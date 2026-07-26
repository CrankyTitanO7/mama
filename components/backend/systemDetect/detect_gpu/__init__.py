"""
detect_gpu package — Entry point / orchestrator.

Runs platform-specific detectors in order and emits KEY=VALUE lines:
    GPU_MANUFACTURER, GPU_NAME, GPU_VRAM_MB,
    CUDA_VERSION, ROCM_VERSION, DRIVER_VERSION,
    METAL_VERSION, MPS_AVAILABLE, GPU_TYPE

Exit 0 always.
"""
import sys
import os

# When executed directly (e.g. from IPC handlers), Python sets __package__ to None,
# which breaks relative imports. Register this directory's parent as a package root
# and temporarily set __package__ so all intra-package relative imports work.
pkg_dir = os.path.dirname(os.path.abspath(__file__))
if __package__ is None:
    parent_dir = os.path.dirname(pkg_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
    __package__ = "detect_gpu"

from .base import emit
from . import nvidia
from . import amd
from . import linux
from . import windows
from . import metal as metal_detector


def run_all():
    """Try platform-specific detectors in order, return first match or fallback."""
    result = (
        nvidia.try_nvidia()
        or amd.try_rocm()
        or linux.try_lspci()
        or windows.try_windows_wmi()
        or metal_detector.try_metal()
    )
    if not result:
        result = {
            "manufacturer":   "none",
            "name":           "",
            "vram_mb":        "",
            "cuda_version":   "",
            "rocm_version":   "",
            "driver_version": "",
            "metal_version":  "",
            "mps_available":  "",
            "gpu_type":       "",
        }
    return result


if __name__ == "__main__":
    result = run_all()
    emit("GPU_MANUFACTURER", result["manufacturer"])
    emit("GPU_NAME",         result["name"])
    emit("GPU_VRAM_MB",      result["vram_mb"])
    emit("CUDA_VERSION",     result["cuda_version"])
    emit("ROCM_VERSION",     result["rocm_version"])
    emit("DRIVER_VERSION",   result["driver_version"])
    emit("METAL_VERSION",    result.get("metal_version", ""))
    emit("MPS_AVAILABLE",    result.get("mps_available", ""))
    emit("GPU_TYPE",         result.get("gpu_type", ""))
    sys.exit(0)
