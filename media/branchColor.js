// A commit's color index from its hash alone, so the graph's lines and pills (graphLayout.js) and the sidebar's
// icons agree without sharing any state: every ref on a commit has its color. Loaded by the webviews and
// required by the extension.
(function () {
  // The theme's graph colors, then the chart colors for more variety.
  const COLORS = [1, 2, 3, 4, 5].map((i) => `var(--vscode-scmGraph-foreground${i})`).concat(['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map((c) => `var(--vscode-charts-${c})`));
  const COLOR_COUNT = COLORS.length;

  function colorIndexOf(hash) {
    let n = 0;
    for (const ch of hash) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return n % COLOR_COUNT;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { colorIndexOf, COLORS, COLOR_COUNT };
  else Object.assign(window, { colorIndexOf, BRANCH_COLORS: COLORS });
})();
