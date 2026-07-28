#!/usr/bin/env python3
"""
train.py — TRL-based SFT fine-tuning runner.
IPC protocol: prints JSON lines to stdout. Each line is one event:
  {"type": "metric", "step": N, "loss": X.X, "learning_rate": X.X, "epoch": X.X, "grad_norm": X.X}
  {"type": "status", "message": "...", "stage": "loading|training|saving|done|error"}
  {"type": "progress", "current": N, "total": N, "stage": "..."}
  {"type": "error", "code": "OOM|CONFIG|IMPORT", "message": "...", "suggestions": [...]}

Usage:
  python train.py --config /path/to/config.json

Pause/Resume: If the file <output_dir>/.pause exists, training pauses.
Cancel: If the file <output_dir>/.cancel exists, training stops.
"""

import sys
import os
import json
import time
import math
import signal
import shutil
import argparse
import traceback
from pathlib import Path
from typing import Optional

# Try to import TrainerCallback so IPCCallback below can subclass it (this
# gives us free no-op default implementations for every callback hook that
# transformers' Trainer invokes). If transformers isn't installed yet, fall
# back to a plain stub — import_trl() will emit a proper "missing
# dependency" error before IPCCallback is ever instantiated.
try:
    from transformers import TrainerCallback
except ImportError:
    class TrainerCallback:
        pass

# ── Structured output ────────────────────────────────────────────────────────

def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def emit_error(code: str, message: str, suggestions: list = None):
    emit({"type": "error", "code": code, "message": message, "suggestions": suggestions or []})
    sys.exit(1)


def emit_status(message: str, stage: str = "loading"):
    emit({"type": "status", "message": message, "stage": stage})


def emit_progress(current: int, total: int, stage: str = ""):
    emit({"type": "progress", "current": current, "total": total, "stage": stage})


# ── Lazy imports with helpful error messages ─────────────────────────────────

def import_trl():
    try:
        import transformers
        import trl
        import torch
        import peft
        import datasets
        return transformers, trl, torch, peft, datasets
    except ImportError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        suggestions = [f"pip install {missing}"]
        if "bitsandbytes" in missing:
            suggestions = [
                "pip install bitsandbytes",
                "On Windows: pip install bitsandbytes-windows",
                "On macOS: QLoRA not supported on MPS, use LoRA instead",
            ]
        emit_error("IMPORT", f"Missing dependency: {missing}", suggestions)


def get_device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ── Config ────────────────────────────────────────────────────────────────────

def load_config(config_path: str) -> dict:
    try:
        with open(config_path, "r") as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        emit_error("CONFIG", f"Failed to load config: {e}")

    required = ["model_name_or_path", "dataset_path", "output_dir"]
    for key in required:
        if key not in cfg:
            emit_error("CONFIG", f"Missing required config key: {key}")

    return cfg


# ── Control signals (pause/resume/cancel) ────────────────────────────────────

def check_control_signals(output_dir: str):
    pause_file = Path(output_dir) / ".pause"
    cancel_file = Path(output_dir) / ".cancel"
    if cancel_file.exists():
        emit_status("Cancel signal received. Stopping training...", "done")
        sys.exit(0)
    if pause_file.exists():
        emit_status("Pause signal detected. Training paused.", "training")
        while pause_file.exists():
            if cancel_file.exists():
                emit_status("Cancel signal received during pause. Stopping...", "done")
                sys.exit(0)
            time.sleep(1)
        emit_status("Resuming training...", "training")


# ── Dataset loading ──────────────────────────────────────────────────────────

def load_dataset(cfg: dict):
    _, _, _, _, datasets = import_trl()
    dataset_path = cfg["dataset_path"]
    dataset_format = cfg.get("dataset_format", "auto")

    emit_status(f"Loading dataset from {dataset_path}", "loading")

    try:
        path_obj = Path(dataset_path)
        if path_obj.exists():
            if dataset_format == "json" or path_obj.suffix == ".json":
                data = datasets.load_dataset("json", data_files=str(path_obj), split="train")
            elif dataset_format == "csv" or path_obj.suffix == ".csv":
                data = datasets.load_dataset("csv", data_files=str(path_obj), split="train")
            elif dataset_format == "parquet" or path_obj.suffix == ".parquet":
                data = datasets.load_dataset("parquet", data_files=str(path_obj), split="train")
            elif path_obj.is_dir():
                data = datasets.load_from_disk(str(path_obj))
            else:
                data = datasets.load_dataset(str(path_obj), split="train")
        else:
            data = datasets.load_dataset(dataset_path, split="train")
    except Exception as e:
        emit_error("CONFIG", f"Failed to load dataset: {e}")

    # Subset for debugging
    max_samples = cfg.get("max_samples")
    if max_samples and max_samples < len(data):
        data = data.select(range(max_samples))
        emit_status(f"Using subset of {max_samples} samples", "loading")

    emit_status(f"Dataset loaded: {len(data)} samples", "loading")
    return data


