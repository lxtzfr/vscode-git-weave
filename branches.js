const vscode = require('vscode');
const { log } = require('./logger');
const { repoName, errorText } = require('./gitRepos');

// Ref types from the vscode.git API (also what refs.js gives the webview)
const RefType = { Head: 0, RemoteHead: 1, Tag: 2 };


// Checks out a branch; a remote one ("origin/foo") through its local branch "foo", created tracking it when missing.
async function checkoutRef(repo, { name, remote }) {
  try {
    if (remote) {
      const localName = name.substring(name.indexOf('/') + 1);
      const locals = await repo.getBranches({ remote: false });
      if (locals.some((r) => r.type === RefType.Head && r.name === localName)) {
        log.info(`[branches] ${repoName(repo)}: checkout ${localName}`);
        await repo.checkout(localName);
      } else {
        log.info(`[branches] ${repoName(repo)}: create ${localName} tracking ${name}`);
        await repo.createBranch(localName, true, name);
        await repo.setBranchUpstream(localName, name);
      }
    } else {
      log.info(`[branches] ${repoName(repo)}: checkout ${name}`);
      await repo.checkout(name);
    }
  } catch (err) {
    log.error(`[branches] ${repoName(repo)}: checkout ${name} failed:`, err);
    vscode.window.showErrorMessage(`Checkout failed: ${errorText(err)}`);
  }
}

const checkout = (item) => checkoutRef(item.repo, { name: item.ref.name, remote: item.ref.type === RefType.RemoteHead });

async function deleteBranch(item) {
  const { repo, ref } = item;
  const remote = ref.type === RefType.RemoteHead;
  const confirm = remote ? 'Delete on remote' : 'Delete';
  const answer = await vscode.window.showWarningMessage(
    remote ? `Delete remote branch "${ref.name}"? This cannot be undone.` : `Delete local branch "${ref.name}"?`,
    { modal: true },
    confirm
  );
  if (answer !== confirm) return;
  try {
    if (remote) {
      const slash = ref.name.indexOf('/');
      log.info(`[branches] ${repoName(repo)}: delete remote branch ${ref.name}`);
      await repo.push(ref.name.substring(0, slash), `:${ref.name.substring(slash + 1)}`);
    } else {
      log.info(`[branches] ${repoName(repo)}: delete branch ${ref.name}`);
      await deleteLocal(repo, ref.name);
    }
  } catch (err) {
    log.error(`[branches] ${repoName(repo)}: delete ${ref.name} failed:`, err);
    vscode.window.showErrorMessage(`Delete failed: ${errorText(err)}`);
  }
}

// git refuses a branch not merged into HEAD: ask before forcing.
async function deleteLocal(repo, name) {
  try {
    await repo.deleteBranch(name, false);
  } catch (err) {
    if (!/not fully merged/i.test(errorText(err))) throw err;
    const force = 'Force delete';
    const answer = await vscode.window.showWarningMessage(`"${name}" is not fully merged. Delete anyway?`, { modal: true }, force);
    if (answer !== force) return;
    log.info(`[branches] ${repoName(repo)}: force delete ${name}`);
    await repo.deleteBranch(name, true);
  }
}

// Runs a branch action: logs it, reports a failure to the user.
async function run(item, action, fn) {
  const { repo, ref } = item;
  try {
    log.info(`[branches] ${repoName(repo)}: ${action} ${ref.name}`);
    await fn(repo, ref);
  } catch (err) {
    log.error(`[branches] ${repoName(repo)}: ${action} ${ref.name} failed:`, err);
    vscode.window.showErrorMessage(`${action} failed: ${errorText(err)}`);
  }
}

const copyName = (item) => run(item, 'copy name', (_repo, ref) => vscode.env.clipboard.writeText(ref.name));

const merge = (item) => run(item, 'merge into current', (repo, ref) => repo.merge(ref.name));

async function renameBranch(item) {
  const newName = await vscode.window.showInputBox({ prompt: `Rename "${item.ref.name}" to`, value: item.ref.name });
  if (!newName || newName === item.ref.name) return;
  // The git API has no rename: copy the branch (with its upstream), switch off it if current, drop the old one.
  await run(item, `rename to ${newName}`, async (repo, ref) => {
    await repo.createBranch(newName, false, ref.name);
    if (ref.upstream) await repo.setBranchUpstream(newName, `${ref.upstream.remote}/${ref.upstream.name}`);
    if (repo.state.HEAD && repo.state.HEAD.name === ref.name) await repo.checkout(newName);
    await repo.deleteBranch(ref.name, true);
  });
}

