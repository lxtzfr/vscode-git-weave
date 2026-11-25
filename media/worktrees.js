// Worktree rows of the sidebar view (sidebar.js), from worktrees.js's loadWorktrees. Click: select the
// worktree's commit in the graph; double-click: open it in a new window; hover buttons and right-click:
// the worktree actions (package.json webview/context). Another worktree's changes show in the Changes section,
// under "repository (worktree)", checkable for the commit as the others; their files are read-only
// (worktreeFiles.js): a click opens the HEAD ↔ working tree diff.
(function () {
  const { el, codicon, menuContext, actionButton, commitColor, repoColor } = window.dom;
  const { tree, files } = window;

  // This window's own changes are the Changes sections already.
  const hasOtherChanges = (wt) => !wt.current && wt.changes.length > 0;

  const menuOf = (wt) => ({ webviewSection: 'worktree', worktree: wt, root: wt.root, openable: !wt.current, deletable: !wt.main && !wt.current, hasIssue: !!(wt.issue && wt.issue.url), hasChanges: hasOtherChanges(wt) });
  const openButton = (api, ctx) => actionButton('empty-window', 'Open in New Window', () => api.command('gitWeave.worktrees.openNewWindow', ctx));
  const discardAllButton = (api, ctx) => actionButton('discard', 'Discard All Changes', () => api.command('gitWeave.worktrees.discardAll', ctx));

  // A repository's part of the Changes section for its other worktrees (group.changedWorktrees, sidebarView.js):
  // one foldable "repository (worktree)" row each, then its files.
  function changeRows(out, group, sectionKey, api, addCheckbox, checkbox) {
    for (const wt of group.changedWorktrees) {
      const key = `${sectionKey}/worktree:${wt.path}`;
      const ctx = menuOf(wt);
      const header = tree.folderRow({ label: `${group.name} (${wt.name})`, path: key, depth: 1 }, api.collapsed, api.changed, ['repo', 'repo'], [openButton(api, ctx), discardAllButton(api, ctx)]);
      header.querySelector('.codicon-repo').style.color = repoColor(group.color);
      header.title = wt.path;
      menuContext(header, ctx);
      const list = wt.changes.map((change) => ({ ...change, root: wt.root }));
      addCheckbox(header, list);
      out.push(header);
      if (api.collapsed.has(key)) continue;
      const rowOf = (file, depth, folder) => {
        const row = fileRow(file, depth, folder, api);
        row.querySelector('.codicon').before(checkbox([file]));
        return row;
      };
      out.push(...files.rows(list, { asTree: api.filesAsTree(), collapsed: api.collapsed, key, depth: 2, onToggle: api.changed, rowOf, decorateFolder: addCheckbox }));
    }
  }

  function row(wt, depth, api) {
    const key = `worktree:${wt.root}:${wt.path}`;
    const changedHere = hasOtherChanges(wt);
    const div = el('div', `tree-row worktree${wt.current ? ' current' : ''}`);
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, true);
    const icon = codicon(wt.current ? 'check' : 'worktree');
    if (wt.commit) icon.style.color = commitColor(wt.commit, wt.commit === api.headOf(wt.root)); // the graph pill's color
    div.append(icon, el('span', 'name', wt.name));
    if (wt.unmerged) div.append(window.refs.unmergedIcon()); // its branch holds work not in the default branch
    const branch = wt.slot && !wt.branch ? 'free' : wt.branch || 'detached';
    const changed = changedHere ? `${wt.changes.length} changed` : wt.state;
    const description = [wt.issue ? `#${wt.issue.number} ${wt.issue.title}` : '', branch, wt.main ? 'main' : '', changed].filter(Boolean).join(' · ');
    div.append(el('span', 'description', description));

    const ctx = menuOf(wt);
    menuContext(div, ctx);
    if (ctx.hasIssue) div.append(actionButton('issues', 'Open Ticket', () => api.command('gitWeave.worktrees.openIssue', ctx)));
    if (ctx.openable) div.append(openButton(api, ctx));
    if (changedHere) div.append(discardAllButton(api, ctx));

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
        if (changedHere) api.reveal(`*${wt.path}`, wt.root);
        else if (wt.commit) api.reveal(wt.commit, wt.root, wt.branch);
      })
    );
    if (ctx.openable) div.addEventListener('dblclick', () => api.command('gitWeave.worktrees.openNewWindow', ctx));
    return div;
  }

  // No changeGroup: the conflict menus stay off another worktree's files.
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

  window.worktrees = { row, changeRows };
})();
