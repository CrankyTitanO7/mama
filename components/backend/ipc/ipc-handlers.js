/**
 * ipc-handlers.js — Registers all setup-wizard IPC handlers.
 *
 * Usage in main.js:
 *   const { registerIPCHandlers } = require('./electron/ipc-handlers');
 *   registerIPCHandlers(app, settingsFilePath);
 *
 * Exposes:
 *   run-os-detect
 *   run-python-detect
 *   run-gpu-detect
 *   run-install           (fw, gpuVariant, accelVersion?)
 *   run-import-test       (fw)
 *   settings-read
 *   settings-write        (settings)   — backs up first
 *   settings-write-nonbackup (settings)
 *   setup-complete
 */

'use strict';

const { ipcMain, app } = require('electron');
const { spawn }        = require('child_process');
const path             = require('path');
const fs               = require('fs');

// ── Script paths ──────────────────────────────────────────────────────────────

const SCRIPT = {
  osDetect:     path.join(__dirname, '..', 'systemDetect', 'detect_os.py'),
  pythonDetect: path.join(__dirname, '..', 'systemDetect', 'detect_python.py'),
  gpuDetect:    path.join(__dirname, '..', 'systemDetect', 'detect_gpu.py'),
  install:      path.join(__dirname, '..', 'installs', 'install_fw.py'),
  importTest:   path.join(__dirname, '..', 'installs', 'import_test.py'),
};

// ── Python executable resolution ──────────────────────────────────────────────

/**
 * Try to find a working Python 3 interpreter.
 * Checks the candidates in order; returns the first one that's on PATH.
 * On Windows 'py' is the Python Launcher and handles version selection.
 */
function findPython() {
  const { execSync } = require('child_process');
  const candidates   = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 })
        .toString().trim();
      if (/Python 3\./i.test(out)) return cmd;
    } catch (_) {
      // not found or wrong version — try next
    }
  }
  // Return 'python3' as a final guess; the error surface will be clear.
  return 'python3';
}

// Cache the resolved executable for the lifetime of the app.
let _pythonExe = null;
function getPython() {
  if (!_pythonExe) _pythonExe = findPython();
  return _pythonExe;
}

// ── Script runner ─────────────────────────────────────────────────────────────

/**
 * Spawn a Python script and collect all output.
 *
 * @param {string}   scriptPath  Absolute path to the .py file.
 * @param {string[]} args        Command-line arguments for the script.
 * @param {object}   [opts]
 * @param {number}   [opts.timeout]  Kill the process after this many ms (default: 120 000).
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runScript(scriptPath, args = [], opts = {}) {
  const timeout = opts.timeout ?? 120_000;

  return new Promise((resolve) => {
    const python = getPython();
    let stdout   = '';
    let stderr   = '';
    let settled  = false;

    const proc = spawn(python, [scriptPath, ...args], {
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        resolve({ code: 1, stdout, stderr: stderr + '\nProcess timed out.' });
      }
    }, timeout);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 0, stdout, stderr });
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: err.message });
      }
    });
  });
}

// ── Settings helpers ──────────────────────────────────────────────────────────

function readSettings(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeSettings(filePath, settings, backup = true) {
  if (backup && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + '.bak');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * @param {Electron.App}  electronApp
 * @param {string}        settingsFilePath  Absolute path to settings.json.
 */
function registerIPCHandlers(electronApp, settingsFilePath) {

  // ── Detection ────────────────────────────────────────────────────────────

  ipcMain.handle('run-os-detect', async () => {
    return runScript(SCRIPT.osDetect, [], { timeout: 15_000 });
  });

  ipcMain.handle('run-python-detect', async () => {
    return runScript(SCRIPT.pythonDetect, [], { timeout: 15_000 });
  });

  ipcMain.handle('run-gpu-detect', async () => {
    // nvidia-smi / rocm-smi can hang briefly on first call — allow 30 s
    return runScript(SCRIPT.gpuDetect, [], { timeout: 30_000 });
  });

  // ── Install ──────────────────────────────────────────────────────────────
  // fw:            'torch' | 'tf'
  // gpuVariant:    'cuda'  | 'rocm' | 'cpu'
  // accelVersion:  CUDA version string (e.g. '12.1') or ROCm version string
  //                (e.g. '5.7') — pass empty string if unknown.
  //
  // NOTE: setup.js currently calls window.electron.runInstall(fw, gv).
  // Update that call to window.electron.runInstall(fw, gv, accelVersion) to
  // pass the CUDA/ROCm version detected in the GPU Detection step, so the
  // installer can pick the exact right wheel URL.
  ipcMain.handle('run-install', async (_event, fw, gpuVariant, accelVersion = '') => {
    const args = [fw, gpuVariant];
    if (accelVersion) args.push(accelVersion);
    // Long install — allow 20 minutes
    return runScript(SCRIPT.install, args, { timeout: 20 * 60_000 });
  });

  // ── Import test ──────────────────────────────────────────────────────────

  ipcMain.handle('run-import-test', async (_event, fw) => {
    return runScript(SCRIPT.importTest, [fw], { timeout: 60_000 });
  });

  // ── Settings ─────────────────────────────────────────────────────────────

  ipcMain.handle('settings-read', async () => {
    return readSettings(settingsFilePath);
  });

  ipcMain.handle('settings-write', async (_event, settings) => {
    try {
      writeSettings(settingsFilePath, settings, true);
      return true;
    } catch (e) {
      console.error('settings-write failed:', e);
      return false;
    }
  });

  ipcMain.handle('settings-write-nonbackup', async (_event, settings) => {
    try {
      writeSettings(settingsFilePath, settings, false);
      return true;
    } catch (e) {
      console.error('settings-write-nonbackup failed:', e);
      return false;
    }
  });

  // ── Setup complete ────────────────────────────────────────────────────────
  // Flip the setup flag in settings and emit an event for main.js to handle
  // (e.g. navigate to the main window or reload the BrowserWindow).

  ipcMain.handle('setup-complete', async () => {
    try {
      const settings = readSettings(settingsFilePath) || {};
      if (!settings['general settings']) settings['general settings'] = {};
      settings['general settings'].setup = false;   // mark setup done
      writeSettings(settingsFilePath, settings, false);

      // Signal main.js — listen for 'frank:setup-complete' there
      electronApp.emit('frank:setup-complete');
      return true;
    } catch (e) {
      console.error('setup-complete failed:', e);
      return false;
    }
  });
}

module.exports = { registerIPCHandlers, runScript, getPython };