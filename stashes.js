const vscode = require('vscode');
const { log } = require('./logger');
const { repoName, runGit } = require('./gitRepos');

const FIELD = '\x1f';

// The vscode.git API has no stash list. stash = { ref ("stash@{0}"), hash, parents, subject, author, email, time };
// parents[0] is the commit the stash was made on: diffing against it gives the stashed changes.
async function loadStashes(repo) {
  const out = await runGit(repo, ['stash', 'list', `--format=%gd${FIELD}%H${FIELD}%P${FIELD}%gs${FIELD}%an${FIELD}%ae${FIELD}%ct`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, parents, subject, author, email, time] = line.split(FIELD);
      return { ref, hash, parents: parents.split(' '), subject, author, email, time: Number(time) };
    });
}

async function stashAction(item, verb, confirm) {
  const { repo, stash } = item;
  if (!stash) return false;
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(`${confirm} ${stash.ref}? This cannot be undone.`, { modal: true, detail: stash.subject }, confirm);
    if (answer !== confirm) return false;
  }
  try {
    log.info(`[stashes] ${repoName(repo)}: ${verb} ${stash.ref}`);
    await runGit(repo, ['stash', verb, stash.ref]);
  } catch (err) {
    log.error(`[stashes] ${repoName(repo)}: ${verb} ${stash.ref} failed:`, err);
    vscode.window.showErrorMessage(`Stash ${verb} failed: ${err.message}`);
  }
  return true;
}

// Our own stash, not git.stash: that command takes the git extension's internal repository object and
// would ask which repository instead of using the graph's.
async function createStash(repo, includeUntracked) {
  const message = await vscode.window.showInputBox({ prompt: `Stash message (${repoName(repo)})`, placeHolder: 'Optional' });
  if (message === undefined) return false;
  try {
    log.info(`[stashes] ${repoName(repo)}: stash${includeUntracked ? ' (with untracked)' : ''}`);
    await runGit(repo, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(message ? ['-m', message] : [])]);
  } catch (err) {
    log.error(`[stashes] ${repoName(repo)}: stash failed:`, err);
    vscode.window.showErrorMessage(`Stash failed: ${err.message}`);
  }
  return true;
}

// Actions of the graph sidebar's stash rows. resolve(ctx) -> { repo, stash }; onChange() reloads the
// graph: dropping a stash changes no repository state, so nothing else would.
function registerStashCommands(context, resolve, onChange) {
  const withItem = (fn) => async (ctx) => {
    const item = ctx && (await resolve(ctx));
    if (item && (await fn(item))) onChange();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('gitWeave.stashes.apply', withItem((item) => stashAction(item, 'apply'))),
    vscode.commands.registerCommand('gitWeave.stashes.pop', withItem((item) => stashAction(item, 'pop'))),
    vscode.commands.registerCommand('gitWeave.stashes.drop', withItem((item) => stashAction(item, 'drop', 'Drop'))),
    vscode.commands.registerCommand('gitWeave.stashes.create', withItem((item) => createStash(item.repo, false))),
    vscode.commands.registerCommand('gitWeave.stashes.createUntracked', withItem((item) => createStash(item.repo, true)))
  );
}

module.exports = { loadStashes, registerStashCommands };
