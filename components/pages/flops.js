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

    // Overall summary
    if (pct !== null && pct !== undefined) {
      parts.push(`<p>Your hardware achieved <strong>${humanFlops(data.achieved_flops)}</strong>, which is <strong>${pct.toFixed(1)}%</strong> of the chip's theoretical peak of <strong>${peak.toFixed(1)} TFLOPS</strong>. This is rated as <strong style="color:${util.color}">${util.label}</strong> utilization.</p>`);
    } else {
      parts.push(`<p>Your hardware achieved <strong>${humanFlops(data.achieved_flops)}</strong>. Peak FLOPS data is not available in the lookup table for this chip.</p>`);
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
    const runBtn = document.getElementById('flops-run-btn');
    const exportBtn = document.getElementById('flops-export-btn');

    exportBtn.style.display = 'none';
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';

    showProgress('Starting benchmark…');

    try {
      const bridge = api();
      let result;

      if (window.pywebview?.api) {
        result = await bridge.run_flops_test(batchSize, model, true);
      } else if (window.electron) {
        result = await bridge.runFlopsTest(batchSize, model, true);
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
