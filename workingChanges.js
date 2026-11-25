const vscode = require('vscode');
const path = require('path');
const { log } = require('./logger');
const { repoName, errorText } = require('./gitRepos');
const { statusLetter, relativePath } = require('./commitFiles');
const { loadWorktreeChanges, discardWorktreeFiles } = require('./worktreeFiles');

// Conflicts, from vscode.git: they open the file itself (its markers), as the native view does.
function mergeFiles(repo) {
  return repo.state.mergeChanges.map((change) => {
    const rel = relativePath(repo, change.uri);
    const status = statusLetter(change.status);
    return { status, path: rel, group: 'merge', left: null, right: status === 'D' ? null : { path: rel } };
  });
}

// The repository's uncommitted changes as the sidebar shows them (WebStorm: no staging area): the conflicts, then
// one HEAD ↔ working tree entry per file, staged or not, in commitFiles.js's file shape. `wip`: this checkout's own
// files, editable and discardable to HEAD.
async function loadChanges(repo) {
  const { HEAD, mergeChanges } = repo.state;
  const conflicts = new Set(mergeChanges.map((c) => relativePath(repo, c.uri)));
  const files = (await loadWorktreeChanges(repo.rootUri.fsPath)) || [];
  return {
    merge: mergeFiles(repo),
    files: files.filter((f) => f.status !== '!' && !conflicts.has(f.path)).map(({ worktree, ...f }) => ({ ...f, wip: true })),
    branch: HEAD && (HEAD.name || (HEAD.commit && HEAD.commit.substring(0, 7))),
    message: repo.inputBox.value,
  };
}

const absolute = (repo, file) => path.join(repo.rootUri.fsPath, file.path);

// where: the worktree the files are in, when not this window's.
async function confirmDiscard(files, where) {
  const untracked = files.filter((f) => f.status === 'U').length;
  const what = (files.length === 1 ? files[0].path : `${files.length} files`) + (where ? ` of ${where}` : '');
  const message = untracked === files.length ? `Delete ${what}? It is untracked: this cannot be undone.` : `Discard the changes in ${what}? This cannot be undone.`;
  return (await vscode.window.showWarningMessage(message, { modal: true }, 'Discard')) === 'Discard';
}

// targets: [{ repo, files }], one entry per repository. Staging only marks a conflict as resolved here.
async function stage(targets) {
  for (const { repo, files } of targets) {
    log.info(`[changes] ${repoName(repo)}: stage ${files.length} files`);
    await repo.add(files.map((f) => absolute(repo, f)));
  }
}

// Every change of the repositories back to HEAD, with one confirmation.
async function discardAll(repos) {
  const targets = [];
  for (const repo of repos) {
    const { files } = await loadChanges(repo);
    if (files.length) targets.push({ repo, files });
  }
  const files = targets.flatMap((t) => t.files);
  if (!files.length || !(await confirmDiscard(files))) return;
  for (const { repo, files: mine } of targets) await discardWorktreeFiles(repo.rootUri.fsPath, mine.map((f) => f.path));
}

// Context menus and inline buttons: ctx = { file, files, root } on a conflict's row, { changeGroup } on a section;
// reposOf(ctx) -> the repositories it acts on.
function registerChangeCommands(context, reposOf, refresh) {
  const run = (action, fn) => async (ctx) => {
    const repos = ctx ? reposOf(ctx) : [];
    if (!repos.length) return;
    try {
      await fn(repos, ctx);
    } catch (err) {
      log.error(`[changes] ${repos.map(repoName).join(', ')}: ${action} failed:`, err);
      vscode.window.showErrorMessage(`${action} failed: ${errorText(err)}`);
    }
    refresh();
  };
  const actions = {
    // ctx.files: a multi-selection (workingTree.js), else the row's own file.
    stage: (repos, ctx) => stage([{ repo: repos[0], files: ctx.files || [ctx.file] }]),
    stageAll: (repos) => stage(repos.map((repo) => ({ repo, files: mergeFiles(repo) })).filter((t) => t.files.length)),
    discardAll,
  };
  context.subscriptions.push(...Object.entries(actions).map(([name, fn]) => vscode.commands.registerCommand(`gitWeave.changes.${name}`, run(name, fn))));
}

module.exports = { loadChanges, confirmDiscard, registerChangeCommands };
