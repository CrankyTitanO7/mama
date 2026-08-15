#!/usr/bin/env python3
"""
modules/definitions/grui.py — grui add-on module definition.

grui ("Grand Unified Imitation") records the user's screen and
keyboard/mouse actions while they interact with arbitrary software, then
converts the recordings into imitation-learning datasets ("observes input,
outputs training data for neural networks").

  - Python 3.12+ (the app's Python must be >= 3.12 for `pip install -e .`)
  - Installs into its own local virtualenv inside the add-ons dir:
      <addons root>/grui/.venv
  - Console script `grui` lives in that venv; the Data page shells out to
    it for `grui dataset build` (raw observation→action samples) and
    `grui train` (behavior-cloning policy training)
  - The venv also gets the `[ml]` extra (torch) so `grui train` works
  - WSL is excluded: screen/keyboard capture inside WSL is not supported
    by the upstream project

Recordings are saved by the grui app under <install dir>/recordings/ and
can be imported into mama's own fine-tuning JSONL from the Data page.
"""

from modules.spec import ModuleSpec, DELETE_INSTALL_DIR

# grui is git-cloned (no PyPI release), so the spec carries repo_url +
# install_dir + venv. The machinery clones the repo, creates the local
# venv, then runs these steps *inside the venv* with the install dir as
# the working directory.
SPEC = ModuleSpec(
    key='grui',
    name='grui',
    description='grui — record screen + keyboard/mouse and build imitation-learning datasets (recordings, dataset builder, behavior-cloning training)',
    console_script='grui',
    platforms=('linux', 'macos', 'native_windows'),
    unsupported_reason='grui needs a desktop session to capture the screen and input; WSL is not supported.',
    repo_url='https://github.com/CrankyTitanO7/grui.git',
    install_dir='grui',
    venv=True,
    # Steps run with <install dir>/.venv/python(-m pip). ".[ml]" installs
    # the torch extra used by `grui train` / `grui agent`.
    install_steps=(
        'pip install -e .',
        'pip install -e ".[ml]"',
    ),
    uninstall_steps=(DELETE_INSTALL_DIR,),
    tags=('git clone', 'local venv', 'imitation learning'),
)