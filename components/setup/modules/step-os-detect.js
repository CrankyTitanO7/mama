// ── Step: OS Detection ────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'os-detect',
    title: 'OS Detection',
    render: () => `
      <h2>Operating System Detection</h2>
      <p>Detecting your operating system…</p>
      <div id="os-out" class="setup-detect-output">
        <p class="setup-hint">⏳ Running detection…</p>
      </div>
      <div id="os-py-missing" style="display:none" class="setup-warn-msg">
        <p style="font-weight:bold; margin-top:0">⚠️ Python not detected</p>
        <p>Auto-detection requires Python 3.8+. Please install it, then click <strong>Re-scan</strong>, or fill in the details manually below.</p>
        <p>Download from <a href="https://www.python.org/downloads/" target="_blank">python.org</a></p>
      </div>
      <div id="os-fields" style="display:none">
        <div class="setup-field">
          <label>OS Full Name <span class="setup-hint">— e.g. Windows 11 Pro 24H2</span></label>
          <input type="text" id="setup-os-full" class="setup-input">
        </div>
        <div class="setup-field">
          <label>OS Pretty Name <span class="setup-hint">— e.g. Windows 11 Pro</span></label>
          <input type="text" id="setup-os-pretty" class="setup-input">
        </div>
        <div class="setup-field">
          <label>Kernel / Build <span class="setup-hint">— e.g. 10.0.26100 / 5.15.0-89-generic</span></label>
          <input type="text" id="setup-os-kernel" class="setup-input">
        </div>
        <div class="setup-field">
          <label>Architecture <span class="setup-hint">— e.g. arm64 / x86_64</span></label>
          <input type="text" id="setup-arch" class="setup-input">
        </div>
        <button id="os-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
      </div>
    `,
    afterRender: () => {
      runOSScan();
      document.getElementById('os-rescan-btn')?.addEventListener('click', runOSScan);

      async function runOSScan() {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const out      = document.getElementById('os-out');
        const fields   = document.getElementById('os-fields');
        const pyMissing = document.getElementById('os-py-missing');
        if (!out) return;
        out.innerHTML = '<p class="setup-hint">⏳ Running detection…</p>';
        if (pyMissing) pyMissing.style.display = 'none';

        try {
          const api = window?.electron;

          // First check if Python is available — detection scripts depend on it
          let pythonOk = false;
          if (api?.runPythonDetect) {
            const pyResult = await U.getPythonDetectResult();
            const pyKv = U.parseKV(pyResult.stdout);
            pythonOk = !!pyKv['PYTHON_VERSION'];
          }

          if (!pythonOk) {
            out.innerHTML = '<div class="setup-error-msg">❌ Python 3 not found — auto-detection unavailable.</div>';
            if (pyMissing) pyMissing.style.display = 'block';
            if (window?.versions?.arch) {
              S.detected.arch = window.versions.arch();
              const archEl = document.getElementById('setup-arch');
              if (archEl) archEl.value = S.detected.arch;
            }
            if (fields) fields.style.display = 'block';
            return;
          }

          if (!api?.runOSDetect) {
            out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable — restart the app and try again.</p>';
            if (fields) fields.style.display = 'block';
            return;
          }
          const result = await api.runOSDetect();
          const kv     = U.parseKV(result.stdout);
          S.detected.osFullName   = kv['OS_FULL']   || '';
          S.detected.osPrettyName = kv['OS_PRETTY'] || '';
          S.detected.osKernel     = kv['OS_KERNEL'] || '';
          S.detected.arch         = kv['ARCH'] || S.detected.arch || window?.versions?.arch?.() || '';

          out.innerHTML = S.detected.osFullName
            ? `<div class="setup-success-msg">✅ <strong>${U.escapeHtml(S.detected.osFullName)}</strong></div>`
            : '<div class="setup-error-msg">⚠️ Could not auto-detect OS — fill in manually below.</div>';

          const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
          set('setup-os-full',   S.detected.osFullName);
          set('setup-os-pretty', S.detected.osPrettyName);
          set('setup-os-kernel', S.detected.osKernel);
          set('setup-arch',      S.detected.arch);

          if (result.stderr && result.code !== 0)
            out.innerHTML += `<pre class="setup-pre setup-pre-error">${U.escapeHtml(result.stderr)}</pre>`;
        } catch (e) {
          out.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${U.escapeHtml(e.message)}</p>`;
        } finally {
          if (fields) fields.style.display = 'block';
        }
      }
    },
    collect: () => {
      const S = window.__setupState;
      S.detected.osFullName   = document.getElementById('setup-os-full')?.value   || S.detected.osFullName;
      S.detected.osPrettyName = document.getElementById('setup-os-pretty')?.value || S.detected.osPrettyName;
      S.detected.osKernel     = document.getElementById('setup-os-kernel')?.value || S.detected.osKernel;
      S.detected.arch         = document.getElementById('setup-arch')?.value      || S.detected.arch;
      return { 'OS full': S.detected.osFullName, 'OS pretty': S.detected.osPrettyName, 'OS kernel': S.detected.osKernel, 'Architecture': S.detected.arch };
    }
  });
})();