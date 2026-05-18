// Setup Wizard — runs on first launch
//
// Step order:
//   Welcome → Language → Appearance → Framework →
//   Software Detection → Software Install → Framework Verification →
//   Hardware Detection → Resources → QoL → Security → Finish
//
// ── New IPC call required in main.js / preload.js ──────────────────────────
//   window.electron.runSoftwareDetect()
//
//   The Python script it invokes should print lines in KEY=VALUE format:
//
//     PYTHON_VERSION=3.11.5
//     PIP_AVAILABLE=true
//     CMAKE_AVAILABLE=true
//     GCC_AVAILABLE=false
//     TORCH_AVAILABLE=false
//     TF_AVAILABLE=true
//
//     # Windows  (winreg):
//     OS_FULL=Windows 11 Pro 24H2
//     OS_PRETTY=Windows 11 Pro
//     OS_KERNEL=10.0.26100
//
//     # Linux  (/etc/os-release + uname -r):
//     OS_FULL=Ubuntu 22.04.3 LTS (kernel 5.15.0-89-generic)
//     OS_PRETTY=Ubuntu 22.04.3 LTS
//     OS_KERNEL=5.15.0-89-generic
//
//     # macOS  (sw_vers):
//     OS_FULL=macOS 14.5 (Sonoma)
//     OS_PRETTY=macOS 14.5
//     OS_KERNEL=23.5.0
//
// ── Reference Python logic for OS fields ───────────────────────────────────
//
//   Windows:
//     import winreg, platform
//     key     = winreg.OpenKey(HKLM, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
//     product = QueryValueEx(key, "ProductName")[0]      # "Windows 11 Pro"
//     try:    build = QueryValueEx(key, "DisplayVersion")[0]   # "24H2"
//     except: build = QueryValueEx(key, "ReleaseId")[0]        # fallback "2009"
//     OS_FULL   = f"{product} {build}"
//     OS_PRETTY = product
//     OS_KERNEL = platform.version()                     # "10.0.26100"
//
//   Linux:
//     kernel = subprocess.run(['uname', '-r'], ...).stdout.strip()
//     # parse /etc/os-release for PRETTY_NAME
//     OS_FULL   = f"{pretty_name} (kernel {kernel})"
//     OS_PRETTY = pretty_name                            # "Ubuntu 22.04.3 LTS"
//     OS_KERNEL = kernel                                 # "5.15.0-89-generic"
//
//   macOS:
//     version = sw_vers -productVersion                  # "14.5"
//     OS_FULL   = f"macOS {version}"
//     OS_PRETTY = f"macOS {version}"
//     OS_KERNEL = platform.release()                     # "23.5.0"

