// ── Step: Appearance ──────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'appearance',
    title: 'Appearance',
    render: (settings) => {
      const accent       = settings['aesthetic settings']?.['accent color'] || 'default';
      const scaling      = settings['aesthetic settings']?.['scaling factor'] || 1;
      const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];
      return `
        <h2>Appearance</h2>
        <div class="setup-field">
          <label>Theme:</label>
          <select id="setup-appearance" class="setup-select">
            <option value="system" selected>System (loading…)</option>
          </select>
        </div>
        <div class="setup-field">
          <label>Scaling Factor:</label>
          <p>in development: for window managers</p>
          <input type="number" id="setup-scaling" class="setup-input"
            min="0.5" max="3" step="0.25" value="${scaling}">
        </div>
      `;
    },
    afterRender: async () => {
      const sel         = document.getElementById('setup-appearance');
      const current     = (window.__setupState?.settingsCache?.['aesthetic settings']?.appearance) || 'system';
      const baseOptions = [{ value: 'system', label: 'System' }];

      let customThemes = window.ThemeManager?.getCustomThemeList?.() || [];
      if (customThemes.length === 0 && window.electron?.themesRead) {
        try { customThemes = await window.electron.themesRead() || []; } catch (_) {}
      }

      const allOptions = customThemes.length > 0
        ? [...baseOptions, ...customThemes.map(t => ({ value: t.name, label: t.title }))]
        : [...baseOptions, { value: '__default__', label: 'Fallback' }];

      sel.innerHTML = allOptions
        .map(o => `<option value="${window.__setupUtils.escapeHtml(o.value)}" ${current === o.value ? 'selected' : ''}>${window.__setupUtils.escapeHtml(String(o.label))}</option>`)
        .join('');
    },
    collect: () => ({
      appearance:       document.getElementById('setup-appearance')?.value || 'system',
      'scaling factor': parseFloat(document.getElementById('setup-scaling')?.value) || 1,
    })
  });
})();