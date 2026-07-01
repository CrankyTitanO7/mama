"""
check_compatibility.py — Validate hardware, OS, and architecture compatibility
for deep learning frameworks (PyTorch / TensorFlow).

This script takes detected system information as arguments and validates
whether the system meets minimum requirements for the intended use case.

Usage:
    python check_compatibility.py --os-family <os> --os-version <ver> --arch <arch> \\
        --gpu-mfr <mfr> --gpu-name <name> --gpu-vram-mb <mb> --cuda-ver <ver> \\
        --rocm-ver <ver> --metal-ver <ver> --mps-avail <bool> --python-ver <ver>

Output (stdout, KEY=VALUE):
    COMPAT_OS            — pass | warn | fail
    COMPAT_OS_MSG        — Human-readable message
    COMPAT_ARCH          — pass | warn | fail
    COMPAT_ARCH_MSG      — Human-readable message
    COMPAT_GPU           — pass | warn | fail
    COMPAT_GPU_MSG       — Human-readable message
    COMPAT_CUDA          — pass | warn | fail  (NVIDIA only)
    COMPAT_CUDA_MSG      — Human-readable message
    COMPAT_ROCM          — pass | warn | fail  (AMD only)
    COMPAT_ROCM_MSG      — Human-readable message
    COMPAT_METAL         — pass | warn | fail  (Apple only)
    COMPAT_METAL_MSG     — Human-readable message
    COMPAT_PYTHON        — pass | warn | fail
    COMPAT_PYTHON_MSG    — Human-readable message
    COMPAT_OVERALL       — pass | warn | fail
    COMPAT_OVERALL_MSG   — Summary message
    COMPAT_CC            — Compute capability string (NVIDIA only, if available)
    COMPAT_CC_MSG        — Compute capability message

Exit 0 always; the verdict is in the output keys.
"""

import argparse
import re
import sys


# ── Constants ──────────────────────────────────────────────────────────────────

# Minimum requirements
MIN_PYTHON_VER        = (3, 8)
REC_PYTHON_VER        = (3, 10)
MIN_CUDA_VER          = (11, 8)       # PyTorch 2.x minimum
REC_CUDA_VER          = (12, 1)
MIN_ROCM_VER          = (5, 0)
REC_ROCM_VER          = (5, 7)
MIN_VRAM_MB           = 4096          # 4 GB
REC_VRAM_MB           = 8192          # 8 GB
MIN_MACOS_VER         = (12, 0)       # Monterey
MIN_WINDOWS_VER       = (10, 0)       # Windows 10
MIN_UBUNTU_VER        = (20, 4)       # Ubuntu 20.04

# Compute capability lookup for common NVIDIA GPUs (name → (major, minor))
# Source: https://developer.nvidia.com/cuda-gpus
COMPUTE_CAP_TABLE = {
    # Ada Lovelace
    "rtx 4090":      (8, 9), "rtx 4080":      (8, 9), "rtx 4070 ti":   (8, 9),
    "rtx 4070":      (8, 9), "rtx 4060 ti":   (8, 9), "rtx 4060":      (8, 9),
    # Ampere
    "rtx 3090 ti":   (8, 6), "rtx 3090":      (8, 6), "rtx 3080 ti":   (8, 6),
    "rtx 3080":      (8, 6), "rtx 3070 ti":   (8, 6), "rtx 3070":      (8, 6),
    "rtx 3060 ti":   (8, 6), "rtx 3060":      (8, 6), "rtx 3050":      (8, 6),
    "a100":          (8, 0), "a6000":         (8, 0), "a5000":         (8, 0),
    "a4000":         (8, 6), "a2000":         (8, 6),
    # Turing
    "rtx 2080 ti":   (7, 5), "rtx 2080":      (7, 5), "rtx 2070":      (7, 5),
    "rtx 2060":      (7, 5), "titan rtx":     (7, 5), "quadro rtx 8000": (7, 5),
    "quadro rtx 6000": (7, 5), "quadro rtx 5000": (7, 5), "quadro rtx 4000": (7, 5),
    "t4":            (7, 5),
    # Volta
    "v100":          (7, 0), "titan v":       (7, 0),
    # Pascal
    "gtx 1080 ti":   (6, 1), "gtx 1080":      (6, 1), "gtx 1070 ti":   (6, 1),
    "gtx 1070":      (6, 1), "gtx 1060":      (6, 1), "gtx 1050 ti":   (6, 1),
    "gtx 1050":      (6, 1), "p100":          (6, 0), "p40":           (6, 1),
    "p4":            (6, 1),
    # Maxwell
    "gtx 980 ti":    (5, 2), "gtx 980":       (5, 2), "gtx 970":       (5, 2),
    "gtx 960":       (5, 2), "gtx 950":       (5, 2), "m5000":         (5, 2),
    "m4000":         (5, 2), "m2000":         (5, 2),
    # Kepler (too old for modern frameworks)
    "gtx 780 ti":    (3, 5), "gtx 780":       (3, 5), "gtx 770":       (3, 5),
    "gtx 760":       (3, 0), "k80":           (3, 7), "k40":           (3, 5),
    "k20":           (3, 5),
}

