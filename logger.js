const vscode = require('vscode');

// Shared "Git Weave" log channel (Output panel), with levels.
const log = vscode.window.createOutputChannel('Git Weave', { log: true });

module.exports = { log };
