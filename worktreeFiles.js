const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { log } = require('./logger');

// Another worktree's files, opened read-only: its changes may not belong to an open repository (vscode.git's own
// git: URIs need one), and a content provider's documents cannot be edited or saved.
const SCHEME = 'git-weave-wt';

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

// Paths go through stdin (--pathspec-from-file): a whole worktree's changes overflow a Windows command line.
function gitPaths(cwd, args, paths) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args, '--pathspec-from-file=-', '--pathspec-file-nul'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code ? reject(new Error(stderr.trim() || `git exited with ${code}`)) : resolve()));
    child.stdin.end(paths.join('\0'));
  });
}

// Porcelain XY -> the Source Control view's letter (commitFiles.js STATUS).
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
// The conflicts whose path HEAD (ours) has: the others were deleted or added on their side only.
const CONFLICTS_IN_HEAD = new Set(['AU', 'UD', 'AA', 'UU']);
function letter(xy) {
  if (xy === '??') return 'U';
  if (CONFLICTS.has(xy)) return '!';
  if (xy[0] === 'R' || xy[0] === 'C') return xy[0];
  if (xy[0] === 'A') return 'A';
  if (xy[0] === 'D' || xy[1] === 'D') return 'D';
  return 'M';
}

// `git status --porcelain -z`: "XY path\0", a rename / copy followed by "orig\0".
function parseStatus(out) {
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const xy = parts[i].substring(0, 2);
    const file = { status: letter(xy), path: parts[i++].substring(3), inHead: CONFLICTS.has(xy) ? CONFLICTS_IN_HEAD.has(xy) : xy !== '??' && xy[0] !== 'A' };
    if (xy[0] === 'R' || xy[0] === 'C') file.oldPath = parts[i++];
    files.push(file);
  }
  return files;
}

// A worktree's uncommitted changes, staged or not, as one HEAD ↔ working tree diff per file, in commitFiles.js's
// file shape plus `worktree` (its path). Undefined when git fails.
async function loadWorktreeChanges(worktreePath) {
  try {
    const files = parseStatus(await git(worktreePath, ['status', '--porcelain', '-z', '--untracked-files=all']));
    return files.map(({ inHead, ...f }) => ({
      ...f,
      worktree: worktreePath,
      left: inHead ? { ref: 'HEAD', path: f.oldPath || f.path } : null,
      right: f.status === 'D' ? null : { path: f.path },
    }));
  } catch (err) {
    log.warn(`[worktreeFiles] git status failed in ${worktreePath}:`, err);
    return undefined;
  }
}

// Back to HEAD, index and disk: what HEAD has is restored, what it lacks (added, untracked, a rename's new path)
// is deleted. Acts on the worktree's current status, not on the caller's list (it may be stale).
async function discardWorktreeFiles(worktreePath, paths) {
  const wanted = new Set(paths);
  const files = ((await loadWorktreeChanges(worktreePath)) || []).filter((f) => wanted.has(f.path));
  const restore = files.filter((f) => f.left).map((f) => f.left.path);
  const remove = files.filter((f) => !f.left || f.left.path !== f.path).map((f) => f.path);
  log.info(`[worktreeFiles] ${worktreePath}: discard ${files.length} files (${restore.length} restored, ${remove.length} deleted)`);
  if (restore.length) await gitPaths(worktreePath, ['restore', '--source=HEAD', '--staged', '--worktree'], restore);
  if (remove.length) {
    await gitPaths(worktreePath, ['rm', '-q', '-f', '--cached', '--ignore-unmatch'], remove);
    await Promise.all(remove.map((p) => fs.promises.rm(path.join(worktreePath, p), { force: true })));
  }
  return files.length;
}

// Commits these files as they are on disk, and nothing else: what another session staged stays staged (WebStorm's
// commit). git refuses a partial commit during a merge: then every change has to be checked.
async function commitWorktreeFiles(worktreePath, message, paths) {
  const changes = await loadWorktreeChanges(worktreePath);
  if (!changes) throw new Error(`git status failed in ${worktreePath}`);
  const wanted = new Set(paths);
  const files = changes.filter((f) => wanted.has(f.path));
  if (!files.length) throw new Error('The checked files have no changes any more.');
  const merging = await git(worktreePath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).then(() => true, () => false);
  if (changes.some((f) => f.status === '!')) throw new Error('Resolve the conflicts before committing.');
  if (merging && files.length !== changes.length) throw new Error('A merge is in progress: check all the files to commit it.');
  log.info(`[worktreeFiles] ${worktreePath}: commit ${files.length}/${changes.length} files "${message.split('\n')[0]}"`);
  const untracked = files.filter((f) => f.status === 'U').map((f) => f.path);
  if (untracked.length) await gitPaths(worktreePath, ['add'], untracked);
  if (merging) {
    await git(worktreePath, ['add', '-A']);
    return git(worktreePath, ['commit', '-m', message]);
  }
  // A rename is committed with both its paths.
  const all = files.flatMap((f) => (f.status === 'R' ? [f.oldPath, f.path] : [f.path]));
  await gitPaths(worktreePath, ['commit', '-m', message], all);
}

// side: { ref, path }, no ref: the file on disk.
function worktreeUri(worktreePath, side) {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${side.path}`, query: JSON.stringify({ worktree: worktreePath, ref: side.ref }) });
}

async function provide(uri) {
  const { worktree, ref } = JSON.parse(uri.query);
  const rel = uri.path.substring(1);
  try {
    if (ref) return await git(worktree, ['show', `${ref}:${rel}`]);
    return await fs.promises.readFile(path.join(worktree, rel), 'utf8');
  } catch (err) {
    log.warn(`[worktreeFiles] ${worktree}: cannot read ${rel} @ ${ref || 'working tree'}:`, err);
    return '';
  }
}

function registerWorktreeDocuments(context) {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: provide }));
}

module.exports = { loadWorktreeChanges, discardWorktreeFiles, commitWorktreeFiles, worktreeUri, registerWorktreeDocuments };
