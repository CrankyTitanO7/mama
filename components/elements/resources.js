/**
 * resources.js — btop-style resource monitor widget.
 *
 * Displays live CPU, RAM, GPU, and VRAM usage with configurable refresh rate.
 * Supports NVIDIA (nvidia-smi) and AMD (rocm-smi → sysfs fallback) GPUs.
 *
 * ── Required IPC (add to ipc-handlers.js + preload.js) ────────────────────
 *
 *   ipc-handlers.js:
 *     ipcMain.handle('run-system-command', async (_event, cmd, args = []) => {
 *       return new Promise((resolve) => {
 *         const proc = spawn(cmd, args, { env: process.env });
 *         let stdout = '', stderr = '';
 *         proc.stdout.on('data', d => stdout += d);
 *         proc.stderr.on('data', d => stderr += d);
 *         proc.on('close', code => resolve({ code: code ?? 0, stdout, stderr }));
 *         proc.on('error', err => resolve({ code: 1, stdout: '', stderr: err.message }));
 *       });
 *     });
 *
 *   preload.js:
 *     runSystemCommand: (cmd, args = []) => ipcRenderer.invoke('run-system-command', cmd, args),
 *
 * ── Platform support ──────────────────────────────────────────────────────
 *
 *   CPU / RAM
 *     Windows  PowerShell Get-CimInstance Win32_Processor + Win32_OperatingSystem
 *     Linux    top -bn2 -d0.1 (CPU)  +  free -b using available column (RAM)
 *     macOS    top -l 2 -s 0 (CPU)   +  vm_stat + sysctl hw.memsize (RAM)
 *
 *   GPU / VRAM
 *     NVIDIA   nvidia-smi --query-gpu (all platforms)
 *  AMD      rocm-smi --json (Linux + ROCm)
 * /   
 //              → /sys/class/drm/card*/
 // device/gpu_busy_percent sysfs (Linux fallback)
 /*              → N/A on Windows AMD (no equivalent CLI without extra drivers)
 */

'use strict';

// ── Platform detection ─────────────────────────────────────────────────────

const PLATFORM = (() => {
  const p  = (navigator.platform  || '').toLowerCase();
  const ua = (navigator.userAgent || '').toLowerCase();
  if (p.startsWith('win') || ua.includes('windows')) return 'windows';
  if (p.startsWith('mac') || ua.includes('macintosh') || ua.includes('mac os')) return 'macos';
  return 'linux';
})();

// ── Widget entry point ─────────────────────────────────────────────────────

/**
 * Initialise the resource monitor inside a container element.
 * @param {HTMLElement} container
 */
