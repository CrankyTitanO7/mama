"""bridge/core.py — the Core base of the pywebview JS API.

Holds the shared instance state (paths, window, emit queue) and the
generic helpers every domain mixin relies on: the script runner, OS info,
JSON comment stripping, JSON-safety conversion and the thread-safe emit
queue. The other bridge/*.py modules are mixins composed into MamaApi in
bridge/__init__.py.
"""

import os
import sys
import json
import subprocess
import shutil
import platform
import threading
import logging
from pathlib import Path
from typing import Optional

import updater
import paths

from .env import clean_subprocess_env

logger = logging.getLogger('mama.bridge')


class Core:
    """Shared state + generic helpers for the MamaApi mixins."""

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

    # ── Script runner ────────────────────────────────────────────────────────

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

    # ── OS info helper ───────────────────────────────────────────────────────

    def _get_os_info(self) -> dict:
        """Quick OS detection for install script."""
        if sys.platform == 'win32':
            return {'os_family': 'windows', 'distro': 'unknown'}
        elif sys.platform == 'darwin':
            distro = 'unknown'
            try:
                subprocess.run(['which', 'brew'], capture_output=True, timeout=5,
                               env=clean_subprocess_env())
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

    # ── JSON helpers ─────────────────────────────────────────────────────────

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

    @staticmethod
    def _make_json_safe(obj):
        """Recursively convert numpy types to native Python types for JSON safety."""
        if isinstance(obj, dict):
            return {k: Core._make_json_safe(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [Core._make_json_safe(v) for v in obj]
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

    def _emit_training_progress(self, chunk: dict):
        """Emit training progress to the frontend."""
        self._enqueue_emit('_trainingProgressCallback', chunk)

    def _emit_model_progress(self, chunk: dict):
        """Emit model management progress to the frontend."""
        self._enqueue_emit('_modelProgressCallback', chunk)

    def _emit_module_progress(self, module_key: str, chunk: dict):
        """Emit add-on module install/uninstall progress to the frontend."""
        payload = {'module': module_key, **chunk}
        self._enqueue_emit('_modulesProgressCallback', payload)

    # ── Path helpers ─────────────────────────────────────────────────────────

    def _models_dir(self) -> Path:
        """User-writable directory for downloaded models.

        In development this is the repo's models/ folder; in frozen builds
        the app bundle may be read-only or replaced on update, so models live
        in a per-user data directory instead.
        """
        if getattr(sys, 'frozen', False):
            return self._data_dir / 'models'
        return self._base_dir / 'models'
