class Topbar {
  constructor(options = {}) {
    this.currentPage = options.currentPage || 'index';
    this.container = options.container || document.body;
    this.multimodelMode = true;
  }

  getLeftNavItems() {
    const items = [
      { label: 'project', page: 'project.html', key: 'project' },
      { label: 'multimodel design', page: 'multicon.html', key: 'multicon' },
      { label: 'mission control', page: 'mission_control.html', key: 'mission_control' },
      { label: 'fine tune', page: 'finetune.html', key: 'finetune' },
      { label: 'training', page: 'training.html', key: 'training' },
      { label: 'export', page: 'export.html', key: 'export' }
    ];
    if (!this.multimodelMode) {
      return items.filter(item => item.key !== 'multicon');
    }
    return items;
  }

  getRightNavItems() {
    return [
      { label: 'database', page: 'db_explorer.html', key: 'db_explorer' },
      { label: 'docs', page: 'docs.html', key: 'docs' },
      { label: 'settings', page: 'settings.html', key: 'settings' }
    ];
  }

  getActiveKey() {
    const keyMap = {
      'loader': 'mission_control',
      'error': 'settings',
      'flops': 'training',
    };
    return keyMap[this.currentPage] || this.currentPage;
  }

  navigateTo(page) {
    if (typeof window.handleSettingsNavigation === 'function') {
      window.handleSettingsNavigation(page);
    } else if (window.pywebview && window.pywebview.api) {
      window.pywebview.api.navigate_to(page);
    } else {
      console.error('No pywebview API bridge — cannot navigate to', page);
    }
  }

  navigatePrev() {
    const leftItems = this.getLeftNavItems();
    const activeKey = this.getActiveKey();
    const activeIndex = leftItems.findIndex(item => item.key === activeKey);
    if (activeIndex > 0) {
      this.navigateTo(`public/${leftItems[activeIndex - 1].page}`);
    }
  }

  navigateNext() {
    const leftItems = this.getLeftNavItems();
    const activeKey = this.getActiveKey();
    const activeIndex = leftItems.findIndex(item => item.key === activeKey);
    if (activeIndex >= 0 && activeIndex < leftItems.length - 1) {
      this.navigateTo(`public/${leftItems[activeIndex + 1].page}`);
    }
  }

