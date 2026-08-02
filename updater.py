#!/usr/bin/env python3
"""
updater.py — GitHub releases auto-updater for mama.

Update flow:
  1. check_for_update()   — query GitHub for the latest release matching this platform.
  2. download_update()    — download + sha256-verify the release asset into the user updates dir.
  3. stage_update()       — extract the archive into a staging dir, write an apply marker.
  4. quit the app         — on_quit spawns `mama --apply-update <marker>` (a detached process).
  5. apply_update()       — the detached process waits for mama to exit, swaps the old app
                            bundle for the staged one (preserving user data), then relaunches
                            mama and exits.

The swap runs as a separate process started with `--apply-update` so the running app
never has to replace its own files (Windows locks running executables). A lock file
guards against two processes applying at once, and a marker left behind by a crashed
session is recovered on the next startup.
"""

import os
import re
import sys
import json
import time
import shutil
import logging
import hashlib
import zipfile
import platform
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

logger = logging.getLogger('mama.updater')

# ── Configuration ─────────────────────────────────────────────────────────────
REPO = 'CrankyTitanO7/mama'
VERSION_FILENAME = 'components/version.json'
DEFAULT_VERSION = '0.1.0'

# User data carried across an update swap (relative to the data dir / MEIPASS)
PRESERVE_RELS = ('user', 'components/recents.json')

_last_check = None


def is_frozen() -> bool:
    return bool(getattr(sys, 'frozen', False))


def load_version() -> str:
    """Return the bundled app version (components/version.json) or the fallback."""
    try:
        path = Path(__file__).resolve().parent / VERSION_FILENAME
        data = json.loads(path.read_text('utf-8'))
        version = str(data.get('version', '')).strip()
        if version:
            return version
    except Exception as e:
        logger.warning('Could not read version file: %s', e)
    return DEFAULT_VERSION


def version_greater(a: str, b: str) -> bool:
    """True if version string a is newer than b (handles 1.2.3, v1.2, 1.2.0rc1)."""

    def key(v):
        parts = re.findall(r'\d+|[a-zA-Z]+', v)
        return [('n', int(p)) if p.isdigit() else ('s', p.lower()) for p in parts]

    ka, kb = key(str(a)), key(str(b))
    for x, y in zip(ka, kb):
        if x == y:
            continue
        if x[0] == y[0]:
            return x[1] > y[1]
        return x[0] < y[0]  # numbers sort before suffix letters
    if len(ka) == len(kb):
        return False
    if len(ka) > len(kb):
        return ka[len(kb)][0] == 'n'  # a has extra numeric parts → newer
    return kb[len(ka)][0] != 'n'      # b only has extra suffix (rc/beta) → a newer


def get_updates_dir() -> Path:
    """User-writable directory for downloads/staging (never inside the app bundle)."""
    if sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support' / 'mama'
    elif sys.platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'mama'
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local' / 'share'))) / 'mama'
    return base / 'updates'


def get_app_root() -> Path:
    """Absolute path of the install root:
    macOS → the .app bundle; Windows/Linux → the folder containing the executable.
    In dev (unfrozen) it is the repo root.
    """
    if is_frozen():
        exe = Path(sys.executable).resolve()
        if sys.platform == 'darwin':
            for parent in exe.parents:
                if parent.suffix == '.app':
                    return parent
        return exe.parent
    return Path(__file__).resolve().parent


def _meipass_rel() -> Path:
    """Data dir (MEIPASS) location relative to the app root."""
    if is_frozen():
        try:
            return Path(sys._MEIPASS).resolve().relative_to(get_app_root())
        except (ValueError, AttributeError):
            pass
    return Path('.')


def _platform_tag():
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


def _asset_info(asset: dict) -> dict:
    return {
        'name': asset.get('name'),
        'url': asset.get('browser_download_url'),
        'size': asset.get('size'),
        'digest': asset.get('digest'),  # 'sha256:<hex>' when GitHub provides it
    }


def _match_asset(assets: list) -> dict:
    os_name, arch = _platform_tag()
    wanted = (
        f'mama-{os_name}-{arch}.zip',
        f'mama-{os_name}-{arch}-latest.zip',
        f'mama-{os_name}.zip',
    )
    for asset in assets or []:
        if asset.get('name') in wanted:
            return _asset_info(asset)
    # Fallback: a single zip whose name does not target another platform
    zips = [a for a in (assets or []) if (a.get('name') or '').endswith('.zip')]
    platform_words = ('macos', 'windows', 'win32', 'win64', 'linux', 'darwin', 'arm64', 'x64', 'x86')
    candidates = []
    for asset in zips:
        name = (asset.get('name') or '').lower()
        if any(w in name for w in platform_words if w not in (os_name, arch)):
            continue
        candidates.append(asset)
    if len(candidates) == 1:
        return _asset_info(candidates[0])
    return None