(function () {

  // ========== Module-level state ==========

  let selectedFramework = null; // 'torch' | 'tf'

  // Populated by the Software Detection step; read by Hardware Detection.
  const softwareInfo = {
    pythonVersion:  null,
    pipAvailable:   false,
    cmakeAvailable: false,
    gccAvailable:   false,
    torchAvailable: false,
    tfAvailable:    false,
    osFullName:     '',
    osPrettyName:   '',
    osKernel:       ''
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

  /** Parse KEY=VALUE lines from a script's stdout into a plain object. */
  function parseKV(stdout) {
    const result = {};
    for (const line of (stdout || '').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
  }

  function boolVal(str) {
    return str?.toLowerCase() === 'true';
  }

  function statusIcon(ok) {
    return ok ? '✅' : '❌';
  }

  // ========== Step definitions ==========

  const STEPS = [

    // ============================================
    // STEP 0: Welcome
    // ============================================
    {
      id: 'welcome',
      title: 'Welcome to Frank',
      render: () => `
        <h2>Welcome!</h2>
        <p>Let's get your environment configured. This will only take a moment.</p>
        <p>You can revisit these settings anytime from the settings page.</p>
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
      render: (settings) => {
        const appearance   = settings['aesthetic settings']?.appearance       || 'dark';
        const accent       = settings['aesthetic settings']?.['accent color'] || 'default';
        const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];
        return `
          <h2>Appearance</h2>
          <div class="setup-field">
            <label>Theme:</label>
            <select id="setup-appearance" class="setup-select">
              <option value="dark"  ${appearance === 'dark'  ? 'selected' : ''}>Dark</option>
              <option value="light" ${appearance === 'light' ? 'selected' : ''}>Light</option>
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
        appearance:       document.getElementById('setup-appearance')?.value || 'dark',
        'accent color':   document.getElementById('setup-accent')?.value    || 'default',
        'scaling factor': parseFloat(document.getElementById('setup-scaling')?.value) || 1
      })
    },

    // ============================================
    // STEP 3: Framework Selection
    // ============================================
    {
      id: 'framework',
      title: 'AI Framework',
      render: (settings) => {
        const pytAlready = settings['software information']?.pyt === true;
        const tfAlready  = settings['software information']?.tf  === true;
        const preSelected = selectedFramework || (tfAlready && !pytAlready ? 'tf' : 'torch');
        return `
          <h2>AI Framework</h2>
          <p>Which deep learning framework would you like to use?</p>
          <div class="setup-radio-group">
            <label class="setup-radio-label">
              <input type="radio" name="framework" value="torch" ${preSelected === 'torch' ? 'checked' : ''}>
              <span class="setup-radio-title">PyTorch</span>
              <span class="setup-radio-desc">torch, torchvision, torchaudio</span>
            </label>
            <label class="setup-radio-label">
              <input type="radio" name="framework" value="tf" ${preSelected === 'tf' ? 'checked' : ''}>
              <span class="setup-radio-title">TensorFlow</span>
              <span class="setup-radio-desc">tensorflow (includes Keras)</span>
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
    // STEP 4: Software Detection
    // Auto-runs on render. Populates softwareInfo for later steps.
    // Requires window.electron.runSoftwareDetect() — see file header.
    // ============================================
    {
      id: 'software-detect',
      title: 'Software Detection',
      render: () => `
        <h2>Software Detection</h2>
        <p>Scanning your system for required dependencies...</p>
        <div id="sw-detect-table" class="setup-detect-output">
          <p class="setup-hint">⏳ Running scan...</p>
        </div>
        <div class="setup-actions-inline" style="margin-top:12px">
          <button id="sw-rescan-btn" class="setup-btn setup-btn-secondary" style="display:none">
            🔄 Re-scan
          </button>
        </div>
        <div id="sw-detect-raw" class="setup-detect-output" style="display:none"></div>
      `,
      afterRender: () => {
        runScan();
        document.getElementById('sw-rescan-btn')?.addEventListener('click', () => {
          const table = document.getElementById('sw-detect-table');
          if (table) table.innerHTML = '<p class="setup-hint">⏳ Running scan...</p>';
          document.getElementById('sw-rescan-btn').style.display = 'none';
          runScan();
        });

        async function runScan() {
          const table  = document.getElementById('sw-detect-table');
          const raw    = document.getElementById('sw-detect-raw');
          const rescan = document.getElementById('sw-rescan-btn');
          if (!table) return;

          try {
            const result = await window.electron.runSoftwareDetect();
            const kv     = parseKV(result.stdout);

            softwareInfo.pythonVersion  = kv['PYTHON_VERSION'] || null;
            softwareInfo.pipAvailable   = boolVal(kv['PIP_AVAILABLE']);
            softwareInfo.cmakeAvailable = boolVal(kv['CMAKE_AVAILABLE']);
            softwareInfo.gccAvailable   = boolVal(kv['GCC_AVAILABLE']);
            softwareInfo.torchAvailable = boolVal(kv['TORCH_AVAILABLE']);
            softwareInfo.tfAvailable    = boolVal(kv['TF_AVAILABLE']);
            softwareInfo.osFullName     = kv['OS_FULL']   || '';
            softwareInfo.osPrettyName   = kv['OS_PRETTY'] || '';
            softwareInfo.osKernel       = kv['OS_KERNEL'] || '';

            const fwOk    = selectedFramework === 'tf' ? softwareInfo.tfAvailable : softwareInfo.torchAvailable;
            const fwLabel = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';

            table.innerHTML = `
              <table class="setup-status-table">
                <tbody>
                  <tr>
                    <td>${statusIcon(!!softwareInfo.pythonVersion)}</td>
                    <td>Python</td>
                    <td class="setup-hint">${escapeHtml(softwareInfo.pythonVersion || 'not found')}</td>
                  </tr>
                  <tr>
                    <td>${statusIcon(softwareInfo.pipAvailable)}</td>
                    <td>pip</td>
                    <td class="setup-hint">${softwareInfo.pipAvailable ? 'available' : 'not found'}</td>
                  </tr>
                  <tr>
                    <td>${statusIcon(softwareInfo.cmakeAvailable)}</td>
                    <td>CMake</td>
                    <td class="setup-hint">${softwareInfo.cmakeAvailable ? 'available' : 'not found'}</td>
                  </tr>
                  <tr>
                    <td>${statusIcon(softwareInfo.gccAvailable)}</td>
                    <td>GCC / C++ compiler</td>
                    <td class="setup-hint">${softwareInfo.gccAvailable ? 'available' : 'not found'}</td>
                  </tr>
                  <tr>
                    <td>${statusIcon(fwOk)}</td>
                    <td>${escapeHtml(fwLabel)}</td>
                    <td class="setup-hint">${fwOk ? 'importable' : 'not installed'}</td>
                  </tr>
                  <tr>
                    <td>🖥️</td>
                    <td>OS</td>
                    <td class="setup-hint">${escapeHtml(softwareInfo.osFullName || 'unknown')}</td>
                  </tr>
                </tbody>
              </table>
            `;

            if (result.stderr && result.code !== 0) {
              if (raw) {
                raw.style.display = 'block';
                raw.innerHTML = `<pre class="setup-pre setup-pre-error">${escapeHtml(result.stderr)}</pre>`;
              }
            }
          } catch (e) {
            table.innerHTML = `
              <p class="setup-hint">⚠️ Scan failed: ${escapeHtml(e.message)}</p>
              <p class="setup-hint">Make sure Python is installed and accessible, then re-scan.</p>
            `;
          } finally {
            if (rescan) rescan.style.display = 'inline-block';
          }
        }
      }
    },

    // ============================================
    // STEP 5: Software Install
    // Shows what is missing based on softwareInfo; installs on demand.
    // ============================================
    {
      id: 'software-install',
      title: 'Software Install',
      render: () => {
        const fw   = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        const fwOk = selectedFramework === 'tf' ? softwareInfo.tfAvailable : softwareInfo.torchAvailable;

        const missing = [];
        if (!softwareInfo.pipAvailable)   missing.push('pip / Python packages');
        if (!fwOk)                        missing.push(fw);
        if (!softwareInfo.cmakeAvailable) missing.push('CMake <span class="setup-hint">(optional — needed for some source builds)</span>');
        if (!softwareInfo.gccAvailable)   missing.push('GCC / C++ compiler <span class="setup-hint">(optional — needed for some source builds)</span>');

        if (!missing.length) {
          return `
            <h2>Software Install</h2>
            <div class="setup-success-msg">✅ All required software is already installed.</div>
            <p class="setup-hint">You can continue to the next step.</p>
          `;
        }

        return `
          <h2>Software Install</h2>
          <p>The following are missing or could not be verified:</p>
          <ul class="setup-missing-list">
            ${missing.map(m => `<li>${m}</li>`).join('')}
          </ul>
          <div class="setup-actions-inline">
            <button id="run-sw-install-btn" class="setup-btn setup-btn-primary">
              ⬇️ Install missing dependencies
            </button>
          </div>
          <div id="sw-install-output" class="setup-detect-output" style="display:none"></div>
        `;
      },
      afterRender: () => {
        const btn = document.getElementById('run-sw-install-btn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
          const output = document.getElementById('sw-install-output');
          if (!output) return;

          output.style.display = 'block';
          output.innerHTML     = '<p class="setup-hint">⏳ Installing... This may take several minutes.</p>';
          btn.disabled         = true;
          btn.textContent      = '⏳ Installing...';

          const fw = selectedFramework || 'torch';
          try {
            const result = await window.electron.runInstall(fw);
            const out    = result.stdout || '';
            const err    = result.stderr || '';

            if (result.code === 0) {
              output.innerHTML = `
                <div class="setup-success-msg">✅ Installation complete!</div>
                <pre class="setup-pre">${escapeHtml(out.slice(0, 800))}</pre>
              `;
              btn.textContent = '✓ Installed';
              // Optimistically update softwareInfo so the next step reflects reality
              softwareInfo.pipAvailable = true;
              if (fw === 'tf') softwareInfo.tfAvailable    = true;
              else             softwareInfo.torchAvailable = true;
            } else {
              output.innerHTML = `
                <div class="setup-error-msg">❌ Installation failed</div>
                <pre class="setup-pre setup-pre-error">${escapeHtml(err || out || 'Unknown error')}</pre>
              `;
              btn.textContent = '⬇️ Retry';
              btn.disabled    = false;
            }
          } catch (e) {
            output.innerHTML = `<p class="setup-hint">⚠️ Error: ${escapeHtml(e.message)}</p>`;
            btn.textContent  = '⬇️ Retry';
            btn.disabled     = false;
          }
        });
      }
    },

    // ============================================
    // STEP 6: Framework Verification
    // ============================================
    {
      id: 'imports',
      title: 'Framework Verification',
      render: () => {
        const fwName = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        return `
          <h2>Verify ${fwName} Installation</h2>
          <p>Run a quick import test to confirm <strong>${fwName}</strong> is working correctly.</p>
          <div id="import-status"  class="setup-detect-output" style="display:none"></div>
          <div id="install-output" class="setup-detect-output" style="display:none"></div>
          <div id="import-actions">
            <button id="run-import-test-btn" class="setup-btn setup-btn-primary">▶ Run Import Test</button>
          </div>
        `;
      },
      afterRender: () => {
        const testBtn = document.getElementById('run-import-test-btn');
        if (!testBtn) return;

        testBtn.addEventListener('click', async () => {
          const fw         = selectedFramework || 'torch';
          const fwName     = fw === 'tf' ? 'TensorFlow' : 'PyTorch';
          const statusDiv  = document.getElementById('import-status');
          const installDiv = document.getElementById('install-output');
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
                <div class="setup-success-msg">✅ ${fwName} is installed and working!</div>
                <pre class="setup-pre">${escapeHtml(stdout)}</pre>
              `;
              testBtn.textContent   = '✓ Verified';
              testBtn.style.opacity = '0.7';
            } else {
              statusDiv.innerHTML = `
                <div class="setup-error-msg">❌ ${fwName} import failed</div>
                <pre class="setup-pre setup-pre-error">${escapeHtml(stdout || stderr || 'Unknown error')}</pre>
                <p>Would you like to install ${fwName} now?</p>
                <button id="run-install-btn" class="setup-btn setup-btn-success">⬇️ Install ${fwName}</button>
              `;
              if (installDiv) installDiv.style.display = 'none';

              document.getElementById('run-install-btn')?.addEventListener('click', async () => {
                const installBtn = document.getElementById('run-install-btn');
                if (installDiv) {
                  installDiv.style.display = 'block';
                  installDiv.innerHTML     = '<p class="setup-hint">⏳ Installing... This may take a few minutes.</p>';
                }
                if (installBtn) { installBtn.disabled = true; installBtn.textContent = '⏳ Installing...'; }

                try {
                  const ir   = await window.electron.runInstall(fw);
                  const iout = ir.stdout || '';
                  const ierr = ir.stderr || '';

                  if (ir.code === 0) {
                    if (installDiv) {
                      installDiv.innerHTML = `
                        <div class="setup-success-msg">✅ ${fwName} installed successfully!</div>
                        <pre class="setup-pre">${escapeHtml(iout.slice(0, 500))}</pre>
                      `;
                    }
                    statusDiv.innerHTML = '<p class="setup-hint">⏳ Re-testing imports...</p>';
                    const retest = await window.electron.runImportTest(fw);
                    statusDiv.innerHTML = retest.code === 0
                      ? `<div class="setup-success-msg">✅ ${fwName} verified after installation!</div>
                         <pre class="setup-pre">${escapeHtml(retest.stdout || '')}</pre>`
                      : `<div class="setup-error-msg">❌ Import still failing after install</div>
                         <pre class="setup-pre setup-pre-error">${escapeHtml(retest.stderr || retest.stdout || 'Unknown')}</pre>`;
                    if (installBtn) installBtn.textContent = '✓ Installed';
                  } else {
                    if (installDiv) {
                      installDiv.innerHTML = `
                        <div class="setup-error-msg">❌ Installation failed</div>
                        <pre class="setup-pre setup-pre-error">${escapeHtml(ierr || iout || 'Unknown error')}</pre>
                      `;
                    }
                    if (installBtn) { installBtn.textContent = '⬇️ Retry Install'; installBtn.disabled = false; }
                  }
                } catch (e) {
                  if (installDiv) installDiv.innerHTML = `<p class="setup-hint">⚠️ Error: ${escapeHtml(e.message)}</p>`;
                  if (installBtn) { installBtn.textContent = '⬇️ Retry Install'; installBtn.disabled = false; }
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
        const statusDiv = document.getElementById('import-status');
        return {
          importSucceeded: statusDiv?.textContent.includes('✅') || false,
          framework:       selectedFramework || 'torch'
        };
      }
    },

    // ============================================
    // STEP 7: Hardware Detection
    // OS fields pre-filled from softwareInfo (populated in step 4).
    // GPU detection runs via the existing runSystemDetect() call.
    // ============================================
    {
      id: 'hardware',
      title: 'Hardware Detection',
      render: (settings) => {
        const gpu        = settings['hardware settings']?.['graphics manufacturer'] || 'unscanned';
        const targetCard = settings['hardware settings']?.['target card name']      || '';

        // Prefer live softwareInfo over stale settings
        const osFullName   = softwareInfo.osFullName   || settings['software information']?.['OS full']   || '';
        const osPrettyName = softwareInfo.osPrettyName || settings['software information']?.['OS pretty'] || '';
        const osKernel     = softwareInfo.osKernel     || settings['software information']?.['OS kernel'] || '';

        return `
          <h2>Hardware Detection</h2>

          <div class="setup-field">
            <label>OS Full Name
              <span class="setup-hint">&nbsp;— e.g. Windows 11 Pro 24H2 / Ubuntu 22.04.3 LTS (kernel 5.15.0-89-generic)</span>
            </label>
            <input type="text" id="setup-os-full" class="setup-input"
              placeholder="Auto-filled from Software Detection..."
              value="${escapeHtml(osFullName)}">
          </div>

          <div class="setup-field">
            <label>OS Pretty Name
              <span class="setup-hint">&nbsp;— e.g. Windows 11 Pro / Ubuntu 22.04.3 LTS</span>
            </label>
            <input type="text" id="setup-os-pretty" class="setup-input"
              placeholder="Auto-filled from Software Detection..."
              value="${escapeHtml(osPrettyName)}">
          </div>

          <div class="setup-field">
            <label>Kernel / Build
              <span class="setup-hint">&nbsp;— e.g. 10.0.26100 / 5.15.0-89-generic / 23.5.0</span>
            </label>
            <input type="text" id="setup-os-kernel" class="setup-input"
              placeholder="Auto-filled from Software Detection..."
              value="${escapeHtml(osKernel)}">
          </div>

          <div class="setup-field">
            <label>Graphics Manufacturer:</label>
            <select id="setup-gpu" class="setup-select">
              <option value="unscanned"  ${gpu === 'unscanned'  ? 'selected' : ''}>Unscanned (auto-detect)</option>
              <option value="nvidia"     ${gpu === 'nvidia'     ? 'selected' : ''}>NVIDIA</option>
              <option value="amd"        ${gpu === 'amd'        ? 'selected' : ''}>AMD</option>
              <option value="undetected" ${gpu === 'undetected' ? 'selected' : ''}>Undetected / Other</option>
            </select>
          </div>

          <div class="setup-field">
            <label>Target GPU Name:</label>
            <input type="text" id="setup-target-gpu" class="setup-input"
              placeholder="e.g. RTX 4070" value="${escapeHtml(targetCard)}">
          </div>

          <div class="setup-actions-inline">
            <button id="auto-detect-btn" class="setup-btn setup-btn-primary">🔍 Auto-Detect GPU</button>
          </div>
          <div id="detect-output" class="setup-detect-output" style="display:none"></div>
        `;
      },
      afterRender: () => {
        document.getElementById('auto-detect-btn')?.addEventListener('click', async () => {
          const output    = document.getElementById('detect-output');
          const detectBtn = document.getElementById('auto-detect-btn');
          if (!output) return;

          output.style.display = 'block';
          output.innerHTML     = '<p class="setup-hint">Running GPU detection...</p>';
          detectBtn.disabled   = true;

          // If OS fields are still blank (software detect was skipped), do a
          // client-side UA guess as a last resort — we note it's imprecise.
          const osFullField = document.getElementById('setup-os-full');
          if (osFullField && !osFullField.value) {
            const ua    = navigator.userAgent;
            let   guess = 'Unknown OS';
            if      (ua.includes('Windows')) guess = 'Windows (version unknown — run Software Detection for full name)';
            else if (ua.includes('Mac OS'))  guess = 'macOS (version unknown — run Software Detection for full name)';
            else if (ua.includes('Linux'))   guess = 'Linux (version unknown — run Software Detection for full name)';
            osFullField.value = guess;
            const osPretty = document.getElementById('setup-os-pretty');
            const osKernel = document.getElementById('setup-os-kernel');
            if (osPretty) osPretty.value = guess;
            if (osKernel) osKernel.value = navigator.platform || '';
          }

          try {
            const result = await window.electron.runSystemDetect(selectedFramework || 'torch');
            const stdout = result.stdout || '';
            const stderr = result.stderr || '';

            if (stdout) output.innerHTML  = `<pre class="setup-pre">${escapeHtml(stdout)}</pre>`;
            if (stderr) output.innerHTML += `<pre class="setup-pre setup-pre-error">${escapeHtml(stderr)}</pre>`;

            const gpuSelect    = document.getElementById('setup-gpu');
            const gpuNameInput = document.getElementById('setup-target-gpu');
            const lc           = stdout.toLowerCase();

            if (lc.includes('nvidia') || lc.includes('geforce') || lc.includes('rtx') ||
                lc.includes('gtx')    || lc.includes('tesla')   || lc.includes('quadro')) {
              if (gpuSelect) gpuSelect.value = 'nvidia';
            } else if (lc.includes('amd') || lc.includes('radeon') || lc.includes('ryzen')) {
              if (gpuSelect) gpuSelect.value = 'amd';
            } else if (result.code === 0 && stdout.trim()) {
              if (gpuSelect) gpuSelect.value = 'undetected';
            }

            const gpuMatch = stdout.match(/(?:GPU\s*Detected|GPU\s*:)\s*(.+)/i) ||
                             stdout.match(/GeForce\s+\S+|Radeon\s+\S+|RTX\s+\S+|GTX\s+\S+|Tesla\s+\S+|Quadro\s+\S+/);
            if (gpuMatch && gpuNameInput) {
              const card = gpuMatch[1] || gpuMatch[0];
              if (card) gpuNameInput.value = card.trim();
            }

            if (result.code !== 0 && !stdout) {
              output.innerHTML = '<p class="setup-hint">⚠️ Could not run GPU detection. Make sure Python is installed, or fill in manually.</p>';
            }
          } catch (e) {
            output.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>`;
          } finally {
            detectBtn.disabled = false;
          }
        });
      },
      collect: () => ({
        'graphics manufacturer': document.getElementById('setup-gpu')?.value        || 'unscanned',
        'target card name':      document.getElementById('setup-target-gpu')?.value || null,
        'OS full':               document.getElementById('setup-os-full')?.value    || null,
        'OS pretty':             document.getElementById('setup-os-pretty')?.value  || null,
        'OS kernel':             document.getElementById('setup-os-kernel')?.value  || null
      })
    },

    // ============================================
    // STEP 8: Resources
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
    // STEP 9: Quality of Life
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
              <input type="checkbox" id="setup-video" ${qol['video enable'] ? 'checked' : ''}>
              Enable Video
            </label>
          </div>
          <div class="setup-field">
            <label>Video Provider:</label>
            <input type="text" id="setup-video-provider" class="setup-input"
              placeholder="e.g. youtube" value="${escapeHtml(qol['video provider'] || '')}">
          </div>
          <div class="setup-field">
            <label>Task Manager:</label>
            <select id="setup-task-manager" class="setup-select">
              <option value="ask"    ${qol['task manager'] === 'ask'    ? 'selected' : ''}>Ask</option>
              <option value="always" ${qol['task manager'] === 'always' ? 'selected' : ''}>Always Show</option>
              <option value="never"  ${qol['task manager'] === 'never'  ? 'selected' : ''}>Never</option>
            </select>
          </div>
          <div class="setup-field">
            <label>Database Provider:</label>
            <input type="text" id="setup-db-provider" class="setup-input"
              placeholder="e.g. huggingface" value="${escapeHtml(qol['database provider'] || '')}">
          </div>
        `;
      },
      collect: () => ({
        'reels enable':      document.getElementById('setup-reels')?.checked          || false,
        'reels provider':    document.getElementById('setup-reels-provider')?.value   || null,
        'video enable':      document.getElementById('setup-video')?.checked          || false,
        'video provider':    document.getElementById('setup-video-provider')?.value   || null,
        'task manager':      document.getElementById('setup-task-manager')?.value     || 'ask',
        'database provider': document.getElementById('setup-db-provider')?.value      || null
      })
    },

    // ============================================
    // STEP 10: Security
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
    // STEP 11: Finish
    // ============================================
    {
      id: 'finish',
      title: 'Done!',
      render: () => `
        <h2>All Set!</h2>
        <p>Your configuration is complete.</p>
        <p>Click <strong>Finish</strong> to save all settings and start using Frank.</p>
        <p class="setup-hint">You can change any of these settings later from the settings page.</p>
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
      'hardware settings':  { 'graphics manufacturer': 'unscanned', 'target card name': null },
      'software information': {
        'OS full': null, 'OS pretty': null, 'OS kernel': null,
        cmake: false, gcc: false, tf: false, pyt: false
      },
      'resource settings': {
        'cloud resources': false, 'cloud provider name': null,
        'local hostname': null,   'trainer browser': 'default'
      },
      'security settings': {
        'local key file path': 'default',
        'project mod': false, 'cloud mod': false,
        'all files': false, sudo: false, 'browser access': false
      },
      'qol settings': {
        'reels enable': false, 'reels provider': null,
        'video enable': false, 'video provider': null,
        'task manager': 'ask', 'database provider': null
      }
    };
  }

  async function collectAndSave() {
    if (!settingsCache) return;

    for (const step of STEPS) {
      if (!step.collect) continue;
      const data = step.collect();

      switch (step.id) {
        case 'language':
          settingsCache['general settings'].language = data;
          break;

        case 'appearance':
          Object.assign(settingsCache['aesthetic settings'], data);
          break;

        case 'framework':
          selectedFramework = data;
          settingsCache['software information'] = settingsCache['software information'] || {};
          settingsCache['software information'].tf  = data === 'tf';
          settingsCache['software information'].pyt = data !== 'tf';
          break;

        case 'hardware': {
          settingsCache['hardware settings'] = {
            'graphics manufacturer': data['graphics manufacturer'],
            'target card name':      data['target card name']
          };
          const si = settingsCache['software information'] = settingsCache['software information'] || {};
          si['OS full']   = data['OS full'];
          si['OS pretty'] = data['OS pretty'];
          si['OS kernel'] = data['OS kernel'];
          // Persist cmake/gcc from software detection
          si.cmake = softwareInfo.cmakeAvailable;
          si.gcc   = softwareInfo.gccAvailable;
          break;
        }

        case 'imports':
          // Ephemeral — not persisted
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

    try {
      await window.electron.settingsWrite(settingsCache);

      // Write framework flags as nonbackup
      const current = await window.electron.settingsRead() || settingsCache;
      current['software information']     = current['software information'] || {};
      current['software information'].tf  = settingsCache['software information']?.tf  || false;
      current['software information'].pyt = settingsCache['software information']?.pyt || false;
      await window.electron.settingsWriteNonbackup(current);

      await window.electron.setupComplete();
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // ========== Step rendering ==========

  function renderStep() {
    const step = STEPS[currentStep];
    if (!step) return;

    const container = document.getElementById('setup-content');
    if (!container) return;

    container.innerHTML = step.render(settingsCache);
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
    if (backBtn)   backBtn.style.display   = currentStep === 0                ? 'none'         : 'inline-block';
    if (nextBtn)   nextBtn.style.display   = currentStep < STEPS.length - 1  ? 'inline-block' : 'none';
    if (finishBtn) finishBtn.style.display = currentStep === STEPS.length - 1 ? 'inline-block' : 'none';
  }

  async function nextStep() {
    const step = STEPS[currentStep];

    // Persist framework choice immediately on leaving that step
    if (step?.id === 'framework' && step.collect) {
      const fw = step.collect();
      selectedFramework = fw;
      if (settingsCache) {
        const si  = settingsCache['software information'] = settingsCache['software information'] || {};
        si.tf  = fw === 'tf';
        si.pyt = fw !== 'tf';
        try {
          const current = await window.electron.settingsRead() || settingsCache;
          current['software information']     = current['software information'] || {};
          current['software information'].tf  = si.tf;
          current['software information'].pyt = si.pyt;
          await window.electron.settingsWriteNonbackup(current);
        } catch (e) {
          console.warn('Could not save framework selection immediately:', e);
        }
      }
    }

    if (currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep();
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      renderStep();
    }
  }

  // ========== Bootstrap ==========

  document.addEventListener('DOMContentLoaded', async () => {
    const wizard = document.createElement('div');
    wizard.id    = 'setup-wizard';
    wizard.innerHTML = `
      <div id="setup-header">
        <h1>Frank Setup</h1>
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
    document.getElementById('setup-skip')?.addEventListener('click', collectAndSave);
    document.getElementById('setup-finish')?.addEventListener('click', collectAndSave);

    renderStep();
  });

})();