"""NVIDIA GPU detection via nvidia-smi."""
import base


def try_nvidia():
    if not __import__("shutil").which("nvidia-smi"):
        return None

    code, out, _ = base.run([
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits"
    ])
    if code != 0 or not out.strip():
        return None

    first_line = out.strip().splitlines()[0]
    parts      = [p.strip() for p in first_line.split(",")]
    name           = parts[0] if len(parts) > 0 else ""
    vram_mb        = parts[1] if len(parts) > 1 else ""
    driver_version = parts[2] if len(parts) > 2 else ""

    cuda_version = ""
    _, banner, _ = base.run(["nvidia-smi"])
    match = __import__("re").search(r"CUDA Version:\s*([\d.]+)", banner)
    if match:
        cuda_version = match.group(1)

    return {
        "manufacturer":    "nvidia",
        "name":            name,
        "vram_mb":         vram_mb,
        "cuda_version":    cuda_version,
        "rocm_version":    "",
        "driver_version":  driver_version,
    }
