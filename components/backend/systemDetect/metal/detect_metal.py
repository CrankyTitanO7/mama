"""
detect_metal.py — macOS Metal / MPS / Apple Silicon GPU detection.

Detects Apple Silicon (M-series) and Intel Mac GPUs via ioreg and
system_profiler, reports Metal framework version, VRAM info, and whether
this is a unified-memory iGPU or a discrete GPU with dedicated VRAM.

Output (stdout, KEY=VALUE):
    GPU_MANUFACTURER  — apple | intel | amd | nvidia | none
    GPU_NAME          — e.g. "Apple M3 Pro" / "Intel Iris Plus Graphics"
    GPU_VRAM_MB       — dedicated VRAM in MB  (only for discrete GPUs; omitted for iGPU)
    METAL_VERSION     — e.g. "3.1"  (Metal framework version)
    MPS_AVAILABLE     — true | false  (PyTorch Metal Performance Shaders usable)
    GPU_TYPE          — igpu | dgpu | unknown
    DRIVER_VERSION    — macOS kernel version (platform.release())

Usage:
    python detect_metal.py

Exit 0 always; 'none' manufacturer means no GPU detected.
"""

import re
import sys
import shutil
import subprocess
import platform


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
    if value is not None and str(value) != "":
        print(f"{key}={value}", flush=True)


def detect_via_ioreg():
    """Use ioreg to detect GPU class and VRAM.

    Apple Silicon uses AGXAccelerator/AppleCLCD classes, not IOAccelerator.
    Tries multiple classes and uses the first one that has results.
    """
    if sys.platform != "darwin":
        return None

    classes_to_try = ["IOAccelerator", "AGXAccelerator", "AppleCLCD",
                      "AppleIntelFramebuffer", "IODISPLAY"]

    best = None
    for cls in classes_to_try:
        code, out, _ = run(["ioreg", "-l", "-w0", "-c", cls])
        if code != 0 or not out.strip():
            continue

        lines = out.splitlines()
        gpu_count = 0
        has_discrete_vram = False
        vram_bytes = 0
        model_hint = ""

        for line in lines:
            stripped = line.strip()

            # Count actual "class = <ClassName>" lines (not property accesses)
            if re.search(r'"class"\s*=\s*"[^"]+"', stripped):
                gpu_count += 1

            # Discrete GPU VRAM (decimal — ioreg outputs VRAM,total as bytes = decimal)
            if '"VRAM' in stripped and 'total' in stripped.lower():
                has_discrete_vram = True
                m = re.search(r'"(?:VRAM|vram)[^"]*total[^"]*"\s*=\s*(\d+)', stripped)
                if m:
                    try:
                        val = int(m.group(1))
                        if val > vram_bytes:
                            vram_bytes = val
                    except ValueError:
                        pass

            if not model_hint:
                for key in ('"model"', '"IOName"', '"IOModel"', '"ProductName"',
                            '"IOClass"'):
                    if key in stripped:
                        m = re.search(r'=\s*"([^"]+)"', stripped)
                        if m:
                            model_hint = m.group(1)
                            break

        if gpu_count > 0 or has_discrete_vram:
            best = {
                "gpu_count": gpu_count if gpu_count > 0 else 1,
                "has_discrete_vram": has_discrete_vram,
                "vram_bytes": vram_bytes,
                "model_hint": model_hint,
            }
            break  # Use first class with results

    return best


def detect_via_system_profiler():
    """Use system_profiler SPDisplaysDataType for human-readable GPU info.

    Returns dict with keys:
        gpu_name, metal_version, vram_total_mb (dedicated only)
    or None if not on macOS / command not available.
    """
    if sys.platform != "darwin":
        return None

    if not shutil.which("system_profiler"):
        return None

    # system_profiler SPDisplaysDataType can take 10-30s on some Macs
    code, out, _ = run(["system_profiler", "SPDisplaysDataType"], timeout=45)
    if code != 0 or not out.strip():
        return None

    gpu_name = ""
    chip_match = re.search(r"Chipset Model:\s*(.+?)$", out, re.MULTILINE)
    if chip_match:
        gpu_name = chip_match.group(1).strip()

    metal_version = ""
    metal_match = re.search(
        r"Metal Support:\s*(.+?)$", out, re.MULTILINE | re.IGNORECASE
    )
    if metal_match:
        mv = metal_match.group(1).strip()
        m_ver = re.search(r"Metal\s*([\d.]+)?", mv, re.IGNORECASE)
        if m_ver:
            metal_version = m_ver.group(1) if m_ver.group(1) else "1"

    vram_total_mb = ""
    vram_match = re.search(r"VRAM \(Total\):\s*(.+?)$", out, re.MULTILINE)
    if vram_match:
        vram_str = vram_match.group(1).strip()
        num_match = re.search(r"([\d.]+)\s*(GB|MB)", vram_str, re.IGNORECASE)
        if num_match:
            val = float(num_match.group(1))
            unit = num_match.group(2).upper()
            if unit == "GB":
                vram_total_mb = str(int(val * 1024))
            else:
                vram_total_mb = str(int(val))

    return {
        "gpu_name": gpu_name,
        "metal_version": metal_version,
        "vram_total_mb": vram_total_mb,
    }


