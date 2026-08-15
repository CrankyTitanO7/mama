# Example projects

Copy a folder into your projects area (or open it directly in mama — each
has a `project.json`) and follow its README. Data is never committed here:
every example pulls its dataset from the Hugging Face Hub via
`soup data download` (or builds it from your own rows on mama's Data
page), the same way mama pulls models.

| project | model | dataset | hardware | runbook |
|---------|-------|---------|----------|---------|
| `soup/hello-sft` | TinyLlama-1.1B-Chat | `HuggingFaceH4/no_robots` (CC-BY-4.0) | any laptop, CPU/MPS | minutes, LoRA SFT |
| `soup/lowvram-8b` | Qwen2.5-8B-Instruct | `teknium/OpenHermes-2.5` (MIT) | ~4 GB CUDA GPU (MPS slower) | layer-streamed 4bit LoRA, the headline claim |
| `soup/your-data` | any (1.1B default) | your rows: Data page / Hub / demo fixtures | any | bring-your-own-data loop |

All examples use `soup train --config soup.yaml`; run
`soup profile --config soup.yaml` first to see what the run will need.