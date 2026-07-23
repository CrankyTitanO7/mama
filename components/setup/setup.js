// ── Setup Wizard — Parent Loader ──────────────────────────────────────────
//
// Fetches setup.json to determine the ordered list of step modules,
// loads _shared.js and each step module in order, then bootstraps the wizard.
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
//   Install — streaming variant
//     window.electron.runInstallStream(fw, gpuVariant, accelVersion, scope, projectFolder)
//       → Promise<{code: number}>   resolves when process exits
//     window.electron.onInstallProgress(callback)
//       → registers listener for { type:'stdout'|'stderr'|'done', text?, code? }
//     window.electron.offInstallProgress()
//       → removes all 'install-progress' listeners
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
  // Bootstrap
  // ═══════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // 1. Load setup.json to get ordered step definitions
      // Note: paths are relative to the HTML page (public/setup.html), so use ../ to reach root
      const response = await fetch('../components/setup/setup.json');
      const config = await response.json();
      const stepDefs = config.steps;

      // 2. Load the shared module (populates window.__setupState, __setupUtils, etc.)
      await loadScript('../components/setup/modules/_shared.js');

      // 3. Load each step module in order (each pushes itself to window.__setupSteps)
      for (const stepDef of stepDefs) {
        await loadScript(`../components/setup/${stepDef.script}`);
      }

      // 4. Build the wizard DOM
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
      else     { document.body.innerHTML = ''; document.body.appendChild(wizard); }

      // 5. Load settings and wire up navigation
      await window.__setupSettings.loadSettings();

      document.getElementById('setup-next')?.addEventListener('click', () => window.__setupRender.nextStep());
      document.getElementById('setup-back')?.addEventListener('click', () => window.__setupRender.prevStep());
      document.getElementById('setup-finish')?.addEventListener('click', () => window.__setupSettings.collectAndSave());
      document.getElementById('setup-skip')?.addEventListener('click', async () => {
        try {
          await window.__setupSettings.collectAndSave();
        } catch (e) {
          console.error('Skip save failed:', e);
          try {
            await window.electron.setupComplete();
            await window.electron.navigateTo('public/index.html');
          } catch (e2) { console.error('Skip failed:', e2); }
        }
      });

      // 6. Render the first step
      await window.__setupRender.renderStep();
    } catch (e) {
      console.error('Setup bootstrap failed:', e);
      document.body.innerHTML = `<p style="color:red;padding:2rem">Failed to load setup: ${e.message}</p>`;
    }
  });

  // ── Utility: dynamically load a script and wait for it to execute ──────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }

      const script = document.createElement('script');
      script.src   = src;
      script.onload  = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

})();