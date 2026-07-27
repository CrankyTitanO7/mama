/**
 * project-store.js — project & recent-folders persistence
 *
 * ELECTRON → PYWBVIEW CONVERSION:
 * Previously used Node.js fs/path for file I/O in the Electron main process.
 * Now delegates all filesystem operations to the Python bridge via
 * window.pywebview.api.*   (MamaApi in bridge.py)
 *
 * ── Bridge methods used ────────────────────────────────────────────────────
 *   project_recents_read()    →  { open: string|null, recent: string[] }
 *   project_open_folder(path) →  { open, recent } (adds to recents)
 *   project_list_folder(path) →  { path, entries[] } | null
 *   project_pick_folder()     →  string | null (native dialog)
 *   project_reveal_folder(path) →  bool
 *   project_templates_read()  →  dict
 *   project_import_template(key) →  dict
 *   project_init(path)        →  { hasProjectJson, hasVenv }
 *   project_create_json(path) →  { success, error? }
 *   project_create_venv(path) →  { success, error? }
 */

'use strict';

// ── Helpers ─────────────────────────────────────────────────────────────────

function api() {
  return window.pywebview && window.pywebview.api;
}

// ── Recents ─────────────────────────────────────────────────────────────────

async function readRecents() {
  try {
    const a = api();
    if (!a) return { open: null, recent: [] };
    const data = await a.project_recents_read();
    return normalizeRecents(data);
  } catch (e) {
    console.error('readRecents failed:', e);
    return { open: null, recent: [] };
  }
}

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

async function writeRecents(data) {
  // Recents are written automatically by project_open_folder on the bridge side.
  // If you need to persist directly, call project_open_folder with the current open path.
  console.warn('writeRecents is a no-op in pywebview mode — use project_open_folder instead');
}

async function clearOpenProjectFolder() {
  try {
    const a = api();
    if (!a) return { open: null, recent: [] };
    // Write an empty recent entry via open with null
    const result = await a.project_open_folder('');
    return result || { open: null, recent: [] };
  } catch (e) {
    console.error('clearOpenProjectFolder failed:', e);
    return { open: null, recent: [] };
  }
}

async function addRecentFolder(folderPath) {
  try {
    const a = api();
    if (!a) return { open: null, recent: [] };
    const result = await a.project_open_folder(folderPath);
    return result || { open: null, recent: [] };
  } catch (e) {
    console.error('addRecentFolder failed:', e);
    return { open: null, recent: [] };
  }
}

async function listDirectory(dirPath) {
  try {
    const a = api();
    if (!a) return null;
    // Bridge does the exists/isDirectory check server-side
    const result = await a.project_list_folder(dirPath);
    if (!result || !result.entries) return null;
    // Sort: directories first, then alphabetical
    result.entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return result.entries;
  } catch (e) {
    console.error('listDirectory failed:', e);
    return null;
  }
}

async function openProjectFolder(folderPath) {
  try {
    const a = api();
    if (!a) return null;
    const result = await a.project_open_folder(folderPath);
    if (!result) return null;

    // Also list directory contents
    const entries = await listDirectory(folderPath);
    if (!entries) return null;

    return { path: folderPath, entries };
  } catch (e) {
    console.error('openProjectFolder failed:', e);
    return null;
  }
}

async function pickFolder() {
  try {
    const a = api();
    if (!a) return null;
    return await a.project_pick_folder();
  } catch (e) {
    console.error('pickFolder failed:', e);
    return null;
  }
}

async function revealFolder(folderPath) {
  try {
    const a = api();
    if (!a) return false;
    return await a.project_reveal_folder(folderPath);
  } catch (e) {
    console.error('revealFolder failed:', e);
    return false;
  }
}

async function readTemplates() {
  try {
    const a = api();
    if (!a) return {};
    return await a.project_templates_read();
  } catch (e) {
    console.error('readTemplates failed:', e);
    return {};
  }
}

async function importTemplate(templateKey) {
  try {
    const a = api();
    if (!a) return { success: false, error: 'No API bridge available' };
    return await a.project_import_template(templateKey);
  } catch (e) {
    console.error('importTemplate failed:', e);
    return { success: false, error: e.message };
  }
}

async function initProject(folderPath) {
  try {
    const a = api();
    if (!a) return { hasProjectJson: false, hasVenv: false };
    return await a.project_init(folderPath);
  } catch (e) {
    console.error('initProject failed:', e);
    return { hasProjectJson: false, hasVenv: false };
  }
}

async function createProjectJson(folderPath) {
  try {
    const a = api();
    if (!a) return { success: false, error: 'No API bridge available' };
    return await a.project_create_json(folderPath);
  } catch (e) {
    console.error('createProjectJson failed:', e);
    return { success: false, error: e.message };
  }
}

async function createVenv(folderPath) {
  try {
    const a = api();
    if (!a) return { success: false, error: 'No API bridge available' };
    return await a.project_create_venv(folderPath);
  } catch (e) {
    console.error('createVenv failed:', e);
    return { success: false, error: e.message };
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

// Keep CommonJS exports for compatibility with any remaining Node.js consumers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    readRecents,
    writeRecents,
    normalizeRecents,
    clearOpenProjectFolder,
    addRecentFolder,
    listDirectory,
    openProjectFolder,
    pickFolder,
    revealFolder,
    readTemplates,
    importTemplate,
    initProject,
    createProjectJson,
    createVenv,
  };
}

// Also make available globally for non-module (browser) usage
if (typeof window !== 'undefined') {
  window.projectStore = {
    readRecents,
    writeRecents,
    normalizeRecents,
    clearOpenProjectFolder,
    addRecentFolder,
    listDirectory,
    openProjectFolder,
    pickFolder,
    revealFolder,
    readTemplates,
    importTemplate,
    initProject,
    createProjectJson,
    createVenv,
  };
}