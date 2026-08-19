"""bridge/examples.py — bundled example projects mixin."""

import sys
import json
import shutil
from pathlib import Path

from modules import by_key as module_by_key

from .core import logger


class ExamplesMixin:
    """Discover and open bundled example projects.

    Each example is a folder with project.json marked "example": true and
    a ``soup:`` metadata block (model, dataset, fetch/train commands). Data
    is never bundled — examples pull it from the HF Hub at run time.
    """

    def _examples_root(self) -> Path:
        """Where bundled example projects live.

        In development this is the repo's examples/ folder; in frozen builds
        examples ship inside the bundle (main.spec bundles them like docs/).
        """
        if getattr(sys, 'frozen', False):
            try:
                return Path(sys._MEIPASS) / 'examples'
            except AttributeError:
                pass
        return self._base_dir / 'examples'

    def examples_list(self) -> dict:
        """Discover bundled example projects (any examples/<kind>/<key>/)."""
        examples = []
        root = self._examples_root()
        if root.is_dir():
            for kind_dir in sorted(root.iterdir()):
                if not kind_dir.is_dir():
                    continue
                for proj in sorted(kind_dir.glob('*/project.json')):
                    try:
                        meta = json.loads(proj.read_text('utf-8'))
                    except Exception as e:
                        logger.warning('examples_list: skipping %s: %s', proj, e)
                        continue
                    if not meta.get('example'):
                        continue
                    folder = proj.parent
                    soup = meta.get('soup') or {}
                    examples.append({
                        'key': folder.name,
                        'kind': kind_dir.name,
                        'name': meta.get('name') or folder.name,
                        'description': meta.get('description') or '',
                        'model': soup.get('model', ''),
                        'dataset': soup.get('dataset', ''),
                        'fetch': soup.get('fetch', ''),
                        'train': soup.get('train', ''),
                        'note': soup.get('note', ''),
                        'hasConfig': (folder / 'soup.yaml').is_file(),
                    })
        soup_installed = False
        try:
            soup_spec = module_by_key('soup')
            if soup_spec:
                soup_installed = self._module_installed(
                    soup_spec, self._module_platform())
        except Exception as e:
            logger.debug('examples_list soup check failed: %s', e)
        return {'success': True, 'examples': examples,
                'soupAddonInstalled': soup_installed}

    def examples_open(self, key: str) -> dict:
        """Open a bundled example as the current project.

        In development the example is opened in place (it is the user's own
        checkout); in frozen builds the bundle is read-only/expired on
        update, so a working copy is created under the per-user data dir
        first — training writes then survive app updates.
        """
        entry = next((ex for ex in self.examples_list().get('examples', [])
                      if ex['key'] == key), None)
        if not entry:
            return {'success': False, 'error': f'Unknown example: {key}'}
        src = self._examples_root() / entry['kind'] / entry['key']
        if not src.is_dir():
            return {'success': False, 'error': f'Example folder missing: {src}'}
        copied = False
        folder = src
        if getattr(sys, 'frozen', False):
            dest = self._data_dir / 'examples' / entry['key']
            if not dest.exists():
                try:
                    shutil.copytree(str(src), str(dest))
                    copied = True
                except Exception as e:
                    logger.error('examples_open copy failed for %s: %s', key, e)
                    return {'success': False,
                            'error': f'Could not copy the example: {e}'}
            folder = dest
        if not self.project_open_folder(str(folder)):
            return {'success': False, 'error': 'Could not open the example folder.'}
        return {'success': True, 'path': str(folder), 'copied': copied}
