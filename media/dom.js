// DOM helpers shared by the webview scripts (graph tab, sidebar view).
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // style goes through the CSSOM: the CSP (no 'unsafe-inline') blocks a style attribute.
  function svgEl(tag, { style, ...attrs }) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const [k, v] of Object.entries(style || {})) node.style.setProperty(k, v);
    return node;
  }

  const codicon = (name) => el('span', `codicon codicon-${name}`);

  // data-vscode-context: what the webview/context menus (package.json) and their commands receive.
  const menuContext = (node, context) => {
    node.dataset.vscodeContext = JSON.stringify({ ...context, preventDefaultContextMenuItems: true });
  };

  // Hover button of a tree row (the native tree's inline actions); the click does not reach the row.
  // busyKey: while it is in `busy` (a running command) the button is a spinner, shown without hover, not clickable.
  const busy = new Set();
  const busyKey = (command, ctx) => `${command}|${ctx.root || ''}|${ctx.ref ? ctx.ref.name : ''}`;

  function actionButton(icon, title, onClick, key) {
    if (key && busy.has(key)) {
      // Only the glyph turns: spinning the button itself would turn its padding and hover background too.
      const spinner = el('span', 'action busy');
      spinner.title = `${title}…`;
      spinner.append(codicon('loading codicon-modifier-spin'));
      return spinner;
    }
    const button = el('span', `action codicon codicon-${icon}`);
    button.title = title;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    button.addEventListener('dblclick', (e) => e.stopPropagation());
    return button;
  }

  // A repository's color (repoSelection.js colorOf), the same in the graph and the sidebar.
  const REPO_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'yellow'];
  const repoColor = (index) => `var(--vscode-charts-${REPO_COLORS[Math.max(index, 0) % REPO_COLORS.length]})`;

  // The repository icon, in its color.
  function repoIcon(index) {
    const icon = codicon('repo');
    icon.style.color = repoColor(index);
    return icon;
  }

  window.dom = { el, svgEl, codicon, menuContext, actionButton, busy, busyKey, repoColor, repoIcon };
})();
