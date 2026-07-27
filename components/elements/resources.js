/**
 * resources.js — btop-style resource monitor widget.
 *
 * Displays live CPU, RAM, GPU, and VRAM usage with configurable refresh rate.
 *
 * ELECTRON → PYWBVIEW CONVERSION:
 * Previously used window.electron.runSystemCommand() via Electron IPC.
 * Now delegates command execution to the Python bridge via
 * window.pywebview.api.run_system_command(cmd, args)
 *
 * ── Bridge method used ────────────────────────────────────────────────────
 *   run_system_command(cmd, args) →  { code, stdout, stderr }
 *
 * ── Platform / GPU support ────────────────────────────────────────────────
 *
 *   CPU / RAM
 *     Windows   PowerShell Get-CimInstance
 *     Linux     top -bn2 -d0.1  +  free -b (available column)
 *     macOS     top -l 2        +  vm_stat + sysctl hw.memsize
 *
 *   GPU / VRAM
 *     NVIDIA       nvidia-smi       (all platforms)
 *     Windows any  PDH counters     (AMD / Intel / any, no extra drivers)
 *     AMD Linux    rocm-smi --json  → /sys/class/drm sysfs fallback
 *     macOS        ioreg IOAccelerator → PerformanceStatistics
 *                  Works on Apple Silicon (AGXAccelerator) and Intel iGPU.
 *                  No sudo required.
 *                  "In use system memory" is GPU-held bytes of unified RAM;
 *                  vramTotal = hw.memsize (no fixed VRAM pool on Apple Silicon).
 */

'use strict';

// ── Platform detection ─────────────────────────────────────────────────────

const PLATFORM = (() => {
  const p  = (navigator.platform  || '').toLowerCase();
  const ua = (navigator.userAgent || '').toLowerCase();
  if (p.startsWith('win') || ua.includes('windows'))                        return 'windows';
  if (p.startsWith('mac') || ua.includes('macintosh') || ua.includes('mac os')) return 'macos';
  return 'linux';
})();

// ── Widget entry point ─────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {object}      [opts]
 * @param {object}      [opts.gpuConfig]  Saved GPU info from setup wizard.
 *   { manufacturer, name, cudaVersion, rocmVersion, metalVersion, mpsAvailable }
 */
