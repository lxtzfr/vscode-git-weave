// Branch and tag rows of the sidebar view (sidebar.js). Click: select the row of the ref's pill in the graph;
// double-click: checkout; right-click: the branch actions (package.json webview/context).
(function () {
  const { el, codicon, menuContext, actionButton, busyKey, commitColor } = window.dom;
  const { tree } = window;
  const RefType = { Head: 0, RemoteHead: 1, Tag: 2 }; // as branches.js

  // Context of a ref for the webview/context menus; also used by the graph's pills.
  function refContext(ref) {
    const section = ref.type === RefType.Head ? 'localBranch' : ref.type === RefType.RemoteHead ? 'remoteBranch' : 'tag';
    return { webviewSection: section, ref, root: ref.root, isCurrent: !!ref.current };
  }

  // A button running a long command: a spinner until it is done (api.run).
  const runButton = (api, icon, title, command, ctx) => actionButton(icon, title, () => api.run(command, ctx), busyKey(command, ctx));

  // Fetch button of the Local section (ctx {}: every checked repository) and of a repository row (ctx { root }).
  const fetchButton = (api, ctx) => runButton(api, 'cloud-download', 'Fetch', 'gitWeave.sync.fetch', ctx);

  function row(ref, depth, api, nameOf) {
    const key = `ref:${ref.root}:${ref.type}:${ref.name}`;
    const div = el('div', `tree-row ref${ref.current ? ' current' : ''}`);
    if (api.isSelected(key)) div.classList.add('selected');
    tree.indent(div, depth, true);
    const icon = ref.type === RefType.Tag ? 'tag' : ref.current ? 'check' : ref.type === RefType.RemoteHead ? 'cloud' : 'git-branch';
    const name = nameOf(ref);
    const iconEl = codicon(icon);
    const colorCommit = ref.colorCommit || ref.commit; // a tag: its branch's tip
    iconEl.style.color = commitColor(colorCommit, colorCommit === api.headOf(ref.root)); // the graph pill's color
    div.append(iconEl, el('span', 'name', name.substring(name.lastIndexOf('/') + 1)));
    if (ref.unmerged) div.append(unmergedIcon());
    const track = trackOf(ref);
    if (ref.gone) div.append(el('span', 'description', track));
    else if (track) {
      const counts = el('span', 'description track');
      if (ref.unpublished) counts.append(codicon('arrow-up')); // no count: nothing to compare with
      if (ref.ahead) counts.append(codicon('arrow-up'), String(ref.ahead));
      if (ref.behind) counts.append(codicon('arrow-down'), String(ref.behind));
      div.append(counts);
    }
    if (ref.type === RefType.Head) {
      // Hover button, as the native tree's inline actions: the same command as the context menu's Push.
      if (!div.querySelector('.description')) div.append(el('span', 'spacer'));
      div.append(
        runButton(api, 'cloud-download', 'Fetch', 'gitWeave.branches.fetch', refContext(ref)),
        runButton(api, 'repo-pull', 'Pull', 'gitWeave.branches.pull', refContext(ref)),
        runButton(api, 'repo-push', 'Push', 'gitWeave.branches.push', refContext(ref))
      );
    }
    div.title = [ref.name, ref.unmerged ? 'not merged into the default branch' : '', ref.upstream ? `→ ${ref.upstream.remote}/${ref.upstream.name}` : '', track, ref.commit.substring(0, 7)].filter(Boolean).join('  ');
    menuContext(div, refContext(ref));
    div.addEventListener('click', (e) => api.toggle(e, key, () => api.reveal(ref.commit, ref.root, ref.type === RefType.Head ? ref.name : undefined)));
    if (ref.type !== RefType.Tag) div.addEventListener('dblclick', () => api.post({ type: 'checkout', ref }));
    return div;
  }

  // "↑1 ↓2" against the upstream, as the status bar shows it (the row draws it with arrow icons; this is the tooltip)
  function trackOf(ref) {
    if (ref.gone) return 'upstream gone';
    if (ref.unpublished) return 'never pushed';
    return [ref.ahead ? `↑${ref.ahead}` : '', ref.behind ? `↓${ref.behind}` : ''].filter(Boolean).join(' ');
  }

  // Flags a branch not merged into the default branch (refs.js loadUnmerged); also used by the worktree rows.
  // No "not merged" codicon exists: the pull request one reads as "waiting to be merged".
  function unmergedIcon() {
    const icon = codicon('git-pull-request');
    icon.classList.add('unmerged-mark');
    icon.title = 'Not merged into the default branch';
    return icon;
  }

  window.refs = { row, refContext, fetchButton, unmergedIcon };
})();
