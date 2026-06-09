/**
 * db_explorer.js — Front-end controller for public/db_explorer.html
 *
 * Handles embedded browser content for the Database Explorer page.
 * Loads the URL from qol settings → database provider (if enabled).
 * Follows the same pattern as reels and site embeds in home.js.
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

/** QoL setting with optional legacy key. */
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

/** True when settings contain a non-empty provider URL string. */
function hasProviderUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Embed fullscreen ──────────────────────────────────────────────────────────

let activeFullscreen = null;

const FULLSCREEN_MARGIN = 16;
const FULLSCREEN_CLOSE_SIZE = 44;
const FULLSCREEN_CLOSE_GAP = 8;
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
 * Wrap embed in chrome with fullscreen and mute controls.
 * @param {'landscape'|'portrait'} orientation
 */
function createEmbedWidget(embedEl, orientation) {
  const root = document.createElement('div');
  root.className = 'embed-widget';
  root.dataset.orientation = orientation;
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.flex = '1';
  root.style.height = '100%';     // fills container when parent is not a flex context
  root.style.minHeight = '0';
  root.style.overflow = 'hidden';

  const toolbar = document.createElement('div');
  toolbar.className = 'embed-widget-toolbar';
  toolbar.style.flexShrink = '0';

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'embed-mute-btn';
  muteBtn.title = 'Mute';
  muteBtn.setAttribute('aria-label', 'Mute');
  muteBtn.textContent = '🔊';

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'embed-fullscreen-btn';
  fsBtn.title = 'Fullscreen';
  fsBtn.setAttribute('aria-label', 'Enter fullscreen');
  fsBtn.textContent = '⛶';

  const slot = document.createElement('div');
  slot.className = 'embed-widget-slot';
  slot.style.flex = '1';
  slot.style.minHeight = '0';
  slot.style.display = 'flex';
  slot.style.flexDirection = 'column';
  slot.appendChild(embedEl);

  toolbar.appendChild(muteBtn);
  toolbar.appendChild(fsBtn);
  root.appendChild(toolbar);
  root.appendChild(slot);

  initEmbedFullscreen(root);
  initMuteButton(root, embedEl, muteBtn);
  return root;
}

/**
 * Wire up the mute button to toggle audio on the embedded webview/iframe.
 */
function initMuteButton(widgetRoot, embedEl, muteBtn) {
  let isMuted = false;

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;

    // For webview elements, use setAudioMuted
    if (embedEl && typeof embedEl.setAudioMuted === 'function') {
      embedEl.setAudioMuted(isMuted);
    }

    // Update button appearance
    muteBtn.textContent = isMuted ? '🔇' : '🔊';
    muteBtn.title = isMuted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', isMuted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('is-muted', isMuted);
  });
}

/**
 * Mount a mini browser (webview). Must use createElement — innerHTML does not
 * initialize <webview> guests in Electron.
 */
function mountMiniBrowser(container, src, title, iframeFallbackSrc, orientation, partitionName) {
  // Ensure the container itself forms a full-height flex column.
  // Without this, flex:1 on the embed widget has nothing to stretch against
  // and the webview collapses to its intrinsic (near-zero) height.
  Object.assign(container.style, {
    display:       'flex',
    flexDirection: 'column',
    flex:          '1',
    height:        '100%',
    minHeight:     '0',
    overflow:      'hidden',
  });

  container.replaceChildren();

  const webview = document.createElement('webview');
  webview.className = 'embed-frame mini-browser';
  webview.title = title;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', src);
  // In a flex column, flex:1 + align-self:stretch fills available space.
  // height:100% alone doesn't work inside a flex container whose height
  // is determined by its children — it creates a circular dependency.
  webview.style.flex        = '1';
  webview.style.alignSelf   = 'stretch';
  webview.style.width       = '100%';
  webview.style.minHeight   = '0';
  webview.style.display     = 'flex';

  // Persistent partition keeps cookies/auth across app restarts
  if (partitionName) {
    webview.setAttribute('partition', `persist:${partitionName}`);
  }

  const widget = createEmbedWidget(webview, orientation);

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return; // Aborted, ignore
    console.error('embed webview load failed:', event.errorCode, event.validatedURL);
    if (!iframeFallbackSrc) return;

    const slot = widget.querySelector('.embed-widget-slot');
    if (!slot || slot.querySelector('iframe.site-fallback')) return;

    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = title;
    iframe.setAttribute('src', iframeFallbackSrc);
    iframe.style.flex      = '1';
    iframe.style.alignSelf = 'stretch';
    iframe.style.width     = '100%';
    iframe.style.minHeight = '0';
    iframe.style.border    = 'none';
    slot.replaceChildren(iframe);
  });

  container.appendChild(widget);
}

/**
 * Shared QoL embed widget for database explorer.
 * Uses landscape orientation like site/video.
 */
async function renderDbExplorer() {
  const container = document.getElementById('db-explorer-content');
  if (!container) return;

  // Check if database explorer is enabled via a qol setting
  // Default to true if not specified (for backward compatibility)
  const dbExplorerEnabled = getQolSetting('database explorer enable', 'database enable');
  const isExplicitlyDisabled = dbExplorerEnabled === false || dbExplorerEnabled === 'false' || dbExplorerEnabled === 'disabled';

  if (isExplicitlyDisabled) {
    container.innerHTML = disabledMsg('Database Explorer is disabled in settings.');
    return;
  }

  const provider = getSetting('qol settings', 'database provider');

  if (hasProviderUrl(provider)) {
    mountMiniBrowser(
      container,
      normalizeProviderUrl(provider),
      'Database Explorer',
      null,
      'landscape',
      'database'
    );
    return;
  }

  // No provider URL configured - show error page
  const errorMessage = 'no database provider specified (change in settings)';
  const iframeFallback = `error.html?error=${encodeURIComponent(errorMessage)}`;
  try {
    const errorUrl = await window.electron.resolvePublicUrl('error.html', {
      error: errorMessage,
    });
    mountMiniBrowser(
      container,
      errorUrl,
      'Database Explorer error',
      iframeFallback,
      'landscape',
      'database'
    );
  } catch (err) {
    console.error('db_explorer.js: could not resolve error.html', err);
    container.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = 'Database Explorer error';
    iframe.setAttribute('src', iframeFallback);
    iframe.style.flex      = '1';
    iframe.style.alignSelf = 'stretch';
    iframe.style.width     = '100%';
    iframe.style.minHeight = '0';
    iframe.style.border    = 'none';
    container.appendChild(createEmbedWidget(iframe, 'landscape'));
  }
}

/** Normalize provider to a loadable http(s) URL. */
function normalizeProviderUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return 'about:blank';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    settings = await window.electron.settingsRead();
  } catch (err) {
    console.error('db_explorer.js: failed to read settings', err);
  }

  renderDbExplorer();
})();