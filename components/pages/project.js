/**
 * project.js — Folder explorer for public/project.html
 */

'use strict';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

let _currentFolderPath = null;

function getRecentPaths(recents) {
  if (!recents || !Array.isArray(recents.recent)) return [];
  return recents.recent.filter((entry) => typeof entry === 'string' && entry);
}

function renderLanding(recents) {
  const container = document.getElementById('project-content');
  if (!container) return;

  const recentPaths = getRecentPaths(recents);
  const recentHtml = recentPaths.length
    ? `
      <div class="project-recent">
        <h3>Open from recent</h3>
        <ul class="project-recent-list">
          ${recentPaths.map((folderPath) => `
            <li>
              <button type="button" class="project-recent-btn" data-folder-path="${escapeHtml(folderPath)}">
                📁 ${escapeHtml(folderPath)}
              </button>
            </li>
          `).join('')}
        </ul>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="project-landing">
      <h1>Project</h1>
      <p class="project-landing-desc">Open a folder to browse project files.</p>
      <div class="project-landing-actions">
        <button type="button" id="project-open-folder-btn" class="settings-btn settings-btn-primary">
          📂 Open folder
        </button>
      </div>
      ${recentHtml}
    </div>
  `;

  document.getElementById('project-open-folder-btn')?.addEventListener('click', pickAndOpenFolder);
  container.querySelectorAll('.project-recent-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const folderPath = btn.getAttribute('data-folder-path');
      if (folderPath) await openFolder(folderPath);
    });
  });
}

function getExplorerLabel() {
  const platform = window.navigator.platform || '';
  if (platform.includes('Mac')) return '🗂 Open in Finder';
  if (platform.includes('Linux')) return '🗂 Open in File Manager';
  return '🗂 Open in Explorer';
}

