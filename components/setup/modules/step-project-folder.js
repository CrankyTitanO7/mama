// ── Step: Project Folder ──────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'project-folder',
    title: 'Project Folder',
    render: () => `
      <h2>Project Folder</h2>
      <p>Select a project folder where your files and models will be stored.</p>
      <p>you can skip this step if you plan to install your python libraries globally</p>
      <div id="project-folder-current" class="setup-detect-output">
        <p class="setup-hint">No folder selected yet.</p>
      </div>
      <div style="margin:12px 0">
        <button id="project-folder-pick-btn" class="setup-btn setup-btn-primary">📂 Select Project Folder</button>
      </div>
      <div id="project-folder-status" style="display:none" class="setup-detect-output"></div>
      <div id="project-folder-init" style="display:none; margin-top:12px">
        <div id="project-folder-init-results" style="margin-bottom:8px"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button id="project-folder-json-btn" class="setup-btn setup-btn-primary" style="display:none">Create project.json</button>
          <button id="project-folder-venv-btn" class="setup-btn setup-btn-primary" style="display:none">Create .venv</button>
          <button id="project-folder-both-btn" class="setup-btn setup-btn-success" style="display:none">Create both</button>
        </div>
      </div>
    `,
    afterRender: async () => {
      const S = window.__setupState;
      const U = window.__setupUtils;
      let selectedFolder = null;

      // Try to load current folder from recents
      try {
        const recents = await window.electron.projectRecentsRead();
        if (recents?.open) {
          selectedFolder = recents.open;
          const current = document.getElementById('project-folder-current');
          if (current) current.innerHTML = `<div class="setup-success-msg">📂 Current: <strong>${U.escapeHtml(selectedFolder)}</strong></div>`;
        }
      } catch (_) {}

      function appendResult(msg, isError) {
        const div = document.getElementById('project-folder-init-results');
        if (!div) return;
        const el = document.createElement('div');
        el.style.cssText = `padding:4px 0; font-size:13px; color:${isError ? 'var(--error-color, #f38ba8)' : 'var(--success-color, #a6e3a1)'}`;
        el.textContent = msg;
        div.appendChild(el);
      }

      function disableInitButtons() {
        ['project-folder-json-btn', 'project-folder-venv-btn', 'project-folder-both-btn'].forEach(id => {
          const btn = document.getElementById(id);
          if (btn) btn.disabled = true;
        });
      }

      async function refreshInitButtons() {
        if (!selectedFolder) return;
        const status = await window.electron.projectInit(selectedFolder);
        const jsonBtn = document.getElementById('project-folder-json-btn');
        const venvBtn = document.getElementById('project-folder-venv-btn');
        const bothBtn = document.getElementById('project-folder-both-btn');
        if (jsonBtn) jsonBtn.style.display = status.hasProjectJson ? 'none' : 'inline-block';
        if (venvBtn) venvBtn.style.display = status.hasVenv ? 'none' : 'inline-block';
        if (bothBtn) bothBtn.style.display = (!status.hasProjectJson && !status.hasVenv) ? 'inline-block' : 'none';
      }

      document.getElementById('project-folder-pick-btn')?.addEventListener('click', async () => {
        try {
          const folderPath = await window.electron.projectPickFolder();
          if (!folderPath) return;
          selectedFolder = folderPath;

          // Persist to recents.json so later steps can find the project folder
          try {
            await window.electron.projectOpenFolder(folderPath);
          } catch (_) {}

          const current = document.getElementById('project-folder-current');
          if (current) current.innerHTML = `<div class="setup-success-msg">📂 Selected: <strong>${U.escapeHtml(folderPath)}</strong></div>`;

          // Clear previous results
          const resultsDiv = document.getElementById('project-folder-init-results');
          if (resultsDiv) resultsDiv.innerHTML = '';

          // Check init status
          const status = await window.electron.projectInit(folderPath);
          const statusDiv = document.getElementById('project-folder-status');
          const initDiv = document.getElementById('project-folder-init');
          if (statusDiv && initDiv) {
            const missing = [];
            if (!status.hasProjectJson) missing.push('project.json');
            if (!status.hasVenv) missing.push('.venv');

            if (missing.length > 0) {
              statusDiv.style.display = 'block';
              statusDiv.innerHTML = `<p>Missing: ${missing.map(m => `<strong>${U.escapeHtml(m)}</strong>`).join(', ')}</p>`;
              initDiv.style.display = 'block';
              await refreshInitButtons();
            } else {
              statusDiv.style.display = 'block';
              statusDiv.innerHTML = '<div class="setup-success-msg">✅ All project files exist!</div>';
              initDiv.style.display = 'none';
            }
          }
        } catch (e) {
          console.error('Failed to pick project folder:', e);
        }
      });

      document.getElementById('project-folder-json-btn')?.addEventListener('click', async () => {
        if (!selectedFolder) return;
        disableInitButtons();
        const res = await window.electron.projectCreateJson(selectedFolder);
        appendResult(`project.json: ${res.success ? '✅' : '❌ ' + (res.error || '')}`, !res.success);
        await refreshInitButtons();
      });

      document.getElementById('project-folder-venv-btn')?.addEventListener('click', async () => {
        if (!selectedFolder) return;
        disableInitButtons();
        const res = await window.electron.projectCreateVenv(selectedFolder);
        appendResult(`.venv: ${res.success ? '✅' : '❌ ' + (res.error || '')}`, !res.success);
        await refreshInitButtons();
      });

      document.getElementById('project-folder-both-btn')?.addEventListener('click', async () => {
        if (!selectedFolder) return;
        disableInitButtons();
        const jsonRes = await window.electron.projectCreateJson(selectedFolder);
        appendResult(`project.json: ${jsonRes.success ? '✅' : '❌ ' + (jsonRes.error || '')}`, !jsonRes.success);
        const venvRes = await window.electron.projectCreateVenv(selectedFolder);
        appendResult(`.venv: ${venvRes.success ? '✅' : '❌ ' + (venvRes.error || '')}`, !venvRes.success);
        await refreshInitButtons();
      });
    },
    collect: () => {
      const currentEl = document.getElementById('project-folder-current');
      const text = currentEl?.textContent || '';
      const match = text.match(/(?:Selected|Current):\s*(.+)/);
      return match ? match[1].trim() : null;
    }
  });
})();