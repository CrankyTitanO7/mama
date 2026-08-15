# Soup example projects

mama ships three ready-to-run **Soup example projects** under
`examples/soup/` (the *Docs* page links here). Each folder is a complete
mama project — it has a `project.json`, a tuned `soup.yaml`, and a README
runbook. Data is **never committed**: every example pulls its dataset from
the Hugging Face Hub with `soup data download`, the same way mama pulls
models.

| example | model | dataset | hardware | what it proves |
|---------|-------|---------|----------|----------------|
| `hello-sft` | TinyLlama-1.1B-Chat | `HuggingFaceH4/no_robots` (CC-BY-4.0) | any laptop, CPU/MPS | a real but tiny LoRA SFT in minutes |
| `lowvram-8b` | Qwen2.5-8B-Instruct | `teknium/OpenHermes-2.5` (MIT) | ~4 GB CUDA GPU | layer streaming: 8B training bounded by one layer, not the model |
| `your-data` | any (1.1B default) | your own rows | any | the Data-page → `soup train` loop |

## Using one

1. Open the folder in mama as a project (File → Open), or copy it into
   your projects area first. Installing the **Soup** add-on (Modules page)
   puts `soup` on mama's shared Python.
2. In a terminal inside the project:

   ```bash
   soup data preview <hf-dataset>          # license + shape before pulling
   soup data download <hf-dataset> -o data/train.jsonl --samples N
   soup profile --config soup.yaml         # estimate before you commit
   soup train --config soup.yaml
   ```

3. LoRA adapters land in `./output/`.

Every example sets `data.format: auto`, so it accepts any mix of alpaca /
chat / messages rows — including JSONL you built on the **Data page**
(which pairs with `your-data` by design).

## Data without the Hub

```bash
soup data demo                             # bundled tiny fixtures (offline)
soup data search "instruction tuning"      # find more datasets
soup data download <id> --samples N        # small slices of big sets
```

## Soup's own material

`soup init --template chat|code|medical|audio` scaffolds configs, and the
upstream repo ships deeper recipes (`examples/configs/`: DPO, GRPO,
full RLHF chain, vision) plus a synthetic-data workflow. See
https://github.com/MakazhanAlpamys/Soup (`docs/`).

## Example metadata

Each example's `project.json` carries `"example": true` plus a `soup:`
block (`config`, `model`, `dataset`, `fetch`, `train`) — machine-readable
so the app can later offer "open example" chips without hardcoding paths.