function showProjectInitDialog(folderPath, status) {
  const container = document.getElementById('project-content');
  if (!container) return;

  // Build checklist of missing items
  const missing = [];
  if (!status.hasProjectJson) missing.push('project.json');
  if (!status.hasVenv) missing.push('.venv (Python virtual environment)');

  if (missing.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'project-init-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); z-index: 1000;
    display: flex; align-items: center; justify-content: center;
  `;

  const modal = document.createElement('div');
  modal.className = 'project-init-modal';
  modal.style.cssText = `
    background: var(--background-color, #1e1e2e);
    color: var(--text-color, #cdd6f4);
    border-radius: 12px; padding: 24px; max-width: 480px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;

  modal.innerHTML = `
    <h3 style="margin-top:0">Project Initialization</h3>
    <p>This folder doesn't have the following project files:</p>
    <ul>
      ${missing.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
    <p>What would you like to create?</p>
    <div id="init-results" style="margin-bottom:12px"></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; margin-top:16px">
      <button id="init-cancel-btn" class="settings-btn settings-btn-secondary">Cancel</button>
      ${!status.hasProjectJson ? '<button id="init-json-btn" class="settings-btn settings-btn-primary">Create project.json</button>' : ''}
      ${!status.hasVenv ? '<button id="init-venv-btn" class="settings-btn settings-btn-primary">Create .venv</button>' : ''}
      ${missing.length > 1 ? '<button id="init-both-btn" class="settings-btn settings-btn-success">Create both</button>' : ''}
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const resultsDiv = document.getElementById('init-results');

  function appendResult(msg, isError) {
    if (!resultsDiv) return;
    const div = document.createElement('div');
    div.style.cssText = `padding:4px 0; font-size:13px; color:${isError ? 'var(--error-color, #f38ba8)' : 'var(--success-color, #a6e3a1)'}`;
    div.textContent = msg;
    resultsDiv.appendChild(div);
  }

  function disableAllButtons() {
    document.querySelectorAll('#init-json-btn, #init-venv-btn, #init-both-btn, #init-cancel-btn').forEach(b => {
      if (b) b.disabled = true;
    });
  }

  document.getElementById('init-cancel-btn')?.addEventListener('click', () => {
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  });

  document.getElementById('init-json-btn')?.addEventListener('click', async () => {
    disableAllButtons();
    const res = await window.electron.projectCreateJson(folderPath);
    appendResult(`project.json: ${res.success ? '✅' : '❌ ' + (res.error || '')}`, !res.success);
    document.getElementById('init-json-btn')?.remove();
    // If both are now done, close after a moment
    if (!document.getElementById('init-venv-btn') && !document.getElementById('init-both-btn')) {
      setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 1500);
    }
  });

  document.getElementById('init-venv-btn')?.addEventListener('click', async () => {
    disableAllButtons();
    const res = await window.electron.projectCreateVenv(folderPath);
    appendResult(`.venv: ${res.success ? '✅' : '❌ ' + (res.error || '')}`, !res.success);
    document.getElementById('init-venv-btn')?.remove();
    if (!document.getElementById('init-json-btn') && !document.getElementById('init-both-btn')) {
      setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 1500);
    }
  });

  document.getElementById('init-both-btn')?.addEventListener('click', async () => {
    disableAllButtons();
    const jsonRes = await window.electron.projectCreateJson(folderPath);
    appendResult(`project.json: ${jsonRes.success ? '✅' : '❌ ' + (jsonRes.error || '')}`, !jsonRes.success);
    const venvRes = await window.electron.projectCreateVenv(folderPath);
    appendResult(`.venv: ${venvRes.success ? '✅' : '❌ ' + (venvRes.error || '')}`, !venvRes.success);
    document.getElementById('init-json-btn')?.remove();
    document.getElementById('init-venv-btn')?.remove();
    document.getElementById('init-both-btn')?.remove();
    setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 2000);
  });
}

async function renderExplorer(folderData) {
  const container = document.getElementById('project-content');
  if (!container || !folderData) return;

  _currentFolderPath = folderData.path;

  const parentPath = getParentPath(folderData.path);
  const templates = await window.electron.projectTemplatesRead();
  const templateOptions = Object.entries(templates || {}).map(([key, template]) => ({
    key,
    label: template?.name || template?.description || key,
  }));

  let projectData, data;
  try {
    projectData = await window.electron.projectJsonRead(folderData.path);
  } catch (e) {
    console.warn('projectJsonRead failed:', e);
  }
  data = projectData || {};
  if (!projectData) {
    data.name = folderData.path.split('/').filter(Boolean).pop() || folderData.path.split('\\').filter(Boolean).pop() || '';
  }

  const rows = (folderData.entries || []).map((entry) => {
    const icon = entry.isDirectory ? '📁' : '📄';
    const type = entry.isDirectory ? 'Folder' : 'File';
    return `
      <tr class="project-file-row ${entry.isDirectory ? 'is-directory' : 'is-file'}"
          data-folder-path="${entry.isDirectory ? escapeHtml(entry.path) : ''}">
        <td class="project-file-name">${icon} ${escapeHtml(entry.name)}</td>
        <td class="project-file-type">${type}</td>
        <td class="project-file-size">${formatSize(entry.size)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="project-explorer">
      <header class="project-explorer-header">
        <div>
          <h1>Project</h1>
          <p class="project-current-path">${escapeHtml(folderData.path)}</p>
        </div>
        <div class="project-explorer-actions">
          ${parentPath ? `<button type="button" id="project-up-btn" class="settings-btn settings-btn-secondary">⬆ Up</button>` : ''}
          <button type="button" id="project-change-folder-btn" class="settings-btn settings-btn-secondary">📂 Open folder</button>
          <button type="button" id="project-open-in-explorer-btn" class="settings-btn settings-btn-secondary">${escapeHtml(getExplorerLabel())}</button>
          <div class="project-import-menu">
            <button type="button" id="project-import-template-btn" class="settings-btn settings-btn-primary">⬇ Import template</button>
            <div class="project-import-menu-options" id="project-import-template-options">
              ${templateOptions.map((entry) => `
                <button type="button" class="project-import-option" data-template-key="${escapeHtml(entry.key)}">
                  ${escapeHtml(entry.label)}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </header>
      <div class="project-file-table-wrap">
        <table class="project-file-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3" class="project-empty">This folder is empty.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="project-settings-section">
        <button type="button" id="project-settings-toggle" class="project-settings-toggle">
          <span id="project-settings-toggle-icon">▶</span> Project Settings
        </button>
        <div id="project-settings-body" class="project-settings-body" style="display:none">
          <div class="settings-group">
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-name">Name</label>
              </div>
              <div class="settings-field-control">
                <input type="text" id="ps-name" class="settings-input" value="${escapeHtml(data.name || '')}">
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-version">Version</label>
              </div>
              <div class="settings-field-control">
                <input type="text" id="ps-version" class="settings-input" value="${escapeHtml(data.version || '')}">
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-description">Description</label>
              </div>
              <div class="settings-field-control">
                <input type="text" id="ps-description" class="settings-input" value="${escapeHtml(data.description || '')}">
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-framework">Framework</label>
              </div>
              <div class="settings-field-control">
                <div class="ps-framework-row">
                  <input type="text" id="ps-framework" class="settings-input" value="${escapeHtml(data.framework || '')}" placeholder="e.g. pytorch, tensorflow">
                  <button type="button" class="ps-fw-btn ps-fw-pytorch ${(data.framework || '').toLowerCase() === 'pytorch' ? 'is-active' : ''}" data-fw="pytorch">PyTorch</button>
                  <button type="button" class="ps-fw-btn ps-fw-tensorflow ${(data.framework || '').toLowerCase() === 'tensorflow' ? 'is-active' : ''}" data-fw="tensorflow">TensorFlow</button>
                </div>
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-created">Created</label>
              </div>
              <div class="settings-field-control">
                <input type="text" id="ps-created" class="settings-input" value="${escapeHtml(data.created || '')}" readonly>
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-difficulty">Difficulty</label>
                <p class="settings-field-desc">Easy will add explanations to all settings.</p>
              </div>
              <div class="settings-field-control">
                <select id="ps-difficulty" class="settings-input">
                  <option value="easy" ${(data.difficulty || 'easy') === 'easy' ? 'selected' : ''}>Easy</option>
                  <option value="hard" ${data.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
                </select>
              </div>
            </div>
            <div class="settings-field">
              <div class="settings-field-meta">
                <label class="settings-label" for="ps-multimodel">Multimodel mode</label>
                <p class="settings-field-desc">A handy GUI tool for designing multi-AI systems. This feature is not yet available.</p>
              </div>
              <div class="settings-field-control">
                <input type="checkbox" id="ps-multimodel" class="settings-checkbox" ${data.multimodel_mode === true ? 'checked' : ''}>
              </div>
            </div>
          </div>
          <div class="settings-actions">
            <button id="ps-save-btn" class="settings-btn settings-btn-primary">💾 Save Settings</button>
            <button id="ps-revert-btn" class="settings-btn settings-btn-secondary">↻ Revert</button>
          </div>
          <div id="ps-status" class="settings-status" style="display:none"></div>
        </div>
      </div>
  </div>
  `;

  document.getElementById('project-change-folder-btn')?.addEventListener('click', pickAndOpenFolder);
  document.getElementById('project-up-btn')?.addEventListener('click', async () => {
    if (parentPath) await openFolder(parentPath, false);
  });
  document.getElementById('project-open-in-explorer-btn')?.addEventListener('click', async () => {
    await revealInExplorer(folderData.path);
  });

  const importButton = document.getElementById('project-import-template-btn');
  const importOptions = document.getElementById('project-import-template-options');
  importButton?.addEventListener('click', () => {
    importOptions?.classList.toggle('is-open');
  });

  container.querySelectorAll('.project-import-option').forEach((button) => {
    button.addEventListener('click', async () => {
      const templateKey = button.getAttribute('data-template-key');
      if (!templateKey) return;
      importOptions?.classList.remove('is-open');
      await importTemplate(templateKey);
    });
  });

  container.querySelectorAll('.project-file-row.is-directory').forEach((row) => {
    row.addEventListener('dblclick', async () => {
      const folderPath = row.getAttribute('data-folder-path');
      if (folderPath) await openFolder(folderPath, false);
    });
  });

  document.getElementById('project-settings-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('project-settings-body');
    const icon = document.getElementById('project-settings-toggle-icon');
    if (!body || !icon) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    icon.textContent = isOpen ? '▶' : '▼';
  });

  container.querySelectorAll('.ps-fw-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('ps-framework');
      if (input) input.value = btn.dataset.fw;
      container.querySelectorAll('.ps-fw-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  document.getElementById('ps-save-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('ps-status');
    const multimodelCheck = document.getElementById('ps-multimodel');
    const difficultySelect = document.getElementById('ps-difficulty');
    const updated = {
      name: document.getElementById('ps-name')?.value || '',
      version: document.getElementById('ps-version')?.value || '',
      description: document.getElementById('ps-description')?.value || '',
      framework: document.getElementById('ps-framework')?.value || null,
      created: data.created || new Date().toISOString(),
      multimodel_mode: multimodelCheck ? multimodelCheck.checked : true,
      difficulty: difficultySelect ? difficultySelect.value : 'easy',
    };
    const result = await window.electron.projectJsonWrite(folderData.path, updated);
    if (result.success) {
      location.reload();
    } else {
      statusEl.textContent = 'Failed to save: ' + (result.error || 'unknown error');
      statusEl.className = 'settings-status error';
      statusEl.style.display = 'block';
    }
  });

  document.getElementById('ps-revert-btn')?.addEventListener('click', async () => {
    if (_currentFolderPath) {
      const folderData = await window.electron.projectListFolder(_currentFolderPath);
      if (folderData) await renderExplorer(folderData);
    }
  });
}

function getParentPath(folderPath) {
  if (!folderPath) return null;
  const normalized = folderPath.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

async function pickAndOpenFolder() {
  try {
    const folderPath = await window.electron.projectPickFolder();
    if (!folderPath) return;
    await openFolder(folderPath);
  } catch (e) {
    console.error('Failed to pick folder:', e);
  }
}

async function openFolder(folderPath, updateRecents = true) {
  try {
    const folderData = updateRecents
      ? await window.electron.projectOpenFolder(folderPath)
      : await window.electron.projectListFolder(folderPath);

    if (!folderData) {
      renderLanding(await window.electron.projectRecentsRead());
      return;
    }

    await renderExplorer(folderData);

    // Check for project.json and .venv, and show init dialog if missing
    const initStatus = await window.electron.projectInit(folderPath);
    showProjectInitDialog(folderPath, initStatus);
  } catch (e) {
    console.error('Failed to open folder:', e);
  }
}

async function revealInExplorer(folderPath) {
  try {
    const ok = await window.electron.projectRevealFolder(folderPath);
    if (!ok) {
      window.alert('Unable to open this folder in the system file explorer.');
    }
  } catch (e) {
    console.error('Reveal folder failed:', e);
    window.alert('Unable to open this folder in the system file explorer.');
  }
}

async function importTemplate(templateKey) {
  try {
    const result = await window.electron.projectImportTemplate(templateKey);
    if (result?.success) {
      window.alert(`Imported template into ${result.destinationDir}`);
      await openFolder(result.destinationDir, false);
    } else {
      window.alert(result?.error || 'Template import failed.');
    }
  } catch (e) {
    console.error('Template import failed:', e);
    window.alert('Template import failed.');
  }
}

async function init() {
  await new Promise(function (resolve) {
    if (window.pywebview && window.pywebview.api) { resolve(); return; }
    window.addEventListener('pywebviewready', function onReady() {
      window.removeEventListener('pywebviewready', onReady);
      setTimeout(resolve, 0);
    });
  });
  const recents = await window.electron.projectRecentsRead();
  if (recents?.open) {
    try {
      await openFolder(recents.open);
      return;
    } catch (e) {
      console.error('Failed to auto-open recents folder:', e);
    }
  }
  renderLanding(recents);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}