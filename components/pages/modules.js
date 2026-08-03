/**
 * modules.js — Front-end controller for public/modules.html
 *
 * Shows installable AI training modules (Axolotl, Unsloth) with
 * install/uninstall buttons, collapsible step lists (run all or run a
 * single step), and a live output console streamed from bridge.py.
 */

'use strict';

// ── Utilities ────────────────────────────────────────────────────────────────

function modulesEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function modulesCall(camel, snake, ...args) {
  const a = window.electron || window.pywebview?.api;
  const fn = a?.[camel] || a?.[snake];
  if (typeof fn !== 'function') return null;
  return await fn(...args);
}

function moduleItemHtml(m) {
  const esc = (v) => modulesEscape(v);
  const platformLabel = m.platform === 'native_windows' ? 'Windows' : (m.platform || 'this system');

  let badge = 'not installed';
  let badgeClass = 'module-badge-missing';
  if (!m.supported) { badge = 'not supported'; badgeClass = 'module-badge-unsupported'; }
  else if (m.installed) { badge = 'installed'; badgeClass = 'module-badge-installed'; }

  const actions = m.supported ? `
      <div class="module-actions">
        <button type="button" class="modules-btn modules-btn-primary" data-module-action="install">${m.installed ? 'reinstall' : 'install'}</button>
        <button type="button" class="modules-btn" data-module-action="uninstall"${m.installed ? '' : ' disabled'}>uninstall</button>
        <button type="button" class="modules-btn modules-btn-ghost" data-module-steps-toggle>steps ▾</button>
      </div>` : `
      <div class="module-unsupported">${esc(m.unsupported_reason)}</div>`;

  const stepGroup = (label, steps, action) => `
      <div class="module-steps-group">
        <div class="module-steps-group-head">
          <span>${label}</span>
          <button type="button" class="modules-btn modules-btn-mini" data-module-run-all="${action}">run all</button>
        </div>
        <ol class="module-steps-list">
          ${steps.map((step, i) => `
            <li>
              <code>${esc(step)}</code>
              <button type="button" class="modules-run-step" data-module-run-step="${action}" data-module-step-index="${i}" title="run this step">run</button>
            </li>`).join('')}
        </ol>
      </div>`;

  const stepsSections = m.supported ? `
      <div class="module-steps" hidden>
        ${stepGroup('install steps', m.install_steps || [], 'install')}
        ${stepGroup('uninstall steps', m.uninstall_steps || [], 'uninstall')}
      </div>` : '';

  return `
    <div class="module-item" data-module="${esc(m.key)}">
      <div class="module-item-head">
        <div class="module-title-row">
          <span class="module-name">${esc(m.name)}</span>
          <span class="module-badge ${badgeClass}">${badge}</span>
        </div>
        <div class="module-desc">${esc(m.description)}</div>
        <div class="module-platform-line">${esc(m.platforms.join(', '))} · running on ${esc(platformLabel)}</div>
      </div>
      ${actions}
      ${stepsSections}
    </div>`;
}

// ── Output console ───────────────────────────────────────────────────────────

function appendModuleLog(text, cls) {
  const log = document.getElementById('modules-log');
  if (!log) return;
  log.hidden = false;
  const pre = log.querySelector('pre');
  if (!pre) return;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  pre.appendChild(span);
  pre.appendChild(document.createTextNode('\n'));
  while (pre.childNodes.length > 600) pre.removeChild(pre.firstChild);
  const body = log.querySelector('.modules-log-body');
  if (body) body.scrollTop = body.scrollHeight;
}

let modulesBusy = false;

