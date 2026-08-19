"""bridge/training.py — training (fine-tuning) mixin: TRL/Axolotl/Unsloth/Custom backends."""

import os
import sys
import json
import subprocess
import threading
import time
import signal
from pathlib import Path
from typing import Optional

from .core import logger
from .env import clean_subprocess_env


class TrainingMixin:
    """Launch/pause/resume/cancel training runs and inspect their output."""

    _training_process: Optional[subprocess.Popen] = None
    _training_thread: Optional[threading.Thread] = None
    _training_output_dir: Optional[str] = None

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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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

    # ── Control + status ─────────────────────────────────────────────────────

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

    # ── Platform checks (training-specific) ──────────────────────────────────

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
