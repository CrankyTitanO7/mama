# developer's guide

the complete comprehensive guide on every working part of this application, including intended usage and etc.

# Development Documentation: Framework Installation & Verification

## Overview
This module provides the logic for automatically installing deep learning frameworks (**PyTorch** and **TensorFlow**) and verifying their installation and hardware acceleration. It is designed to be called by a parent process (e.g., a Node.js application) and provides streamed output for real-time monitoring.

## Workflow Logic

### 1. Installation Phase (`install_fw.py`)
The installation script handles the mapping between user requirements and the specific `pip` commands needed.

**Logic Flow:**
1. **Input Parsing:** Accepts `framework` (torch/tf), `gpu_variant` (cuda/rocm/cpu), and an optional `accel_version`.
2. **Command Construction:** The `build_command()` function determines the correct installation string:
   - **PyTorch:** Maps requirements to `torch` installation strings, including specific wheels for CUDA or ROCm.
   - **TensorFlow:** Maps requirements to `tensorflow` or `tensorflow-gpu` packages.
   - **CPU Fallback:** Installs the CPU-only versions of the frameworks.
3. **Execution:** Executes the command using `subprocess.run()`.
   - **Output Streaming:** stdout and stderr are inherited, allowing the calling process to capture the installation progress in real-time.

### 2. Verification Phase (`import_test.py`)
After installation, this script ensures that the framework is functional and that the system hardware is correctly recognized.

**Logic Flow:**
- **PyTorch Verification:**
    - Attempts `import torch`.
    - **NVIDIA Path:** Checks `torch.cuda.is_available()` $\rightarrow$ Prints CUDA version, GPU count, and per-GPU properties (Model Name, VRAM).
    - **AMD Path:** Checks `torch.version.hip` $\rightarrow$ Prints ROCm version.
    - **CPU Path:** Falls back to "CPU only" status.
- **TensorFlow Verification:**
    - Attempts `import tensorflow as tf`.
    - **GPU Detection:** Uses `tf.config.list_physical_devices("GPU")` to list all available hardware.
- **Exit Status:** 
    - `0`: Success.
    - `1`: `ImportError` or critical failure.
    - `2`: Invalid arguments.

## Logic Summary Table

| Feature | PyTorch Path | TensorFlow Path |
| :--- | :--- | :--- |
| **Install Command** | `pip install torch` (+ variant) | `pip install tensorflow` (+ variant) |
| **Verification** | `import torch` | `import tensorflow as tf` |
| **Hardware Check** | `torch.cuda` / `torch.version.hip` | `tf.config.list_physical_devices` |
| **Diagnostics** | GPU Model, VRAM, CUDA/HIP Version | List of physical GPU devices |


## theme system

### architecture

themes are stored as JSON files in `user/themes/`. each file represents one theme and must contain three fields:

```json
{
  "name": "theme-id",
  "title": "Display Name",
  "variables": {
    "--highlight-color": "#00d4ff",
    "--main-color": "#1a1a2e"
  }
}
```

- **name** — unique identifier used as the internal key and stored in settings.
- **title** — human-readable label shown in the appearance dropdown.
- **variables** — a flat map of CSS custom properties to values. each key must start with `--`.

### theme loading flow

1. **startup** — `components/styling/theme.js` calls `window.electron.themesRead()` (IPC) on initialization.
2. **backend** — `components/styling/theme-loader.js` reads all `.json` files from `user/themes/`, validates structure (`name`, `title`, `variables`), and returns the array.
3. **renderer** — `theme.js` merges each theme's variables into a `palettes` lookup by `name`.
4. **settings** — both the settings page (`components/setup/settings.js`) and setup wizard (`components/setup/setup.js`) call `themesRead()` to populate the appearance dropdown.

### fallback behaviour

when `user/themes/` is empty or contains no valid `.json` files, the app falls back to a hidden built-in dark palette. this fallback is **never listed** in the dropdown — instead a single "Fallback" option appears. the fallback is hardcoded in `theme.js` as `fallbackPalette`.

### file locations

| file | purpose |
|------|---------|
| `user/themes/*.json` | user-provided theme files |
| `components/styling/theme-loader.js` | backend module that reads themes from disk |
| `components/styling/theme.js` | frontend theme manager — applies CSS variables, manages state |
| `components/backend/ipc/ipc-handlers.js` | registers `themes-read` IPC handler |
| `preload.js` | exposes `themesRead()` to renderer via contextBridge |

### creating a theme

drop a `.json` file into `user/themes/` with the schema above. the theme will appear automatically in the appearance dropdown on next page load. no app restart is required — navigating away and back, or clicking the reload button in settings, is sufficient.

### variables reference

the complete set of CSS custom properties a theme can define:

- `--highlight-color`
- `--main-color`
- `--shadow-color`
- `--heading-color`
- `--body-color`
- `--page-bg`
- `--page-text`
- `--page-muted`
- `--panel-bg`
- `--panel-border`
- `--widget-bg`
- `--widget-border`
- `--topbar-bg`
- `--topbar-border`
- `--topbar-text`
- `--topbar-muted`
- `--topbar-active`
- `--input-bg`
- `--input-text`
- `--input-border`
- `--button-secondary-bg`
- `--button-secondary-text`

