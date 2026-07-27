#!/usr/bin/env python3
"""
http_server.py — Lightweight static file server with JS shim injection.
Serves the mama frontend files and injects a compatibility layer so
existing window.electron.* calls work via pywebview's JS bridge.
"""

import os
import json
import threading
import logging
import mimetypes
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
(function() {
  'use strict';
  const api = window.pywebview ? window.pywebview.api : {};

  function wrapResult(result) {
    if (result && typeof result === 'object' && 'code' in result) return result;
    return { code: 0, stdout: JSON.stringify(result), stderr: '' };
  }

  function wrapError(err) {
    return { code: 1, stdout: '', stderr: String(err) };
  }

  let _installProgressCallback = null;

  const electron = {
    // ═══════════ Navigation ═══════════
    navigateTo: async (page) => {
      if (api.navigate_to) return await api.navigate_to(page);
      // Fallback: navigate relative to server root
      window.location.href = page.startsWith('http') ? page : '/' + page.replace(/^\\.\\//, '');
    },
    resolvePublicUrl: async (filename, query) => {
      if (api.resolve_public_url) return await api.resolve_public_url(filename, query || {});
      const qs = query ? '?' + new URLSearchParams(query).toString() : '';
      return filename + qs;
    },

    // ═══════════ Settings ═══════════
    settingsRead:            async () => { try { return await api.settings_read(); } catch(e) { return null; } },
    settingsDescriptionsRead: async () => { try { return await api.settings_descriptions_read(); } catch(e) { return null; } },
    settingsWrite:           async (s) => { try { return await api.settings_write(s); } catch(e) { return false; } },
    settingsWriteNonbackup:  async (s) => { try { return await api.settings_write_nonbackup(s); } catch(e) { return false; } },
    settingsWriteWithBackup: async (s) => { try { return await api.settings_write_with_backup(s); } catch(e) { return false; } },
    settingsReset:           async () => { try { return await api.settings_reset(); } catch(e) { return null; } },
    settingsBackupExists:    async () => { try { return await api.settings_backup_exists(); } catch(e) { return false; } },
    settingsRestoreBackup:   async () => { try { return await api.settings_restore_backup(); } catch(e) { return null; } },
    settingsSetupComplete:   async () => { try { return await api.settings_setup_complete(); } catch(e) { return false; } },
    setupComplete:           async () => { try { return await api.setup_complete(); } catch(e) { return false; } },

    // ═══════════ Setup Data ═══════════
    torchCommandsRead: async () => { try { return await api.torch_commands_read(); } catch(e) { return {}; } },

    // ═══════════ System Detection ═══════════
    runOSDetect:     async () => { try { return wrapResult(await api.run_os_detect()); } catch(e) { return wrapError(e); } },
    runPythonDetect: async () => { try { return wrapResult(await api.run_python_detect()); } catch(e) { return wrapError(e); } },
    runGPUDetect:    async () => { try { return wrapResult(await api.run_gpu_detect()); } catch(e) { return wrapError(e); } },
    runCompatibilityCheck: async (params) => { try { return wrapResult(await api.run_compatibility_check(params)); } catch(e) { return wrapError(e); } },

    // ═══════════ Install ═══════════
    runInstall: async (fw, gpuVariant, accelVersion) => {
      try { return wrapResult(await api.run_install(fw, gpuVariant, accelVersion || '')); } catch(e) { return wrapError(e); }
    },
    runInstallStream: async (fw, gpuVariant, accelVersion, scope, projectFolder) => {
      try { return wrapResult(await api.run_install_stream(fw, gpuVariant, accelVersion || '', scope || 'global', projectFolder || '')); } catch(e) { return wrapError(e); }
    },
    onInstallProgress: (callback) => { _installProgressCallback = callback; },
    offInstallProgress: () => { _installProgressCallback = null; },

    // ═══════════ Tests ═══════════
    runImportTest: async (framework, projectFolder) => {
      try { return wrapResult(await api.run_import_test(framework, projectFolder || null)); } catch(e) { return wrapError(e); }
    },
    runFlopsTest: async (batchSize) => {
      try { return wrapResult(await api.run_flops_test(batchSize || 1)); } catch(e) { return wrapError(e); }
    },

    // ═══════════ System ═══════════
    runSystemDetect: async (framework) => { try { return wrapResult(await api.run_system_detect(framework)); } catch(e) { return wrapError(e); } },
    runSystemCommand: async (command, args) => { try { return wrapResult(await api.run_system_command(command, args || [])); } catch(e) { return wrapError(e); } },

    // ═══════════ Themes ═══════════
    themesRead:  async () => { try { return await api.themes_read(); } catch(e) { return []; } },
    themesWrite: async (theme) => { try { return await api.themes_write(theme); } catch(e) { return false; } },

    // ═══════════ Python ═══════════
    runPythonCommand: async (action) => { try { return wrapResult(await api.run_python_command(action)); } catch(e) { return wrapError(e); } },

    // ═══════════ Project Explorer ═══════════
    projectRecentsRead:  async () => { try { return await api.project_recents_read(); } catch(e) { return null; } },
    projectPickFolder:   async () => { try { return await api.project_pick_folder(); } catch(e) { return null; } },
    projectOpenFolder:   async (folderPath) => { try { return await api.project_open_folder(folderPath); } catch(e) { return null; } },
    projectListFolder:   async (folderPath) => { try { return await api.project_list_folder(folderPath); } catch(e) { return null; } },
    projectRevealFolder: async (folderPath) => { try { return await api.project_reveal_folder(folderPath); } catch(e) { return false; } },
    projectTemplatesRead: async () => { try { return await api.project_templates_read(); } catch(e) { return {}; } },
    projectImportTemplate: async (templateKey) => { try { return await api.project_import_template(templateKey); } catch(e) { return { success: false, error: String(e) }; } },

    // ═══════════ Project Init ═══════════
    projectInit:       async (folderPath) => { try { return await api.project_init(folderPath); } catch(e) { return { hasProjectJson: false, hasVenv: false }; } },
    projectCreateJson: async (folderPath) => { try { return await api.project_create_json(folderPath); } catch(e) { return { success: false, error: String(e) }; } },
    projectCreateVenv: async (folderPath) => { try { return await api.project_create_venv(folderPath); } catch(e) { return { success: false, error: String(e) }; } },

    // ═══════════ Docs ═══════════
    readDocsFile: async (filename) => { try { return await api.read_docs_file(filename); } catch(e) { return null; } },

    // ═══════════ Before Quit ═══════════
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
})();
</script>
"""


class MamaHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom handler that injects the pywebview shim into HTML responses."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        """Serve a GET request with optional shim injection for HTML files."""
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