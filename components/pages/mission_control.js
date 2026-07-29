// Mission Control – Pre-flight Compatibility Checks
// Runs system-level queries + Python framework import tests

const MC = (() => {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  const CHECKS = [
    { id: 'python',        label: 'Python',        action: 'python',        settingKey: null },
    { id: 'node',          label: 'Node.js',       action: 'node',          settingKey: null },
    { id: 'npm',           label: 'npm',            action: 'npm',           settingKey: null },
    { id: 'git',           label: 'Git',            action: 'git',           settingKey: null },
    { id: 'torch',         label: 'PyTorch',       action: 'import-torch',  settingKey: 'pyt' },
    { id: 'tensorflow',    label: 'TensorFlow',    action: 'import-tf',     settingKey: 'tf' },
    { id: 'docker',        label: 'Docker',        action: 'docker',        settingKey: null },
  ];

  const ICON = { idle: '⏳', pending: '🔄', pass: '✅', fail: '❌', warn: '⚠️', disabled: '🔒' };
  const LABEL = { idle: 'Pending…', pending: 'Checking…', pass: 'Pass', fail: 'Fail', warn: 'Warning', disabled: 'Disabled' };
  const COLOR = { idle: '#666', pending: '#ffc107', pass: '#4caf50', fail: '#f44336', warn: '#ff9800', disabled: '#444' };

  let container = null;
  let cards = {};
  let settings = null;
  let projectFolder = null;

  // ── Load project folder from recents ────────────────────────
  async function loadProjectFolder() {
    try {
      const recents = await window.electron.projectRecentsRead();
      if (recents?.open) {
        projectFolder = recents.open;
      }
    } catch (e) {
      projectFolder = null;
    }
  }

  // ── Load settings ─────────────────────────────────────────

  async function loadSettings() {
    try {
      settings = await window.electron.settingsRead();
    } catch (e) {
      settings = null;
    }
  }

  // ── Check if a framework check should be disabled ──────────
  function isDisabled(settingKey) {
    if (!settingKey || !settings) return false;
    // software information contains tf and pyt booleans
    const si = settings['software information'];
    if (!si) return false;
    // If the setting key is present and false, the framework is deselected → disabled
    if (si[settingKey] === false) return true;
    return false;
  }

  // ── Helpers ────────────────────────────────────────────────
  function humanFlops(flops) {
    if (flops >= 1e12) return (flops / 1e12).toFixed(3) + ' TFLOPS';
    if (flops >= 1e9) return (flops / 1e9).toFixed(3) + ' GFLOPS';
    return flops.toFixed(1) + ' FLOPS';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Render structured FLOPS results ──────────────────────────
  function renderFlopsResults(data, container, exportBtn) {
    container.style.display = 'block';
    container.dataset.rawJson = JSON.stringify(data, null, 2);

    const pct = data.pct_of_peak;
    const peakTflops = data.peak_tflops;

    // Color-code utilization
    let utilColor, utilLabel;
    if (pct === null || pct === undefined) {
      utilColor = '#aaa';
      utilLabel = 'Unknown chip — no peak data';
    } else if (pct >= 30) {
      utilColor = '#4caf50';
      utilLabel = 'Good utilization';
    } else if (pct >= 10) {
      utilColor = '#ffc107';
      utilLabel = 'Moderate utilization';
    } else {
      utilColor = '#f44336';
      utilLabel = 'Low utilization (expected for small models)';
    }

    // Build utilization bar
    const barPct = pct !== null && pct !== undefined ? Math.min(pct, 100) : 0;

    container.innerHTML = `
      <div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:1.25rem;margin-top:0.5rem">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
          <div>
            <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Model</div>
            <div style="color:#eee;font-size:1rem">${escapeHtml(data.model)}</div>
          </div>
          <div>
            <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Device</div>
            <div style="color:#eee;font-size:1rem">${escapeHtml(data.device)}</div>
          </div>
          <div>
            <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Batch Size</div>
            <div style="color:#eee;font-size:1rem">${data.batch_size}</div>
          </div>
          <div>
            <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Input Size</div>
            <div style="color:#eee;font-size:1rem">${data.input_size}×${data.input_size}</div>
          </div>
        </div>

        <div style="border-top:1px solid #444;padding-top:1rem;margin-bottom:1rem">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div>
              <div style="color:#888;font-size:0.75rem;text-transform:uppercase">FLOPs / Pass</div>
              <div style="color:#eee;font-size:1rem">${humanFlops(data.flops_per_pass)}</div>
            </div>
            <div>
              <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Parameters</div>
              <div style="color:#eee;font-size:1rem">${(data.params / 1e6).toFixed(2)} M</div>
            </div>
            <div>
              <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Achieved FLOPS</div>
              <div style="color:#4caf50;font-size:1.1rem;font-weight:bold">${humanFlops(data.achieved_flops)}</div>
            </div>
            <div>
              <div style="color:#888;font-size:0.75rem;text-transform:uppercase">Throughput</div>
              <div style="color:#eee;font-size:1rem">${data.inferences_per_sec.toFixed(1)} inf/s</div>
            </div>
          </div>
        </div>

        ${peakTflops ? `
        <div style="border-top:1px solid #444;padding-top:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
            <div>
              <span style="color:#888;font-size:0.75rem;text-transform:uppercase">Chip: </span>
              <span style="color:#eee;font-size:0.9rem">${escapeHtml(data.chip_name || 'Unknown')}</span>
            </div>
            <div>
              <span style="color:#888;font-size:0.75rem;text-transform:uppercase">Peak: </span>
              <span style="color:#eee;font-size:0.9rem">${peakTflops.toFixed(1)} TFLOPS</span>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:#666;margin-bottom:0.15rem">
            <span>0%</span>
            <span style="color:#ffc107">10% — Expected range — 40%</span>
            <span>100%</span>
          </div>
          <div style="background:#444;border-radius:4px;height:20px;overflow:hidden;margin-bottom:0.3rem;position:relative">
            <div style="position:absolute;left:10%;width:30%;height:100%;background:repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,193,7,0.12) 4px,rgba(255,193,7,0.12) 8px);border-left:1px dashed rgba(255,193,7,0.4);border-right:1px dashed rgba(255,193,7,0.4)"></div>
            <div style="background:${utilColor};width:${barPct}%;height:100%;border-radius:4px;transition:width 0.5s ease;position:relative;z-index:1"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="color:${utilColor};font-size:0.85rem;font-weight:bold">${pct.toFixed(1)}% of peak</span>
            <span style="color:#aaa;font-size:0.8rem">${utilLabel}</span>
          </div>
        </div>
        ` : `
        <div style="border-top:1px solid #444;padding-top:0.75rem;color:#888;font-size:0.85rem">
          ⚠ Peak FLOPS data not available for this chip. Compare manually to your spec sheet.
        </div>
        `}

        <div style="border-top:1px solid #444;padding-top:0.75rem;margin-top:1rem;color:#666;font-size:0.75rem">
          ${data.iterations} iterations × ${data.warmup} warmup — ${data.elapsed_seconds.toFixed(3)}s elapsed
        </div>
      </div>
    `;

    // Show export button
    exportBtn.style.display = 'inline-block';
  }

  // ── Parse PROGRESS lines from flops.py stdout ──────────────
  function parseProgressSteps(output) {
    const lines = output.split('\n').filter(l => l.startsWith('PROGRESS:'));
    if (!lines.length) {
      return [{ msg: 'Running benchmark...', pct: 50 }, { msg: 'Complete!', pct: 100 }];
    }

    const steps = [];
    let prevPct = 0;
    for (const line of lines) {
      const msg = line.slice(9);
      let pct;
      if (/^Loading model/i.test(msg)) pct = 5;
      else if (/^Counting FLOPs/i.test(msg)) pct = 10;
      else if (/^Moving model/i.test(msg)) pct = 15;
      else if (/^Warming up/i.test(msg)) pct = 20;
      else if (/^Warmup (\d+)\/(\d+)/.test(msg)) {
        const m = msg.match(/^Warmup (\d+)\/(\d+)/);
        pct = 20 + (parseInt(m[1]) / parseInt(m[2])) * 30;
      } else if (/^Measuring \(\d+ iterations\)/.test(msg)) pct = 50;
      else if (/^Measuring (\d+)\/(\d+)/.test(msg)) {
        const m = msg.match(/^Measuring (\d+)\/(\d+)/);
        pct = 50 + (parseInt(m[1]) / parseInt(m[2])) * 45;
      } else pct = Math.min(prevPct + 5, 99);
      steps.push({ msg, pct: Math.round(Math.max(pct, prevPct)) });
      prevPct = pct;
    }
    steps.push({ msg: 'Complete!', pct: 100 });
    return steps;
  }

  function animateProgressSteps(steps, textEl, barEl, onDone) {
    let i = 0;
    function tick() {
      if (i >= steps.length) { onDone(); return; }
      const s = steps[i];
      textEl.textContent = s.msg;
      barEl.style.width = s.pct + '%';
      i++;
      setTimeout(tick, 180);
    }
    tick();
  }

  // ── Render ────────────────────────────────────────────────
  async function render(target) {
    container = target;
    container.innerHTML = '';

    // Load settings first so we know which frameworks are active
    await loadSettings();

    // Load project folder from recents for project-scoped checks
    await loadProjectFolder();

    const title = document.createElement('h2');
    title.textContent = '🚀 Pre-Flight Checks';
    container.appendChild(title);

    const flexGrid = document.createElement('div');
    flexGrid.className = 'mc-grid';

    CHECKS.forEach((check) => {
      const card = document.createElement('div');
      card.className = 'mc-card';
      card.dataset.checkId = check.id;
      const disabled = isDisabled(check.settingKey);

      const statusIcon = document.createElement('span');
      statusIcon.className = 'mc-icon';
      statusIcon.textContent = disabled ? ICON.disabled : ICON.idle;

      const info = document.createElement('div');
      info.className = 'mc-info';

      const name = document.createElement('div');
      name.className = 'mc-name';
      name.textContent = check.label;
      if (disabled) name.style.color = '#555';

      const status = document.createElement('div');
      status.className = 'mc-status';
      status.textContent = disabled ? LABEL.disabled : LABEL.idle;
      status.style.color = disabled ? COLOR.disabled : COLOR.idle;

      const detail = document.createElement('div');
      detail.className = 'mc-detail';
      detail.textContent = disabled ? 'Deselected in settings' : '';

      info.appendChild(name);
      info.appendChild(status);
      info.appendChild(detail);

      // If disabled, add a small "check anyway" link
      if (disabled) {
        const checkAnyway = document.createElement('button');
        checkAnyway.className = 'mc-check-anyway';
        checkAnyway.textContent = '▶ check anyway';
        checkAnyway.addEventListener('click', (e) => {
          e.stopPropagation();
          // Unlock the card so setStatus works
          cards[check.id].disabled = false;
          // Run just this check
          runSingleCheck(check.id);
        });
        info.appendChild(checkAnyway);
      }

      card.appendChild(statusIcon);
      card.appendChild(info);
      flexGrid.appendChild(card);

      cards[check.id] = {
        card,
        statusIcon,
        statusEl: status,
        detailEl: detail,
        disabled
      };
    });

    container.appendChild(flexGrid);

    // Run button (skip disabled checks)
    const runBtn = document.createElement('button');
    runBtn.className = 'mc-run-btn';
    runBtn.textContent = '▶ Run All Checks';
    runBtn.addEventListener('click', runAll);
    container.appendChild(runBtn);

    // ── FLOPS Benchmark Section (separate, not in Run All) ──
    const flopsSection = document.createElement('div');
    flopsSection.className = 'mc-flops-section';
    flopsSection.style.marginTop = '2rem';
    flopsSection.style.padding = '1rem';
    flopsSection.style.borderTop = '1px solid #444';

    const flopsTitle = document.createElement('h3');
    flopsTitle.textContent = '⚡ GPU FLOPS Benchmark';
    flopsSection.appendChild(flopsTitle);

    const flopsDesc = document.createElement('p');
    flopsDesc.style.color = '#aaa';
    flopsDesc.style.fontSize = '0.85rem';
    flopsDesc.textContent = 'Measures achieved FLOPS on the selected GPU. Results below the chip\'s peak spec (10-40% of peak) are expected.';
    flopsSection.appendChild(flopsDesc);

    // Controls row: model dropdown, batch size, run button
    const flopsControls = document.createElement('div');
    flopsControls.style.display = 'flex';
    flopsControls.style.alignItems = 'center';
    flopsControls.style.gap = '0.75rem';
    flopsControls.style.marginTop = '0.5rem';
    flopsControls.style.flexWrap = 'wrap';

    // Model selector
    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'Model:';
    modelLabel.style.color = '#ccc';

    const modelSelect = document.createElement('select');
    modelSelect.style.padding = '0.3rem 0.5rem';
    modelSelect.style.border = '1px solid #555';
    modelSelect.style.borderRadius = '4px';
    modelSelect.style.backgroundColor = '#333';
    modelSelect.style.color = '#eee';
    modelSelect.style.fontSize = '0.9rem';

    const models = [
      { value: 'resnet18', label: 'ResNet-18' },
      { value: 'resnet50', label: 'ResNet-50' },
      { value: 'vit_b_16', label: 'ViT-B/16' },
    ];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    });

    // Batch size input
    const batchLabel = document.createElement('label');
    batchLabel.textContent = 'Batch size:';
    batchLabel.style.color = '#ccc';

    const batchInput = document.createElement('input');
    batchInput.type = 'number';
    batchInput.min = 1;
    batchInput.max = 512;
    batchInput.value = '8';
    batchInput.style.width = '80px';
    batchInput.style.padding = '0.3rem 0.5rem';
    batchInput.style.border = '1px solid #555';
    batchInput.style.borderRadius = '4px';
    batchInput.style.backgroundColor = '#333';
    batchInput.style.color = '#eee';
    batchInput.style.fontSize = '0.9rem';

    const flopsRunBtn = document.createElement('button');
    flopsRunBtn.className = 'mc-run-btn mc-run-btn-flops';
    flopsRunBtn.textContent = '▶ Run FLOPS Test';
    flopsRunBtn.style.marginTop = '0';

    flopsControls.appendChild(modelLabel);
    flopsControls.appendChild(modelSelect);
    flopsControls.appendChild(batchLabel);
    flopsControls.appendChild(batchInput);
    flopsControls.appendChild(flopsRunBtn);
    flopsSection.appendChild(flopsControls);

    // ── Progress Modal Overlay ──────────────────────────────────
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'mc-flops-modal';
    modalOverlay.style.cssText = `
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 9999;
      align-items: center;
      justify-content: center;
    `;

    const modalBox = document.createElement('div');
    modalBox.style.cssText = `
      background: #222;
      border: 1px solid #555;
      border-radius: 8px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      text-align: center;
    `;

    const modalSpinner = document.createElement('div');
    modalSpinner.textContent = '⏳';
    modalSpinner.style.fontSize = '2.5rem';
    modalSpinner.style.marginBottom = '1rem';

    const modalTitle = document.createElement('div');
    modalTitle.textContent = 'Running FLOPS Benchmark…';
    modalTitle.style.fontSize = '1.1rem';
    modalTitle.style.fontWeight = 'bold';
    modalTitle.style.marginBottom = '0.75rem';
    modalTitle.style.color = '#eee';

    const modalProgress = document.createElement('div');
    modalProgress.style.cssText = `
      font-family: monospace;
      font-size: 0.85rem;
      color: #aaa;
      margin-bottom: 0.5rem;
      min-height: 1.5em;
    `;

    const modalProgressBarTrack = document.createElement('div');
    modalProgressBarTrack.style.cssText = `
      width: 100%;
      height: 6px;
      background: #333;
      border-radius: 3px;
      margin-bottom: 1rem;
      overflow: hidden;
    `;

    const modalProgressBar = document.createElement('div');
    modalProgressBar.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #4caf50, #8bc34a);
      border-radius: 3px;
      transition: width 0.3s ease;
    `;

    modalProgressBarTrack.appendChild(modalProgressBar);

    const modalCancelBtn = document.createElement('button');
    modalCancelBtn.textContent = '✕ Cancel';
    modalCancelBtn.style.cssText = `
      padding: 0.5rem 1.2rem;
      border: 1px solid #f44336;
      border-radius: 4px;
      background: transparent;
      color: #f44336;
      cursor: pointer;
      font-size: 0.85rem;
    `;
    modalCancelBtn.addEventListener('mouseenter', () => {
      modalCancelBtn.style.background = '#f4433622';
    });
    modalCancelBtn.addEventListener('mouseleave', () => {
      modalCancelBtn.style.background = 'transparent';
    });

    modalBox.appendChild(modalSpinner);
    modalBox.appendChild(modalTitle);
    modalBox.appendChild(modalProgress);
    modalBox.appendChild(modalProgressBarTrack);
    modalBox.appendChild(modalCancelBtn);
    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);

    // ── Results display ─────────────────────────────────────────
    const flopsResults = document.createElement('div');
    flopsResults.className = 'mc-flops-results';
    flopsResults.style.marginTop = '1rem';
    flopsResults.style.display = 'none';

    // Export button (hidden until results available)
    const exportBtn = document.createElement('button');
    exportBtn.className = 'mc-run-btn';
    exportBtn.textContent = '💾 Export Results';
    exportBtn.style.marginTop = '0.75rem';
    exportBtn.style.display = 'none';
    exportBtn.style.backgroundColor = '#795548';

    flopsSection.appendChild(flopsResults);
    flopsSection.appendChild(exportBtn);
    container.appendChild(flopsSection);

    // ── FLOPS test runner ───────────────────────────────────────
    flopsRunBtn.addEventListener('click', async () => {
      const batchSize = Math.max(1, parseInt(batchInput.value, 10) || 1);
      const model = modelSelect.value;

      // Reset UI
      flopsResults.style.display = 'none';
      exportBtn.style.display = 'none';
      flopsRunBtn.disabled = true;
      flopsRunBtn.textContent = '⏳ Running…';

      // Show modal
      modalOverlay.style.display = 'flex';
      modalProgress.textContent = 'Starting…';
      modalCancelBtn.disabled = false;
      modalCancelBtn.style.opacity = '1';

      // Cancel handler
      const onCancel = () => {
        modalOverlay.style.display = 'none';
        flopsRunBtn.disabled = false;
        flopsRunBtn.textContent = '▶ Run FLOPS Test';
      };
      modalCancelBtn.onclick = onCancel;

      try {
        // Run with JSON output for structured parsing
        const bridge = window.pywebview?.api || window.electron;
        const result = bridge
          ? window.pywebview?.api
            ? await bridge.run_flops_test(batchSize, model, true)
            : await bridge.runFlopsTest(batchSize, model, true)
          : { code: 1, stdout: '', stderr: 'No API bridge available' };
        const output = result.stdout || '';
        const err = result.stderr || '';

        // Parse progress lines and animate the progress bar
        modalCancelBtn.disabled = true;
        modalCancelBtn.style.opacity = '0.4';
        const steps = parseProgressSteps(output);

        await new Promise((resolve) => {
          animateProgressSteps(steps, modalProgress, modalProgressBar, resolve);
        });

        // Small pause to show "Complete!" before hiding modal
        await new Promise(r => setTimeout(r, 300));

        // Hide modal
        modalOverlay.style.display = 'none';

        if (result.code === 0 && output) {
          // Try to parse JSON result
          let data;
          try {
            // Find JSON in output (it's the last line with --json flag)
            const lines = output.trim().split('\n');
            const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'));
            data = jsonLine ? JSON.parse(jsonLine) : null;
          } catch (e) {
            data = null;
          }

          if (data) {
            renderFlopsResults(data, flopsResults, exportBtn);
          } else {
            // Fallback: show raw output
            flopsResults.style.display = 'block';
            flopsResults.innerHTML = `<pre style="color:#4caf50;font-family:monospace;font-size:0.85rem;white-space:pre-wrap">${escapeHtml(output)}</pre>`;
          }
        } else {
          flopsResults.style.display = 'block';
          flopsResults.innerHTML = `<pre style="color:#f44336;font-family:monospace;font-size:0.85rem;white-space:pre-wrap">${escapeHtml(err || output || 'FLOPS test failed.')}</pre>`;
        }
      } catch (e) {
        modalOverlay.style.display = 'none';
        flopsResults.style.display = 'block';
        flopsResults.innerHTML = `<pre style="color:#f44336;font-family:monospace;font-size:0.85rem;white-space:pre-wrap">Error: ${escapeHtml(e.message)}</pre>`;
      } finally {
        flopsRunBtn.disabled = false;
        flopsRunBtn.textContent = '▶ Run FLOPS Test';
      }
    });

    // ── Export handler ──────────────────────────────────────────
    exportBtn.addEventListener('click', async () => {
      const resultText = flopsResults.dataset.rawJson || flopsResults.textContent;
      if (!resultText) return;

      try {
        const bridge = window.pywebview?.api || window.electron;
        const exportResult = bridge
          ? window.pywebview?.api
            ? await bridge.export_flops_result(resultText)
            : await bridge.exportFlopsResult(resultText)
          : { success: false, error: 'No API bridge available' };
        if (exportResult.success) {
          exportBtn.textContent = '✅ Exported!';
          setTimeout(() => {
            exportBtn.textContent = '💾 Export Results';
          }, 2000);
        } else if (exportResult.error) {
          alert(`Export failed: ${exportResult.error}`);
        }
        // If path is null, user cancelled — do nothing
      } catch (e) {
        alert(`Export error: ${e.message}`);
      }
    });
  }

  // ── Update UI ─────────────────────────────────────────────
  function setStatus(id, state, detailText) {
    const c = cards[id];
    if (!c) return;
    // Never overwrite disabled state
    if (c.disabled) return;
    c.statusIcon.textContent = ICON[state] || ICON.idle;
    c.statusEl.textContent = LABEL[state] || LABEL.idle;
    c.statusEl.style.color = COLOR[state] || COLOR.idle;
    c.detailEl.textContent = detailText || '';
    c.card.className = 'mc-card mc-card-' + state;
  }

  // ── Individual Checks ──────────────────────────────────────
  async function runCheckPython() {
    setStatus('python', 'pending');
    try {
      const result = await window.electron.runSystemCommand('python', ['--version']);
      if (result.code === 0 && result.stdout) {
        const ver = result.stdout.trim().replace(/^Python\s+/i, '');
        setStatus('python', 'pass', `v${ver}`);
      } else {
        const result3 = await window.electron.runSystemCommand('python3', ['--version']);
        if (result3.code === 0 && result3.stdout) {
          const ver = result3.stdout.trim().replace(/^Python\s+/i, '');
          setStatus('python', 'pass', `v${ver}`);
        } else {
          setStatus('python', 'fail', 'Not found');
        }
      }
    } catch (e) {
      setStatus('python', 'fail', e.message);
    }
  }

  async function runCheckNode() {
    setStatus('node', 'pending');
    try {
      const result = await window.electron.runSystemCommand('node', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('node', 'pass', result.stdout.trim());
      } else {
        setStatus('node', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('node', 'fail', e.message);
    }
  }

  async function runCheckNpm() {
    setStatus('npm', 'pending');
    try {
      const result = await window.electron.runSystemCommand('npm', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('npm', 'pass', `v${result.stdout.trim()}`);
      } else {
        setStatus('npm', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('npm', 'fail', e.message);
    }
  }

  async function runCheckGit() {
    setStatus('git', 'pending');
    try {
      const result = await window.electron.runSystemCommand('git', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('git', 'pass', result.stdout.trim());
      } else {
        setStatus('git', 'fail', 'Not found');
      }
    } catch (e) {
      setStatus('git', 'fail', e.message);
    }
  }

  async function runCheckDocker() {
    setStatus('docker', 'pending');
    try {
      const result = await window.electron.runSystemCommand('docker', ['--version']);
      if (result.code === 0 && result.stdout) {
        setStatus('docker', 'pass', result.stdout.trim());
      } else {
        setStatus('docker', 'warn', 'Not installed (optional)');
      }
    } catch (e) {
      setStatus('docker', 'warn', 'Not installed (optional)');
    }
  }

  async function runCheckImportTorch() {
    setStatus('torch', 'pending');
    try {
      const result = await window.electron.runImportTest('torch', projectFolder);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        const verLine = lines.find(l => l.toLowerCase().includes('version'));
        const ver = verLine ? verLine.replace(/.*version:\s*/i, 'v') : 'Installed';
        const hasCuda = result.stdout.toLowerCase().includes('cuda available');
        setStatus('torch', 'pass', `${ver}${hasCuda ? ' 🎮 CUDA' : ' 💻 CPU'}`);
      } else {
        setStatus('torch', 'fail', 'Not installed');
      }
    } catch (e) {
      setStatus('torch', 'fail', e.message);
    }
  }

  async function runCheckImportTf() {
    setStatus('tensorflow', 'pending');
    try {
      const result = await window.electron.runImportTest('tf', projectFolder);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        const verLine = lines.find(l => l.toLowerCase().includes('version'));
        const ver = verLine ? verLine.replace(/.*version:\s*/i, 'v') : 'Installed';
        setStatus('tensorflow', 'pass', ver);
      } else {
        setStatus('tensorflow', 'fail', 'Not installed');
      }
    } catch (e) {
      setStatus('tensorflow', 'fail', e.message);
    }
  }

  // ── Run a single check by id ────────────────────────────────
  async function runSingleCheck(id) {
    switch (id) {
      case 'python':     return runCheckPython();
      case 'node':       return runCheckNode();
      case 'npm':        return runCheckNpm();
      case 'git':        return runCheckGit();
      case 'docker':     return runCheckDocker();
      case 'torch':      return runCheckImportTorch();
      case 'tensorflow': return runCheckImportTf();
    }
  }

  // ── Run All ────────────────────────────────────────────────
  async function runAll() {
    // Reset all to idle first
    CHECKS.forEach(c => setStatus(c.id, 'idle', ''));

    const tasks = [];

    // Only add tasks for non-disabled checks
    CHECKS.forEach((check) => {
      if (cards[check.id] && cards[check.id].disabled) return;
      switch (check.id) {
        case 'python':     tasks.push(runCheckPython()); break;
        case 'node':       tasks.push(runCheckNode()); break;
        case 'npm':        tasks.push(runCheckNpm()); break;
        case 'git':        tasks.push(runCheckGit()); break;
        case 'docker':     tasks.push(runCheckDocker()); break;
        case 'torch':      tasks.push(runCheckImportTorch()); break;
        case 'tensorflow': tasks.push(runCheckImportTf()); break;
      }
    });

    await Promise.allSettled(tasks);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    init: (targetElement) => render(targetElement),
    run: runAll,
  };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('main-box') || document.getElementById('main box');
  if (target) {
    MC.init(target);
  }
});