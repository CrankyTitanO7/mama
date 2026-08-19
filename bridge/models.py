"""bridge/models.py — model management mixin (download / list / check / merge)."""

import os
import sys
import json
import subprocess
import threading
import shutil
from pathlib import Path
from typing import Optional

from .core import logger
from .env import clean_subprocess_env


class ModelsMixin:
    """Hugging Face model download, listing, compatibility checks, delete/move."""

    _model_download_process: Optional[subprocess.Popen] = None

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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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
                env=clean_subprocess_env(),
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
