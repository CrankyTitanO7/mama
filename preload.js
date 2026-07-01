// Preload script for secure context — mama
const { contextBridge, ipcRenderer } = require('electron');

// ── Streaming install state (internal, not exposed) ─────────────────────────
let _installChunkCallback = null;
let _beforeQuitCallback = null;

ipcRenderer.on('install-chunk', (_event, chunk) => {
  if (_installChunkCallback) _installChunkCallback(chunk);
});

ipcRenderer.on('before-quit-check', async (_event) => {
  if (_beforeQuitCallback) {
    const action = await _beforeQuitCallback();
    ipcRenderer.send('before-quit-response', action);
  } else {
    ipcRenderer.send('before-quit-response', 'proceed');
  }
});

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  arch: () => process.arch
});

contextBridge.exposeInMainWorld('electron', {
  // ── Navigation ──────────────────────────────────────────────
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page),
  resolvePublicUrl: (filename, query) =>
    ipcRenderer.invoke('resolve-public-url', filename, query),

  // ── Settings ────────────────────────────────────────────────
  settingsRead:            ()       => ipcRenderer.invoke('settings-read'),
  settingsDescriptionsRead: ()      => ipcRenderer.invoke('settings-descriptions-read'),
  settingsWrite:           (s)      => ipcRenderer.invoke('settings-write', s),
  settingsWriteNonbackup:  (s)      => ipcRenderer.invoke('settings-write-nonbackup', s),
  settingsWriteWithBackup: (s)      => ipcRenderer.invoke('settings-write-with-backup', s),
  settingsReset:           ()       => ipcRenderer.invoke('settings-reset'),
  settingsBackupExists:      ()       => ipcRenderer.invoke('settings-backup-exists'),
  settingsRestoreBackup:     ()       => ipcRenderer.invoke('settings-restore-backup'),
  settingsSetupComplete:   ()       => ipcRenderer.invoke('settings-setup-complete'),
  setupComplete:           ()       => ipcRenderer.invoke('setup-complete'),

  // ── System Detection (Python scripts) ──────────────────────
  runOSDetect:     ()                 => ipcRenderer.invoke('run-os-detect'),
  runPythonDetect: ()                 => ipcRenderer.invoke('run-python-detect'),
  runGPUDetect:    ()                 => ipcRenderer.invoke('run-gpu-detect'),
  runCompatibilityCheck: (params)     => ipcRenderer.invoke('run-compatibility-check', params),

  // ── Python: Install framework (GPU-variant aware) ──────────
  runInstall: (fw, gpuVariant = 'cpu', accelVersion = '') =>
                 ipcRenderer.invoke('run-install', fw, gpuVariant, accelVersion),

  // ── Python: Streaming install (real-time output) ──────────
  runInstallStream: (fw, gpuVariant, accelVersion, onChunk) => {
    _installChunkCallback = onChunk || null;
    return ipcRenderer.invoke('run-install-stream', fw, gpuVariant, accelVersion || '')
      .finally(() => { _installChunkCallback = null; });
  },

  // ── Python: Import test ────────────────────────────────────
  runImportTest: (framework) => ipcRenderer.invoke('run-import-test', framework),

  // ── Python: Legacy system / GPU detection ──────────────────
  runSystemDetect: (framework) => ipcRenderer.invoke('run-system-detect', framework),

  // ── System: Generic command (for mission control checks) ───
  runSystemCommand: (command, args) => ipcRenderer.invoke('run-system-command', command, args),

  // ── Custom themes ───────────────────────────────────────────
  themesRead: () => ipcRenderer.invoke('themes-read'),
  themesWrite: (theme) => ipcRenderer.invoke('themes-write', theme),

  // ── Python: Legacy commands ─────────────────────────────────
  runPythonCommand: (action) => ipcRenderer.invoke('run-python-command', action),

  // ── Project explorer ─────────────────────────────────────────
  projectRecentsRead:  ()           => ipcRenderer.invoke('project-recents-read'),
  projectPickFolder:   ()           => ipcRenderer.invoke('project-pick-folder'),
  projectOpenFolder:   (folderPath) => ipcRenderer.invoke('project-open-folder', folderPath),
  projectListFolder:   (folderPath) => ipcRenderer.invoke('project-list-folder', folderPath),
  projectRevealFolder: (folderPath) => ipcRenderer.invoke('project-reveal-folder', folderPath),
  projectTemplatesRead: ()          => ipcRenderer.invoke('project-templates-read'),
  projectImportTemplate: (templateKey) => ipcRenderer.invoke('project-import-template', templateKey),

  // ── Before-quit hook (settings unsaved changes dialog) ─────
  onBeforeQuit: (callback) => {
    _beforeQuitCallback = callback;
  },
});