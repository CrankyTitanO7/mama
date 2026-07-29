/**
 * home.js — Front-end controller for public/index.html
 */

'use strict';

let settings = null;
let trainingPollTimer = null;
let trainingState = null;

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

async function pollTrainingStatus() {
  try {
    trainingState = await window.electron.trainGetActive();
  } catch (e) {
    trainingState = null;
  }
  renderStatus();
  updateQuickActionButtons();
}

function startTrainingPolling() {
  stopTrainingPolling();
  pollTrainingStatus();
  trainingPollTimer = setInterval(pollTrainingStatus, 3000);
}

function stopTrainingPolling() {
  if (trainingPollTimer) {
    clearInterval(trainingPollTimer);
    trainingPollTimer = null;
  }
}

function renderStatus() {
  const container = document.getElementById('status-content');
  if (!container) return;

  if (!trainingState || !trainingState.active) {
    container.innerHTML = `
      <div class="status-placeholder">
        <p>No active training session.</p>
        <p class="status-hint">Start a training job on the <a href="#" onclick="event.preventDefault(); window.electron.navigateTo('public/finetune.html')">fine-tune page</a>.</p>
        <p><a href="#" onclick="event.preventDefault(); window.electron.navigateTo('public/training.html')">Open Training Monitor &rarr;</a></p>
      </div>
    `;
    return;
  }

  const cp = trainingState.latest_checkpoint;
  const cpStep = cp ? cp.step : '?';
  const cpLoss = cp && cp.loss != null ? cp.loss.toFixed(4) : null;

  let icon, label, cls;
  if (trainingState.is_cancelled) {
    icon = '✖️'; label = 'Cancelled'; cls = 'status-cancelled';
  } else if (trainingState.paused) {
    icon = '⏸️'; label = 'Paused'; cls = 'status-paused';
  } else if (trainingState.running) {
    icon = '▶️'; label = 'Running'; cls = 'status-running';
  } else {
    icon = '✅'; label = 'Completed'; cls = 'status-completed';
  }

  const dir = escapeHtmlAttr(trainingState.output_dir || '');

  container.innerHTML = `
    <div class="status-training ${cls}">
      <p class="status-line"><strong>${icon} Training ${label}</strong></p>
      <p class="status-dir" title="${dir}">${dir}</p>
      <p class="status-metrics">Step ${cpStep}${cpLoss !== null ? ' &middot; Loss ' + cpLoss : ''}</p>
      <p><a href="#" onclick="event.preventDefault(); window.electron.navigateTo('public/training.html')">Open Training Monitor &rarr;</a></p>
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
    const hw = getSetting('hardware settings') || {};
    initResourcesWidget(container, {
      gpuConfig: {
        manufacturer:  hw['graphics manufacturer'],
        name:          hw['target card name'],
        cudaVersion:   hw['cuda version'],
        rocmVersion:   hw['rocm version'],
        metalVersion:  hw['metal version'],
        mpsAvailable:  hw['mps available'],
        gpuType:       hw['gpu type'],
      }
    });
  } else {
    container.innerHTML = `<p class="disabled-msg">Resources widget not loaded.</p>`;
  }
}

function updateQuickActionButtons() {
  const container = document.getElementById('quick-actions-content');
  if (!container) return;

  const pausePlayBtn = container.querySelector('.qa-pause-play');
  const cancelBtn = container.querySelector('.qa-cancel');

  const hasActive = trainingState && trainingState.active;

  if (pausePlayBtn) {
    pausePlayBtn.disabled = !hasActive;
    pausePlayBtn.textContent = trainingState && trainingState.paused
      ? '▶️ resume' : '⏸️ pause';
  }

  if (cancelBtn) {
    cancelBtn.disabled = !hasActive;
  }
}

function renderQuickActions() {
  const container = document.getElementById('quick-actions-content');
  if (!container) return;

  const pausePlayBtn  = container.querySelector('.qa-pause-play');
  const cancelBtn     = container.querySelector('.qa-cancel');
  const openFolderBtn = container.querySelector('.qa-open-folder');

  pausePlayBtn?.addEventListener('click', async () => {
    if (!trainingState || !trainingState.active) return;
    try {
      if (trainingState.paused) {
        await window.electron.trainResume(trainingState.output_dir);
      } else {
        await window.electron.trainPause(trainingState.output_dir);
      }
      await pollTrainingStatus();
    } catch (e) {
      console.error('home.js: pause/resume failed', e);
    }
  });

  cancelBtn?.addEventListener('click', async () => {
    if (!trainingState || !trainingState.active) return;
    if (!confirm('Cancel the current training job?')) return;
    try {
      await window.electron.trainCancel(trainingState.output_dir);
      await pollTrainingStatus();
    } catch (e) {
      console.error('home.js: cancel failed', e);
    }
  });

  openFolderBtn?.addEventListener('click', async () => {
    try {
      if (trainingState && trainingState.output_dir) {
        await window.electron.projectRevealFolder(trainingState.output_dir);
      }
    } catch (e) {
      console.error('home.js: open folder failed', e);
    }
  });

  updateQuickActionButtons();
}

function hasProviderUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Embed fullscreen ──────────────────────────────────────────────────────────

let activeFullscreen = null;

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

  const startRect = widgetRoot.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.className = 'embed-fullscreen-overlay';
  overlay.addEventListener('click', () => exitEmbedFullscreen());

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

  const saved = {};
  ['position', 'top', 'left', 'width', 'height', 'zIndex', 'transition'].forEach(k => {
    saved[k] = widgetRoot.style[k] || '';
  });

  widgetRoot.style.position = 'fixed';
  widgetRoot.style.top = startRect.top + 'px';
  widgetRoot.style.left = startRect.left + 'px';
  widgetRoot.style.width = startRect.width + 'px';
  widgetRoot.style.height = startRect.height + 'px';
  widgetRoot.style.zIndex = '10001';
  widgetRoot.style.transition = 'none';
  void widgetRoot.offsetHeight;

  widgetRoot.style.transition = 'top 0.42s cubic-bezier(0.22, 1, 0.36, 1), left 0.42s cubic-bezier(0.22, 1, 0.36, 1), width 0.42s cubic-bezier(0.22, 1, 0.36, 1), height 0.42s cubic-bezier(0.22, 1, 0.36, 1)';

  const fsBtn = widgetRoot.querySelector('.embed-fullscreen-btn');
  if (fsBtn) {
    fsBtn.dataset.origText = fsBtn.textContent;
    fsBtn.dataset.origTitle = fsBtn.title;
    fsBtn.textContent = '✕';
    fsBtn.title = 'Exit fullscreen';
  }

  document.body.appendChild(overlay);
  document.body.classList.add('embed-fullscreen-active');
  overlay.appendChild(closeBtn);

  const onKeyDown = onFullscreenKeyDown;
  document.addEventListener('keydown', onKeyDown, true);
  activeFullscreen = { widget: widgetRoot, overlay, saved, startRect, onKeyDown };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      widgetRoot.style.top = '0';
      widgetRoot.style.left = '0';
      widgetRoot.style.width = '100vw';
      widgetRoot.style.height = '100vh';
    });
  });
}

function exitEmbedFullscreen() {
  if (!activeFullscreen) return;

  const { widget, overlay, saved, startRect, onKeyDown } = activeFullscreen;
  document.removeEventListener('keydown', onKeyDown, true);

  const fsBtn = widget.querySelector('.embed-fullscreen-btn');
  if (fsBtn && fsBtn.dataset.origText !== undefined) {
    fsBtn.textContent = fsBtn.dataset.origText;
    fsBtn.title = fsBtn.dataset.origTitle || 'Fullscreen';
  }

  widget.style.transition = 'top 0.42s cubic-bezier(0.22, 1, 0.36, 1), left 0.42s cubic-bezier(0.22, 1, 0.36, 1), width 0.42s cubic-bezier(0.22, 1, 0.36, 1), height 0.42s cubic-bezier(0.22, 1, 0.36, 1)';
  widget.style.top = startRect.top + 'px';
  widget.style.left = startRect.left + 'px';
  widget.style.width = startRect.width + 'px';
  widget.style.height = startRect.height + 'px';

  overlay.classList.remove('is-visible');

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    Object.keys(saved).forEach(k => { widget.style[k] = saved[k]; });
    overlay.remove();
    document.body.classList.remove('embed-fullscreen-active');
    activeFullscreen = null;
  };

  overlay.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 500);
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
 * Mount a mini browser (iframe).
 */
function mountMiniBrowser(container, src, title, iframeFallbackSrc, orientation, partitionName) {
  Object.assign(container.style, {
    display:       'flex',
    flexDirection: 'column',
    flex:          '1',
    height:        '100%',
    minHeight:     '0',
    overflow:      'hidden',
  });

  container.replaceChildren();

  const frame = document.createElement('iframe');
  frame.className = 'embed-frame mini-browser';
  frame.title = title;
  frame.setAttribute('src', src);

  Object.assign(frame.style, {
    flex:      '1',
    alignSelf: 'stretch',
    width:     '100%',
    minHeight: '0',
    border:    'none',
    opacity:   '0',
  });

  frame.style.transition = 'opacity 0.4s ease';
  frame.addEventListener('load', () => {
    frame.style.opacity = '1';
  }, { once: true });

  const widget = createEmbedWidget(frame, orientation);

  frame.addEventListener('error', () => {
    console.error('embed iframe load failed:', src);
    if (!iframeFallbackSrc) return;

    const slot = widget.querySelector('.embed-widget-slot');
    if (!slot || slot.querySelector('iframe.site-fallback')) return;

    const fallback = document.createElement('iframe');
    fallback.className = 'embed-frame site-fallback';
    fallback.title = title;
    fallback.addEventListener('load', () => {
      if (window.ThemeManager?.applyThemeToWindow) {
        window.ThemeManager.applyThemeToWindow(fallback.contentWindow, window.ThemeManager.getActiveTheme?.() || 'system');
      }
    });
    fallback.setAttribute('src', iframeFallbackSrc);
    Object.assign(fallback.style, {
      flex:      '1',
      alignSelf: 'stretch',
      width:     '100%',
      minHeight: '0',
      border:    'none',
      height:    '100%',
    });
    slot.replaceChildren(fallback);
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

async function renderSite() {
  const container = document.getElementById('site-content');
  if (!container) return;
  await renderQolEmbed(container, {
    enabled:      getSetting('qol settings', 'site enable'),
    provider:     getSetting('qol settings', 'site provider'),
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
  let resolved = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
  if (window.pywebview && window.pywebview.api) {
    const parsed = new URL(resolved);
    const domain = parsed.host;
    const path = parsed.pathname + parsed.search;
    resolved = '/proxy/' + domain + path;
  }
  return resolved;
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

  renderQuickActions();
  void renderResources();
  void renderSite();

  startTrainingPolling();
})();
