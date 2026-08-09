"""
install_fw.py — Install PyTorch or TensorFlow with the correct GPU variant.

Usage:
    python install_fw.py <fw> <gpu_variant> [accel_version]

Arguments:
    fw            — "torch" | "tf"
    gpu_variant   — "cuda" | "rocm" | "cpu"
    accel_version — CUDA version string for torch+cuda  (e.g. "12.1")
                    ROCm version string for torch+rocm   (e.g. "5.7")
                    Omit or leave empty for cpu / tf variants.

Exit code mirrors the pip exit code (0 = success).

Notes:
    - Always installs into the current Python interpreter (sys.executable),
      so it respects active virtualenvs.
    - For TF + ROCm, tensorflow-rocm is a community build maintained by AMD;
      version availability may lag behind upstream tensorflow.
    - PyTorch CUDA wheels: https://pytorch.org/get-started/locally/
    - If CUDA version is unknown or newer than the newest published wheel
      (e.g. driver-reported CUDA 13.3), the latest available CUDA wheel
      (cu132) is used.
"""

import sys
import subprocess
import os


def clean_subprocess_env():
    """Return a copy of os.environ safe for spawning real Python subprocesses.

    When frozen, PyInstaller's onefile bootloader points LD_LIBRARY_PATH /
    DYLD_LIBRARY_PATH at its own bundled-libs temp directory; a spawned
    system/venv Python would otherwise load the app's bundled shared
    libraries instead of its own. PyInstaller saves the pre-bootloader value
    as *_ORIG so children can restore it.
    """
    env = os.environ.copy()
    if getattr(sys, 'frozen', False):
        for var, orig_var in (
            ('LD_LIBRARY_PATH', 'LD_LIBRARY_PATH_ORIG'),
            ('DYLD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH_ORIG'),
        ):
            if orig_var in env:
                env[var] = env[orig_var]
            else:
                env.pop(var, None)
    return env


# Latest stable CUDA/ROCm tags to fall back to when version detection failed.
DEFAULT_CUDA_TAG = "cu132"   # Latest PyTorch CUDA wheel (CUDA 13.2)
DEFAULT_ROCM_TAG = "rocm7.2"

# Newest CUDA major.minor PyTorch publishes wheels for. Drivers/toolkits can
# report newer versions (e.g. CUDA 13.3) that have no matching PyTorch wheel.
MAX_CUDA = (13, 2)


def cuda_tag(version_str):
    """
    Convert a CUDA version string to a PyTorch wheel tag.
    "12.6" → "cu126", "13.0" → "cu130", "13.2" → "cu132"
    Falls back to DEFAULT_CUDA_TAG if version_str is empty / unparseable.
    Versions newer than the newest published wheel (13.2) are clamped down,
    so e.g. CUDA 13.3 resolves to "cu132" instead of a nonexistent "cu133".
    """
    if not version_str:
        return DEFAULT_CUDA_TAG
    # Remove dots and take first two numeric parts (major + minor)
    parts = version_str.split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return DEFAULT_CUDA_TAG
    if (major, minor) > MAX_CUDA:
        major, minor = MAX_CUDA
    return f"cu{major}{minor}"


def rocm_tag(version_str):
    """
    Convert a ROCm version string to a PyTorch wheel tag.
    "5.7.1" → "rocm5.7", "6.2" → "rocm6.2"
    Falls back to DEFAULT_ROCM_TAG if version_str is empty / unparseable.
    """
    if not version_str:
        return DEFAULT_ROCM_TAG
    parts = version_str.split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return f"rocm{major}.{minor}"
    except (ValueError, IndexError):
        return DEFAULT_ROCM_TAG


def build_command(fw, gpu_variant, accel_version):
    pip = [sys.executable, "-m", "pip", "install"]

    if fw == "torch":
        packages = ["torch", "torchvision"]
        if gpu_variant == "cuda":
            tag       = cuda_tag(accel_version)
            index_url = f"https://download.pytorch.org/whl/{tag}"
            return pip + packages + ["--index-url", index_url]
        elif gpu_variant == "rocm":
            tag       = rocm_tag(accel_version)
            index_url = f"https://download.pytorch.org/whl/{tag}"
            return pip + packages + ["--index-url", index_url]
        else:
            # CPU-only
            return pip + packages + [
                "--index-url", "https://download.pytorch.org/whl/cpu"
            ]

    elif fw == "tf":
        if gpu_variant == "cuda":
            # tensorflow[and-cuda] bundles cuDNN + cuBLAS via pip (TF 2.13+)
            return pip + ["tensorflow[and-cuda]"]
        elif gpu_variant == "rocm":
            # Community build maintained by AMD: https://github.com/ROCmSoftwarePlatform/tensorflow-upstream
            return pip + ["tensorflow-rocm"]
        else:
            return pip + ["tensorflow-cpu"]

    else:
        print(f"ERROR: Unknown framework '{fw}'. Expected 'torch' or 'tf'.",
              file=sys.stderr, flush=True)
        sys.exit(2)


def main():
    if len(sys.argv) < 3:
        print(
            "Usage: install_fw.py <torch|tf> <cuda|rocm|cpu> [accel_version]",
            file=sys.stderr, flush=True
        )
        sys.exit(2)

    fw            = sys.argv[1].lower().strip()
    gpu_variant   = sys.argv[2].lower().strip()
    accel_version = sys.argv[3].strip() if len(sys.argv) > 3 else ""

    cmd = build_command(fw, gpu_variant, accel_version)

    print(f"Running: {' '.join(cmd)}", flush=True)
    print("-" * 60, flush=True)

    # Run pip, inheriting stdout/stderr so Node.js spawn captures streamed output
    result = subprocess.run(cmd, env=clean_subprocess_env())
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()