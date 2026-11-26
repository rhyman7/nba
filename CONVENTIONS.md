# Conventions: NBA Matchup Dashboard

Read this before changing anything in this repo, and update it in the same pull request whenever a
convention changes. The rules follow the NFL and CFB dashboards'.

- Live site: GitHub Pages from `main`, repo root.
- **Pull requests, merged after checks.** `main` is the live site. Hand changes go through a pull
  request (one topic per PR): run the checks below, then merge (squash). Tell Ryan what went live.
- **Automated commits straight to `main`:** only the **Rebuild NBA data** Action (`data/`).
- **Ask first** if anything is unclear or a change could break the live site.
- **Out of scope here:** prediction and betting-model work belongs in rhyman7/bb-value-board.
- **Look.** Keep `style.css` identical to the football sites' file; put basketball-only styles in
  `nba.css`. Team colors live in `teamcolors.js` (ESPN abbreviations).
- **Writing on the page.** Plain words, full sentences, no jargon a casual fan wouldn't know without
  a note on How to Read Matchups.

## Checks before merging

1. `python scripts/build_data.py` and `python scripts/check_data.py` pass.
2. Serve the folder (`python -m http.server`) and load `index.html`, one `matchup.html?game=<id>`,
   `ratings.html`, `compare.html` and `how-to-read.html` headlessly at 1280 and 390 wide: no page
   errors (failed requests to ESPN are fine when ESPN is unreachable) and no sideways scrolling.

- **Site bar (Nov 26, 2026).** Every page loads the Weekly Gridiron Board's site bar as the first
  thing in `<body>`: `<script src="/site-bar.js" data-shell="2"></script>`. The script lives in
  rhyman7/rhyman7.github.io; change the bar there. It marks Basketball as the current section and
  gives the pages the Back arrow inside the home-screen app. A new page needs the same line.

- **One site (Nov 26, 2026).** With the shared bar on (`html.wgb-shell-on`), the page's own menu
  (`.topnav > a`) and "All boards" are hidden: the bar's second row lists this league's pages and
  the College/NBA switch (`HOOPS` in rhyman7.github.io's `site-bar.js`). They stay in the markup as
  the fallback when the bar script does not load. A new page is added to both.
