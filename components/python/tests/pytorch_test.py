#!/usr/bin/env python3
"""
PyTorch Runner Script
Executed from pyrunner.js
"""

import sys
import time

print("✅ PyTorch Runner started successfully")
print(f"Python version: {sys.version}")
print("\nRunning PyTorch operations...")

try:
    import torch
    print(f"✅ PyTorch version: {torch.__version__}")
    print(f"✅ CUDA available: {torch.cuda.is_available()}")
    
    # Simple tensor operation test
    x = torch.rand(3, 3)
    y = torch.rand(3, 3)
    z = x + y
    
    print("\n✓ Tensor addition test completed successfully")
    print(f"Result tensor shape: {z.shape}")
    
except ImportError:
    print("⚠️  PyTorch not installed, running in demo mode")
    print("Install PyTorch with: pip install torch torchvision torchaudio")

print("\n✅ Script execution completed")