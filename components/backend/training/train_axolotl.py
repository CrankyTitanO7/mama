#!/usr/bin/env python3
"""
train_axolotl.py - Axolotl fine-tuning runner (the "power" backend).

Target: Linux + CUDA, NVIDIA GPUs.

This is a thin wrapper around Axolotl (no custom training loop is written
here). Flow:

  1. validate the backend (Linux + CUDA) and the mama training config JSON,
  2. make sure "axolotl" is installed (pip install, streamed like the
     built-in backend's install_deps step),
  3. translate the mama JSON config into an Axolotl YAML config
     (config.yaml inside the output directory),
  4. spawn: accelerate launch -m axolotl.cli.train config.yaml
     and stream the HuggingFace Trainer output back to the mama IPC
     protocol used by the existing Training Monitor:

       {"type": "metric", "step": N, "loss": X, "learning_rate": X, "epoch": X}
       {"type": "status", "message": "...", "stage": "loading|training|saving|done|error"}
       {"type": "progress", "current": N, "total": N, "stage": "..."}
       {"type": "error", "code": "OOM|CONFIG|IMPORT|TRAIN", "message": "...", "suggestions": [...]}

Pause / Resume / Cancel markers match the built-in backend: a ".pause" or
".cancel" file inside the output directory. Cancelling terminates the
accelerate process tree; pausing uses SIGSTOP/SIGCONT on the process group
(step boundaries inside the trainer are not interruptible).
"""

import sys
import os
import re
import json
import time
import signal
import argparse
import threading
import subprocess
from pathlib import Path


def clean_subprocess_env():
    """Return a copy of os.environ safe for spawning real Python subprocesses.

    When frozen, PyInstaller's onefile bootloader points LD_LIBRARY_PATH /
    DYLD_LIBRARY_PATH at its own bundled-libs temp directory; a spawned
    system/venv Python would otherwise load the app's bundled shared
    libraries instead of its own. PyInstaller saves the pre-bootloader value
    as *_ORIG so children can restore it.
    """
    env = os.environ.copy()
    if getattr(sys, 'frozen', False):
        for var, orig_var in (
            ('LD_LIBRARY_PATH', 'LD_LIBRARY_PATH_ORIG'),
            ('DYLD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH_ORIG'),
        ):
            if orig_var in env:
                env[var] = env[orig_var]
            else:
                env.pop(var, None)
    return env


# ── Structured output ────────────────────────────────────────────────────────


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def emit_error(code, message, suggestions=None, traceback_str=None):
    emit({"type": "error", "code": code, "message": message,
          "suggestions": suggestions or [], "traceback": traceback_str})
    sys.exit(1)


def emit_status(message, stage="loading"):
    emit({"type": "status", "message": message, "stage": stage})


def emit_progress(current, total, stage=""):
    emit({"type": "progress", "current": current, "total": total, "stage": stage})


# ── Minimal YAML writer (no PyYAML dependency needed) ────────────────────────

_YAML_NEEDS_QUOTE = re.compile(r'[:#\[\]{},&*!|><?%"\'@`\\\n]')


