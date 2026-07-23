// ── Step: Resources ───────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'resources',
    title: 'Resources',
    render: (settings) => {
      const U = window.__setupUtils;
      const res = settings['resource settings'] || {};
      return `
        <h2>Resource Configuration</h2>
        <div class="setup-field">
          <label class="setup-checkbox-label">
            <input type="checkbox" id="setup-cloud" ${res['cloud resources'] ? 'checked' : ''}>
            Enable Cloud Resources
          </label>
        </div>
        <div class="setup-field">
          <label>Cloud Provider:</label>
          <input type="text" id="setup-cloud-provider" class="setup-input"
            placeholder="e.g. openai" value="${U.escapeHtml(res['cloud provider name'] || '')}">
        </div>
        <div class="setup-field">
          <label>Local Hostname:</label>
          <input type="text" id="setup-local-host" class="setup-input"
            placeholder="e.g. ollama" value="${U.escapeHtml(res['local hostname'] || '')}">
        </div>
        <div class="setup-field">
          <label>Trainer Browser:</label>
          <input type="text" id="setup-trainer-browser" class="setup-input"
            placeholder="default" value="${U.escapeHtml(res['trainer browser'] || 'default')}">
        </div>
      `;
    },
    collect: () => ({
      'cloud resources':     document.getElementById('setup-cloud')?.checked         || false,
      'cloud provider name': document.getElementById('setup-cloud-provider')?.value  || null,
      'local hostname':      document.getElementById('setup-local-host')?.value      || null,
      'trainer browser':     document.getElementById('setup-trainer-browser')?.value || 'default',
    })
  });
})();