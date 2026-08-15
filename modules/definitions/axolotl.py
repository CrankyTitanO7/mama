#!/usr/bin/env python3
"""
modules/definitions/axolotl.py — Axolotl add-on module definition.

Axolotl fine-tuning framework, pip-installed into the training python.
Linux or WSL + NVIDIA CUDA only.
"""

from modules.spec import ModuleSpec

SPEC = ModuleSpec(
    key='axolotl',
    name='Axolotl',
    description='Axolotl fine-tuning framework (needs Linux or WSL + CUDA)',
    import_name='axolotl',
    platforms=('linux', 'wsl'),
    unsupported_reason='Axolotl only runs on Linux or WSL with an NVIDIA CUDA GPU.',
    install_steps=('pip install axolotl',),
    uninstall_steps=('pip uninstall -y axolotl',),
    tags=('pip package',),
)