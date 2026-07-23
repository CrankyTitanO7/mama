// ── Step: Security ────────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'security',
    title: 'Security',
    render: (settings) => {
      const U = window.__setupUtils;
      const sec = settings['security settings'] || {};
      const chk = (id, val) => `<input type="checkbox" id="${id}" ${val ? 'checked' : ''}>`;
      return `
        <h2>Security Preferences</h2>
        <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-project-mod', sec['project mod'])} Allow project file modifications without asking</label></div>
        <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-cloud-mod',   sec['cloud mod'])}   Allow cloud modifications without asking</label></div>
        <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-all-files',   sec['all files'])}   Allow all file modifications without asking</label></div>
        <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-sudo',         sec['sudo'])}        Allow sudo / system-level access</label></div>
        <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-browser-access', sec['browser access'])} Allow model / web access</label></div>
        <div class="setup-field">
          <label>Local Key File Path:</label>
          <input type="text" id="setup-key-path" class="setup-input"
            placeholder="default" value="${U.escapeHtml(sec['local key file path'] || 'default')}">
        </div>
      `;
    },
    collect: () => ({
      'project mod':         document.getElementById('setup-project-mod')?.checked    || false,
      'cloud mod':           document.getElementById('setup-cloud-mod')?.checked      || false,
      'all files':           document.getElementById('setup-all-files')?.checked      || false,
      sudo:                  document.getElementById('setup-sudo')?.checked           || false,
      'browser access':      document.getElementById('setup-browser-access')?.checked || false,
      'local key file path': document.getElementById('setup-key-path')?.value         || 'default',
    })
  });
})();