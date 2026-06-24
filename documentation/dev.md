# developer's guide

the complete comprehensive guide on every working part of this application, including intended usage and etc.

## theme system

### architecture

themes are stored as JSON files in `user/themes/`. each file represents one theme and must contain three fields:

```json
{
  "name": "theme-id",
  "title": "Display Name",
  "variables": {
    "--highlight-color": "#00d4ff",
    "--main-color": "#1a1a2e"
  }
}
```

- **name** — unique identifier used as the internal key and stored in settings.
- **title** — human-readable label shown in the appearance dropdown.
- **variables** — a flat map of CSS custom properties to values. each key must start with `--`.

### theme loading flow

1. **startup** — `components/styling/theme.js` calls `window.electron.themesRead()` (IPC) on initialization.
2. **backend** — `components/styling/theme-loader.js` reads all `.json` files from `user/themes/`, validates structure (`name`, `title`, `variables`), and returns the array.
3. **renderer** — `theme.js` merges each theme's variables into a `palettes` lookup by `name`.
4. **settings** — both the settings page (`components/setup/settings.js`) and setup wizard (`components/setup/setup.js`) call `themesRead()` to populate the appearance dropdown.

### fallback behaviour

when `user/themes/` is empty or contains no valid `.json` files, the app falls back to a hidden built-in dark palette. this fallback is **never listed** in the dropdown — instead a single "Fallback" option appears. the fallback is hardcoded in `theme.js` as `fallbackPalette`.

### file locations

| file | purpose |
|------|---------|
| `user/themes/*.json` | user-provided theme files |
| `components/styling/theme-loader.js` | backend module that reads themes from disk |
| `components/styling/theme.js` | frontend theme manager — applies CSS variables, manages state |
| `components/backend/ipc/ipc-handlers.js` | registers `themes-read` IPC handler |
| `preload.js` | exposes `themesRead()` to renderer via contextBridge |

### creating a theme

drop a `.json` file into `user/themes/` with the schema above. the theme will appear automatically in the appearance dropdown on next page load. no app restart is required — navigating away and back, or clicking the reload button in settings, is sufficient.

### variables reference

the complete set of CSS custom properties a theme can define:

- `--highlight-color`
- `--main-color`
- `--shadow-color`
- `--heading-color`
- `--body-color`
- `--page-bg`
- `--page-text`
- `--page-muted`
- `--panel-bg`
- `--panel-border`
- `--widget-bg`
- `--widget-border`
- `--topbar-bg`
- `--topbar-border`
- `--topbar-text`
- `--topbar-muted`
- `--topbar-active`
- `--input-bg`
- `--input-text`
- `--input-border`
- `--button-secondary-bg`
- `--button-secondary-text`

all variables are optional — missing ones will simply not override the previous value.

### theme manager api

the `window.ThemeManager` object exposed by `theme.js` provides:

- `applyTheme(themeName, broadcast?)` — apply a theme by name
- `getCustomThemeList()` — returns `[{name, title}]` of loaded themes
- `isUsingFallback()` — returns true if no user themes exist
- `getActiveTheme()` — returns the currently active theme name
- `initializeTheme()` — re-initialize (loads themes from IPC, applies stored preference)
- `getResolvedTheme(themeName)` — returns the resolved palette key

