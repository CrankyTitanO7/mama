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
import platform
import signal
import threading
import logging
import time
import datetime
from pathlib import Path
from typing import Optional, Any

import updater
import paths

logger = logging.getLogger('mama.bridge')


# Python sources the app is allowed to use for installs/venvs. Only:
#   - python.org "website" installer  (/Library/Frameworks/Python.framework)
#   - Homebrew                       (/opt/homebrew, /usr/local)
#   - conda (miniforge/miniconda/anaconda/mambaforge under /opt, /usr/local, ~)
# Anything else (Apple's /usr/bin/python3, CommandLineTools, pyenv, ...) is
# rejected so the app never creates 3.9.6 venvs or fails to install wheels.
CONDA_PREFIX_NAMES = (
    'miniforge', 'miniconda', 'anaconda', 'mambaforge',
    'miniforge3', 'miniconda3', 'anaconda3', 'mambaforge3',
)


def allowed_python_path(real: str) -> bool:
    """Return True if the real path belongs to an allowed Python source.

    Enforced on macOS only; Windows/Linux keep their usual PATH behavior.
    """
    if sys.platform != 'darwin':
        return True
    prefixes = [
        '/Library/Frameworks/Python.framework/',
        '/opt/homebrew/',
        '/usr/local/',
    ]
    home = str(Path.home())
    for root in ('/opt', '/usr/local', home):
        for name in CONDA_PREFIX_NAMES:
            prefixes.append(f'{root}/{name}/')
    return any(real.startswith(p) for p in prefixes)


def augment_path_for_gui_launch() -> None:
    """Prepend allowed Python install dirs to PATH.

    GUI apps launched from Finder get a minimal PATH (e.g. /usr/bin:/bin:/usr/
    sbin:/sbin), so bare 'python3' resolves to Apple's /usr/bin/python3 (3.9.6,
    no pip, no PyTorch wheels). Homebrew and conda installs live outside that
    PATH — add them so the app and every subprocess can find a real, modern
    Python. Other interpreters stay discoverable but are filtered out later by
    allowed_python_path().
    """
    extra = []
    home = str(Path.home())
    for p in ('/opt/homebrew/bin', '/usr/local/bin'):
        if os.path.isdir(p):
            extra.append(p)
    for prefix in ('/opt', '/usr/local', home, '/opt/homebrew/Caskroom'):
        for sub in CONDA_PREFIX_NAMES:
            for sub_dir in (os.path.join(prefix, sub, 'bin'),
                            os.path.join(prefix, sub, 'base', 'bin')):
                if os.path.isdir(sub_dir):
                    extra.append(sub_dir)
    if not extra:
        return
    current = os.environ.get('PATH', '')
    merged = os.pathsep.join(dict.fromkeys(
        p for p in (extra + ([current] if current else [])) if p
    ))
    if merged != current:
        os.environ['PATH'] = merged


augment_path_for_gui_launch()


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


# Backend "modules" the user can install/uninstall from the topbar dropdown.
# Each module lists the exact pip steps (shown and run by the UI). On WSL the
# steps are executed inside the default WSL distro; native Windows has no
# supported modules, macOS only unsloth.
MODULES = [
    {
        'key': 'axolotl',
        'name': 'Axolotl',
        'description': 'Axolotl fine-tuning framework (needs Linux or WSL + CUDA)',
        'import_name': 'axolotl',
        'platforms': ('linux', 'wsl'),
        'unsupported_reason': 'Axolotl only runs on Linux or WSL with an NVIDIA CUDA GPU.',
        'install_steps': ('pip install axolotl',),
        'uninstall_steps': ('pip uninstall -y axolotl',),
    },
    {
        'key': 'unsloth',
        'name': 'Unsloth',
        'description': 'Unsloth — fast LoRA/QLoRA fine-tuning',
        'import_name': 'unsloth',
        'platforms': ('linux', 'macos', 'wsl'),
        'unsupported_reason': 'Unsloth does not support native Windows; use WSL, Linux, or macOS.',
        # install steps are platform specific, see _module_install_steps
        'install_steps': ('pip install unsloth',),
        'uninstall_steps': ('pip uninstall -y unsloth',),
    },
]

MODULES_BY_KEY = {m['key']: m for m in MODULES}

