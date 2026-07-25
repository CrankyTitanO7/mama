// ── Step: Difficulty Mode Selector ───────────────────────────────────────
// This step must always be first. It determines whether reading/info modules
// appear throughout the setup process. The difficulty is NOT saved to settings.
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'difficulty',
    title: 'Setup Mode',
    render: () => `
      <h2>Choose Your Setup Mode</h2>
      <p>Select the experience level that's right for you. This only affects whether
         informational reading modules appear during setup — it won't change any settings.</p>
      <div class="difficulty-cards">
        <label class="difficulty-card" id="diff-easy">
          <input type="radio" name="difficulty" value="easy" checked>
          <div class="difficulty-card-content">
            <span class="difficulty-icon">🌱</span>
            <span class="difficulty-title">Easy — Beginner Friendly</span>
            <span class="difficulty-desc">Includes reading modules that explain AI, machine learning,
              Python, and dependencies as you go through setup.</span>
          </div>
        </label>
        <label class="difficulty-card" id="diff-medium">
          <input type="radio" name="difficulty" value="medium">
          <div class="difficulty-card-content">
            <span class="difficulty-icon">⚡</span>
            <span class="difficulty-title">Medium — Some Context</span>
            <span class="difficulty-desc">Shorter explanations focused on why mama needs Python
              and how the app uses it.</span>
          </div>
        </label>
        <label class="difficulty-card" id="diff-hard">
          <input type="radio" name="difficulty" value="hard">
          <div class="difficulty-card-content">
            <span class="difficulty-icon">🚀</span>
            <span class="difficulty-title">Hard — Just the Steps</span>
            <span class="difficulty-desc">No reading modules. Jump straight into the setup process
              with no extra information.</span>
          </div>
        </label>
      </div>
    `,
    afterRender: () => {
      // Store the selected difficulty in state (NOT saved to settings)
      const s = window.__setupState;
      const selected = document.querySelector('input[name="difficulty"]:checked');
      if (selected) s.difficulty = selected.value;

      // Update state on change
      document.querySelectorAll('input[name="difficulty"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          s.difficulty = e.target.value;
        });
      });
    },
    collect: () => {
      // Difficulty is NOT persisted to settings — it's ephemeral for this session only
      return {};
    }
  });
})();