function initResourcesWidget(container, opts = {}) {
  if (!container) return;

  const gpuConfig      = opts.gpuConfig || null;
  const hasConfiguredGPU = gpuConfig
    && gpuConfig.manufacturer
    && gpuConfig.manufacturer !== 'none';

  // ── Static HTML ──────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="resources-widget">
      <div class="resources-header">
        <span class="resources-title">System Resources</span>
        <label class="resources-interval-label">
          Refresh every
          <input id="res-interval-input" class="resources-interval-slider"
            type="range" min="1" max="60" step="1" value="3">
          <span id="res-interval-value" class="resources-interval-value">3s</span>
        </label>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">CPU</div>
        <div class="resource-bar-track"><div class="resource-bar cpu-bar" style="width:0%"></div></div>
        <div class="resource-detail cpu-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">RAM</div>
        <div class="resource-bar-track"><div class="resource-bar ram-bar" style="width:0%"></div></div>
        <div class="resource-detail ram-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">GPU</div>
        <div class="resource-bar-track"><div class="resource-bar gpu-bar" style="width:0%"></div></div>
        <div class="resource-detail gpu-detail">—</div>
      </div>

      <div class="resource-group">
        <div class="resource-group-title">VRAM</div>
        <div class="resource-bar-track"><div class="resource-bar vram-bar" style="width:0%"></div></div>
        <div class="resource-detail vram-detail">—</div>
      </div>

      <div class="resource-update-msg">waiting for first reading…</div>
    </div>
  `;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function cmd(command, args = []) {
    if (window.pywebview && window.pywebview.api) {
      return window.pywebview.api.run_system_command(command, args);
    }
    console.error('No pywebview API bridge available — cannot run command', command);
    return { code: 1, stdout: '', stderr: 'No pywebview API bridge' };
  }

  function parseFirst(text) {
    const m = String(text || '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const gib = bytes / (1024 ** 3);
    if (gib >= 1) return `${gib.toFixed(1)} GiB`;
    return `${(bytes / (1024 ** 2)).toFixed(0)} MiB`;
  }

  function clampPct(v) {
    return Math.min(100, Math.max(0, v || 0));
  }

  // ── CPU ───────────────────────────────────────────────────────────────────

  async function getCPUWindows() {
    try {
      const r = await cmd('powershell', [
        '-NoProfile', '-Command',
        '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'
      ]);
      const v = parseFirst(r.stdout);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    } catch (_) {}
    try {
      const r = await cmd('wmic', ['cpu', 'get', 'loadpercentage', '/value']);
      const m = (r.stdout || '').match(/LoadPercentage=(\d+)/i);
      if (m) return clampPct(parseFloat(m[1]));
    } catch (_) {}
    return 0;
  }

  async function getCPULinux() {
    try {
      const r = await cmd('top', ['-bn2', '-d0.1']);
      const lines = (r.stdout || '').split('\n')
        .filter(l => /^(%Cpu|Cpu\(s\))/i.test(l.trim()));
      const line = lines[lines.length - 1] || '';
      const m = line.match(/(\d+(?:\.\d+)?)\s*%?\s*id/i);
      if (m) return clampPct(100 - parseFloat(m[1]));
    } catch (_) {}
    try {
      const r = await cmd('cat', ['/proc/stat']);
      const line = (r.stdout || '').split('\n').find(l => l.startsWith('cpu '));
      if (line) {
        const parts = line.trim().split(/\s+/).slice(1).map(Number);
        const idle  = (parts[3] || 0) + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        return clampPct(total > 0 ? ((total - idle) / total) * 100 : 0);
      }
    } catch (_) {}
    return 0;
  }

  async function getCPUMacOS() {
    try {
      const r = await cmd('top', ['-l', '2', '-s', '0', '-n', '0', '-stats', 'cpu']);
      const lines = (r.stdout || '').split('\n').filter(l => /CPU usage:/i.test(l));
      const line  = lines[lines.length - 1] || '';
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

  // ── RAM ───────────────────────────────────────────────────────────────────

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
          const total = totalKiB * 1024;
          const used  = (totalKiB - freeKiB) * 1024;
          return { total, used, pct: clampPct((used / total) * 100) };
        }
      }
    } catch (_) {}
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

  async function getRAMLinux() {
    try {
      const r = await cmd('free', ['-b']);
      const line = (r.stdout || '').split('\n').find(l => l.trim().startsWith('Mem:'));
      if (line) {
        const parts = line.trim().split(/\s+/);
        const total     = parseFloat(parts[1]);
        const available = parseFloat(parts[6]);
        if (!isNaN(total) && total > 0 && !isNaN(available)) {
          const used = total - available;
          return { total, used, pct: clampPct((used / total) * 100) };
        }
      }
    } catch (_) {}
    return { total: 0, used: 0, pct: 0 };
  }

  async function getRAMMacOS() {
    try {
      const [sysR, vmR] = await Promise.all([
        cmd('sysctl', ['-n', 'hw.memsize']),
        cmd('vm_stat'),
      ]);
      const total = parseFloat((sysR.stdout || '').trim());
      if (isNaN(total) || total <= 0) throw new Error('no total');

      const vmLines  = (vmR.stdout || '').split('\n');
      const psMatch  = vmLines[0].match(/page size of (\d+) bytes/i);
      const pageSize = psMatch ? parseInt(psMatch[1]) : 4096;

      function pages(label) {
        const line = vmLines.find(l => l.includes(label));
        if (!line) return 0;
        const m = line.match(/(\d+)/);
        return m ? parseInt(m[1]) : 0;
      }

      const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * pageSize;
      return { total, used, pct: clampPct((used / total) * 100) };
    } catch (_) {}
    return { total: 0, used: 0, pct: 0 };
  }

  async function getRAM() {
    if (PLATFORM === 'windows') return getRAMWindows();
    if (PLATFORM === 'macos')   return getRAMMacOS();
    return getRAMLinux();
  }

  // ── GPU ───────────────────────────────────────────────────────────────────

  /** NVIDIA via nvidia-smi (all platforms). */
  async function getGPUNvidia() {
    try {
      const r = await cmd('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ]);
      if (r.code !== 0 || !r.stdout.trim()) return null;
      const parts = r.stdout.trim().split('\n')[0].split(',').map(p => parseFloat(p.trim()));
      if (parts.length < 3 || parts.some(isNaN)) return null;
      const [gpuPct, usedMiB, totalMiB] = parts;
      const vramUsed  = usedMiB  * 1024 * 1024;
      const vramTotal = totalMiB * 1024 * 1024;
      return {
        gpuPct: clampPct(gpuPct), vramUsed, vramTotal,
        vramPct: clampPct((vramUsed / vramTotal) * 100),
        source: 'nvidia', available: true,
      };
    } catch (_) { return null; }
  }

  /** AMD via rocm-smi JSON (Linux + ROCm). */
  async function getGPUROCm() {
    try {
      const r = await cmd('rocm-smi', ['--showuse', '--showmeminfo', 'vram', '--json']);
      if (r.code !== 0 || !r.stdout.trim()) return null;
      const data    = JSON.parse(r.stdout);
      const cardKey = Object.keys(data).find(k => k.startsWith('card'));
      if (!cardKey) return null;
      const card      = data[cardKey];
      const gpuPct    = parseFloat(card['GPU use (%)']              || '0');
      const vramTotal = parseFloat(card['VRAM Total Memory (B)']    || '0');
      const vramUsed  = parseFloat(card['VRAM Total Used Memory (B)'] || '0');
      if (isNaN(vramTotal) || vramTotal <= 0) return null;
      return {
        gpuPct: clampPct(gpuPct), vramUsed, vramTotal,
        vramPct: clampPct((vramUsed / vramTotal) * 100),
        source: 'rocm', available: true,
      };
    } catch (_) { return null; }
  }

  /** AMD sysfs fallback (Linux, no ROCm needed). */
  async function getGPUSysfs() {
    for (const card of ['card0', 'card1', 'card2']) {
      const base = `/sys/class/drm/${card}/device`;
      try {
        const [busyR, usedR, totalR] = await Promise.all([
          cmd('cat', [`${base}/gpu_busy_percent`]),
          cmd('cat', [`${base}/mem_info_vram_used`]),
          cmd('cat', [`${base}/mem_info_vram_total`]),
        ]);
        if (busyR.code !== 0) continue;
        const gpuPct    = clampPct(parseFirst(busyR.stdout));
        const vramUsed  = parseFirst(usedR.stdout)  || 0;
        const vramTotal = parseFirst(totalR.stdout) || 0;
        if (vramTotal < 64 * 1024 * 1024) continue;  // skip iGPU / system-RAM GPU
        return {
          gpuPct, vramUsed, vramTotal,
          vramPct: clampPct(vramTotal > 0 ? (vramUsed / vramTotal) * 100 : 0),
          source: 'sysfs', available: true,
        };
      } catch (_) { continue; }
    }
    return null;
  }

  /**
   * Windows GPU via PDH performance counters.
   * Works for AMD, NVIDIA, Intel — no vendor tools required.
   */
  async function getGPUWindows() {
    try {
      const script =
        '$GpuMemTotal = (((Get-Counter "\\GPU Process Memory(*)\\Local Usage").CounterSamples ' +
          '| where CookedValue).CookedValue | measure -sum).sum; ' +
        'Write-Output "MEM:$([math]::Round($GpuMemTotal/1MB, 4))"; ' +
        '$GpuUseTotal = (((Get-Counter "\\GPU Engine(*engtype_3D)\\Utilization Percentage").CounterSamples ' +
          '| where CookedValue).CookedValue | measure -sum).sum; ' +
        'Write-Output "USE:$([math]::Round($GpuUseTotal, 4))"; ' +
        '$vc = Get-CimInstance Win32_VideoController ' +
          '| Where-Object { $_.Name -notmatch "Microsoft|Basic|Remote" } ' +
          '| Sort-Object AdapterRAM -Descending | Select-Object -First 1; ' +
        'Write-Output "TOTAL:$($vc.AdapterRAM)"';

      const r = await cmd('powershell', ['-NoProfile', '-Command', script]);
      if (r.code !== 0 || !r.stdout.trim()) return null;

      const val = (prefix) => {
        const line = (r.stdout || '').split('\n').find(l => l.trimStart().startsWith(prefix));
        if (!line) return NaN;
        return parseFloat(line.slice(line.indexOf(':') + 1).trim());
      };

      const vramUsedMB = val('MEM:');
      const gpuPct     = val('USE:');
      const vramTotalB = val('TOTAL:');
      if (isNaN(vramUsedMB) && isNaN(gpuPct)) return null;

      const vramUsed  = (vramUsedMB  || 0) * 1024 * 1024;
      const vramTotal = isNaN(vramTotalB) ? 0 : vramTotalB;
      return {
        gpuPct: clampPct(gpuPct || 0), vramUsed, vramTotal,
        vramPct: vramTotal > 0 ? clampPct((vramUsed / vramTotal) * 100) : 0,
        source: 'windows-pdh', available: true,
      };
    } catch (_) { return null; }
  }

  /**
   * macOS GPU via ioreg IOAccelerator → PerformanceStatistics.
   *
   * Works on Apple Silicon (AGXAccelerator) and Intel iGPU (IntelAccelerator).
   * No sudo required — ioreg reads public IOKit registry entries.
   *
   * Fields read from PerformanceStatistics:
   *   "Device Utilization %"  → gpuPct   (0–100)
   *   "In use system memory"  → vramUsed (bytes of unified RAM held by GPU)
   *
   * vramTotal = hw.memsize (total system RAM) because Apple Silicon has no
   * fixed VRAM pool — GPU memory is carved from unified RAM on demand.
   */
  async function getGPUMacOS() {
    try {
      const [ioregR, memR] = await Promise.all([
        cmd('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']),
        cmd('sysctl', ['-n', 'hw.memsize']),
      ]);

      if (ioregR.code !== 0 || !ioregR.stdout.trim()) return null;

      const out = ioregR.stdout;

      // Parse a named integer field from the PerformanceStatistics dictionary.
      // ioreg prints it as:  "Device Utilization %" = 12
      function ioField(name) {
        // Escape special regex chars in the field name (the % sign)
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = out.match(new RegExp(`"${escaped}"\\s*=\\s*(\\d+)`));
        return m ? parseInt(m[1], 10) : null;   // m[1], NOT m.group(1)
      }

      const gpuPct   = ioField('Device Utilization %');
      const vramUsed = ioField('In use system memory');

      // If neither field exists this probably isn't an accelerator with stats
      if (gpuPct === null && vramUsed === null) return null;

      const vramTotal = parseFloat((memR.stdout || '').trim()) || 0;

      return {
        gpuPct:    clampPct(gpuPct   ?? 0),
        vramUsed:  vramUsed ?? 0,
        vramTotal,
        vramPct:   vramTotal > 0 ? clampPct(((vramUsed ?? 0) / vramTotal) * 100) : 0,
        source:    'ioreg',
        available: true,
      };
    } catch (_) { return null; }
  }

  /**
   * Try all GPU backends in priority order.
   *
   * Windows:  nvidia-smi → PDH (AMD / Intel / any)
   * Linux:    nvidia-smi → rocm-smi → sysfs
   * macOS:    nvidia-smi (eGPU) → ioreg (Apple Silicon / Intel iGPU)
   */
  async function getGPU() {
    const result =
      (await getGPUNvidia()) ||
      (PLATFORM === 'windows' ? await getGPUWindows() : null) ||
      (PLATFORM === 'linux'   ? await getGPUROCm()    : null) ||
      (PLATFORM === 'linux'   ? await getGPUSysfs()   : null) ||
      (PLATFORM === 'macos'   ? await getGPUMacOS()   : null) ||   // ← was missing
      { gpuPct: 0, vramUsed: 0, vramTotal: 0, vramPct: 0, source: 'none', available: false };
    return result;
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function setBar(sel, pct)  { const el = container.querySelector(sel); if (el) el.style.width = `${clampPct(pct)}%`; }
  function setText(sel, txt) { const el = container.querySelector(sel); if (el) el.textContent = txt; }

  // ── Refresh loop ──────────────────────────────────────────────────────────

  let refreshTimer    = null;
  let refreshInFlight = false;

  function getRefreshSeconds() {
    const v = parseInt(container.querySelector('#res-interval-input')?.value, 10);
    return Math.min(60, Math.max(1, Number.isFinite(v) ? v : 3));
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, getRefreshSeconds() * 1000);
  }

  function restartRefreshTimer() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!refreshInFlight) refresh();
  }

  async function refresh() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }

    try {
      const [cpu, ram, gpu] = await Promise.all([getCPU(), getRAM(), getGPU()]);

      // ── CPU ──────────────────────────────────────────────────────────────
      const cpuPct = Math.round(cpu);
      setBar('.cpu-bar', cpuPct);
      setText('.cpu-detail', `${cpuPct}%`);

      // ── RAM ──────────────────────────────────────────────────────────────
      const ramPct = Math.round(ram.pct);
      setBar('.ram-bar', ramPct);
      setText('.ram-detail', ram.total > 0
        ? `${fmtBytes(ram.used)} / ${fmtBytes(ram.total)} (${ramPct}%)`
        : 'unavailable');

      // ── GPU ──────────────────────────────────────────────────────────────
      const gpuPct = Math.round(gpu.gpuPct);
      setBar('.gpu-bar', gpuPct);

      if (!hasConfiguredGPU) {
        setText('.gpu-detail', 'not configured');
        setBar('.gpu-bar', 0);
      } else if (gpu.available) {
        // Build suffix: prefer gpuConfig metadata, fall back to source tag
        let suffix = '';
        if (gpuConfig.manufacturer === 'apple') {
          const metalTag = gpuConfig.metalVersion ? ` Metal ${gpuConfig.metalVersion}` : '';
          const mpsTag   = gpuConfig.mpsAvailable === 'true' ? ' · MPS' : '';
          const name     = gpuConfig.name || 'Apple GPU';
          suffix = `  [${name}${metalTag}${mpsTag}]`;
        } else {
          const sourceLabel = {
            'nvidia':      'NVIDIA',
            'rocm':        'AMD/ROCm',
            'sysfs':       'AMD/sysfs',
            'windows-pdh': 'PDH',
            'ioreg':       'Apple GPU',
          }[gpu.source] || '';
          if (sourceLabel) suffix = `  [${sourceLabel}]`;
        }
        setText('.gpu-detail', `${gpuPct}%${suffix}`);
      } else {
        setText('.gpu-detail', 'N/A — no supported GPU detected');
      }

      // ── VRAM ─────────────────────────────────────────────────────────────
      const vramPct = Math.round(gpu.vramPct);
      setBar('.vram-bar', vramPct);

      if (!hasConfiguredGPU) {
        setText('.vram-detail', 'not configured');
      } else if (gpu.available && gpu.vramTotal > 0) {
        // Apple unified memory: label makes clear this isn't a fixed VRAM pool
        const detail = gpu.source === 'ioreg'
          ? `${fmtBytes(gpu.vramUsed)} GPU  /  ${fmtBytes(gpu.vramTotal)} unified (${vramPct}%)`
          : `${fmtBytes(gpu.vramUsed)} / ${fmtBytes(gpu.vramTotal)} (${vramPct}%)`;
        setText('.vram-detail', detail);
      } else if (gpuConfig?.manufacturer === 'apple') {
        setText('.vram-detail', 'unified memory — no fixed VRAM pool');
      } else {
        setText('.vram-detail', 'N/A');
      }

      // ── Timestamp ────────────────────────────────────────────────────────
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

  // ── Interval slider ───────────────────────────────────────────────────────

  const intervalInput = container.querySelector('#res-interval-input');
  const intervalValue = container.querySelector('#res-interval-value');

  function updateIntervalDisplay() {
    if (intervalValue) intervalValue.textContent = `${getRefreshSeconds()}s`;
  }

  intervalInput?.addEventListener('input',  () => { updateIntervalDisplay(); restartRefreshTimer(); });
  intervalInput?.addEventListener('change', () => { updateIntervalDisplay(); restartRefreshTimer(); });

  updateIntervalDisplay();

  // ── Kick off ──────────────────────────────────────────────────────────────
  refresh();
}