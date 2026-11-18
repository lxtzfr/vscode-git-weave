const vscode = require('vscode');
const crypto = require('crypto');

// Shared by the graph panel and the sidebar view: scripts and styles from media/, codicons from the package.
function webviewOptions(extensionUri) {
  const localResourceRoots = [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')];
  return { enableScripts: true, localResourceRoots };
}

// No 'unsafe-inline': the scripts set styles through the CSSOM (dom.js), never a style attribute.
function webviewHtml(webview, extensionUri, { styles, body, scripts }) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const uri = (...segments) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments));
  const css = ['common.css', ...styles].map((f) => `<link rel="stylesheet" href="${uri('media', f)}">`);
  const js = ['dom.js', 'tree.js', 'refs.js', ...scripts].map((f) => `<script nonce="${nonce}" src="${uri('media', f)}"></script>`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')}">
${css.join('\n')}
</head>
<body>
${body}
${js.join('\n')}
</body>
</html>`;
}

module.exports = { webviewOptions, webviewHtml };
