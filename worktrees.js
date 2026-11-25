const vscode = require('vscode');
const path = require('path');
const { log } = require('./logger');
const { repoName, githubIssueUrl, runGit } = require('./gitRepos');
const { readSlotMarker, worktreeState } = require('./slotInfo');
const { loadWorktreeChanges, discardWorktreeFiles, commitWorktreeFiles } = require('./worktreeFiles');
const { confirmDiscard } = require('./workingChanges');

function samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function isOpenInThisWindow(worktreePath) {
  return (vscode.workspace.workspaceFolders || []).some((f) => f.uri.scheme === 'file' && samePath(f.uri.fsPath, worktreePath));
}

// `git worktree list --porcelain`: blocks "worktree <path>" / "HEAD <sha>" / "branch <ref>" | "detached",
// the main checkout first. Gives each worktree's commit, which the vscode.git API does not.
function parseWorktrees(out) {
  return out
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block, i) => {
      const fields = Object.fromEntries(block.split('\n').map((line) => [line.split(' ')[0], line.substring(line.indexOf(' ') + 1)]));
      return {
        path: path.normalize(fields.worktree),
        commit: fields.HEAD,
        branch: fields.branch ? fields.branch.replace(/^refs\/heads\//, '') : undefined,
        main: i === 0,
        prunable: 'prunable' in fields,
      };
    });
}

// Worktrees for the graph's sidebar: { path, name, commit, branch, main, current, slot, issue, state, lastSession, changes },
// issue = { number, title, url } of a my-stack wt slot, changes = its changed files (worktreeFiles.js).
async function loadWorktrees(repo) {
  const worktrees = parseWorktrees(await runGit(repo, ['worktree', 'list', '--porcelain']));
  return Promise.all(
    worktrees.map(async (wt) => {
      const marker = wt.prunable ? undefined : readSlotMarker(wt.path);
      const changes = wt.prunable ? [] : await loadWorktreeChanges(wt.path);
      // Same rule as `wt list`: the marker's ticket only counts while the slot is still on its branch.
      const issue = marker && marker.issue && wt.branch && marker.branch === wt.branch ? marker : undefined;
      return {
        ...wt,
        name: path.basename(wt.path),
        // The repository's own root counts even when the window is opened on a parent folder: its changes are the
        // WIP row / Changes sections already, never another worktree's.
        current: isOpenInThisWindow(wt.path) || samePath(wt.path, repo.rootUri.fsPath),
        slot: !wt.main && marker !== undefined,
        issue: issue && { number: issue.issue, title: issue.title || '', url: githubIssueUrl(repo, issue.issue) },
        state: wt.prunable ? 'missing' : worktreeState(wt.path, changes),
        lastSession: marker && marker.lastSession,
        changes: changes || [],
      };
    })
  );
}

function open(item, forceNewWindow) {
  log.info(`[worktrees] open ${item.worktree.path} (${forceNewWindow ? 'new' : 'current'} window)`);
  return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.worktree.path), { forceNewWindow });
}

async function remove(item) {
  const { repo, worktree } = item;
  const answer = await vscode.window.showWarningMessage(`Delete worktree "${worktree.name}"?`, { modal: true, detail: worktree.path }, 'Delete');
  if (answer !== 'Delete') return;
  try {
    log.info(`[worktrees] ${repoName(repo)}: delete ${worktree.path}`);
    // The git extension itself offers a forced delete when the worktree has local changes.
    await repo.deleteWorktree(worktree.path);
  } catch (err) {
    log.error(`[worktrees] ${repoName(repo)}: delete ${worktree.path} failed:`, err);
    vscode.window.showErrorMessage(`Delete failed: ${err.message || err}`);
  }
}

// Paths come from a webview: only a worktree of the repository is touched.
async function findWorktree(repo, worktreePath) {
  const worktrees = parseWorktrees(await runGit(repo, ['worktree', 'list', '--porcelain']));
  const wt = worktrees.find((w) => samePath(w.path, worktreePath) && !w.prunable);
  if (!wt) log.warn(`[worktrees] ${repoName(repo)}: refused, not one of its worktrees: ${worktreePath}`);
  return wt;
}

