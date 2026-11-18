const vscode = require('vscode');
const { log } = require('./logger');
const { RepoSelection } = require('./repoSelection');
const { registerGraphView } = require('./graphView');
const { registerSidebarView } = require('./sidebarView');
const { registerEmptyDocuments } = require('./commitFiles');
const { registerWindowTitle } = require('./windowTitle');

async function getGitApi() {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) return undefined;
  const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  return exports.getAPI(1);
}

async function activate(context) {
  log.info('Activating');
  context.subscriptions.push(log);
  const git = await getGitApi();
  if (!git) {
    log.warn('Built-in Git extension not available: extension disabled');
    vscode.window.showWarningMessage('Git Weave: the built-in Git extension is not available.');
    return;
  }

  registerEmptyDocuments(context);
  const selection = new RepoSelection(context, git);
  context.subscriptions.push(selection);
  const graph = registerGraphView(context, git, selection);
  registerSidebarView(context, selection, graph);
  registerWindowTitle(context, git);
}

function deactivate() {}

module.exports = { activate, deactivate };
