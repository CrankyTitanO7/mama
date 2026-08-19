"""bridge/env.py — module-level environment helpers.

Platform/PATH/process-environment logic shared by every bridge mixin:
which Python sources the app trusts, PATH augmentation for GUI launches,
and a subprocess environment cleaned of PyInstaller onefile leftovers.
"""

import os
import sys
import platform
from pathlib import Path


# Python sources the app is allowed to use for installs/venvs. Only:
#   - python.org "website" installer  (/Library/Frameworks/Python.framework)
#   - Homebrew                       (/opt/homebrew, /usr/local)
#   - conda (miniforge/miniconda/anaconda/mambaforge under /opt, /usr/local, ~)
# Anything else (Apple's /usr/bin/python3, CommandLineTools, pyenv, ...) is
# rejected so the app never creates 3.9.6 venvs or fails to install wheels.
CONDA_PREFIX_NAMES = (
    'miniforge', 'miniconda', 'anaconda', 'mambaforge',
    'miniforge3', 'miniconda3', 'anaconda3', 'mambaforge3',
)


def allowed_python_path(real: str) -> bool:
    """Return True if the real path belongs to an allowed Python source.

    Enforced on macOS only; Windows/Linux keep their usual PATH behavior.
    """
    if sys.platform != 'darwin':
        return True
    prefixes = [
        '/Library/Frameworks/Python.framework/',
        '/opt/homebrew/',
        '/usr/local/',
    ]
    home = str(Path.home())
    for root in ('/opt', '/usr/local', home):
        for name in CONDA_PREFIX_NAMES:
            prefixes.append(f'{root}/{name}/')
    return any(real.startswith(p) for p in prefixes)


def augment_path_for_gui_launch() -> None:
    """Prepend allowed Python install dirs to PATH.

    GUI apps launched from Finder get a minimal PATH (e.g. /usr/bin:/bin:/usr/
    sbin:/sbin), so bare 'python3' resolves to Apple's /usr/bin/python3 (3.9.6,
    no pip, no PyTorch wheels). Homebrew and conda installs live outside that
    PATH — add them so the app and every subprocess can find a real, modern
    Python. Other interpreters stay discoverable but are filtered out later by
    allowed_python_path().
    """
    extra = []
    home = str(Path.home())
    for p in ('/opt/homebrew/bin', '/usr/local/bin'):
        if os.path.isdir(p):
            extra.append(p)
    for prefix in ('/opt', '/usr/local', home, '/opt/homebrew/Caskroom'):
        for sub in CONDA_PREFIX_NAMES:
            for sub_dir in (os.path.join(prefix, sub, 'bin'),
                            os.path.join(prefix, sub, 'base', 'bin')):
                if os.path.isdir(sub_dir):
                    extra.append(sub_dir)
    if not extra:
        return
    current = os.environ.get('PATH', '')
    merged = os.pathsep.join(dict.fromkeys(
        p for p in (extra + ([current] if current else [])) if p
    ))
    if merged != current:
        os.environ['PATH'] = merged


augment_path_for_gui_launch()


def clean_subprocess_env():
    """Return a copy of os.environ safe for spawning real Python subprocesses.

    When frozen, PyInstaller's onefile bootloader points LD_LIBRARY_PATH /
    DYLD_LIBRARY_PATH at its own bundled-libs temp directory; a spawned
    system/venv Python would otherwise load the app's bundled shared
    libraries instead of its own. PyInstaller saves the pre-bootloader value
    as *_ORIG so children can restore it.
    """
    env = os.environ.copy()
    if getattr(sys, 'frozen', False):
        for var, orig_var in (
            ('LD_LIBRARY_PATH', 'LD_LIBRARY_PATH_ORIG'),
            ('DYLD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH_ORIG'),
        ):
            if orig_var in env:
                env[var] = env[orig_var]
            else:
                env.pop(var, None)
    return env
