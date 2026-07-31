// ── Step: Language ────────────────────────────────────────────────────────
(function () {
  if (!window.__setupSteps) window.__setupSteps = [];
  window.__setupSteps.push({
    id: 'language',
    title: 'Language',
    render: (settings) => {
      const lang = settings['general settings']?.language || 'eng';
      const langs = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'],
        ['deu', 'German'],  ['jpn', 'Japanese'],['zho', 'Chinese'],
      ];
      return `
        <h2>Language</h2>
        <p>Select your preferred language:</p>
        <p>in development: only english available currently</p>
        <select id="setup-language" class="setup-select">
          ${langs.map(([v, l]) => `<option value="${v}" ${lang === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      `;
    },
    collect: () => document.getElementById('setup-language')?.value || 'eng'
  });
})();