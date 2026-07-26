"""Linux fallbacks: lspci."""
from .base import run


def try_lspci():
    if not __import__("shutil").which("lspci"):
        return None

    _, out, _ = run(["lspci"])
    if not out.strip():
        return None

    for line in out.splitlines():
        ll = line.lower()
        if not any(k in ll for k in ("vga", "3d", "display")):
            continue
        desc = line.split(":", 2)[-1].strip()
        if any(k in ll for k in ("nvidia", "geforce", "quadro", "tesla", "rtx", "gtx")):
            return {"manufacturer": "nvidia", "name": desc, "vram_mb": "",
                    "cuda_version": "", "rocm_version": "", "driver_version": ""}
        if any(k in ll for k in ("amd", "radeon", "ati")):
            return {"manufacturer": "amd", "name": desc, "vram_mb": "",
                    "cuda_version": "", "rocm_version": "", "driver_version": ""}
        if "intel" in ll:
            return {"manufacturer": "intel", "name": desc, "vram_mb": "",
                    "cuda_version": "", "rocm_version": "", "driver_version": ""}

    return None