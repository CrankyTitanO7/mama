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

module.exports = { readCustomThemes, getTheme, THEMES_DIR };