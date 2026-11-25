const vscode = require('vscode');
const { log } = require('./logger');
const { repoName, sortedRepositories, errorText, withRoot } = require('./gitRepos');
const { loadRefs } = require('./refs');
const { loadWorktrees, commitFiles, samePath } = require('./worktrees');
const { loadStashes } = require('./stashes');
const { checkoutRef, RefType } = require('./branches');
const { loadChanges } = require('./workingChanges');
const { webviewOptions, webviewHtml, runWebviewCommand } = require('./webviewHtml');

const VIEW_ID = 'gitWeave.sidebar';

// Our own Source Control (activity bar): repository checkboxes, commit box, then the checked repositories'
// changes, branches, worktrees, stashes and tags (repoSelection.js). A branch or worktree click selects its commit in the graph, a stash click
// shows its files there, a changed file opens its diff.
// Each group's other worktrees to list under Changes, once each: not one checked as a repository (its changes are
// there already), nor twice when two checked repositories are worktrees of the same one.
function listChangedWorktrees(groups) {
  const listed = groups.map((g) => g.root);
  for (const group of groups) {
    group.changedWorktrees = group.worktrees.filter((wt) => !wt.current && wt.changes.length && !listed.some((p) => samePath(p, wt.path)));
    listed.push(...group.changedWorktrees.map((wt) => wt.path));
  }
}

class SidebarView {
  constructor(context, selection, graph) {
    this.context = context;
    this.selection = selection;
    this.graph = graph;
    this.view = undefined;
    this.loadId = 0;
    this.disposables = [selection.onDidChange(() => this.load())];
  }

  resolveWebviewView(view) {
    log.info('[sidebar] resolved');
    this.view = view;
    const { extensionUri } = this.context;
    view.webview.options = webviewOptions(extensionUri);
    view.webview.html = webviewHtml(view.webview, extensionUri, {
      styles: ['sidebar.css'],
      body: `<div id="repos">
<div id="repos-toggle" class="tree-row" tabindex="0"></div>
<div id="repos-list" hidden></div>
</div>
<div hidden>
<div id="commit">
<textarea id="message" rows="1"></textarea>
<button id="commit-button"><span class="codicon codicon-check"></span>Commit</button>
</div>
</div>
<div id="branches"></div>`,
      scripts: ['files.js', 'workingTree.js', 'worktrees.js', 'stashes.js', 'sidebar.js'],
    });
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    // Hidden views are not kept alive: the page reloads and sends 'ready' when shown again.
    view.onDidDispose(() => {
      log.info('[sidebar] disposed');
      this.view = undefined;
    });
  }

  async load() {
    if (!this.view || !this.view.visible) return;
    const selected = this.selection.repos();
    if (!selected.length) return this.post({ type: 'empty', message: 'No git repository open.' });
    const names = selected.map(repoName).join(', ');
    const id = ++this.loadId;
    try {
      const groups = await Promise.all(selected.map((repo) => this.loadRepo(repo)));
      if (id !== this.loadId) return; // a newer load is running
      listChangedWorktrees(groups);
      log.info(`[sidebar] ${names}: ${groups.map((g) => `${g.name} ${g.refs.local.length} local, ${g.worktrees.length} worktrees, ${g.stashes.length} stashes`).join('; ')}`);
      // By root: the git API returns new repository objects on every `repositories` read.
      const selectedRoots = new Set(selected.map((r) => r.rootUri.fsPath));
      const repos = sortedRepositories(this.selection.git).map((r, color) => ({
        root: r.rootUri.fsPath,
        color,
        name: repoName(r),
        branch: r.state.HEAD && r.state.HEAD.name,
        selected: selectedRoots.has(r.rootUri.fsPath),
      }));
      // The draft is the first repository's input box; a single repository's branch goes in the placeholder.
      const [first] = selected;
      const commit = { message: first.inputBox.value, branch: selected.length === 1 ? groups[0].changes.branch : undefined };
      this.post({ type: 'refs', repos, groups, commit });
    } catch (err) {
      if (id !== this.loadId) return;
      log.error(`[sidebar] ${names}: load failed:`, err);
      this.post({ type: 'empty', message: `git failed: ${err.message}` });
    }
  }

  // One repository's sections, every item tagged with its root (the rows' menus act on it).
  async loadRepo(repo) {
    const [refs, worktrees, stashes, changes] = await Promise.all([loadRefs(repo), loadWorktrees(repo), loadStashes(repo), loadChanges(repo)]);
    return {
      root: repo.rootUri.fsPath,
      name: repoName(repo),
      color: this.selection.colorOf(repo),
      head: repo.state.HEAD && repo.state.HEAD.commit,
      refs: withRoot(repo, refs),
      worktrees: withRoot(repo, worktrees.map((wt) => ({ ...wt, unmerged: refs.local.some((b) => b.name === wt.branch && b.unmerged) }))),
      stashes: withRoot(repo, stashes),
      changes: withRoot(repo, changes),
    };
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        return this.load();
      case 'selectRepos':
        return this.selection.set(msg.roots);
      case 'reveal':
        return this.graph.show({ type: 'reveal', root: msg.root, hash: msg.hash, branch: msg.branch });
      case 'deselect':
        return this.graph.deselect();
      case 'stash':
        return this.graph.show({ type: 'showStash', stash: msg.stash });
      case 'openDiff':
      case 'openFile':
        return this.graph.fileAction(msg.type, msg.file);
      case 'message': {
        // The draft lives in the repositories' input boxes: kept across reloads, shared with the native view.
        for (const repo of this.selection.repos()) repo.inputBox.value = msg.text;
        return;
      }
      case 'commit':
        return this.commit(msg.text, msg.targets);
      case 'command':
        return runWebviewCommand(msg, (m) => this.post(m), 'sidebar');
      case 'checkout': {
        const repo = msg.ref && this.selection.byRoot(msg.ref.root);
        return repo && checkoutRef(repo, { name: msg.ref.name, remote: msg.ref.type === RefType.RemoteHead });
      }
      default:
        log.warn('[sidebar] unknown webview message:', msg);
    }
  }

  // targets: [{ root, path, paths }], the checked files of each checkout of a repository.
  async commit(text, targets) {
    let ok = false;
    try {
      const mine = targets.map((t) => ({ ...t, repo: this.selection.byRoot(t.root) })).filter((t) => t.repo);
      ok = await commitFiles(mine, text);
      if (ok) for (const repo of this.selection.repos()) repo.inputBox.value = '';
    } catch (err) {
      log.error('[sidebar] commit failed:', err);
      vscode.window.showErrorMessage(`Commit failed: ${errorText(err)}`);
    }
    // Even after a failure: an earlier checkout may be committed, and other worktrees are not watched.
    this.selection.refresh();
    this.post({ type: 'committed', ok });
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function registerSidebarView(context, selection, graph) {
  const sidebar = new SidebarView(context, selection, graph);
  context.subscriptions.push(sidebar, vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar));
}

module.exports = { registerSidebarView };
