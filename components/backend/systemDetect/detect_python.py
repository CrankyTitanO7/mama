"""
detect_python.py — Detect system Python, pip, CMake, and GCC availability.

This script is executed BY the app's own interpreter (a bundled/frozen
PyInstaller interpreter in production). It must therefore never report that
interpreter itself — instead it locates a real system Python on PATH
(excluding the bundled one) and asks it for its version and pip support.

Output (stdout, KEY=VALUE):
    PYTHON_VERSION   — e.g. "3.11.5"  (empty string if no system Python found)
    PIP_AVAILABLE    — true | false
    CMAKE_AVAILABLE  — true | false
    GCC_AVAILABLE    — true | false

Exit 0 always (missing tools are not errors, just reported as false).
"""

import os
import re
import shutil
import subprocess
import sys


def check_command(*candidates):
    """Return True if any of the candidate commands exist on PATH."""
    for cmd in candidates:
        if shutil.which(cmd):
            return True
    return False


def clean_subprocess_env():
    """
    Environment for subprocesses we spawn.

    When frozen, PyInstaller's onefile bootloader points LD_LIBRARY_PATH (and
    on macOS, sometimes DYLD_LIBRARY_PATH) at its own bundled-libs temp
    directory so the frozen app finds its bundled .so/.dylib files. Any
    subprocess we spawn inherits that by default — meaning a "real system
    Python" we launch could accidentally load PyInstaller's bundled shared
    libraries instead of its own. PyInstaller saves the pre-bootloader value
    as *_ORIG specifically so spawned children can restore it; we do that
    here rather than passing the polluted environment through untouched.
    """
    env = os.environ.copy()
    if getattr(sys, "frozen", False):
        for var, orig_var in (
            ("LD_LIBRARY_PATH", "LD_LIBRARY_PATH_ORIG"),
            ("DYLD_LIBRARY_PATH", "DYLD_LIBRARY_PATH_ORIG"),
        ):
            if orig_var in env:
                env[var] = env[orig_var]
            else:
                env.pop(var, None)
    return env


def run(python, *args):
    """Run a command with the given python; return trimmed stdout or None."""
    try:
        result = subprocess.run(
            [python, *args],
            capture_output=True, text=True, timeout=15,
            env=clean_subprocess_env(),
        )
        if result.returncode != 0:
            return None
        return (result.stdout or result.stderr).strip()
    except Exception:
        return None


def get_python_version(python):
    """Get the version string of a system python, e.g. '3.11.5' ('' if it fails)."""
    out = run(python, "--version")
    if not out:
        return ""
    match = re.search(r"\d+\.\d+(?:\.\d+)?", out)
    return match.group(0) if match else ""


def find_system_python():
    """
    Locate a real, WORKING system Python on PATH, excluding this app's own
    bundled interpreter.

    Validates each PATH candidate by actually running --version and checking
    it parses, rather than accepting the first PATH match unconditionally.
    This matters most on Windows, where python.exe/python3.exe commonly
    resolve — via the OS's App Execution Alias feature — to a Microsoft
    Store stub rather than a real interpreter when Python was never
    installed. That stub isn't a working Python; invoked non-interactively
    it produces no usable version output, so accepting it on the first match
    (without validation) would incorrectly report "no Python found" even
    when a real one exists further down PATH.

    Returns (path, version) or (None, "") if no working candidate is found.
    """
    own = os.path.realpath(sys.executable) if getattr(sys, "frozen", False) else None
    if sys.platform == "win32":
        candidates = ("py", "python", "python3")
    else:
        candidates = ("python3", "python")

    seen = set()
    for cmd in candidates:
        path = shutil.which(cmd)
        if not path:
            continue
        real = os.path.realpath(path)
        if real in seen:
            continue  # py/python/python3 often resolve to the same binary
        seen.add(real)

        if own and real == own:
            continue

        version = get_python_version(path)
        if version:
            return path, version
        # Candidate resolved to something on PATH but didn't actually work
        # (e.g. a Windows Store alias stub) — keep looking.

    return None, ""


def check_pip(python):
    """
    Check whether THIS SPECIFIC interpreter has pip — always via
    `python -m pip`, which is unambiguous. Checking for a bare "pip"/"pip3"
    command on PATH is not reliable here: PATH could easily contain a pip
    belonging to a completely different Python install, which would report
    a false positive for the interpreter we're actually asking about.
    """
    return run(python, "-m", "pip", "--version") is not None


def check_cmake():
    return check_command("cmake")


def _check_msvc_windows():
    """
    Detect MSVC via vswhere.exe rather than checking if 'cl' is on PATH.
    cl.exe is deliberately NOT added to PATH by the Visual Studio installer —
    it's only available inside a "Developer Command Prompt" session (via
    vcvarsall.bat). vswhere.exe is Microsoft's own tool for exactly this
    detection problem, always installed alongside VS/Build Tools at a fixed,
    documented path.
    """
    vswhere = os.path.join(
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        "Microsoft Visual Studio", "Installer", "vswhere.exe",
    )
    if not os.path.exists(vswhere):
        return False
    try:
        result = subprocess.run(
            [vswhere, "-latest", "-products", "*",
             "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
             "-property", "installationPath"],
            capture_output=True, text=True, timeout=15,
            env=clean_subprocess_env(),
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def check_gcc():
    """
    Accept any C/C++ compiler — gcc, g++, clang, cl (MSVC).
    On Windows, also checks for MSVC via vswhere (see _check_msvc_windows)
    since 'cl' rarely shows up in a plain PATH lookup.
    On macOS, Xcode ships 'clang'.
    """
    if check_command("gcc", "g++", "clang", "clang++", "cl"):
        return True
    if sys.platform == "win32":
        return _check_msvc_windows()
    return False


def main():
    system_python, python_version = find_system_python()
    pip_ok = check_pip(system_python) if system_python else False
    cmake_ok = check_cmake()
    gcc_ok = check_gcc()

    print(f"PYTHON_VERSION={python_version}", flush=True)
    print(f"PIP_AVAILABLE={'true' if pip_ok   else 'false'}", flush=True)
    print(f"CMAKE_AVAILABLE={'true' if cmake_ok else 'false'}", flush=True)
    print(f"GCC_AVAILABLE={'true' if gcc_ok   else 'false'}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()