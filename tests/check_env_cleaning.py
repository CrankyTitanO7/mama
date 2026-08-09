#!/usr/bin/env python3
"""check_env_cleaning.py — flags subprocess.Popen()/.run() calls that don't
pass env=clean_subprocess_env(). Catches the exact bug class found in
bridge.py: a fix applied at one call site but not propagated to the rest.

Usage:
    python check_env_cleaning.py bridge.py [other_files.py ...]

Exit 1 (and prints each offending line) if any call site is missing it —
safe to drop into CI or a pre-commit hook.
"""
import re
import sys


def scan(path):
    src = open(path).read()
    bad = []
    for m in re.finditer(r'subprocess\.(?:Popen|run)\(', src):
        depth, i = 1, m.end()
        while depth and i < len(src):
            depth += (src[i] == '(') - (src[i] == ')')
            i += 1
        call_text = src[m.start():i]
        if 'clean_subprocess_env' not in call_text:
            bad.append(src.count('\n', 0, m.start()) + 1)
    return bad


if __name__ == '__main__':
    exit_code = 0
    for path in sys.argv[1:]:
        for line_no in scan(path):
            print(f"{path}:{line_no}: subprocess call missing env=clean_subprocess_env()")
            exit_code = 1
    if exit_code == 0:
        print("✅ all subprocess calls pass env=clean_subprocess_env()")
    sys.exit(exit_code)