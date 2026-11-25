// Right pane of the graph webview (WebStorm's Git log): the selected commits' files as a folder tree,
// then their foldable details. A click on a file opens its diff.
(function () {
  const { el, codicon, repoColor, actionButton } = window.dom;
  const { tree, files: fileRows } = window;

  const filesEl = document.getElementById('files');
  const detailsEl = document.getElementById('details');
  const collapsed = new Set(); // folder paths the user closed, kept across commits
  let current; // { rows, files }
  let selectedPath;
  let post;
  let prefs; // { state, save() }: the graph's saved state (filesAsTree, detailsCollapsed)
  let shownDetails = []; // renderDetails' arguments, to redraw on fold / unfold
  const DETAILS = 'Commit details';

  function init(postMessage, savedState) {
    post = postMessage;
    prefs = savedState;
    clear();
  }

  function clear() {
    current = undefined;
    filesEl.replaceChildren(el('div', 'placeholder', 'Select a commit to see its changes.'));
    detailsEl.replaceChildren();
  }

  // rows: the selected commits, newest first.
  function loading(rows) {
    current = { rows, files: undefined };
    filesEl.replaceChildren(el('div', 'placeholder', 'Loading…'));
    renderDetails(rows, '');
  }

  // data: { files, body, error } from the extension for these rows.
  function show(rows, data, repos) {
    if (!rows.length) return clear();
    current = { rows, files: data.files, repos };
    if (data.error) filesEl.replaceChildren(el('div', 'placeholder error', data.error));
    else renderFiles();
    renderDetails(rows, data.body);
  }

  function renderFiles() {
    const { files, rows, repos } = current;
    const commits = rows.length > 1 ? ` in ${rows.length} commits` : '';
    const title = el('div', 'pane-title');
    const asTree = prefs.state.filesAsTree !== false;
    const toggle = fileRows.layoutButton(asTree, () => {
      prefs.state.filesAsTree = !asTree;
      prefs.save();
      renderFiles();
    });
    title.append(el('span', 'name', `${files.length} file${files.length === 1 ? '' : 's'} changed${commits}`), toggle);
    const list = el('div', 'tree');
    const layoutOf = { collapsed, onToggle: renderFiles, rowOf: fileRow };
    if (asTree) {
      // One tree per repository, under its own row (a lone top folder is not merged into the repository's).
      for (const repo of repos.filter((r) => files.some((f) => f.repoName === r.name))) {
        const folder = tree.folderRow({ label: repo.name, path: repo.name, depth: 0 }, collapsed, renderFiles, ['repo', 'repo']);
        folder.querySelector('.codicon-repo').style.color = repoColor(repo.color);
        list.append(folder);
        if (collapsed.has(repo.name)) continue;
        list.append(...fileRows.rows(files.filter((f) => f.repoName === repo.name), { ...layoutOf, asTree: true, key: repo.name, depth: 1 }));
      }
    } else {
      list.append(...fileRows.rows(files, { ...layoutOf, asTree: false, sortKey: (file) => `${file.repoName}/${file.path}` }));
    }
    filesEl.replaceChildren(title, list);
  }

  // folder: the list layout shows each file's folder as its description. Uncommitted files (a WIP row's, this
  // window's or another worktree's) can go back to HEAD.
  function fileRow(file, depth, folder) {
    const ctx = { file, root: file.root };
    const command = (name) => () => post({ type: 'command', command: name, ctx });
    const discardToHead = !!(file.worktree || file.wip);
    const actions = [];
    if (file.right) actions.push(actionButton('go-to-file', 'Open File', command('gitWeave.graph.openFile')));
    if (discardToHead) actions.push(actionButton('discard', 'Discard Changes', command('gitWeave.worktrees.discardFile')));
    return fileRows.row(file, {
      depth,
      folder,
      selected: `${file.root}\n${file.path}` === selectedPath,
      context: { discardToHead },
      actions,
      onClick: () => {
        selectedPath = `${file.root}\n${file.path}`;
        renderFiles();
        post({ type: 'openDiff', file });
      },
    });
  }

  // A header folding the details away, leaving the room to the files; the choice is kept across commits.
  function renderDetails(rows, body) {
    shownDetails = [rows, body];
    const closed = new Set(prefs.state.detailsCollapsed ? [DETAILS] : []);
    const onToggle = () => {
      prefs.state.detailsCollapsed = closed.has(DETAILS);
      prefs.save();
      renderDetails(...shownDetails);
    };
    const header = tree.folderRow({ label: DETAILS, path: DETAILS, depth: 0 }, closed, onToggle, []);
    header.classList.add('section');
    if (closed.has(DETAILS)) return detailsEl.replaceChildren(header);
    const content = el('div', 'details-body');
    content.append(...detailsOf(rows, body));
    detailsEl.replaceChildren(header, content);
  }

  function detailsOf(rows, body) {
    if (rows.length > 1) return listOf(rows);
    const [row] = rows;
    if (row.wip) return [el('div', 'message', wipLabel(row))];
    const date = new Date(row.time * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const meta = el('div', 'meta');
    meta.append(
      line('person', `${row.author} <${row.email}>`),
      line('calendar', date),
      line('git-commit', row.hash),
      ...(row.parents.length ? [line(row.parents.length > 1 ? 'git-merge' : 'arrow-down', row.parents.map((p) => p.substring(0, 7)).join(', '))] : [])
    );
    return [el('div', 'message', body || row.subject), meta];
  }

  // Several commits: one line each, as in WebStorm.
  function listOf(rows) {
    const list = el('div', 'meta');
    for (const row of rows) {
      const div = line(row.wip ? 'circle-outline' : 'git-commit', row.wip ? wipLabel(row) : `${row.hash.substring(0, 7)}  ${row.subject}`);
      div.title = row.wip ? '' : `${row.hash}
${row.author} <${row.email}>
${row.subject}`;
      list.append(div);
    }
    return [el('div', 'message', `${rows.length} commits selected`), list];
  }

  const wipLabel = (row) => (row.worktree ? `Uncommitted changes in ${row.worktreeName} (read-only)` : 'Uncommitted changes');

  function line(icon, text) {
    const div = el('div', 'meta-line');
    div.append(codicon(icon), el('span', 'meta-text', text));
    return div;
  }

  window.changes = { init, clear, loading, show };
})();
