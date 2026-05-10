// Preload script for secure context
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});

contextBridge.exposeInMainWorld('electron', {
  runPythonCommand: (action) => ipcRenderer.invoke('run-python-command', action),
  // Settings IPC
  settingsRead: () => ipcRenderer.invoke('settings-read'),
  settingsWrite: (settings) => ipcRenderer.invoke('settings-write', settings),
  setupComplete: () => ipcRenderer.invoke('settings-setup-complete'),
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page)
});
