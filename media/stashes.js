// Stash rows of the sidebar view (sidebar.js), from stashes.js's loadStashes. Click: its files in the
// right pane; hover buttons and right-click: apply / pop / drop (package.json webview/context).
(function () {
  const { el, codicon, menuContext, actionButton } = window.dom;
  const { tree } = window;
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const UNITS = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  function age(time) {
    const seconds = time - Date.now() / 1000;
    const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) || ['second', 1];
    return relative.format(Math.round(seconds / size), unit);
  }

  function row(stash, depth, api) {
    const key = `stash:${stash.root}:${stash.hash}`;
    const div = el('div', 'tree-row stash');
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, true);
    div.append(codicon('archive'), el('span', 'name', stash.subject), el('span', 'description', `${stash.ref} · ${age(stash.time)}`));
    const ctx = { webviewSection: 'stash', stash, root: stash.root };
    menuContext(div, ctx);
    div.append(
      actionButton('debug-step-back', 'Apply Stash', () => api.command('gitWeave.stashes.apply', ctx)),
      actionButton('trash', 'Drop Stash', () => api.command('gitWeave.stashes.drop', ctx))
    );
    div.title = `${stash.ref}\n${stash.subject}\n${new Date(stash.time * 1000).toLocaleString()}`;
    div.addEventListener('click', () => {
      api.select(key);
      api.stash(stash);
    });
    return div;
  }

  window.stashes = { row };
})();
