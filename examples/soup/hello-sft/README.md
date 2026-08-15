# hello-sft — the "does it work?" Soup run

Smallest possible real training run: LoRA-fine-tune **TinyLlama-1.1B-Chat**
on a slice of a public Hugging Face dataset. No GPU needed — CPU/MPS is
fine — and it finishes in minutes.

## 1. Requirements

- mama project open (this folder has `project.json`); the **Soup** add-on
  installed from the *Modules* page — that puts `soup` on the shared Python.
- `soup --version` in a terminal to confirm.

## 2. Get the data

Soup pulls straight from the Hugging Face Hub, the same way mama pulls
models:

```bash
soup data preview HuggingFaceH4/no_robots    # metadata first: rows, columns, license
soup data download HuggingFaceH4/no_robots -o data/train.jsonl --samples 1000
```

`no_robots` is 10k rows of clean instruction/response pairs (CC-BY-4.0 —
attribution preserved in the files you train on). `--samples 1000` keeps
the first run small; drop it when you want the full set.

Quick sanity check, no training involved:

```bash
soup data inspect data/train.jsonl           # detected format + row stats
soup profile --config soup.yaml              # estimated RAM/time before you commit
```

## 3. Train

```bash
soup train --config soup.yaml
```

LoRA adapters land in `./output/` every `save_steps`; the run streams
progress into the terminal (and into the Modules/Data pages if you run it
from mama's UI).

## 4. Next steps

- Swap `base:` for another smallish open model (Qwen2.5-1.5B-Instruct, …).
- Point `data.train` at a set you built on the **Data page** (your CSV,
  pasted text, or a grui recording) — same `format: auto`, same command.
- See `../lowvram-8b/` for the same shape on an 8B class model, and
  `../your-data/` for the bring-your-own-data loop.

## Alternatives for `data.train`

```bash
soup data demo                            # bundled tiny fixtures (no network)
soup data search "instruction tuning"     # find more Hub datasets
soup data search --sort likes --limit 10
```