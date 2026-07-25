// ── Reading Module: What is Python? ─────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-python',
    title: 'What is Python?',
    render: () => `
      <h2>🐍 What is Python?</h2>
      <div class="reading-module">
        <p><strong>Python</strong> is a programming language that's widely used in AI, data science, and web development. It's known for being easy to read and write, which makes it a favorite among beginners and experts alike.</p>

        <h3>Why Python for AI?</h3>
        <ul>
          <li><strong>Rich Ecosystem</strong> — Python has thousands of libraries for math, science, and AI (like PyTorch, TensorFlow, NumPy, and more).</li>
          <li><strong>Community</strong> — Most AI research and tools are built in Python first, so you get the latest innovations quickly.</li>
          <li><strong>Simplicity</strong> — Python code reads almost like English, making it easier to understand what's happening under the hood.</li>
        </ul>

        <h3>Python Versions</h3>
        <p>mama requires <strong>Python 3.8 or higher</strong>. Python 2 is no longer supported. If you don't have Python installed, the setup will guide you through it.</p>

        <div class="reading-note">
          <p>💡 <strong>Don't worry if you've never used Python before.</strong> mama handles all the Python-related tasks for you — you just need it installed on your system.</p>
        </div>
      </div>
    `
  });
})();