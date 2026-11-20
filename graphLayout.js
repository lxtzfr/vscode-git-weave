// Lane layout of a commit graph: each commit gets a column (lane), each row the line pieces to draw
// in its upper half (coming from the row above) and lower half (going below).
// Lanes never shift sideways once given, so a branch stays on one column down its whole history;
// a node takes the leftmost lane waiting for it, the others merge into it from the right. Each repository's
// trunk (its default branch's first-parent chain) owns a lane from the top, left of every other: a branch
// newer than the trunk's tip still leaves it to the right instead of taking its column.
// Colors follow branches, not columns (as the native SCM graph): a new lane takes the next color,
// a first parent keeps its child's; HEAD's first-parent chain gets REF_COLOR.

const { colorIndexOf, COLOR_COUNT } = require('./media/branchColor');

const REF_COLOR = 'ref';

// commits: display order (children before parents), { hash, parents: [hash], wip, worktree, head, unpushed, trunk }
// (head: a repository's HEAD; unpushed: on no remote branch; its lines to its parents are dashed, as the WIP row's;
// worktree: the WIP row of another worktree, in its branch's color; colorKey: the commit's own hash when it carries
// a branch (its color follows it, as the sidebar's icons of those refs); trunk: its repository's key when on its trunk;
// several repositories can share one graph).
// Returns one row per commit: { col, color, width, up: [piece], down: [piece] },
// piece = { x1, x2, color, dashed } in lane units: x1 at the half's top, x2 at its bottom.
function layoutGraph(commits) {
  const trunks = [...new Set(commits.map((c) => c.trunk).filter(Boolean))];
  // lane index -> { hash it waits for, color }, null = free; a trunk's lane is never free (no hash: nothing drawn).
  const lanes = trunks.map(() => ({}));
  const rows = [];
  let pending = []; // { from, lane, hash, color }: lines leaving the previous row
  let nextColor = 0;
  const newColor = () => nextColor++ % COLOR_COUNT;

  // First free lane right of `after` (GitKraken: a branch always leaves its node to the right, so
  // it always merges back leftwards); -1 for a branch tip, which nothing connects to from above.
  const freeLane = (after) => {
    const i = lanes.findIndex((l, idx) => l === null && idx > after);
    return i === -1 ? Math.max(lanes.length, after + 1) : i;
  };
  const laneOf = (hash) => lanes.findIndex((l) => l && l.hash === hash);

  for (let r = 0; r < commits.length; r++) {
    const { hash, parents, wip, worktree, head, trunk, colorKey } = commits[r];
    const dashed = commits[r].unpushed || wip; // uncommitted changes are not pushed either
    let col = trunk ? trunks.indexOf(trunk) : laneOf(hash);
    let color;
    if (trunk) {
      color = lanes[col].hash === hash ? lanes[col].color : newColor(); // its tip: nothing above in its lane
    } else if (col === -1) {
      col = freeLane(-1); // branch tip: nothing above leads to it
      color = newColor();
    } else {
      color = lanes[col].color;
    }
    if (colorKey) color = colorIndexOf(colorKey); // a commit with refs has its own color from here down, as its pills and sidebar icons
    if (head || (wip && !worktree)) color = REF_COLOR;
    const row = { col, color, up: [], down: [] };

    // Close the previous row's lines now that this node's column is known. A line runs in its lane:
    // it bends below the node it leaves when it starts off that node's column (a merge's second
    // parent, always rightwards), and above the node it joins when it ends on another column (a
    // branch leaving its parent, always from the right).
    if (r > 0) {
      const prev = rows[r - 1];
      for (const p of pending) {
        const to = p.hash === hash ? col : p.lane;
        prev.down.push({ x1: p.from, x2: p.lane, color: p.color, dashed: p.dashed });
        row.up.push({ x1: p.lane, x2: to, color: p.color, dashed: p.dashed });
      }
    }

    for (let i = 0; i < lanes.length; i++) if (lanes[i] && lanes[i].hash === hash) lanes[i] = null;

    // First parent keeps the node's lane, even when another lane already waits for it: both
    // lanes then join at the parent, which draws the fork point.
    lanes[col] = parents.length ? { hash: parents[0], color, dashed } : trunk ? {} : null;
    const fromNode = new Set([col]);
    const extra = []; // other parents already awaited by a lane: line from the node into that lane
    for (const parent of parents.slice(1)) {
      const existing = laneOf(parent);
      if (existing !== -1) {
        extra.push({ from: col, lane: existing, hash: parent, color: lanes[existing].color, dashed });
      } else {
        const j = freeLane(col);
        lanes[j] = { hash: parent, color: newColor(), dashed };
        fromNode.add(j);
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    pending = [];
    lanes.forEach((l, i) => l && l.hash && pending.push({ from: fromNode.has(i) ? col : i, lane: i, hash: l.hash, color: l.color, dashed: l.dashed }));
    pending.push(...extra);
    rows.push(row);
  }

  // Parents not loaded (beyond the page): lines run off the last row.
  const last = rows[rows.length - 1];
  if (last) for (const p of pending) last.down.push({ x1: p.from, x2: p.lane, color: p.color, dashed: p.dashed });

  for (const row of rows) {
    const xs = [row.col, ...row.up.flatMap((p) => [p.x1, p.x2]), ...row.down.flatMap((p) => [p.x1, p.x2])];
    row.width = Math.max(...xs) + 1;
  }
  return rows;
}

module.exports = { layoutGraph };
