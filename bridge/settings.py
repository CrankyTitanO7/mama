"""bridge/settings.py — user settings persistence mixin."""

import json
import shutil
from typing import Optional

from .core import logger


class SettingsMixin:
    """Read/write/reset of user/settings.json with backup + template seeding."""

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
