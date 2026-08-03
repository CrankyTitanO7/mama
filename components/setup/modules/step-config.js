// ── Step: Get Started (combined first screen) ────────────────────────────
// Replaces the separate difficulty, appearance and project-folder steps for
// the beginner-friendly flow. Picks look, scale, language and where the
// project (.venv) will live, in one place. Everything here is baked into
// settings.json so the user can edit it again later from the settings page.
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'config',
    title: 'Get Started',
    render: (settings) => {
      const U = window.__setupUtils;
      const accent = settings['aesthetic settings']?.['accent color'] || 'default';
      const scaling = settings['aesthetic settings']?.['scaling factor'] || 1;
      const lang = settings['general settings']?.language || 'eng';
      const langs = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'],
        ['deu', 'German'], ['jpn', 'Japanese'], ['zho', 'Chinese'],
      ];
      return `
        <h2>Let's Get You Set Up</h2>
        <p>Touch a few quick choices so mama can install the right stuff for you.
           Everything can be changed later in <strong>Settings</strong>.</p>

        <div class="setup-field">
          <div style="margin-bottom:8px; font-size:14px; color:var(--page-text);">How comfortable are you with AI tools?</div>
          <div class="difficulty-cards">
            <label class="difficulty-card">
              <input type="radio" name="difficulty" value="easy" checked>
              <div class="difficulty-card-content">
                <span class="difficulty-icon">🌱</span>
                <span class="difficulty-title">Easy — Beginner Friendly</span>
                <span class="difficulty-desc">Simple walkthrough. While mama installs, we show you
                  friendly pages that explain AI, machine learning and Python.</span>
              </div>
            </label>
            <label class="difficulty-card">
              <input type="radio" name="difficulty" value="medium">
              <div class="difficulty-card-content">
                <span class="difficulty-icon">⚡</span>
                <span class="difficulty-title">Medium — Some Context</span>
                <span class="difficulty-desc">Shorter explanations focused on what mama is and
                  how it uses Python to run AI.</span>
              </div>
            </label>
            <label class="difficulty-card">
              <input type="radio" name="difficulty" value="hard">
              <div class="difficulty-card-content">
                <span class="difficulty-icon">🚀</span>
                <span class="difficulty-title">Hard — Just the Steps</span>
                <span class="difficulty-desc">No fluff. You'll watch the raw install output directly
                  on the loading screen.</span>
              </div>
            </label>
          </div>
        </div>

        <div class="setup-config-grid">
          <div class="setup-field">
            <label>Appearance</label>
            <select id="config-appearance" class="setup-select">
              <option value="system" selected>System (loading…)</option>
            </select>
          </div>
          <div class="setup-field">
            <label>Scaling Factor</label>
            <input type="number" id="config-scaling" class="setup-input"
                   min="0.5" max="3" step="0.25" value="${scaling}">
            <p class="setup-hint">UI zoom. Useful on very large or high-DPI displays.</p>
          </div>
        </div>

        <div class="setup-field">
          <label>Language</label>
          <select id="config-language" class="setup-select">
            ${langs.map(([v, l]) => `<option value="${v}" ${lang === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <p class="setup-hint">Currently only English is fully supported.</p>
        </div>

        <div class="setup-field">
          <label>Project Folder</label>
          <p class="setup-hint">Where your models and project files will live. mama creates a
            <strong>.venv</strong> (Python virtual environment) inside it and installs the
            matching PyTorch build there.</p>
          <div id="config-folder" class="setup-detect-output">
            <p class="setup-hint">No folder selected yet.</p>
          </div>
          <div style="margin-top:10px">
            <button id="config-folder-pick-btn" class="setup-btn setup-btn-primary">📂 Choose Project Folder</button>
          </div>
        </div>
      `;
    },
    afterRender: async () => {
      const S = window.__setupState;

      // ── Difficulty (stored in state only — not persisted) ─────────────
      const readDifficulty = () => {
        const sel = document.querySelector('input[name="difficulty"]:checked');
        if (sel) S.difficulty = sel.value;
      };
      readDifficulty();
      document.querySelectorAll('input[name="difficulty"]').forEach(el => {
        el.addEventListener('change', (e) => { if (e.target.checked) S.difficulty = e.target.value; });
      });

      // ── Appearance (theme) ────────────────────────────────────────────
      const sel = document.getElementById('config-appearance');
      const baseOptions = [{ value: 'system', label: 'System' }];
      let customThemes = window.ThemeManager?.getCustomThemeList?.() || [];
      if (customThemes.length === 0 && window.electron?.themesRead) {
        try { customThemes = await window.electron.themesRead() || []; } catch (_) {}
      }
      const allOptions = customThemes.length > 0
        ? [...baseOptions, ...customThemes.map(t => ({ value: t.name, label: t.title }))]
        : [...baseOptions, { value: '__default__', label: 'Fallback' }];
      const current = S.selectedAppearance || S.settingsCache?.['aesthetic settings']?.appearance || 'system';
      sel.innerHTML = allOptions
        .map(o => `<option value="${window.__setupUtils.escapeHtml(o.value)}" ${current === o.value ? 'selected' : ''}>${window.__setupUtils.escapeHtml(String(o.label))}</option>`)
        .join('');
      S.selectedAppearance = sel.value;
      sel.addEventListener('change', () => { S.selectedAppearance = sel.value; });

      // ── Scaling ───────────────────────────────────────────────────────
      const scalingEl = document.getElementById('config-scaling');
      S.selectedScaling = parseFloat(scalingEl?.value) || 1;
      scalingEl?.addEventListener('input', () => { S.selectedScaling = parseFloat(scalingEl.value) || 1; });

      // ── Language ──────────────────────────────────────────────────────
      const langEl = document.getElementById('config-language');
      S.selectedLanguage = langEl?.value || 'eng';
      langEl?.addEventListener('change', () => { S.selectedLanguage = langEl.value; });

      // ── Project folder ────────────────────────────────────────────────
      const folderBox = document.getElementById('config-folder');
      const showFolder = (path) => {
        if (!folderBox) return;
        folderBox.innerHTML = path
          ? `<div class="setup-success-msg">📂 <strong>${window.__setupUtils.escapeHtml(path)}</strong></div>`
          : '<p class="setup-hint">No folder selected yet.</p>';
      };

      // Pre-fill from recents if the user already has an open project.
      try {
        const recents = await window.electron.projectRecentsRead();
        if (recents?.open) { S.selectedProjectFolder = recents.open; showFolder(recents.open); }
      } catch (_) {}

      document.getElementById('config-folder-pick-btn')?.addEventListener('click', async () => {
        try {
          const folderPath = await window.electron.projectPickFolder();
          if (!folderPath) return;
          S.selectedProjectFolder = folderPath;
          showFolder(folderPath);
          try { await window.electron.projectOpenFolder(folderPath); } catch (_) {}
        } catch (e) { console.error('Failed to pick project folder:', e); }
      });
    },
    collect: () => {
      const S = window.__setupState;
      return {
        difficulty: S.difficulty,
        appearance:       S.selectedAppearance || document.getElementById('config-appearance')?.value || 'system',
        'scaling factor': S.selectedScaling || parseFloat(document.getElementById('config-scaling')?.value) || 1,
        language:         S.selectedLanguage || document.getElementById('config-language')?.value || 'eng',
        'project folder': S.selectedProjectFolder || null,
      };
    }
  });
})();