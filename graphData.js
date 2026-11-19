const { runGit } = require('./gitRepos');
const { layoutGraph } = require('./graphLayout');
const { loadWorktrees } = require('./worktrees');

const FIELD = '\x1f';
const RECORD = '\x1e';
const WIP = '*';

// Branches, remotes, tags and HEAD, not --all: it would pull in refs/stash and its index commits. The other
// worktrees' HEADs too: a detached slot's commits are on no branch.
const LOG_REFS = ['--branches', '--remotes', '--tags', 'HEAD'];
const logRevs = (others) => [...LOG_REFS, ...others.map((wt) => wt.commit)];

// The repository's other worktrees with a commit (worktrees.js), their changes included.
async function otherWorktrees(repo) {
  return (await loadWorktrees(repo)).filter((wt) => !wt.current && wt.commit && wt.state !== 'missing');
}

async function loadCommits(repo, limit, others) {
  const format = `${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%D${FIELD}%s`;
  const out = await runGit(repo, ['log', ...logRevs(others), '--date-order', `-n${limit + 1}`, `--format=${format}`]);
  const commits = out
    .split(RECORD)
    .filter((r) => r.trim())
    .map((record) => {
      const [hash, parents, author, email, time, refs, subject] = record.replace(/\n+$/, '').split(FIELD);
      return { hash, parents: parents ? parents.split(' ') : [], author, email, time: Number(time), refs, subject };
    });
  const hasMore = commits.length > limit;
  return { commits: commits.slice(0, limit), hasMore };
}

// "HEAD -> main, origin/main, origin/HEAD, tag: v1" -> pills, a local branch and its remote copies merged
// into one pill (GitKraken style): { name, kind: 'branch'|'tag', local, remotes: [remote], current }.
function parseRefs(decoration, remoteNames) {
  const pills = new Map();
  const branch = (name) => {
    if (!pills.has(name)) pills.set(name, { name, kind: 'branch', local: false, remotes: [], current: false });
    return pills.get(name);
  };
  for (let ref of decoration.split(', ').filter(Boolean)) {
    if (ref.startsWith('tag: ')) {
      const name = ref.substring(5);
      pills.set(`tag:${name}`, { name, kind: 'tag' });
      continue;
    }
    let current = false;
    if (ref.startsWith('HEAD -> ')) {
      ref = ref.substring(8);
      current = true;
    }
    if (ref === 'HEAD') continue; // detached: the HEAD row is marked apart
    const remote = remoteNames.find((r) => ref.startsWith(`${r}/`));
    if (remote) {
      const name = ref.substring(remote.length + 1);
      if (name !== 'HEAD') branch(name).remotes.push(remote);
    } else {
      Object.assign(branch(ref), { local: true, current });
    }
  }
  return [...pills.values()].sort((a, b) => Number(b.current || false) - Number(a.current || false));
}

