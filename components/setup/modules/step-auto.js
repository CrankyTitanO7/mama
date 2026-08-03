// ── Step: Auto Setup (hands-free installer) ──────────────────────────────
// Inserted dynamically after the "Set Up This Project?" confirm step.
// Runs the whole setup hands-free:
//   detect OS → detect Python → detect GPU → create .venv → install the
//   PyTorch build matched to the hardware → verify → write settings.json.
//
// The loading screen adapts to the chosen mode:
//   easy   → shows AI / LLM explainer pages while it works
//   medium → shows an overview of the app (why/how mama uses Python)
//   hard   → pure stdout: just the live install terminal output
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];

  const PHASES = [
    { id: 'python',   label: 'Checking Python' },
    { id: 'os',       label: 'Detecting operating system' },
    { id: 'gpu',      label: 'Detecting GPU & hardware' },
    { id: 'venv',     label: 'Creating project environment (.venv)' },
    { id: 'install',  label: 'Installing PyTorch for your hardware' },
    { id: 'verify',   label: 'Verifying installation' },
    { id: 'settings', label: 'Saving your settings' },
  ];

  const step = {
    id: 'auto',
    title: 'Setting Up',
    render: () => {
      const s = window.__setupState;
      const hardMode = s.difficulty === 'hard';
      return `
        <h2>Setting Up mama</h2>
        <p>This usually takes a few minutes. Please leave the app open.</p>

        <ul class="auto-checklist" id="auto-checklist" ${hardMode ? 'style="display:none"' : ''}>
          ${PHASES.map(p => `
            <li data-phase="${p.id}" data-state="pending">
              <span class="auto-phase-icon">○</span>
              <span class="auto-phase-label">${window.__setupUtils.escapeHtml(p.label)}</span>
              <span class="auto-phase-detail"></span>
            </li>`).join('')}
        </ul>

        <div id="auto-reading-wrap" class="auto-reading-wrap" style="display:none">
          <div class="auto-reading-header"><span id="auto-reading-count"></span></div>
          <div id="auto-reading" class="auto-reading"></div>
        </div>

        <pre id="auto-terminal" class="setup-terminal ${hardMode ? 'auto-terminal-hard' : 'auto-terminal-hidden'}"
             style="${hardMode ? '' : 'display:none'}"></pre>

        <div id="auto-error" class="setup-error-msg" style="display:none"></div>
        <div id="auto-success" style="display:none"></div>

        <div id="auto-actions" class="setup-actions-inline" style="display:none">
          <button id="auto-retry" class="setup-btn setup-btn-secondary" style="display:none">🔄 Retry</button>
          <button id="auto-back" class="setup-btn setup-btn-secondary" style="display:none">← Go Back</button>
          <button id="auto-pick-folder" class="setup-btn setup-btn-secondary" style="display:none">📂 Choose Project Folder</button>
          <button id="auto-finish" class="setup-btn setup-btn-success" style="display:none">✓ Start Using mama</button>
        </div>
      `;
    },
    afterRender: () => {
      // The auto step owns the UI — hide the wizard's Next / Skip / Back /
      // Finish buttons; retry and back happen through the step's own
      // controls, and a successful setup finishes with "Start Using mama".
      const nextBtn = document.getElementById('setup-next');
      const skipBtn = document.getElementById('setup-skip');
      const backBtn = document.getElementById('setup-back');
      const finishBtn = document.getElementById('setup-finish');
      if (nextBtn) nextBtn.style.display = 'none';
      if (skipBtn) skipBtn.style.display = 'none';
      if (backBtn) backBtn.style.display = 'none';
      if (finishBtn) finishBtn.style.display = 'none';
      runAutoSetup();
    }
  };

  window.__setupSteps.push(step);
  window.__autoStep = step;

  // ═══════════════ Auto-setup engine ═══════════════

  let readingTimer = null;
  let running = false;

  const el = (id) => document.getElementById(id);

  // ── UI helpers ───────────────────────────────────────────────────────────

  function setPhase(id, state, detail) {
    const li = document.querySelector(`#auto-checklist li[data-phase="${id}"]`);
    if (!li) return;
    const icon = state === 'ok' ? '✅' : state === 'error' ? '❌' : state === 'busy' ? '⏳' : '○';
    li.setAttribute('data-state', state);
    const iconEl = li.querySelector('.auto-phase-icon');
    const detailEl = li.querySelector('.auto-phase-detail');
    if (iconEl) iconEl.textContent = icon;
    if (detailEl && detail) detailEl.textContent = ' — ' + String(detail);
  }

  function appendTerminal(text, cls) {
    const term = el('auto-terminal');
    if (!term) return;
    const span = document.createElement('span');
    span.className = cls || 'terminal-stdout';
    span.textContent = text;
    term.appendChild(span);
    term.scrollTop = term.scrollHeight;
  }

  function revealTerminal() {
    const term = el('auto-terminal');
    if (!term) return;
    term.style.display = 'block';
    term.classList.remove('auto-terminal-hidden');
  }

  function hideExtraActions() {
    ['auto-retry', 'auto-back', 'auto-pick-folder', 'auto-finish'].forEach(id => {
      const b = el(id); if (b) b.style.display = 'none';
    });
  }

  function showOnlyButtons(ids) {
    const actions = el('auto-actions');
    if (actions) actions.style.display = 'block';
    hideExtraActions();
    (ids || []).forEach(id => { const b = el(id); if (b) b.style.display = 'inline-block'; });
  }

  function resetWizard() {
    running = false;
    document.querySelectorAll('#auto-checklist li').forEach(li => {
      li.setAttribute('data-state', 'pending');
      const iconEl = li.querySelector('.auto-phase-icon');
      if (iconEl) iconEl.textContent = '○';
      const detailEl = li.querySelector('.auto-phase-detail');
      if (detailEl) detailEl.textContent = '';
    });
    const err = el('auto-error'); if (err) err.style.display = 'none';
    const success = el('auto-success'); if (success) success.style.display = 'none';
    const actions = el('auto-actions'); if (actions) actions.style.display = 'none';
    hideExtraActions();
  }

  // ── Reading content (easy / medium) ───────────────────────────────────────

  function stopReadingTimer() {
    if (readingTimer) { clearInterval(readingTimer); readingTimer = null; }
  }

  async function setupReading() {
    stopReadingTimer();
    const s = window.__setupState;
    const wrap = el('auto-reading-wrap');
    const box = el('auto-reading');
    const count = el('auto-reading-count');
    if (!wrap || !box) return;

    const ids = s.difficulty === 'easy'
      ? ['reading-ai', 'reading-ml', 'reading-python', 'reading-dependencies']
      : s.difficulty === 'medium'
        ? ['reading-why-python', 'reading-how-python']
        : [];

    if (ids.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';

    const items = [];
    for (const id of ids) {
      try {
        await window.__setupLoadScript(`../components/setup/modules/reading/${id}.js`);
        const idx = window.__setupSteps.findIndex(st => st.id === id);
        if (idx !== -1) {
          const readingStep = window.__setupSteps.splice(idx, 1)[0];
          items.push({ title: readingStep.title, html: readingStep.render() });
        }
      } catch (e) { console.warn('Could not load reading module:', id, e); }
    }

    if (items.length === 0) { wrap.style.display = 'none'; return; }

    let index = 0;
    const show = (i) => {
      box.innerHTML = items[i].html;
      if (count) count.textContent = `${items[i].title} · ${i + 1} / ${items.length}`;
    };
    show(0);
    readingTimer = setInterval(() => { index = (index + 1) % items.length; show(index); }, 15_000);
  }

  // ── Error / success screens ───────────────────────────────────────────────

  function fail(message) {
    running = false;
    stopReadingTimer();
    document.querySelectorAll('#auto-checklist li[data-state="busy"]').forEach(li => {
      setPhase(li.getAttribute('data-phase'), 'error');
    });
    revealTerminal();
    const err = el('auto-error');
    if (err) { err.style.display = 'block'; err.innerHTML = '⚠️ <strong>Setup did not finish.</strong><br>' + message; }
    showOnlyButtons(['auto-retry', 'auto-back']);
    el('auto-retry').onclick = () => { running = false; runAutoSetup(); };
    el('auto-back').onclick = () => window.__setupRender.prevStep();
  }

  function succeed() {
    running = false;
    stopReadingTimer();
    const S = window.__setupState;
    const success = el('auto-success');
    if (!success) return;
    const gpuName = S.detected.gpuName || (S.detected.gpuManufacturer === 'none' ? 'CPU' : S.detected.gpuManufacturer.toUpperCase());
    const variant = window.__setupUtils.gpuVariantLabel();
    success.style.display = 'block';
    success.innerHTML = `
      <div class="setup-success-msg">✅ <strong>mama is ready!</strong></div>
      <p>Detected <strong>${window.__setupUtils.escapeHtml(gpuName)}</strong> and installed
         <strong>PyTorch</strong> (${window.__setupUtils.escapeHtml(variant)}) inside
         <strong>${window.__setupUtils.escapeHtml(S.selectedProjectFolder || 'your project folder')}</strong>.</p>
      <p>Your choices were saved to <code>settings.json</code> so you can review or
         change them any time from the Settings page.</p>
    `;
    showOnlyButtons(['auto-finish']);
    el('auto-finish').onclick = finishSetup;
  }

  function finishSetup() {
    (async () => {
      try { await window.electron.settingsRead(); } catch (e) {}
      try { await window.electron.setupComplete(); } catch (e) {}
      try { await window.electron.navigateTo('public/index.html'); }
      catch (e) { window.location.href = 'index.html'; }
    })();
  }

  // ── Main pipeline ─────────────────────────────────────────────────────────

  async function runAutoSetup() {
    if (running) return;
    running = true;
    resetWizard();
    const S = window.__setupState;
    const U = window.__setupUtils;
    const electron = window.electron;

    try { await setupReading(); } catch (e) { console.warn('reading setup failed:', e); }

    // ── Detect Python ──────────────────────────────────────────────────────
    try {
      setPhase('python', 'busy');
      const py = await U.getPythonDetectResult();
      const kv = U.parseKV(py.stdout);
      S.detected.pythonVersion = kv['PYTHON_VERSION'] || null;
      S.detected.pipAvailable = U.boolVal(kv['PIP_AVAILABLE']);
      S.detected.cmakeAvailable = U.boolVal(kv['CMAKE_AVAILABLE']);
      S.detected.gccAvailable = U.boolVal(kv['GCC_AVAILABLE']);

      const pyOk = S.detected.pythonVersion && U.versionAtLeast(S.detected.pythonVersion, 3, 10);
      if (!pyOk) {
        setPhase('python', 'error');
        const need = S.detected.pythonVersion
          ? `Python ${S.detected.pythonVersion} was found, but mama needs 3.10 or newer.`
          : 'Python 3 was not found on this machine.';
        fail(`${need} Install Python 3.10+ from <a href="https://www.python.org/downloads/" target="_blank">python.org</a>, then retry.`);
        return;
      }
      setPhase('python', 'ok', S.detected.pythonVersion);
    } catch (e) {
      setPhase('python', 'error');
      fail(`Python detection failed: ${e.message}`);
      return;
    }

    // ── Detect OS ──────────────────────────────────────────────────────────
    try {
      setPhase('os', 'busy');
      const r = await electron.runOSDetect();
      const k = U.parseKV(r.stdout);
      S.detected.osFullName = k['OS_FULL'] || '';
      S.detected.osPrettyName = k['OS_PRETTY'] || '';
      S.detected.osKernel = k['OS_KERNEL'] || '';
      S.detected.arch = k['ARCH'] || S.detected.arch || window.versions?.arch?.() || '';
      setPhase('os', 'ok', S.detected.osPrettyName || S.detected.osFullName || 'detected');
    } catch (e) {
      setPhase('os', 'error');
    }

    // ── Detect GPU ─────────────────────────────────────────────────────────
    try {
      setPhase('gpu', 'busy');
      const r = await electron.runGPUDetect();
      const k = U.parseKV(r.stdout);
      S.detected.gpuManufacturer = (k['GPU_MANUFACTURER'] || 'none').toLowerCase();
      S.detected.gpuName = k['GPU_NAME'] || '';
      S.detected.gpuVramMB = k['GPU_VRAM_MB'] ? parseInt(k['GPU_VRAM_MB'], 10) : null;
      S.detected.cudaVersion = k['CUDA_VERSION'] || '';
      S.detected.rocmVersion = k['ROCM_VERSION'] || '';
      S.detected.driverVersion = k['DRIVER_VERSION'] || '';
      S.detected.metalVersion = k['METAL_VERSION'] || '';
      S.detected.mpsAvailable = U.boolVal(k['MPS_AVAILABLE']);
      setPhase('gpu', 'ok', S.detected.gpuName || window.__setupUtils.gpuVariantLabel());
    } catch (e) {
      // Never block the user — fall back to a CPU-only build.
      S.detected.gpuManufacturer = 'none';
      setPhase('gpu', 'ok', 'CPU-only (GPU detection unavailable)');
    }

    // ── Framework / variant (`torch`, matched to the detected GPU) ─────────
    S.selectedFramework = 'torch';
    const fw = 'torch';
    const gv = U.gpuVariant();
    const accel = S.detected.cudaVersion || S.detected.rocmVersion || '';

    // ── Create the .venv ───────────────────────────────────────────────────
    setPhase('venv', 'busy');
    if (!S.selectedProjectFolder) {
      running = false;
      setPhase('venv', 'error', 'a project folder is required');
      showOnlyButtons(['auto-pick-folder', 'auto-back']);
      el('auto-back').onclick = () => window.__setupRender.prevStep();
      el('auto-pick-folder').onclick = async () => {
        try {
          const path = await electron.projectPickFolder();
          if (!path) return;
          S.selectedProjectFolder = path;
          try { await electron.projectOpenFolder(path); } catch (e) {}
          running = false;
          runAutoSetup();
        } catch (e) { console.error('Folder pick failed:', e); }
      };
      return;
    }

    try {
      const init = await electron.projectInit(S.selectedProjectFolder);
      if (!init.hasVenv) {
        const venvRes = await electron.projectCreateVenv(S.selectedProjectFolder);
        if (!venvRes.success) throw new Error(venvRes.error || 'Could not create .venv.');
      }
      setPhase('venv', 'ok', '.venv ready');
    } catch (e) {
      setPhase('venv', 'error');
      fail(`Could not create the virtual environment: ${e.message}`);
      return;
    }

    // ── Install the framework (streaming) ──────────────────────────────────
    setPhase('install', 'busy');
    let result;
    try {
      result = await installFramework(fw, gv, accel);
    } catch (e) {
      setPhase('install', 'error');
      fail(`Installer threw an error: ${e.message}`);
      return;
    }

    const parsed = window.__setupUtils?.parseInstallOutput
      ? window.__setupUtils.parseInstallOutput(result.stdout, result.stderr, result.code)
      : null;
    const installOk = parsed ? parsed.success : result.code === 0;

    if (!installOk) {
      setPhase('install', 'error');
      const full = (result.stderr || '') + (result.stdout || '');
      if (full) appendTerminal('\n── Full install output ──\n' + full + '\n', 'terminal-stderr');
      fail(parsed?.message || 'PyTorch could not be installed — see the terminal output below.');
      return;
    }
    setPhase('install', 'ok');

    // ── Verify the import ──────────────────────────────────────────────────
    setPhase('verify', 'busy');
    try {
      const verify = await electron.runImportTest(fw, S.selectedProjectFolder);
      if (verify.code === 0) {
        setPhase('verify', 'ok', 'import works');
        S.installSucceeded = true;
      } else {
        setPhase('verify', 'error', 'import test failed');
        S.installSucceeded = false;
      }
    } catch (e) {
      setPhase('verify', 'error');
      S.installSucceeded = false;
    }

    // ── Persist settings.json ──────────────────────────────────────────────
    setPhase('settings', 'busy');
    try {
      await saveSettingsToJson();
      setPhase('settings', 'ok');
    } catch (e) {
      setPhase('settings', 'error');
      fail(`Your software installed fine, but saving the settings failed: ${e.message}`);
      return;
    }

    if (S.installSucceeded) {
      succeed();
    } else {
      fail('PyTorch installed, but the import test did not pass. Your project and .venv are still in place — retry or back out.');
    }
  }

  // Runs install_fw with streaming progress, resolving when the process exits.
  function installFramework(fw, gv, accel) {
    const S = window.__setupState;
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      window.electron.onInstallProgress((chunk) => {
        if (chunk.type === 'stdout') { stdout += chunk.text; appendTerminal(chunk.text, 'terminal-stdout'); }
        if (chunk.type === 'stderr') { stderr += chunk.text; appendTerminal(chunk.text, 'terminal-stderr'); }
        if (chunk.type === 'meta')   { appendTerminal('\n' + chunk.text + '\n', 'terminal-meta'); }
        if (chunk.type === 'done')   { resolve({ code: chunk.code, stdout, stderr }); }
      });
      window.electron.runInstallStream(fw, gv, accel, 'project', S.selectedProjectFolder, '')
        .catch((e) => { window.electron.offInstallProgress?.(); reject(e); });
    });
  }

  // ── settings.json writer ──────────────────────────────────────────────────
  async function saveSettingsToJson() {
    const S = window.__setupState;
    const base = window.__setupSettings.defaultSettings();
    const sc = Object.assign({}, base, S.settingsCache || {});
    sc['general settings'] = Object.assign({}, sc['general settings'], { language: S.selectedLanguage || 'eng' });
    sc['aesthetic settings'] = Object.assign({}, sc['aesthetic settings'], {
      appearance: S.selectedAppearance || 'system',
      'scaling factor': Number(S.selectedScaling) || 1,
    });
    sc['hardware settings'] = Object.assign({}, sc['hardware settings'], {
      'graphics manufacturer': S.detected.gpuManufacturer || null,
      'target card name': S.detected.gpuName || null,
      'cuda version': S.detected.cudaVersion || null,
      'rocm version': S.detected.rocmVersion || null,
      'metal version': S.detected.metalVersion || null,
      'mps available': S.detected.mpsAvailable || false,
      'gpu type': null,
      mode: 'gpu',
    });
    sc['software information'] = Object.assign({}, sc['software information'], {
      'OS full': S.detected.osFullName || null,
      'OS pretty': S.detected.osPrettyName || null,
      'OS kernel': S.detected.osKernel || null,
      cmake: Boolean(S.detected.cmakeAvailable),
      gcc: Boolean(S.detected.gccAvailable),
      tf: false,
      pyt: true,
    });
    try { if (S.selectedProjectFolder) await window.electron.projectOpenFolder(S.selectedProjectFolder); } catch (e) {}
    await window.electron.settingsWrite(sc);
    await window.electron.settingsWriteNonbackup(sc);
    S.settingsCache = sc;
  }
})();