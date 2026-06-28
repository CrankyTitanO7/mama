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


### custom theming

themes are set as css variables. each theme is represented as a .json file in user/themes. each json should automatically be added as an entry. additionally, duplicates will be ignored. 

the values of said themes can be any css accepted color value, in quotations.
