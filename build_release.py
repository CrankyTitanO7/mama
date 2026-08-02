#!/usr/bin/env python3
"""
build_release.py — package a mama release for the auto-updater.

Usage:
    python build_release.py [--version 0.2.0] [--skip-build]

Steps:
  1. Bump components/version.json (the version the app reports).
  2. Run PyInstaller with main.spec.
  3. Zip the built app into dist/mama-<os>-<arch>.zip (the asset the updater
     downloads: macOS zips the .app bundle, Windows/Linux zip the dist/mama dir).
  4. Print the asset name, sha256 and release notes to paste into the GitHub
     release (the updater checks the latest release and downloads this asset).
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


def platform_tag():
    if sys.platform == 'darwin':
        os_name = 'macos'
    elif sys.platform == 'win32':
        os_name = 'windows'
    else:
        os_name = 'linux'
    machine = platform.machine().lower()
    if machine in ('arm64', 'aarch64'):
        arch = 'arm64'
    elif machine in ('x86_64', 'amd64'):
        arch = 'x64'
    else:
        arch = machine
    return os_name, arch


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def zip_dir(source_dir: Path, zip_path: Path):
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d not in ('__pycache__',)]
            for name in files:
                full = Path(root) / name
                rel = full.relative_to(source_dir)
                zf.write(full, rel.as_posix())
    print(f'Zipped {source_dir} → {zip_path}')


def main():
    ap = argparse.ArgumentParser(description='Package a mama release for the auto-updater')
    ap.add_argument('--version', default=None, help='version to bump to (e.g. 0.2.0)')
    ap.add_argument('--skip-build', action='store_true', help='skip PyInstaller, only package dist/')
    args = ap.parse_args()

    base = Path(__file__).resolve().parent
    version_file = base / 'components' / 'version.json'

    if args.version:
        current = {}
        if version_file.exists():
            try:
                current = json.loads(version_file.read_text('utf-8'))
            except Exception:
                pass
        current['version'] = args.version.lstrip('v')
        version_file.write_text(json.dumps(current, indent=4) + '\n', 'utf-8')
        print(f'Version bumped to {current["version"]} ({version_file})')

    if not args.skip_build:
        print('Running PyInstaller…')
        subprocess.run([sys.executable, '-m', 'PyInstaller', 'main.spec'],
                       cwd=base, check=True)

    os_name, arch = platform_tag()
    dist = base / 'dist'
    if sys.platform == 'darwin':
        build_dir = dist / 'mama.app'
    else:
        build_dir = dist / 'mama'
    if not build_dir.is_dir():
        print(f'ERROR: {build_dir} not found — run the build first', file=sys.stderr)
        sys.exit(1)

    asset = dist / f'mama-{os_name}-{arch}.zip'
    if asset.exists():
        asset.unlink()
    zip_dir(build_dir, asset)

    print(f'\nAsset: {asset.name} ({asset.stat().st_size:,} bytes)')
    print(f'SHA256: {sha256_of(asset)}')
    print(f'''
────────────────────────────────────────────────────────────────────
Create the GitHub release (tag it v{args.version or "X.Y.Z"}), then:
  gh release create v{args.version or "X.Y.Z"} {asset.name} \\
    --repo CrankyTitanO7/mama --notes "…release notes…" \\
    --title "mama {args.version or "X.Y.Z"}"
The updater finds this asset by the name {asset.name} and verifies
its sha256 before installing. If you do not use `gh`, attach the zip
to the release manually in the web UI.
────────────────────────────────────────────────────────────────────''')


if __name__ == '__main__':
    main()
