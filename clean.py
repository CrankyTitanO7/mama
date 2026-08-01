import pathlib
import shutil

# Directories to skip when cleaning (managed by pip / pyinstaller / git)
SKIP_DIRS = {".venv", "venv", "build", "dist", ".git", "node_modules"}

# Specific user-generated files to remove
USER_FILES = [
    "user/settings.json",
    "user/settings.json.bak",
    "components/recents.json",
    "user/install.log",
]


def should_skip(path: pathlib.Path) -> bool:
    """Return True if any component of the path is in SKIP_DIRS."""
    return any(part in SKIP_DIRS for part in path.parts)


def remove_pycache(root: pathlib.Path) -> None:
    """Remove all __pycache__ directories under root (excluding skipped dirs)."""
    for p in root.rglob("__pycache__"):
        if should_skip(p):
            continue
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
            print(f"Removed directory: {p}")


def remove_cache_files(root: pathlib.Path) -> None:
    """Remove compiled Python cache files (*.pyc, *.pyo, *.pyd, *$py.class) and *.cache files."""
    patterns = ["*.pyc", "*.pyo", "*.pyd", "*$py.class", "*.cache"]
    for pattern in patterns:
        for p in root.rglob(pattern):
            if should_skip(p):
                continue
            if p.is_file():
                p.unlink(missing_ok=True)
                print(f"Removed file: {p}")


def remove_user_files(root: pathlib.Path) -> None:
    """Remove specific user-generated files."""
    for rel in USER_FILES:
        p = root / rel
        if p.is_file():
            p.unlink(missing_ok=True)
            print(f"Removed file: {p}")


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent
    print(f"Cleaning from: {root}\n")

    remove_pycache(root)
    remove_cache_files(root)
    remove_user_files(root)

    print("\nDone.")


if __name__ == "__main__":
    main()