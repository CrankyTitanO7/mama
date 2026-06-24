(function () {
  const STORAGE_KEY = 'mama-theme-preference';
  const root = document.documentElement;

  // Built-in fallback palettes
  const builtInPalettes = {
    light: {
      '--highlight-color': '#0077ff',
      '--main-color': '#f4f7fb',
      '--shadow-color': 'rgba(15, 52, 96, 0.16)',
      '--heading-color': '#0f172a',
      '--body-color': '#475569',
      '--page-bg': '#f4f7fb',
      '--page-text': '#0f172a',
      '--page-muted': '#475569',
      '--panel-bg': '#ffffff',
      '--panel-border': '#dbe4f0',
      '--widget-bg': '#ffffff',
      '--widget-border': '#dbe4f0',
      '--topbar-bg': '#ffffff',
      '--topbar-border': '#dbe4f0',
      '--topbar-text': '#0f172a',
      '--topbar-muted': '#64748b',
      '--topbar-active': '#0077ff',
      '--input-bg': '#ffffff',
      '--input-text': '#0f172a',
      '--input-border': '#dbe4f0',
      '--button-secondary-bg': '#e2e8f0',
      '--button-secondary-text': '#0f172a'
    },
    dark: {
      '--highlight-color': '#00d4ff',
      '--main-color': '#1a1a2e',
      '--shadow-color': 'rgba(0, 0, 0, 0.35)',
      '--heading-color': '#00d4ff',
      '--body-color': '#b0b0b0',
      '--page-bg': '#1a1a2e',
      '--page-text': '#e0e0e0',
      '--page-muted': '#b0b0b0',
      '--panel-bg': '#16213e',
      '--panel-border': '#0f3460',
      '--widget-bg': '#16213e',
      '--widget-border': '#0f3460',
      '--topbar-bg': '#16213e',
      '--topbar-border': '#0f3460',
      '--topbar-text': '#e0e0e0',
      '--topbar-muted': '#b0b0b0',
      '--topbar-active': '#00d4ff',
      '--input-bg': '#1a1a2e',
      '--input-text': '#e0e0e0',
      '--input-border': '#0f3460',
      '--button-secondary-bg': '#333333',
      '--button-secondary-text': '#e0e0e0'
    }
  };

  // Master palette: built-in + custom themes merged in at load time
  let palettes = { ...builtInPalettes };

  // Custom theme descriptors { name, title } for UI consumption
  let customThemeList = [];

  let activeTheme = 'system';

  function getSystemTheme() {
    if (typeof window.matchMedia !== 'function') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getResolvedTheme(themeName) {
    if (!themeName || themeName === 'system') return getSystemTheme();
    // If it's a known palette (built-in or custom), use it directly
    if (palettes[themeName]) return themeName;
    // Fall back to system
    return getSystemTheme();
  }

  function applyThemeToRoot(targetRoot, themeName) {
    const normalized = themeName || 'system';
    const resolved = getResolvedTheme(normalized);
    const palette = palettes[resolved] || palettes.dark;

    Object.entries(palette).forEach(([property, value]) => {
      targetRoot.style.setProperty(property, value);
    });

    targetRoot.style.setProperty('--theme-mode', resolved);
    targetRoot.style.colorScheme = resolved === 'dark' ? 'dark' : 'light';
    targetRoot.dataset.theme = resolved;

    return { normalized, resolved };
  }

  function applyThemeToWindow(targetWindow, themeName) {
    if (!targetWindow || !targetWindow.document) return null;
    return applyThemeToRoot(targetWindow.document.documentElement, themeName);
  }

  function applyTheme(themeName, broadcast = true) {
    const current = applyThemeToWindow(window, themeName);
    const normalized = current?.normalized || themeName || 'system';
    activeTheme = normalized;

    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch (error) {
      console.warn('Theme preference could not be saved.', error);
    }

    if (!broadcast) return;

    const message = { type: 'mama-theme-update', themeName: normalized };
    try {
      window.postMessage(message, '*');
    } catch (error) {
      console.warn('Theme notification could not be sent to self.', error);
    }

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
    } catch (error) {
      console.warn('Theme notification could not be sent to parent.', error);
    }

    try {
      Array.from(document.querySelectorAll('iframe')).forEach((iframe) => {
        if (iframe.contentWindow) {
          applyThemeToWindow(iframe.contentWindow, normalized);
          iframe.contentWindow.postMessage(message, '*');
        }
      });
    } catch (error) {
      console.warn('Theme notification could not be sent to iframes.', error);
    }
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'system';
    } catch (error) {
      return 'system';
    }
  }

  /**
   * Load custom theme JSON files from user/themes/ via IPC and merge them
   * into the palette lookup so they can be applied by name.
   */
  async function loadCustomThemes() {
    try {
      if (window.electron?.themesRead) {
        const themes = await window.electron.themesRead();
        if (Array.isArray(themes)) {
          customThemeList = [];
          for (const t of themes) {
            if (t.name && t.title && t.variables) {
              palettes[t.name] = { ...t.variables };
              customThemeList.push({ name: t.name, title: t.title });
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load custom themes:', error);
    }
  }

  function getCustomThemeList() {
    return customThemeList;
  }

  async function initializeTheme() {
    await loadCustomThemes();

    let themeName = getStoredTheme();
    applyTheme(themeName, false);

    if (window.__themeApplyDeferred !== true && window.electron?.settingsRead) {
      try {
        const settings = await window.electron.settingsRead();
        const appearance = settings?.['aesthetic settings']?.appearance;
        if (appearance) {
          applyTheme(appearance);
        }
      } catch (error) {
        console.warn('Failed to load theme from settings.', error);
      }
    }

    if (typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        if (activeTheme === 'system') {
          applyTheme('system');
        }
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
      }
    }
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'mama-theme-update') return;
    applyTheme(data.themeName);
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(event.newValue || 'system');
  });

  window.ThemeManager = {
    applyTheme,
    applyThemeToWindow,
    initializeTheme,
    getResolvedTheme,
    getCustomThemeList,
    getActiveTheme: () => activeTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTheme);
  } else {
    initializeTheme();
  }
})();