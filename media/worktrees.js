// Worktree rows of the sidebar view (sidebar.js), from worktrees.js's loadWorktrees. Click: select the
// worktree's commit in the graph; double-click: open it in a new window; hover buttons and right-click:
// the worktree actions (package.json webview/context).
(function () {
  const { el, codicon, menuContext, actionButton } = window.dom;
  const { tree } = window;

  function row(wt, depth, api) {
    const key = `worktree:${wt.root}:${wt.path}`;
    const div = el('div', `tree-row worktree${wt.current ? ' current' : ''}`);
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, true);
    div.append(codicon(wt.current ? 'check' : 'worktree'), el('span', 'name', wt.name));
    const branch = wt.slot && !wt.branch ? 'free' : wt.branch || 'detached';
    const description = [wt.issue ? `#${wt.issue.number} ${wt.issue.title}` : '', branch, wt.main ? 'main' : '', wt.state].filter(Boolean).join(' · ');
    div.append(el('span', 'description', description));

    const ctx = { webviewSection: 'worktree', worktree: wt, root: wt.root, openable: !wt.current, deletable: !wt.main && !wt.current, hasIssue: !!(wt.issue && wt.issue.url) };
    menuContext(div, ctx);
    if (ctx.hasIssue) div.append(actionButton('issues', 'Open Ticket', () => api.command('gitWeave.worktrees.openIssue', ctx)));
    if (ctx.openable) div.append(actionButton('empty-window', 'Open in New Window', () => api.command('gitWeave.worktrees.openNewWindow', ctx)));

    div.title = [
      `${wt.path}${wt.main ? ' (main checkout)' : ''}${wt.current ? ' (this window)' : ''}`,
      `${branch}${wt.state ? ` · ${wt.state}` : ''}`,
      wt.issue ? `#${wt.issue.number} ${wt.issue.title}` : '',
      wt.lastSession ? `Last session: ${new Date(wt.lastSession).toLocaleString()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    div.addEventListener('click', () => {
      api.select(key);
      if (wt.commit) api.reveal(wt.commit, wt.root);
    });
    if (ctx.openable) div.addEventListener('dblclick', () => api.command('gitWeave.worktrees.openNewWindow', ctx));
    return div;
  }

  window.worktrees = { row };
})();
