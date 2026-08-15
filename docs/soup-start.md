# Starting a Soup project

Three paths, from easiest to most manual. Prerequisites: the Soup add-on
installed (Modules page — one click; needs Python ≥3.10 in the shared
environment) and a mama project folder open.

## 1. From the fine-tune page (easiest)

1. Open a project folder in mama (File → Open).
2. Install the **Soup** add-on: Modules page → Soup → Install (packages
   go into the shared environment; pip steps use `uv` when it's on PATH).
3. Fine tune → **Browse Examples** → *Soup (low VRAM)* group → pick an
   example (`hello-sft` for any laptop, `lowvram-8b` for a ~4 GB GPU) →
   **Open example**. See `docs/soup-examples.md` for the trio.
4. In a terminal inside that folder:

   ```bash
   soup data download HuggingFaceH4/no_robots -o data/train.jsonl --samples 1000
   soup profile --config soup.yaml      # optional: size the run first
   soup train --config soup.yaml
   ```

   (the exact fetch command is in the example's README + card).

## 2. From Soup's own scaffolder

Any folder, no app needed:

```bash
soup init --template chat    # writes soup.yaml (also: code, medical, audio)
soup data download <hf-dataset> -o data/train.jsonl --samples N
soup train --config soup.yaml
```

## 3. With your own data

Data page → CSV / pasted text / grui recording → Alpaca JSONL in `data/`
→ `soup train --config soup.yaml`. `data.format: auto` detects alpaca,
chat and messages rows. The `your-data` example is this exact loop.

## Sanity checks at every step

```bash
soup --version                      # add-on (or soup-cli) present
soup data preview <hf-dataset>      # rows, columns, license before pulling
soup data inspect data/train.jsonl  # detected format + stats
soup data demo                      # bundled tiny fixtures (offline)
soup profile --config soup.yaml     # estimated RAM/time/VRAM before training
```

## Hardware notes

- **hello-sft / your-data** (TinyLlama-1.1B, LoRA): any laptop, CPU/MPS.
- **lowvram-8b** (Qwen2.5-8B, layer streaming + 4bit): ~4 GB CUDA GPU
  (MPS slower), ~8 GB free RAM, and it needs `soup` ≥0.72 for streaming.
- Shared env python version: 3.10–3.12 covers Soup's supported range.