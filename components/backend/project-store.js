'use strict';

const fs = require('fs');
const path = require('path');

const RECENTS_PATH = path.join(__dirname, '..', 'recents.json');
const RECENTS_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'user', 'template', 'recents.json');
const MAX_RECENTS = 10;

function normalizeRecents(data) {
  const open = typeof data?.open === 'string' && data.open ? data.open : null;
  let recent = [];

  if (Array.isArray(data?.recent)) {
    recent = data.recent.filter((entry) => typeof entry === 'string' && entry);
  } else if (data?.recent && typeof data.recent === 'object') {
    recent = Object.values(data.recent).filter((entry) => typeof entry === 'string' && entry);
  }

  return { open, recent };
}

function seedRecentsFromTemplate(recentsFilePath = RECENTS_PATH) {
  if (!fs.existsSync(RECENTS_TEMPLATE_PATH)) {
    console.warn('Recents template missing:', RECENTS_TEMPLATE_PATH);
    return null;
  }

  try {
    const raw = fs.readFileSync(RECENTS_TEMPLATE_PATH, 'utf8');
    const parsed = normalizeRecents(JSON.parse(raw));
    fs.mkdirSync(path.dirname(recentsFilePath), { recursive: true });
    fs.writeFileSync(recentsFilePath, JSON.stringify(parsed, null, 4), 'utf8');
    return parsed;
  } catch (e) {
    console.error('Failed to seed recents from template:', e);
    return null;
  }
}

function ensureUserRecents(recentsFilePath = RECENTS_PATH) {
  if (fs.existsSync(recentsFilePath)) return false;
  return seedRecentsFromTemplate(recentsFilePath) !== null;
}

function readRecents() {
  ensureUserRecents();
  try {
    if (!fs.existsSync(RECENTS_PATH)) {
      return { open: null, recent: [] };
    }
    const raw = fs.readFileSync(RECENTS_PATH, 'utf8');
    return normalizeRecents(JSON.parse(raw));
  } catch (e) {
    console.error('readRecents failed:', e);
    return { open: null, recent: [] };
  }
}

function writeRecents(data) {
  fs.mkdirSync(path.dirname(RECENTS_PATH), { recursive: true });
  fs.writeFileSync(RECENTS_PATH, JSON.stringify(data, null, 4), 'utf8');
}

function addRecentFolder(folderPath) {
  const data = readRecents();
  const recent = [folderPath, ...data.recent.filter((entry) => entry !== folderPath)].slice(0, MAX_RECENTS);
  const updated = { open: folderPath, recent };
  writeRecents(updated);
  return updated;
}

function listDirectory(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return null;

  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (_) {
    return null;
  }
  if (!stat.isDirectory()) return null;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        let size = null;
        if (!entry.isDirectory()) {
          try {
            size = fs.statSync(fullPath).size;
          } catch (_) {
            size = null;
          }
        }
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size,
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  } catch (e) {
    console.error('listDirectory failed:', e);
    return null;
  }
}

function openProjectFolder(folderPath) {
  const entries = listDirectory(folderPath);
  if (!entries) return null;

  addRecentFolder(folderPath);
  return { path: folderPath, entries };
}

module.exports = {
  RECENTS_PATH,
  RECENTS_TEMPLATE_PATH,
  seedRecentsFromTemplate,
  ensureUserRecents,
  readRecents,
  writeRecents,
  addRecentFolder,
  listDirectory,
  openProjectFolder,
};
