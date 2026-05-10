// Setup Wizard — runs on first launch
(function () {
  // Step definitions
  const STEPS = [
    {
      id: 'welcome',
      title: 'Welcome to Frank',
      render: () => `
        <h2>Welcome!</h2>
        <p>Let's get your environment configured. This will only take a moment.</p>
        <p>You can revisit these settings anytime from the settings page.</p>
      `
    },
    {
      id: 'language',
      title: 'Language',
      render: (settings) => {
        const lang = settings['general settings']?.language || 'eng';
        return `
          <h2>Language</h2>
          <p>Select your preferred language:</p>
          <select id="setup-language" class="setup-select">
            <option value="eng" ${lang === 'eng' ? 'selected' : ''}>English</option>
            <option value="spa" ${lang === 'spa' ? 'selected' : ''}>Spanish</option>
            <option value="fra" ${lang === 'fra' ? 'selected' : ''}>French</option>
            <option value="deu" ${lang === 'deu' ? 'selected' : ''}>German</option>
            <option value="jpn" ${lang === 'jpn' ? 'selected' : ''}>Japanese</option>
            <option value="zho" ${lang === 'zho' ? 'selected' : ''}>Chinese</option>
          </select>
        `;
      },
      collect: () => document.getElementById('setup-language')?.value || 'eng'
    },
    {
      id: 'appearance',
      title: 'Appearance',
      render: (settings) => {
        const appearance = settings['aesthetic settings']?.appearance || 'dark';
        const accentColors = ['default', 'blue', 'green', 'purple', 'orange', 'red'];
        const accent = settings['aesthetic settings']?.['accent color'] || 'default';
        return `
          <h2>Appearance</h2>
          <div class="setup-field">
            <label>Theme:</label>
            <select id="setup-appearance" class="setup-select">
              <option value="dark" ${appearance === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="light" ${appearance === 'light' ? 'selected' : ''}>Light</option>
            </select>
          </div>
          <div class="setup-field">
            <label>Accent Color:</label>
            <select id="setup-accent" class="setup-select">
              ${accentColors.map(c => `<option value="${c}" ${accent === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="setup-field">
            <label>Scaling Factor:</label>
            <input type="number" id="setup-scaling" class="setup-input" min="0.5" max="3" step="0.25" value="${settings['aesthetic settings']?.['scaling factor'] || 1}">
          </div>
        `;
      },
      collect: () => ({
        appearance: document.getElementById('setup-appearance')?.value || 'dark',
        'accent color': document.getElementById('setup-accent')?.value || 'default',
        'scaling factor': parseFloat(document.getElementById('setup-scaling')?.value) || 1
      })
    },
    {
      id: 'hardware',
      title: 'Hardware Detection',
      render: (settings) => {
        const gpu = settings['hardware settings']?.['graphics manufacturer'] || 'unscanned';
        const targetCard = settings['hardware settings']?.['target card name'] || '';
        return `
          <h2>Hardware</h2>
          <div class="setup-field">
            <label>Graphics Manufacturer:</label>
            <select id="setup-gpu" class="setup-select">
              <option value="unscanned" ${gpu === 'unscanned' ? 'selected' : ''}>Unscanned (auto-detect later)</option>
              <option value="nvidia" ${gpu === 'nvidia' ? 'selected' : ''}>NVIDIA</option>
              <option value="amd" ${gpu === 'amd' ? 'selected' : ''}>AMD</option>
              <option value="undetected" ${gpu === 'undetected' ? 'selected' : ''}>Undetected / Other</option>
            </select>
          </div>
          <div class="setup-field">
            <label>Target GPU Name (optional):</label>
            <input type="text" id="setup-target-gpu" class="setup-input" placeholder="e.g. RTX 4070" value="${targetCard}">
          </div>
          <p class="setup-hint">Hardware detection helps optimize model selection. You can run detailed detection from the settings page later.</p>
        `;
      },
      collect: () => ({
        'graphics manufacturer': document.getElementById('setup-gpu')?.value || 'unscanned',
        'target card name': document.getElementById('setup-target-gpu')?.value || null
      })
    },
    {
      id: 'resources',
      title: 'Resources',
      render: (settings) => {
        const cloudResources = settings['resource settings']?.['cloud resources'] || false;
        const cloudProvider = settings['resource settings']?.['cloud provider name'] || '';
        const localHostname = settings['resource settings']?.['local hostname'] || '';
        return `
          <h2>Resource Configuration</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-cloud" ${cloudResources ? 'checked' : ''}>
              Enable Cloud Resources
            </label>
          </div>
          <div class="setup-field">
            <label>Cloud Provider:</label>
            <input type="text" id="setup-cloud-provider" class="setup-input" placeholder="e.g. openai" value="${cloudProvider}">
          </div>
          <div class="setup-field">
            <label>Local Hostname:</label>
            <input type="text" id="setup-local-host" class="setup-input" placeholder="e.g. ollama" value="${localHostname}">
          </div>
        `;
      },
      collect: () => ({
        'cloud resources': document.getElementById('setup-cloud')?.checked || false,
        'cloud provider name': document.getElementById('setup-cloud-provider')?.value || null,
        'local hostname': document.getElementById('setup-local-host')?.value || null
      })
    },
    {
      id: 'security',
      title: 'Security',
      render: (settings) => {
        const sec = settings['security settings'] || {};
        return `
          <h2>Security Preferences</h2>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-project-mod" ${sec['project mod'] ? 'checked' : ''}>
              Allow file modifications without asking
            </label>
          </div>
          <div class="setup-field">
            <label class="setup-checkbox-label">
              <input type="checkbox" id="setup-browser-access" ${sec['browser access'] ? 'checked' : ''}>
              Allow model/web access
            </label>
          </div>
          <div class="setup-field">
            <label>Local Key File Path:</label>
            <input type="text" id="setup-key-path" class="setup-input" placeholder="default" value="${sec['local key file path'] || 'default'}">
          </div>
        `;
      },
      collect: () => ({
        'project mod': document.getElementById('setup-project-mod')?.checked || false,
        'browser access': document.getElementById('setup-browser-access')?.checked || false,
        'local key file path': document.getElementById('setup-key-path')?.value || 'default'
      })
    },
    {
      id: 'finish',
      title: 'Done!',
      render: () => `
        <h2>All Set!</h2>
        <p>Your basic configuration is complete.</p>
        <p>Click <strong>Finish</strong> to save and start using Frank.</p>
        <p class="setup-hint">You can change any of these settings later from the settings page.</p>
      `
    }
  ];

  let currentStep = 0;
  let settingsCache = null;

  async function loadSettings() {
    try {
      settingsCache = await window.electron.settingsRead();
      if (!settingsCache) {
        // Fallback defaults if no settings file exists
        settingsCache = {
          'general settings': { setup: true, language: 'eng' },
          'aesthetic settings': { appearance: 'dark', 'scaling factor': 1, 'accent color': 'default' },
          'hardware settings': { 'graphics manufacturer': 'unscanned', 'target card name': null },
          'software information': { 'operating system': null, 'OS pretty': null, cmake: false, gcc: false },
          'resource settings': { 'cloud resources': false, 'cloud provider name': null, 'local hostname': null, 'trainer browser': 'default' },
          'security settings': { 'local key file path': 'default', 'project mod': false, 'cloud mod': false, 'all files': false, sudo: false, 'browser access': false },
          'qol settings': { 'reels enable': false, 'reels provider': null, 'video enable': false, 'video provider': null, 'task manager': 'ask', 'database provider': null }
        };
      }
      return settingsCache;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return null;
    }
  }

  async function collectAndSave() {
    if (!settingsCache) return;

    // Collect data from each step
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      if (step.collect) {
        const data = step.collect();
        if (step.id === 'language') {
          settingsCache['general settings'].language = data;
        } else if (step.id === 'appearance') {
          Object.assign(settingsCache['aesthetic settings'], data);
        } else if (step.id === 'hardware') {
          Object.assign(settingsCache['hardware settings'], data);
        } else if (step.id === 'resources') {
          Object.assign(settingsCache['resource settings'], data);
        } else if (step.id === 'security') {
          Object.assign(settingsCache['security settings'], data);
        }
      }
    }

    try {
      await window.electron.settingsWrite(settingsCache);
      await window.electron.setupComplete();
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  function renderStep() {
    const step = STEPS[currentStep];
    if (!step) return;

    const container = document.getElementById('setup-content');
    if (!container) return;

    container.innerHTML = step.render(settingsCache);

    // Update progress indicator
    const progressContainer = document.getElementById('setup-progress');
    if (progressContainer) {
      progressContainer.innerHTML = STEPS.map((s, i) => {
        const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
        return `<span class="progress-dot ${cls}"></span>`;
      }).join('');
    }

    // Update buttons
    const backBtn = document.getElementById('setup-back');
    const nextBtn = document.getElementById('setup-next');
    const finishBtn = document.getElementById('setup-finish');

    if (backBtn) {
      backBtn.style.display = currentStep === 0 ? 'none' : 'inline-block';
    }
    if (nextBtn) {
      nextBtn.style.display = currentStep < STEPS.length - 1 ? 'inline-block' : 'none';
    }
    if (finishBtn) {
      finishBtn.style.display = currentStep === STEPS.length - 1 ? 'inline-block' : 'none';
    }
  }

  async function nextStep() {
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep();
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      renderStep();
    }
  }

  // Initialize setup wizard
  document.addEventListener('DOMContentLoaded', async () => {
    // Create wizard UI
    const app = document.getElementById('setup-app') || document.body;

    const wizard = document.createElement('div');
    wizard.id = 'setup-wizard';
    wizard.innerHTML = `
      <div id="setup-header">
        <h1>Frank Setup</h1>
        <div id="setup-progress"></div>
      </div>
      <div id="setup-content"></div>
      <div id="setup-actions">
        <button id="setup-back" class="setup-btn setup-btn-secondary">← Back</button>
        <button id="setup-next" class="setup-btn setup-btn-primary">Next →</button>
        <button id="setup-finish" class="setup-btn setup-btn-success" style="display:none">✓ Finish</button>
      </div>
    `;

    // If setup-app container exists, put wizard inside it
    const container = document.getElementById('setup-app');
    if (container) {
      container.innerHTML = '';
      container.appendChild(wizard);
    } else {
      document.body.innerHTML = '';
      document.body.appendChild(wizard);
    }

    // Load settings
    await loadSettings();

    // Wire up events
    document.getElementById('setup-next')?.addEventListener('click', nextStep);
    document.getElementById('setup-back')?.addEventListener('click', prevStep);
    document.getElementById('setup-finish')?.addEventListener('click', collectAndSave);

    // Render first step
    renderStep();
  });
})();