def check_for_update() -> dict:
    """Query GitHub releases/latest and return update info for this platform."""
    global _last_check
    url = f'https://api.github.com/repos/{REPO}/releases/latest'
    result = {
        'available': False,
        'update_exists': False,
        'current_version': load_version(),
        'latest_version': None,
        'release_name': None,
        'notes': '',
        'published_at': None,
        'asset': None,
    }
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'mama-updater/1.0',
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            _last_check = result
            return result
        result['error'] = f'Update server returned HTTP {e.code}'
        _last_check = result
        return result
    except Exception as e:
        result['error'] = f'Could not reach update server: {e}'
        _last_check = result
        return result

    tag = str(data.get('tag_name', '')).lstrip('v')
    result['latest_version'] = tag
    result['release_name'] = data.get('name') or ''
    result['notes'] = data.get('body') or ''
    result['published_at'] = data.get('published_at')
    result['update_exists'] = bool(tag) and version_greater(tag, result['current_version'])
    result['asset'] = _match_asset(data.get('assets') or [])
    result['available'] = result['update_exists'] and result['asset'] is not None
    if result['update_exists'] and not result['asset']:
        result['error'] = f'No build available for {_platform_tag()[0]}-{_platform_tag()[1]} yet'
    _last_check = result
    return result


def download_update(progress_cb=None) -> dict:
    """Download the update asset into the user updates dir, verifying its sha256."""
    info = _last_check or check_for_update()
    asset = info.get('asset')
    if not asset or not info.get('available'):
        return {'success': False, 'error': info.get('error') or 'No update to download'}

    updates_dir = get_updates_dir()
    updates_dir.mkdir(parents=True, exist_ok=True)
    target = updates_dir / asset['name']
    tmp = updates_dir / (asset['name'] + '.part')
    tmp.unlink(missing_ok=True)

    try:
        req = urllib.request.Request(asset['url'], headers={'User-Agent': 'mama-updater/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp, open(tmp, 'wb') as f:
            total = int(resp.headers.get('Content-Length') or 0)
            received = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                received += len(chunk)
                if progress_cb and total:
                    progress_cb(received, total)
        if total and received != total:
            raise IOError(f'Download incomplete ({received}/{total} bytes)')

        digest = (asset.get('digest') or '').strip()
        if digest:
            expected = digest.split(':', 1)[1].lower() if ':' in digest else digest.lower()
            actual = hashlib.sha256(tmp.read_bytes()).hexdigest()
            if actual != expected:
                raise IOError(f'Checksum mismatch (got {actual[:12]}…, expected {expected[:12]}…)')

        os.replace(tmp, target)
        return {'success': True, 'path': str(target), 'size': received}
    except Exception as e:
        tmp.unlink(missing_ok=True)
        logger.error('Download failed: %s', e)
        return {'success': False, 'error': str(e)}


def _extract_zip(zip_path: Path, dest: Path) -> Path:
    """Extract a release zip into dest; returns the staged app root."""
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            target = (dest / member).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise IOError('Update archive contains unsafe paths')
        zf.extractall(dest)
    return dest


def _staged_root_valid(staged: Path) -> bool:
    """Sanity-check that a staged directory really is a mama install."""
    if sys.platform == 'darwin':
        macos_dir = staged / 'Contents' / 'MacOS'
        return any(p.is_file() for p in macos_dir.iterdir()) if macos_dir.is_dir() else False
    exe_name = 'mama.exe' if sys.platform == 'win32' else 'mama'
    return (staged / exe_name).is_file()


def stage_update() -> dict:
    """Download + extract the update and write the apply marker (if not frozen, refuses)."""
    if not is_frozen():
        return {'success': False, 'error': 'Updates can only be installed in a packaged build'}

    info = _last_check or check_for_update()
    asset = info.get('asset')
    tag = info.get('latest_version')
    if not info.get('available') or not asset or not tag:
        return {'success': False, 'error': info.get('error') or 'No update to install'}

    updates_dir = get_updates_dir()
    zip_path = updates_dir / asset['name']
    if not zip_path.exists():
        dl = download_update()
        if not dl.get('success'):
            return {'success': False, 'error': dl.get('error')}

    staged = _extract_zip(zip_path, updates_dir / f'mama-{tag}')
    if not _staged_root_valid(staged):
        shutil.rmtree(staged, ignore_errors=True)
        return {'success': False, 'error': 'Downloaded update is not a valid mama build'}

    marker = {
        'pid': os.getpid(),
        'tag': tag,
        'app_root': str(get_app_root()),
        'staged_root': str(staged),
        'meipass_rel': str(_meipass_rel()),
        'exe_rel': None,
    }
    if is_frozen():
        try:
            marker['exe_rel'] = str(Path(sys.executable).resolve().relative_to(get_app_root()))
        except ValueError:
            pass

    marker_path = updates_dir / 'apply.json'
    tmp = marker_path.with_suffix('.tmp')
    tmp.write_text(json.dumps(marker, indent=2), 'utf-8')
    os.replace(tmp, marker_path)
    logger.info('Staged update %s at %s', tag, staged)
    return {'success': True, 'tag': tag}


# ── Applying (runs in the detached `--apply-update` process) ─────────────────

def _pending_marker_path() -> Path:
    return get_updates_dir() / 'apply.json'


def _acquire_apply_lock() -> Path:
    """Try to take the apply lock. Returns the lock path, or None if another
    process is applying right now (a stale lock from a dead process is stolen)."""
    lock = get_updates_dir() / 'applying.lock'
    try:
        lock.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    for _ in range(5):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return lock
        except FileExistsError:
            try:
                owner = int(lock.read_text('utf-8').strip())
                os.kill(owner, 0)
                return None  # owner is alive — it is applying
            except ProcessLookupError:
                pass
            except (ValueError, OSError):
                pass
            try:
                lock.unlink(missing_ok=True)
            except OSError:
                return None
        except OSError:
            return None
    return None


def _process_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, AttributeError):
        return False
    except PermissionError:
        return True
    except OSError:
        return True


def _wait_for_process_exit(pid: int, timeout: float = 90.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _process_alive(pid):
            return
        time.sleep(0.25)


def _safe_rmtree(path: Path, attempts: int = 3) -> None:
    for i in range(attempts):
        try:
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
            return
        except OSError:
            time.sleep(0.5)


def _preserve_user_data(old_root: Path, new_root: Path, marker: dict) -> None:
    """Copy user data (settings, themes, recents) from the old install into the new one."""
    meipass_rel = Path(marker.get('meipass_rel') or str(_meipass_rel()))
    old_data, new_data = old_root / meipass_rel, new_root / meipass_rel
    if not old_data.is_dir():
        return
    for rel in PRESERVE_RELS:
        src = old_data / rel
        if not src.exists():
            continue
        dst = new_data / rel
        if dst.is_dir():
            _safe_rmtree(dst)
        elif dst.exists():
            dst.unlink(missing_ok=True)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
            logger.info('Preserved %s', rel)
        except OSError as e:
            logger.error('Could not preserve %s: %s', rel, e)


def _relaunch(root: Path, marker: dict) -> None:
    try:
        if sys.platform == 'darwin' and (root / 'Contents').is_dir():
            subprocess.Popen(['open', str(root)])
            return
        exe_rel = marker.get('exe_rel')
        if exe_rel:
            exe = root / exe_rel
            if exe.exists():
                subprocess.Popen([str(exe)], cwd=str(exe.parent), start_new_session=True)
                return
        logger.warning('Could not relaunch after update')
    except Exception as e:
        logger.error('Relaunch failed: %s', e)


def apply_update(marker_path: str) -> int:
    """Apply a staged update. Runs in the `--apply-update` process.
    Returns 0 on success (relaunched), 1 on failure, 2 when skipped."""
    try:
        marker_path = Path(marker_path)
        if not marker_path.is_file():
            return 2
        marker = json.loads(marker_path.read_text('utf-8'))
    except Exception as e:
        logger.error('Cannot read update marker: %s', e)
        return 1

    root = Path(marker.get('app_root', '')).resolve()
    staged = Path(marker.get('staged_root', '')).resolve()
    pid = marker.get('pid')

    lock = _acquire_apply_lock()
    if lock is None:
        return 2
    try:
        if pid and pid != os.getpid():
            _wait_for_process_exit(pid)
        if not staged.is_dir():
            marker_path.unlink(missing_ok=True)  # already applied / never extracted
            return 2
        if not root.is_dir():
            logger.error('App root missing: %s', root)
            return 1

        backup = root.with_name(root.name + '.old')
        _safe_rmtree(backup)
        try:
            root.rename(backup)
            staged.rename(root)
        except OSError as e:
            try:
                if backup.is_dir() and not root.exists():
                    backup.rename(root)
            except OSError:
                pass
            logger.error('Update swap failed: %s', e)
            return 1

        _preserve_user_data(backup, root, marker)
        _safe_rmtree(backup)
        marker_path.unlink(missing_ok=True)
        logger.info('Update %s applied', marker.get('tag'))
    finally:
        try:
            lock.unlink(missing_ok=True)
        except OSError:
            pass

    _relaunch(root, marker)
    return 0


def spawn_applier() -> bool:
    """Launch the detached swap process that waits for mama to exit, applies the
    staged update and relaunches. Called from on_quit. Returns True if spawned."""
    marker = _pending_marker_path()
    if not marker.is_file():
        return False
    try:
        subprocess.Popen(
            [sys.executable, '--apply-update', str(marker)],
            start_new_session=True,
        )
        logger.info('Update swapper spawned for %s', marker)
        return True
    except Exception as e:
        logger.error('Could not spawn update swapper: %s', e)
        return False


def recover_pending() -> bool:
    """Crash recovery: if a staged update's owner process is gone, apply it now.
    Returns True if the app was swapped and relaunched (caller should exit)."""
    marker = _pending_marker_path()
    if not marker.is_file():
        return False
    try:
        data = json.loads(marker.read_text('utf-8'))
    except Exception:
        return False
    pid = data.get('pid')
    if pid and _process_alive(pid):
        return False
    staged = Path(data.get('staged_root', ''))
    if not staged.is_dir():
        try:
            marker.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    logger.info('Recovering staged update from a previous session')
    return apply_update(str(marker)) == 0
