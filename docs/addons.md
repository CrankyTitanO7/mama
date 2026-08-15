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
| **Axolotl** | Axolotl fine-tuning framework (Linux/WSL + CUDA) | pip into the training python |
| **Unsloth** | fast LoRA/QLoRA fine-tuning (Linux/WSL/macOS) | pip into the training python |
| **Soup** | low-VRAM fine-tuning from one YAML — layer streaming trains an 8B model on a 4 GB laptop GPU (Linux/macOS/Windows, CUDA/MPS/CPU) | pip `soup-cli[train]` |
| **grui** | records your screen + keyboard/mouse while you work in any software, then builds imitation-learning data and trains behavior-cloning policies | git clone + its own local venv under the app's add-ons folder |

Where installed things live:

- **pip modules** go into the training python (the interpreter the app
  installs torch into, or the current project's `.venv`).
- **grui** lives in its own virtualenv, e.g.
  `~/Library/Application Support/mama/addons/grui/.venv` (macOS;
  `%APPDATA%\mama\addons` on Windows, `~/.local/share/mama/addons` on
  Linux; the repo's `addons/` in development). Its recordings are saved
  under `addons/grui/recordings/`.

### Why grui needs its own venv

grui pins Python 3.12+ and its own dependency stack (PySide6, pynput,
opencv, imageio-ffmpeg, …). Keeping it isolated means installing it never
touches the training environment, and vice versa. The Modules page handles
clone + venv creation + `pip install -e .` + `[ml]` (torch) automatically.

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
`grui.py` (git + venv) and fill in the fields. The full guide is
`modules/README.md`; a fresh checkout never contains installs (the
`addons/` folder is git-ignored), only definitions.