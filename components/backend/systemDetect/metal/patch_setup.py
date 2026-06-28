#!/usr/bin/env python3
"""Patch setup.js for Metal/MPS/Apple GPU support."""
import sys

path = '/Users/eelnedaj/Documents/git/mama/components/setup/setup.js'

with open(path, 'rb') as f:
    data = f.read()

NL = b'\r\n' if b'\r\n' in data else b'\n'
print(f"Detected {'CRLF' if NL == b'\\r\\n' else 'LF'} line endings")

def replace(old_str, new_str):
    global data
    old = old_str.replace('\n', NL.decode()).encode('utf-8')
    new = new_str.replace('\n', NL.decode()).encode('utf-8')
    count = data.count(old)
    if count == 0:
        print(f"  FAILED: pattern not found")
        return False
    data = data.replace(old, new)
    print(f"  OK: {count} occurrence(s)")
    return True

# Parse metal/mps/gpuType fields after driverVersion
print("\n[1] Adding Metal/MPS/GPU_TYPE field parsing...")
replace(
    """            detected.driverVersion   = kv['DRIVER_VERSION']  || '';""",
    """            detected.driverVersion   = kv['DRIVER_VERSION']  || '';
            detected.metalVersion    = kv['METAL_VERSION']   || '';
            detected.mpsAvailable    = kv['MPS_AVAILABLE']   || '';
            detected.gpuType         = kv['GPU_TYPE']        || '';"""
)

# Add apple to mfrLabel map
print("\n[2] Adding Apple to manufacturer label map...")
replace(
    """            const mfrLabel = {
              nvidia: 'NVIDIA',
              amd:    'AMD',
              intel:  'Intel',
              none:   'None / CPU only'
            }[detected.gpuManufacturer] || 'Unknown';""",
    """            const mfrLabel = {
              nvidia: 'NVIDIA',
              amd:    'AMD',
              apple:  'Apple',
              intel:  'Intel',
              none:   'None / CPU only'
            }[detected.gpuManufacturer] || 'Unknown';"""
)

# Update accelStr to include Metal and add mpsStr
print("\n[3] Updating accelStr and adding mpsStr...")
replace(
    """            const vramStr  = detected.gpuVramMB ? ` — ${(detected.gpuVramMB / 1024).toFixed(1)} GB VRAM` : '';
            const accelStr = detected.cudaVersion ? ` (CUDA ${detected.cudaVersion})`
                           : detected.rocmVersion ? ` (ROCm ${detected.rocmVersion})`
                           : '';""",
    """            const vramStr = detected.gpuVramMB
              ? ` — ${(detected.gpuVramMB / 1024).toFixed(1)} GB VRAM`
              : '';
            const accelStr = detected.cudaVersion
              ? ` (CUDA ${detected.cudaVersion})`
              : detected.rocmVersion
                ? ` (ROCm ${detected.rocmVersion})`
                : detected.metalVersion
                  ? ` (Metal ${detected.metalVersion})`
                  : '';
            const mpsStr = detected.mpsAvailable === 'true'
              ? ' — MPS available'
              : '';"""
)

# Update GPU detected message to include mpsStr
print("\n[4] Updating GPU detected message...")
replace(
    """                  ✅ GPU detected: <strong>${escapeHtml(detected.gpuName)}</strong>${escapeHtml(vramStr + accelStr)}""",
    """                  ✅ GPU detected: <strong>${escapeHtml(detected.gpuName)}</strong>${escapeHtml(vramStr + accelStr + mpsStr)}"""
)

replace(
    """              out.innerHTML = `<div class="setup-success-msg">✅ ${mfrLabel} GPU detected${escapeHtml(accelStr)}</div>`;""",
    """              out.innerHTML = `<div class="setup-success-msg">✅ ${mfrLabel} GPU detected${escapeHtml(accelStr + mpsStr)}</div>`;"""
)

# 5) Add Apple to manufacturer dropdown
print("\n[5] Adding Apple to manufacturer dropdown...")
replace(
    """              <option value="nvidia">NVIDIA</option>
              <option value="amd">AMD</option>
              <option value="intel">Intel</option>
              <option value="none">None / CPU only</option>""",
    """              <option value="nvidia">NVIDIA</option>
              <option value="amd">AMD</option>
              <option value="apple">Apple (MPS / Metal)</option>
              <option value="intel">Intel</option>
              <option value="none">None / CPU only</option>"""
)

# 6) Update gpuVariantLabel for Apple
print("\n[6] Updating gpuVariantLabel()...")
replace(
    """    if (mfr === 'amd')    return detected.rocmVersion ? `ROCm ${detected.rocmVersion}` : 'ROCm (version unknown)';
    return 'CPU-only';
  }""",
    """    if (mfr === 'amd')    return detected.rocmVersion ? `ROCm ${detected.rocmVersion}` : 'ROCm (version unknown)';
    if (mfr === 'apple')  return `MPS${detected.metalVersion ? ` (Metal ${detected.metalVersion})` : ''}`;
    return 'CPU-only';
  }"""
)

# 7) Update gpuVariant for Apple
print("\n[7] Updating gpuVariant()...")
replace(
    """    if (detected.gpuManufacturer === 'nvidia') return 'cuda';
    if (detected.gpuManufacturer === 'amd')    return 'rocm';
    return 'cpu';""",
    """    if (detected.gpuManufacturer === 'nvidia') return 'cuda';
    if (detected.gpuManufacturer === 'amd')    return 'rocm';
    if (detected.gpuManufacturer === 'apple')  return 'mps';
    return 'cpu';"""
)

with open(path, 'wb') as f:
    f.write(data)
print("\nAll done!")
