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
                <p>Export training code to a Google Colab-compatible Python script.</p>
              </div>
              <button type="button" id="export-btn-colab" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-js">
              <div class="export-card-icon">🌐</div>
              <div class="export-card-body">
                <h4>JavaScript (Web)</h4>
                <p>Convert model to ONNX format with a JavaScript runner for use in websites.</p>
              </div>
              <button type="button" id="export-btn-js" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>

            <div class="export-card" id="export-card-ollama">
              <div class="export-card-icon">🦙</div>
              <div class="export-card-body">
                <h4>Ollama</h4>
                <p>Export model to Ollama with a Modelfile. Run <code>ollama create</code> to use it.</p>
              </div>
              <button type="button" id="export-btn-ollama" class="settings-btn settings-btn-primary" disabled>Export</button>
            </div>
          </div>
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
  }

  function updateButtons(enabled) {
    ['colab', 'js', 'ollama'].forEach(type => {
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
      }

      if (result.success) {
        showStatus('Export completed successfully!', 'done');
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

    const labels = { colab: 'Google Colab', js: 'JavaScript', ollama: 'Ollama' };
    const label = labels[type] || type;
    const path = result.path || '';
    const command = result.ollama_command || '';

    let extraHtml = '';
    if (command) {
      extraHtml = `<p class="export-ollama-cmd">Run this command to create the Ollama model:</p>
                   <pre class="export-ollama-command">${escapeHtml(command)}</pre>`;
    }

    el.innerHTML = `
      <h4>${label} Export — Complete</h4>
      <p>Exported to: <code>${escapeHtml(path)}</code></p>
      ${extraHtml}
      <button type="button" class="settings-btn settings-btn-secondary" onclick="
        navigator.clipboard.writeText(${JSON.stringify(command || path)});
        this.textContent = 'Copied!';
        setTimeout(() => this.textContent = 'Copy Path', 2000);
      ">Copy Path</button>
    `;
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
