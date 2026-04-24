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
    const outputElement = document.getElementById('bash-output');
    outputElement.textContent = 'Starting PyTorch script...\n';
    
    // Path to python script
    const scriptPath = path.join(__dirname, 'python', 'tests/pytorch_runner.py');
    
    // Spawn python process
    const pythonProcess = spawn('python3', [scriptPath]);
}