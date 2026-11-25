# Git Weave

A VS Code extension that puts Source Control and a commit graph side by side, in the spirit of WebStorm and
GitKraken: several repositories shown together, branches, worktrees and stashes one click away. Plain
JavaScript, no build step.

## Features

- **Nested repositories** opened automatically, at least two folder levels deep (more with
  `git.repositoryScanMaxDepth`), without changing any setting. Source Control lists them too.
- **Git Weave** in the activity bar, a webview:
  - repository checkboxes: several repositories shown together;
  - Changes, as in WebStorm (no staging area): a checkbox per file, folder and repository; diff on click, discard;
    other worktrees' changes under **repository (worktree)**;
  - commit box (Ctrl+Enter): the checked files committed with one message, one commit per repository or worktree;
  - Merge Changes: the conflicts, marked as resolved once fixed;
  - Local and Remote branches, Worktrees, Stashes, Tags, with their actions on hover and right-click; ↑ / ↓ on a
    branch for the commits to push / pull, a lone ↑ when it was never pushed;
  - an orange "waiting to be merged" icon on the branches (and worktrees) not merged into the default branch (`origin/HEAD`, else
    `main` / `master`); a squash or rebase merge counts as not merged.
- **Graph** in an editor tab (the **Git Weave** status bar button toggles it):
  - colored lanes, branch and tag pills, the checked repositories merged by date;
  - one or several commits selected: their files and foldable details on the right, diffs open in the first editor group.
- **Window title** (opt-in, `gitWeave.windowTitle.enabled`): the workspace name for a `.code-workspace`, else the
  git remote path.

## Install

From the Extensions view: search **Git Weave**, or **Install from VSIX…** with a `.vsix` of the releases.

## Logs

**Output** panel, channel **Git Weave**.

## License

[MIT](LICENSE)
