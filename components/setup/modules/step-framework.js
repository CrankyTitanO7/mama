// ── Step: AI Framework Selection ─────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'framework',
    title: 'AI Framework',
    render: (settings) => {
      const S = window.__setupState;
      const U = window.__setupUtils;
      const pytAlready  = settings['software information']?.pyt === true;
      const tfAlready   = settings['software information']?.tf  === true;
      const suggested   = (S.detected.gpuManufacturer === 'intel' || S.detected.gpuManufacturer === 'none') ? 'tf' : 'torch';
      const preSelected = S.selectedFramework || (pytAlready && !tfAlready ? 'torch' : tfAlready && !pytAlready ? 'tf' : suggested);

      const variant  = U.gpuVariantLabel();
      const isCPU    = S.selectedMode === 'cpu';
      const mfr      = S.detected.gpuManufacturer;

      const torchDesc = isCPU || mfr === 'none' || mfr === 'intel'
        ? 'CPU-only wheels'
        : mfr === 'nvidia' ? `<code>--index-url ${U.escapeHtml(U.torchIndexURL())}</code>`
        : mfr === 'amd'    ? `<code>--index-url ${U.escapeHtml(U.torchIndexURL())}</code>`
        : 'CPU-only wheels';

      const tfDesc = isCPU           ? 'tensorflow-cpu'
                   : mfr === 'nvidia' ? 'tensorflow[and-cuda]'
                   : mfr === 'amd'    ? 'tensorflow-rocm'
                   : 'tensorflow-cpu';

      const compat  = S.detected.compatResults;
      const overall = compat?.['COMPAT_OVERALL'] || '';
      const banner  = isCPU
        ? '<div class="setup-success-msg" style="margin-bottom:12px">✅ CPU mode — CPU-only wheels will be installed.</div>'
        : overall === 'fail'
          ? '<div class="setup-error-msg" style="margin-bottom:12px">❌ Compatibility issues detected. Review the previous step. CPU mode is recommended.</div>'
          : overall === 'warn'
            ? '<div class="setup-warn-msg" style="margin-bottom:12px">⚠️ Some compatibility warnings — your system should work but performance may vary.</div>'
            : '';

      return `
        <h2>AI Framework</h2>
        <p>Which deep learning framework would you like to use?</p>
        ${banner}
        <p class="setup-hint" style="margin-bottom:12px">
          Hardware: <strong>${U.escapeHtml(S.detected.gpuName || S.detected.gpuManufacturer || 'CPU only')}</strong>
          &nbsp;·&nbsp; Mode: <strong>${isCPU ? 'CPU' : 'GPU'}</strong>
          &nbsp;·&nbsp; Variant: <strong>${U.escapeHtml(variant)}</strong>
        </p>
        <div class="setup-radio-group">
          <label class="setup-radio-label">
            <input type="radio" name="framework" value="torch" ${preSelected === 'torch' ? 'checked' : ''}>
            <span class="setup-radio-title">PyTorch</span>
            <span class="setup-radio-desc">torch, torchvision, torchaudio<br>${torchDesc}</span>
          </label>
          <label class="setup-radio-label">
            <input type="radio" name="framework" value="tf" ${preSelected === 'tf' ? 'checked' : ''}>
            <span class="setup-radio-title">TensorFlow</span>
            <span class="setup-radio-desc">${tfDesc}</span>
          </label>
        </div>
        <div class="setup-reqs-section">
          <p style="font-weight:600;font-size:14px;margin:16px 0 8px">⚙️ Minimum Requirements</p>
          <div class="setup-reqs-grid">
            <div class="setup-reqs-card">
              <p style="font-weight:600;font-size:13px;color:var(--highlight-color);margin:0 0 6px">PyTorch</p>
              <ul style="margin:0;padding-left:16px;font-size:13px;line-height:1.7">
                <li>Python 3.8+ (3.10+ recommended)</li>
                <li>CUDA 11.8+ / ROCm 5.0+, or CPU-only</li>
                <li>4 GB VRAM min / 8 GB+ recommended</li>
                <li>Windows 10+ / macOS 12+ / Linux</li>
              </ul>
            </div>
            <div class="setup-reqs-card">
              <p style="font-weight:600;font-size:13px;color:var(--highlight-color);margin:0 0 6px">TensorFlow</p>
              <ul style="margin:0;padding-left:16px;font-size:13px;line-height:1.7">
                <li>Python 3.9–3.12</li>
                <li>CUDA 11.8+ / ROCm 5.0+, or CPU-only</li>
                <li>4 GB VRAM min / 8 GB+ recommended</li>
                <li>Windows 10+ / Ubuntu 20.04+</li>
              </ul>
            </div>
          </div>
        </div>
      `;
    },
    afterRender: () => {
      document.querySelectorAll('input[name="framework"]').forEach(el => {
        el.addEventListener('change', (e) => { if (e.target.checked) window.__setupState.selectedFramework = e.target.value; });
      });
    },
    collect: () => {
      const S = window.__setupState;
      S.selectedFramework = document.querySelector('input[name="framework"]:checked')?.value || S.selectedFramework || 'torch';
      return S.selectedFramework;
    }
  });
})();