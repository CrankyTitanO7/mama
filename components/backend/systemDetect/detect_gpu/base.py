"""Shared helpers for detect_gpu sub-modules."""
import re
import sys
import shutil
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


def run(cmd, timeout=15):
    """Run a command, return (returncode, stdout, stderr). Never raises."""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            env=clean_subprocess_env()
        )
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 1, "", f"command not found: {cmd[0]}"
    except Exception as e:
        return 1, "", str(e)


def emit(key, value):
    if value is not None and value != "":
        print(f"{key}={value}", flush=True)


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