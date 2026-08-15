# Add-on Modules Framework

Mama's **add-on modules** are optional pieces of external tooling that the
Modules page can install, uninstall and run on the user's machine. Each
module is a single, declarative spec file — there is no logic to maintain
unless your module genuinely needs it.

Current modules:

| key      | what it is                                                        | style           |
|----------|-------------------------------------------------------------------|-----------------|
| `axolotl`| Axolotl fine-tuning framework (Linux/WSL + CUDA)                  | pip package     |
| `unsloth`| Unsloth fast LoRA/QLoRA fine-tuning                               | pip package     |
| `soup`   | Soup low-VRAM fine-tuning (8B on a 4 GB GPU via layer streaming)  | pip package     |
| `grui`   | grui screen/keyboard/mouse recorder + imitation-learning datasets | git + local venv|

---

## Adding a new module

1. Copy `definitions/soup.py` (pip module) or `definitions/grui.py`
   (git-cloned module with its own venv) to
   `definitions/<your-key>.py`.
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
| `console_script`   | instead of an import probe: look for this executable in the module's venv `bin/` (Windows: `Scripts/`)         |
| `platforms`        | tuple of supported `linux` / `macos` / `wsl` / `native_windows`                                                |
| `unsupported_reason` | shown when the current platform is not supported                                                            |
| `install_steps`    | ordered steps run on install (strings, see step syntax below)                                                  |
| `uninstall_steps`  | ordered steps run on uninstall                                                                                 |
| `repo_url`         | if set, the repo is cloned into `<addons root>/<install_dir>` before the steps run                             |
| `install_dir`      | directory under the add-ons root where repo-based modules live                                                 |
| `venv`             | `True` → the machinery creates `<install_dir>/.venv` and runs pip/python steps with that interpreter           |
| `tags`             | small labels surfaced to the UI (`pip package`, `low VRAM`, `local venv`, …)                                   |

Where things live:

- **pip modules** install into the *training python* (the interpreter the
  app installs torch into, or the current project's `.venv`).
- **repo modules** live in the add-ons root — `~/Library/Application
  Support/mama/addons/` (macOS), `%APPDATA%/mama/addons` (Windows),
  `~/.local/share/mama/addons` (Linux); in development that's the repo's
  `addons/` folder, which is git-ignored.

## Step syntax

Steps are plain strings that run in order with output streamed to the
Modules page. Interpretation:

| step                              | runs as                                               |
|-----------------------------------|-------------------------------------------------------|
| `pip install pkg` / `pip3 ...`    | `<python> -m pip install pkg`                         |
| `python <script> args...`         | `<python> <script> args...`                           |
| `git clone ...`, anything else    | run as-is (no shell, argv is split like a shell)      |

For `venv: True` modules, pip/python steps use the venv interpreter and
**all** steps run with the install dir as the working directory — so
`pip install -e .` installs the cloned repo itself, and bare commands like
`ffmpeg` resolve inside the venv's PATH.

`uninstall_steps=(DELETE_INSTALL_DIR,)` (from `modules.spec`) removes the
module's install directory — the correct uninstall for git-cloned modules,
since everything lives in that folder.

## Platform keys

`native_windows` = Windows without WSL. `wsl` = Windows with an available
WSL distro (steps run inside the default distro). `macos`/`linux` are the
host OSes.

## Wiring to a page (optional)

Installing a module is only step one — usually you want the app to *use*
it. gr ui is the template for this: mama's Data page shells out to the
module's venv (see `MamaApi._module_install_path()` / venv helpers in
`bridge.py`) for:

- `grui dataset build <recording> --out <dir>` — raw observation→action samples
- `grui train --dataset <dir> --out <ckpt> --epochs N` — behavior-cloning training

The pattern: keep the module's own CLI the single source of truth, run it
as a subprocess with streaming output, and let the frontend show the log
(see `_dataProgressCallback` in `http_server.py`'s shim).

## Notes when packaging

`main.spec` bundles `modules/` as Python code (they're imported by
`bridge.py`), and `addons/` (user-created module installs) is git-ignored;
a clean checkout never contains installs, only definitions.