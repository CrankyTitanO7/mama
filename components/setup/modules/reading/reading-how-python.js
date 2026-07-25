// ── Reading Module: How mama Uses Python (Medium mode) ─────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-how-python',
    title: 'How mama Uses Python',
    render: () => `
      <h2>⚙️ How mama Uses Python</h2>
      <div class="reading-module">
        <p>mama uses Python behind the scenes to power its AI features. Here's how it all fits together:</p>

        <h3>The Architecture</h3>
        <ul>
          <li><strong>Electron (JavaScript)</strong> — Handles the user interface, windows, and file system operations.</li>
          <li><strong>Python Bridge</strong> — mama spawns Python processes to run AI-related tasks, communicating results back to the UI.</li>
          <li><strong>AI Framework</strong> — PyTorch or TensorFlow does the actual model training and inference.</li>
        </ul>

        <h3>What Python Does in mama</h3>
        <ul>
          <li>🔍 <strong>System Detection</strong> — Checks your OS, Python version, GPU, and hardware compatibility</li>
          <li>📦 <strong>Package Management</strong> — Installs and manages AI frameworks and their dependencies</li>
          <li>🧠 <strong>Model Training</strong> — Runs the training loops that teach AI models</li>
          <li>⚡ <strong>Inference</strong> — Runs trained models to make predictions</li>
        </ul>

        <div class="reading-note">
          <p>💡 <strong>You don't need to write any Python code.</strong> mama handles all the Python interactions automatically through its setup wizard and backend.</p>
        </div>
      </div>
    `
  });
})();