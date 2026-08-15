#!/usr/bin/env python3
"""
modules/definitions/unsloth.py — Unsloth add-on module definition.

Fast LoRA/QLoRA fine-tuning, pip-installed into the training python.
Linux / WSL / macOS. Official macOS install builds from source via the
GitHub repo, so the install steps are platform-dependent — see
MamaApi._module_install_steps(), which special-cases 'unsloth' on macOS.
"""

from modules.spec import ModuleSpec

# Official macOS install requires building from source via the github repo.
UNSLOTH_MACOS_INSTALL_STEPS = (
    'pip install --upgrade --force-reinstall --no-cache-dir '
    '"unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"',
)

SPEC = ModuleSpec(
    key='unsloth',
    name='Unsloth',
    description='Unsloth — fast LoRA/QLoRA fine-tuning',
    import_name='unsloth',
    platforms=('linux', 'macos', 'wsl'),
    unsupported_reason='Unsloth does not support native Windows; use WSL, Linux, or macOS.',
    install_steps=('pip install unsloth',),
    uninstall_steps=('pip uninstall -y unsloth',),
    tags=('pip package',),
)