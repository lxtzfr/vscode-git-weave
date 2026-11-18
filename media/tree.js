// Folder tree of slash-named items (file paths, "feature/x" branches), shared by the webview's panes:
// single-child folder chains compacted ("src/utils"), as the SCM tree view does.
(function () {
  const { el, codicon } = window.dom;
  const INDENT = 12;
  const CHEVRON = 16;

  // items -> { folders: Map(name -> node), items: [] }, nameOf(item) = its slash path
  function build(items, nameOf) {
    const root = { folders: new Map(), items: [] };
    for (const item of items) {
      let node = root;
      for (const segment of nameOf(item).split('/').slice(0, -1)) {
        if (!node.folders.has(segment)) node.folders.set(segment, { folders: new Map(), items: [] });
        node = node.folders.get(segment);
      }
      node.items.push(item);
    }
    return root;
  }

  const count = (node) => node.items.length + [...node.folders.values()].reduce((n, f) => n + count(f), 0);

  // Visible rows in order: { folder: true, label, path, depth, count } or { item, depth };
  // collapsed: Set of folder paths (prefixed by `prefix`) the user closed.
  function flatten(node, collapsed, nameOf, depth = 0, prefix = '') {
    const out = [];
    for (const [name, start] of [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let child = start;
      let label = name;
      while (child.items.length === 0 && child.folders.size === 1) {
        const [[sub, next]] = child.folders.entries();
        label += `/${sub}`;
        child = next;
      }
      const path = prefix ? `${prefix}/${label}` : label;
      out.push({ folder: true, label, path, depth, count: count(child) });
      if (!collapsed.has(path)) out.push(...flatten(child, collapsed, nameOf, depth + 1, path));
    }
    const items = [...node.items].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    for (const item of items) out.push({ item, depth });
    return out;
  }

  // A row's left padding; leaves get the chevron's width so their icons line up with the folders'.
  function indent(row, depth, leaf) {
    row.style.paddingLeft = `${depth * INDENT + 4 + (leaf ? CHEVRON : 0)}px`;
  }

  // Collapsible row (folder or section): onToggle() after the collapsed set changed; actions: hover buttons.
  function folderRow({ label, path, depth, count: n }, collapsed, onToggle, icons = ['folder-opened', 'folder'], actions = []) {
    const open = !collapsed.has(path);
    const row = el('div', 'tree-row folder');
    indent(row, depth, false);
    row.append(codicon(open ? 'chevron-down' : 'chevron-right'));
    const icon = open ? icons[0] : icons[1];
    if (icon) row.append(codicon(icon));
    row.append(el('span', 'name', label));
    if (n !== undefined) row.append(el('span', 'description', String(n)));
    if (actions.length) row.append(el('span', 'spacer'), ...actions);
    row.title = path;
    row.addEventListener('click', () => {
      if (open) collapsed.add(path);
      else collapsed.delete(path);
      onToggle();
    });
    return row;
  }

  window.tree = { build, flatten, indent, folderRow };
})();
