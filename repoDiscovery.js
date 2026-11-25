const vscode = require('vscode');
const { log } = require('./logger');

// vscode.git scans one level by default, which misses repositories nested in a folder's repository
// (<folder>/workspace/{web,server}). A deeper `git.repositoryScanMaxDepth` still applies.
const MIN_DEPTH = 2;

async function findRepositoryRoots(dir, depth, ignored) {
  let entries;
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch (err) {
    log.warn(`[discovery] cannot read ${dir.fsPath}: ${err.message}`);
    return [];
  }
  const found = await Promise.all(
    entries
      // Dot folders hold tooling checkouts (.git itself, .claude worktrees), not the user's repositories.
      .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.') && !ignored.includes(name))
      .map(async ([name]) => {
        const child = vscode.Uri.joinPath(dir, name);
        // `.git` is a file in a worktree or a submodule, so only its existence counts.
        const isRoot = await vscode.workspace.fs.stat(vscode.Uri.joinPath(child, '.git')).then(() => true, () => false);
        const nested = depth > 1 ? await findRepositoryRoots(child, depth - 1, ignored) : [];
        return isRoot ? [child, ...nested] : nested;
      })
  );
  return found.flat();
}

// Opens the nested repositories in vscode.git, so Source Control and Git Weave both list them.
async function discoverRepositories(git, folders) {
  for (const folder of folders) {
    const config = vscode.workspace.getConfiguration('git', folder.uri);
    const detection = config.get('autoRepositoryDetection');
    if (detection === false || detection === 'openEditors') continue;
    const maxDepth = config.get('repositoryScanMaxDepth', 1);
    const depth = maxDepth < 0 ? Infinity : Math.max(maxDepth, MIN_DEPTH);
    const roots = await findRepositoryRoots(folder.uri, depth, config.get('repositoryScanIgnoredFolders', []));
    log.info(`[discovery] ${folder.name}: ${roots.length} nested repositories found`);
    for (const root of roots) {
      try {
        // A no-op for a repository already open; vscode.git applies its own ignore settings.
        await git.openRepository(root);
      } catch (err) {
        log.warn(`[discovery] cannot open ${root.fsPath}: ${err.message}`);
      }
    }
  }
}

function registerRepoDiscovery(context, git) {
  const run = (folders) => discoverRepositories(git, folders).catch((err) => log.error(`[discovery] ${err.message}`));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e) => run(e.added)));
  run(vscode.workspace.workspaceFolders || []);
}

module.exports = { registerRepoDiscovery };
