// Right pane of the graph webview (WebStorm's Git log): the selected commits' files as a folder tree,
// then their details. A click on a file opens its diff.
(function () {
  const { el, codicon } = window.dom;
  const { tree, files: fileRows } = window;

  const filesEl = document.getElementById('files');
  const detailsEl = document.getElementById('details');
  const collapsed = new Set(); // folder paths the user closed, kept across commits
  let current; // { rows, files }
  let selectedPath;
  let post;

  function init(postMessage) {
    post = postMessage;
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
  function show(rows, data) {
    if (!rows.length) return clear();
    current = { rows, files: data.files };
    if (data.error) filesEl.replaceChildren(el('div', 'placeholder error', data.error));
    else renderFiles();
    renderDetails(rows, data.body);
  }

  function renderFiles() {
    const { files, rows } = current;
    const commits = rows.length > 1 ? ` in ${rows.length} commits` : '';
    const title = el('div', 'pane-title', `${files.length} file${files.length === 1 ? '' : 's'} changed${commits}`);
    const list = el('div', 'tree');
    // Several repositories: their files under a folder named after each (WebStorm's grouping by root).
    const pathOf = (file) => (file.repoName ? `${file.repoName}/${file.path}` : file.path);
    for (const row of tree.flatten(tree.build(files, pathOf), collapsed, pathOf)) {
      list.append(row.folder ? tree.folderRow(row, collapsed, renderFiles) : fileRow(row));
    }
    filesEl.replaceChildren(title, list);
  }

  function fileRow({ item: file, depth }) {
    return fileRows.row(file, {
      depth,
      selected: `${file.root}\n${file.path}` === selectedPath,
      onClick: () => {
        selectedPath = `${file.root}\n${file.path}`;
        renderFiles();
        post({ type: 'openDiff', file });
      },
    });
  }

  function renderDetails(rows, body) {
    if (rows.length > 1) return renderList(rows);
    const [row] = rows;
    if (row.wip) return detailsEl.replaceChildren(el('div', 'message', 'Uncommitted changes'));
    const date = new Date(row.time * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const meta = el('div', 'meta');
    meta.append(
      line('person', `${row.author} <${row.email}>`),
      line('calendar', date),
      line('git-commit', row.hash),
      ...(row.parents.length ? [line(row.parents.length > 1 ? 'git-merge' : 'arrow-down', row.parents.map((p) => p.substring(0, 7)).join(', '))] : [])
    );
    detailsEl.replaceChildren(el('div', 'message', body || row.subject), meta);
  }

  // Several commits: one line each, as in WebStorm.
  function renderList(rows) {
    const list = el('div', 'meta');
    for (const row of rows) {
      const div = line(row.wip ? 'circle-outline' : 'git-commit', row.wip ? 'Uncommitted changes' : `${row.hash.substring(0, 7)}  ${row.subject}`);
      div.title = row.wip ? '' : `${row.hash}
${row.author} <${row.email}>
${row.subject}`;
      list.append(div);
    }
    detailsEl.replaceChildren(el('div', 'message', `${rows.length} commits selected`), list);
  }

  function line(icon, text) {
    const div = el('div', 'meta-line');
    div.append(codicon(icon), el('span', 'meta-text', text));
    return div;
  }

  window.changes = { init, clear, loading, show };
})();
