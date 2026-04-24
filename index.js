const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment to open DevTools
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('run-python-command', async (event, action) => {
  return new Promise((resolve) => {
    let command, args;
    
    if (action === 'install') {
      // Install PyTorch dependencies
      command = 'pip3';
      args = ['install', 'torch', 'torchvision', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu'];
    } else {
      // Run the pytorch runner script
      command = 'python3';
      args = [path.join(__dirname, 'components', 'python', 'tests', 'pytorch_test.py')];
    }
    
    const process = 
    spawn(command, args);
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
    createWindow();
  }
});