MIN_CC = (5, 0)   # Maxwell minimum for modern CUDA
REC_CC = (7, 0)   # Volta+ recommended for ML perf


# ── Helpers ────────────────────────────────────────────────────────────────────

def parse_version(ver_str):
    """Parse '12.1' → (12, 1), '5.7.1' → (5, 7). Returns None on failure."""
    if not ver_str:
        return None
    try:
        parts = ver_str.split(".")
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return (major, minor)
    except (ValueError, IndexError):
        return None


def parse_os_version(os_family, os_version_str):
    """
    Parse OS version string into a comparable tuple.
    For Windows: '10.0.26100' → (10, 0)
    For macOS: '14.5' → (14, 5)
    For Ubuntu: '22.04.3 LTS' → (22, 4)
    """
    if not os_version_str:
        return None
    # Strip non-numeric suffixes
    cleaned = re.sub(r"[^0-9.]", "", os_version_str).strip(".")
    return parse_version(cleaned)


def lookup_compute_cap(gpu_name):
    """Look up compute capability from the table by GPU name substring match."""
    if not gpu_name:
        return None
    name_lower = gpu_name.lower().strip()
    # Try exact match first, then substring
    for key, cc in COMPUTE_CAP_TABLE.items():
        if key in name_lower:
            return cc
    return None


def cc_string(cc):
    """Convert (8, 9) → '8.9'"""
    if not cc:
        return ""
    return f"{cc[0]}.{cc[1]}"


def emit(key, value):
    print(f"{key}={value}", flush=True)


def check_result(status, message):
    """Return a (status, message) tuple."""
    return (status, message)


# ── Individual checks ─────────────────────────────────────────────────────────

def check_os(os_family, os_version_str):
    """Validate OS compatibility."""
    if not os_family or os_family == "unknown":
        return check_result("warn", "Could not determine operating system — proceeding with caution.")

    os_family = os_family.lower()

    if os_family == "windows":
        ver = parse_os_version("windows", os_version_str)
        if ver and ver < MIN_WINDOWS_VER:
            return check_result("fail", f"Windows {os_version_str} is too old. Windows 10 or later required.")
        return check_result("pass", f"Windows {os_version_str or 'detected'} is supported.")

    elif os_family == "macos":
        ver = parse_os_version("macos", os_version_str)
        if ver and ver < MIN_MACOS_VER:
            return check_result("fail", f"macOS {os_version_str} is too old. macOS 12 (Monterey) or later required.")
        return check_result("pass", f"macOS {os_version_str or 'detected'} is supported.")

    elif os_family == "linux":
        # Linux is generally well-supported
        return check_result("pass", f"Linux ({os_version_str or 'detected'}) is supported.")

    else:
        return check_result("warn", f"Unknown OS '{os_family}' — compatibility not guaranteed.")


