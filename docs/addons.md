# Add-on Modules & Your Own Data

Two features work together: **add-on modules** extend mama with external
tooling (installable from the *Modules* page), and the **Data page** turns
local sources into fine-tuning datasets you can train on.

---

## Add-on modules

Mama ships with four installable add-ons. Open the **Modules** page
(top-right nav) to install, reinstall, uninstall or run individual steps.

| add-on | what it adds | install style |
|--------|--------------|---------------|
| **Axolotl** | Axolotl fine-tuning framework (Linux/WSL + CUDA) | pip into the shared environment |
| **Unsloth** | fast LoRA/QLoRA fine-tuning (Linux/WSL/macOS) | pip into the shared environment |
| **Soup** | low-VRAM fine-tuning from one YAML — layer streaming trains an 8B model on a 4 GB laptop GPU (Linux/macOS/Windows, CUDA/MPS/CPU) | pip `soup-cli[train]` |
| **grui** | records your screen + keyboard/mouse while you work in any software, then builds imitation-learning data and trains behavior-cloning policies | git clone into the add-ons folder, packages in the shared environment |

Where installed things live:

- **Everything installs into one shared environment** — the interpreter
  the app already uses for training: the open project's `.venv` if the
  project has one, otherwise a real Python found on PATH. Nothing is
  duplicated per module, even when modules share heavy deps (torch, …).
- **git-cloned modules** (grui) keep *only repository files* under the
  add-ons root — `~/Library/Application Support/mama/addons/grui/` (macOS;
  `%APPDATA%\mama\addons` on Windows, `~/.local/share/mama/addons` on
  Linux; the repo's `addons/` in development). Its recordings are saved
  under `addons/grui/recordings/`.
- **uv, when installed** — pip steps run through `uv pip install` with the
  shared environment as target; uv's global cache hardlinks wheels across
  installs, so reinstalls and cross-module deps don't re-download or
  multiply on disk.

### Why there is no per-module venv

Per-module venvs turned every install into a fresh copy of the whole
dependency stack (grui alone pulls PySide6, opencv, torch, …). One shared
environment means heavier deps are installed once and reused by every
module and by training itself. Isolation still exists where it matters:
grui requires **Python >= 3.12** and refuses to install into an older
project `.venv` with a clear message (open a project with a newer venv).

The Modules page handles clone + `pip install -e .` + `[ml]` (torch)
automatically, so `grui` starts working with one click.

---

## The Data page (build your own fine-tuning set)

The **Data** page (nav: *fine tune → data → training*) builds datasets
locally from three sources, in **Alpaca JSONL** (`instruction/input/output`
— Soup, Axolotl, and most fine-tuning stacks) or **TRL JSONL**
(`prompt/completion` — mama's built-in trainer auto-detects it).

1. **grui recordings** — pick one of your recordings (from
   `addons/grui/recordings/`); every F9 annotation becomes one example
   (instruction = the annotation label or your own task text; response =
   the plain-language action transcript). It can also:
   - run **grui dataset build** — the recording's raw
     observation→action samples in grui's own format;
   - run **grui train** — behavior-cloning policy (CNN+GRU) training on a
     built dataset, streamed live into the page.
2. **CSV / TSV** — pick a delimited file, preview the columns, choose the
   instruction / response (and optional context) columns, build.
3. **Paste text** — Q:/A: blocks (blank-line separated, indented
   continuations) or one tab-separated pair per line.

The **Output** tab sets the default output folder — the open project's
`data/` directory by default. Built sets can go straight into the Fine-Tune
page's dataset field, or be pointed at by a Soup `soup.yaml`
(`data.train: <path>`, `data.format: alpaca`).

Conversion logic lives in `components/backend/data/converters.py`
(pure-stdlib, runnable as a CLI for sanity checks).

---

## For developers: the module framework

Each add-on is one declarative spec file under `modules/definitions/`.
Specs are auto-discovered — to add a module, copy `soup.py` (pip) or
`grui.py` (git clone) and fill in the fields. The full guide is
`modules/README.md`; a fresh checkout never contains installs (the
`addons/` folder is git-ignored), only definitions.