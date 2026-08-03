#!/usr/bin/env python3
"""
http_server.py — Lightweight static file server with JS shim injection.
Serves the mama frontend files and injects a compatibility layer so
existing window.electron.* calls work via pywebview's JS bridge.
"""

import os
import re
import json
import threading
import logging
import mimetypes
import urllib.request
import urllib.parse
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

logger = logging.getLogger('mama.http')

# ── JS Shim — injected into every HTML page ──────────────────────────────────
# NOTE: pywebview exposes Python methods with their original snake_case names.
# The shim maps the existing window.electron.* camelCase API to the Python
# snake_case methods on window.pywebview.api.*
SHIM_SCRIPT = """
<script>
// ── pywebview → electron API compatibility shim ──────────────────────────────
//
// TIMING: pywebview injects its bridge (window.pywebview.api) AFTER
// DOMContentLoaded.  This shim is injected into <head> so it runs before
// any body scripts.  We expose window.electron immediately (so code can
// reference it) but every method that talks to the Python backend
// automatically awaits the pywebviewready event via _apiReady before
// calling through.
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  'use strict';

  // ── Bridge readiness ──────────────────────────────────────────────────────
  // Resolves once with the pywebview API object.  If the bridge is already
  // present (e.g. future pywebview versions that inject earlier) the
  // promise resolves immediately.
  var _apiReady = new Promise(function (resolve) {
    function check() {
      if (window.pywebview && window.pywebview.api) {
        resolve(window.pywebview.api);
        return true;
      }
      return false;
    }
    if (check()) return;
    window.addEventListener('pywebviewready', function onReady() {
      window.removeEventListener('pywebviewready', onReady);
      // Small safety delay so the proxy is fully wired
      setTimeout(function () { resolve(window.pywebview.api); }, 0);
    });
  });

  // Public helper: returns a promise that resolves to the pywebview API
  async function api() { return _apiReady; }

  function wrapResult(result) {
    if (result && typeof result === 'object' && 'code' in result) return result;
    return { code: 0, stdout: JSON.stringify(result), stderr: '' };
  }

  function wrapError(err) {
    return { code: 1, stdout: '', stderr: String(err) };
  }

  const electron = {
    // ═══════════ Navigation ═══════════
    navigateTo: async (page) => {
      try {
        var a = await api();
        return await a.navigate_to(page);
      } catch (_) {
        window.location.href = page.startsWith('http') ? page : '/' + page.replace(/^\\.\\//, '');
      }
    },
    resolvePublicUrl: async (filename, query) => {
      try {
        var a = await api();
        return await a.resolve_public_url(filename, query || {});
      } catch (_) {
        var qs = query ? '?' + new URLSearchParams(query).toString() : '';
        return filename + qs;
      }
    },

    // ═══════════ Settings ═══════════
    settingsRead:            async () => { try { return await (await api()).settings_read(); } catch(e) { return null; } },
    settingsDescriptionsRead: async () => { try { return await (await api()).settings_descriptions_read(); } catch(e) { return null; } },
    settingsWrite:           async (s) => { try { return await (await api()).settings_write(s); } catch(e) { return false; } },
    settingsWriteNonbackup:  async (s) => { try { return await (await api()).settings_write_nonbackup(s); } catch(e) { return false; } },
    settingsWriteWithBackup: async (s) => { try { return await (await api()).settings_write_with_backup(s); } catch(e) { return false; } },
    settingsReset:           async () => { try { return await (await api()).settings_reset(); } catch(e) { return null; } },
    settingsBackupExists:    async () => { try { return await (await api()).settings_backup_exists(); } catch(e) { return false; } },
    settingsRestoreBackup:   async () => { try { return await (await api()).settings_restore_backup(); } catch(e) { return null; } },
    settingsSetupComplete:   async () => { try { return await (await api()).settings_setup_complete(); } catch(e) { return false; } },
    setupComplete:           async () => { try { return await (await api()).setup_complete(); } catch(e) { return false; } },

    // ═══════════ Setup Data ═══════════
    torchCommandsRead: async () => { try { return await (await api()).torch_commands_read(); } catch(e) { return {}; } },

    // ═══════════ System Detection ═══════════
    runOSDetect:     async () => { try { return wrapResult(await (await api()).run_os_detect()); } catch(e) { return wrapError(e); } },
    runPythonDetect: async () => { try { return wrapResult(await (await api()).run_python_detect()); } catch(e) { return wrapError(e); } },
    runGPUDetect:    async () => { try { return wrapResult(await (await api()).run_gpu_detect()); } catch(e) { return wrapError(e); } },
    runCompatibilityCheck: async (params) => { try { return wrapResult(await (await api()).run_compatibility_check(params)); } catch(e) { return wrapError(e); } },

    // ═══════════ Install ═══════════
    runInstall: async (fw, gpuVariant, accelVersion) => {
      try { return wrapResult(await (await api()).run_install(fw, gpuVariant, accelVersion || '')); } catch(e) { return wrapError(e); }
    },
    runInstallStream: async (fw, gpuVariant, accelVersion, scope, projectFolder, rawCommand) => {
      try { return wrapResult(await (await api()).run_install_stream(fw, gpuVariant, accelVersion || '', scope || 'global', projectFolder || '', rawCommand || '')); } catch(e) { return wrapError(e); }
    },
    onInstallProgress: (callback) => { electron._handlers['_installProgressCallback'] = callback; },
    offInstallProgress: () => { delete electron._handlers['_installProgressCallback']; },

    // ═══════════ Tests ═══════════
    runImportTest: async (framework, projectFolder) => {
      try { return wrapResult(await (await api()).run_import_test(framework, projectFolder || null)); } catch(e) { return wrapError(e); }
    },
    runFlopsTest: async (batchSize, model, jsonOutput, projectFolder, installCalflops) => {
      try { return wrapResult(await (await api()).run_flops_test(batchSize || 1, model || 'resnet18', jsonOutput || false, projectFolder || '', installCalflops || false)); } catch(e) { return wrapError(e); }
    },
    exportFlopsResult: async (resultJson) => {
      try { return await (await api()).export_flops_result(resultJson); } catch(e) { return { success: false, error: String(e) }; }
    },

    // ═══════════ System ═══════════
    runSystemDetect: async (framework) => { try { return wrapResult(await (await api()).run_system_detect(framework)); } catch(e) { return wrapError(e); } },
    runSystemCommand: async (command, args) => { try { return wrapResult(await (await api()).run_system_command(command, args || [])); } catch(e) { return wrapError(e); } },

    // ═══════════ Themes ═══════════
    themesRead:  async () => { try { return await (await api()).themes_read(); } catch(e) { return []; } },
    themesWrite: async (theme) => { try { return await (await api()).themes_write(theme); } catch(e) { return false; } },

    // ═══════════ Python ═══════════
    runPythonCommand: async (action) => { try { return wrapResult(await (await api()).run_python_command(action)); } catch(e) { return wrapError(e); } },

    // ═══════════ Project Explorer ═══════════
    projectRecentsRead:  async () => { try { return await (await api()).project_recents_read(); } catch(e) { return null; } },
    projectRecentsWrite: async (data) => { try { return await (await api()).project_recents_write(data); } catch(e) { return null; } },
    projectPickFolder:   async () => { try { return await (await api()).project_pick_folder(); } catch(e) { return null; } },
    projectOpenFolder:   async (folderPath) => { try { return await (await api()).project_open_folder(folderPath); } catch(e) { return null; } },
    projectListFolder:   async (folderPath) => { try { return await (await api()).project_list_folder(folderPath); } catch(e) { return null; } },
    projectRevealFolder: async (folderPath) => { try { return await (await api()).project_reveal_folder(folderPath); } catch(e) { return false; } },
    projectTemplatesRead: async () => { try { return await (await api()).project_templates_read(); } catch(e) { return {}; } },
    projectImportTemplate: async (templateKey) => { try { return await (await api()).project_import_template(templateKey); } catch(e) { return { success: false, error: String(e) }; } },

    projectJsonRead:   async (folderPath) => { try { return await (await api()).project_json_read(folderPath); } catch(e) { return null; } },
    projectJsonWrite:  async (folderPath, data) => { try { return await (await api()).project_json_write(folderPath, data); } catch(e) { return { success: false, error: String(e) }; } },

    // ═══════════ Project Init ═══════════
    projectInit:       async (folderPath) => { try { return await (await api()).project_init(folderPath); } catch(e) { return { hasProjectJson: false, hasVenv: false }; } },
    projectCreateJson: async (folderPath) => { try { return await (await api()).project_create_json(folderPath); } catch(e) { return { success: false, error: String(e) }; } },
    projectCreateVenv: async (folderPath) => { try { return await (await api()).project_create_venv(folderPath); } catch(e) { return { success: false, error: String(e) }; } },

    // ═══════════ Docs ═══════════
    readDocsFile: async (filename) => { try { return await (await api()).read_docs_file(filename); } catch(e) { return null; } },

    // ═══════════ IPC dispatch ═══════════
    // Generic IPC dispatcher called by bridge.py for ALL callback types.
    // Dispatches to DOM custom events and any registered handler.
    _handlers: {},

    _dispatchIpc: function(name, chunk) {
      // Dispatch a DOM custom event
      document.dispatchEvent(new CustomEvent('app:ipc-' + name, { detail: chunk }));
      // Call registered handler if any
      var h = electron._handlers[name];
      if (h) h(chunk);
    },

    // ═══════════ Training ═══════════
    trainStart: async (configJson) => {
      try { return await (await api()).train_start(configJson); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainPause: async (outputDir) => {
      try { return await (await api()).train_pause(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainResume: async (outputDir) => {
      try { return await (await api()).train_resume(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainCancel: async (outputDir) => {
      try { return await (await api()).train_cancel(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainStatus: async (outputDir) => {
      try { return await (await api()).train_status(outputDir); } catch(e) { return { running: false, error: String(e) }; }
    },
    trainReadConfig: async (outputDir) => {
      try { return await (await api()).train_read_config(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainListCheckpoints: async (outputDir) => {
      try { return await (await api()).train_list_checkpoints(outputDir); } catch(e) { return []; }
    },
    trainGetActive: async () => {
      try { return await (await api()).train_get_active(); } catch(e) { return { active: false }; }
    },
    trainPlatformCheck: async () => {
      try { return await (await api()).train_platform_check(); } catch(e) { return { success: false, error: String(e) }; }
    },
    axolotlCheck: async () => {
      try { return await (await api()).train_axolotl_check(); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainAxolotlWriteConfig: async (outputDir, configJson) => {
      try { return await (await api()).train_axolotl_write_config(outputDir || '', configJson || ''); } catch(e) { return { success: false, error: String(e) }; }
    },
    trainConfigSave: async (outputDir, configJson) => {
      try { return await (await api()).train_config_save(outputDir || '', configJson || ''); } catch(e) { return { success: false, error: String(e) }; }
    },
    onTrainingProgress: (callback) => { electron._handlers['_trainingProgressCallback'] = callback; },
    offTrainingProgress: () => { delete electron._handlers['_trainingProgressCallback']; },

    // ═══════════ Model Management ═══════════
    modelDownload: async (modelId, outputDir, revision) => {      try { return await (await api()).model_download(modelId, outputDir || '', revision || 'main'); } catch(e) { return { success: false, error: String(e) }; }
    },
    modelDownloadCancel: async () => {
      try { return await (await api()).model_download_cancel(); } catch(e) { return { success: false }; }
    },
    modelInstallHub: async () => {
      try { return await (await api()).model_install_hub(); } catch(e) { return { success: false, error: String(e) }; }
    },
    modelList: async (modelsDir) => {
      try { return await (await api()).model_list(modelsDir || ''); } catch(e) { return []; }
    },
    modelCheckCompatibility: async (modelId) => {
      try { return await (await api()).model_check_compatibility(modelId); } catch(e) { return { compatible: false, error: String(e) }; }
    },
    modelDelete: async (modelPath) => {
      try { return await (await api()).model_delete(modelPath); } catch(e) { return { success: false, error: String(e) }; }
    },
    modelMove: async (modelPath, destDir) => {
      try { return await (await api()).model_move(modelPath, destDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    modelMergeAdapter: async (baseModel, adapter, output) => {
      try { return await (await api()).model_merge_adapter(baseModel, adapter, output); } catch(e) { return { success: false, error: String(e) }; }
    },
    onModelProgress: (callback) => { electron._handlers['_modelProgressCallback'] = callback; },
    offModelProgress: () => { delete electron._handlers['_modelProgressCallback']; },

    // ═══════════ Updates ═══════════
    updateCheck: async () => {
      try { return await (await api()).update_check(); } catch(e) { return { available: false, error: String(e) }; }
    },
    updateDownload: async () => {
      try { return await (await api()).update_download(); } catch(e) { return { started: false, error: String(e) }; }
    },
    updateInstall: async () => {
      try { return await (await api()).update_install(); } catch(e) { return { success: false, error: String(e) }; }
    },
    appQuit: async () => {
      try { await (await api()).app_quit(); } catch(e) {}
    },
    onUpdateProgress: (callback) => { electron._handlers['_updateProgressCallback'] = callback; },
    offUpdateProgress: () => { delete electron._handlers['_updateProgressCallback']; },

    // ═══════════ Dataset ═══════════
    datasetPreview: async (path, maxRows) => {
      try { return await (await api()).dataset_preview(path, maxRows || 5); } catch(e) { return { success: false, error: String(e) }; }
    },
    onDatasetPreviewProgress: (callback) => { electron._handlers['_datasetPreviewCallback'] = callback; },
    offDatasetPreviewProgress: () => { delete electron._handlers['_datasetPreviewCallback']; },

    // ═══════════ Before Quit ═══════════
    // ═══════════ Export ═══════════
    exportRunColab: async (outputDir) => {
      try { return await (await api()).export_run_colab(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    exportRunJs: async (outputDir) => {
      try { return await (await api()).export_run_js(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    exportRunOllama: async (outputDir) => {
      try { return await (await api()).export_run_ollama(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },
    exportRunAxolotl: async (outputDir) => {
      try { return await (await api()).export_run_axolotl(outputDir); } catch(e) { return { success: false, error: String(e) }; }
    },

    onBeforeQuit: (callback) => { /* no-op in pywebview */ },
  };

  window.electron = electron;
  window.versions = {
    node: () => 'pywebview',
    chrome: () => 'pywebview',
    electron: () => 'pywebview',
    arch: () => navigator.platform
  };
  console.log('[mama] pywebview compatibility shim loaded');

  // Load the update banner UI (idempotent across page navigations)
  if (!window.__mamaUpdaterLoaded) {
    window.__mamaUpdaterLoaded = true;
    var _u = document.createElement('script');
    _u.src = '/components/elements/updater.js';
    document.head.appendChild(_u);
  }
})();
</script>
"""


