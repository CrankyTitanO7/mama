# Fine-Tuning Project Examples

Every example below uses **Hugging Face sources only** (model and dataset IDs
are HF Hub identifiers). Each project category ships in one or more hardware
tiers so you can pick the one that matches your machine:

| Tier | Typical hardware | Notes |
|------|------------------|-------|
| **Easy** | CPU, Apple Silicon 8 GB, GPU < 6 GB VRAM | 135M–1.1B models, LoRA, short sequences |
| **Medium** | Apple Silicon 16 GB+, GPU 6–16 GB VRAM | 1.1B–3.8B models, LoRA / QLoRA |
| **Hard** | GPU 24 GB+ VRAM | 7B+ models, QLoRA, longer sequences |

All models are causal language models, so every example works with the built-in
SFT trainer (LoRA / QLoRA). Each example is tagged with the backend it is
curated for; in Step 0 of the Fine-Tune page the cards for the selected backend
are highlighted.

## Built-in (TRL) examples — mama-curated

## 1. Text-to-SQL Copilot
* **The Goal**: Convert natural language questions into executable database queries.
* **Dataset**: `b-mc2/sql-create-context` (text column: `answer`).
* **Why it's great**: Shows immediate business value and teaches structured text generation.

| Tier | Base Model |
|------|------------|
| Easy | `HuggingFaceTB/SmolLM2-135M-Instruct` — LoRA, seq 512, ~2k samples |
| Medium | `TinyLlama/TinyLlama-1.1B-Chat-v1.0` — LoRA, seq 1024, ~8k samples |
| Hard | `NousResearch/Llama-2-7b-chat-hf` — QLoRA, seq 2048, ~15k samples |

## 2. Customer Support Ticket Classifier
* **The Goal**: Categorize incoming emails into departments (e.g., Billing, Tech Support, Refunds) and detect urgency.
* **Dataset**: `PolyAI/banking77` (text column: `text`).
* **Why it's great**: Cheap and fast to train, highly accurate, and runs easily on a free tier.

| Tier | Base Model |
|------|------------|
| Easy | `HuggingFaceTB/SmolLM2-135M-Instruct` — LoRA, seq 256 |
| Medium | `google/gemma-2b-it` — LoRA, seq 512 |
| Hard | `mistralai/Mistral-7B-Instruct-v0.3` — QLoRA, seq 1024 |

## 3. Medical / Legal Terminology Simplifier
* **The Goal**: Translate complex jargon from professional documents into simple, layman's terms.
* **Dataset**: `medalpaca/medical_meadow_wikidoc` (text column: `output`).
* **Why it's great**: Demonstrates domain adaptation, which is a major real-world use case for AI engineering.

| Tier | Base Model |
|------|------------|
| Easy | `TinyLlama/TinyLlama-1.1B-Chat-v1.0` — LoRA, seq 512 |
| Medium | `microsoft/Phi-3-mini-4k-instruct` — QLoRA, seq 1024 |
| Hard | `NousResearch/Llama-2-7b-chat-hf` — QLoRA, seq 2048 |

## 4. Brand-Voice Copywriter
* **The Goal**: Write marketing copy or social media posts in the exact tone of a specific brand or creator.
* **Dataset**: `databricks/databricks-dolly-15k` (text column: `output`).
* **Why it's great**: Perfect for learning how to handle small, highly specialized datasets with LoRA.

| Tier | Base Model |
|------|------------|
| Easy | `HuggingFaceTB/SmolLM2-135M-Instruct` — LoRA, seq 512 |
| Medium | `TinyLlama/TinyLlama-1.1B-Chat-v1.0` — LoRA, seq 1024 |
| Hard | `mistralai/Mistral-7B-Instruct-v0.3` — QLoRA, seq 2048 |

## Axolotl examples — official recipes

Sourced from the official Axolotl repo (`axolotl-ai-cloud/axolotl`, `examples/` directory).

## 5. Axolotl Starter — Llama 3.2 1B LoRA
* **Source**: `examples/llama-3/lora-1b.yml` (LoRA, r=16/α=32, lr 2e-4, cosine, flash attention, grad checkpointing).
* **Dataset**: `teknium/GPT4-LLM-Cleaned` (Alpaca, text column: `output`).

| Tier | Base Model |
|------|------------|
| Easy | `NousResearch/Llama-3.2-1B` — LoRA, seq 2048, ~2k samples |
| Medium | `NousResearch/Llama-3.2-1B` — LoRA, seq 2048, ~10k samples |
| Hard | `NousResearch/Llama-3.2-1B` — LoRA, seq 2048, full 20k samples |

## 6. Axolotl Power — Mistral 7B QLoRA
* **Source**: `examples/mistral/qlora.yml` (QLoRA, 4-bit, r=32/α=16, lr 2e-4, adamw_bnb_8bit, flash attention).
* **Dataset**: `mhenrichsen/alpaca_2k_test` (Alpaca, text column: `output`).

| Tier | Base Model |
|------|------------|
| Medium | `mistralai/Mistral-7B-v0.1` — QLoRA, seq 4096 |
| Hard | `mistralai/Mistral-7B-v0.1` — QLoRA, seq 8192 |

## 7. Axolotl Big — Qwen3 32B QLoRA
* **Source**: `examples/qwen3/32b-qlora.yaml` (QLoRA, 4-bit, flash attention, bf16).
* **Dataset**: `mlabonne/FineTome-100k` (ShareGPT, text column: `conversations`).

| Tier | Base Model |
|------|------------|
| Hard | `Qwen/Qwen3-32B` — QLoRA, seq 8192, ~8k samples |

## Unsloth examples — official tutorials / notebooks

Sourced from the official Unsloth docs (`unsloth.ai/docs`) and notebooks repo (`unslothai/notebooks`). Defaults per the fine-tuning guide: QLoRA (4-bit), r=16/α=16, lr 2e-4, seq 2048, 1 epoch.

## 8. Unsloth — Llama 3.1 8B Chat
* **Source**: https://unsloth.ai/docs/get-started/fine-tuning-llms-guide
* **Dataset**: `vicgalle/alpaca-gpt4` (Alpaca, text column: `output`).

| Tier | Base Model |
|------|------------|
| Medium | `unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit` — QLoRA, ~5k samples |
| Hard | `unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit` — QLoRA, full 20k samples |

## 9. Unsloth — Llama 3.2 3B Instruct
* **Source**: `notebooks/nb/Llama-3.2 (3B)-Conversational.ipynb`
* **Dataset**: `yahma/alpaca-cleaned` (Alpaca, text column: `output`).

| Tier | Base Model |
|------|------------|
| Easy | `unsloth/Llama-3.2-3B-Instruct` — QLoRA, ~2k samples |
| Medium | `unsloth/Llama-3.2-3B-Instruct` — QLoRA, ~10k samples |

## 10. Unsloth — Gemma 2 9B Chat
* **Source**: `notebooks/nb/Gemma2 (9B)-Alpaca.ipynb`
* **Dataset**: `vicgalle/alpaca-gpt4` (Alpaca, text column: `output`).

| Tier | Base Model |
|------|------------|
| Medium | `unsloth/gemma-2-9b-bnb-4bit` — QLoRA, ~5k samples |
| Hard | `unsloth/gemma-2-9b-bnb-4bit` — QLoRA, ~15k samples |