# ── Model loading ────────────────────────────────────────────────────────────

def load_model_and_tokenizer(cfg: dict):
    transformers, _, torch, peft, _ = import_trl()
    model_name = cfg["model_name_or_path"]
    use_qlora = cfg.get("use_qlora", False)
    use_flash_attention = cfg.get("use_flash_attention", False)
    device = get_device()
    dtype = cfg.get("torch_dtype", "bfloat16" if device == "cuda" else "float32")

    torch_dtype = {
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
        "float32": torch.float32,
    }.get(dtype, torch.bfloat16 if device == "cuda" else torch.float32)

    emit_status(f"Loading model {model_name} on {device}", "loading")

    quantization_config = None
    if use_qlora:
        try:
            from transformers import BitsAndBytesConfig
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch_dtype,
                bnb_4bit_use_double_quant=True,
            )
        except ImportError:
            emit_error("IMPORT", "bitsandbytes not available for QLoRA", [
                "pip install bitsandbytes",
                "Use LoRA instead (set use_qlora: false)",
            ])

    try:
        model = transformers.AutoModelForCausalLM.from_pretrained(
            model_name,
            quantization_config=quantization_config,
            torch_dtype=torch_dtype if not quantization_config else None,
            device_map="auto" if device == "cuda" else None,
            trust_remote_code=cfg.get("trust_remote_code", False),
            attn_implementation="flash_attention_2" if use_flash_attention else "eager",
        )
        tokenizer = transformers.AutoTokenizer.from_pretrained(
            model_name,
            trust_remote_code=cfg.get("trust_remote_code", False),
        )
    except torch.cuda.OutOfMemoryError:
        emit_error("OOM", "GPU out of memory while loading model", [
            "Use QLoRA (4-bit quantization) to reduce memory",
            "Reduce model size",
            "Enable gradient checkpointing",
            "Close other GPU applications",
        ])
    except Exception as e:
        emit_error("CONFIG", f"Failed to load model: {e}")

    # Padding token
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    return model, tokenizer


# ── LoRA / PEFT config ───────────────────────────────────────────────────────

def get_lora_config(cfg: dict):
    _, _, _, peft, _ = import_trl()
    use_qlora = cfg.get("use_qlora", False)

    if cfg.get("use_lora", True):
        return peft.LoraConfig(
            r=cfg.get("lora_r", 8),
            lora_alpha=cfg.get("lora_alpha", 16),
            lora_dropout=cfg.get("lora_dropout", 0.05),
            target_modules=cfg.get("lora_target_modules", ["q_proj", "v_proj", "k_proj", "o_proj"]),
            bias="none",
            task_type="CAUSAL_LM",
            use_dora=cfg.get("use_dora", False),
        )
    return None


# ── Training arguments ────────────────────────────────────────────────────────