  async render() {
    try {
      const a = window.pywebview?.api || window.electron;
      if (a && a.projectRecentsRead) {
        const recents = await a.projectRecentsRead();
        if (recents?.open) {
          const projectData = a.projectJsonRead ? await a.projectJsonRead(recents.open) : null;
          if (projectData && projectData.multimodel_mode === false) {
            this.multimodelMode = false;
          }
        }
      }
    } catch (_) {}

    const leftItems = this.getLeftNavItems();
    const rightItems = this.getRightNavItems();
    const activeKey = this.getActiveKey();

    const activeIndex = leftItems.findIndex(item => item.key === activeKey);
    const hasPrev = activeIndex > 0;
    const hasNext = activeIndex >= 0 && activeIndex < leftItems.length - 1;

    const topbarHTML = `
      <div class="topbar">
        <span class="topbar-brand" style="cursor:pointer" data-topbar-nav="public/index.html">mama</span>
        <div class="topbar-nav topbar-nav-left">
          <button class="topbar-arrow ${hasPrev ? '' : 'disabled'}" data-topbar-prev>
            ‹<span class="keybind-hint">⌘,</span>
          </button>
          ${leftItems.map(item => `
            <button
              class="topbar-btn ${activeKey === item.key ? 'active' : ''}"
              data-topbar-nav="public/${item.page}"
            >
              ${item.label}
            </button>
          `).join('')}
          <button class="topbar-arrow ${hasNext ? '' : 'disabled'}" data-topbar-next>
            ›<span class="keybind-hint">⌘.</span>
          </button>
        </div>
        <div class="topbar-nav topbar-nav-right">
          ${rightItems.map(item => `
            <button
              class="topbar-btn ${activeKey === item.key ? 'active' : ''}"
              data-topbar-nav="public/${item.page}"
            >
              ${item.label}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    this.container.insertAdjacentHTML('afterbegin', topbarHTML);

    this.renderModulesButton();

    this.container.querySelectorAll('[data-topbar-nav]').forEach((el) => {
      el.addEventListener('click', async (event) => {
        event.preventDefault();
        this.navigateTo(el.getAttribute('data-topbar-nav'));
      });
    });

    const prevBtn = this.container.querySelector('[data-topbar-prev]');
    const nextBtn = this.container.querySelector('[data-topbar-next]');

    if (prevBtn && hasPrev) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigatePrev();
      });
    }

    if (nextBtn && hasNext) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigateNext();
      });
    }

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        this.navigatePrev();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        this.navigateNext();
      }
    });
  }

  // ── Modules dropdown (axolotl / unsloth) ─────────────────────────────

  _apiBridge() {
    return (window.electron && window.electron.modulesGet) ? window.electron
      : window.pywebview?.api || window.electron;
  }

  async _moduleCall(camel, snake, ...args) {
    const a = this._apiBridge();
    if (!a) return null;
    const fn = a[camel] || a[snake];
    if (typeof fn !== 'function') return null;
    return await fn(...args);
  }

  _moduleEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _moduleItemHtml(m) {
    const esc = (v) => this._moduleEscape(v);
    const platformLabel = m.platform === 'native_windows' ? 'Windows' : (m.platform || 'this system');
    let badge = 'not installed';
    let badgeClass = 'module-badge-missing';
    if (!m.supported) { badge = 'not supported'; badgeClass = 'module-badge-unsupported'; }
    else if (m.installed) { badge = 'installed'; badgeClass = 'module-badge-installed'; }

    const actions = m.supported ? `
      <div class="module-actions">
        <button type="button" class="modules-btn modules-btn-primary" data-module-action="install">${m.installed ? 'reinstall' : 'install'}</button>
        <button type="button" class="modules-btn" data-module-action="uninstall"${m.installed ? '' : ' disabled'}>uninstall</button>
        <button type="button" class="modules-btn modules-btn-ghost" data-module-steps-toggle>steps ▾</button>
      </div>` : `
      <div class="module-unsupported">${esc(m.unsupported_reason)}</div>`;

    const stepGroup = (label, steps, action) => `
      <div class="module-steps-group">
        <div class="module-steps-group-head">
          <span>${label}</span>
          <button type="button" class="modules-btn modules-btn-mini" data-module-run-all="${action}">run all</button>
        </div>
        <ol class="module-steps-list">
          ${steps.map((step, i) => `
            <li>
              <code>${esc(step)}</code>
              <button type="button" class="modules-run-step" data-module-run-step="${action}" data-module-step-index="${i}" title="run this step">run</button>
            </li>`).join('')}
        </ol>
      </div>`;

    const stepsSections = m.supported ? `
      <div class="module-steps" hidden>
        ${stepGroup('install steps', m.install_steps || [], 'install')}
        ${stepGroup('uninstall steps', m.uninstall_steps || [], 'uninstall')}
      </div>` : '';

    return `
      <div class="module-item" data-module="${esc(m.key)}">
        <div class="module-item-head">
          <div class="module-title-row">
            <span class="module-name">${esc(m.name)}</span>
            <span class="module-badge ${badgeClass}">${badge}</span>
          </div>
          <div class="module-desc">${esc(m.description)}</div>
          <div class="module-platform-line">${esc(m.platforms.join(', '))} · running on ${esc(platformLabel)}</div>
        </div>
        ${stepsSections}
      </div>`;
  }

  renderModulesButton() {
    if (this._modulesMounted) return;
    this._modulesMounted = true;

    const rightNav = this.container.querySelector('.topbar-nav-right');
    if (!rightNav) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'topbar-btn topbar-btn-modules';
    btn.textContent = 'modules ▾';
    rightNav.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'topbar-modules-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="topbar-modules-panel-head">
        <span class="topbar-modules-title">modules</span>
        <button type="button" class="topbar-modules-close" title="close">×</button>
      </div>
      <div class="topbar-modules-list"></div>
      <div class="topbar-modules-log" hidden>
        <div class="topbar-modules-log-head">
          <span>output</span>
          <button type="button" class="topbar-modules-log-clear" title="clear">clear</button>
        </div>
        <div class="topbar-modules-log-body"><pre></pre></div>
      </div>
      <div class="topbar-modules-foot">
        <span class="topbar-modules-platform"></span>
        <button type="button" class="topbar-modules-refresh" title="refresh status">↻ refresh</button>
      </div>`;
    rightNav.appendChild(panel);

    const close = () => {
      panel.hidden = true;
      btn.classList.remove('active');
    };
    const open = async () => {
      panel.hidden = false;
      btn.classList.add('active');
      await this.loadModulesPanel(panel);
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    panel.querySelector('.topbar-modules-close').addEventListener('click', close);
    panel.querySelector('.topbar-modules-refresh').addEventListener('click', () => this.loadModulesPanel(panel));
    panel.querySelector('.topbar-modules-log-clear').addEventListener('click', () => {
      const log = panel.querySelector('.topbar-modules-log');
      if (log) {
        log.querySelector('pre').textContent = '';
        log.hidden = true;
      }
    });

    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    this._modulesPanel = panel;
  }

  async loadModulesPanel(panel) {
    const listEl = panel.querySelector('.topbar-modules-list');
    listEl.innerHTML = '<div class="topbar-modules-loading">checking modules…</div>';
    this._ensureModuleStream(panel);
    try {
      const data = await this._moduleCall('modulesGet', 'modules_get');
      if (!data || !data.modules) {
        listEl.innerHTML = '<div class="topbar-modules-loading">modules unavailable — bridge not connected.</div>';
        return;
      }
      const platformEl = panel.querySelector('.topbar-modules-platform');
      if (platformEl) platformEl.textContent = `platform: ${data.platform || 'unknown'}`;
      listEl.innerHTML = data.modules.map((m) => this._moduleItemHtml(m)).join('');
      this._wireModuleItems(panel);
    } catch (err) {
      listEl.innerHTML = '<div class="topbar-modules-loading">error loading modules: ' + this._moduleEscape(err && err.message || err) + '</div>';
    }
  }

  _wireModuleItems(panel) {
    const items = panel.querySelectorAll('[data-module]');
    items.forEach((item) => {
      const key = item.getAttribute('data-module');
      const setBusy = (busy) => {
        item.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
        item.dataset.busy = busy ? '1' : '0';
      };

      item.querySelectorAll('[data-module-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (item.dataset.busy === '1') return;
          setBusy(true);
          this.runModuleAction(panel, key, btn.getAttribute('data-module-action')).finally(() => setBusy(false));
        });
      });
      item.querySelectorAll('[data-module-run-all]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (item.dataset.busy === '1') return;
          setBusy(true);
          this.runModuleAction(panel, key, btn.getAttribute('data-module-run-all')).finally(() => setBusy(false));
        });
      });
      item.querySelectorAll('[data-module-run-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (item.dataset.busy === '1') return;
          setBusy(true);
          this.runModuleStep(panel, key, btn.getAttribute('data-module-run-step'), Number(btn.getAttribute('data-module-step-index')), () => setBusy(false));
        });
      });
      const toggle = item.querySelector('[data-module-steps-toggle]');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const steps = item.querySelector('.module-steps');
          if (!steps) return;
          steps.hidden = !steps.hidden;
          toggle.textContent = steps.hidden ? 'steps ▾' : 'steps ▴';
        });
      }
    });
  }

  _ensureModuleStream(panel) {
    if (this._moduleStreamBound) return;
    this._moduleStreamBound = true;
    const a = this._apiBridge();
    if (a && typeof a.onModuleProgress === 'function') {
      a.onModuleProgress((chunk) => {
        chunk = chunk || {};
        const log = panel.querySelector('.topbar-modules-log');
        if (!log) return;
        if (chunk.type === 'meta') {
          this.appendModuleLog(log, chunk.text, 'log-meta');
        } else if (chunk.type === 'log') {
          this.appendModuleLog(log, chunk.text, '');
        } else if (chunk.type === 'error') {
          this.appendModuleLog(log, '! ' + chunk.text, 'log-err');
        } else if (chunk.type === 'done') {
          this.appendModuleLog(log, chunk.success ? '» done.' : '» failed.', chunk.success ? 'log-ok' : 'log-err');
        }
      });
    }
  }

  appendModuleLog(log, text, cls) {
    if (!log) return;
    log.hidden = false;
    const pre = log.querySelector('pre');
    if (!pre) return;
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    pre.appendChild(span);
    pre.appendChild(document.createTextNode('\n'));
    while (pre.childNodes.length > 600) pre.removeChild(pre.firstChild);
    const body = log.querySelector('.topbar-modules-log-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  async runModuleAction(panel, key, action) {
    const log = panel.querySelector('.topbar-modules-log');
    this.appendModuleLog(log, `$ ${action} ${key}`, 'log-meta');
    const res = await this._moduleCall(action === 'install' ? 'modulesInstall' : 'modulesUninstall', action === 'install' ? 'modules_install' : 'modules_uninstall', key);
    if (res && !res.success) this.appendModuleLog(log, '! ' + (res.error || 'failed'), 'log-err');
    await this.loadModulesPanel(panel);
  }

  async runModuleStep(panel, key, action, index) {
    const log = panel.querySelector('.topbar-modules-log');
    this.appendModuleLog(log, `$ run ${action} step #${index} of ${key}`, 'log-step');
    const res = await this._moduleCall('modulesRunStep', 'modules_run_step', key, action, String(index));
    if (res && !res.success) this.appendModuleLog(log, '! ' + (res.error || 'failed'), 'log-err');
    await this.loadModulesPanel(panel);
  }

  static async init(currentPage) {
    const topbar = new Topbar({ currentPage });
    await topbar.render();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Topbar;
}

window.Topbar = Topbar;