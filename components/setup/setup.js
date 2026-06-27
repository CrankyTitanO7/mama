// Setup Wizard — runs on first launch
//
// Step order:
//   Welcome → Language → Appearance →
//   OS Detection → Python & Tools Detection → GPU Detection →
//   Framework Selection → Framework Install → Framework Verification →
//   Resources → QoL → Security → Finish
//
// ── Required IPC calls (add to main.js / preload.js) ───────────────────────
//
//   window.electron.runOSDetect()
//   window.electron.runPythonDetect()
//   window.electron.runGPUDetect()
//   window.electron.runInstall(fw, gpuVariant)   ← gpuVariant: 'cuda' | 'rocm' | 'cpu'
//   window.electron.runImportTest(fw)
//   window.electron.settingsRead()
//   window.electron.settingsWrite(obj)
//   window.electron.settingsWriteNonbackup(obj)
//   window.electron.setupComplete()
//
// ── Expected script output formats (KEY=VALUE per line) ────────────────────
//
//   runOSDetect()
//     Windows  → winreg HKLM\...\CurrentVersion
//       OS_FULL    = Windows 11 Pro 24H2
//       OS_PRETTY  = Windows 11 Pro
//       OS_KERNEL  = 10.0.26100
//
//     Linux    → /etc/os-release + uname -r
//       OS_FULL    = Ubuntu 22.04.3 LTS (kernel 5.15.0-89-generic)
//       OS_PRETTY  = Ubuntu 22.04.3 LTS
//       OS_KERNEL  = 5.15.0-89-generic
//
//     macOS    → sw_vers + uname -r
//       OS_FULL    = macOS 14.5 (Sonoma)
//       OS_PRETTY  = macOS 14.5
//       OS_KERNEL  = 23.5.0
//
//   runPythonDetect()
//     PYTHON_VERSION  = 3.11.5          (or empty if not found)
//     PIP_AVAILABLE   = true | false
//     CMAKE_AVAILABLE = true | false
//     GCC_AVAILABLE   = true | false
//
//   runGPUDetect()
//     GPU_MANUFACTURER = nvidia | amd | intel | none
//     GPU_NAME         = NVIDIA GeForce RTX 4070
//     GPU_VRAM_MB      = 12288           (optional)
//     CUDA_VERSION     = 12.1            (nvidia only, empty otherwise)
//     ROCM_VERSION     = 5.7             (amd only, empty otherwise)
//     DRIVER_VERSION   = 536.23          (optional)
//
//     Detection logic:
//       nvidia → nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
//               + parse CUDA version from "nvidia-smi" header line
//       amd    → rocm-smi --showproductname  (Linux)
//               or lspci | grep -i "vga\|display" (fallback)
//       intel  → lspci | grep -i "intel.*graphics"  or  wmic path Win32_VideoController
//       none   → all above failed or returned nothing
//
//   runInstall(fw, gpuVariant)
//     fw:         'torch' | 'tf'
//     gpuVariant: 'cuda' | 'rocm' | 'cpu'
//
//     Resulting pip commands:
//
//       torch + cuda  → pip install torch torchvision torchaudio \
//                         --index-url https://download.pytorch.org/whl/cu<CUDA_MAJOR_MINOR>
//                       e.g. cu121 for CUDA 12.1
//
//       torch + rocm  → pip install torch torchvision torchaudio \
//                         --index-url https://download.pytorch.org/whl/rocm<ROCM_MAJOR>
//                       e.g. rocm5.7
//
//       torch + cpu   → pip install torch torchvision torchaudio \
//                         --index-url https://download.pytorch.org/whl/cpu
//
//       tf    + cuda  → pip install tensorflow[and-cuda]
//       tf    + rocm  → pip install tensorflow-rocm
//       tf    + cpu   → pip install tensorflow-cpu

