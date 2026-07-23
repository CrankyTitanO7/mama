/**
 * preload.js — Exposes the mama IPC API to the renderer process.
 *
 * Runs in an isolated context (nodeIntegration: false).
 * All communication goes through ipcRenderer.invoke() — no direct Node access
 * is exposed to the page.
 *
 * window.electron API surface:
 *
 *   Detection
 *     runOSDetect()                        → Promise<{code, stdout, stderr}>
 *     runPythonDetect()                    → Promise<{code, stdout, stderr}>
 *     runGPUDetect()                       → Promise<{code, stdout, stderr}>
 *
 *   Install / verify
 *     runInstall(fw, gpuVariant, accelVer) → Promise<{code, stdout, stderr}>
 *     runInstallStream(fw, gpuVariant, accelVer, scope, projectFolder)
 *                                           → Promise<{code: number}>
 *     onInstallProgress(cb)                → registers listener for
 *                                            { type:'stdout'|'stderr'|'done', text?, code? }
 *     offInstallProgress()               → removes all 'install-progress' listeners
 *     runImportTest(fw, projectFolder)     → Promise<{code, stdout, stderr}>
 *
 *   Settings
 *     settingsRead()                       → Promise<object|null>
 *     settingsWrite(settings)              → Promise<boolean>
 *     settingsWriteNonbackup(settings)     → Promise<boolean>
 *
 *   Lifecycle
 *     setupComplete()                      → Promise<boolean>
 *     navigateTo(path)                     → Promise<void>
 *     themesRead()                         → Promise<array|null>
 *     torchCommandsRead()                  → Promise<object>
 *     projectRecentsRead()                 → Promise<object>
 *     projectPickFolder()                  → Promise<string|null>
 *     projectInit(folder)                  → Promise<{hasProjectJson, hasVenv}>
 *     projectCreateJson(folder)            → Promise<{success, error?}>
 *     projectCreateVenv(folder)            → Promise<{success, error?}>
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Streaming install state (internal, not exposed) ─────────────────────────
let _installChunkCallback = null;

// The main process sends 'install-progress' events with chunks like:
//   { type: 'stdout', text: '...' }
//   { type: 'stderr', text: '...' }
//   { type: 'done',   code: 0 }
ipcRenderer.on('install-progress', (_event, chunk) => {
  if (_installChunkCallback) _installChunkCallback(chunk);
});

contextBridge.exposeInMainWorld('electron', {

  // ── Detection ─────────────────────────────────────────────────────────────
  runOSDetect:     ()                          => ipcRenderer.invoke('run-os-detect'),
  runPythonDetect: ()                          => ipcRenderer.invoke('run-python-detect'),
  runGPUDetect:    ()                          => ipcRenderer.invoke('run-gpu-detect'),

  // ── Install / verify ──────────────────────────────────────────────────────
  // fw:           'torch' | 'tf'
  // gpuVariant:   'cuda'  | 'rocm' | 'cpu'
  // accelVersion: CUDA version string e.g. '12.1', ROCm version e.g. '5.7',
  //               or empty string — installer falls back to latest stable tag.
  // scope:        'global' | 'project' — determines whether to use venv or system python
  // projectFolder: path to project folder (required for 'project' scope)
  runInstall:      (fw, gpuVariant, accelVersion = '') =>
                     ipcRenderer.invoke('run-install', fw, gpuVariant, accelVersion),

  /**
   * Streaming install — sends output chunks to onChunk in real-time.
   *
   * @param {string}   fw           'torch' | 'tf'
   * @param {string}   gpuVariant   'cuda' | 'rocm' | 'cpu'
   * @param {string}   accelVersion e.g. '12.1', '5.7', or ''
   * @param {string}   scope        'global' | 'project'
   * @param {string}   projectFolder path to project folder (for 'project' scope)
   * @returns {Promise<{code: number}>} Resolves when the process finishes.
   */
  runInstallStream: (fw, gpuVariant, accelVersion = '', scope = 'global', projectFolder = '') =>
                     ipcRenderer.invoke('run-install-stream', fw, gpuVariant, accelVersion, scope, projectFolder),

  /**
   * Register a listener for install progress chunks.
   * Each chunk is { type: 'stdout'|'stderr'|'done', text?, code? }
   */
  onInstallProgress:  (cb) => { _installChunkCallback = cb; },

  /**
   * Remove all install-progress listeners.
   */
  offInstallProgress: () => { _installChunkCallback = null; },

  runImportTest:   (fw, projectFolder = null) => ipcRenderer.invoke('run-import-test', fw, projectFolder),

  // ── Settings ──────────────────────────────────────────────────────────────
  settingsRead:             ()       => ipcRenderer.invoke('settings-read'),
  settingsWrite:            (s)      => ipcRenderer.invoke('settings-write', s),
  settingsWriteNonbackup:   (s)      => ipcRenderer.invoke('settings-write-nonbackup', s),
  settingsDescriptionsRead: ()       => ipcRenderer.invoke('settings-descriptions-read'),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  setupComplete: () => ipcRenderer.invoke('setup-complete'),
  navigateTo:    (path) => ipcRenderer.invoke('navigate-to', path),

  // ── Themes ────────────────────────────────────────────────────────────────
  themesRead:    ()       => ipcRenderer.invoke('themes-read'),
  themesWrite:   (theme)  => ipcRenderer.invoke('themes-write', theme),

  // ── Torch commands ────────────────────────────────────────────────────────
  torchCommandsRead: () => ipcRenderer.invoke('torch-commands-read'),

  // ── Project / folder ──────────────────────────────────────────────────────
  projectRecentsRead:   ()         => ipcRenderer.invoke('project-recents-read'),
  projectPickFolder:    ()         => ipcRenderer.invoke('project-pick-folder'),
  projectInit:          (folder)   => ipcRenderer.invoke('project-init', folder),
  projectCreateJson:    (folder)   => ipcRenderer.invoke('project-create-json', folder),
  projectCreateVenv:    (folder)   => ipcRenderer.invoke('project-create-venv', folder),

});
