#!/usr/bin/env python3
"""
install_deps.py — Install Python packages required for fine‑tuning.
Skips torch and tensorflow (user is expected to install those separately).

IPC protocol: prints JSON lines to stdout:
  {"type": "install_status", "message": "...", "package": "...", "status": "checking|installing|done|skipped|error"}
  {"type": "install_progress", "current": N, "total": N, "package": "..."}
  {"type": "install_done", "success": true/false, "error": "..."}

Usage:
  python install_deps.py [--check-only]
"""

import sys
import os
import json
import subprocess
import importlib


PACKAGES = [
    "transformers",
    "trl",
    "peft",
    "datasets",
    "accelerate",
    "huggingface_hub",
    "scipy",
    "safetensors",
    "einops",
]

# Bitsandbytes is only available on Linux/x86_64 with CUDA
if sys.platform.startswith("linux") and os.uname().machine in ("x86_64", "amd64"):
    PACKAGES.append("bitsandbytes")


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def check_installed(pkg: str) -> bool:
    try:
        importlib.import_module(pkg.replace("-", "_"))
        return True
    except ImportError:
        return False


def pip_install(pkg: str) -> bool:
    emit({"type": "install_status", "message": f"Ensuring {pkg}...", "package": pkg, "status": "checking"})
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--no-input", pkg],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            # Log pip's output so the frontend shows what happened
            for line in result.stdout.strip().split('\n'):
                line = line.strip()
                if line and 'Requirement already satisfied' not in line:
                    emit({"type": "install_log", "text": line})
            # Verify it's actually importable after install
            if check_installed(pkg):
                emit({"type": "install_status", "message": f"{pkg} ready", "package": pkg, "status": "done"})
                return True
            else:
                emit({"type": "install_status", "message": f"pip OK but {pkg} not importable — try reinstalling", "package": pkg, "status": "error"})
                return False
        else:
            emit({"type": "install_status", "message": f"pip install {pkg} failed", "package": pkg, "status": "error"})
            for line in result.stdout.strip().split('\n'):
                if line.strip():
                    emit({"type": "install_log", "text": line.strip()})
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    emit({"type": "install_log", "text": line.strip()})
            return False
    except subprocess.TimeoutExpired:
        emit({"type": "install_status", "message": f"Timeout installing {pkg} (5 min)", "package": pkg, "status": "error"})
        return False
    except Exception as e:
        emit({"type": "install_status", "message": f"Error installing {pkg}: {e}", "package": pkg, "status": "error"})
        return False


def main():
    check_only = "--check-only" in sys.argv

    total = len(PACKAGES)
    for i, pkg in enumerate(PACKAGES):
        emit({"type": "install_progress", "current": i, "total": total, "package": pkg})

        if check_only and not check_installed(pkg):
            emit({"type": "install_status", "message": f"{pkg} is missing", "package": pkg, "status": "missing"})
            emit({"type": "install_done", "success": False, "error": f"Missing package: {pkg}"})
            sys.exit(1)

        if check_installed(pkg):
            emit({"type": "install_status", "message": f"{pkg} already installed", "package": pkg, "status": "skipped"})
            continue

        if not pip_install(pkg):
            emit({"type": "install_done", "success": False, "error": f"Failed to install {pkg}"})
            sys.exit(1)

    emit({"type": "install_progress", "current": total, "total": total, "package": ""})
    emit({"type": "install_done", "success": True, "error": ""})


if __name__ == "__main__":
    main()
