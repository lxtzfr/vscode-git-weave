// Uncommitted changes of the sidebar view (sidebar.js), as WebStorm's commit window (no staging area): the
// conflicts, then Changes with a checkbox per file, folder, repository and section: the checked files are what
// Commit commits. One row per file (a list or a folder tree, toggled by the section's button), the other worktrees'
// changes after the repositories', and the commit box closing the section.
// Click: its diff; hover buttons and right-click: open, discard (package.json webview/context).
(function () {
  const { actionButton } = window.dom;
  const { files } = window;
  const commitBox = document.getElementById('commit'); // moved into the Changes section by each render (sidebar.js)
  const message = document.getElementById('message');
  const commitButton = document.getElementById('commit-button');
  const buttonLabel = document.createTextNode('Commit');
  const MESSAGE_DELAY_MS = 300;
  const CHANGES_KEY = '§unstaged';

  let api;
  let order = []; // the files in render order (Shift+click ranges)
  let anchor; // the last clicked file
  const picked = new Map(); // key -> file, the multi-selection (hover and menu actions, not the commit)
  let checkouts = []; // [{ root, path, files }]: every file list shown, a repository's or a worktree's
  let committing = false;

  // The checkout a file is in: its worktree, else its repository.
  const checkOf = (file) => `${file.worktree || file.root}\n${file.path}`;

  // api: the sidebar's row API; draft: the repository's input box, applied unless the user is typing.
  function init(sidebarApi) {
    api = sidebarApi;
    let timer;
    message.addEventListener('input', () => {
      autosize();
      clearTimeout(timer);
      timer = setTimeout(() => api.post({ type: 'message', text: message.value }), MESSAGE_DELAY_MS);
    });
    message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    });
    commitButton.lastChild.replaceWith(buttonLabel);
    commitButton.addEventListener('click', commit);
  }

  const checkedTargets = () =>
    checkouts
      .map(({ root, path, files: list }) => ({ root, path, paths: list.filter((f) => api.checked.has(checkOf(f))).map((f) => f.path) }))
      .filter((target) => target.paths.length);

  function commit() {
    if (committing) return;
    committing = true;
    commitButton.disabled = true;
    api.post({ type: 'commit', text: message.value, targets: checkedTargets() });
  }

  function committed(ok) {
    committing = false;
    commitButton.disabled = false;
    if (!ok) return;
    message.value = '';
    autosize();
  }

  function autosize() {
    message.style.height = 'auto';
    message.style.height = `${message.scrollHeight + 2}px`;
  }

  // commit: { message: the draft, branch: the only checked repository's }; groups: the repositories' data. A file
  // that left the lists (committed, discarded) is unchecked: it must not come back already checked.
  function update(commit, groups) {
    checkouts = groups.flatMap((g) => [
      { root: g.root, path: g.root, files: g.changes.files },
      ...g.changedWorktrees.map((wt) => ({ root: g.root, path: wt.path, files: wt.changes.map((c) => ({ ...c, root: g.root })) })),
    ]);
    const present = new Set(checkouts.flatMap((c) => c.files.map(checkOf)));
    for (const k of api.checked) if (!present.has(k)) api.checked.delete(k);
    message.placeholder = `Message (Ctrl+Enter to commit${commit.branch ? ` on '${commit.branch}'` : ''})`;
    if (document.activeElement !== message && message.value !== commit.message) {
      message.value = commit.message;
      autosize();
    }
  }

  const checkbox = (list) => files.checkbox(list.map(checkOf), api.checked, api.changed);
  // Before the row's icon, after its chevron.
  const addCheckbox = (row, list) => row.firstChild.after(checkbox(list));

  // Appends the sections' rows to out, through the sidebar's bySection (a sub-folder per repository when
  // several are checked). A section's actions act on every checked repository.
  function sections(out, bySection) {
    order = [];
    const action = (icon, title, cmd, menu) => actionButton(icon, title, () => api.command(`gitWeave.changes.${cmd}`, menu));

    const merge = { webviewSection: 'changes', changeGroup: 'merge' };
    bySection(out, '§merge', 'Merge Changes', (g) => g.changes.merge, (o, g, key, depth) => fillFiles(o, g.changes.merge, key, depth, mergeRow), {
      actions: [api.layoutButton(), action('add', 'Mark All as Resolved', 'stageAll', merge)],
      menu: merge,
    });

    const changes = { webviewSection: 'changes', changeGroup: 'unstaged' };
    bySection(out, CHANGES_KEY, 'Changes', (g) => g.changes.files, (o, g, key, depth) => fillFiles(o, g.changes.files, key, depth, fileRow, addCheckbox), {
      actions: [api.layoutButton(), action('discard', 'Discard All Changes', 'discardAll', changes)],
      menu: changes,
      keepEmpty: true,
      footer: commitBox,
      extra: otherWorktrees,
      decorate: (row, g) => addCheckbox(row, g.changes.files),
      decorateSection: (row) => addCheckbox(row, checkouts.flatMap((c) => c.files)),
    });
    const count = checkedTargets().reduce((n, target) => n + target.paths.length, 0);
    buttonLabel.textContent = count ? `Commit (${count})` : 'Commit';

    // Files that left the lists leave the selection.
    const keys = new Set(order.map(keyOf));
    for (const k of picked.keys()) if (!keys.has(k)) picked.delete(k);
  }

  const otherWorktrees = {
    count: (g) => g.changedWorktrees.reduce((n, wt) => n + wt.changes.length, 0),
    rows: (out, g, key) => window.worktrees.changeRows(out, g, key, api, addCheckbox, checkbox),
  };

  // key: each group and repository collapses its own folders.
  function fillFiles(out, list, key, depth, rowOf, decorateFolder) {
    out.push(...files.rows(list, { asTree: api.filesAsTree(), collapsed: api.collapsed, key, depth, onToggle: api.changed, rowOf, decorateFolder }));
  }

  const keyOf = (file) => `change:${file.root}:${file.group || ''}:${file.path}`;

  // Ctrl/Cmd+click toggles a file, Shift+click extends to the last clicked one; a selection stays within one
  // repository and group (what one command acts on).
  function pick(file, e) {
    const key = keyOf(file);
    const same = (f) => f.root === file.root && f.group === file.group;
    if (e.shiftKey && anchor && same(anchor)) {
      const from = order.findIndex((f) => keyOf(f) === keyOf(anchor));
      const to = order.findIndex((f) => keyOf(f) === key);
      picked.clear();
      order.slice(Math.min(from, to), Math.max(from, to) + 1).filter(same).forEach((f) => picked.set(keyOf(f), f));
      return;
    }
    for (const [k, f] of picked) if (!same(f)) picked.delete(k);
    if (!picked.size) order.filter((f) => same(f) && api.isSelected(keyOf(f))).forEach((f) => picked.set(keyOf(f), f));
    if (picked.has(key)) picked.delete(key);
    else picked.set(key, file);
    anchor = file;
  }

  // actionsOf(ctx) -> the hover buttons; context: extra keys for the menus.
  function changeRow(file, depth, folder, context, actionsOf) {
    const key = keyOf(file);
    order.push(file);
    const multi = picked.size > 1 && picked.has(key);
    const all = { ...context, ...(multi && { files: [...picked.values()] }) };
    return files.row(file, {
      depth,
      folder,
      selected: api.isSelected(key) || picked.has(key),
      context: all,
      actions: actionsOf({ file, root: file.root, ...all }),
      onClick: (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          pick(file, e);
          api.changed();
          return;
        }
        picked.clear();
        anchor = file;
        api.select(key);
        api.post({ type: file.left ? 'openDiff' : 'openFile', file });
      },
    });
  }

  const button = (icon, title, command, ctx) => actionButton(icon, title, () => api.command(command, ctx));
  const openButtons = (ctx) => (ctx.file.right ? [button('go-to-file', 'Open File', 'gitWeave.graph.openFile', ctx)] : []);

  const mergeRow = (file, depth, folder) =>
    changeRow(file, depth, folder, { changeGroup: 'merge' }, (ctx) => [button('add', 'Mark as Resolved', 'gitWeave.changes.stage', ctx)]);

  function fileRow(file, depth, folder) {
    const row = changeRow(file, depth, folder, { discardToHead: true }, (ctx) => [...openButtons(ctx), button('discard', 'Discard Changes', 'gitWeave.worktrees.discardFile', ctx)]);
    row.querySelector('.codicon').before(checkbox([file]));
    return row;
  }

  // Runs a render that re-attaches the commit box: that drops the caret and the textarea's height (a detached
  // textarea has none), so both are restored.
  function keepCaret(render) {
    const typing = document.activeElement === message;
    const { selectionStart, selectionEnd } = message;
    render();
    autosize();
    if (typing && message.isConnected) {
      message.focus();
      message.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  window.workingTree = { init, update, sections, committed, keepCaret };
})();
