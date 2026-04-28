const { spawn } = require('child_process');
const path = require('path');

document.addEventListener('DOMContentLoaded', () => {
    console.log('bash loaded successfully');
    
    // Create run button
    const runButton = document.createElement('button');
    runButton.textContent = 'Run PyTorch install Script';
    runButton.id = 'run-pytorch-btn';
    runButton.style.padding = '10px 20px';
    runButton.style.margin = '20px 0';
    runButton.style.cursor = 'pointer';
    
    // Add button to page
    document.body.appendChild(runButton);
    
    // Output container
    const outputContainer = document.createElement('div');
    outputContainer.id = 'pytorch-output';
    outputContainer.style.marginTop = '20px';
    outputContainer.style.padding = '15px';
    outputContainer.style.backgroundColor = '#f5f5f5';
    outputContainer.style.borderRadius = '5px';
    outputContainer.style.fontFamily = 'monospace';
    outputContainer.style.whiteSpace = 'pre-wrap';
    document.body.appendChild(outputContainer);
    
    // Button click handler
    runButton.addEventListener('click', runPytorchInstall);
});


function runPytorchInstall() {
    const outputElement = document.getElementById('pytorch-output');
    outputElement.textContent = 'Starting PyTorch script...\n';
    
    // Path to python script
    const scriptPath = path.join(__dirname, 'python', 'tests/pytorch_runner.py');
    
    // Spawn python process
    const pythonProcess = spawn('python3', [scriptPath]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        outputElement.textContent += text;
    });

    pythonProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        outputElement.textContent += text;
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            outputElement.textContent += '\n\nInstall script completed successfully.';
            return;
        }

        outputElement.textContent += `\n\nInstall script failed (exit code: ${code}).`;

        if (isPackageManagerManagedEnvError(stderr)) {
            outputElement.textContent += '\n\nDetected a system-managed Python environment (PEP 668 / externally managed).';
            outputElement.textContent += '\nTry one of these options:\n';
            outputElement.textContent += `${buildPackageManagerSuggestions(detectPlatform(), stderr)}\n`;
        } else if (isLikelyPipInstallFailure(stderr)) {
            outputElement.textContent += '\n\npip failed to install dependencies.';
            outputElement.textContent += '\nConsider using a virtual environment first:\n';
            outputElement.textContent += 'python3 -m venv .venv\nsource .venv/bin/activate\npython3 -m pip install -U pip\n';
        }
    });
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
            '- Install deps in venv: python3 -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu'
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