// Branch and tag rows of the sidebar view (sidebar.js). Click: select the ref's commit in the graph;
// double-click: checkout; right-click: the branch actions (package.json webview/context).
(function () {
  const { el, codicon, menuContext, actionButton } = window.dom;
  const { tree } = window;
  const RefType = { Head: 0, RemoteHead: 1, Tag: 2 }; // as branches.js

  // Context of a ref for the webview/context menus; also used by the graph's pills.
  function refContext(ref) {
    const section = ref.type === RefType.Head ? 'localBranch' : ref.type === RefType.RemoteHead ? 'remoteBranch' : 'tag';
    return { webviewSection: section, ref, root: ref.root, isCurrent: !!ref.current };
  }

  // Fetch button of the Local section (ctx {}: every checked repository) and of a repository row (ctx { root }).
  function fetchButton(api, ctx) {
    return actionButton('cloud-download', 'Fetch', () => api.command('gitWeave.sync.fetch', ctx));
  }

  function row(ref, depth, api, nameOf) {
    const key = `ref:${ref.root}:${ref.type}:${ref.name}`;
    const div = el('div', `tree-row ref${ref.current ? ' current' : ''}`);
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, true);
    const icon = ref.type === RefType.Tag ? 'tag' : ref.current ? 'check' : ref.type === RefType.RemoteHead ? 'cloud' : 'git-branch';
    const name = nameOf(ref);
    div.append(codicon(icon), el('span', 'name', name.substring(name.lastIndexOf('/') + 1)));
    const track = trackOf(ref);
    if (ref.gone) div.append(el('span', 'description', track));
    else if (track) {
      const counts = el('span', 'description track');
      if (ref.ahead) counts.append(codicon('arrow-up'), String(ref.ahead));
      if (ref.behind) counts.append(codicon('arrow-down'), String(ref.behind));
      div.append(counts);
    }
    if (ref.type === RefType.Head) {
      // Hover button, as the native tree's inline actions: the same command as the context menu's Push.
      if (!div.querySelector('.description')) div.append(el('span', 'spacer'));
      div.append(
        actionButton('cloud-download', 'Fetch', () => api.command('gitWeave.branches.fetch', refContext(ref))),
        actionButton('repo-pull', 'Pull', () => api.command('gitWeave.branches.pull', refContext(ref))),
        actionButton('repo-push', 'Push', () => api.command('gitWeave.branches.push', refContext(ref)))
      );
    }
    div.title = [ref.name, ref.upstream ? `→ ${ref.upstream.remote}/${ref.upstream.name}` : '', track, ref.commit.substring(0, 7)].filter(Boolean).join('  ');
    menuContext(div, refContext(ref));
    div.addEventListener('click', () => {
      api.select(key);
      api.reveal(ref.commit, ref.root);
    });
    if (ref.type !== RefType.Tag) div.addEventListener('dblclick', () => api.post({ type: 'checkout', ref }));
    return div;
  }

  // "↑1 ↓2" against the upstream, as the status bar shows it (the row draws it with arrow icons; this is the tooltip)
  function trackOf(ref) {
    if (ref.gone) return 'upstream gone';
    return [ref.ahead ? `↑${ref.ahead}` : '', ref.behind ? `↓${ref.behind}` : ''].filter(Boolean).join(' ');
  }

  window.refs = { row, refContext, fetchButton };
})();
