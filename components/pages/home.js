/**
 * home.js — Front-end controller for public/index.html
 *
 * Handles dynamic content for the home page flex-box layout:
 *  - status:        terminal output / model learning visualization
 *  - resources:     top tasks / resource consumption (if enabled in settings)
 *  - quick actions: pause/play, cancel, open folder
 *  - reels:         embedded BrowserWindow content (if enabled in settings)
 *  - site:          embedded BrowserWindow content (if enabled in settings)
 *
 * This script is loaded by public/index.html via <script> tag.
 * Communicates with main process through window.electron IPC.
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let settings = null;

// ── Utility ───────────────────────────────────────────────────────────────────

/** Safely query a nested key from settings, returning fallback if missing. */
function getSetting(...keys) {
  let obj = settings;
  for (const key of keys) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[key];
  }
  return obj;
}

/**
 * Generate disabled message with "enable?" link that navigates to settings.
 */
function disabledMsg(text) {
  return `<p class="disabled-msg">${text} <a href="#" onclick="event.preventDefault(); window.electron.navigateTo('public/settings.html')">enable?</a></p>`;
}

// ── Box renderers ─────────────────────────────────────────────────────────────

/**
 * Status box — placeholder for terminal output / model learning visualization.
 * Future: this could stream logs from a running training process via IPC.
 */
function renderStatus() {
  const container = document.getElementById('status-content');
  if (!container) return;

  // Static placeholder for now. In the future this will be populated
  // by IPC events emitting model training logs / loss curves.
  container.innerHTML = `
    <div class="status-placeholder">
      <p>No active training session.</p>
      <p class="status-hint">Start a training job to see live output here.</p>
    </div>
  `;
}

/**
 * Resources box — shows top tasks / resource consumption
 * (only if enabled in settings → qol settings → task manager != "disabled").
 */
function renderResources() {
  const container = document.getElementById('resources-content');
  if (!container) return;

  const taskManager = getSetting('qol settings', 'task manager');

  if (!taskManager || taskManager === 'disabled') {
    container.innerHTML = disabledMsg('Resource monitoring is disabled in settings.');
    return;
  }

  // Load the btop-like resource widget
  if (typeof initResourcesWidget === 'function') {
    initResourcesWidget(container);
  } else {
    container.innerHTML = `<p class="disabled-msg">Resources widget not loaded.</p>`;
  }
}

/**
 * Quick actions box — pause/play, cancel, open folder buttons.
 * Buttons are already present in the HTML; this wires up click handlers.
 */
function renderQuickActions() {
  const container = document.getElementById('quick-actions-content');
  if (!container) return;

  // Buttons are static in HTML, but we can add dynamic wiring here.
  // Example: attach IPC calls to each button.
  const pausePlayBtn = container.querySelector('.qa-pause-play');
  const cancelBtn    = container.querySelector('.qa-cancel');
  const openFolderBtn = container.querySelector('.qa-open-folder');

  if (pausePlayBtn) {
    pausePlayBtn.addEventListener('click', () => {
      // Future: IPC call to pause/resume the current training job.
      console.log('pause/play toggled');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      // Future: IPC call to cancel the current training job.
      console.log('cancel requested');
    });
  }

  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      // Future: IPC call to open the project folder in file explorer.
      console.log('open folder requested');
    });
  }
}

/** True when settings contain a non-empty provider URL string. */
function hasProviderUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Embed fullscreen (site = landscape, reels = portrait) ─────────────────────

let activeFullscreen = null;

function computeFullscreenTarget(orientation) {
  const margin = 24;

  if (orientation === 'portrait') {
    const maxH = window.innerHeight - margin * 2;
    const maxW = window.innerWidth - margin * 2;
    let height = Math.min(maxH, (maxW * 16) / 9);
    let width = (height * 9) / 16;
    if (width > maxW) {
      width = maxW;
      height = (width * 16) / 9;
    }
    return {
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      borderRadius: 20,
    };
  }

  const width = window.innerWidth - margin * 2;
  const height = window.innerHeight - margin * 2;
  return {
    top: (window.innerHeight - height) / 2,
    left: (window.innerWidth - width) / 2,
    width,
    height,
    borderRadius: 20,
  };
}

function applyPanelRect(panel, rect) {
  panel.style.top = `${rect.top}px`;
  panel.style.left = `${rect.left}px`;
  panel.style.width = `${rect.width}px`;
  panel.style.height = `${rect.height}px`;
  panel.style.borderRadius = `${rect.borderRadius}px`;
}

function onFullscreenKeyDown(event) {
  if (event.key === 'Escape' && event.shiftKey) {
    event.preventDefault();
    exitEmbedFullscreen();
  }
}

function enterEmbedFullscreen(widgetRoot) {
  if (activeFullscreen) return;

  const slot = widgetRoot.querySelector('.embed-widget-slot');
  const embed = slot?.firstElementChild;
  if (!embed) return;

  const startRect = embed.getBoundingClientRect();
  const orientation = widgetRoot.dataset.orientation || 'landscape';
  const target = computeFullscreenTarget(orientation);

  const overlay = document.createElement('div');
  overlay.className = 'embed-fullscreen-overlay';

  const panel = document.createElement('div');
  panel.className = 'embed-fullscreen-panel';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'embed-fullscreen-close';
  closeBtn.setAttribute('aria-label', 'Exit fullscreen');
  closeBtn.title = 'Exit fullscreen';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exitEmbedFullscreen();
  });

  applyPanelRect(panel, {
    top: startRect.top,
    left: startRect.left,
    width: startRect.width,
    height: startRect.height,
    borderRadius: 8,
  });

  panel.appendChild(embed);
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.classList.add('embed-fullscreen-active');

  const onKeyDown = onFullscreenKeyDown;
  document.addEventListener('keydown', onKeyDown, true);

  activeFullscreen = { overlay, panel, slot, embed, closeBtn, onKeyDown };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      applyPanelRect(panel, target);
    });
  });
}

