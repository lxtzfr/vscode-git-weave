const vscode = require('vscode');
const path = require('path');
const { log } = require('./logger');
const { runGit } = require('./gitRepos');

const EMPTY_SCHEME = 'my-empty';
// git runs per selected commit, a few at a time: a selection can span hundreds of commits.
const PARALLEL_GIT = 8;

// vscode.git Status enum -> the Source Control view's letter; 12..18 are the conflict states.
const API_STATUS = { 1: 'A', 2: 'D', 3: 'R', 4: 'C', 6: 'D', 7: 'U', 9: 'A', 10: 'R', 11: 'T' };
const statusLetter = (status) => (status >= 12 ? '!' : API_STATUS[status] || 'M');

// A changed file: { status, path, oldPath, left, right }, left / right = the diff's sides,
// { ref, path } (no ref: the working tree), null for the missing side of an added / deleted file.

// `git diff-tree -z --name-status` -> [{ status, path, oldPath }]
function parseNameStatus(out) {
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++][0];
    if (status === 'R' || status === 'C') files.push({ status, oldPath: parts[i++], path: parts[i++] });
    else files.push({ status, path: parts[i++] });
  }
  return files;
}

// before: the parent revision (undefined for a root commit), after: the commit (undefined: working tree).
function withSides(file, before, after) {
  const added = file.status === 'A' || file.status === 'U' || !before;
  return {
    ...file,
    left: added ? null : { ref: before, path: file.oldPath || file.path },
    right: file.status === 'D' ? null : { ref: after, path: file.path },
  };
}

const relativePath = (repo, uri) => path.relative(repo.rootUri.fsPath, uri.fsPath).split(path.sep).join('/');

function workingTreeFiles(repo) {
  const { indexChanges, workingTreeChanges, mergeChanges } = repo.state;
  const byPath = new Map();
  for (const change of [...mergeChanges, ...indexChanges, ...workingTreeChanges]) {
    const rel = relativePath(repo, change.uri);
    const oldRel = change.originalUri && relativePath(repo, change.originalUri);
    byPath.set(rel, { status: statusLetter(change.status), path: rel, oldPath: oldRel !== rel ? oldRel : undefined });
  }
  return [...byPath.values()].map((f) => withSides(f, 'HEAD', undefined));
}

// A merge against its first parent, as the SCM graph does.
async function filesOf(repo, commit) {
  if (commit.wip) return workingTreeFiles(repo);
  const args = ['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id'];
  const out = commit.parents.length ? await runGit(repo, [...args, commit.parents[0], commit.hash]) : await runGit(repo, [...args, '--root', commit.hash]);
  return parseNameStatus(out).map((f) => withSides(f, commit.parents[0], commit.hash));
}

// Files of several commits, oldest first (WebStorm's multi-commit changes): one entry per file, from
// its state before the oldest commit touching it to its state after the newest, following renames.
function combine(perCommit) {
  const byPath = new Map();
  for (const files of perCommit) {
    for (const file of files) {
      const prev = byPath.get(file.oldPath || file.path);
      if (!prev) {
        byPath.set(file.path, file);
        continue;
      }
      if (file.oldPath) byPath.delete(file.oldPath);
      byPath.set(file.path, { path: file.path, left: prev.left, right: file.right, combined: true });
    }
  }
  return [...byPath.values()]
    .filter((f) => f.left || f.right) // added then deleted within the selection
    .map((f) => {
      if (!f.combined) return f;
      const oldPath = f.left && f.left.path !== f.path ? f.left.path : undefined;
      const status = !f.left ? 'A' : !f.right ? 'D' : oldPath ? 'R' : 'M';
      return { status, path: f.path, oldPath, left: f.left, right: f.right };
    });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// commits: the selection in display order (newest first), { hash, parents, wip }.
// Returns { files, body }, body = the full message of a single selected commit.
async function commitChanges(repo, commits) {
  const lists = await mapLimit([...commits].reverse(), PARALLEL_GIT, (c) => filesOf(repo, c));
  const files = lists.length === 1 ? lists[0] : combine(lists);
  const single = commits.length === 1 && !commits[0].wip;
  const body = single ? (await runGit(repo, ['show', '-s', '--format=%B', commits[0].hash])).trim() : '';
  return { files, body };
}

const sideLabel = (side) => (side.ref === '~' ? 'Index' : side.ref ? (/^[0-9a-f]{40}$/.test(side.ref) ? side.ref.substring(0, 7) : side.ref) : 'Working Tree');

function sideUri(git, repo, side) {
  const uri = vscode.Uri.joinPath(repo.rootUri, side.path);
  return side.ref ? git.toGitUri(uri, side.ref) : uri;
}

// The group beside the first editor group (created when missing). Beside is relative to the active group, so the
// first one is focused: the index-based ViewColumn.Two could be the graph's group, which sits below it.
async function besideFirstGroup() {
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  return vscode.ViewColumn.Beside;
}

// The missing side of an added / deleted file is an empty document: git has no such revision.
async function openDiff(git, repo, file) {
  const empty = vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${file.path}` });
  const left = file.left ? sideUri(git, repo, file.left) : empty;
  const right = file.right ? sideUri(git, repo, file.right) : empty;
  const labels = [file.left, file.right].filter(Boolean).map(sideLabel).join(' ↔ ');
  log.info(`[commitFiles] open diff ${file.path} (${labels})`);
  await vscode.commands.executeCommand('vscode.diff', left, right, `${path.posix.basename(file.path)} (${labels})`, { preview: true, viewColumn: await besideFirstGroup() });
}

async function openFile(git, repo, file) {
  if (!file.right) return;
  log.info(`[commitFiles] open ${file.path} @ ${sideLabel(file.right)}`);
  await vscode.window.showTextDocument(sideUri(git, repo, file.right), { preview: true, viewColumn: await besideFirstGroup() });
}

function registerEmptyDocuments(context) {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, { provideTextDocumentContent: () => '' }));
}

module.exports = { commitChanges, openDiff, openFile, registerEmptyDocuments, statusLetter, relativePath };
