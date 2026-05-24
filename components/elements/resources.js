/**
 * resources.js — Task-manager/btop-like resource overview element
 *
 * Displays live CPU, RAM, GPU, and VRAM usage in the resources box.
 * This script is loaded by home.js and renders into a target container.
 *
 * Dependencies:
 *  - window.electron.runSystemCommand (IPC) for CLI-based resource queries
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

  /**
   * Extract numeric value from text that may contain \r, \n, trailing junk.
   * Returns -1 if no number found.
   */
  function extractNumber(text) {
    if (!text) return -1;
    const clean = String(text).replace(/[^0-9.]/g, '').trim();
    if (!clean) return -1;
    const val = parseFloat(clean);
    return isNaN(val) ? -1 : val;
  }

  /**
   * Query CPU & RAM on Windows using PowerShell (reliable structured output).
   */
  async function queryWindowsCPUandRAM() {
    let cpuUsage = 0;
    let ramTotal = 0;
    let ramUsed  = 0;
    let ramPct   = 0;

    // CPU via PowerShell: Win32_Processor LoadPercentage
    try {
      const cpuRes = await window.electron.runSystemCommand(
        'powershell',
        ['-Command', '(Get-CimInstance Win32_Processor).LoadPercentage']
      );
      const val = extractNumber(cpuRes.stdout);
      if (val >= 0 && val <= 100) {
        cpuUsage = val;
      }
    } catch (_) { /* fallback to wmic */ }

    // If PowerShell failed, try wmic for CPU
    if (cpuUsage === 0) {
      try {
        const cpuRes = await window.electron.runSystemCommand('wmic', ['cpu', 'get', 'loadpercentage']);
        const val = extractNumber(cpuRes.stdout);
        if (val >= 0 && val <= 100) {
          cpuUsage = val;
        }
      } catch (_) { /* ignore */ }
    }

    // RAM via PowerShell: Win32_OperatingSystem TotalVisibleMemorySize & FreePhysicalMemory (KB)
    try {
      const memRes = await window.electron.runSystemCommand(
        'powershell',
        [
          '-Command',
          '$os = Get-CimInstance Win32_OperatingSystem; ' +
          'Write-Output ($os.TotalVisibleMemorySize.ToString() + \" \" + $os.FreePhysicalMemory.ToString())'
        ]
      );
      const parts = (memRes.stdout || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const totalKb = extractNumber(parts[0]);
        const freeKb  = extractNumber(parts[1]);
        if (totalKb > 0 && freeKb >= 0) {
          ramTotal = totalKb * 0.000001;          // KB → GB
          ramUsed  = (totalKb - freeKb) * 0.000001;
          ramPct   = totalKb > 0 ? (ramUsed / ramTotal) * 100 : 0;
        }
      }
    } catch (_) { /* fallback to wmic */ }

    // Fallback: wmic os get for RAM
    if (ramTotal <= 0) {
      try {
        const memRes = await window.electron.runSystemCommand(
          'wmic',
          ['os', 'get', 'TotalVisibleMemorySize,FreePhysicalMemory']
        );
        const lines = (memRes.stdout || '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            const totalKb = extractNumber(parts[0]);
            const freeKb  = extractNumber(parts[1]);
            if (totalKb > 0 && freeKb >= 0) {
              ramTotal = totalKb * 0.000001;
              ramUsed  = (totalKb - freeKb) * 0.000001;
              ramPct   = (ramUsed / ramTotal) * 100;
              break;
            }
          }
        }
      } catch (_) { /* ignore */ }
    }

    return { cpuUsage, ramPct, ramUsed, ramTotal };
  }

  /**
   * Query CPU & RAM on Linux/Mac using ps and free.
   */
  async function queryUnixCPUandRAM() {
    let cpuUsage = 0;
    let ramTotal = 0;
    let ramUsed  = 0;
    let ramPct   = 0;

    try {
      const cpuRes = await window.electron.runSystemCommand('ps', ['-A', '-o', '%cpu', '--sort=-%cpu', '--no-headers']);
      const lines = (cpuRes.stdout || '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const total = lines.reduce((sum, l) => sum + (parseFloat(l) || 0), 0);
        cpuUsage = Math.min(total / lines.length, 100);
      }
    } catch (_) { /* ignore */ }

    try {
      const memRes = await window.electron.runSystemCommand('free', ['-m']);
      const lines = (memRes.stdout || '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n').map(l => l.trim()).filter(Boolean);
      const memLine = lines.find(l => l.startsWith('Mem:'));
      if (memLine) {
        const parts = memLine.split(/\s+/).filter(Boolean);
        if (parts.length >= 3) {
          const totalMb = extractNumber(parts[1]);
          const usedMb  = extractNumber(parts[2]);
          if (totalMb > 0 && usedMb >= 0) {
            ramTotal = totalMb / 1024;
            ramUsed  = usedMb / 1024;
            ramPct   = (ramUsed / ramTotal) * 100;
          }
        }
      }
    } catch (_) { /* ignore */ }

    return { cpuUsage, ramPct, ramUsed, ramTotal };
  }

  /**
   * Detect platform and route to appropriate query function.
   */
  async function queryCPUandRAM() {
    const isWin = navigator.platform && navigator.platform.startsWith('Win');
    return isWin ? queryWindowsCPUandRAM() : queryUnixCPUandRAM();
  }

  /**
   * Fetch GPU & VRAM usage via nvidia-smi.
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
      // Clean and parse the first data line
      const line = (res.stdout || '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n').map(l => l.trim()).filter(Boolean)[0];
      if (line) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 3) {
          gpuUsage  = extractNumber(parts[0]);
          vramUsed  = extractNumber(parts[1]);
          vramTotal = extractNumber(parts[2]);
          if (gpuUsage < 0) gpuUsage = 0;
          if (vramUsed < 0) vramUsed = 0;
          if (vramTotal <= 0) vramTotal = 1;
          vramPct = (vramUsed / vramTotal) * 100;
        }
      }
    } catch (_) { /* nvidia-smi not available */ }

    return { gpuUsage, vramPct, vramUsed, vramTotal };
  }

  /** Format memory in human-readable form (GB). */
  function fmtMem(gb) {
    if (gb <= 0) return '—';
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
    if (ramDtl) {
      const used = cpuRAM.ramUsed;
      const total = cpuRAM.ramTotal;
      if (total > 0 && used >= 0) {
        ramDtl.textContent = `${fmtMem(used)} / ${fmtMem(total)} (${ramPct}%)`;
      } else {
        ramDtl.textContent = `unable to read (${ramPct}%)`;
      }
    }

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