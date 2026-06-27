"""
detect_gpu.py — Detect GPU manufacturer, name, VRAM, and driver info.

Detection order:
    1. nvidia-smi          (NVIDIA, all platforms)
    2. rocm-smi            (AMD, Linux)
    3. lspci               (Linux fallback — manufacturer + name, no VRAM)
    4. wmic / PowerShell   (Windows fallback)
    5. metal/detect_metal  (macOS — Apple Silicon iGPU, Intel Iris, AMD dGPU)

Output (stdout, KEY=VALUE):
    GPU_MANUFACTURER  — nvidia | amd | intel | apple | none
    GPU_NAME          — e.g. "NVIDIA GeForce RTX 4070" / "Apple M3 Pro"
    GPU_VRAM_MB       — e.g. "12288"  (discrete GPUs only; omitted for iGPU)
    CUDA_VERSION      — e.g. "12.1"   (NVIDIA only, omitted otherwise)
    ROCM_VERSION      — e.g. "5.7"    (AMD/ROCm only, omitted otherwise)
    DRIVER_VERSION    — e.g. "536.23" (omitted if unknown)
    METAL_VERSION     — e.g. "3.1"    (macOS only, omitted otherwise)
    MPS_AVAILABLE     — true | false  (macOS only)
    GPU_TYPE          — igpu | dgpu | unknown  (macOS only)

Exit 0 always; 'none' manufacturer means no supported GPU found.

Notes:
    - AMD ROCm is Linux-only. On Windows, AMD GPUs will be detected but
      ROCM_VERSION will be absent; the installer should default to CPU wheels.
    - Intel Arc GPU acceleration requires Intel Extension for PyTorch (ipex),
      not handled here — manufacturer is reported as 'intel' for awareness only.
    - On macOS, Apple Silicon iGPUs use unified memory: VRAM is omitted and
      GPU_TYPE=igpu.  Discrete AMD/NVIDIA dGPUs on Intel Macs show VRAM.
"""

import re
import sys
import shutil
import subprocess
import os


# ── Metal detection (macOS) ──────────────────────────────────────────────────

def _metal_dir():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "metal")

def try_metal():
    """Try to detect GPU via the dedicated macOS Metal detector."""
    metal_detect = os.path.join(_metal_dir(), "detect_metal.py")
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def run(cmd, timeout=15):
    """Run a command, return (returncode, stdout, stderr). Never raises."""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 1, "", f"command not found: {cmd[0]}"
    except Exception as e:
        return 1, "", str(e)


def emit(key, value):
    if value is not None and value != "":
        print(f"{key}={value}", flush=True)


# ── NVIDIA via nvidia-smi ────────────────────────────────────────────────────

def try_nvidia():
    if not shutil.which("nvidia-smi"):
        return None

    # Query name, VRAM (MiB), driver version
    code, out, _ = run([
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits"
    ])
    if code != 0 or not out.strip():
        return None

    # Take the first GPU found (multi-GPU: main card is index 0)
    first_line = out.strip().splitlines()[0]
    parts      = [p.strip() for p in first_line.split(",")]
    name           = parts[0] if len(parts) > 0 else ""
    vram_mb        = parts[1] if len(parts) > 1 else ""
    driver_version = parts[2] if len(parts) > 2 else ""

    # CUDA version from nvidia-smi banner line: "CUDA Version: 12.1"
    cuda_version = ""
    _, banner, _ = run(["nvidia-smi"])
    match = re.search(r"CUDA Version:\s*([\d.]+)", banner)
    if match:
        cuda_version = match.group(1)

    return {
        "manufacturer": "nvidia",
        "name":          name,
        "vram_mb":       vram_mb,
        "cuda_version":  cuda_version,
        "rocm_version":  "",
        "driver_version": driver_version,
    }


# ── AMD via rocm-smi (Linux) ─────────────────────────────────────────────────

