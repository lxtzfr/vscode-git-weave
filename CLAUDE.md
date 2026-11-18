# Project instructions

Git Weave: a VS Code extension, Source Control and commit graph side by side (plain JS, `main: ./extension.js`, no
build; the webview pages are `media/`). Unrelated workspace helpers (Unity...) go in LXTZFR Toolbox
(github.com/lxtzfr/vscode-toolbox), not here.

- Ids are prefixed `gitWeave.` (commands, views, context keys, workspaceState); every command used in a menu or a
  webview button is declared in `package.json` `contributes.commands`.

## Native VS Code config first

Before coding a feature in the extension, check whether it can be done with native VS Code configuration (settings, keybindings, built-in commands, existing views/menus). Only implement it in the extension if native config cannot do it.

<!-- my-stack:core:conventions:start -->
<!-- Managed by my-stack (`my-stack update`): do not edit inside this block. -->
@claude/my-stack/core/CLAUDE.md
<!-- my-stack:core:conventions:end -->

<!-- my-stack:local:start -->
<!-- Managed by my-stack (`my-stack update`): do not edit inside this block. -->
my-stack copies not committed (`my-stack.json` `local`): `core`.
When one is missing (fresh clone: no `claude/my-stack/<kit>/`), say so before any task: `my-stack restore`
rewrites them (needs the my-stack clone).
<!-- my-stack:local:end -->
