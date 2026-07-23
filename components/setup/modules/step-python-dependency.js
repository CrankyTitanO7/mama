// ── Step: Python Dependency ───────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'python-dependency',
    title: 'Python Dependency',
    render: () => `
      <h2>Python Dependency Check</h2>
      <p>Python is a required dependency for mama. It is used for:</p>
      <ul style="line-height:1.8; margin-bottom:16px">
        <li>Installing and running AI frameworks (PyTorch, TensorFlow)</li>
        <li>Creating and managing virtual environments (.venv)</li>
        <li>Running Python-based tools and scripts</li>
      </ul>
      <div id="py-dep-out" class="setup-detect-output">
        <p class="setup-hint">Checking for Python 3…</p>
      </div>
      <div id="py-dep-detail" style="display:none; margin-top:12px">
        <table class="setup-status-table"><tbody id="py-dep-tbody"></tbody></table>
      </div>
      <div id="py-dep-warn" class="setup-warn-msg" style="display:none">
        <p style="font-weight:bold; margin-top:0">❌ Python 3 not found!</p>
        <p>mama requires Python 3.8 or higher to function. Please install it from:</p>
        <ul>
          <li><strong>macOS:</strong> <code>brew install python</code> or download from <a href="https://www.python.org/downloads/" target="_blank">python.org</a></li>
          <li><strong>Linux:</strong> <code>sudo apt install python3 python3-venv python3-pip</code> (Debian/Ubuntu) or <code>sudo dnf install python3</code> (Fedora)</li>
          <li><strong>Windows:</strong> Download from <a href="https://www.python.org/downloads/" target="_blank">python.org</a> — ensure "Add Python to PATH" is checked</li>
        </ul>
        <p style="margin-bottom:0">After installing, click <strong>Re-check</strong> below.</p>
      </div>
      <div id="py-dep-rescan-wrap" style="display:none; margin-top:12px">
        <button id="py-dep-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-check</button>
      </div>
    `,
    afterRender: async () => {
      async function runPyDepScan() {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const out     = document.getElementById('py-dep-out');
        const detail  = document.getElementById('py-dep-detail');
        const warn    = document.getElementById('py-dep-warn');
        const rescanW = document.getElementById('py-dep-rescan-wrap');
        if (!out) return;
        out.innerHTML = '<p class="setup-hint">⏳ Checking for Python 3…</p>';
        if (warn) warn.style.display = 'none';
        if (detail) detail.style.display = 'none';

        try {
          const api = window?.electron;
          if (!api?.runPythonDetect) {
            out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable.</p>';
            if (rescanW) rescanW.style.display = 'block';
            return;
          }
          const result = await U.getPythonDetectResult();
          const kv = U.parseKV(result.stdout);
          const pythonVer = kv['PYTHON_VERSION'] || null;
          const pipAvail  = U.boolVal(kv['PIP_AVAILABLE']);

          const tbody = document.getElementById('py-dep-tbody');
          if (tbody) {
            tbody.innerHTML = `
              <tr><td>${pythonVer ? '✅' : '❌'}</td><td>Python 3</td><td class="setup-hint">${U.escapeHtml(pythonVer || 'not found')}</td></tr>
              <tr><td>${pipAvail ? '✅' : '❌'}</td><td>pip</td><td class="setup-hint">${pipAvail ? 'available' : 'not found'}</td></tr>
              <tr><td>${pythonVer ? '✅' : '⏳'}</td><td>Python venv support</td><td class="setup-hint">${pythonVer ? 'available (python3 -m venv)' : 'unavailable without Python'}</td></tr>
            `;
          }

          if (pythonVer) {
            out.innerHTML = `<div class="setup-success-msg">✅ Python ${U.escapeHtml(pythonVer)} detected</div>`;
            if (detail) detail.style.display = 'block';
            if (warn) warn.style.display = 'none';
          } else {
            out.innerHTML = '<div class="setup-error-msg">❌ Python 3 not found</div>';
            if (warn) warn.style.display = 'block';
            if (detail) detail.style.display = 'block';
          }
        } catch (e) {
          out.innerHTML = `<p class="setup-hint">⚠️ Check failed: ${U.escapeHtml(e.message)}</p>`;
        } finally {
          if (rescanW) rescanW.style.display = 'block';
        }
      }

      try {
        await runPyDepScan();
        document.getElementById('py-dep-rescan-btn')?.addEventListener('click', runPyDepScan);
      } catch (e) {
        console.error('Python dependency scan failed:', e);
      }
    }
  });
})();