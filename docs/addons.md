# Add-on Modules & Your Own Data

Two features work together: **add-on modules** extend mama with external
tooling (installable from the *Modules* page), and the **Fine-Tune page's
Dataset step** builds fine-tuning datasets from your own local sources.

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

## Your own data (inside fine-tune step 2)

The Dataset step of the **Fine-Tune** page builds datasets locally, in
**Alpaca JSONL** (`instruction/input/output` — Soup, Axolotl, and most
fine-tuning stacks) or **TRL JSONL** (`prompt/completion` — mama's built-in
trainer auto-detects it):

1. **CSV / TSV** — pick a delimited file, preview the columns, choose the
   instruction / response (and optional context) columns, build. A JSONL
   set is written next to your file (or into the open project's `data/`
   folder) and becomes the active dataset for training.
2. **grui recorder** — the *Open grui* button launches the grui app: record
   your screen + input in any software, then use grui's own tooling from a
   terminal (`grui dataset build <recording>` and `grui train`, see the
   grui repo's README). Recordings are saved under the add-on folder.

Built sets can also be pointed at by a Soup `soup.yaml`
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