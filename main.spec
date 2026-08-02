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
    # pywebview's GTK backend loads WebKit2GTK through PyGObject (`gi`).
    # PyInstaller's shipped gi.repository hooks cover Gtk/Gdk/Gio/GLib but
    # not WebKit2, so collect its typelib (and the shared library it refers
    # to) at build time; otherwise the frozen app fails with
    # "No module named 'gi'" / "WebKit2 cannot be loaded".
    try:
        from PyInstaller.utils.hooks.gi import GiModuleInfo
        for gi_module, gi_version in (('WebKit2', '4.1'), ('Soup', '3.0')):
            gi_info = GiModuleInfo(gi_module, gi_version)
            if not gi_info.available:
                print(f'WARNING: gi typelib {gi_module}-{gi_version} not found on this '
                      'build machine; the AppImage may not be able to load WebKit2GTK. '
                      'Install PyGObject and the webkit2gtk/gir packages (e.g. '
                      'libwebkit2gtk-4.1-dev gir1.2-webkit2-4.1) before building.',
                      file=sys.stderr)
                continue
            gi_binaries, gi_datas, gi_hidden = gi_info.collect_typelib_data()
            binaries += gi_binaries
            datas += gi_datas
            platform_hiddenimports += gi_hidden
    except Exception as e:
        print('WARNING: could not collect WebKit2 gi typelibs:', e, file=sys.stderr)
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