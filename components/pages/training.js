/**
 * training.js — Live training monitor with loss chart, ETA, resource usage.
 */

'use strict';

const TrainingMonitor = (() => {
  let currentOutputDir = '';
  let metrics = [];
  let lossChart = null;
  let chartCanvas = null;
  let chartCtx = null;
  let refreshInterval = null;
  let trainingActive = false;

  // ── Init ──────────────────────────────────────────────────────────

  async function init() {
    chartCanvas = document.getElementById('train-loss-chart');
    if (chartCanvas) {
      chartCtx = chartCanvas.getContext('2d');
      initChart();
    }

    // Load the resources widget
    const resourcesContainer = document.getElementById('train-resources-widget');
    if (resourcesContainer && window.initResourcesWidget) {
      try {
        const settings = await window.electron.settingsRead();
        const gpuConfig = settings?.['system information'] || null;
        initResourcesWidget(resourcesContainer, { gpuConfig });
      } catch (e) {
        resourcesContainer.innerHTML = '<p class="train-muted">Resource monitoring unavailable</p>';
      }
    }

    // Start listening for training IPC events
    window.electron.onTrainingProgress(onTrainingEvent);

    // Try to auto-load from recents
    try {
      const recents = await window.electron.projectRecentsRead();
      if (recents?.open) {
        await loadOutputFolder(recents.open);
      }
    } catch (e) {
      // ignore
    }

    // Bind controls
    document.getElementById('train-select-folder')?.addEventListener('click', selectOutputFolder);
    document.getElementById('train-pause-btn')?.addEventListener('click', pauseTraining);
    document.getElementById('train-resume-btn')?.addEventListener('click', resumeTraining);
    document.getElementById('train-cancel-btn')?.addEventListener('click', cancelTraining);

    // Periodic checkpoint refresh
    refreshInterval = setInterval(refreshCheckpoints, 5000);
  }

  // ── Chart ─────────────────────────────────────────────────────────

  function initChart() {
    if (!chartCtx) return;
    const canvas = chartCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    chartCtx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function drawChart() {
    if (!chartCtx) return;
    const canvas = chartCanvas;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const ctx = chartCtx;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--widget-bg').trim() || '#1e1e2e';
    ctx.fillRect(0, 0, width, height);

    if (metrics.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for training data...', width / 2, height / 2);
      return;
    }

    const steps = metrics.map(m => m.step);
    const losses = metrics.map(m => m.loss).filter(l => l !== null && l !== undefined);
    if (losses.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting loss data...', width / 2, height / 2);
      return;
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const minLoss = Math.min(...losses);
    const maxLoss = Math.max(...losses);
    const lossRange = maxLoss - minLoss || 1;

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const val = maxLoss - (lossRange / 4) * i;
      ctx.fillStyle = '#888';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(3), padding.left - 8, y + 4);
    }

    // X-axis labels
    const stepMin = steps[0];
    const stepMax = steps[steps.length - 1];
    const stepRange = stepMax - stepMin || 1;
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (chartW / 4) * i;
      const val = Math.round(stepMin + (stepRange / 4) * i);
      ctx.fillStyle = '#888';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(val.toString(), x, height - padding.bottom + 18);
    }

    // Loss line
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < steps.length; i++) {
      if (metrics[i].loss === null || metrics[i].loss === undefined) continue;
      const x = padding.left + ((steps[i] - stepMin) / stepRange) * chartW;
      const y = padding.top + ((maxLoss - metrics[i].loss) / lossRange) * chartH;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current value dot
    const lastIdx = steps.length - 1;
    if (metrics[lastIdx].loss !== null && metrics[lastIdx].loss !== undefined) {
      const x = padding.left + ((steps[lastIdx] - stepMin) / stepRange) * chartW;
      const y = padding.top + ((maxLoss - metrics[lastIdx].loss) / lossRange) * chartH;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Axis labels
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Step', width / 2, height - 2);
    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Loss', 0, 0);
    ctx.restore();
  }

  // ── IPC event handler ──────────────────────────────────────────

  function onTrainingEvent(chunk) {
    if (chunk.type === 'metric') {
      metrics.push({
        step: chunk.step,
        loss: chunk.loss,
        learning_rate: chunk.learning_rate,
        epoch: chunk.epoch,
        grad_norm: chunk.grad_norm,
      });
      updateCurrentMetrics(chunk);
      drawChart();
      appendLog(`Step ${chunk.step}: loss=${chunk.loss?.toFixed(4) || '?'} lr=${formatLR(chunk.learning_rate)}`);
    } else if (chunk.type === 'status') {
      updateStatus(chunk.message, chunk.stage);
      appendLog(`[${chunk.stage}] ${chunk.message}`);
    } else if (chunk.type === 'progress') {
      updateProgress(chunk.current, chunk.total);
    } else if (chunk.type === 'error') {
      updateStatus(`Error: ${chunk.message}`, 'error');
      appendLog(`ERROR: ${chunk.message}`);
      if (chunk.suggestions) {
        chunk.suggestions.forEach(s => appendLog(`  Suggestion: ${s}`));
      }
      trainingActive = false;
      updateControlButtons();
    } else if (chunk.type === 'done') {
      updateStatus('Training completed', 'done');
      appendLog('Training completed successfully.');
      trainingActive = false;
      updateControlButtons();
      refreshCheckpoints();
    } else if (chunk.stderr) {
      appendLog(`[stderr] ${chunk.text || ''}`);
    }
  }

  // ── UI updates ─────────────────────────────────────────────────

  function updateStatus(message, stage) {
    const banner = document.getElementById('train-status-banner');
    if (!banner) return;
    banner.className = 'train-status-banner';
    if (stage === 'error') banner.classList.add('status-error');
    else if (stage === 'done') banner.classList.add('status-done');
    else if (stage === 'training') banner.classList.add('status-active');
    else if (stage === 'loading') banner.classList.add('status-loading');
    document.getElementById('train-status-text').textContent = message;
  }

  function updateProgress(current, total) {
    const bar = document.getElementById('train-progress-bar');
    const stepEl = document.getElementById('train-current-step');
    const totalEl = document.getElementById('train-total-steps');
    if (bar && total > 0) bar.style.width = `${Math.min(100, (current / total) * 100)}%`;
    if (stepEl) stepEl.textContent = current;
    if (totalEl) totalEl.textContent = total;
    trainingActive = true;
    updateControlButtons();
  }

  function updateCurrentMetrics(data) {
    setText('train-current-loss', data.loss?.toFixed(4) || '—');
    setText('train-current-lr', formatLR(data.learning_rate));
    setText('train-current-grad', data.grad_norm?.toFixed(4) || '—');
    setText('train-current-epoch', data.epoch?.toFixed(2) || '—');
  }

  function formatLR(lr) {
    if (!lr) return '—';
    if (lr < 1e-5) return lr.toExponential(2);
    return lr.toFixed(6);
  }

  // ── Log ──────────────────────────────────────────────────────────

  function appendLog(line) {
    const logEl = document.getElementById('train-log');
    if (!logEl) return;
    const empty = logEl.querySelector('.train-log-empty');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'train-log-line';
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── Output folder selection ─────────────────────────────────────

  async function selectOutputFolder() {
    try {
      const folder = await window.electron.projectPickFolder();
      if (folder) await loadOutputFolder(folder);
    } catch (e) {
      console.error('Folder selection failed:', e);
    }
  }

  async function loadOutputFolder(folderPath) {
    if (!folderPath) return;
    currentOutputDir = folderPath;
    document.getElementById('train-current-folder').textContent = folderPath;
    metrics = [];

    // Load config if available
    const status = await window.electron.trainStatus(folderPath);
    if (status.has_config) {
      document.getElementById('train-total-steps').textContent = '?';
    }

    // Check for checkpoints and past metrics
    await refreshCheckpoints();

    // Pre-populate log with existing trainer state
    const checkpoints = await window.electron.trainListCheckpoints(folderPath);
    if (checkpoints.length > 0) {
      appendLog(`Found ${checkpoints.length} checkpoint(s). Latest: step ${checkpoints[checkpoints.length - 1].step}`);
      // Load metrics from trainer state
      for (const cp of checkpoints) {
        if (cp.loss !== undefined && cp.loss !== null) {
          metrics.push({ step: cp.step, loss: cp.loss, epoch: cp.epoch });
        }
      }
      if (metrics.length > 0) drawChart();
    }

    updateControlButtons();
  }

  // ── Training controls ─────────────────────────────────────────

  function updateControlButtons() {
    const pauseBtn = document.getElementById('train-pause-btn');
    const resumeBtn = document.getElementById('train-resume-btn');
    const cancelBtn = document.getElementById('train-cancel-btn');

    if (!currentOutputDir) {
      [pauseBtn, resumeBtn, cancelBtn].forEach(b => { if (b) b.style.display = 'none'; });
      return;
    }

    if (trainingActive) {
      if (pauseBtn) pauseBtn.style.display = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = '';
    } else {
      // Check if paused
      (async () => {
        const status = await window.electron.trainStatus(currentOutputDir);
        if (status.is_paused) {
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (resumeBtn) resumeBtn.style.display = '';
          if (cancelBtn) cancelBtn.style.display = '';
        } else {
          [pauseBtn, resumeBtn, cancelBtn].forEach(b => { if (b) b.style.display = 'none'; });
        }
      })();
    }
  }

  async function pauseTraining() {
    if (!currentOutputDir) return;
    const result = await window.electron.trainPause(currentOutputDir);
    if (result.success) {
      appendLog('Training paused.');
      updateControlButtons();
    }
  }

  async function resumeTraining() {
    if (!currentOutputDir) return;
    const result = await window.electron.trainResume(currentOutputDir);
    if (result.success) {
      appendLog('Training resumed.');
      trainingActive = true;
      updateControlButtons();
    }
  }

  async function cancelTraining() {
    if (!currentOutputDir) return;
    if (!confirm('Are you sure you want to cancel training?')) return;
    const result = await window.electron.trainCancel(currentOutputDir);
    if (result.success) {
      appendLog('Training cancelled.');
      trainingActive = false;
      updateControlButtons();
    }
  }

  async function refreshCheckpoints() {
    if (!currentOutputDir) return;
    try {
      const checkpoints = await window.electron.trainListCheckpoints(currentOutputDir);
      const container = document.getElementById('train-checkpoints');
      if (!container) return;

      if (checkpoints.length === 0) {
        container.innerHTML = '<span class="train-muted">No checkpoints found</span>';
        return;
      }

      container.innerHTML = checkpoints.map(cp => `
        <div class="train-checkpoint-item">
          <span class="train-cp-step">Step ${cp.step}</span>
          <span class="train-cp-loss">${cp.loss !== undefined && cp.loss !== null ? 'loss: ' + cp.loss.toFixed(4) : ''}</span>
          <span class="train-cp-size">${formatSize(cp.size_bytes)}</span>
        </div>
      `).join('');
    } catch (e) {
      // ignore
    }
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let sz = bytes;
    while (sz >= 1024 && i < units.length - 1) { sz /= 1024; i++; }
    return sz.toFixed(1) + ' ' + units[i];
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  function cleanup() {
    if (refreshInterval) clearInterval(refreshInterval);
    window.electron.offTrainingProgress();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', cleanup);

  return { cleanup };
})();
