// ── Step: System Compatibility ───────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'compat-check',
    title: 'System Compatibility',
    render: (settings) => {
      const S = window.__setupState;
      const mode = settings['hardware settings']?.mode || S.selectedMode;
      return `
        <h2>System Compatibility</h2>
        <p>Choose the runtime mode for the framework install, then review compatibility below.</p>
        <div class="setup-radio-group" style="margin-bottom:12px">
          <label class="setup-radio-label">
            <input type="radio" name="compat-mode" value="gpu" ${mode !== 'cpu' ? 'checked' : ''}>
            <span class="setup-radio-title">GPU mode</span>
            <span class="setup-radio-desc">Run GPU compatibility checks and install GPU-optimised variants.</span>
          </label>
          <label class="setup-radio-label">
            <input type="radio" name="compat-mode" value="cpu" ${mode === 'cpu' ? 'checked' : ''}>
            <span class="setup-radio-title">CPU mode</span>
            <span class="setup-radio-desc">Skip GPU checks and install CPU-only variants.</span>
          </label>
        </div>
        <div id="compat-out" class="setup-detect-output">
          <p class="setup-hint">⏳ Running compatibility check…</p>
        </div>
        <div id="compat-results" style="display:none">
          <table class="setup-status-table"><tbody id="compat-tbody"></tbody></table>
          <div id="compat-overall" style="margin-top:12px"></div>
          <button id="compat-rescan-btn" class="setup-btn setup-btn-secondary" style="margin-top:12px">🔄 Re-check</button>
        </div>
      `;
    },
    afterRender: () => {
      // Sync selectedMode from radio immediately on any change, then re-run check
      document.querySelectorAll('input[name="compat-mode"]').forEach(el => {
        el.addEventListener('change', (e) => {
          if (e.target.checked) {
            window.__setupState.selectedMode = e.target.value;
            runCompatCheck();
          }
        });
      });

      runCompatCheck();
      document.getElementById('compat-rescan-btn')?.addEventListener('click', runCompatCheck);

      async function runCompatCheck() {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const out     = document.getElementById('compat-out');
        const results = document.getElementById('compat-results');
        if (!out) return;

        out.innerHTML = '<p class="setup-hint">⏳ Running compatibility check…</p>';
        if (results) results.style.display = 'none';

        if (S.selectedMode === 'cpu') {
          S.detected.compatResults = { COMPAT_OVERALL: 'pass', COMPAT_OVERALL_MSG: 'CPU mode — GPU checks skipped.' };
          out.innerHTML = '<div class="setup-success-msg">✅ CPU mode enabled — GPU checks skipped.</div>';
          return;
        }

        try {
          const api = window?.electron;
          if (!api?.runCompatibilityCheck) {
            out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable — restart the app and try again.</p>';
            if (results) results.style.display = 'none';
            return;
          }
          const osLower = (S.detected.osPrettyName || S.detected.osFullName || '').toLowerCase();
          const osFamily = osLower.includes('windows') ? 'windows'
                         : osLower.includes('mac') || osLower.includes('darwin') ? 'macos'
                         : 'linux';

          const params = {
            osFamily,
            osVersion:  S.detected.osKernel      || '',
            arch:       S.detected.arch || window?.versions?.arch?.() || '',
            gpuMfr:     S.detected.gpuManufacturer || '',
            gpuName:    S.detected.gpuName         || '',
            gpuVramMB:  S.detected.gpuVramMB       || '',
            cudaVer:    S.detected.cudaVersion     || '',
            rocmVer:    S.detected.rocmVersion     || '',
            metalVer:   S.detected.metalVersion    || '',
            mpsAvail:   S.detected.mpsAvailable    || '',
            pythonVer:  S.detected.pythonVersion   || '',
          };

          const result = await api.runCompatibilityCheck(params);
          const kv     = U.parseKV(result.stdout);
          if (result.code !== 0 || !kv['COMPAT_OVERALL']) {
            out.innerHTML = `<p class="setup-hint">⚠️ Compatibility check failed: ${U.escapeHtml(result.stderr || 'No output received.')}</p>`;
            if (results) results.style.display = 'none';
            return;
          }
          S.detected.compatResults = kv;

          const checks = [
            { key: 'COMPAT_OS',     label: 'Operating System'    },
            { key: 'COMPAT_ARCH',   label: 'Architecture'        },
            { key: 'COMPAT_GPU',    label: 'GPU Requirements'    },
            { key: 'COMPAT_CUDA',   label: 'CUDA Compatibility'  },
            { key: 'COMPAT_ROCM',   label: 'ROCm Compatibility'  },
            { key: 'COMPAT_METAL',  label: 'Metal / MPS'         },
            { key: 'COMPAT_CC',     label: 'Compute Capability'  },
            { key: 'COMPAT_PYTHON', label: 'Python Version'      },
          ];

          const tbody = document.getElementById('compat-tbody');
          if (tbody) {
            tbody.innerHTML = checks.map(c => {
                const mfr = (S.detected.gpuManufacturer || '').toLowerCase();
                const notApplicable =
                  (c.key === 'COMPAT_CUDA' && mfr !== 'nvidia') ||
                  (c.key === 'COMPAT_ROCM' && mfr !== 'amd') ||
                  (c.key === 'COMPAT_METAL' && mfr !== 'apple');
                const status = kv[c.key];
                const present = status != null;
                const icon   = notApplicable || !present ? '—' : status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : status === 'fail' ? '❌' : '—';
                const msg    = notApplicable ? 'Not applicable for this system.' : !present ? '' : (kv[c.key + '_MSG'] || status || '');
                const rowClass = notApplicable || !present ? 'setup-status-muted' : '';
                return `<tr class="${rowClass}"><td>${icon}</td><td>${U.escapeHtml(c.label)}</td><td class="setup-hint">${U.escapeHtml(msg)}</td></tr>`;
              }).join('');
          }

          const overall    = kv['COMPAT_OVERALL'] || 'warn';
          const overallMsg = kv['COMPAT_OVERALL_MSG'] || 'Compatibility check complete.';
          const overallDiv = document.getElementById('compat-overall');
          if (overallDiv) {
            const icon = overall === 'pass' ? '✅' : overall === 'warn' ? '⚠️' : '❌';
            const cls  = overall === 'pass' ? 'setup-success-msg' : overall === 'warn' ? 'setup-warn-msg' : 'setup-error-msg';
            overallDiv.innerHTML = `<div class="${cls}">${icon} ${U.escapeHtml(overallMsg)}</div>`;
          }

          out.innerHTML = '';
          if (results) results.style.display = 'block';
        } catch (e) {
          out.innerHTML = `<p class="setup-hint">⚠️ Compatibility check failed: ${U.escapeHtml(e.message)}</p>`;
        }
      }
    },
    collect: () => {
      const S = window.__setupState;
      S.selectedMode = document.querySelector('input[name="compat-mode"]:checked')?.value || S.selectedMode;
      return { mode: S.selectedMode };
    }
  });
})();