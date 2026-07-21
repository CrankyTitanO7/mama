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
 *   settings-write        (settings) — backs up first
 *   settings-write-nonbackup (settings)
 *   setup-complete
 */

'use strict';

const { ipcMain, app, dialog, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Script paths ──────────────────────────────────────────────────────────────

const SCRIPT = {
  osDetect: path.join(__dirname, '..', 'systemDetect', 'detect_os.py'),
  pythonDetect: path.join(__dirname, '..', 'systemDetect', 'detect_python.py'),
  gpuDetect: path.join(__dirname, '..', 'systemDetect', 'detect_gpu.py'),
  compatCheck: path.join(__dirname, '..', 'systemDetect', 'check_compatibility.py'),
  install: path.join(__dirname, '..', 'installs', 'install_fw.py'),
  importTest: path.join(__dirname, '..', 'installs', 'import_test.py'),
};

// ── Python executable resolution ──────────────────────────────────────────────

/**
 * Try to find a working Python 3 interpreter.
 * Checks the candidates in order; returns the first one that's on PATH.
 * On Windows 'py' is the Python Launcher and handles version selection.
 * Returns null if no Python 3 is found.
 */
function findPython() {
  const { execSync } = require('child_process');
  const candidates = process.platform === 'win32'
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
  return null;
}

// Cache the resolved executable for the lifetime of the app.
// undefined = not yet checked, null = checked and not found, string = found
let _pythonExe;
function getPython() {
  if (_pythonExe === undefined) _pythonExe = findPython();
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
    if (!python) {
      resolve({ code: 1, stdout: '', stderr: 'Python 3 not found on PATH.' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

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
  resetSettingsToTemplate,
  settingsBackupExists,
  restoreSettingsFromBackup,
} = require('../settings-store');

const {
  readRecents,
  openProjectFolder,
  listDirectory,
  addRecentFolder,
} = require('../project-store');

const {
  readCustomThemes,
} = require('../../styling/theme-loader');

const { importTemplate } = require('../template-download/template_download');

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

  // ── Compatibility check ──────────────────────────────────────────────────
  // Uses the detected system information to validate hardware/OS/architecture
  // minimum requirements. Takes all detected values as arguments.
  ipcMain.handle('run-compatibility-check', async (
    _event,
    { osFamily, osVersion, arch, gpuMfr, gpuName, gpuVramMB, cudaVer, rocmVer, metalVer, mpsAvail, pythonVer }
  ) => {
    const args = [
      '--os-family', osFamily || '',
      '--os-version', osVersion || '',
      '--arch', arch || '',
      '--gpu-mfr', gpuMfr || '',
      '--gpu-name', gpuName || '',
      '--gpu-vram-mb', String(gpuVramMB || ''),
      '--cuda-ver', cudaVer || '',
      '--rocm-ver', rocmVer || '',
      '--metal-ver', metalVer || '',
      '--mps-avail', mpsAvail || '',
      '--python-ver', pythonVer || '',
    ];
    return runScript(SCRIPT.compatCheck, args, { timeout: 30_000 });
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
   //   event.sender.send('install-progress', { type: 'stdout'|'stderr', text })
   // and sends a final message when done:
   //   event.sender.send('install-progress', { type: 'done', code })
   // scope: 'global' | 'project' — determines whether to use venv or system python
   // projectFolder: path to project folder (required for 'project' scope)
   ipcMain.handle('run-install-stream', async (event, fw, gpuVariant, accelVersion = '', scope = 'global', projectFolder = '') => {
     let args = [fw, gpuVariant];
     if (accelVersion) args.push(accelVersion);

     const osInfo = getOsInfo();
     args.push('--os-family', osInfo.osFamily);
     args.push('--distro', osInfo.distro);

     const timeout = 20 * 60_000;

     // For project scope, we need to use the venv's python if it exists, or create it first
     let python = getPython();
     let venvPath = null;

     if (scope === 'project' && projectFolder) {
       venvPath = path.join(projectFolder, '.venv');
       // Check if .venv exists and has a python executable
       const venvPython = process.platform === 'win32' 
         ? path.join(venvPath, 'Scripts', 'python.exe')
         : path.join(venvPath, 'bin', 'python');
       
       if (fs.existsSync(venvPython)) {
         python = venvPython;
       } else {
         // No .venv yet — need to create one first
         if (!python) {
           event.sender.send('install-progress', { type: 'stderr', text: 'Python 3 not found on PATH.' });
           event.sender.send('install-progress', { type: 'done', code: 1 });
           return { code: 1 };
         }
         // Create .venv
         const venvCreated = await new Promise((resolveVenv) => {
           const venvProc = spawn(python, ['-m', 'venv', venvPath], {
             env: { ...process.env },
             cwd: projectFolder,
           });
           venvProc.on('close', (code) => {
             if (code === 0) {
               python = process.platform === 'win32' 
                 ? path.join(venvPath, 'Scripts', 'python.exe')
                 : path.join(venvPath, 'bin', 'python');
               resolveVenv(true);
             } else {
               event.sender.send('install-progress', { type: 'stderr', text: '.venv creation failed.' });
               event.sender.send('install-progress', { type: 'done', code: 1 });
               resolveVenv(false);
             }
           });
           venvProc.on('error', (err) => {
             event.sender.send('install-progress', { type: 'stderr', text: `Failed to create .venv: ${err.message}` });
             event.sender.send('install-progress', { type: 'done', code: 1 });
             resolveVenv(false);
           });
         });
         if (!venvCreated) {
           return { code: 1 };
         }
       }
     }

     return new Promise((resolve) => {
       if (!python) {
         event.sender.send('install-progress', { type: 'done', code: 1 });
         resolve({ code: 1 });
         return;
       }

       let settled = false;

       const proc = spawn(python, [SCRIPT.install, ...args], {
         env: { ...process.env },
       });

       const timer = setTimeout(() => {
         if (!settled) {
           settled = true;
           proc.kill();
           event.sender.send('install-progress', { type: 'done', code: 1 });
           resolve({ code: 1 });
         }
       }, timeout);

       proc.stdout.on('data', (data) => {
         event.sender.send('install-progress', { type: 'stdout', text: data.toString() });
       });

       proc.stderr.on('data', (data) => {
         event.sender.send('install-progress', { type: 'stderr', text: data.toString() });
       });

       proc.on('close', (code) => {
         if (!settled) {
           settled = true;
           clearTimeout(timer);
           event.sender.send('install-progress', { type: 'done', code: code ?? 0 });
           resolve({ code: code ?? 0 });
         }
       });

       proc.on('error', (err) => {
         if (!settled) {
           settled = true;
           clearTimeout(timer);
           event.sender.send('install-progress', { type: 'done', code: 1 });
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

  ipcMain.handle('settings-reset', async () => {
    try {
      return resetSettingsToTemplate(settingsFilePath);
    } catch (e) {
      console.error('settings-reset failed:', e);
      return null;
    }
  });

  ipcMain.handle('settings-backup-exists', async () => {
    return settingsBackupExists(settingsFilePath);
  });

  ipcMain.handle('settings-restore-backup', async () => {
    try {
      return restoreSettingsFromBackup(settingsFilePath);
    } catch (e) {
      console.error('settings-restore-backup failed:', e);
      return null;
    }
  });

  // ── Project / folder explorer ───────────────────────────────────────────

  ipcMain.handle('project-recents-read', async () => {
    return readRecents();
  });

  ipcMain.handle('project-pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('project-open-folder', async (_event, folderPath) => {
    try {
      if (!folderPath) return null;
      return openProjectFolder(folderPath);
    } catch (e) {
      console.error('project-open-folder failed:', e);
      return null;
    }
  });

  ipcMain.handle('project-list-folder', async (_event, folderPath) => {
    try {
      if (!folderPath) return null;
      const entries = listDirectory(folderPath);
      if (!entries) return null;
      return { path: folderPath, entries };
    } catch (e) {
      console.error('project-list-folder failed:', e);
      return null;
    }
  });

  ipcMain.handle('project-reveal-folder', async (_event, folderPath) => {
    try {
      if (!folderPath) return false;
      const result = await shell.openPath(folderPath);
      return result === '';
    } catch (e) {
      console.error('project-reveal-folder failed:', e);
      return false;
    }
  });

  ipcMain.handle('project-templates-read', async () => {
    try {
      const { readTemplates } = require('../template-download/template_download');
      return readTemplates();
    } catch (e) {
      console.error('project-templates-read failed:', e);
      return {};
    }
  });

  ipcMain.handle('project-import-template', async (_event, templateKey) => {
    try {
      return await importTemplate(templateKey);
    } catch (e) {
      console.error('project-import-template failed:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Project init check ──────────────────────────────────────────────────
  // Checks if a folder has project.json and .venv
  ipcMain.handle('project-init', async (_event, folderPath) => {
    try {
      if (!folderPath) return { hasProjectJson: false, hasVenv: false };
      const projectJsonPath = path.join(folderPath, 'project.json');
      const venvPath = path.join(folderPath, '.venv');
      return {
        hasProjectJson: fs.existsSync(projectJsonPath),
        hasVenv: fs.existsSync(venvPath) && fs.statSync(venvPath).isDirectory(),
      };
    } catch (e) {
      console.error('project-init failed:', e);
      return { hasProjectJson: false, hasVenv: false };
    }
  });

  // ── Create project.json ─────────────────────────────────────────────────
  ipcMain.handle('project-create-json', async (_event, folderPath) => {
    try {
      if (!folderPath) return { success: false, error: 'No folder path provided.' };
      const projectJsonPath = path.join(folderPath, 'project.json');
      if (fs.existsSync(projectJsonPath)) {
        return { success: true, message: 'project.json already exists.' };
      }
      const projectJson = {
        name: path.basename(folderPath),
        version: '0.1.0',
        description: '',
        framework: null,
        created: new Date().toISOString(),
      };
      fs.writeFileSync(projectJsonPath, JSON.stringify(projectJson, null, 2), 'utf8');
      return { success: true, message: 'project.json created.' };
    } catch (e) {
      console.error('project-create-json failed:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Create .venv ────────────────────────────────────────────────────────
  ipcMain.handle('project-create-venv', async (_event, folderPath) => {
    try {
      if (!folderPath) return { success: false, error: 'No folder path provided.' };
      const venvPath = path.join(folderPath, '.venv');
      if (fs.existsSync(venvPath)) {
        return { success: true, message: '.venv already exists.' };
      }
      const python = getPython();
      if (!python) {
        return { success: false, error: 'Python 3 not found on PATH. Install Python 3.8+ to create a virtual environment.' };
      }
      return new Promise((resolve) => {
        const proc = spawn(python, ['-m', 'venv', venvPath], {
          env: { ...process.env },
          cwd: folderPath,
        });
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, message: '.venv created.' });
          } else {
            resolve({ success: false, error: stderr || 'Failed to create .venv.' });
          }
        });
        proc.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    } catch (e) {
      console.error('project-create-venv failed:', e);
      return { success: false, error: e.message };
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

  // ── Torch commands ────────────────────────────────────────────────────────
  // Reads the torchCommands.json file for the installation matrix.
  ipcMain.handle('torch-commands-read', async () => {
    try {
      const commandsPath = path.join(__dirname, '..', '..', 'setup', 'torchCommands.json');
      const content = fs.readFileSync(commandsPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error('torch-commands-read failed:', e);
      return {};
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

      // Signal main.js — listen for 'mama:setup-complete' there
      electronApp.emit('mama:setup-complete');
      return true;
    } catch (e) {
      console.error('setup-complete failed:', e);
      return false;
    }
  });
}

module.exports = { registerIPCHandlers, runScript, getPython };