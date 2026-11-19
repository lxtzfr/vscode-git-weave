// Uncommitted changes of the sidebar view (sidebar.js), as the Source Control view groups them, from
// workingChanges.js's loadChanges: Merge / Staged / Changes, one row per file (a list or a folder tree, toggled
// by the section's button), the commit box under the Changes files.
// Click: its diff; hover buttons and right-click: stage, unstage, discard (package.json webview/context).
(function () {
  const { actionButton } = window.dom;
  const { files } = window;
  const commitBox = document.getElementById('commit'); // moved into the Changes section by each render (sidebar.js)
  const message = document.getElementById('message');
  const commitButton = document.getElementById('commit-button');
  const MESSAGE_DELAY_MS = 300;

  // [codicon, title, command suffix]
  const GROUPS = [
    { id: 'merge', label: 'Merge Changes', actions: [['add', 'Stage All Merge Changes', 'stageAll']] },
    { id: 'staged', label: 'Staged Changes', actions: [['remove', 'Unstage All Changes', 'unstageAll']] },
    { id: 'unstaged', label: 'Changes', actions: [['discard', 'Discard All Changes', 'discardAll'], ['add', 'Stage All Changes', 'stageAll']], keepEmpty: true },
  ];
  const FILE_ACTIONS = {
    merge: [['add', 'Stage Changes', 'changes.stage']],
    staged: [['go-to-file', 'Open File', 'graph.openFile'], ['remove', 'Unstage Changes', 'changes.unstage']],
    unstaged: [['go-to-file', 'Open File', 'graph.openFile'], ['discard', 'Discard Changes', 'changes.discard'], ['add', 'Stage Changes', 'changes.stage']],
  };

  let api;
  let order = []; // the files in render order (Shift+click ranges)
  let anchor; // the last clicked file
  const picked = new Map(); // key -> file, the multi-selection

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
    commitButton.addEventListener('click', commit);
  }

  function commit() {
    if (commitButton.disabled) return;
    commitButton.disabled = true;
    api.post({ type: 'commit', text: message.value });
  }

  function committed(ok) {
    commitButton.disabled = false;
    if (!ok) return;
    message.value = '';
    autosize();
  }

  function autosize() {
    message.style.height = 'auto';
    message.style.height = `${message.scrollHeight + 2}px`;
  }

  // commit: { message: the draft, branch: the only checked repository's }
  function update(commit) {
    message.placeholder = `Message (Ctrl+Enter to commit${commit.branch ? ` on '${commit.branch}'` : ''})`;
    if (document.activeElement !== message && message.value !== commit.message) {
      message.value = commit.message;
      autosize();
    }
  }

  // Appends the sections' rows to out, through the sidebar's bySection (a sub-folder per repository when
  // several are checked). A section's actions act on every checked repository, a sub-folder's on its own.
  function sections(out, bySection) {
    order = [];
    for (const group of GROUPS) {
      const menu = { webviewSection: 'changes', changeGroup: group.id };
      const actions = group.actions.map(([icon, title, cmd]) => actionButton(icon, title, () => api.command(`gitWeave.changes.${cmd}`, menu)));
      actions.unshift(api.layoutButton());
      const fill = (o, g, key, depth) => fillFiles(o, g.changes[group.id], key, depth);
      // The commit box closes the Changes section, under its files (it commits what the Staged section holds).
      const footer = group.id === 'unstaged' ? commitBox : undefined;
      bySection(out, `§${group.id}`, group.label, (g) => g.changes[group.id], fill, { actions, menu, keepEmpty: group.keepEmpty, footer });
    }
    // Files that left the lists (committed, discarded) leave the selection.
    const keys = new Set(order.map(keyOf));
    for (const k of picked.keys()) if (!keys.has(k)) picked.delete(k);
  }

  // key: each group and repository collapses its own folders.
  function fillFiles(out, list, key, depth) {
    out.push(...files.rows(list, { asTree: api.filesAsTree(), collapsed: api.collapsed, key, depth, onToggle: api.changed, rowOf: fileRow }));
  }

  const keyOf = (file) => `change:${file.root}:${file.group}:${file.path}`;

  // Ctrl/Cmd+click toggles a file, Shift+click extends to the last clicked one; a selection stays within one
  // repository and group (what one stage / unstage / discard command acts on).
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

  function fileRow(file, depth, folder) {
    const key = keyOf(file);
    order.push(file);
    const multi = picked.size > 1 && picked.has(key);
    const context = { changeGroup: file.group };
    if (multi) context.files = [...picked.values()];
    const ctx = { file, root: file.root, ...context };
    const actions = FILE_ACTIONS[file.group]
      .filter(([, , cmd]) => cmd !== 'graph.openFile' || file.right)
      .map(([icon, title, cmd]) => actionButton(icon, title, () => api.command(`gitWeave.${cmd}`, ctx)));
    return files.row(file, {
      depth,
      folder,
      selected: api.isSelected(key) || picked.has(key),
      context,
      actions,
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
