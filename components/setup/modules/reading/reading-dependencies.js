// ── Reading Module: Python Dependencies ─────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-dependencies',
    title: 'Python Dependencies',
    render: () => `
      <h2>📦 Python Dependencies & pip</h2>
      <div class="reading-module">
        <p><strong>pip</strong> is Python's package installer. It downloads and installs libraries (packages) from the Python Package Index (PyPI) — think of it like an app store for Python code.</p>

        <h3>Key Dependencies mama Uses</h3>
        <ul>
          <li><strong>PyTorch</strong> or <strong>TensorFlow</strong> — The AI framework that does the heavy lifting for training and running models.</li>
          <li><strong>torchvision</strong> / <strong>torchaudio</strong> — PyTorch add-ons for image and audio processing.</li>
          <li><strong>NumPy</strong> — A fundamental library for numerical computations (used behind the scenes).</li>
        </ul>

        <h3>Virtual Environments</h3>
        <p>mama uses <strong>virtual environments (.venv)</strong> to keep your project's dependencies isolated from the rest of your system. This means:</p>
        <ul>
          <li>✅ No conflicts with other Python projects</li>
          <li>✅ Easy to recreate the exact environment later</li>
          <li>✅ Safe to experiment without breaking system tools</li>
        </ul>

        <div class="reading-note">
          <p>💡 <strong>Good news:</strong> mama will handle all of this automatically during setup. You don't need to run pip commands yourself!</p>
        </div>
      </div>
    `
  });
})();