def get_training_args(cfg: dict, device: str, dataset_text_field: Optional[str] = None):
    transformers, trl, torch, _, _ = import_trl()
    output_dir = cfg["output_dir"]

    # Hardware-aware defaults
    per_device_batch = cfg.get("per_device_train_batch_size", 2)
    gradient_acc = cfg.get("gradient_accumulation_steps", 4)
    effective_batch = per_device_batch * gradient_acc

    if device == "mps":
        # MPS (Apple Silicon) often needs mixed precision and smaller batches
        per_device_batch = min(per_device_batch, 4)
        gradient_acc = max(gradient_acc, 4)

    # NOTE: current TRL no longer accepts `dataset_text_field` / `max_seq_length`
    # (now `max_length`) as direct SFTTrainer kwargs — they live on SFTConfig,
    # which is a drop-in superset of TrainingArguments, so we build that instead.
    return trl.SFTConfig(
        output_dir=output_dir,
        per_device_train_batch_size=per_device_batch,
        gradient_accumulation_steps=gradient_acc,
        learning_rate=cfg.get("learning_rate", 2e-4),
        warmup_steps=cfg.get("warmup_steps", 100),
        num_train_epochs=cfg.get("num_train_epochs", 3),
        max_steps=cfg.get("max_steps", -1),
        logging_steps=cfg.get("logging_steps", 10),
        save_steps=cfg.get("save_steps", 500),
        eval_strategy="no",
        save_strategy="steps",
        bf16=cfg.get("bf16", device == "cuda"),
        fp16=cfg.get("fp16", False),
        tf32=cfg.get("tf32", False),
        gradient_checkpointing=cfg.get("gradient_checkpointing", True),
        gradient_checkpointing_kwargs={"use_reentrant": False} if cfg.get("gradient_checkpointing", True) else None,
        optim=cfg.get("optim", "adamw_torch"),
        lr_scheduler_type=cfg.get("lr_scheduler_type", "cosine"),
        weight_decay=cfg.get("weight_decay", 0.01),
        max_grad_norm=cfg.get("max_grad_norm", 1.0),
        seed=cfg.get("seed", 42),
        report_to="none",
        ddp_find_unused_parameters=False if cfg.get("use_lora", True) else None,
        dataloader_num_workers=cfg.get("dataloader_num_workers", 2),
        save_total_limit=cfg.get("save_total_limit", 3),
        # For structured datasets (prompt-completion / conversational),
        # SFTTrainer needs the raw columns (e.g. "completion") to still be
        # there when it does its own dataset preparation. The generic
        # Trainer-level column pruning doesn't know that and will strip them
        # first if left on, causing a bare KeyError deep inside SFTTrainer.
        # Only default it on for genuine flat-text datasets.
        remove_unused_columns=cfg.get("remove_unused_columns", dataset_text_field is not None),
        dataset_text_field=dataset_text_field,
        max_length=cfg.get("max_seq_length", cfg.get("max_length", 2048)),
    )


# ── Custom callback for IPC streaming ─────────────────────────────────────────

class IPCCallback(TrainerCallback):
    def __init__(self, output_dir: str, total_steps: int):
        self.output_dir = output_dir
        self.total_steps = total_steps
        self.last_time = time.time()
        self.last_log = 0

    def on_log(self, args, state, control, logs=None, **kwargs):
        if not logs:
            return
        step = state.global_step
        emit({
            "type": "metric",
            "step": step,
            "loss": logs.get("loss", None),
            "learning_rate": logs.get("learning_rate", None),
            "epoch": logs.get("epoch", None),
            "grad_norm": logs.get("grad_norm", None),
            "elapsed_seconds": time.time() - self.last_time,
        })
        self.last_time = time.time()
        self.last_log = step

        # Check control signals on each log step
        check_control_signals(self.output_dir)

    def on_step_end(self, args, state, control, **kwargs):
        if state.global_step % 10 == 0:
            emit_progress(state.global_step, self.total_steps, "training")

    def on_train_end(self, args, state, control, **kwargs):
        emit_status("Training completed", "done")

    def on_train_begin(self, args, state, control, **kwargs):
        self.last_time = time.time()
        emit_status("Training started", "training")
        emit_progress(0, self.total_steps, "training")


# ── Main training function ───────────────────────────────────────────────────

