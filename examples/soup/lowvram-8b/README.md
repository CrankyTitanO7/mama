# lowvram-8b — 8B-class tuning on a ~4 GB GPU

LoRA-fine-tune **Qwen2.5-8B-Instruct** with **layer streaming**: the frozen
base is quantised to 4bit once (sharded and cached), then decoder layers
are streamed one at a time from RAM into two small VRAM buffers while the
previous layer still computes. Peak VRAM is bounded by a single layer, not
the whole model — the upstream build trains on ~4 GB GPUs (peak just under
~3.5 GB in their benchmark; your mileage varies with batch size and
`stream_buffers`).

## Requirements

- CUDA GPU with ~4 GB VRAM (or MPS on Apple Silicon — expect slower).
- **Soup** add-on installed in mama (Modules page).
- ~8 GB free RAM for the streaming source.

## Run

```bash
soup data preview teknium/OpenHermes-2.5
soup data download teknium/OpenHermes-2.5 -o data/train.jsonl --samples 2000
soup profile --config soup.yaml --gpu 4090   # bandwidth/VRAM estimate, no training
soup train --config soup.yaml
```

`profile` is your friend before the first run: it estimates what the run
needs so you can tune `batch_size` / `stream_buffers` / `max_length`
before burning watts.

## Tuning knobs on this config

| knob | what it does | tradeoff |
|------|--------------|----------|
| `training.batch_size` | rows per step in VRAM | 2 fits a 4 GB card; raise on 8 GB+ |
| `stream_buffers` | double/quad buffering | more buffers = more VRAM, less latency |
| `quantization: 4bit` | NF4 base shard | big VRAM saving; first run pays quantisation once |
| `max_length: 1024` | sequence cap | longer rows cost activation memory |
| `save_steps` | checkpointing cadence | lower = more checkpoints, more disk |

## Making it honest

Layer streaming needs an SFT/DPO-family task — GRPO/PPO rollouts re-read
every layer per token and are refused by Soup (permanent), so keep this
config on `sft`. Same shape works for you: point `data.train` at any
JSONL (Data page output included) and re-`profile`.