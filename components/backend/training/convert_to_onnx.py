#!/usr/bin/env python3
"""
convert_to_onnx.py — Convert a trained model to ONNX format for web export.
"""

import json, os, sys, argparse
from pathlib import Path


def emit(data: dict):
    print(json.dumps(data), flush=True)


def convert_to_onnx(input_dir: str, output_dir: str):
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Look for final_model or latest checkpoint
    model_dir = input_path / 'final_model'
    if not model_dir.exists():
        checkpoints = sorted(input_path.glob('checkpoint-*'))
        if checkpoints:
            model_dir = checkpoints[-1]
        else:
            emit({'type': 'error', 'message': 'No model found in input directory'})
            return False

    emit({'type': 'status', 'message': f'Converting model from {model_dir} to ONNX...'})

    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        import torch

        model = AutoModelForSequenceClassification.from_pretrained(str(model_dir))
        tokenizer = AutoTokenizer.from_pretrained(str(model_dir))

        model.eval()

        # Create dummy input for tracing
        dummy_input = tokenizer("dummy input for tracing", return_tensors="pt")

        onnx_path = output_path / 'model.onnx'

        with torch.no_grad():
            torch.onnx.export(
                model,
                (dummy_input['input_ids'], dummy_input['attention_mask']),
                str(onnx_path),
                input_names=['input_ids', 'attention_mask'],
                output_names=['logits'],
                dynamic_axes={
                    'input_ids': {0: 'batch_size', 1: 'sequence'},
                    'attention_mask': {0: 'batch_size', 1: 'sequence'},
                    'logits': {0: 'batch_size'},
                },
                opset_version=14,
            )

        # Save tokenizer alongside the ONNX model
        tokenizer.save_pretrained(str(output_path))
        emit({'type': 'status', 'message': f'Model converted and saved to {onnx_path}'})
        emit({'type': 'done', 'path': str(onnx_path)})
        return True

    except ImportError as e:
        emit({'type': 'error', 'message': f'Missing dependency: {e}. Install with: pip install transformers torch'})
        return False
    except Exception as e:
        emit({'type': 'error', 'message': f'Conversion failed: {e}'})
        return False


def main():
    parser = argparse.ArgumentParser(description='Convert trained model to ONNX')
    parser.add_argument('--input-dir', required=True, help='Training output directory')
    parser.add_argument('--output-dir', required=True, help='ONNX export directory')
    args = parser.parse_args()

    success = convert_to_onnx(args.input_dir, args.output_dir)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
