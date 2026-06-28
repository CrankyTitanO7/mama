'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'user', 'template', 'settings.json');
const DESCRIPTIONS_PATH = path.join(__dirname, '..', '..', 'user', 'template', 'descriptions.json');

/** Strip // line comments for developer-facing template JSON (JSONC-lite). */
function stripJsonComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) return '';
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      const quoteCount = (before.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) return line;
      return before.replace(/\s+$/, '');
    })
    .join('\n');
}

function parseSettingsJson(raw) {
  return JSON.parse(stripJsonComments(raw));
}

function ensureUserSettings(settingsFilePath) {
  if (fs.existsSync(settingsFilePath)) return false;

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn('Settings template missing:', TEMPLATE_PATH);
    return false;
  }

  try {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const parsed = parseSettingsJson(raw);
    fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
    fs.writeFileSync(settingsFilePath, JSON.stringify(parsed, null, 4), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to seed settings from template:', e);
    return false;
  }
}

function readSettings(settingsFilePath) {
  ensureUserSettings(settingsFilePath);
  try {
    if (!fs.existsSync(settingsFilePath)) return null;
    const raw = fs.readFileSync(settingsFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('readSettings failed:', e);
    return null;
  }
}

function readDescriptions() {
  try {
    if (!fs.existsSync(DESCRIPTIONS_PATH)) return null;
    return JSON.parse(fs.readFileSync(DESCRIPTIONS_PATH, 'utf8'));
  } catch (e) {
    console.error('readDescriptions failed:', e);
    return null;
  }
}

module.exports = {
  TEMPLATE_PATH,
  DESCRIPTIONS_PATH,
  stripJsonComments,
  parseSettingsJson,
  ensureUserSettings,
  readSettings,
  readDescriptions,
};
