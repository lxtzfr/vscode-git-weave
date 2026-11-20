const { runGit } = require('./gitRepos');
const { RefType } = require('./branches');

const FIELD = '\x1f';

// "ahead 1, behind 2" / "gone" / "" -> { ahead, behind, gone }
function parseTrack(track) {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: track === 'gone' };
}

// Branches and tags of a repository in one git call (the vscode.git API needs one per kind and has
// no ahead / behind on lists). ref = { name, type, commit, upstream: { remote, name }, ahead, behind,
// gone, current, remote }, commit = the peeled commit for an annotated tag.
async function loadRefs(repo) {
  const remoteNames = (repo.state.remotes || []).map((r) => r.name);
  const splitRemote = (short) => {
    const remote = remoteNames.find((r) => short.startsWith(`${r}/`));
    return remote ? { remote, name: short.substring(remote.length + 1) } : undefined;
  };
  const format = ['%(refname)', '%(objectname)', '%(*objectname)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(HEAD)'].join(FIELD);
  const out = await runGit(repo, ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  const refs = { local: [], remote: [], tags: [] };
  for (const line of out.split('\n').filter(Boolean)) {
    const [full, object, peeled, upstream, track, head] = line.split(FIELD);
    const commit = peeled || object;
    if (full.startsWith('refs/heads/')) {
      const name = full.substring(11);
      refs.local.push({ name, type: RefType.Head, commit, upstream: upstream ? splitRemote(upstream) : undefined, ...parseTrack(track), current: head === '*' });
    } else if (full.startsWith('refs/remotes/')) {
      const name = full.substring(13);
      if (name.endsWith('/HEAD')) continue;
      refs.remote.push({ name, type: RefType.RemoteHead, commit, remote: (splitRemote(name) || {}).remote });
    } else {
      refs.tags.push({ name: full.substring(10), type: RefType.Tag, commit });
    }
  }
  await colorTags(repo, refs);
  return refs;
}

// A tag has the color of the branch it sits on, as its pill in the graph (the lane's color): colorCommit = the
// tip of the nearest local branch above it (git name-rev, "main~3" -> main), else its own commit.
async function colorTags(repo, refs) {
  const commits = [...new Set(refs.tags.map((t) => t.commit))];
  const tips = new Map(refs.local.map((b) => [b.name, b.commit]));
  const tipOf = new Map();
  for (let i = 0; i < commits.length; i += 200) {
    const chunk = commits.slice(i, i + 200);
    const out = await runGit(repo, ['name-rev', '--name-only', '--refs=refs/heads/*', ...chunk]);
    out.split('\n').forEach((line, j) => {
      const branch = line.trim().replace(/^heads\//, '').replace(/([~^]\d*)+$/, '');
      if (chunk[j] && tips.has(branch)) tipOf.set(chunk[j], tips.get(branch));
    });
  }
  for (const tag of refs.tags) tag.colorCommit = tipOf.get(tag.commit) || tag.commit;
}

module.exports = { loadRefs };
