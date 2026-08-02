// updater.js — update banner + shared update manager.
// Injected on every page by http_server.py's shim. The banner shows below the
// topbar when an update is available; the settings page renders a full panel
// from the same state.
(function () {
  'use strict';

  const PHASES = ['idle', 'checking', 'available', 'downloading', 'done', 'ready', 'error', 'uptodate'];

  let phase = 'idle';
  let info = null;
  let progress = 0;
  let dismissed = false;
  let bannerEl = null;
  let statusListeners = [];

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function setPhase(next, msg) {
    if (!PHASES.includes(next)) return;
    phase = next;
    if (next === 'error') info = Object.assign({}, info, { error: msg });
    if (next === 'available' || next === 'uptodate') dismissed = false;
    notify();
  }

  function notify() {
    renderBanner();
    statusListeners.forEach((fn) => { try { fn(getState()); } catch (_) {} });
  }

  async function call(method, ...args) {
    try {
      return await window.electron[method](...args);
    } catch (e) {
      return null;
    }
  }

  async function check(silent) {
    if (phase === 'checking' || phase === 'downloading') return;
    if (!silent) setPhase('checking');
    const res = await call('updateCheck');
    if (!res) {
      if (!silent) setPhase('error', 'Could not reach the Python bridge.');
      return;
    }
    info = res;
    if (res.available) setPhase('available');
    else if (res.error && res.update_exists) setPhase('error', res.error);
    else setPhase('uptodate');
  }

  async function download() {
    if (phase === 'downloading') return;
    setPhase('downloading');
    progress = 0;
    await call('updateDownload');
  }

  async function install() {
    const res = await call('updateInstall');
    if (!res || !res.success) {
      setPhase('error', (res && res.error) || 'Install failed.');
      return false;
    }
    setPhase('ready');
    return true;
  }

  function restart() {
    call('appQuit');
  }

  function getState() {
    return {
      phase,
      info,
      progress,
      currentVersion: info ? info.current_version : null,
      latestVersion: info ? info.latest_version : null,
      releaseName: info ? info.release_name : null,
      notes: info ? info.notes : '',
      size: info && info.asset ? info.asset.size : 0,
      error: info ? info.error : null,
    };
  }

  function subscribe(fn) {
    statusListeners.push(fn);
    fn(getState());
    return () => {
      statusListeners = statusListeners.filter((f) => f !== fn);
    };
  }

  // ── Banner ────────────────────────────────────────────────────────────────

  const BANNER_TEMPLATES = {
    checking: () => `<span class="update-banner-text">Checking for updates…</span>`,
    available: () => {
      const s = getState();
      return `
        <span class="update-banner-text">
          <strong>Update ${s.latestVersion ? 'v' + s.latestVersion : ''} available</strong>
          <span class="update-banner-meta">${s.size ? fmtSize(s.size) : ''}${s.releaseName ? ' · ' + escapeHtml(s.releaseName) : ''}</span>
        </span>
        <details class="update-banner-notes">
          <summary>what's new</summary>
          <pre>${escapeHtml(s.notes || 'No release notes.')}</pre>
        </details>
        <span class="update-banner-actions">
          <button class="update-banner-btn" data-update-action="download">Download</button>
          <button class="update-banner-btn update-banner-btn-ghost" data-update-action="dismiss">Not now</button>
        </span>
      `;
    },
    downloading: () => {
      const s = getState();
      return `
        <span class="update-banner-text">Downloading ${s.latestVersion ? 'v' + s.latestVersion : 'update'}… ${Math.round(s.progress)}%</span>
        <div class="update-banner-progress"><div class="update-banner-progress-fill" style="width:${Math.round(s.progress)}%"></div></div>
      `;
    },
    done: () => `
      <span class="update-banner-text">Update downloaded — ready to install.</span>
      <span class="update-banner-actions">
        <button class="update-banner-btn" data-update-action="install">Install &amp; restart</button>
        <button class="update-banner-btn update-banner-btn-ghost" data-update-action="dismiss">Later</button>
      </span>
    `,
    ready: () => `
      <span class="update-banner-text"><strong>Restart to apply the update.</strong></span>
      <span class="update-banner-actions">
        <button class="update-banner-btn" data-update-action="restart">Restart now</button>
      </span>
    `,
    error: () => {
      const s = getState();
      return `
        <span class="update-banner-text update-banner-error">⚠ ${escapeHtml(s.error || 'Update check failed.')}</span>
        <span class="update-banner-actions">
          <button class="update-banner-btn" data-update-action="check">Retry</button>
          <button class="update-banner-btn update-banner-btn-ghost" data-update-action="dismiss">Dismiss</button>
        </span>
      `;
    },
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderBanner() {
    if (!bannerEl) return;
    if (phase === 'idle' || phase === 'uptodate' || dismissed) {
      bannerEl.style.display = 'none';
      document.body.classList.remove('has-update-banner');
      return;
    }
    const template = BANNER_TEMPLATES[phase] || BANNER_TEMPLATES.checking;
    bannerEl.innerHTML = `<div class="update-banner-inner">${template()}</div>`;
    bannerEl.style.display = 'block';
    document.body.classList.add('has-update-banner');

    bannerEl.querySelectorAll('[data-update-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.updateAction;
        if (action === 'download') download();
        else if (action === 'install') install();
        else if (action === 'restart') restart();
        else if (action === 'check') check(false);
        else if (action === 'dismiss') { dismissed = true; renderBanner(); }
      });
    });
  }

  function initBanner(attempts) {
    if (bannerEl || !window.electron || typeof window.electron.updateCheck !== 'function') return;
    if (document.getElementById('setup-app')) return; // setup pages never show the banner
    const topbar = document.querySelector('.topbar');
    if (!topbar) {
      // Topbar renders async; retry until it appears
      if ((attempts || 10) > 0) setTimeout(() => initBanner((attempts || 10) - 1), 300);
      return;
    }
    bannerEl = document.createElement('div');
    bannerEl.className = 'update-banner';
    bannerEl.style.display = 'none';
    topbar.parentNode.insertBefore(bannerEl, topbar.nextSibling);
    renderBanner();
  }

  // Progress events pushed from Python via the shim's _dispatchIpc
  document.addEventListener('app:ipc-_updateProgressCallback', (e) => {
    const d = (e && e.detail) || {};
    if (d.type === 'download') {
      setPhase('downloading');
      progress = d.percent || 0;
    } else if (d.type === 'done') {
      progress = 100;
      setPhase('done');
    } else if (d.type === 'ready') {
      setPhase('ready');
    } else if (d.type === 'error') {
      setPhase('error', d.message);
    }
  });

  // Auto-check once per session, gently after first load
  let alreadyChecked = false;
  try { alreadyChecked = !!sessionStorage.getItem('mama-update-checked'); } catch (_) {}
  if (!alreadyChecked) {
    try { sessionStorage.setItem('mama-update-checked', '1'); } catch (_) {}
    setTimeout(() => { initBanner(); check(true); }, 1500);
  }
  window.UpdateManager = { check, download, install, restart, getState, subscribe };
})();
