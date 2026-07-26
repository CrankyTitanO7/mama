"""
measure_flops.py — Measure ACHIEVED FLOPS (not just the model's FLOP count).

Combines:
  - calflops' analytical FLOP count per forward pass (fixed, hardware-independent)
  - measured wall-clock time for N forward passes on your actual device

to compute real throughput in FLOPS, comparable to a chip's advertised peak
(e.g. "M1 GPU: 2.6 TFLOPS"). Expect your result to land well below the peak
spec — 10-40% of peak is normal for a single small model like ResNet18,
since peak numbers assume perfectly saturated compute with no memory-bandwidth
or kernel-launch overhead.

Usage:
    python measure_flops.py                      # auto-picks best device
    python measure_flops.py --device cpu          # force CPU
    python measure_flops.py --batch-size 8        # larger batch = better utilization
    python measure_flops.py --iterations 200      # more iterations = more stable timing
"""

import argparse
import time

import torch
import torchvision.models as models
from calflops import calculate_flops


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def sync(device: str):
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
    args = parser.parse_args()

    device = pick_device(args.device)
    input_shape = (args.batch_size, 3, 224, 224)

    print(f"Device: {device}")
    print(f"Batch size: {args.batch_size}")
    print("-" * 50)

    # ── Step 1: analytical FLOP count for ONE forward pass ─────────────────
    # This is fixed by the model architecture — independent of hardware.
    model_cpu = models.resnet18()
    flops_per_pass, macs_per_pass, params = calculate_flops(
        model=model_cpu,
        input_shape=input_shape,
        output_as_string=False,   # get raw numbers so we can do math with them
        print_results=False,
    )
    print(f"FLOPs per forward pass: {human_flops(flops_per_pass)}")
    print(f"Parameters: {params / 1e6:.2f} M")
    print("-" * 50)

    # ── Step 2: measure real wall-clock time on the target device ──────────
    model = model_cpu.to(device).eval()
    dummy_input = torch.randn(*input_shape, device=device)

    with torch.no_grad():
        # Warmup — first calls include lazy kernel compilation / memory allocation
        for _ in range(args.warmup):
            model(dummy_input)
        sync(device)

        start = time.perf_counter()
        for _ in range(args.iterations):
            model(dummy_input)
        sync(device)
        elapsed = time.perf_counter() - start

    # ── Step 3: derive achieved FLOPS from count × iterations / time ───────
    total_flops = flops_per_pass * args.iterations
    achieved_flops = total_flops / elapsed
    inferences_per_sec = args.iterations / elapsed

    print(f"Ran {args.iterations} forward passes in {elapsed:.3f}s")
    print(f"Throughput: {inferences_per_sec:.1f} inferences/sec")
    print(f"Achieved FLOPS: {human_flops(achieved_flops)}")
    print()
    print("Compare this to your chip's advertised PEAK FLOPS (a spec sheet number).")
    print("Achieved will normally be well below peak — that's expected, not a bug.")


if __name__ == "__main__":
    main()