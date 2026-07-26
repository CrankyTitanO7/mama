"""Shared helpers for detect_gpu sub-modules."""
import re
import sys
import shutil
import subprocess
import os


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