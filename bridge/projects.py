"""bridge/projects.py — project/folder explorer + recents + whiteboard mixin."""

import os
import sys
import json
import subprocess
import shutil
import time
from pathlib import Path
from typing import Optional

from .core import logger
from .env import clean_subprocess_env

# Header written on top of whiteboard graphs (graph.json). Uses // comments so
# the file stays valid for whiteboard_read(), which strips them, while reading
# clearly for humans.
_WHITEBOARD_HEADER = (
    '  // mama — multimodel whiteboard graph\n'
    '  // This file describes a whiteboard design: widgets (model, script,\n'
    '  // dataset, format) and the data-flow connections between their\n'
    '  // anchors. Annotations are freehand drawings / notes, not part of the\n'
    '  // executable graph.\n'
)


class ProjectsMixin:
    """Recents persistence, folder picking/listing, project.json, whiteboard."""

    # ── Recents ──────────────────────────────────────────────────────────────

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

    # ── Native pickers ───────────────────────────────────────────────────────

    def project_pick_folder(self) -> Optional[str]:
        """Open a native folder picker dialog."""
        try:
            if sys.platform == 'darwin':
                result = subprocess.run(
                    ['osascript', '-e', 'return POSIX path of (choose folder with prompt "Select Project Folder")'],
                    capture_output=True, text=True, timeout=120,
                    env=clean_subprocess_env()
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
                # macOS 'choose file ... of type' expects UTIs, not extensions.
                # An unrecognized UTI makes the dialog show no selectable files
                # (folders only). Only filter when the UTI is reliably registered;
                # otherwise fall back to an unfiltered dialog.
                _macos_utis = {
                    'json': 'public.json',
                    'txt': 'public.plain-text',
                    'csv': 'public.comma-separated-values-text',
                }
                cmd = 'return POSIX path of (choose file with prompt "Choose File")'
                if patterns:
                    ext = patterns.split(',')[0].strip().lstrip('.')
                    uti = _macos_utis.get(ext.lower())
                    if uti:
                        cmd = (
                            'return POSIX path of '
                            f'(choose file with prompt "Choose File" '
                            f'of type {{"{uti}"}})'
                        )
                result = subprocess.run(
                    ['osascript', '-e', cmd],
                    capture_output=True, text=True, timeout=120,
                    env=clean_subprocess_env()
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            else:
                if not self._window:
                    return None
                import webview
                if patterns:
                    exts = ['.' + p.strip().lstrip('.') for p in patterns.split(',') if p.strip()]
                    result = self._window.create_file_dialog(
                        webview.OPEN_DIALOG,
                        file_types=[('Allowed files', exts)]
                    )
                else:
                    result = self._window.create_file_dialog(webview.OPEN_DIALOG)
                if result and len(result) > 0:
                    return result[0]
        except Exception as e:
            logger.error('File picker failed: %s', e)
        return None

    # ── Folder operations ────────────────────────────────────────────────────

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
                subprocess.Popen(['open', str(folder)], env=clean_subprocess_env())
            elif sys.platform == 'win32':
                subprocess.Popen(['explorer', str(folder)], env=clean_subprocess_env())
            else:
                subprocess.Popen(['xdg-open', str(folder)], env=clean_subprocess_env())
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

    # ── Project init ─────────────────────────────────────────────────────────

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

    def project_json_read_file(self, file_path: str) -> dict:
        """Read and parse an arbitrary JSON file (e.g. a training config)."""
        try:
            if not file_path:
                return {'success': False, 'error': 'No file path provided.'}
            path = Path(file_path)
            if not path.exists():
                return {'success': False, 'error': 'File not found.'}
            return {'success': True, 'data': json.loads(path.read_text('utf-8'))}
        except Exception as e:
            logger.error('project_json_read_file failed: %s', e)
            return {'success': False, 'error': str(e)}

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

    # ── Whiteboard ───────────────────────────────────────────────────────────

    def whiteboard_save(self, folder_path: str, data_json: str) -> dict:
        """Save a whiteboard graph to <folder>/graph.json (human-readable).

        The file is plain pretty-printed JSON with a // comment header that
        explains the format; whiteboard_read() strips the comments before
        parsing. Returns {'success': bool, 'path': str, 'error': str}.
        """
        try:
            if not folder_path:
                return {'success': False, 'error': 'No folder path provided.'}
            graph = json.loads(data_json)
            body = json.dumps(graph, indent=2, ensure_ascii=False)
            body = body.replace('{\n', '{\n' + _WHITEBOARD_HEADER, 1)
            folder = Path(folder_path)
            folder.mkdir(parents=True, exist_ok=True)
            graph_path = folder / 'graph.json'
            graph_path.write_text(body, 'utf-8')
            return {'success': True, 'path': str(graph_path)}
        except (json.JSONDecodeError, TypeError) as e:
            logger.error('whiteboard_save failed to serialize: %s', e)
            return {'success': False, 'error': 'Invalid graph data: %s' % e}
        except OSError as e:
            logger.error('whiteboard_save failed: %s', e)
            return {'success': False, 'error': str(e)}

    def whiteboard_read(self, path: str) -> dict:
        """Read a whiteboard graph from a folder or a graph.json file path.

        Accepts either a project folder (reads <folder>/graph.json) or the
        full path to a graph file. Returns {'success': bool, 'data': dict}.
        """
        try:
            if not path:
                return {'success': False, 'error': 'No path provided.'}
            graph_path = Path(path)
            if graph_path.is_dir() or graph_path.suffix.lower() != '.json':
                graph_path = graph_path / 'graph.json'
            if not graph_path.exists():
                return {'success': False, 'error': 'No graph.json in that location.'}
            text = self._strip_json_comments(graph_path.read_text('utf-8'))
            return {'success': True, 'data': json.loads(text), 'path': str(graph_path)}
        except (json.JSONDecodeError, OSError) as e:
            logger.error('whiteboard_read failed: %s', e)
            return {'success': False, 'error': str(e)}

    # ── project.json / .venv creation ────────────────────────────────────────

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
                env=clean_subprocess_env(),
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
