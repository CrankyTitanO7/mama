"""
measure_flops.py — Measure ACHIEVED FLOPS (not just the model's FLOP count).

Combines:
  - analytical FLOP count per forward pass (fixed, hardware-independent)
  - measured wall-clock time for N forward passes on your actual device

to compute real throughput in FLOPS, comparable to a chip's advertised peak
(e.g. "M1 GPU: 2.6 TFLOPS"). Expect your result to land well below the peak
spec — 10-40% of peak is normal for a single small model like ResNet18,
since peak numbers assume perfectly saturated compute with no memory-bandwidth
or kernel-launch overhead.

Usage:
    python flops.py                              # auto-picks best device, ResNet-18
    python flops.py --device cpu                 # force CPU
    python flops.py --batch-size 8               # larger batch = better utilization
    python flops.py --model resnet50             # choose model
    python flops.py --json                       # machine-readable JSON output
"""

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import time
from typing import Optional

# NOTE: torch is imported lazily inside functions so the script can show
# a helpful error message if PyTorch is not installed.

# ── Model registry ──────────────────────────────────────────────────────────
# Each entry: (model_fn, input_size, default_batch)
MODEL_REGISTRY = {
    "resnet18":  ("resnet18", 224),
    "resnet50":  ("resnet50", 224),
    "vit_b_16":  ("vit_b_16", 224),
}

# ── Peak FLOPS lookup table (TFLOPS) ───────────────────────────────────────
# Sources: manufacturer spec sheets. These are theoretical peak FP32 values.
PEAK_FLOPS_TABLE: dict[str, dict[str, float]] = {
    # Apple Silicon (GPU)
    "apple": {
        "M1":        2.6,
        "M1 Pro":    5.3,
        "M1 Max":   10.4,
        "M1 Ultra": 20.8,
        "M2":        3.6,
        "M2 Pro":    6.8,
        "M2 Max":   13.6,
        "M2 Ultra": 27.2,
        "M3":        4.1,
        "M3 Pro":    7.2,
        "M3 Max":   14.2,
        "M4":        4.6,
        "M4 Pro":    8.2,
        "M4 Max":   16.4,
    },
    # NVIDIA consumer
    "nvidia": {
        "RTX 3060":      12.7,
        "RTX 3060 Ti":   16.2,
        "RTX 3070":      20.3,
        "RTX 3070 Ti":   21.7,
        "RTX 3080":      29.8,
        "RTX 3080 Ti":   34.1,
        "RTX 3090":      35.6,
        "RTX 3090 Ti":   40.0,
        "RTX 4060":      15.0,
        "RTX 4060 Ti":   22.1,
        "RTX 4070":      29.1,
        "RTX 4070 Ti":   40.1,
        "RTX 4080":      48.7,
        "RTX 4080 Super":52.2,
        "RTX 4090":      82.6,
        "RTX 4090 D":    73.5,
        "RTX 5000 Ada":  27.8,
        "RTX 6000 Ada":  48.7,
    },
    # NVIDIA datacenter
    "nvidia_dc": {
        "Tesla T4":      8.1,
        "Tesla V100":   14.1,   # FP32 (125 TFLOPS tensor)
        "A100":          19.5,  # FP32 (312 TFLOPS tensor)
        "A10":           31.2,
        "A16":           22.0,
        "A30":           10.3,
        "H100":          51.0,  # FP32 (989 TFLOPS tensor)
        "H200":          51.0,
        "B100":          56.0,
        "B200":          67.0,
    },
    # AMD consumer
    "amd": {
        "RX 6600":       10.6,
        "RX 6600 XT":    13.2,
        "RX 6700 XT":    16.6,
        "RX 6800":       19.3,
        "RX 6800 XT":    23.0,
        "RX 6900 XT":    26.9,
        "RX 6950 XT":    28.2,
        "RX 7600":       14.9,
        "RX 7600 XT":    20.6,
        "RX 7700 XT":    28.0,
        "RX 7800 XT":    33.5,
        "RX 7900 GRE":   36.5,
        "RX 7900 XT":    45.8,
        "RX 7900 XTX":   61.4,
    },
}


def _import_torch():
    """Import torch and return the module, or exit with a clear error."""
    try:
        import torch
        return torch
    except ImportError:
        print("ERROR: PyTorch is not installed.", flush=True)
        print("HINT: Install it with: pip install torch torchvision torchaudio", flush=True)
        print("      Or visit https://pytorch.org/get-started/locally/", flush=True)
        sys.exit(1)


def _detect_apple_chip() -> Optional[str]:
    """Detect Apple Silicon chip model from sysctl."""
    try:
        brand = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True, text=True, timeout=5
        ).stdout.strip()
        if "Apple" in brand:
            # e.g. "Apple M1 Pro" → "M1 Pro"
            for chip in PEAK_FLOPS_TABLE["apple"]:
                if chip in brand:
                    return chip
            # Fallback: extract "M[0-9]" pattern
            m = re.search(r'(M\d(?:\s+\w+)?)', brand)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


