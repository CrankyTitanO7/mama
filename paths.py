#!/usr/bin/env python3
"""
paths.py — resolves the writable user-data directory and the bundled
(read-only) resources directory.

Frozen (PyInstaller) builds keep every file under a read-only location
(AppImage mount, .app bundle, _internal/ folder). Anything the app creates
or edits — settings, themes, recents, logs — must live in a per-user data
directory instead:

    macOS:   ~/Library/Application Support/mama
    Windows: %APPDATA%/mama
    Linux:   $XDG_DATA_HOME/mama (default ~/.local/share/mama)

In development (running from the repo) the repo root is used, so all
paths behave exactly as before.
"""

import os
import sys
from pathlib import Path

APP_NAME = 'mama'


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return bool(getattr(sys, 'frozen', False))


def app_data_dir() -> Path:
    """Writable per-user data directory (repo root in development)."""
    if not is_frozen():
        return Path(__file__).resolve().parent
    if sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support' / APP_NAME
    elif sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA') or (Path.home() / 'AppData' / 'Roaming')) / APP_NAME
    else:
        base = Path(os.environ.get('XDG_DATA_HOME') or (Path.home() / '.local' / 'share')) / APP_NAME
    return base


def bundle_dir() -> Path:
    """Directory of bundled (read-only) resources, e.g. sys._MEIPASS."""
    if is_frozen():
        try:
            return Path(sys._MEIPASS)
        except AttributeError:
            pass
    return Path(__file__).resolve().parent
