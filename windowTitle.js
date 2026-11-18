const vscode = require('vscode');
const { log } = require('./logger');
const { getFocusedRepository, getRemoteUrl, parseRemote, onRepositoriesChange } = require('./gitRepos');

const SETTING_SECTION = 'gitWeave.windowTitle';

function computeTitle(git) {
  // Opened through a .code-workspace file: use the workspace name (native variable).
  const wsFile = vscode.workspace.workspaceFile;
  if (wsFile && wsFile.scheme !== 'untitled') return '${rootNameShort}';

  const repo = getFocusedRepository(git);
  const url = repo && getRemoteUrl(repo);
  return url ? parseRemote(url).path : undefined;
}

// Sets the workspace "window.title" setting: the .code-workspace name when one is open,
// otherwise the remote path of the focused repository. Opt-in: it writes every opened project's .vscode/settings.json.
function registerWindowTitle(context, git) {
  const update = async () => {
    if (!vscode.workspace.workspaceFolders) return;
    if (!vscode.workspace.getConfiguration(SETTING_SECTION).get('enabled')) return;
    const title = computeTitle(git);
    if (!title) return;

    const config = vscode.workspace.getConfiguration('window');
    if (config.inspect('title').workspaceValue === title) return;
    try {
      log.info(`[windowTitle] set window.title to "${title}"`);
      await config.update('title', title, vscode.ConfigurationTarget.Workspace);
    } catch (err) {
      log.error('[windowTitle] failed to set window.title:', err);
    }
  };

  context.subscriptions.push(
    onRepositoriesChange(git, update),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(SETTING_SECTION) && update())
  );
}

module.exports = { registerWindowTitle };
