/**
 * docs.js — Markdown document viewer.
 *
 * Reads docs/register.json  { "Display Name": "filename.md", … }
 * Renders selected doc as HTML in #doc-content using marked.js.
 *
 * Uses window.electron.readDocsFile(filename) via IPC instead of fetch()
 * so paths are always resolved from project root regardless of where the
 * HTML file lives. fetch() with a relative path in Electron resolves
 * relative to the HTML file's location, which breaks when docs/ is outside
 * the renderer directory.
 *
 * Add to ipc-handlers.js:
 *   const fs   = require('fs');
 *   const path = require('path');
 *
 *   ipcMain.handle('read-docs-file', async (_event, filename) => {
 *     // Sanitize: strip any path traversal, allow only filenames + .json/.md
 *     const safe = path.basename(filename);
 *     if (!/^[\w\-. ]+\.(md|json)$/i.test(safe)) {
 *       throw new Error(`Disallowed filename: ${safe}`);
 *     }
 *     const docsDir  = path.join(app.getAppPath(), 'docs');
 *     const fullPath = path.join(docsDir, safe);
 *     return fs.promises.readFile(fullPath, 'utf8');
 *   });
 *
 * Add to preload.js:
 *   readDocsFile: (filename) => ipcRenderer.invoke('read-docs-file', filename),
 */

document.addEventListener('DOMContentLoaded', async () => {
  const list    = document.getElementById('doc-list');
  const content = document.getElementById('doc-content');

  if (!list || !content) {
    console.error('docs.js: #doc-list or #doc-content not found in DOM');
    return;
  }

  if (typeof marked === 'undefined') {
    content.innerHTML = '<p class="doc-error">marked.js failed to load. Check your internet connection or bundle marked.js locally.</p>';
    console.error('docs.js: marked.js is not defined — add it to the HTML before docs.js');
    return;
  }

  // ── Read a file via IPC (path resolved from project root in main process) ─

  async function readDocsFile(filename) {
    if (typeof window.electron?.readDocsFile === 'function') {
      return window.electron.readDocsFile(filename);
    }
    // Dev fallback: fetch() works if the HTML is served from the right place
    console.warn('docs.js: window.electron.readDocsFile not available, falling back to fetch()');
    const res = await fetch(`../docs/${filename}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    return res.text();
  }

  // ── Render a markdown file into the content pane ──────────────────────────

  async function loadDoc(filename, key) {
    list.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    list.querySelector(`[data-doc-key="${CSS.escape(key)}"]`)?.classList.add('active');

    content.innerHTML = '<p class="doc-loading">Loading…</p>';

    try {
      const markdown = await readDocsFile(filename);
      content.innerHTML = marked.parse(markdown);
      content.scrollTop = 0;
    } catch (err) {
      content.innerHTML = `<p class="doc-error">Failed to load <code>${filename}</code>: ${err.message}</p>`;
      console.error('docs.js loadDoc:', err);
    }
  }

  // ── Load register and build nav list ──────────────────────────────────────

  try {
    const raw      = await readDocsFile('register.json');
    const register = JSON.parse(raw);
    const entries  = Object.entries(register);

    list.innerHTML = '';

    if (entries.length === 0) {
      list.innerHTML = '<li class="doc-empty">No documents registered.</li>';
      return;
    }

    for (const [key, filename] of entries) {
      const li  = document.createElement('li');
      li.dataset.docKey = key;

      const btn = document.createElement('button');
      btn.type        = 'button';
      btn.className   = 'doc-list-btn';
      btn.textContent = key;
      btn.addEventListener('click', () => loadDoc(filename, key));

      li.appendChild(btn);
      list.appendChild(li);
    }

    // Auto-load the first doc
    const [firstKey, firstFilename] = entries[0];
    loadDoc(firstFilename, firstKey);

  } catch (err) {
    list.innerHTML = `<li class="doc-error">Error loading register: ${err.message}</li>`;
    console.error('docs.js register:', err);
  }
});