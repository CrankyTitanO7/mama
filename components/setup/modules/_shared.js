// ── Shared state, utilities, and wizard logic for setup steps ──────────────
// This file must be loaded before any step module.

(function () {

  // ═══════════════════════════════════════════════════════════════
  // Module state
  // ═══════════════════════════════════════════════════════════════

  window.__setupState = {
    selectedFramework: null,   // 'torch' | 'tf'
    selectedMode:      'gpu',  // 'gpu' | 'cpu'
    installSucceeded:  false,
    difficulty:        'easy', // 'easy' | 'medium' | 'hard' — not persisted to settings

    // Populated by detection steps; read by later steps.
    detected: {
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
      mpsAvailable:    false,
      compatResults:   null,
    },

    // Cached Python detection result — avoids re-running the same
    // detection script in steps 3, 4, and 5.
    pythonDetectCache: null,

    // Selected project folder for project-scoped installs.
    selectedProjectFolder: null,

    // Wizard state
    currentStep:   0,
    settingsCache: null,
  };

  // ═══════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════

  window.__setupUtils = {
    escapeHtml(text) {
      if (!text) return '';
      const amp = String.fromCharCode(38);
      return String(text)
        .replace(/&/g,  amp + 'amp;')
        .replace(/</g,  amp + 'lt;')
        .replace(/>/g,  amp + 'gt;')
        .replace(/"/g,  amp + 'quot;')
        .replace(/'/g,  amp + '#039;');
    },

    parseKV(stdout) {
      const result = {};
      for (const line of (stdout || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      return result;
    },

    boolVal(str)   { return str?.toLowerCase() === 'true'; },
    okIcon(ok)     { return ok ? '✅' : '❌'; },
    warnIcon(ok)   { return ok ? '✅' : '⚠️'; },

    gpuVariant() {
      const s = window.__setupState;
      if (s.selectedMode === 'cpu') return 'cpu';
      if (s.detected.gpuManufacturer === 'nvidia') return 'cuda';
      if (s.detected.gpuManufacturer === 'amd')    return 'rocm';
      if (s.detected.gpuManufacturer === 'apple') return 'mps';
      return 'cpu';
    },

    torchIndexURL() {
      const s = window.__setupState;
      if (s.selectedMode === 'cpu') return 'https://download.pytorch.org/whl/cpu';
      if (s.detected.gpuManufacturer === 'nvidia' && s.detected.cudaVersion) {
        const tag = 'cu' + s.detected.cudaVersion.replace('.', '');
        return `https://download.pytorch.org/whl/${tag}`;
      }
      if (s.detected.gpuManufacturer === 'amd' && s.detected.rocmVersion) {
        return `https://download.pytorch.org/whl/rocm${s.detected.rocmVersion}`;
      }
      return 'https://download.pytorch.org/whl/cpu';
    },

    gpuVariantLabel() {
      const s = window.__setupState;
      if (s.selectedMode === 'cpu')                    return 'CPU-only';
      if (s.detected.gpuManufacturer === 'nvidia')     return s.detected.cudaVersion ? `CUDA ${s.detected.cudaVersion}` : 'CUDA (version unknown)';
      if (s.detected.gpuManufacturer === 'amd')        return s.detected.rocmVersion ? `ROCm ${s.detected.rocmVersion}` : 'ROCm (version unknown)';
      if (s.detected.gpuManufacturer === 'apple')      return s.detected.metalVersion ? `Metal ${s.detected.metalVersion} / MPS` : 'MPS';
      return 'CPU-only';
    },

    // Derive which pip packages to install based on current state.
    buildInstallCommand() {
      const s = window.__setupState;
      const fw = s.selectedFramework || 'torch';
      const gv = window.__setupUtils.gpuVariant();

      if (fw === 'tf') {
        if (gv === 'cuda')                    return 'pip install tensorflow[and-cuda]';
        if (gv === 'rocm')                    return 'pip install tensorflow-rocm';
        return 'pip install tensorflow-cpu';
      }

      // PyTorch
      return `pip install torch torchvision torchaudio --index-url ${window.__setupUtils.torchIndexURL()}`;
    },

    // Cached wrapper around runPythonDetect — returns {code, stdout, stderr}.
    async getPythonDetectResult() {
      const s = window.__setupState;
      if (s.pythonDetectCache) return s.pythonDetectCache;
      s.pythonDetectCache = await window.electron.runPythonDetect();
      return s.pythonDetectCache;
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════

  window.__setupSettings = {
    async loadSettings() {
      const s = window.__setupState;
      try {
        s.settingsCache = await window.electron.settingsRead();
        if (!s.settingsCache) s.settingsCache = window.__setupSettings.defaultSettings();
        s.selectedMode = s.settingsCache['hardware settings']?.mode || 'gpu';
      } catch (e) {
        console.error('Failed to load settings:', e);
        s.settingsCache = window.__setupSettings.defaultSettings();
      }
      return s.settingsCache;
    },

    defaultSettings() {
      return {
        'general settings':   { setup: true, language: 'eng' },
        'aesthetic settings': { appearance: 'system', 'scaling factor': 1, 'accent color': 'default' },
        'hardware settings':  { 'graphics manufacturer': 'unscanned', 'target card name': null, 'cuda version': null, 'rocm version': null, mode: 'gpu' },
        'software information': { 'OS full': null, 'OS pretty': null, 'OS kernel': null, cmake: false, gcc: false, tf: false, pyt: false },
        'resource settings':  { 'cloud resources': false, 'cloud provider name': null, 'local hostname': null, 'trainer browser': 'default' },
        'security settings':  { 'local key file path': 'default', 'project mod': false, 'cloud mod': false, 'all files': false, sudo: false, 'browser access': false },
        'qol settings':       { 'reels enable': false, 'reels provider': null, 'site enable': false, 'site provider': null, 'resources': 'ask', 'database provider': null },
      };
    },

    // Persist step data into settingsCache while DOM elements still exist.
    applyStepData(step) {
      const s = window.__setupState;
      if (!step?.collect || !s.settingsCache) return;
      const data = step.collect();
      const sc   = s.settingsCache;
      const si   = () => sc['software information'] = sc['software information'] || {};
      const hw   = () => sc['hardware settings']    = sc['hardware settings']    || {};

      switch (step.id) {
        case 'language':     sc['general settings'].language = data; break;
        case 'appearance':   Object.assign(sc['aesthetic settings'], data); break;
        case 'os-detect':    Object.assign(si(), { 'OS full': data['OS full'], 'OS pretty': data['OS pretty'], 'OS kernel': data['OS kernel'], 'Architecture': data['Architecture'] }); break;
        case 'gpu-detect':   Object.assign(hw(), { 'graphics manufacturer': data['graphics manufacturer'], 'target card name': data['target card name'], 'cuda version': data['cuda version'], 'rocm version': data['rocm version'], 'metal version': data['metal version'], 'mps available': data['mps available'] }); break;
        case 'compat-check': Object.assign(hw(), { mode: data.mode }); break;
        case 'framework':    s.selectedFramework = data; break;
        case 'resources':    Object.assign(sc['resource settings'], data); break;
        case 'qol':          Object.assign(sc['qol settings'],      data); break;
        case 'security':     Object.assign(sc['security settings'], data); break;
        // fw-install and fw-verify are tracked via installSucceeded / collect return values
      }
    },

    async collectAndSave() {
      const s = window.__setupState;
      if (!s.settingsCache) return;

      // Collect the current step before saving (handles Finish click)
      const steps = window.__setupSteps || [];
      window.__setupSettings.applyStepData(steps[s.currentStep]);

      const si = s.settingsCache['software information'] = s.settingsCache['software information'] || {};
      si.tf    = s.installSucceeded && s.selectedFramework === 'tf';
      si.pyt   = s.installSucceeded && s.selectedFramework === 'torch';
      si.cmake = s.detected.cmakeAvailable;
      si.gcc   = s.detected.gccAvailable;

      try {
        await window.electron.settingsWrite(s.settingsCache);

        // Framework flags written separately as nonbackup
        const current = await window.electron.settingsRead() || s.settingsCache;
        current['software information']     = current['software information'] || {};
        current['software information'].tf  = si.tf;
        current['software information'].pyt = si.pyt;
        await window.electron.settingsWriteNonbackup(current);

        await window.electron.setupComplete();
        await window.electron.navigateTo('public/index.html');
      } catch (e) {
        console.error('Failed to save settings:', e);
      }
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════

  window.__setupRender = {
    async renderStep() {
      const steps = window.__setupSteps || [];
      const s     = window.__setupState;
      const step  = steps[s.currentStep];
      if (!step) return;

      const container = document.getElementById('setup-content');
      if (!container) return;

      // render() is always sync; await handles the rare Promise case gracefully
      container.innerHTML = await Promise.resolve(step.render(s.settingsCache));
      if (step.afterRender) await step.afterRender();

      // Progress dots
      const prog = document.getElementById('setup-progress');
      if (prog) {
        prog.innerHTML = steps.map((st, i) => {
          const cls = i < s.currentStep ? 'done' : i === s.currentStep ? 'active' : '';
          return `<span class="progress-dot ${cls}" title="${window.__setupUtils.escapeHtml(st.title)}"></span>`;
        }).join('');
      }

      const backBtn   = document.getElementById('setup-back');
      const nextBtn   = document.getElementById('setup-next');
      const skipBtn   = document.getElementById('setup-skip');
      const finishBtn = document.getElementById('setup-finish');
      const isLast    = s.currentStep === steps.length - 1;

      if (backBtn)   backBtn.style.display   = s.currentStep === 0 ? 'none' : 'inline-block';
      if (nextBtn)   nextBtn.style.display   = isLast ? 'none' : 'inline-block';
      if (skipBtn)   skipBtn.style.display   = isLast ? 'none' : 'inline-block';
      if (finishBtn) finishBtn.style.display = isLast ? 'inline-block' : 'none';
    },

    async nextStep() {
      const steps = window.__setupSteps || [];
      const s     = window.__setupState;
      window.__setupSettings.applyStepData(steps[s.currentStep]);
      if (s.currentStep < steps.length - 1) {
        s.currentStep++;
        await window.__setupRender.renderStep();
      }
    },

    async prevStep() {
      const s = window.__setupState;
      if (s.currentStep > 0) {
        s.currentStep--;
        await window.__setupRender.renderStep();
      }
    },
  };

})();