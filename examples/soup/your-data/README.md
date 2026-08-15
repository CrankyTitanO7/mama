# your-data — the bring-your-own-data loop

The template for "my own task, my own rows": build a dataset locally, drop
it here, train. No Hub involved unless you want it.

## Route A — mama's Data page (recommended)

1. Open this folder as a project in mama (it has `project.json`).
2. **Data page** → pick a source:
   - *grui recordings* (if grui add-on installed) — every annotation
     becomes an instruction/response example;
   - *CSV / TSV* — preview, choose instruction/response/context columns;
   - *paste text* — `Q:`/`A:` blocks or tab-separated pairs.
   The Output tab writes **Alpaca JSONL** (`instruction/input/output`) or
   **TRL** (`prompt/completion`) — Soup autodetects both (`format: auto`).
3. Save it as `data/train.jsonl` (default output folder is this project's
   `data/`, so this is usually a no-op).
4. `soup train --config soup.yaml`.

## Route B — Hugging Face Hub

Same pull pattern as the other examples:

```bash
soup data search "your task"                 # or browse the Hub
soup data preview <hf-dataset>               # rows, columns, license
soup data download <hf-dataset> -o data/train.jsonl [--samples N]
soup train --config soup.yaml
```

## Route C — seed a demo (no network)

```bash
soup data demo                               # list bundled fixtures
soup data demo alpaca_demo --output data/train.jsonl
```

## How much data do you need (Soup's own guidance)

- **A style** (output shape, tone) — hundreds of rows.
- **A task the model half-knows** (your flavour of summarisation…) — thousands.
- **New facts** — fine-tuning is usually the wrong tool; retrieval (RAG)
  belongs in the prompt instead.

`soup advise data/train.jsonl --goal "<what you want>"` reads your rows and
tells you which bucket you are in before you spend a training run on it.

## Growing into the heavy stuff

The same file works for the bigger claim: copy `../lowvram-8b/soup.yaml`
and point its `data.train` at this project's `data/train.jsonl`.
DPO/GRPO/RLHF shapes (`prompt`/`chosen`/`rejected`, reasoning traces) go
into the same `data:` block — see Soup's own `examples/configs/` and
`docs/training.md`.