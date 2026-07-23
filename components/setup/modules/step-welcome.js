// ── Step: Welcome ─────────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'welcome',
    title: 'Welcome',
    render: () => `
      <h2>Welcome to mama!</h2>
      <p>Let's get your environment configured. This will only take a moment.</p>
      <p>mama will detect your OS, Python install, and GPU automatically,
         then install the right version of PyTorch or TensorFlow for your hardware.</p>
      <p class="setup-hint">You can revisit these settings anytime from the settings page.</p>
    `
  });
})();