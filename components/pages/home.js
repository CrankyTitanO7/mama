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

  // Placeholder for live resource consumption data.
  // Future: subscribe to IPC events for CPU/RAM/GPU usage.
  container.innerHTML = `
    <div class="resources-placeholder">
      <div class="resource-row"><span class="resource-label">CPU</span><span class="resource-value">—</span></div>
      <div class="resource-row"><span class="resource-label">RAM</span><span class="resource-value">—</span></div>
      <div class="resource-row"><span class="resource-label">GPU</span><span class="resource-value">—</span></div>
    </div>
  `;
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

/**
 * Site box — shows video content if enabled in settings.
 * Uses a BrowserWindow-like embedded view (iframe or IPC bridge).
 */
function renderSite() {
  const container = document.getElementById('site-content');
  if (!container) return;

  const videoEnabled  = getSetting('qol settings', 'video enable');
  const videoProvider = getSetting('qol settings', 'video provider');

  if (!videoEnabled) {
    container.innerHTML = disabledMsg('Video is disabled in settings.');
    return;
  }

  if (videoProvider) {
    // Embed the provider content in an iframe.
    // Future: this could use a dedicated BrowserWindow or webview tag.
    container.innerHTML = `
      <iframe
        class="embed-frame"
        src="${sanitizeUrl(videoProvider)}"
        frameborder="0"
        allowfullscreen
        title="video content"
      ></iframe>
    `;
  } else {
    container.innerHTML = disabledMsg('No video provider configured.');
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
  renderSite();
})();