# the power user's manual

welcome to the power user guide. this is a supplement to the regular user manual (aimed towards AI beginners), detailing some tips and tricks beyond normal usage.

for in depth explanations of each component, refer to the developer's guide.

## the user folder

the user folder, located at mama/user, holds most of everything the user will need. it is here that most files are, including for custom editing. 

## Framework Installation & Verification

### Installation (`install_fw.py`)
Handles the installation of **PyTorch** and **TensorFlow** via `pip`. 
- **Variants:** Supports `cuda` (NVIDIA), `rocm` (AMD), and `cpu` (Standard).
- **Logic:** Dynamically builds the installation command based on the requested framework and hardware variant.
- **Execution:** Uses `subprocess.run` to execute the installation, streaming output for real-time monitoring.

### Verification (`import_test.py`)
Verifies the installation and hardware acceleration.
- **PyTorch:** Checks for CUDA/ROCm availability and prints GPU details (Model, VRAM, Version).
- **TensorFlow:** Checks for available physical GPU devices.
- **Error Handling:** Returns exit code `0` on success or `1` on `ImportError`, allowing the pipeline to detect installation failures.

### Summary Table

| Feature | PyTorch | TensorFlow |
| :--- | :--- | :--- |
| **Install** | `pip install torch` | `pip install tensorflow` |
| **Verification** | `import torch` | `import tensorflow` |
| **Hardware Check** | CUDA / ROCm / CPU | Physical GPU devices |
| **Diagnostics** | GPU Model & VRAM | Device List |


## Setup Wizard — Modular Architecture

The setup wizard (`components/setup/setup.js`) has been refactored from a single monolithic script into a modular system. Each step of the wizard lives in its own file under `components/setup/modules/`, and the order is controlled by `components/setup/setup.json`.

### How it works

1. **`setup.json`** defines two things:
   - `steps` — an array of step definitions, each with an `id`, `title`, and `script` path.
   - `setup_order` — an ordered array of step IDs that determines the wizard's navigation sequence.

2. **`setup.js`** (the parent loader) fetches `setup.json`, loads `_shared.js`, then loads each step module. After all modules are loaded, it reorders `window.__setupSteps` to match `setup_order`.

3. **`modules/_shared.js`** provides shared state (`window.__setupState`), utilities (`window.__setupUtils`), settings management (`window.__setupSettings`), and rendering/navigation (`window.__setupRender`).

4. **Each step module** (e.g., `step-welcome.js`, `step-framework.js`) is an IIFE that pushes a step object with `{ id, title, render, afterRender?, collect? }` to `window.__setupSteps`.

### Reordering steps

To change the wizard's step order, edit the `setup_order` array in `setup.json`. No JavaScript changes are needed. For example, to move "Language" after "Appearance":

```json
"setup_order": [
  "welcome",
  "appearance",
  "language",
  ...
]
```

### Adding a new step

1. Create a new file in `components/setup/modules/step-your-step.js`.
2. Add its definition to the `steps` array in `setup.json`.
3. Add its ID to `setup_order` at the desired position.

### custom theming

themes are set as css variables. each theme is represented as a .json file in user/themes. each json should automatically be added as an entry. additionally, duplicates will be ignored. 

the values of said themes can be any css accepted color value, in quotations.
