#!/usr/bin/env python3
"""
main.py — PyWebView entry point for mama
Replaces the Electron main process (index.js + preload.js + ipc-handlers.js).
"""

import os
import sys
import json
import threading
import logging
from pathlib import Path

import webview

from http_server import start_http_server
from bridge import MamaApi

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
USER_SETTINGS_PATH = BASE_DIR / 'user' / 'settings.json'
TEMPLATE_SETTINGS_PATH = BASE_DIR / 'user' / 'template' / 'settings.json'

logging.basicConfig(level=logging.INFO, format='[mama] %(levelname)s %(message)s')
logger = logging.getLogger('mama')


def load_settings():
    """Load settings from user/settings.json, seeding from template if needed."""
    if not USER_SETTINGS_PATH.exists():
        if TEMPLATE_SETTINGS_PATH.exists():
            USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            raw = TEMPLATE_SETTINGS_PATH.read_text('utf-8')
            USER_SETTINGS_PATH.write_text(raw, 'utf-8')
        else:
            return None
    try:
        return json.loads(USER_SETTINGS_PATH.read_text('utf-8'))
    except Exception as e:
        logger.error('Failed to load settings: %s', e)
        return None


def get_startup_page():
    """Determine which HTML page to load based on setup flag."""
    settings = load_settings()
    if settings and settings.get('general settings', {}).get('setup', False):
        return 'public/setup.html'
    return 'public/index.html'


def main():
    # Start the static HTTP server on a random port
    port = start_http_server(str(BASE_DIR))
    logger.info('Static server started on port %d', port)

    # Create the API bridge
    api = MamaApi(user_settings_path=str(USER_SETTINGS_PATH),
                  base_dir=str(BASE_DIR),
                  server_port=port)

    # Determine initial page
    startup_page = get_startup_page()
    url = f'http://127.0.0.1:{port}/{startup_page}'

    logger.info('Starting pywebview window at %s', url)

    window = webview.create_window(
        title='mama',
        url=url,
        js_api=api,
        width=1200,
        height=800,
    )

    # Give the API a reference to the window for evaluate_js (streaming, etc.)
    api.set_window(window)

    webview.start(debug=True)


if __name__ == '__main__':
    main()