_URL_REWRITE_ATTRS = re.compile(
    r'(<(?:img|script|link|a|source|video|audio|iframe|form|input|meta|object|embed|area)\s[^>]*?)'
    r'(href|src|action|poster|data-src|data-href|srcset|cite|formaction|icon|manifest)'
    r'=(?P<q>["\'])/(?P<val>[^"\'>]+)(?P=q)',
    re.IGNORECASE
)

_CSS_URL = re.compile(r'url\(/([^)]+)\)', re.IGNORECASE)
_CSS_IMPORT = re.compile(r'@import\s+url\(/([^)]+)\)', re.IGNORECASE)


def _proxy_rewrite_html(html, base_url):
    """Rewrite proxied HTML so that all relative/absolute-path URLs go
    through the proxy.

    1. Inject <base> pointing to *base_url* (the proxy URL).
    2. Strip the leading ``/`` from absolute-path URLs in HTML attributes
       (``href="/…"`` → ``href="…"``) so they become relative and the
       injected <base> applies.
    3. Same for ``url()`` references inside inline CSS.
    4. Same for ``srcset`` attribute values.
    """
    # ── 1. inject <base> ──────────────────────────────────────────────
    base_tag = f'<base href="{base_url}">'
    if '<head>' in html:
        html = html.replace('<head>', f'<head>{base_tag}', 1)
    elif '<head ' in html:
        html = html.replace('<head ', f'<head>{base_tag}<head ', 1)
    else:
        html = base_tag + html

    # ── 2. rewrite href="/… src="/… etc in HTML tags ─────────────────
    def _rewrite_attr(m):
        before = m.group(1)
        attr = m.group(2)
        quote = m.group('q')
        path = m.group('val')
        if path.startswith('/') or re.match(r'https?://', path, re.I):
            return m.group(0)
        if attr.lower() == 'srcset':
            parts = []
            for part in path.split(','):
                p = part.strip()
                if p.startswith('/'):
                    p = p[1:]
                parts.append(p)
            return f'{before}{attr}={quote}{", ".join(parts)}{quote}'
        return f'{before}{attr}={quote}{path}{quote}'

    html = _URL_REWRITE_ATTRS.sub(_rewrite_attr, html)

    # ── 3. url() in inline CSS ────────────────────────────────────────
    html = _CSS_IMPORT.sub(r'@import url(\1)', html)
    html = _CSS_URL.sub(r'url(\1)', html)

    return html


class MamaHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom handler that injects the pywebview shim into HTML responses."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def _proxy_query(self, target_url, server_port):
        """Handle legacy query-based proxy: /proxy/?url=URL"""
        try:
            req = urllib.request.Request(
                target_url,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                content_type = resp.headers.get('Content-Type', 'text/html') or 'text/html'

                if 'text/html' in content_type:
                    base_tag = f'<base href="{target_url.rstrip("/")}/">'.encode('utf-8')
                    body = body.replace(b'<head>', b'<head>' + base_tag, 1)

                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)
        except Exception as e:
            logger.error('Proxy error for %s: %s', target_url, e)
            self.send_response(502)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(f'<html><body><h2>Proxy error</h2><p>{e}</p></body></html>'.encode('utf-8'))

    def _proxy_path(self, domain, path_query, server_port):
        """Handle path-based proxy: /proxy/DOMAIN/PATH

        For HTML responses, injects <base> pointing to the proxy URL and
        rewrites absolute-path URLs (href=\"/..., src=\"/...) to relative
        paths so they resolve through the proxy.
        """
        if not path_query.startswith('/'):
            path_query = '/' + path_query
        target_url = f'https://{domain}{path_query}'
        base_proxy_url = f'http://127.0.0.1:{server_port}/proxy/{domain}/'

        try:
            req = urllib.request.Request(
                target_url,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                content_type = resp.headers.get('Content-Type', 'text/html') or 'text/html'

                if 'text/html' in content_type:
                    html = body.decode('utf-8', errors='replace')
                    html = _proxy_rewrite_html(html, base_proxy_url)
                    body = html.encode('utf-8', errors='replace')

                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)
        except Exception as e:
            logger.error('Proxy error for %s: %s', target_url, e)
            self.send_response(502)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(f'<html><body><h2>Proxy error</h2><p>{e}</p></body></html>'.encode('utf-8'))

    def do_GET(self):
        """Serve a GET request with optional shim injection for HTML files."""

        # ── Reverse proxy for iframe embedding ───────────────────────────
        if self.path.startswith('/proxy/'):
            server_port = self.server.server_address[1]
            parsed = urllib.parse.urlparse(self.path)
            query = parsed.query
            params = urllib.parse.parse_qs(query)

            path_part = parsed.path  # e.g. /proxy/?url=... or /proxy/DOMAIN/PATH

            # Legacy query-based proxy: /proxy/?url=URL
            if 'url' in params:
                target_url = params.get('url', [None])[0]
                if not target_url:
                    self.send_response(400)
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(b'Missing url parameter')
                    return
                self._proxy_query(target_url, server_port)
                return

            # Path-based proxy: /proxy/DOMAIN/PATH_AND_QUERY
            prefix = '/proxy/'
            if not path_part.startswith(prefix):
                self.send_response(400)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'Invalid proxy path')
                return

            remaining = path_part[len(prefix):]  # DOMAIN/PATH (without leading /proxy/)
            if not remaining:
                self.send_response(400)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'Missing domain in proxy path')
                return

            if '/' in remaining:
                domain, _, rest_path = remaining.partition('/')
                rest_path = '/' + rest_path
            else:
                domain = remaining
                rest_path = '/'

            if query:
                rest_path += '?' + query

            self._proxy_path(domain, rest_path, server_port)
            return

        path = self.translate_path(self.path)

        if os.path.isfile(path) and path.endswith('.html'):
            try:
                with open(path, 'rb') as f:
                    content = f.read()

                html = content.decode('utf-8')
                if '</head>' in html:
                    html = html.replace('</head>', SHIM_SCRIPT + '\n</head>')
                elif '<body>' in html:
                    html = html.replace('<body>', '<body>\n' + SHIM_SCRIPT)
                else:
                    html = SHIM_SCRIPT + '\n' + html

                body = html.encode('utf-8')

                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Last-Modified', self.date_time_string(os.path.getmtime(path)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                logger.error('Error serving %s: %s', path, e)

        return super().do_GET()

    def log_message(self, fmt, *args):
        logger.debug('HTTP %s - %s', self.address_string(), fmt % args)


def start_http_server(base_dir, port=0):
    """Start a HTTP server on a random port serving the given directory.
    Returns the port number.
    """

    def handler_factory(*args, **kwargs):
        return MamaHTTPRequestHandler(*args, directory=base_dir, **kwargs)

    server = HTTPServer(('127.0.0.1', port), handler_factory)
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    logger.info('HTTP server listening on 127.0.0.1:%d serving %s', port, base_dir)
    return port