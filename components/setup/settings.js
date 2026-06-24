// Settings page — full settings editor
(function () {
  let settingsCache = null;
  let descriptionsCache = null;
  let savedSnapshot = null;
  let navigationWired = false;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFieldDescription(groupKey, key) {
    const group = descriptionsCache?.[groupKey];
    if (!group || typeof group !== 'object') return '';
    if (key === 'task manager' && group.resources) return group.resources;
    if (key === 'video enable' && group['site enable']) return group['site enable'];
    if (key === 'video provider' && group['site provider']) return group['site provider'];
    return group[key] || '';
  }

  async function loadDescriptions() {
    try {
      descriptionsCache = await window.electron.settingsDescriptionsRead();
    } catch (e) {
      console.error('Failed to load setting descriptions:', e);
      descriptionsCache = null;
    }
  }

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
    updateUnsavedState();
  }

  function isDirty() {
    if (!settingsCache || savedSnapshot === null) return false;
    return snapshotSettings() !== savedSnapshot;
  }

  function updateUnsavedState() {
    const dirty = isDirty();
    document.querySelectorAll('.settings-label').forEach((label) => {
      label.classList.toggle('is-unsaved', dirty);
    });
  }

  function migrateQolSettingKeys() {
    const qol = settingsCache?.['qol settings'];
    if (!qol) return;
    if ('site enable' in qol) {
      delete qol['video enable'];
      delete qol['video provider'];
    }
    if ('resources' in qol) delete qol['task manager'];
  }

  async function saveSettings() {
    if (!settingsCache) return false;
    migrateQolSettingKeys();
    try {
      await window.electron.settingsWrite(settingsCache);
      markClean();
      window.__themeApplyDeferred = false;
      if (window.ThemeManager) {
        const appearance = settingsCache?.['aesthetic settings']?.appearance;
        window.ThemeManager.applyTheme(appearance || 'system');
      }
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

      const dialog = overlay.querySelector('.settings-unsaved-dialog');
      dialog?.addEventListener('click', (e) => e.stopPropagation());

      overlay.querySelector('#unsaved-discard')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close('discard');
      });
      overlay.querySelector('#unsaved-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close('cancel');
      });
      overlay.querySelector('#unsaved-save')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await saveSettings();
        if (ok) close('save');
      });

      overlay.addEventListener('click', () => close('cancel'));
    });
  }

  async function revertToSaved() {
    try {
      settingsCache = await window.electron.settingsRead();
      window.__themeApplyDeferred = false;
      markClean();
    } catch (e) {
      console.error('Failed to reload settings from disk:', e);
    }
  }

  async function navigateAway(page) {
    if (!isDirty()) {
      await window.electron.navigateTo(page);
      return;
    }

    const action = await showUnsavedDialog();
    if (action === 'cancel' || !action) return;

    if (action === 'discard') {
      await revertToSaved();
      await window.electron.navigateTo(page);
      return;
    }

    if (action === 'save') {
      const saved = await saveSettings();
      if (saved) {
        await window.electron.navigateTo(page);
      }
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

    window.handleSettingsNavigation = async (page) => {
      if (!page) return;
      await navigateAway(page);
    };

    window.addEventListener('beforeunload', (e) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function renderResourcesField(fieldId, groupKey, key, value) {
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
          if (groupKey === 'qol settings') {
            if (key === 'task manager' && 'resources' in groupValue) continue;
            if (key === 'video enable' && 'site enable' in groupValue) continue;
            if (key === 'video provider' && 'site provider' in groupValue) continue;
          }

          const fieldId = `setting-${groupKey}-${key}`.replace(/\s+/g, '-').toLowerCase();
          const label = key.replace(/(^\w|\s\w)/g, m => m.toUpperCase());
          const desc = getFieldDescription(groupKey, key);

          let control = '';
          if (groupKey === 'aesthetic settings' && key === 'appearance') {
            const normalizedValue = String(value || 'system');
            let themeOptions = `
              <option value="system" ${normalizedValue === 'system' ? 'selected' : ''}>System</option>
              <option value="light" ${normalizedValue === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${normalizedValue === 'dark' ? 'selected' : ''}>Dark</option>
            `;
            // Append custom themes from ThemeManager
            const customThemes = window.ThemeManager?.getCustomThemeList?.() || [];
            for (const t of customThemes) {
              if (t.name === 'light' || t.name === 'dark' || t.name === 'system') continue;
              const sel = normalizedValue === t.name ? 'selected' : '';
              themeOptions += `<option value="${t.name}" ${sel}>${t.title}</option>`;
            }
            control = `
              <select id="${fieldId}" class="settings-input settings-select" data-group="${groupKey}" data-key="${key}">
                ${themeOptions}
              </select>
            `;
          } else if (groupKey === 'qol settings' && (key === 'resources' || key === 'task manager')) {
            control = renderResourcesField(fieldId, groupKey, 'resources', value);
          } else if (typeof value === 'boolean') {
            control = `<input type="checkbox" id="${fieldId}" class="settings-checkbox" data-group="${groupKey}" data-key="${key}" ${value ? 'checked' : ''}>`;
          } else if (typeof value === 'number') {
            control = `<input type="number" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${value}" step="any">`;
          } else if (value === null) {
            control = `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" placeholder="null">`;
          } else {
            control = `<input type="text" id="${fieldId}" class="settings-input" data-group="${groupKey}" data-key="${key}" value="${escapeHtml(value)}">`;
          }

          html += `<div class="settings-field">`;
          html += `<div class="settings-field-meta">`;
          html += `<label class="settings-label" for="${fieldId}">${escapeHtml(label)}</label>`;
          if (desc) {
            html += `<p class="settings-field-desc">${escapeHtml(desc)}</p>`;
          }
          html += `</div>`;
          html += `<div class="settings-field-control">${control}</div>`;
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
      el.addEventListener('change', () => {
        updateCacheFromField(el);
        updateUnsavedState();
      });
      el.addEventListener('input', () => {
        updateCacheFromField(el);
        updateUnsavedState();
      });
    });

    document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);
    document.getElementById('settings-reload-btn')?.addEventListener('click', async () => {
      if (isDirty()) {
        const action = await showUnsavedDialog();
        if (action === 'cancel' || !action) return;
        if (action === 'discard') await revertToSaved();
        else if (action === 'save') await saveSettings();
      }
      await Promise.all([loadSettings(), loadDescriptions()]);
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
    window.__themeApplyDeferred = true;
    wireNavigationGuards();
    await Promise.all([loadSettings(), loadDescriptions()]);
    renderSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
