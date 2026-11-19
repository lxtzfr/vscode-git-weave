const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { log } = require('./logger');

// Another worktree's files, read-only: its changes may not belong to an open repository (vscode.git's own
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

// Porcelain XY -> the Source Control view's letter (commitFiles.js STATUS).
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
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
    const file = { status: letter(xy), path: parts[i++].substring(3) };
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
    return files.map((f) => ({
      ...f,
      worktree: worktreePath,
      left: f.status === 'A' || f.status === 'U' ? null : { ref: 'HEAD', path: f.oldPath || f.path },
      right: f.status === 'D' ? null : { path: f.path },
    }));
  } catch (err) {
    log.warn(`[worktreeFiles] git status failed in ${worktreePath}:`, err);
    return undefined;
  }
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

module.exports = { loadWorktreeChanges, worktreeUri, registerWorktreeDocuments };
