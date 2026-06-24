/**
 * Topbar Component
 * Reusable navigation bar for all pages
 */

class Topbar {
  constructor(options = {}) {
    this.currentPage = options.currentPage || 'index';
    this.container = options.container || document.body;
  }

  getNavItems() {
    return [
      { label: '🔧 Setup', page: 'setup.html', key: 'setup' },
      { label: '⚙️ Settings', page: 'settings.html', key: 'settings' },
      { label: 'mission control', page: 'mission_control.html', key: 'mission_control' },
      { label: '✏️ multimodel designer', page: 'multicon.html', key: 'multicon' },
      { label: 'database explorer', page: 'db_explorer.html', key: 'db_explorer' },
      { label: 'export model', page: 'export.html', key: 'export' }
    ];
  }

  getActiveKey() {
    // Map page keys that don't have nav items to their parent section
    const keyMap = {
      'loader': 'mission_control',
      'db_explorer': 'db_explorer',
      'error': 'settings'
    };
    return keyMap[this.currentPage] || this.currentPage;
  }

  render() {
    const navItems = this.getNavItems();
    const activeKey = this.getActiveKey();
    
    const topbarHTML = `
      <div class="topbar">
        <span class="topbar-brand" style="cursor:pointer" data-topbar-nav="public/index.html">mama</span>
        <div class="topbar-nav">
          ${navItems.map(item => `
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

    // Insert at the beginning of body
    this.container.insertAdjacentHTML('afterbegin', topbarHTML);

    this.container.querySelectorAll('[data-topbar-nav]').forEach((el) => {
      el.addEventListener('click', async (event) => {
        event.preventDefault();
        const target = el.getAttribute('data-topbar-nav');
        if (typeof window.handleSettingsNavigation === 'function') {
          await window.handleSettingsNavigation(target);
        } else {
          await window.electron.navigateTo(target);
        }
      });
    });
  }

  static init(currentPage) {
    const topbar = new Topbar({ currentPage });
    topbar.render();
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Topbar;
}

// Also make available globally for non-module usage
window.Topbar = Topbar;