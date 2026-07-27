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
  let _beforeQuitCallback = null;

  const electron = {
    navigateTo: async (page) => {
      if (api.navigateTo) return await api.navigateTo(page);
      window.location.href = page;
    },
    resolvePublicUrl: async (filename, query) => {
      if (api.resolvePublicUrl) return await api.resolvePublicUrl(filename, query || {});
      const qs = query ? '?' + new URLSearchParams(query).toString() : '';
      return filename + qs;
    },
    settingsRead:            async () => { try { return await api.settingsRead(); } catch(e) { return null; } },
    settingsDescriptionsRead: async () => { try { return await api.settingsDescriptionsRead(); } catch(e) { return null; } },
    settingsWrite:           async (s) => { try { return await api.settingsWrite(s); } catch(e) { return false; } },
    settingsWriteNonbackup:  async (s) => { try { return await api.settingsWriteNonbackup(s); } catch(e) { return false; } },
    settingsWriteWithBackup: async (s) => { try { return await api.settingsWriteWithBackup(s); } catch(e) { return false; } },
    settingsReset:           async () => { try { return await api.settingsReset(); } catch(e) { return null; } },
    settingsBackupExists:    async () => { try { return await api.settingsBackupExists(); } catch(e) { return false; } },
    settingsRestoreBackup:   async () => { try { return await api.settingsRestoreBackup(); } catch(e) { return null; } },
    settingsSetupComplete:   async () => { try { return await api.settingsSetupComplete(); } catch(e) { return false; } },
    setupComplete:           async () => { try { return await api.setupComplete(); } catch(e) { return false; } },
    torchCommandsRead: async () => { try { return await api.torchCommandsRead(); } catch(e) { return {}; } },
    runOSDetect:     async () => { try { return wrapResult(await api.runOSDetect()); } catch(e) { return wrapError(e); } },
    runPythonDetect: async () => { try { return wrapResult(await api.runPythonDetect()); } catch(e) { return wrapError(e); } },
    runGPUDetect:    async () => { try { return wrapResult(await api.runGPUDetect()); } catch(e) { return wrapError(e); } },
    runCompatibilityCheck: async (params) => { try { return wrapResult(await api.runCompatibilityCheck(params)); } catch(e) { return wrapError(e); } },
    runInstall: async (fw, gpuVariant, accelVersion) => {
      try { return wrapResult(await api.runInstall(fw, gpuVariant, accelVersion || '')); } catch(e) { return wrapError(e); }
    },
    runInstallStream: async (fw, gpuVariant, accelVersion, scope, projectFolder) => {
      try { return wrapResult(await api.runInstallStream(fw, gpuVariant, accelVersion || '', scope || 'global', projectFolder || '')); } catch(e) { return wrapError(e); }
    },
    onInstallProgress: (callback) => { _installProgressCallback = callback; },
    offInstallProgress: () => { _installProgressCallback = null; },
    runImportTest: async (framework, projectFolder) => {
      try { return wrapResult(await api.runImportTest(framework, projectFolder || null)); } catch(e) { return wrapError(e); }
    },
    runFlopsTest: async (batchSize) => {
      try { return wrapResult(await api.runFlopsTest(batchSize || 1)); } catch(e) { return wrapError(e); }
    },
    runSystemDetect: async (framework) => { try { return wrapResult(await api.runSystemDetect(framework)); } catch(e) { return wrapError(e); } },
    runSystemCommand: async (command, args) => { try { return wrapResult(await api.runSystemCommand(command, args || [])); } catch(e) { return wrapError(e); } },
    themesRead:  async () => { try { return await api.themesRead(); } catch(e) { return []; } },
    themesWrite: async (theme) => { try { return await api.themesWrite(theme); } catch(e) { return false; } },
    runPythonCommand: async (action) => { try { return wrapResult(await api.runPythonCommand(action)); } catch(e) { return wrapError(e); } },
    projectRecentsRead:  async () => { try { return await api.projectRecentsRead(); } catch(e) { return null; } },
    projectPickFolder:   async () => { try { return await api.projectPickFolder(); } catch(e) { return null; } },
    projectOpenFolder:   async (folderPath) => { try { return await api.projectOpenFolder(folderPath); } catch(e) { return null; } },
    projectListFolder:   async (folderPath) => { try { return await api.projectListFolder(folderPath); } catch(e) { return null; } },
    projectRevealFolder: async (folderPath) => { try { return await api.projectRevealFolder(folderPath); } catch(e) { return false; } },
    projectTemplatesRead: async () => { try { return await api.projectTemplatesRead(); } catch(e) { return {}; } },
    projectImportTemplate: async (templateKey) => { try { return await api.projectImportTemplate(templateKey); } catch(e) { return { success: false, error: String(e) }; } },
    projectInit:       async (folderPath) => { try { return await api.projectInit(folderPath); } catch(e) { return { hasProjectJson: false, hasVenv: false }; } },
    projectCreateJson: async (folderPath) => { try { return await api.projectCreateJson(folderPath); } catch(e) { return { success: false, error: String(e) }; } },
    projectCreateVenv: async (folderPath) => { try { return await api.projectCreateVenv(folderPath); } catch(e) { return { success: false, error: String(e) }; } },
    readDocsFile: async (filename) => { try { return await api.readDocsFile(filename); } catch(e) { return null; } },
    onBeforeQuit: (callback) => { _beforeQuitCallback = callback; },
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
        # Translate the path to a filesystem path
        path = self.translate_path(self.path)

        # Check if the file is an HTML file
        if os.path.isfile(path) and path.endswith('.html'):
            try:
                with open(path, 'rb') as f:
                    content = f.read()

                # Inject the shim
                html = content.decode('utf-8')
                if '</head>' in html:
                    html = html.replace('</head>', SHIM_SCRIPT + '\n</head>')
                elif '<body>' in html:
                    html = html.replace('<body>', '<body>\n' + SHIM_SCRIPT)
                else:
                    html = SHIM_SCRIPT + '\n' + html

                body = html.encode('utf-8')

                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Last-Modified', self.date_time_string(os.path.getmtime(path)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                logger.error('Error serving %s: %s', path, e)
                # Fall through to default handler

        # Default handling for non-HTML files
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