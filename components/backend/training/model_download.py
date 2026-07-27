#!/usr/bin/env python3
"""
model_download.py — Download models from Hugging Face Hub with progress streaming.
Emits JSON lines to stdout for IPC consumption.

Events:
  {"type": "progress", "current": X, "total": Y, "stage": "downloading"}
  {"type": "status", "message": "...", "stage": "loading|done|error"}
  {"type": "error", "code": "...", "message": "..."}
  {"type": "done", "path": "/path/to/model"}

Usage:
  python model_download.py --model-id mistralai/Mistral-7B-v0.1 --output /path/to/models
"""

import sys
import os
import json
import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def emit_error(code: str, message: str):
    emit({"type": "error", "code": code, "message": message})
    sys.exit(1)


def download_model(model_id: str, output_dir: str, revision: str = "main"):
    try:
        from huggingface_hub import snapshot_download, HfApi
    except ImportError:
        emit_error("IMPORT", "huggingface_hub not installed. Run: pip install huggingface_hub")

    output_path = Path(output_dir) / model_id.replace("/", "--")
    output_path.mkdir(parents=True, exist_ok=True)

    emit({"type": "status", "message": f"Starting download of {model_id}", "stage": "downloading"})

    class ProgressCallback:
        def __init__(self):
            self.last_pct = -1

        def __call__(self, current, total, status=None):
            if total > 0:
                pct = int(current / total * 100)
                if pct != self.last_pct and pct % 5 == 0:
                    emit({"type": "progress", "current": current, "total": total, "stage": "downloading"})
                    self.last_pct = pct

    try:
        callback = ProgressCallback()
        result_path = snapshot_download(
            repo_id=model_id,
            local_dir=str(output_path),
            revision=revision,
            local_dir_use_symlinks=False,
            resume_download=True,
            ignore_patterns=["*.safetensors", "pytorch_model*.bin"] if "--no-weights" in sys.argv else None,
        )
        emit({"type": "done", "path": str(output_path), "model_id": model_id})
    except Exception as e:
        emit_error("DOWNLOAD", str(e))


def list_local_models(models_dir: str) -> list:
    models_path = Path(models_dir)
    if not models_path.exists():
        return []

    results = []
    for item in models_path.iterdir():
        if item.is_dir():
            config_file = item / "config.json"
            model_id = item.name.replace("--", "/")
            info = {
                "name": item.name,
                "model_id": model_id,
                "path": str(item),
                "has_config": config_file.exists(),
                "size_bytes": sum(f.stat().st_size for f in item.rglob("*") if f.is_file()),
            }
            results.append(info)
    return results


def check_model_compatibility(model_id: str):
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        info = api.model_info(model_id)
        pipeline_tag = info.pipeline_tag if info.pipeline_tag else "unknown"
        library_name = info.library_name if info.library_name else "unknown"

        # Determine likely target modules for LoRA based on model type
        suggested_modules = get_suggested_modules(info)

        emit({
            "type": "compatibility",
            "model_id": model_id,
            "pipeline_tag": pipeline_tag,
            "library_name": library_name,
            "is_text_generation": pipeline_tag in ("text-generation", "text2text-generation"),
            "suggested_lora_modules": suggested_modules,
            "card_data": info.card_data if hasattr(info, "card_data") else None,
        })
    except Exception as e:
        emit_error("COMPAT", f"Failed to check model: {e}")


def get_suggested_modules(model_info) -> list:
    config = model_info.card_data if hasattr(model_info, "card_data") else {}
    if not config:
        return ["q_proj", "v_proj", "k_proj", "o_proj"]

    model_type = ""
    if hasattr(config, "architectures") and config.architectures:
        model_type = config.architectures[0].lower() if config.architectures else ""

    # Architecture-specific target modules
    if "llama" in model_type:
        return ["q_proj", "v_proj", "k_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    if "mistral" in model_type:
        return ["q_proj", "v_proj", "k_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    if "gemma" in model_type:
        return ["q_proj", "v_proj", "k_proj", "o_proj"]
    if "phi" in model_type:
        return ["q_proj", "v_proj", "k_proj", "o_proj", "fc1", "fc2"]
    if "falcon" in model_type:
        return ["query_key_value", "dense", "dense_h_to_4h", "dense_4h_to_h"]
    if "gpt" in model_type:
        return ["c_attn", "c_proj", "c_fc"]

    return ["q_proj", "v_proj", "k_proj", "o_proj"]


def main():
    parser = argparse.ArgumentParser(description="HF Hub model downloader")
    parser.add_argument("--model-id", help="Model ID on Hugging Face Hub")
    parser.add_argument("--output", default=str(Path.cwd() / "models"), help="Output directory for downloaded models")
    parser.add_argument("--revision", default="main", help="Model revision/branch")
    parser.add_argument("--list", action="store_true", help="List locally downloaded models")
    parser.add_argument("--check", action="store_true", help="Check model compatibility")
    parser.add_argument("--no-weights", action="store_true", help="Skip weight files (config only)")

    args = parser.parse_args()

    if args.list:
        models = list_local_models(args.output)
        emit({"type": "model_list", "models": models, "models_dir": args.output})
        return

    if args.check and args.model_id:
        check_model_compatibility(args.model_id)
        return

    if not args.model_id:
        emit_error("USAGE", "Provide --model-id for download or --list to list local models")

    download_model(args.model_id, args.output, args.revision)


if __name__ == "__main__":
    main()
