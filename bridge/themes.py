"""bridge/themes.py — user themes persistence mixin."""

import json
import re
import shutil
import sys

from .core import logger


class ThemesMixin:
    """Read/write custom themes from user/themes/."""

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