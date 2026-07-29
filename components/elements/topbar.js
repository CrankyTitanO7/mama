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

  static async init(currentPage) {
    const topbar = new Topbar({ currentPage });
    await topbar.render();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Topbar;
}

window.Topbar = Topbar;