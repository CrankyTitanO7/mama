/**
 * settings-store.js — user settings persistence
 *
 * ELECTRON → PYWBVIEW CONVERSION:
 * Previously used Node.js fs/path for file I/O in the Electron main process.
 * Now delegates all filesystem operations to the Python bridge via
 * window.pywebview.api.*   (MamaApi in bridge.py)
 *
 * ── Bridge methods used ────────────────────────────────────────────────────
 *   settings_read()              →  dict | null
 *   settings_write(dict)         →  bool
 *   settings_write_nonbackup(dict) →  bool
 *   settings_write_with_backup(dict) →  bool
 *   settings_reset()             →  dict | null
 *   settings_backup_exists()     →  bool
 *   settings_restore_backup()    →  dict | null
 *   settings_descriptions_read() →  dict | null
 */

'use strict';

// ── Helpers ─────────────────────────────────────────────────────────────────

function api() {
  return window.pywebview && window.pywebview.api;
}

// ── Settings ────────────────────────────────────────────────────────────────

async function readSettings() {
  try {
    const a = api();
    if (!a) return null;
    return await a.settings_read();
  } catch (e) {
    console.error('readSettings failed:', e);
    return null;
  }
}

async function writeSettings(settings) {
  try {
    const a = api();
    if (!a) return false;
    return await a.settings_write(settings);
  } catch (e) {
    console.error('writeSettings failed:', e);
    return false;
  }
}

async function writeSettingsNoBackup(settings) {
  try {
    const a = api();
    if (!a) return false;
    return await a.settings_write_nonbackup(settings);
  } catch (e) {
    console.error('writeSettingsNoBackup failed:', e);
    return false;
  }
}

async function writeSettingsWithBackup(settings) {
  try {
    const a = api();
    if (!a) return false;
    return await a.settings_write_with_backup(settings);
  } catch (e) {
    console.error('writeSettingsWithBackup failed:', e);
    return false;
  }
}

async function resetSettings() {
  try {
    const a = api();
    if (!a) return null;
    return await a.settings_reset();
  } catch (e) {
    console.error('resetSettings failed:', e);
    return null;
  }
}

async function settingsBackupExists() {
  try {
    const a = api();
    if (!a) return false;
    return await a.settings_backup_exists();
  } catch (e) {
    console.error('settingsBackupExists failed:', e);
    return false;
  }
}

async function restoreSettingsFromBackup() {
  try {
    const a = api();
    if (!a) return null;
    return await a.settings_restore_backup();
  } catch (e) {
    console.error('restoreSettingsFromBackup failed:', e);
    return null;
  }
}

async function readDescriptions() {
  try {
    const a = api();
    if (!a) return null;
    return await a.settings_descriptions_read();
  } catch (e) {
    console.error('readDescriptions failed:', e);
    return null;
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

// Keep CommonJS exports for compatibility with any remaining Node.js consumers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    readSettings,
    writeSettings,
    writeSettingsNoBackup,
    writeSettingsWithBackup,
    resetSettings,
    settingsBackupExists,
    restoreSettingsFromBackup,
    readDescriptions,
  };
}

// Also make available globally for non-module (browser) usage
if (typeof window !== 'undefined') {
  window.settingsStore = {
    readSettings,
    writeSettings,
    writeSettingsNoBackup,
    writeSettingsWithBackup,
    resetSettings,
    settingsBackupExists,
    restoreSettingsFromBackup,
    readDescriptions,
  };
}