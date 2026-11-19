const vscode = require('vscode');
const { log } = require('./logger');
const { repoName, withRoot } = require('./gitRepos');
const { loadGraph, positionOf, rowId } = require('./graphData');
const { loadRefs } = require('./refs');
const { registerWorktreeCommands } = require('./worktrees');
const { loadStashes, registerStashCommands } = require('./stashes');
const { checkoutRef, registerBranchCommands, registerSyncCommands, RefType } = require('./branches');
const { commitChanges, openDiff, openFile } = require('./commitFiles');
const { registerChangeCommands } = require('./workingChanges');
const { webviewOptions, webviewHtml } = require('./webviewHtml');

const VIEW_TYPE = 'gitWeave.graph';
const PAGE_SIZE = 500;
// WebStorm's Git log in an editor tab (a sidebar or panel view is too cramped): the commit graph of the
// repositories checked in the sidebar (repoSelection.js), merged by date, the selected commits' files on
// the right. One instance.
class GraphPanel {
  constructor(context, git, selection) {
    this.context = context;
    this.git = git;
    this.selection = selection;
    this.panel = undefined;
    this.selected = []; // selected commits, display order: { id, root, hash, parents, wip }
    this.shownKey = undefined; // roots of the repositories shown
    this.ids = new Set(); // loaded row ids
    this.hasMore = false;
    this.limit = PAGE_SIZE;
    this.loadId = 0;
    this.pending = undefined; // a sidebar click that opened the graph, run after its first load
    this.disposables = [selection.onDidChange(() => this.load())];
  }

  // Opens in a new editor group below the current editors (WebStorm's Git window), alone when none is open.
  async open() {
    if (this.panel) return this.panel.reveal();
    log.info('[graph] open');
    if (vscode.window.tabGroups.all.some((g) => g.tabs.length)) await vscode.commands.executeCommand('workbench.action.newGroupBelow');
    this.attach(vscode.window.createWebviewPanel(VIEW_TYPE, 'Graph', vscode.ViewColumn.Active, this.options()));
  }

