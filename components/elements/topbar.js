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
      { label: 'fine-tune', page: 'finetune.html', key: 'finetune' },
      { label: 'training', page: 'training.html', key: 'training' },
      { label: 'project', page: 'project.html', key: 'project' },
      { label: 'mission control', page: 'mission_control.html', key: 'mission_control' },
      { label: 'export model', page: 'export.html', key: 'export' },
      { label: '✏️ designer', page: 'multicon.html', key: 'multicon' },
      { label: 'database', page: 'db_explorer.html', key: 'db_explorer' }
    ];
  }

  /**
   * Items that appear at the right end of the topbar.
   */
  getRightNavItems() {
    return [
      { label: 'docs', page: 'docs.html', key: 'docs' }, 
      { label: '⚙️ Settings', page: 'settings.html', key: 'settings' }, 
    ];
  }

  getActiveKey() {
    // Map page keys that don't have nav items to their parent section
    const keyMap = {
      'loader': 'mission_control',
      'db_explorer': 'db_explorer',
      'error': 'settings',
      'finetune': 'finetune',
      'training': 'training',
    };
    return keyMap[this.currentPage] || this.currentPage;
  }

  render() {
    const navItems = this.getNavItems();
    const rightNavItems = this.getRightNavItems();
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
        <div class="topbar-nav topbar-nav-right">
          ${rightNavItems.map(item => `
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
        } else if (window.pywebview && window.pywebview.api) {
          await window.pywebview.api.navigate_to(target);
        } else {
          console.error('No pywebview API bridge — cannot navigate to', target);
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