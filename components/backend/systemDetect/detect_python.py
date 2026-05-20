"""
detect_python.py — Detect Python, pip, CMake, and GCC availability.

Output (stdout, KEY=VALUE):
    PYTHON_VERSION   — e.g. "3.11.5"  (empty string if not found, but we ARE Python so always set)
    PIP_AVAILABLE    — true | false
    CMAKE_AVAILABLE  — true | false
    GCC_AVAILABLE    — true | false

Exit 0 always (missing tools are not errors, just reported as false).
"""

import sys
import subprocess
import shutil


def check_command(*candidates):
    """Return True if any of the candidate commands exist on PATH."""
    for cmd in candidates:
        if shutil.which(cmd):
            return True
    return False


def check_pip():
    """pip may exist as a command or only as a module."""
    if check_command("pip", "pip3"):
        return True
    # Try as a module (covers venv setups where the script isn't on PATH)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            capture_output=True, timeout=10
        )
        return result.returncode == 0
    except Exception:
        return False


def check_gcc():
    """
    Accept any C/C++ compiler — gcc, g++, clang, cl (MSVC).
    On Windows MSVC ships as 'cl', on macOS Xcode ships 'clang'.
    """
    return check_command("gcc", "g++", "clang", "clang++", "cl")


def main():
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"

    pip_ok   = check_pip()
    cmake_ok = check_command("cmake")
    gcc_ok   = check_gcc()

    print(f"PYTHON_VERSION={python_version}", flush=True)
    print(f"PIP_AVAILABLE={'true' if pip_ok   else 'false'}", flush=True)
    print(f"CMAKE_AVAILABLE={'true' if cmake_ok else 'false'}", flush=True)
    print(f"GCC_AVAILABLE={'true' if gcc_ok   else 'false'}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()