// ── Step: Framework Verification ──────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'fw-verify',
    title: 'Verify Install',
    render: () => {
      const S = window.__setupState;
      const fwName = S.selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
      return `
        <h2>Verify ${fwName}</h2>
        <p>Run a quick import test to confirm <strong>${fwName}</strong> is working correctly.</p>
        <div id="verify-status"  class="setup-detect-output" style="display:none"></div>
        <div id="verify-install" class="setup-detect-output" style="display:none"></div>
        <button id="run-verify-btn" class="setup-btn setup-btn-primary">▶ Run Import Test</button>
      `;
    },
    afterRender: () => {
      document.getElementById('run-verify-btn')?.addEventListener('click', async () => {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const testBtn    = document.getElementById('run-verify-btn');
        const statusDiv  = document.getElementById('verify-status');
        const installDiv = document.getElementById('verify-install');
        const fw         = S.selectedFramework || 'torch';
        const fwName     = fw === 'tf' ? 'TensorFlow' : 'PyTorch';
        if (!statusDiv) return;

        statusDiv.style.display = 'block';
        statusDiv.innerHTML     = '<p class="setup-hint">⏳ Running import test…</p>';
        testBtn.disabled        = true;
        testBtn.style.opacity   = '0.5';

        try {
          const result = await window.electron.runImportTest(fw, S.selectedProjectFolder);
          if (result.code === 0) {
            statusDiv.innerHTML = `
              <div class="setup-success-msg">✅ ${fwName} is working!</div>
              <pre class="setup-pre">${U.escapeHtml(result.stdout)}</pre>
            `;
            testBtn.textContent   = '✓ Verified';
            testBtn.style.opacity = '0.7';
          } else {
            statusDiv.innerHTML = `
              <div class="setup-error-msg">❌ ${fwName} import failed</div>
              <pre class="setup-pre setup-pre-error">${U.escapeHtml(result.stdout || result.stderr || 'Unknown error')}</pre>
              <p>Would you like to retry the install?</p>
              <button id="retry-install-btn" class="setup-btn setup-btn-success">⬇️ Retry Install</button>
            `;
            if (installDiv) installDiv.style.display = 'none';

            document.getElementById('retry-install-btn')?.addEventListener('click', async () => {
              const retryBtn = document.getElementById('retry-install-btn');
              if (installDiv) { installDiv.style.display = 'block'; installDiv.innerHTML = '<p class="setup-hint">⏳ Installing…</p>'; }
              if (retryBtn)   { retryBtn.disabled = true; retryBtn.textContent = '⏳ Installing…'; }

              try {
                const scope = document.getElementById('install-scope')?.value || 'global';
                const accelVersion = S.detected.cudaVersion || S.detected.rocmVersion || '';
                const ir = await window.electron.runInstallStream(fw, U.gpuVariant(), accelVersion, scope, S.selectedProjectFolder);
                if (installDiv) {
                  installDiv.innerHTML = ir.code === 0
                    ? `<div class="setup-success-msg">✅ Installed!</div><pre class="setup-pre">${U.escapeHtml((ir.stdout || '').slice(0, 500))}</pre>`
                    : `<div class="setup-error-msg">❌ Failed</div><pre class="setup-pre setup-pre-error">${U.escapeHtml(ir.stderr || ir.stdout || '')}</pre>`;
                }
                if (ir.code === 0) {
                  statusDiv.innerHTML = '<p class="setup-hint">⏳ Re-testing…</p>';
                  const retest = await window.electron.runImportTest(fw, S.selectedProjectFolder);
                  statusDiv.innerHTML = retest.code === 0
                    ? `<div class="setup-success-msg">✅ ${fwName} verified!</div><pre class="setup-pre">${U.escapeHtml(retest.stdout || '')}</pre>`
                    : `<div class="setup-error-msg">❌ Still failing — check the install output.</div><pre class="setup-pre setup-pre-error">${U.escapeHtml(retest.stderr || retest.stdout || '')}</pre>`;
                  if (retryBtn) retryBtn.textContent = '✓ Done';
                } else {
                  if (retryBtn) { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
                }
              } catch (e) {
                if (installDiv) installDiv.innerHTML = `<p class="setup-hint">⚠️ ${U.escapeHtml(e.message)}</p>`;
                if (retryBtn)   { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
              }
            });
          }
        } catch (e) {
          statusDiv.innerHTML = `<p class="setup-hint">⚠️ Test error: ${U.escapeHtml(e.message)}</p>`;
        } finally {
          testBtn.disabled      = false;
          testBtn.style.opacity = '1';
        }
      });
    },
    collect: () => ({
      importSucceeded: document.getElementById('verify-status')?.textContent.includes('✅') || false,
      framework:       window.__setupState.selectedFramework || 'torch',
    })
  });
})();