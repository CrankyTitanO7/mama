#!/usr/bin/env python3
"""
modules/definitions/grui.py — grui add-on module definition.

grui ("Grand Unified Imitation") records the user's screen and
keyboard/mouse actions while they interact with arbitrary software, then
converts the recordings into imitation-learning datasets ("observes input,
outputs training data for neural networks").

  - Python 3.12+ — the *shared* environment (open project's .venv or a
    real Python) must be >= 3.12 or the install fails fast up front
  - The repo is cloned into <addons root>/grui/ (repository files only)
  - Packages install into the shared environment; `pip install -e .`
    run from the clone dir registers grui there, and the `grui` console
    script lands in the shared environment's scripts dir (bin/)
  - The `[ml]` extra (torch) is installed so `grui train` works
  - WSL is excluded: screen/keyboard capture inside WSL is not supported
    by the upstream project

Recordings are saved by the grui app under <install dir>/recordings/ and
can be imported into mama's own fine-tuning JSONL from the Data page.
"""

from modules.spec import ModuleSpec, DELETE_INSTALL_DIR

# grui is git-cloned (no PyPI release), so the spec carries repo_url +
# install_dir. The machinery clones the repo, then runs these steps with
# the shared environment's python and the install dir as the working
# directory.
SPEC = ModuleSpec(
    key='grui',
    name='grui',
    description='grui — record screen + keyboard/mouse and build imitation-learning datasets (recordings, dataset builder, behavior-cloning training)',
    console_script='grui',
    platforms=('linux', 'macos', 'native_windows'),
    unsupported_reason='grui needs a desktop session to capture the screen and input; WSL is not supported.',
    repo_url='https://github.com/CrankyTitanO7/grui.git',
    install_dir='grui',
    min_python='3.12',
    # Steps run with the shared environment's python (cwd = install dir).
    # ".[ml]" installs the torch extra used by `grui train` / `grui agent`.
    install_steps=(
        'pip install -e .',
        'pip install -e ".[ml]"',
    ),
    uninstall_steps=(DELETE_INSTALL_DIR,),
    tags=('git clone', 'shared env', 'imitation learning'),
)