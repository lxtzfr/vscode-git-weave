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
  return refs;
}

module.exports = { loadRefs };