(function () {

  // ========== Module-level state ==========

  let selectedFramework = null; // 'torch' | 'tf'
  let installSucceeded  = false;

  // Populated by detection steps; read by later steps
  const detected = {
    // OS
    osFullName:    '',
    osPrettyName:  '',
    osKernel:      '',
    // Python / tools
    pythonVersion:  null,
    pipAvailable:   false,
    cmakeAvailable: false,
    gccAvailable:   false,
    // GPU
    gpuManufacturer: 'none',   // 'nvidia' | 'amd' | 'intel' | 'none'
    gpuName:         '',
    gpuVramMB:       null,
    cudaVersion:     '',
    rocmVersion:     '',
    driverVersion:   ''
  };

  // ========== Utilities ==========

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

  function boolVal(str)     { return str?.toLowerCase() === 'true'; }
  function statusIcon(ok)   { return ok ? '✅' : '❌'; }
  function warnIcon(ok)     { return ok ? '✅' : '⚠️'; }

  /** Derive the pip index URL for PyTorch based on detected GPU info. */
  function torchIndexURL() {
    const mfr = detected.gpuManufacturer;
    if (mfr === 'nvidia' && detected.cudaVersion) {
      // Convert "12.1" → "cu121", "11.8" → "cu118"
      const tag = 'cu' + detected.cudaVersion.replace('.', '');
      return `https://download.pytorch.org/whl/${tag}`;
    }
    if (mfr === 'amd' && detected.rocmVersion) {
      return `https://download.pytorch.org/whl/rocm${detected.rocmVersion}`;
    }
    return 'https://download.pytorch.org/whl/cpu';
  }

  /** Human-readable variant label */
  function gpuVariantLabel() {
    const mfr = detected.gpuManufacturer;
    if (mfr === 'nvidia') return detected.cudaVersion ? `CUDA ${detected.cudaVersion}` : 'CUDA (version unknown)';
    if (mfr === 'amd')    return detected.rocmVersion ? `ROCm ${detected.rocmVersion}` : 'ROCm (version unknown)';
    if (mfr === 'apple')  return `MPS${detected.metalVersion ? ` (Metal ${detected.metalVersion})` : ''}`;
    return 'CPU-only';
  }

  /** gpuVariant string passed to runInstall() */
  function gpuVariant() {
    if (detected.gpuManufacturer === 'nvidia') return 'cuda';
    if (detected.gpuManufacturer === 'amd')    return 'rocm';
    if (detected.gpuManufacturer === 'apple')  return 'mps';
    return 'cpu';
  }

  // ========== Step definitions ==========

  const STEPS = [

    // ============================================
    // STEP 0: Welcome
    // ============================================
    {
      id: 'welcome',
      title: 'Welcome',
      render: () => `
        <h2>Welcome to mama!</h2>
        <p>Let's get your environment configured. This will only take a moment.</p>
        <p>mama will detect your OS, Python install, and GPU automatically — then install the right
           version of PyTorch or TensorFlow for your hardware.</p>
        <p class="setup-hint">You can revisit these settings anytime from the settings page.</p>
      `
    },

    // ============================================
    // STEP 1: Language
    // ============================================
    {
      id: 'language',
      title: 'Language',
      render: (settings) => {
        const lang = settings['general settings']?.language || 'eng';
        return `
          <h2>Language</h2>
          <p>Select your preferred language:</p>
          <select id="setup-language" class="setup-select">
            <option value="eng" ${lang === 'eng' ? 'selected' : ''}>English</option>
            <option value="spa" ${lang === 'spa' ? 'selected' : ''}>Spanish</option>
            <option value="fra" ${lang === 'fra' ? 'selected' : ''}>French</option>
            <option value="deu" ${lang === 'deu' ? 'selected' : ''}>German</option>
            <option value="jpn" ${lang === 'jpn' ? 'selected' : ''}>Japanese</option>
            <option value="zho" ${lang === 'zho' ? 'selected' : ''}>Chinese</option>
          </select>
        `;
      },
      collect: () => document.getElementById('setup-language')?.value || 'eng'
    },

    // ============================================
    // STEP 2: Appearance
    // ============================================
    {
      id: 'appearance',
      title: 'Appearance',
      render: async (settings) => {
        const appearance   = settings['aesthetic settings']?.appearance       || 'system';
        const accent       = settings['aesthetic settings']?.['accent color'] || 'default';
        const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];

        // Build theme dropdown options — try custom themes first, then fallback
        let themeOptions =
          `<option value="system" ${appearance === 'system' ? 'selected' : ''}>System</option>`;

        // Access themes from ThemeManager if loaded, or try direct IPC as fallback
        let customThemes = window.ThemeManager?.getCustomThemeList?.() || [];
        if (customThemes.length === 0 && window.electron?.themesRead) {
          try {
            const themes = await window.electron.themesRead();
            if (Array.isArray(themes) && themes.length > 0) {
              customThemes = themes;
            }
          } catch (_) {}
        }

        if (customThemes.length > 0) {
          for (const t of customThemes) {
            const sel = appearance === t.name ? 'selected' : '';
            themeOptions += `<option value="${t.name}" ${sel}>${escapeHtml(t.title)}</option>`;
          }
        } else {
          // No custom themes available — show fallback option
          const sel = appearance === '__default__' ? 'selected' : '';
          themeOptions += `<option value="__default__" ${sel}>Fallback</option>`;
        }

        return `
          <h2>Appearance</h2>
          <div class="setup-field">
            <label>Theme:</label>
            <select id="setup-appearance" class="setup-select">
              ${themeOptions}
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
              min="0.5" max="3" step="0.25"
              value="${settings['aesthetic settings']?.['scaling factor'] || 1}">
          </div>
        `;
      },
      collect: () => ({
        appearance:       document.getElementById('setup-appearance')?.value || 'system',
        'accent color':   document.getElementById('setup-accent')?.value    || 'default',
        'scaling factor': parseFloat(document.getElementById('setup-scaling')?.value) || 1
      })
    },

    // ============================================
    // STEP 3: OS Detection  (auto-runs on render)
    // Calls window.electron.runOSDetect()
    // See file header for expected output format.
    // ============================================
    {
      id: 'os-detect',
      title: 'OS Detection',
      render: () => `
        <h2>Operating System Detection</h2>
        <p>Detecting your operating system...</p>
        <div id="os-detect-output" class="setup-detect-output">
          <p class="setup-hint">⏳ Running detection...</p>
        </div>
        <div id="os-fields" style="display:none">
          <div class="setup-field">
            <label>OS Full Name
              <span class="setup-hint">&nbsp;— e.g. Windows 11 Pro 24H2 / Ubuntu 22.04.3 LTS (kernel 5.15.0-89-generic)</span>
            </label>
            <input type="text" id="setup-os-full"   class="setup-input">
          </div>
          <div class="setup-field">
            <label>OS Pretty Name
              <span class="setup-hint">&nbsp;— e.g. Windows 11 Pro / Ubuntu 22.04.3 LTS</span>
            </label>
            <input type="text" id="setup-os-pretty" class="setup-input">
          </div>
          <div class="setup-field">
            <label>Kernel / Build
              <span class="setup-hint">&nbsp;— e.g. 10.0.26100 / 5.15.0-89-generic / 23.5.0</span>
            </label>
            <input type="text" id="setup-os-kernel" class="setup-input">
          </div>
          <div class="setup-actions-inline">
            <button id="os-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
          </div>
        </div>
      `,
      afterRender: () => {
        runOSScan();

        document.getElementById('os-rescan-btn')?.addEventListener('click', () => {
          const out = document.getElementById('os-detect-output');
          if (out) out.innerHTML = '<p class="setup-hint">⏳ Running detection...</p>';
          runOSScan();
        });

        async function runOSScan() {
          const out    = document.getElementById('os-detect-output');
          const fields = document.getElementById('os-fields');
          if (!out) return;

          try {
            const result = await window.electron.runOSDetect();
            const kv     = parseKV(result.stdout);

            detected.osFullName   = kv['OS_FULL']   || '';
            detected.osPrettyName = kv['OS_PRETTY']  || '';
            detected.osKernel     = kv['OS_KERNEL']  || '';

            if (detected.osFullName) {
              out.innerHTML = `<div class="setup-success-msg">✅ OS detected: <strong>${escapeHtml(detected.osFullName)}</strong></div>`;
            } else {
              out.innerHTML = `<div class="setup-error-msg">⚠️ Could not auto-detect OS — please fill in manually.</div>`;
            }

            // Populate editable fields
            const full   = document.getElementById('setup-os-full');
            const pretty = document.getElementById('setup-os-pretty');
            const kernel = document.getElementById('setup-os-kernel');
            if (full)   full.value   = detected.osFullName;
            if (pretty) pretty.value = detected.osPrettyName;
            if (kernel) kernel.value = detected.osKernel;

            if (fields) fields.style.display = 'block';

            if (result.stderr && result.code !== 0) {
              out.innerHTML += `<pre class="setup-pre setup-pre-error">${escapeHtml(result.stderr)}</pre>`;
            }
          } catch (e) {
            out.innerHTML = `
              <p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>
              <p class="setup-hint">Fill in manually below.</p>
            `;
            if (fields) fields.style.display = 'block';
          }
        }
      },
      collect: () => {
        // Prefer edited field values over auto-detected cache
        detected.osFullName   = document.getElementById('setup-os-full')?.value   || detected.osFullName;
        detected.osPrettyName = document.getElementById('setup-os-pretty')?.value || detected.osPrettyName;
        detected.osKernel     = document.getElementById('setup-os-kernel')?.value || detected.osKernel;
        return {
          'OS full':   detected.osFullName,
          'OS pretty': detected.osPrettyName,
          'OS kernel': detected.osKernel
        };
      }
    },

    // ============================================
    // STEP 4: Python & Tools Detection  (auto-runs on render)
    // Calls window.electron.runPythonDetect()
    // See file header for expected output format.
    // ============================================
    {
      id: 'python-detect',
      title: 'Python & Tools',
      render: () => `
        <h2>Python &amp; Tools Detection</h2>
        <p>Checking for Python, pip, CMake, and GCC...</p>
        <div id="py-detect-output" class="setup-detect-output">
          <p class="setup-hint">⏳ Running detection...</p>
        </div>
        <div class="setup-actions-inline" style="margin-top:12px; display:none" id="py-rescan-wrap">
          <button id="py-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
        </div>
        <div id="py-missing-warn" style="display:none">
          <p class="setup-hint">
            ⚠️ Python was not found. mama requires Python 3.8 or later.<br>
            Please install Python from <strong>python.org</strong> and re-scan before continuing.
          </p>
        </div>
      `,
      afterRender: () => {
        runPyScan();

        document.getElementById('py-rescan-btn')?.addEventListener('click', () => {
          const out = document.getElementById('py-detect-output');
          if (out) out.innerHTML = '<p class="setup-hint">⏳ Running detection...</p>';
          runPyScan();
        });

        async function runPyScan() {
          const out      = document.getElementById('py-detect-output');
          const rescanWr = document.getElementById('py-rescan-wrap');
          const misWarn  = document.getElementById('py-missing-warn');
          if (!out) return;

          try {
            const result = await window.electron.runPythonDetect();
            const kv     = parseKV(result.stdout);

            detected.pythonVersion  = kv['PYTHON_VERSION']  || null;
            detected.pipAvailable   = boolVal(kv['PIP_AVAILABLE']);
            detected.cmakeAvailable = boolVal(kv['CMAKE_AVAILABLE']);
            detected.gccAvailable   = boolVal(kv['GCC_AVAILABLE']);

            const pyOk = !!detected.pythonVersion;

            out.innerHTML = `
              <table class="setup-status-table">
                <tbody>
                  <tr>
                    <td>${statusIcon(pyOk)}</td>
                    <td>Python</td>
                    <td class="setup-hint">${escapeHtml(detected.pythonVersion || 'not found')}</td>
                  </tr>
                  <tr>
                    <td>${statusIcon(detected.pipAvailable)}</td>
                    <td>pip</td>
                    <td class="setup-hint">${detected.pipAvailable ? 'available' : 'not found'}</td>
                  </tr>
                  <tr>
                    <td>${warnIcon(detected.cmakeAvailable)}</td>
                    <td>CMake <span class="setup-hint">(optional)</span></td>
                    <td class="setup-hint">${detected.cmakeAvailable ? 'available' : 'not found'}</td>
                  </tr>
                  <tr>
                    <td>${warnIcon(detected.gccAvailable)}</td>
                    <td>GCC / C++ compiler <span class="setup-hint">(optional)</span></td>
                    <td class="setup-hint">${detected.gccAvailable ? 'available' : 'not found'}</td>
                  </tr>
                </tbody>
              </table>
            `;

            if (misWarn) misWarn.style.display = pyOk ? 'none' : 'block';
          } catch (e) {
            out.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>`;
          } finally {
            if (rescanWr) rescanWr.style.display = 'block';
          }
        }
      }
    },

    // ============================================
    // STEP 5: GPU Detection  (auto-runs on render)
    // Calls window.electron.runGPUDetect()
    // See file header for expected output format.
    // ============================================
    {
      id: 'gpu-detect',
      title: 'GPU Detection',
      render: () => `
        <h2>GPU Detection</h2>
        <p>Scanning for your graphics hardware...</p>
        <div id="gpu-detect-output" class="setup-detect-output">
          <p class="setup-hint">⏳ Running detection...</p>
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
          <div class="setup-field">
            <label>CUDA Version <span class="setup-hint">(NVIDIA only — leave blank for CPU / AMD)</span>:</label>
            <input type="text" id="setup-cuda-ver" class="setup-input" placeholder="e.g. 12.1">
          </div>
          <div class="setup-field">
            <label>ROCm Version <span class="setup-hint">(AMD only — leave blank for CPU / NVIDIA)</span>:</label>
            <input type="text" id="setup-rocm-ver" class="setup-input" placeholder="e.g. 5.7">
          </div>
          <div class="setup-actions-inline">
            <button id="gpu-rescan-btn" class="setup-btn setup-btn-secondary">🔄 Re-scan</button>
          </div>
        </div>
        <div id="gpu-raw-output" class="setup-detect-output" style="display:none"></div>
      `,
      afterRender: () => {
        runGPUScan();

        document.getElementById('gpu-rescan-btn')?.addEventListener('click', () => {
          const out = document.getElementById('gpu-detect-output');
          if (out) out.innerHTML = '<p class="setup-hint">⏳ Running detection...</p>';
          runGPUScan();
        });

        // When manufacturer changes, show/hide CUDA / ROCm fields sensibly
        document.getElementById('setup-gpu-mfr')?.addEventListener('change', (e) => {
          const mfr       = e.target.value;
          const cudaField = document.getElementById('setup-cuda-ver');
          const rocmField = document.getElementById('setup-rocm-ver');
          if (cudaField) cudaField.closest('.setup-field').style.opacity = mfr === 'nvidia' ? '1' : '0.4';
          if (rocmField) rocmField.closest('.setup-field').style.opacity = mfr === 'amd'    ? '1' : '0.4';
        });

        async function runGPUScan() {
          const out    = document.getElementById('gpu-detect-output');
          const fields = document.getElementById('gpu-fields');
          const raw    = document.getElementById('gpu-raw-output');
          if (!out) return;

          try {
            const result = await window.electron.runGPUDetect();
            const kv     = parseKV(result.stdout);

            detected.gpuManufacturer = (kv['GPU_MANUFACTURER'] || 'none').toLowerCase();
            detected.gpuName         = kv['GPU_NAME']        || '';
            detected.gpuVramMB       = kv['GPU_VRAM_MB']     ? parseInt(kv['GPU_VRAM_MB']) : null;
            detected.cudaVersion     = kv['CUDA_VERSION']    || '';
            detected.rocmVersion     = kv['ROCM_VERSION']    || '';
            detected.driverVersion   = kv['DRIVER_VERSION']  || '';
            detected.metalVersion    = kv['METAL_VERSION']   || '';
            detected.mpsAvailable    = kv['MPS_AVAILABLE']   || '';
            detected.gpuType         = kv['GPU_TYPE']        || '';
            detected.metalVersion    = kv['METAL_VERSION']   || '';
            detected.mpsAvailable    = kv['MPS_AVAILABLE']   || '';
            detected.gpuType         = kv['GPU_TYPE']        || '';

            const mfrLabel = {
              nvidia: 'NVIDIA',
              amd:    'AMD',
              apple:  'Apple',
              intel:  'Intel',
              none:   'None / CPU only'
            }[detected.gpuManufacturer] || 'Unknown';

            const vramStr = detected.gpuVramMB
              ? ` — ${(detected.gpuVramMB / 1024).toFixed(1)} GB VRAM`
              : '';
            const accelStr = detected.cudaVersion
              ? ` (CUDA ${detected.cudaVersion})`
              : detected.rocmVersion
                ? ` (ROCm ${detected.rocmVersion})`
                : detected.metalVersion
                  ? ` (Metal ${detected.metalVersion})`
                  : '';
            const mpsStr = detected.mpsAvailable === 'true'
              ? ' — MPS available'
              : '';

            if (detected.gpuManufacturer !== 'none' && detected.gpuName) {
              out.innerHTML = `
                <div class="setup-success-msg">
                  ✅ GPU detected: <strong>${escapeHtml(detected.gpuName)}</strong>${escapeHtml(vramStr + accelStr + mpsStr)}
                </div>
              `;
            } else if (detected.gpuManufacturer !== 'none') {
              out.innerHTML = `<div class="setup-success-msg">✅ ${mfrLabel} GPU detected${escapeHtml(accelStr + mpsStr)}</div>`;
            } else {
              out.innerHTML = `
                <div class="setup-hint">
                  ℹ️ No discrete GPU detected — will install CPU-only framework variants.
                  If you have a GPU, check your drivers and re-scan, or select manually below.
                </div>
              `;
            }

            // Populate editable fields
            const mfrSelect  = document.getElementById('setup-gpu-mfr');
            const nameInput  = document.getElementById('setup-gpu-name');
            const cudaInput  = document.getElementById('setup-cuda-ver');
            const rocmInput  = document.getElementById('setup-rocm-ver');
            if (mfrSelect) mfrSelect.value = detected.gpuManufacturer;
            if (nameInput) nameInput.value = detected.gpuName;
            if (cudaInput) cudaInput.value = detected.cudaVersion;
            if (rocmInput) rocmInput.value = detected.rocmVersion;

            if (fields) fields.style.display = 'block';

            if (result.stderr) {
              if (raw) {
                raw.style.display = 'block';
                raw.innerHTML = `<pre class="setup-pre setup-pre-error">${escapeHtml(result.stderr)}</pre>`;
              }
            }
          } catch (e) {
            out.innerHTML = `
              <p class="setup-hint">⚠️ GPU detection failed: ${escapeHtml(e.message)}</p>
              <p class="setup-hint">Select manually below.</p>
            `;
            if (fields) fields.style.display = 'block';
          }
        }
      },
      collect: () => {
        // Commit any manual overrides back to detected state
        detected.gpuManufacturer = document.getElementById('setup-gpu-mfr')?.value  || detected.gpuManufacturer;
        detected.gpuName         = document.getElementById('setup-gpu-name')?.value || detected.gpuName;
        detected.cudaVersion     = document.getElementById('setup-cuda-ver')?.value || detected.cudaVersion;
        detected.rocmVersion     = document.getElementById('setup-rocm-ver')?.value || detected.rocmVersion;
        return {
          'graphics manufacturer': detected.gpuManufacturer,
          'target card name':      detected.gpuName         || null,
          'cuda version':          detected.cudaVersion     || null,
          'rocm version':          detected.rocmVersion     || null
        };
      }
    },

    // ============================================
    // STEP 6: Framework Selection
    // Pre-suggests PyTorch for NVIDIA/AMD (better GPU ecosystem),
    // TensorFlow for Intel or CPU-only (historically better CPU perf).
    // ============================================
    {
      id: 'framework',
      title: 'AI Framework',
      render: (settings) => {
        const pytAlready  = settings['software information']?.pyt === true;
        const tfAlready   = settings['software information']?.tf  === true;

        // Smart default: suggest PyTorch for NVIDIA/AMD, TF for Intel/none
        let suggested = 'torch';
        if (detected.gpuManufacturer === 'intel' || detected.gpuManufacturer === 'none') {
          suggested = 'tf';
        }
        const preSelected = selectedFramework
          || (pytAlready && !tfAlready ? 'torch' : tfAlready && !pytAlready ? 'tf' : suggested);

        const variant    = gpuVariantLabel();
        const indexUrl   = torchIndexURL();

        return `
          <h2>AI Framework</h2>
          <p>Which deep learning framework would you like to use?</p>
          <div class="setup-hint" style="margin-bottom:12px">
            Detected hardware: <strong>${escapeHtml(detected.gpuName || detected.gpuManufacturer || 'CPU only')}</strong>
            — install variant will be <strong>${escapeHtml(variant)}</strong>
          </div>
          <div class="setup-radio-group">
            <label class="setup-radio-label">
              <input type="radio" name="framework" value="torch" ${preSelected === 'torch' ? 'checked' : ''}>
              <span class="setup-radio-title">PyTorch</span>
              <span class="setup-radio-desc">
                torch, torchvision, torchaudio
                ${detected.gpuManufacturer === 'nvidia' ? `<br><code>--index-url ${escapeHtml(indexUrl)}</code>` : ''}
                ${detected.gpuManufacturer === 'amd'    ? `<br><code>--index-url ${escapeHtml(indexUrl)}</code>` : ''}
                ${detected.gpuManufacturer === 'none' || detected.gpuManufacturer === 'intel'
                  ? '<br>CPU-only wheels' : ''}
              </span>
            </label>
            <label class="setup-radio-label">
              <input type="radio" name="framework" value="tf" ${preSelected === 'tf' ? 'checked' : ''}>
              <span class="setup-radio-title">TensorFlow</span>
              <span class="setup-radio-desc">
                ${detected.gpuManufacturer === 'nvidia' ? 'tensorflow[and-cuda]' : ''}
                ${detected.gpuManufacturer === 'amd'    ? 'tensorflow-rocm' : ''}
                ${detected.gpuManufacturer === 'intel' || detected.gpuManufacturer === 'none'
                  ? 'tensorflow-cpu' : ''}
              </span>
            </label>
          </div>
        `;
      },
      afterRender: () => {
        document.querySelectorAll('input[name="framework"]').forEach(el => {
          el.addEventListener('change', (e) => {
            if (e.target.checked) selectedFramework = e.target.value;
          });
        });
      },
      collect: () => {
        const selected = document.querySelector('input[name="framework"]:checked')?.value || 'torch';
        selectedFramework = selected;
        return selected;
      }
    },

    // ============================================
    // STEP 7: Framework Install
    // GPU-aware: shows the exact pip command before running it.
    // Streams output to a live terminal window.
    // ============================================
    {
      id: 'fw-install',
      title: 'Framework Install',
      render: () => {
        const fw      = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        const variant = gpuVariantLabel();

        // Build the install command string for display
        let installCmd = '';
        if (selectedFramework === 'tf') {
          if (detected.gpuManufacturer === 'nvidia') installCmd = 'pip install tensorflow[and-cuda]';
          else if (detected.gpuManufacturer === 'amd') installCmd = 'pip install tensorflow-rocm';
          else installCmd = 'pip install tensorflow-cpu';
        } else {
          installCmd = `pip install torch torchvision torchaudio --index-url ${torchIndexURL()}`;
        }

        return `
          <h2>Install ${fw}</h2>
          <p>
            Installing <strong>${fw}</strong> with <strong>${escapeHtml(variant)}</strong> support.
          </p>
          <div class="setup-field">
            <label>Install command:</label>
            <input type="text" id="install-cmd-input" class="setup-input setup-input-mono"
              value="${escapeHtml(installCmd)}">
            <p class="setup-hint">Edit if you need a different CUDA/ROCm version — see pytorch.org/get-started.</p>
          </div>
          <div class="setup-actions-inline">
            <button id="run-fw-install-btn" class="setup-btn setup-btn-primary">
              ⬇️ Install ${fw}
            </button>
          </div>
          <div id="fw-install-output" class="setup-detect-output" style="display:none"></div>
        `;
      },
      afterRender: () => {
        document.getElementById('run-fw-install-btn')?.addEventListener('click', async () => {
          const btn    = document.getElementById('run-fw-install-btn');
          const output = document.getElementById('fw-install-output');
          if (!output || !btn) return;

          output.style.display = 'block';
          output.innerHTML     = `
            <p class="setup-hint">⏳ Installing... Streaming output below:</p>
            <div id="fw-install-terminal" class="setup-terminal"></div>
          `;
          const terminal = document.getElementById('fw-install-terminal');
          btn.disabled         = true;
          btn.textContent      = '⏳ Installing...';

          const fw = selectedFramework || 'torch';
          const gv = gpuVariant();
          let exitCode = null;

          try {
            exitCode = await window.electron.runInstallStream(fw, gv, '', (chunk) => {
              if (chunk.type === 'stdout' || chunk.type === 'stderr') {
                if (terminal) {
                  const span = document.createElement('span');
                  span.className = chunk.type === 'stderr' ? 'terminal-stderr' : 'terminal-stdout';
                  span.textContent = chunk.text || '';
                  terminal.appendChild(span);
                  // Auto-scroll to bottom
                  terminal.scrollTop = terminal.scrollHeight;
                }
              } else if (chunk.type === 'done') {
                exitCode = chunk.code;
              }
            });

            // Ensure exitCode is set (from either the resolved promise or the chunk callback)
            if (exitCode === null) exitCode = 0;

    if (exitCode === 0) {
              installSucceeded = true;
              // Append success message inside terminal area
              if (terminal) {
                const msg = document.createElement('div');
                msg.className = 'terminal-status terminal-success';
                msg.textContent = '✅ Installation complete!';
                terminal.appendChild(msg);
                terminal.scrollTop = terminal.scrollHeight;
              }
              btn.textContent = '✓ Installed';
            } else {
              if (terminal) {
                const msg = document.createElement('div');
                msg.className = 'terminal-status terminal-error';
                msg.textContent = '❌ Installation failed — check output above.';
                terminal.appendChild(msg);
                terminal.scrollTop = terminal.scrollHeight;
              }
              btn.textContent = '⬇️ Retry';
              btn.disabled    = false;
            }
          } catch (e) {
            if (terminal) {
              const msg = document.createElement('div');
              msg.className = 'terminal-status terminal-error';
              msg.textContent = `⚠️ Error: ${e.message}`;
              terminal.appendChild(msg);
            }
            btn.textContent  = '⬇️ Retry';
            btn.disabled     = false;
          }
        });
      }
    },

    // ============================================
    // STEP 8: Framework Verification
    // ============================================
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
          <div>
            <button id="run-verify-btn" class="setup-btn setup-btn-primary">▶ Run Import Test</button>
          </div>
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
          statusDiv.innerHTML     = '<p class="setup-hint">⏳ Running import test...</p>';
          testBtn.disabled        = true;
          testBtn.style.opacity   = '0.5';

          try {
            const result = await window.electron.runImportTest(fw);
            const stdout = result.stdout || '';
            const stderr = result.stderr || '';

            if (result.code === 0) {
              statusDiv.innerHTML = `
                <div class="setup-success-msg">✅ ${fwName} is working!</div>
                <pre class="setup-pre">${escapeHtml(stdout)}</pre>
              `;
              testBtn.textContent   = '✓ Verified';
              testBtn.style.opacity = '0.7';
            } else {
              statusDiv.innerHTML = `
                <div class="setup-error-msg">❌ ${fwName} import failed</div>
                <pre class="setup-pre setup-pre-error">${escapeHtml(stdout || stderr || 'Unknown error')}</pre>
                <p>Would you like to try installing again?</p>
                <button id="retry-install-btn" class="setup-btn setup-btn-success">⬇️ Retry Install</button>
              `;
              if (installDiv) installDiv.style.display = 'none';

              document.getElementById('retry-install-btn')?.addEventListener('click', async () => {
                const retryBtn = document.getElementById('retry-install-btn');
                if (installDiv) {
                  installDiv.style.display = 'block';
                  installDiv.innerHTML     = '<p class="setup-hint">⏳ Installing...</p>';
                }
                if (retryBtn) { retryBtn.disabled = true; retryBtn.textContent = '⏳ Installing...'; }

                try {
                  const ir = await window.electron.runInstall(fw, gpuVariant());
                  if (installDiv) {
                    installDiv.innerHTML = ir.code === 0
                      ? `<div class="setup-success-msg">✅ Installed!</div>
                         <pre class="setup-pre">${escapeHtml((ir.stdout || '').slice(0, 500))}</pre>`
                      : `<div class="setup-error-msg">❌ Install failed</div>
                         <pre class="setup-pre setup-pre-error">${escapeHtml(ir.stderr || ir.stdout || '')}</pre>`;
                  }
                  if (ir.code === 0) {
                    statusDiv.innerHTML = '<p class="setup-hint">⏳ Re-testing...</p>';
                    const retest = await window.electron.runImportTest(fw);
                    statusDiv.innerHTML = retest.code === 0
                      ? `<div class="setup-success-msg">✅ ${fwName} verified after reinstall!</div>
                         <pre class="setup-pre">${escapeHtml(retest.stdout || '')}</pre>`
                      : `<div class="setup-error-msg">❌ Still failing — check the install step output.</div>
                         <pre class="setup-pre setup-pre-error">${escapeHtml(retest.stderr || retest.stdout || '')}</pre>`;
                    if (retryBtn) retryBtn.textContent = '✓ Done';
                  } else {
                    if (retryBtn) { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
                  }
                } catch (e) {
                  if (installDiv) installDiv.innerHTML = `<p class="setup-hint">⚠️ ${escapeHtml(e.message)}</p>`;
                  if (retryBtn) { retryBtn.textContent = '⬇️ Retry'; retryBtn.disabled = false; }
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
      collect: () => {
        const statusDiv = document.getElementById('verify-status');
        return {
          importSucceeded: statusDiv?.textContent.includes('✅') || false,
          framework:       selectedFramework || 'torch'
        };
      }
    },

    // ============================================
    // STEP 9: Resources
    // ============================================
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
        'trainer browser':     document.getElementById('setup-trainer-browser')?.value || 'default'
      })
    },

    // ============================================
    // STEP 10: Quality of Life
    // ============================================
    {
      id: 'qol',
      title: 'Quality of Life',
      render: (settings) => {
        const qol = settings['qol settings'] || {};
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
            <label>Resources:</label>
            <select id="setup-resources" class="setup-select">
              <option value="ask"  ${(qol['resources'] ?? qol['task manager']) === 'ask'  ? 'selected' : ''}>Ask</option>
              <option value="true" ${(qol['resources'] ?? qol['task manager']) === true || (qol['resources'] ?? qol['task manager']) === 'always' ? 'selected' : ''}>Enabled</option>
              <option value="false" ${(qol['resources'] ?? qol['task manager']) === false || (qol['resources'] ?? qol['task manager']) === 'never' ? 'selected' : ''}>Disabled</option>
            </select>
          </div>
        `;
      },
      collect: () => ({
        'reels enable':            document.getElementById('setup-reels')?.checked          || false,
        'reels provider':          document.getElementById('setup-reels-provider')?.value   || null,
        'site enable':             document.getElementById('setup-site')?.checked           || false,
        'site provider':           document.getElementById('setup-site-provider')?.value     || null,
        'database explorer enable': document.getElementById('setup-db-explorer')?.checked   || false,
        'database provider':       document.getElementById('setup-db-provider')?.value      || null,
        'resources':               (() => {
          const v = document.getElementById('setup-resources')?.value;
          if (v === 'true') return true;
          if (v === 'false') return false;
          return 'ask';
        })()
      })
    },

    // ============================================
    // STEP 11: Security
    // ============================================
    {
      id: 'security',
      title: 'Security',
      render: (settings) => {
        const sec = settings['security settings'] || {};
        return `
          <h2>Security Preferences</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-project-mod" ${sec['project mod'] ? 'checked' : ''}>
              Allow project file modifications without asking
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-cloud-mod" ${sec['cloud mod'] ? 'checked' : ''}>
              Allow cloud modifications without asking
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-all-files" ${sec['all files'] ? 'checked' : ''}>
              Allow all file modifications without asking
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-sudo" ${sec['sudo'] ? 'checked' : ''}>
              Allow sudo / system-level access
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-browser-access" ${sec['browser access'] ? 'checked' : ''}>
              Allow model / web access
            </label>
          </div>
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
        'local key file path': document.getElementById('setup-key-path')?.value         || 'default'
      })
    },

    // ============================================
    // STEP 12: Finish
    // ============================================
    {
      id: 'finish',
      title: 'Done!',
      render: () => `
        <h2>All Set!</h2>
        <p>Your configuration is complete. Click <strong>Finish</strong> to start using mama.</p>
      `
    }
  ];

  // ========== Wizard state ==========

  let currentStep   = 0;
  let settingsCache = null;

  // ========== Settings management ==========

  async function loadSettings() {
    try {
      settingsCache = await window.electron.settingsRead();
      if (!settingsCache) settingsCache = getDefaultSettings();
      return settingsCache;
    } catch (e) {
      console.error('Failed to load settings:', e);
      settingsCache = getDefaultSettings();
      return settingsCache;
    }
  }

  function getDefaultSettings() {
    return {
      'general settings':   { setup: true, language: 'eng' },
      'aesthetic settings': { appearance: 'dark', 'scaling factor': 1, 'accent color': 'default' },
      'hardware settings': {
        'graphics manufacturer': 'unscanned',
        'target card name':      null,
        'cuda version':          null,
        'rocm version':          null
      },
      'software information': {
        'OS full': null, 'OS pretty': null, 'OS kernel': null,
        cmake: false, gcc: false, tf: false, pyt: false
      },
      'resource settings': {
        'cloud resources': false, 'cloud provider name': null,
        'local hostname':  null,  'trainer browser': 'default'
      },
      'security settings': {
        'local key file path': 'default',
        'project mod': false, 'cloud mod': false,
        'all files': false, sudo: false, 'browser access': false
      },
      'qol settings': {
        'reels enable': false, 'reels provider': null,
        'site enable': false, 'site provider': null,
        'resources': 'ask', 'database provider': null
      }
    };
  }

  async function collectAndSave() {
    if (!settingsCache) return;

    // All step data was already collected incrementally by applyStepData().
    // Only need to set framework flags (based on install result) and cmake/gcc.
    const si = settingsCache['software information'] = settingsCache['software information'] || {};
    if (installSucceeded && selectedFramework) {
      si.tf  = selectedFramework === 'tf';
      si.pyt = selectedFramework !== 'tf';
    } else {
      si.tf  = false;
      si.pyt = false;
    }
    si.cmake = detected.cmakeAvailable;
    si.gcc   = detected.gccAvailable;

    try {
      await window.electron.settingsWrite(settingsCache);

      // Write framework flags as nonbackup
      const current = await window.electron.settingsRead() || settingsCache;
      current['software information']     = current['software information'] || {};
      current['software information'].tf  = settingsCache['software information']?.tf  || false;
      current['software information'].pyt = settingsCache['software information']?.pyt || false;
      await window.electron.settingsWriteNonbackup(current);

      await window.electron.setupComplete();
      await window.electron.navigateTo('public/index.html');
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // ========== Step rendering ==========

  async function renderStep() {
    const step = STEPS[currentStep];
    if (!step) return;

    const container = document.getElementById('setup-content');
    if (!container) return;

    container.innerHTML = await step.render(settingsCache);
    if (step.afterRender) step.afterRender();

    // Progress dots
    const progressContainer = document.getElementById('setup-progress');
    if (progressContainer) {
      progressContainer.innerHTML = STEPS.map((s, i) => {
        const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
        return `<span class="progress-dot ${cls}" title="${escapeHtml(s.title)}"></span>`;
      }).join('');
    }

    // Nav buttons
    const backBtn   = document.getElementById('setup-back');
    const nextBtn   = document.getElementById('setup-next');
    const finishBtn = document.getElementById('setup-finish');
    const skipBtn = document.getElementById('setup-skip');
    if (backBtn)   backBtn.style.display   = currentStep === 0                ? 'none'         : 'inline-block';
    if (nextBtn)   nextBtn.style.display   = currentStep < STEPS.length - 1  ? 'inline-block' : 'none';
    if (finishBtn) finishBtn.style.display = currentStep === STEPS.length - 1 ? 'inline-block' : 'none';
    if (skipBtn)   skipBtn.style.display   = currentStep < STEPS.length - 1  ? 'inline-block' : 'none';
  }

  /** Collect and persist step data while DOM elements still exist. */
  function applyStepData(step) {
    if (!step?.collect || !settingsCache) return;
    const data = step.collect();
    switch (step.id) {
      case 'language':
        settingsCache['general settings'].language = data;
        break;
      case 'appearance':
        Object.assign(settingsCache['aesthetic settings'], data);
        break;
      case 'os-detect': {
        const si = settingsCache['software information'] = settingsCache['software information'] || {};
        si['OS full']   = data['OS full'];
        si['OS pretty'] = data['OS pretty'];
        si['OS kernel'] = data['OS kernel'];
        break;
      }
      case 'gpu-detect':
        settingsCache['hardware settings'] = {
          'graphics manufacturer': data['graphics manufacturer'],
          'target card name':      data['target card name'],
          'cuda version':          data['cuda version'],
          'rocm version':          data['rocm version']
        };
        break;
      case 'framework':
        selectedFramework = data;
        break;
      case 'resources':
        Object.assign(settingsCache['resource settings'], data);
        break;
      case 'qol':
        Object.assign(settingsCache['qol settings'], data);
        break;
      case 'security':
        Object.assign(settingsCache['security settings'], data);
        break;
    }
  }

  async function nextStep() {
    const step = STEPS[currentStep];
    // Collect step data while DOM elements still exist
    applyStepData(step);

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

  // ========== Bootstrap ==========

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

    const container = document.getElementById('setup-app');
    if (container) {
      container.innerHTML = '';
      container.appendChild(wizard);
    } else {
      document.body.innerHTML = '';
      document.body.appendChild(wizard);
    }

    await loadSettings();

    document.getElementById('setup-next')?.addEventListener('click', nextStep);
    document.getElementById('setup-back')?.addEventListener('click', prevStep);
    document.getElementById('setup-skip')?.addEventListener('click', async () => {
      // Skip: mark setup complete and navigate away WITHOUT modifying any settings
      try {
        await window.electron.setupComplete();
        await window.electron.navigateTo('public/index.html');
      } catch (e) {
        console.error('Skip failed:', e);
      }
    });
    document.getElementById('setup-finish')?.addEventListener('click', collectAndSave);

    renderStep();
  });

})();