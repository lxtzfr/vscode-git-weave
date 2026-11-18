// Uncommitted changes of the sidebar view (sidebar.js), as the Source Control view groups them, from
// workingChanges.js's loadChanges: the commit box, then Merge / Staged / Changes, one row per file.
// Click: its diff; hover buttons and right-click: stage, unstage, discard (package.json webview/context).
(function () {
  const { actionButton } = window.dom;
  const { files } = window;
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
    for (const group of GROUPS) {
      const menu = { webviewSection: 'changes', changeGroup: group.id };
      const actions = group.actions.map(([icon, title, cmd]) => actionButton(icon, title, () => api.command(`gitWeave.changes.${cmd}`, menu)));
      const fill = (o, g, key, depth) => g.changes[group.id].forEach((file) => o.push(fileRow(file, depth)));
      bySection(out, `§${group.id}`, group.label, (g) => g.changes[group.id], fill, { actions, menu, keepEmpty: group.keepEmpty });
    }
  }

  function fileRow(file, depth) {
    const key = `change:${file.root}:${file.group}:${file.path}`;
    const context = { changeGroup: file.group };
    const ctx = { file, root: file.root, ...context };
    const actions = FILE_ACTIONS[file.group]
      .filter(([, , cmd]) => cmd !== 'graph.openFile' || file.right)
      .map(([icon, title, cmd]) => actionButton(icon, title, () => api.command(`gitWeave.${cmd}`, ctx)));
    return files.row(file, {
      depth,
      folder: true,
      selected: api.isSelected(key),
      context,
      actions,
      onClick: () => {
        api.select(key);
        api.post({ type: file.left ? 'openDiff' : 'openFile', file });
      },
    });
  }

  window.workingTree = { init, update, sections, committed };
})();