# Official macOS install requires building from source via the github repo.
UNSLOTH_MACOS_INSTALL_STEPS = (
    'pip install --upgrade --force-reinstall --no-cache-dir '
    '"unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"',
)


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

        # Writable user-data location: a per-user data dir in frozen builds
        # (the bundle can be read-only, e.g. AppImage mount or Program Files),
        # the repo root in development.
        self._data_dir = paths.app_data_dir()
        self._bundle_dir = paths.bundle_dir()

        # Template paths: templates ship read-only in the bundle; the
        # settings/themes/recents they seed are written to the data dir.
        if getattr(sys, 'frozen', False):
            self._template_dir = self._bundle_dir / 'user' / 'template'
            self._themes_dir = self._data_dir / 'user' / 'themes'
            self._recents_path = self._data_dir / 'components' / 'recents.json'
        else:
            self._template_dir = self._base_dir / 'user' / 'template'
            self._themes_dir = self._base_dir / 'user' / 'themes'
            self._recents_path = self._base_dir / 'components' / 'recents.json'
        self._descriptions_path = self._template_dir / 'descriptions.json'

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

        # Auto-update: if an update was staged, hand off to the swapper process
        # (it waits for this process to exit, swaps the bundle, relaunches).
        try:
            if updater.spawn_applier():
                logger.info('Update swapper launched')
        except Exception as e:
            logger.error('Failed to launch update swapper: %s', e)

    # ═══════════════════════════════════════════════════════════════════════
    # Python executable resolution
    # ═══════════════════════════════════════════════════════════════════════

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
                    capture_output=True, text=True, timeout=8
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
                    capture_output=True, text=True, timeout=30)
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

    def _models_dir(self) -> Path:
        """User-writable directory for downloaded models.

        In development this is the repo's models/ folder; in frozen builds
        the app bundle may be read-only or replaced on update, so models live
        in a per-user data directory instead.
        """
        if getattr(sys, 'frozen', False):
            return self._data_dir / 'models'
        return self._base_dir / 'models'

    # ═══════════════════════════════════════════════════════════════════════
    # Script runner
    # ═══════════════════════════════════════════════════════════════════════

    def _run_script(self, script_path: str, args: list = None,
                    timeout: int = 120_000, python_exe: str = None,
                    fallback_python: bool = False) -> dict:
        """Run a Python script and return {code, stdout, stderr}.

        fallback_python: if True and no system Python is found, run the
        script with the app's own interpreter instead. Use only for
        pure-stdlib detection scripts that never pip-install.
        """
        if args is None:
            args = []
        python = python_exe or self._get_python()
        if not python and fallback_python and sys.executable and not getattr(sys, 'frozen', False):
            python = sys.executable
        if not python:
            return {'code': 1, 'stdout': '', 'stderr': 'Python 3 not found on PATH.'}

        try:
            proc = subprocess.Popen(
                [python, script_path] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=clean_subprocess_env(),
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
    # Updates
    # ═══════════════════════════════════════════════════════════════════════

    def update_check(self) -> dict:
        """Check GitHub releases for a newer version of mama."""
        try:
            return updater.check_for_update()
        except Exception as e:
            logger.error('update_check failed: %s', e)
            return {'available': False, 'error': str(e)}

    def update_download(self) -> dict:
        """Download the latest update in the background; progress is emitted
        through the '_updateProgressCallback' channel."""
        threading.Thread(target=self._update_download_worker, daemon=True).start()
        return {'started': True}

    def _update_download_worker(self):
        self._enqueue_emit('_updateProgressCallback', {'type': 'status', 'text': 'Downloading update…'})

        def on_progress(received, total):
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'download',
                'received': received,
                'total': total,
                'percent': round(received * 100 / total) if total else 0,
            })

        result = updater.download_update(progress_cb=on_progress)
        if result.get('success'):
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'done', 'size': result.get('size'),
            })
        else:
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'error', 'message': result.get('error'),
            })

    def update_install(self) -> dict:
        """Stage the downloaded update so it is applied on next quit."""
        try:
            result = updater.stage_update()
            if result.get('success'):
                self._enqueue_emit('_updateProgressCallback', {
                    'type': 'ready', 'tag': result.get('tag'),
                })
            else:
                self._enqueue_emit('_updateProgressCallback', {
                    'type': 'error', 'message': result.get('error'),
                })
            return result
        except Exception as e:
            logger.error('update_install failed: %s', e)
            return {'success': False, 'error': str(e)}

    def app_quit(self):
        """Close the window; on_quit then hands off any staged update."""
        if self._window:
            try:
                self._window.destroy()
            except Exception as e:
                logger.error('app_quit failed: %s', e)

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

        self._emit_install_progress({'type': 'meta', 'text': f'python: {python}'})
        self._emit_install_progress({'type': 'meta', 'text': f'command: {" ".join(cmd)}'})

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ}
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

    def _seed_themes(self):
        """Copy bundled themes into the writable themes dir on first run.

        In frozen builds the bundle's user/themes/ is read-only, so on a
        fresh install the bundled themes are copied into the data dir once;
        afterwards only the data-dir copies are used (and user themes can
        be added/deleted there).
        """
        if not getattr(sys, 'frozen', False):
            return
        if self._themes_dir.is_dir() and any(self._themes_dir.glob('*.json')):
            return
        bundled = self._base_dir / 'user' / 'themes'
        if not bundled.is_dir():
            return
        try:
            self._themes_dir.mkdir(parents=True, exist_ok=True)
            for f in bundled.glob('*.json'):
                shutil.copy2(f, self._themes_dir / f.name)
            logger.info('Seeded bundled themes into %s', self._themes_dir)
        except OSError as e:
            logger.warning('Could not seed themes: %s', e)

    def themes_read(self) -> list:
        """Read custom themes from user/themes/ directory."""
        self._seed_themes()
        themes_dir = self._themes_dir
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
            themes_dir = self._themes_dir
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

    def project_pick_file(self, patterns: str = '') -> Optional[str]:
        """Open a native file picker dialog (optionally filtered by extension)."""
        try:
            if sys.platform == 'darwin':
                cmd = 'return POSIX path of (choose file with prompt "Choose File")'
                if patterns:
                    ext = patterns.split(',')[0].strip().lstrip('.')
                    cmd = (
                        'return POSIX path of '
                        f'(choose file with prompt "Choose File" '
                        f'of type {{"{ext}"}})'
                    )
                result = subprocess.run(
                    ['osascript', '-e', cmd],
                    capture_output=True, text=True, timeout=120
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            else:
                if not self._window:
                    return None
                import webview
                result = self._window.create_file_dialog(
                    webview.OPEN_DIALOG,
                    file_types=(patterns,)
                ) if patterns else self._window.create_file_dialog(
                    webview.OPEN_DIALOG
                )
                if result and len(result) > 0:
                    return result[0]
        except Exception as e:
            logger.error('File picker failed: %s', e)
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

        # ── Backend routing ───────────────────────────────────────────
        backend = str(cfg.get('training_backend') or 'trl').lower()
        if backend in ('axolotl', 'axol', 'axoly'):
            return self._train_start_axolotl(cfg, config_path, python)
        if backend in ('unsleth', 'unsl', 'us'):
            return self._train_start_unsloth(cfg, config_path, python)
        if backend in ('custom', 'cs', 'script'):
            return self._train_start_custom(cfg, config_path, python)

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

    def train_config_save(self, output_dir: str, config_json: str) -> dict:
        """Persist a mama training config as training_config.json in an output folder.

        Used so the confirmation screen / export page can point at a real
        config before training has ever been launched.
        """
        try:
            out = Path(output_dir)
            if not output_dir:
                return {'success': False, 'error': 'output_dir is required'}
            out.mkdir(parents=True, exist_ok=True)
            cfg = json.loads(config_json)
            cfg_path = out / 'training_config.json'
            cfg_path.write_text(json.dumps(cfg, indent=2), 'utf-8')
            logger.info('Saved training config to %s', cfg_path)
            return {'success': True, 'path': str(cfg_path)}
        except Exception as e:
            logger.error('train_config_save failed: %s', e)
            return {'success': False, 'error': str(e)}

    def train_axolotl_write_config(self, output_dir: str, config_json: str) -> dict:
        """Generate a standalone Axolotl YAML config into an output directory.

        Lets the user inspect/preview the exact YAML that an Axolotl run would
        use without launching training. Returns the YAML text and its path.
        """
        try:
            cfg = json.loads(config_json)
            output_dir = output_dir or cfg.get('output_dir')
            if not output_dir:
                return {'success': False, 'error': 'output_dir is required'}
            script = str(self._base_dir / 'components' / 'backend' / 'training' / 'train_axolotl.py')
            python = self._get_training_python()
            if not python:
                return {'success': False, 'error': 'Python 3 not found'}
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            cfg_path = output_path / 'training_config.json'
            cfg_path.write_text(json.dumps(cfg, indent=2), 'utf-8')

            result = self._run_script(
                script, ['--config', str(cfg_path), '--gen-config'],
                timeout=60_000, python_exe=python
            )
            if result['code'] != 0:
                return {'success': False, 'error': result.get('stderr') or 'Failed to build Axolotl config'}
            yaml_text = ''
            for line in reversed(result['stdout'].strip().split('\n')):
                if line.startswith('{'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'axolotl_config':
                            yaml_text = data.get('yaml', '')
                            break
                    except Exception:
                        pass
            yaml_path = output_path / 'config.yaml'
            if not yaml_text:
                yaml_text = yaml_path.read_text('utf-8') if yaml_path.exists() else ''
            return {'success': True, 'path': str(yaml_path), 'yaml': yaml_text}
        except Exception as e:
            logger.error('train_axolotl_write_config failed: %s', e)
            return {'success': False, 'error': str(e)}

    def _train_start_axolotl(self, cfg: dict, config_path, python: str) -> dict:
        """Spawn the Axolotl (power) backend runner.

        Unlike the built-in TRL backend there is no separate dependency
        install step: train_axolotl.py installs axolotl (if missing) itself
        and assumes PyTorch (CUDA) was installed by the Setup wizard.
        """
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'train_axolotl.py')

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

            return {'success': True, 'config_path': str(config_path), 'backend': 'axolotl'}
        except Exception as e:
            logger.error('_train_start_axolotl failed: %s', e)
            return {'success': False, 'error': str(e)}

    # ── Unsloth backend ────────────────────────────────────────────────────────

    def _train_unsloth_script(self) -> str:
        return str(self._base_dir / 'components' / 'backend' / 'training' / 'train_unsloth.py')

    def _train_start_unsloth(self, cfg: dict, config_path, python: str) -> dict:
        """Spawn the Unsloth (fast) backend runner.

        train_unsloth.py installs unsloth itself (if missing) and renders a
        standalone train_unsloth.py in the output dir, then runs it — the same
        artifact the Export page produces, so freeze-frame export/import of a
        run reproduces the identical training program.
        """
        script = self._train_unsloth_script()
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

            return {'success': True, 'config_path': str(config_path), 'backend': 'unsloth'}
        except Exception as e:
            logger.error('_train_start_unsloth failed: %s', e)
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _watch_training_control_files(proc: subprocess.Popen, output_dir: str):
        """Watch .pause / .cancel marker files and signal the process group.

        Mirrors the control-file behaviour of train_unsloth.py: cancel sends
        SIGTERM (then SIGKILL) to the whole group, pause SIGSTOPs it and
        resume SIGCONTs it. Used for user-supplied scripts so the Training
        Monitor's Pause / Resume / Cancel buttons work with the Custom
        backend too.
        """
        pause_file = Path(output_dir) / '.pause'
        cancel_file = Path(output_dir) / '.cancel'
        paused = False
        while proc.poll() is None:
            try:
                if cancel_file.exists():
                    pgid = os.getpgid(proc.pid)
                    os.killpg(pgid, signal.SIGTERM)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(pgid, signal.SIGKILL)
                    return
                if pause_file.exists() and not paused:
                    paused = True
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGSTOP)
                    except (ProcessLookupError, PermissionError, OSError):
                        pass
                elif not pause_file.exists() and paused:
                    paused = False
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGCONT)
                    except (ProcessLookupError, PermissionError, OSError):
                        pass
            except (ProcessLookupError, PermissionError, OSError):
                return
            time.sleep(1)

    def _train_start_custom(self, cfg: dict, config_path, python: str) -> dict:
        """Run a user-supplied Python training script (the Custom backend).

        Spawns `python <script> --config <config_path>` inside its own
        process group and streams stdout/stderr over the same IPC protocol
        as the other backends (JSON lines like {"type": "metric"/"status"/
        "progress"/"error"} are forwarded as-is; anything else becomes a
        log entry). The script reads the mama training config from the path
        given by --config. Pause / Resume / Cancel markers in the output
        directory are applied to the whole process group.
        """
        script_path = str(cfg.get('custom_script') or '').strip()
        if not script_path:
            return {'success': False,
                    'error': 'custom_script is required when training_backend is "custom"'}
        if not Path(script_path).exists():
            return {'success': False, 'error': f'Custom script not found: {script_path}'}
        output_dir = str(cfg.get('output_dir') or '')

        try:
            proc = subprocess.Popen(
                [python, script_path, '--config', str(config_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
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

            if output_dir:
                threading.Thread(
                    target=self._watch_training_control_files,
                    args=(proc, output_dir), daemon=True).start()

            return {'success': True, 'config_path': str(config_path), 'backend': 'custom',
                    'script': script_path}
        except Exception as e:
            logger.error('_train_start_custom failed: %s', e)
            return {'success': False, 'error': str(e)}

    def train_unsloth_check(self) -> dict:
        """Check whether the Unsloth backend can be used on this system.

        Unlike Axolotl, Unsloth supports both CUDA (Linux) and Apple Silicon
        MPS (macOS). Windows requires WSL. A real torch/device probe is
        delegated to train_unsloth.py's --mode platform-check.
        """
        if sys.platform == 'win32' and not os.environ.get('WSL_DISTRO_NAME'):
            return {
                'success': True,
                'backend': 'us',
                'supported': False,
                'device': 'cpu',
                'cuda_available': False,
                'mps_available': False,
                'unsloth_installed': None,
                'reason': 'Unsloth does not support native Windows; use WSL, Linux, or macOS.',
            }
        script = self._train_unsloth_script()
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found'}
        result = self._run_script(script, ['--mode', 'platform-check'],
                                  timeout=120_000, python_exe=python)
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

    def train_unsloth_write_config(self, output_dir: str, config_json: str) -> dict:
        """Generate a standalone Unsloth script into an output directory.

        Lets the user preview/inspect the exact train_unsloth.py that an
        Unsloth run would use without launching training. Returns the script
        text and its path.
        """
        try:
            cfg = json.loads(config_json)
            output_dir = output_dir or cfg.get('output_dir')
            if not output_dir:
                return {'success': False, 'error': 'output_dir is required'}
            script = self._train_unsloth_script()
            python = self._get_training_python()
            if not python:
                return {'success': False, 'error': 'Python 3 not found'}
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)

            # Tracing script generation through train_unsloth.py keeps the
            # on-disk artifact identical to the one produced at run time.
            cfg_path = output_path / 'training_config.json'
            cfg_path.write_text(json.dumps(cfg, indent=2), 'utf-8')
            result = self._run_script(
                script, ['--mode', 'gen-script', '--config', str(cfg_path),
                         '--output-dir', str(output_path)],
                timeout=60_000, python_exe=python,
            )
            if result['code'] != 0:
                return {'success': False, 'error': result.get('stderr') or 'Failed to generate Unsloth script'}
            script_text = ''
            for line in reversed(result['stdout'].strip().split('\n')):
                if line.startswith('{'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'unsloth_script':
                            script_text = data.get('script', '')
                            break
                    except Exception:
                        pass
            script_path = output_path / 'train_unsloth.py'
            if not script_text or not script_path.exists():
                return {'success': False, 'error': 'Failed to generate train_unsloth.py'}
            return {'success': True, 'path': str(script_path), 'script': script_text}
        except Exception as e:
            logger.error('train_unsloth_write_config failed: %s', e)
            return {'success': False, 'error': str(e)}

    def unsloth_import(self, script_path: str, output_dir: str) -> dict:
        """Import an existing Unsloth script back into a mama training config.

        Reads train_unsloth.py (or any unsloth-style .py), extracts a mama
        training_config.json, and writes it to output_dir. If output_dir is
        omitted, the script's own output_dir is used.
        """
        try:
            src = Path(script_path)
            if not src.exists():
                return {'success': False, 'error': f'Script not found: {script_path}'}
            script = self._train_unsloth_script()
            python = self._get_training_python()
            if not python:
                return {'success': False, 'error': 'Python 3 not found'}
            result = self._run_script(
                script, ['--mode', 'import', '--script', str(src),
                         '--output-dir', output_dir or '.'],
                timeout=60_000, python_exe=python,
            )
            if result['code'] != 0:
                return {'success': False, 'error': result.get('stderr') or 'Failed to import Unsloth script'}
            cfg = None
            cfg_path = ''
            for line in reversed(result['stdout'].strip().split('\n')):
                if line.startswith('{'):
                    try:
                        data = json.loads(line)
                        if data.get('type') == 'unsloth_import':
                            cfg = data.get('config')
                            cfg_path = data.get('path', '')
                            break
                    except Exception:
                        pass
            if not cfg:
                return {'success': False, 'error': 'No usable config found in script'}
            return {'success': True, 'config': cfg, 'path': cfg_path,
                    'script': str(src)}
        except Exception as e:
            logger.error('unsloth_import failed: %s', e)
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

    def _get_hf_token(self) -> str:
        """Resolve Hugging Face token from env or cache."""
        token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGING_FACE_HUB_TOKEN', '')
        if token:
            return token
        try:
            from huggingface_hub import HfFolder
            cached = HfFolder.get_token()
            if cached:
                return cached
        except Exception:
            pass
        return ''

    def model_download(self, model_id: str, output_dir: str = '', revision: str = 'main') -> dict:
        """Download a model from HF Hub with progress streaming."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'model_download.py')
        models_dir = output_dir or str(self._models_dir())
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found on PATH.'}

        hf_token = self._get_hf_token()
        cmd = [python, script, '--model-id', model_id, '--output', models_dir, '--revision', revision]
        if hf_token:
            cmd.extend(['--token', hf_token])

        try:
            proc = subprocess.Popen(cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={**os.environ},
            )
            self._model_download_process = proc

            error_lines: list = []
            error_lock = threading.Lock()

            def read_stream(stream, stream_type):
                for line in iter(stream.readline, ''):
                    if line:
                        try:
                            data = json.loads(line)
                            data['_stream'] = stream_type
                            if data.get('type') == 'error' and data.get('message'):
                                with error_lock:
                                    error_lines.append(data['message'])
                            self._emit_model_progress(data)
                        except json.JSONDecodeError:
                            if stream_type == 'stderr':
                                with error_lock:
                                    error_lines.append(line.strip())
                                    if len(error_lines) > 20:
                                        del error_lines[:len(error_lines) - 20]
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
                detail = ''
                with error_lock:
                    if error_lines:
                        detail = '\n'.join(error_lines[-5:])
                self._emit_model_progress({'type': 'done', 'code': proc.returncode or 0, 'error': detail})
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

    def model_install_hub(self) -> dict:
        """Install huggingface_hub into the active training Python.

        Prefers the open project's .venv (creating it if needed) so the
        package is installed where model downloads/training run.
        Streams pip output via _modelProgressCallback as install_log /
        install_done events.
        """
        python = None
        recents = self._read_recents() or {}
        project_folder = recents.get('open')
        if project_folder:
            python = self._get_venv_python(project_folder)
            if not python:
                python = self._create_venv(project_folder)
        if not python:
            python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found on PATH.'}

        self._emit_model_progress({
            'type': 'install_log',
            'text': f'Installing huggingface_hub into: {python}',
        })

        try:
            proc = subprocess.Popen(
                [python, '-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', 'huggingface_hub'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env={**os.environ},
            )
        except Exception as e:
            logger.error('model_install_hub failed: %s', e)
            return {'success': False, 'error': str(e)}

        def read_stream(stream):
            for line in iter(stream.readline, ''):
                if line and line.strip():
                    self._emit_model_progress({'type': 'install_log', 'text': line.rstrip('\n')})
            stream.close()

        stream_thread = threading.Thread(target=read_stream, args=(proc.stdout,), daemon=True)
        stream_thread.start()

        def wait_thread():
            proc.wait()
            stream_thread.join(timeout=5)
            self._emit_model_progress({
                'type': 'install_done',
                'success': proc.returncode == 0,
                'python': python,
                'error': '' if proc.returncode == 0 else f'pip install failed (exit code {proc.returncode}). See log above.',
            })

        threading.Thread(target=wait_thread, daemon=True).start()
        return {'success': True, 'python': python}

    def model_list(self, models_dir: str = '') -> list:
        """List locally downloaded models."""
        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'model_download.py')
        models_dir = models_dir or str(self._models_dir())
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
        args = ['--check', '--model-id', model_id]
        hf_token = self._get_hf_token()
        if hf_token:
            args.extend(['--token', hf_token])
        result = self._run_script(script, args, timeout=120_000, python_exe=python)
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

    def train_axolotl_check(self) -> dict:
        """Check whether the Axolotl (power) backend can be used.

        The Axolotl backend targets Linux + CUDA. On other platforms verdict
        comes back unsupported so the UI can select the built-in TRL backend
        instead. A real CUDA/torch probe is delegated to train_axolotl.py's
        --platform-check mode.
        """
        if sys.platform.startswith('darwin') or sys.platform == 'win32':
            return {
                'success': True,
                'backend': 'axolotl',
                'supported': False,
                'device': 'mps' if sys.platform.startswith('darwin') else 'cpu',
                'cuda_available': False,
                'axolotl_installed': None,
                'reason': 'Axolotl requires Linux + CUDA; use the built-in TRL backend on this OS.',
            }

        script = str(self._base_dir / 'components' / 'backend' / 'training' / 'train_axolotl.py')
        python = self._get_training_python()
        if not python:
            return {'success': False, 'error': 'Python 3 not found'}
        result = self._run_script(script, ['--platform-check'], timeout=120_000, python_exe=python)
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
    # Modules (axolotl / unsloth)
    # ═══════════════════════════════════════════════════════════════════════

    def _module_platform(self) -> str:
        """Current platform key: linux | macos | wsl | native_windows | other."""
        if sys.platform.startswith('linux'):
            return 'linux'
        if sys.platform == 'darwin':
            return 'macos'
        if sys.platform == 'win32':
            if os.environ.get('WSL_DISTRO_NAME'):
                return 'wsl'
            try:
                check = subprocess.run(
                    ['wsl', '--status'], capture_output=True, text=True, timeout=10)
                if check.returncode == 0:
                    return 'wsl'
            except Exception:
                pass
            return 'native_windows'
        return 'other'

    def _module_install_steps(self, module: dict, platform: str) -> list:
        if module['key'] == 'unsloth' and platform == 'macos':
            return list(UNSLOTH_MACOS_INSTALL_STEPS)
        return list(module['install_steps'])

    def _module_steps(self, module: dict, action: str, platform: str) -> list:
        if action == 'uninstall':
            return list(module['uninstall_steps'])
        return self._module_install_steps(module, platform)

    def _module_python(self, platform: str) -> Optional[str]:
        """The interpreter the module steps run under (None for WSL)."""
        if platform in ('linux', 'macos'):
            return self._get_training_python() or self._get_python()
        return None

    def _module_step_args(self, step: str, platform: str) -> Optional[list]:
        """Turn a 'pip install ...' step into a concrete argv for this platform."""
        if platform == 'wsl':
            # Run inside the default WSL distro. Prefer python3 -m pip so we
            # don't depend on the bare `pip` shim being installed there.
            inner = step
            if inner.startswith('pip '):
                inner = 'python3 -m pip' + inner[len('pip'):]
            return ['wsl', '-e', 'sh', '-lc', inner]
        python = self._module_python(platform)
        if not python:
            return None
        import shlex
        parts = shlex.split(step)
        if parts and parts[0] == 'pip':
            return [python, '-m', 'pip'] + parts[1:]
        return [python] + parts

    def _module_installed(self, module: dict, platform: str) -> bool:
        try:
            if platform == 'wsl':
                cmd = ['wsl', '-e', 'python3', '-c',
                       f'import {module["import_name"]}; print("ok")']
            else:
                python = self._module_python(platform)
                if not python:
                    return False
                cmd = [python, '-c',
                       f'import {module["import_name"]}; print("ok")']
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=60,
                env=clean_subprocess_env())
            return result.returncode == 0
        except Exception as e:
            logger.debug('module installed check failed for %s: %s',
                         module['key'], e)
            return False

    def _run_module_step(self, module_key: str, args: list) -> int:
        """Run one module step, streaming its output to the frontend."""
        try:
            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=clean_subprocess_env(),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
            )
            for line in iter(proc.stdout.readline, ''):
                if line and line.strip():
                    self._emit_module_progress(module_key, {'type': 'log', 'text': line.rstrip()})
            proc.wait(timeout=20 * 60)
            return proc.returncode or 0
        except subprocess.TimeoutExpired:
            proc.kill()
            self._emit_module_progress(module_key, {'type': 'error', 'text': 'Step timed out (20 min).'})
            return 1
        except Exception as e:
            logger.error('run_module_step error: %s', e)
            self._emit_module_progress(module_key, {'type': 'error', 'text': str(e)})
            return 1

    def _handle_module_action(self, key: str, action: str) -> dict:
        module = MODULES_BY_KEY.get(key or '')
        if not module:
            return {'success': False, 'error': f'Unknown module: {key}'}
        platform = self._module_platform()
        if platform not in module['platforms']:
            self._emit_module_progress(module['key'], {'type': 'error', 'text': module['unsupported_reason']})
            return {'success': False, 'error': module['unsupported_reason']}

        steps = self._module_steps(module, action, platform)
        label = 'Install' if action == 'install' else 'Uninstall'
        self._emit_module_progress(module['key'], {'type': 'meta', 'text': f'{label}ing {module["name"]}...'})

        for i, step in enumerate(steps, 1):
            self._emit_module_progress(module['key'], {'type': 'meta', 'text': f'Step {i}/{len(steps)}: {step}'})
            args = self._module_step_args(step, platform)
            if args is None:
                self._emit_module_progress(module['key'], {'type': 'error', 'text': 'Python 3 not found on PATH.'})
                return {'success': False, 'error': 'Python 3 not found on PATH.'}
            code = self._run_module_step(module['key'], args)
            if code != 0:
                self._emit_module_progress(module['key'], {
                    'type': 'done', 'success': False,
                    'error': f'{label} failed at step {i}/{len(steps)}.',
                })
                return {'success': False, 'error': f'Step {i} failed (exit {code})'}
            self._emit_module_progress(module['key'], {'type': 'step', 'current': i, 'total': len(steps)})

        self._emit_module_progress(module['key'], {'type': 'done', 'success': True})
        return {'success': True}

    def modules_get(self) -> dict:
        """Return module list with platform support + installed status."""
        platform = self._module_platform()
        modules = []
        for module in MODULES:
            supported = platform in module['platforms']
            modules.append({
                'key': module['key'],
                'name': module['name'],
                'description': module['description'],
                'platforms': list(module['platforms']),
                'platform': platform,
                'supported': supported,
                'unsupported_reason': module['unsupported_reason'] if not supported else '',
                'installed': self._module_installed(module, platform) if supported else False,
                'install_steps': self._module_steps(module, 'install', platform) if supported else [],
                'uninstall_steps': list(module['uninstall_steps']) if supported else [],
            })
        return {'success': True, 'modules': modules, 'platform': platform}

    def modules_install(self, key: str, project_folder: str = '') -> dict:
        """Install a module (streams progress to the frontend)."""
        return self._handle_module_action(key, 'install')

    def modules_uninstall(self, key: str, project_folder: str = '') -> dict:
        """Uninstall a module (streams progress to the frontend)."""
        return self._handle_module_action(key, 'uninstall')

    def modules_run_step(self, key: str, action: str, index: int) -> dict:
        """Run a single install/uninstall step of a module."""
        module = MODULES_BY_KEY.get(key or '')
        if not module:
            return {'success': False, 'error': f'Unknown module: {key}'}
        platform = self._module_platform()
        if platform not in module['platforms']:
            self._emit_module_progress(module['key'], {'type': 'error', 'text': module['unsupported_reason']})
            return {'success': False, 'error': module['unsupported_reason']}
        try:
            idx = int(index or 0)
        except (TypeError, ValueError):
            idx = 0
        steps = self._module_steps(module, action, platform)
        if not (0 <= idx < len(steps)):
            return {'success': False, 'error': 'Invalid step index'}
        step = steps[idx]
        self._emit_module_progress(module['key'], {'type': 'meta', 'text': f'Running: {step}'})
        args = self._module_step_args(step, platform)
        if args is None:
            self._emit_module_progress(module['key'], {'type': 'error', 'text': 'Python 3 not found on PATH.'})
            return {'success': False, 'error': 'Python 3 not found on PATH.'}
        code = self._run_module_step(module['key'], args)
        self._emit_module_progress(module['key'], {
            'type': 'done', 'success': code == 0,
            'error': '' if code == 0 else f'Step failed (exit {code})',
        })
        return {'success': code == 0}

    def _emit_module_progress(self, module_key: str, chunk: dict):
        payload = {'module': module_key, **chunk}
        self._enqueue_emit('_modulesProgressCallback', payload)

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

    def export_run_axolotl(self, output_dir: str) -> dict:
        """Export an Axolotl YAML config from the training config in an output folder."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            cfg_path = out / 'training_config.json'
            has_config = cfg_path.exists()
            if has_config:
                cfg = json.loads(cfg_path.read_text('utf-8'))
            else:
                # No config yet: still produce a usable YAML from placeholder
                # settings so the user can drop them into a real output folder.
                cfg = {
                    'model_name_or_path': 'HuggingFaceTB/SmolLM2-135M-Instruct',
                    'dataset_path': 'trl-lib/Capybara',
                    'output_dir': str(out),
                    'text_column': 'text',
                    'use_lora': True,
                    'use_qlora': False,
                }

            result = self.train_axolotl_write_config(str(out), json.dumps(cfg))
            if result.get('success'):
                result['has_config'] = has_config
            return result
        except Exception as e:
            logger.error('export_run_axolotl failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_unsloth(self, output_dir: str) -> dict:
        """Export a standalone Unsloth script from the training config in an output folder."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            cfg_path = out / 'training_config.json'
            has_config = cfg_path.exists()
            if has_config:
                cfg = json.loads(cfg_path.read_text('utf-8'))
            else:
                # No config yet: still produce a usable script from placeholder
                # settings so the user can drop them into a real output folder.
                cfg = {
                    'training_backend': 'unsloth',
                    'model_name_or_path': 'unsloth/SmolLM2-135M-Instruct-bnb-4bit',
                    'dataset_path': 'trl-lib/Capybara',
                    'output_dir': str(out),
                    'text_column': 'text',
                    'use_lora': True,
                    'use_qlora': False,
                }

            result = self.train_unsloth_write_config(str(out), json.dumps(cfg))
            if result.get('success'):
                result['has_config'] = has_config
            return result
        except Exception as e:
            logger.error('export_run_unsloth failed: %s', e)
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