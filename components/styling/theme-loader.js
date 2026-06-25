'use strict';

const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', '..', 'user', 'themes');

/**
 * Read all custom theme JSON files from user/themes/.
 * Each file must have: { name, title, variables }
 *
 * @returns {Array<{name: string, title: string, variables: object}>}
 */
function readCustomThemes() {
  const themes = [];
  try {
    if (!fs.existsSync(THEMES_DIR)) return themes;

    const entries = fs.readdirSync(THEMES_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(THEMES_DIR, entry);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.name && parsed.title && parsed.variables) {
          themes.push({
            name: parsed.name,
            title: parsed.title,
            variables: parsed.variables,
          });
        }
      } catch (e) {
        console.warn(`Skipping invalid theme file: ${entry}`, e.message);
      }
    }
  } catch (e) {
    console.warn('Failed to read themes directory:', e.message);
  }
  return themes;
}

/**
 * Get a specific theme by name.
 * @param {string} name
 * @returns {object|null}
 */
function getTheme(name) {
  const themes = readCustomThemes();
  return themes.find((t) => t.name === name) || null;
}

/**
 * Write a custom theme JSON file to user/themes/.
 * The filename is derived from the theme name (lowercased, spaces to hyphens).
 *
 * @param {{ name: string, title: string, variables: object }} theme
 * @returns {boolean} success
 */
function writeCustomTheme(theme) {
  try {
    if (!fs.existsSync(THEMES_DIR)) {
      fs.mkdirSync(THEMES_DIR, { recursive: true });
    }

    // Build a safe filename from the name
    const safeName = theme.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'custom-theme';

    let filePath = path.join(THEMES_DIR, `${safeName}.json`);

    // If the file already exists, we are overwriting — this is expected for "save"
    // when editing the same custom theme. Generate a unique name if name collision
    // with a different theme (but the user named it, so we respect their choice).
    // To avoid clobbering an unrelated existing theme, we check if the file contents
    // have a different name property.
    if (fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (existing.name && existing.name !== theme.name) {
          // Name collision with a different theme — append a suffix
          let counter = 2;
          while (true) {
            const suffixedName = `${safeName}-${counter}`;
            const altPath = path.join(THEMES_DIR, `${suffixedName}.json`);
            if (!fs.existsSync(altPath)) {
              filePath = altPath;
              break;
            }
            counter++;
          }
        }
      } catch (_) {
        // If existing file is corrupt, overwrite it
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(theme, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to write custom theme:', e.message);
    return false;
  }
}

module.exports = { readCustomThemes, getTheme, writeCustomTheme, THEMES_DIR };