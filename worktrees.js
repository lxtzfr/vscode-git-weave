const vscode = require('vscode');
const path = require('path');
const { log } = require('./logger');
const { repoName, githubIssueUrl, runGit } = require('./gitRepos');
const { readSlotMarker, worktreeState } = require('./slotInfo');

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

// Worktrees for the graph's sidebar: { path, name, commit, branch, main, current, slot, issue, state, lastSession },
// issue = { number, title, url } of a my-stack wt slot.
async function loadWorktrees(repo) {
  const worktrees = parseWorktrees(await runGit(repo, ['worktree', 'list', '--porcelain']));
  return Promise.all(
    worktrees.map(async (wt) => {
      const marker = wt.prunable ? undefined : readSlotMarker(wt.path);
      // Same rule as `wt list`: the marker's ticket only counts while the slot is still on its branch.
      const issue = marker && marker.issue && wt.branch && marker.branch === wt.branch ? marker : undefined;
      return {
        ...wt,
        name: path.basename(wt.path),
        current: isOpenInThisWindow(wt.path),
        slot: !wt.main && marker !== undefined,
        issue: issue && { number: issue.issue, title: issue.title || '', url: githubIssueUrl(repo, issue.issue) },
        state: wt.prunable ? 'missing' : await worktreeState(wt.path),
        lastSession: marker && marker.lastSession,
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

// Actions of the graph sidebar's worktree rows (webview/context, inline buttons).
// resolve(ctx) -> { repo, worktree }, undefined when the graph has no repository.
function registerWorktreeCommands(context, resolve) {
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
  };
  context.subscriptions.push(
    ...Object.entries(commands).map(([name, fn]) => vscode.commands.registerCommand(`gitWeave.worktrees.${name}`, withItem(fn))),
    vscode.commands.registerCommand('gitWeave.worktrees.create', () => vscode.commands.executeCommand('git.createWorktree'))
  );
}

module.exports = { loadWorktrees, registerWorktreeCommands };
