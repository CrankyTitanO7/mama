// ── Step: Quality of Life ─────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'qol',
    title: 'Quality of Life',
    render: (settings) => {
      const U = window.__setupUtils;
      const qol = settings['qol settings'] || {};
      const res = qol['resources'];
      return `
        <h2>Quality of Life</h2>
        <div class="setup-field">
          <label class="setup-checkbox-label">
            <input type="checkbox" id="setup-reels" ${qol['reels enable'] ? 'checked' : ''}>
            Enable Reels (relax while code compiles)
          </label>
        </div>
        <div class="setup-field">
          <label>Reels Provider:</label>
          <input type="text" id="setup-reels-provider" class="setup-input"
            placeholder="e.g. youtube" value="${U.escapeHtml(qol['reels provider'] || '')}">
        </div>
        <div class="setup-field">
          <label class="setup-checkbox-label">
            <input type="checkbox" id="setup-site" ${(qol['site enable'] ?? qol['video enable']) ? 'checked' : ''}>
            Enable Site
          </label>
        </div>
        <div class="setup-field">
          <label>Site Provider:</label>
          <input type="text" id="setup-site-provider" class="setup-input"
            placeholder="e.g. youtube" value="${U.escapeHtml(qol['site provider'] || qol['video provider'] || '')}">
        </div>
        <div class="setup-field">
          <label class="setup-checkbox-label">
            <input type="checkbox" id="setup-db-explorer" ${qol['database explorer enable'] ? 'checked' : ''}>
            Enable Database Explorer
          </label>
        </div>
        <div class="setup-field">
          <label>Database Provider:</label>
          <input type="text" id="setup-db-provider" class="setup-input"
            placeholder="e.g. huggingface" value="${U.escapeHtml(qol['database provider'] || '')}">
        </div>
        <div class="setup-field">
          <label>Resource Monitor:</label>
          <select id="setup-resources" class="setup-select">
            <option value="ask"   ${res === 'ask'   || res == null           ? 'selected' : ''}>Ask each time</option>
            <option value="true"  ${res === true    || res === 'always'      ? 'selected' : ''}>Always enable</option>
            <option value="false" ${res === false   || res === 'never'       ? 'selected' : ''}>Always disable</option>
          </select>
        </div>
      `;
    },
    collect: () => {
      const resRaw = document.getElementById('setup-resources')?.value;
      return {
        'reels enable':             document.getElementById('setup-reels')?.checked        || false,
        'reels provider':           document.getElementById('setup-reels-provider')?.value || null,
        'site enable':              document.getElementById('setup-site')?.checked         || false,
        'site provider':            document.getElementById('setup-site-provider')?.value  || null,
        'database explorer enable': document.getElementById('setup-db-explorer')?.checked  || false,
        'database provider':        document.getElementById('setup-db-provider')?.value    || null,
        'resources': resRaw === 'true' ? true : resRaw === 'false' ? false : 'ask',
      };
    }
  });
})();