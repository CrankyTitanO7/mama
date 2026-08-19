# Add-on Modules Framework

Mama's **add-on modules** are optional pieces of external tooling that the
Modules page can install, uninstall and run on the user's machine. Each
module is a single, declarative spec file — there is no logic to maintain
unless your module genuinely needs it.

Current modules:

| key      | what it is                                                        | style                   |
|----------|-------------------------------------------------------------------|-------------------------|
| `axolotl`| Axolotl fine-tuning framework (Linux/WSL + CUDA)                  | pip package             |
| `unsloth`| Unsloth fast LoRA/QLoRA fine-tuning                               | pip package             |
| `soup`   | Soup low-VRAM fine-tuning (8B on a 4 GB GPU via layer streaming)  | pip package             |
| `grui`   | grui screen/keyboard/mouse recorder + imitation-learning datasets | git clone, shared env   |

---

## Adding a new module

1. Copy `definitions/soup.py` (pip module) or `definitions/grui.py`
   (git-cloned module) to `definitions/<your-key>.py`.
2. Fill in the spec fields (table below).
3. Done. The registry auto-discovers the file; the Modules page and all
   install/uninstall machinery pick it up with no other changes.

```python
# modules/definitions/mything.py
from modules.spec import ModuleSpec

SPEC = ModuleSpec(
    key='mything',
    name='My Thing',
    description='One-line description shown in the UI.',
    import_name='mything',              # probe: `import mything`
    platforms=('linux', 'macos', 'wsl', 'native_windows'),
    install_steps=('pip install mything',),
    uninstall_steps=('pip uninstall -y mything',),
    tags=('pip package',),
)
```

## Spec fields

| field              | meaning                                                                                                        |
|--------------------|----------------------------------------------------------------------------------------------------------------|
| `key`              | unique id; must match the file name (`definitions/soup.py` → `key='soup'`)                                     |
| `name`, `description` | shown on the Modules page                                                                                  |
| `import_name`      | python import to probe for the installed check (e.g. `soup_cli`)                                               |
| `console_script`   | instead of an import probe: look for this executable in the shared environment's scripts dir (`bin/`, Windows: `Scripts/`) |
| `platforms`        | tuple of supported `linux` / `macos` / `wsl` / `native_windows`                                                |
| `unsupported_reason` | shown when the current platform is not supported                                                            |
| `install_steps`    | ordered steps run on install (strings, see step syntax below)                                                  |
| `uninstall_steps`  | ordered steps run on uninstall                                                                                 |
| `repo_url`         | if set, the repo is cloned into `<addons root>/<install_dir>` before the steps run                             |
| `install_dir`      | directory under the add-ons root where repo-based modules live (repository files only)                         |
| `min_python` / `max_python` | optional version gates ("3.12" style) checked against the shared environment before install |
| `tags`             | small labels surfaced to the UI (`pip package`, `low VRAM`, …)                                                 |

## The shared environment (one venv to rule them all)

Every module — pip *and* git-cloned — installs its packages into the **same
shared environment**: the interpreter the app already uses for training,
i.e. the open project's `.venv` if the project has one, otherwise a real
Python found on PATH. There are **no per-module virtualenvs**; an install
dir never contains more than the cloned repository files.

That keeps heavy dependencies (torch, PySide6, …) from being duplicated for
each module, and it means the Modules page and the training pipeline share
one consistent toolchain.

Where things live:

- **packages** → open project's `.venv`, or the app's Python.
- **git-cloned module code** → the add-ons root — `~/Library/Application
  Support/mama/addons/` (macOS), `%APPDATA%/mama/addons` (Windows),
  `~/.local/share/mama/addons` (Linux); in development that's the repo's
  `addons/` folder, which is git-ignored.

### Version gates

`min_python`/`max_python` protect the shared environment from modules that
need a newer (or older) interpreter — grui requires **Python >= 3.12**, so
installing it into a 3.11 project `.venv` fails fast with a readable
message instead of a confusing pip error. Use them whenever the upstream
project pins a version range.

## Step syntax

Steps are plain strings that run in order with output streamed to the
Modules page. Interpretation:

| step                              | runs as                                               |
|-----------------------------------|-------------------------------------------------------|
| `pip install pkg` / `pip3 ...`    | `uv pip <sub> --python <python> ...` when uv is on PATH, else `<python> -m pip ...` |
| `python <script> args...`         | `<python> <script> args...`                           |
| `git clone ...`, anything else    | run as-is (no shell, argv is split like a shell)      |

`<python>` is the shared environment's interpreter. When **uv** is on PATH
it drives every pip step: uv keeps one global package cache and hardlinks
wheels across installs, so reinstalls and cross-module deps (torch,
datasets, …) are not re-downloaded and don't eat extra disk. Without uv the
machinery falls back to plain `python -m pip`.

All steps run with the install dir as the working directory when the
module has one — so for git-cloned modules `pip install -e .` installs the
repo itself into the shared environment, and its console script lands in
the shared environment's scripts dir.

`uninstall_steps=(DELETE_INSTALL_DIR,)` (from `modules.spec`) removes the
module's install directory — the correct uninstall for git-cloned modules,
since their repo files live in that folder (packages stay in the shared
environment, as designed).

## Platform keys

`native_windows` = Windows without WSL. `wsl` = Windows with an available
WSL distro (steps run inside the default distro). `macos`/`linux` are the
host OSes.

## Wiring to a page (optional)

Installing a module is only step one — usually you want the app to *use*
it. grui is the template for this: fine-tune step 2 shows a status line
and an *Open grui* button backed by `MamaApi.grui_status()` /
`MamaApi.grui_launch()` (the console script is resolved via the shared
environment — see `MamaApi._module_scripts_dir()` in the `bridge/` package), and
the modules and examples pages check `_module_installed()` before
enabling features.

The pattern: keep the module's own CLI the single source of truth; for
long-running subcommands launch it detached with `start_new_session=True`
and let grui itself open its GUI (the PySide6 recorder window).

## Notes when packaging

`main.spec` bundles `modules/` as Python code (they're imported by
the `bridge/` package), and `addons/` (user-created module installs) is git-ignored;
a clean checkout never contains installs, only definitions.