// Same rules as this window's commit (workingChanges.js), asking too when only a part is staged: the view does not
// show which files of another worktree are. Returns whether it committed.
async function commitWorktree(repo, worktreePath, message) {
  if (!message.trim()) {
    vscode.window.showWarningMessage('Enter a commit message.');
    return false;
  }
  const wt = await findWorktree(repo, worktreePath);
  if (!wt) return false;
  const files = (await loadWorktreeChanges(wt.path)) || [];
  const name = path.basename(wt.path);
  if (!files.length) {
    vscode.window.showInformationMessage(`There are no changes to commit in ${name}.`);
    return false;
  }
  if (files.some((f) => f.status === '!')) {
    vscode.window.showWarningMessage(`Resolve the conflicts of ${name} before committing.`);
    return false;
  }
  const staged = files.filter((f) => f.staged).length;
  let stageAll = false;
  if (files.some((f) => f.unstaged)) {
    const all = 'Stage All and Commit';
    const only = 'Commit Staged Only';
    const question = staged ? `${name} has both staged and unstaged changes. What should be committed?` : `There are no staged changes in ${name}. Stage all its changes and commit them?`;
    const answer = await vscode.window.showWarningMessage(question, { modal: true }, ...(staged ? [only, all] : [all]));
    if (!answer) return false;
    stageAll = answer === all;
  }
  await commitWorktreeFiles(wt.path, message, stageAll);
  return true;
}

// Another worktree's files back to HEAD.
async function discard(repo, worktreePath, files, refresh) {
  const wt = await findWorktree(repo, worktreePath);
  if (!wt) return;
  if (!files.length || !(await confirmDiscard(files, path.basename(wt.path)))) return;
  try {
    await discardWorktreeFiles(wt.path, files.map((f) => f.path));
  } catch (err) {
    log.error(`[worktrees] ${wt.path}: discard failed:`, err);
    vscode.window.showErrorMessage(`Discard failed: ${err.message || err}`);
  }
  refresh();
}

// Actions of the graph sidebar's worktree rows (webview/context, inline buttons).
// resolve(ctx) -> { repo, worktree }, undefined when the graph has no repository; refresh(): reload the views
// (another worktree's files are not watched).
function registerWorktreeCommands(context, resolve, refresh) {
  const withItem = (fn) => (ctx) => {
    const item = ctx && resolve(ctx);
    return item && item.worktree && fn(item);
  };
  const commands = {
    openNewWindow: (item) => open(item, true),
    open: (item) => open(item, false),
    copyPath: (item) => vscode.env.clipboard.writeText(item.worktree.path),
    reveal: (item) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.worktree.path)),
    delete: remove,
    openIssue: (item) => item.worktree.issue && item.worktree.issue.url && vscode.env.openExternal(vscode.Uri.parse(item.worktree.issue.url)),
    discardAll: async (item) => discard(item.repo, item.worktree.path, (await loadWorktreeChanges(item.worktree.path)) || [], refresh),
  };
  // A file of another worktree (ctx.file.worktree) or of this window's WIP row in the graph (ctx.file.wip).
  const discardFile = (ctx) => {
    const item = ctx && ctx.file && (ctx.file.worktree || ctx.file.wip) && resolve(ctx);
    return item && discard(item.repo, ctx.file.worktree || item.repo.rootUri.fsPath, [ctx.file], refresh);
  };
  context.subscriptions.push(
    ...Object.entries(commands).map(([name, fn]) => vscode.commands.registerCommand(`gitWeave.worktrees.${name}`, withItem(fn))),
    vscode.commands.registerCommand('gitWeave.worktrees.create', () => vscode.commands.executeCommand('git.createWorktree')),
    vscode.commands.registerCommand('gitWeave.worktrees.discardFile', discardFile)
  );
}

module.exports = { loadWorktrees, commitWorktree, registerWorktreeCommands, samePath };
