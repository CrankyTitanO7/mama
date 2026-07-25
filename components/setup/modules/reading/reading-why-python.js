// ── Reading Module: Why mama Needs Python (Medium mode) ────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-why-python',
    title: 'Why Python?',
    render: () => `
      <h2>🔧 Why Does mama Need Python?</h2>
      <div class="reading-module">
        <p>mama is built on <strong>Electron</strong> (JavaScript) for the user interface, but the core AI functionality relies on <strong>Python</strong> for a few key reasons:</p>

        <h3>1. AI Frameworks are Python-First</h3>
        <p>The two main AI frameworks — <strong>PyTorch</strong> and <strong>TensorFlow</strong> — are primarily developed for Python. While they have other language bindings, Python offers the most complete and up-to-date support.</p>

        <h3>2. Scientific Computing Ecosystem</h3>
        <p>Python has a mature ecosystem of scientific computing libraries (NumPy, SciPy, etc.) that AI frameworks depend on. These libraries are highly optimized C/C++ under the hood, but exposed through a convenient Python interface.</p>

        <h3>3. Industry Standard</h3>
        <p>Python is the <em>lingua franca</em> of AI research and development. By using Python, mama ensures compatibility with the latest models, tools, and community resources.</p>

        <div class="reading-note">
          <p>💡 <strong>In short:</strong> Python acts as the bridge between mama's user interface and the powerful AI engines that do the actual work.</p>
        </div>
      </div>
    `
  });
})();