#!/usr/bin/env python3
"""
modules/spec.py — Add-on module spec.

An "add-on module" is an installable piece of external tooling that mama can
set up on the user's machine (fine-tuning frameworks, data capture apps, …).
Every module is described by one ModuleSpec; the registry (registry.py) picks
up every spec automatically from modules/definitions/.

A spec is declarative — no Python logic required for the common cases. To add
a new module, copy an existing definition file and fill in the fields. The
full how-to lives in modules/README.md.

How install/uninstall works
---------------------------
Each spec lists shell-ish *steps* (strings). They run in order, streaming
their output into the Modules page. Step interpretation:

  - ``pip install foo`` / ``pip3 …``      -> <python> -m pip install foo
                                           (or `uv pip install` when uv is on
                                           PATH; uv shares one global package
                                           cache, so repeated installs across
                                           modules reuse the same files)
  - ``python <script> ...``               -> <python> <script> ...
  - ``git clone ...`` and any other bare  -> run as-is (git must be on PATH)
    command

Everything installs into ONE shared environment — the same interpreter the
app uses for training jobs (the open project's ``.venv`` if it has one,
otherwise a real system Python). There is no per-module virtualenv: modules
at most bring *repository files* (a git clone under the add-ons directory),
and packages always go into the shared environment. That keeps repeated
installs of heavy deps (torch, PySide6, …) from multiplying on disk.

Repo-based modules (a git clone, e.g. grui) get extra setup before the
steps run:

  1. creates the install dir,
  2. ``git clone``s the repo into it (if not already present),

then every step runs with the shared environment's python *and* the install
dir as the working directory, so ``pip install -e .`` installs the repo into
the shared env. Uninstall removes the clone directory.
"""

from dataclasses import dataclass, field
from typing import Callable, Optional


# Sentinel step: delete the module's install directory (used as the
# uninstall step for repo-based modules). Not a real command.
DELETE_INSTALL_DIR = '<delete install dir>'


@dataclass
class ModuleSpec:
    """Declarative description of one installable add-on module."""

    # Unique machine key used by the UI and by mama internally (must match
    # the filename's stem, e.g. 'soup' -> definitions/soup.py).
    key: str

    # Human-readable name shown in the Modules page.
    name: str

    # One-line description shown under the module name.
    description: str

    # Console/import probe used to decide whether the module is installed.
    # ``import_name``: run `import <import_name>` with the shared environment's
    #                  python (project .venv if open, else a real Python).
    # ``console_script``: look for this executable in the shared environment's
    #                  scripts dir (bin/ on macOS/Linux, Scripts/ on Windows).
    # One of the two must be set unless ``is_installed`` is provided.
    import_name: Optional[str] = None
    console_script: Optional[str] = None

    # Platform keys this module supports: 'linux', 'macos', 'wsl',
    # 'native_windows'. See MamaApi._module_platform().
    platforms: tuple = ()

    # Shown when the current platform is not in ``platforms``.
    unsupported_reason: str = ''

    # Install / uninstall steps (see module docstring for the syntax).
    install_steps: tuple = ()
    uninstall_steps: tuple = ()

    # ── Repo-based (local) modules ─────────────────────────────────────────
    # If set, the repo is cloned into <addons root>/<install_dir> and the
    # install steps run from there. The directory holds repository files
    # only — packages are installed into the shared environment. Uninstall
    # removes the directory.
    repo_url: Optional[str] = None
    install_dir: Optional[str] = None

    # Optional Python version gates against the *shared environment*:
    # "3.12" style strings, compared numerically. Enforced before the
    # install steps run (e.g. grui wants Python >= 3.12, so installing it
    # into a 3.11 project .venv fails fast with a readable message).
    min_python: str = ''
    max_python: str = ''

    # Custom installed-check. Optional; called with (spec, api) where api is
    # the MamaApi instance (use api._get_venv_python(...) etc. if needed).
    # If None, ``import_name`` / ``console_script`` probing is used.
    is_installed: Optional[Callable] = None

    # Extra info surfaced to the frontend (e.g. ["pip package", "shared env"]).
    tags: tuple = ()

    # Fields below are filled by the registry — do not set them in
    # definition files.
    definition_path: Optional[str] = None

    def clone_flags(self, dest: str) -> list:
        """git clone argv for repo-based modules (clones into `dest`)."""
        return ['git', 'clone', '--depth', '1', self.repo_url, dest]

    def version_ok(self, version: tuple) -> bool:
        """True when a ``(major, minor[, micro])`` version satisfies the
        ``min_python``/``max_python`` gates (or neither is set)."""
        if not self.min_python and not self.max_python:
            return True
        num = _parse_version(version)
        if self.min_python and num < _parse_version(self.min_python):
            return False
        if self.max_python and num > _parse_version(self.max_python):
            return False
        return True

    def version_gate_text(self) -> str:
        """Human-readable requirement, e.g. '>= 3.12'."""
        parts = []
        if self.min_python:
            parts.append(f'>={self.min_python}')
        if self.max_python:
            parts.append(f'<={self.max_python}')
        return ', '.join(parts)


def _parse_version(value) -> tuple:
    """Normalize a version to a numeric tuple (pads with zeros).

    Accepts tuples like (3, 12) and strings like "3.12.0".
    """
    if isinstance(value, str):
        parts = value.split('.')
    else:
        parts = [str(v) for v in value]
    nums = []
    for p in parts:
        try:
            nums.append(int(p))
        except ValueError:
            break
    return tuple(nums)