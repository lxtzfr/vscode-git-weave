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

  // A commit checkbox over the files `keys` of `checked` (a Set): ticked when all are, mixed when some are.
  function checkbox(keys, checked, onToggle) {
    const box = el('input', 'check');
    box.type = 'checkbox';
    const n = keys.filter((k) => checked.has(k)).length;
    box.checked = n > 0 && n === keys.length;
    box.indeterminate = n > 0 && n < keys.length;
    box.disabled = !keys.length;
    box.addEventListener('click', (e) => {
      e.stopPropagation(); // not the row's own click
      for (const k of keys) {
        if (n === keys.length) checked.delete(k);
        else checked.add(k);
      }
      onToggle();
    });
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    return box;
  }

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
  // rowOf(file, depth, folder) -> its row; decorateFolder(row, its files): adds to a folder row; key: the folders' prefix in `collapsed`, so each list collapses its own;
  // onToggle(): re-render after a folder opened or closed.
  function rows(list, { asTree, collapsed, key, depth = 0, onToggle, rowOf, sortKey = (f) => f.path, decorateFolder }) {
    if (!asTree) return [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((file) => rowOf(file, depth, true));
    return tree
      .flatten(tree.build(list, (f) => f.path), collapsed, (f) => f.path, depth, key)
      .map((r) => {
        if (!r.folder) return rowOf(r.item, r.depth, false);
        const row = tree.folderRow(r, collapsed, onToggle);
        const dir = `${key ? r.path.substring(key.length + 1) : r.path}/`;
        if (decorateFolder) decorateFolder(row, list.filter((file) => file.path.startsWith(dir)));
        return row;
      });
  }

  window.files = { row, rows, layoutButton, checkbox };
})();
