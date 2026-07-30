(() => {
  'use strict';

  const api = () => window.pywebview?.api || window.electron;

  function humanFlops(flops) {
    if (flops >= 1e12) return (flops / 1e12).toFixed(3) + ' TFLOPS';
    if (flops >= 1e9) return (flops / 1e9).toFixed(3) + ' GFLOPS';
    return flops.toFixed(1) + ' FLOPS';
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  const GLOBAL_PEAKS = [
    { name: 'B200', peak: 67.0, tier: 'datacenter' },
    { name: 'B100', peak: 56.0, tier: 'datacenter' },
    { name: 'H100', peak: 51.0, tier: 'datacenter' },
    { name: 'H200', peak: 51.0, tier: 'datacenter' },
    { name: 'RTX 4090', peak: 82.6, tier: 'enthusiast' },
    { name: 'RTX 4090 D', peak: 73.5, tier: 'enthusiast' },
    { name: 'RTX 4080 Super', peak: 52.2, tier: 'enthusiast' },
    { name: 'RTX 4080', peak: 48.7, tier: 'enthusiast' },
    { name: 'RTX 6000 Ada', peak: 48.7, tier: 'professional' },
    { name: 'RTX 4070 Ti', peak: 40.1, tier: 'high' },
    { name: 'RTX 3090', peak: 35.6, tier: 'enthusiast' },
    { name: 'RTX 3090 Ti', peak: 40.0, tier: 'enthusiast' },
    { name: 'RTX 3080 Ti', peak: 34.1, tier: 'high' },
    { name: 'RTX 3080', peak: 29.8, tier: 'high' },
    { name: 'RTX 5000 Ada', peak: 27.8, tier: 'professional' },
    { name: 'RX 7900 XTX', peak: 61.4, tier: 'enthusiast' },
    { name: 'RX 7900 XT', peak: 45.8, tier: 'enthusiast' },
    { name: 'RX 7900 GRE', peak: 36.5, tier: 'high' },
    { name: 'RX 7800 XT', peak: 33.5, tier: 'high' },
    { name: 'RX 7700 XT', peak: 28.0, tier: 'high' },
    { name: 'RX 6950 XT', peak: 28.2, tier: 'high' },
    { name: 'RX 6900 XT', peak: 26.9, tier: 'high' },
    { name: 'RX 6800 XT', peak: 23.0, tier: 'high' },
    { name: 'RX 6800', peak: 19.3, tier: 'mid' },
    { name: 'RX 6700 XT', peak: 16.6, tier: 'mid' },
    { name: 'RX 7600 XT', peak: 20.6, tier: 'mid' },
    { name: 'RX 7600', peak: 14.9, tier: 'mid' },
    { name: 'RX 6600 XT', peak: 13.2, tier: 'mid' },
    { name: 'RX 6600', peak: 10.6, tier: 'mid' },
    { name: 'RTX 3070 Ti', peak: 21.7, tier: 'high' },
    { name: 'RTX 3070', peak: 20.3, tier: 'high' },
    { name: 'RTX 3060 Ti', peak: 16.2, tier: 'mid' },
    { name: 'RTX 3060', peak: 12.7, tier: 'mid' },
    { name: 'RTX 4060 Ti', peak: 22.1, tier: 'mid' },
    { name: 'RTX 4060', peak: 15.0, tier: 'mid' },
    { name: 'RTX 4070', peak: 29.1, tier: 'high' },
    { name: 'M2 Ultra', peak: 27.2, tier: 'high' },
    { name: 'M1 Ultra', peak: 20.8, tier: 'high' },
    { name: 'M4 Max', peak: 16.4, tier: 'mid' },
    { name: 'M4 Pro', peak: 8.2, tier: 'mid' },
    { name: 'M4', peak: 4.6, tier: 'mid' },
    { name: 'M3 Max', peak: 14.2, tier: 'mid' },
    { name: 'M3 Pro', peak: 7.2, tier: 'mid' },
    { name: 'M3', peak: 4.1, tier: 'mid' },
    { name: 'M2 Max', peak: 13.6, tier: 'mid' },
    { name: 'M2 Pro', peak: 6.8, tier: 'mid' },
    { name: 'M2', peak: 3.6, tier: 'mid' },
    { name: 'M1 Max', peak: 10.4, tier: 'mid' },
    { name: 'M1 Pro', peak: 5.3, tier: 'mid' },
    { name: 'M1', peak: 2.6, tier: 'mid' },
    { name: 'A100', peak: 19.5, tier: 'datacenter' },
    { name: 'Tesla V100', peak: 14.1, tier: 'datacenter' },
    { name: 'Tesla T4', peak: 8.1, tier: 'datacenter' },
    { name: 'A10', peak: 31.2, tier: 'datacenter' },
    { name: 'A30', peak: 10.3, tier: 'datacenter' },
    { name: 'A16', peak: 22.0, tier: 'datacenter' },
  ].sort((a, b) => b.peak - a.peak);

  const GLOBAL_TIERS = [
    { min: 0, max: 3, label: 'Very Low', color: '#f44336', desc: 'Entry-level or integrated graphics. Suitable for basic inference but not intensive training.' },
    { min: 3, max: 8, label: 'Low', color: '#ff8a65', desc: 'Lower mid-range. Can run small models for experimentation.' },
    { min: 8, max: 16, label: 'Moderate', color: '#ffc107', desc: 'Mid-range. Capable of training moderate-sized models.' },
    { min: 16, max: 32, label: 'High', color: '#8bc34a', desc: 'High-end consumer/professional. Handles most models well.' },
    { min: 32, max: Infinity, label: 'Very High', color: '#4caf50', desc: 'Enthusiast or datacenter-class. Suitable for large-scale training.' },
  ];

  function computeGlobalRank(chipPeakTflops, chipName, device) {
    if (!chipPeakTflops && chipName) {
      const matched = GLOBAL_PEAKS.find(p => chipName.toLowerCase().includes(p.name.toLowerCase()));
      if (matched) chipPeakTflops = matched.peak;
    }
    if (!chipPeakTflops) {
      if (device === 'cpu') return { tier: GLOBAL_TIERS[0], rank: 'CPU', pct: 0 };
      return null;
    }

    const total = GLOBAL_PEAKS.length;
    const above = GLOBAL_PEAKS.filter(p => p.peak > chipPeakTflops).length;
    const pct = Math.round((above / total) * 100);
    const tier = GLOBAL_TIERS.find(t => chipPeakTflops >= t.min && chipPeakTflops < t.max) || GLOBAL_TIERS[0];
    return { tier, rank: `Top ${pct}%`, pct, above, total };
  }

  const DESCRIPTIONS = {
    achieved: {
      good: 'Your hardware is delivering strong throughput for this workload. The GPU compute units are being utilized effectively.',
      moderate: 'Throughput is reasonable but there is headroom for improvement. Consider increasing batch size or choosing a compute-heavy model.',
      low: 'Throughput is below typical expectations. This is often expected for small models — try a larger batch size or a more compute-intensive model.',
      unknown: 'Achieved FLOPS represents the real throughput measured across many forward passes. This is what your hardware actually delivers.'
    },
    utilization: {
      high: 'Your workload is saturating the GPU well. The compute units are kept busy and memory bandwidth is not a bottleneck for this model/batch combination.',
      good: 'Decent utilization of the chip\'s theoretical peak. There is some headroom but performance is within the expected range for real workloads.',
      moderate: 'Moderate utilization — typical for smaller models or suboptimal batch sizes. The GPU spends a noticeable fraction of time on overhead rather than compute.',
      low: 'Low utilization is expected for small models like ResNet-18 at modest batch sizes. The GPU is mostly waiting on memory or kernel launch. Try a larger model or batch size.',
      unknown: 'Utilization compares your achieved throughput to the chip\'s theoretical peak. Real workloads typically achieve 10-40% of peak.'
    },
    peak: {
      present: 'The manufacturer-specified theoretical peak throughput for this chip. This number assumes perfectly parallelized, compute-bound operations with no memory bottlenecks.',
      absent: 'Your chip was not found in the peak FLOPS lookup table. Compare your achieved results against your chip\'s published spec sheet manually.'
    }
  };

  function interpretUtilization(pct) {
    if (pct === null || pct === undefined) return { level: 'unknown', color: '#888', label: 'Unknown' };
    if (pct >= 40) return { level: 'high', color: '#4caf50', label: 'Excellent' };
    if (pct >= 25) return { level: 'good', color: '#8bc34a', label: 'Good' };
    if (pct >= 10) return { level: 'moderate', color: '#ffc107', label: 'Moderate' };
    return { level: 'low', color: '#f44336', label: 'Low' };
  }

  function interpretAchieved(achievedFlops, peakTflops) {
    if (peakTflops) {
      const pct = (achievedFlops / (peakTflops * 1e12)) * 100;
      if (pct >= 30) return 'good';
      if (pct >= 10) return 'moderate';
      return 'low';
    }
    return 'unknown';
  }

  function buildInterpretation(data) {
    const parts = [];
    const pct = data.pct_of_peak;
    const util = interpretUtilization(pct);
    const peak = data.peak_tflops;

    const globalRank = computeGlobalRank(peak, data.chip_name, data.device);

    // Overall summary
    if (pct !== null && pct !== undefined) {
      parts.push(`<p>Your hardware achieved <strong>${humanFlops(data.achieved_flops)}</strong>, which is <strong>${pct.toFixed(1)}%</strong> of the chip's theoretical peak of <strong>${peak.toFixed(1)} TFLOPS</strong>. This is rated as <strong style="color:${util.color}">${util.label}</strong> utilization.</p>`);
    } else {
      parts.push(`<p>Your hardware achieved <strong>${humanFlops(data.achieved_flops)}</strong>. Peak FLOPS data is not available in the lookup table for this chip.</p>`);
    }

    // Global ranking summary
    if (globalRank) {
      const t = globalRank.tier;
      parts.push(`<p>Globally, your chip is rated <strong style="color:${t.color}">${t.label}</strong> — ${t.desc} It ranks <strong>${globalRank.rank}</strong> among ${globalRank.total} reference GPUs.</p>`);
    }

    // What affects utilization
    parts.push('<div class="flops-interp-details">');
    parts.push('<h5>What influences these results?</h5>');
    parts.push('<ul>');
    parts.push('<li><strong>Model size & type:</strong> ResNet-style models are memory-bandwidth bound at small batch sizes. ViTs have different compute-to-memory ratios.</li>');
    parts.push(`<li><strong>Batch size:</strong> You used batch size ${data.batch_size}. Larger batches amortize kernel launch overhead and improve utilization.</li>`);
    parts.push('<li><strong>Operation mix:</strong> Real models mix compute-bound ops (large matrix multiplies) and memory-bound ops (activations, small convolutions). Peak FLOPS assumes 100% compute-bound.</li>');
    parts.push('<li><strong>Framework overhead:</strong> PyTorch\'s dispatch, memory allocation, and data movement add overhead that does not contribute to FLOPs.</li>');
    if (data.chip_name) {
      parts.push(`<li><strong>Chip detected:</strong> ${escapeHtml(data.chip_name)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</div>');

    // Tips
    parts.push('<div class="flops-interp-tips">');
    parts.push('<h5>Tips to improve utilization</h5>');
    parts.push('<ul>');
    if (data.batch_size < 32) {
      parts.push('<li><strong>Increase batch size</strong> — batch sizes of 32–128 typically yield better GPU saturation.</li>');
    }
    if (data.model === 'resnet18' || data.model === 'resnet50') {
      parts.push('<li><strong>Try ViT-B/16</strong> — vision transformers are more compute-heavy and can better saturate modern GPUs.</li>');
    }
    parts.push('<li><strong>Use mixed precision (FP16/BF16)</strong> — modern GPUs have 2-8x higher peak throughput in lower precision.</li>');
    parts.push('<li><strong>Fuse operations</strong> — operator fusion reduces kernel launch overhead and memory traffic.</li>');
    parts.push('</ul>');
    parts.push('</div>');

    return parts.join('\n');
  }

  function showResults(data) {
    const resultsEl = document.getElementById('flops-results');
    resultsEl.dataset.rawJson = JSON.stringify(data, null, 2);
    const welcomeEl = document.getElementById('flops-welcome');
    const progressEl = document.getElementById('flops-progress');
    const errorEl = document.getElementById('flops-error');

    welcomeEl.style.display = 'none';
    progressEl.style.display = 'none';
    errorEl.style.display = 'none';
    resultsEl.style.display = 'block';

    const pct = data.pct_of_peak;
    const peak = data.peak_tflops;
    const util = interpretUtilization(pct);

    // Chip badge
    const chipBadge = document.getElementById('flops-chip-badge');
    if (data.chip_name) {
      chipBadge.textContent = data.chip_name + (data.device ? ' (' + data.device + ')' : '');
      chipBadge.style.display = 'inline-block';
    } else {
      chipBadge.textContent = data.device || 'Unknown device';
      chipBadge.style.display = 'inline-block';
    }

    // Metrics
    document.getElementById('flops-achieved').textContent = humanFlops(data.achieved_flops);
    document.getElementById('flops-achieved').style.color = util.color;

    document.getElementById('flops-peak').textContent = peak ? peak.toFixed(1) + ' TFLOPS' : 'Unknown';
    document.getElementById('flops-peak').style.color = peak ? '#ffc107' : '#888';

    document.getElementById('flops-per-pass').textContent = humanFlops(data.flops_per_pass);
    document.getElementById('flops-throughput').textContent = data.inferences_per_sec.toFixed(1) + ' inf/s';
    document.getElementById('flops-params').textContent = (data.params / 1e6).toFixed(2) + ' M';
    document.getElementById('flops-elapsed').textContent = data.elapsed_seconds.toFixed(3) + 's (' + data.iterations + ' iters)';
    document.getElementById('flops-batch-info').textContent = data.batch_size + ' × ' + data.input_size + '×' + data.input_size;

    // Utilization bar
    const barPct = pct !== null && pct !== undefined ? Math.min(pct, 100) : 0;
    const bar = document.getElementById('flops-util-bar');
    bar.style.width = barPct + '%';
    bar.style.background = util.color;

    const utilVal = document.getElementById('flops-utilization');
    if (pct !== null && pct !== undefined) {
      utilVal.textContent = pct.toFixed(1) + '%';
      utilVal.style.color = util.color;
    } else {
      utilVal.textContent = 'N/A';
      utilVal.style.color = '#888';
    }

    const utilInterp = document.getElementById('flops-util-interp');
    utilInterp.textContent = DESCRIPTIONS.utilization[util.level];

    // Global comparison
    const globalRank = computeGlobalRank(peak, data.chip_name, data.device);
    const globalEl = document.getElementById('flops-global');
    const globalBarEl = document.getElementById('flops-global-bar');
    const globalDescEl = document.getElementById('flops-global-desc');
    if (globalRank) {
      const t = globalRank.tier;
      globalEl.textContent = t.label;
      globalEl.style.color = t.color;
      globalBarEl.style.width = Math.min(100 - globalRank.pct, 100) + '%';
      globalBarEl.style.background = t.color;
      globalDescEl.innerHTML = `${t.desc} Your chip is <strong>${globalRank.rank}</strong> of ${globalRank.total} known GPUs by peak FLOPS.`;
    } else {
      globalEl.textContent = 'Unknown';
      globalEl.style.color = '#888';
      globalBarEl.style.width = '0%';
      globalDescEl.textContent = 'Chip not found in the global reference table.';
    }

    // Set per-metric descriptions based on context
    const achievedInfo = interpretAchieved(data.achieved_flops, peak);
    document.getElementById('flops-achieved-desc').textContent = DESCRIPTIONS.achieved[achievedInfo];

    const peakDescEl = document.getElementById('flops-peak-desc');
    peakDescEl.textContent = peak ? DESCRIPTIONS.peak.present : DESCRIPTIONS.peak.absent;

    // Full interpretation section
    document.getElementById('flops-interp-body').innerHTML = buildInterpretation(data);

    // Show export button
    const exportBtn = document.getElementById('flops-export-btn');
    exportBtn.style.display = 'inline-block';
  }

  function showError(msg) {
    const welcomeEl = document.getElementById('flops-welcome');
    const progressEl = document.getElementById('flops-progress');
    const resultsEl = document.getElementById('flops-results');
    const errorEl = document.getElementById('flops-error');

    welcomeEl.style.display = 'none';
    progressEl.style.display = 'none';
    resultsEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.innerHTML = `<strong>Benchmark failed</strong><p>${escapeHtml(msg)}</p>`;
  }

  function showProgress(text) {
    document.getElementById('flops-welcome').style.display = 'none';
    document.getElementById('flops-results').style.display = 'none';
    document.getElementById('flops-error').style.display = 'none';
    document.getElementById('flops-progress').style.display = 'block';
    document.getElementById('flops-progress-text').textContent = text;
  }

  async function runBenchmark() {
    const model = document.getElementById('flops-model').value;
    const batchSize = Math.max(1, parseInt(document.getElementById('flops-batch').value, 10) || 1);
    const installCalflops = document.getElementById('flops-install-calflops').checked;
    const runBtn = document.getElementById('flops-run-btn');
    const exportBtn = document.getElementById('flops-export-btn');

    exportBtn.style.display = 'none';
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';

    showProgress('Starting benchmark…');

    try {
      // Load project folder from recents to use its .venv
      let projectFolder = '';
      try {
        const bridge = api();
        if (window.pywebview?.api) {
          const recents = await bridge.project_recents_read();
          if (recents && recents.open) projectFolder = recents.open;
        } else if (window.electron) {
          const recents = await bridge.projectRecentsRead();
          if (recents && recents.open) projectFolder = recents.open;
        }
      } catch (_) {}

      const bridge = api();
      let result;

      if (window.pywebview?.api) {
        result = await bridge.run_flops_test(batchSize, model, true, projectFolder, installCalflops);
      } else if (window.electron) {
        result = await bridge.runFlopsTest(batchSize, model, true, projectFolder, installCalflops);
      } else {
        throw new Error('No API bridge available');
      }

      const output = result.stdout || '';
      const err = result.stderr || '';

      if (result.code === 0 && output) {
        let data = null;
        try {
          const lines = output.trim().split('\n');
          const jsonLine = lines.find(l => l.startsWith('{') && l.endsWith('}'));
          data = jsonLine ? JSON.parse(jsonLine) : null;
        } catch (e) {
          data = null;
        }

        if (data) {
          showProgress('Parsing results…');
          setTimeout(() => showResults(data), 300);
        } else {
          showError('Could not parse benchmark output. The --json flag may not be supported by this version.\n\nRaw output:\n' + output);
        }
      } else {
        showError(err || output || 'Benchmark returned no output.');
      }
    } catch (e) {
      showError(e.message || String(e));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Benchmark';
    }
  }

  async function exportResults() {
    const resultsEl = document.getElementById('flops-results');
    const rawJson = resultsEl.dataset.rawJson;
    if (!rawJson) return;

    try {
      const bridge = api();
      let exportResult;
      if (window.pywebview?.api) {
        exportResult = await bridge.export_flops_result(rawJson);
      } else if (window.electron) {
        exportResult = await bridge.exportFlopsResult(rawJson);
      } else {
        throw new Error('No API bridge available');
      }

      const btn = document.getElementById('flops-export-btn');
      if (exportResult.success) {
        btn.textContent = 'Exported!';
        setTimeout(() => { btn.textContent = 'Export Results'; }, 2000);
      } else if (exportResult.error) {
        alert('Export failed: ' + exportResult.error);
      }
    } catch (e) {
      alert('Export error: ' + e.message);
    }
  }

  function init() {
    document.getElementById('flops-run-btn').addEventListener('click', runBenchmark);
    document.getElementById('flops-export-btn').addEventListener('click', exportResults);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
