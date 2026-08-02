# -*- mode: python ; coding: utf-8 -*-

import os
import platform
import sys

base_dir = os.path.dirname(os.path.abspath('main.py'))
system = platform.system()

datas = [
    (os.path.join(base_dir, 'public'), 'public'),
    (os.path.join(base_dir, 'components'), 'components'),
    (os.path.join(base_dir, 'user'), 'user'),
    (os.path.join(base_dir, 'docs'), 'docs'),
    (os.path.join(base_dir, 'styles.css'), '.'),
]

# Bundle CA certificates: without them every HTTPS request from the packaged
# app fails with SSLCertVerificationError (the updater cannot reach GitHub).
# certifi's hook normally covers this, but we add the pem explicitly so it is
# bundled even if the hook is missing.
try:
    import certifi
    cert_pem = certifi.where()
    datas.append((cert_pem, 'certifi'))
except Exception:
    print('WARNING: certifi not available at build time — the packaged app will',
          'not be able to verify HTTPS certificates. Install it: pip install certifi',
          file=sys.stderr)

icons_dir = os.path.join(base_dir, 'icons')
app_icon = os.path.join(icons_dir, 'icon.ico' if system == 'Windows' else 'icon.icns')

if system == 'Windows':
    platform_hiddenimports = ['webview.platforms.winforms']
elif system == 'Linux':
    platform_hiddenimports = ['webview.platforms.gtk']
elif system == 'Darwin':
    platform_hiddenimports = ['webview.platforms.cocoa']
else:
    print(f'WARNING: unknown platform {system}', file=sys.stderr)
    platform_hiddenimports = []

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=['webview'] + platform_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [], # Removed a.binaries and a.datas from here
    exclude_binaries=True, # Added this flag
    name='mama',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=app_icon,
)

if system == 'Windows':
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='mama',
    )

if system == 'Linux':
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='mama',
    )

if system == 'Darwin':
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='mama',
    )
    app = BUNDLE(
        coll,
        name='mama.app',
        icon=app_icon,
        bundle_identifier='com.crankytitano7.mama',
    )