const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const MARKER = 'my-stack-wt.json';

// A worktree's ".git" is a folder (main checkout) or a "gitdir: <path>" file (linked worktree).
function gitDirOf(worktreePath) {
  const dotGit = path.join(worktreePath, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const match = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
    return match ? path.resolve(worktreePath, match[1].trim()) : undefined;
  } catch {
    return undefined;
  }
}

// Slot marker written by my-stack's worktree tool in the repositories it manages: { branch, issue, title, lastSession, links }. Undefined: not a wt slot.
function readSlotMarker(worktreePath) {
  const gitDir = gitDirOf(worktreePath);
  if (!gitDir) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(gitDir, MARKER), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn(`[slots] unreadable ${MARKER} in ${gitDir}:`, err);
    return undefined;
  }
}

// Same states as `wt list`: Unity holds Temp/UnityLockfile while the project is open.
// changes: the worktree's changed files (worktreeFiles.js), undefined when git failed.
function worktreeState(worktreePath, changes) {
  if (fs.existsSync(path.join(worktreePath, 'Temp', 'UnityLockfile'))) return 'unity open';
  if (!changes) return undefined;
  return changes.length ? 'dirty' : 'clean';
}

module.exports = { readSlotMarker, worktreeState };
