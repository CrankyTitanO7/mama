# MAMA

> **Build, train, and run AI models locally—without fighting the command line.**

MAMA is a cross-platform desktop application that makes local AI development approachable. Instead of editing YAML files, memorizing command-line arguments, or spending hours configuring environments, MAMA guides you through the entire process with a visual interface.

Whether you're training your first language model or experimenting with advanced workflows, MAMA keeps the power of modern AI tooling while removing the friction.

---

## Why MAMA?

Getting started with local AI training can be overwhelming.

Most frameworks expect you to:

* Learn dozens of configuration options
* Edit YAML files by hand
* Manage Python environments
* Install CUDA, PyTorch, and backend dependencies
* Debug cryptic errors before training even begins

MAMA was built to change that.

Instead of forcing users to learn tooling before learning AI, MAMA lets you focus on building models.

---

## Features

### 🖥 Native Desktop Application

Runs natively on Windows, macOS, and Linux.

No browser tabs.
No cloud accounts.
No subscriptions.

Your models stay on your computer.

---

### 🧠 Beginner-Friendly Training

Create a project, choose a model, import a dataset, and start training through a guided interface.

No YAML.
No terminal required.

---

### flexibility

supports multiple backends, including Axolotl AI and Unsloth AI

Supports MacOS and Windows, with Linux support on the way

easy development for developers

ultra-modularized code

--- 

### ⚙️ Build System

Save complete training configurations as reusable **Builds**.

Instead of remembering dozens of hyperparameters, you can:

* Create reusable workflows
* Share configurations with others
* Reproduce experiments
* Switch between different training setups instantly

---

### 🚀 Local-First

MAMA is designed around local AI.

Your datasets, checkpoints, and projects remain yours.

---

### 🔧 Automatic Environment Management

MAMA handles many of the frustrating setup tasks automatically.

Including:

* Python environment detection
* Dependency installation
* GPU detection
* Hardware compatibility
* Platform-specific configuration

Spend less time debugging installations and more time training.

---

### 📦 Project Management

Organize everything in one place.

Manage:

* Models
* Datasets
* Projects
* Training runs
* Builds
* Settings

without digging through folders.

---

## Planned Features

* Build marketplace
* One-click model downloads
* Dataset utilities (custom dataset editor)
* Online plugin support
* Advanced monitoring

---

# Screenshots
## training page
visualize your training statistics
<img width="1166" height="1011" alt="training" src="https://github.com/user-attachments/assets/82c605bf-0137-42af-ade1-aa0b95b56b97" />
## modular backends
modular backend setup for Unsloth and Axolotl
<img width="1168" height="1007" alt="modules" src="https://github.com/user-attachments/assets/86cd8706-924a-416c-b28d-9097f5f8817b" />
## mission control
all of your hardware/software checks in one place
<img width="1168" height="1007" alt="mission control" src="https://github.com/user-attachments/assets/ecbff9ed-d67b-4d24-8fae-6a76dc1bafcd" />
## homepage
with a tailored, modular styling system
<img width="1168" height="848" alt="mainscreen" src="https://github.com/user-attachments/assets/40da9dca-5593-494a-b4f5-246738880fed" />
## fine tune
easy export to other backends, including example projects
<img width="1169" height="1008" alt="fine tune 1" src="https://github.com/user-attachments/assets/8aca867b-f712-404f-8712-7b7c4a195ff0" />
## export
options to export, including other backends, Google Colab support for training for free on a powerful compute backend, and more options
<img width="1166" height="1002" alt="export" src="https://github.com/user-attachments/assets/99517807-4f6c-48a1-9131-003c2c1dea4c" />
## dataset viewer
modules that allow you to access external websites in-app, including tutorials, Huggingface, database exporers, and more.
<img width="1164" height="1012" alt="databse explorer" src="https://github.com/user-attachments/assets/955fe178-1dc0-4745-9642-282d5c8d5c48" />


---

# Installation
> NOTE: DO NOT PRESS FINISH ON THE VERY LAST STEP UNTIL THE PROGRAM IS DONE INSTALLING. Yes, it's very misleading, I will fix it eventually, but it's basically a "skip" button for now. When it is actually done installing, another green button with "Start using mama will appear." 

### Windows

Download the latest release and run the installer.

### macOS

Download the latest `.dmg`.

### Linux

Download the AppImage or install from source.

---

## Building from Source

```bash
git clone https://github.com/CrankyTitanO7/mama.git
cd mama
pip install pywebview
python main.py
```
or to build an executable:
```bash
pip install pyinstaller pywebview
pyinstaller main.spec
```

---

# Philosophy

MAMA is built around a simple idea:

> AI should be difficult because of the problems you're solving—not because of the tools you're forced to use.

Modern AI frameworks are incredibly powerful, but their learning curve often starts with configuration files, dependency conflicts, and command-line interfaces.

MAMA doesn't replace those tools.

It makes them accessible.

## open source forever

published under an open source license (thumbs up emoji)

---

# Who is MAMA for?

✅ Students

✅ Researchers

✅ Hobbyists

✅ Developers learning AI

✅ Anyone who wants to train models locally without wrestling with configuration files

---

# why is it called mama

mama is easy to pronounce in every language.

---
# Contributing

Contributions are welcome.

Whether you're fixing bugs, improving documentation, designing UI, or adding new training backends, we'd love your help.

If you're looking for a place to start, check the Issues page for beginner-friendly tasks.

---

# License

See the LICENSE file for details.
