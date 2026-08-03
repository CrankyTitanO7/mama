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

binaries = []

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
    # pythonnet/clr_loader must be bundled completely (runtime dir, .deps.json,
    # native ClrLoader.dll for the netfx loader); the shipped hooks only pick
    # up Python.Runtime.dll and may miss the rest, which makes `import clr`
    # fail with "Failed to resolve Python.Runtime.Loader.Initialize".
    try:
        from PyInstaller.utils.hooks import collect_all
        pn_datas, pn_binaries, pn_hidden = collect_all('pythonnet')
        cl_datas, cl_binaries, cl_hidden = collect_all('clr_loader')
        datas += pn_datas + cl_datas
        binaries += pn_binaries + cl_binaries
        platform_hiddenimports += pn_hidden + cl_hidden
    except Exception as e:
        print('WARNING: could not collect pythonnet/clr_loader files:', e, file=sys.stderr)
elif system == 'Linux':
    platform_hiddenimports = ['webview.platforms.gtk', 'gi']
    # Note: we deliberately do NOT bundle the WebKit2/Soup gi typelibs or the
    # webkit2gtk shared libraries. PyInstaller's gi runtime hook points
    # GI_TYPELIB_PATH at the bundle, but the bundled Ubuntu-built webkit
    # libraries cannot load on other distros (e.g. they link Ubuntu-only ICU
    # sonames), which surfaces as "Could not locate symbol
    # webkit_get_major_version". Instead the app must use the WebKit2GTK
    # installed on the user's system (libwebkit2gtk-4.1-0 + gir1.2-webkit2-4.1
    # on Debian/Ubuntu, webkit2gtk-4.1 on Arch).
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