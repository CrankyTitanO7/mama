// ── Step: Set Up This Project? ───────────────────────────────────────────
// Shows a summary of the choices made on the config step and asks the user
// to commit. "Yes" runs the hands-free auto setup (step-auto.js). "No"
// falls through to the step-by-step developer wizard.
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'confirm',
    title: 'Set Up Project',
    render: () => {
      const U = window.__setupUtils;
      const S = window.__setupState;
      const modeLabel = S.difficulty === 'easy' ? '🌱 Easy (Beginner)'
        : S.difficulty === 'medium' ? '⚡ Medium (Some context)'
        : '🚀 Hard (Just the steps)';
      const folder = S.selectedProjectFolder || 'Not selected yet';

      return `
        <h2>Set Up This Project?</h2>
        <p>Based on your choices, mama will now take care of everything hands-free:</p>
        <ul style="line-height:1.8; margin:0 0 16px">
          <li>🔍 Automatically detect your OS, Python and GPU</li>
          <li>📦 Create a <strong>.venv</strong> virtual environment in your project folder</li>
          <li>⚙️ Install <strong>PyTorch</strong> matched to your hardware (CPU, CUDA, ROCm or MPS)</li>
          <li>💾 Fill in <strong>settings.json</strong> so you can review or edit it later</li>
        </ul>

        <div class="setup-summary-card">
          <div class="setup-summary-row"><span>Mode</span><strong>${U.escapeHtml(modeLabel)}</strong></div>
          <div class="setup-summary-row"><span>Appearance</span><strong>${U.escapeHtml(S.selectedAppearance || 'system')}</strong></div>
          <div class="setup-summary-row"><span>Scaling</span><strong>${U.escapeHtml(String(S.selectedScaling || 1))}</strong></div>
          <div class="setup-summary-row"><span>Language</span><strong>${U.escapeHtml(S.selectedLanguage || 'eng')}</strong></div>
          <div class="setup-summary-row"><span>Project folder</span><strong>${U.escapeHtml(folder)}</strong></div>
        </div>

        <div class="setup-actions-inline">
          <button id="confirm-yes" class="setup-btn setup-btn-success">✓ Yes — Set Everything Up For Me</button>
          <button id="confirm-no" class="setup-btn setup-btn-secondary">No — Configure Step by Step</button>
        </div>
      `;
    },
    afterRender: () => {
      const S = window.__setupState;
      // Once the user has committed to the hands-free installer, the
      // step-by-step modules are gone — only "Yes" is left on this screen.
      const no = document.getElementById('confirm-no');
      if (S.autoCommitted && no) {
        no.style.display = 'none';
        const actions = no.closest('.setup-actions-inline');
        const note = document.createElement('p');
        note.className = 'setup-note';
        note.textContent = 'Hands-free setup was already chosen — you can only retry the auto installer from here.';
        actions?.after(note);
      }
      document.getElementById('confirm-yes')?.addEventListener('click', () => {
        window.__setupRender.startAutoSetup();
      });
      no?.addEventListener('click', () => {
        window.__setupRender.nextStep();
      });
    },
    collect: () => ({})
  });
})();