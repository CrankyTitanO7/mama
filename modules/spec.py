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
  - ``python <script> ...``               -> <python> <script> ...
  - ``git clone ...`` and any other bare  -> run as-is (git must be on PATH)
    command

For repo-based modules (a git clone that ships its own venv, e.g. grui) the
machinery does setup before the steps run:

  1. creates the install dir,
  2. ``git clone``s the repo into it (if not already present),
  3. creates ``<install dir>/.venv`` with the app's Python (if ``venv`` is
     true),

then every step runs with the venv interpreter *and* the install dir as the
working directory. pip/python steps use the venv python; other commands
(git, ffmpeg, …) just run inside that directory.
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
    # ``import_name``: run `import <import_name>` with the training python
    #                  (or the module's venv python for venv modules).
    # ``console_script``: look for this executable inside the module's venv
    #                  bin/ (Scripts/ on Windows) directory.
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
    # install steps run from there. Uninstall removes the directory.
    repo_url: Optional[str] = None
    install_dir: Optional[str] = None

    # True when the module wants its own local virtualenv (created inside
    # the install dir). All pip/python steps then run with the venv's
    # interpreter. This is the "local venv" setup grui-style modules use.
    venv: bool = False

    # Custom installed-check. Optional; called with (spec, api) where api is
    # the MamaApi instance (use api._get_venv_python(...) etc. if needed).
    # If None, ``import_name`` / ``console_script`` probing is used.
    is_installed: Optional[Callable] = None

    # Extra info surfaced to the frontend (e.g. ["pip package", "local venv"]).
    tags: tuple = ()

    # Fields below are filled by the registry — do not set them in
    # definition files.
    definition_path: Optional[str] = None

    def clone_flags(self, dest: str) -> list:
        """git clone argv for repo-based modules (clones into `dest`)."""
        return ['git', 'clone', '--depth', '1', self.repo_url, dest]

    def step_python_hint(self) -> str:
        """Human label for the interpreter steps run under."""
        if self.venv:
            return f'{self.key} .venv'
        return 'training python'