# tests/test_modules.py
"""Add-on module framework tests (modules/ registry + specs)."""

import pytest

import modules
from modules.registry import all_modules, by_key, reset_registry
from modules.spec import DELETE_INSTALL_DIR


@pytest.fixture(autouse=True)
def reload_registry():
    """Each test sees a freshly discovered registry."""
    reset_registry()
    yield
    reset_registry()


def test_registry_discovers_builtin_modules():
    keys = {m.key for m in all_modules()}
    assert {'axolotl', 'unsloth', 'soup', 'grui'} <= keys


def test_by_key_returns_spec():
    soup = by_key('soup')
    assert soup is not None
    assert soup.name == 'Soup'
    assert soup.import_name == 'soup_cli'


def test_soup_spec_supports_all_platforms():
    soup = by_key('soup')
    assert 'linux' in soup.platforms
    assert 'macos' in soup.platforms
    assert 'native_windows' in soup.platforms
    assert soup.install_steps[0] == 'pip install "soup-cli[train]"'


def test_grui_spec_is_local_venv_module():
    grui = by_key('grui')
    assert grui.repo_url == 'https://github.com/CrankyTitanO7/grui.git'
    assert grui.venv is True
    assert grui.install_dir == 'grui'
    assert grui.console_script == 'grui'
    assert grui.uninstall_steps == (DELETE_INSTALL_DIR,)
    assert 'wsl' not in grui.platforms  # no screen capture under WSL


def test_registry_skips_unknown_files():
    # Files without a SPEC must not crash discovery
    reset_registry()
    assert all_modules()


def test_spec_definitions_are_importable_via_package():
    assert modules.by_key('soup') is not None