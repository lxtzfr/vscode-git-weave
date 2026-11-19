const vscode = require('vscode');
const crypto = require('crypto');
const { log } = require('./logger');

// The commands a webview's hover buttons may run: our own.
const WEBVIEW_COMMANDS = /^gitWeave\.(worktrees|stashes|branches|changes|graph|sync)\./;

// Shared by the graph panel and the sidebar view: scripts, styles and the codicons font, all from media/.
// The codicons are copied there (media/codicons), not a dependency: vsce cannot package a pnpm node_modules.
function webviewOptions(extensionUri) {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
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
<link rel="stylesheet" href="${uri('media', 'codicons', 'codicon.css')}">
${css.join('\n')}
</head>
<body>
${body}
${js.join('\n')}
</body>
</html>`;
}

// A webview's hover button: the same command as its context menu, same argument (msg.ctx). msg.key: a button
// waiting for the end (its spinner), told through post({ type: 'commandDone' }) when the command settled.
function runWebviewCommand(msg, post, tag) {
  if (!WEBVIEW_COMMANDS.test(msg.command)) return log.warn(`[${tag}] refused command:`, msg.command);
  return Promise.resolve(vscode.commands.executeCommand(msg.command, msg.ctx))
    .catch((err) => log.error(`[${tag}] command failed:`, msg.command, err))
    .finally(() => msg.key && post({ type: 'commandDone', key: msg.key }));
}

module.exports = { webviewOptions, webviewHtml, runWebviewCommand };
