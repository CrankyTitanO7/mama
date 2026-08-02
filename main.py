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

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
USER_SETTINGS_PATH = BASE_DIR / 'user' / 'settings.json'
BACKUP_SETTINGS_PATH = BASE_DIR / 'user' / 'settings.json.bak'
TEMPLATE_SETTINGS_PATH = BASE_DIR / 'user' / 'template' / 'settings.json'

logging.basicConfig(level=logging.INFO, format='[mama] %(levelname)s %(message)s')
logger = logging.getLogger('mama')


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


def load_settings():
    """Load settings from user/settings.json, restoring from backup or template if needed."""
    if not USER_SETTINGS_PATH.exists():
        if BACKUP_SETTINGS_PATH.exists():
            logger.info('settings.json missing, restoring from backup')
            USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            raw = BACKUP_SETTINGS_PATH.read_text('utf-8')
            USER_SETTINGS_PATH.write_text(raw, 'utf-8')
        elif TEMPLATE_SETTINGS_PATH.exists():
            logger.info('settings.json and backup missing, creating from template')
            USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            raw = _strip_json_comments(TEMPLATE_SETTINGS_PATH.read_text('utf-8'))
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

    # argument parser for debug mode
    import argparse
    parser = argparse.ArgumentParser(description="the mama application: a GUI app for training ai based in pywebview")
    parser.add_argument("-d", "--debug", action="store_true", help="debug mode")
    parser.add_argument("--apply-update", metavar="MARKER",
                        help="internal: apply a staged update and exit (used by the auto-updater)")
    parser.add_argument("--check-update", action="store_true",
                        help="internal: run the update check, print the result and exit")
    args = parser.parse_args()

    # Internal updater mode: swap in the staged update, relaunch, exit.
    # Runs before pywebview is imported so the swapper never loads GUI frameworks.
    if args.apply_update:
        from updater import apply_update
        sys.exit(apply_update(args.apply_update))

    # Diagnostic mode: run the update check and print the raw result.
    if args.check_update:
        from updater import check_for_update
        print(json.dumps(check_for_update(), indent=2, default=str))
        sys.exit(0)

    # Crash recovery: if a staged update's owner process is gone, apply it now.
    from updater import recover_pending
    if recover_pending():
        sys.exit(0)

    import webview
    from http_server import start_http_server
    from bridge import MamaApi

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

    window.events.closed += api.on_quit

    webview.start(debug=args.debug)


if __name__ == '__main__':
    main()