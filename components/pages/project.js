/**
 * project.js — Folder explorer for public/project.html
 */

'use strict';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

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

function renderExplorer(folderData) {
  const container = document.getElementById('project-content');
  if (!container || !folderData) return;

  const parentPath = getParentPath(folderData.path);

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
    </div>
  `;

  document.getElementById('project-change-folder-btn')?.addEventListener('click', pickAndOpenFolder);
  document.getElementById('project-up-btn')?.addEventListener('click', async () => {
    if (parentPath) await openFolder(parentPath, false);
  });

  container.querySelectorAll('.project-file-row.is-directory').forEach((row) => {
    row.addEventListener('dblclick', async () => {
      const folderPath = row.getAttribute('data-folder-path');
      if (folderPath) await openFolder(folderPath, false);
    });
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

    renderExplorer(folderData);
  } catch (e) {
    console.error('Failed to open folder:', e);
  }
}

async function init() {
  const recents = await window.electron.projectRecentsRead();
  renderLanding(recents);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
