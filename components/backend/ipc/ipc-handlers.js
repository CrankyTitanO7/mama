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

const {
  readSettings: readSettingsFromStore,
  readDescriptions,
} = require('../settings-store');

const {
  readCustomThemes,
} = require('../../styling/theme-loader');

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
    // nvidia-smi / rocm-smi can hang briefly on first call.
    // macOS system_profiler SPDisplaysDataType may take 10–20 s on some machines,
    // and the metal detector calls both ioreg + system_profiler — allow 90 s total.
    return runScript(SCRIPT.gpuDetect, [], { timeout: 90_000 });
  });

  // ── OS info helper ─────────────────────────────────────────────────────────
  // Quick OS detection for passing to install script (avoids re-detection in Python)
  let _osInfo = null;
  function getOsInfo() {
    if (_osInfo) return _osInfo;

    const platform = process.platform;
    let osFamily = 'unknown';
    let distro = 'unknown';

    if (platform === 'win32') {
      osFamily = 'windows';
      distro = 'unknown';
    } else if (platform === 'darwin') {
      osFamily = 'macos';
      // Check for Homebrew
      try {
        const { execSync } = require('child_process');
        execSync('which brew', { stdio: 'pipe', timeout: 5000 });
        distro = 'homebrew';
      } catch (_) {
        distro = 'unknown';
      }
    } else if (platform === 'linux') {
      osFamily = 'linux';
      // Read /etc/os-release for distro info
      try {
        const fs = require('fs');
        const content = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
        if (content.includes('ubuntu') || content.includes('debian')) {
          distro = 'debian-based';
        } else if (content.includes('fedora') || content.includes('rhel') || content.includes('centos')) {
          distro = 'fedora-based';
        } else if (content.includes('arch') || content.includes('manjaro')) {
          distro = 'arch-based';
        } else if (content.includes('opensuse') || content.includes('suse')) {
          distro = 'suse-based';
        } else if (content.includes('alpine')) {
          distro = 'alpine';
        }
      } catch (_) {
        distro = 'unknown';
      }
    }

    _osInfo = { osFamily, distro };
    return _osInfo;
  }

  // ── Install (non-streaming, kept for backward compat) ────────────────────
  ipcMain.handle('run-install', async (_event, fw, gpuVariant, accelVersion = '') => {
    const args = [fw, gpuVariant];
    if (accelVersion) args.push(accelVersion);

    const osInfo = getOsInfo();
    args.push('--os-family', osInfo.osFamily);
    args.push('--distro', osInfo.distro);

    return runScript(SCRIPT.install, args, { timeout: 20 * 60_000 });
  });

  // ── Install (streaming) ─────────────────────────────────────────────────
  // Streams stdout/stderr chunks to the renderer in real-time via
  //   event.sender.send('install-chunk', { type: 'stdout'|'stderr', text })
  // and sends a final message when done:
  //   event.sender.send('install-chunk', { type: 'done', code })
  ipcMain.handle('run-install-stream', async (event, fw, gpuVariant, accelVersion = '') => {
    const args = [fw, gpuVariant];
    if (accelVersion) args.push(accelVersion);

    const osInfo = getOsInfo();
    args.push('--os-family', osInfo.osFamily);
    args.push('--distro', osInfo.distro);

    const timeout = 20 * 60_000;

    return new Promise((resolve) => {
      const python = getPython();
      let settled = false;

      const proc = spawn(python, [SCRIPT.install, ...args], {
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          event.sender.send('install-chunk', { type: 'done', code: 1 });
          resolve({ code: 1 });
        }
      }, timeout);

      proc.stdout.on('data', (data) => {
        event.sender.send('install-chunk', { type: 'stdout', text: data.toString() });
      });

      proc.stderr.on('data', (data) => {
        event.sender.send('install-chunk', { type: 'stderr', text: data.toString() });
      });

      proc.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          event.sender.send('install-chunk', { type: 'done', code: code ?? 0 });
          resolve({ code: code ?? 0 });
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          event.sender.send('install-chunk', { type: 'done', code: 1 });
          resolve({ code: 1 });
        }
      });
    });
  });

  // ── Import test ──────────────────────────────────────────────────────────

  ipcMain.handle('run-import-test', async (_event, fw) => {
    return runScript(SCRIPT.importTest, [fw], { timeout: 60_000 });
  });

  // ── Settings ─────────────────────────────────────────────────────────────

  ipcMain.handle('settings-read', async () => {
    return readSettingsFromStore(settingsFilePath);
  });

  ipcMain.handle('settings-descriptions-read', async () => {
    return readDescriptions();
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

  // ── Custom themes ───────────────────────────────────────────────────────

  ipcMain.handle('themes-read', async () => {
    return readCustomThemes();
  });

  ipcMain.handle('themes-write', async (_event, theme) => {
    try {
      const { writeCustomTheme } = require('../../styling/theme-loader');
      return writeCustomTheme(theme);
    } catch (e) {
      console.error('themes-write failed:', e);
      return false;
    }
  });

  // ── Setup complete ────────────────────────────────────────────────────────
  // Flip the setup flag in settings and emit an event for main.js to handle
  // (e.g. navigate to the main window or reload the BrowserWindow).

  ipcMain.handle('setup-complete', async () => {
    try {
      const settings = readSettingsFromStore(settingsFilePath) || {};
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