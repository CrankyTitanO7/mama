// Mission Control – Pre-flight Compatibility Checks
// Runs system-level queries + Python framework import tests

const MC = (() => {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  const CHECKS = [
    { id: 'python',        label: 'Python',        action: 'python' },
    { id: 'node',          label: 'Node.js',       action: 'node' },
    { id: 'npm',           label: 'npm',           action: 'npm' },
    { id: 'git',           label: 'Git',           action: 'git' },
    { id: 'torch',         label: 'PyTorch',       action: 'import-torch' },
    { id: 'tensorflow',    label: 'TensorFlow',    action: 'import-tf' },
    { id: 'docker',        label: 'Docker',        action: 'docker' },
  ];

  const ICON = { idle: '⏳', pending: '🔄', pass: '✅', fail: '❌', warn: '⚠️' };
  const LABEL = { idle: 'Pending…', pending: 'Checking…', pass: 'Pass', fail: 'Fail', warn: 'Warning' };
  const COLOR = { idle: '#666', pending: '#ffc107', pass: '#4caf50', fail: '#f44336', warn: '#ff9800' };

  let container = null;
  let cards = {};

  // ── Render ────────────────────────────────────────────────
  function render(target) {
    container = target;
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = '🚀 Pre-Flight Checks';
    container.appendChild(title);

    const flexGrid = document.createElement('div');
    flexGrid.className = 'mc-grid';

    CHECKS.forEach((check) => {
      const card = document.createElement('div');
      card.className = 'mc-card';
      card.dataset.checkId = check.id;

      const statusIcon = document.createElement('span');
      statusIcon.className = 'mc-icon';
      statusIcon.textContent = ICON.idle;

      const info = document.createElement('div');
      info.className = 'mc-info';

      const name = document.createElement('div');
      name.className = 'mc-name';
      name.textContent = check.label;

      const status = document.createElement('div');
      status.className = 'mc-status';
      status.textContent = LABEL.idle;
      status.style.color = COLOR.idle;

      const detail = document.createElement('div');
      detail.className = 'mc-detail';
      detail.textContent = '';

      info.appendChild(name);
      info.appendChild(status);
      info.appendChild(detail);

      card.appendChild(statusIcon);
      card.appendChild(info);
      flexGrid.appendChild(card);

      cards[check.id] = { card, statusIcon, statusEl: status, detailEl: detail };
    });

    container.appendChild(flexGrid);

    // Run button
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
    c.statusIcon.textContent = ICON[state] || ICON.idle;
    c.statusEl.textContent = LABEL[state] || LABEL.idle;
    c.statusEl.style.color = COLOR[state] || COLOR.idle;
    c.detailEl.textContent = detailText || '';
    // Add class for styling
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
        // Try python3 on non-Windows
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
      const result = await window.electron.runImportTest('torch');
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
      const result = await window.electron.runImportTest('tf');
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

  // ── Run All ────────────────────────────────────────────────
  async function runAll() {
    // Reset all to pending
    CHECKS.forEach(c => setStatus(c.id, 'idle', ''));

    // Run in parallel
    const tasks = [
      runCheckPython(),
      runCheckNode(),
      runCheckNpm(),
      runCheckGit(),
      runCheckDocker(),
      runCheckImportTorch(),
      runCheckImportTf(),
    ];

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