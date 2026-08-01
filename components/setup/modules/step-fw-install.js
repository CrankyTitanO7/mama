// ── Step: Framework Install ───────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'fw-install',
    title: 'Framework Install',
    render: () => {
      const S = window.__setupState;
      const U = window.__setupUtils;
      const fw      = S.selectedFramework === 'tf' ? 'TensorFlow' : 'PyTorch';
      const isTorch = S.selectedFramework === 'torch';
      const variant = U.gpuVariantLabel();
      const cmd     = U.buildInstallCommand();

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
        const detectedOs = (S.detected.osPrettyName || '').toLowerCase();
        const defaultOs = detectedOs.includes('windows') ? 'windows' : detectedOs.includes('mac') ? 'macos' : 'linux';
        const defaultCompute = S.detected.gpuManufacturer === 'nvidia' ? 'cuda.x' : S.detected.gpuManufacturer === 'amd' ? 'rocm5.x' : 'accnone';
        // macOS ARM (Apple Silicon) needs nightly builds for MPS support
        const isMacOSArm = defaultOs === 'macos' && (S.detected.arch || '').includes('arm');
        const defaultBuild = isMacOSArm ? 'preview' : 'stable';

        const matrixBlock = (name, items, defaultValue, legend) => `
          <div class="setup-pytorch-matrix-block">
            <div class="setup-pytorch-matrix-label">${U.escapeHtml(legend)}</div>
            <div class="setup-pytorch-option-grid" data-group="${U.escapeHtml(name)}">
              ${items.map(item => `
                <label class="setup-pytorch-option ${item.value === defaultValue ? 'selected' : ''}">
                  <input type="radio" name="${U.escapeHtml(name)}" value="${U.escapeHtml(item.value)}" ${item.value === defaultValue ? 'checked' : ''}>
                  <span>${U.escapeHtml(item.label)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `;

        gridHtml = `
          <div class="setup-pytorch-matrix" style="margin: 16px 0; padding: 16px; background: rgba(128,128,128,0.1); border-radius: 8px;">
            <p style="margin-top:0; margin-bottom: 12px; font-weight: bold; font-size: 14px;">PyTorch Installation Matrix</p>
            ${matrixBlock('pt-build', [{ value: 'stable', label: 'Stable (2.13.0)' }, { value: 'preview', label: 'Preview (Nightly)' }], defaultBuild, 'PyTorch Build')}
            ${matrixBlock('pt-os', osChoices, defaultOs, 'Your OS')}
            ${matrixBlock('pt-pm', packageChoices, 'pip', 'Package')}
            ${matrixBlock('pt-lang', languageChoices, 'python', 'Language')}
            ${matrixBlock('pt-cuda', computeChoices, defaultCompute, 'Compute Platform')}
          </div>
        `;
      }

      return `
        <h2>Install ${fw}</h2>
        <p>Installing <strong>${fw}</strong> with <strong>${U.escapeHtml(variant)}</strong> support.</p>
        <p>note: if installing pytorch with MPS support (MacOS), choose nightly build!</p>
        ${gridHtml}
        <div class="setup-field">
          <label>Install Scope:</label>
          <select id="install-scope" class="setup-select">
            <option value="global">Global (system Python)</option>
            <option value="project">Project (.venv only)</option>
          </select>
          <p class="setup-hint">Global installs to your system Python. Project installs to a virtual environment in your project folder.</p>
        </div>
        <div id="project-folder-prompt" style="display:none; margin-top:12px">
          <p class="setup-hint">No project folder selected. Click below to choose one.</p>
          <button id="select-project-folder-btn" class="setup-btn setup-btn-secondary">📂 Select Project Folder</button>
        </div>
        <div class="setup-field">
          <label>Install command:</label>
          <input type="text" id="install-cmd-input" class="setup-input setup-input-mono" value="${U.escapeHtml(cmd)}">
          <p class="setup-hint">Edit if you need a specific wheel, or use the matrix above for PyTorch.</p>
        </div>
        <button id="run-fw-install-btn" class="setup-btn setup-btn-primary">⬇️ Install ${fw}</button>
        <div id="fw-install-output" style="display:none; margin-top:12px">
          <div id="fw-install-terminal" class="setup-terminal"></div>
        </div>
      `;
    },
    afterRender: async () => {
      const S = window.__setupState;
      const U = window.__setupUtils;

      // --- PYTORCH DYNAMIC MATRIX LOGIC ---
      if (S.selectedFramework === 'torch') {
        const cmdInput = document.getElementById('install-cmd-input');
        const matrixGroups = ['pt-build', 'pt-pm', 'pt-os', 'pt-cuda', 'pt-lang'];
        let pyTorchCommandMap = {};

        try {
          pyTorchCommandMap = await window.electron?.torchCommandsRead?.() || {};
        } catch (error) {
          console.error('Unable to load the PyTorch command matrix:', error);
        }

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
          const fallback = document.querySelector('input[name="pt-cuda"][value="accnone"]');

          document.querySelectorAll('input[name="pt-cuda"]').forEach(input => {
            const label = input.closest('.setup-pytorch-option');
            const isCuda = input.value.startsWith('cuda');
            const isRocm = input.value.startsWith('rocm');
            const allowed = input.value === 'accnone' || (!isMacOS && (isCuda || !isWindows));
            const shouldDisable = !allowed || (isRocm && (isMacOS || isWindows));

            input.disabled = shouldDisable;
            label?.classList.toggle('disabled', shouldDisable);

            if (shouldDisable && input.checked && fallback) {
              fallback.checked = true;
              fallback.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        };

        const updateCommand = () => {
          syncSelectorAvailability();
          syncSelectionVisuals();

          const key = [
            getSelection('pt-build'),
            getSelection('pt-pm'),
            getSelection('pt-os'),
            getSelection('pt-cuda'),
            getSelection('pt-lang')
          ].join(',');

          if (cmdInput) {
            cmdInput.value = pyTorchCommandMap[key] || '# Follow instructions at https://github.com/pytorch/pytorch#from-source';
          }
        };

        matrixGroups.forEach(groupName => {
          document.querySelectorAll(`input[name="${groupName}"]`).forEach(el => {
            el.addEventListener('change', updateCommand);
          });
        });

        syncSelectorAvailability();
        syncSelectionVisuals();
        updateCommand();
      }

      // --- INSTALL SCOPE LOGIC ---
      const scopeSelect = document.getElementById('install-scope');
      const folderPrompt = document.getElementById('project-folder-prompt');
      const selectFolderBtn = document.getElementById('select-project-folder-btn');

      const updateScopeUI = () => {
        const isProjectScope = scopeSelect?.value === 'project';
        if (folderPrompt) folderPrompt.style.display = isProjectScope && !S.selectedProjectFolder ? 'block' : 'none';
      };

      scopeSelect?.addEventListener('change', updateScopeUI);

      // Load current project folder from recents
      try {
        const recents = await window.electron.projectRecentsRead();
        if (recents?.open) {
          S.selectedProjectFolder = recents.open;
          updateScopeUI();
        }
      } catch (_) {}

      // Handle project folder selection button
      selectFolderBtn?.addEventListener('click', async () => {
        try {
          const folderPath = await window.electron.projectPickFolder();
          if (!folderPath) return;
          S.selectedProjectFolder = folderPath;
          updateScopeUI();
        } catch (e) {
          console.error('Failed to pick project folder:', e);
        }
      });

      // --- INSTALL PROCESS LOGIC ---
      document.getElementById('run-fw-install-btn')?.addEventListener('click', async () => {
        const btn      = document.getElementById('run-fw-install-btn');
        const output   = document.getElementById('fw-install-output');
        const terminal = document.getElementById('fw-install-terminal');
        const cmdInput = document.getElementById('install-cmd-input');
        if (!btn || !output || !terminal) return;

        // If the user selected libtorch (which spits out a URL instead of a pip command), abort
        if (cmdInput && cmdInput.value.startsWith('http')) {
          alert('LibTorch provides a ZIP download link, not a direct command. Please copy the URL to download it.');
          return;
        }

        // Check if project scope is selected but no folder chosen
        if (scopeSelect?.value === 'project' && !S.selectedProjectFolder) {
          try {
            const folderPath = await window.electron.projectPickFolder();
            if (!folderPath) {
              btn.disabled = false;
              btn.textContent = '⬇️ Install';
              return;
            }
            S.selectedProjectFolder = folderPath;
          } catch (e) {
            console.error('Failed to pick project folder:', e);
            btn.disabled = false;
            btn.textContent = '⬇️ Install';
            return;
          }
        }

        output.style.display = 'block';
        terminal.innerHTML   = '';
        btn.disabled         = true;
        btn.textContent      = '⏳ Installing…';

        const fw = S.selectedFramework || 'torch';
        const ptCudaValue = document.querySelector('input[name="pt-cuda"]:checked')?.value || '';
        const gv = fw === 'torch' && ptCudaValue
          ? (ptCudaValue.includes('cuda') ? 'cuda' : ptCudaValue.includes('rocm') ? 'rocm' : 'cpu')
          : U.gpuVariant();

        const accelVersion = S.detected.cudaVersion || S.detected.rocmVersion || '';
        const scope = scopeSelect?.value || 'global';

        function appendTerminal(text, cls) {
          const span = document.createElement('span');
          span.className   = cls;
          span.textContent = text;
          terminal.appendChild(span);
          terminal.scrollTop = terminal.scrollHeight;
        }

        // Capture full output for the install parser
        let installStdout = '';
        let installStderr = '';

        try {
          window.electron.onInstallProgress((chunk) => {
            if (chunk.type === 'stdout') {
              installStdout += chunk.text;
              appendTerminal(chunk.text, 'terminal-stdout');
            }
            if (chunk.type === 'stderr') {
              installStderr += chunk.text;
              appendTerminal(chunk.text, 'terminal-stderr');
            }
            if (chunk.type === 'meta') {
              appendTerminal(chunk.text + '\n', 'terminal-meta');
            }
          });

          const rawCmd = cmdInput ? cmdInput.value : '';
          const result = await window.electron.runInstallStream(fw, gv, accelVersion, scope, S.selectedProjectFolder, rawCmd);

          window.electron.offInstallProgress();

          // runInstallStream returns { code: number } — extract the numeric code
          const exitCode = result?.code ?? result ?? -1;

          // Use the install parser to determine the actual result
          const parseResult = window.__setupUtils?.parseInstallOutput
            ? window.__setupUtils.parseInstallOutput(installStdout, installStderr, exitCode)
            : null;

          if (parseResult) {
            appendTerminal('\\n── ' + parseResult.message + '\\n', parseResult.success ? 'terminal-success' : 'terminal-error');
            if (parseResult.success) {
              S.installSucceeded = true;
              btn.textContent = '✓ Installed';
            } else {
              // Never hide the failure: print the complete captured output.
              const full = (installStdout || '') + (installStderr || '');
              if (full.trim()) {
                appendTerminal('\\n── Full install output ──\\n' + full + '\\n', 'terminal-stderr');
              }
              btn.textContent = '⬇️ Retry';
              btn.disabled    = false;
            }
          } else if (exitCode === 0) {
            S.installSucceeded = true;
            appendTerminal('✅ Installation complete!\\n', 'terminal-success');
            btn.textContent = '✓ Installed';
          } else {
            const full = (installStdout || '') + (installStderr || '');
            appendTerminal('❌ Installation failed — see full output below.\\n', 'terminal-error');
            if (full.trim()) {
              appendTerminal(full + '\\n', 'terminal-stderr');
            }
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
  });
})();