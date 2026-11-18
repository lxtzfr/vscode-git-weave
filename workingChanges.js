const vscode = require('vscode');
const path = require('path');
const { log } = require('./logger');
const { repoName, errorText } = require('./gitRepos');
const { statusLetter, relativePath } = require('./commitFiles');

// The git URI ref of the index (as vscode.git's own diffs use it)
const INDEX = '~';

// The repository's uncommitted changes as the Source Control view groups them, in commitFiles.js's
// file shape (its sides make openDiff show HEAD ↔ index for staged files, index ↔ disk for the others).
function loadChanges(repo) {
  const { indexChanges, workingTreeChanges, mergeChanges, HEAD } = repo.state;
  const toFile = (change, group) => {
    const status = statusLetter(change.status);
    const rel = relativePath(repo, change.uri);
    const oldRel = change.originalUri && relativePath(repo, change.originalUri);
    const oldPath = oldRel !== rel ? oldRel : undefined;
    const added = status === 'A' || status === 'U';
    const deleted = status === 'D';
    if (group === 'staged') {
      return { status, path: rel, oldPath, group, left: added ? null : { ref: 'HEAD', path: oldPath || rel }, right: deleted ? null : { ref: INDEX, path: rel } };
    }
    // Conflicts open the file itself (its markers), as the native view does.
    return { status, path: rel, oldPath, group, left: added || group === 'merge' ? null : { ref: INDEX, path: rel }, right: deleted ? null : { path: rel } };
  };
  return {
    merge: mergeChanges.map((c) => toFile(c, 'merge')),
    staged: indexChanges.map((c) => toFile(c, 'staged')),
    unstaged: workingTreeChanges.map((c) => toFile(c, 'unstaged')),
    branch: HEAD && (HEAD.name || (HEAD.commit && HEAD.commit.substring(0, 7))),
    message: repo.inputBox.value,
  };
}

const absolute = (repo, file) => path.join(repo.rootUri.fsPath, file.path);
const groupFiles = (repo, group) => loadChanges(repo)[group];

async function confirmDiscard(files) {
  const untracked = files.filter((f) => f.status === 'U').length;
  const what = files.length === 1 ? files[0].path : `${files.length} files`;
  const message = untracked === files.length ? `Delete ${what}? It is untracked: this cannot be undone.` : `Discard the changes in ${what}? This cannot be undone.`;
  return (await vscode.window.showWarningMessage(message, { modal: true }, 'Discard')) === 'Discard';
}

// targets: [{ repo, files }], one entry per repository.
async function stage(targets) {
  for (const { repo, files } of targets) {
    log.info(`[changes] ${repoName(repo)}: stage ${files.length} files`);
    await repo.add(files.map((f) => absolute(repo, f)));
  }
}

async function unstage(targets) {
  for (const { repo, files } of targets) {
    log.info(`[changes] ${repoName(repo)}: unstage ${files.length} files`);
    await repo.revert(files.map((f) => absolute(repo, f)));
  }
}

// One confirmation for all the repositories.
async function discard(targets) {
  const files = targets.flatMap((t) => t.files);
  if (!files.length || !(await confirmDiscard(files))) return;
  for (const { repo, files: mine } of targets) {
    log.info(`[changes] ${repoName(repo)}: discard ${mine.length} files`);
    await repo.clean(mine.map((f) => absolute(repo, f)));
  }
}

const groupTargets = (repos, group) => repos.map((repo) => ({ repo, files: groupFiles(repo, group) })).filter((t) => t.files.length);

// One message, committed in every given repository with staged changes (WebStorm's multi-root commit).
// Nothing staged anywhere: offer to stage everything, untracked files included, as the native smart commit does.
async function commit(repos, message) {
  if (!message.trim()) {
    vscode.window.showWarningMessage('Enter a commit message.');
    return false;
  }
  let targets = repos.filter((repo) => repo.state.indexChanges.length);
  if (!targets.length) {
    const unstaged = groupTargets(repos, 'unstaged');
    if (!unstaged.length) {
      vscode.window.showInformationMessage('There are no changes to commit.');
      return false;
    }
    const answer = await vscode.window.showWarningMessage('There are no staged changes. Stage all your changes and commit them?', { modal: true }, 'Stage All and Commit');
    if (answer !== 'Stage All and Commit') return false;
    await stage(unstaged);
    targets = unstaged.map((t) => t.repo);
  }
  for (const repo of targets) {
    log.info(`[changes] ${repoName(repo)}: commit "${message.split('\n')[0]}"`);
    await repo.commit(message);
  }
  for (const repo of repos) repo.inputBox.value = '';
  return true;
}

// Context menus and inline buttons: ctx = { file, changeGroup, root } on a file row, { changeGroup } on a
// section; reposOf(ctx) -> the repositories it acts on.
function registerChangeCommands(context, reposOf) {
  const run = (action, fn) => async (ctx) => {
    const repos = ctx ? reposOf(ctx) : [];
    if (!repos.length) return;
    try {
      await fn(repos, ctx);
    } catch (err) {
      log.error(`[changes] ${repos.map(repoName).join(', ')}: ${action} failed:`, err);
      vscode.window.showErrorMessage(`${action} failed: ${errorText(err)}`);
    }
  };
  const one = (repos, ctx) => [{ repo: repos[0], files: [ctx.file] }];
  const actions = {
    stage: (repos, ctx) => stage(one(repos, ctx)),
    unstage: (repos, ctx) => unstage(one(repos, ctx)),
    discard: (repos, ctx) => discard(one(repos, ctx)),
    stageAll: (repos, ctx) => stage(groupTargets(repos, ctx.changeGroup)),
    unstageAll: (repos) => unstage(groupTargets(repos, 'staged')),
    discardAll: (repos) => discard(groupTargets(repos, 'unstaged')),
  };
  context.subscriptions.push(...Object.entries(actions).map(([name, fn]) => vscode.commands.registerCommand(`gitWeave.changes.${name}`, run(name, fn))));
}

module.exports = { loadChanges, commit, registerChangeCommands };
