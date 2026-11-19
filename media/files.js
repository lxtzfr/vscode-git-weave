// Changed-file rows and their tree / list layout, shared by the graph's right pane (changes.js), the sidebar's
// changes (workingTree.js) and another worktree's changes (worktrees.js).
(function () {
  const { el, codicon, menuContext, actionButton } = window.dom;
  const { tree } = window;
  // Same letters as the Source Control view; colors in common.css (gitDecoration.*).
  const STATUS = {
    A: ['added', 'Added'],
    M: ['modified', 'Modified'],
    D: ['deleted', 'Deleted'],
    R: ['renamed', 'Renamed'],
    C: ['added', 'Copied'],
    T: ['modified', 'Type changed'],
    U: ['untracked', 'Untracked'],
    '!': ['conflict', 'Conflict'],
  };

  // file: { status, path, oldPath }; folder: show its folder as description (flat lists);
  // context: extra keys for the webview/context menus; actions: hover buttons.
  function row(file, { depth = 0, selected, folder, context, actions = [], onClick }) {
    const [cls, label] = STATUS[file.status] || STATUS.M;
    const div = el('div', `tree-row file ${cls}`);
    if (selected) div.classList.add('selected');
    tree.indent(div, depth, true);
    const slash = file.path.lastIndexOf('/');
    div.append(codicon('file'), el('span', 'name', file.path.substring(slash + 1)));
    const description = [folder && slash > 0 ? file.path.substring(0, slash) : '', file.oldPath ? `← ${file.oldPath}` : ''].filter(Boolean).join('  ');
    if (description) div.append(el('span', 'description', description));
    if (actions.length) div.append(el('span', 'spacer'), ...actions);
    div.append(el('span', 'letter', file.status));
    div.title = `${file.path} • ${label}${file.oldPath ? ` from ${file.oldPath}` : ''}`;
    menuContext(div, { webviewSection: 'file', file, root: file.root, fileDeleted: file.status === 'D', ...context });
    div.addEventListener('click', onClick);
    return div;
  }

  // The Source Control view's "View as Tree / List" button: its icon is the layout it switches to.
  function layoutButton(asTree, onToggle) {
    return actionButton(asTree ? 'list-flat' : 'list-tree', asTree ? 'View as List' : 'View as Tree', onToggle);
  }

  // Files as a folder tree, or as a list sorted by sortKey (each file's folder as its description).
  // rowOf(file, depth, folder) -> its row; key: the folders' prefix in `collapsed`, so each list collapses its own;
  // onToggle(): re-render after a folder opened or closed.
  function rows(list, { asTree, collapsed, key, depth = 0, onToggle, rowOf, sortKey = (f) => f.path }) {
    if (!asTree) return [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((file) => rowOf(file, depth, true));
    return tree
      .flatten(tree.build(list, (f) => f.path), collapsed, (f) => f.path, depth, key)
      .map((r) => (r.folder ? tree.folderRow(r, collapsed, onToggle) : rowOf(r.item, r.depth, false)));
  }

  window.files = { row, rows, layoutButton };
})();
