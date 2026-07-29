// Settings page — full settings editor
(function () {
  let settingsCache = null;
  let descriptionsCache = null;
  let savedSnapshot = null;
  let navigationWired = false;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  function getFieldDescription(groupKey, key) {
    const group = descriptionsCache?.[groupKey];
    if (!group || typeof group !== 'object') return '';
    if (key === 'task manager' && group.resources) return group.resources;
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

  function showResetConfirmDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'settings-unsaved-overlay';
      overlay.innerHTML = `
        <div class="settings-unsaved-dialog" role="dialog" aria-labelledby="reset-title">
          <h3 id="reset-title">Reset settings?</h3>
          <p>Your current settings will be saved to <strong>user/settings.json.bak</strong>, then replaced with the defaults from <strong>user/template</strong>.</p>
          <div class="settings-unsaved-actions">
            <button type="button" id="reset-confirm" class="settings-btn settings-btn-primary">
              Reset settings
            </button>
            <button type="button" id="reset-cancel" class="settings-btn settings-btn-secondary">
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

      overlay.querySelector('#reset-confirm')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(true);
      });
      overlay.querySelector('#reset-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(false);
      });
      overlay.addEventListener('click', () => close(false));
    });
  }

  async function resetSettings() {
    const confirmed = await showResetConfirmDialog();
    if (!confirmed) return;

    try {
      const settings = await window.electron.settingsReset();
      if (!settings) {
        showStatus('Failed to reset settings.', 'error');
        return;
      }

      settingsCache = settings;
      markClean();
      window.__themeApplyDeferred = false;
      if (window.ThemeManager) {
        const appearance = settings?.['aesthetic settings']?.appearance;
        window.ThemeManager.applyTheme(appearance || 'system');
      }
      await loadDescriptions();
      await renderSettings();
      showStatus('Settings reset. Previous settings saved to user/settings.json.bak.', 'success');
    } catch (e) {
      showStatus('Failed to reset settings.', 'error');
      console.error(e);
    }
  }

  async function restoreSettingsFromBackup() {
    let hasBackup = false;
    try {
      hasBackup = await window.electron.settingsBackupExists();
    } catch (e) {
      console.error(e);
    }

    if (!hasBackup) {
      showStatus('No settings backup found (user/settings.json.bak).', 'error');
      return;
    }

    try {
      const settings = await window.electron.settingsRestoreBackup();
      if (!settings) {
        showStatus('Failed to restore settings from backup.', 'error');
        return;
      }

      settingsCache = settings;
      markClean();
      window.__themeApplyDeferred = false;
      if (window.ThemeManager) {
        const appearance = settings?.['aesthetic settings']?.appearance;
        window.ThemeManager.applyTheme(appearance || 'system');
      }
      await loadDescriptions();
      await renderSettings();
      showStatus('Settings restored from user/settings.json.bak.', 'success');
    } catch (e) {
      showStatus('Failed to restore settings from backup.', 'error');
      console.error(e);
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

    // Use event delegation so dynamically added [data-settings-nav] elements work
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-settings-nav]');
      if (!btn) return;
      e.preventDefault();
      const page = btn.dataset.settingsNav;
      if (page) navigateAway(page);
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

    // Register quit handler: when main process asks about unsaved changes,
    // show the unsaved dialog and return the user's choice.
    if (window.electron && window.electron.onBeforeQuit) {
      window.electron.onBeforeQuit(async () => {
        if (!isDirty()) return 'proceed';

        const action = await showUnsavedDialog();
        if (action === 'cancel') return 'cancel';

        if (action === 'discard') {
          await revertToSaved();
          return 'proceed';
        }

        if (action === 'save') {
          const saved = await saveSettings();
          return saved ? 'proceed' : 'cancel';
        }

        return 'proceed';
      });
    }
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

  // ── Custom Theme Editor ─────────────────────────────────────────────────────

  // The canonical list of CSS variable keys for a theme, with friendly labels
  const THEME_VARIABLE_DEFS = [
    { key: '--highlight-color',       label: 'Highlight' },
    { key: '--main-color',            label: 'Main Background' },
    { key: '--shadow-color',          label: 'Shadow' },
    { key: '--heading-color',         label: 'Heading' },
    { key: '--body-color',            label: 'Body Text' },
    { key: '--page-bg',               label: 'Page Background' },
    { key: '--page-text',             label: 'Page Text' },
    { key: '--page-muted',            label: 'Page Muted' },
    { key: '--panel-bg',              label: 'Panel Background' },
    { key: '--panel-border',          label: 'Panel Border' },
    { key: '--widget-bg',             label: 'Widget Background' },
    { key: '--widget-border',         label: 'Widget Border' },
    { key: '--topbar-bg',             label: 'Topbar Background' },
    { key: '--topbar-border',         label: 'Topbar Border' },
    { key: '--topbar-text',           label: 'Topbar Text' },
    { key: '--topbar-muted',          label: 'Topbar Muted' },
    { key: '--topbar-active',         label: 'Topbar Active' },
    { key: '--input-bg',              label: 'Input Background' },
    { key: '--input-text',            label: 'Input Text' },
    { key: '--input-border',          label: 'Input Border' },
    { key: '--button-secondary-bg',   label: 'Button Secondary Background' },
    { key: '--button-secondary-text', label: 'Button Secondary Text' },
  ];

  // Snapshot taken when the custom theme popup opens, for dirty-checking
  let _customThemeEditorSnapshot = null;

  function getDefaultThemeColors() {
    // Read current CSS custom property values from the document
    const style = getComputedStyle(document.documentElement);
    const colors = {};
    for (const def of THEME_VARIABLE_DEFS) {
      colors[def.key] = style.getPropertyValue(def.key).trim() || '#000000';
    }
    return colors;
  }

  async function openCustomThemeEditor() {
    const colors = getDefaultThemeColors();

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-theme-overlay';
      overlay.innerHTML = `
        <div class="custom-theme-dialog" role="dialog" aria-labelledby="custom-theme-title">
          <h3 id="custom-theme-title">🎨 Custom Theme</h3>
          <p class="custom-theme-desc">Adjust the colors below and click Save to create your theme.</p>
          <div class="custom-theme-fields">
            ${THEME_VARIABLE_DEFS.map((def, idx) => {
              const val = colors[def.key] || '#000000';
              return `
                <div class="custom-theme-field" data-var-key="${def.key}">
                  <label class="custom-theme-label" for="ct-${idx}">${escapeHtml(def.label)}</label>
                  <div class="custom-theme-picker-row">
                    <input type="color" id="ct-${idx}" class="custom-theme-color" value="${val}">
                    <input type="text" class="custom-theme-hex" value="${val}" maxlength="7" spellcheck="false">
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="custom-theme-actions">
            <button type="button" class="custom-theme-btn custom-theme-btn-secondary" data-action="cancel">Cancel</button>
            <button type="button" class="custom-theme-btn custom-theme-btn-primary" data-action="save">Save Theme</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Wire up color <-> hex sync
      overlay.querySelectorAll('.custom-theme-field').forEach((field) => {
        const colorInput = field.querySelector('.custom-theme-color');
        const hexInput = field.querySelector('.custom-theme-hex');

        colorInput.addEventListener('input', () => {
          hexInput.value = colorInput.value;
        });

        hexInput.addEventListener('input', () => {
          let val = hexInput.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            colorInput.value = val;
          }
        });

        hexInput.addEventListener('blur', () => {
          let val = hexInput.value.trim();
          if (!/^#[0-9a-fA-F]{6}$/.test(val)) {
            // Reset to the color input's value on invalid input
            hexInput.value = colorInput.value;
          }
        });
      });

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      const dialog = overlay.querySelector('.custom-theme-dialog');
      dialog?.addEventListener('click', (e) => e.stopPropagation());

      // Cancel / close overlay
      overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(null);
      });

      overlay.addEventListener('click', () => close(null));

      // Save
      overlay.querySelector('[data-action="save"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Collect colors
        const variables = {};
        overlay.querySelectorAll('.custom-theme-field').forEach((field) => {
          const key = field.dataset.varKey;
          const hexInput = field.querySelector('.custom-theme-hex');
          variables[key] = hexInput.value;
        });

        // Prompt for name
        const name = await showThemeNamePrompt();
        if (!name) return; // user cancelled naming

        const theme = {
          name: name.toLowerCase().replace(/\s+/g, '-'),
          title: name,
          variables
        };

        // Write via IPC
        const success = await window.electron.themesWrite(theme);
        if (!success) {
          showStatus('Failed to save custom theme.', 'error');
          return;
        }

        showStatus(`Theme "${escapeHtml(name)}" saved!`, 'success');

        // Reload themes in ThemeManager and re-apply
        if (window.ThemeManager && window.ThemeManager.applyTheme) {
          try {
            // Reload the theme list in the ThemeManager
            if (window.ThemeManager.initializeTheme) {
              await window.ThemeManager.initializeTheme();
            }
            // Apply the new theme
            window.ThemeManager.applyTheme(theme.name);
            // Also update the settings cache to reflect the new selection
            if (settingsCache?.['aesthetic settings']) {
              settingsCache['aesthetic settings'].appearance = theme.name;
            }
          } catch (e) {
            console.warn('Theme re-apply after save failed', e);
          }
        }

        // Re-render settings so the dropdown picks up the new theme
        await renderSettings();
        close(theme);
      });
    });
  }

  async function showThemeNamePrompt() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-theme-overlay';
      overlay.innerHTML = `
        <div class="custom-theme-name-dialog" role="dialog" aria-labelledby="theme-name-title">
          <h3 id="theme-name-title">Name Your Theme</h3>
          <p class="custom-theme-desc">Give your custom theme a name.</p>
          <div class="custom-theme-name-row">
            <input type="text" id="theme-name-input" class="settings-input" placeholder="My Theme" maxlength="64" autofocus>
          </div>
          <div class="custom-theme-actions">
            <button type="button" class="custom-theme-btn custom-theme-btn-secondary" data-action="cancel">Cancel</button>
            <button type="button" class="custom-theme-btn custom-theme-btn-primary" data-action="confirm">Save</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      const input = overlay.querySelector('#theme-name-input');
      const dialog = overlay.querySelector('.custom-theme-name-dialog');
      dialog?.addEventListener('click', (e) => e.stopPropagation());

      setTimeout(() => input?.focus(), 50);

      overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(null);
      });

      overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = input.value.trim();
        if (!name) {
          input.focus();
          input.style.borderColor = '#f44336';
          return;
        }
        close(name);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          overlay.querySelector('[data-action="confirm"]')?.click();
        }
        if (e.key === 'Escape') {
          close(null);
        }
      });

      overlay.addEventListener('click', () => close(null));
    });
  }

  async function buildAppearanceOptions(normalizedValue) {
    // Start with system — always present
    let options =
      `<option value="system" ${normalizedValue === 'system' ? 'selected' : ''}>System</option>`;

    // Load custom themes from disk via IPC
    try {
      const customThemes = await window.electron.themesRead();
      if (Array.isArray(customThemes) && customThemes.length > 0) {
        const seenNames = new Set();
        const titleCount = {};
        for (const t of customThemes) {
          // Skip if duplicate name (same value would conflict)
          if (seenNames.has(t.name)) continue;
          seenNames.add(t.name);

          // Deduplicate display title
          let displayTitle = t.title;
          if (titleCount[t.title] !== undefined) {
            titleCount[t.title]++;
            displayTitle = `${t.title} (${titleCount[t.title]})`;
          } else {
            titleCount[t.title] = 0;
          }

          const sel = normalizedValue === t.name ? 'selected' : '';
          options += `<option value="${t.name}" ${sel}>${escapeHtml(displayTitle)}</option>`;
        }
      } else {
        // No custom themes — show the hidden fallback option
        const sel = normalizedValue === '__default__' ? 'selected' : '';
        options += `<option value="__default__" ${sel}>Fallback</option>`;
      }
    } catch (_) {
      // IPC not available
      const sel = normalizedValue === '__default__' ? 'selected' : '';
      options += `<option value="__default__" ${sel}>Fallback</option>`;
    }

    // Always add the custom theme option
    options += `<option value="__custom__" data-custom-theme="true">🎨 Custom theme...</option>`;

    return options;
  }

  async function renderSettings() {
    const container = document.getElementById('settings-content');
    if (!container || !settingsCache) return;

    let html = '';

    // Setup Wizard link at the top of settings content
    html += `<div class="settings-setup-bar">
      <button type="button" class="nav-btn" data-settings-nav="public/setup.html">🔧 Setup Wizard</button>
      <span class="settings-setup-bar-text">Configure initial installation and framework detection</span>
    </div>`;

    for (const [groupKey, groupValue] of Object.entries(settingsCache)) {
      html += `<div class="settings-group">`;
      html += `<h2 class="settings-group-title">${groupKey.replace(/(^\w|\s\w)/g, m => m.toUpperCase())}</h2>`;

      if (typeof groupValue === 'object' && groupValue !== null) {
        for (const [key, value] of Object.entries(groupValue)) {
          if (groupKey === 'qol settings') {
            if (key === 'task manager' && 'resources' in groupValue) continue;
          }

          const fieldId = `setting-${groupKey}-${key}`.replace(/\s+/g, '-').toLowerCase();
          const label = key.replace(/(^\w|\s\w)/g, m => m.toUpperCase());
          const desc = getFieldDescription(groupKey, key);

          let control = '';
          if (groupKey === 'aesthetic settings' && key === 'appearance') {
            const normalizedValue = String(value || 'system');
            const themeOptions = await buildAppearanceOptions(normalizedValue);
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
      <button id="settings-restore-btn" class="settings-btn settings-btn-secondary">⏪ Restore from Backup</button>
      <button id="settings-reset-btn" class="settings-btn settings-btn-secondary">↺ Reset Settings</button>
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

    // Special handling for the appearance select: intercept "custom theme" selection
    const appearanceSelect = container.querySelector('[data-group="aesthetic settings"][data-key="appearance"]');
    if (appearanceSelect) {
      appearanceSelect.addEventListener('change', async function () {
        if (this.value === '__custom__') {
          // Reset the dropdown to the previous value while the editor is open
          const prevValue = settingsCache?.['aesthetic settings']?.appearance || 'system';
          this.value = prevValue;

          // Open the custom theme editor
          const result = await openCustomThemeEditor();
          if (result) {
            // A theme was saved — update the dropdown to select it
            appearanceSelect.value = result.name;
            settingsCache['aesthetic settings'].appearance = result.name;
            updateUnsavedState();
          }
          // If cancelled, the dropdown stays at the previous value
        } else {
          updateCacheFromField(this);
          updateUnsavedState();
        }
      });
    }

    document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);
    document.getElementById('settings-restore-btn')?.addEventListener('click', restoreSettingsFromBackup);
    document.getElementById('settings-reset-btn')?.addEventListener('click', resetSettings);
    document.getElementById('settings-reload-btn')?.addEventListener('click', async () => {
      if (isDirty()) {
        const action = await showUnsavedDialog();
        if (action === 'cancel' || !action) return;
        if (action === 'discard') await revertToSaved();
        else if (action === 'save') await saveSettings();
      }
      await Promise.all([loadSettings(), loadDescriptions()]);
      await renderSettings();
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
    // Wait for pywebview bridge — DOMContentLoaded fires before the API is ready
    await new Promise(function (resolve) {
      if (window.pywebview && window.pywebview.api) { resolve(); return; }
      window.addEventListener('pywebviewready', function onReady() {
        window.removeEventListener('pywebviewready', onReady);
        setTimeout(resolve, 0);
      });
    });
    await Promise.all([loadSettings(), loadDescriptions()]);
    await renderSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();