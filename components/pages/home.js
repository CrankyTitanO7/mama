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

/**
 * Reels box — shows reels content if enabled in settings.
 * Uses a BrowserWindow-like embedded view (iframe or IPC bridge).
 */
function renderReels() {
  const container = document.getElementById('reels-content');
  if (!container) return;

  const reelsEnabled  = getSetting('qol settings', 'reels enable');
  const reelsProvider = getSetting('qol settings', 'reels provider');

  if (!reelsEnabled) {
    container.innerHTML = disabledMsg('Reels are disabled in settings.');
    return;
  }

  if (reelsProvider) {
    // Embed the provider content in an iframe (assuming URL-based provider).
    // Future: this could use a dedicated BrowserWindow or webview tag.
    container.innerHTML = `
      <iframe
        class="embed-frame"
        src="${sanitizeUrl(reelsProvider)}"
        frameborder="0"
        allowfullscreen
        title="reels content"
      ></iframe>
    `;
  } else {
    container.innerHTML = disabledMsg('No reels provider configured.');
  }
}

/** True when settings contain a non-empty video provider string. */
function hasVideoProvider(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Mount a mini browser (webview). Must use createElement — innerHTML does not
 * initialize <webview> guests in Electron.
 */
function mountMiniBrowser(container, src, title, iframeFallbackSrc) {
  container.replaceChildren();

  const webview = document.createElement('webview');
  webview.className = 'embed-frame mini-browser';
  webview.title = title;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', src);

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return; // navigation aborted
    console.error('site webview load failed:', event.errorCode, event.validatedURL);
    if (!iframeFallbackSrc || container.querySelector('iframe.site-fallback')) return;
    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = title;
    iframe.setAttribute('src', iframeFallbackSrc);
    container.replaceChildren(iframe);
  });

  container.appendChild(webview);
}

/**
 * Site box — shows video content if enabled in settings.
 * Uses an embedded webview (mini browser) when a provider URL is set;
 * otherwise loads error.html when enabled without a provider.
 */
async function renderSite() {
  const container = document.getElementById('site-content');
  if (!container) return;

  const videoEnabled  = getSetting('qol settings', 'video enable');
  const videoProvider = getSetting('qol settings', 'video provider');

  if (!videoEnabled) {
    container.innerHTML = disabledMsg('Video is disabled in settings.');
    return;
  }

  if (hasVideoProvider(videoProvider)) {
    mountMiniBrowser(
      container,
      normalizeProviderUrl(videoProvider),
      'video content',
      null
    );
    return;
  }

  const errorMessage = 'no video provider specified (change in settings)';
  const iframeFallback = `error.html?error=${encodeURIComponent(errorMessage)}`;
  try {
    const errorUrl = await window.electron.resolvePublicUrl('error.html', {
      error: errorMessage,
    });
    mountMiniBrowser(container, errorUrl, 'video error', iframeFallback);
  } catch (err) {
    console.error('home.js: could not resolve error.html URL', err);
    container.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = 'video error';
    iframe.setAttribute('src', iframeFallback);
    container.appendChild(iframe);
  }
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
  renderReels();
  await renderSite();
})();