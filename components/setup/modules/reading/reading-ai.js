// ── Reading Module: What is AI? ──────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-ai',
    title: 'What is AI?',
    render: () => `
      <h2>🤖 What is Artificial Intelligence?</h2>
      <div class="reading-module">
        <p><strong>AI</strong> (Artificial Intelligence) is a broad field of computer science focused on creating systems that can perform tasks that normally require human intelligence.</p>

        <h3>Key Concepts</h3>
        <ul>
          <li><strong>AI</strong> — The overarching field. Think of it as the science of making machines smart.</li>
          <li><strong>Machine Learning (ML)</strong> — A subset of AI where machines learn from data instead of being explicitly programmed.</li>
          <li><strong>Deep Learning</strong> — A subset of ML using neural networks with many layers (hence "deep"). This is what powers modern image recognition, language models, and more.</li>
        </ul>

        <h3>How mama Uses AI</h3>
        <p>mama helps you train and run AI models locally on your own hardware. Instead of sending your data to the cloud, you keep everything on your machine — giving you full control, privacy, and the ability to experiment freely.</p>

        <div class="reading-note">
          <p>💡 <strong>Don't worry</strong> — you don't need to be an AI expert to use mama. The app handles the complex parts so you can focus on creating.</p>
        </div>
      </div>
    `
  });
})();