def determine_gpu_type(gpu_name, has_discrete_vram):
    """Determine if this is an integrated GPU (iGPU) or discrete GPU (dGPU).

    Apple Silicon (M1/M2/M3/M4) → always iGPU (unified memory)
    Intel Iris / HD / UHD      → always iGPU
    AMD / NVIDIA with VRAM     → dGPU
    """
    nl = gpu_name.lower()
    if "apple" in nl:
        return "igpu"
    if any(k in nl for k in ("intel", "iris", "hd graphics", "uhd graphics")):
        return "igpu"
    if has_discrete_vram and any(k in nl for k in ("amd", "radeon", "nvidia", "geforce", "rtx", "gtx")):
        return "dgpu"
    return "unknown"


def detect():
    """Main detection: ioreg is primary, system_profiler enriches if fast enough.

    Runs both in parallel via threads so a slow system_profiler never blocks
    the fast ioreg result.  Always returns a result when ioreg finds a GPU,
    even if system_profiler fails or times out.
    """
    import threading

    sp_result = [None]
    sp_error  = [None]

    def run_sp():
        try:
            sp_result[0] = detect_via_system_profiler()
        except Exception as e:
            sp_error[0] = str(e)

    # Start system_profiler in background (can take 10-30s)
    t = threading.Thread(target=run_sp, daemon=True)
    t.start()

    # Run ioreg first (fast, ~1s)
    ioreg_data = detect_via_ioreg()
    if not ioreg_data:
        t.join(timeout=5)
        return None

    # Wait for system_profiler (up to 80s beyond ioreg time)
    t.join(timeout=80)

    sp_data = sp_result[0] if sp_result[0] else None

    # Build result starting from ioreg as baseline
    gpu_name      = ioreg_data.get("model_hint", "") or ""
    metal_version = ""
    vram_total_mb  = ""

    if sp_data:
        if sp_data.get("gpu_name"):
            gpu_name = sp_data["gpu_name"]
        metal_version = sp_data.get("metal_version", "") or ""
        vram_total_mb  = sp_data.get("vram_total_mb", "") or ""

    # Fallback if we still have no name but ioreg confirmed GPU exists
    if not gpu_name:
        if ioreg_data.get("gpu_count", 0) > 0 or ioreg_data.get("has_discrete_vram"):
            gpu_name = "Apple GPU"
        else:
            return None

    nl = gpu_name.lower()
    if "apple" in nl:
        manufacturer = "apple"
    elif any(k in nl for k in ("nvidia", "geforce", "quadro", "tesla", "rtx", "gtx")):
        manufacturer = "nvidia"
    elif any(k in nl for k in ("amd", "radeon", "ati")):
        manufacturer = "amd"
    elif any(k in nl for k in ("intel", "iris", "hd graphics", "uhd graphics")):
        manufacturer = "intel"
    else:
        manufacturer = "none"

    gpu_type = determine_gpu_type(gpu_name, ioreg_data.get("has_discrete_vram", False))

    if gpu_type == "dgpu" and ioreg_data.get("vram_bytes", 0) > 0:
        vram_mb = str(ioreg_data["vram_bytes"] // (1024 * 1024))
    elif vram_total_mb and gpu_type == "dgpu":
        vram_mb = vram_total_mb
    else:
        vram_mb = ""

    mps_available = "true" if manufacturer == "apple" and metal_version else ""

    driver_version = platform.release()

    return {
        "manufacturer": manufacturer,
        "name": gpu_name,
        "vram_mb": vram_mb,
        "metal_version": metal_version,
        "mps_available": mps_available,
        "gpu_type": gpu_type,
        "driver_version": driver_version,
    }


def main():
    result = detect()

    if not result:
        result = {
            "manufacturer": "none",
            "name": "",
            "vram_mb": "",
            "metal_version": "",
            "mps_available": "",
            "gpu_type": "",
            "driver_version": "",
        }

    emit("GPU_MANUFACTURER", result["manufacturer"])
    emit("GPU_NAME", result["name"])
    emit("GPU_VRAM_MB", result["vram_mb"])
    emit("METAL_VERSION", result["metal_version"])
    emit("MPS_AVAILABLE", result["mps_available"])
    emit("GPU_TYPE", result["gpu_type"])
    emit("DRIVER_VERSION", result["driver_version"])
    sys.exit(0)


if __name__ == "__main__":
    main()

