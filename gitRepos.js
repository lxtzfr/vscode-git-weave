const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');

// The git API only exposes the focused repository (`ui.selected`): the multi-selection of the
// Source Control "Repositories" section stays internal to VS Code. Falls back to the first one.
function getFocusedRepository(git) {
  const repos = git.repositories;
  return repos.find((r) => r.ui.selected) || repos[0];
}

// For what the vscode.git API does not expose (stash list, full log with decorations).
// stderr is the error message: git's own reason, not a generic "Command failed".
function runGit(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo.rootUri.fsPath, ...args], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

function repoName(repo) {
  return path.basename(repo.rootUri.fsPath);
}

// "git@github.com:owner/repo.git" / "https://github.com/owner/repo.git" -> { host: "github.com", path: "owner/repo" }
function parseRemote(url) {
  const u = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const scp = u.match(/^[^@/]+@([^:]+):(.+)$/);
  if (scp) return { host: scp[1], path: scp[2].replace(/^\/+/, '') };
  try {
    const parsed = new URL(u);
    return { host: parsed.hostname, path: parsed.pathname.replace(/^\/+/, '') };
  } catch {
    return { host: undefined, path: u };
  }
}

function getRemoteUrl(repo) {
  const remotes = repo.state.remotes || [];
  const remote = remotes.find((r) => r.name === 'origin') || remotes[0];
  return remote && (remote.fetchUrl || remote.pushUrl);
}

// Web URL of a GitHub issue of the repository, undefined when its remote is not on GitHub.
function githubIssueUrl(repo, number) {
  const url = getRemoteUrl(repo);
  const remote = url && parseRemote(url);
  return remote && remote.host === 'github.com' ? `https://github.com/${remote.path}/issues/${number}` : undefined;
}

function sortedRepositories(git) {
  return [...git.repositories].sort((a, b) => repoName(a).localeCompare(repoName(b)));
}

// Calls listener when a repository opens/closes, gets the focus or its state (HEAD, refs, remotes) changes.
function onRepositoriesChange(git, listener) {
  let repoDisposables = [];
  const watch = () => {
    repoDisposables.forEach((d) => d.dispose());
    repoDisposables = git.repositories.flatMap((repo) => [
      repo.ui.onDidChange(listener),
      repo.state.onDidChange(listener),
    ]);
    listener();
  };
  const disposables = [git.onDidOpenRepository(watch), git.onDidCloseRepository(watch)];
  watch();
  return new vscode.Disposable(() => [...disposables, ...repoDisposables].forEach((d) => d.dispose()));
}

// Tags items (or each item list of an object) with their repository's root: the webviews' rows and
// menus act on that repository when several are shown.
function withRoot(repo, items) {
  const root = repo.rootUri.fsPath;
  const tag = (list) => list.map((item) => ({ ...item, root }));
  if (Array.isArray(items)) return tag(items);
  return Object.fromEntries(Object.entries(items).map(([k, v]) => [k, Array.isArray(v) ? tag(v) : v]));
}

// vscode.git errors carry a generic message ("Failed to execute git"): the real reason is in stderr.
const errorText = (err) => String(err.stderr || err.message || err).trim();

module.exports = { withRoot, errorText, runGit, getFocusedRepository, repoName, sortedRepositories, onRepositoriesChange, parseRemote, getRemoteUrl, githubIssueUrl };
