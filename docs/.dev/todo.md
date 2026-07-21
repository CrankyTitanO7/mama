# to do list 

## bugs (known)
- <del>doesn't quit all the way sometimes (mac)</del>
- <del> user settings are softlocked on first launch. The setup wizard is not run because settings.json doesn't exist yet. </del>

## features
- finish multimodel designer
    - build basic training script-template

- build folder loader (important!) (also, do memory scan. make sure drive has enough memory for project)

- create prereq loaders
    - <del>pytorch (from site)
        - solve refreshing problem (probably via web-analysis?)
        - <del>REMEMBER MPS ONLY SUPPORTED ON NIGHTLY BUILD!!! HARDWARE DETECTION COMES FIRST</del>
        - https://docs.pytorch.org/assets/quick-start-module.js
        </del>
    - amd (rocm)
        - static load from documentation site
    - nvidia cuda
        - static load from documentation site

- bounty system loader
    - build external website (hosted via vercel? github statics? generated from gist?)
    - build refresh cache

## documentation

- finish documentation, somehow

## git and build

- ACTIVATE LFS BEFORE UPLOADING DESIGNS
- write README.MD
- configure git repo contribute settings, license settings, etc.

## aesthetic
- redesign default themes 
- design icons (BEFORE UPLOADING, ACTIVATE GIT LFS)

## long term
- language support
- due to missing certification, users on mac must run 
    ```zsh
    xattr -cr /path/to/application
    ```

Yeah, I've got a pretty clear picture. You're building something like a local, open-source Axolotl with a GUI — the gap I mentioned earlier. Here's how I'd actually approach the implementation:

## The core insight: don't write a training loop

Your instinct to "write a Python script that pulls a model and tunes it" will lead you down a path of reimplementing things that already exist and are very hard to get right (gradient accumulation, mixed precision, checkpointing, OOM handling). Instead, your Python scripts should be thin wrappers around HuggingFace's training stack:

- **`transformers`** — model loading, tokenization, saving
- **`datasets`** — dataset loading from HF Hub or local files
- **`peft`** — LoRA / QLoRA (this is what makes large models trainable on consumer hardware)
- **`trl`** — `SFTTrainer`, `DPOTrainer` etc. — the highest-level training API; one object handles the entire loop
- **`accelerate`** — device management, handles CPU/GPU/MPS/multi-GPU transparently
- **`bitsandbytes`** — 4-bit/8-bit quantization (required for QLoRA on consumer VRAM)

`trl`'s `SFTTrainer` in particular is the right starting point — it's literally designed for "take a model, take a dataset, fine-tune it" in about 20 lines.

## Architecture

```
Electron UI
    │
    ├── generates a training config JSON (the "project")
    │
    └── spawns: python train.py config.json
                    │
                    ├── streams progress to stdout  ← your IPC reads this
                    │   STEP=120 LOSS=1.4231 EPOCH=1 ETA=00:14:32
                    │
                    ├── writes checkpoints to output dir
                    └── writes final model to output dir
```

The config JSON becomes the central data structure — it's what a "training project" is. Users create, save, and load these. Something like:

```json
{
  "model": {
    "id": "microsoft/phi-2",
    "source": "huggingface"
  },
  "dataset": {
    "id": "tatsu-lab/alpaca",
    "source": "huggingface",
    "split": "train",
    "text_field": "text"
  },
  "method": "lora",
  "lora": {
    "r": 16,
    "alpha": 32,
    "target_modules": ["q_proj", "v_proj"],
    "dropout": 0.05
  },
  "training": {
    "epochs": 3,
    "batch_size": 4,
    "gradient_accumulation": 4,
    "learning_rate": 2e-4,
    "warmup_steps": 100,
    "save_steps": 500
  },
  "output": {
    "dir": "/Users/x/mama-projects/my-run",
    "push_to_hub": false
  }
}
```

## Training methods to support, in priority order

**1. LoRA fine-tuning (build this first)**
Works on any NVIDIA GPU with 6+ GB VRAM, AMD with ROCm, Apple Silicon via MPS. Covers 90% of your user base. The model stays frozen; small adapter weights are trained and merged later.

**2. QLoRA (build this second)**
LoRA + 4-bit quantization via `bitsandbytes`. Lets users fine-tune 7B–13B models on 8 GB VRAM. Only works on NVIDIA (bitsandbytes has limited AMD/Apple support as of now — worth flagging in the UI).

