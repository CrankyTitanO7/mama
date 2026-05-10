const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

const SETTINGS_PATH = path.join(__dirname, 'user', 'settings.json');

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf8');
  return true;
}

const createWindow = (page) => {
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
  // mainWindow.webContents.openDevTools(); // Uncomment to open DevTools
};

app.on('ready', () => {
  // Check if setup is needed
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

// --- IPC: Settings ---

ipcMain.handle('settings-read', async () => {
  return loadSettings();
});

ipcMain.handle('settings-write', async (event, settings) => {
  return saveSettings(settings);
});

ipcMain.handle('settings-setup-complete', async () => {
  const settings = loadSettings();
  if (settings && settings['general settings']) {
    settings['general settings'].setup = false;
    saveSettings(settings);
  }
  // Reload to main page after setup
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

// --- IPC: Python (existing) ---

ipcMain.handle('run-python-command', async (event, action) => {
  return new Promise((resolve) => {
    let command, args;
    
    if (action === 'install') {
      command = 'pip3';
      args = ['install', 'torch', 'torchvision', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu'];
    } else {
      command = 'python3';
      args = [path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py')];
    }
    
    const process = spawn(command, args);
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
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