function exitEmbedFullscreen() {
  if (!activeFullscreen) return;

  const { overlay, panel, slot, embed, onKeyDown } = activeFullscreen;
  document.removeEventListener('keydown', onKeyDown, true);

  const slotRect = slot.getBoundingClientRect();
  applyPanelRect(panel, {
    top: slotRect.top,
    left: slotRect.left,
    width: slotRect.width,
    height: slotRect.height,
    borderRadius: 8,
  });

  overlay.classList.remove('is-visible');

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (embed) slot.appendChild(embed);
    overlay.remove();
    document.body.classList.remove('embed-fullscreen-active');
    activeFullscreen = null;
  };

  panel.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width') finish();
  }, { once: true });

  setTimeout(finish, 480);
}

function initEmbedFullscreen(widgetRoot) {
  const fsBtn = widgetRoot.querySelector('.embed-fullscreen-btn');
  const slot = widgetRoot.querySelector('.embed-widget-slot');

  fsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterEmbedFullscreen(widgetRoot);
  });

  slot?.addEventListener('dblclick', () => {
    enterEmbedFullscreen(widgetRoot);
  });
}

/**
 * Wrap embed in chrome with fullscreen control.
 * @param {'landscape'|'portrait'} orientation
 */
function createEmbedWidget(embedEl, orientation) {
  const root = document.createElement('div');
  root.className = 'embed-widget';
  root.dataset.orientation = orientation;

  const toolbar = document.createElement('div');
  toolbar.className = 'embed-widget-toolbar';

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'embed-fullscreen-btn';
  fsBtn.title = 'Fullscreen';
  fsBtn.setAttribute('aria-label', 'Enter fullscreen');
  fsBtn.textContent = '⛶';

  const slot = document.createElement('div');
  slot.className = 'embed-widget-slot';
  slot.appendChild(embedEl);

  toolbar.appendChild(fsBtn);
  root.appendChild(toolbar);
  root.appendChild(slot);

  initEmbedFullscreen(root);
  return root;
}

/**
 * Mount a mini browser (webview). Must use createElement — innerHTML does not
 * initialize <webview> guests in Electron.
 */
function mountMiniBrowser(container, src, title, iframeFallbackSrc, orientation) {
  container.replaceChildren();

  const webview = document.createElement('webview');
  webview.className = 'embed-frame mini-browser';
  webview.title = title;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', src);

  const widget = createEmbedWidget(webview, orientation);

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return;
    console.error('embed webview load failed:', event.errorCode, event.validatedURL);
    if (!iframeFallbackSrc) return;

    const slot = widget.querySelector('.embed-widget-slot');
    if (!slot || slot.querySelector('iframe.site-fallback')) return;

    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = title;
    iframe.setAttribute('src', iframeFallbackSrc);
    slot.replaceChildren(iframe);
  });

  container.appendChild(widget);
}

/**
 * Shared QoL embed widget (site/video and reels use the same logic).
 * Portrait vs landscape only affects fullscreen dimensions.
 */
async function renderQolEmbed(container, {
  enabled,
  provider,
  label,
  errorMessage,
  contentTitle,
  orientation,
}) {
  if (!enabled) {
    container.innerHTML = disabledMsg(`${label} is disabled in settings.`);
    return;
  }

  if (hasProviderUrl(provider)) {
    mountMiniBrowser(
      container,
      normalizeProviderUrl(provider),
      contentTitle,
      null,
      orientation
    );
    return;
  }

  const iframeFallback = `error.html?error=${encodeURIComponent(errorMessage)}`;
  try {
    const errorUrl = await window.electron.resolvePublicUrl('error.html', {
      error: errorMessage,
    });
    mountMiniBrowser(
      container,
      errorUrl,
      `${contentTitle} error`,
      iframeFallback,
      orientation
    );
  } catch (err) {
    console.error(`home.js: could not resolve error.html for ${label}`, err);
    container.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = `${contentTitle} error`;
    iframe.setAttribute('src', iframeFallback);
    container.appendChild(createEmbedWidget(iframe, orientation));
  }
}

async function renderReels() {
  const container = document.getElementById('reels-content');
  if (!container) return;

  await renderQolEmbed(container, {
    enabled: getSetting('qol settings', 'reels enable'),
    provider: getSetting('qol settings', 'reels provider'),
    label: 'Reels',
    errorMessage: 'no reels provider specified (change in settings)',
    contentTitle: 'reels content',
    orientation: 'portrait',
  });
}

async function renderSite() {
  const container = document.getElementById('site-content');
  if (!container) return;

  await renderQolEmbed(container, {
    enabled: getSetting('qol settings', 'video enable'),
    provider: getSetting('qol settings', 'video provider'),
    label: 'Video',
    errorMessage: 'no video provider specified (change in settings)',
    contentTitle: 'video content',
    orientation: 'landscape',
  });
}

// ── Sanitize URL helper ───────────────────────────────────────────────────────

/**
 * Basic URL sanitizer to prevent XSS via iframe src.
 * Only allows http/https URLs. Returns 'about:blank' for invalid input.
 */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return 'about:blank';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return 'about:blank';
}

/** Normalize video provider to a loadable http(s) URL. */
function normalizeProviderUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return 'about:blank';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Escape a string for use inside an HTML attribute value. */
function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    settings = await window.electron.settingsRead();
  } catch (err) {
    console.error('home.js: failed to read settings', err);
  }

  renderStatus();
  renderResources();
  renderQuickActions();
  await renderReels();
  await renderSite();
})();