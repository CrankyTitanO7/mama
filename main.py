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

import paths

# ── Paths ─────────────────────────────────────────────────────────────────────
# BASE_DIR is the bundle's resource root (static files, scripts, templates).
# In frozen builds it may be read-only (AppImage mount, .app bundle,
# Program Files) so user data — settings, backups, themes, recents — lives
# in a per-user data directory instead (see paths.py).
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = paths.app_data_dir()
BUNDLE_DIR = paths.bundle_dir()

USER_SETTINGS_PATH = DATA_DIR / 'user' / 'settings.json'
BACKUP_SETTINGS_PATH = DATA_DIR / 'user' / 'settings.json.bak'
TEMPLATE_SETTINGS_PATH = BUNDLE_DIR / 'user' / 'template' / 'settings.json'

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
        try:
            USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            if BACKUP_SETTINGS_PATH.exists():
                logger.info('settings.json missing, restoring from backup')
                raw = BACKUP_SETTINGS_PATH.read_text('utf-8')
                USER_SETTINGS_PATH.write_text(raw, 'utf-8')
            elif TEMPLATE_SETTINGS_PATH.exists():
                logger.info('settings.json and backup missing, creating from template')
                raw = _strip_json_comments(TEMPLATE_SETTINGS_PATH.read_text('utf-8'))
                USER_SETTINGS_PATH.write_text(raw, 'utf-8')
        except OSError as e:
            logger.error('Could not seed settings file: %s', e)
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


def _prepare_windows_clr() -> None:
    """Frozen Windows builds: make pythonnet loadable, fail with guidance.

    Two things commonly break `import clr` in a frozen build:

    1. Files extracted from a downloaded zip carry Windows' "Mark of the
       Web" zone flag; the .NET runtime refuses to load such assemblies,
       so clr_loader fails to resolve Python.Runtime.Loader.Initialize.
    2. The machine's .NET Framework is too old (4.7.2+ is required).

    Clearing the zone flag from the bundled .NET files and importing clr
    early makes the real failure surface as a readable dialog instead of a
    pywebview traceback.
    """
    if sys.platform != 'win32' or not getattr(sys, 'frozen', False):
        return

    def try_import_clr():
        try:
            import clr  # noqa: F401
            return True
        except Exception as e:
            logger.error('pythonnet failed to initialize: %s', e)
            return False

    if try_import_clr():
        return

    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        for sub in ('pythonnet', 'clr_loader', 'webview'):
            d = BUNDLE_DIR / sub
            if d.is_dir():
                for p in d.rglob('*'):
                    if p.is_file():
                        kernel32.DeleteFileW(str(p) + ':Zone.Identifier')
    except Exception:
        pass

    if try_import_clr():
        logger.info('pythonnet loaded after clearing Mark-of-the-Web flags')
        return

    try:
        import ctypes
        msg = (
            'mama could not initialize its Windows GUI framework.\n\n'
            'If you downloaded mama as a zip, unblock the extracted files:\n'
            '  right-click the mama folder > Properties > Unblock\n'
            '  (or in the folder run: Get-ChildItem -Recurse | Unblock-File)\n\n'
            'If that does not help, install Microsoft .NET Framework 4.8:\n'
            '  https://dotnet.microsoft.com/download/dotnet-framework/net48'
        )
        ctypes.windll.user32.MessageBoxW(0, msg, 'mama', 0x10)
    except Exception:
        pass
    raise SystemExit(1)


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

    # Ensure HTTPS works from the packaged app (uses the bundled certifi CA bundle).
    from updater import _setup_ssl_certs
    _setup_ssl_certs()

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

    # Windows frozen builds: unblock + preload pythonnet (clear error if it fails)
    _prepare_windows_clr()

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