  // Locks the graph's editor group so a file opened from the Explorer goes to another group. The command acts on
  // the active group only: a restored panel in a background group waits until it is active (no tab check:
  // tabGroups is not updated yet right after the panel is created).
  lockGroupWhenActive(panel) {
    const lock = () => {
      log.info('[graph] locking its editor group');
      return vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    };
    if (panel.active) return lock();
    const sub = panel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.active) return;
      sub.dispose();
      lock();
    });
  }

  // Status bar button: open, bring forward when behind another tab, close when shown.
  toggle() {
    if (!this.panel) return this.open();
    if (!this.panel.visible) return this.panel.reveal();
    log.info('[graph] toggled off');
    this.panel.dispose();
  }

  // From the sidebar: run msg in the graph, opening it first (msg then waits for its first load).
  async show(msg) {
    if (msg.type === 'showStash') msg = { ...msg, stash: { ...msg.stash, id: rowId(msg.stash.root, msg.stash.hash) } };
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return msg.type === 'reveal' ? this.reveal(msg.root, msg.hash) : this.post(msg);
    }
    this.pending = msg;
    await this.open();
  }

  // Also the restore path of a tab left open when the window reloaded (registerWebviewPanelSerializer).
  attach(panel) {
    this.panel = panel;
    panel.iconPath = new vscode.ThemeIcon('git-merge');
    panel.webview.options = this.options();
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.lockGroupWhenActive(panel);
    panel.onDidDispose(() => {
      log.info('[graph] closed');
      this.panel = undefined;
      this.shownKey = undefined;
      this.selected = [];
      this.pending = undefined;
    });
  }

  options() {
    // Kept alive when hidden: rebuilding thousands of rows and the scroll position on every tab switch costs more.
    return { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true };
  }

  // The latest load; reveal() waits for it, an older one's result being dropped.
  load() {
    const loading = this.loadRows();
    this.lastLoad = loading;
    return loading;
  }

  async settled() {
    let loading;
    do {
      loading = this.lastLoad;
      await loading;
    } while (loading !== this.lastLoad);
  }

  async loadRows() {
    if (!this.panel) return;
    const repos = this.selection.repos();
    const key = repos.map((r) => r.rootUri.fsPath).join('\n');
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.limit = PAGE_SIZE;
      this.selected = [];
    }
    if (!repos.length) return this.post({ type: 'empty', message: 'No git repository open.' });
    const names = repos.map(repoName).join(', ');
    const id = ++this.loadId;
    const started = Date.now();
    try {
      // refs: the pills' menus; stashes: drop a shown stash once it is gone.
      const [{ rows, hasMore }, refs, stashes] = await Promise.all([
        loadGraph(repos, this.limit),
        Promise.all(repos.map(async (repo) => withRoot(repo, await loadRefs(repo)))),
        Promise.all(repos.map(async (repo) => (await loadStashes(repo)).map((s) => rowId(repo.rootUri.fsPath, s.hash)))),
      ]);
      if (id !== this.loadId) return; // a newer load is running
      log.info(`[graph] ${names}: ${rows.length} rows in ${Date.now() - started} ms${hasMore ? ' (more available)' : ''}`);
      this.ids = new Set(rows.map((r) => r.id));
      this.hasMore = hasMore;
      this.panel.title = repos.length > 2 ? `Graph: ${repos.length} repositories` : `Graph: ${names}`;
      const repoList = repos.map((r) => ({ root: r.rootUri.fsPath, name: repoName(r), color: this.selection.colorOf(r) }));
      this.post({ type: 'graph', repos: repoList, refs, stashes: stashes.flat(), rows, hasMore });
      if (this.selected.some((c) => c.wip)) this.select(this.selected); // the working tree changed under it
      const pending = this.pending;
      this.pending = undefined;
      // Not awaited: its reveal waits for this load to settle.
      if (pending) this.show(pending).catch((err) => log.error('[graph] pending action failed:', err));
    } catch (err) {
      if (id !== this.loadId) return;
      log.error(`[graph] ${names}: load failed:`, err);
      this.post({ type: 'empty', message: `git log failed: ${err.message}` });
    }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        return this.load();
      case 'loadMore':
        this.limit += PAGE_SIZE;
        log.info(`[graph] load more: ${this.limit} commits`);
        return this.load();
      case 'select':
        return this.select(msg.commits);
      case 'openDiff':
        return this.fileAction('openDiff', msg.file);
      case 'checkout': {
        const repo = msg.ref && this.selection.byRoot(msg.ref.root);
        return repo && checkoutRef(repo, { name: msg.ref.name, remote: msg.ref.type === RefType.RemoteHead });
      }
      default:
        log.warn('[graph] unknown webview message:', msg);
    }
  }

  // Files of the selected commits, per repository; prefixed with the repository's name when the graph shows several.
  async select(commits) {
    this.selected = commits || [];
    if (!this.selected.length) return;
    const key = this.selected.map((c) => c.id).join(',');
    const label = this.selected.length === 1 ? this.selected[0].hash.substring(0, 7) : `${this.selected.length} commits`;
    const multi = this.selection.repos().length > 1;
    const id = (this.selectId = (this.selectId || 0) + 1);
    try {
      const byRoot = new Map();
      for (const c of this.selected) byRoot.set(c.root, [...(byRoot.get(c.root) || []), c]);
      const parts = await Promise.all(
        [...byRoot].map(async ([root, list]) => {
          const repo = this.selection.byRoot(root);
          if (!repo) return { files: [], body: '' };
          const { files, body } = await commitChanges(repo, list);
          return { files: withRoot(repo, files).map((f) => (multi ? { ...f, repoName: repoName(repo) } : f)), body };
        })
      );
      if (id !== this.selectId) return; // the selection changed meanwhile
      const files = parts.flatMap((p) => p.files);
      log.info(`[graph] ${label}: ${files.length} files`);
      this.post({ type: 'commit', key, files, body: parts.length === 1 ? parts[0].body : '' });
    } catch (err) {
      if (id !== this.selectId) return;
      log.error(`[graph] ${label}: listing files failed:`, err);
      this.post({ type: 'commit', key, files: [], body: '', error: err.message });
    }
  }

  // A file of the selected commits or of the sidebar's changes: from a click (message) or a context menu.
  async fileAction(action, file) {
    const repo = file && this.selection.byRoot(file.root);
    if (!repo) return;
    try {
      if (action === 'openDiff') await openDiff(this.git, repo, file);
      else if (action === 'openFile') await openFile(this.git, repo, file);
      else if (action === 'copyPath') await vscode.env.clipboard.writeText(file.path);
    } catch (err) {
      log.error(`[graph] ${action} ${file.path} failed:`, err);
      vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
    }
  }

  // A branch or worktree clicked in the sidebar: load the pages up to its commit, then select it. Its
  // position in its own repository is a lower bound of the rows to load when several are merged.
  async reveal(root, hash) {
    const repo = this.selection.byRoot(root);
    if (!repo) return;
    const id = rowId(root, hash);
    await this.settled();
    if (!this.ids.has(id)) {
      const position = await positionOf(repo, hash);
      if (position === -1) return log.warn(`[graph] ${hash} is not in the graph's history`);
      this.limit = Math.max(this.limit, Math.ceil((position + 1) / PAGE_SIZE) * PAGE_SIZE);
      for (;;) {
        log.info(`[graph] reveal ${hash.substring(0, 7)}: load ${this.limit} commits`);
        this.load();
        await this.settled();
        if (this.ids.has(id) || !this.hasMore) break;
        this.limit *= 2;
      }
      if (!this.ids.has(id)) return log.warn(`[graph] ${hash} not loaded`);
    }
    this.post({ type: 'reveal', id });
  }

  post(msg) {
    if (this.panel) this.panel.webview.postMessage(msg);
  }

  html() {
    return webviewHtml(this.panel.webview, this.context.extensionUri, {
      styles: ['graph.css'],
      body: `<div id="log">
<div id="header"></div>
<div id="scroller" tabindex="0"><div id="canvas"></div></div>
<div id="empty" hidden></div>
</div>
<div id="splitter" class="splitter"></div>
<div id="side">
<div id="files"></div>
<div id="details"></div>
</div>`,
      scripts: ['files.js', 'changes.js', 'graph.js'],
    });
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function statusBarButton() {
  const item = vscode.window.createStatusBarItem('gitWeave.graph', vscode.StatusBarAlignment.Left, 0);
  item.name = 'Git Graph';
  item.text = '$(git-merge) Graph';
  item.tooltip = 'Toggle Git Graph';
  item.command = 'gitWeave.graph.toggle';
  item.show();
  return item;
}

function registerGraphView(context, git, selection) {
  const graph = new GraphPanel(context, git, selection);
  context.subscriptions.push(
    graph,
    statusBarButton(),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel) => {
        log.info('[graph] restored');
        graph.attach(panel);
      },
    }),
    vscode.commands.registerCommand('gitWeave.graph.open', () => graph.open()),
    vscode.commands.registerCommand('gitWeave.graph.toggle', () => graph.toggle()),
    vscode.commands.registerCommand('gitWeave.graph.refresh', () => selection.refresh()),
    vscode.commands.registerCommand('gitWeave.graph.copySha', (ctx) => ctx && vscode.env.clipboard.writeText(ctx.sha)),
    ...['openDiff', 'openFile', 'copyPath'].map((action) =>
      vscode.commands.registerCommand(`gitWeave.graph.${action}`, (ctx) => ctx && graph.fileAction(action, ctx.file))
    ),
    { dispose: () => graph.panel && graph.panel.dispose() }
  );
  // Menus of the sidebar's rows and of the graph's pills: ctx.root is the row's repository.
  const own = (ctx) => selection.byRoot(ctx.root);
  registerBranchCommands(context, (ctx) => own(ctx) && ctx.ref && { repo: own(ctx), ref: ctx.ref });
  registerWorktreeCommands(context, (ctx) => own(ctx) && { repo: own(ctx), worktree: ctx.worktree });
  registerStashCommands(context, async (ctx) => {
    const repo = await selection.pick(ctx);
    return repo && { repo, stash: ctx.stash };
  }, () => selection.refresh());
  // A section's "all" actions: every selected repository; a file's: its own.
  const reposOf = (ctx) => (ctx.root ? [own(ctx)].filter(Boolean) : selection.repos());
  registerChangeCommands(context, reposOf);
  registerSyncCommands(context, reposOf);
  return graph;
}

module.exports = { registerGraphView };
