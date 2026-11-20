// Sidebar view (sidebarView.js), our own Source Control: the repository checkboxes, the commit box, then
// the checked repositories' sections (Merge / Staged / Changes, Local, Remote per remote, Worktrees,
// Stashes, Tags), each collapsible, one sub-folder per repository when several are checked, "feature/x"
// names as folders. Rows come from workingTree.js, refs.js, worktrees.js and stashes.js; right-click menus
// are package.json webview/context. A ref, worktree or stash click acts in the graph tab, through the extension.
(function () {
  const vscode = acquireVsCodeApi();
  const { el, codicon, actionButton, menuContext, repoIcon, repoColor, busy, busyKey } = window.dom;
  const { tree, files, refs, worktrees, stashes, workingTree } = window;

  const reposToggle = document.getElementById('repos-toggle');
  const reposList = document.getElementById('repos-list');
  const branchesEl = document.getElementById('branches');
  const state = Object.assign({ collapsed: ['§tags'], expanded: [], selectedKey: undefined, reposOpen: false, filesAsTree: false }, vscode.getState());
  const collapsed = new Set(state.collapsed);
  const expanded = new Set(state.expanded); // rows closed by default (a worktree's changes), the user opened
  let data; // { repos: [{ root, name, branch, selected }], groups: [{ root, name, refs, worktrees, stashes, changes }] }
  const post = (msg) => vscode.postMessage(msg);
  const saveState = () => vscode.setState({ ...state, collapsed: [...collapsed], expanded: [...expanded] });

  // What row builders get: post a message, reveal a commit, select a row (highlighted until another one).
  const api = {
    post,
    // Runs a command as its context menu would, with the row's menu context as argument.
    command: (command, ctx) => post({ type: 'command', command, ctx }),
    // A long command (fetch, pull, push): its button spins until the extension says it is done.
    run: (command, ctx) => {
      const key = busyKey(command, ctx);
      busy.add(key);
      renderTree();
      post({ type: 'command', command, ctx, key });
    },
    reveal: (hash, root) => post({ type: 'reveal', hash, root }),
    stash: (stash) => post({ type: 'stash', stash }),
    isSelected: (key) => key === state.selectedKey,
    // A repository's HEAD commit: its refs' icons use HEAD's color, as the graph's pills there.
    headOf: (root) => (data.groups.find((g) => g.root === root) || {}).head,
    // The changes' tree / list layout, and what their folder rows need (the collapsed set, a re-render).
    filesAsTree: () => state.filesAsTree,
    // One tree / list choice for every file list of the view (changes, worktrees' changes), as in Source Control.
    layoutButton: () =>
      files.layoutButton(state.filesAsTree, () => {
        state.filesAsTree = !state.filesAsTree;
        changed();
      }),
    collapsed,
    expanded,
    changed: () => changed(),
    select: (key) => {
      state.selectedKey = key;
      saveState();
      renderTree();
    },
  };

  function render(msg) {
    data = msg;
    workingTree.update(msg.commit);
    renderRepos();
    renderTree();
  }

  // The selector: a summary row, opened into one checkbox per repository (WebStorm's root filter).
  function renderRepos() {
    const checked = data.repos.filter((r) => r.selected);
    // Always named "Repositories", with the checked count ("2/3" when not all are).
    const count = checked.length === data.repos.length ? `${checked.length}` : `${checked.length}/${data.repos.length}`;
    reposToggle.replaceChildren(codicon(state.reposOpen ? 'chevron-down' : 'chevron-right'), el('span', 'name', 'Repositories'), el('span', 'description', count));
    reposToggle.title = checked.map((r) => r.root).join('\n');
    reposList.hidden = !state.reposOpen;
    reposList.replaceChildren(...data.repos.map((repo) => repoRow(repo, checked)));
  }

  function checkRow(checked, name, description, icon) {
    const row = el('label', 'tree-row repo-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    row.append(box);
    if (icon) row.append(icon);
    row.append(el('span', 'name', name));
    if (description) row.append(el('span', 'description', description));
    return { row, box };
  }

  function repoRow(repo, checked) {
    const { row, box } = checkRow(repo.selected, repo.name, repo.branch, repoIcon(repo.color));
    row.title = repo.root;
    box.addEventListener('change', () => {
      // The last checked one stays checked (the views always show a repository): clicking it selects all.
      if (!box.checked && checked.length === 1 && repo.selected) return selectRepos(data.repos.map((r) => r.root));
      const roots = data.repos.filter((r) => (r === repo ? box.checked : r.selected)).map((r) => r.root);
      selectRepos(roots);
    });
    if (data.repos.length > 1) {
      const only = actionButton('target', 'Only This Repository', () => selectRepos([repo.root]));
      only.addEventListener('click', (e) => e.preventDefault()); // a click in a label would toggle its checkbox
      row.append(el('span', 'spacer'), only);
    }
    return row;
  }

  function selectRepos(roots) {
    data.repos.forEach((r) => (r.selected = roots.includes(r.root)));
    renderRepos();
    post({ type: 'selectRepos', roots });
  }

  function toggleRepos() {
    state.reposOpen = !state.reposOpen;
    saveState();
    renderRepos();
  }

  function renderTree() {
    const out = [];
    workingTree.sections(out, bySection);
    const refName = (ref) => ref.name;
    bySection(out, '§local', 'Local', (g) => g.refs.local, (o, g, key, depth) => named(o, key, g.refs.local, refName, refs.row, depth), {
      noCount: true,
      actions: [refs.fetchButton(api, {})],
      rowActions: (g) => [refs.fetchButton(api, { root: g.root })],
    });
    bySection(out, '§remote', 'Remote', (g) => g.refs.remote, remotes, {
      noCount: true,
      actions: [refs.fetchButton(api, {})],
      rowActions: (g) => [refs.fetchButton(api, { root: g.root })],
    });
    const createWorktree = actionButton('add', 'Create Worktree…', () => api.command('gitWeave.worktrees.create', {}));
    bySection(out, '§worktrees', 'Worktrees', (g) => g.worktrees, (o, g, key, depth) => g.worktrees.forEach((wt) => worktrees.rows(o, wt, depth, api)), { actions: [api.layoutButton(), createWorktree] });
    const stashMenu = { webviewSection: 'stashes' };
    const createStash = actionButton('add', 'Stash Changes…', () => api.command('gitWeave.stashes.create', stashMenu));
    bySection(out, '§stashes', 'Stashes', (g) => g.stashes, (o, g, key, depth) => flat(o, g.stashes, stashes.row, depth), { actions: [createStash], menu: stashMenu, keepEmpty: true });
    bySection(out, '§tags', 'Tags', (g) => g.refs.tags, (o, g, key, depth) => named(o, key, g.refs.tags, refName, refs.row, depth), { noCount: true });
    workingTree.keepCaret(() => branchesEl.replaceChildren(...out));
  }

  // A section filled from each checked repository: fill(out, group, key, depth) appends a repository's
  // rows, under a sub-folder per repository when several are checked. options: { actions, menu, keepEmpty,
  // noCount, footer }: noCount hides the section's number (the branches', whose lists show themselves);
  // footer: a node shown under the section's rows while it is open.
  function bySection(out, key, label, itemsOf, fill, { actions, menu, keepEmpty, noCount, footer, rowActions } = {}) {
    const groups = data.groups.filter((g) => itemsOf(g).length);
    const count = groups.reduce((n, g) => n + itemsOf(g).length, 0);
    if (!count && !keepEmpty) return;
    out.push(sectionRow(key, label, 0, noCount ? undefined : count, actions, menu));
    if (collapsed.has(key)) return;
    sectionRows(out, key, groups, fill, menu, rowActions);
    if (footer) out.push(footer);
  }

  // rowActions(group) -> the hover buttons of a repository's sub-folder.
  function sectionRows(out, key, groups, fill, menu, rowActions) {
    for (const g of groups) {
      const sub = `${key}/${g.root}`;
      const row = tree.folderRow({ label: g.name, path: sub, depth: 1 }, collapsed, changed, ['repo', 'repo'], rowActions && rowActions(g));
      row.querySelector('.codicon-repo').style.color = repoColor(g.color);
      row.title = g.root;
      if (menu) menuContext(row, { ...menu, root: g.root });
      out.push(row);
      if (!collapsed.has(sub)) fill(out, g, sub, 2);
    }
  }

  // A repository's remote branches, one folder per remote.
  function remotes(out, g, key, depth) {
    const remote = g.refs.remote;
    for (const name of [...new Set(remote.map((r) => r.remote || ''))].sort()) {
      const mine = remote.filter((r) => (r.remote || '') === name);
      const nameOf = (ref) => (name ? ref.name.substring(name.length + 1) : ref.name);
      const sub = `${key}/${name}`;
      out.push(tree.folderRow({ label: name || '(no remote)', path: sub, depth }, collapsed, changed, ['cloud', 'cloud']));
      if (!collapsed.has(sub)) named(out, sub, mine, nameOf, refs.row, depth + 1);
    }
  }

  // Slash-named items as a folder tree.
  function named(out, key, items, nameOf, rowOf, depth) {
    for (const row of tree.flatten(tree.build(items, nameOf), collapsed, nameOf, depth, key)) {
      out.push(row.folder ? tree.folderRow({ ...row, count: undefined }, collapsed, changed) : rowOf(row.item, row.depth, api, nameOf));
    }
  }

  function flat(out, items, rowOf, depth) {
    for (const item of items) out.push(rowOf(item, depth, api));
  }

  function sectionRow(key, label, depth, count, actions, menu) {
    const row = tree.folderRow({ label, path: key, depth, count }, collapsed, changed, [null, null], actions);
    row.classList.add('section');
    if (menu) menuContext(row, menu);
    return row;
  }

  function changed() {
    saveState();
    renderTree();
  }

  function showEmpty(message) {
    reposToggle.replaceChildren();
    reposList.replaceChildren();
    branchesEl.replaceChildren(el('div', 'placeholder', message));
  }

  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'refs') render(msg);
    else if (msg.type === 'empty') showEmpty(msg.message);
    else if (msg.type === 'committed') workingTree.committed(msg.ok);
    else if (msg.type === 'commandDone') {
      busy.delete(msg.key);
      if (data) renderTree();
    }
  });
  reposToggle.addEventListener('click', toggleRepos);
  reposToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleRepos();
    }
  });
  workingTree.init(api);
  post({ type: 'ready' });
})();
