#!/usr/bin/env python3
"""
modules/__init__.py — Add-on module framework for mama.

This package is the place where optional external tooling ("add-on
modules") is declared so the Modules page can install, uninstall and run
them. Development guide: modules/README.md
"""

from modules.registry import all_modules, by_key, reset_registry  # noqa: F401
from modules.spec import ModuleSpec, DELETE_INSTALL_DIR  # noqa: F401