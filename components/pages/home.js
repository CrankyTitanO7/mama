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

/** QoL setting with optional legacy key (pre-widget rename). */
function getQolSetting(key, legacyKey) {
  const val = getSetting('qol settings', key);
  if (val !== undefined) return val;
  if (legacyKey) return getSetting('qol settings', legacyKey);
  return undefined;
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
 * Normalize task manager setting to enabled | disabled | ask.
 * Accepts true/false/"ask" and legacy always/never/disabled/enabled strings.
 */
function resolveTaskManagerMode(raw) {
  if (raw === true || raw === 'true' || raw === 'enabled' || raw === 'always') {
    return 'enabled';
  }
  if (raw === false || raw === 'false' || raw === 'disabled' || raw === 'never') {
    return 'disabled';
  }
  return 'ask';
}

function showTaskManagerPrompt(container) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <div class="task-manager-prompt">
        <p class="task-manager-prompt-text">Enable resource monitoring for this visit?</p>
        <div class="task-manager-prompt-actions">
          <button type="button" class="nav-btn task-manager-enable">Enable</button>
          <button type="button" class="nav-btn task-manager-skip">Not now</button>
        </div>
        <p class="task-manager-prompt-text"><i>You are seeing this because <code>resources</code> is set to "ask" in settings.</i></p>
      </div>
    `;
    container.querySelector('.task-manager-enable')?.addEventListener('click', () => resolve(true));
    container.querySelector('.task-manager-skip')?.addEventListener('click', () => resolve(false));
  });
}

/**
 * Resources box — gated by qol settings → resources (true / false / ask).
 */
async function renderResources() {
  const container = document.getElementById('resources-content');
  if (!container) return;

  const mode = resolveTaskManagerMode(getQolSetting('resources', 'task manager'));

  if (mode === 'disabled') {
    container.innerHTML = disabledMsg('Resource monitoring is disabled in settings.');
    return;
  }

  if (mode === 'ask') {
    const enabled = await showTaskManagerPrompt(container);
    if (!enabled) {
      container.innerHTML = `
        <p class="disabled-msg">Resource monitoring skipped for this visit.</p>
      `;
      return;
    }
  }

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

const FULLSCREEN_MARGIN = 16;
const FULLSCREEN_CLOSE_SIZE = 44;
const FULLSCREEN_CLOSE_GAP = 8;
/** Header row above the panel (close button lives here, inside the stage). */
const FULLSCREEN_HEADER = FULLSCREEN_CLOSE_SIZE + FULLSCREEN_CLOSE_GAP;

function clampStageRect(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(FULLSCREEN_CLOSE_SIZE, Math.min(rect.width, vw - FULLSCREEN_MARGIN * 2));
  const height = Math.max(
    FULLSCREEN_HEADER + 80,
    Math.min(rect.height, vh - FULLSCREEN_MARGIN * 2)
  );
  let top = Math.max(FULLSCREEN_MARGIN, rect.top);
  let left = Math.max(FULLSCREEN_MARGIN, rect.left);
  top = Math.min(top, vh - FULLSCREEN_MARGIN - height);
  left = Math.min(left, vw - FULLSCREEN_MARGIN - width);
  return { top, left, width, height };
}

/**
 * Fullscreen stage rect (panel + header row), centered and clamped inside the window.
 */
function computeFullscreenStageRect(orientation) {
  const maxW = window.innerWidth - FULLSCREEN_MARGIN * 2;
  const maxContentH = window.innerHeight - FULLSCREEN_MARGIN * 2 - FULLSCREEN_HEADER;

  let contentW;
  let contentH;

  if (orientation === 'portrait') {
    contentH = Math.min(maxContentH, (maxW * 16) / 9);
    contentW = (contentH * 9) / 16;
    if (contentW > maxW) {
      contentW = maxW;
      contentH = (contentW * 16) / 9;
    }
  } else {
    contentW = maxW;
    contentH = maxContentH;
  }

  const stageW = contentW;
  const stageH = contentH + FULLSCREEN_HEADER;

  return clampStageRect({
    top: (window.innerHeight - stageH) / 2,
    left: (window.innerWidth - stageW) / 2,
    width: stageW,
    height: stageH,
  });
}

/** Stage rect when animating from the inline embed slot. */
function stageRectFromSlot(slotRect) {
  return clampStageRect({
    top: slotRect.top,
    left: slotRect.left,
    width: slotRect.width,
    height: slotRect.height + FULLSCREEN_HEADER,
  });
}

function applyStageRect(stage, rect) {
  stage.style.top = `${rect.top}px`;
  stage.style.left = `${rect.left}px`;
  stage.style.width = `${rect.width}px`;
  stage.style.height = `${rect.height}px`;
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
  const targetStage = computeFullscreenStageRect(orientation);

  const overlay = document.createElement('div');
  overlay.className = 'embed-fullscreen-overlay';
  overlay.addEventListener('click', () => exitEmbedFullscreen());

  const stage = document.createElement('div');
  stage.className = 'embed-fullscreen-stage';
  stage.addEventListener('click', (e) => e.stopPropagation());

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

  applyStageRect(stage, stageRectFromSlot(startRect));

  panel.appendChild(embed);
  stage.appendChild(closeBtn);
  stage.appendChild(panel);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  document.body.classList.add('embed-fullscreen-active');

  const onKeyDown = onFullscreenKeyDown;
  document.addEventListener('keydown', onKeyDown, true);

  activeFullscreen = { overlay, stage, panel, slot, embed, onKeyDown };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      applyStageRect(stage, targetStage);
    });
  });
}

function exitEmbedFullscreen() {
  if (!activeFullscreen) return;

  const { overlay, stage, panel, slot, embed, onKeyDown } = activeFullscreen;
  document.removeEventListener('keydown', onKeyDown, true);

  const slotRect = slot.getBoundingClientRect();
  applyStageRect(stage, stageRectFromSlot(slotRect));

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

  stage.addEventListener('transitionend', (e) => {
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
    enabled: getQolSetting('site enable', 'video enable'),
    provider: getQolSetting('site provider', 'video provider'),
    label: 'Site',
    errorMessage: 'no site provider specified (change in settings)',
    contentTitle: 'site content',
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
  renderQuickActions();
  // Each widget loads independently — do not await resources (may wait on task-manager prompt).
  void renderResources();
  void renderReels();
  void renderSite();
})();