// Publishes a branch without upstream to its remote (origin, else the first one) and tracks it.
const pushBranch = (item) => run(item, 'push', pushOne);

async function createBranchFrom(item) {
  const name = await vscode.window.showInputBox({ prompt: `New branch from "${item.ref.name}"` });
  if (!name) return;
  await run(item, `create ${name} from`, (repo, ref) => repo.createBranch(name, true, ref.name));
}

async function deleteTag(item) {
  const answer = await vscode.window.showWarningMessage(`Delete local tag "${item.ref.name}"?`, { modal: true }, 'Delete');
  if (answer !== 'Delete') return;
  await run(item, 'delete tag', (repo, ref) => repo.deleteTag(ref.name));
}

// Branch / tag actions of the graph's ref menus (webview/context). resolve(ctx) -> { repo, ref } with
// ref = { name, type, commit, upstream: { remote, name } }, undefined when the graph has no repository.
function registerBranchCommands(context, resolve) {
  const withRef = (fn) => (ctx) => {
    const item = ctx && resolve(ctx);
    return item && fn(item);
  };
  const commands = {
    checkout,
    delete: deleteBranch,
    copyName,
    merge,
    rename: renameBranch,
    push: pushBranch,
    createFrom: createBranchFrom,
    deleteTag,
  };
  context.subscriptions.push(
    ...Object.entries(commands).map(([name, fn]) => vscode.commands.registerCommand(`gitWeave.branches.${name}`, withRef(fn)))
  );
}

// Fetch / Pull / Push at three levels, by what the button's context holds: a ref (that branch), a root (that
// repository), neither (every selected repository). reposOf(ctx) -> the repositories to act on.
// A non-current branch is pulled by a fast-forward-only fetch into it (git refuses anything else).
const upstreamOf = (ref) => {
  if (!ref.upstream) throw new Error(`"${ref.name}" has no upstream`);
  return ref.upstream;
};

const SYNC = {
  fetch: {
    ref: (repo, ref) => (ref.upstream ? repo.fetch({ remote: ref.upstream.remote, ref: ref.upstream.name }) : repo.fetch()),
    repo: (repo) => repo.fetch(),
  },
  pull: {
    ref: (repo, ref) => {
      const up = upstreamOf(ref);
      return ref.current ? repo.pull() : repo.fetch({ remote: up.remote, ref: `${up.name}:${ref.name}` });
    },
    repo: (repo) => repo.pull(),
  },
  // Branches with an upstream and commits to push; unpublished ones are left out (publishing is the branch's own Push).
  push: {
    ref: (repo, ref) => pushOne(repo, ref),
    repo: async (repo) => {
      const ahead = (await repo.getBranches({ remote: false })).filter((b) => b.type === RefType.Head && b.upstream && b.ahead);
      for (const b of ahead) await repo.push(b.upstream.remote, b.name);
    },
  },
};

async function pushOne(repo, ref) {
  const remotes = repo.state.remotes || [];
  const remote = ref.upstream ? ref.upstream.remote : (remotes.find((r) => r.name === 'origin') || remotes[0] || {}).name;
  if (!remote) throw new Error('no remote configured');
  await repo.push(remote, ref.name, !ref.upstream);
}

function registerSyncCommands(context, reposOf) {
  const sync = (action) => async (ctx = {}) => {
    const level = ctx.ref ? 'ref' : 'repo';
    await Promise.all(
      reposOf(ctx).map(async (repo) => {
        const what = ctx.ref ? ctx.ref.name : 'all';
        try {
          log.info(`[branches] ${repoName(repo)}: ${action} ${what}`);
          await SYNC[action][level](repo, ctx.ref);
        } catch (err) {
          log.error(`[branches] ${repoName(repo)}: ${action} ${what} failed:`, err);
          vscode.window.showErrorMessage(`${repoName(repo)}: ${action} ${what} failed: ${errorText(err)}`);
        }
      })
    );
  };
  context.subscriptions.push(...Object.keys(SYNC).map((action) => vscode.commands.registerCommand(`gitWeave.sync.${action}`, sync(action))));
}

module.exports = { registerSyncCommands, registerBranchCommands, checkoutRef, RefType };
