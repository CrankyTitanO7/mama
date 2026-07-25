// ── Reading Module: What is Machine Learning? ───────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'reading-ml',
    title: 'What is Machine Learning?',
    render: () => `
      <h2>🧠 What is Machine Learning?</h2>
      <div class="reading-module">
        <p><strong>Machine Learning (ML)</strong> is a subset of AI where computers learn patterns from data rather than following explicit instructions.</p>

        <h3>How ML Works (Simplified)</h3>
        <ol>
          <li><strong>Data</strong> — You provide examples (images, text, numbers).</li>
          <li><strong>Training</strong> — The model adjusts its internal parameters to recognize patterns in the data.</li>
          <li><strong>Inference</strong> — Once trained, the model can make predictions or decisions on new data.</li>
        </ol>

        <h3>Common ML Applications</h3>
        <ul>
          <li>📷 <strong>Image Recognition</strong> — Identifying objects, faces, or scenes in photos</li>
          <li>📝 <strong>Text Generation</strong> — Language models that write, summarize, or translate</li>
          <li>🎵 <strong>Audio Processing</strong> — Speech recognition, music generation</li>
          <li>🎮 <strong>Reinforcement Learning</strong> — Training agents to play games or control robots</li>
        </ul>

        <div class="reading-note">
          <p>💡 <strong>Frameworks like PyTorch and TensorFlow</strong> are the tools that make it easy to build and train ML models. mama will help you install one of these.</p>
        </div>
      </div>
    `
  });
})();