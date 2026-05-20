/**
 * preload.js — Exposes the Frank IPC API to the renderer process.
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

  runImportTest:   (fw)                        => ipcRenderer.invoke('run-import-test', fw),

  // ── Settings ──────────────────────────────────────────────────────────────
  settingsRead:             ()       => ipcRenderer.invoke('settings-read'),
  settingsWrite:            (s)      => ipcRenderer.invoke('settings-write', s),
  settingsWriteNonbackup:   (s)      => ipcRenderer.invoke('settings-write-nonbackup', s),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  setupComplete: () => ipcRenderer.invoke('setup-complete'),

});