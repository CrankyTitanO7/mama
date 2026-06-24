(function () {
  const STORAGE_KEY = 'mama-theme-preference';
  const root = document.documentElement;

  // Hidden fallback palette — only used when user/themes/ is empty
  const fallbackPalette = {
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
  };

  // Master palette: populated from user/themes/ files only
  let palettes = {};

  // Custom theme descriptors { name, title } for UI consumption
  let customThemeList = [];

  // Whether the fallback (default) palette is active
  let usingFallback = false;

  let activeTheme = 'system';

  function getSystemTheme() {
    if (typeof window.matchMedia !== 'function') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getResolvedTheme(themeName) {
    if (!themeName || themeName === 'system') {
      const sys = getSystemTheme();
      // If custom palettes are loaded and have this name, use it
      if (palettes[sys]) return sys;
      // Otherwise fall back to the default hidden palette
      return '__default__';
    }
    // If it's a known custom palette, use it directly
    if (palettes[themeName]) return themeName;
    // Unknown theme — use hidden default
    return '__default__';
  }

  function getPalette(resolved) {
    if (resolved === '__default__') return fallbackPalette;
    return palettes[resolved] || fallbackPalette;
  }

  // Prevent flash by suppressing CSS transitions briefly during theme switches
  function applyThemeToRoot(targetRoot, themeName) {
    // Disable transitions temporarily to avoid flash
    targetRoot.style.transition = 'none';
    // Force a synchronous reflow so the 'none' takes effect before we change the CSS vars
    targetRoot.getBoundingClientRect();

    const normalized = themeName || 'system';
    const resolved = getResolvedTheme(normalized);
    const palette = getPalette(resolved);

    Object.entries(palette).forEach(([property, value]) => {
      targetRoot.style.setProperty(property, value);
    });

    targetRoot.style.setProperty('--theme-mode', resolved === '__default__' ? 'dark' : resolved);
    targetRoot.style.colorScheme = resolved === '__default__' ? 'dark' : (resolved === 'dark' ? 'dark' : 'light');
    targetRoot.dataset.theme = resolved === '__default__' ? 'dark' : resolved;

    // Re-enable transitions on next frame so subsequent changes animate normally
    requestAnimationFrame(() => {
      targetRoot.style.transition = '';
    });

    return { normalized, resolved };
  }

  function applyThemeToWindow(targetWindow, themeName) {
    if (!targetWindow || !targetWindow.document) return null;
    return applyThemeToRoot(targetWindow.document.documentElement, themeName);
  }

  // Guard to prevent redundant applies within the same tick
  let _applyGuard = false;

  function applyTheme(themeName, broadcast = true) {
    // Skip redundant calls that arrive in the same synchronous batch
    if (_applyGuard) return;
    _applyGuard = true;
    setTimeout(() => { _applyGuard = false; }, 0);

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
   * Load custom theme JSON files from user/themes/ via IPC.
   * If no themes are found, the hidden fallback (default) palette is used.
   */
  async function loadCustomThemes() {
    try {
      if (window.electron?.themesRead) {
        const themes = await window.electron.themesRead();
        if (Array.isArray(themes) && themes.length > 0) {
          customThemeList = [];
          palettes = {};
          for (const t of themes) {
            if (t.name && t.title && t.variables) {
              palettes[t.name] = { ...t.variables };
              customThemeList.push({ name: t.name, title: t.title });
            }
          }
          usingFallback = false;
        } else {
          // No custom themes — use the hidden default fallback
          customThemeList = [];
          palettes = {};
          usingFallback = true;
        }
      }
    } catch (error) {
      console.warn('Failed to load custom themes:', error);
      customThemeList = [];
      palettes = {};
      usingFallback = true;
    }
  }

  function getCustomThemeList() {
    return customThemeList;
  }

  function isUsingFallback() {
    return usingFallback;
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
    isUsingFallback,
    getActiveTheme: () => activeTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTheme);
  } else {
    initializeTheme();
  }
})();