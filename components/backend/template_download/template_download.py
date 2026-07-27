#!/usr/bin/env python3
"""
template_download.py — Python equivalent of template_download.js
Handles downloading and extracting project templates.
"""

import os
import json
import shutil
import tempfile
import urllib.request
import subprocess
import sys
import logging
from pathlib import Path

logger = logging.getLogger('mama.template_download')

TEMPLATES_PATH = Path(__file__).resolve().parent.parent.parent / 'templates.json'
RECENTS_PATH = Path(__file__).resolve().parent.parent.parent / 'recents.json'


def read_templates() -> dict:
    """Read template definitions from templates.json."""
    if not TEMPLATES_PATH.exists():
        return {}
    try:
        data = json.loads(TEMPLATES_PATH.read_text('utf-8'))
        if isinstance(data, dict):
            return data
    except Exception as e:
        logger.error('Failed to read templates: %s', e)
    return {}


def get_import_target_folder() -> str:
    """Get the target folder for template import from recents."""
    if RECENTS_PATH.exists():
        try:
            recents = json.loads(RECENTS_PATH.read_text('utf-8'))
            open_folder = recents.get('open')
            if open_folder:
                return open_folder
        except Exception:
            pass
    raise ValueError('No open folder is available in recents.json.')


def download_file(url: str, dest_path: str):
    """Download a file from URL to destination path."""
    urllib.request.urlretrieve(url, dest_path)


def extract_archive(archive_path: str, extract_dir: str):
    """Extract a zip archive to the given directory."""
    os.makedirs(extract_dir, exist_ok=True)

    if sys.platform == 'win32':
        # Use PowerShell on Windows
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             f"Expand-Archive -Path '{archive_path}' -DestinationPath '{extract_dir}' -Force"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr or 'Failed to extract archive with PowerShell.')
    else:
        # Use unzip on Unix
        result = subprocess.run(
            ['unzip', '-o', archive_path, '-d', extract_dir],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr or 'Failed to extract archive with unzip.')


def copy_directory_contents(source_dir: str, target_dir: str):
    """Copy all contents from source directory to target directory."""
    os.makedirs(target_dir, exist_ok=True)
    for item in os.listdir(source_dir):
        source_path = os.path.join(source_dir, item)
        target_path = os.path.join(target_dir, item)
        if os.path.isdir(source_path):
            shutil.copytree(source_path, target_path, dirs_exist_ok=True)
        else:
            shutil.copy2(source_path, target_path)


def get_extracted_source_root(extract_dir: str) -> str:
    """Get the actual source root after extraction (handles single-dir archives)."""
    entries = [e for e in os.listdir(extract_dir) if e != '.DS_Store']
    if len(entries) == 1:
        single_path = os.path.join(extract_dir, entries[0])
        if os.path.isdir(single_path):
            return single_path
    return extract_dir


def import_template(template_key: str, target_dir: str = None) -> dict:
    """Import a template by key, downloading and extracting it."""
    templates = read_templates()
    template = templates.get(template_key)
    if not template:
        raise ValueError(f'Template "{template_key}" was not found.')

    download_url = template.get('dl') or template.get('url')
    if not download_url:
        raise ValueError(f'Template "{template_key}" does not define a download URL.')

    destination_dir = target_dir or get_import_target_folder()
    os.makedirs(destination_dir, exist_ok=True)

    temp_dir = tempfile.mkdtemp(prefix='mama-template-')
    archive_path = os.path.join(temp_dir, f"{template.get('name', template_key)}.zip")
    extract_dir = os.path.join(temp_dir, 'extracted')

    try:
        download_file(download_url, archive_path)
        extract_archive(archive_path, extract_dir)

        source_root = get_extracted_source_root(extract_dir)
        copy_directory_contents(source_root, destination_dir)

        return {
            'success': True,
            'destinationDir': destination_dir,
            'templateKey': template_key,
            'templateName': template.get('name', template_key),
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)