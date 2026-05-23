/**
 * resources.js — Task-manager/btop-like resource overview element
 *
 * Displays live CPU, RAM, GPU, and VRAM usage in the resources box.
 * This script is loaded by home.js and renders into a target container.
 *
 * Dependencies:
 *  - window.electron.runSystemCommand (IPC) for CLI-based resource queries
 *  - window.electron.runOSDetect / runGPUDetect for system info
 */

'use strict';

/**
 * Initialize the resources widget inside a given container element.
 * @param {HTMLElement} container - The DOM element to render into.
 */
function initResourcesWidget(container) {
  if (!container) return;

  // ── Render static structure ────────────────────────────────────────────────
  container.innerHTML = `
    <div class="resources-widget">
      <div class="resource-group">
        <div class="resource-group-title">CPU</div>
        <div class="resource-bar-track">
          <div class="resource-bar cpu-bar" style="width: 0%"></div>
        </div>
        <div class="resource-detail cpu-detail">—</div>
      </div>
      <div class="resource-group">
        <div class="resource-group-title">RAM</div>
        <div class="resource-bar-track">
          <div class="resource-bar ram-bar" style="width: 0%"></div>
        </div>
        <div class="resource-detail ram-detail">—</div>
      </div>
      <div class="resource-group">
        <div class="resource-group-title">GPU</div>
        <div class="resource-bar-track">
          <div class="resource-bar gpu-bar" style="width: 0%"></div>
        </div>
        <div class="resource-detail gpu-detail">—</div>
      </div>
      <div class="resource-group">
        <div class="resource-group-title">VRAM</div>
        <div class="resource-bar-track">
          <div class="resource-bar vram-bar" style="width: 0%"></div>
        </div>
        <div class="resource-detail vram-detail">—</div>
      </div>
      <div class="resource-update-msg">updating…</div>
    </div>
  `;

  // ── Query functions ────────────────────────────────────────────────────────

  /** Parse a percentage from a line like "cpu: 23.5%" */
  function parsePercent(text) {
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : 0;
  }

  /** Parse a numeric value + unit (e.g. "7.8 GiB", "512 MiB") into GB */
  function parseMemValue(text) {
    const m = text.match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB)/i);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    switch (unit) {
      case 'gib': return val * 1.074;  // GiB → GB approx
      case 'mib': return val * 0.001074;
      case 'kib': return val * 0.000001074;
      case 'gb':  return val;
      case 'mb':  return val * 0.001;
      case 'kb':  return val * 0.000001;
      default:    return val;
    }
  }

  /**
   * Fetch CPU & RAM via system commands.
   * On Windows uses wmic; on Linux/Mac uses top / vm_stat / free.
   */
  /**
   * Clean up Windows \r\n line endings and split into non-empty lines.
   */
  function cleanLines(text) {
    return (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  }

  /**
   * Parse a non-negative integer from a string. Returns NaN if invalid.
   */
  function parseIntSafe(v) {
    const n = parseInt(String(v).trim(), 10);
    return isNaN(n) ? NaN : Math.max(n, 0);
  }

  async function queryCPUandRAM() {
    const isWin = navigator.platform && navigator.platform.startsWith('Win');
    let cpuUsage = 0;
    let ramTotal = 0;
    let ramUsed  = 0;
    let ramPct   = 0;

    if (isWin) {
      // CPU: wmic cpu get loadpercentage
      try {
        const cpuRes = await window.electron.runSystemCommand('wmic', ['cpu', 'get', 'loadpercentage']);
        const lines = cleanLines(cpuRes.stdout);
        // Typical output:
        //   LoadPercentage
        //   12
        for (const line of lines) {
          const val = parseFloat(line);
          if (!isNaN(val) && val >= 0 && val <= 100) {
            cpuUsage = val;
            break;
          }
        }
      } catch (_) { /* ignore */ }

      // RAM: wmic os get TotalVisibleMemorySize,FreePhysicalMemory
      // Returns values in KB.
      try {
        const memRes = await window.electron.runSystemCommand('wmic', ['os', 'get', 'TotalVisibleMemorySize,FreePhysicalMemory']);
        const lines = cleanLines(memRes.stdout);
        // Typical output:
        //   TotalVisibleMemorySize  FreePhysicalMemory
        //   16667708                8384912
        for (const line of lines) {
          const parts = line.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            const totalKb = parseIntSafe(parts[0]);
            const freeKb  = parseIntSafe(parts[1]);
            if (!isNaN(totalKb) && !isNaN(freeKb) && totalKb > 0) {
              ramTotal = totalKb * 0.000001;        // KB → GB
              ramUsed  = (totalKb - freeKb) * 0.000001;
              ramPct   = (ramUsed / ramTotal) * 100;
              break;  // use first valid data row
            }
          }
        }
      } catch (_) { /* ignore */ }
    } else {
      // Linux/Mac: use ps + free
      try {
        const cpuRes = await window.electron.runSystemCommand('ps', ['-A', '-o', '%cpu', '--sort=-%cpu', '--no-headers']);
        const lines = cleanLines(cpuRes.stdout);
        if (lines.length > 0) {
          const total = lines.reduce((sum, l) => sum + (parseFloat(l) || 0), 0);
          cpuUsage = Math.min(total / lines.length, 100);
        }
      } catch (_) { /* ignore */ }

      try {
        const memRes = await window.electron.runSystemCommand('free', ['-m']);
        const lines = cleanLines(memRes.stdout);
        const memLine = lines.find(l => l.startsWith('Mem:'));
        if (memLine) {
          const parts = memLine.split(/\s+/).filter(Boolean);
          if (parts.length >= 3) {
            const totalMb = parseIntSafe(parts[1]);
            const usedMb  = parseIntSafe(parts[2]);
            if (!isNaN(totalMb) && !isNaN(usedMb) && totalMb > 0) {
              ramTotal = totalMb / 1024; // MB → GB
              ramUsed  = usedMb / 1024;
              ramPct   = (ramUsed / ramTotal) * 100;
            }
          }
        }
      } catch (_) { /* ignore */ }
    }

    return { cpuUsage, ramPct, ramUsed, ramTotal };
  }

  /**
   * Fetch GPU & VRAM usage via nvidia-smi.
   * Returns zeros if NVIDIA driver is not available.
   */
  async function queryGPUandVRAM() {
    let gpuUsage = 0;
    let vramPct  = 0;
    let vramUsed = 0;
    let vramTotal = 0;

    try {
      const res = await window.electron.runSystemCommand('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ]);
      const line = (res.stdout || '').split('\n').map(l => l.trim()).filter(Boolean)[0];
      if (line) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 3) {
          gpuUsage  = parseFloat(parts[0]) || 0;
          vramUsed  = parseFloat(parts[1]) || 0;
          vramTotal = parseFloat(parts[2]) || 1;
          vramPct   = (vramUsed / vramTotal) * 100;
        }
      }
    } catch (_) { /* nvidia-smi not available */ }

    return { gpuUsage, vramPct, vramUsed, vramTotal };
  }

  /** Format memory in human-readable form (GB). */
  function fmtMem(gb) {
    if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
    return `${gb.toFixed(1)} GB`;
  }

  /** Update the UI with the latest readings. */
  async function refresh() {
    const [cpuRAM, gpuVRAM] = await Promise.all([
      queryCPUandRAM(),
      queryGPUandVRAM(),
    ]);

    const cpuBar   = container.querySelector('.cpu-bar');
    const ramBar   = container.querySelector('.ram-bar');
    const gpuBar   = container.querySelector('.gpu-bar');
    const vramBar  = container.querySelector('.vram-bar');
    const cpuDtl   = container.querySelector('.cpu-detail');
    const ramDtl   = container.querySelector('.ram-detail');
    const gpuDtl   = container.querySelector('.gpu-detail');
    const vramDtl  = container.querySelector('.vram-detail');
    const updMsg   = container.querySelector('.resource-update-msg');

    // CPU
    const cpuPct = Math.round(cpuRAM.cpuUsage);
    if (cpuBar) cpuBar.style.width = `${cpuPct}%`;
    if (cpuDtl) cpuDtl.textContent = `${cpuPct}%`;

    // RAM
    const ramPct = Math.round(cpuRAM.ramPct);
    if (ramBar) ramBar.style.width = `${ramPct}%`;
    if (ramDtl) ramDtl.textContent = `${fmtMem(cpuRAM.ramUsed)} / ${fmtMem(cpuRAM.ramTotal)} (${ramPct}%)`;

    // GPU
    const gpuPct = Math.round(gpuVRAM.gpuUsage);
    if (gpuBar) gpuBar.style.width = `${gpuPct}%`;
    if (gpuDtl) gpuDtl.textContent = gpuPct > 0 ? `${gpuPct}%` : 'N/A (no NVIDIA GPU detected)';

    // VRAM
    const vramPct = Math.round(gpuVRAM.vramPct);
    if (vramBar) vramBar.style.width = `${vramPct}%`;
    if (vramDtl) {
      if (gpuVRAM.vramTotal > 0) {
        vramDtl.textContent = `${fmtMem(gpuVRAM.vramUsed)} / ${fmtMem(gpuVRAM.vramTotal)} (${vramPct}%)`;
      } else {
        vramDtl.textContent = 'N/A';
      }
    }

    // Update timestamp
    if (updMsg) {
      const now = new Date();
      updMsg.textContent = `updated ${now.toLocaleTimeString()}`;
    }

    // Schedule next refresh in 3 seconds
    setTimeout(refresh, 3000);
  }

  // ── Start the refresh loop ──────────────────────────────────────────────────
  refresh();
}