function setModulesBusy(busy) {
  modulesBusy = busy;
  document.querySelectorAll('#modules-list button').forEach((btn) => {
    btn.disabled = busy;
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function runModuleAction(key, action) {
  if (modulesBusy) return;
  setModulesBusy(true);
  appendModuleLog(`$ ${action} ${key}`, 'log-meta');
  try {
    const res = await modulesCall(
      action === 'install' ? 'modulesInstall' : 'modulesUninstall',
      action === 'install' ? 'modules_install' : 'modules_uninstall',
      key
    );
    if (res && !res.success) appendModuleLog('! ' + (res.error || 'failed'), 'log-err');
  } catch (err) {
    appendModuleLog('! ' + (err && err.message || err), 'log-err');
  }
  setModulesBusy(false);
  await loadModules();
}

async function runModuleStep(key, action, index) {
  if (modulesBusy) return;
  setModulesBusy(true);
  appendModuleLog(`$ run ${action} step #${index} of ${key}`, 'log-meta');
  try {
    const res = await modulesCall('modulesRunStep', 'modules_run_step', key, action, String(index));
    if (res && !res.success) appendModuleLog('! ' + (res.error || 'failed'), 'log-err');
  } catch (err) {
    appendModuleLog('! ' + (err && err.message || err), 'log-err');
  }
  setModulesBusy(false);
  await loadModules();
}

// ── Render + load ────────────────────────────────────────────────────────────

async function loadModules() {
  const listEl = document.getElementById('modules-list');
  if (!listEl) return;

  const statusEl = document.getElementById('modules-status');
  if (statusEl) {
    statusEl.textContent = 'checking modules…';
    statusEl.classList.add('modules-status-loading');
  }

  try {
    const result = await modulesCall('modulesGet', 'modules_get');
    if (!result || !result.modules) {
      throw new Error('modules unavailable — bridge not connected');
    }
    if (statusEl) {
      statusEl.textContent = `platform: ${result.platform || 'unknown'}`;
      statusEl.classList.remove('modules-status-loading');
    }
    listEl.innerHTML = result.modules.map((m) => moduleItemHtml(m)).join('');
    wireModuleItems();
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'error loading modules';
      statusEl.classList.remove('modules-status-loading');
    }
    listEl.innerHTML = '<p class="modules-error">' + modulesEscape(err && err.message || err) + '</p>';
  }
}

function wireModuleItems() {
  document.querySelectorAll('[data-module]').forEach((item) => {
    const key = item.getAttribute('data-module');

    item.querySelectorAll('[data-module-action]').forEach((btn) => {
      btn.addEventListener('click', () => runModuleAction(key, btn.getAttribute('data-module-action')));
    });
    item.querySelectorAll('[data-module-run-all]').forEach((btn) => {
      btn.addEventListener('click', () => runModuleAction(key, btn.getAttribute('data-module-run-all')));
    });
    item.querySelectorAll('[data-module-run-step]').forEach((btn) => {
      btn.addEventListener('click', () => runModuleStep(key, btn.getAttribute('data-module-run-step'), Number(btn.getAttribute('data-module-step-index'))));
    });

    const toggle = item.querySelector('[data-module-steps-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const steps = item.querySelector('.module-steps');
        if (!steps) return;
        steps.hidden = !steps.hidden;
        toggle.textContent = steps.hidden ? 'steps ▾' : 'steps ▴';
      });
    }
  });
}

function registerModuleStream() {
  const a = window.electron || window.pywebview?.api;
  if (a && typeof a.onModuleProgress === 'function') {
    a.onModuleProgress((chunk) => {
      chunk = chunk || {};
      if (chunk.type === 'meta') appendModuleLog(chunk.text, 'log-meta');
      else if (chunk.type === 'log') appendModuleLog(chunk.text, '');
      else if (chunk.type === 'error') appendModuleLog('! ' + chunk.text, 'log-err');
      else if (chunk.type === 'done') appendModuleLog(chunk.success ? '» done.' : '» failed.', chunk.success ? 'log-ok' : 'log-err');
    });
  }
}

function initModulesPage() {
  const container = document.getElementById('modules-content');
  if (!container) return;

  container.innerHTML = `
    <div class="modules-page">
      <div class="modules-toolbar">
        <div>
          <h2>Install / Uninstall</h2>
          <p>Optional AI training modules for this machine. Axolotl requires Linux or WSL.</p>
        </div>
        <button type="button" id="modules-refresh" class="settings-btn settings-btn-secondary">↻ refresh</button>
      </div>
      <p id="modules-status" class="modules-status"></p>
      <div id="modules-list" class="modules-list"></div>
      <div id="modules-log" class="modules-log" hidden>
        <div class="modules-log-head">
          <span>output</span>
          <button type="button" id="modules-log-clear" class="modules-log-clear">clear</button>
        </div>
        <div class="modules-log-body"><pre></pre></div>
      </div>
    </div>`;

  document.getElementById('modules-refresh').addEventListener('click', loadModules);
  document.getElementById('modules-log-clear').addEventListener('click', () => {
    const log = document.getElementById('modules-log');
    if (log) {
      log.querySelector('pre').textContent = '';
      log.hidden = true;
    }
  });

  registerModuleStream();
  loadModules();
}

initModulesPage();