all variables are optional — missing ones will simply not override the previous value.

### theme manager api

the `window.ThemeManager` object exposed by `theme.js` provides:

- `applyTheme(themeName, broadcast?)` — apply a theme by name
- `getCustomThemeList()` — returns `[{name, title}]` of loaded themes
- `isUsingFallback()` — returns true if no user themes exist
- `getActiveTheme()` — returns the currently active theme name
- `initializeTheme()` — re-initialize (loads themes from IPC, applies stored preference)
- `getResolvedTheme(themeName)` — returns the resolved palette key

## Setup Wizard — Modular Architecture

The setup wizard was refactored from a single 1727-line IIFE into a modular system. Each step lives in its own file under `components/setup/modules/`, and the order is controlled declaratively via `components/setup/setup.json`.

### File Layout

```
components/setup/
├── setup.js              # Parent loader — fetches setup.json, loads modules, bootstraps
├── setup.json            # Step definitions + setup_order array
└── modules/
    ├── _shared.js        # Shared state, utilities, settings, rendering
    ├── step-welcome.js
    ├── step-language.js
    ├── step-appearance.js
    ├── step-os-detect.js
    ├── step-python-detect.js
    ├── step-python-dependency.js
    ├── step-gpu-detect.js
    ├── step-compat-check.js
    ├── step-framework.js
    ├── step-fw-install.js
    ├── step-fw-verify.js
    ├── step-resources.js
    ├── step-project-folder.js
    ├── step-qol.js
    ├── step-security.js
    └── step-finish.js
```

### Bootstrap Flow

1. **`setup.js`** listens for `DOMContentLoaded`, then:
   - Fetches `setup.json` to get `steps` (definitions) and `setup_order` (ordering).
   - Loads `_shared.js` via dynamic `<script>` injection.
   - Loads each step module in the order listed in `steps`.
   - Reorders `window.__setupSteps` to match `setup_order`.
   - Builds the wizard DOM (`#setup-wizard` with header, content, progress dots, and action buttons).
   - Calls `window.__setupSettings.loadSettings()` to hydrate the settings cache.
   - Wires up navigation event listeners (next, back, skip, finish).
   - Renders the first step.

### Shared Module (`_shared.js`)

Exposes four global namespaces:

| Namespace | Purpose |
|-----------|---------|
| `window.__setupState` | All mutable state — `selectedFramework`, `selectedMode`, `installSucceeded`, `detected` (OS, Python, GPU, compat), `pythonDetectCache`, `selectedProjectFolder`, `currentStep`, `settingsCache` |
| `window.__setupUtils` | Pure utility functions — `escapeHtml`, `parseKV`, `boolVal`, `okIcon`, `warnIcon`, `gpuVariant`, `torchIndexURL`, `gpuVariantLabel`, `buildInstallCommand`, `getPythonDetectResult` |
| `window.__setupSettings` | Settings persistence — `loadSettings`, `defaultSettings`, `applyStepData`, `collectAndSave` |
| `window.__setupRender` | Rendering and navigation — `renderStep`, `nextStep`, `prevStep` |

### Step Module Contract

Each step module is an IIFE that pushes an object to `window.__setupSteps` with:

```js
{
  id: 'unique-step-id',           // matches the id in setup.json
  title: 'Display Title',         // shown in progress dots
  render(settingsCache) { ... },  // returns HTML string (synchronous)
  afterRender() { ... },          // async — runs after DOM is injected
  collect() { ... }               // returns data to persist into settings
}
```

- **`render()`** — must be synchronous. Returns the HTML for the step. Receives the current `settingsCache` as argument.
- **`afterRender()`** — optional async hook. Runs after the HTML is in the DOM. Used for event binding, async detection, and dynamic UI updates.
- **`collect()`** — optional. Called when the user navigates away from the step. Returns data that `applyStepData()` maps into the settings cache.

### Step Ordering

The `setup_order` array in `setup.json` is the single source of truth for navigation order. After all modules load, `setup.js` builds a lookup map by step ID and reassembles `window.__setupSteps` to follow `setup_order`. Steps not listed in `setup_order` are dropped. Steps listed but not found are silently skipped.

### Adding a New Step

1. Create `components/setup/modules/step-your-step.js` following the contract above.
2. Add an entry to the `steps` array in `setup.json`:
   ```json
   { "id": "your-step", "title": "Your Step", "script": "modules/step-your-step.js" }
   ```
3. Insert the step ID into `setup_order` at the desired position.

### Removing or Skipping a Step

- To remove: delete its entry from `steps` and remove its ID from `setup_order`.
- To skip without deleting: just remove its ID from `setup_order` — the module still loads but won't appear in the wizard.

## documentation

the documentation system is quite simple. add the relative path of any md file to docs/register.json (it assumes it is in docs folder, but you can change the path). see example: 
```json
{
  "display name" : "filename.md",
  "file outside of docs folder" : "../path/to/file.md"
}
```