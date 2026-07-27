#!/usr/bin/env python3
"""
merge_adapter.py — Merge LoRA adapter weights into the base model and save.
Emits JSON lines to stdout for IPC.

Usage:
  python merge_adapter.py --base-model /path/to/model --adapter /path/to/adapter --output /path/to/merged
"""

import sys
import json
import argparse
from pathlib import Path


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def emit_error(code: str, message: str):
    emit({"type": "error", "code": code, "message": message})
    sys.exit(1)


def merge(base_model_path: str, adapter_path: str, output_path: str):
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel
    except ImportError as e:
        emit_error("IMPORT", f"Missing dependency: {e}")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    emit({"type": "status", "message": "Loading base model...", "stage": "loading"})
    try:
        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_path,
            torch_dtype=torch.bfloat16 if device == "cuda" else torch.float32,
            device_map="auto" if device == "cuda" else None,
            trust_remote_code=True,
        )
        tokenizer = AutoTokenizer.from_pretrained(base_model_path, trust_remote_code=True)
    except Exception as e:
        emit_error("LOAD", f"Failed to load base model: {e}")

    emit({"type": "status", "message": "Loading LoRA adapter...", "stage": "loading"})
    try:
        model = PeftModel.from_pretrained(base_model, adapter_path)
    except Exception as e:
        emit_error("LOAD", f"Failed to load adapter: {e}")

    emit({"type": "status", "message": "Merging weights...", "stage": "merging"})
    try:
        merged = model.merge_and_unload()
    except Exception as e:
        emit_error("MERGE", f"Failed to merge adapter: {e}")

    emit({"type": "status", "message": f"Saving merged model to {output_path}", "stage": "saving"})
    Path(output_path).mkdir(parents=True, exist_ok=True)
    try:
        merged.save_pretrained(output_path, safe_serialization=True)
        tokenizer.save_pretrained(output_path)
    except Exception as e:
        emit_error("SAVE", f"Failed to save merged model: {e}")

    emit({"type": "done", "path": output_path})


def main():
    parser = argparse.ArgumentParser(description="Merge LoRA adapter into base model")
    parser.add_argument("--base-model", required=True, help="Path to base model")
    parser.add_argument("--adapter", required=True, help="Path to LoRA adapter")
    parser.add_argument("--output", required=True, help="Output path for merged model")

    args = parser.parse_args()
    merge(args.base_model, args.adapter, args.output)


if __name__ == "__main__":
    main()
