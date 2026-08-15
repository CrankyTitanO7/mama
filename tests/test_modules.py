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


def test_grui_spec_is_shared_env_repo_module():
    grui = by_key('grui')
    assert grui.repo_url == 'https://github.com/CrankyTitanO7/grui.git'
    assert grui.install_dir == 'grui'
    assert grui.console_script == 'grui'
    assert grui.min_python == '3.12'
    assert grui.uninstall_steps == (DELETE_INSTALL_DIR,)
    assert 'wsl' not in grui.platforms  # no screen capture under WSL


def test_soup_spec_has_python_floor():
    soup = by_key('soup')
    assert soup.min_python == '3.10'
    assert soup.version_ok((3, 11, 4))
    assert soup.version_ok((3, 12, 0))
    assert not soup.version_ok((3, 9, 0))


def test_version_ok_gates():
    grui = by_key('grui')
    assert not grui.version_ok((3, 11, 9))
    assert grui.version_ok((3, 12, 0))
    assert grui.version_ok((3, 13, 1))
    assert grui.version_gate_text() == '>=3.12'
    # No gates -> always ok
    from modules.spec import ModuleSpec
    assert ModuleSpec(key='x', name='x', description='').version_ok((2, 7))


def test_registry_skips_unknown_files():
    # Files without a SPEC must not crash discovery
    reset_registry()
    assert all_modules()


def test_spec_definitions_are_importable_via_package():
    assert modules.by_key('soup') is not None

def test_pip_steps_rewrite_to_uv_when_available(monkeypatch):
    """pip steps run through `uv pip --python <shared python>` when uv exists."""
    import bridge
    import tempfile
    from pathlib import Path

    tmp = tempfile.mkdtemp()
    api = bridge.MamaApi(user_settings_path=f'{tmp}/s.json', base_dir=tmp)

    monkeypatch.setattr(api, '_module_uv_path', lambda: '/usr/bin/uv')
    monkeypatch.setattr(api, '_get_training_python', lambda *a, **k: '/opt/py/bin/python3')
    monkeypatch.setattr(api, '_get_python', lambda: '/opt/py/bin/python3')

    soup = by_key('soup')
    args, cwd = api._module_step_args(soup, 'pip install "soup-cli[train]"', 'macos')
    assert args == ['/usr/bin/uv', 'pip', 'install', '--python', '/opt/py/bin/python3',
                    'soup-cli[train]']
    assert cwd is None  # pip modules have no install dir

    # Fallback when uv is missing
    monkeypatch.setattr(api, '_module_uv_path', lambda: None)
    args, _ = api._module_step_args(soup, 'pip install "soup-cli[train]"', 'macos')
    assert args == ['/opt/py/bin/python3', '-m', 'pip', 'install', 'soup-cli[train]']

    # Uninstall steps go through uv the same way
    monkeypatch.setattr(api, '_module_uv_path', lambda: '/usr/bin/uv')
    args, _ = api._module_step_args(soup, 'pip uninstall -y soup-cli', 'macos')
    assert args == ['/usr/bin/uv', 'pip', 'uninstall', '--python', '/opt/py/bin/python3',
                    '-y', 'soup-cli']


def test_pip_steps_keep_system_path_for_wsl():
    import bridge
    import tempfile

    tmp = tempfile.mkdtemp()
    api = bridge.MamaApi(user_settings_path=f'{tmp}/s.json', base_dir=tmp)
    soup = by_key('soup')
    args, cwd = api._module_step_args(soup, 'pip install "soup-cli[train]"', 'wsl')
    assert args == ['wsl', '-e', 'sh', '-lc',
                    'python3 -m pip install "soup-cli[train]"']
    assert cwd is None


def test_version_preflight_bails_before_steps(monkeypatch):
    """grui refuses to install into a 3.11 shared environment."""
    import bridge
    import tempfile

    tmp = tempfile.mkdtemp()
    api = bridge.MamaApi(user_settings_path=f'{tmp}/s.json', base_dir=tmp)
    grui = by_key('grui')

    monkeypatch.setattr(api, '_get_training_python', lambda *a, **k: '/py3.11/bin/python3')
    monkeypatch.setattr(api, '_get_python', lambda: '/py3.11/bin/python3')
    monkeypatch.setattr(api, '_module_version',
                        lambda python: (3, 11, 4))
    monkeypatch.setattr(api, '_prepare_module_dir', lambda s, p: True)
    emitted = []
    monkeypatch.setattr(api, '_emit_module_progress',
                        lambda key, chunk: emitted.append(chunk))

    result = api._handle_module_action('grui', 'install')
    assert result['success'] is False
    assert '3.12' in result['error']
    assert any('requires Python' in c.get('text', '') for c in emitted)


def test_examples_list_and_open_in_place(monkeypatch):
    """examples_list discovers bundled projects; dev open uses the folder in place."""
    import bridge
    import tempfile
    from pathlib import Path

    repo = Path(__file__).resolve().parent.parent
    tmp = tempfile.mkdtemp()
    api = bridge.MamaApi(user_settings_path=f'{tmp}/s.json', base_dir=str(repo))
    monkeypatch.setattr(api, '_recents_path', Path(tmp) / 'recents.json')

    res = api.examples_list()
    assert res['success']
    keys = {e['key'] for e in res['examples']}
    assert {'hello-sft', 'lowvram-8b', 'your-data'} <= keys
    entry = next(e for e in res['examples'] if e['key'] == 'hello-sft')
    assert entry['kind'] == 'soup'
    assert entry['model'] and entry['fetch'] and entry['hasConfig']

    opened = api.examples_open('hello-sft')
    assert opened['success'] is True
    assert opened['copied'] is False
    assert 'examples' in opened['path'] and opened['path'].endswith('hello-sft')
    assert api._read_recents()['open'] == opened['path']

    unknown = api.examples_open('nope')
    assert unknown['success'] is False and 'Unknown' in unknown['error']
