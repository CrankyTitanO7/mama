// ── Step: Python & Tools Detection ────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'python-detect',
    title: 'Python & Tools',
    render: () => `
      <h2>Python & Tools Detection</h2>
      <p>Checking for Python, pip, CMake, and GCC…</p>
      <div id="py-out" class="setup-detect-output">
        <p class="setup-hint">⏳ Running detection…</p>
      </div>
      <div id="py-rescan-wrap" style="display:none; margin-top:12px">
        <button id="py-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
      </div>
      <div id="py-warn" class="setup-warn-msg" style="display:none">
        ⚠️ ${window.__setupUtils.pythonInstallGuide({ reason: 'Python 3.10+ was not found — mama requires 3.10 or higher, and PyTorch publishes no wheels for older versions.' })}
      </div>
    `,
    afterRender: () => {
      runPyScan();
      document.getElementById('py-rescan-btn')?.addEventListener('click', runPyScan);

      async function runPyScan() {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const out     = document.getElementById('py-out');
        const rescanW = document.getElementById('py-rescan-wrap');
        const warn    = document.getElementById('py-warn');
        if (!out) return;
        out.innerHTML = '<p class="setup-hint">⏳ Running detection…</p>';
        try {
          const api = window?.electron;
          if (!api?.runPythonDetect) {
            out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable — restart the app and try again.</p>';
            if (rescanW) rescanW.style.display = 'block';
            return;
          }
          const result = await U.getPythonDetectResult();
          const kv     = U.parseKV(result.stdout);
          S.detected.pythonVersion  = kv['PYTHON_VERSION']  || null;
          S.detected.pipAvailable   = U.boolVal(kv['PIP_AVAILABLE']);
          S.detected.cmakeAvailable = U.boolVal(kv['CMAKE_AVAILABLE']);
          S.detected.gccAvailable   = U.boolVal(kv['GCC_AVAILABLE']);
          const pyOk = !!S.detected.pythonVersion
            && U.versionAtLeast(S.detected.pythonVersion, 3, 10);
          out.innerHTML = `
            <table class="setup-status-table"><tbody>
              <tr><td>${S.detected.pythonVersion ? (pyOk ? '✅' : '⚠️') : '❌'}</td><td>Python</td><td class="setup-hint">${U.escapeHtml(S.detected.pythonVersion || 'not found')}</td></tr>
              <tr><td>${U.okIcon(S.detected.pipAvailable)}</td><td>pip</td><td class="setup-hint">${S.detected.pipAvailable ? 'available' : 'not found'}</td></tr>
              <tr><td>${U.warnIcon(S.detected.cmakeAvailable)}</td><td>CMake <span class="setup-hint">(optional)</span></td><td class="setup-hint">${S.detected.cmakeAvailable ? 'available' : 'not found'}</td></tr>
              <tr><td>${U.warnIcon(S.detected.gccAvailable)}</td><td>GCC / C++ <span class="setup-hint">(optional)</span></td><td class="setup-hint">${S.detected.gccAvailable ? 'available' : 'not found'}</td></tr>
            </tbody></table>
          `;
          if (warn) warn.style.display = pyOk ? 'none' : 'block';
        } catch (e) {
          out.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${U.escapeHtml(e.message)}</p>`;
        } finally {
          if (rescanW) rescanW.style.display = 'block';
        }
      }
    }
  });
})();