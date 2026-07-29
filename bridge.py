#!/usr/bin/env python3
"""
bridge.py — PyWebView JS API bridge for mama
Replaces Electron's ipc-handlers.js, settings-store.js, project-store.js, etc.
All methods are callable from the frontend via window.pywebview.api.*
"""

import os
import sys
import json
import re
import subprocess
import shutil
import threading
import logging
import time
from pathlib import Path
from typing import Optional, Any

logger = logging.getLogger('mama.bridge')


class MamaApi:
    """Python backend exposed to the frontend via pywebview JS bridge."""

    def __init__(self, user_settings_path: str, base_dir: str, server_port: int = 0):
        self._user_settings_path = Path(user_settings_path)
        self._base_dir = Path(base_dir)
        self._window = None
        self._server_port = server_port

        # Thread-safe emit queue: background threads push, main thread flushes
        self._emit_queue: list = []
        self._emit_lock = threading.Lock()
        self._emit_timer: Optional[threading.Timer] = None

        # Template paths
        self._template_dir = self._base_dir / 'user' / 'template'
        self._descriptions_path = self._template_dir / 'descriptions.json'
        self._recents_path = self._base_dir / 'components' / 'recents.json'

        # Script paths
        self._script_dir = self._base_dir / 'components' / 'backend'
        self._system_detect_dir = self._script_dir / 'systemDetect'
        self._installs_dir = self._script_dir / 'installs'
        self._python_tests_dir = self._base_dir / 'components' / 'python' / 'tests'

        # Cached Python executable
        self._python_exe: Optional[str] = None

        # Settings backup path
        self._settings_backup_path = self._user_settings_path.with_suffix('.json.bak')

    def set_window(self, window):
        """Give the API a reference to the pywebview window for evaluate_js."""
        self._window = window
        # Start periodic emit queue flusher on the main thread
        try:
            self._emit_timer = threading.Timer(0.1, self.on_emit_tick)
            self._emit_timer.daemon = True
            self._emit_timer.start()
        except Exception:
            pass

    def on_quit(self):
        """Persist recents and terminate training if running."""
        try:
            # Kill training process if still running
            if self._training_process and self._training_process.poll() is None:
                try:
                    self._training_process.terminate()
                    self._training_process.wait(timeout=10)
                except Exception:
                    try:
                        self._training_process.kill()
                    except Exception:
                        pass
                self._training_process = None
            self._training_output_dir = None

            recents = self._read_recents() or {}
            open_path = recents.get('open')
            if open_path:
                recent_list = recents.get('recent', [])
                if open_path not in recent_list:
                    recent_list.insert(0, open_path)
                recents['recent'] = recent_list[:10]
            self._write_recents(recents)
        except Exception as e:
            logger.error('on_quit recents save failed: %s', e)

    # ═══════════════════════════════════════════════════════════════════════
    # Python executable resolution
    # ═══════════════════════════════════════════════════════════════════════

    def _find_python(self) -> Optional[str]:
        """Find a working Python 3 interpreter."""
        candidates = ['python3', 'python']
        if sys.platform == 'win32':
            candidates = ['python', 'py', 'python3']

        for cmd in candidates:
            try:
                result = subprocess.run(
                    [cmd, '--version'],
                    capture_output=True, text=True, timeout=5
                )
                if 'Python 3' in result.stdout or 'Python 3' in result.stderr:
                    return cmd
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue
        return None

    def _get_python(self) -> Optional[str]:
        """Get cached Python executable."""
        if self._python_exe is None:
            self._python_exe = self._find_python()
        return self._python_exe

    def _get_training_python(self, project_folder: str = None) -> Optional[str]:
        """Python for training subprocesses — prefers project .venv, then app interpreter."""
        if not project_folder:
            recents = self._read_recents() or {}
            project_folder = recents.get('open')
        if project_folder:
            venv_python = self._get_venv_python(project_folder)
            if venv_python:
                return venv_python
        if sys.executable:
            return sys.executable
        return self._get_python()

    # ═══════════════════════════════════════════════════════════════════════
    # Script runner
    # ═══════════════════════════════════════════════════════════════════════

    def _run_script(self, script_path: str, args: list = None,
                    timeout: int = 120_000, python_exe: str = None) -> dict:
        """Run a Python script and return {code, stdout, stderr}."""
        if args is None:
            args = []
        python = python_exe or self._get_python()
        if not python:
            return {'code': 1, 'stdout': '', 'stderr': 'Python 3 not found on PATH.'}

        try:
            proc = subprocess.Popen(
                [python, script_path] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ},
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            stdout, stderr = proc.communicate(timeout=timeout / 1000.0)
            return {
                'code': proc.returncode or 0,
                'stdout': stdout or '',
                'stderr': stderr or ''
            }
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            return {
                'code': 1,
                'stdout': stdout or '',
                'stderr': (stderr or '') + '\nProcess timed out.'
            }
        except FileNotFoundError as e:
            return {'code': 1, 'stdout': '', 'stderr': str(e)}
        except Exception as e:
            logger.error('run_script error: %s', e)
            return {'code': 1, 'stdout': '', 'stderr': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # OS info helper
    # ═══════════════════════════════════════════════════════════════════════

    def _get_os_info(self) -> dict:
        """Quick OS detection for install script."""
        if sys.platform == 'win32':
            return {'os_family': 'windows', 'distro': 'unknown'}
        elif sys.platform == 'darwin':
            distro = 'unknown'
            try:
                subprocess.run(['which', 'brew'], capture_output=True, timeout=5)
                distro = 'homebrew'
            except Exception:
                pass
            return {'os_family': 'macos', 'distro': distro}
        elif sys.platform == 'linux':
            os_family = 'linux'
            distro = 'unknown'
            try:
                content = Path('/etc/os-release').read_text().lower()
                if 'ubuntu' in content or 'debian' in content:
                    distro = 'debian-based'
                elif 'fedora' in content or 'rhel' in content or 'centos' in content:
                    distro = 'fedora-based'
                elif 'arch' in content or 'manjaro' in content:
                    distro = 'arch-based'
                elif 'opensuse' in content or 'suse' in content:
                    distro = 'suse-based'
                elif 'alpine' in content:
                    distro = 'alpine'
            except Exception:
                pass
            return {'os_family': os_family, 'distro': distro}
        return {'os_family': 'unknown', 'distro': 'unknown'}

    # ═══════════════════════════════════════════════════════════════════════
    # Settings
    # ═══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _strip_json_comments(text: str) -> str:
        """Strip //-style comments from JSON text, handling strings properly."""
        result = []
        i = 0
        in_string = False
        string_char = None
        while i < len(text):
            c = text[i]
            if in_string:
                result.append(c)
                if c == '\\':
                    i += 1
                    if i < len(text):
                        result.append(text[i])
                elif c == string_char:
                    in_string = False
            elif c in ('"', "'"):
                in_string = True
                string_char = c
                result.append(c)
            elif c == '/' and i + 1 < len(text) and text[i+1] == '/':
                while i < len(text) and text[i] != '\n':
                    i += 1
                continue
            else:
                result.append(c)
            i += 1
        return ''.join(result)

    def _ensure_settings(self):
        """Seed user settings from backup or template if they don't exist."""
        if not self._user_settings_path.exists():
            self._user_settings_path.parent.mkdir(parents=True, exist_ok=True)
            if self._settings_backup_path.exists():
                logger.info('settings.json missing, restoring from backup')
                shutil.copy2(self._settings_backup_path, self._user_settings_path)
            elif self._template_dir.exists():
                template = self._template_dir / 'settings.json'
                if template.exists():
                    logger.info('settings.json and backup missing, creating from template')
                    raw = self._strip_json_comments(template.read_text('utf-8'))
                    self._user_settings_path.write_text(raw, 'utf-8')

    def _read_settings_raw(self) -> Optional[dict]:
        """Read settings JSON file."""
        self._ensure_settings()
        if not self._user_settings_path.exists():
            return None
        try:
            return json.loads(self._user_settings_path.read_text('utf-8'))
        except Exception as e:
            logger.error('Failed to read settings: %s', e)
            return None

    def _write_settings(self, settings: dict, backup: bool = True):
        """Write settings JSON file with optional backup."""
        if backup and self._user_settings_path.exists():
            try:
                self._settings_backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(self._user_settings_path, self._settings_backup_path)
            except Exception as e:
                logger.warning('Settings backup failed: %s', e)

        self._user_settings_path.parent.mkdir(parents=True, exist_ok=True)
        self._user_settings_path.write_text(
            json.dumps(settings, indent=4), 'utf-8'
        )

    def settings_read(self) -> Optional[dict]:
        return self._read_settings_raw()

    def settings_descriptions_read(self) -> Optional[dict]:
        if self._descriptions_path.exists():
            try:
                return json.loads(self._descriptions_path.read_text('utf-8'))
            except Exception:
                pass
        return None

    def settings_write(self, settings: dict) -> bool:
        try:
            self._write_settings(settings, backup=True)
            return True
        except Exception as e:
            logger.error('settings_write failed: %s', e)
            return False

    def settings_write_nonbackup(self, settings: dict) -> bool:
        try:
            self._write_settings(settings, backup=False)
            return True
        except Exception as e:
            logger.error('settings_write_nonbackup failed: %s', e)
            return False

    def settings_write_with_backup(self, settings: dict) -> bool:
        try:
            self._write_settings(settings, backup=True)
            return True
        except Exception as e:
            logger.error('settings_write_with_backup failed: %s', e)
            return False

    def settings_reset(self) -> Optional[dict]:
        """Reset settings to template, backing up current first."""
        try:
            if self._user_settings_path.exists():
                shutil.copy2(self._user_settings_path, self._settings_backup_path)

            template = self._template_dir / 'settings.json'
            if template.exists():
                data = json.loads(template.read_text('utf-8'))
                self._user_settings_path.write_text(
                    json.dumps(data, indent=4), 'utf-8'
                )
                return data
        except Exception as e:
            logger.error('settings_reset failed: %s', e)
        return None

    def settings_backup_exists(self) -> bool:
        return self._settings_backup_path.exists()

    def settings_restore_backup(self) -> Optional[dict]:
        if not self._settings_backup_path.exists():
            return None
        try:
            shutil.copy2(self._settings_backup_path, self._user_settings_path)
            return json.loads(self._user_settings_path.read_text('utf-8'))
        except Exception as e:
            logger.error('settings_restore_backup failed: %s', e)
            return None

    def settings_setup_complete(self) -> bool:
        """Mark setup as done and navigate to main page."""
        try:
            settings = self._read_settings_raw() or {}
            if 'general settings' not in settings:
                settings['general settings'] = {}
            settings['general settings']['setup'] = False
            self._write_settings(settings, backup=False)
            return True
        except Exception as e:
            logger.error('settings_setup_complete failed: %s', e)
            return False

    def setup_complete(self) -> bool:
        """Alias for settings_setup_complete, called from setup wizard."""
        return self.settings_setup_complete()

    # ═══════════════════════════════════════════════════════════════════════
    # Navigation
    # ═══════════════════════════════════════════════════════════════════════

    def navigate_to(self, page: str) -> None:
        """Navigate the pywebview window to a different page.
        page is a relative path like 'public/settings.html' or a full URL.
        Returns None to avoid pywebview callback issues when page navigates away.
        """
        if self._window:
            if not page.startswith('http://') and not page.startswith('https://') and not page.startswith('file://'):
                clean_page = page.lstrip('./')
                url = f'http://127.0.0.1:{self._server_port}/{clean_page}'
            else:
                url = page
            self._window.load_url(url)

    def resolve_public_url(self, filename: str, query: dict = None) -> str:
        """Resolve a public file URL."""
        if query:
            qs = '&'.join(f'{k}={v}' for k, v in query.items())
            return f'{filename}?{qs}'
        return filename

    # ═══════════════════════════════════════════════════════════════════════
    # Torch commands
    # ═══════════════════════════════════════════════════════════════════════

    def torch_commands_read(self) -> dict:
        torch_path = self._base_dir / 'components' / 'setup' / 'torchCommands.json'
        if torch_path.exists():
            try:
                return json.loads(torch_path.read_text('utf-8'))
            except Exception:
                pass
        return {}

    # ═══════════════════════════════════════════════════════════════════════
    # System Detection
    # ═══════════════════════════════════════════════════════════════════════

    def run_os_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_os.py')
        return self._run_script(script, timeout=15_000)

    def run_python_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_python.py')
        return self._run_script(script, timeout=15_000)

    def run_gpu_detect(self) -> dict:
        script = str(self._system_detect_dir / 'detect_gpu' / '__init__.py')
        return self._run_script(script, timeout=90_000)

    def run_compatibility_check(self, params: dict) -> dict:
        script = str(self._system_detect_dir / 'check_compatibility.py')
        args = [
            '--os-family', params.get('osFamily', ''),
            '--os-version', params.get('osVersion', ''),
            '--arch', params.get('arch', ''),
            '--gpu-mfr', params.get('gpuMfr', ''),
            '--gpu-name', params.get('gpuName', ''),
            '--gpu-vram-mb', str(params.get('gpuVramMB', '')),
            '--cuda-ver', params.get('cudaVer', ''),
            '--rocm-ver', params.get('rocmVer', ''),
            '--metal-ver', params.get('metalVer', ''),
            '--mps-avail', params.get('mpsAvail', ''),
            '--python-ver', params.get('pythonVer', ''),
        ]
        return self._run_script(script, args, timeout=30_000)

    # ═══════════════════════════════════════════════════════════════════════
    # System commands (generic)
    # ═══════════════════════════════════════════════════════════════════════

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
                env={**os.environ}
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

    # ═══════════════════════════════════════════════════════════════════════
    # Python commands (legacy)
    # ═══════════════════════════════════════════════════════════════════════

    def run_python_command(self, action: str) -> dict:
        """Run a generic Python command (legacy compatibility)."""
        script = str(self._python_tests_dir / 'pytorch_test.py')
        return self._run_script(script)

    # ═══════════════════════════════════════════════════════════════════════
    # Install framework
    # ═══════════════════════════════════════════════════════════════════════

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

    def _get_venv_python(self, project_folder: str) -> Optional[str]:
        """Get path to venv python if it exists."""
        if not project_folder:
            return None
        venv_path = Path(project_folder) / '.venv'
        if sys.platform == 'win32':
            venv_python = venv_path / 'Scripts' / 'python.exe'
        else:
            venv_python = venv_path / 'bin' / 'python3'

        if venv_python.exists():
            return str(venv_python)
        return None

    def _create_venv(self, project_folder: str) -> Optional[str]:
        """Create a .venv in the project folder and return the python path."""
        python = self._get_python()
        if not python:
            return None

        venv_path = Path(project_folder) / '.venv'
        try:
            proc = subprocess.Popen(
                [python, '-m', 'venv', str(venv_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ},
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

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ}
            )

            def read_stream(stream, stream_type):
                for line in iter(stream.readline, ''):
                    if line:
                        self._emit_install_progress({'type': stream_type, 'text': line})
                stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, 'stdout'), daemon=True)
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, 'stderr'), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            proc.wait(timeout=20 * 60)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

            self._emit_install_progress({'type': 'done', 'code': proc.returncode or 0})
            return {'code': proc.returncode or 0}

        except subprocess.TimeoutExpired:
            proc.kill()
            self._emit_install_progress({'type': 'done', 'code': 1})
            return {'code': 1}
        except Exception as e:
            logger.error('run_install_stream error: %s', e)
            self._emit_install_progress({'type': 'done', 'code': 1})
            return {'code': 1}

    # ── Thread-safe emit queue ──────────────────────────────────────────────

    def _enqueue_emit(self, callback_name: str, chunk: dict):
        """Push a message to the emit queue; flushed from the main thread."""
        with self._emit_lock:
            self._emit_queue.append((callback_name, chunk))
        # Try to flush immediately if on the main thread, otherwise schedule
        if self._window:
            try:
                import threading as _th
                if _th.current_thread() is _th.main_thread():
                    self._flush_emit_queue()
            except Exception:
                pass

    def _flush_emit_queue(self):
        """Flush all pending emits via evaluate_js (must be called from main thread)."""
        if not self._window:
            return
        with self._emit_lock:
            items = list(self._emit_queue)
            self._emit_queue.clear()
        for callback_name, chunk in items:
            js = (
                f"(function(){{"
                f"var el=window.electron;"
                f"if(el&&el._dispatchIpc)el._dispatchIpc({json.dumps(callback_name)},{json.dumps(chunk)});"
                f"}})();"
            )
            try:
                self._window.evaluate_js(js)
            except Exception as e:
                logger.debug('emit %s failed: %s', callback_name, e)

    def on_emit_tick(self):
        """Periodic tick called from pywebview to flush emits.
        Called from the main thread by a recurring timer.
        """
        self._flush_emit_queue()
        # Re-schedule
        try:
            self._emit_timer = threading.Timer(0.1, self.on_emit_tick)
            self._emit_timer.daemon = True
            self._emit_timer.start()
        except Exception:
            pass

    def _emit_install_progress(self, chunk: dict):
        """Emit install progress to the frontend."""
        self._enqueue_emit('_installProgressCallback', chunk)

    # ═══════════════════════════════════════════════════════════════════════
    # Import test
    # ═══════════════════════════════════════════════════════════════════════

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

    # ═══════════════════════════════════════════════════════════════════════
    # FLOPS test
    # ═══════════════════════════════════════════════════════════════════════

    def run_flops_test(self, batch_size: int = 1, model: str = "resnet18",
                       json_output: bool = False) -> dict:
        """Run flops.py benchmark.

        Args:
            batch_size: Batch size for dummy input.
            model: Model name (resnet18, resnet50, vit_b_16).
            json_output: If True, add --json flag for machine-readable output.
        """
        script = str(self._python_tests_dir / 'flops.py')
        args = ['--batch-size', str(batch_size), '--model', model]
        if json_output:
            args.append('--json')
        return self._run_script(script, args, timeout=300_000)

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
                    capture_output=True, text=True, timeout=120
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

    # ═══════════════════════════════════════════════════════════════════════
    # Themes
    # ═══════════════════════════════════════════════════════════════════════

    def themes_read(self) -> list:
        """Read custom themes from user/themes/ directory."""
        themes_dir = self._base_dir / 'user' / 'themes'
        themes = []
        if themes_dir.exists():
            for f in sorted(themes_dir.iterdir()):
                if f.suffix == '.json':
                    try:
                        themes.append(json.loads(f.read_text('utf-8')))
                    except Exception as e:
                        logger.warning('Failed to read theme %s: %s', f.name, e)
        return themes

    def themes_write(self, theme: dict) -> bool:
        """Write a custom theme to user/themes/.

        Handles name collisions by appending a numeric suffix if the existing
        file has a different theme name property.
        """
        try:
            themes_dir = self._base_dir / 'user' / 'themes'
            themes_dir.mkdir(parents=True, exist_ok=True)

            # Build a safe filename from the name
            safe_name = theme.get('name', 'custom').lower()
            safe_name = re.sub(r'[^a-z0-9-]', '-', safe_name)
            safe_name = re.sub(r'-+', '-', safe_name).strip('-')
            if not safe_name:
                safe_name = 'custom-theme'

            file_path = themes_dir / f'{safe_name}.json'

            # Handle name collision: if file exists with a different theme name, append suffix
            if file_path.exists():
                try:
                    existing = json.loads(file_path.read_text('utf-8'))
                    if existing.get('name') and existing['name'] != theme.get('name'):
                        counter = 2
                        while True:
                            suffixed_name = f'{safe_name}-{counter}'
                            alt_path = themes_dir / f'{suffixed_name}.json'
                            if not alt_path.exists():
                                file_path = alt_path
                                break
                            counter += 1
                except Exception:
                    # If existing file is corrupt, overwrite it
                    pass

            file_path.write_text(json.dumps(theme, indent=4), 'utf-8')
            return True
        except Exception as e:
            logger.error('themes_write failed: %s', e)
            return False

    # ═══════════════════════════════════════════════════════════════════════
    # Project / folder explorer
    # ═══════════════════════════════════════════════════════════════════════

    def _ensure_recents(self):
        """Seed recents from template if not exists."""
        if not self._recents_path.exists():
            template_recents = self._template_dir / 'recents.json'
            if template_recents.exists():
                self._recents_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(template_recents, self._recents_path)

    def _read_recents(self) -> Optional[dict]:
        self._ensure_recents()
        if not self._recents_path.exists():
            return None
        try:
            return json.loads(self._recents_path.read_text('utf-8'))
        except Exception:
            return None

    def _write_recents(self, recents: dict):
        self._recents_path.parent.mkdir(parents=True, exist_ok=True)
        self._recents_path.write_text(json.dumps(recents, indent=4), 'utf-8')

    def project_recents_read(self) -> Optional[dict]:
        return self._read_recents()

    def project_recents_write(self, data: dict) -> dict:
        """Merge data into recents.json and return the updated recents dict."""
        recents = self._read_recents() or {}
        recents.update(data)
        self._write_recents(recents)
        return recents

    def project_pick_folder(self) -> Optional[str]:
        """Open a native folder picker dialog."""
        try:
            if sys.platform == 'darwin':
                result = subprocess.run(
                    ['osascript', '-e', 'return POSIX path of (choose folder with prompt "Select Project Folder")'],
                    capture_output=True, text=True, timeout=120
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            else:
                if not self._window:
                    return None
                import webview
                result = self._window.create_file_dialog(
                    webview.FOLDER_DIALOG
                )
                if result and len(result) > 0:
                    return result[0]
        except Exception as e:
            logger.error('Folder picker failed: %s', e)
        return None

    def project_open_folder(self, folder_path: str) -> Optional[dict]:
        """Open a project folder: update recents, then return folder listing."""
        try:
            if not folder_path:
                return None
            folder = Path(folder_path)
            if not folder.exists():
                return None

            recents = self._read_recents() or {}
            recents['open'] = folder_path

            # Add to recent list
            recent_list = recents.get('recent', [])
            if folder_path in recent_list:
                recent_list.remove(folder_path)
            recent_list.insert(0, folder_path)
            recents['recent'] = recent_list[:10]  # Keep last 10

            self._write_recents(recents)
            return self.project_list_folder(folder_path)
        except Exception as e:
            logger.error('project_open_folder failed: %s', e)
            return None

    def project_list_folder(self, folder_path: str) -> Optional[dict]:
        """List contents of a directory."""
        try:
            if not folder_path:
                return None
            folder = Path(folder_path)
            if not folder.exists():
                return None

            entries = []
            for item in sorted(folder.iterdir()):
                entries.append({
                    'name': item.name,
                    'path': str(item),
                    'isDirectory': item.is_dir(),
                    'size': item.stat().st_size if item.is_file() else 0,
                })
            return {'path': folder_path, 'entries': entries}
        except Exception as e:
            logger.error('project_list_folder failed: %s', e)
            return None

    def project_reveal_folder(self, folder_path: str) -> bool:
        """Open folder in file manager."""
        try:
            if not folder_path:
                return False
            folder = Path(folder_path)
            if not folder.exists():
                return False

            if sys.platform == 'darwin':
                subprocess.Popen(['open', str(folder)])
            elif sys.platform == 'win32':
                subprocess.Popen(['explorer', str(folder)])
            else:
                subprocess.Popen(['xdg-open', str(folder)])
            return True
        except Exception as e:
            logger.error('project_reveal_folder failed: %s', e)
            return False

    def project_templates_read(self) -> dict:
        """Read project templates from components/templates.json."""
        try:
            from components.backend.template_download.template_download import read_templates
            return read_templates()
        except Exception:
            pass
        templates_path = self._base_dir / 'components' / 'templates.json'
        if templates_path.exists():
            try:
                return json.loads(templates_path.read_text('utf-8'))
            except Exception:
                pass
        return {}

    def project_import_template(self, template_key: str) -> dict:
        """Import a template (download/extract)."""
        try:
            from components.backend.template_download.template_download import import_template
            return import_template(template_key)
        except Exception as e:
            logger.error('project_import_template failed: %s', e)
            return {'success': False, 'error': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # Project init
    # ═══════════════════════════════════════════════════════════════════════

    def project_init(self, folder_path: str) -> dict:
        """Check if a folder has project.json and .venv."""
        try:
            if not folder_path:
                return {'hasProjectJson': False, 'hasVenv': False}
            folder = Path(folder_path)
            return {
                'hasProjectJson': (folder / 'project.json').exists(),
                'hasVenv': (folder / '.venv').exists() and (folder / '.venv').is_dir(),
            }
        except Exception as e:
            logger.error('project_init failed: %s', e)
            return {'hasProjectJson': False, 'hasVenv': False}

    def project_json_read(self, folder_path: str) -> Optional[dict]:
        """Read project.json from a folder. Returns None if not found or invalid."""
        try:
            if not folder_path:
                return None
            path = Path(folder_path) / 'project.json'
            if not path.exists():
                return None
            return json.loads(path.read_text('utf-8'))
        except Exception as e:
            logger.error('project_json_read failed: %s', e)
            return None

    def project_json_write(self, folder_path: str, data: dict) -> dict:
        """Write project.json to a folder. Returns {success: bool, error: str}."""
        try:
            if not folder_path:
                return {'success': False, 'error': 'No folder path provided.'}
            path = Path(folder_path) / 'project.json'
            path.write_text(json.dumps(data, indent=2), 'utf-8')
            return {'success': True}
        except Exception as e:
            logger.error('project_json_write failed: %s', e)
            return {'success': False, 'error': str(e)}

    def project_create_json(self, folder_path: str) -> dict:
        """Create a project.json file in the given folder."""
        try:
            if not folder_path:
                return {'success': False, 'error': 'No folder path provided.'}
            folder = Path(folder_path)
            project_json_path = folder / 'project.json'
            if project_json_path.exists():
                return {'success': True, 'message': 'project.json already exists.'}

            project_json = {
                'name': folder.name,
                'version': '0.1.0',
                'description': '',
                'framework': None,
                'created': time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()),
                'multimodel_mode': False,
                'difficulty': 'easy',
            }
            project_json_path.write_text(json.dumps(project_json, indent=2), 'utf-8')
            return {'success': True, 'message': 'project.json created.'}
        except Exception as e:
            logger.error('project_create_json failed: %s', e)
            return {'success': False, 'error': str(e)}

    def project_create_venv(self, folder_path: str) -> dict:
        """Create a .venv in the given folder."""
        try:
            if not folder_path:
                return {'success': False, 'error': 'No folder path provided.'}
            folder = Path(folder_path)
            venv_path = folder / '.venv'
            if venv_path.exists():
                return {'success': True, 'message': '.venv already exists.'}

            python = self._get_python()
            if not python:
                return {'success': False, 'error': 'Python 3 not found on PATH.'}

            proc = subprocess.Popen(
                [python, '-m', 'venv', str(venv_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ},
                cwd=folder_path
            )
            _, stderr = proc.communicate(timeout=60)
            if proc.returncode == 0:
                return {'success': True, 'message': '.venv created.'}
            return {'success': False, 'error': stderr or 'Failed to create .venv.'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Timed out creating .venv.'}
        except Exception as e:
            logger.error('project_create_venv failed: %s', e)
            return {'success': False, 'error': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # Training (Fine-Tuning)
    # ═══════════════════════════════════════════════════════════════════════

    _training_process: Optional[subprocess.Popen] = None
    _training_thread: Optional[threading.Thread] = None
    _training_output_dir: Optional[str] = None

    def _emit_training_progress(self, chunk: dict):
        self._enqueue_emit('_trainingProgressCallback', chunk)

    def train_start(self, config_json: str) -> dict:
        """Start a training run from a JSON config string.
        Streams stdout via IPC callback. Installs missing deps first.
        """
        try:
            cfg = json.loads(config_json)
        except json.JSONDecodeError as e:
            return {'success': False, 'error': f'Invalid config JSON: {e}'}

        output_dir = cfg.get('output_dir', '')
        self._training_output_dir = output_dir
        if not output_dir:
            return {'success': False, 'error': 'output_dir is required in config'}

        # Write config to output dir
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Clean stale control markers from previous runs
        for marker in ['.cancel', '.pause']:
            (output_path / marker).unlink(missing_ok=True)

        config_path = output_path / 'training_config.json'
        config_path.write_text(json.dumps(cfg, indent=2), 'utf-8')

        project_folder = None
        recents = self._read_recents() or {}
        if recents.get('open'):
            project_folder = recents['open']
        elif output_dir:
            parent = Path(output_dir).parent
            if (parent / 'project.json').exists():
                project_folder = str(parent)

        python = self._get_training_python(project_folder)
        if not python:
            return {'success': False, 'error': 'Python 3 not found on PATH.'}

        # ── Step 1: Install dependencies (no torch/tf) ─────────────────
        self._enqueue_emit('_trainingProgressCallback', {
            'type': 'install_status', 'stage': 'install',
            'message': 'Checking and installing dependencies...',
        })

        install_script = str(self._base_dir / 'components' / 'backend' / 'training' / 'install_deps.py')
        install_success = False
        install_error = ''
        try:
            install_proc = subprocess.Popen(
                [python, install_script],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(install_proc.stdout.readline, ''):
                if line:
                    try:
                        data = json.loads(line)
                        data['_stream'] = 'install'
                        if data.get('type') == 'install_done':
                            install_success = bool(data.get('success'))
                            install_error = data.get('error', '')
                        self._enqueue_emit('_trainingProgressCallback', data)
                    except json.JSONDecodeError:
                        self._enqueue_emit('_trainingProgressCallback', {
                            'type': 'install_log', 'text': line.strip(), '_stream': 'install',
                        })
            install_proc.wait()
        except Exception as e:
            logger.error('install_deps failed: %s', e)
            return {'success': False, 'error': f'Dependency installation error: {e}'}

        if install_proc.returncode != 0 or not install_success:
            return {
                'success': False,
                'error': install_error or 'Dependency installation failed. Check the Training Monitor for details.',
            }

        # ── Step 2: Launch training subprocess ────────────────────────
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'train.py')

        try:
            proc = subprocess.Popen(
                [python, script, '--config', str(config_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ},
            )
            self._training_process = proc

            def read_stream(stream, stream_type):
                for line in iter(stream.readline, ''):
                    if line:
                        try:
                            data = json.loads(line)
                            data['_stream'] = stream_type
                            self._enqueue_emit('_trainingProgressCallback', data)
                        except json.JSONDecodeError:
                            self._enqueue_emit('_trainingProgressCallback', {
                                'type': stream_type,
                                'text': line,
                                '_stream': stream_type,
                            })
                stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, 'stdout'), daemon=True)
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, 'stderr'), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            def wait_thread():
                proc.wait()
                stdout_thread.join(timeout=5)
                stderr_thread.join(timeout=5)
                self._enqueue_emit('_trainingProgressCallback', {'type': 'done', 'code': proc.returncode or 0})
                self._training_process = None

            self._training_thread = threading.Thread(target=wait_thread, daemon=True)
            self._training_thread.start()

            return {'success': True, 'config_path': str(config_path)}
        except Exception as e:
            logger.error('train_start failed: %s', e)
            return {'success': False, 'error': str(e)}

    def train_pause(self, output_dir: str) -> dict:
        """Pause training by creating .pause file."""
        try:
            pause_file = Path(output_dir) / '.pause'
            pause_file.write_text('pause', 'utf-8')
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def train_resume(self, output_dir: str) -> dict:
        """Resume training by removing .pause file."""
        try:
            pause_file = Path(output_dir) / '.pause'
            if pause_file.exists():
                pause_file.unlink()
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def train_cancel(self, output_dir: str) -> dict:
        """Cancel training by creating .cancel file."""
        try:
            cancel_file = Path(output_dir) / '.cancel'
            cancel_file.write_text('cancel', 'utf-8')
            # Also kill process if running
            if self._training_process:
                self._training_process.terminate()
                self._training_process = None
            if self._training_output_dir == output_dir:
                self._training_output_dir = None
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def train_status(self, output_dir: str) -> dict:
        """Check training status in output directory."""
        try:
            out = Path(output_dir)
            return {
                'running': self._training_process is not None and self._training_process.poll() is None,
                'has_checkpoint': len(list(out.glob('checkpoint-*'))) > 0,
                'has_config': (out / 'training_config.json').exists(),
                'is_paused': (out / '.pause').exists(),
                'is_cancelled': (out / '.cancel').exists(),
            }
        except Exception as e:
            return {'running': False, 'error': str(e)}

    def train_read_config(self, output_dir: str) -> dict:
        """Read training config from output directory."""
        try:
            out = Path(output_dir)
            config_path = out / 'training_config.json'
            if config_path.exists():
                return {'success': True, 'config': json.loads(config_path.read_text('utf-8'))}
            return {'success': False, 'error': 'No training config found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def train_list_checkpoints(self, output_dir: str) -> list:
        """List checkpoints in output directory."""
        try:
            out = Path(output_dir)
            checkpoints = sorted(out.glob('checkpoint-*'), key=lambda p: int(p.name.split('-')[-1]))
            result = []
            for cp in checkpoints:
                trainer_state = cp / 'trainer_state.json'
                metrics = {}
                if trainer_state.exists():
                    try:
                        state = json.loads(trainer_state.read_text('utf-8'))
                        log_history = state.get('log_history', [])
                        if log_history:
                            last = log_history[-1]
                            metrics = {
                                'step': last.get('step', 0),
                                'loss': last.get('loss', None),
                                'epoch': last.get('epoch', None),
                            }
                    except Exception:
                        pass
                result.append({
                    'path': str(cp),
                    'step': int(cp.name.split('-')[-1]),
                    'size_bytes': sum(f.stat().st_size for f in cp.rglob('*') if f.is_file()),
                    **metrics,
                })
            return result
        except Exception as e:
            logger.error('train_list_checkpoints failed: %s', e)
            return []

    def train_get_active(self) -> dict:
        """Get info about any currently active (or recently completed) training."""
        if not self._training_output_dir:
            return {'active': False}

        out = Path(self._training_output_dir)
        running = self._training_process is not None and self._training_process.poll() is None
        has_config = (out / 'training_config.json').exists()
        is_paused = (out / '.pause').exists()

        result = {
            'active': running or has_config,
            'running': running,
            'paused': is_paused,
            'output_dir': self._training_output_dir,
            'has_config': has_config,
            'is_cancelled': (out / '.cancel').exists(),
            'has_checkpoint': len(list(out.glob('checkpoint-*'))) > 0,
        }

        checkpoints = self.train_list_checkpoints(self._training_output_dir)
        if checkpoints:
            result['latest_checkpoint'] = checkpoints[-1]
        result['checkpoints'] = checkpoints

        return result

    # ═══════════════════════════════════════════════════════════════════════
    # Model Management (Download / List / Check)
    # ═══════════════════════════════════════════════════════════════════════

    _model_download_process: Optional[subprocess.Popen] = None

    def _emit_model_progress(self, chunk: dict):
        self._enqueue_emit('_modelProgressCallback', chunk)

    def model_download(self, model_id: str, output_dir: str = '', revision: str = 'main') -> dict:
        """Download a model from HF Hub with progress streaming."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'model_download.py')
        models_dir = output_dir or str(self._base_dir / 'models')
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found on PATH.'}

        try:
            proc = subprocess.Popen(
                [python, script, '--model-id', model_id, '--output', models_dir, '--revision', revision],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ},
            )
            self._model_download_process = proc

            def read_stream(stream, stream_type):
                for line in iter(stream.readline, ''):
                    if line:
                        try:
                            data = json.loads(line)
                            data['_stream'] = stream_type
                            self._emit_model_progress(data)
                        except json.JSONDecodeError:
                            self._emit_model_progress({'type': stream_type, 'text': line, '_stream': stream_type})
                stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, 'stdout'), daemon=True)
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, 'stderr'), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            def wait_thread():
                proc.wait()
                stdout_thread.join(timeout=5)
                stderr_thread.join(timeout=5)
                self._emit_model_progress({'type': 'done', 'code': proc.returncode or 0})
                self._model_download_process = None

            threading.Thread(target=wait_thread, daemon=True).start()
            return {'success': True}
        except Exception as e:
            logger.error('model_download failed: %s', e)
            return {'success': False, 'error': str(e)}

    def model_download_cancel(self) -> dict:
        """Cancel an active model download."""
        if self._model_download_process:
            self._model_download_process.terminate()
            self._model_download_process = None
        return {'success': True}

    def model_list(self, models_dir: str = '') -> list:
        """List locally downloaded models."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'model_download.py')
        models_dir = models_dir or str(self._base_dir / 'models')
        python = self._get_training_python()
        if not python:
            return []
        result = self._run_script(script, ['--list', '--output', models_dir], timeout=30_000, python_exe=python)
        if result['code'] == 0 and result['stdout']:
            try:
                # Parse last JSON line
                for line in reversed(result['stdout'].strip().split('\n')):
                    if line.startswith('{'):
                        data = json.loads(line)
                        if data.get('type') == 'model_list':
                            return data.get('models', [])
            except Exception:
                pass
        return []

    def model_check_compatibility(self, model_id: str) -> dict:
        """Check model compatibility for fine-tuning."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'model_download.py')
        python = self._get_training_python()
        if not python:
            return {'compatible': False, 'error': 'Python 3 not found'}
        result = self._run_script(script, ['--check', '--model-id', model_id], timeout=60_000, python_exe=python)
        if result['code'] == 0 and result['stdout']:
            for line in reversed(result['stdout'].strip().split('\n')):
                if line.startswith('{'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'compatibility':
                            return data
                    except Exception:
                        pass
        return {'compatible': False, 'error': result.get('stderr', 'Unknown error')}

    def model_delete(self, model_path: str) -> dict:
        """Delete a locally downloaded model directory."""
        try:
            path = Path(model_path)
            if not path.exists():
                return {'success': False, 'error': 'Model path does not exist'}
            if not path.is_dir():
                return {'success': False, 'error': 'Model path is not a directory'}

            shutil.rmtree(path)
            logger.info('Deleted model at %s', model_path)
            return {'success': True}
        except Exception as e:
            logger.error('model_delete failed: %s', e)
            return {'success': False, 'error': str(e)}

    def model_move(self, model_path: str, dest_dir: str) -> dict:
        """Move a locally downloaded model to another directory."""
        try:
            src = Path(model_path)
            if not src.exists():
                return {'success': False, 'error': 'Model path does not exist'}
            if not src.is_dir():
                return {'success': False, 'error': 'Model path is not a directory'}

            dest = Path(dest_dir)
            dest.mkdir(parents=True, exist_ok=True)

            target = dest / src.name
            if target.exists():
                return {'success': False, 'error': f'Destination {target} already exists'}

            shutil.move(str(src), str(target))
            logger.info('Moved model from %s to %s', model_path, target)
            return {'success': True, 'dest_path': str(target)}
        except Exception as e:
            logger.error('model_move failed: %s', e)
            return {'success': False, 'error': str(e)}

    def model_merge_adapter(self, base_model: str, adapter: str, output: str) -> dict:
        """Merge LoRA adapter into base model with streaming."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'merge_adapter.py')
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found on PATH.'}

        try:
            proc = subprocess.Popen(
                [python, script, '--base-model', base_model, '--adapter', adapter, '--output', output],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ},
            )

            def read_stream(stream, stream_type):
                for line in iter(stream.readline, ''):
                    if line:
                        try:
                            data = json.loads(line)
                            data['_stream'] = stream_type
                            self._emit_training_progress(data)
                        except json.JSONDecodeError:
                            pass
                stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, 'stdout'), daemon=True)
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, 'stderr'), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            proc.wait(timeout=600)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

            if proc.returncode == 0:
                return {'success': True, 'path': output}
            return {'success': False, 'error': 'Merge failed'}
        except subprocess.TimeoutExpired:
            proc.kill()
            return {'success': False, 'error': 'Merge timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # Dataset Preview
    # ═══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _make_json_safe(obj):
        """Recursively convert numpy types to native Python types for JSON safety."""
        if isinstance(obj, dict):
            return {k: MamaApi._make_json_safe(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [MamaApi._make_json_safe(v) for v in obj]
        # numpy types — lazy import to avoid crash when numpy isn't installed
        try:
            import numpy as np
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, (np.bool_,)):
                return bool(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
        except ImportError:
            pass
        return obj

    def dataset_preview(self, path: str, max_rows: int = 5) -> dict:
        """Preview a dataset (JSONL, CSV, Parquet, or HF Hub dataset ID).
        Returns column names and sample rows.
        """
        import csv
        import json as pyjson
        import traceback

        def _log(msg):
            print(f'[dataset_preview] {msg}', flush=True)

        def safe_row(r):
            """Convert a single row dict to JSON-safe values, truncating long strings."""
            out = {}
            for k, v in r.items():
                v = self._make_json_safe(v)
                if isinstance(v, str) and len(v) > 500:
                    v = v[:500] + '…'
                out[str(k)] = v
            return out

        try:
            # ── Try local file/directory first ────────────────────────────
            p = Path(path)
            if p.exists():
                _log(f'local path exists: {p} (suffix={p.suffix})')
                if p.suffix == '.csv':
                    with open(p, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f)
                        rows = []
                        for i, row in enumerate(reader):
                            if i >= max_rows:
                                break
                            rows.append(safe_row(row))
                        _log(f'loaded {len(rows)} rows from CSV')
                        return {'success': True, 'columns': list(reader.fieldnames or []), 'rows': rows}

                elif p.suffix in ('.jsonl', '.json'):
                    rows = []
                    columns = set()
                    with open(p, 'r', encoding='utf-8') as f:
                        for i, line in enumerate(f):
                            if i >= max_rows:
                                break
                            line = line.strip()
                            if line:
                                try:
                                    row = pyjson.loads(line)
                                    if isinstance(row, dict):
                                        rows.append(safe_row(row))
                                        columns.update(row.keys())
                                except pyjson.JSONDecodeError:
                                    pass
                    _log(f'loaded {len(rows)} rows from JSON')
                    return {'success': True, 'columns': sorted(columns), 'rows': rows}

                elif p.suffix == '.parquet':
                    try:
                        import pandas as pd
                        df = pd.read_parquet(p)
                        cols = list(df.columns)
                        sample = df.head(max_rows).to_dict(orient='records')
                        _log(f'loaded {len(sample)} rows from Parquet')
                        return {'success': True, 'columns': cols, 'rows': [safe_row(r) for r in sample]}
                    except ImportError:
                        return {'success': False, 'error': 'pandas required for parquet preview'}

                elif p.is_dir():
                    try:
                        from datasets import load_from_disk
                        _log('loading dataset directory with load_from_disk...')
                        ds = load_from_disk(str(p))
                        cols = ds.column_names
                        rows = ds.select(range(min(max_rows, len(ds)))).to_list()
                        _log(f'loaded {len(rows)} rows from dataset directory')
                        return {'success': True, 'columns': cols, 'rows': [safe_row(r) for r in rows]}
                    except Exception as e:
                        _log(f'load_from_disk failed: {e}')
                        return {'success': False, 'error': 'Not a valid dataset directory'}

                return {'success': False, 'error': f'Unsupported file format: {p.suffix}'}

            # ── Not a local path — try Hugging Face Hub via API ──────────
            import urllib.request as urlreq
            import urllib.error

            _log(f'Hugging Face Hub dataset: {path}')
            try:
                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'contacting',
                    'message': 'Contacting Hugging Face datasets server...'
                })

                # Step 1: Get dataset info (configs, splits, features)
                info_url = f'https://datasets-server.huggingface.co/info?dataset={path}'
                _log(f'fetching dataset info: {info_url}')
                req = urlreq.Request(info_url, headers={'User-Agent': 'mama/1.0'})
                with urlreq.urlopen(req, timeout=15) as resp:
                    info_data = pyjson.loads(resp.read().decode('utf-8'))
                _log('dataset info received OK')

                # Extract config and split
                configs = info_data.get('dataset_info', {})
                if not configs:
                    _log('no configs found in dataset info')
                    return {'success': False, 'error': 'No configs found for dataset'}

                # Pick the first config (usually 'default' or the only one)
                config_name = next(iter(configs.keys())) if isinstance(configs, dict) else 'default'
                config_info = configs.get(config_name, {}) if isinstance(configs, dict) else configs
                splits = config_info.get('splits', {}) if isinstance(config_info, dict) else {}
                split_name = 'train' if 'train' in splits else (next(iter(splits.keys())) if splits else 'train')
                _log(f'config={config_name}, split={split_name}')

                # Features / columns
                features = config_info.get('features', {}) if isinstance(config_info, dict) else {}
                cols = list(features.keys()) if features else []

                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'rows',
                    'message': 'Downloading sample rows...'
                })

                # Step 2: Fetch first rows from the Datasets Server
                rows_url = (
                    f'https://datasets-server.huggingface.co/rows'
                    f'?dataset={path}&config={config_name}&split={split_name}'
                )
                _log(f'fetching sample rows: {rows_url}')
                req2 = urlreq.Request(rows_url, headers={'User-Agent': 'mama/1.0'})
                with urlreq.urlopen(req2, timeout=30) as resp2:
                    rows_data = pyjson.loads(resp2.read().decode('utf-8'))
                _log('sample rows received OK')

                raw_rows = rows_data.get('rows', []) if isinstance(rows_data, dict) else []
                sample = []
                for i, item in enumerate(raw_rows):
                    if i >= max_rows:
                        break
                    row_data = item.get('row', item) if isinstance(item, dict) else item
                    if isinstance(row_data, dict):
                        sample.append(safe_row(row_data))
                _log(f'processed {len(sample)} sample rows')

                if not cols and sample:
                    cols = list(sample[0].keys())

                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'done',
                    'message': 'Preview ready'
                })
                _log('preview complete, returning result')

                return {
                    'success': True,
                    'columns': cols,
                    'rows': sample,
                    'dataset_id': path,
                    'split': split_name,
                    'config': config_name,
                    'source': 'huggingface',
                    'total_rows': splits.get(split_name, {}).get('num_examples', 0) if isinstance(splits, dict) else 0,
                }

            except urllib.error.HTTPError as e:
                _log(f'HTTPError: {e.code} {e.reason}')
                if e.code == 404:
                    return {'success': False, 'error': f'Dataset "{path}" not found on Hugging Face Hub'}
                return {'success': False, 'error': f'HF API error ({e.code}): {e.reason}'}
            except urllib.error.URLError as e:
                _log(f'URLError: {e.reason}')
                return {'success': False, 'error': f'Network error accessing HF Hub: {e.reason}'}
            except Exception as e:
                _log(f'unexpected HF error: {e}\n{traceback.format_exc()}')
                return {'success': False, 'error': f'Hugging Face dataset error: {e}'}

        except Exception as e:
            _log(f'unexpected error: {e}\n{traceback.format_exc()}')
            return {'success': False, 'error': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # Platform Check (training-specific)
    # ═══════════════════════════════════════════════════════════════════════

    def train_platform_check(self) -> dict:
        """Check platform compatibility for training."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'train.py')
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found'}
        result = self._run_script(script, ['--platform-check'], timeout=60_000, python_exe=python)
        if result['code'] == 0 and result['stdout']:
            for line in reversed(result['stdout'].strip().split('\n')):
                if line.startswith('{'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'platform_check':
                            return {'success': True, **data}
                    except Exception:
                        pass
        return {'success': False, 'error': result.get('stderr', 'Unknown error')}

    # ═══════════════════════════════════════════════════════════════════════
    # Export
    # ═══════════════════════════════════════════════════════════════════════

    def export_run_colab(self, output_dir: str) -> dict:
        """Export training code to a Google Colab-compatible notebook."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            template_src = self._base_dir / 'components' / 'export' / 'template' / 'colab' / 'colab_export.ipynb'
            if not template_src.exists():
                return {'success': False, 'error': 'Colab template not found'}

            # Read template notebook
            with open(template_src, 'r', encoding='utf-8') as f:
                notebook = json.load(f)

            # Find the CONFIG cell (cell index 1, the code cell with CONFIG_JSON)
            config_found = False
            training_cfg = out / 'training_config.json'
            if training_cfg.exists():
                config_data = json.loads(training_cfg.read_text('utf-8'))
                config_json = json.dumps(config_data, indent=2)
                # Use concatenation, NOT an f-string — config_json contains { }
                notebook['cells'][1]['source'] = [
                    '# --- TRAINING CONFIG (injected by mama from training_config.json) ---\n',
                    '\n',
                    "CONFIG_JSON = '''" + config_json + "'''\n",
                ]
                config_found = True
                logger.info('Injected config from %s', training_cfg)

            if not config_found:
                # Cell already has a helpful fallback message; just log it
                logger.info('No training_config.json found; keeping fallback guidance in notebook')

            dest = out / 'colab_export.ipynb'
            with open(dest, 'w', encoding='utf-8') as f:
                json.dump(notebook, f, indent=1, ensure_ascii=False)

            logger.info('Colab export created at %s', dest)
            return {
                'success': True,
                'path': str(dest),
                'has_config': config_found,
            }
        except Exception as e:
            logger.error('export_run_colab failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_js(self, output_dir: str) -> dict:
        """Export trained model to JavaScript (ONNX.js) format."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            template_src = self._base_dir / 'components' / 'export' / 'template' / 'js' / 'js_export.js'
            if not template_src.exists():
                return {'success': False, 'error': 'JS export template not found'}

            js_dir = out / 'js_export'
            js_dir.mkdir(parents=True, exist_ok=True)

            # Copy the JS template
            shutil.copy2(str(template_src), str(js_dir / 'model_runner.js'))

            # Detect if a trained model exists
            model_path = out / 'final_model'
            if not model_path.exists():
                checkpoints = sorted(out.glob('checkpoint-*'))
                if checkpoints:
                    model_path = checkpoints[-1]

            conversion = None
            if model_path.exists():
                python = self._get_training_python()
                conversion_script = str(self._base_dir / 'components' / 'backend' / 'training' / 'convert_to_onnx.py')
                if python and Path(conversion_script).exists():
                    result = self._run_script(
                        conversion_script,
                        ['--input-dir', output_dir, '--output-dir', str(js_dir)],
                        timeout=300_000,
                        python_exe=python
                    )
                    conversion = result['code'] == 0
                    if not conversion:
                        logger.warning('ONNX conversion failed, template still copied')

            logger.info('JS export created at %s', js_dir)
            return {
                'success': True,
                'path': str(js_dir),
                'has_model': model_path.exists(),
                'converted': conversion,
            }
        except Exception as e:
            logger.error('export_run_js failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_ollama(self, output_dir: str) -> dict:
        """Export trained model to Ollama via Modelfile."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            ollama_dir = out / 'ollama_export'
            ollama_dir.mkdir(parents=True, exist_ok=True)

            # Find model directory
            model_path = out / 'final_model'
            if not model_path.exists():
                checkpoints = sorted(out.glob('checkpoint-*'))
                if checkpoints:
                    model_path = checkpoints[-1]

            model_found = model_path.exists()

            # Write Modelfile
            from_line = f'FROM {model_path}' if model_found else '# No trained model found. Replace with your model path.'
            modelfile = f"""{from_line}

PARAMETER temperature 0.7
PARAMETER top_p 0.9

TEMPLATE \"\"\"{{ .System }}
{{ .Prompt }}
\"\"\"

SYSTEM \"\"\"You are a model trained with mama. Respond to the user's queries.
\"\"\"
"""
            (ollama_dir / 'Modelfile').write_text(modelfile, 'utf-8')

            if model_found:
                model_dest = ollama_dir / 'model'
                if not model_dest.exists():
                    try:
                        os.symlink(str(model_path), str(model_dest))
                    except OSError:
                        shutil.copytree(str(model_path), str(model_dest), dirs_exist_ok=True)

            logger.info('Ollama export created at %s', ollama_dir)
            return {
                'success': True,
                'path': str(ollama_dir),
                'has_model': model_found,
                'ollama_command': f'ollama create my-model -f {ollama_dir / "Modelfile"}',
            }
        except Exception as e:
            logger.error('export_run_ollama failed: %s', e)
            return {'success': False, 'error': str(e)}

    # ═══════════════════════════════════════════════════════════════════════
    # Docs
    # ═══════════════════════════════════════════════════════════════════════

    def read_docs_file(self, filename: str) -> Optional[str]:
        """Read a documentation file from the docs/ directory."""
        try:
            docs_path = self._base_dir / 'docs' / filename
            if docs_path.exists():
                return docs_path.read_text('utf-8')
            return None
        except Exception as e:
            logger.error('read_docs_file failed: %s', e)
            return None