def _yaml_scalar(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    needs = bool(_YAML_NEEDS_QUOTE.search(s))
    needs = needs or s == "" or (s[0] in "!&*-?>" or s[0].isspace())
    needs = needs or s.strip() in ("true", "false", "null", "yes", "no",
                                   "on", "off", "None", "~")
    if not needs:
        return s
    # single-quote, doubling embedded single quotes
    return "'" + s.replace("'", "''") + "'"


def _yaml_item(item, indent):
    """Render a dict as a YAML list item starting with a dash. Handles scalar
    and nested-dict/mapping values; the first key shares the '- ' line and
    subsequent keys are indented underneath."""
    pad = " " * indent
    out = []
    first = True
    for key, value in item.items():
        lead = "- " if first else "  "
        if isinstance(value, dict):
            if value:
                out.append(pad + lead + key + ":")
                out.extend(_yaml_render(value, indent + 4))
            else:
                out.append(pad + lead + key + ": {}")
        elif isinstance(value, list):
            out.append(pad + lead + key + ":")
            for entry in value:
                if isinstance(entry, dict):
                    out.extend(_yaml_item(entry, indent + 6))
                else:
                    out.append(" " * (indent + 4) + "- " + _yaml_scalar(entry))
        else:
            out.append(pad + lead + key + ": " + _yaml_scalar(value))
        first = False
    return out


def _yaml_render(cfg, indent):
    """Render a dict as indented YAML lines. Values may be scalars, dicts or
    lists of dicts / lists of scalars (covers every Axolotl config shape used
    by mama)."""
    lines = []
    prefix = " " * indent
    for key, value in cfg.items():
        if isinstance(value, dict):
            if value:
                lines.append(prefix + key + ":")
                lines.extend(_yaml_render(value, indent + 2))
            else:
                lines.append(prefix + key + ": {}")
        elif isinstance(value, list):
            if not value:
                lines.append(prefix + key + ": []")
                continue
            lines.append(prefix + key + ":")
            for item in value:
                if isinstance(item, dict):
                    lines.extend(_yaml_item(item, indent + 2))
                else:
                    lines.append(prefix + "  - " + _yaml_scalar(item))
        else:
            lines.append(prefix + key + ": " + _yaml_scalar(value))
    return lines


def yaml_dump(cfg: dict) -> str:
    return "\n".join(_yaml_render(cfg, 0)) + "\n"


# ── Platform / backend validation ────────────────────────────────────────────


def get_device():
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def ensure_axolotl():
    """Import axolotl; if missing, pip install it (streamed) and retry."""
    try:
        import axolotl  # noqa: F401
        emit_status("Axolotl already installed", "loading")
        return True
    except ImportError:
        pass

    emit_status("Installing Axolotl (this can take a few minutes)...", "loading")
    cmd = [sys.executable, "-m", "pip", "install", "--no-input",
           "--disable-pip-version-check", "axolotl"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1, env=clean_subprocess_env())
    ok = True
    for line in iter(proc.stdout.readline, ""):
        if line and line.strip():
            emit({"type": "install_log", "text": line.rstrip()})
    proc.wait()
    if proc.returncode != 0:
        emit_error("IMPORT", "Failed to install axolotl via pip", [
            "Check your network connection and pip index",
            "Axolotl requires Linux + CUDA (see docs)",
            "On Windows/macOS use the built-in TRL backend instead",
        ])
        return False
    try:
        import axolotl  # noqa: F401
        return True
    except ImportError as e:
        emit_error("IMPORT", f"axolotl installed but failed to import: {e}")
        return False


# ── Config JSON → Axolotl YAML translation ───────────────────────────────────


def resolve_dataset_section(cfg: dict) -> dict:
    """Pick an Axolotl dataset type + fields from the mama dataset config.

    mama configs carry a text_column (flat text) and optionally
    prompt/completion or messages columns. Axolotl understands those shapes
    natively via its "text", "completion" and "conversation" dataset types.
    """
    ds = {"path": cfg.get("dataset_path", "")}
    text_column = cfg.get("text_column") or "text"
    columns = cfg.get("dataset_columns") or []

    if "prompt" in columns and "completion" in columns:
        ds["type"] = "completion"
        ds["field"] = {
            "prompt": "prompt",
            "completion": "completion",
        }
        return ds
    if "messages" in columns or "conversations" in columns:
        ds["type"] = "conversation"
        return ds
    ds["type"] = "text"
    ds["field"] = {"text": text_column}
    return ds


def build_axolotl_yaml(cfg: dict, output_dir: str) -> str:
    """Translate a mama training config JSON into an Axolotl YAML dict."""
    use_qlora = bool(cfg.get("use_qlora", False))
    use_lora = bool(cfg.get("use_lora", True))
    max_steps = int(cfg.get("max_steps", -1) or -1)
    device = get_device()
    dtype = cfg.get("torch_dtype", "bfloat16" if device == "cuda" else "float32")

    yaml_cfg = {
        "base_model": cfg.get("model_name_or_path", ""),
        "model_type": "AutoModelForCausalLM",
        "tokenizer_type": "AutoTokenizer",
        "strict": False,
        "load_in_4bit": use_qlora,
        "bnb_4bit_quant_type": "nf4",
        "bnb_4bit_compute_dtype": dtype,
        "bnb_4bit_use_double_quant": True,
        "datasets": [resolve_dataset_section(cfg)],
        "dataset_prepared_path": os.path.join(output_dir, "prepared"),
        "val_set_size": 0.0,
        "output_dir": output_dir,
        "sequence_len": int(cfg.get("max_seq_length") or 2048),
        "sample_packing": True,
        "adapter": "lora" if use_lora else "full",
        "lora_r": int(cfg.get("lora_r") or 8),
        "lora_alpha": int(cfg.get("lora_alpha") or 16),
        "lora_dropout": float(cfg.get("lora_dropout") or 0.05),
        "lora_target_modules": cfg.get("lora_target_modules",
                                        ["q_proj", "v_proj", "k_proj", "o_proj"]),
        "gradient_accumulation_steps": int(cfg.get("gradient_accumulation_steps") or 4),
        "micro_batch_size": int(cfg.get("per_device_train_batch_size") or 2),
        "num_epochs": float(cfg.get("num_train_epochs") or 3),
        "learning_rate": float(cfg.get("learning_rate") or 2e-4),
        "optimizer": cfg.get("optimizer") or ("paged_adamw_8bit" if use_qlora
                                              else "adamw_torch"),
        "lr_scheduler": cfg.get("lr_scheduler_type", "cosine"),
        "warmup_steps": int(cfg.get("warmup_steps") or 100),
        "logging_steps": int(cfg.get("logging_steps") or 10),
        "save_steps": int(cfg.get("save_steps") or 500),
        "save_total_limit": int(cfg.get("save_total_limit") or 3),
        "gradient_checkpointing": bool(cfg.get("gradient_checkpointing", True)),
        "flash_attention": bool(cfg.get("use_flash_attention", False)),
        "bf16": bool(cfg.get("bf16", device == "cuda")),
        "fp16": bool(cfg.get("fp16", False)),
        "tf32": bool(cfg.get("tf32", False)),
        "weight_decay": float(cfg.get("weight_decay") or 0.01),
        "max_grad_norm": float(cfg.get("max_grad_norm") or 1.0),
        "seed": int(cfg.get("seed") or 42),
        "trust_remote_code": bool(cfg.get("trust_remote_code", False)),
        "use_fast_tokenizer": True,
        "saves_per_epoch": 1,
    }
    if max_steps > 0:
        yaml_cfg["training_steps"] = max_steps
    if cfg.get("max_samples"):
        yaml_cfg["datasets"][0]["max_packed_sequence_length"] = None
        ds = yaml_cfg["datasets"][0]
        ds["max_sample_length"] = None
        ds["limit"] = int(cfg["max_samples"])

    # Do not require flash-attn to build (kept optional per architecture docs)
    return yaml_dump(yaml_cfg)


# ── Output parsing (HF Trainer lines → mama IPC) ─────────────────────────────


_TRAIN_DICT_RE = re.compile(r"\{.*?\}")


def parse_trainer_line(line: str, state: dict):
    """Parse one stdout line from accelerate/axolotl into mama IPC events.

    HuggingFace trainers print dict logs like:
      {'loss': 1.4321, 'learning_rate': 0.0002, 'epoch': 0.12}
    and tqdm prints 'Step 120/1000' style progress.
    """
    text = line.strip()
    if not text:
        return

    m = _TRAIN_DICT_RE.search(text)
    if m:
        try:
            import ast
            data = ast.literal_eval(m.group(0))
            if isinstance(data, dict) and "loss" in data:
                step = data.get("step") or state.get("last_step", 0) + 1
                state["last_step"] = int(step)
                emit({
                    "type": "metric",
                    "step": int(step),
                    "loss": data.get("loss"),
                    "learning_rate": data.get("learning_rate"),
                    "epoch": data.get("epoch"),
                })
                return
        except (ValueError, SyntaxError):
            pass

    step_m = re.search(r"Step\s+(\d+)\s*/\s*(\d+)", text, re.IGNORECASE)
    if step_m:
        emit_progress(int(step_m.group(1)), int(step_m.group(2)), "training")
        return

    if "out of memory" in text.lower() or "OutOfMemoryError" in text:
        emit_error("OOM", "GPU out of memory during training", [
            "Reduce micro_batch_size (try 1)",
            "Increase gradient_accumulation_steps",
            "Use LoRA with a lower rank (r=4 or r=8)",
            "Use QLoRA (4-bit quantization) if not already enabled",
            "Reduce max_seq_length / sequence_len",
        ])
        return

    # Pass everything else through as a plain log line so the monitor stays
    # verbose without spamming the loss chart
    emit({"type": "log", "text": text})


# ── Process tree helpers ─────────────────────────────────────────────────────


def kill_process_tree(proc):
    """Terminate a subprocess and its whole process group."""
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.terminate()
        except OSError:
            pass


def watch_control_files(output_dir: str, proc: subprocess.Popen):
    """Background thread: poll .pause / .cancel markers like train.py does."""
    pause_file = Path(output_dir) / ".pause"
    cancel_file = Path(output_dir) / ".cancel"
    paused = False
    while proc.poll() is None:
        if cancel_file.exists():
            emit_status("Cancel signal received. Stopping training...", "done")
            kill_process_tree(proc)
            return
        if pause_file.exists() and not paused:
            paused = True
            emit_status("Pause signal detected. Pausing...", "training")
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGSTOP)
            except (ProcessLookupError, PermissionError, OSError):
                pass
        elif not pause_file.exists() and paused:
            paused = False
            emit_status("Resuming training...", "training")
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGCONT)
            except (ProcessLookupError, PermissionError, OSError):
                pass
        time.sleep(1)


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Axolotl fine-tuning runner")
    parser.add_argument("--config", help="Path to mama training config JSON")
    parser.add_argument("--platform-check", action="store_true",
                        help="Only check Axolotl backend availability and exit")
    parser.add_argument("--gen-config", action="store_true",
                        help="Only write the Axolotl YAML config, then exit (no install, no training)")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    try:
        if args.platform_check:
            info = {"backend": "axolotl"}
            try:
                device = get_device()
                info.update({
                    "device": device,
                    "cuda_available": device == "cuda",
                    "supported": device == "cuda" and not sys.platform.startswith("darwin"),
                    "axolotl_installed": False,
                })
                try:
                    import axolotl  # noqa: F401
                    info["axolotl_installed"] = True
                except ImportError:
                    pass
            except ImportError as e:
                info.update({
                    "device": "unknown", "cuda_available": False,
                    "supported": False, "error": str(e),
                })
            emit({"type": "platform_check", **info})
            return

        if not args.config:
            emit_error("CONFIG", "--config is required", [])

        with open(args.config, "r") as f:
            cfg = json.load(f)

        output_dir = cfg.get("output_dir", "")
        if not output_dir:
            emit_error("CONFIG", "output_dir is required in config")
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        # Backend validation (the "power" backend targets Linux + CUDA).
        # Skipped in --gen-config so users can preview the YAML anywhere.
        if not args.gen_config:
            if sys.platform.startswith("darwin") or sys.platform == "win32":
                emit_error("CONFIG", "Axolotl backend requires Linux + CUDA", [
                    "This backend only runs on Linux with an NVIDIA GPU",
                    "Switch the backend selector to 'Built-in (TRL)' on this OS",
                    "On WSL2 inside Windows, the Linux backend may work",
                ])
            device = get_device()
            if device != "cuda":
                emit_error("CONFIG", "Axolotl backend requires CUDA (no GPU detected)", [
                    "Install NVIDIA CUDA PyTorch from the Setup wizard",
                    "Or switch to the built-in (TRL) backend",
                ])

        # Write config for resume flows (same file the TRL backend writes)
        config_path = Path(output_dir) / "training_config.json"
        config_path.write_text(json.dumps(cfg, indent=2), "utf-8")

        emit_status("Preparing Axolotl run...", "loading")

        # Translate JSON → Axolotl YAML
        yaml_text = build_axolotl_yaml(cfg, output_dir)
        yaml_path = Path(output_dir) / "config.yaml"
        yaml_path.write_text(yaml_text, "utf-8")
        emit_status(f"Axolotl config written: {yaml_path}", "loading")

        if args.gen_config:
            emit({"type": "axolotl_config", "path": str(yaml_path), "yaml": yaml_text})
            return

        if not ensure_axolotl():
            return

        # ── Spawn: accelerate launch -m axolotl.cli.train config.yaml ──
        cmd = ["accelerate", "launch", "-m", "axolotl.cli.train", str(yaml_path)]
        emit_status(f"Launching: {' '.join(cmd)}", "training")

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                start_new_session=True,
                env=clean_subprocess_env(),
            )
        except FileNotFoundError:
            # accelerate CLI missing (shouldn't happen after pip install)
            emit_error("IMPORT", "accelerate command not found", [
                "pip install accelerate",
                "Or reinstall axolotl (pip install --upgrade axolotl)",
            ])
            return

        state = {"last_step": 0}
        threading.Thread(target=watch_control_files,
                         args=(output_dir, proc), daemon=True).start()

        for line in iter(proc.stdout.readline, ""):
            if line:
                parse_trainer_line(line, state)
        proc.wait()

        if proc.returncode == 0:
            emit_status("Training completed. Checkpoints saved to " + output_dir, "done")
        else:
            # If we already emitted a structured error, exit quietly; otherwise
            # surface the raw failure.
            emit({"type": "done", "code": proc.returncode})
            sys.exit(proc.returncode)
    except SystemExit:
        raise
    except Exception as e:
        emit_error("FATAL", str(e), [], traceback_str=None)


if __name__ == "__main__":
    main()
