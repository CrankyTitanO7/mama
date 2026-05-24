// Preload script for secure context — mama
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});

contextBridge.exposeInMainWorld('electron', {
  // ── Navigation ──────────────────────────────────────────────
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page),

  // ── Settings ────────────────────────────────────────────────
  settingsRead:            ()       => ipcRenderer.invoke('settings-read'),
  settingsWrite:           (s)      => ipcRenderer.invoke('settings-write', s),
  settingsWriteNonbackup:  (s)      => ipcRenderer.invoke('settings-write-nonbackup', s),
  settingsWriteWithBackup: (s)      => ipcRenderer.invoke('settings-write-with-backup', s),
  settingsSetupComplete:   ()       => ipcRenderer.invoke('settings-setup-complete'),
  setupComplete:           ()       => ipcRenderer.invoke('setup-complete'),

  // ── System Detection (Python scripts) ──────────────────────
  runOSDetect:     ()                 => ipcRenderer.invoke('run-os-detect'),
  runPythonDetect: ()                 => ipcRenderer.invoke('run-python-detect'),
  runGPUDetect:    ()                 => ipcRenderer.invoke('run-gpu-detect'),

  // ── Python: Install framework (GPU-variant aware) ──────────
  runInstall: (fw, gpuVariant = 'cpu', accelVersion = '') =>
                 ipcRenderer.invoke('run-install', fw, gpuVariant, accelVersion),

  // ── Python: Import test ────────────────────────────────────
  runImportTest: (framework) => ipcRenderer.invoke('run-import-test', framework),

  // ── Python: Legacy system / GPU detection ──────────────────
  runSystemDetect: (framework) => ipcRenderer.invoke('run-system-detect', framework),

  // ── System: Generic command (for mission control checks) ───
  runSystemCommand: (command, args) => ipcRenderer.invoke('run-system-command', command, args),

  // ── Python: Legacy commands ─────────────────────────────────
  runPythonCommand: (action) => ipcRenderer.invoke('run-python-command', action),
});