function initResourcesWidget(container) {
  if (!container) return;

  // ── Static HTML ──────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="resources-widget">

      <div class="resources-header">
        <span class="resources-title">System Resources</span>
        <label class="resources-interval-label">
          Refresh every
          <input
            id="res-interval-input"
            class="resources-interval-input"
            type="number"
            min="1" max="60" step="1"
            value="3"
          >
          s
        </label>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">CPU</div>
        <div class="resource-bar-track">
          <div class="resource-bar cpu-bar" style="width:0%"></div>
        </div>
        <div class="resource-detail cpu-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">RAM</div>
        <div class="resource-bar-track">
          <div class="resource-bar ram-bar" style="width:0%"></div>
        </div>
        <div class="resource-detail ram-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">GPU</div>
        <div class="resource-bar-track">
          <div class="resource-bar gpu-bar" style="width:0%"></div>
        </div>
        <div class="resource-detail gpu-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">VRAM</div>
        <div class="resource-bar-track">
          <div class="resource-bar vram-bar" style="width:0%"></div>
        </div>
        <div class="resource-detail vram-detail">—</div>
      </div>

      <div class="resource-update-msg">waiting for first reading…</div>
    </div>
  `;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Run a system command via Electron IPC. */
  function cmd(command, args = []) {
    return window.electron.runSystemCommand(command, args);
  }

  /**
   * Parse the first float found in a string.
   * Returns NaN on failure rather than -1 so callers can use isNaN().
   */
  function parseFirst(text) {
    const m = String(text || '').match(/[\d]+(?:\.[\d]+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  /** Bytes → GiB string, e.g. "7.8 GiB" or "512 MiB". */
  function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const gib = bytes / (1024 ** 3);
    if (gib >= 1) return `${gib.toFixed(1)} GiB`;
    return `${(bytes / (1024 ** 2)).toFixed(0)} MiB`;
  }

  /** Clamp a percentage value to [0, 100]. */
  function clampPct(v) {
    return Math.min(100, Math.max(0, v || 0));
  }

  // ── CPU queries ──────────────────────────────────────────────────────────

  /**
   * Windows CPU via PowerShell (Get-CimInstance Win32_Processor).
   * Returns 0–100 load percentage.
   */
  async function getCPUWindows() {
    try {
      const r = await cmd('powershell', [
        '-NoProfile', '-Command',
        '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'
      ]);
      const v = parseFirst(r.stdout);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    } catch (_) {}

    // Fallback: wmic (deprecated but still present on older Windows)
    try {
      const r = await cmd('wmic', ['cpu', 'get', 'loadpercentage', '/value']);
      const m = (r.stdout || '').match(/LoadPercentage=(\d+)/i);
      if (m) return clampPct(parseFloat(m[1]));
    } catch (_) {}

    return 0;
  }

  /**
   * Linux CPU via top (two samples, 100ms apart → accurate delta reading).
   * Parses "id" (idle) field and returns 100 - idle.
   *
   * top -bn2 -d0.1 output (second sample):
   *   %Cpu(s):  5.0 us,  2.0 sy, ..., 92.5 id, ...
   */
  async function getCPULinux() {
    try {
      const r = await cmd('top', ['-bn2', '-d0.1']);
      const lines = (r.stdout || '')
        .split('\n')
        .filter(l => /^(%Cpu|Cpu\(s\))/i.test(l.trim()));

      // Use the last matching line (second top sample)
      const line = lines[lines.length - 1] || '';

      // Match "92.5 id" or "92.5%id"
      const m = line.match(/(\d+(?:\.\d+)?)\s*%?\s*id/i);
      if (m) return clampPct(100 - parseFloat(m[1]));
    } catch (_) {}

    // Fallback: /proc/stat snapshot (less accurate — one sample only)
    try {
      const r = await cmd('cat', ['/proc/stat']);
      const line = (r.stdout || '').split('\n').find(l => l.startsWith('cpu '));
      if (line) {
        const parts = line.trim().split(/\s+/).slice(1).map(Number);
        // [user, nice, system, idle, iowait, irq, softirq, steal]
        const idle  = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
        const total = parts.reduce((a, b) => a + b, 0);
        return clampPct(total > 0 ? ((total - idle) / total) * 100 : 0);
      }
    } catch (_) {}

    return 0;
  }

  /**
   * macOS CPU via top (two samples, accurate delta).
   * Parses "CPU usage: X% user, Y% sys, Z% idle"
   * from the second sample line.
   */
  async function getCPUMacOS() {
    try {
      const r = await cmd('top', ['-l', '2', '-s', '0', '-n', '0', '-stats', 'cpu']);
      const lines = (r.stdout || '')
        .split('\n')
        .filter(l => /CPU usage:/i.test(l));

      const line = lines[lines.length - 1] || '';
      // "CPU usage: 12.50% user, 6.25% sys, 81.25% idle"
      const m = line.match(/(\d+(?:\.\d+)?)\s*%\s*idle/i);
      if (m) return clampPct(100 - parseFloat(m[1]));
    } catch (_) {}

    return 0;
  }

  async function getCPU() {
    if (PLATFORM === 'windows') return getCPUWindows();
    if (PLATFORM === 'macos')   return getCPUMacOS();
    return getCPULinux();
  }

  // ── RAM queries ──────────────────────────────────────────────────────────

  /**
   * RAM result shape: { used: bytes, total: bytes, pct: 0-100 }
   */

  /**
   * Windows RAM via PowerShell.
   * Win32_OperatingSystem reports TotalVisibleMemorySize and FreePhysicalMemory in KB.
   * Correct conversion: KiB / 1048576 → GiB  (NOT * 0.000001 which is ~5% wrong).
   */
  async function getRAMWindows() {
    try {
      const r = await cmd('powershell', [
        '-NoProfile', '-Command',
        '$os = Get-CimInstance Win32_OperatingSystem; ' +
        'Write-Output ($os.TotalVisibleMemorySize.ToString() + " " + $os.FreePhysicalMemory.ToString())'
      ]);
      const parts = (r.stdout || '').trim().split(/\s+/);
      if (parts.length >= 2) {
        const totalKiB = parseFloat(parts[0]);
        const freeKiB  = parseFloat(parts[1]);
        if (!isNaN(totalKiB) && totalKiB > 0) {
          const total = totalKiB * 1024;          // KiB → bytes
          const used  = (totalKiB - freeKiB) * 1024;
          return { total, used, pct: clampPct((used / total) * 100) };
        }
      }
    } catch (_) {}

    // Fallback: wmic os get (same fields, older Windows)
    try {
      const r = await cmd('wmic', ['os', 'get', 'TotalVisibleMemorySize,FreePhysicalMemory', '/value']);
      const totalM = (r.stdout || '').match(/TotalVisibleMemorySize=(\d+)/i);
      const freeM  = (r.stdout || '').match(/FreePhysicalMemory=(\d+)/i);
      if (totalM && freeM) {
        const total = parseFloat(totalM[1]) * 1024;
        const used  = (parseFloat(totalM[1]) - parseFloat(freeM[1])) * 1024;
        return { total, used, pct: clampPct((used / total) * 100) };
      }
    } catch (_) {}

    return { total: 0, used: 0, pct: 0 };
  }

  /**
   * Linux RAM via `free -b` (bytes, so no unit conversion rounding).
   *
   * `free -b` columns: total used free shared buff/cache available
   *
   * "used" shown in htop / GNOME System Monitor =  total - available
   * This correctly excludes reclaimable page cache and buffers,
   * giving the memory that is actually committed to processes.
   */
  async function getRAMLinux() {
    try {
      const r = await cmd('free', ['-b']);
      const line = (r.stdout || '')
        .split('\n')
        .find(l => l.trim().startsWith('Mem:'));
      if (line) {
        const parts = line.trim().split(/\s+/);
        // parts: ["Mem:", total, used, free, shared, buff/cache, available]
        const total     = parseFloat(parts[1]);
        const available = parseFloat(parts[6]);   // ← key fix: use available, not parts[2]
        if (!isNaN(total) && total > 0 && !isNaN(available)) {
          const used = total - available;
          return { total, used, pct: clampPct((used / total) * 100) };
        }
      }
    } catch (_) {}

    return { total: 0, used: 0, pct: 0 };
  }

  /**
   * macOS RAM via vm_stat + sysctl.
   *
   * sysctl -n hw.memsize → total bytes
   * vm_stat              → page counts (page size declared on first line)
   *
   * used = (active + wired + occupied-by-compressor) × page_size
   * This matches Activity Monitor's "Memory Used" figure.
   */
  async function getRAMMacOS() {
    try {
      const [sysR, vmR] = await Promise.all([
        cmd('sysctl', ['-n', 'hw.memsize']),
        cmd('vm_stat'),
      ]);

      const total = parseFloat((sysR.stdout || '').trim());
      if (isNaN(total) || total <= 0) throw new Error('no total');

      // Parse page size from first line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
      const vmLines  = (vmR.stdout || '').split('\n');
      const psMatch  = vmLines[0].match(/page size of (\d+) bytes/i);
      const pageSize = psMatch ? parseInt(psMatch[1]) : 4096;

      function pages(label) {
        const line = vmLines.find(l => l.includes(label));
        if (!line) return 0;
        const m = line.match(/([\d]+)/);
        return m ? parseInt(m[1]) : 0;
      }

      const active     = pages('Pages active');
      const wired      = pages('Pages wired down');
      const compressed = pages('Pages occupied by compressor');

      const used = (active + wired + compressed) * pageSize;
      return { total, used, pct: clampPct((used / total) * 100) };
    } catch (_) {}

    return { total: 0, used: 0, pct: 0 };
  }

  async function getRAM() {
    if (PLATFORM === 'windows') return getRAMWindows();
    if (PLATFORM === 'macos')   return getRAMMacOS();
    return getRAMLinux();
  }

  // ── GPU / VRAM queries ───────────────────────────────────────────────────

  /**
   * GPU result shape:
   *   { gpuPct, vramUsed, vramTotal, vramPct, source, available }
   *   source: 'nvidia' | 'rocm' | 'sysfs' | 'none'
   */

  /** NVIDIA via nvidia-smi (all platforms). */
  async function getGPUNvidia() {
    try {
      const r = await cmd('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ]);
      if (r.code !== 0 || !r.stdout.trim()) return null;

      // First GPU: "5, 1024, 12288" (MiB)
      const line  = r.stdout.trim().split('\n')[0];
      const parts = line.split(',').map(p => parseFloat(p.trim()));
      if (parts.length < 3 || parts.some(isNaN)) return null;

      const [gpuPct, vramUsedMiB, vramTotalMiB] = parts;
      const vramUsed  = vramUsedMiB  * 1024 * 1024;   // MiB → bytes
      const vramTotal = vramTotalMiB * 1024 * 1024;
      return {
        gpuPct: clampPct(gpuPct),
        vramUsed,
        vramTotal,
        vramPct: clampPct((vramUsed / vramTotal) * 100),
        source: 'nvidia',
        available: true,
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * AMD via rocm-smi JSON (Linux + ROCm installed).
   *
   * rocm-smi --showuse --showmeminfo vram --json
   * Output: {"card0": {"GPU use (%)": "5", "VRAM Total Memory (B)": "8589934592",
   *                    "VRAM Total Used Memory (B)": "1073741824"}}
   */
  async function getGPUROCm() {
    try {
      const r = await cmd('rocm-smi', ['--showuse', '--showmeminfo', 'vram', '--json']);
      if (r.code !== 0 || !r.stdout.trim()) return null;

      const data    = JSON.parse(r.stdout);
      const cardKey = Object.keys(data).find(k => k.startsWith('card'));
      if (!cardKey) return null;

      const card       = data[cardKey];
      const gpuPct     = parseFloat(card['GPU use (%)'] || '0');
      const vramTotal  = parseFloat(card['VRAM Total Memory (B)'] || '0');
      const vramUsed   = parseFloat(card['VRAM Total Used Memory (B)'] || '0');

      if (isNaN(vramTotal) || vramTotal <= 0) return null;
      return {
        gpuPct:    clampPct(gpuPct),
        vramUsed,
        vramTotal,
        vramPct:   clampPct((vramUsed / vramTotal) * 100),
        source:    'rocm',
        available: true,
      };
    } catch (_) {
      // rocm-smi not installed, JSON parse failed, etc.
      return null;
    }
  }

  /**
   * AMD sysfs fallback (Linux, no ROCm required — works with plain amdgpu kernel driver).
   *
   * /sys/class/drm/card0/device/gpu_busy_percent   → e.g. "5\n"
   * /sys/class/drm/card0/device/mem_info_vram_used  → bytes
   * /sys/class/drm/card0/device/mem_info_vram_total → bytes
   *
   * Tries card0 first, then card1 (multi-GPU or iGPU-present systems).
   */
  async function getGPUSysfs() {
    for (const card of ['card0', 'card1', 'card2']) {
      const base = `/sys/class/drm/${card}/device`;
      try {
        const [busyR, usedR, totalR] = await Promise.all([
          cmd('cat', [`${base}/gpu_busy_percent`]),
          cmd('cat', [`${base}/mem_info_vram_used`]),
          cmd('cat', [`${base}/mem_info_vram_total`]),
        ]);

        if (busyR.code !== 0) continue;   // this card doesn't have the file; skip

        const gpuPct    = clampPct(parseFirst(busyR.stdout));
        const vramUsed  = parseFirst(usedR.stdout)  || 0;
        const vramTotal = parseFirst(totalR.stdout) || 0;

        // If total is 0 or very small it's an iGPU using system RAM — skip
        if (vramTotal < 64 * 1024 * 1024) continue;

        return {
          gpuPct,
          vramUsed,
          vramTotal,
          vramPct:   clampPct(vramTotal > 0 ? (vramUsed / vramTotal) * 100 : 0),
          source:    'sysfs',
          available: true,
        };
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  /**
   * Windows GPU via PDH performance counters (works for AMD, NVIDIA, Intel —
   * no vendor-specific tools required, just the standard Windows GPU driver).
   *
   * Counter paths (backslashes doubled for JS string literals):
   *   \GPU Process Memory(*)\Local Usage      → current VRAM used (bytes)
   *   \GPU Engine(*engtype_3D)\Utilization Percentage → 3D engine usage (%)
   *
   * `| where CookedValue` filters out zero/null samples correctly.
   * A separate Win32_VideoController query gives total VRAM.
   * Note: AdapterRAM is a 32-bit WMI field — it caps at ~4 GB for cards with
   * more VRAM (e.g. RX 7900 XTX 24 GB shows as 4 GB). No reliable workaround
   * exists without vendor SDK; the bar will still work, only the label is off.
   */
  async function getGPUWindows() {
    try {
      const script =
        // VRAM used: sum Local Usage across all GPU process memory instances
        '$GpuMemTotal = (((Get-Counter "\\GPU Process Memory(*)\\Local Usage").CounterSamples ' +
          '| where CookedValue).CookedValue | measure -sum).sum; ' +
        'Write-Output "MEM:$([math]::Round($GpuMemTotal/1MB, 4))"; ' +

        // GPU utilisation: sum 3D engine utilisation across all engine instances
        '$GpuUseTotal = (((Get-Counter "\\GPU Engine(*engtype_3D)\\Utilization Percentage").CounterSamples ' +
          '| where CookedValue).CookedValue | measure -sum).sum; ' +
        'Write-Output "USE:$([math]::Round($GpuUseTotal, 4))"; ' +

        // Total VRAM from WMI — grab the adapter with the most dedicated RAM
        '$vc = Get-CimInstance Win32_VideoController ' +
          '| Where-Object { $_.Name -notmatch "Microsoft|Basic|Remote" } ' +
          '| Sort-Object AdapterRAM -Descending ' +
          '| Select-Object -First 1; ' +
        'Write-Output "TOTAL:$($vc.AdapterRAM)"';

      const r = await cmd('powershell', ['-NoProfile', '-Command', script]);
      if (r.code !== 0 || !r.stdout.trim()) return null;

      // Parse labeled output lines
      const val = (prefix) => {
        const line = (r.stdout || '').split('\n').find(l => l.trimStart().startsWith(prefix));
        if (!line) return NaN;
        return parseFloat(line.slice(line.indexOf(':') + 1).trim());
      };

      const vramUsedMB  = val('MEM:');    // MB
      const gpuPct      = val('USE:');    // %
      const vramTotalB  = val('TOTAL:'); // bytes (may be capped at ~4 GB by WMI)

      // If all three failed the counters aren't available on this system
      if (isNaN(vramUsedMB) && isNaN(gpuPct)) return null;

      const vramUsed  = (vramUsedMB  || 0) * 1024 * 1024;  // MB → bytes
      const vramTotal = isNaN(vramTotalB) ? 0 : vramTotalB; // already bytes from WMI

      return {
        gpuPct:    clampPct(gpuPct   || 0),
        vramUsed,
        vramTotal,
        vramPct:   vramTotal > 0 ? clampPct((vramUsed / vramTotal) * 100) : 0,
        source:    'windows-pdh',
        available: true,
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Try all GPU backends in priority order.
   *
   * Windows:  nvidia-smi (NVIDIA) → PDH counters (AMD / Intel / any)
   * Linux:    nvidia-smi → rocm-smi → sysfs
   * macOS:    nvidia-smi (eGPU edge case only; Apple Silicon not supported)
   */
  async function getGPU() {
    const result =
      (await getGPUNvidia()) ||
      (PLATFORM === 'windows' ? await getGPUWindows()  : null) ||
      (PLATFORM === 'linux'   ? await getGPUROCm()     : null) ||
      (PLATFORM === 'linux'   ? await getGPUSysfs()    : null) ||
      { gpuPct: 0, vramUsed: 0, vramTotal: 0, vramPct: 0, source: 'none', available: false };
    return result;
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function setBar(selector, pct) {
    const el = container.querySelector(selector);
    if (el) el.style.width = `${clampPct(pct)}%`;
  }

  function setText(selector, text) {
    const el = container.querySelector(selector);
    if (el) el.textContent = text;
  }

  // ── Refresh loop ─────────────────────────────────────────────────────────

  let refreshTimer = null;
  let refreshInFlight = false;

  function getRefreshSeconds() {
    const input = container.querySelector('#res-interval-input');
    const parsed = parseInt(input?.value, 10);
    return Math.min(60, Math.max(1, Number.isFinite(parsed) ? parsed : 3));
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    const seconds = getRefreshSeconds();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, seconds * 1000);
  }

  function restartRefreshTimer() {
    clearRefreshTimer();
    if (!refreshInFlight) {
      refresh();
    }
    // If a refresh is in flight, its finally block schedules with the new interval.
  }

  async function refresh() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    clearRefreshTimer();

    try {
      const [cpu, ram, gpu] = await Promise.all([getCPU(), getRAM(), getGPU()]);

      // CPU
      const cpuPct = Math.round(cpu);
      setBar('.cpu-bar', cpuPct);
      setText('.cpu-detail', `${cpuPct}%`);

      // RAM
      const ramPct = Math.round(ram.pct);
      setBar('.ram-bar', ramPct);
      if (ram.total > 0) {
        setText('.ram-detail',
          `${fmtBytes(ram.used)} / ${fmtBytes(ram.total)} (${ramPct}%)`);
      } else {
        setText('.ram-detail', 'unavailable');
      }

      // GPU
      const gpuPct = Math.round(gpu.gpuPct);
      setBar('.gpu-bar', gpuPct);
      if (gpu.available) {
        const label = gpu.source === 'nvidia'      ? 'NVIDIA' :
                      gpu.source === 'rocm'        ? 'AMD/ROCm' :
                      gpu.source === 'sysfs'       ? 'AMD/sysfs' :
                      gpu.source === 'windows-pdh' ? 'PDH' : '';
        setText('.gpu-detail', `${gpuPct}%${label ? `  [${label}]` : ''}`);
      } else {
        setText('.gpu-detail', 'N/A — no supported GPU detected');
      }

      // VRAM
      const vramPct = Math.round(gpu.vramPct);
      setBar('.vram-bar', vramPct);
      if (gpu.available && gpu.vramTotal > 0) {
        setText('.vram-detail',
          `${fmtBytes(gpu.vramUsed)} / ${fmtBytes(gpu.vramTotal)} (${vramPct}%)`);
      } else {
        setText('.vram-detail', 'N/A');
      }

      // Timestamp
      setText('.resource-update-msg',
        `updated ${new Date().toLocaleTimeString()} · every ${getRefreshSeconds()}s`);
    } catch (err) {
      console.error('resources widget refresh failed:', err);
      setText('.resource-update-msg', 'refresh failed — retrying…');
    } finally {
      refreshInFlight = false;
      scheduleRefresh();
    }
  }

  const intervalInput = container.querySelector('#res-interval-input');
  intervalInput?.addEventListener('input', restartRefreshTimer);
  intervalInput?.addEventListener('change', restartRefreshTimer);

  // ── Kick off ──────────────────────────────────────────────────────────────
  refresh();
}