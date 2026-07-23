// ── Step: Finish ──────────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'finish',
    title: 'Done!',
    render: () => `
      <h2>All Set!</h2>
      <p>Your configuration is complete.</p>
      <p>Click <strong>Finish</strong> to save all settings and start using mama.</p>
      <p class="setup-hint">Everything can be changed later from the settings page.</p>
    `
  });
})();