// ── Step: GPU Detection ───────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'gpu-detect',
    title: 'GPU Detection',
    render: () => `
      <h2>GPU Detection</h2>
      <p>Scanning for graphics hardware…</p>
      <div id="gpu-out" class="setup-detect-output">
        <p class="setup-hint">⏳ Running detection…</p>
      </div>
      <div id="gpu-fields" style="display:none">
        <div class="setup-field">
          <label>Manufacturer:</label>
          <select id="setup-gpu-mfr" class="setup-select">
            <option value="nvidia">NVIDIA</option>
            <option value="amd">AMD</option>
            <option value="apple">Apple (MPS / Metal)</option>
            <option value="intel">Intel</option>
            <option value="none">None / CPU only</option>
          </select>
        </div>
        <div class="setup-field">
          <label>GPU Name:</label>
          <input type="text" id="setup-gpu-name" class="setup-input" placeholder="e.g. RTX 4070">
        </div>
        <div class="setup-field" id="cuda-field">
          <label>CUDA Version <span class="setup-hint">(NVIDIA only)</span>:</label>
          <input type="text" id="setup-cuda-ver" class="setup-input" placeholder="e.g. 12.1">
        </div>
        <div class="setup-field" id="rocm-field">
          <label>ROCm Version <span class="setup-hint">(AMD only)</span>:</label>
          <input type="text" id="setup-rocm-ver" class="setup-input" placeholder="e.g. 5.7">
        </div>
        <button id="gpu-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
      </div>
      <div id="gpu-raw" class="setup-detect-output" style="display:none"></div>
    `,
    afterRender: () => {
      runGPUScan();
      document.getElementById('gpu-rescan-btn')?.addEventListener('click', runGPUScan);
      document.getElementById('setup-gpu-mfr')?.addEventListener('change', (e) => {
        const mfr = e.target.value;
        const cudaF = document.getElementById('cuda-field');
        const rocmF = document.getElementById('rocm-field');
        if (cudaF) cudaF.style.opacity = mfr === 'nvidia' ? '1' : '0.4';
        if (rocmF) rocmF.style.opacity = mfr === 'amd'    ? '1' : '0.4';
      });

      async function runGPUScan() {
        const S = window.__setupState;
        const U = window.__setupUtils;
        const out    = document.getElementById('gpu-out');
        const fields = document.getElementById('gpu-fields');
        const raw    = document.getElementById('gpu-raw');
        if (!out) return;
        out.innerHTML = '<p class="setup-hint">⏳ Running detection…</p>';
        try {
          const api = window?.electron;
          if (!api?.runGPUDetect) {
            out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable — restart the app and try again.</p>';
            if (fields) fields.style.display = 'block';
            return;
          }
          const result = await api.runGPUDetect();
          const kv     = U.parseKV(result.stdout);

          S.detected.gpuManufacturer = (kv['GPU_MANUFACTURER'] || 'none').toLowerCase();
          S.detected.gpuName         = kv['GPU_NAME']       || '';
          S.detected.gpuVramMB       = kv['GPU_VRAM_MB']    ? parseInt(kv['GPU_VRAM_MB'], 10) : null;
          S.detected.cudaVersion     = kv['CUDA_VERSION']   || '';
          S.detected.rocmVersion     = kv['ROCM_VERSION']   || '';
          S.detected.driverVersion   = kv['DRIVER_VERSION'] || '';
          S.detected.metalVersion    = kv['METAL_VERSION']  || '';
          S.detected.mpsAvailable    = U.boolVal(kv['MPS_AVAILABLE']);

          const vramStr  = S.detected.gpuVramMB  ? ` — ${(S.detected.gpuVramMB / 1024).toFixed(1)} GB VRAM` : '';
          const accelStr = S.detected.cudaVersion  ? ` (CUDA ${S.detected.cudaVersion})`
                         : S.detected.rocmVersion  ? ` (ROCm ${S.detected.rocmVersion})`
                         : S.detected.metalVersion ? ` (Metal ${S.detected.metalVersion})`
                         : '';
          const mpsStr   = S.detected.mpsAvailable ? ' — MPS available' : '';

          if (S.detected.gpuManufacturer !== 'none') {
            const display = S.detected.gpuName || S.detected.gpuManufacturer.toUpperCase();
            out.innerHTML = `<div class="setup-success-msg">✅ GPU detected: <strong>${U.escapeHtml(display)}</strong>${U.escapeHtml(vramStr + accelStr + mpsStr)}</div>`;
          } else {
            out.innerHTML = `<div class="setup-hint">ℹ️ No discrete GPU detected — CPU-only variants will be installed. If you have a GPU, check your drivers and re-scan, or select manually below.</div>`;
          }

          const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
          set('setup-gpu-mfr',  S.detected.gpuManufacturer);
          set('setup-gpu-name', S.detected.gpuName);
          set('setup-cuda-ver', S.detected.cudaVersion);
          set('setup-rocm-ver', S.detected.rocmVersion);

          const mfr = S.detected.gpuManufacturer;
          const cudaF = document.getElementById('cuda-field');
          const rocmF = document.getElementById('rocm-field');
          if (cudaF) cudaF.style.opacity = mfr === 'nvidia' ? '1' : '0.4';
          if (rocmF) rocmF.style.opacity = mfr === 'amd'    ? '1' : '0.4';

          if (fields) fields.style.display = 'block';
          if (result.stderr && raw) {
            raw.style.display = 'block';
            raw.innerHTML = `<pre class="setup-pre setup-pre-error">${U.escapeHtml(result.stderr)}</pre>`;
          }
        } catch (e) {
          out.innerHTML = `<p class="setup-hint">⚠️ GPU detection failed: ${U.escapeHtml(e.message)}</p>`;
          if (fields) fields.style.display = 'block';
        }
      }
    },
    collect: () => {
      const S = window.__setupState;
      S.detected.gpuManufacturer = document.getElementById('setup-gpu-mfr')?.value  || S.detected.gpuManufacturer;
      S.detected.gpuName         = document.getElementById('setup-gpu-name')?.value || S.detected.gpuName;
      S.detected.cudaVersion     = document.getElementById('setup-cuda-ver')?.value || S.detected.cudaVersion;
      S.detected.rocmVersion     = document.getElementById('setup-rocm-ver')?.value || S.detected.rocmVersion;
      return {
        'graphics manufacturer': S.detected.gpuManufacturer,
        'target card name':      S.detected.gpuName   || null,
        'cuda version':          S.detected.cudaVersion || null,
        'rocm version':          S.detected.rocmVersion || null,
      };
    }
  });
})();