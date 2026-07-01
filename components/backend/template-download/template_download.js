'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { readRecents } = require('../project-store');

const TEMPLATES_PATH = path.join(__dirname, '..', '..', 'templates.json');

function readTemplates() {
  try {
    if (!fs.existsSync(TEMPLATES_PATH)) return {};
    const raw = fs.readFileSync(TEMPLATES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error('Failed to read template definitions:', e);
  }
  return {};
}

function getImportTargetFolder() {
  const recents = readRecents() || {};
  const openFolder = typeof recents.open === 'string' && recents.open ? recents.open : null;
  if (!openFolder) {
    throw new Error('No open folder is available in recents.json.');
  }
  return openFolder;
}

function getTemplateDefinition(templateKey) {
  const templates = readTemplates();
  return templates[templateKey] || null;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;

    const request = transport.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(resolve));
      fileStream.on('error', reject);
    });

    request.on('error', reject);
  });
}

function extractArchive(archivePath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: 'utf8' }
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || 'Failed to extract archive with PowerShell.');
    }
    return;
  }

  const result = spawnSync('unzip', ['-o', archivePath, '-d', extractDir], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to extract archive with unzip.');
  }
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function getExtractedSourceRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => entry.name !== '.DS_Store');

  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

async function importTemplate(templateKey, targetDir = null) {
  const template = getTemplateDefinition(templateKey);
  if (!template) {
    throw new Error(`Template "${templateKey}" was not found.`);
  }

  const downloadUrl = template.dl || template.url;
  if (!downloadUrl) {
    throw new Error(`Template "${templateKey}" does not define a download URL.`);
  }

  const destinationDir = targetDir || getImportTargetFolder();
  fs.mkdirSync(destinationDir, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mama-template-'));
  const archivePath = path.join(tempRoot, `${template.name || templateKey}.zip`);
  const extractDir = path.join(tempRoot, 'extracted');

  try {
    await downloadFile(downloadUrl, archivePath);
    extractArchive(archivePath, extractDir);

    const sourceRoot = getExtractedSourceRoot(extractDir);
    copyDirectoryContents(sourceRoot, destinationDir);

    return {
      success: true,
      destinationDir,
      templateKey,
      templateName: template.name || templateKey,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  readTemplates,
  getImportTargetFolder,
  getTemplateDefinition,
  importTemplate,
};
