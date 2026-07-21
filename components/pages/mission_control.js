// Mission Control – Pre-flight Compatibility Checks
// Runs system-level queries + Python framework import tests

const MC = (() => {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  const CHECKS = [
    { id: 'python',        label: 'Python',        action: 'python',        settingKey: null },
    { id: 'node',          label: 'Node.js',       action: 'node',          settingKey: null },
    { id: 'npm',           label: 'npm',           action: 'npm',           settingKey: null },
    { id: 'git',           label: 'Git',           action: 'git',           settingKey: null },
    { id: 'torch',         label: 'PyTorch',       action: 'import-torch',  settingKey: 'pyt' },
    { id: 'tensorflow',    label: 'TensorFlow',    action: 'import-tf',     settingKey: 'tf' },
    { id: 'docker',        label: 'Docker',        action: 'docker',        settingKey: null },
  ];

  const ICON = { idle: '⏳', pending: '🔄', pass: '✅', fail: '❌', warn: '⚠️', disabled: '🔒' };
  const LABEL = { idle: 'Pending…', pending: 'Checking…', pass: 'Pass', fail: 'Fail', warn: 'Warning', disabled: 'Disabled' };
  const COLOR = { idle: '#666', pending: '#ffc107', pass: '#4caf50', fail: '#f44336', warn: '#ff9800', disabled: '#444' };

  let container = null;
  let cards = {};
  let settings = null;
  let projectFolder = null;

  // ── Load project folder from recents ────────────────────────
  async function loadProjectFolder() {
    try {
      const recents = await window.electron.projectRecentsRead();
      if (recents?.open) {
        projectFolder = recents.open;
      }
    } catch (e) {
      projectFolder = null;
    }
  }

  // ── Load settings ─────────────────────────────────────────

  async function loadSettings() {
    try {
      settings = await window.electron.settingsRead();
    } catch (e) {
      settings = null;
    }
  }

  // ── Check if a framework check should be disabled ──────────
  function isDisabled(settingKey) {
    if (!settingKey || !settings) return false;
    // software information contains tf and pyt booleans
    const si = settings['software information'];
    if (!si) return false;
    // If the setting key is present and false, the framework is deselected → disabled
    if (si[settingKey] === false) return true;
    return false;
  }

  // ── Render ────────────────────────────────────────────────
  async function render(target) {
    container = target;
    container.innerHTML = '';

    // Load settings first so we know which frameworks are active
    await loadSettings();

    // Load project folder from recents for project-scoped checks
    await loadProjectFolder();

    const title = document.createElement('h2');
    title.textContent = '🚀 Pre-Flight Checks';
    container.appendChild(title);

    const flexGrid = document.createElement('div');
    flexGrid.className = 'mc-grid';

    CHECKS.forEach((check) => {
      const card = document.createElement('div');
      card.className = 'mc-card';
      card.dataset.checkId = check.id;
      const disabled = isDisabled(check.settingKey);

      const statusIcon = document.createElement('span');
      statusIcon.className = 'mc-icon';
      statusIcon.textContent = disabled ? ICON.disabled : ICON.idle;

      const info = document.createElement('div');
      info.className = 'mc-info';

      const name = document.createElement('div');
      name.className = 'mc-name';
      name.textContent = check.label;
      if (disabled) name.style.color = '#555';

      const status = document.createElement('div');
      status.className = 'mc-status';
      status.textContent = disabled ? LABEL.disabled : LABEL.idle;
      status.style.color = disabled ? COLOR.disabled : COLOR.idle;

      const detail = document.createElement('div');
      detail.className = 'mc-detail';
      detail.textContent = disabled ? 'Deselected in settings' : '';

      info.appendChild(name);
      info.appendChild(status);
      info.appendChild(detail);

      // If disabled, add a small "check anyway" link
      if (disabled) {
        const checkAnyway = document.createElement('button');
        checkAnyway.className = 'mc-check-anyway';
        checkAnyway.textContent = '▶ check anyway';
        checkAnyway.addEventListener('click', (e) => {
          e.stopPropagation();
          // Unlock the card so setStatus works
          cards[check.id].disabled = false;
          // Run just this check
          runSingleCheck(check.id);
        });
        info.appendChild(checkAnyway);
      }

      card.appendChild(statusIcon);
      card.appendChild(info);
      flexGrid.appendChild(card);

      cards[check.id] = {
        card,
        statusIcon,
        statusEl: status,
        detailEl: detail,
        disabled
      };
    });

    container.appendChild(flexGrid);

    // Run button (skip disabled checks)
    const runBtn = document.createElement('button');
    runBtn.className = 'mc-run-btn';
    runBtn.textContent = '▶ Run All Checks';
    runBtn.addEventListener('click', runAll);
    container.appendChild(runBtn);
  }

  // ── Update UI ─────────────────────────────────────────────
  function setStatus(id, state, detailText) {
    const c = cards[id];
    if (!c) return;
    // Never overwrite disabled state
    if (c.disabled) return;
    c.statusIcon.textContent = ICON[state] || ICON.idle;
    c.statusEl.textContent = LABEL[state] || LABEL.idle;
    c.statusEl.style.color = COLOR[state] || COLOR.idle;
    c.detailEl.textContent = detailText || '';
    c.card.className = 'mc-card mc-card-' + state;
  }

  // ── Individual Checks ──────────────────────────────────────
  async function runCheckPython() {
    setStatus('python', 'pending');
    try {
      const result = await window.electron.runSystemCommand('python', ['--version']);
      if (result.code === 0 && result.stdout) {
        const ver = result.stdout.trim().replace(/^Python\s+/i, '');
        setStatus('python', 'pass', `v${ver}`);
      } else {
        const result3 = await window.electron.runSystemCommand('python3', ['--version']);
        if (result3.code === 0 && result3.stdout) {
          const ver = result3.stdout.trim().replace(/^Python\s+/i, '');
          setStatus('python', 'pass', `v${ver}`);
        } else {
          setStatus('python', 'fail', 'Not found');
        }
      }
    } catch (e) {
      setStatus('python', 'fail', e.message);
    }
  }

  async function runCheckNode() {
    setStatus('node', 'pending');
    try {
      const result = await window.electron.runSystemCommand('node', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('node', 'pass', result.stdout.trim());
      } else {
        setStatus('node', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('node', 'fail', e.message);
    }
  }

  async function runCheckNpm() {
    setStatus('npm', 'pending');
    try {
      const result = await window.electron.runSystemCommand('npm', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('npm', 'pass', `v${result.stdout.trim()}`);
      } else {
        setStatus('npm', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('npm', 'fail', e.message);
    }
  }

  async function runCheckGit() {
    setStatus('git', 'pending');
    try {
      const result = await window.electron.runSystemCommand('git', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('git', 'pass', result.stdout.trim());
      } else {
        setStatus('git', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('git', 'fail', e.message);
    }
  }

  async function runCheckDocker() {
    setStatus('docker', 'pending');
    try {
      const result = await window.electron.runSystemCommand('docker', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('docker', 'pass', result.stdout.trim());
      } else {
        setStatus('docker', 'warn', 'Not installed (optional)');
      }
    } catch (e) {
      setStatus('docker', 'warn', 'Not installed (optional)');
    }
  }

  async function runCheckImportTorch() {
    setStatus('torch', 'pending');
    try {
      const result = await window.electron.runImportTest('torch', projectFolder);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        const verLine = lines.find(l => l.toLowerCase().includes('version'));
        const ver = verLine ? verLine.replace(/.*version:\s*/i, 'v') : 'Installed';
        const hasCuda = result.stdout.toLowerCase().includes('cuda available');
        setStatus('torch', 'pass', `${ver}${hasCuda ? ' 🎮 CUDA' : ' 💻 CPU'}`);
      } else {
        setStatus('torch', 'fail', 'Not installed');
      }
    } catch (e) {
      setStatus('torch', 'fail', e.message);
    }
  }

  async function runCheckImportTf() {
    setStatus('tensorflow', 'pending');
    try {
      const result = await window.electron.runImportTest('tf', projectFolder);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        const verLine = lines.find(l => l.toLowerCase().includes('version'));
        const ver = verLine ? verLine.replace(/.*version:\s*/i, 'v') : 'Installed';
        setStatus('tensorflow', 'pass', ver);
      } else {
        setStatus('tensorflow', 'fail', 'Not installed');
      }
    } catch (e) {
      setStatus('tensorflow', 'fail', e.message);
    }
  }

  // ── Run a single check by id ────────────────────────────────
  async function runSingleCheck(id) {
    switch (id) {
      case 'python':     return runCheckPython();
      case 'node':       return runCheckNode();
      case 'npm':        return runCheckNpm();
      case 'git':        return runCheckGit();
      case 'docker':     return runCheckDocker();
      case 'torch':      return runCheckImportTorch();
      case 'tensorflow': return runCheckImportTf();
    }
  }

  // ── Run All ────────────────────────────────────────────────
  async function runAll() {
    // Reset all to idle first
    CHECKS.forEach(c => setStatus(c.id, 'idle', ''));

    const tasks = [];

    // Only add tasks for non-disabled checks
    CHECKS.forEach((check) => {
      if (cards[check.id] && cards[check.id].disabled) return;
      switch (check.id) {
        case 'python':     tasks.push(runCheckPython()); break;
        case 'node':       tasks.push(runCheckNode()); break;
        case 'npm':        tasks.push(runCheckNpm()); break;
        case 'git':        tasks.push(runCheckGit()); break;
        case 'docker':     tasks.push(runCheckDocker()); break;
        case 'torch':      tasks.push(runCheckImportTorch()); break;
        case 'tensorflow': tasks.push(runCheckImportTf()); break;
      }
    });

    await Promise.allSettled(tasks);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    init: (targetElement) => render(targetElement),
    run: runAll,
  };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('main-box') || document.getElementById('main box');
  if (target) {
    MC.init(target);
  }
});