def train(cfg: dict):
    transformers, trl, torch, _, _ = import_trl()
    device = get_device()
    output_dir = cfg["output_dir"]

    # Create output directory
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Check for existing checkpoints (resume support)
    resume_checkpoint = None
    if cfg.get("resume", True):
        from glob import glob
        checkpoints = sorted(glob(os.path.join(output_dir, "checkpoint-*")))
        if checkpoints:
            resume_checkpoint = checkpoints[-1]
            emit_status(f"Found existing checkpoint: {resume_checkpoint}", "loading")

    # Load dataset
    dataset = load_dataset(cfg)

    # Format dataset if needed
    text_column = cfg.get("text_column", "text")
    prompt_template = cfg.get("prompt_template", None)
    if prompt_template and text_column in dataset.column_names:
        def format_fn(examples):
            texts = []
            for i in range(len(examples[text_column])):
                texts.append(prompt_template.format(text=examples[text_column][i]))
            return {"text": texts}
        dataset = dataset.map(format_fn, batched=True, remove_columns=dataset.column_names)
        text_column_content = "text"
    else:
        text_column_content = text_column

    # Decide what (if anything) to tell TRL is the "text field". TRL natively
    # understands conversational ("messages"/"conversations") and
    # prompt-completion ("prompt" + "completion") datasets with no text field
    # at all — forcing dataset_text_field on those datasets confuses TRL's
    # format auto-detection and surfaces as a bare KeyError deep inside
    # SFTTrainer. Only pass a text field for genuine flat-text datasets, and
    # only once we've confirmed that column actually exists.
    column_names = set(dataset.column_names)
    if {"prompt", "completion"} <= column_names or "messages" in column_names or "conversations" in column_names:
        dataset_text_field = None
    elif text_column_content in column_names:
        dataset_text_field = text_column_content
    else:
        emit_error(
            "CONFIG",
            f"Dataset has no '{text_column_content}' column to train on. Available columns: {sorted(column_names)}",
            [
                'Set "text_column" in your config to an existing column name',
                'Or set "prompt_template" to build a text field from another column',
                "If your dataset is already prompt/completion or chat-formatted, no text_column is needed",
            ],
        )

    # Load model
    model, tokenizer = load_model_and_tokenizer(cfg)

    # Configure PEFT
    peft_config = get_lora_config(cfg)
    use_lora = peft_config is not None

    # Training arguments (get_training_args may adjust batch size / grad
    # accumulation for certain hardware, e.g. MPS — compute total_steps
    # from those actual values so progress reporting stays accurate)
    training_args = get_training_args(cfg, device, dataset_text_field)

    # Determine total training steps
    if cfg.get("max_steps", -1) > 0:
        total_steps = cfg["max_steps"]
    else:
        epochs = cfg.get("num_train_epochs", 3)
        steps_per_epoch = max(1, len(dataset) // (
            training_args.per_device_train_batch_size * training_args.gradient_accumulation_steps
        ))
        total_steps = int(steps_per_epoch * epochs)

    # Callback
    emit_status(f"Starting training on {device} ({total_steps} steps)", "training")

    try:
        trainer = trl.SFTTrainer(
            model=model,
            processing_class=tokenizer,
            args=training_args,
            train_dataset=dataset,
            peft_config=peft_config,
            callbacks=[IPCCallback(output_dir, total_steps)],
        )

        trainer.train(resume_from_checkpoint=resume_checkpoint)

        # Save final model
        emit_status("Saving final model...", "saving")
        trainer.save_model()
        tokenizer.save_pretrained(output_dir)

        # Save training config alongside model
        final_cfg_path = Path(output_dir) / "training_config.json"
        final_cfg_path.write_text(json.dumps(cfg, indent=2))

        emit_status("Model saved successfully", "done")

    except torch.cuda.OutOfMemoryError:
        emit_error("OOM", "GPU out of memory during training", [
            "Reduce per_device_train_batch_size (try 1)",
            "Increase gradient_accumulation_steps",
            "Enable gradient checkpointing (already enabled by default)",
            "Use LoRA with lower rank (r=4 or r=8)",
            "Use QLoRA (4-bit quantization)",
            "Reduce max_seq_length",
        ])
    except Exception as e:
        emit_status(f"Training failed: {e}", "error")
        emit({"type": "error", "code": "TRAIN", "message": str(e), "traceback": traceback.format_exc()})


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="TRL-based SFT fine-tuning runner")
    parser.add_argument("--config", help="Path to training config JSON")
    parser.add_argument("--platform-check", action="store_true", help="Only check platform compatibility and exit")
    args = parser.parse_args()

    # Handle SIGTERM gracefully
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    try:
        if args.platform_check:
            try:
                import torch
                device = get_device()
                info = {
                    "device": device,
                    "cuda_available": torch.cuda.is_available(),
                    "cuda_version": torch.version.cuda if torch.cuda.is_available() else None,
                    "mps_available": getattr(torch.backends, "mps", None) and torch.backends.mps.is_available(),
                    "torch_version": torch.__version__,
                }
            except ImportError as e:
                info = {
                    "device": "unknown",
                    "cuda_available": False,
                    "cuda_version": None,
                    "mps_available": False,
                    "torch_version": None,
                    "error": f"PyTorch not installed: {e}",
                }
            emit({"type": "platform_check", **info})
            return

        if not args.config:
            emit_error("CONFIG", "--config is required", [])

        cfg = load_config(args.config)
        train(cfg)
    except SystemExit:
        # Preserve the original exit code (e.g. sys.exit(1) from emit_error)
        # instead of silently turning every error path into a 0/success exit.
        raise
    except Exception as e:
        emit_error("FATAL", str(e), [])
        sys.exit(1)


if __name__ == "__main__":
    main()