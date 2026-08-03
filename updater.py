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


def _setup_ssl_certs() -> None:
    """Make plain urllib/ssl trust the bundled CA bundle.

    Packaged builds ship certifi's cacert.pem as a data file, but Python's
    ssl module does not read it unless SSL_CERT_FILE points at it (PyInstaller
    does not do this for us). Without it, every HTTPS request from the frozen
    app fails with SSLCertVerificationError and the updater can never reach
    GitHub. Call this before any HTTPS request.
    """
    if os.environ.get('SSL_CERT_FILE') or os.environ.get('SSL_CERT_DIR'):
        return
    try:
        import certifi
        os.environ['SSL_CERT_FILE'] = certifi.where()
        logger.info('Using CA bundle: %s', certifi.where())
    except Exception:
        pass


_setup_ssl_certs()


def is_frozen() -> bool:
    return bool(getattr(sys, 'frozen', False))


def load_version() -> str:
    """Return the bundled app version (components/version.json) or the fallback."""
    try:
        if is_frozen():
            base = Path(sys._MEIPASS)
        else:
            base = Path(__file__).resolve().parent
        path = base / VERSION_FILENAME
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


def version_sort_key(v: str) -> list:
    """Sortable key for a version string ('0.0.45b' → [(0,0),(0,0),(0,45),(1,'b')])."""
    out = []
    for p in re.findall(r'\d+|[a-zA-Z]+', str(v)):
        out.append((0, int(p)) if p.isdigit() else (1, p.lower()))
    return out


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
    AppImage → the folder containing the AppImage file (APPIMAGE env var).
    In dev (unfrozen) it is the repo root.
    """
    appimage = os.environ.get('APPIMAGE')
    if appimage:
        return Path(appimage).resolve().parent
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


def _asset_candidates(os_name: str, arch: str) -> list:
    """Release asset names we accept, most specific first. Real releases ship
    mama-linux.AppImage, mama-macos.dmg, mama-windows.zip (+ optional -<arch>)."""
    zip_name = f'mama-{os_name}-{arch}.zip'
    if os_name == 'macos':
        return [
            f'mama-macos.dmg',
            f'mama-macos-{arch}.dmg',
            f'mama-macos.zip',
            f'mama-macos-{arch}.zip',
        ]
    if os_name == 'windows':
        return [
            f'mama-windows.zip',
            f'mama-windows-{arch}.zip',
        ]
    return [
        f'mama-linux.AppImage',
        f'mama-linux-{arch}.AppImage',
        f'mama-linux-{arch}.zip',
        f'mama-linux.zip',
    ]


def _match_asset(assets: list) -> dict:
    os_name, arch = _platform_tag()
    wanted = _asset_candidates(os_name, arch)
    for asset in assets or []:
        if asset.get('name') in wanted:
            return _asset_info(asset)
    # Fallback: a single archive whose name does not target another platform
    platform_words = ('macos', 'windows', 'win32', 'win64', 'linux', 'darwin', 'arm64', 'x64', 'x86')
    candidates = []
    for asset in assets or []:
        name = (asset.get('name') or '').lower()
        if not (name.endswith('.zip') or name.endswith('.dmg') or name.endswith('.appimage')):
            continue
        if any(w in name for w in platform_words if w not in (os_name, arch)):
            continue
        candidates.append(asset)
    if len(candidates) == 1:
        return _asset_info(candidates[0])
    return None


def _pick_latest_release(releases: list) -> dict:
    """Pick the release with the highest version tag. /releases/latest returns the
    most recently *published* release, which can be an older version uploaded later
    (e.g. v0.0.45b published after v1.0.0), so we pick by version, not by publish time."""
    stable = [r for r in (releases or []) if not r.get('prerelease')]
    pool = stable or (releases or [])
    if not pool:
        return None
    return max(pool, key=lambda r: version_sort_key(str(r.get('tag_name', '')).lstrip('v')))


def check_for_update() -> dict:
    """Query GitHub releases and return update info for this platform."""
    global _last_check
    url = f'https://api.github.com/repos/{REPO}/releases?per_page=100'
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
        logger.exception('Update check failed')
        msg = f'Could not reach update server: {type(e).__name__}: {e}'
        if 'ssl' in type(e).__name__.lower():
            msg += ' (TLS failed — is the build missing CA certificates / certifi?)'
        result['error'] = msg
        _last_check = result
        return result

    release = _pick_latest_release(data) if isinstance(data, list) else None
    if not release:
        result['error'] = 'No releases found'
        _last_check = result
        return result
    tag = str(release.get('tag_name', '')).lstrip('v')
    result['latest_version'] = tag
    result['release_name'] = release.get('name') or ''
    result['notes'] = release.get('body') or ''
    result['published_at'] = release.get('published_at')
    result['update_exists'] = bool(tag) and version_greater(tag, result['current_version'])
    result['asset'] = _match_asset(release.get('assets') or [])
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


def _extract_macos_dmg(dmg_path: Path, dest: Path) -> Path:
    """Mount the release dmg read-only and copy the .app bundle out of it."""
    dest.mkdir(parents=True, exist_ok=True)
    mount = dest / '.mount'
    mount.mkdir(exist_ok=True)
    try:
        r = subprocess.run(
            ['hdiutil', 'attach', str(dmg_path), '-nobrowse', '-readonly', '-mountpoint', str(mount)],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            raise IOError(r.stderr.strip() or 'hdiutil attach failed')
        apps = [p for p in mount.iterdir() if p.is_dir() and p.suffix == '.app']
        if not apps:
            raise IOError('No .app found inside the dmg')
        app_dest = dest / apps[0].name
        subprocess.run(['ditto', str(apps[0]), str(app_dest)], check=True, timeout=300)
        return app_dest
    finally:
        try:
            subprocess.run(['hdiutil', 'detach', str(mount)], capture_output=True, timeout=60)
        except Exception:
            pass
        shutil.rmtree(mount, ignore_errors=True)


def _staged_root_valid(staged: Path, is_file: bool = False) -> bool:
    """Sanity-check that a staged artifact really is a mama install.
    Platform-agnostic: a macOS .app bundle, or a dir containing the
    mama / mama.exe binary (Windows zip wraps it in a 'mama' folder)."""
    if is_file:
        return staged.is_file() and staged.stat().st_size > 1_000_000
    if not staged.is_dir():
        return False
    if (staged / 'Contents' / 'MacOS').is_dir():
        return True
    return any((staged / exe).is_file() for exe in ('mama', 'mama.exe'))


def _locate_staged_root(dest: Path) -> Path:
    """Find the actual app root inside the extracted archive. Windows builds wrap
    everything in a top-level 'mama' folder (dist/mama.zip)."""
    if _staged_root_valid(dest):
        return dest
    inner = dest / 'mama'
    if inner.is_dir() and _staged_root_valid(inner):
        return inner
    return dest


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
    artifact = updates_dir / asset['name']
    if not artifact.exists():
        dl = download_update()
        if not dl.get('success'):
            return {'success': False, 'error': dl.get('error')}

    dest = updates_dir / f'mama-{tag}'
    name = asset['name'].lower()
    staged_is_file = False
    try:
        if name.endswith('.dmg') and sys.platform == 'darwin':
            staged = _extract_macos_dmg(artifact, dest)
        elif name.endswith('.appimage') and sys.platform != 'win32':
            staged = artifact  # the AppImage file itself is the artifact
            try:
                staged.chmod(staged.stat().st_mode | 0o111)  # AppImages must be executable
            except OSError:
                pass
            staged_is_file = True
        elif name.endswith('.zip'):
            extracted = _extract_zip(artifact, dest)
            staged = _locate_staged_root(extracted)
        else:
            return {'success': False, 'error': f'Unsupported update format: {asset["name"]}'}

        if not _staged_root_valid(staged, is_file=staged_is_file):
            if not staged_is_file:
                shutil.rmtree(dest, ignore_errors=True)
            return {'success': False, 'error': 'Downloaded update is not a valid mama build'}
    except Exception as e:
        shutil.rmtree(dest, ignore_errors=True)
        return {'success': False, 'error': str(e)}

    marker = {
        'pid': os.getpid(),
        'tag': tag,
        'app_root': str(get_app_root()),
        'staged_root': str(staged),
        'staged_is_file': staged_is_file,
        'meipass_rel': str(_meipass_rel()),
        'exe_rel': None,
    }
    if staged_is_file:
        marker['exe_rel'] = staged.name  # file moves into the app root on apply
    elif is_frozen():
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
                if _process_alive(owner):
                    return None  # owner is alive — it is applying
            except (ValueError, OSError):
                pass
            try:
                lock.unlink(missing_ok=True)
            except OSError:
                return None
        except OSError:
            return None
    return None


def _win_pid_alive(pid: int) -> bool:
    """Windows liveness check. os.kill(pid, 0) is unreliable on Windows: it can
    raise OSError [WinError 6] for recently-exited processes and even raise
    SystemError (uncaught by callers) in some CPython versions, so use the
    Win32 API instead: OpenProcess + GetExitCodeProcess (STILL_ACTIVE == 259)."""
    try:
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return ctypes.windll.kernel32.GetLastError() == 5  # access denied → alive
        try:
            exit_code = ctypes.c_ulong()
            if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return True  # cannot tell → assume alive
            return exit_code.value == 259  # STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    except Exception:
        return True  # cannot tell → assume alive


def _process_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        if sys.platform == 'win32':
            return _win_pid_alive(pid)
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


def _data_dir(root: Path) -> Path:
    """Locate a bundle's data dir (the one holding components/), tolerating
    PyInstaller layout changes between builds (macOS: Contents/Resources in
    new PyInstaller, Contents/_internal in older; Windows/Linux: _internal)."""
    candidates = ['Contents/Resources', 'Contents/_internal', '_internal', ''] \
        if sys.platform == 'darwin' else ['_internal', '']
    for rel in candidates:
        cand = root / rel
        if cand.is_dir() and (cand / 'components').is_dir():
            return cand
    return root / candidates[0]


def _preserve_user_data(old_root: Path, new_root: Path, marker: dict) -> None:
    """Copy user data (settings, themes, recents) from the old install into the new one."""
    meipass_rel = Path(marker.get('meipass_rel') or str(_meipass_rel()))
    old_data = old_root / meipass_rel
    new_data = _data_dir(new_root)
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
    staged_is_file = bool(marker.get('staged_is_file'))
    pid = marker.get('pid')

    lock = _acquire_apply_lock()
    if lock is None:
        return 2
    try:
        if pid and pid != os.getpid():
            _wait_for_process_exit(pid)
        if not (staged.is_dir() or staged.is_file()):
            marker_path.unlink(missing_ok=True)  # already applied / never extracted
            return 2
        if not (root.is_dir() or root.is_file()):
            logger.error('App root missing: %s', root)
            return 1

        if staged_is_file:
            # single-file swap (AppImage): replace the executable file inside the app dir
            exe_rel = marker.get('exe_rel') or staged.name
            exe = root / exe_rel
            if not exe.is_file():
                logger.error('App file missing: %s', exe)
                return 1
            backup = exe.with_name(exe.name + '.old')
            _safe_rmtree(backup)
            try:
                exe.rename(backup)
                staged.rename(exe)
            except OSError as e:
                try:
                    if backup.is_file() and not exe.exists():
                        backup.rename(exe)
                except OSError:
                    pass
                logger.error('Update swap failed: %s', e)
                return 1
            _safe_rmtree(backup)
            marker_path.unlink(missing_ok=True)
            logger.info('Update %s applied', marker.get('tag'))
        else:
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
    if not (staged.is_dir() or staged.is_file()):
        try:
            marker.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    logger.info('Recovering staged update from a previous session')
    return apply_update(str(marker)) == 0
