"""bridge/system.py — system detection, installs, and python test runners."""

import os
import sys
import json
import subprocess
import threading
import time
import datetime
from pathlib import Path
from typing import Optional

from .core import logger
from .env import clean_subprocess_env


class SystemMixin:
    """Setup-wizard detection scripts, framework installs, and test runners."""

    # ── System Detection ─────────────────────────────────────────────────────

    def run_os_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_os.py')
        return self._run_script(script, timeout=15_000, fallback_python=True)

    def run_python_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_python.py')
        return self._run_script(script, timeout=15_000, fallback_python=True)

    def run_gpu_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_gpu' / '__init__.py')
        return self._run_script(script, timeout=90_000, fallback_python=True)

    def run_compatibility_check(self, params: dict) -> dict:
        script = str(self._system_detect_dir / 'check_compatibility.py')
        args = [
            '--os-family', str(params.get('osFamily', '')),
            '--os-version', str(params.get('osVersion', '')),
            '--arch', str(params.get('arch', '')),
            '--gpu-mfr', str(params.get('gpuMfr', '')),
            '--gpu-name', str(params.get('gpuName', '')),
            '--gpu-vram-mb', str(params.get('gpuVramMB', '')),
            '--cuda-ver', str(params.get('cudaVer', '')),
            '--rocm-ver', str(params.get('rocmVer', '')),
            '--metal-ver', str(params.get('metalVer', '')),
            '--mps-avail', str(params.get('mpsAvail', '')),
            '--python-ver', str(params.get('pythonVer', '')),
        ]
        return self._run_script(script, args, timeout=30_000, fallback_python=True)

    # ── System commands (generic) ────────────────────────────────────────────

    def run_system_command(self, command: str, args: list = None) -> dict:
        """Run an arbitrary system command."""
        if args is None:
            args = []
        try:
            proc = subprocess.Popen(
                [command] + list(args),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=(sys.platform == 'win32'),
                env=clean_subprocess_env()
            )
            stdout, stderr = proc.communicate(timeout=30)
            code = proc.returncode or 0
            if code == 0 and stderr and not stdout:
                stdout = stderr
                stderr = ''
            return {'code': code, 'stdout': stdout or '', 'stderr': stderr or ''}
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            return {'code': 1, 'stdout': stdout or '', 'stderr': (stderr or '') + '\nTimed out.'}
        except FileNotFoundError:
            return {'code': 1, 'stdout': '', 'stderr': f'Command not found: {command}'}
        except Exception as e:
            return {'code': 1, 'stdout': '', 'stderr': str(e)}

    def run_system_detect(self, framework: str) -> dict:
        """Legacy system detection command."""
        return self.run_gpu_detect()

    # ── Python commands (legacy) ─────────────────────────────────────────────

    def run_python_command(self, action: str) -> dict:
        """Run a generic Python command (legacy compatibility)."""
        script = str(self._python_tests_dir / 'pytorch_test.py')
        return self._run_script(script)

    # ── Install framework ────────────────────────────────────────────────────

    def run_install(self, fw: str, gpu_variant: str, accel_version: str = '') -> dict:
        """Run install_fw.py with framework, GPU variant, and optional accelerator version."""
        script = str(self._installs_dir / 'install_fw.py')
        args = [fw, gpu_variant]
        if accel_version:
            args.append(accel_version)

        os_info = self._get_os_info()
        args.extend(['--os-family', os_info['os_family']])
        args.extend(['--distro', os_info['distro']])

        return self._run_script(script, args, timeout=20 * 60_000)

    def run_install_stream(self, fw: str, gpu_variant: str,
                           accel_version: str = '', scope: str = 'global',
                           project_folder: str = '',
                           raw_command: str = '') -> dict:
        """Run install with real-time streaming output."""
        python = self._get_python()

        # Handle venv for project scope
        if scope == 'project' and project_folder:
            venv_python = self._get_venv_python(project_folder)
            if venv_python:
                python = venv_python
            elif python:
                venv_python = self._create_venv(project_folder)
                if venv_python:
                    python = venv_python
                else:
                    self._emit_install_progress({'type': 'stderr', 'text': '.venv creation failed.'})
                    self._emit_install_progress({'type': 'done', 'code': 1})
                    return {'code': 1}

        if not python:
            self._emit_install_progress({'type': 'stderr', 'text': 'Python 3 not found on PATH.'})
            self._emit_install_progress({'type': 'done', 'code': 1})
            return {'code': 1}

        if raw_command:
            import shlex
            parts = shlex.split(raw_command)
            if parts and parts[0] in ('pip', 'pip3'):
                cmd = [python, '-m', 'pip'] + parts[1:]
            else:
                cmd = parts
        else:
            script = str(self._installs_dir / 'install_fw.py')
            args = [fw, gpu_variant]
            if accel_version:
                args.append(accel_version)
            os_info = self._get_os_info()
            args.extend(['--os-family', os_info['os_family']])
            args.extend(['--distro', os_info['distro']])
            cmd = [python, script] + args

        self._emit_install_progress({'type': 'meta', 'text': f'python: {python}'})
        self._emit_install_progress({'type': 'meta', 'text': f'command: {" ".join(cmd)}'})

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=clean_subprocess_env()
            )

            stdout_lines: list = []
            stderr_lines: list = []

            def read_stream(stream, stream_type):
                lines = stdout_lines if stream_type == 'stdout' else stderr_lines
                for line in iter(stream.readline, ''):
                    if line:
                        lines.append(line)
                        self._emit_install_progress({'type': stream_type, 'text': line})
                stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, 'stdout'), daemon=True)
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, 'stderr'), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            proc.wait(timeout=20 * 60)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

            code = proc.returncode or 0
            stdout = ''.join(stdout_lines)
            stderr = ''.join(stderr_lines)

            # Persist install.log only for UNKNOWN failures — known errors
            # (package-not-found, externally-managed, network, ...) are already
            # explained in the UI and don't need a log file.
            if self._is_unknown_install_error(code, stdout, stderr):
                log_path = self._user_settings_path.parent / 'install.log'
                try:
                    log_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(log_path, 'a', encoding='utf-8') as log_file:
                        log_file.write(
                            f"\n===== {datetime.datetime.now().isoformat()} =====\n"
                            f"python: {python}\n"
                            f"command: {' '.join(cmd)}\n"
                        )
                        log_file.write(stdout)
                        log_file.write(stderr)
                        log_file.write(f"exit code: {code}\n")
                    self._emit_install_progress(
                        {'type': 'meta', 'text': f'full output log: {log_path}'})
                except Exception as e:
                    logger.error('install log write failed: %s', e)

            self._emit_install_progress({'type': 'done', 'code': code})
            return {'code': code, 'stdout': stdout, 'stderr': stderr}

        except subprocess.TimeoutExpired:
            proc.kill()
            self._emit_install_progress({'type': 'done', 'code': 1})
            return {'code': 1}
        except Exception as e:
            logger.error('run_install_stream error: %s', e)
            self._emit_install_progress({'type': 'done', 'code': 1})
            return {'code': 1}

    @staticmethod
    def _is_unknown_install_error(code: int, stdout: str, stderr: str) -> bool:
        """True when the install failed for an unrecognized reason.

        Mirrors the known-error patterns of components/setup/install-parser.js;
        known failures (package-not-found, externally-managed, network, disk,
        permission, conflicts, os errors) don't produce a log file.
        """
        if code == 0:
            return False
        text = ((stdout or '') + '\n' + (stderr or '')).lower()
        known = (
            'externally-managed',
            'could not find a version',
            'no matching distribution',
            'dependency conflict',
            'conflicting dependencies',
            'oserror', 'errno',
            'permission denied', 'access is denied',
            'network is unreachable', 'connection refused', 'connection timed out',
            'could not reach', 'ssl error', 'certificate verify failed',
            'no space left on device', 'disk full',
        )
        return not any(p in text for p in known)

    # ── Import test ──────────────────────────────────────────────────────────

    def run_import_test(self, fw: str, project_folder: str = None) -> dict:
        """Run import_test.py for a given framework."""
        script = str(self._installs_dir / 'import_test.py')
        python = self._get_python()

        # Use venv python if project folder has .venv
        if project_folder:
            venv_python = self._get_venv_python(project_folder)
            if venv_python:
                return self._run_script(script, [fw], timeout=60_000, python_exe=venv_python)

        return self._run_script(script, [fw], timeout=60_000)

    # ── FLOPS test ───────────────────────────────────────────────────────────

    def run_flops_test(self, batch_size: int = 1, model: str = "resnet18",
                       json_output: bool = False, project_folder: str = '',
                       install_calflops: bool = False) -> dict:
        """Run flops.py benchmark.

        Args:
            batch_size: Batch size for dummy input.
            model: Model name (resnet18, resnet50, vit_b_16).
            json_output: If True, add --json flag for machine-readable output.
            project_folder: Project folder to use its .venv python.
            install_calflops: If True, pip install calflops before running.
        """
        script = str(self._python_tests_dir / 'flops.py')
        args = ['--batch-size', str(batch_size), '--model', model]
        if json_output:
            args.append('--json')

        # Prefer the project .venv python — that's where the app installs
        # torch and calflops. In a frozen (PyInstaller) deployment neither
        # the app's bundled interpreter nor the detected system Python has
        # torch, so running the test anywhere else just fails with
        # "ERROR: PyTorch is not installed."
        python = self._get_training_python(project_folder)
        if python == sys.executable and getattr(sys, 'frozen', False):
            # Never benchmark with the bundled interpreter — no torch, and
            # pip installs into it are meaningless. Fall back to system.
            python = self._get_python()

        # Install calflops if requested (into the same python that runs the test)
        if install_calflops and python:
            try:
                proc = subprocess.Popen(
                    [python, '-m', 'pip', 'install', 'calflops'],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    env=clean_subprocess_env()
                )
                _, stderr = proc.communicate(timeout=120)
                if proc.returncode != 0:
                    logger.warning('calflops install failed: %s', stderr)
            except Exception as e:
                logger.warning('calflops install exception: %s', e)

        return self._run_script(script, args, timeout=300_000, python_exe=python)

    def export_flops_result(self, result_json: str) -> dict:
        """Export FLOPS benchmark result to a user-chosen file.

        Opens a native file-save dialog and writes the result as JSON or TXT.
        Returns {success: bool, path: str | null, error: str | null}.
        """
        try:
            # Parse the result to determine format
            try:
                data = json.loads(result_json)
                is_json = True
            except (json.JSONDecodeError, TypeError):
                data = {"raw": result_json}
                is_json = False

            # Open native file-save dialog
            if sys.platform == 'darwin':
                # On macOS, use osascript for native dialog
                from urllib.parse import quote
                safe_name = quote(f"flops_benchmark_{data.get('model', 'resnet18')}_{int(time.time())}", safe='')
                script_cmd = (
                    f'set defaultName to "{safe_name}.json" if {"true" if is_json else "false"} '
                    f'else "flops_benchmark_{int(time.time())}.txt"\n'
                    'set outputFile to choose file name with prompt "Save FLOPS Benchmark Result" '
                    f'default name defaultName\n'
                    'return POSIX path of outputFile'
                )
                result = subprocess.run(
                    ['osascript', '-e', script_cmd],
                    capture_output=True, text=True, timeout=120,
                    env=clean_subprocess_env()
                )
                if result.returncode != 0:
                    # User cancelled
                    return {'success': False, 'path': None, 'error': None}
                save_path = result.stdout.strip()
            else:
                # On other platforms, save to a default location
                from pathlib import Path
                save_dir = Path.home() / 'Desktop'
                save_dir.mkdir(parents=True, exist_ok=True)
                ext = '.json' if is_json else '.txt'
                save_path = str(save_dir / f"flops_benchmark_{data.get('model', 'resnet18')}_{int(time.time())}{ext}")

            # Write the file
            content = result_json if is_json else result_json
            Path(save_path).write_text(content, 'utf-8')
            logger.info('FLOPS result exported to %s', save_path)
            return {'success': True, 'path': save_path, 'error': None}

        except Exception as e:
            logger.error('export_flops_result failed: %s', e)
            return {'success': False, 'path': None, 'error': str(e)}
