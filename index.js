const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const fs = require('fs');

// ── Modular IPC handlers (detection, install, settings, etc.) ────
const { registerIPCHandlers } = require('./components/backend/ipc/ipc-handlers');
const {
  readSettings: readSettingsFromStore,
  ensureUserSettings,
} = require('./components/backend/settings-store');
const { readRecents, ensureUserRecents, clearOpenProjectFolder } = require('./components/backend/project-store');

let mainWindow;

const SETTINGS_PATH = path.join(__dirname, 'user', 'settings.json');
const SETTINGS_BACKUP_PATH = path.join(__dirname, 'user', 'backup', 'settings.json');

// ========== Settings helpers ==========

function loadSettings() {
  return readSettingsFromStore(SETTINGS_PATH);
}

function saveSettings(settings, skipBackup = false) {
  if (!skipBackup && fs.existsSync(SETTINGS_PATH)) {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_BACKUP_PATH), { recursive: true });
      fs.copyFileSync(SETTINGS_PATH, SETTINGS_BACKUP_PATH);
    } catch (e) {
      console.warn('Settings backup failed:', e.message);
    }
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf8');
  return true;
}

// ========== Python runner ==========

function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(cmd, [scriptPath, ...args]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    proc.on('error', (err) => {
      if (process.platform === 'win32') {
        const proc2 = spawn('python', [scriptPath, ...args]);
        let stdout2 = '';
        let stderr2 = '';
        proc2.stdout.on('data', (d) => { stdout2 += d.toString(); });
        proc2.stderr.on('data', (d) => { stderr2 += d.toString(); });
        proc2.on('close', (c2) => resolve({ stdout: stdout2, stderr: stderr2, code: c2 }));
        proc2.on('error', () => resolve({ stdout, stderr, code: -1 }));
      } else {
        resolve({ stdout, stderr, code: -1 });
      }
    });
  });
}

// ========== Download routing ==========

function attachDownloadHandler(session) {
  session.on('will-download', (event, item) => {
    const recents = readRecents();
    if (recents.open) {
      const filePath = path.join(recents.open, item.getFilename());
      item.setSavePath(filePath);
    }
    // If no open folder, Electron uses default behavior (Downloads folder + dialog)
  });
}

// ========== Window ==========

const createWindow = (page) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const prefs = mainWindow.webContents.getWebPreferences?.() ?? {};
    if (!prefs.webviewTag) {
      mainWindow.destroy();
      mainWindow = null;
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(page || 'public/index.html');
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    }
  });

  // Attach download handler to the main window's session
  attachDownloadHandler(mainWindow.webContents.session);

  // Flag to prevent re-triggering the close check after user confirms
  let _closingConfirmed = false;

  // Intercept close: if settings page is showing unsaved changes,
  // ask the renderer to prompt the user before closing.
  mainWindow.on('close', async (e) => {
    // If already confirmed, allow the close to proceed naturally
    if (_closingConfirmed) return;

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.webContents) {
      e.preventDefault();

      // Send a synchronous-style check via IPC — ask renderer if there are unsaved changes
      const result = await new Promise((resolve) => {
        // Listen for the response
        const onResponse = (_event, action) => {
          ipcMain.removeListener('before-quit-response', onResponse);
          resolve(action);
        };
        ipcMain.on('before-quit-response', onResponse);

        // Ask the renderer to check
        const windowRef = mainWindow;
        if (windowRef && !windowRef.isDestroyed() && windowRef.webContents) {
          windowRef.webContents.send('before-quit-check');
        } else {
          resolve('proceed');
          return;
        }

        // Timeout: if no response within 10 seconds, proceed with close
        setTimeout(() => {
          ipcMain.removeListener('before-quit-response', onResponse);
          resolve('proceed');
        }, 10000);
      });

      if (result === 'cancel') return;

      // User confirmed — close the window for real
      _closingConfirmed = true;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.close();
    }
  });

  mainWindow.loadFile(page || 'public/index.html');
};

app.on('before-quit', () => {
  clearOpenProjectFolder();
});

app.on('ready', () => {
  // Seed user/settings.json and components/recents.json from user/template on first launch.
  ensureUserSettings(SETTINGS_PATH);
  ensureUserRecents();

  // ── Register all modular IPC handlers first ──
  // This registers: run-os-detect, run-python-detect, run-gpu-detect,
  //   run-install (GPU-variant aware), run-import-test (enhanced),
  //   settings-read, settings-write, settings-write-nonbackup, setup-complete
  registerIPCHandlers(app, SETTINGS_PATH);

  app.on('mama:setup-complete', () => {
    if (mainWindow) {
      mainWindow.loadFile('public/index.html');
    }
  });

  // ── Additional index.js-specific IPC handlers ──
  // (These do NOT overlap with what registerIPCHandlers registered)

  ipcMain.handle('navigate-to', async (event, page) => {
    if (mainWindow) {
      mainWindow.loadFile(page);
    }
    return true;
  });

  ipcMain.handle('resolve-public-url', async (_event, filename, query = {}) => {
    const filePath = path.join(__dirname, 'public', filename);
    let href = pathToFileURL(filePath).href;
    const qs = new URLSearchParams(query).toString();
    if (qs) href += `?${qs}`;
    return href;
  });

  ipcMain.handle('settings-write-with-backup', async (event, settings) => {
    return saveSettings(settings, false);
  });

  ipcMain.handle('settings-setup-complete', async () => {
    const settings = loadSettings();
    if (settings && settings['general settings']) {
      settings['general settings'].setup = false;
      saveSettings(settings, true);
    }
    if (mainWindow) {
      mainWindow.loadFile('public/index.html');
    }
    return true;
  });

  // System: Generic command runner (for mission control pre-flight checks)
  ipcMain.handle('run-system-command', async (event, command, args) => {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const opts = { shell: isWin };
      const proc = spawn(command, args || [], opts);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && stderr && !stdout) {
          stdout = stderr;
          stderr = '';
        }
        resolve({ stdout, stderr, code });
      });
      proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: -1 }));
    });
  });

  // Python: Run generic command (existing, kept for compatibility)
  ipcMain.handle('run-python-command', async (event, action) => {
    if (action === 'install') {
      return runPythonScript(path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py'));
    }
    return runPythonScript(path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py'));
  });

  // ── Launch window ──
  const settings = loadSettings();
  if (settings && settings['general settings'] && settings['general settings'].setup === true) {
    createWindow('public/setup.html');
  } else {
    createWindow('public/index.html');
  }
});

// ── Attach download handler to webview sessions ──
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    attachDownloadHandler(contents.session);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    const settings = loadSettings();
    if (settings && settings['general settings'] && settings['general settings'].setup === true) {
      createWindow('public/setup.html');
    } else {
      createWindow('public/index.html');
    }
  }
});