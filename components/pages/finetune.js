/**
 * finetune.js — Model browser, dataset loader, config builder for fine-tuning.
 */

'use strict';

const Finetune = (() => {
  let currentTab = 'model';
  let localModels = [];
  let selectedModel = '';
  let selectedDataset = '';
  let hwInfo = null;

  // ── Utils ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── Tab switching ──────────────────────────────────────────────

  function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.ft-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.ft-tab-content').forEach(c => c.classList.toggle('active', c.id === 'ft-tab-' + tabId));
  }

  // ── Model tab ──────────────────────────────────────────────────

  async function refreshLocalModels() {
    try {
      const models = await window.electron.modelList();
      localModels = models || [];
      const container = document.getElementById('ft-local-models');
      if (!container) return;

      if (models.length === 0) {
        container.innerHTML = '<div class="ft-empty">No models downloaded yet. Use the form above to download one.</div>';
        return;
      }

      container.innerHTML = models.map(m => `
        <div class="ft-local-model ${m.path === selectedModel ? 'selected' : ''}" data-path="${escapeHtml(m.path)}" data-id="${escapeHtml(m.model_id)}">
          <div class="ft-local-model-name">${escapeHtml(m.model_id)}</div>
          <div class="ft-local-model-size">${formatSize(m.size_bytes)}</div>
          <div class="ft-local-model-path">${escapeHtml(m.path)}</div>
        </div>
      `).join('');

      container.querySelectorAll('.ft-local-model').forEach(el => {
        el.addEventListener('click', () => {
          document.querySelectorAll('.ft-local-model').forEach(m => m.classList.remove('selected'));
          el.classList.add('selected');
          selectedModel = el.dataset.path;
          document.getElementById('ft-model-id').value = el.dataset.id;
        });
      });
    } catch (e) {
      console.error('Failed to list models:', e);
    }
  }

  async function checkModelCompatibility() {
    const modelId = document.getElementById('ft-model-id').value.trim();
    if (!modelId) return;

    const resultDiv = document.getElementById('ft-compat-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="ft-spinner">Checking compatibility...</div>';

    try {
      const result = await window.electron.modelCheckCompatibility(modelId);
      if (result.error) {
        resultDiv.innerHTML = `<div class="ft-error">${escapeHtml(result.error)}</div>`;
        return;
      }

      const isCompat = result.is_text_generation;
      const modules = result.suggested_lora_modules || [];
      const pipeline = result.pipeline_tag || 'unknown';

      resultDiv.innerHTML = `
        <div class="ft-compat-card ${isCompat ? 'ft-compat-ok' : 'ft-compat-warn'}">
          <div class="ft-compat-header">
            <span>${isCompat ? 'Compatible' : 'Potentially Incompatible'}</span>
            <span class="ft-compat-tag">${escapeHtml(pipeline)}</span>
          </div>
          <div class="ft-compat-detail">
            <strong>Suggested LoRA modules:</strong>
            <code>${modules.length ? modules.join(', ') : 'q_proj, v_proj, k_proj, o_proj'}</code>
          </div>
        </div>
      `;
    } catch (e) {
      resultDiv.innerHTML = `<div class="ft-error">${escapeHtml(e.message)}</div>`;
    }
  }

  async function downloadModel() {
    const modelId = document.getElementById('ft-model-id').value.trim();
    if (!modelId) return;

    show('ft-download-progress');
    setText('ft-dl-text', `Starting download of ${modelId}...`);
    document.getElementById('ft-dl-bar').style.width = '0%';

    window.electron.onModelProgress((chunk) => {
      if (chunk.type === 'progress' && chunk.total > 0) {
        const pct = Math.min(100, Math.round((chunk.current / chunk.total) * 100));
        document.getElementById('ft-dl-bar').style.width = pct + '%';
        setText('ft-dl-text', `Downloading: ${pct}% (${formatBytes(chunk.current)} / ${formatBytes(chunk.total)})`);
      } else if (chunk.type === 'status') {
        setText('ft-dl-text', chunk.message || '');
      } else if (chunk.type === 'done') {
        setText('ft-dl-text', 'Download complete!');
        document.getElementById('ft-dl-bar').style.width = '100%';
        setTimeout(() => hide('ft-download-progress'), 2000);
        refreshLocalModels();
      } else if (chunk.type === 'error') {
        setText('ft-dl-text', `Error: ${chunk.message}`);
      }
    });

    const result = await window.electron.modelDownload(modelId);
    if (!result.success) {
      setText('ft-dl-text', `Failed to start download: ${result.error}`);
    }
  }

  // ── Dataset tab ────────────────────────────────────────────────

  function initDatasetTabs() {
    document.querySelectorAll('input[name="ds-source"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isHub = radio.value === 'hub';
        document.getElementById('ft-ds-hub').style.display = isHub ? '' : 'none';
        document.getElementById('ft-ds-local').style.display = isHub ? 'none' : '';
      });
    });
  }

  async function loadDatasetPreview() {
    const radio = document.querySelector('input[name="ds-source"]:checked');
    if (!radio) return;
    const isHub = radio.value === 'hub';
    let path;
    if (isHub) {
      const el = document.getElementById('ft-ds-hub-id');
      if (!el) return;
      path = el.value.trim();
      if (!path) return;
    } else {
      const el = document.getElementById('ft-ds-path');
      if (!el) return;
      path = el.value.trim();
      if (!path) return;
    }

    selectedDataset = path;
    const previewDiv = document.getElementById('ft-ds-preview');
    if (!previewDiv) return;
    previewDiv.style.display = 'block';

    const infoEl = document.getElementById('ft-ds-info');
    const tableWrap = document.getElementById('ft-ds-table-wrap');
    if (infoEl) infoEl.innerHTML = '';
    if (!tableWrap) return;

    // Add progress bar styles once
    if (!document.getElementById('ft-loading-style')) {
      const style = document.createElement('style');
      style.id = 'ft-loading-style';
      style.textContent = `
        @keyframes ft-bar-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .ft-ds-progress-track {
          width: 100%;
          height: 8px;
          background: var(--panel-border, #333);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .ft-ds-progress-bar {
          width: 25%;
          height: 100%;
          background: var(--active-color, #00d4ff);
          border-radius: 4px;
          animation: ft-bar-indeterminate 1.5s ease-in-out infinite;
        }
      `;
      document.head.appendChild(style);
    }

    // Show progress bar inside table wrap (preserve info/table DOM ids)
    const loadingStatus = isHub
      ? 'Fetching dataset metadata from Hugging Face Hub...'
      : 'Scanning local dataset files...';
    tableWrap.innerHTML = `
      <div class="ft-ds-loading">
        <div class="ft-ds-progress-track">
          <div class="ft-ds-progress-bar" id="ft-ds-progress-bar"></div>
        </div>
        <div class="ft-ds-loading-status" style="font-size:13px;color:var(--body-color);">
          ${escapeHtml(loadingStatus)}
        </div>
      </div>
    `;

    const progressStatusEl = tableWrap.querySelector('.ft-ds-loading-status');
    const progressBarEl = tableWrap.querySelector('#ft-ds-progress-bar');
    let progressTimer;

    if (isHub && window.electron.onDatasetPreviewProgress) {
      window.electron.onDatasetPreviewProgress((chunk) => {
        if (progressStatusEl && chunk.message) {
          progressStatusEl.textContent = chunk.message;
        }
        if (chunk.stage === 'done' && progressBarEl) {
          progressBarEl.style.animation = 'none';
          progressBarEl.style.width = '100%';
        }
      });
    } else if (isHub) {
      const messages = [
        'Contacting Hugging Face datasets server...',
        'Fetching dataset info...',
        'Downloading sample rows...',
      ];
      let idx = 0;
      progressTimer = setInterval(() => {
        if (idx < messages.length && progressStatusEl) {
          progressStatusEl.textContent = messages[idx++];
        }
      }, 3000);
    }

    try {
      const result = await window.electron.datasetPreview(path, 5);
      if (result && result.success && progressBarEl) {
        progressBarEl.style.animation = 'none';
        progressBarEl.style.width = '100%';
      }
      if (!result || !result.success) {
        const errMsg = result ? result.error : 'null response from backend';
        tableWrap.innerHTML = `<div class="ft-error">${escapeHtml(errMsg || 'Unknown error')}</div>`;
        return;
      }

      const cols = Array.isArray(result.columns) ? result.columns : [];
      const rows = Array.isArray(result.rows) ? result.rows : [];
      if (infoEl) {
        infoEl.innerHTML = `
          <span><strong>Columns:</strong> ${cols.join(', ') || '—'}</span>
          <span><strong>Rows previewed:</strong> ${rows.length}</span>
        `;
      }

      if (cols.length > 0 && rows.length > 0) {
        const table = document.createElement('table');
        table.className = 'ft-preview-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const displayCols = cols.slice(0, 4);
        displayCols.forEach(col => {
          const th = document.createElement('th');
          th.textContent = col;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach(row => {
          const tr = document.createElement('tr');
          displayCols.forEach(col => {
            const td = document.createElement('td');
            const val = row[col];
            td.textContent = val !== undefined && val !== null ? String(val).slice(0, 100) : '—';
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrap.innerHTML = '';
        tableWrap.appendChild(table);
      } else {
        tableWrap.innerHTML = '<p class="ft-empty">No data to display</p>';
      }

      // Auto-suggest text column
      const colInput = document.getElementById('ft-ds-column');
      if (colInput && cols.length > 0) {
        const preferred = cols.find(c => ['text', 'content', 'input', 'sentence'].includes(c));
        if (preferred) colInput.value = preferred;
      }
    } catch (e) {
      tableWrap.innerHTML = `<div class="ft-error">${escapeHtml(e.message || e)}</div>`;
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      window.electron.offDatasetPreviewProgress?.();
    }
  }

  // ── Config tab ─────────────────────────────────────────────────

  async function setDefaultOutputDir() {
    try {
      const recents = await window.electron.projectRecentsRead();
      const openFolder = recents?.open;
      if (openFolder) {
        document.getElementById('ft-output-dir').value = openFolder.replace(/\/+$/, '') + '/outputs';
      }
    } catch (e) {
      // ignore
    }
  }

  async function loadHardwareInfo() {
    try {
      const settings = await window.electron.settingsRead();
      const hw = settings?.['hardware settings'] || {};
      const sw = settings?.['software information'] || {};

      let deviceLabel = 'Unknown';
      let isMPS = false;
      let isCUDA = false;

      const mfr = (hw['graphics manufacturer'] || '').toLowerCase();
      const mode = (hw['mode'] || 'gpu').toLowerCase();

      if (mfr === 'apple') {
        deviceLabel = 'Apple Silicon (MPS)';
        isMPS = true;
      } else if (mfr === 'nvidia') {
        deviceLabel = 'NVIDIA GPU (CUDA)';
        isCUDA = true;
      } else if (mfr === 'amd') {
        deviceLabel = 'AMD GPU (ROCm)';
        isCUDA = true;
      } else if (mode === 'cpu') {
        deviceLabel = 'CPU';
      } else {
        // Fallback: try platform check script
        const result = await window.electron.trainPlatformCheck();
        if (result.success) {
          if (result.device === 'cuda') { deviceLabel = 'CUDA GPU'; isCUDA = true; }
          else if (result.device === 'mps') { deviceLabel = 'Apple Silicon (MPS)'; isMPS = true; }
          else deviceLabel = 'CPU';
        }
      }

      document.getElementById('ft-hw-text').textContent = `Device: ${deviceLabel} | Mode: ${mode}`;

      if (isMPS) {
        document.getElementById('ft-method-hint').textContent = 'MPS does not support QLoRA. Using LoRA.';
        document.getElementById('ft-use-bf16').checked = false;
        document.getElementById('ft-use-bf16').disabled = true;
      } else if (!isCUDA) {
        document.getElementById('ft-method-hint').textContent = 'CPU training is slow. Consider using a very small model and batch size.';
        document.getElementById('ft-use-bf16').checked = false;
        document.getElementById('ft-use-bf16').disabled = true;
      }
    } catch (e) {
      document.getElementById('ft-hw-text').textContent = 'Could not detect hardware. Defaulting to safe settings.';
    }
  }

  function buildConfig() {
    const method = document.getElementById('ft-method').value;
    const modelPath = document.getElementById('ft-model-id').value.trim();
    const datasetPath = selectedDataset || document.getElementById('ft-ds-hub-id').value.trim() || document.getElementById('ft-ds-path').value.trim();
    const outputDir = document.getElementById('ft-output-dir').value.trim();

    const cfg = {
      model_name_or_path: modelPath,
      dataset_path: datasetPath,
      output_dir: outputDir,
      text_column: document.getElementById('ft-ds-column').value.trim() || 'text',
      use_lora: method !== 'full',
      use_qlora: method === 'qlora',
      lora_r: parseInt(document.getElementById('ft-lora-r').value) || 8,
      lora_alpha: parseInt(document.getElementById('ft-lora-alpha').value) || 16,
      lora_dropout: parseFloat(document.getElementById('ft-lora-dropout').value) || 0.05,
      learning_rate: parseFloat(document.getElementById('ft-lr').value) || 2e-4,
      per_device_train_batch_size: parseInt(document.getElementById('ft-batch-size').value) || 2,
      gradient_accumulation_steps: parseInt(document.getElementById('ft-grad-acc').value) || 4,
      max_seq_length: parseInt(document.getElementById('ft-max-seq').value) || 2048,
      num_train_epochs: parseInt(document.getElementById('ft-epochs').value) || 3,
      max_steps: parseInt(document.getElementById('ft-max-steps').value) || -1,
      warmup_steps: parseInt(document.getElementById('ft-warmup').value) || 100,
      logging_steps: parseInt(document.getElementById('ft-log-steps').value) || 10,
      save_steps: parseInt(document.getElementById('ft-save-steps').value) || 500,
      lr_scheduler_type: document.getElementById('ft-scheduler').value,
      gradient_checkpointing: document.getElementById('ft-grad-checkpoint').checked,
      use_flash_attention: document.getElementById('ft-use-flash').checked,
      bf16: document.getElementById('ft-use-bf16').checked,
      resume: document.getElementById('ft-resume').checked,
    };

    const maxSamplesEl = document.getElementById('ft-ds-max-samples');
    const maxSamples = maxSamplesEl?.value ? parseInt(maxSamplesEl.value, 10) : null;
    if (maxSamples && maxSamples > 0) {
      cfg.max_samples = maxSamples;
    }

    return cfg;
  }

  function updateConfigPreview() {
    const cfg = buildConfig();
    document.getElementById('ft-config-preview').textContent = JSON.stringify(cfg, null, 2);
  }

  async function startTraining() {
    const cfg = buildConfig();

    if (!cfg.model_name_or_path) {
      alert('Please select a model first.');
      switchTab('model');
      return;
    }
    if (!cfg.dataset_path) {
      alert('Please select a dataset first.');
      switchTab('dataset');
      return;
    }

    try {
      sessionStorage.setItem('pendingTrainingConfig', JSON.stringify(cfg));
      window.electron.navigateTo('public/training.html');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  // ── Format helpers ─────────────────────────────────────────────

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let sz = bytes;
    while (sz >= 1024 && i < units.length - 1) { sz /= 1024; i++; }
    return sz.toFixed(1) + ' ' + units[i];
  }

  function formatBytes(bytes) {
    return formatSize(bytes);
  }

  // ── Init ───────────────────────────────────────────────────────

  async function init() {
    // Tab switching
    document.querySelectorAll('.ft-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Model tab
    document.getElementById('ft-check-model')?.addEventListener('click', checkModelCompatibility);
    document.getElementById('ft-download-model')?.addEventListener('click', downloadModel);
    document.getElementById('ft-model-id')?.addEventListener('input', () => {
      hide('ft-compat-result');
    });

    // Dataset tab
    initDatasetTabs();
    document.getElementById('ft-ds-load')?.addEventListener('click', loadDatasetPreview);
    document.getElementById('ft-ds-browse')?.addEventListener('click', async () => {
      const folder = await window.electron.projectPickFolder();
      if (folder) document.getElementById('ft-ds-path').value = folder;
    });

    // Config tab - auto-update preview
    document.querySelectorAll('#ft-tab-config input, #ft-tab-config select').forEach(el => {
      el.addEventListener('change', updateConfigPreview);
      el.addEventListener('input', updateConfigPreview);
    });
    document.getElementById('ft-output-browse')?.addEventListener('click', async () => {
      const folder = await window.electron.projectPickFolder();
      if (folder) document.getElementById('ft-output-dir').value = folder;
    });
    document.getElementById('ft-start-train')?.addEventListener('click', startTraining);

    // Training tab
    document.getElementById('ft-go-training')?.addEventListener('click', () => {
      window.electron.navigateTo('public/training.html');
    });

    // Method selector hint
    document.getElementById('ft-method')?.addEventListener('change', () => {
      const method = document.getElementById('ft-method').value;
      const hint = document.getElementById('ft-method-hint');
      if (method === 'lora') hint.textContent = 'Efficient for most GPUs with 6GB+ VRAM. Recommended.';
      else if (method === 'qlora') hint.textContent = '4-bit quantization. Requires bitsandbytes. Not available on MPS.';
      else hint.textContent = 'Updates all parameters. Requires significant VRAM (24GB+ for 7B models).';
    });

    // Load data
    await Promise.all([
      refreshLocalModels(),
      loadHardwareInfo(),
      setDefaultOutputDir(),
    ]);

    updateConfigPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { refreshLocalModels };
})();
