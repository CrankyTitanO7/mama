"""AMD GPU detection via rocm-smi (Linux)."""
import re
from .base import run


def try_rocm():
    if not __import__("shutil").which("rocm-smi"):
        return None

    code, out, _ = run(["rocm-smi", "--showproductname"])
    if code != 0 or not out.strip():
        return None

    name = ""
    for line in out.splitlines():
        ll = line.lower()
        if any(k in ll for k in ("card series", "card model", "card vendor", "gpu")):
            if ":" in line:
                name = line.split(":", 1)[1].strip()
                break

    rocm_version = ""
    _, ver_out, _ = run(["rocm-smi", "--version"])
    match = re.search(r"([\d]+\.[\d]+\.?[\d]*)", ver_out)
    if match:
        rocm_version = match.group(1)

    vram_mb = ""
    _, mem_out, _ = run(["rocm-smi", "--showmeminfo", "vram"])
    match = re.search(r"Total Memory.*?:\s*(\d+)", mem_out, re.IGNORECASE)
    if match:
        try:
            vram_mb = str(int(match.group(1)) // (1024 * 1024))
        except ValueError:
            pass

    return {
        "manufacturer":    "amd",
        "name":            name,
        "vram_mb":         vram_mb,
        "cuda_version":    "",
        "rocm_version":    rocm_version,
        "driver_version":  "",
    }