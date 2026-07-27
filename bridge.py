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
                env={**os.environ}
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

    def _ensure_settings(self):
        """Seed user settings from template if they don't exist."""
        if not self._user_settings_path.exists():
            if self._template_dir.exists():
                template = self._template_dir / 'settings.json'
                if template.exists():
                    self._user_settings_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(template, self._user_settings_path)

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

    def navigate_to(self, page: str) -> bool:
        """Navigate the pywebview window to a different page.
        page is a relative path like 'public/settings.html' or a full URL.
        """
        if self._window:
            # If it's a relative path, construct the full URL
            if not page.startswith('http://') and not page.startswith('https://') and not page.startswith('file://'):
                # Remove leading ../ or ./ or just use as-is relative to base
                clean_page = page.lstrip('./')
                url = f'http://127.0.0.1:{self._server_port}/{clean_page}'
            else:
                url = page
            self._window.load_url(url)
            return True
        return False

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
                           project_folder: str = '') -> dict:
        """Run install with real-time streaming output."""
        script = str(self._installs_dir / 'install_fw.py')
        args = [fw, gpu_variant]
        if accel_version:
            args.append(accel_version)

        os_info = self._get_os_info()
        args.extend(['--os-family', os_info['os_family']])
        args.extend(['--distro', os_info['distro']])

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

        try:
            proc = subprocess.Popen(
                [python, script] + args,
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

    def _emit_install_progress(self, chunk: dict):
        """Emit install progress to the frontend via evaluate_js."""
        if self._window:
            js = f"""
            (function() {{
                if (window.electron && window.electron._installProgressCallback) {{
                    window.electron._installProgressCallback({json.dumps(chunk)});
                }}
            }})();
            """
            try:
                self._window.evaluate_js(js)
            except Exception as e:
                logger.debug('Failed to emit install progress: %s', e)

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

    def run_flops_test(self, batch_size: int = 1) -> dict:
        """Run flops.py benchmark."""
        script = str(self._python_tests_dir / 'flops.py')
        args = ['--batch-size', str(batch_size)]
        return self._run_script(script, args, timeout=300_000)

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
                    webview.FOLDER_DIALOG,
                    title='Select Project Folder'
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