def check_arch(arch, gpu_mfr):
    """Validate architecture compatibility."""
    if not arch:
        return check_result("warn", "Could not determine system architecture.")

    arch = arch.lower()

    if "x86_64" in arch or "amd64" in arch or "x64" in arch:
        return check_result("pass", f"x86_64 architecture — fully supported for all frameworks.")

    if "arm64" in arch or "aarch64" in arch:
        if gpu_mfr and gpu_mfr.lower() == "apple":
            return check_result("pass", f"ARM64 (Apple Silicon) — fully supported via MPS.")
        elif gpu_mfr and gpu_mfr.lower() == "nvidia":
            return check_result("warn", f"ARM64 with NVIDIA GPU — CUDA support is limited on ARM. Consider CPU-only or cloud resources.")
        else:
            return check_result("pass", f"ARM64 architecture — supported for CPU-only workloads.")

    return check_result("warn", f"Architecture '{arch}' — compatibility not guaranteed.")


def check_gpu(gpu_mfr, gpu_name, vram_mb):
    """Validate GPU minimum requirements."""
    if not gpu_mfr or gpu_mfr == "none":
        return check_result("pass", "No discrete GPU detected — will use CPU-only mode.")

    gpu_mfr = gpu_mfr.lower()

    if gpu_mfr == "nvidia":
        if not gpu_name:
            return check_result("warn", "NVIDIA GPU detected but name unknown — proceeding with caution.")
        # Check VRAM
        if vram_mb:
            try:
                vram = int(vram_mb)
                if vram < MIN_VRAM_MB:
                    return check_result("fail",
                        f"{gpu_name} has only {vram // 1024}GB VRAM — minimum {MIN_VRAM_MB // 1024}GB required for ML workloads.")
                elif vram < REC_VRAM_MB:
                    return check_result("warn",
                        f"{gpu_name} has {vram // 1024}GB VRAM — {REC_VRAM_MB // 1024}GB+ recommended for larger models.")
            except (ValueError, TypeError):
                pass
        return check_result("pass", f"NVIDIA {gpu_name or 'GPU'} detected.")

    elif gpu_mfr == "amd":
        if not gpu_name:
            return check_result("warn", "AMD GPU detected but name unknown — proceeding with caution.")
        if vram_mb:
            try:
                vram = int(vram_mb)
                if vram < MIN_VRAM_MB:
                    return check_result("fail",
                        f"{gpu_name} has only {vram // 1024}GB VRAM — minimum {MIN_VRAM_MB // 1024}GB required.")
                elif vram < REC_VRAM_MB:
                    return check_result("warn",
                        f"{gpu_name} has {vram // 1024}GB VRAM — {REC_VRAM_MB // 1024}GB+ recommended.")
            except (ValueError, TypeError):
                pass
        return check_result("pass", f"AMD {gpu_name or 'GPU'} detected.")

    elif gpu_mfr == "apple":
        return check_result("pass", f"Apple {gpu_name or 'GPU'} detected — using Metal Performance Shaders.")

    elif gpu_mfr == "intel":
        return check_result("warn", "Intel GPU detected — limited ML framework support. CPU-only mode recommended.")

    return check_result("pass", f"GPU ({gpu_mfr}) detected.")


def check_cuda(cuda_ver_str, gpu_mfr, gpu_name):
    """Validate CUDA version for NVIDIA GPUs."""
    if not gpu_mfr or gpu_mfr.lower() != "nvidia":
        return check_result("pass", "Not applicable (non-NVIDIA GPU).")

    if not cuda_ver_str:
        return check_result("warn",
            "NVIDIA GPU detected but CUDA version unknown. "
            "Install NVIDIA drivers with CUDA 11.8+ from https://developer.nvidia.com/cuda-downloads.")

    ver = parse_version(cuda_ver_str)
    if not ver:
        return check_result("warn", f"Could not parse CUDA version '{cuda_ver_str}'.")

    if ver < MIN_CUDA_VER:
        return check_result("fail",
            f"CUDA {cuda_ver_str} is too old. Minimum CUDA {cc_string(MIN_CUDA_VER)} required for PyTorch 2.x.")
    elif ver < REC_CUDA_VER:
        return check_result("warn",
            f"CUDA {cuda_ver_str} meets minimum requirements, but CUDA {cc_string(REC_CUDA_VER)}+ is recommended.")
    else:
        return check_result("pass", f"CUDA {cuda_ver_str} — fully supported.")


