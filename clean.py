import pathlib
import shutil

userfiles = {""}

for p in pathlib.Path('.').rglob('__pycache__'):
    if p.is_dir():
        shutil.rmtree(p)
        print(f"Removed: {p}")

shutil.rmtree()