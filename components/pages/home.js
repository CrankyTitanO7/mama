/**
 * home.js — Front-end controller for public/index.html
 */

'use strict';

let settings = null;

function getSetting(...keys) {
  let obj = settings;
  for (const key of keys) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[key];
  }
  return obj;
}

function getQolSetting(key, legacyKey) {
  const val = getSetting('qol settings', key);
  if (val !== undefined) return val;
  if (legacyKey) return getSetting('qol settings', legacyKey);
  return undefined;
}

function disabledMsg(text) {
  return `<p class="disabled-msg">${text} <a href="#" onclick="event.preventDefault(); window.electron.navigateTo('public/settings.html')">enable?</a></p>`;
}

function renderStatus() {
  const container = document.getElementById('status-content');
  if (!container) return;
  container.innerHTML = `
    <div class="status-placeholder">
      <p>No active training session.</p>
      <p class="status-hint">Start a training job to see live output here.</p>
    </div>
  `;
}

function resolveTaskManagerMode(raw) {
  if (raw === true || raw === 'true' || raw === 'enabled' || raw === 'always') return 'enabled';
  if (raw === false || raw === 'false' || raw === 'disabled' || raw === 'never') return 'disabled';
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
      container.innerHTML = `<p class="disabled-msg">Resource monitoring skipped for this visit.</p>`;
      return;
    }
  }

  if (typeof initResourcesWidget === 'function') {
    initResourcesWidget(container);
  } else {
    container.innerHTML = `<p class="disabled-msg">Resources widget not loaded.</p>`;
  }
}

function renderQuickActions() {
  const container = document.getElementById('quick-actions-content');
  if (!container) return;

  const pausePlayBtn  = container.querySelector('.qa-pause-play');
  const cancelBtn     = container.querySelector('.qa-cancel');
  const openFolderBtn = container.querySelector('.qa-open-folder');

  pausePlayBtn?.addEventListener('click',  () => console.log('pause/play toggled'));
  cancelBtn?.addEventListener('click',     () => console.log('cancel requested'));
  openFolderBtn?.addEventListener('click', () => console.log('open folder requested'));
}

function hasProviderUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Embed fullscreen ──────────────────────────────────────────────────────────

let activeFullscreen = null;

const FULLSCREEN_MARGIN     = 16;
const FULLSCREEN_CLOSE_SIZE = 44;
const FULLSCREEN_CLOSE_GAP  = 8;
const FULLSCREEN_HEADER     = FULLSCREEN_CLOSE_SIZE + FULLSCREEN_CLOSE_GAP;

function clampStageRect(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(FULLSCREEN_CLOSE_SIZE, Math.min(rect.width, vw - FULLSCREEN_MARGIN * 2));
  const height = Math.max(FULLSCREEN_HEADER + 80, Math.min(rect.height, vh - FULLSCREEN_MARGIN * 2));
  let top  = Math.min(Math.max(FULLSCREEN_MARGIN, rect.top),  vh - FULLSCREEN_MARGIN - height);
  let left = Math.min(Math.max(FULLSCREEN_MARGIN, rect.left), vw - FULLSCREEN_MARGIN - width);
  return { top, left, width, height };
}

function computeFullscreenStageRect(orientation) {
  const maxW        = window.innerWidth  - FULLSCREEN_MARGIN * 2;
  const maxContentH = window.innerHeight - FULLSCREEN_MARGIN * 2 - FULLSCREEN_HEADER;

  let contentW, contentH;
  if (orientation === 'portrait') {
    contentH = Math.min(maxContentH, (maxW * 16) / 9);
    contentW = (contentH * 9) / 16;
    if (contentW > maxW) { contentW = maxW; contentH = (contentW * 16) / 9; }
  } else {
    contentW = maxW;
    contentH = maxContentH;
  }

  return clampStageRect({
    top:    (window.innerHeight - contentH - FULLSCREEN_HEADER) / 2,
    left:   (window.innerWidth  - contentW) / 2,
    width:  contentW,
    height: contentH + FULLSCREEN_HEADER,
  });
}

function stageRectFromSlot(slotRect) {
  return clampStageRect({
    top: slotRect.top, left: slotRect.left,
    width: slotRect.width, height: slotRect.height + FULLSCREEN_HEADER,
  });
}

