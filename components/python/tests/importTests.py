import sys

# Accept framework argument: "torch" or "tf"
framework = sys.argv[1] if len(sys.argv) > 1 else "torch"

print(f"Testing imports for: {framework}")

if framework == "tf":
    try:
        import tensorflow as tf
        print(f"TensorFlow version: {tf.__version__}")
        print("TensorFlow imported successfully!")
    except ImportError as e:
        print(f"IMPORT_FAILED: could not import tensorflow")
        print(f"Error: {e}")
        sys.exit(1)
else:
    try:
        import torch
        print(f"PyTorch version: {torch.__version__}")
        print("PyTorch imported successfully!")
        if torch.cuda.is_available():
            print(f"CUDA available: {torch.cuda.get_device_name(0)}")
        elif torch.mps.is_available():
            print(f"MPS available: {torch.cuda.get_device_name(0)}")
        else:
            print("CUDA nor MPS available (CPU mode)")
    except ImportError as e:
        print(f"IMPORT_FAILED: could not import torch")
        print(f"Error: {e}")
        sys.exit(1)