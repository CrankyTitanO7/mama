// Preload script for secure context
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});

contextBridge.exposeInMainWorld('electron', {
  // Python commands (existing)
  runPythonCommand: (action) => ipcRenderer.invoke('run-python-command', action),

  // Settings IPC
  settingsRead: () => ipcRenderer.invoke('settings-read'),
  settingsWrite: (settings) => ipcRenderer.invoke('settings-write', settings),
  settingsWriteWithBackup: (settings) => ipcRenderer.invoke('settings-write-with-backup', settings),
  setupComplete: () => ipcRenderer.invoke('settings-setup-complete'),
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page),

  // Python: Import test
  runImportTest: (framework) => ipcRenderer.invoke('run-import-test', framework),

  // Python: Install framework
  runInstall: (framework) => ipcRenderer.invoke('run-install', framework),

  // Python: System / GPU detection
  runSystemDetect: (framework) => ipcRenderer.invoke('run-system-detect', framework)
});