def check_rocm(rocm_ver_str, gpu_mfr, os_family):
    """Validate ROCm version for AMD GPUs."""
    if not gpu_mfr or gpu_mfr.lower() != "amd":
        return check_result("pass", "Not applicable (non-AMD GPU).")

    if os_family and os_family.lower() != "linux":
        return check_result("warn",
            "AMD GPU detected on non-Linux OS. ROCm is Linux-only; will use CPU-only mode on this platform.")

    if not rocm_ver_str:
        return check_result("warn",
            "AMD GPU detected but ROCm version unknown. "
            "Install ROCm 5.0+ from https://rocm.docs.amd.com/")

    ver = parse_version(rocm_ver_str)
    if not ver:
        return check_result("warn", f"Could not parse ROCm version '{rocm_ver_str}'.")

    if ver < MIN_ROCM_VER:
        return check_result("fail",
            f"ROCm {rocm_ver_str} is too old. Minimum ROCm {cc_string(MIN_ROCM_VER)} required.")
    elif ver < REC_ROCM_VER:
        return check_result("warn",
            f"ROCm {rocm_ver_str} meets minimum requirements, but ROCm {cc_string(REC_ROCM_VER)}+ is recommended.")
    else:
        return check_result("pass", f"ROCm {rocm_ver_str} — fully supported.")


def check_metal(metal_ver_str, mps_avail, gpu_mfr):
    """Validate Metal/MPS support for Apple GPUs."""
    if not gpu_mfr or gpu_mfr.lower() != "apple":
        return check_result("pass", "Not applicable (non-Apple GPU).")

    if mps_avail and mps_avail.lower() == "true":
        return check_result("pass", f"Metal Performance Shaders (MPS) available — GPU acceleration ready.")
    elif metal_ver_str:
        return check_result("warn",
            f"Metal {metal_ver_str} detected but MPS not available. "
            "Ensure you're on macOS 12.3+ and using a supported Apple Silicon or AMD GPU.")
    else:
        return check_result("warn",
            "Apple GPU detected but Metal version unknown. GPU acceleration may not be available.")


def check_compute_cap(gpu_mfr, gpu_name):
    """Look up and validate NVIDIA compute capability."""
    if not gpu_mfr or gpu_mfr.lower() != "nvidia":
        return check_result("pass", "Not applicable (non-NVIDIA GPU)."), None

    if not gpu_name:
        return check_result("warn", "NVIDIA GPU name unknown — cannot determine compute capability."), None

    cc = lookup_compute_cap(gpu_name)
    if not cc:
        return check_result("warn",
            f"Compute capability for '{gpu_name}' not in lookup table. "
            "Run 'nvidia-smi -q -d COMPUTE' to check manually."), None

    if cc < MIN_CC:
        return check_result("fail",
            f"Compute capability {cc_string(cc)} is too old. "
            f"Minimum {cc_string(MIN_CC)} (Maxwell) required for modern CUDA frameworks."), cc
    elif cc < REC_CC:
        return check_result("warn",
            f"Compute capability {cc_string(cc)} meets minimum requirements, "
            f"but {cc_string(REC_CC)}+ (Volta) recommended for ML performance."), cc
    else:
        return check_result("pass",
            f"Compute capability {cc_string(cc)} — fully supported."), cc