**3. Full fine-tuning (build this third, gate it behind a warning)**
No adapters — the whole model trains. Requires massive VRAM or multi-GPU. Only practical for small models (< 1B params) on consumer hardware. Still useful for image classifiers etc.

**4. Multimodal (later)**
Whisper fine-tuning (audio→text) is actually the easiest entry point because the architecture is simple. Vision-language (LLaVA-style) is significantly harder. I'd punt on multimodal until the text pipeline is solid.

## What the minimal train.py looks like

```python
# train.py — receives config path as argv[1], streams progress to stdout
import json, sys
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer
import torch

config = json.load(open(sys.argv[1]))

# ── Model ──────────────────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained(config['model']['id'])
model     = AutoModelForCausalLM.from_pretrained(
    config['model']['id'],
    torch_dtype=torch.float16,
    device_map='auto',     # accelerate handles CPU/GPU/MPS automatically
)

# ── LoRA ───────────────────────────────────────────────────────────
lora_cfg = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=config['lora']['r'],
    lora_alpha=config['lora']['alpha'],
    target_modules=config['lora']['target_modules'],
    lora_dropout=config['lora']['dropout'],
)
model = get_peft_model(model, lora_cfg)

# ── Dataset ────────────────────────────────────────────────────────
dataset = load_dataset(config['dataset']['id'], split=config['dataset']['split'])

# ── Progress callback → stdout so Electron can read it ────────────
from transformers import TrainerCallback

class StreamingCallback(TrainerCallback):
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs:
            loss  = logs.get('loss', '')
            epoch = logs.get('epoch', '')
            step  = state.global_step
            # Electron parses these lines
            print(f"STEP={step} LOSS={loss:.4f} EPOCH={epoch:.2f}", flush=True)

# ── Train ──────────────────────────────────────────────────────────
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field=config['dataset']['text_field'],
    args=TrainingArguments(
        output_dir=config['output']['dir'],
        num_train_epochs=config['training']['epochs'],
        per_device_train_batch_size=config['training']['batch_size'],
        gradient_accumulation_steps=config['training']['gradient_accumulation'],
        learning_rate=config['training']['learning_rate'],
        warmup_steps=config['training']['warmup_steps'],
        save_steps=config['training']['save_steps'],
        fp16=torch.cuda.is_available(),
        bf16=False,
        logging_steps=10,
        report_to='none',   # disable wandb etc.
    ),
    callbacks=[StreamingCallback()],
)

trainer.train()
trainer.save_model(config['output']['dir'])
print("DONE", flush=True)
```

## UI flow (what pages you need)

```
Model Browser
  → search HF Hub or paste model ID
  → shows model size, architecture, license
  → "Download" button (streams download progress)

Dataset Browser
  → search HF datasets or import local JSONL/CSV
  → preview rows
  → pick the text column(s)

Training Config
  → method picker (LoRA / QLoRA / Full)
  → hyperparameters with sensible defaults and tooltips
  → hardware check ("your GPU has 8 GB — recommended: LoRA with r=8")

Training View
  → live loss curve (recharts)
  → step / epoch / ETA
  → GPU/VRAM usage (your resources widget already does this)
  → Pause / Resume / Cancel buttons

Output / Export
  → checkpoint browser
  → merge LoRA adapters into base model
  → push to HF Hub (optional)
  → test with a chat UI inline
```

## The hardest parts to get right

**OOM handling** — when the user's GPU runs out of memory mid-training, you need to catch it gracefully and suggest fixes (reduce batch size, enable gradient checkpointing, switch to QLoRA). The Python script should catch `torch.cuda.OutOfMemoryError` and print a structured error code that Electron can surface as a helpful suggestion rather than a raw traceback.

**Model compatibility** — not every HF model works with every training method. You need a compatibility layer that checks whether a model supports LoRA target modules before the user starts a run. HF's model cards have enough metadata to do this.

**Resume from checkpoint** — training runs fail. The output dir already has checkpoints; you need a "resume" flow that detects the last checkpoint and continues from there.

## What to actually build first

1. The model downloader (HF Hub → local folder, with streaming progress)
2. The dataset loader (HF datasets + local JSONL)
3. The config builder UI (the form that generates the JSON)
4. `train.py` with `SFTTrainer` + streaming callback, LoRA only
5. The training view that reads stdout progress and draws the loss curve

Get that end-to-end working on one model (Phi-2 or TinyLlama are good test targets — small enough to run on anything) before adding more training methods or multimodal support. The pipeline is more complex than it looks even for the simple case.