// Setup Wizard — runs on first launch
//
// Step order:
//   Welcome → Language → Appearance →
//   OS Detection → Python & Tools → GPU Detection →
//   System Compatibility → Framework Selection →
//   Framework Install → Framework Verification →
//   Resources → QoL → Security → Finish
//
// ── Required IPC (main.js / preload.js) ────────────────────────────────────
//
//   Detection
//     window.electron.runOSDetect()
//     window.electron.runPythonDetect()
//     window.electron.runGPUDetect()
//     window.electron.runCompatibilityCheck(params)
//     window.electron.runImportTest(fw)
//
//   Install — streaming variant (see notes below)
//     window.electron.runInstallStream(fw, gpuVariant, accelVersion)
//       → Promise<exitCode>   resolves when process exits
//     window.electron.onInstallProgress(callback)
//       → registers listener for { type:'stdout'|'stderr'|'done', text?, code? }
//     window.electron.offInstallProgress()
//       → removes all 'install-progress' listeners
//
//     Main-process side of streaming install (add to ipc-handlers.js):
//
//       ipcMain.handle('run-install-stream', async (event, fw, gv, accelVer = '') => {
//         const args = [fw, gv];
//         if (accelVer) args.push(accelVer);
//         return new Promise((resolve) => {
//           const proc = spawn(getPython(), [SCRIPT.install, ...args]);
//           proc.stdout.on('data', d => event.sender.send('install-progress',
//             { type: 'stdout', text: d.toString() }));
//           proc.stderr.on('data', d => event.sender.send('install-progress',
//             { type: 'stderr', text: d.toString() }));
//           proc.on('close', code => resolve(code ?? 0));
//           proc.on('error', err => {
//             event.sender.send('install-progress', { type: 'stderr', text: err.message });
//             resolve(1);
//           });
//         });
//       });
//
//     Preload additions:
//       runInstallStream:   (fw, gv, av) => ipcRenderer.invoke('run-install-stream', fw, gv, av),
//       onInstallProgress:  (cb)         => ipcRenderer.on('install-progress', (_e, c) => cb(c)),
//       offInstallProgress: ()           => ipcRenderer.removeAllListeners('install-progress'),
//
//   Settings
//     window.electron.settingsRead()
//     window.electron.settingsWrite(obj)
//     window.electron.settingsWriteNonbackup(obj)
//     window.electron.setupComplete()
//     window.electron.navigateTo(path)
//     window.electron.themesRead()          ← optional; appearance step degrades gracefully
//
// ── GPU detect output format (KEY=VALUE per line) ──────────────────────────
//
//   GPU_MANUFACTURER = nvidia | amd | apple | intel | none
//   GPU_NAME         = NVIDIA GeForce RTX 4070
//   GPU_VRAM_MB      = 12288
//   CUDA_VERSION     = 12.1     (nvidia only)
//   ROCM_VERSION     = 5.7      (amd only)
//   METAL_VERSION    = 3        (apple only)
//   MPS_AVAILABLE    = true     (apple only)
//   DRIVER_VERSION   = 536.23

