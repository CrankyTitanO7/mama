// Settings page — full settings editor
(function () {
  let settingsCache = null;

  async function loadSettings() {
    try {
      settingsCache = await window.electron.settingsRead();
      return settingsCache;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return null;
    }
  }

  async function saveSettings() {
    if (!settingsCache) return;
    try {
      await window.electron.settingsWrite(settingsCache);
      showStatus('Settings saved!', 'success');
    } catch (e) {
      showStatus('Failed to save settings.', 'error');
      console.error(e);
    }
  }

  function showStatus(message, type) {
    const el = document.getElementById('settings-status');
    if (el) {
      el.textContent = message;
      el.className = `settings-status ${type}`;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
  }

  function renderSettings() {
    const container = document.getElementById('settings-content');
    if (!container || !settingsCache) return;

    let html = '';

    for (const [groupKey, groupValue] of Object.entries(settingsCache)) {
      html += `<div class="settings-group">`;
      html += `<h2 class="settings-group-title">${groupKey.replace(/(^\w|\s\w)/g, m => m.toUpperCase())}</h2>`;

      if (typeof groupValue === 'object' && groupValue !== null) {
        for (const [key, value] of Object.entries(groupValue)) {
          const fieldId = `setting-${groupKey}-${key}`.replace(/\s+/g, '-').toLowerCase();
          html += `<div class="settings-field">`;
          html += `<label class="settings-label" for="${fieldId}">${key.replace(/(^\w|\s\w)/g, m => m.toUpperCase())}</label>`;

          if (typeof value === 'boolean') {
            html += `<input type="checkbox" id="${fieldId}" class="settings-checkbox" data-group="${groupKey}" data-key="${key}" ${value ? 'checked' : ''}>`;
          } else if (typeof value === 'number') {
            html += `<input type="number" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${value}" step="any">`;
          } else if (value === null) {
            html += `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" placeholder="null">`;
          } else {
            html += `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${String(value).replace(/"/g, '"')}">`;
          }

          html += `</div>`;
        }
      }

      html += `</div>`;
    }

    html += `<div class="settings-actions">
      <button id="settings-save-btn" class="settings-btn settings-btn-primary">💾 Save Settings</button>
      <button id="settings-reload-btn" class="settings-btn settings-btn-secondary">↻ Reload</button>
    </div>`;

    container.innerHTML = html;

    // Wire up change listeners to update cache in real-time
    container.querySelectorAll('[data-group][data-key]').forEach(el => {
      el.addEventListener('change', () => updateCacheFromField(el));
      el.addEventListener('input', () => updateCacheFromField(el));
    });

    document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);
    document.getElementById('settings-reload-btn')?.addEventListener('click', init);
  }

  function updateCacheFromField(el) {
    const group = el.dataset.group;
    const key = el.dataset.key;
    if (!settingsCache[group]) return;

    if (el.type === 'checkbox') {
      settingsCache[group][key] = el.checked;
    } else if (el.type === 'number') {
      settingsCache[group][key] = parseFloat(el.value);
    } else {
      settingsCache[group][key] = el.value || null;
    }
  }

  async function init() {
    await loadSettings();
    renderSettings();
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();