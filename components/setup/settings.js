// Settings page — full settings editor
(function () {
  let settingsCache = null;
  let savedSnapshot = null;
  let navigationWired = false;

  async function loadSettings() {
    try {
      settingsCache = await window.electron.settingsRead();
      markClean();
      return settingsCache;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return null;
    }
  }

  function snapshotSettings() {
    return JSON.stringify(settingsCache);
  }

  function markClean() {
    savedSnapshot = snapshotSettings();
  }

  function isDirty() {
    if (!settingsCache || savedSnapshot === null) return false;
    return snapshotSettings() !== savedSnapshot;
  }

  async function saveSettings() {
    if (!settingsCache) return false;
    try {
      await window.electron.settingsWrite(settingsCache);
      markClean();
      showStatus('Settings saved!', 'success');
      return true;
    } catch (e) {
      showStatus('Failed to save settings.', 'error');
      console.error(e);
      return false;
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

  function showUnsavedDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'settings-unsaved-overlay';
      overlay.innerHTML = `
        <div class="settings-unsaved-dialog" role="dialog" aria-labelledby="unsaved-title">
          <h3 id="unsaved-title">Unsaved changes</h3>
          <p>You have unsaved changes. What would you like to do?</p>
          <div class="settings-unsaved-actions">
            <button type="button" id="unsaved-discard" class="settings-btn settings-btn-secondary">
              Close without saving
            </button>
            <button type="button" id="unsaved-save" class="settings-btn settings-btn-primary">
              Save and close
            </button>
            <button type="button" id="unsaved-cancel" class="settings-btn settings-btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('#unsaved-discard')?.addEventListener('click', () => close('discard'));
      overlay.querySelector('#unsaved-cancel')?.addEventListener('click', () => close('cancel'));
      overlay.querySelector('#unsaved-save')?.addEventListener('click', async () => {
        const ok = await saveSettings();
        if (ok) close('save');
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close('cancel');
      });
    });
  }

  async function navigateAway(page) {
    if (!isDirty()) {
      await window.electron.navigateTo(page);
      return;
    }

    const action = await showUnsavedDialog();
    if (action === 'discard') {
      await window.electron.navigateTo(page);
    } else if (action === 'save') {
      await window.electron.navigateTo(page);
    }
  }

  function wireNavigationGuards() {
    if (navigationWired) return;
    navigationWired = true;

    document.querySelectorAll('[data-settings-nav]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const page = btn.dataset.settingsNav;
        if (page) navigateAway(page);
      });
    });

    window.addEventListener('beforeunload', (e) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function renderTaskManagerField(fieldId, groupKey, key, value) {
    const current =
      value === true ? 'true' :
      value === false ? 'false' :
      'ask';

    return `
      <select id="${fieldId}" class="settings-input settings-select" data-group="${groupKey}" data-key="${key}">
        <option value="ask" ${current === 'ask' ? 'selected' : ''}>Ask</option>
        <option value="true" ${current === 'true' ? 'selected' : ''}>Enabled</option>
        <option value="false" ${current === 'false' ? 'selected' : ''}>Disabled</option>
      </select>
    `;
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

          if (groupKey === 'qol settings' && key === 'task manager') {
            html += renderTaskManagerField(fieldId, groupKey, key, value);
          } else if (typeof value === 'boolean') {
            html += `<input type="checkbox" id="${fieldId}" class="settings-checkbox" data-group="${groupKey}" data-key="${key}" ${value ? 'checked' : ''}>`;
          } else if (typeof value === 'number') {
            html += `<input type="number" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${value}" step="any">`;
          } else if (value === null) {
            html += `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" placeholder="null">`;
          } else {
            html += `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${String(value).replace(/"/g, '&quot;')}">`;
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

    container.querySelectorAll('[data-group][data-key]').forEach(el => {
      el.addEventListener('change', () => updateCacheFromField(el));
      el.addEventListener('input', () => updateCacheFromField(el));
    });

    document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);
    document.getElementById('settings-reload-btn')?.addEventListener('click', async () => {
      if (isDirty()) {
        const action = await showUnsavedDialog();
        if (action === 'cancel') return;
        if (action === 'save') await saveSettings();
      }
      await loadSettings();
      renderSettings();
    });
  }

  function updateCacheFromField(el) {
    const group = el.dataset.group;
    const key = el.dataset.key;
    if (!settingsCache[group]) return;

    if (el.tagName === 'SELECT') {
      if (el.value === 'true') settingsCache[group][key] = true;
      else if (el.value === 'false') settingsCache[group][key] = false;
      else settingsCache[group][key] = el.value;
      return;
    }

    if (el.type === 'checkbox') {
      settingsCache[group][key] = el.checked;
    } else if (el.type === 'number') {
      settingsCache[group][key] = parseFloat(el.value);
    } else {
      settingsCache[group][key] = el.value || null;
    }
  }

  async function init() {
    wireNavigationGuards();
    await loadSettings();
    renderSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
