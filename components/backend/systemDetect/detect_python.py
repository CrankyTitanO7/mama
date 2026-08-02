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


def login_shell_path():
    """
    PATH as the user's login shell sees it ('' if it can't be recovered).

    A GUI-launched (frozen) app inherits a minimal PATH that lacks the
    user's shell additions (Homebrew, /usr/local, custom toolchains such
    as STM32CubeCLT, ...). Running the login shell non-interactively
    re-reads ~/.zprofile / ~/.zshrc / ~/.bash_profile etc. and prints the
    real PATH, which includes every directory the user deliberately added.
    """
    if sys.platform == "win32":
        return ""
    shells = []
    if os.environ.get("SHELL"):
        shells.append(os.environ["SHELL"])
    shells += ["/bin/zsh", "/bin/bash"]
    for shell in shells:
        if not os.path.exists(shell):
            continue
        try:
            result = subprocess.run(
                [shell, "-l", "-c", 'echo "__PATHPROBE__$PATH"'],
                capture_output=True, text=True, timeout=10,
                env=clean_subprocess_env(),
            )
            # Startup scripts may print noise to stdout; the marker line is
            # guaranteed to come last, so take its occurrence.
            for line in reversed(result.stdout.splitlines()):
                if "__PATHPROBE__" in line:
                    return line.split("__PATHPROBE__", 1)[1].strip()
        except Exception:
            continue
    return ""


def registry_path_windows():
    """User + system PATH from the Windows registry ('' if unavailable)."""
    paths = []
    try:
        import winreg
        for hive, key in (
            (winreg.HKEY_CURRENT_USER, r"Environment"),
            (winreg.HKEY_LOCAL_MACHINE,
             r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        ):
            with winreg.OpenKey(hive, key) as regkey:
                value, _ = winreg.QueryValueEx(regkey, "Path")
                if value:
                    paths.append(value)
    except Exception:
        pass
    return os.pathsep.join(paths)


def merge_user_path():
    """Prepend the user's real PATH to os.environ['PATH']."""
    extra = registry_path_windows() if sys.platform == "win32" else login_shell_path()
    current = os.environ.get("PATH", "")
    if extra:
        os.environ["PATH"] = extra + (os.pathsep + current if current else "")


def check_command(*candidates, extra_dirs=()):
    """Return True if any candidate exists on PATH or in extra_dirs.

    extra_dirs are checked as exact absolute paths. They cover tools that
    are installed but not on PATH — a GUI-launched (frozen) app inherits a
    minimal PATH that lacks the user's shell additions (Homebrew, /usr/local,
    official installers, ...), so PATH lookup alone misses real installs.
    """
    for cmd in candidates:
        if shutil.which(cmd):
            return True
        exe = cmd + (".exe" if sys.platform == "win32" else "")
        for directory in extra_dirs:
            path = os.path.join(directory, exe)
            if os.path.isfile(path) and os.access(path, os.X_OK):
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


def is_apple_python(real: str) -> bool:
    """True if the real path is Apple's system Python (CommandLineTools / Xcode).

    macOS ships /usr/bin/python3 — a symlink to
    /Library/Developer/CommandLineTools/usr/bin/python3 (3.9.6) when the
    CommandLineTools are installed. It has no usable pip (it cannot install
    anything into system-protected locations) and no PyTorch wheels exist for
    it, so it must never count as a detected Python.
    """
    return (real.startswith("/usr/bin/")
            or real.startswith("/Library/Developer/"))


def find_system_python():
    """
    Locate a real, WORKING system Python on PATH, excluding this app's own
    bundled interpreter and (on macOS) Apple's CommandLineTools /usr/bin/
    python3, which has no usable pip.

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

        if sys.platform == "darwin" and is_apple_python(real):
            continue  # reject Apple's /usr/bin/python3 (3.9.6, no usable pip)

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


def cmake_fallback_dirs():
    """Well-known CMake installation directories, per platform."""
    dirs = []
    if sys.platform == "darwin":
        dirs += [
            "/opt/homebrew/bin",          # Apple Silicon Homebrew
            "/usr/local/bin",             # Intel Homebrew / official installer
            "/opt/local/bin",             # MacPorts
            "/Applications/CMake.app/Contents/bin",
        ]
    elif sys.platform == "win32":
        dirs += [
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "CMake", "bin"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "CMake", "bin"),
        ]
        install_path = _vswhere_install_path()
        if install_path:
            # CMake bundled with Visual Studio / Build Tools
            dirs.append(os.path.join(install_path, "CMake", "bin"))
            dirs.append(os.path.join(
                install_path, "Common7", "IDE", "CommonExtensions",
                "Microsoft", "CMake", "CMake", "bin"))
    else:
        dirs += ["/usr/bin", "/usr/local/bin", "/opt/cmake/bin", "/snap/bin"]
    return dirs


def check_cmake():
    return check_command("cmake", extra_dirs=cmake_fallback_dirs())


def _vswhere_install_path():
    """
    Locate the latest Visual Studio / Build Tools installation via
    vswhere.exe and return its installation path (or None). See
    _check_msvc_windows for why vswhere is the right tool for this.
    """
    vswhere = os.path.join(
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        "Microsoft Visual Studio", "Installer", "vswhere.exe",
    )
    if not os.path.exists(vswhere):
        return None
    try:
        result = subprocess.run(
            [vswhere, "-latest", "-products", "*",
             "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
             "-property", "installationPath"],
            capture_output=True, text=True, timeout=15,
            env=clean_subprocess_env(),
        )
        return result.stdout.strip() or None
    except Exception:
        return None


def _check_msvc_windows():
    """
    Detect MSVC via vswhere.exe rather than checking if 'cl' is on PATH.
    cl.exe is deliberately NOT added to PATH by the Visual Studio installer —
    it's only available inside a "Developer Command Prompt" session (via
    vcvarsall.bat). vswhere.exe is Microsoft's own tool for exactly this
    detection problem, always installed alongside VS/Build Tools at a fixed,
    documented path.
    """
    return _vswhere_install_path() is not None


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
    merge_user_path()
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