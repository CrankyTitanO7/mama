// PyTorch Runner Component
// This script executes pytorch_runner.py from the python directory
// Electron IPC version (fix for sandboxed renderer)

document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ PyRunner loaded successfully');
    
    // Create UI elements
    const container = document.createElement('div');
    container.style.margin = '20px 0';
    
    // Install Dependencies Button
    const installBtn = document.createElement('button');
    installBtn.textContent = '🔧 Install PyTorch Dependencies';
    installBtn.style.padding = '10px 18px';
    installBtn.style.marginRight = '10px';
    installBtn.style.cursor = 'pointer';
    installBtn.style.backgroundColor = '#4CAF50';
    installBtn.style.color = 'white';
    installBtn.style.border = 'none';
    installBtn.style.borderRadius = '4px';
    
    // Run Script Button
    const runButton = document.createElement('button');
    runButton.textContent = '▶ Run PyTorch Script';
    runButton.style.padding = '10px 18px';
    runButton.style.cursor = 'pointer';
    runButton.style.backgroundColor = '#2196F3';
    runButton.style.color = 'white';
    runButton.style.border = 'none';
    runButton.style.borderRadius = '4px';
    
    // Output container
    const outputContainer = document.createElement('div');
    outputContainer.id = 'pytorch-output';
    outputContainer.style.marginTop = '20px';
    outputContainer.style.padding = '15px';
    outputContainer.style.backgroundColor = '#f5f5f5';
    outputContainer.style.borderRadius = '5px';
    outputContainer.style.fontFamily = 'monospace';
    outputContainer.style.whiteSpace = 'pre-wrap';
    outputContainer.style.maxHeight = '400px';
    outputContainer.style.overflowY = 'auto';
    
    // Add elements to page
    container.appendChild(installBtn);
    container.appendChild(runButton);
    document.body.appendChild(container);
    document.body.appendChild(outputContainer);
    
    // Event handlers
    installBtn.addEventListener('click', () => runCommand('install'));
    runButton.addEventListener('click', () => runCommand('run'));
});

async function runCommand(action) {
    const outputElement = document.getElementById('pytorch-output');
    outputElement.textContent = action === 'install' 
        ? '🔧 Installing PyTorch dependencies...\n' 
        : '▶ Starting PyTorch test script...\n';
    
    try {
        // Use Electron IPC bridge (this requires preload.js exposeInMainWorld setup)
        const result = await window.electron.runPythonCommand(action);
        
        if (result.stdout) outputElement.textContent += result.stdout;
        if (result.stderr) outputElement.textContent += `\n⚠️  ${result.stderr}`;
        outputElement.textContent += `\n✅ Done. Exit code: ${result.code}`;

        if (action === 'install' && result.code !== 0) {
            const stderr = result.stderr || '';
            const platform = detectPlatform();

            if (isPackageManagerManagedEnvError(stderr)) {
                outputElement.textContent += '\n\nDetected a system-managed Python environment (PEP 668 / externally managed).';
                outputElement.textContent += '\nTry one of these options:\n';
                outputElement.textContent += `${buildPackageManagerSuggestions(platform, stderr)}\n`;
            } else if (isLikelyPipInstallFailure(stderr)) {
                outputElement.textContent += '\n\npip failed to install dependencies.';
                outputElement.textContent += '\nTry an isolated virtual environment first:\n';
                outputElement.textContent += 'python3 -m venv .venv\nsource .venv/bin/activate\npython3 -m pip install -U pip\n';
                outputElement.textContent += 'python3 -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu\n';
            }
        }
        
    } catch (error) {
        outputElement.textContent += `\n❌ Error: ${error.message}`;
        outputElement.textContent += "\n\nNote: Make sure you have setup the preload.js IPC bridge properly for Electron";
    }
}

function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('windows')) return 'windows';
    if (ua.includes('mac')) return 'macos';
    return 'linux';
}

function isPackageManagerManagedEnvError(stderrText) {
    return /externally[\s-]managed|pep\s*668|managed by the system package manager|this environment is externally managed/i.test(stderrText || '');
}

function isLikelyPipInstallFailure(stderrText) {
    return /pip|no matching distribution|could not find a version|permission denied|not writable|failed building wheel|subprocess-exited-with-error/i.test(stderrText || '');
}

function buildPackageManagerSuggestions(platform, stderrText) {
    const stderr = (stderrText || '').toLowerCase();

    if (platform === 'windows') {
        return [
            '- Chocolatey: choco install python',
            '- Winget: winget install Python.Python.3',
            '- Then use a venv: py -m venv .venv && .venv\\Scripts\\activate'
        ].join('\n');
    }

    if (platform === 'macos' || stderr.includes('homebrew') || stderr.includes('brew')) {
        return [
            '- Homebrew Python: brew install python',
            '- Use isolated env: python3 -m venv .venv && source .venv/bin/activate',
            '- Install deps in venv: python3 -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu'
        ].join('\n');
    }

    return [
        '- Debian/Ubuntu: sudo apt install python3-full python3-venv python3-pip',
        '- Fedora/RHEL: sudo dnf install python3 python3-pip python3-virtualenv',
        '- Arch: sudo pacman -S python python-pip',
        '- openSUSE: sudo zypper install python3 python3-pip',
        '- Alpine: sudo apk add python3 py3-pip',
        '- Then create isolated env: python3 -m venv .venv && source .venv/bin/activate'
    ].join('\n');
}
