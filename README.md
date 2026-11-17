# NBA Matchup Dashboard

A static GitHub Pages site for NBA games, built like the [NFL](https://github.com/rhyman7/nfl) and
[CFB](https://github.com/rhyman7/cfb) Matchup Dashboards: same graphite look, team-color blocks and
Head to Head rank bars, with basketball stats in place of football ones.

## Pages

- **Tonight's Matchups** (`index.html`): every game on the day's slate, grouped by tip-off time.
  Each row has both teams (record and adjusted net rating), the spread, the total, implied team
  totals, the arena and TV. B2B marks a team on the second night of a back-to-back; "3d rest" a team
  with three or more days off. A line that has moved since the morning shows what it opened at.
  Live scores join the rows once games start. The date strip in the top bar opens the last three
  days (final scores) and the next six (schedule): `index.html?date=YYYY-MM-DD`.
- **Matchup** (`matchup.html?game=<ESPN game id>`): the game header (line, total, implied score,
  rest and games in the last 7 days, altitude in Denver and Utah), Head to Head (each offense
  against the other defense on adjusted rating, points, the Four Factors and shooting, with league
  ranks and an edge called at one standard deviation), pace, form and rest, then both team cards:
  SRS/OSRS/DSRS/SoS, offense and defense dials, the top ten players by minutes (click a name for the
  game log), defense against guards, forwards and centers, and the last ten games.
- **Team Ratings** (`ratings.html`): every team's adjusted offensive, defensive and net ratings,
  SRS, pace and Four Factors in one sortable table.
- **Compare Any Two Teams** (`compare.html?t1=BOS&t2=NY`).
- **How to Read Matchups** (`how-to-read.html`): what every number means.

All pages read `data/data.json` and share `common.js`, `teamcolors.js`, `style.css` (the football
sites' stylesheet, unchanged) and `nba.css` (the basketball additions).

## Data

`scripts/build_data.py` downloads three files from
[sportsdataverse/hoopR-nba-data](https://github.com/sportsdataverse/hoopR-nba-data) (schedule, team
box scores, player box scores; no key needed) and writes `data/data.json`:

- **Team stats** from regular-season games only: per game, per 100 possessions
  (possessions = FGA − OREB + TOV + 0.44 × FTA) and the Four Factors, for and against.
- **Adjusted ratings**: a ridge regression over every game at once (offense, defense and home
  court), on points per 100 possessions (Adj. ratings) and on points (SRS, OSRS, DSRS).
- **Players**: per-game averages, last-5 scoring and the last 15 games for each team's top ten by minutes.
- **Defense by position**: what opposing guards, forwards and centers score per game.
- **Schedule**: three days back and six ahead of the slate, with rest days, games in the last
  seven days, and ESPN's line when the build can reach ESPN. The first line of the day is kept
  as `lineOpen`.

The live score and current line are fetched by the viewer's browser from ESPN's public scoreboard
(`live.js`), so they are current even between builds.

The **Rebuild NBA data** Action (`.github/workflows/rebuild-data.yml`) runs four times a day from
October to June, checks the build (`scripts/check_data.py`) and commits `data/` to `main`.

## Run it locally

```bash
pip install -r requirements.txt
python scripts/build_data.py        # writes data/data.json
python scripts/check_data.py
python -m http.server 8000          # then open http://localhost:8000
```

## Not yet

Injury reports, player props, the daily matchup report and PDFs, and the value board's
projections (a separate repo, rhyman7/bb-value-board) come in later phases.
