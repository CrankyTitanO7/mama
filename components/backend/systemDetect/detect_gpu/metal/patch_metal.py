#!/usr/bin/env python3
"""Patch metal/detect_metal.py to fix ioreg detection for all Mac GPUs."""
import os
path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'detect_metal.py'
)

with open(path, 'rb') as f:
    data = f.read()

# Detect line ending style
NL = b'\r\n' if b'\r\n' in data else b'\n'
enc = NL.decode()

old_fn = (
    'def detect_via_ioreg():\n'
    '    """Use ioreg to detect GPU class and VRAM.\n'
    '\n'
    '    ioreg -l -w0 -c IOAccelerator lists every GPU-like IO service.\n'
    '    Discrete GPUs expose "VRAM,total" with their dedicated memory size.\n'
    '    Apple Silicon iGPUs and Intel Iris do NOT expose that key.\n'
    '\n'
    '    Returns dict with keys:\n'
    '        gpu_count, has_discrete_vram, vram_bytes, model_hint\n'
    '    or None if detection fails.\n'
    '    """\n'
    '    if sys.platform != "darwin":\n'
    '        return None\n'
    '\n'
    '    code, out, _ = run(["ioreg", "-l", "-w0", "-c", "IOAccelerator"])\n'
    '    if code != 0 or not out.strip():\n'
    '        return None\n'
    '\n'
    '    lines = out.splitlines()\n'
    '\n'
    '    gpu_count = 0\n'
    '    has_discrete_vram = False\n'
    '    vram_bytes = 0\n'
    '    model_hint = ""\n'
    '\n'
    '    for line in lines:\n'
    '        stripped = line.strip()\n'
    '\n'
    '        if \'"class" = "IOAccelerator"\' in stripped:\n'
    '            gpu_count += 1\n'
    '\n'
    '        if \'"VRAM,total"\' in stripped:\n'
    '            has_discrete_vram = True\n'
    '            m = re.search(r\'"VRAM,total"\\s*=\\s*(\\d+)\', stripped)\n'
    '            if m:\n'
    '                val = int(m.group(1))\n'
    '                if val > vram_bytes:\n'
    '                    vram_bytes = val\n'
    '\n'
    '        if not model_hint and (\'"model"\' in stripped or \'"IOName"\' in stripped):\n'
    '            m = re.search(r\'=\\s*"([^"]+)"\', stripped)\n'
    '            if m:\n'
    '                model_hint = m.group(1)\n'
    '\n'
    '    if gpu_count == 0:\n'
    '        return None\n'
    '\n'
    '    return {\n'
    '        "gpu_count": gpu_count,\n'
    '        "has_discrete_vram": has_discrete_vram,\n'
    '        "vram_bytes": vram_bytes,\n'
    '        "model_hint": model_hint,\n'
    '    }'
).replace('\n', enc)

new_fn = (
    'def detect_via_ioreg():\n'
    '    """Use ioreg to detect GPU class and VRAM.\n'
    '\n'
    '    Apple Silicon uses AGXAccelerator/AppleCLCD classes, not IOAccelerator.\n'
    '    Tries multiple classes and uses the first one that has results.\n'
    '    """\n'
    '    if sys.platform != "darwin":\n'
    '        return None\n'
    '\n'
    '    classes_to_try = ["IOAccelerator", "AGXAccelerator", "AppleCLCD",\n'
    '                      "AppleIntelFramebuffer", "IODISPLAY"]\n'
    '\n'
    '    best = None\n'
    '    for cls in classes_to_try:\n'
    '        code, out, _ = run(["ioreg", "-l", "-w0", "-c", cls])\n'
    '        if code != 0 or not out.strip():\n'
    '            continue\n'
    '\n'
    '        lines = out.splitlines()\n'
    '        gpu_count = 0\n'
    '        has_discrete_vram = False\n'
    '        vram_bytes = 0\n'
    '        model_hint = ""\n'
    '\n'
    '        for line in lines:\n'
    '            stripped = line.strip()\n'
    '\n'
    '            # Count class appearances (any variation)\n'
    '            if \'"class"\' in stripped:\n'
    '                gpu_count += 1\n'
    '\n'
    '            # Discrete GPU VRAM (hex or decimal)\n'
    '            if \'"VRAM\' in stripped and \'total\' in stripped.lower():\n'
    '                has_discrete_vram = True\n'
    '                m = re.search(r\'"(?:VRAM|vram)[^"]*total[^"]*"\\s*=\\s*(\\d+)\', stripped)\n'
    '                if m:\n'
    '                    try:\n'
    '                        val = int(m.group(1))\n'
    '                        if val > vram_bytes:\n'
    '                            vram_bytes = val\n'
    '                    except ValueError:\n'
    '                        pass\n'
    '\n'
    '            if not model_hint:\n'
    '                for key in (\'"model"\', \'"IOName"\', \'"IOModel"\', \'"ProductName"\',\n'
    '                            \'"IOClass"\', \'"IOPCIDevice"\'):\n'
    '                    if key in stripped:\n'
    '                        m = re.search(r\'=\\s*"([^"]+)"\', stripped)\n'
    '                        if m:\n'
    '                            model_hint = m.group(1)\n'
    '                            break\n'
    '\n'
    '        if gpu_count > 0 or has_discrete_vram:\n'
    '            best = {\n'
    '                "gpu_count": gpu_count if gpu_count > 0 else 1,\n'
    '                "has_discrete_vram": has_discrete_vram,\n'
    '                "vram_bytes": vram_bytes,\n'
    '                "model_hint": model_hint,\n'
    '            }\n'
    '            break  # Use first class with results\n'
    '\n'
    '    return best'
).replace('\n', enc)

old_b = old_fn.encode('utf-8')
new_b = new_fn.encode('utf-8')

if old_b in data:
    data = data.replace(old_b, new_b)
    with open(path, 'wb') as f:
        f.write(data)
    print("OK: detect_via_ioreg patched successfully")
else:
    print("FAILED: old text not found")
    # Find approximate location
    idx = data.find(b'detect_via_ioreg')
    if idx >= 0:
        print(f"Found function at byte {idx}")
        print(data[idx:idx+200])
    else:
        print("Function not found!")