def _detect_nvidia_gpu(torch) -> Optional[str]:
    """Detect NVIDIA GPU model from torch."""
    if not torch.cuda.is_available():
        return None
    try:
        name = torch.cuda.get_device_name(0)
        # Try consumer table first
        for gpu in PEAK_FLOPS_TABLE["nvidia"]:
            if gpu.lower() in name.lower():
                return gpu
        # Try datacenter table
        for gpu in PEAK_FLOPS_TABLE["nvidia_dc"]:
            if gpu.lower() in name.lower():
                return gpu
        # Return raw name if no match
        return name
    except Exception:
        return None


def _detect_amd_gpu(torch) -> Optional[str]:
    """Detect AMD GPU model from torch."""
    if not torch.cuda.is_available():
        return None
    try:
        name = torch.cuda.get_device_name(0)
        for gpu in PEAK_FLOPS_TABLE["amd"]:
            if gpu.lower() in name.lower():
                return gpu
        return name
    except Exception:
        return None


def lookup_peak_flops(device: str, torch) -> tuple[Optional[str], Optional[float]]:
    """
    Look up the chip name and peak TFLOPS for the current hardware.
    Returns (chip_name, peak_tflops) or (None, None) if unknown.
    """
    if device == "mps":
        chip = _detect_apple_chip()
        if chip:
            peak = PEAK_FLOPS_TABLE["apple"].get(chip)
            return chip, peak
        return None, None
    elif device == "cuda":
        # Try NVIDIA consumer
        chip = _detect_nvidia_gpu(torch)
        if chip:
            peak = PEAK_FLOPS_TABLE["nvidia"].get(chip) or PEAK_FLOPS_TABLE["nvidia_dc"].get(chip)
            return chip, peak
        # Try AMD
        chip = _detect_amd_gpu(torch)
        if chip:
            peak = PEAK_FLOPS_TABLE["amd"].get(chip)
            return chip, peak
        return None, None
    return None, None


def pick_device(requested: str, torch) -> str:
    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def sync(device: str, torch):
    """Block until all queued GPU work finishes — required for accurate timing."""
    if device == "mps":
        torch.mps.synchronize()
    elif device == "cuda":
        torch.cuda.synchronize()
    # CPU is already synchronous — nothing to do


def human_flops(flops: float) -> str:
    """Format a raw FLOPS value with the appropriate unit (GFLOPS/TFLOPS)."""
    if flops >= 1e12:
        return f"{flops / 1e12:.3f} TFLOPS"
    return f"{flops / 1e9:.3f} GFLOPS"


def _load_model(model_name: str, input_size: int):
    """Load a torchvision model by name. Returns model instance."""
    try:
        import torchvision.models as models
    except ImportError:
        print(f"ERROR: torchvision is not installed.", flush=True)
        print("HINT: Install it with: pip install torchvision", flush=True)
        sys.exit(1)
    model_fn = getattr(models, model_name, None)
    if model_fn is None:
        raise ValueError(f"Unknown model: {model_name}. Available: {', '.join(MODEL_REGISTRY.keys())}")
    return model_fn(weights=None)


def _count_flops_manual(model, input_shape, torch) -> float:
    """
    Manual FLOP counting fallback when calflops is not available.
    Counts multiply-accumulate operations for Conv2d and Linear layers.
    Returns total FLOPs (1 MAC = 2 FLOPs).
    """
    total_macs = 0
    # FIX: Use the actual input_shape to respect the user's batch size
    dummy = torch.randn(*input_shape)

    def _count_conv(module, input, output):
        nonlocal total_macs
        # FIX: MACs = kernel_area * (in_channels / groups) * total_output_elements
        kernel_ops = module.kernel_size[0] * module.kernel_size[1]
        in_ch_per_group = module.in_channels // module.groups
        total_macs += kernel_ops * in_ch_per_group * output.numel()

    def _count_linear(module, input, output):
        nonlocal total_macs
        # FIX: Output elements * in_features automatically handles multi-dim (e.g. sequences in Transformers)
        total_macs += output.numel() * module.in_features

    hooks = []
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Conv2d):
            hooks.append(module.register_forward_hook(_count_conv))
        elif isinstance(module, torch.nn.Linear):
            hooks.append(module.register_forward_hook(_count_linear))

    # Run a forward pass to trigger hooks
    with torch.no_grad():
        model.eval()
        model(dummy)

    for h in hooks:
        h.remove()

    # Each MAC = 2 FLOPs (multiply + accumulate)
    return total_macs * 2


