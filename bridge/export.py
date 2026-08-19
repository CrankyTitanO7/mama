"""bridge/export.py — training run export mixin (Colab / JS / Ollama / configs)."""

import os
import json
import shutil
from pathlib import Path

from .core import logger


class ExportMixin:
    """Export trained runs to Colab, JavaScript (ONNX.js), Ollama, Axolotl YAML or Unsloth scripts."""

    def export_run_colab(self, output_dir: str) -> dict:
        """Export training code to a Google Colab-compatible notebook."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            template_src = self._base_dir / 'components' / 'export' / 'template' / 'colab' / 'colab_export.ipynb'
            if not template_src.exists():
                return {'success': False, 'error': 'Colab template not found'}

            # Read template notebook
            with open(template_src, 'r', encoding='utf-8') as f:
                notebook = json.load(f)

            # Find the CONFIG cell (cell index 1, the code cell with CONFIG_JSON)
            config_found = False
            training_cfg = out / 'training_config.json'
            if training_cfg.exists():
                config_data = json.loads(training_cfg.read_text('utf-8'))
                config_json = json.dumps(config_data, indent=2)
                # Use concatenation, NOT an f-string — config_json contains { }
                notebook['cells'][1]['source'] = [
                    '# --- TRAINING CONFIG (injected by mama from training_config.json) ---\n',
                    '\n',
                    "CONFIG_JSON = '''" + config_json + "'''\n",
                ]
                config_found = True
                logger.info('Injected config from %s', training_cfg)

            if not config_found:
                # Cell already has a helpful fallback message; just log it
                logger.info('No training_config.json found; keeping fallback guidance in notebook')

            dest = out / 'colab_export.ipynb'
            with open(dest, 'w', encoding='utf-8') as f:
                json.dump(notebook, f, indent=1, ensure_ascii=False)

            logger.info('Colab export created at %s', dest)
            return {
                'success': True,
                'path': str(dest),
                'has_config': config_found,
            }
        except Exception as e:
            logger.error('export_run_colab failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_js(self, output_dir: str) -> dict:
        """Export trained model to JavaScript (ONNX.js) format."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            template_src = self._base_dir / 'components' / 'export' / 'template' / 'js' / 'js_export.js'
            if not template_src.exists():
                return {'success': False, 'error': 'JS export template not found'}

            js_dir = out / 'js_export'
            js_dir.mkdir(parents=True, exist_ok=True)

            # Copy the JS template
            shutil.copy2(str(template_src), str(js_dir / 'model_runner.js'))

            # Detect if a trained model exists
            model_path = out / 'final_model'
            if not model_path.exists():
                checkpoints = sorted(out.glob('checkpoint-*'))
                if checkpoints:
                    model_path = checkpoints[-1]

            conversion = None
            if model_path.exists():
                python = self._get_training_python()
                conversion_script = str(self._base_dir / 'components' / 'backend' / 'training' / 'convert_to_onnx.py')
                if python and Path(conversion_script).exists():
                    result = self._run_script(
                        conversion_script,
                        ['--input-dir', output_dir, '--output-dir', str(js_dir)],
                        timeout=300_000,
                        python_exe=python
                    )
                    conversion = result['code'] == 0
                    if not conversion:
                        logger.warning('ONNX conversion failed, template still copied')

            logger.info('JS export created at %s', js_dir)
            return {
                'success': True,
                'path': str(js_dir),
                'has_model': model_path.exists(),
                'converted': conversion,
            }
        except Exception as e:
            logger.error('export_run_js failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_ollama(self, output_dir: str) -> dict:
        """Export trained model to Ollama via Modelfile."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            ollama_dir = out / 'ollama_export'
            ollama_dir.mkdir(parents=True, exist_ok=True)

            # Find model directory
            model_path = out / 'final_model'
            if not model_path.exists():
                checkpoints = sorted(out.glob('checkpoint-*'))
                if checkpoints:
                    model_path = checkpoints[-1]

            model_found = model_path.exists()

            # Write Modelfile
            from_line = f'FROM {model_path}' if model_found else '# No trained model found. Replace with your model path.'
            modelfile = f"""{from_line}

PARAMETER temperature 0.7
PARAMETER top_p 0.9

TEMPLATE \"\"\"{{ .System }}
{{ .Prompt }}
\"\"\"

SYSTEM \"\"\"You are a model trained with mama. Respond to the user's queries.
\"\"\"
"""
            (ollama_dir / 'Modelfile').write_text(modelfile, 'utf-8')

            if model_found:
                model_dest = ollama_dir / 'model'
                if not model_dest.exists():
                    try:
                        os.symlink(str(model_path), str(model_dest))
                    except OSError:
                        shutil.copytree(str(model_path), str(model_dest), dirs_exist_ok=True)

            logger.info('Ollama export created at %s', ollama_dir)
            return {
                'success': True,
                'path': str(ollama_dir),
                'has_model': model_found,
                'ollama_command': f'ollama create my-model -f {ollama_dir / "Modelfile"}',
            }
        except Exception as e:
            logger.error('export_run_ollama failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_axolotl(self, output_dir: str) -> dict:
        """Export an Axolotl YAML config from the training config in an output folder."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            cfg_path = out / 'training_config.json'
            has_config = cfg_path.exists()
            if has_config:
                cfg = json.loads(cfg_path.read_text('utf-8'))
            else:
                # No config yet: still produce a usable YAML from placeholder
                # settings so the user can drop them into a real output folder.
                cfg = {
                    'model_name_or_path': 'HuggingFaceTB/SmolLM2-135M-Instruct',
                    'dataset_path': 'trl-lib/Capybara',
                    'output_dir': str(out),
                    'text_column': 'text',
                    'use_lora': True,
                    'use_qlora': False,
                }

            result = self.train_axolotl_write_config(str(out), json.dumps(cfg))
            if result.get('success'):
                result['has_config'] = has_config
            return result
        except Exception as e:
            logger.error('export_run_axolotl failed: %s', e)
            return {'success': False, 'error': str(e)}

    def export_run_unsloth(self, output_dir: str) -> dict:
        """Export a standalone Unsloth script from the training config in an output folder."""
        try:
            out = Path(output_dir)
            if not out.exists():
                return {'success': False, 'error': 'Output directory does not exist'}

            cfg_path = out / 'training_config.json'
            has_config = cfg_path.exists()
            if has_config:
                cfg = json.loads(cfg_path.read_text('utf-8'))
            else:
                # No config yet: still produce a usable script from placeholder
                # settings so the user can drop them into a real output folder.
                cfg = {
                    'training_backend': 'unsloth',
                    'model_name_or_path': 'unsloth/SmolLM2-135M-Instruct-bnb-4bit',
                    'dataset_path': 'trl-lib/Capybara',
                    'output_dir': str(out),
                    'text_column': 'text',
                    'use_lora': True,
                    'use_qlora': False,
                }

            result = self.train_unsloth_write_config(str(out), json.dumps(cfg))
            if result.get('success'):
                result['has_config'] = has_config
            return result
        except Exception as e:
            logger.error('export_run_unsloth failed: %s', e)
            return {'success': False, 'error': str(e)}
