"""
import_test.py — Verify that PyTorch or TensorFlow can be imported.

Usage:
    python import_test.py <torch|tf>

Prints diagnostic info to stdout and exits 0 on success, 1 on failure.
"""

import sys


def test_torch():
    try:
        import torch
    except ImportError as e:
        print(f"ImportError: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"PyTorch version : {torch.__version__}", flush=True)
    print(f"CUDA available  : {torch.cuda.is_available()}", flush=True)

    if torch.cuda.is_available():
        print(f"CUDA version    : {torch.version.cuda}", flush=True)
        device_count = torch.cuda.device_count()
        print(f"GPU count       : {device_count}", flush=True)
        for i in range(device_count):
            props = torch.cuda.get_device_properties(i)
            vram_gb = props.total_memory / (1024 ** 3)
            print(f"  GPU {i}         : {props.name} ({vram_gb:.1f} GB)", flush=True)
    else:
        # Check ROCm (HIP)
        if hasattr(torch, "version") and hasattr(torch.version, "hip") and torch.version.hip:
            print(f"ROCm available  : True", flush=True)
            print(f"ROCm version    : {torch.version.hip}", flush=True)
        else:
            print("GPU backend     : none (CPU only)", flush=True)

    sys.exit(0)


def test_tf():
    try:
        import tensorflow as tf
    except ImportError as e:
        print(f"ImportError: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    # Suppress TF logging noise
    import os
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

    print(f"TensorFlow version : {tf.__version__}", flush=True)

    gpus = tf.config.list_physical_devices("GPU")
    print(f"GPUs available     : {len(gpus)}", flush=True)
    for gpu in gpus:
        print(f"  {gpu.name}", flush=True)

    if not gpus:
        print("GPU backend        : none (CPU only)", flush=True)

    sys.exit(0)


def main():
    if len(sys.argv) < 2:
        print("Usage: import_test.py <torch|tf>", file=sys.stderr, flush=True)
        sys.exit(2)

    fw = sys.argv[1].lower().strip()

    if fw == "torch":
        test_torch()
    elif fw in ("tf", "tensorflow"):
        test_tf()
    else:
        print(f"Unknown framework '{fw}'. Expected 'torch' or 'tf'.",
              file=sys.stderr, flush=True)
        sys.exit(2)


if __name__ == "__main__":
    main()