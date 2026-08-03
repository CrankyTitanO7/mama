'use strict';

const ExportPage = (() => {
  let currentOutputDir = '';

  async function init() {
    await new Promise(function (resolve) {
      if (window.pywebview && window.pywebview.api) { resolve(); return; }
      window.addEventListener('pywebviewready', function onReady() {
        window.removeEventListener('pywebviewready', onReady);
        setTimeout(resolve, 0);
      });
    });

    render();

    document.getElementById('export-select-folder')?.addEventListener('click', selectFolder);
    document.getElementById('export-btn-colab')?.addEventListener('click', () => exportTo('colab'));
    document.getElementById('export-btn-js')?.addEventListener('click', () => exportTo('js'));
    document.getElementById('export-btn-ollama')?.addEventListener('click', () => exportTo('ollama'));
    document.getElementById('export-btn-axolotl')?.addEventListener('click', () => exportTo('axolotl'));
    document.getElementById('export-btn-unsloth')?.addEventListener('click', () => exportTo('unsloth'));
    document.getElementById('export-btn-unsloth-import')?.addEventListener('click', importUnsloth);

    tryAutoDetect();
  }

  function render() {
    const container = document.getElementById('export-content');
    if (!container) return;

    container.innerHTML = `
      <div class="export-layout">
        <div class="export-folder-section">
          <h3>Training Output Folder</h3>
          <div class="export-folder-row">
            <span id="export-current-folder" class="export-folder-path">No folder selected</span>
            <button type="button" id="export-select-folder" class="settings-btn settings-btn-secondary">Browse</button>
          </div>
        </div>

        <div class="export-options-section">
          <h3>Export Options</h3>
          <div class="export-cards">
            <div class="export-card" id="export-card-colab">
              <div class="export-card-icon">▶</div>
              <div class="export-card-body">
                <h4>Google Colab</h4>
                <p>Export your training code as a Jupyter notebook for Google Colab. Reads settings from <code>training_config.json</code> or <code>project.json</code>. No model required.</p>
              </div>
              <button type="button" id="export-btn-colab" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-js">
              <div class="export-card-icon">🌐</div>
              <div class="export-card-body">
                <h4>JavaScript (Web)</h4>
                <p>Convert a trained model to ONNX with a JS runner for use in websites. Requires a trained model in the outputs folder.</p>
              </div>
              <button type="button" id="export-btn-js" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-ollama">
              <div class="export-card-icon">🦙</div>
              <div class="export-card-body">
                <h4>Ollama</h4>
                <p>Export a trained model to Ollama with a Modelfile. Requires a trained model, then run <code>ollama create</code> to use it.</p>
              </div>
              <button type="button" id="export-btn-ollama" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-axolotl">
              <div class="export-card-icon">📄</div>
              <div class="export-card-body">
                <h4>Axolotl YAML</h4>
                <p>Generate an Axolotl training config (<code>config.yaml</code>) from <code>training_config.json</code> for the Linux + CUDA power backend.</p>
              </div>
              <button type="button" id="export-btn-axolotl" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-unsloth">
              <div class="export-card-icon">🐼</div>
              <div class="export-card-body">
                <h4>Unsloth Script</h4>
                <p>Generate a standalone Unsloth script (<code>train_unsloth.py</code>) from <code>training_config.json</code> for the fast CUDA / Apple Silicon backend.</p>
              </div>
              <button type="button" id="export-btn-unsloth" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>
          </div>
        </div>

        <div class="export-import-section">
          <h3>Import from Unsloth</h3>
          <p>Bring an existing Unsloth training script back into mama. A <code>training_config.json</code> is written to the selected output folder so you can edit or re-export it.</p>
          <div class="export-folder-row">
            <button type="button" id="export-btn-unsloth-import" class="settings-btn settings-btn-secondary">Choose Unsloth Script (.py)</button>
          </div>
          <div id="export-import-result" class="export-result" style="display:none"></div>
        </div>

        <div id="export-status" class="export-status" style="display:none"></div>
        <div id="export-result" class="export-result" style="display:none"></div>
      </div>
    `;

    // Re-bind events after render
    document.getElementById('export-select-folder')?.addEventListener('click', selectFolder);
    document.getElementById('export-btn-colab')?.addEventListener('click', () => exportTo('colab'));
    document.getElementById('export-btn-js')?.addEventListener('click', () => exportTo('js'));
    document.getElementById('export-btn-ollama')?.addEventListener('click', () => exportTo('ollama'));
    document.getElementById('export-btn-axolotl')?.addEventListener('click', () => exportTo('axolotl'));
    document.getElementById('export-btn-unsloth')?.addEventListener('click', () => exportTo('unsloth'));
    document.getElementById('export-btn-unsloth-import')?.addEventListener('click', importUnsloth);
  }

  function updateButtons(enabled) {
    ['colab', 'js', 'ollama', 'axolotl', 'unsloth'].forEach(type => {
      const btn = document.getElementById(`export-btn-${type}`);
      if (btn) btn.disabled = !enabled;
    });
  }

  async function tryAutoDetect() {
    try {
      const active = await window.electron.trainGetActive();
      if (active?.output_dir) {
        currentOutputDir = active.output_dir;
        updateFolderDisplay(currentOutputDir);
        updateButtons(true);
        return;
      }

      const recents = await window.electron.projectRecentsRead();
      if (recents?.open) {
        const outputsDir = recents.open.replace(/\/+$/, '') + '/outputs';
        if (await checkOutputDir(outputsDir)) {
          currentOutputDir = outputsDir;
          updateFolderDisplay(currentOutputDir);
          updateButtons(true);
          return;
        }
      }
    } catch (e) {
      console.warn('Auto-detect failed:', e);
    }
  }

  async function checkOutputDir(dir) {
    try {
      const status = await window.electron.trainStatus(dir);
      return status && status.has_config;
    } catch {
      return false;
    }
  }

  function updateFolderDisplay(dir) {
    const el = document.getElementById('export-current-folder');
    if (el) el.textContent = dir;
  }

  async function selectFolder() {
    try {
      const folder = await window.electron.projectPickFolder();
      if (!folder) return;
      currentOutputDir = folder;
      updateFolderDisplay(folder);

      const valid = await checkOutputDir(folder);
      updateButtons(valid);
      if (!valid) {
        showStatus('Selected folder does not contain training output. Select an <code>outputs</code> folder.', 'warning');
      } else {
        hideStatus();
      }
    } catch (e) {
      console.error('Folder selection failed:', e);
    }
  }

  async function exportTo(type) {
    if (!currentOutputDir) {
      showStatus('Please select a training output folder first.', 'error');
      return;
    }

    const statusEl = document.getElementById('export-status');
    const resultEl = document.getElementById('export-result');
    if (statusEl) statusEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';

    showStatus('Exporting...', 'loading');
    updateButtons(false);

    try {
      let result;
      switch (type) {
        case 'colab':
          result = await window.electron.exportRunColab(currentOutputDir);
          break;
        case 'js':
          result = await window.electron.exportRunJs(currentOutputDir);
          break;
        case 'ollama':
          result = await window.electron.exportRunOllama(currentOutputDir);
          break;
        case 'axolotl':
          result = await window.electron.exportRunAxolotl(currentOutputDir);
          break;
        case 'unsloth':
          result = await window.electron.exportRunUnsloth(currentOutputDir);
          break;
      }

      if (result.success) {
        const notes = [];
        if ((type === 'colab' || type === 'axolotl' || type === 'unsloth') && result.has_config === false) {
          notes.push('No training_config.json found. The export includes default placeholder settings — edit them before running.');
        }
        if (type !== 'colab' && type !== 'unsloth' && result.has_model === false) {
          notes.push('No trained model found in this folder. The template has been copied but you will need to provide a model manually.');
        }
        if (result.converted === false) {
          notes.push('ONNX conversion failed. The JS template was still copied but no model.onnx was generated.');
        }
        const noteHtml = notes.length ? '<p class="export-note">' + notes.join('<br>') + '</p>' : '';
        showStatus('Export completed.' + (noteHtml ? ' ' + notes.join(' ') : ''), notes.length ? 'warning' : 'done');
        showResult(type, result);
      } else {
        showStatus('Export failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (e) {
      showStatus('Export error: ' + e.message, 'error');
    } finally {
      updateButtons(true);
    }
  }

  function showStatus(message, type) {
    const el = document.getElementById('export-status');
    if (!el) return;
    el.className = 'export-status';
    if (type === 'error') el.classList.add('status-error');
    else if (type === 'done') el.classList.add('status-done');
    else if (type === 'loading') el.classList.add('status-loading');
    else if (type === 'warning') el.classList.add('status-warning');
    el.innerHTML = message;
    el.style.display = 'block';
  }

  function hideStatus() {
    const el = document.getElementById('export-status');
    if (el) el.style.display = 'none';
  }

  function showResult(type, result) {
    const el = document.getElementById('export-result');
    if (!el) return;

    const labels = { colab: 'Google Colab', js: 'JavaScript', ollama: 'Ollama', axolotl: 'Axolotl YAML', unsloth: 'Unsloth Script' };
    const label = labels[type] || type;
    const path = result.path || '';
    const command = result.ollama_command || '';
    const scriptText = result.script || '';

    const notes = [];
    if ((type === 'colab' || type === 'axolotl' || type === 'unsloth') && result.has_config === false) {
      notes.push('No training_config.json was found. The export contains default placeholder settings — edit them before running.');
    }
    if (type !== 'colab' && result.has_model === false && type !== 'unsloth') {
      notes.push('No trained model was found in this folder. Edit the exported files to point to your model before using.');
    }
    if (result.converted === false) {
      notes.push('ONNX conversion was skipped. Install torch and transformers, or convert manually.');
    }

    let extraHtml = '';
    if (scriptText) {
      extraHtml += '<p class="export-ollama-cmd">Generated Unsloth script (run with <code>python train_unsloth.py</code>):</p>';
      extraHtml += `<pre class="export-ollama-command">${escapeHtml(scriptText.slice(0, 4000))}</pre>`;
    } else {
      const yamlText = result.yaml || '';
      if (yamlText) {
        extraHtml += '<p class="export-ollama-cmd">Generated Axolotl config:</p>';
        extraHtml += `<pre class="export-ollama-command">${escapeHtml(yamlText)}</pre>`;
      } else if (notes.length) {
        extraHtml += '<div class="export-notes">' + notes.map(n => '<p>' + escapeHtml(n) + '</p>').join('') + '</div>';
      }
    }
    if (command) {
      extraHtml += `<p class="export-ollama-cmd">Run this command to create the Ollama model:</p>
                    <pre class="export-ollama-command">${escapeHtml(command)}</pre>`;
    }

    const copyTarget = scriptText || command || yamlText || path;
    el.innerHTML = `
      <h4>${label} Export — Complete</h4>
      <p>Exported to: <code>${escapeHtml(path)}</code></p>
      ${extraHtml}
      <button type="button" class="settings-btn settings-btn-secondary" onclick="
        navigator.clipboard.writeText(${JSON.stringify(copyTarget)});
        this.textContent = 'Copied!';
        setTimeout(() => this.textContent = 'Copy ${command ? 'Command' : scriptText ? 'Script' : yamlText ? 'YAML' : 'Path'}', 2000);
      ">Copy Path</button>
    `;
    el.style.display = 'block';
  }

  async function importUnsloth() {
    const resultEl = document.getElementById('export-import-result');
    if (resultEl) resultEl.style.display = 'none';
    try {
      const file = await window.electron.projectPickFile('.py');
      if (!file) return;

      let outDir = currentOutputDir;
      if (!outDir) {
        outDir = await window.electron.projectPickFolder();
        if (!outDir) {
          showImportResult('Choose an output folder for the imported config, or select a training output folder above first.', 'warning');
          return;
        }
      }

      const result = await window.electron.unslothImport(file, outDir);
      if (result.success) {
        const cfg = result.config || {};
        const keys = ['model_name_or_path', 'dataset_path', 'max_seq_length', 'learning_rate',
          'per_device_train_batch_size', 'lora_r', 'lora_alpha', 'num_train_epochs'];
        const rows = keys.filter(k => cfg[k] !== undefined && cfg[k] !== null)
          .map(k => `<div class="ft-confirm-row"><span class="ft-confirm-key">${escapeHtml(k)}</span><span class="ft-confirm-value">${escapeHtml(String(cfg[k]))}</span></div>`)
          .join('');
        showImportResult(`
          <h4>Unsloth Import — Complete</h4>
          <p>Imported <code>${escapeHtml(result.script || file)}</code> into <code>${escapeHtml(result.path || outDir)}</code>.</p>
          <p>The training_config.json now reflects the script — open the Fine-Tune page and pick backend "Unsloth" to edit it, or re-export to any target.</p>
          ${rows ? '<div class="export-notes">' + rows + '</div>' : ''}
        `, 'done');
      } else {
        showImportResult('Import failed: ' + escapeHtml(result.error || 'Unknown error'), 'error');
      }
    } catch (e) {
      showImportResult('Import error: ' + escapeHtml(e.message), 'error');
    }
  }

  function showImportResult(html, type) {
    const el = document.getElementById('export-import-result');
    if (!el) return;
    el.className = 'export-result';
    if (type === 'error') el.classList.add('status-error');
    else if (type === 'done') el.classList.add('status-done');
    else if (type === 'warning') el.classList.add('status-warning');
    el.innerHTML = html;
    el.style.display = 'block';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {};
})();
