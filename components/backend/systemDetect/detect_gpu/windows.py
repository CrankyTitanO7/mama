"""Windows GPU detection via wmic and PowerShell."""
import sys
from .base import run, _name_to_manufacturer


def try_windows_wmi():
    if sys.platform != "win32":
        return None

    code, out, _ = run([
        "wmic", "path", "Win32_VideoController",
        "get", "Name,AdapterRAM,DriverVersion",
        "/format:csv"
    ])
    if code == 0 and out.strip():
        for line in out.strip().splitlines():
            if not line.strip() or line.lower().startswith("node"):
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            adapter_ram    = parts[1]
            driver_version = parts[2]
            gpu_name       = parts[3]
            if not gpu_name:
                continue
            manufacturer = _name_to_manufacturer(gpu_name)
            if manufacturer == "none":
                continue
            vram_mb = ""
            try:
                ram_bytes = int(adapter_ram)
                if ram_bytes > 0:
                    vram_mb = str(ram_bytes // (1024 * 1024))
            except (ValueError, TypeError):
                pass
            return {
                "manufacturer":   manufacturer,
                "name":           gpu_name,
                "vram_mb":        vram_mb,
                "cuda_version":   "",
                "rocm_version":   "",
                "driver_version": driver_version,
            }

    ps_cmd = (
        "Get-WmiObject Win32_VideoController | "
        "Select-Object Name,AdapterRAM,DriverVersion | "
        "ConvertTo-Csv -NoTypeInformation"
    )
    code, out, _ = run(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=20)
    if code != 0 or not out.strip():
        return None

    lines = [l for l in out.strip().splitlines() if l.strip() and not l.startswith('"Name"')]
    for line in lines:
        parts = [p.strip().strip('"') for p in line.split(",")]
        if len(parts) < 3:
            continue
        gpu_name       = parts[0]
        adapter_ram    = parts[1]
        driver_version = parts[2]
        if not gpu_name:
            continue
        manufacturer = _name_to_manufacturer(gpu_name)
        if manufacturer == "none":
            continue
        vram_mb = ""
        try:
            ram_bytes = int(adapter_ram)
            if ram_bytes > 0:
                vram_mb = str(ram_bytes // (1024 * 1024))
        except (ValueError, TypeError):
            pass
        return {
            "manufacturer":   manufacturer,
            "name":           gpu_name,
            "vram_mb":        vram_mb,
            "cuda_version":   "",
            "rocm_version":   "",
            "driver_version": driver_version,
        }

    return None