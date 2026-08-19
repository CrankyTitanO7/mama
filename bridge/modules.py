"""bridge/modules.py — add-on module install/uninstall mixin (incl. grui).

Specs live in modules/definitions/ — see modules/README.md. This mixin is
the single integration point between the frontend and the registry.
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
from typing import Optional

from modules import by_key as module_by_key, all_modules as all_module_specs
from modules.spec import DELETE_INSTALL_DIR

from .core import logger
from .env import clean_subprocess_env


class ModulesMixin:
    """Install/uninstall/run the declarative add-on modules."""

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
                    ['wsl', '--status'], capture_output=True, text=True, timeout=10,
                    env=clean_subprocess_env())
                if check.returncode == 0:
                    return 'wsl'
            except Exception:
                pass
            return 'native_windows'
        return 'other'

    # ── Module storage (repo-based modules) ────────────────────────────────

    def _addon_root(self) -> Path:
        """Writable root for cloned add-on modules.

        In development this is the repo's addons/ folder; in frozen builds
        the bundle may be read-only or replaced on update, so clones live
        under the per-user data directory instead.
        """
        if getattr(sys, 'frozen', False):
            return self._data_dir / 'addons'
        return self._base_dir / 'addons'

    def _module_install_path(self, spec) -> Optional[Path]:
        """Absolute path where a repo-based module lives (None for pip modules)."""
        if not spec.install_dir:
            return None
        return self._addon_root() / spec.install_dir

    def _module_uv_path(self) -> Optional[str]:
        """Path to `uv` if it is on PATH (cached). Used when available to
        install packages with a shared global cache."""
        if hasattr(self, '_module_uv_cache'):
            return self._module_uv_cache
        uv = None
        try:
            uv = shutil.which('uv')
        except Exception:
            uv = None
        self._module_uv_cache = uv
        return uv

    def _module_scripts_dir(self, python: str) -> Optional[Path]:
        """Scripts dir (bin/ or Scripts/) of the given Python environment."""
        if not hasattr(self, '_module_scripts_cache'):
            self._module_scripts_cache = {}
        cached = self._module_scripts_cache.get(python)
        if cached is not None:
            return cached
        scripts = None
        try:
            result = subprocess.run(
                [python, '-c',
                 'import sysconfig; print(sysconfig.get_path("scripts"))'],
                capture_output=True, text=True, timeout=30,
                env=clean_subprocess_env())
            if result.returncode == 0 and result.stdout.strip():
                scripts = Path(result.stdout.strip())
        except Exception as e:
            logger.debug('scripts dir probe failed for %s: %s', python, e)
        self._module_scripts_cache[python] = scripts
        return scripts

    def _module_version(self, python: str) -> Optional[tuple]:
        """(major, minor, micro) of the given Python environment (cached)."""
        if not hasattr(self, '_module_version_cache'):
            self._module_version_cache = {}
        cached = self._module_version_cache.get(python)
        if cached is not None:
            return cached
        version = None
        try:
            result = subprocess.run(
                [python, '-c',
                 'import sys; print("%d.%d.%d" % sys.version_info[:3])'],
                capture_output=True, text=True, timeout=30,
                env=clean_subprocess_env())
            if result.returncode == 0 and result.stdout.strip():
                version = tuple(int(x) for x in result.stdout.strip().split('.')[:3])
        except Exception as e:
            logger.debug('version probe failed for %s: %s', python, e)
        self._module_version_cache[python] = version
        return version

    def _prepare_module_dir(self, spec, platform) -> bool:
        """Clone repo for repo-based modules; emit progress.

        The install dir holds repository files only — packages are installed
        into the shared environment (project .venv or system python), so no
        local venv is created here. Returns True on success (or if nothing
        needs doing). pip-only modules skip right through.
        """
        if not spec.repo_url:
            return True
        install_path = self._module_install_path(spec)
        if install_path is None:
            return True
        try:
            if not install_path.exists():
                install_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = install_path.parent / ('.' + spec.key + '.tmp')
                if tmp.exists():
                    shutil.rmtree(str(tmp))
                self._emit_module_progress(
                    spec.key, {'type': 'meta', 'text': f'git clone {spec.repo_url}'})
                code = self._run_module_step(spec.key, spec.clone_flags(str(tmp)),
                                             cwd=str(install_path.parent))
                if code != 0:
                    return False
                tmp.rename(install_path)
        except Exception as e:
            logger.error('prepare_module_dir failed for %s: %s', spec.key, e)
            self._emit_module_progress(spec.key, {'type': 'error', 'text': str(e)})
            return False
        return True

    def _remove_module_dir(self, spec) -> bool:
        """Delete a repo-based module's install directory entirely."""
        install_path = self._module_install_path(spec)
        if not install_path or not install_path.exists():
            return True
        try:
            shutil.rmtree(str(install_path))
            self._emit_module_progress(
                spec.key, {'type': 'meta', 'text': f'removed {install_path}'})
            return True
        except Exception as e:
            logger.error('remove_module_dir failed for %s: %s', spec.key, e)
            return False

    # ── Step interpretation ───────────────────────────────────────────────

    @staticmethod
    def _module_install_steps(spec, platform: str) -> list:
        if spec.key == 'unsloth' and platform == 'macos':
            from modules.definitions.unsloth import UNSLOTH_MACOS_INSTALL_STEPS
            return list(UNSLOTH_MACOS_INSTALL_STEPS)
        return list(spec.install_steps)

    @staticmethod
    def _module_steps(spec, action: str, platform: str) -> list:
        if action == 'uninstall':
            return list(spec.uninstall_steps)
        return ModulesMixin._module_install_steps(spec, platform)

    def _module_python(self, spec, platform: str) -> Optional[str]:
        """Interpreter steps run under (None for WSL).

        Everything installs into ONE shared environment — the same python
        the app uses for training: the open project's .venv if it has one,
        otherwise a real Python. No per-module virtualenvs exist.
        """
        if platform in ('linux', 'macos', 'native_windows'):
            return self._get_training_python() or self._get_python()
        return None

    def _module_step_args(self, spec, step: str, platform: str):
        """Turn one step into (argv, cwd|None). None means Python missing."""
        if platform == 'wsl':
            inner = step
            if inner.startswith('pip '):
                inner = 'python3 -m pip' + inner[len('pip'):]
            # WSL steps run in shell; cwd applies below.
            return (['wsl', '-e', 'sh', '-lc', inner],
                    str(self._module_install_path(spec)) if spec.install_dir else None)
        python = self._module_python(spec, platform)
        if not python:
            return None
        import shlex
        parts = shlex.split(step)
        if parts and parts[0] in ('pip', 'pip3'):
            # Prefer uv when available: one shared global cache means the
            # heavy deps (torch, PySide6, …) are not re-downloaded and are
            # hardlinked across installs. Falls back to python -m pip.
            uv = self._module_uv_path()
            if uv:
                return ([uv, 'pip', parts[1], '--python', python] + parts[2:],
                        str(self._module_install_path(spec)) if spec.install_dir else None)
            return ([python, '-m', 'pip'] + parts[1:],
                    str(self._module_install_path(spec)) if spec.install_dir else None)
        if parts and parts[0] in ('python', 'python3'):
            return ([python] + parts[1:],
                    str(self._module_install_path(spec)) if spec.install_dir else None)
        return (parts, str(self._module_install_path(spec)) if spec.install_dir else None)

    # ── Installed check ───────────────────────────────────────────────────

    def _module_installed(self, spec, platform: str) -> bool:
        try:
            if spec.is_installed is not None:
                return bool(spec.is_installed(spec, self))
            if platform == 'wsl':
                if spec.import_name:
                    cmd = ['wsl', '-e', 'python3', '-c',
                           f'import {spec.import_name}; print("ok")']
                else:
                    return False
            else:
                python = self._module_python(spec, platform)
                if not python:
                    return False
                if spec.import_name:
                    cmd = [python, '-c',
                           f'import {spec.import_name}; print("ok")']
                elif spec.console_script:
                    # Console scripts live in the shared environment's
                    # scripts dir (bin/ or Scripts/).
                    scripts_dir = self._module_scripts_dir(python)
                    if not scripts_dir:
                        return False
                    script = spec.console_script
                    if sys.platform == 'win32':
                        script += '.exe'
                    return (scripts_dir / script).exists()
                else:
                    return False
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=60,
                env=clean_subprocess_env())
            return result.returncode == 0
        except Exception as e:
            logger.debug('module installed check failed for %s: %s', spec.key, e)
            return False

    # ── Step runner ───────────────────────────────────────────────────────

    def _run_module_step(self, module_key: str, args: list,
                         cwd: str = None) -> int:
        """Run one module step, streaming its output to the frontend."""
        try:
            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=cwd,
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
        spec = module_by_key(key or '')
        if not spec:
            return {'success': False, 'error': f'Unknown module: {key}'}
        platform = self._module_platform()
        if platform not in spec.platforms:
            self._emit_module_progress(spec.key, {'type': 'error', 'text': spec.unsupported_reason})
            return {'success': False, 'error': spec.unsupported_reason}

        if action == 'install' and not self._prepare_module_dir(spec, platform):
            return {'success': False, 'error': 'Module setup failed (see output).'}

        if (action == 'install' and platform != 'wsl'
                and (spec.min_python or spec.max_python)):
            python = self._module_python(spec, platform)
            version = self._module_version(python) if python else None
            if version is None:
                self._emit_module_progress(spec.key, {
                    'type': 'error',
                    'text': f'Could not determine the shared environment\'s Python version.'})
                return {'success': False, 'error': 'Python version check failed.'}
            if not spec.version_ok(version):
                text = (f'{spec.name} requires Python {spec.version_gate_text()}, '
                        f'but the shared environment runs {version[0]}.{version[1]}.'
                        f' Open a project with a newer .venv (or a newer Python on '
                        f'PATH) and try again.')
                self._emit_module_progress(spec.key, {'type': 'error', 'text': text})
                return {'success': False, 'error': text}

        steps = self._module_steps(spec, action, platform)
        label = 'Install' if action == 'install' else 'Uninstall'
        self._emit_module_progress(spec.key, {'type': 'meta', 'text': f'{label}ing {spec.name}...'})

        for i, step in enumerate(steps, 1):
            self._emit_module_progress(spec.key, {'type': 'meta', 'text': f'Step {i}/{len(steps)}: {step}'})
            if step == DELETE_INSTALL_DIR:
                if not self._remove_module_dir(spec):
                    self._emit_module_progress(spec.key, {
                        'type': 'done', 'success': False,
                        'error': f'{label} failed at step {i}/{len(steps)}.',
                    })
                    return {'success': False, 'error': 'Could not remove install directory.'}
            else:
                resolved = self._module_step_args(spec, step, platform)
                if resolved is None:
                    self._emit_module_progress(spec.key, {'type': 'error', 'text': 'Python 3 not found on PATH.'})
                    return {'success': False, 'error': 'Python 3 not found on PATH.'}
                args, cwd = resolved
                code = self._run_module_step(spec.key, args, cwd=cwd)
                if code != 0:
                    self._emit_module_progress(spec.key, {
                        'type': 'done', 'success': False,
                        'error': f'{label} failed at step {i}/{len(steps)}.',
                    })
                    return {'success': False, 'error': f'Step {i} failed (exit {code})'}
            self._emit_module_progress(spec.key, {'type': 'step', 'current': i, 'total': len(steps)})

        self._emit_module_progress(spec.key, {'type': 'done', 'success': True})
        return {'success': True}

    def modules_get(self) -> dict:
        """Return module list with platform support + installed status."""
        platform = self._module_platform()
        modules = []
        for spec in all_module_specs():
            supported = platform in spec.platforms
            modules.append({
                'key': spec.key,
                'name': spec.name,
                'description': spec.description,
                'platforms': list(spec.platforms),
                'platform': platform,
                'supported': supported,
                'unsupported_reason': spec.unsupported_reason if not supported else '',
                'installed': self._module_installed(spec, platform) if supported else False,
                'install_steps': self._module_steps(spec, 'install', platform) if supported else [],
                'uninstall_steps': self._module_steps(spec, 'uninstall', platform) if supported else [],
                'tags': list(spec.tags),
                'repo_url': spec.repo_url,
                'install_dir': str(self._module_install_path(spec)) if spec.install_dir else '',
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
        spec = module_by_key(key or '')
        if not spec:
            return {'success': False, 'error': f'Unknown module: {key}'}
        platform = self._module_platform()
        if platform not in spec.platforms:
            self._emit_module_progress(spec.key, {'type': 'error', 'text': spec.unsupported_reason})
            return {'success': False, 'error': spec.unsupported_reason}
        try:
            idx = int(index or 0)
        except (TypeError, ValueError):
            idx = 0
        steps = self._module_steps(spec, action, platform)
        if not (0 <= idx < len(steps)):
            return {'success': False, 'error': 'Invalid step index'}
        step = steps[idx]
        self._emit_module_progress(spec.key, {'type': 'meta', 'text': f'Running: {step}'})
        if step == DELETE_INSTALL_DIR:
            ok = self._remove_module_dir(spec)
            self._emit_module_progress(spec.key, {
                'type': 'done', 'success': ok,
                'error': '' if ok else 'Could not remove install directory.',
            })
            return {'success': ok}
        resolved = self._module_step_args(spec, step, platform)
        if resolved is None:
            self._emit_module_progress(spec.key, {'type': 'error', 'text': 'Python 3 not found on PATH.'})
            return {'success': False, 'error': 'Python 3 not found on PATH.'}
        args, cwd = resolved
        code = self._run_module_step(spec.key, args, cwd=cwd)
        self._emit_module_progress(spec.key, {
            'type': 'done', 'success': code == 0,
            'error': '' if code == 0 else f'Step failed (exit {code})',
        })
        return {'success': code == 0}

    # ── grui recorder add-on (fine-tune step 2) ──────────────────────────────

    def _grui_spec(self):
        """The grui add-on ModuleSpec (None if the definition is missing)."""
        from modules import by_key as _by_key
        return _by_key('grui')

    def _grui_console(self) -> Optional[str]:
        """Absolute path to grui's console script in the shared environment."""
        spec = self._grui_spec()
        if not spec:
            return None
        python = self._module_python(spec, self._module_platform())
        if not python:
            return None
        scripts_dir = self._module_scripts_dir(python)
        if not scripts_dir:
            return None
        name = 'grui.exe' if sys.platform == 'win32' else 'grui'
        console = scripts_dir / name
        return str(console) if console.exists() else None

    def grui_status(self) -> dict:
        """Install status of the grui recorder add-on (fine-tune step 2)."""
        spec = self._grui_spec()
        if not spec:
            return {'success': False, 'error': 'grui module definition not found.'}
        platform = self._module_platform()
        supported = platform in spec.platforms
        installed = self._module_installed(spec, platform) if supported else False
        install_path = self._module_install_path(spec)
        return {
            'success': True,
            'installed': installed,
            'supported': supported,
            'unsupported_reason': spec.unsupported_reason if not supported else '',
            'install_dir': str(install_path) if install_path else '',
            'console': self._grui_console(),
            'python': self._module_python(spec, platform),
        }

    def grui_launch(self) -> dict:
        """Launch the grui recorder app (PySide6 GUI) detached from mama."""
        console = self._grui_console()
        if not console:
            return {'success': False,
                    'error': 'grui is not installed. Install it from the Modules page first.'}
        spec = self._grui_spec()
        install_dir = self._module_install_path(spec) if spec else None
        try:
            subprocess.Popen(
                [console],
                cwd=str(install_dir) if install_dir else None,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                env=clean_subprocess_env(),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
            )
            return {'success': True, 'console': console}
        except Exception as e:
            logger.error('grui launch failed: %s', e)
            return {'success': False, 'error': str(e)}
