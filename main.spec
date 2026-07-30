# -*- mode: python ; coding: utf-8 -*-

import os

base_dir = os.path.dirname(os.path.abspath('main.py'))

datas = [
    # Public HTML/CSS/JS
    (os.path.join(base_dir, 'public'), 'public'),
    (os.path.join(base_dir, 'components'), 'components'),
    (os.path.join(base_dir, 'user'), 'user'),
    (os.path.join(base_dir, 'docs'), 'docs'),
    (os.path.join(base_dir, 'styles.css'), '.'),  # root-level CSS
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'webview',
        'webview.platforms.cocoa',  # Changed from winforms to cocoa for macOS
    ],
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
    a.binaries,
    a.datas,
    [],
    name='mama',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# --- ADDED: macOS App Bundle wrapper ---
app = BUNDLE(
    exe,
    name='mama.app',
    icon=None,  # Replace with 'icon.icns' path if you have an app icon
    bundle_identifier='com.crankytitano7.mama',
)