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
 *     runImportTest(fw)                    → Promise<{code, stdout, stderr}>
 *
 *   Settings
 *     settingsRead()                       → Promise<object|null>
 *     settingsWrite(settings)              → Promise<boolean>
 *     settingsWriteNonbackup(settings)     → Promise<boolean>
 *
 *   Lifecycle
 *     setupComplete()                      → Promise<boolean>
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Streaming install state (internal, not exposed) ─────────────────────────
let _installChunkCallback = null;

ipcRenderer.on('install-chunk', (_event, chunk) => {
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
  runInstall:      (fw, gpuVariant, accelVersion = '') =>
                     ipcRenderer.invoke('run-install', fw, gpuVariant, accelVersion),

  /**
   * Streaming install — sends output chunks to onChunk in real-time.
   *
   * @param {string}   fw           'torch' | 'tf'
   * @param {string}   gpuVariant   'cuda' | 'rocm' | 'cpu'
   * @param {string}   accelVersion e.g. '12.1', '5.7', or ''
   * @param {function} onChunk      Called with { type: 'stdout'|'stderr'|'done', text?, code? }
   * @returns {Promise<{code: number}>} Resolves when the process finishes.
   */
  runInstallStream: (fw, gpuVariant, accelVersion, onChunk) => {
    _installChunkCallback = onChunk || null;
    return ipcRenderer.invoke('run-install-stream', fw, gpuVariant, accelVersion)
      .finally(() => { _installChunkCallback = null; });
  },

  runImportTest:   (fw)                        => ipcRenderer.invoke('run-import-test', fw),

  // ── Settings ──────────────────────────────────────────────────────────────
  settingsRead:             ()       => ipcRenderer.invoke('settings-read'),
  settingsWrite:            (s)      => ipcRenderer.invoke('settings-write', s),
  settingsWriteNonbackup:   (s)      => ipcRenderer.invoke('settings-write-nonbackup', s),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  setupComplete: () => ipcRenderer.invoke('setup-complete'),

});