function applyStageRect(stage, rect) {
  stage.style.top    = `${rect.top}px`;
  stage.style.left   = `${rect.left}px`;
  stage.style.width  = `${rect.width}px`;
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

  const slot  = widgetRoot.querySelector('.embed-widget-slot');
  const embed = slot?.firstElementChild;
  if (!embed) return;

  const startRect   = embed.getBoundingClientRect();
  const orientation = widgetRoot.dataset.orientation || 'landscape';
  const targetStage = computeFullscreenStageRect(orientation);

  const overlay = document.createElement('div');
  overlay.className = 'embed-fullscreen-overlay';
  overlay.addEventListener('click', () => exitEmbedFullscreen());

  // Stage: flex column so closeBtn + panel divide the pixel height correctly
  const stage = document.createElement('div');
  stage.className = 'embed-fullscreen-stage';
  Object.assign(stage.style, {
    display:        'flex',
    flexDirection:  'column',
    overflow:       'hidden',
  });
  stage.addEventListener('click', (e) => e.stopPropagation());

  // Close button: fixed-height row at the top
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'embed-fullscreen-close';
  closeBtn.setAttribute('aria-label', 'Exit fullscreen');
  closeBtn.title = 'Exit fullscreen';
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, {
    flexShrink: '0',
    height:     `${FULLSCREEN_CLOSE_SIZE}px`,
  });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); exitEmbedFullscreen(); });

  // Panel: takes all remaining height after the close button
  const panel = document.createElement('div');
  panel.className = 'embed-fullscreen-panel';
  Object.assign(panel.style, {
    flex:          '1',
    minHeight:     '0',
    display:       'flex',
    flexDirection: 'column',
    overflow:      'hidden',
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
  const slot  = widgetRoot.querySelector('.embed-widget-slot');

  fsBtn?.addEventListener('click', (e) => { e.stopPropagation(); enterEmbedFullscreen(widgetRoot); });
  slot?.addEventListener('dblclick', () => enterEmbedFullscreen(widgetRoot));
}

/**
 * Wrap embed in chrome with fullscreen and mute controls.
 * @param {'landscape'|'portrait'} orientation
 */
function createEmbedWidget(embedEl, orientation) {
  const root = document.createElement('div');
  root.className = 'embed-widget';
  root.dataset.orientation = orientation;
  // flex:1 stretches in a flex parent; height:100% fills when parent is block
  Object.assign(root.style, {
    display:       'flex',
    flexDirection: 'column',
    flex:          '1',
    height:        '100%',
    minHeight:     '0',
    overflow:      'hidden',
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'embed-widget-toolbar';
  toolbar.style.flexShrink = '0';   // never let the toolbar get squeezed away

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
  // slot must be a flex column so the webview/iframe inside can use flex:1
  Object.assign(slot.style, {
    display:       'flex',
    flexDirection: 'column',
    flex:          '1',
    minHeight:     '0',
    overflow:      'hidden',
  });
  slot.appendChild(embedEl);

  toolbar.appendChild(muteBtn);
  toolbar.appendChild(fsBtn);
  root.appendChild(toolbar);
  root.appendChild(slot);

  initEmbedFullscreen(root);
  initMuteButton(root, embedEl, muteBtn);
  return root;
}

function initMuteButton(widgetRoot, embedEl, muteBtn) {
  let isMuted = false;

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;
    if (embedEl && typeof embedEl.setAudioMuted === 'function') {
      embedEl.setAudioMuted(isMuted);
    }
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
  // Give the container a flex column so the embed widget can stretch into it.
  // Without this, flex:1 on the widget has nothing to measure against.
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
  // flex:1 + align-self:stretch fills the flex column correctly.
  // height:100% alone is circular inside a flex container and collapses.
  Object.assign(webview.style, {
    flex:      '1',
    alignSelf: 'stretch',
    width:     '100%',
    minHeight: '0',
    display:   'flex',
  });

  if (partitionName) {
    webview.setAttribute('partition', `persist:${partitionName}`);
  }

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
    Object.assign(iframe.style, {
      flex:      '1',
      alignSelf: 'stretch',
      width:     '100%',
      minHeight: '0',
      border:    'none',
      height:    '100%',
    });
    slot.replaceChildren(iframe);
  });

  container.appendChild(widget);
}

async function renderQolEmbed(container, {
  enabled, provider, label, errorMessage, contentTitle, orientation, partition,
}) {
  if (!enabled) {
    container.innerHTML = disabledMsg(`${label} is disabled in settings.`);
    return;
  }

  if (hasProviderUrl(provider)) {
    mountMiniBrowser(container, normalizeProviderUrl(provider), contentTitle, null, orientation, partition);
    return;
  }

  const iframeFallback = `error.html?error=${encodeURIComponent(errorMessage)}`;
  try {
    const errorUrl = await window.electron.resolvePublicUrl('error.html', { error: errorMessage });
    mountMiniBrowser(container, errorUrl, `${contentTitle} error`, iframeFallback, orientation, partition);
  } catch (err) {
    console.error(`home.js: could not resolve error.html for ${label}`, err);
    container.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.className = 'embed-frame site-fallback';
    iframe.title = `${contentTitle} error`;
    iframe.setAttribute('src', iframeFallback);
    Object.assign(iframe.style, {
      flex:      '1',
      alignSelf: 'stretch',
      width:     '100%',
      minHeight: '0',
      border:    'none',
    });
    container.appendChild(createEmbedWidget(iframe, orientation));
  }
}

async function renderReels() {
  const container = document.getElementById('reels-content');
  if (!container) return;
  await renderQolEmbed(container, {
    enabled:      getSetting('qol settings', 'reels enable'),
    provider:     getSetting('qol settings', 'reels provider'),
    label:        'Reels',
    errorMessage: 'no reels provider specified (change in settings)',
    contentTitle: 'reels content',
    orientation:  'portrait',
    partition:    'reels',
  });
}

async function renderSite() {
  const container = document.getElementById('site-content');
  if (!container) return;
  await renderQolEmbed(container, {
    enabled:      getQolSetting('site enable', 'video enable'),
    provider:     getQolSetting('site provider', 'video provider'),
    label:        'Site',
    errorMessage: 'no site provider specified (change in settings)',
    contentTitle: 'site content',
    orientation:  'landscape',
    partition:    'site',
  });
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return 'about:blank';
  const trimmed = url.trim();
  return (trimmed.startsWith('http://') || trimmed.startsWith('https://')) ? trimmed : 'about:blank';
}

function normalizeProviderUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return 'about:blank';
  return (trimmed.startsWith('http://') || trimmed.startsWith('https://')) ? trimmed : `https://${trimmed}`;
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  void renderResources();
  void renderReels();
  void renderSite();
})();