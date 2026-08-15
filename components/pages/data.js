/**
 * data.js — Front-end controller for public/data.html
 *
 * Builds fine-tuning datasets locally:
 *   1. grui recordings → fine-tuning JSONL (alpaca / trl prompt-completion),
 *      plus runners for `grui dataset build` and `grui train`.
 *   2. CSV / TSV: pick columns, preview, build.
 *   3. Pasted Q:/A: text → build.
 *
 * "Output" tab sets the default output folder used by the other tabs.
 */

'use strict';

// ── Utilities ────────────────────────────────────────────────────────────────

function dataEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function dataCall(camel, snake, ...args) {
  const a = window.electron || window.pywebview?.api;
  const fn = a?.[camel] || a?.[snake];
  if (typeof fn !== 'function') return null;
  return await fn(...args);
}

let dataOutDir = ''; // shared output folder from the Output tab
let dataTableColumns = []; // last columns of the previewed table
let dataTableFile = '';

function setDataBusy(busy) {
  document.querySelectorAll('.data-page button').forEach((btn) => { btn.disabled = busy; });
}

function showResult(container, ok, text) {
  const el = document.getElementById(container);
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.className = 'data-result ' + (ok ? 'data-result-ok' : 'data-result-err');
}

function appendDataLog(text, cls) {
  const log = document.getElementById('data-log');
  if (!log) return;
  log.hidden = false;
  const pre = log.querySelector('pre');
  if (!pre) return;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  pre.appendChild(span);
  pre.appendChild(document.createTextNode('\n'));
  while (pre.childNodes.length > 600) pre.removeChild(pre.firstChild);
  const body = log.querySelector('.modules-log-body');
  if (body) body.scrollTop = body.scrollHeight;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function switchDataTab(tabId) {
  document.querySelectorAll('.ft-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.ft-tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === 'data-tab-' + tabId);
  });
  if (tabId === 'grui') refreshGruiStatus();
}

// ── File pickers ─────────────────────────────────────────────────────────────

async function pickFile(inputId, patterns) {
  const path = await dataCall('projectPickFile', 'project_pick_file', patterns || '');
  if (path) document.getElementById(inputId).value = path;
}

async function pickFolder(inputId) {
  const path = await dataCall('projectPickFolder', 'project_pick_folder');
  if (path) document.getElementById(inputId).value = path;
}

// ── grui tab ─────────────────────────────────────────────────────────────────

async function refreshGruiStatus() {
  const statusEl = document.getElementById('data-status');
  const result = await dataCall('dataGruiStatus', 'data_grui_status');
  if (!result || result.success !== true) {
    if (statusEl) statusEl.textContent = 'grui add-on check failed';
    return;
  }

  const notice = document.getElementById('data-grui-notice');
  if (!result.installed) {
    notice.hidden = false;
    notice.innerHTML = result.supported
      ? '<b>grui is not installed.</b> Install it from the Modules page (top-right), then come back.'
      : dataEscape(result.unsupported_reason || 'grui is not supported on this platform.');
    document.querySelectorAll('#data-tab-grui .settings-btn').forEach((b) => { b.disabled = true; });
  } else {
    notice.hidden = true;
    document.querySelectorAll('#data-tab-grui .settings-btn').forEach((b) => { b.disabled = false; });
  }

  if (statusEl) {
    statusEl.textContent = result.installed
      ? `grui installed · ${result.recordings.length} recording(s)`
      : 'grui not installed (Modules page)';
  }

  const select = document.getElementById('data-grui-recording');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = result.recordings.length
    ? result.recordings.map((r) => {
        const meta = [r.started_at, r.duration ? r.duration.toFixed(0) + 's' : ''].filter(Boolean).join(' · ');
        return `<option value="${dataEscape(r.path)}">${dataEscape(r.name)}${meta ? ' — ' + dataEscape(meta) : ''}</option>`;
      }).join('')
    : '<option value="">— no recordings yet (open the grui app and record) —</option>';
  if (previous) select.value = previous;
  document.getElementById('data-grui-ds-out').value = '';
}

// ── Table tab ───────────────────────────────────────────────────────────────

let tablePreviewRows = [];

