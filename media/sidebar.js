// Sidebar view (sidebarView.js), our own Source Control: the repository checkboxes, the commit box, then
// the checked repositories' sections (Merge / Staged / Changes, Local, Remote per remote, Worktrees,
// Stashes, Tags), each collapsible, one sub-folder per repository when several are checked, "feature/x"
// names as folders. Rows come from workingTree.js, refs.js, worktrees.js and stashes.js; right-click menus
// are package.json webview/context. A ref, worktree or stash click acts in the graph tab, through the extension.
(function () {
  const vscode = acquireVsCodeApi();
  const { el, codicon, actionButton, menuContext, repoIcon, repoColor } = window.dom;
  const { tree, refs, worktrees, stashes, workingTree } = window;

  const reposToggle = document.getElementById('repos-toggle');
  const reposList = document.getElementById('repos-list');
  const branchesEl = document.getElementById('branches');
  const state = Object.assign({ collapsed: ['§tags'], selectedKey: undefined, reposOpen: false }, vscode.getState());
  const collapsed = new Set(state.collapsed);
  let data; // { repos: [{ root, name, branch, selected }], groups: [{ root, name, refs, worktrees, stashes, changes }] }
  const post = (msg) => vscode.postMessage(msg);
  const saveState = () => vscode.setState({ ...state, collapsed: [...collapsed] });

  // What row builders get: post a message, reveal a commit, select a row (highlighted until another one).
  const api = {
    post,
    // Runs a command as its context menu would, with the row's menu context as argument.
    command: (command, ctx) => post({ type: 'command', command, ctx }),
    reveal: (hash, root) => post({ type: 'reveal', hash, root }),
    stash: (stash) => post({ type: 'stash', stash }),
    isSelected: (key) => key === state.selectedKey,
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
    const label = checked.length === 1 ? checked[0].name : checked.length === data.repos.length ? `All repositories (${checked.length})` : checked.map((r) => r.name).join(', ');
    const icon = checked.length === 1 ? repoIcon(checked[0].color) : codicon('repo');
    reposToggle.replaceChildren(codicon(state.reposOpen ? 'chevron-down' : 'chevron-right'), icon, el('span', 'name', label));
    if (checked.length === 1 && checked[0].branch) reposToggle.append(el('span', 'description', checked[0].branch));
    reposToggle.title = checked.map((r) => r.root).join('\n');
    reposList.hidden = !state.reposOpen;
    const rows = data.repos.map((repo) => repoRow(repo, checked));
    if (data.repos.length > 1) rows.unshift(allRow(checked));
    reposList.replaceChildren(...rows);
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
    // The last checked one stays: the views always show a repository.
    box.disabled = repo.selected && checked.length === 1;
    box.addEventListener('change', () => {
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

  function allRow(checked) {
    const { row, box } = checkRow(checked.length === data.repos.length, 'All repositories');
    box.indeterminate = checked.length > 0 && checked.length < data.repos.length;
    box.addEventListener('change', () => selectRepos(box.checked ? data.repos.map((r) => r.root) : [data.repos.find((r) => r.selected).root]));
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
    bySection(out, '§local', 'Local', (g) => g.refs.local, (o, g, key, depth) => named(o, key, g.refs.local, refName, refs.row, depth));
    bySection(out, '§remote', 'Remote', (g) => g.refs.remote, remotes);
    const createWorktree = actionButton('add', 'Create Worktree…', () => api.command('gitWeave.worktrees.create', {}));
    bySection(out, '§worktrees', 'Worktrees', (g) => g.worktrees, (o, g, key, depth) => flat(o, g.worktrees, worktrees.row, depth), { actions: [createWorktree] });
    const stashMenu = { webviewSection: 'stashes' };
    const createStash = actionButton('add', 'Stash Changes…', () => api.command('gitWeave.stashes.create', stashMenu));
    bySection(out, '§stashes', 'Stashes', (g) => g.stashes, (o, g, key, depth) => flat(o, g.stashes, stashes.row, depth), { actions: [createStash], menu: stashMenu, keepEmpty: true });
    bySection(out, '§tags', 'Tags', (g) => g.refs.tags, (o, g, key, depth) => named(o, key, g.refs.tags, refName, refs.row, depth));
    branchesEl.replaceChildren(...out);
  }

  // A section filled from each checked repository: fill(out, group, key, depth) appends a repository's
  // rows, under a sub-folder per repository when several are checked. options: { actions, menu, keepEmpty }.
  function bySection(out, key, label, itemsOf, fill, { actions, menu, keepEmpty } = {}) {
    const groups = data.groups.filter((g) => itemsOf(g).length);
    const count = groups.reduce((n, g) => n + itemsOf(g).length, 0);
    if (!count && !keepEmpty) return;
    out.push(sectionRow(key, label, 0, count, actions, menu));
    if (collapsed.has(key)) return;
    if (data.groups.length === 1) return groups.forEach((g) => fill(out, g, key, 1));
    for (const g of groups) {
      const sub = `${key}/${g.root}`;
      const row = tree.folderRow({ label: g.name, path: sub, depth: 1, count: itemsOf(g).length }, collapsed, changed, ['repo', 'repo']);
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
      out.push(tree.folderRow({ label: name || '(no remote)', path: sub, depth, count: mine.length }, collapsed, changed, ['cloud', 'cloud']));
      if (!collapsed.has(sub)) named(out, sub, mine, nameOf, refs.row, depth + 1);
    }
  }

  // Slash-named items as a folder tree.
  function named(out, key, items, nameOf, rowOf, depth) {
    for (const row of tree.flatten(tree.build(items, nameOf), collapsed, nameOf, depth, key)) {
      out.push(row.folder ? tree.folderRow(row, collapsed, changed) : rowOf(row.item, row.depth, api, nameOf));
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