def check_python(python_ver_str):
    """Validate Python version."""
    if not python_ver_str:
        return check_result("fail", "Python not detected. Python 3.8+ is required.")

    ver = parse_version(python_ver_str)
    if not ver:
        return check_result("warn", f"Could not parse Python version '{python_ver_str}'.")

    if ver < MIN_PYTHON_VER:
        return check_result("fail",
            f"Python {python_ver_str} is too old. Python {cc_string(MIN_PYTHON_VER)}+ is required.")
    elif ver < REC_PYTHON_VER:
        return check_result("warn",
            f"Python {python_ver_str} meets minimum requirements, "
            f"but Python {cc_string(REC_PYTHON_VER)}+ is recommended.")
    else:
        return check_result("pass", f"Python {python_ver_str} — fully supported.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Validate system compatibility for ML frameworks."
    )
    parser.add_argument("--os-family", default="", help="OS family: windows | macos | linux | unknown")
    parser.add_argument("--os-version", default="", help="OS version string (e.g. kernel or build number)")
    parser.add_argument("--arch", default="", help="System architecture: x86_64 | arm64 | aarch64 | ...")
    parser.add_argument("--gpu-mfr", default="", help="GPU manufacturer: nvidia | amd | apple | intel | none")
    parser.add_argument("--gpu-name", default="", help="GPU model name")
    parser.add_argument("--gpu-vram-mb", default="", help="GPU VRAM in MB")
    parser.add_argument("--cuda-ver", default="", help="CUDA version string")
    parser.add_argument("--rocm-ver", default="", help="ROCm version string")
    parser.add_argument("--metal-ver", default="", help="Metal version string")
    parser.add_argument("--mps-avail", default="", help="MPS available: true | false")
    parser.add_argument("--python-ver", default="", help="Python version string")

    args = parser.parse_args()

    # Run all checks
    os_result = check_os(args.os_family, args.os_version)
    arch_result = check_arch(args.arch, args.gpu_mfr)
    gpu_result = check_gpu(args.gpu_mfr, args.gpu_name, args.gpu_vram_mb)
    cuda_result = check_cuda(args.cuda_ver, args.gpu_mfr, args.gpu_name)
    rocm_result = check_rocm(args.rocm_ver, args.gpu_mfr, args.os_family)
    metal_result = check_metal(args.metal_ver, args.mps_avail, args.gpu_mfr)
    cc_result, cc_value = check_compute_cap(args.gpu_mfr, args.gpu_name)
    python_result = check_python(args.python_ver)

    # Collect all results for overall verdict
    all_results = [os_result, arch_result, gpu_result, cuda_result, rocm_result,
                   metal_result, cc_result, python_result]

    # Overall: fail if any fail, warn if any warn, pass otherwise
    has_fail = any(r[0] == "fail" for r in all_results)
    has_warn = any(r[0] == "warn" for r in all_results)

    if has_fail:
        overall = "fail"
        overall_msg = "Some compatibility checks failed. Review warnings above before proceeding."
    elif has_warn:
        overall = "warn"
        overall_msg = "All critical checks passed, but there are warnings to review."
    else:
        overall = "pass"
        overall_msg = "All compatibility checks passed — system is ready."

    # Emit results
    emit("COMPAT_OS",         os_result[0])
    emit("COMPAT_OS_MSG",     os_result[1])
    emit("COMPAT_ARCH",       arch_result[0])
    emit("COMPAT_ARCH_MSG",   arch_result[1])
    emit("COMPAT_GPU",        gpu_result[0])
    emit("COMPAT_GPU_MSG",    gpu_result[1])
    emit("COMPAT_CUDA",       cuda_result[0])
    emit("COMPAT_CUDA_MSG",   cuda_result[1])
    emit("COMPAT_ROCM",       rocm_result[0])
    emit("COMPAT_ROCM_MSG",   rocm_result[1])
    emit("COMPAT_METAL",      metal_result[0])
    emit("COMPAT_METAL_MSG",  metal_result[1])
    emit("COMPAT_CC",         cc_string(cc_value) if cc_value else "")
    emit("COMPAT_CC_MSG",     cc_result[1])
    emit("COMPAT_PYTHON",     python_result[0])
    emit("COMPAT_PYTHON_MSG", python_result[1])
    emit("COMPAT_OVERALL",    overall)
    emit("COMPAT_OVERALL_MSG", overall_msg)

    sys.exit(0)


if __name__ == "__main__":
    main()