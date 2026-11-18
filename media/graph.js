// Graph webview: renders the rows computed by graphData.js with the native SCM graph's look (sizes,
// theme colors, codicons), only the rows in view, and asks for the next page near the bottom.
// The selected commits' (or a stash's, clicked in the sidebar view) files in the right pane (changes.js).
(function () {
  const vscode = acquireVsCodeApi();
  const { el, svgEl, codicon, menuContext, repoColor } = window.dom;
  const { changes, refs } = window;
  // Native SCM graph metrics (scmHistory.ts)
  const ROW_H = 22;
  const LANE_W = 11;
  // GitKraken-like round turns: a quarter circle over the whole half row (native uses 5px elbows).
  const CURVE_R = ROW_H / 2;
  const NODE_R = 4;
  const OVERSCAN = 15;
  const SIDE_WIDTH = 360; // right pane, until the user drags its splitter

  // Repository: only when several are shown (WebStorm's root column), a color per repository.
  const COLUMNS = [
    { id: 'repo', title: 'Repository', width: 110, multi: true },
    { id: 'refs', title: 'Branch / Tag', width: 200 },
    { id: 'graph', title: 'Graph', width: 0 }, // 0: fitted to the lanes until the user resizes it
    { id: 'msg', title: 'Message', flex: true },
    { id: 'author', title: 'Author', width: 140 },
    { id: 'date', title: 'Date', width: 130 },
    { id: 'sha', title: 'Commit', width: 70 },
  ];

  // selection: selected row ids (graphData.js rowId: a repository's root and a hash); anchor: the id
  // Shift extends from (also where arrow keys move from).
  const state = Object.assign({ widths: {}, selection: [], anchor: undefined, sideWidth: SIDE_WIDTH }, vscode.getState());
  let refsByName = new Map(); // "root\ntype:name" -> ref, for the pills' menus
  let repos = []; // [{ root, name }] shown
  const visibleColumns = () => COLUMNS.filter((c) => !c.multi || repos.length > 1);
  const repoIndex = (root) => repos.findIndex((r) => r.root === root);
  let rows = [];
  let shownKey; // hashes whose files the right pane shows or loads
  let shownRows = []; // and their rows: the selected commits, or a stash
  let shownStash; // hash of the stash shown, when it is one
  let hasMore = false;
  let loadingMore = false;

  const header = document.getElementById('header');
  const scroller = document.getElementById('scroller');
  const canvas = document.getElementById('canvas');
  const empty = document.getElementById('empty');

  // graphLayout.js colors: 'ref' (HEAD's chain) or 0..4 -> scmGraph.foreground1..5
  const color = (c) => (c === 'ref' ? 'var(--vscode-scmGraph-historyItemRefColor)' : `var(--vscode-scmGraph-foreground${c + 1})`);
  const laneX = (lane) => lane * LANE_W + LANE_W;
  const saveState = () => vscode.setState(state);

  function widthOf(col) {
    if (state.widths[col.id]) return state.widths[col.id];
    if (col.id === 'graph') {
      const lanes = rows.reduce((max, r) => Math.max(max, r.graph.width), 1);
      return Math.min(Math.max((lanes + 1) * LANE_W, 50), 400);
    }
    return col.width;
  }

  function applyColumns() {
    const template = visibleColumns().map((c) => (c.flex ? 'minmax(100px, 1fr)' : `${widthOf(c)}px`)).join(' ');
    document.body.style.setProperty('--columns', template);
  }

  function renderHeader() {
    header.replaceChildren(
      ...visibleColumns().map((col) => {
        const cell = el('div', `cell ${col.id}`, col.title);
        if (!col.flex) cell.append(resizer(col, cell));
        return cell;
      })
    );
  }

  // Drag on a handle: onMove(dx from the press), the state saved on release; double-click: onReset.
  function draggable(handle, onStart, onMove, onReset) {
    handle.addEventListener('mousedown', (down) => {
      down.preventDefault();
      onStart();
      const move = (e) => onMove(e.clientX - down.clientX);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        saveState();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    handle.addEventListener('dblclick', () => {
      onReset();
      saveState();
    });
  }

  function resizer(col, cell) {
    const handle = el('div', 'resizer');
    let startW;
    draggable(
      handle,
      () => (startW = cell.getBoundingClientRect().width),
      (dx) => {
        state.widths[col.id] = Math.max(30, startW + dx);
        applyColumns();
      },
      () => {
        delete state.widths[col.id];
        applyColumns();
      }
    );
    return handle;
  }

  function applySide() {
    document.body.style.setProperty('--side-width', `${state.sideWidth}px`);
  }

  function splitter() {
    let startW;
    draggable(
      document.getElementById('splitter'),
      () => (startW = state.sideWidth),
      (dx) => {
        state.sideWidth = Math.min(Math.max(140, startW - dx), window.innerWidth - 300);
        applySide();
      },
      () => {
        state.sideWidth = SIDE_WIDTH;
        applySide();
      }
    );
  }

  function render() {
    canvas.style.height = `${rows.length * ROW_H}px`;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW_H) + OVERSCAN);
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) fragment.append(renderRow(rows[i], i));
    canvas.replaceChildren(fragment);
    maybeLoadMore(last);
  }

  function renderRow(row, index) {
    const div = el('div', 'row');
    div.style.top = `${index * ROW_H}px`;
    if (state.selection.includes(row.id)) div.classList.add('selected');
    if (row.head) div.classList.add('head');
    if (row.wip) div.classList.add('wip');
    if (!row.wip) menuContext(div, { webviewSection: 'commit', sha: row.hash });
    div.addEventListener('click', (e) => onClick(e, index));

    div.append(...visibleColumns().map((col) => CELLS[col.id](row)));
    return div;
  }

  const textCell = (cls, text, title) => {
    const cell = el('div', `cell ${cls}`, text);
    if (title) cell.title = title;
    return cell;
  };
  const CELLS = {
    repo: renderRepo,
    refs: renderRefs,
    graph: renderGraph,
    msg: (row) => textCell('msg', row.subject, row.subject),
    author: (row) => textCell('author', row.author || '', row.email ? `${row.author} <${row.email}>` : ''),
    date: (row) => textCell('date', row.time ? new Date(row.time * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''),
    sha: (row) => textCell('sha', row.wip ? '' : row.hash.substring(0, 7), row.wip ? '' : row.hash),
  };

  function renderRepo(row) {
    const index = repoIndex(row.root);
    const cell = el('div', 'cell repo');
    const stripe = el('span', 'repo-stripe');
    stripe.style.background = index === -1 ? '' : repoColor(repos[index].color);
    cell.append(stripe, el('span', 'name', index === -1 ? '' : repos[index].name));
    cell.title = row.root;
    return cell;
  }

  // Pills: the type's icon (branch / tag), the name (bold when current), then for a branch where it lives:
  // local and/or remote (one pill merges a local branch and its remote copies).
  function renderRefs(row) {
    const cell = el('div', 'cell refs');
    for (const pill of row.refs) {
      const kind = pill.kind === 'tag' ? 'tag' : pill.local ? 'local' : 'remote';
      const p = el('span', `label ${kind}${pill.current ? ' current' : ''}`);
      p.style.background = color(row.graph.color); // the commit's lane: a pill reads as its branch
      p.append(codicon(pill.kind === 'tag' ? 'tag' : 'git-branch'), el('span', 'name', pill.name));
      if (pill.kind === 'branch') {
        if (pill.local) p.append(codicon('device-desktop'));
        if (pill.remotes.length) p.append(codicon('cloud'));
      }
      p.title = describe(pill);
      const ref = refOfPill(pill, row.root);
      if (ref) {
        menuContext(p, { ...refs.refContext(ref), sha: row.hash });
        if (pill.kind === 'branch') {
          p.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'checkout', ref });
          });
        }
      }
      cell.append(p);
    }
    cell.title = row.refs.map(describe).join('\n');
    return cell;
  }

  // A pill merges a local branch and its remote copies: its menu acts on the local one, else the first remote.
  function refOfPill(pill, root) {
    const get = (key) => refsByName.get(`${root}\n${key}`);
    if (pill.kind === 'tag') return get(`2:${pill.name}`);
    return pill.local ? get(`0:${pill.name}`) : get(`1:${pill.remotes[0]}/${pill.name}`);
  }

  function describe(pill) {
    if (pill.kind === 'tag') return `Tag ${pill.name}`;
    const where = [pill.local ? pill.name : '', ...pill.remotes.map((r) => `${r}/${pill.name}`)].filter(Boolean);
    return `${where.join(', ')}${pill.current ? ' (current)' : ''}`;
  }

  function renderGraph(row) {
    const cell = el('div', 'cell graph');
    const { col, up, down } = row.graph;
    const svg = svgEl('svg', { width: (row.graph.width + 1) * LANE_W, height: ROW_H });
    const mid = ROW_H / 2;
    for (const p of up) svg.append(line(p, 'up'));
    for (const p of down) svg.append(line(p, 'down'));
    svg.append(...node(row, laneX(col), mid, color(row.graph.color)));
    cell.append(svg);
    return cell;
  }

  // Native graph shapes: HEAD a ring around a dot, a merge a ring, another commit a dot, WIP a dashed ring.
  // An unpushed commit (on no remote branch) is dashed too: its dot becomes a dashed ring.
  function node(row, cx, cy, stroke) {
    if (row.wip) return [svgEl('circle', { cx, cy, r: NODE_R + 1, class: 'node wip', style: { stroke } })];
    const dashed = row.unpushed ? ' dashed' : '';
    if (row.head) {
      return [
        svgEl('circle', { cx, cy, r: NODE_R + 2, class: `node ring${dashed}`, style: { stroke } }),
        svgEl('circle', { cx, cy, r: NODE_R - 1.5, class: 'node', style: { fill: stroke } }),
      ];
    }
    if (row.parents.length > 1 || row.unpushed) return [svgEl('circle', { cx, cy, r: NODE_R, class: `node ring${dashed}`, style: { stroke } })];
    return [svgEl('circle', { cx, cy, r: NODE_R, class: 'node', style: { fill: stroke } })];
  }

  // Lines run vertically; a lane joining or leaving a node turns at the node's height ('up' halves
  // end at the node row's middle, 'down' halves start there): branches leave to the right, merge from it.
  function line({ x1, x2, color: c, dashed }, half) {
    const a = laneX(x1);
    const b = laneX(x2);
    const mid = ROW_H / 2;
    let d;
    if (a === b) d = half === 'up' ? `M${a} 0V${mid}` : `M${a} ${mid}V${ROW_H}`;
    else if (half === 'up') {
      const dir = Math.sign(b - a); // into the node at b
      d = `M${a} 0V${mid - CURVE_R}A${CURVE_R} ${CURVE_R} 0 0 ${dir > 0 ? 0 : 1} ${a + dir * CURVE_R} ${mid}H${b}`;
    } else {
      const dir = Math.sign(b - a); // out of the node at a
      d = `M${a} ${mid}H${b - dir * CURVE_R}A${CURVE_R} ${CURVE_R} 0 0 ${dir > 0 ? 1 : 0} ${b} ${mid + CURVE_R}V${ROW_H}`;
    }
    return svgEl('path', { d, style: { stroke: color(c) }, ...(dashed && { class: 'dashed' }) });
  }

  // Click: select one; Ctrl/Cmd+click: toggle; Shift+click: range from the anchor (WebStorm / VS Code lists).
  function onClick(e, index) {
    const hash = rows[index].id;
    state.cursor = e.shiftKey ? index : undefined;
    if (e.shiftKey) return selectRange(index);
    if (e.ctrlKey || e.metaKey) {
      const selection = state.selection.includes(hash) ? state.selection.filter((h) => h !== hash) : [...state.selection, hash];
      return setSelection(selection, hash);
    }
    setSelection([hash], hash);
  }

  function selectRange(index) {
    const from = indexOf(state.anchor);
    if (from === -1) return setSelection([rows[index].id], rows[index].id);
    const [a, b] = from < index ? [from, index] : [index, from];
    setSelection(rows.slice(a, b + 1).map((r) => r.id), state.anchor);
  }

  function setSelection(selection, anchor) {
    state.selection = selection;
    state.anchor = anchor;
    saveState();
    render();
    requestChanges();
  }

  // A ref's commit, from the sidebar view: selected and scrolled to the middle (the extension loaded
  // the pages up to it first).
  function reveal(id) {
    const index = indexOf(id);
    if (index === -1) return;
    scroller.scrollTop = Math.max(0, index * ROW_H - scroller.clientHeight / 2);
    state.cursor = undefined;
    setSelection([id], id);
  }

  const indexOf = (id) => (id === undefined ? -1 : rows.findIndex((r) => r.id === id));
  // Selected rows in display order (newest first)
  const selectedRows = () => rows.filter((r) => state.selection.includes(r.id));

  function requestChanges() {
    shownStash = undefined;
    showChanges(selectedRows());
  }

  // rows: commits in display order, or a stash as a row; the extension answers with a 'commit' message.
  function showChanges(selected) {
    shownRows = selected;
    shownKey = selected.map((r) => r.id).join(',');
    if (!selected.length) return changes.clear();
    changes.loading(selected);
    vscode.postMessage({ type: 'select', commits: selected.map(({ id, root, hash, parents, wip }) => ({ id, root, hash, parents, wip })) });
  }

  // A stash's files, against the commit it was made on (its first parent; the others hold its index
  // and untracked files). Clears the graph's selection: the pane shows one thing.
  function showStash(stash) {
    state.selection = [];
    saveState();
    render();
    showChanges([{ ...stash, parents: [stash.parents[0]] }]);
    shownStash = stash.id;
  }

  // After a reload: drop selected commits that are gone (a committed WIP) and refresh the pane if that changed it.
  function syncSelection(stashes) {
    if (shownStash) {
      if (!stashes.includes(shownStash)) requestChanges(); // popped or dropped
      return;
    }
    const selection = state.selection.filter((h) => indexOf(h) !== -1);
    if (selection.length !== state.selection.length) {
      state.selection = selection;
      saveState();
      render();
    }
    if (selectedRows().map((r) => r.id).join(',') !== shownKey) requestChanges();
  }

  // Up / Down (Page Up / Down) move the selection from the anchor, Shift extends it.
  function onKey(e) {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 20, PageUp: -20 }[e.key];
    if (!step || !rows.length) return;
    e.preventDefault();
    const cursor = e.shiftKey ? (state.cursor === undefined ? indexOf(state.anchor) : state.cursor) : indexOf(state.anchor);
    const index = Math.min(Math.max(cursor + step, 0), rows.length - 1);
    const top = index * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
    if (e.shiftKey) {
      state.cursor = index;
      selectRange(index);
    } else {
      state.cursor = undefined;
      setSelection([rows[index].id], rows[index].id);
    }
  }

  function maybeLoadMore(lastRendered) {
    if (hasMore && !loadingMore && lastRendered >= rows.length - OVERSCAN) {
      loadingMore = true;
      vscode.postMessage({ type: 'loadMore' });
    }
  }

  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'graph') {
      rows = msg.rows;
      hasMore = msg.hasMore;
      loadingMore = false;
      empty.hidden = true;
      scroller.hidden = false;
      repos = msg.repos;
      refsByName = new Map(msg.refs.flatMap((repoRefs) => ['local', 'remote', 'tags'].flatMap((k) => repoRefs[k].map((r) => [`${r.root}\n${r.type}:${r.name}`, r]))));
      renderHeader();
      applyColumns();
      render();
      syncSelection(msg.stashes);
    } else if (msg.type === 'reveal') {
      reveal(msg.id);
    } else if (msg.type === 'showStash') {
      showStash(msg.stash);
    } else if (msg.type === 'commit') {
      if (msg.key === shownKey) changes.show(shownRows, msg);
    } else if (msg.type === 'empty') {
      rows = [];
      loadingMore = false;
      shownKey = undefined;
      shownStash = undefined;
      changes.clear();
      empty.textContent = msg.message;
      empty.hidden = false;
      scroller.hidden = true;
    }
  });

  let frame;
  scroller.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  scroller.addEventListener('keydown', onKey);
  new ResizeObserver(() => render()).observe(scroller);

  changes.init((msg) => vscode.postMessage(msg), {
    asTree: state.filesAsTree !== false,
    set(asTree) {
      this.asTree = asTree;
      state.filesAsTree = asTree;
      saveState();
    },
  });
  splitter();
  renderHeader();
  applyColumns();
  applySide();
  vscode.postMessage({ type: 'ready' });
})();
