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
        
    } catch (error) {
        outputElement.textContent += `\n❌ Error: ${error.message}`;
        outputElement.textContent += "\n\nNote: Make sure you have setup the preload.js IPC bridge properly for Electron";
    }
}