def _count_flops(model, input_shape, torch, use_calflops=True):
    """
    Count FLOPs for one forward pass.
    Returns (flops_per_pass, params).
    """
    if use_calflops:
        try:
            from calflops import calculate_flops
            flops_per_pass, macs_per_pass, params = calculate_flops(
                model=model,
                input_shape=input_shape,
                output_as_string=False,
                print_results=False,
            )
            return flops_per_pass, params
        except ImportError:
            pass  # Fall through to manual

    # Manual fallback
    flops_per_pass = _count_flops_manual(model, input_shape, torch)
    params = sum(p.numel() for p in model.parameters())
    return flops_per_pass, params


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"],
                        help="Device to run on (default: auto-detect best available)")
    parser.add_argument("--batch-size", type=int, default=1,
                        help="Batch size for the dummy input (default: 1)")
    parser.add_argument("--warmup", type=int, default=10,
                        help="Warmup iterations, not timed (default: 10)")
    parser.add_argument("--iterations", type=int, default=100,
                        help="Timed iterations (default: 100)")
    parser.add_argument("--model", type=str, default="resnet18",
                        choices=list(MODEL_REGISTRY.keys()),
                        help="Benchmark model (default: resnet18)")
    parser.add_argument("--json", action="store_true",
                        help="Output results as JSON (machine-readable)")
    args = parser.parse_args()

    # ── Import torch (gives clean error if not installed) ──────────────────
    torch = _import_torch()

    # ── Validate model ─────────────────────────────────────────────────────
    if args.model not in MODEL_REGISTRY:
        print(f"ERROR: Unknown model '{args.model}'. Choose from: {', '.join(MODEL_REGISTRY.keys())}")
        sys.exit(1)

    model_key, input_size = MODEL_REGISTRY[args.model]
    device = pick_device(args.device, torch)
    input_shape = (args.batch_size, 3, input_size, input_size)

    # ── Progress helper ────────────────────────────────────────────────────
    def progress(msg: str):
        print(f"PROGRESS:{msg}", flush=True)

    # ── Step 1: analytical FLOP count ──────────────────────────────────────
    progress(f"Loading model {args.model}...")
    model_cpu = _load_model(model_key, input_size)

    progress("Counting FLOPs per forward pass...")
    try:
        flops_per_pass, params = _count_flops(model_cpu, input_shape, torch, use_calflops=True)
    except Exception:
        flops_per_pass, params = _count_flops(model_cpu, input_shape, torch, use_calflops=False)

    # ── Step 2: measure real wall-clock time ───────────────────────────────
    progress(f"Moving model to {device}...")
    model = model_cpu.to(device).eval()
    dummy_input = torch.randn(*input_shape, device=device)

    progress(f"Warming up ({args.warmup} iterations)...")
    with torch.no_grad():
        for i in range(args.warmup):
            model(dummy_input)
            if (i + 1) % 5 == 0:
                progress(f"Warmup {i + 1}/{args.warmup}")
        sync(device, torch)

    # FIX: Remove print statements inside the timer block to prevent I/O latency from skewing metrics
    progress(f"Measuring ({args.iterations} iterations)...")
    with torch.no_grad():
        start = time.perf_counter()
        for i in range(args.iterations):
            model(dummy_input)
        sync(device, torch)
        elapsed = time.perf_counter() - start

    # ── Step 3: derive achieved FLOPS ──────────────────────────────────────
    total_flops = flops_per_pass * args.iterations
    achieved_flops = total_flops / elapsed
    inferences_per_sec = args.iterations / elapsed

    # ── Step 4: peak FLOPS lookup ──────────────────────────────────────────
    chip_name, peak_tflops = lookup_peak_flops(device, torch)
    peak_flops = peak_tflops * 1e12 if peak_tflops else None
    pct_of_peak = (achieved_flops / peak_flops * 100) if peak_flops else None

    # ── Output ─────────────────────────────────────────────────────────────
    if args.json:
        result = {
            "model": args.model,
            "device": device,
            "batch_size": args.batch_size,
            "warmup": args.warmup,
            "iterations": args.iterations,
            "input_size": input_size,
            "flops_per_pass": flops_per_pass,
            "params": params,
            "elapsed_seconds": elapsed,
            "achieved_flops": achieved_flops,
            "inferences_per_sec": inferences_per_sec,
            "chip_name": chip_name,
            "peak_tflops": peak_tflops,
            "pct_of_peak": round(pct_of_peak, 1) if pct_of_peak is not None else None,
        }
        print(json.dumps(result))
    else:
        print(f"Model: {args.model}")
        print(f"Device: {device}")
        print(f"Batch size: {args.batch_size}")
        print(f"Input size: {input_size}x{input_size}")
        print("-" * 50)
        print(f"FLOPs per forward pass: {human_flops(flops_per_pass)}")
        print(f"Parameters: {params / 1e6:.2f} M")
        print("-" * 50)
        print(f"Ran {args.iterations} forward passes in {elapsed:.3f}s")
        print(f"Throughput: {inferences_per_sec:.1f} inferences/sec")
        print(f"Achieved FLOPS: {human_flops(achieved_flops)}")
        if chip_name:
            print(f"Chip detected: {chip_name}")
        if peak_tflops:
            print(f"Peak FLOPS (spec): {peak_tflops:.1f} TFLOPS")
            print(f"Utilization: {pct_of_peak:.1f}% of peak")
        else:
            print("Peak FLOPS: unknown (chip not in lookup table)")
        print()
        print("Compare this to your chip's advertised PEAK FLOPS (a spec sheet number).")
        print("Achieved will normally be well below peak — that's expected, not a bug.")


if __name__ == "__main__":
    main()