const vscode = require('vscode');
const { log } = require('./logger');
const { getFocusedRepository, repoName, sortedRepositories, onRepositoriesChange } = require('./gitRepos');

// workspaceState key: roots of the repositories checked in the sidebar's selector
const REPOS_KEY = 'gitWeave.repos';
// Repository state fires on every file save: coalesce into one reload.
const RELOAD_DELAY_MS = 300;

// The repositories the sidebar and the graph show together (WebStorm's multi-root log): checked in the
// sidebar, not Source Control's selection (the git API cannot set that one), which is the fallback.
// onDidChange: a new selection, or any repository changed.
class RepoSelection {
  constructor(context, git) {
    this.context = context;
    this.git = git;
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
    let timer;
    this.disposables = [
      this.emitter,
      onRepositoriesChange(git, () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.emitter.fire(), RELOAD_DELAY_MS);
      }),
      { dispose: () => clearTimeout(timer) },
    ];
  }

  // Selected repositories, in the selector's order.
  repos() {
    const roots = this.context.workspaceState.get(REPOS_KEY) || [];
    const repos = sortedRepositories(this.git).filter((r) => roots.includes(r.rootUri.fsPath));
    if (repos.length) return repos;
    const focused = getFocusedRepository(this.git);
    return focused ? [focused] : [];
  }

  // Color index of a repository (dom.js repoColor): its rank among all of them, so it keeps its color
  // in the graph and the sidebar whatever is checked.
  colorOf(repo) {
    return sortedRepositories(this.git).findIndex((r) => r.rootUri.fsPath === repo.rootUri.fsPath);
  }

  byRoot(root) {
    return this.git.repositories.find((r) => r.rootUri.fsPath === root);
  }

  // A menu context's repository: the row's own (ctx.root), else the only selected one, else asked.
  async pick(ctx) {
    const own = ctx && ctx.root && this.byRoot(ctx.root);
    if (own) return own;
    const repos = this.repos();
    if (repos.length <= 1) return repos[0];
    const item = await vscode.window.showQuickPick(
      repos.map((repo) => ({ label: repoName(repo), description: repo.rootUri.fsPath, repo })),
      { placeHolder: 'Repository' }
    );
    return item && item.repo;
  }

  async set(roots) {
    const known = roots.filter((root) => this.byRoot(root));
    if (!known.length) return;
    log.info(`[repos] selected: ${known.map((root) => repoName(this.byRoot(root))).join(', ')}`);
    await this.context.workspaceState.update(REPOS_KEY, known);
    this.emitter.fire();
  }

  // Changes git does not report through the repository state (a dropped stash, a deleted tag).
  refresh() {
    this.emitter.fire();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

module.exports = { RepoSelection };
