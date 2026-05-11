const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

const SETTINGS_PATH = path.join(__dirname, 'user', 'settings.json');
const SETTINGS_BACKUP_PATH = path.join(__dirname, 'user', 'backup', 'settings.json');

// ========== Settings helpers ==========

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSettings(settings, skipBackup = false) {
  // Backup before overwriting (unless it's a nonbackup save)
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
    // Try python3 first, then python
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
      // If python3 fails on Windows, try python
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

// ========== Window ==========

const createWindow = (page) => {
  if (mainWindow) {
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
    }
  });
  mainWindow.loadFile(page || 'public/index.html');
};

app.on('ready', () => {
  const settings = loadSettings();
  if (settings && settings['general settings'] && settings['general settings'].setup === true) {
    createWindow('public/setup.html');
  } else {
    createWindow('public/index.html');
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

// ========== IPC Handlers ==========

// --- Settings ---
ipcMain.handle('settings-read', async () => loadSettings());

ipcMain.handle('settings-write', async (event, settings) => {
  return saveSettings(settings, false);
});

ipcMain.handle('settings-write-nonbackup', async (event, settings) => {
  return saveSettings(settings, true);
});

ipcMain.handle('settings-setup-complete', async () => {
  const settings = loadSettings();
  if (settings && settings['general settings']) {
    settings['general settings'].setup = false;
    saveSettings(settings);
  }
  if (mainWindow) {
    mainWindow.loadFile('public/index.html');
  }
  return true;
});

ipcMain.handle('navigate-to', async (event, page) => {
  if (mainWindow) {
    mainWindow.loadFile(page);
  }
  return true;
});

// --- Python: Import test ---
ipcMain.handle('run-import-test', async (event, framework) => {
  // framework: 'torch' or 'tf'
  const scriptPath = path.join(__dirname, 'components', 'python', 'tests', 'importTests.py');
  const result = await runPythonScript(scriptPath, [framework]);
  return result;
});

// --- Python: Install framework ---
ipcMain.handle('run-install', async (event, framework) => {
  // framework: 'torch' or 'tf'
  let command, args;
  if (framework === 'torch') {
    command = 'pip3';
    args = ['install', 'torch', 'torchvision', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu'];
    if (process.platform === 'win32') {
      command = 'pip';
      args = ['install', 'torch', 'torchvision', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu'];
    }
  } else {
    command = 'pip3';
    args = ['install', 'tensorflow'];
    if (process.platform === 'win32') {
      command = 'pip';
      args = ['install', 'tensorflow'];
    }
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => resolve({ stdout, stderr, code }));
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: -1 }));
  });
});

// --- Python: System detect (hardware / GPU) ---
ipcMain.handle('run-system-detect', async (event, framework) => {
  let scriptPath;
  if (framework === 'torch') {
    scriptPath = path.join(__dirname, 'components', 'backend', 'systemDetect', 'systemDetectTorch.py');
  } else {
    scriptPath = path.join(__dirname, 'components', 'backend', 'systemDetect', 'systemDetectTF.py');
  }

  if (!fs.existsSync(scriptPath)) {
    return { stdout: '', stderr: 'Detection script not found', code: -1 };
  }

  const result = await runPythonScript(scriptPath);
  return result;
});

// --- Python: Run generic command (existing, kept for compatibility) ---
ipcMain.handle('run-python-command', async (event, action) => {
  if (action === 'install') {
    return runPythonScript(path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py'));
  }

  return runPythonScript(path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py'));
});