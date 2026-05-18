// Setup Wizard — runs on first launch
(function () {
  // Track framework choice for cross-step use
  let selectedFramework = null; // 'torch' or 'tf'

  // ========== Utility ==========

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
        const appearance = settings['aesthetic settings']?.appearance || 'dark';
        const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];
        const accent = settings['aesthetic settings']?.['accent color'] || 'default';
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
    // STEP 3: Framework Selection (TF or PyTorch)
    // ============================================
    {
      id: 'framework',
      title: 'AI Framework',
      render: (settings) => {
        const pytAlready = settings['software information']?.pyt === true;
        const tfAlready  = settings['software information']?.tf  === true;
        let preSelected  = 'torch';
        if (tfAlready && !pytAlready) preSelected = 'tf';
        if (selectedFramework) preSelected = selectedFramework;
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
          <p id="framework-status" class="setup-hint"></p>
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
    // STEP 4: Confirm Install
    // ============================================
    {
      id: 'install-conf',
      title: 'Install Dependencies',
      render: () => {
        const fwName = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        return `
          <h2>Install Dependencies</h2>
          <p>Click below to install all required packages for <strong>${fwName}</strong>.</p>
          <div class="setup-actions-inline">
            <button id="run-install-conf-btn" class="setup-btn setup-btn-primary">
              ⬇️ Install all dependencies
            </button>
          </div>
          <div id="install-conf-output" class="setup-detect-output" style="display:none"></div>
        `;
      },
      afterRender: () => {
        const btn = document.getElementById('run-install-conf-btn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
          const output = document.getElementById('install-conf-output');
          if (!output) return;

          output.style.display = 'block';
          output.innerHTML = '<p class="setup-hint">⏳ Installing... This may take a few minutes.</p>';
          btn.disabled = true;
          btn.textContent = '⏳ Installing...';

          try {
            const fw = selectedFramework || 'torch';
            const result = await window.electron.runInstall(fw);
            const out = result.stdout || '';
            const err = result.stderr || '';

            if (result.code === 0) {
              output.innerHTML = `
                <div class="setup-success-msg">✅ Installation complete!</div>
                <pre class="setup-pre">${escapeHtml(out.slice(0, 800))}</pre>
              `;
              btn.textContent = '✓ Installed';
            } else {
              output.innerHTML = `
                <div class="setup-error-msg">❌ Installation failed</div>
                <pre class="setup-pre setup-pre-error">${escapeHtml(err || out || 'Unknown error')}</pre>
              `;
              btn.textContent = '⬇️ Retry';
              btn.disabled = false;
            }
          } catch (e) {
            output.innerHTML = `<p class="setup-hint">⚠️ Error: ${escapeHtml(e.message)}</p>`;
            btn.textContent = '⬇️ Retry';
            btn.disabled = false;
          }
        });
      }
    },

    // ============================================
    // STEP 5: Hardware Detection (with auto-detect)
    // ============================================
    {
      id: 'hardware',
      title: 'Hardware Detection',
      render: (settings) => {
        const gpu        = settings['hardware settings']?.['graphics manufacturer'] || 'unscanned';
        const targetCard = settings['hardware settings']?.['target card name']      || '';
        const osName     = settings['software information']?.['operating system']   || '';
        const osPretty   = settings['software information']?.['OS pretty']          || '';
        const cmake      = settings['software information']?.cmake || false;
        const gcc        = settings['software information']?.gcc   || false;
        return `
          <h2>Hardware &amp; System Detection</h2>
          <div class="setup-field">
            <label>Operating System:</label>
            <input type="text" id="setup-os" class="setup-input" placeholder="Auto-detected..." value="${escapeHtml(osName)}">
          </div>
          <div class="setup-field">
            <label>OS Pretty Name:</label>
            <input type="text" id="setup-os-pretty" class="setup-input" placeholder="Auto-detected..." value="${escapeHtml(osPretty)}">
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
            <input type="text" id="setup-target-gpu" class="setup-input" placeholder="e.g. RTX 4070" value="${escapeHtml(targetCard)}">
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-cmake" ${cmake ? 'checked' : ''}>
              CMake Available
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-gcc" ${gcc ? 'checked' : ''}>
              GCC / C++ Compiler Available
            </label>
          </div>
          <div class="setup-actions-inline">
            <button id="auto-detect-btn" class="setup-btn setup-btn-primary">🔍 Auto-Detect Hardware</button>
          </div>
          <div id="detect-output" class="setup-detect-output" style="display:none"></div>
        `;
      },
      afterRender: () => {
        const detectBtn = document.getElementById('auto-detect-btn');
        if (!detectBtn) return;

        detectBtn.addEventListener('click', async () => {
          const output = document.getElementById('detect-output');
          if (!output) return;

          output.style.display = 'block';
          output.innerHTML = '<p class="setup-hint">Running hardware detection...</p>';

          // Client-side OS detection
          const platform  = navigator.platform  || '';
          const userAgent = navigator.userAgent || '';
          const osField       = document.getElementById('setup-os');
          const osPrettyField = document.getElementById('setup-os-pretty');

          if (osField && !osField.value) {
            osField.value = platform;
          }

          if (osPrettyField && !osPrettyField.value) {
            let pretty = 'Unknown';
            if      (userAgent.includes('Windows')) pretty = 'Windows';
            else if (userAgent.includes('Mac OS'))  pretty = 'macOS';
            else if (userAgent.includes('Linux'))   pretty = 'Linux';
            else if (userAgent.includes('Android')) pretty = 'Android';
            else if (userAgent.includes('iOS'))     pretty = 'iOS';
            osPrettyField.value = pretty;
          }

          // GPU detection via Python
          const framework = selectedFramework || 'torch';
          try {
            const result = await window.electron.runSystemDetect(framework);
            const stdout = result.stdout || '';
            const stderr = result.stderr || '';

            if (stdout) {
              output.innerHTML = `<pre class="setup-pre">${escapeHtml(stdout)}</pre>`;
            }
            if (stderr) {
              output.innerHTML += `<pre class="setup-pre setup-pre-error">${escapeHtml(stderr)}</pre>`;
            }

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
            } else {
              if (gpuSelect) gpuSelect.value = 'unscanned';
            }

            const gpuMatch = stdout.match(/(?:GPU\s*Detected|GPU\s*:)\s*(.+)/i) ||
                             stdout.match(/GeForce\s+\S+|Radeon\s+\S+|RTX\s+\S+|GTX\s+\S+|Tesla\s+\S+|Quadro\s+\S+/);
            if (gpuMatch && gpuNameInput) {
              const card = gpuMatch[1] || gpuMatch[0];
              if (card) gpuNameInput.value = card.trim();
            }

            if (result.code !== 0 && !stdout) {
              output.innerHTML = '<p class="setup-hint">⚠️ Could not run hardware detection. Make sure Python is installed and try again, or fill in manually.</p>';
            }
          } catch (e) {
            output.innerHTML = `<p class="setup-hint">⚠️ Detection failed: ${escapeHtml(e.message)}</p>`;
          }
        });
      },
      collect: () => ({
        'graphics manufacturer': document.getElementById('setup-gpu')?.value          || 'unscanned',
        'target card name':      document.getElementById('setup-target-gpu')?.value   || null,
        'operating system':      document.getElementById('setup-os')?.value           || null,
        'OS pretty':             document.getElementById('setup-os-pretty')?.value    || null,
        cmake:                   document.getElementById('setup-cmake')?.checked      || false,
        gcc:                     document.getElementById('setup-gcc')?.checked        || false
      })
    },

    // ============================================
    // STEP 6: Framework Verification + Auto-Install
    // ============================================
    {
      id: 'imports',
      title: 'Framework Verification',
      render: () => {
        const fwName = selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
        return `
          <h2>Verify ${fwName} Installation</h2>
          <p>We'll test if <strong>${fwName}</strong> can be imported. If not, we'll install it automatically.</p>
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
          statusDiv.innerHTML = '<p class="setup-hint">⏳ Running import test...</p>';
          testBtn.disabled    = true;
          testBtn.style.opacity = '0.5';

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

              const installBtn = document.getElementById('run-install-btn');
              if (installBtn) {
                installBtn.addEventListener('click', async () => {
                  if (installDiv) {
                    installDiv.style.display = 'block';
                    installDiv.innerHTML = '<p class="setup-hint">⏳ Installing... This may take a few minutes.</p>';
                  }
                  installBtn.disabled     = true;
                  installBtn.textContent  = '⏳ Installing...';

                  try {
                    const installResult = await window.electron.runInstall(fw);
                    const iout = installResult.stdout || '';
                    const ierr = installResult.stderr || '';

                    if (installResult.code === 0) {
                      if (installDiv) {
                        installDiv.innerHTML = `
                          <div class="setup-success-msg">✅ ${fwName} installed successfully!</div>
                          <pre class="setup-pre">${escapeHtml(iout.slice(0, 500))}</pre>
                        `;
                      }
                      // Re-test imports after install
                      statusDiv.innerHTML = '<p class="setup-hint">⏳ Re-testing imports...</p>';
                      const retestResult = await window.electron.runImportTest(fw);
                      if (retestResult.code === 0) {
                        statusDiv.innerHTML = `
                          <div class="setup-success-msg">✅ ${fwName} verified after installation!</div>
                          <pre class="setup-pre">${escapeHtml(retestResult.stdout || '')}</pre>
                        `;
                      } else {
                        statusDiv.innerHTML = `
                          <div class="setup-error-msg">❌ Import still failing after install</div>
                          <pre class="setup-pre setup-pre-error">${escapeHtml(retestResult.stderr || retestResult.stdout || 'Unknown')}</pre>
                        `;
                      }
                      installBtn.textContent = '✓ Installed';
                    } else {
                      if (installDiv) {
                        installDiv.innerHTML = `
                          <div class="setup-error-msg">❌ Installation failed</div>
                          <pre class="setup-pre setup-pre-error">${escapeHtml(ierr || iout || 'Unknown error')}</pre>
                        `;
                      }
                      installBtn.textContent = '⬇️ Retry Install';
                      installBtn.disabled    = false;
                    }
                  } catch (e) {
                    if (installDiv) {
                      installDiv.innerHTML = `<p class="setup-hint">⚠️ Error: ${escapeHtml(e.message)}</p>`;
                    }
                    installBtn.textContent = '⬇️ Retry Install';
                    installBtn.disabled    = false;
                  }
                });
              }
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
        const success   = statusDiv?.textContent.includes('✅') || false;
        return { importSucceeded: success, framework: selectedFramework || 'torch' };
      }
    },

    // ============================================
    // STEP 7: Resources
    // ============================================
    {
      id: 'resources',
      title: 'Resources',
      render: (settings) => {
        const res            = settings['resource settings'] || {};
        const cloudResources = res['cloud resources']      || false;
        const cloudProvider  = res['cloud provider name']  || '';
        const localHostname  = res['local hostname']       || '';
        const trainerBrowser = res['trainer browser']      || 'default';
        return `
          <h2>Resource Configuration</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-cloud" ${cloudResources ? 'checked' : ''}>
              Enable Cloud Resources
            </label>
          </div>
          <div class="setup-field">
            <label>Cloud Provider:</label>
            <input type="text" id="setup-cloud-provider" class="setup-input"
              placeholder="e.g. openai" value="${escapeHtml(cloudProvider)}">
          </div>
          <div class="setup-field">
            <label>Local Hostname:</label>
            <input type="text" id="setup-local-host" class="setup-input"
              placeholder="e.g. ollama" value="${escapeHtml(localHostname)}">
          </div>
          <div class="setup-field">
            <label>Trainer Browser:</label>
            <input type="text" id="setup-trainer-browser" class="setup-input"
              placeholder="default" value="${escapeHtml(trainerBrowser)}">
          </div>
        `;
      },
      collect: () => ({
        'cloud resources':    document.getElementById('setup-cloud')?.checked          || false,
        'cloud provider name':document.getElementById('setup-cloud-provider')?.value   || null,
        'local hostname':     document.getElementById('setup-local-host')?.value       || null,
        'trainer browser':    document.getElementById('setup-trainer-browser')?.value  || 'default'
      })
    },

    // ============================================
    // STEP 8: Quality of Life
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
        'reels enable':     document.getElementById('setup-reels')?.checked           || false,
        'reels provider':   document.getElementById('setup-reels-provider')?.value    || null,
        'video enable':     document.getElementById('setup-video')?.checked           || false,
        'video provider':   document.getElementById('setup-video-provider')?.value    || null,
        'task manager':     document.getElementById('setup-task-manager')?.value      || 'ask',
        'database provider':document.getElementById('setup-db-provider')?.value       || null
      })
    },

    // ============================================
    // STEP 9: Security
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
    // STEP 10: Finish
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
        'operating system': null, 'OS pretty': null,
        cmake: false, gcc: false, tf: false, pyt: false
      },
      'resource settings': {
        'cloud resources': false, 'cloud provider name': null,
        'local hostname': null, 'trainer browser': 'default'
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
          if (data === 'tf') {
            settingsCache['software information'].tf  = true;
            settingsCache['software information'].pyt = false;
          } else {
            settingsCache['software information'].pyt = true;
            settingsCache['software information'].tf  = false;
          }
          break;

        case 'hardware':
          settingsCache['hardware settings'] = {
            'graphics manufacturer': data['graphics manufacturer'],
            'target card name':      data['target card name']
          };
          settingsCache['software information'] = settingsCache['software information'] || {};
          settingsCache['software information']['operating system'] = data['operating system'];
          settingsCache['software information']['OS pretty']        = data['OS pretty'];
          settingsCache['software information'].cmake               = data.cmake;
          settingsCache['software information'].gcc                 = data.gcc;
          break;

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
      current['software information']      = current['software information'] || {};
      current['software information'].tf   = settingsCache['software information']?.tf  || false;
      current['software information'].pyt  = settingsCache['software information']?.pyt || false;
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
        return `<span class="progress-dot ${cls}"></span>`;
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
        settingsCache['software information'] = settingsCache['software information'] || {};
        if (fw === 'tf') {
          settingsCache['software information'].tf  = true;
          settingsCache['software information'].pyt = false;
        } else {
          settingsCache['software information'].pyt = true;
          settingsCache['software information'].tf  = false;
        }
        try {
          const current = await window.electron.settingsRead() || settingsCache;
          current['software information']      = current['software information'] || {};
          current['software information'].tf   = settingsCache['software information'].tf;
          current['software information'].pyt  = settingsCache['software information'].pyt;
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
    wizard.id = 'setup-wizard';
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