// The default branch's first-parent chain (origin/HEAD's branch, local and remote; else main / master): the
// graph's trunk, on its own lane (graphLayout.js). Empty when there is no such branch.
async function trunkHashes(repo) {
  const originHead = (await runGit(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).catch(() => '')).trim();
  const name = originHead.replace(/^refs\/remotes\/origin\//, '');
  const patterns = name ? [`refs/heads/${name}`, originHead] : ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master'];
  const refs = (await runGit(repo, ['for-each-ref', '--format=%(refname)', ...patterns])).split('\n').filter(Boolean);
  if (!refs.length) return new Set();
  return new Set((await runGit(repo, ['rev-list', '--first-parent', ...refs])).split('\n').filter(Boolean));
}

// A row's id, unique across repositories (two worktrees of one repository share their commits).
const rowId = (root, hash) => `${root}\n${hash}`;

// Commits on a local branch but on no remote one. None when there is no remote: everything would be unpushed.
async function unpushedHashes(repo) {
  if (!(repo.state.remotes || []).length) return new Set();
  const out = await runGit(repo, ['rev-list', '--branches', '--not', '--remotes']);
  return new Set(out.split('\n').filter(Boolean));
}

const uncommitted = (n) => `${n} uncommitted change${n > 1 ? 's' : ''}`;

// One repository's rows, newest first: commit fields, ref pills, plus a WIP row on top of HEAD when
// the working tree has changes, and one on top of each other worktree's HEAD with changes (read-only:
// worktreeFiles.js). Hashes become row ids, for the layout to keep repositories apart.
async function repoRows(repo, limit) {
  const root = repo.rootUri.fsPath;
  const others = await otherWorktrees(repo);
  const [{ commits, hasMore }, unpushed, trunk] = await Promise.all([loadCommits(repo, limit, others), unpushedHashes(repo), trunkHashes(repo)]);
  const head = repo.state.HEAD && repo.state.HEAD.commit;
  for (const wt of others.filter((w) => w.changes.length)) {
    const subject = `${wt.name}: ${uncommitted(wt.changes.length)}`;
    commits.unshift({ hash: `${WIP}${wt.path}`, parents: [wt.commit], subject, refs: '', wip: true, worktree: wt.path, worktreeName: wt.name, time: Infinity });
  }
  const changes = repo.state.workingTreeChanges.length + repo.state.indexChanges.length + repo.state.mergeChanges.length;
  if (changes && head) {
    commits.unshift({ hash: WIP, parents: [head], subject: uncommitted(changes), refs: '', wip: true, time: Infinity });
  }
  const remoteNames = (repo.state.remotes || []).map((r) => r.name);
  const rows = commits.map((c) => ({
    ...c,
    time: c.wip ? undefined : c.time,
    sortTime: c.time,
    root,
    id: rowId(root, c.hash),
    refs: parseRefs(c.refs, remoteNames),
    head: c.hash === head,
    unpushed: unpushed.has(c.hash),
    // This window's WIP row on a trunk HEAD stays in the trunk's lane, right above it.
    trunk: trunk.has(c.hash) || (c.wip && !c.worktree && trunk.has(head)),
  }));
  return { rows, hasMore };
}

// Several date-ordered lists into one, keeping each list's own order (children before parents).
function mergeByTime(lists, limit) {
  const heads = lists.map(() => 0);
  const out = [];
  while (out.length < limit) {
    let best = -1;
    lists.forEach((list, i) => {
      if (heads[i] < list.length && (best === -1 || list[heads[i]].sortTime > lists[best][heads[best]].sortTime)) best = i;
    });
    if (best === -1) break;
    out.push(lists[best][heads[best]++]);
  }
  return { rows: out, cut: lists.some((list, i) => heads[i] < list.length) };
}

// The graph of the selected repositories: newest `limit` rows of all of them, each with its layout.
async function loadGraph(repos, limit) {
  const loaded = await Promise.all(repos.map((repo) => repoRows(repo, limit)));
  const { rows, cut } = mergeByTime(loaded.map((l) => l.rows), limit);
  const layout = layoutGraph(rows.map((r) => ({ hash: r.id, parents: r.parents.map((p) => rowId(r.root, p)), wip: r.wip, worktree: r.worktree, head: r.head, unpushed: r.unpushed, trunk: r.trunk ? r.root : undefined })));
  return {
    rows: rows.map(({ sortTime, ...r }, i) => ({ ...r, graph: layout[i] })),
    hasMore: cut || loaded.some((l) => l.hasMore),
  };
}

// Row index of a commit in its repository's graph order (without the WIP rows), -1 when no ref reaches it.
async function positionOf(repo, hash) {
  const out = await runGit(repo, ['log', ...logRevs(await otherWorktrees(repo)), '--date-order', '--format=%H']);
  return out.split('\n').indexOf(hash);
}

module.exports = { loadGraph, positionOf, rowId, WIP };
