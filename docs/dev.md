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
