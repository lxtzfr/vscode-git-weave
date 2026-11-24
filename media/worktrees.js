// Worktree rows of the sidebar view (sidebar.js), from worktrees.js's loadWorktrees. Click: select the
// worktree's commit in the graph; double-click: open it in a new window; hover buttons and right-click:
// the worktree actions (package.json webview/context). Another worktree's changes unfold under its row, read-only
// (worktreeFiles.js): a file click opens its HEAD ↔ working tree diff.
(function () {
  const { el, codicon, menuContext, actionButton, commitColor } = window.dom;
  const { tree, files } = window;

  // Appends the worktree's row, then its changed files when unfolded.
  function rows(out, wt, depth, api) {
    const key = `worktree:${wt.root}:${wt.path}`;
    // This window's own changes are the Changes sections already.
    const foldable = !wt.current && wt.changes.length > 0;
    const open = foldable && api.expanded.has(key);
    out.push(row(wt, key, depth, api, foldable, open));
    if (!open) return;
    const list = wt.changes.map((change) => ({ ...change, root: wt.root }));
    const rowOf = (file, d, folder) => fileRow(file, d, folder, api);
    out.push(...files.rows(list, { asTree: api.filesAsTree(), collapsed: api.collapsed, key, depth: depth + 1, onToggle: api.changed, rowOf }));
  }

  function row(wt, key, depth, api, foldable, open) {
    const div = el('div', `tree-row worktree${wt.current ? ' current' : ''}`);
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, !foldable);
    if (foldable) {
      const chevron = codicon(open ? 'chevron-down' : 'chevron-right');
      chevron.title = open ? 'Hide Changes' : 'Show Changes (read-only)';
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) api.expanded.delete(key);
        else api.expanded.add(key);
        api.changed();
      });
      chevron.addEventListener('dblclick', (e) => e.stopPropagation());
      div.append(chevron);
    }
    const icon = codicon(wt.current ? 'check' : 'worktree');
    if (wt.commit) icon.style.color = commitColor(wt.commit, wt.commit === api.headOf(wt.root)); // the graph pill's color
    div.append(icon, el('span', 'name', wt.name));
    if (wt.unmerged) div.append(window.refs.unmergedIcon()); // its branch holds work not in the default branch
    const branch = wt.slot && !wt.branch ? 'free' : wt.branch || 'detached';
    const changed = foldable ? `${wt.changes.length} changed` : wt.state;
    const description = [wt.issue ? `#${wt.issue.number} ${wt.issue.title}` : '', branch, wt.main ? 'main' : '', changed].filter(Boolean).join(' · ');
    div.append(el('span', 'description', description));

    const ctx = { webviewSection: 'worktree', worktree: wt, root: wt.root, openable: !wt.current, deletable: !wt.main && !wt.current, hasIssue: !!(wt.issue && wt.issue.url), hasChanges: foldable };
    menuContext(div, ctx);
    if (ctx.hasIssue) div.append(actionButton('issues', 'Open Ticket', () => api.command('gitWeave.worktrees.openIssue', ctx)));
    if (ctx.openable) div.append(actionButton('empty-window', 'Open in New Window', () => api.command('gitWeave.worktrees.openNewWindow', ctx)));
    if (foldable) div.append(actionButton('discard', 'Discard All Changes', () => api.command('gitWeave.worktrees.discardAll', ctx)));

    div.title = [
      `${wt.path}${wt.main ? ' (main checkout)' : ''}${wt.current ? ' (this window)' : ''}`,
      `${branch}${wt.unmerged ? ' (not merged)' : ''}${wt.state ? ` · ${wt.state}` : ''}`,
      wt.issue ? `#${wt.issue.number} ${wt.issue.title}` : '',
      wt.lastSession ? `Last session: ${new Date(wt.lastSession).toLocaleString()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    // With changes: its WIP row (graphData.js hash: WIP + path), else its commit.
    div.addEventListener('click', (e) =>
      api.toggle(e, key, () => {
        if (foldable) api.reveal(`*${wt.path}`, wt.root);
        else if (wt.commit) api.reveal(wt.commit, wt.root);
      })
    );
    if (ctx.openable) div.addEventListener('dblclick', () => api.command('gitWeave.worktrees.openNewWindow', ctx));
    return div;
  }

  // No changeGroup: this window's stage / unstage / discard menus stay off another worktree's files.
  function fileRow(file, depth, folder, api) {
    const key = `worktree-file:${file.root}:${file.worktree}:${file.path}`;
    const ctx = { file, root: file.root };
    const actions = file.right ? [actionButton('go-to-file', 'Open File (read-only)', () => api.command('gitWeave.graph.openFile', ctx))] : [];
    actions.push(actionButton('discard', 'Discard Changes', () => api.command('gitWeave.worktrees.discardFile', ctx)));
    return files.row(file, {
      depth,
      folder,
      selected: api.isSelected(key),
      context: { discardToHead: true },
      actions,
      onClick: () => {
        api.select(key);
        api.post({ type: file.left ? 'openDiff' : 'openFile', file });
      },
    });
  }

  window.worktrees = { rows };
})();
