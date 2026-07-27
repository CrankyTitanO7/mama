#!/usr/bin/env python3
"""
deparse.py — Dependency lookup and reference resolution.

Reads dependencies.json and provides:
  - search(key): returns the string value for a key
  - parse(key): resolves #-references recursively

Usage:
    from deparse import search, parse

    value = search('torch.cpu')
    resolved = parse('torch.cpu')
"""

import json
from pathlib import Path
from typing import Optional, Any


def _load_deps() -> dict:
    """Load dependencies.json from the same directory as this file."""
    deps_path = Path(__file__).resolve().parent / 'dependencies.json'
    with open(deps_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _flatten(obj: dict, prefix: str = '') -> dict:
    """Flatten nested object into single-level key-value map."""
    result = {}
    for key, value in obj.items():
        full_key = f'{prefix}.{key}' if prefix else key
        if isinstance(value, dict):
            result.update(_flatten(value, full_key))
        else:
            result[key] = value
            result[full_key] = value
    return result


# Build the lookup table once at module load time
_lookup = _flatten(_load_deps())


def search(key: str) -> Optional[Any]:
    """Return the value for a key, or None if not found."""
    return _lookup.get(key, None)


def parse(key: str) -> Optional[Any]:
    """Resolve #-references recursively.

    If a value starts with '#', it is treated as a reference to another key.
    References are resolved recursively with circular reference protection.
    """
    value = search(key)
    if value is None:
        return None

    visited = {key}
    while isinstance(value, str) and value.startswith('#'):
        ref_key = value[1:].strip()
        if ref_key in visited:
            return None  # circular reference
        visited.add(ref_key)
        value = search(ref_key)
        if value is None:
            return None

    return value