def try_rocm():
    if not shutil.which("rocm-smi"):
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

    # ROCm version
    rocm_version = ""
    _, ver_out, _ = run(["rocm-smi", "--version"])
    match = re.search(r"([\d]+\.[\d]+\.?[\d]*)", ver_out)
    if match:
        rocm_version = match.group(1)

    # VRAM: rocm-smi --showmeminfo vram
    vram_mb = ""
    _, mem_out, _ = run(["rocm-smi", "--showmeminfo", "vram"])
    match = re.search(r"Total Memory.*?:\s*(\d+)", mem_out, re.IGNORECASE)
    if match:
        # rocm-smi reports in bytes
        try:
            vram_mb = str(int(match.group(1)) // (1024 * 1024))
        except ValueError:
            pass

    return {
        "manufacturer": "amd",
        "name":          name,
        "vram_mb":       vram_mb,
        "cuda_version":  "",
        "rocm_version":  rocm_version,
        "driver_version": "",
    }


# ── lspci fallback (Linux, no driver info) ───────────────────────────────────

def try_lspci():
    if not shutil.which("lspci"):
        return None

    _, out, _ = run(["lspci"])
    if not out.strip():
        return None

    for line in out.splitlines():
        ll = line.lower()
        # Only look at VGA / 3D / display controller lines
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


# ── wmic / PowerShell fallback (Windows) ─────────────────────────────────────

def try_windows_wmi():
    """
    Try wmic first (available on older Windows), then PowerShell Get-WmiObject
    (works on Windows 10+ where wmic is deprecated).
    """
    if sys.platform != "win32":
        return None

    # --- wmic ---
    code, out, _ = run([
        "wmic", "path", "Win32_VideoController",
        "get", "Name,AdapterRAM,DriverVersion",
        "/format:csv"
    ])
    if code == 0 and out.strip():
        for line in out.strip().splitlines():
            if not line.strip() or line.lower().startswith("node"):
                continue
            parts = [p.strip() for p in line.split(",")]
            # CSV columns: Node, AdapterRAM, DriverVersion, Name
            if len(parts) < 4:
                continue
            adapter_ram    = parts[1]
            driver_version = parts[2]
            gpu_name       = parts[3]
            if not gpu_name:
                continue
            manufacturer = _name_to_manufacturer(gpu_name)
            if manufacturer == "none":
                continue
            vram_mb = ""
            try:
                ram_bytes = int(adapter_ram)
                if ram_bytes > 0:
                    vram_mb = str(ram_bytes // (1024 * 1024))
            except (ValueError, TypeError):
                pass
            return {
                "manufacturer": manufacturer,
                "name":          gpu_name,
                "vram_mb":       vram_mb,
                "cuda_version":  "",
                "rocm_version":  "",
                "driver_version": driver_version,
            }

    # --- PowerShell fallback ---
    ps_cmd = (
        "Get-WmiObject Win32_VideoController | "
        "Select-Object Name,AdapterRAM,DriverVersion | "
        "ConvertTo-Csv -NoTypeInformation"
    )
    code, out, _ = run(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=20)
    if code != 0 or not out.strip():
        return None

    lines = [l for l in out.strip().splitlines() if l.strip() and not l.startswith('"Name"')]
    for line in lines:
        parts = [p.strip().strip('"') for p in line.split(",")]
        if len(parts) < 3:
            continue
        gpu_name       = parts[0]
        adapter_ram    = parts[1]
        driver_version = parts[2]
        if not gpu_name:
            continue
        manufacturer = _name_to_manufacturer(gpu_name)
        if manufacturer == "none":
            continue
        vram_mb = ""
        try:
            ram_bytes = int(adapter_ram)
            if ram_bytes > 0:
                vram_mb = str(ram_bytes // (1024 * 1024))
        except (ValueError, TypeError):
            pass
        return {
            "manufacturer": manufacturer,
            "name":          gpu_name,
            "vram_mb":       vram_mb,
            "cuda_version":  "",
            "rocm_version":  "",
            "driver_version": driver_version,
        }

    return None


def _name_to_manufacturer(name):
    n = name.lower()
    if any(k in n for k in ("nvidia", "geforce", "quadro", "tesla", "rtx", "gtx")):
        return "nvidia"
    if any(k in n for k in ("amd", "radeon", "ati")):
        return "amd"
    if "apple" in n:
        return "apple"
    if "intel" in n:
        return "intel"
    return "none"


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    result = (
        try_nvidia()
        or try_rocm()
        or try_lspci()
        or try_windows_wmi()
        or try_metal()
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


if __name__ == "__main__":
    main()