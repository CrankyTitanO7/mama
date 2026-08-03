/**
 * finetune.js — Model browser, dataset loader, config builder for fine-tuning.
 */

'use strict';

const Finetune = (() => {
  let currentTab = 'start';
  let localModels = [];
  let selectedModel = '';
  let selectedDataset = '';
  let hwInfo = null;
  let hwDevice = null; // 'cpu' | 'mps' | 'cuda'
  let axolotlAvailable = null; // null = unknown | true | false
  let previewedColumns = []; // last columns returned by the dataset preview

  // ── Utils ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function humanFlops(flops) {
    if (flops >= 1e12) return (flops / 1e12).toFixed(3) + ' TFLOPS';
    if (flops >= 1e9) return (flops / 1e9).toFixed(3) + ' GFLOPS';
    return flops.toFixed(1) + ' FLOPS';
  }

  function humanParams(params) {
    if (params >= 1e9) return (params / 1e9).toFixed(1) + 'B';
    if (params >= 1e6) return (params / 1e6).toFixed(1) + 'M';
    return Math.round(params).toLocaleString();
  }

  // ── Example projects (mirrors docs/.dev/eg.md) ───────────────────────
  // Four categories, each with one config per hardware tier. All model and
  // dataset IDs are Hugging Face Hub sources only.

  const HW_TIERS = {
    easy: { label: 'Easy', hint: 'CPU / Apple Silicon 8 GB / GPU &lt; 6 GB' },
    medium: { label: 'Medium', hint: 'Apple Silicon 16 GB+ / GPU 6–16 GB' },
    hard: { label: 'Hard', hint: 'GPU 24 GB+' },
  };

  const EXAMPLES = [
    {
      id: 'text-to-sql',
      title: 'Text-to-SQL Copilot',
      desc: 'Convert natural language questions into executable database queries.',
      dataset: 'b-mc2/sql-create-context',
      textColumn: 'answer',
      variants: {
        easy: {
          model: 'HuggingFaceTB/SmolLM2-135M-Instruct',
          method: 'lora', max_samples: 2000, lora_r: 8, lora_alpha: 16,
          learning_rate: 3e-4, batch_size: 2, grad_acc: 8, max_seq: 512,
          epochs: 3, warmup: 50, save_steps: 100, bf16: false,
        },
        medium: {
          model: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
          method: 'lora', max_samples: 8000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 2, grad_acc: 4, max_seq: 1024,
          epochs: 2, warmup: 100, save_steps: 500, bf16: false,
        },
        hard: {
          model: 'NousResearch/Llama-2-7b-chat-hf',
          method: 'qlora', max_samples: 15000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 1, grad_acc: 8, max_seq: 2048,
          epochs: 1, warmup: 100, save_steps: 500, bf16: false,
        },
      },
    },
    {
      id: 'ticket-classifier',
      title: 'Support Ticket Classifier',
      desc: 'Categorize incoming emails by department and detect urgency.',
      dataset: 'PolyAI/banking77',
      textColumn: 'text',
      variants: {
        easy: {
          model: 'HuggingFaceTB/SmolLM2-135M-Instruct',
          method: 'lora', max_samples: 2000, lora_r: 8, lora_alpha: 16,
          learning_rate: 3e-4, batch_size: 2, grad_acc: 8, max_seq: 256,
          epochs: 3, warmup: 50, save_steps: 500, bf16: false,
        },
        medium: {
          model: 'google/gemma-2b-it',
          method: 'lora', max_samples: 6000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 2, grad_acc: 4, max_seq: 512,
          epochs: 2, warmup: 100, save_steps: 500, bf16: false,
        },
        hard: {
          model: 'mistralai/Mistral-7B-Instruct-v0.3',
          method: 'qlora', max_samples: 10000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 1, grad_acc: 8, max_seq: 1024,
          epochs: 1, warmup: 100, save_steps: 500, bf16: false,
        },
      },
    },
    {
      id: 'jargon-simplifier',
      title: 'Medical / Legal Jargon Simpler',
      desc: 'Translate complex professional jargon into simple, layman terms.',
      dataset: 'medalpaca/medical_meadow_wikidoc',
      textColumn: 'output',
      variants: {
        easy: {
          model: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
          method: 'lora', max_samples: 1000, lora_r: 8, lora_alpha: 16,
          learning_rate: 2e-4, batch_size: 2, grad_acc: 8, max_seq: 512,
          epochs: 2, warmup: 50, log_steps: 10, save_steps: 500, bf16: false,
        },
        medium: {
          model: 'microsoft/Phi-3-mini-4k-instruct',
          method: 'qlora', max_samples: 3000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 2, grad_acc: 4, max_seq: 1024,
          epochs: 1, warmup: 100, log_steps: 10, save_steps: 500, bf16: false,
        },
        hard: {
          model: 'NousResearch/Llama-2-7b-chat-hf',
          method: 'qlora', max_samples: 6000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 1, grad_acc: 8, max_seq: 2048,
          epochs: 1, warmup: 100, log_steps: 10, save_steps: 500, bf16: false,
        },
      },
    },
    {
      id: 'brand-voice',
      title: 'Brand-Voice Copywriter',
      desc: 'Write marketing copy and social posts in the exact tone of a brand.',
      dataset: 'databricks/databricks-dolly-15k',
      textColumn: 'output',
      variants: {
        easy: {
          model: 'HuggingFaceTB/SmolLM2-135M-Instruct',
          method: 'lora', max_samples: 1000, lora_r: 8, lora_alpha: 16,
          learning_rate: 3e-4, batch_size: 2, grad_acc: 8, max_seq: 512,
          epochs: 3, warmup: 50, log_steps: 10, save_steps: 500, bf16: false,
        },
        medium: {
          model: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
          method: 'lora', max_samples: 4000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 2, grad_acc: 4, max_seq: 1024,
          epochs: 2, warmup: 100, log_steps: 10, save_steps: 500, bf16: false,
        },
        hard: {
          model: 'mistralai/Mistral-7B-Instruct-v0.3',
          method: 'qlora', max_samples: 8000, lora_r: 16, lora_alpha: 32,
          learning_rate: 2e-4, batch_size: 1, grad_acc: 8, max_seq: 2048,
          epochs: 1, warmup: 100, log_steps: 10, save_steps: 500, bf16: false,
        },
      },
    },
  ];

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
    if (tabId === 'train') updateTrainTab();
  }

  // ── Model tab ──────────────────────────────────────────────────

  let installingHub = false;
  let installLogLines = [];

  function showDownloadErrorDialog(detail, onInstall) {
    const old = document.getElementById('ft-dl-error-modal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ft-dl-error-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#1e1e2e;border:1px solid #f44336aa;border-radius:8px;padding:20px 24px;max-width:640px;width:90%;display:flex;flex-direction:column;gap:12px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:1.05rem;font-weight:700;color:#ff6b6b;';
    title.textContent = 'Model Download Failed';

    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#11111b;border:1px solid #333;border-radius:6px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:.85rem;line-height:1.45;color:#cdd6f4;margin:0;max-height:50vh;';
    pre.textContent = detail || 'No error details were captured. Check the app log for more information.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    if (onInstall) {
      const installBtn = document.createElement('button');
      installBtn.textContent = 'Install huggingface_hub & Retry';
      installBtn.className = 'settings-btn settings-btn-success';
      installBtn.onclick = () => {
        overlay.remove();
        onInstall();
      };
      btnRow.prepend(installBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'settings-btn settings-btn-primary';
    closeBtn.onclick = () => overlay.remove();
    btnRow.appendChild(closeBtn);

    box.append(title, pre, btnRow);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  function installHubAndRetry() {
    const modelId = document.getElementById('ft-model-id').value.trim();
    if (!modelId) return;
    installingHub = true;
    installLogLines = [];
    show('ft-download-progress');
    setText('ft-dl-text', 'Installing huggingface_hub...');
    document.getElementById('ft-dl-bar').style.width = '0%';
    window.electron.modelInstallHub();
  }

  async function refreshLocalModels() {
    try {
      const models = await window.electron.modelList();
      localModels = models || [];
      const container = document.getElementById('ft-local-models');
      if (!container) return;

      if (models.length === 0) {
        container.innerHTML = '<div class="ft-empty">No models downloaded yet. Use the form above to download one.</div>';
        selectedModel = '';
        return;
      }

      // Auto-select most recent model if none selected
      if (!selectedModel || !models.some(m => m.path === selectedModel)) {
        selectedModel = models[0].path;
        document.getElementById('ft-model-id').value = models[0].model_id;
      }

      container.innerHTML = models.map(m => `
        <div class="ft-local-model ${m.path === selectedModel ? 'selected' : ''}" data-path="${escapeHtml(m.path)}" data-id="${escapeHtml(m.model_id)}">
          <div class="ft-local-model-name">${escapeHtml(m.model_id)}</div>
          <div class="ft-local-model-size">${formatSize(m.size_bytes)}</div>
          <div class="ft-local-model-path">${escapeHtml(m.path)}</div>
          <div class="ft-local-model-actions">
            <button class="ft-model-move-btn settings-btn settings-btn-primary" data-path="${escapeHtml(m.path)}" data-id="${escapeHtml(m.model_id)}">Move</button>
            <button class="ft-model-del-btn settings-btn settings-btn-danger" data-path="${escapeHtml(m.path)}" data-id="${escapeHtml(m.model_id)}">Delete</button>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.ft-local-model').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.ft-local-model-actions')) return;
          document.querySelectorAll('.ft-local-model').forEach(m => m.classList.remove('selected'));
          el.classList.add('selected');
          selectedModel = el.dataset.path;
          document.getElementById('ft-model-id').value = el.dataset.id;
        });
      });

      container.querySelectorAll('.ft-model-del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          const id = btn.dataset.id;
          if (confirm(`Delete model "${id}"? This will permanently remove all model files.`)) {
            const result = await window.electron.modelDelete(path);
            if (result.success) {
              refreshLocalModels();
            } else {
              alert('Failed to delete model: ' + (result.error || 'Unknown error'));
            }
          }
        });
      });

      container.querySelectorAll('.ft-model-move-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          const id = btn.dataset.id;
          const dest = await window.electron.projectPickFolder();
          if (!dest) return;
          const result = await window.electron.modelMove(path, dest);
          if (result.success) {
            refreshLocalModels();
          } else {
            alert('Failed to move model: ' + (result.error || 'Unknown error'));
          }
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

      let flopsHtml = '';
      const flopsPerPass = result.flops_per_pass;
      const params = result.params;
      if (flopsPerPass && params) {
        const methodLabel = result.method === 'calflops' ? 'calflops' : 'estimated';
        flopsHtml = `
          <div class="ft-compat-flops">
            <div class="ft-flops-row">
              <span class="ft-flops-label">Parameters</span>
              <span class="ft-flops-value">${humanParams(params)}</span>
            </div>
            <div class="ft-flops-row">
              <span class="ft-flops-label">FLOPs / forward pass</span>
              <span class="ft-flops-value">${humanFlops(flopsPerPass)}</span>
            </div>
            <div class="ft-flops-row ft-flops-row-method">
              <span>(${methodLabel} at seq_len=512)</span>
            </div>
          </div>
        `;
      }

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
          ${flopsHtml}
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
      if (chunk.type === 'install_log') {
        installLogLines.push(chunk.text);
        const last = String(chunk.text).slice(-90);
        setText('ft-dl-text', `Installing huggingface_hub: ${last}`);
      } else if (chunk.type === 'install_done') {
        installingHub = false;
        if (chunk.success) {
          setText('ft-dl-text', 'huggingface_hub installed. Retrying download...');
          downloadModel();
        } else {
          setText('ft-dl-text', 'Failed to install huggingface_hub.');
          document.getElementById('ft-dl-bar').style.width = '0%';
          const pipError = chunk.error || 'pip install failed';
          showDownloadErrorDialog(pipError + '\n\n' + installLogLines.join('\n'));
        }
      } else if (chunk.type === 'progress' && chunk.total > 0) {
        const pct = Math.min(100, Math.round((chunk.current / chunk.total) * 100));
        document.getElementById('ft-dl-bar').style.width = pct + '%';
        setText('ft-dl-text', `Downloading: ${pct}% (${formatBytes(chunk.current)} / ${formatBytes(chunk.total)})`);
      } else if (chunk.type === 'status') {
        setText('ft-dl-text', chunk.message || '');
      } else if (chunk.type === 'done') {
        if (chunk.code !== 0) {
          setText('ft-dl-text', 'Download failed.');
          document.getElementById('ft-dl-bar').style.width = '0%';
          refreshLocalModels();
          const detail = chunk.error || `Exit code ${chunk.code}`;
          showDownloadErrorDialog(
            detail,
            /huggingface/i.test(detail) ? installHubAndRetry : null
          );
          return;
        }
        setText('ft-dl-text', 'Download complete!');
        document.getElementById('ft-dl-bar').style.width = '100%';
        setTimeout(() => hide('ft-download-progress'), 2000);
        refreshLocalModels();
      } else if (chunk.type === 'error') {
        setText('ft-dl-text', `Error: ${chunk.message}`);
        document.getElementById('ft-dl-bar').style.width = '0%';
      }
    });

    const result = await window.electron.modelDownload(modelId);
    if (!result.success) {
      setText('ft-dl-text', `Failed to start download: ${result.error}`);
    }
  }

  // ── Dataset tab ────────────────────────────────────────────────

  async function loadDatasetPreview() {
    const el = document.getElementById('ft-ds-hub-id');
    if (!el) return;
    const path = el.value.trim();
    if (!path) return;

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
    const loadingStatus = 'Fetching dataset metadata from Hugging Face Hub...';
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

    if (window.electron.onDatasetPreviewProgress) {
      window.electron.onDatasetPreviewProgress((chunk) => {
        if (progressStatusEl && chunk.message) {
          progressStatusEl.textContent = chunk.message;
        }
        if (chunk.stage === 'done' && progressBarEl) {
          progressBarEl.style.animation = 'none';
          progressBarEl.style.width = '100%';
        }
      });
    } else {
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
      previewedColumns = cols;
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

      saveDatasetRecents();
    } catch (e) {
      tableWrap.innerHTML = `<div class="ft-error">${escapeHtml(e.message || e)}</div>`;
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      window.electron.offDatasetPreviewProgress?.();
    }
  }

  // ── Save / restore dataset inputs ──────────────────────────────

  async function saveDatasetRecents() {
    const data = {
      lastDataset: {
        hubId: document.getElementById('ft-ds-hub-id')?.value?.trim() || '',
        textColumn: document.getElementById('ft-ds-column')?.value?.trim() || 'text',
        maxSamples: document.getElementById('ft-ds-max-samples')?.value?.trim() || '',
      },
    };
    try {
      await window.electron.projectRecentsWrite(data);
    } catch (e) {
      // ignore
    }
  }

  async function restoreDatasetRecents() {
    try {
      const recents = await window.electron.projectRecentsRead();
      const ds = recents?.lastDataset;
      if (!ds) return;

      if (ds.hubId) document.getElementById('ft-ds-hub-id').value = ds.hubId;
      if (ds.textColumn) document.getElementById('ft-ds-column').value = ds.textColumn;
      if (ds.maxSamples) document.getElementById('ft-ds-max-samples').value = ds.maxSamples;
    } catch (e) {
      // ignore
    }
  }

  // ── Config tab ─────────────────────────────────────────────────

  async function setDefaultOutputDir() {
    try {
      const recents = await window.electron.projectRecentsRead();
      const openFolder = recents?.open;
      const el = document.getElementById('ft-output-dir');
      if (openFolder) {
        el.value = openFolder.replace(/\/+$/, '') + '/outputs';
      } else {
        el.placeholder = '<project-folder>/outputs — open a project folder first';
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
        hwDevice = 'mps';
        document.getElementById('ft-method-hint').textContent = 'MPS does not support QLoRA. Using LoRA.';
        document.getElementById('ft-use-bf16').checked = false;
        document.getElementById('ft-use-bf16').disabled = true;
      } else if (!isCUDA) {
        hwDevice = 'cpu';
        document.getElementById('ft-method-hint').textContent = 'CPU training is slow. Consider using a very small model and batch size.';
        document.getElementById('ft-use-bf16').checked = false;
        document.getElementById('ft-use-bf16').disabled = true;
      } else {
        hwDevice = 'cuda';
      }

      await checkAxolotlBackend();
    } catch (e) {
      hwDevice = 'cpu';
      document.getElementById('ft-hw-text').textContent = 'Could not detect hardware. Defaulting to safe settings.';
    }
  }

  // ── Axolotl backend availability ─────────────────────────────

  async function checkAxolotlBackend() {
    const hint = document.getElementById('ft-backend-hint');
    const backendSel = document.getElementById('ft-backend');
    try {
      const result = await window.electron.axolotlCheck();
      axolotlAvailable = result?.supported === true;
      if (axolotlAvailable === true) {
        if (hint) hint.textContent = 'Axolotl backend is available on this system (Linux + CUDA).';
      } else {
        if (hint) hint.textContent = (result?.reason)
          ? result.reason
          : 'Axolotl backend requires Linux + CUDA. Use the built-in TRL backend here.';
        if (backendSel && backendSel.value === 'axolotl') {
          backendSel.value = 'trl';
          backendSel.dispatchEvent(new Event('change'));
        }
      }
    } catch (e) {
      axolotlAvailable = false;
      if (hint) hint.textContent = 'Could not verify the Axolotl backend. Using built-in TRL by default.';
    }
  }

  function updateBackendHint() {
    const backend = document.getElementById('ft-backend')?.value;
    const hint = document.getElementById('ft-backend-hint');
    if (backend === 'axolotl') {
      if (axolotlAvailable === false) {
        hint.textContent = 'Axolotl backend requires Linux + CUDA (not available here). Training will fail at launch - switch to Built-in (TRL).';
      } else if (axolotlAvailable === null) {
        hint.textContent = 'Checking Axolotl availability...';
      } else {
        hint.textContent = 'Axolotl backend selected. Generates config.yaml and runs accelerate launch -m axolotl.cli.train.';
      }
    } else {
      hint.textContent = 'Built-in backend works everywhere (CPU / MPS / CUDA).';
    }
    updateConfigPreview();
  }

  function recommendedTier() {
    if (hwDevice === 'cuda') return 'hard';
    if (hwDevice === 'mps') return 'medium';
    return 'easy';
  }

  function renderExamples() {
    const list = document.getElementById('ft-examples-list');
    if (!list) return;
    const recommended = recommendedTier();
    const hwHint = document.getElementById('ft-example-hw-hint');

    const deviceName = hwDevice === 'cuda' ? 'CUDA GPU' : hwDevice === 'mps' ? 'Apple Silicon' : 'CPU';
    if (hwHint) {
      hwHint.textContent = `Detected hardware: ${deviceName} — recommended tier: ${HW_TIERS[recommended].label}. You can still pick any tier.`;
    }

    list.innerHTML = EXAMPLES.map(ex => {
      const cards = Object.keys(HW_TIERS).map(tier => {
        const v = ex.variants[tier];
        const tierInfo = HW_TIERS[tier];
        const isRecommended = tier === recommended;
        return `
          <div class="ft-example-card ${isRecommended ? 'ft-example-recommended' : ''}" data-cat="${escapeHtml(ex.id)}" data-tier="${tier}">
            <div class="ft-example-card-head">
              <span class="ft-tier-badge ft-tier-${tier}">${tierInfo.label} Hardware</span>
              ${isRecommended ? '<span class="ft-tier-rec">Recommended</span>' : ''}
            </div>
            <div class="ft-example-tier-hint">${tierInfo.hint}</div>
            <p><strong>Model:</strong> <code>${escapeHtml(v.model)}</code></p>
            <p><strong>Dataset:</strong> <code>${escapeHtml(ex.dataset)}</code></p>
            <p><strong>Method:</strong> ${v.method.toUpperCase()} &middot; <strong>Seq len:</strong> ${v.max_seq} &middot; <strong>Samples:</strong> ${v.max_samples.toLocaleString()}</p>
            <button class="settings-btn settings-btn-success ft-example-use" data-cat="${escapeHtml(ex.id)}" data-tier="${tier}">Use this example</button>
          </div>`;
      }).join('');

      return `
        <div class="ft-example-category">
          <h3>${escapeHtml(ex.title)}</h3>
          <p class="ft-example-desc">${escapeHtml(ex.desc)}</p>
          <div class="ft-example-grid">${cards}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.ft-example-use').forEach(btn => {
      btn.addEventListener('click', () => applyExample(btn.dataset.cat, btn.dataset.tier));
    });
  }

  async function exampleOutputDir(catId, tier) {
    try {
      const recents = await window.electron.projectRecentsRead();
      const openFolder = recents?.open;
      if (openFolder) {
        return openFolder.replace(/\/+$/, '') + '/outputs/' + catId + '-' + tier;
      }
    } catch (e) {
      // ignore
    }
    return '';
  }

  async function applyExample(catId, tier) {
    const ex = EXAMPLES.find(e => e.id === catId);
    if (!ex) return;
    const v = ex.variants[tier];
    if (!v) return;

    // Model
    const modelInput = document.getElementById('ft-model-id');
    if (modelInput) modelInput.value = v.model;
    selectedModel = '';
    hide('ft-compat-result');

    // Dataset
    const dsInput = document.getElementById('ft-ds-hub-id');
    if (dsInput) dsInput.value = ex.dataset;
    selectedDataset = ex.dataset;
    const colInput = document.getElementById('ft-ds-column');
    if (colInput) colInput.value = ex.textColumn || 'text';
    const maxInput = document.getElementById('ft-ds-max-samples');
    if (maxInput) maxInput.value = v.max_samples || '';

    // Output dir
    const outInput = document.getElementById('ft-output-dir');
    const outDir = await exampleOutputDir(catId, tier);
    if (outInput && outDir) outInput.value = outDir;

    // Hyperparameters
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.value = val;
    };
    set('ft-method', v.method);
    set('ft-lora-r', v.lora_r);
    set('ft-lora-alpha', v.lora_alpha);
    set('ft-lora-dropout', v.lora_dropout !== undefined ? v.lora_dropout : 0.05);
    set('ft-lr', v.learning_rate);
    set('ft-batch-size', v.batch_size);
    set('ft-grad-acc', v.grad_acc);
    set('ft-max-seq', v.max_seq);
    set('ft-epochs', v.epochs);
    set('ft-max-steps', v.max_steps !== undefined ? v.max_steps : '');
    set('ft-warmup', v.warmup);
    set('ft-log-steps', v.log_steps !== undefined ? v.log_steps : 10);
    set('ft-save-steps', v.save_steps);
    set('ft-scheduler', v.scheduler || 'cosine');
    const gradCheck = document.getElementById('ft-grad-checkpoint');
    if (gradCheck) gradCheck.checked = v.grad_checkpoint !== undefined ? v.grad_checkpoint : true;
    const flash = document.getElementById('ft-use-flash');
    if (flash) flash.checked = !!v.flash;
    const bf16 = document.getElementById('ft-use-bf16');
    if (bf16 && !bf16.disabled) bf16.checked = !!v.bf16;
    const resume = document.getElementById('ft-resume');
    if (resume) resume.checked = true;

    // Update method hint + preview, then go straight to training
    const methodSel = document.getElementById('ft-method');
    if (methodSel) {
      methodSel.dispatchEvent(new Event('change'));
    }
    updateConfigPreview();

    const cfg = buildConfig();
    if (!cfg.output_dir) {
      alert('Open a project folder first (File > Open Project) so the example can find an output directory.');
      switchTab('config');
      return;
    }

    // Persist the generated config so step 4 (confirmation) and the Export
    // page (Axolotl YAML / Colab) can pick it up even before training runs.
    if (window.electron.trainConfigSave) {
      window.electron.trainConfigSave(cfg.output_dir, JSON.stringify(cfg)).catch(() => {});
    }

    // Work-from-example: generate the config, then land on step 4 which now
    // acts as a confirmation screen (review + confirm) rather than jumping
    // straight into the training monitor.
    switchTab('train');
  }

  function buildConfig() {
    const method = document.getElementById('ft-method').value;
    const modelPath = document.getElementById('ft-model-id').value.trim();
    const datasetPath = selectedDataset || document.getElementById('ft-ds-hub-id').value.trim();
    const outputDir = document.getElementById('ft-output-dir').value.trim();

    const cfg = {
      training_backend: document.getElementById('ft-backend').value || 'trl',
      model_name_or_path: modelPath,
      dataset_path: datasetPath,
      output_dir: outputDir,
      text_column: document.getElementById('ft-ds-column').value.trim() || 'text',
      dataset_columns: previewedColumns.length ? previewedColumns : undefined,
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

  async function generateAxolotlYaml() {
    const cfg = buildConfig();
    const status = document.getElementById('ft-gen-yaml-status');
    if (!cfg.output_dir) {
      if (status) status.textContent = 'Set an output directory first.';
      return;
    }
    if (status) status.textContent = 'Generating...';
    try {
      const result = await window.electron.trainAxolotlWriteConfig(cfg.output_dir, JSON.stringify(cfg));
      if (result.success) {
        const pre = document.getElementById('ft-config-preview');
        if (pre) {
          pre.textContent = `# Axolotl config (config.yaml in ${result.path})\n# Generated by mama - backend: axolotl\n\n${result.yaml || ''}`;
        }
        if (status) status.textContent = 'config.yaml written. Preview above.';
      } else {
        if (status) status.textContent = 'Failed: ' + (result.error || 'Unknown error');
      }
    } catch (e) {
      if (status) status.textContent = 'Failed: ' + e.message;
    }
  }

  function updateTrainTab() {
    const cfg = buildConfig();
    const summary = document.getElementById('ft-train-tab-config-summary');
    if (cfg.model_name_or_path && cfg.dataset_path && cfg.output_dir) {
      const method = cfg.use_qlora ? 'QLoRA' : cfg.use_lora ? 'LoRA' : 'Full';
      const backend = cfg.training_backend === 'axolotl' ? 'Axolotl (Linux + CUDA)' : 'Built-in (TRL)';
      const effectiveBatch = (cfg.per_device_train_batch_size || 2) * (cfg.gradient_accumulation_steps || 4);
      const details = [
        ['Backend', backend],
        ['Method', method],
        ['Model', cfg.model_name_or_path],
        ['Dataset', cfg.dataset_path],
        ['Text column', cfg.text_column || 'text'],
        ['Max samples', cfg.max_samples ? String(cfg.max_samples) : 'All'],
        ['Output dir', cfg.output_dir],
        ['Sequence length', String(cfg.max_seq_length || 2048)],
        ['Effective batch size', String(effectiveBatch)],
        ['Learning rate', String(cfg.learning_rate || 2e-4)],
        ['Epochs', String(cfg.num_train_epochs || 3)],
        ['Warmup steps', String(cfg.warmup_steps || 100)],
        ['Save steps', String(cfg.save_steps || 500)],
        ['Scheduler', cfg.lr_scheduler_type || 'cosine'],
      ].map(([k, v]) => `
        <div class="ft-confirm-row">
          <span class="ft-confirm-key">${escapeHtml(k)}</span>
          <span class="ft-confirm-value">${escapeHtml(v)}</span>
        </div>`).join('');

      summary.innerHTML = `
        <div class="ft-confirm-card">
          <div class="ft-confirm-head">
            <span>Configuration Summary</span>
            <span class="ft-confirm-ok">Ready to confirm</span>
          </div>
          ${details}
        </div>`;
    } else {
      summary.innerHTML = `<p>Complete steps 1-3 to generate a training configuration, then confirm below.</p>`;
    }
  }

  async function startTraining() {
    const cfg = buildConfig();

    if (cfg.training_backend === 'axolotl' && axolotlAvailable === false) {
      if (!confirm('The Axolotl backend needs Linux + CUDA, which was not detected on this machine.\n\nTraining will fail at launch. Switch to the built-in TRL backend?\n\n(OK = keep Axolotl, Cancel = go back and switch)')) {
        switchTab('config');
        return;
      }
    }

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
    if (!cfg.output_dir) {
      alert('Please set an output directory. Open a project folder first, or choose an output path manually.');
      switchTab('config');
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

  // ── Easy mode explanations ─────────────────────────────────────

  const easyExplanations = {
    'ft-backend': 'Which training engine to use. The built-in (TRL) backend runs on any platform. Axolotl is the "power" backend with the full feature set (LoRA, QLoRA, full FT) but requires Linux with an NVIDIA CUDA GPU.',
    'ft-method': 'Choose how much of the model to update. LoRA is memory-efficient and recommended for most users. QLoRA uses 4-bit quantization to reduce memory further. Full fine-tuning updates all parameters but requires significant VRAM.',
    'ft-lora-r': 'The rank determines the size of the LoRA adapter matrices. Higher values (16-64) allow more expressiveness but use more memory. Start with 8-16.',
    'ft-lora-alpha': 'Scaling factor for LoRA updates. Typically set to 2\u00d7 the rank value. Controls how strongly the adapter affects the model output.',
    'ft-lora-dropout': 'Dropout probability for LoRA layers. Helps prevent overfitting on small datasets. 0.05 is a safe default.',
    'ft-lr': 'The step size for optimizer updates. 2e-4 is a common starting point for LoRA fine-tuning. Lower for full fine-tuning (1e-5 to 5e-5).',
    'ft-batch-size': 'Number of samples processed per device per step. Larger batch sizes use more memory but can give more stable gradients.',
    'ft-grad-acc': 'Accumulates gradients over multiple steps before updating weights. Effective batch size = batch size \u00d7 accumulation steps.',
    'ft-max-seq': 'Maximum number of tokens per input sequence. Longer sequences use more memory. 2048 is a good balance for most tasks.',
    'ft-epochs': 'Number of complete passes through the training dataset. More epochs can improve performance but risk overfitting.',
    'ft-max-steps': 'Maximum training steps. Overrides epochs if set to a positive value. Set to -1 to use epoch-based training.',
    'ft-warmup': 'Number of steps to linearly increase the learning rate from 0 to the target value. Helps stabilize early training.',
    'ft-log-steps': 'How often to log training metrics and save model checkpoints during training.',
    'ft-scheduler': 'Controls how the learning rate changes over time. Cosine is the most common and generally works well.',
    'ft-grad-checkpoint': 'Trades compute for memory. Uses less GPU memory but is slightly slower. Recommended for large models.',
    'ft-use-flash': 'Flash Attention 2 speeds up attention computation. Requires a CUDA-compatible GPU and the flash-attn package.',
    'ft-use-bf16': 'Uses bfloat16 precision for faster training and lower memory usage. Requires CUDA-capable GPU with bfloat16 support.',
    'ft-resume': 'If a checkpoint exists in the output directory, training will resume from it rather than starting from scratch.',
  };

  async function applyEasyMode() {
    try {
      const recents = await window.electron.projectRecentsRead();
      const openFolder = recents?.open;
      if (!openFolder) return;

      const projectData = await window.electron.projectJsonRead(openFolder);
      if (!projectData || projectData.difficulty !== 'easy') return;

      const grid = document.querySelector('.ft-config-grid');
      if (!grid) return;
      grid.classList.add('ft-config-easy');

      grid.querySelectorAll('.ft-field').forEach(field => {
        const children = Array.from(field.children);
        const hint = field.querySelector('.ft-hint');
        const control = field.querySelector('input, select');

        const left = document.createElement('div');
        left.className = 'ft-field-left';

        const right = document.createElement('div');
        right.className = 'ft-field-right';

        children.forEach(child => {
          if (child === hint || (child.classList && child.classList.contains('ft-hint'))) {
            right.appendChild(child);
          } else {
            left.appendChild(child);
          }
        });

        if (!right.children.length && control) {
          const id = control.id;
          if (id && easyExplanations[id]) {
            const p = document.createElement('p');
            p.textContent = easyExplanations[id];
            right.appendChild(p);
          }
        }

        field.textContent = '';
        field.appendChild(left);
        if (right.children.length > 0) {
          field.appendChild(right);
        }
      });
    } catch (e) {
      console.warn('applyEasyMode failed:', e);
    }
  }

  // ── Init ───────────────────────────────────────────────────────

  async function init() {
    // Tab switching
    document.querySelectorAll('.ft-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Step 0 - Start
    document.getElementById('ft-start-example-btn')?.addEventListener('click', () => {
      show('ft-examples');
      renderExamples();
      document.getElementById('ft-examples')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('ft-start-manual-btn')?.addEventListener('click', () => {
      switchTab('model');
    });
    document.getElementById('ft-start-card-example')?.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        document.getElementById('ft-start-example-btn')?.click();
      }
    });
    document.getElementById('ft-start-card-manual')?.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        document.getElementById('ft-start-manual-btn')?.click();
      }
    });

    // Model tab
    document.getElementById('ft-check-model')?.addEventListener('click', checkModelCompatibility);
    document.getElementById('ft-download-model')?.addEventListener('click', downloadModel);
    document.getElementById('ft-model-id')?.addEventListener('input', () => {
      hide('ft-compat-result');
    });

    // Dataset tab
    document.getElementById('ft-ds-load')?.addEventListener('click', loadDatasetPreview);

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
    document.getElementById('ft-gen-yaml')?.addEventListener('click', generateAxolotlYaml);
    document.getElementById('ft-backend')?.addEventListener('change', updateBackendHint);

    // Training tab
    document.getElementById('ft-start-train-from-step4')?.addEventListener('click', startTraining);
    document.getElementById('ft-export-axolotl-colab')?.addEventListener('click', () => {
      window.electron.navigateTo('public/export.html');
    });
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
      restoreDatasetRecents(),
      applyEasyMode(),
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
