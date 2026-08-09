"""
detect_os.py — Detect operating system details.

Output (stdout, KEY=VALUE):
    OS_FULL    — e.g. "Windows 11 Pro 24H2" / "Ubuntu 22.04.3 LTS (kernel 5.15.0-89-generic)"
    OS_PRETTY  — e.g. "Windows 11 Pro" / "Ubuntu 22.04.3 LTS"
    OS_KERNEL  — e.g. "10.0.26100" / "5.15.0-89-generic" / "23.5.0"

Exit 0 on success, 1 on failure.
"""

import sys
import platform
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


def detect_windows():
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"
        )
        product = winreg.QueryValueEx(key, "ProductName")[0]   # "Windows 11 Pro"
        # DisplayVersion is the feature update label e.g. "24H2", "23H2"
        # Falls back to ReleaseId ("21H2", "2009") on older builds
        try:
            build_label = winreg.QueryValueEx(key, "DisplayVersion")[0]
        except FileNotFoundError:
            build_label = winreg.QueryValueEx(key, "ReleaseId")[0]
        winreg.CloseKey(key)
        os_full   = f"{product} {build_label}"
        os_pretty = product
        os_kernel = platform.version()   # "10.0.26100"
    except Exception as e:
        # Fallback — less detail but never crashes
        os_full   = platform.platform()
        os_pretty = f"{platform.system()} {platform.release()}"
        os_kernel = platform.version()
    return os_full, os_pretty, os_kernel


def detect_linux():
    # Kernel version via uname -r
    try:
        kernel = subprocess.run(
            ["uname", "-r"], capture_output=True, text=True, timeout=5,
            env=clean_subprocess_env()
        ).stdout.strip()
    except Exception:
        kernel = platform.release()

    try:
        arch = subprocess.run(
            ["uname", "-m"], capture_output=True, text=True, timeout=5,
            env=clean_subprocess_env()
        ).stdout.strip()
    except Exception:
        arch = platform.machine()

    # Distribution name via /etc/os-release (systemd standard)
    pretty_name = ""
    name        = ""
    version_id  = ""
    try:
        with open("/etc/os-release") as f:
            for line in f:
                line = line.strip()
                if line.startswith("PRETTY_NAME="):
                    pretty_name = line.split("=", 1)[1].strip().strip('"')
                elif line.startswith("NAME="):
                    name = line.split("=", 1)[1].strip().strip('"')
                elif line.startswith("VERSION_ID="):
                    version_id = line.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError:
        pass

    # Fallback: try hostnamectl if /etc/os-release is absent
    if not pretty_name:
        try:
            out = subprocess.run(
                ["hostnamectl"], capture_output=True, text=True, timeout=5,
                env=clean_subprocess_env()
            ).stdout
            for line in out.splitlines():
                if "Operating System:" in line:
                    pretty_name = line.split(":", 1)[1].strip()
                    break
        except Exception:
            pass

    if not pretty_name:
        pretty_name = f"{name} {version_id}".strip() or "Linux"

    os_full   = f"{pretty_name} (kernel {kernel})" if kernel else pretty_name
    os_pretty = pretty_name
    os_kernel = kernel
    return os_full, os_pretty, os_kernel, arch


# macOS major version → marketing codename
MACOS_CODENAMES = {
    15: "Sequoia",
    14: "Sonoma",
    13: "Ventura",
    12: "Monterey",
    11: "Big Sur",
    10: "Catalina",   # 10.15 — close enough for display
}

def detect_macos():
    try:
        version = subprocess.run(
            ["sw_vers", "-productVersion"], capture_output=True, text=True, timeout=5,
            env=clean_subprocess_env()
        ).stdout.strip()
        kernel = subprocess.run(
            ["uname", "-r"], capture_output=True, text=True, timeout=5,
            env=clean_subprocess_env()
        ).stdout.strip()
        arch = subprocess.run(
            ["uname", "-m"], capture_output=True, text=True, timeout=5,
            env=clean_subprocess_env()
        ).stdout.strip()
    except Exception:
        version = platform.mac_ver()[0]
        kernel  = platform.release()
        arch = platform.machine()

    try:
        major    = int(version.split(".")[0])
        codename = MACOS_CODENAMES.get(major, "")
    except (ValueError, IndexError):
        codename = ""

    suffix    = f" ({codename})" if codename else ""
    os_full   = f"macOS {version}{suffix}"
    os_pretty = f"macOS {version}"
    os_kernel = kernel
    return os_full, os_pretty, os_kernel, arch


def main():
    plat = sys.platform
    try:
        if plat == "win32":
            os_full, os_pretty, os_kernel = detect_windows()
            arch = platform.machine()
        elif plat == "darwin":
            os_full, os_pretty, os_kernel, arch = detect_macos()
        else:
            os_full, os_pretty, os_kernel, arch = detect_linux()
    except Exception as e:
        print(f"OS_FULL=", flush=True)
        print(f"OS_PRETTY=", flush=True)
        print(f"OS_KERNEL=", flush=True)
        print(f"ARCH=", flush=True)
        print(f"ERROR={e}", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"OS_FULL={os_full}",   flush=True)
    print(f"OS_PRETTY={os_pretty}", flush=True)
    print(f"OS_KERNEL={os_kernel}", flush=True)
    print(f"ARCH={arch}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()