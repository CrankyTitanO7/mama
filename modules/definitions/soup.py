#!/usr/bin/env python3
"""
modules/definitions/soup.py — Soup add-on module definition.

Soup (soup-cli) fine-tunes LLMs from one YAML and is built for low-VRAM
setups: layer streaming trains an 8B model on a 4 GB laptop GPU.

  - pip package `soup-cli`, console script `soup`, import module `soup_cli`
  - `pip install "soup-cli[train]"` brings the training stack (torch,
    transformers, peft, trl, datasets, …)
  - Python 3.10–3.12 only; pip will refuse newer interpreters (the
    project pins that upper bound itself)
  - Works on Linux (CUDA), macOS (MPS, Apple Silicon), Windows (CUDA) and
    CPU; install the plain `soup-cli` (light CLI) and let `[train]` add
    the heavy stack

After install, the Data page can emit `data.format: alpaca` JSONL that
`soup train --config soup.yaml` consumes directly.
"""

from modules.spec import ModuleSpec

SPEC = ModuleSpec(
    key='soup',
    name='Soup',
    description='Soup — low-VRAM fine-tuning from one YAML (8B model on a 4 GB laptop GPU via layer streaming)',
    import_name='soup_cli',
    platforms=('linux', 'macos', 'wsl', 'native_windows'),
    unsupported_reason=(
        'Soup installs via pip and does not restrict platforms; '
        'this platform is not recognized by mama.'
    ),
    # Double quotes inside the step keep the [train] extra intact for pip
    # (shlex.split() honours the embedded quotes).
    install_steps=('pip install "soup-cli[train]"',),
    uninstall_steps=('pip uninstall -y soup-cli',),
    min_python='3.10',
    tags=('pip package', 'low VRAM'),
)