async function previewTable() {
  const file = (document.getElementById('data-table-file').value || '').trim();
  if (!file) return showResult('data-table-build-result', false, 'Pick a table file first.');
  dataTableFile = file;
  const result = await dataCall('dataTablePreview', 'data_table_preview', file, '', 6);
  if (!result || result.success !== true) {
    return showResult('data-table-build-result', false, (result && result.error) || 'Preview failed.');
  }
  dataTableColumns = result.columns || [];
  document.getElementById('data-table-preview-wrap').hidden = false;
  document.getElementById('data-table-info').textContent =
    `${result.columns.length} column(s) · ${result.total} row(s) · delimiter: ${result.delimiter_label}`;

  const fill = (elId, skipNone) => {
    const sel = document.getElementById(elId);
    if (!sel) return;
    sel.innerHTML = (skipNone ? '' : '<option value="">— none —</option>') +
      result.columns.map((c) => `<option value="${dataEscape(c)}">${dataEscape(c)}</option>`).join('');
    if (sel.options.length) sel.selectedIndex = 0;
  };
  fill('data-table-instruction-col', true);
  fill('data-table-response-col', true);
  fill('data-table-context-col', false);

  tablePreviewRows = result.rows || [];
  const wrap = document.getElementById('data-table-wrap');
  wrap.innerHTML = tablePreviewRows.length
    ? '<table class="ft-data-table"><thead><tr>' +
      result.columns.map((c) => `<th>${dataEscape(c)}</th>`).join('') +
      '</tr></thead><tbody>' +
      tablePreviewRows.map((row) => '<tr>' + result.columns.map((c) => `<td>${dataEscape(row[c] ?? '')}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>'
    : '<p class="ft-empty">No data rows in file.</p>';
  if (result.columns.length && result.columns.length >= 2) {
    document.getElementById('data-table-instruction-col').value = result.columns[0];
    document.getElementById('data-table-response-col').value = result.columns[result.columns.length - 1];
  }
}

async function buildFromTable() {
  const instructionCol = (document.getElementById('data-table-instruction-col').value || '').trim();
  const responseCol = (document.getElementById('data-table-response-col').value || '').trim();
  const contextCol = (document.getElementById('data-table-context-col').value || '').trim();
  const params = {
    input_path: dataTableFile,
    instruction_col: instructionCol,
    response_col: responseCol,
    context_col: contextCol,
    format: document.getElementById('data-table-format').value,
    output_path: '',
  };
  setDataBusy(true);
  try {
    const result = await dataCall('dataBuildFromTable', 'data_build_from_table', params);
    showResult('data-table-build-result', !!result?.success,
      result?.success
        ? `Wrote ${result.samples} example(s) (${result.format}) → ${dataEscape(result.path)}`
        : (result?.error || 'Build failed.'));
  } finally {
    setDataBusy(false);
  }
}

// ── Paste-text tab ───────────────────────────────────────────────────────────

async function buildFromText() {
  const text = document.getElementById('data-text-input').value;
  setDataBusy(true);
  try {
    const params = { text: text, format: document.getElementById('data-text-format').value, output_path: '' };
    const result = await dataCall('dataBuildFromText', 'data_build_from_text', params);
    showResult('data-text-build-result', !!result?.success,
      result?.success
        ? `Wrote ${result.samples} example(s) (${result.format}) → ${dataEscape(result.path)}`
        : (result?.error || 'Build failed.'));
  } finally {
    setDataBusy(false);
  }
}

// ── grui actions ─────────────────────────────────────────────────────────────

async function buildFromGruiRecording() {
  const recording = document.getElementById('data-grui-recording').value;
  const params = {
    recording_dir: recording,
    instruction: document.getElementById('data-grui-instruction').value,
    format: document.getElementById('data-grui-format').value,
    output_path: '',
  };
  setDataBusy(true);
  try {
    const result = await dataCall('dataGruiRecordingBuild', 'data_grui_recording_build', params);
    showResult('data-grui-build-result', !!result?.success,
      result?.success
        ? `Wrote ${result.samples} example(s) (${result.format}) → ${dataEscape(result.path)}`
        : (result?.error || 'Conversion failed.'));
  } finally {
    setDataBusy(false);
  }
}

async function runGruiDatasetBuild() {
  const recording = document.getElementById('data-grui-recording').value;
  if (!recording) return showResult('data-grui-build-result', false, 'No recording selected.');
  const params = {
    recording_dir: recording,
    out_dir: document.getElementById('data-grui-ds-out').value || '',
  };
  setDataBusy(true);
  try {
    await dataCall('dataGruiDatasetBuild', 'data_grui_dataset_build', params);
  } finally {
    setDataBusy(false);
    refreshGruiStatus();
  }
}

async function runGruiTrain() {
  const dataset = (document.getElementById('data-grui-train-ds').value || '').trim();
  const out = (document.getElementById('data-grui-train-out').value || '').trim();
  if (!dataset || !out) return appendDataLog('! dataset directory and checkpoint output are required', 'log-err');
  const params = {
    dataset_dir: dataset,
    out: out,
    epochs: document.getElementById('data-grui-train-epochs').value || 10,
  };
  setDataBusy(true);
  try {
    const result = await dataCall('dataGruiTrain', 'data_grui_train', params);
    if (result && !result.success && result.error) appendDataLog('! ' + result.error, 'log-err');
  } finally {
    setDataBusy(false);
  }
}

// ── Output tab ───────────────────────────────────────────────────────────────

async function initOutputTab() {
  const dir = await dataCall('dataDefaultOutputDir', 'data_default_output_dir');
  if (typeof dir === 'string' && dir) {
    dataOutDir = dir;
    document.getElementById('data-out-dir').value = dir;
  }
}

async function applyOutDir() {
  dataOutDir = (document.getElementById('data-out-dir').value || '').trim();
  // Prefill the grui dataset build output when it is still empty
  const dsOut = document.getElementById('data-grui-ds-out');
  if (dsOut && !dsOut.value.trim() && dataOutDir) dsOut.value = dataOutDir + '/grui_dataset';
  const trainOut = document.getElementById('data-grui-train-out');
  if (trainOut && !trainOut.value.trim() && dataOutDir) trainOut.value = dataOutDir + '/policy.pt';
  appendDataLog('output folder: ' + dataOutDir, 'log-meta');
}

// ── IPC stream ───────────────────────────────────────────────────────────────

function registerDataStream() {
  const a = window.electron || window.pywebview?.api;
  if (a && typeof a.onDataProgress === 'function') {
    a.onDataProgress((chunk) => {
      chunk = chunk || {};
      if (chunk.type === 'meta') appendDataLog(chunk.text, 'log-meta');
      else if (chunk.type === 'stdout' || chunk.type === 'log') appendDataLog(chunk.text, '');
      else if (chunk.type === 'stderr' || chunk.type === 'error') appendDataLog('! ' + chunk.text, 'log-err');
      else if (chunk.type === 'done') appendDataLog(chunk.success ? '» done.' : '» failed.', chunk.success ? 'log-ok' : 'log-err');
    });
  }
  // Fallback for environments where the domain-event path is used instead
  window.addEventListener?.('app:ipc-_dataProgressCallback', (ev) => {
    const chunk = ev.detail || {};
    if (chunk.type === 'meta') appendDataLog(chunk.text, 'log-meta');
    else if (chunk.type === 'stdout' || chunk.type === 'log') appendDataLog(chunk.text, '');
    else if (chunk.type === 'stderr' || chunk.type === 'error') appendDataLog('! ' + chunk.text, 'log-err');
    else if (chunk.type === 'done') appendDataLog(chunk.success ? '» done.' : '» failed.', chunk.success ? 'log-ok' : 'log-err');
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initDataPage() {
  document.querySelectorAll('.ft-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchDataTab(tab.dataset.tab));
  });

  document.getElementById('data-refresh').addEventListener('click', () => { refreshGruiStatus(); });
  document.getElementById('data-table-browse').addEventListener('click', () => pickFile('data-table-file', 'csv,tsv,txt'));
  document.getElementById('data-table-preview').addEventListener('click', previewTable);
  document.getElementById('data-table-build').addEventListener('click', buildFromTable);
  document.getElementById('data-text-build').addEventListener('click', buildFromText);
  document.getElementById('data-grui-build').addEventListener('click', buildFromGruiRecording);
  document.getElementById('data-grui-dataset-build').addEventListener('click', runGruiDatasetBuild);
  document.getElementById('data-grui-train').addEventListener('click', runGruiTrain);
  document.getElementById('data-grui-ds-browse').addEventListener('click', () => pickFolder('data-grui-ds-out'));
  document.getElementById('data-grui-train-ds-browse').addEventListener('click', () => pickFolder('data-grui-train-ds'));
  document.getElementById('data-grui-train-out-browse').addEventListener('click', () => pickFolder('data-grui-train-out'));
  document.getElementById('data-out-browse').addEventListener('click', () => pickFolder('data-out-dir'));
  document.getElementById('data-out-apply').addEventListener('click', applyOutDir);
  document.getElementById('data-log-clear').addEventListener('click', () => {
    const log = document.getElementById('data-log');
    if (log) { log.querySelector('pre').textContent = ''; log.hidden = true; }
  });

  registerDataStream();
  initOutputTab();
  switchDataTab('grui');
}

initDataPage();