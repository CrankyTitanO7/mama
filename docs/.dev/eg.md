# Fine-Tuning Project Examples

Every example below uses **Hugging Face sources only** (model and dataset IDs
are HF Hub identifiers). Each project category ships in three hardware tiers so
you can pick the one that matches your machine:

| Tier | Typical hardware | Notes |
|------|------------------|-------|
| **Easy** | CPU, Apple Silicon 8 GB, GPU < 6 GB VRAM | 135M–1.1B models, LoRA, short sequences |
| **Medium** | Apple Silicon 16 GB+, GPU 6–16 GB VRAM | 1.1B–3.8B models, LoRA / QLoRA |
| **Hard** | GPU 24 GB+ VRAM | 7B models, QLoRA, longer sequences |

All models are causal language models, so every example works with the built-in
SFT trainer (LoRA / QLoRA).

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
