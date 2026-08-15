#!/usr/bin/env python3
"""
modules/registry.py — Add-on module registry.

Auto-discovers every ModuleSpec in modules/definitions/*.py and exposes the
combined list. Adding a new module = dropping one new file into
modules/definitions/ (see modules/README.md for the full guide).
"""

import importlib
import logging
from pathlib import Path
from typing import List

from modules.spec import ModuleSpec

logger = logging.getLogger('mama.modules')

_DEFINITIONS_DIR = Path(__file__).resolve().parent / 'definitions'

# Cached, lazily-loaded registry. Call reset_registry() (mostly useful for
# tests) to force a reload.
_registry: List[ModuleSpec] = []
_loaded = False


def _load_definitions() -> List[ModuleSpec]:
    """Import every modules/definitions/*.py and collect its SPEC."""
    modules = []
    if _DEFINITIONS_DIR.is_dir():
        for path in sorted(_DEFINITIONS_DIR.glob('*.py')):
            if path.name.startswith('_'):
                continue
            mod = importlib.import_module(f'modules.definitions.{path.stem}')
            spec = getattr(mod, 'SPEC', None)
            if not isinstance(spec, ModuleSpec):
                logger.warning('modules/definitions/%s.py has no SPEC; skipping',
                               path.stem)
                continue
            spec.definition_path = str(path)
            modules.append(spec)
    return modules


def reset_registry() -> None:
    """Force a reload of all module definitions (used by tests)."""
    global _registry, _loaded
    _registry = []
    _loaded = False


def all_modules() -> List[ModuleSpec]:
    """All registered ModuleSpecs, in definition order."""
    global _registry, _loaded
    if not _loaded:
        _registry = _load_definitions()
        _loaded = True
    return list(_registry)


def by_key(key: str):
    """Return the spec with the given key, or None."""
    for spec in all_modules():
        if spec.key == key:
            return spec
    return None