(function () {

  // ═══════════════════════════════════════════════════════════════
  // Module state
  // ═══════════════════════════════════════════════════════════════

  let selectedFramework = null;   // 'torch' | 'tf'
  let selectedMode      = 'gpu';  // 'gpu' | 'cpu'
  let installSucceeded  = false;

  // Populated by detection steps; read by later steps.
  const detected = {
    osFullName:      '',
    osPrettyName:    '',
    osKernel:        '',
    arch:            window?.versions?.arch?.() || '',
    pythonVersion:   null,
    pipAvailable:    false,
    cmakeAvailable:  false,
    gccAvailable:    false,
    gpuManufacturer: 'none',
    gpuName:         '',
    gpuVramMB:       null,
    cudaVersion:     '',
    rocmVersion:     '',
    driverVersion:   '',
    metalVersion:    '',
    mpsAvailable:    '',
    compatResults:   null,
  };

  // ═══════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

  function parseKV(stdout) {
    const result = {};
    for (const line of (stdout || '').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
  }

  function boolVal(str)   { return str?.toLowerCase() === 'true'; }
  function okIcon(ok)     { return ok ? '✅' : '❌'; }
  function warnIcon(ok)   { return ok ? '✅' : '⚠️'; }

  function gpuVariant() {
    if (selectedMode === 'cpu') return 'cpu';
    if (detected.gpuManufacturer === 'nvidia') return 'cuda';
    if (detected.gpuManufacturer === 'amd')    return 'rocm';
    if (detected.gpuManufacturer === 'apple')  return 'mps';
    return 'cpu';
  }

  function torchIndexURL() {
    if (selectedMode === 'cpu') return 'https://download.pytorch.org/whl/cpu';
    if (detected.gpuManufacturer === 'nvidia' && detected.cudaVersion) {
      const tag = 'cu' + detected.cudaVersion.replace('.', '');
      return `https://download.pytorch.org/whl/${tag}`;
    }
    if (detected.gpuManufacturer === 'amd' && detected.rocmVersion) {
      return `https://download.pytorch.org/whl/rocm${detected.rocmVersion}`;
    }
    return 'https://download.pytorch.org/whl/cpu';
  }

  function gpuVariantLabel() {
    if (selectedMode === 'cpu')                    return 'CPU-only';
    if (detected.gpuManufacturer === 'nvidia')     return detected.cudaVersion ? `CUDA ${detected.cudaVersion}` : 'CUDA (version unknown)';
    if (detected.gpuManufacturer === 'amd')        return detected.rocmVersion ? `ROCm ${detected.rocmVersion}` : 'ROCm (version unknown)';
    if (detected.gpuManufacturer === 'apple')      return detected.metalVersion ? `Metal ${detected.metalVersion} / MPS` : 'MPS';
    return 'CPU-only';
  }

  // Derive which pip packages to install based on current state.
  function buildInstallCommand() {
    const fw = selectedFramework || 'torch';
    const gv = gpuVariant();

    if (fw === 'tf') {
      if (gv === 'cuda')                    return 'pip install tensorflow[and-cuda]';
      if (gv === 'rocm')                    return 'pip install tensorflow-rocm';
      return 'pip install tensorflow-cpu';
    }

    // PyTorch
    return `pip install torch torchvision torchaudio --index-url ${torchIndexURL()}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Steps
  // All render() functions are synchronous. Async work lives in
  // afterRender(). This keeps renderStep() simple and avoids mixed
  // sync/async rendering that was causing subtle issues.
  // ═══════════════════════════════════════════════════════════════

  const STEPS = [

    // ── 0: Welcome ────────────────────────────────────────────────
    {
      id: 'welcome',
      title: 'Welcome',
      render: () => `
        <h2>Welcome to mama!</h2>
        <p>Let's get your environment configured. This will only take a moment.</p>
        <p>mama will detect your OS, Python install, and GPU automatically,
           then install the right version of PyTorch or TensorFlow for your hardware.</p>
        <p class="setup-hint">You can revisit these settings anytime from the settings page.</p>
      `
    },

    // ── 1: Language ───────────────────────────────────────────────
    {
      id: 'language',
      title: 'Language',
      render: (settings) => {
        const lang = settings['general settings']?.language || 'eng';
        const langs = [
          ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'],
          ['deu', 'German'],  ['jpn', 'Japanese'],['zho', 'Chinese'],
        ];
        return `
          <h2>Language</h2>
          <p>Select your preferred language:</p>
          <select id="setup-language" class="setup-select">
            ${langs.map(([v, l]) => `<option value="${v}" ${lang === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        `;
      },
      collect: () => document.getElementById('setup-language')?.value || 'eng'
    },

    // ── 2: Appearance ─────────────────────────────────────────────
    // render() returns static markup; afterRender() async-populates
    // the theme dropdown so render() stays synchronous.
    {
      id: 'appearance',
      title: 'Appearance',
      render: (settings) => {
        const accent       = settings['aesthetic settings']?.['accent color'] || 'default';
        const scaling      = settings['aesthetic settings']?.['scaling factor'] || 1;
        const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];
        return `
          <h2>Appearance</h2>
          <div class="setup-field">
            <label>Theme:</label>
            <select id="setup-appearance" class="setup-select">
              <option value="system" selected>System (loading…)</option>
            </select>
          </div>
          <div class="setup-field">
            <label>Accent Color:</label>
            <select id="setup-accent" class="setup-select">
              ${accentColors.map(c =>
                `<option value="${c}" ${accent === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="setup-field">
            <label>Scaling Factor:</label>
            <input type="number" id="setup-scaling" class="setup-input"
              min="0.5" max="3" step="0.25" value="${scaling}">
          </div>
        `;
      },
      afterRender: async () => {
        const sel         = document.getElementById('setup-appearance');
        const current     = settingsCache['aesthetic settings']?.appearance || 'system';
        const baseOptions = [{ value: 'system', label: 'System' }];

        let customThemes = window.ThemeManager?.getCustomThemeList?.() || [];
        if (customThemes.length === 0 && window.electron?.themesRead) {
          try { customThemes = await window.electron.themesRead() || []; } catch (_) {}
        }

        const allOptions = customThemes.length > 0
          ? [...baseOptions, ...customThemes.map(t => ({ value: t.name, label: t.title }))]
          : [...baseOptions, { value: '__default__', label: 'Fallback' }];

        sel.innerHTML = allOptions
          .map(o => `<option value="${escapeHtml(o.value)}" ${current === o.value ? 'selected' : ''}>${escapeHtml(String(o.label))}</option>`)
          .join('');
      },
      collect: () => ({
        appearance:       document.getElementById('setup-appearance')?.value || 'system',
        'accent color':   document.getElementById('setup-accent')?.value    || 'default',
        'scaling factor': parseFloat(document.getElementById('setup-scaling')?.value) || 1,
      })
    },

    // ── 3: OS Detection ───────────────────────────────────────────
    {
      id: 'os-detect',
      title: 'OS Detection',
      render: () => `
        <h2>Operating System Detection</h2>
        <p>Detecting your operating system…</p>
        <div id="os-out" class="setup-detect-output">
          <p class="setup-hint">⏳ Running detection…</p>
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
          const out    = document.getElementById('os-out');
          const fields = document.getElementById('os-fields');
          if (!out) return;
          out.innerHTML = '<p class="setup-hint">⏳ Running detection…</p>';
          try {
            const api = window?.electron;
            if (!api?.runOSDetect) {
              out.innerHTML = '<p class="setup-hint">⚠️ Electron bridge unavailable — restart the app and try again.</p>';
              if (fields) fields.style.display = 'block';
              return;
            }
            const result = await api.runOSDetect();
            const kv     = parseKV(result.stdout);
            detected.osFullName   = kv['OS_FULL']   || '';
            detected.osPrettyName = kv['OS_PRETTY'] || '';
            detected.osKernel     = kv['OS_KERNEL'] || '';
            detected.arch         = kv['ARCH'] || detected.arch || window?.versions?.arch?.() || '';

            out.innerHTML = detected.osFullName
              ? `<div class="setup-success-msg">✅ <strong>${escapeHtml(detected.osFullName)}</strong></div>`
              : '<div class="setup-error-msg">⚠️ Could not auto-detect OS — fill in manually below.</div>';

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            set('setup-os-full',   detected.osFullName);
            set('setup-os-pretty', detected.osPrettyName);
            set('setup-os-kernel', detected.osKernel);
            set('setup-arch',      detected.arch);

            if (result.stderr && result.code !== 0)
              out.innerHTML += `<pre class="setup-pre setup-pre-error">${escapeHtml(result.stderr)}</pre>`;
          } catch (e) {
            out.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>`;
          } finally {
            if (fields) fields.style.display = 'block';
          }
        }
      },
      collect: () => {
        detected.osFullName   = document.getElementById('setup-os-full')?.value   || detected.osFullName;
        detected.osPrettyName = document.getElementById('setup-os-pretty')?.value || detected.osPrettyName;
        detected.osKernel     = document.getElementById('setup-os-kernel')?.value || detected.osKernel;
        detected.arch         = document.getElementById('setup-arch')?.value      || detected.arch;
        return { 'OS full': detected.osFullName, 'OS pretty': detected.osPrettyName, 'OS kernel': detected.osKernel, 'Architecture': detected.arch };
      }
    },

    // ── 4: Python & Tools ─────────────────────────────────────────
    {
      id: 'python-detect',
      title: 'Python & Tools',
      render: () => `
        <h2>Python &amp; Tools Detection</h2>
        <p>Checking for Python, pip, CMake, and GCC…</p>
        <div id="py-out" class="setup-detect-output">
          <p class="setup-hint">⏳ Running detection…</p>
        </div>
        <div id="py-rescan-wrap" style="display:none; margin-top:12px">
          <button id="py-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
        </div>
        <div id="py-warn" class="setup-warn-msg" style="display:none">
          ⚠️ Python not found. mama requires Python 3.8+.<br>
          Install from <strong>python.org</strong> then re-scan.
        </div>
      `,
      afterRender: () => {
        runPyScan();
        document.getElementById('py-rescan-btn')?.addEventListener('click', runPyScan);

        async function runPyScan() {
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
            const result = await api.runPythonDetect();
            const kv     = parseKV(result.stdout);
            detected.pythonVersion  = kv['PYTHON_VERSION']  || null;
            detected.pipAvailable   = boolVal(kv['PIP_AVAILABLE']);
            detected.cmakeAvailable = boolVal(kv['CMAKE_AVAILABLE']);
            detected.gccAvailable   = boolVal(kv['GCC_AVAILABLE']);
            const pyOk = !!detected.pythonVersion;
            out.innerHTML = `
              <table class="setup-status-table"><tbody>
                <tr><td>${okIcon(pyOk)}</td><td>Python</td><td class="setup-hint">${escapeHtml(detected.pythonVersion || 'not found')}</td></tr>
                <tr><td>${okIcon(detected.pipAvailable)}</td><td>pip</td><td class="setup-hint">${detected.pipAvailable ? 'available' : 'not found'}</td></tr>
                <tr><td>${warnIcon(detected.cmakeAvailable)}</td><td>CMake <span class="setup-hint">(optional)</span></td><td class="setup-hint">${detected.cmakeAvailable ? 'available' : 'not found'}</td></tr>
                <tr><td>${warnIcon(detected.gccAvailable)}</td><td>GCC / C++ <span class="setup-hint">(optional)</span></td><td class="setup-hint">${detected.gccAvailable ? 'available' : 'not found'}</td></tr>
              </tbody></table>
            `;
            if (warn) warn.style.display = pyOk ? 'none' : 'block';
          } catch (e) {
            out.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>`;
          } finally {
            if (rescanW) rescanW.style.display = 'block';
          }
        }
      }
    },

    // ── 5: GPU Detection ──────────────────────────────────────────
    {
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
            const kv     = parseKV(result.stdout);

            // Single assignment block — no duplicates
            detected.gpuManufacturer = (kv['GPU_MANUFACTURER'] || 'none').toLowerCase();
            detected.gpuName         = kv['GPU_NAME']       || '';
            detected.gpuVramMB       = kv['GPU_VRAM_MB']    ? parseInt(kv['GPU_VRAM_MB'], 10) : null;
            detected.cudaVersion     = kv['CUDA_VERSION']   || '';
            detected.rocmVersion     = kv['ROCM_VERSION']   || '';
            detected.driverVersion   = kv['DRIVER_VERSION'] || '';
            detected.metalVersion    = kv['METAL_VERSION']  || '';
            detected.mpsAvailable    = kv['MPS_AVAILABLE']  || '';

            const vramStr  = detected.gpuVramMB  ? ` — ${(detected.gpuVramMB / 1024).toFixed(1)} GB VRAM` : '';
            const accelStr = detected.cudaVersion  ? ` (CUDA ${detected.cudaVersion})`
                           : detected.rocmVersion  ? ` (ROCm ${detected.rocmVersion})`
                           : detected.metalVersion ? ` (Metal ${detected.metalVersion})`
                           : '';
            const mpsStr   = detected.mpsAvailable === 'true' ? ' — MPS available' : '';

            if (detected.gpuManufacturer !== 'none') {
              const display = detected.gpuName || detected.gpuManufacturer.toUpperCase();
              out.innerHTML = `<div class="setup-success-msg">✅ GPU detected: <strong>${escapeHtml(display)}</strong>${escapeHtml(vramStr + accelStr + mpsStr)}</div>`;
            } else {
              out.innerHTML = `<div class="setup-hint">ℹ️ No discrete GPU detected — CPU-only variants will be installed. If you have a GPU, check your drivers and re-scan, or select manually below.</div>`;
            }

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            set('setup-gpu-mfr',  detected.gpuManufacturer);
            set('setup-gpu-name', detected.gpuName);
            set('setup-cuda-ver', detected.cudaVersion);
            set('setup-rocm-ver', detected.rocmVersion);

            // Dim irrelevant fields
            const mfr = detected.gpuManufacturer;
            const cudaF = document.getElementById('cuda-field');
            const rocmF = document.getElementById('rocm-field');
            if (cudaF) cudaF.style.opacity = mfr === 'nvidia' ? '1' : '0.4';
            if (rocmF) rocmF.style.opacity = mfr === 'amd'    ? '1' : '0.4';

            if (fields) fields.style.display = 'block';
            if (result.stderr && raw) {
              raw.style.display = 'block';
              raw.innerHTML = `<pre class="setup-pre setup-pre-error">${escapeHtml(result.stderr)}</pre>`;
            }
          } catch (e) {
            out.innerHTML = `<p class="setup-hint">⚠️ GPU detection failed: ${escapeHtml(e.message)}</p>`;
            if (fields) fields.style.display = 'block';
          }
        }
      },
      collect: () => {
        // Commit any manual field overrides back to detected state
        detected.gpuManufacturer = document.getElementById('setup-gpu-mfr')?.value  || detected.gpuManufacturer;
        detected.gpuName         = document.getElementById('setup-gpu-name')?.value || detected.gpuName;
        detected.cudaVersion     = document.getElementById('setup-cuda-ver')?.value || detected.cudaVersion;
        detected.rocmVersion     = document.getElementById('setup-rocm-ver')?.value || detected.rocmVersion;
        return {
          'graphics manufacturer': detected.gpuManufacturer,
          'target card name':      detected.gpuName   || null,
          'cuda version':          detected.cudaVersion || null,
          'rocm version':          detected.rocmVersion || null,
        };
      }
    },

    // ── 6: System Compatibility ───────────────────────────────────
    {
      id: 'compat-check',
      title: 'System Compatibility',
      render: (settings) => {
        const mode = settings['hardware settings']?.mode || selectedMode;
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
              selectedMode = e.target.value;
              runCompatCheck();
            }
          });
        });

        runCompatCheck();
        document.getElementById('compat-rescan-btn')?.addEventListener('click', runCompatCheck);

        async function runCompatCheck() {
          const out     = document.getElementById('compat-out');
          const results = document.getElementById('compat-results');
          if (!out) return;

          out.innerHTML = '<p class="setup-hint">⏳ Running compatibility check…</p>';
          if (results) results.style.display = 'none';

          if (selectedMode === 'cpu') {
            detected.compatResults = { COMPAT_OVERALL: 'pass', COMPAT_OVERALL_MSG: 'CPU mode — GPU checks skipped.' };
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
            const osLower = (detected.osPrettyName || detected.osFullName || '').toLowerCase();
            const osFamily = osLower.includes('windows') ? 'windows'
                           : osLower.includes('mac') || osLower.includes('darwin') ? 'macos'
                           : 'linux';

            const params = {
              osFamily,
              osVersion:  detected.osKernel      || '',
              arch:       detected.arch || window?.versions?.arch?.() || '',
              gpuMfr:     detected.gpuManufacturer || '',
              gpuName:    detected.gpuName         || '',
              gpuVramMB:  detected.gpuVramMB       || '',
              cudaVer:    detected.cudaVersion     || '',
              rocmVer:    detected.rocmVersion     || '',
              metalVer:   detected.metalVersion    || '',
              mpsAvail:   detected.mpsAvailable    || '',
              pythonVer:  detected.pythonVersion   || '',
            };

            const result = await api.runCompatibilityCheck(params);
            const kv     = parseKV(result.stdout);
            detected.compatResults = kv;

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
              tbody.innerHTML = checks
                .filter(c => kv[c.key])   // only show checks the script actually ran
                .map(c => {
                  const mfr = (detected.gpuManufacturer || '').toLowerCase();
                  const notApplicable =
                    (c.key === 'COMPAT_CUDA' && mfr !== 'nvidia') ||
                    (c.key === 'COMPAT_ROCM' && mfr !== 'amd') ||
                    (c.key === 'COMPAT_METAL' && mfr !== 'apple');
                  const status = kv[c.key];
                  const icon   = notApplicable ? '—' : status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
                  const msg    = notApplicable ? 'Not applicable for this system.' : (kv[c.key + '_MSG'] || '');
                  const rowClass = notApplicable ? 'setup-status-muted' : '';
                  return `<tr class="${rowClass}"><td>${icon}</td><td>${escapeHtml(c.label)}</td><td class="setup-hint">${escapeHtml(msg)}</td></tr>`;
                }).join('');
            }

            const overall    = kv['COMPAT_OVERALL'] || 'warn';
            const overallMsg = kv['COMPAT_OVERALL_MSG'] || 'Compatibility check complete.';
            const overallDiv = document.getElementById('compat-overall');
            if (overallDiv) {
              const icon = overall === 'pass' ? '✅' : overall === 'warn' ? '⚠️' : '❌';
              const cls  = overall === 'pass' ? 'setup-success-msg' : overall === 'warn' ? 'setup-warn-msg' : 'setup-error-msg';
              overallDiv.innerHTML = `<div class="${cls}">${icon} ${escapeHtml(overallMsg)}</div>`;
            }

            out.innerHTML = '';
            if (results) results.style.display = 'block';
          } catch (e) {
            out.innerHTML = `<p class="setup-hint">⚠️ Compatibility check failed: ${escapeHtml(e.message)}</p>`;
          }
        }
      },
      collect: () => {
        selectedMode = document.querySelector('input[name="compat-mode"]:checked')?.value || selectedMode;
        return { mode: selectedMode };
      }
    },

    // ── 7: Framework Selection ────────────────────────────────────
    {
      id: 'framework',
      title: 'AI Framework',
      render: (settings) => {
        const pytAlready  = settings['software information']?.pyt === true;
        const tfAlready   = settings['software information']?.tf  === true;
        const suggested   = (detected.gpuManufacturer === 'intel' || detected.gpuManufacturer === 'none') ? 'tf' : 'torch';
        const preSelected = selectedFramework || (pytAlready && !tfAlready ? 'torch' : tfAlready && !pytAlready ? 'tf' : suggested);

        const variant  = gpuVariantLabel();
        const isCPU    = selectedMode === 'cpu';
        const mfr      = detected.gpuManufacturer;

        const torchDesc = isCPU || mfr === 'none' || mfr === 'intel'
          ? 'CPU-only wheels'
          : mfr === 'nvidia' ? `<code>--index-url ${escapeHtml(torchIndexURL())}</code>`
          : mfr === 'amd'    ? `<code>--index-url ${escapeHtml(torchIndexURL())}</code>`
          : 'CPU-only wheels';

        const tfDesc = isCPU           ? 'tensorflow-cpu'
                     : mfr === 'nvidia' ? 'tensorflow[and-cuda]'
                     : mfr === 'amd'    ? 'tensorflow-rocm'
                     : 'tensorflow-cpu';

        const compat  = detected.compatResults;
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
            Hardware: <strong>${escapeHtml(detected.gpuName || detected.gpuManufacturer || 'CPU only')}</strong>
            &nbsp;·&nbsp; Mode: <strong>${isCPU ? 'CPU' : 'GPU'}</strong>
            &nbsp;·&nbsp; Variant: <strong>${escapeHtml(variant)}</strong>
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
          el.addEventListener('change', (e) => { if (e.target.checked) selectedFramework = e.target.value; });
        });
      },
      collect: () => {
        selectedFramework = document.querySelector('input[name="framework"]:checked')?.value || selectedFramework || 'torch';
        return selectedFramework;
      }
    },

    // ── 8: Framework Install ──────────────────────────────────────
    {
      id: 'fw-install',
      title: 'Framework Install',
      render: () => {
        const fw      = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        const isTorch = selectedFramework === 'torch';
        const variant = gpuVariantLabel();
        const cmd     = buildInstallCommand();

        let gridHtml = '';
        if (isTorch) {
          const osChoices = [
            { value: 'linux', label: 'Linux' },
            { value: 'macos', label: 'Mac' },
            { value: 'windows', label: 'Windows' },
          ];
          const packageChoices = [
            { value: 'pip', label: 'Pip' },
            { value: 'libtorch', label: 'LibTorch' },
          ];
          const languageChoices = [
            { value: 'python', label: 'Python' },
            { value: 'cplusplus', label: 'C++' },
          ];
          const computeChoices = [
            { value: 'accnone', label: 'CPU / Default' },
            { value: 'cuda.x', label: 'CUDA 12.6' },
            { value: 'cuda.y', label: 'CUDA 13.0' },
            { value: 'cuda.z', label: 'CUDA 13.2' },
            { value: 'rocm5.x', label: 'ROCm 7.2' },
          ];
          const detectedOs = (detected.osPrettyName || '').toLowerCase();
          const defaultOs = detectedOs.includes('windows') ? 'windows' : detectedOs.includes('mac') ? 'macos' : 'linux';
          const defaultCompute = detected.gpuManufacturer === 'nvidia' ? 'cuda.x' : detected.gpuManufacturer === 'amd' ? 'rocm5.x' : 'accnone';

          const matrixBlock = (name, items, defaultValue, legend) => `
            <div class="setup-pytorch-matrix-block">
              <div class="setup-pytorch-matrix-label">${escapeHtml(legend)}</div>
              <div class="setup-pytorch-option-grid" data-group="${escapeHtml(name)}">
                ${items.map(item => `
                  <label class="setup-pytorch-option ${item.value === defaultValue ? 'selected' : ''}">
                    <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(item.value)}" ${item.value === defaultValue ? 'checked' : ''}>
                    <span>${escapeHtml(item.label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `;

          gridHtml = `
            <div class="setup-pytorch-matrix" style="margin: 16px 0; padding: 16px; background: rgba(128,128,128,0.1); border-radius: 8px;">
              <p style="margin-top:0; margin-bottom: 12px; font-weight: bold; font-size: 14px;">PyTorch Installation Matrix</p>
              ${matrixBlock('pt-build', [{ value: 'stable', label: 'Stable (2.13.0)' }, { value: 'preview', label: 'Preview (Nightly)' }], 'stable', 'PyTorch Build')}
              ${matrixBlock('pt-os', osChoices, defaultOs, 'Your OS')}
              ${matrixBlock('pt-pm', packageChoices, 'pip', 'Package')}
              ${matrixBlock('pt-lang', languageChoices, 'python', 'Language')}
              ${matrixBlock('pt-cuda', computeChoices, defaultCompute, 'Compute Platform')}
            </div>
          `;
        }

        return `
          <h2>Install ${fw}</h2>
          <p>Installing <strong>${fw}</strong> with <strong>${escapeHtml(variant)}</strong> support.</p>
          ${gridHtml}
          <div class="setup-field">
            <label>Install command:</label>
            <input type="text" id="install-cmd-input" class="setup-input setup-input-mono" value="${escapeHtml(cmd)}">
            <p class="setup-hint">Edit if you need a specific wheel, or use the matrix above for PyTorch.</p>
          </div>
          <button id="run-fw-install-btn" class="setup-btn setup-btn-primary">⬇️ Install ${fw}</button>
          <div id="fw-install-output" style="display:none; margin-top:12px">
            <div id="fw-install-terminal" class="setup-terminal"></div>
          </div>
        `;
      },
      afterRender: async () => {
        // --- PYTORCH DYNAMIC MATRIX LOGIC ---
        if (selectedFramework === 'torch') {
          const cmdInput = document.getElementById('install-cmd-input');
          const pyTorchCommandMap = await Promise.resolve(window.electron?.getTorchCommands?.() || {});

          const getSelection = (name) => {
            const selected = document.querySelector(`input[name="${name}"]:checked`);
            return selected?.value || '';
          };

          const syncSelectionVisuals = () => {
            document.querySelectorAll('.setup-pytorch-option').forEach(label => {
              const input = label.querySelector('input[type="radio"]');
              label.classList.toggle('selected', !!input?.checked);
            });
          };

          const syncSelectorAvailability = () => {
            const osValue = getSelection('pt-os');
            const isMacOS = osValue === 'macos';
            const isWindows = osValue === 'windows';

            document.querySelectorAll('input[name="pt-cuda"]').forEach(input => {
              const label = input.closest('.setup-pytorch-option');
              const isCuda = input.value.startsWith('cuda');
              const isRocm = input.value.startsWith('rocm');
              const allowed = input.value === 'accnone' || (!isMacOS && (isCuda || !isWindows));
              const shouldDisable = !allowed || (isRocm && (isMacOS || isWindows));

              input.disabled = shouldDisable;
              label?.classList.toggle('disabled', shouldDisable);

              if (shouldDisable && input.checked) {
                const fallback = document.querySelector('input[name="pt-cuda"][value="accnone"]');
                if (fallback) {
                  fallback.checked = true;
                }
              }
            });
          };

          const updateCommand = () => {
            syncSelectorAvailability();
            syncSelectionVisuals();
            const key = [getSelection('pt-build'), getSelection('pt-pm'), getSelection('pt-os'), getSelection('pt-cuda'), getSelection('pt-lang')].join(',');
            if (pyTorchCommandMap[key]) {
              cmdInput.value = pyTorchCommandMap[key];
            } else {
              cmdInput.value = '# Follow instructions at https://github.com/pytorch/pytorch#from-source';
            }
          };

          document.querySelectorAll('.setup-pytorch-option-grid').forEach(grid => {
            grid.addEventListener('click', (event) => {
              const label = event.target.closest('.setup-pytorch-option');
              if (!label) return;
              const input = label.querySelector('input[type="radio"]');
              if (!input || input.disabled) return;
              input.checked = true;
              input.dispatchEvent(new Event('change', { bubbles: true }));
            });
          });

          document.querySelectorAll('input[name="pt-build"], input[name="pt-pm"], input[name="pt-os"], input[name="pt-cuda"], input[name="pt-lang"]').forEach(el => {
            el.addEventListener('change', updateCommand);
          });

          syncSelectorAvailability();
          syncSelectionVisuals();
          updateCommand();
        }

        // --- EXISTING INSTALL PROCESS LOGIC ---
        document.getElementById('run-fw-install-btn')?.addEventListener('click', async () => {
          const btn      = document.getElementById('run-fw-install-btn');
          const output   = document.getElementById('fw-install-output');
          const terminal = document.getElementById('fw-install-terminal');
          const cmdInput = document.getElementById('install-cmd-input');
          if (!btn || !output || !terminal) return;

          // If the user selected libtorch (which spits out a URL instead of a pip command), abort the pip install
          if (cmdInput && cmdInput.value.startsWith('http')) {
             alert('LibTorch provides a ZIP download link, not a direct command. Please copy the URL to download it.');
             return;
          }

          output.style.display = 'block';
          terminal.innerHTML   = '';
          btn.disabled         = true;
          btn.textContent      = '⏳ Installing…';

          const fw = selectedFramework || 'torch';
          const ptCudaValue = document.querySelector('input[name="pt-cuda"]:checked')?.value || '';
          const gv = fw === 'torch' && ptCudaValue
            ? (ptCudaValue.includes('cuda') ? 'cuda' : ptCudaValue.includes('rocm') ? 'rocm' : 'cpu')
            : gpuVariant();
          
          const accelVersion = detected.cudaVersion || detected.rocmVersion || '';

          function appendTerminal(text, cls) {
            const span = document.createElement('span');
            span.className   = cls;
            span.textContent = text;
            terminal.appendChild(span);
            terminal.scrollTop = terminal.scrollHeight;
          }

          try {
            window.electron.onInstallProgress((chunk) => {
              if (chunk.type === 'stdout') appendTerminal(chunk.text, 'terminal-stdout');
              if (chunk.type === 'stderr') appendTerminal(chunk.text, 'terminal-stderr');
            });

            // Note: If you want to use the EXACT command from the input field rather than 
            // recalculating it in 'runInstallStream', you may need to update IPC to accept 
            // the full 'cmdInput.value' string as a parameter instead of fw/gv/accelVersion.
            const exitCode = await window.electron.runInstallStream(fw, gv, accelVersion);

            window.electron.offInstallProgress();

            if (exitCode === 0) {
              installSucceeded = true;
              appendTerminal('✅ Installation complete!\\n', 'terminal-success');
              btn.textContent = '✓ Installed';
            } else {
              appendTerminal('❌ Installation failed — see output above.\\n', 'terminal-error');
              btn.textContent = '⬇️ Retry';
              btn.disabled    = false;
            }
          } catch (e) {
            window.electron.offInstallProgress?.();
            appendTerminal(`⚠️ Error: ${e.message}\\n`, 'terminal-error');
            btn.textContent = '⬇️ Retry';
            btn.disabled    = false;
          }
        });
      }
    }, 

    // ── 9: Framework Verification ─────────────────────────────────
    {
      id: 'fw-verify',
      title: 'Verify Install',
      render: () => {
        const fwName = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
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
          const testBtn    = document.getElementById('run-verify-btn');
          const statusDiv  = document.getElementById('verify-status');
          const installDiv = document.getElementById('verify-install');
          const fw         = selectedFramework || 'torch';
          const fwName     = fw === 'tf' ? 'TensorFlow' : 'PyTorch';
          if (!statusDiv) return;

          statusDiv.style.display = 'block';
          statusDiv.innerHTML     = '<p class="setup-hint">⏳ Running import test…</p>';
          testBtn.disabled        = true;
          testBtn.style.opacity   = '0.5';

          try {
            const result = await window.electron.runImportTest(fw);
            if (result.code === 0) {
              statusDiv.innerHTML = `
                <div class="setup-success-msg">✅ ${fwName} is working!</div>
                <pre class="setup-pre">${escapeHtml(result.stdout)}</pre>
              `;
              testBtn.textContent   = '✓ Verified';
              testBtn.style.opacity = '0.7';
            } else {
              statusDiv.innerHTML = `
                <div class="setup-error-msg">❌ ${fwName} import failed</div>
                <pre class="setup-pre setup-pre-error">${escapeHtml(result.stdout || result.stderr || 'Unknown error')}</pre>
                <p>Would you like to retry the install?</p>
                <button id="retry-install-btn" class="setup-btn setup-btn-success">⬇️ Retry Install</button>
              `;
              if (installDiv) installDiv.style.display = 'none';

              document.getElementById('retry-install-btn')?.addEventListener('click', async () => {
                const retryBtn = document.getElementById('retry-install-btn');
                if (installDiv) { installDiv.style.display = 'block'; installDiv.innerHTML = '<p class="setup-hint">⏳ Installing…</p>'; }
                if (retryBtn)   { retryBtn.disabled = true; retryBtn.textContent = '⏳ Installing…'; }

                try {
                  const ir = await window.electron.runInstall(fw, gpuVariant());
                  if (installDiv) {
                    installDiv.innerHTML = ir.code === 0
                      ? `<div class="setup-success-msg">✅ Installed!</div><pre class="setup-pre">${escapeHtml((ir.stdout || '').slice(0, 500))}</pre>`
                      : `<div class="setup-error-msg">❌ Failed</div><pre class="setup-pre setup-pre-error">${escapeHtml(ir.stderr || ir.stdout || '')}</pre>`;
                  }
                  if (ir.code === 0) {
                    statusDiv.innerHTML = '<p class="setup-hint">⏳ Re-testing…</p>';
                    const retest = await window.electron.runImportTest(fw);
                    statusDiv.innerHTML = retest.code === 0
                      ? `<div class="setup-success-msg">✅ ${fwName} verified!</div><pre class="setup-pre">${escapeHtml(retest.stdout || '')}</pre>`
                      : `<div class="setup-error-msg">❌ Still failing — check the install output.</div><pre class="setup-pre setup-pre-error">${escapeHtml(retest.stderr || retest.stdout || '')}</pre>`;
                    if (retryBtn) retryBtn.textContent = '✓ Done';
                  } else {
                    if (retryBtn) { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
                  }
                } catch (e) {
                  if (installDiv) installDiv.innerHTML = `<p class="setup-hint">⚠️ ${escapeHtml(e.message)}</p>`;
                  if (retryBtn)   { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
                }
              });
            }
          } catch (e) {
            statusDiv.innerHTML = `<p class="setup-hint">⚠️ Test error: ${escapeHtml(e.message)}</p>`;
          } finally {
            testBtn.disabled      = false;
            testBtn.style.opacity = '1';
          }
        });
      },
      collect: () => ({
        importSucceeded: document.getElementById('verify-status')?.textContent.includes('✅') || false,
        framework:       selectedFramework || 'torch',
      })
    },

    // ── 10: Resources ─────────────────────────────────────────────
    {
      id: 'resources',
      title: 'Resources',
      render: (settings) => {
        const res = settings['resource settings'] || {};
        return `
          <h2>Resource Configuration</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-cloud" ${res['cloud resources'] ? 'checked' : ''}>
              Enable Cloud Resources
            </label>
          </div>
          <div class="setup-field">
            <label>Cloud Provider:</label>
            <input type="text" id="setup-cloud-provider" class="setup-input"
              placeholder="e.g. openai" value="${escapeHtml(res['cloud provider name'] || '')}">
          </div>
          <div class="setup-field">
            <label>Local Hostname:</label>
            <input type="text" id="setup-local-host" class="setup-input"
              placeholder="e.g. ollama" value="${escapeHtml(res['local hostname'] || '')}">
          </div>
          <div class="setup-field">
            <label>Trainer Browser:</label>
            <input type="text" id="setup-trainer-browser" class="setup-input"
              placeholder="default" value="${escapeHtml(res['trainer browser'] || 'default')}">
          </div>
        `;
      },
      collect: () => ({
        'cloud resources':     document.getElementById('setup-cloud')?.checked         || false,
        'cloud provider name': document.getElementById('setup-cloud-provider')?.value  || null,
        'local hostname':      document.getElementById('setup-local-host')?.value      || null,
        'trainer browser':     document.getElementById('setup-trainer-browser')?.value || 'default',
      })
    },

    // ── 11: QoL ───────────────────────────────────────────────────
    {
      id: 'qol',
      title: 'Quality of Life',
      render: (settings) => {
        const qol = settings['qol settings'] || {};
        const res = qol['resources'] ?? qol['task manager'];
        return `
          <h2>Quality of Life</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-reels" ${qol['reels enable'] ? 'checked' : ''}>
              Enable Reels (relax while code compiles)
            </label>
          </div>
          <div class="setup-field">
            <label>Reels Provider:</label>
            <input type="text" id="setup-reels-provider" class="setup-input"
              placeholder="e.g. youtube" value="${escapeHtml(qol['reels provider'] || '')}">
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-site" ${(qol['site enable'] ?? qol['video enable']) ? 'checked' : ''}>
              Enable Site
            </label>
          </div>
          <div class="setup-field">
            <label>Site Provider:</label>
            <input type="text" id="setup-site-provider" class="setup-input"
              placeholder="e.g. youtube" value="${escapeHtml(qol['site provider'] || qol['video provider'] || '')}">
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-db-explorer" ${qol['database explorer enable'] ? 'checked' : ''}>
              Enable Database Explorer
            </label>
          </div>
          <div class="setup-field">
            <label>Database Provider:</label>
            <input type="text" id="setup-db-provider" class="setup-input"
              placeholder="e.g. huggingface" value="${escapeHtml(qol['database provider'] || '')}">
          </div>
          <div class="setup-field">
            <label>Resource Monitor:</label>
            <select id="setup-resources" class="setup-select">
              <option value="ask"   ${res === 'ask'   || res == null           ? 'selected' : ''}>Ask each time</option>
              <option value="true"  ${res === true    || res === 'always'      ? 'selected' : ''}>Always enable</option>
              <option value="false" ${res === false   || res === 'never'       ? 'selected' : ''}>Always disable</option>
            </select>
          </div>
        `;
      },
      collect: () => {
        const resRaw = document.getElementById('setup-resources')?.value;
        return {
          'reels enable':             document.getElementById('setup-reels')?.checked        || false,
          'reels provider':           document.getElementById('setup-reels-provider')?.value || null,
          'site enable':              document.getElementById('setup-site')?.checked         || false,
          'site provider':            document.getElementById('setup-site-provider')?.value  || null,
          'database explorer enable': document.getElementById('setup-db-explorer')?.checked  || false,
          'database provider':        document.getElementById('setup-db-provider')?.value    || null,
          'resources': resRaw === 'true' ? true : resRaw === 'false' ? false : 'ask',
        };
      }
    },

    // ── 12: Security ──────────────────────────────────────────────
    {
      id: 'security',
      title: 'Security',
      render: (settings) => {
        const sec = settings['security settings'] || {};
        const chk = (id, val) => `<input type="checkbox" id="${id}" ${val ? 'checked' : ''}>`;
        return `
          <h2>Security Preferences</h2>
          <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-project-mod', sec['project mod'])} Allow project file modifications without asking</label></div>
          <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-cloud-mod',   sec['cloud mod'])}   Allow cloud modifications without asking</label></div>
          <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-all-files',   sec['all files'])}   Allow all file modifications without asking</label></div>
          <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-sudo',         sec['sudo'])}        Allow sudo / system-level access</label></div>
          <div class="setup-field"><label class="setup-checkbox-label">${chk('setup-browser-access', sec['browser access'])} Allow model / web access</label></div>
          <div class="setup-field">
            <label>Local Key File Path:</label>
            <input type="text" id="setup-key-path" class="setup-input"
              placeholder="default" value="${escapeHtml(sec['local key file path'] || 'default')}">
          </div>
        `;
      },
      collect: () => ({
        'project mod':         document.getElementById('setup-project-mod')?.checked    || false,
        'cloud mod':           document.getElementById('setup-cloud-mod')?.checked      || false,
        'all files':           document.getElementById('setup-all-files')?.checked      || false,
        sudo:                  document.getElementById('setup-sudo')?.checked           || false,
        'browser access':      document.getElementById('setup-browser-access')?.checked || false,
        'local key file path': document.getElementById('setup-key-path')?.value         || 'default',
      })
    },

    // ── 13: Finish ────────────────────────────────────────────────
    {
      id: 'finish',
      title: 'Done!',
      render: () => `
        <h2>All Set!</h2>
        <p>Your configuration is complete.</p>
        <p>Click <strong>Finish</strong> to save all settings and start using mama.</p>
        <p class="setup-hint">Everything can be changed later from the settings page.</p>
      `
    }
  ];

  // ═══════════════════════════════════════════════════════════════
  // Wizard state
  // ═══════════════════════════════════════════════════════════════

  let currentStep   = 0;
  let settingsCache = null;

  // ═══════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════

  async function loadSettings() {
    try {
      settingsCache = await window.electron.settingsRead();
      if (!settingsCache) settingsCache = defaultSettings();
      selectedMode = settingsCache['hardware settings']?.mode || 'gpu';
    } catch (e) {
      console.error('Failed to load settings:', e);
      settingsCache = defaultSettings();
    }
    return settingsCache;
  }

  function defaultSettings() {
    return {
      'general settings':   { setup: true, language: 'eng' },
      'aesthetic settings': { appearance: 'system', 'scaling factor': 1, 'accent color': 'default' },
      'hardware settings':  { 'graphics manufacturer': 'unscanned', 'target card name': null, 'cuda version': null, 'rocm version': null, mode: 'gpu' },
      'software information': { 'OS full': null, 'OS pretty': null, 'OS kernel': null, cmake: false, gcc: false, tf: false, pyt: false },
      'resource settings':  { 'cloud resources': false, 'cloud provider name': null, 'local hostname': null, 'trainer browser': 'default' },
      'security settings':  { 'local key file path': 'default', 'project mod': false, 'cloud mod': false, 'all files': false, sudo: false, 'browser access': false },
      'qol settings':       { 'reels enable': false, 'reels provider': null, 'site enable': false, 'site provider': null, 'resources': 'ask', 'database provider': null },
    };
  }

  // Persist step data into settingsCache while DOM elements still exist.
  function applyStepData(step) {
    if (!step?.collect || !settingsCache) return;
    const data = step.collect();
    const si   = () => settingsCache['software information'] = settingsCache['software information'] || {};
    const hw   = () => settingsCache['hardware settings']    = settingsCache['hardware settings']    || {};

    switch (step.id) {
      case 'language':     settingsCache['general settings'].language = data; break;
      case 'appearance':   Object.assign(settingsCache['aesthetic settings'], data); break;
      case 'os-detect':    Object.assign(si(), { 'OS full': data['OS full'], 'OS pretty': data['OS pretty'], 'OS kernel': data['OS kernel'] }); break;
      case 'gpu-detect':   Object.assign(hw(), { 'graphics manufacturer': data['graphics manufacturer'], 'target card name': data['target card name'], 'cuda version': data['cuda version'], 'rocm version': data['rocm version'] }); break;
      case 'compat-check': Object.assign(hw(), { mode: data.mode }); break;
      case 'framework':    selectedFramework = data; break;
      case 'resources':    Object.assign(settingsCache['resource settings'], data); break;
      case 'qol':          Object.assign(settingsCache['qol settings'],      data); break;
      case 'security':     Object.assign(settingsCache['security settings'], data); break;
      // fw-install and fw-verify are tracked via installSucceeded / collect return values
    }
  }

  async function collectAndSave() {
    if (!settingsCache) return;

    // Collect the current step before saving (handles Finish click)
    applyStepData(STEPS[currentStep]);

    const si = settingsCache['software information'] = settingsCache['software information'] || {};
    si.tf    = installSucceeded && selectedFramework === 'tf';
    si.pyt   = installSucceeded && selectedFramework === 'torch';
    si.cmake = detected.cmakeAvailable;
    si.gcc   = detected.gccAvailable;

    try {
      await window.electron.settingsWrite(settingsCache);

      // Framework flags written separately as nonbackup
      const current = await window.electron.settingsRead() || settingsCache;
      current['software information']     = current['software information'] || {};
      current['software information'].tf  = si.tf;
      current['software information'].pyt = si.pyt;
      await window.electron.settingsWriteNonbackup(current);

      await window.electron.setupComplete();
      await window.electron.navigateTo('public/index.html');
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════

  async function renderStep() {
    const step = STEPS[currentStep];
    if (!step) return;

    const container = document.getElementById('setup-content');
    if (!container) return;

    // render() is always sync; await handles the rare Promise case gracefully
    container.innerHTML = await Promise.resolve(step.render(settingsCache));
    if (step.afterRender) await step.afterRender();

    // Progress dots
    const prog = document.getElementById('setup-progress');
    if (prog) {
      prog.innerHTML = STEPS.map((s, i) => {
        const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
        return `<span class="progress-dot ${cls}" title="${escapeHtml(s.title)}"></span>`;
      }).join('');
    }

    const backBtn   = document.getElementById('setup-back');
    const nextBtn   = document.getElementById('setup-next');
    const skipBtn   = document.getElementById('setup-skip');
    const finishBtn = document.getElementById('setup-finish');
    const isLast    = currentStep === STEPS.length - 1;

    if (backBtn)   backBtn.style.display   = currentStep === 0 ? 'none' : 'inline-block';
    if (nextBtn)   nextBtn.style.display   = isLast ? 'none' : 'inline-block';
    if (skipBtn)   skipBtn.style.display   = isLast ? 'none' : 'inline-block';
    if (finishBtn) finishBtn.style.display = isLast ? 'inline-block' : 'none';
  }

  async function nextStep() {
    applyStepData(STEPS[currentStep]);
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      await renderStep();
    }
  }

  async function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      await renderStep();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Bootstrap
  // ═══════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', async () => {
    const wizard = document.createElement('div');
    wizard.id    = 'setup-wizard';
    wizard.innerHTML = `
      <div id="setup-header">
        <h1>mama Setup</h1>
        <div id="setup-progress"></div>
      </div>
      <div id="setup-content"></div>
      <div id="setup-actions">
        <button id="setup-back"   class="setup-btn setup-btn-secondary">← Back</button>
        <button id="setup-next"   class="setup-btn setup-btn-primary">Next →</button>
        <button id="setup-skip"   class="setup-btn setup-btn-secondary">Skip →→→</button>
        <button id="setup-finish" class="setup-btn setup-btn-success" style="display:none">✓ Finish</button>
      </div>
    `;

    const app = document.getElementById('setup-app');
    if (app) { app.innerHTML = ''; app.appendChild(wizard); }
    else      { document.body.innerHTML = ''; document.body.appendChild(wizard); }

    await loadSettings();

    document.getElementById('setup-next')?.addEventListener('click', nextStep);
    document.getElementById('setup-back')?.addEventListener('click', prevStep);
    document.getElementById('setup-finish')?.addEventListener('click', collectAndSave);
    document.getElementById('setup-skip')?.addEventListener('click', async () => {
      try {
        await window.electron.setupComplete();
        await window.electron.navigateTo('public/index.html');
      } catch (e) { console.error('Skip failed:', e); }
    });

    await renderStep();
  });

})();