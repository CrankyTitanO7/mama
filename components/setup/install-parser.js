/**
 * install-parser.js — Parses pip install output to determine the actual result.
 *
 * pip can exit with code 0 but still have issues (e.g. "externally-managed-environment"
 * warnings, or "Requirement already satisfied" with no new installs). Conversely,
 * pip can exit with non-zero but have partially succeeded.
 *
 * This module provides a single function that analyzes stdout + stderr + exit code
 * and returns a structured result.
 *
 * Usage (renderer process):
 *   const result = window.__setupUtils.parseInstallOutput(stdout, stderr, exitCode);
 *   // result = { success: bool, message: string, code: string }
 *   //   code: 'installed' | 'already-satisfied' | 'externally-managed' |
 *   //         'package-not-found' | 'os-error' | 'network-error' |
 *   //         'permission-denied' | 'unknown-failure' | 'unknown-success'
 */

(function () {
  if (window.__setupUtils) {
    window.__setupUtils.parseInstallOutput = function (stdout, stderr, exitCode) {
      const combined = (stdout || '') + '\n' + (stderr || '');
      const lower = combined.toLowerCase();

      // ── Helper: check if a pattern exists in the combined output ──────────
      const has = function (pattern) {
        return lower.includes(pattern.toLowerCase());
      };

      // ── Determine the result ──────────────────────────────────────────────

      // 1. Externally-managed-environment (brew/apt managed Python)
      if (has('externally-managed-environment') || has('externally managed environment')) {
        return {
          success: false,
          message: 'Your Python installation is managed by the system package manager (brew/apt). ' +
                   'Use a virtual environment or install Python via pyenv to install packages globally.',
          code: 'externally-managed',
        };
      }

      // 2. Dependency conflict
      if (has('dependency conflict') || has('conflicting dependencies')) {
        return {
          success: false,
          message: 'Dependency conflict detected. Try installing in a virtual environment or using --no-deps.',
          code: 'dependency-conflict',
        };
      }

      // 3. Package not found
      if (has('could not find a version that satisfies the requirement') ||
          has('no matching distribution found')) {
        return {
          success: false,
          message: 'The requested package version was not found. Check the package name and version constraints.',
          code: 'package-not-found',
        };
      }

      // 4. OS / filesystem error
      if (has('oserror') || has('errno') || has('could not install packages due to an oserror')) {
        return {
          success: false,
          message: 'A filesystem or operating system error occurred during installation.',
          code: 'os-error',
        };
      }

      // 5. Permission denied
      if (has('permission denied') || has('permissiondenied') || has('access is denied')) {
        return {
          success: false,
          message: 'Permission denied. Try running with --user flag or in a virtual environment.',
          code: 'permission-denied',
        };
      }

      // 6. Network error
      if (has('network is unreachable') || has('connection refused') ||
          has('connection timed out') || has('could not reach') ||
          has('ssl error') || has('certificate verify failed')) {
        return {
          success: false,
          message: 'Network error. Check your internet connection and try again.',
          code: 'network-error',
        };
      }

      // 7. Disk space
      if (has('no space left on device') || has('disk full')) {
        return {
          success: false,
          message: 'No space left on device. Free up disk space and try again.',
          code: 'disk-full',
        };
      }

      // ── Now check exit code ───────────────────────────────────────────────

      if (exitCode === 0) {
        // 8. "Requirement already satisfied" — already installed, no new installs
        if (has('requirement already satisfied') && !has('successfully installed')) {
          return {
            success: true,
            message: 'All requirements are already satisfied.',
            code: 'already-satisfied',
          };
        }

        // 9. "Successfully installed" — new packages were installed
        if (has('successfully installed')) {
          const match = combined.match(/successfully installed\s+([\s\S]+?)(?:\n\s*\n|\n$|$)/i);
          const packages = match ? match[1].trim() : '';
          return {
            success: true,
            message: packages
              ? 'Successfully installed: ' + packages.replace(/\s+/g, ' ').trim()
              : 'Installation completed successfully.',
            code: 'installed',
          };
        }

        // 10. "WARNING: Target directory" — already exists but pip considers it success
        if (has('warning: target directory')) {
          return {
            success: true,
            message: 'Packages were installed (some targets already existed).',
            code: 'installed',
          };
        }

        // 11. "WARNING: The scripts" — installed but scripts not on PATH
        if (has('warning: the scripts') || has('warning: the script')) {
          return {
            success: true,
            message: 'Installation completed. Note: some scripts may not be on your PATH.',
            code: 'installed',
          };
        }

        // 12. Exit code 0 but no recognizable patterns — assume success
        return {
          success: true,
          message: 'Installation completed (exit code 0).',
          code: 'unknown-success',
        };
      }

      // ── Exit code non-zero ────────────────────────────────────────────────

      // 13. Non-zero exit with "Successfully installed" — partial success
      if (has('successfully installed')) {
        return {
          success: true,
          message: 'Installation partially completed (some packages may have failed).',
          code: 'installed',
        };
      }

      // 14. Non-zero exit with "Requirement already satisfied" — partial
      if (has('requirement already satisfied')) {
        return {
          success: true,
          message: 'Some requirements were already satisfied, but others failed.',
          code: 'already-satisfied',
        };
      }

      // 15. Generic failure — extract meaningful error from last stderr lines
      const stderrLines = (stderr || '').split('\n').filter(function (l) { return l.trim(); });
      const lastError = stderrLines.length > 0
        ? stderrLines[stderrLines.length - 1].trim()
        : '';

      return {
        success: false,
        message: lastError
          ? 'Installation failed: ' + lastError
          : 'Installation failed with unknown error.',
        code: 'unknown-failure',
      };
    };
  }
})();