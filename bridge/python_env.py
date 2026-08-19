"""bridge/python_env.py — Python interpreter / venv resolution mixin."""

import os
import sys
import shutil
import platform
import subprocess
from pathlib import Path
from typing import Optional

from .core import logger
from .env import CONDA_PREFIX_NAMES, allowed_python_path, clean_subprocess_env


class PythonEnvMixin:
    """Resolves the Python interpreters the app runs scripts with."""

    def _find_python(self) -> Optional[str]:
        """Find a working Python 3 interpreter.

        Prefers an interpreter that can actually install PyTorch:
        version >= 3.10 (older versions have no wheels) and, on macOS, one
        matching the OS architecture (an x86_64 interpreter under Rosetta can
        never satisfy an arm64 wheel index). Falls back to any working Python 3.
        """
        candidates = ['python3', 'python']
        if sys.platform == 'win32':
            candidates = ['python', 'py', 'python3']

        os_machine = platform.machine().lower()

        # Also probe well-known conda install locations directly: Finder
        # launches never have these on PATH, and conda pythons are the ones
        # pip can actually install into (no PEP 668 guard).
        known_dirs = []
        if sys.platform != 'win32':
            for root in ('/opt/homebrew/Caskroom', '/usr/local/Caskroom',
                         '/opt', str(Path.home())):
                for sub in CONDA_PREFIX_NAMES:
                    d = Path(root) / sub
                    if d.is_dir():
                        known_dirs.append(d / 'base' / 'bin' / 'python3')
                        known_dirs.append(d / 'bin' / 'python3')

        def probe(cmd: str) -> Optional[tuple]:
            """Return (major, minor, machine, externally_managed, has_pip)."""
            try:
                result = subprocess.run(
                    [cmd, '-c',
                     'import sys,platform;print(f"{sys.version_info.major}.{sys.version_info.minor} {platform.machine()}")'],
                    capture_output=True, text=True, timeout=8,
                    env=clean_subprocess_env()
                )
                if result.returncode != 0:
                    return None
                parts = (result.stdout or result.stderr).strip().split()
                major, minor = (int(x) for x in parts[0].split('.')[:2])
                machine = parts[1].lower() if len(parts) > 1 else ''
            except Exception:
                return None

            has_pip = False
            externally_managed = False
            try:
                proc = subprocess.run(
                    [cmd, '-m', 'pip', 'install', '--dry-run', '--no-index',
                     'mama-probe-nonexistent-package'],
                    capture_output=True, text=True, timeout=30,
                    env=clean_subprocess_env())
                if proc.returncode == 0:
                    has_pip = True  # no marker, pip works (nothing to install)
                else:
                    # Either PEP 668 guard or "no matching distribution".
                    text = (proc.stderr or '') + (proc.stdout or '')
                    if 'externally-managed' in text:
                        externally_managed = True
                    else:
                        has_pip = True  # normal resolution failure — pip works
            except Exception:
                pass
            return (major, minor, machine, externally_managed, has_pip)

        matches = []
        seen = set()
        for cmd in candidates:
            path = shutil.which(cmd)
            if not path:
                continue
            real = os.path.realpath(path)
            if real in seen:
                continue  # python3/python often resolve to the same binary
            seen.add(real)
            if not allowed_python_path(real):
                continue  # reject Apple's python3, pyenv, etc.
            info = probe(real)
            if info:
                matches.append((real, info))

        for path in known_dirs:
            if not path.exists():
                continue
            real = os.path.realpath(str(path))
            if real in seen:
                continue
            seen.add(real)
            if not allowed_python_path(real):
                continue
            info = probe(str(path))
            if info:
                matches.append((real, info))

        if not matches:
            return None

        # On macOS, drop interpreters that don't match the OS architecture
        # (e.g. x86_64 pythons running under Rosetta on Apple Silicon).
        if sys.platform == 'darwin':
            native = [m for m in matches if m[1][2] == os_machine]
            if native:
                matches = native

        # Prefer Python >= 3.10 (PyTorch publishes no wheels for older).
        new_enough = [m for m in matches
                      if m[1][0] > 3 or (m[1][0] == 3 and m[1][1] >= 10)]
        if new_enough:
            matches = new_enough

        # Prefer Python 3.10–3.14: PyTorch nightly wheels (incl. torchvision
        # and torchaudio) are only published for cp310–cp314.
        def in_wheel_range(m):
            return 3.10 <= m[1][0] + m[1][1] / 10.0 <= 3.14

        # Prefer interpreters pip can install into (not PEP 668 managed).
        def installable(m):
            return not m[1][3]

        wheel_range = [m for m in matches if in_wheel_range(m)]
        if wheel_range:
            matches = wheel_range

        installable_ok = [m for m in matches if installable(m)]
        if installable_ok:
            matches = installable_ok

        with_pip = [m for m in matches if m[1][4]]
        if with_pip:
            matches = with_pip

        return matches[0][0]

    def _get_python(self) -> Optional[str]:
        """Get cached Python executable."""
        if self._python_exe is None:
            self._python_exe = self._find_python()
        return self._python_exe

    def _get_training_python(self, project_folder: str = None) -> Optional[str]:
        """Python for training subprocesses — prefers project .venv, then a real interpreter.

        The frozen (PyInstaller) executable is never used: it is not a Python
        interpreter, and spawning it with a script path just relaunches the app.
        """
        if not project_folder:
            recents = self._read_recents() or {}
            project_folder = recents.get('open')
        if project_folder:
            venv_python = self._get_venv_python(project_folder)
            if venv_python:
                return venv_python
        if getattr(sys, 'frozen', False):
            return self._get_python()
        if sys.executable:
            return sys.executable
        return self._get_python()

    def _get_venv_python(self, project_folder: str) -> Optional[str]:
        """Get path to venv python if it exists and is usable.

        A venv made by Apple's /usr/bin/python3 (3.9.6) realpaths back to the
        CommandLineTools framework — rejected by allowed_python_path(), so the
        caller recreates the venv with a proper interpreter.
        """
        if not project_folder:
            return None
        venv_path = Path(project_folder) / '.venv'
        if sys.platform == 'win32':
            venv_python = venv_path / 'Scripts' / 'python.exe'
        else:
            venv_python = venv_path / 'bin' / 'python3'

        if not venv_python.exists():
            return None
        try:
            real = os.path.realpath(str(venv_python))
        except Exception:
            return None
        if not allowed_python_path(real):
            return None
        return str(venv_python)

    def _create_venv(self, project_folder: str) -> Optional[str]:
        """Create a .venv in the project folder and return the python path.

        If a stale/incompatible .venv exists (e.g. created by Apple's
        /usr/bin/python3 3.9.6), remove it first so the new venv is clean.
        """
        python = self._get_python()
        if not python:
            return None

        venv_path = Path(project_folder) / '.venv'
        if venv_path.exists():
            try:
                shutil.rmtree(str(venv_path))
                self._emit_install_progress(
                    {'type': 'meta', 'text': 'removed stale .venv (recreating with a proper Python)'})
            except Exception as e:
                logger.error('venv cleanup failed: %s', e)

        try:
            proc = subprocess.Popen(
                [python, '-m', 'venv', str(venv_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=clean_subprocess_env(),
                cwd=project_folder
            )
            _, stderr = proc.communicate(timeout=60)
            if proc.returncode != 0:
                logger.error('venv creation failed: %s', stderr)
                return None

            if sys.platform == 'win32':
                return str(venv_path / 'Scripts' / 'python.exe')
            return str(venv_path / 'bin' / 'python3')
        except Exception as e:
            logger.error('venv creation error: %s', e)
            return None
