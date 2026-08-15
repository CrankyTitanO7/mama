# how to use 

## available pages

### homepage (available by clicking the logo top left)

here is an overview of current projects and a computer resource overview, as well as other quality of life "widgets" as needed.

### setup menu

this is where you can run the setup wizard again. it will auto-scan your system to determine prerequisites

### settings

this is where you can change several settings about the app. It can also be edited in the app files user/settings.json. it was intentionally designed to be flexible, portable, and easy to access.

several settings are optional and not needed for core functions, but they are used in several of the apps tests. for example, several installers require the OS field to be filled out, as they determine the system OS via the settings json file, and not through other means.

### multimodel design

an easy gui for designing multi-model systems

drop **Model**, **Script**, **Dataset** and **Format** widgets on the infinite canvas, click a widget's fields to edit them, and drag the **Connect** tool from a widget's *Output* node to another widget's *Input* node to link them. widgets snap to each other's anchors automatically.

the board is a real graph, not just a drawing: widgets are the nodes, connected lines are data flow, and freehand shapes/text are annotations. use **Save** (⌘S) to persist it as a `graph.json` in the open project folder (or a folder you pick) — a plain, commented, human-readable file. **Open** (⌘O) loads it back, **New** (⌘N) starts a fresh board, and the status bar shows the current graph and an unsaved "•" marker.

### database explorer

a quality of life feature allowing the user to easy browse a web database (such as huggingface) to easily transfer information from outside sources.

### export model

a page designed to walk a user through exporting a model for any use case. future aspirations include instant app/website generation (from template, not LLM), ollama (or other client) exports, etc. 

### data (build your own datasets)

the **data** page (nav: fine tune → data → training) builds fine-tuning sets locally, in Alpaca JSONL (`instruction/input/output` — for Soup and Axolotl) or TRL JSONL (`prompt/completion` — for the built-in trainer):

1. **grui recordings** — after installing the grui add-on (Modules page), pick a recording from `addons/grui/recordings/`. every F9 annotation becomes one example: instruction = the annotation label (or your own task text), response = the action transcript. the tab also runs grui's own raw dataset builder (`grui dataset build`) and behavior-cloning training (`grui train`) with live output.
2. **CSV / TSV** — pick a delimited file, preview columns, choose the instruction and response columns (plus an optional context column), build.
3. **paste text** — `Q:`/`A:` blocks (blank-line separated, indented continuations) or one tab-separated pair per line.

the **Output** tab sets the default output folder (the open project's `data/` by default). built sets plug straight into the fine-tune page or a Soup `soup.yaml`. see `docs/addons.md` for details.

### modules (add-ons)

install optional AI training tooling from the top-right **modules** nav item: Axolotl, Unsloth, **Soup** (low-VRAM fine-tuning, 8B on a 4 GB GPU), and **grui** (records screen + input for imitation learning). pip modules install into the training python; grui gets its own git clone + local venv. every step's output streams into the page. see `docs/addons.md`.

## baby's first project

1) make a directory
2) open directory with mama
3) design a multimodel interface, and save to directory
4) click begin training
5) export model

## settings (in-depth)

### general settings 

#### setup

## themes

the app uses a file-based theme system. themes are JSON files placed in `user/themes/`. each file adds an option to the appearance dropdown in settings.

### built-in themes

the app ships with no built-in theme visible in the dropdown. the only hardcoded palette is a dark fallback that activates automatically when `user/themes/` is empty. if the folder has any valid JSON themes, the fallback is replaced.

### adding a theme

create a new `.json` file in `user/themes/` with this structure:

```json
{
  "name": "my-theme",
  "title": "My Theme",
  "variables": {
    "--page-bg": "#ffffff",
    "--page-text": "#000000"
  }
}
```

- **name** — a short identifier (no spaces recommended). used internally and stored in settings.
- **title** — what appears in the dropdown menu.
- **variables** — CSS custom properties that change the app colours.

once saved, open **Settings → Appearance** and your theme will appear in the dropdown. no restart needed — just navigate to settings or reload the page.

### example themes

the repo includes three example themes in `user/themes/`:
- `light.json` — light mode
- `dark.json` — dark mode
- `dark-green.json` — dark mode with green accents

you can enable or disable any theme by adding or removing its `.json` file.

### fallback

if you remove all `.json` files from `user/themes/`, the dropdown will show only **System** and **Fallback**. the fallback is a default dark palette built into the app.
