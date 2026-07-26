"""macOS Metal GPU detection."""
import os
import re
import sys
from .base import run


def try_metal():
    """Try to detect GPU via the dedicated macOS Metal detector."""
    metal_detect = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "metal", "detect_metal.py"
    )
    if not os.path.isfile(metal_detect):
        return None
    if sys.platform != "darwin":
        return None
    rc, out, _ = run([sys.executable, metal_detect], timeout=90)
    if rc != 0 or not out.strip():
        return None
    result = {"manufacturer": "none", "name": "", "vram_mb": "",
              "cuda_version": "", "rocm_version": "", "driver_version": "",
              "metal_version": "", "mps_available": "", "gpu_type": ""}
    for line in out.splitlines():
        m = re.match(r"^([^=]+)=(.*)$", line)
        if not m:
            continue
        key = m.group(1).strip()
        val = m.group(2).strip()
        if key == "GPU_MANUFACTURER":
            result["manufacturer"] = val
        elif key == "GPU_NAME":
            result["name"] = val
        elif key == "GPU_VRAM_MB":
            result["vram_mb"] = val
        elif key == "METAL_VERSION":
            result["metal_version"] = val
        elif key == "MPS_AVAILABLE":
            result["mps_available"] = val
        elif key == "GPU_TYPE":
            result["gpu_type"] = val
        elif key == "DRIVER_VERSION":
            result["driver_version"] = val
        elif key == "CUDA_VERSION":
            result["cuda_version"] = val
        elif key == "ROCM_VERSION":
            result["rocm_version"] = val
    if result["manufacturer"] == "none":
        return None
    return result