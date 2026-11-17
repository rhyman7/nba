#!/usr/bin/env python3
"""
Builds data/data.json for the NBA Matchup Dashboard from sportsdataverse's hoopR data.

Inputs (downloaded on every run, nothing committed, no API key):
    https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/
        schedules/parquet/nba_schedule_<S>.parquet   every game of the season, with venue and status
        team_box/parquet/team_box_<S>.parquet         one row per team per finished game
        player_box/parquet/player_box_<S>.parquet     one row per player per finished game
    <S> is the year the season ends: the 2026-27 season is 2027.

Optional: ESPN's public scoreboard for the slate's current spread and total. It is read
with a short timeout; when it can't be reached (it isn't from every machine) the lines are
simply left out and the page fetches them itself in the viewer's browser.

Usage:
    python scripts/build_data.py [--season 2027] [--out data/data.json] [--src <cache folder>]
                                 [--today YYYY-MM-DD]

Only regular-season games count toward the stats (NBA Cup group games are regular season;
the Cup final is not). The first line of the day for each slate game (lineOpen) is kept from
the published file, so the board can show how a line has moved since the morning.
"""
import argparse
import json
import math
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

ET = ZoneInfo("America/New_York")
BASE = "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba"
FILES = {
    "schedule": "schedules/parquet/nba_schedule_{s}.parquet",
    "team_box": "team_box/parquet/team_box_{s}.parquet",
    "player_box": "player_box/parquet/player_box_{s}.parquet",
}
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d}"

# Conference and division of each team, by ESPN abbreviation.
DIVISIONS = {
    "East Atlantic": ["BOS", "BKN", "NY", "PHI", "TOR"],
    "East Central": ["CHI", "CLE", "DET", "IND", "MIL"],
    "East Southeast": ["ATL", "CHA", "MIA", "ORL", "WSH"],
    "West Northwest": ["DEN", "MIN", "OKC", "POR", "UTAH"],
    "West Pacific": ["GS", "LAC", "LAL", "PHX", "SAC"],
    "West Southwest": ["DAL", "HOU", "MEM", "NO", "SA"],
}
DIV_OF = {a: d for d, teams in DIVISIONS.items() for a in teams}
# Arenas a mile or more above sea level.
ALTITUDE = {"DEN": 5280, "UTAH": 4226}

HOME_COURT_PRIOR = 2.5      # points; the solve below estimates it, shrunk toward this
RIDGE = 2.0                 # ridge penalty on the team ratings, in games
SLATE_DAYS_BACK = 3         # finished days kept in data.json for the date strip
SLATE_DAYS_AHEAD = 6        # upcoming days kept
PLAYER_ROWS = 10            # players per team card, by minutes per game
LOG_GAMES = 15              # game log entries kept per player


def note(msg):
    print("note:", msg, file=sys.stderr)


def fetch_parquet(kind, season, src):
    path = Path(src) / f"{kind}_{season}.parquet"
    url = f"{BASE}/{FILES[kind].format(s=season)}"
    req = urllib.request.Request(url, headers={"User-Agent": "nba-matchup-dashboard"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                path.write_bytes(r.read())
            break
        except Exception as e:
            if attempt == 2:
                if path.exists():
                    note(f"{kind}: download failed ({e}); using the copy from an earlier run")
                    break
                raise
            time.sleep(10 * (attempt + 1))
    return pd.read_parquet(path)


def r1(x, n=1):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), n)


def season_for(today):
    """The season that is on: from August on it's the season ending next year."""
    return today.year + 1 if today.month >= 8 else today.year


# ---------------------------------------------------------------- team stats

def possessions(fga, oreb, tov, fta):
    return fga - oreb + tov + 0.44 * fta


def team_games(tb, pb):
    """One row per team per finished regular-season game, with the opponent's numbers beside it."""
    tb = tb[tb.season_type == 2].copy()
    num = ["team_score", "field_goals_made", "field_goals_attempted", "three_point_field_goals_made",
           "three_point_field_goals_attempted", "free_throws_made", "free_throws_attempted",
           "offensive_rebounds", "defensive_rebounds", "total_rebounds", "assists", "steals", "blocks",
           "turnovers", "total_turnovers", "fouls", "points_in_paint", "fast_break_points", "turnover_points"]
    for c in num:
        tb[c] = pd.to_numeric(tb[c], errors="coerce").fillna(0)
    tb["tov"] = tb["total_turnovers"].where(tb["total_turnovers"] > 0, tb["turnovers"])
    # game length from player minutes (240 in regulation, +25 per overtime)
    mins = pb.groupby(["game_id", "team_id"])["minutes"].sum().rename("team_min").reset_index()
    tb = tb.merge(mins, on=["game_id", "team_id"], how="left")
    tb["team_min"] = tb["team_min"].fillna(240).clip(lower=240)
    keep = ["game_id", "team_id"] + num + ["tov"]
    opp = tb[keep].rename(columns={c: "o_" + c for c in keep if c != "game_id"})
    g = tb.merge(opp, left_on=["game_id", "opponent_team_id"], right_on=["game_id", "o_team_id"])
    g["poss"] = possessions(g.field_goals_attempted, g.offensive_rebounds, g.tov, g.free_throws_attempted)
    g["o_poss"] = possessions(g.o_field_goals_attempted, g.o_offensive_rebounds, g.o_tov, g.o_free_throws_attempted)
    g["pace_poss"] = (g.poss + g.o_poss) / 2
    g["pace48"] = g.pace_poss * 48 * 5 / g.team_min
    g["home"] = (g.team_home_away == "home").astype(int)
    g["margin"] = g.team_score - g.o_team_score
    g["date"] = pd.to_datetime(g.game_date)
    return g.sort_values(["date", "game_id"])


def ridge_ratings(g, value, abbrs):
    """Opponent-adjusted offense and defense on a per-game value (points or points per 100):
    value_ij = mean + off_i - def_j + hca * home_i, solved by ridge over every team at once.
    Returns ({abbr: off}, {abbr: def}, hca, mean). def is points (or per 100) kept below average:
    positive is good."""
    idx = {a: i for i, a in enumerate(abbrs)}
    n = len(abbrs)
    rows = g[g.team_abbreviation.isin(idx) & g.opponent_team_abbreviation.isin(idx)]
    X = np.zeros((len(rows), 2 * n + 1))
    y = rows[value].to_numpy(float)
    mean = y.mean()
    for k, (a, o, h) in enumerate(zip(rows.team_abbreviation, rows.opponent_team_abbreviation, rows.home)):
        X[k, idx[a]] = 1
        X[k, n + idx[o]] = -1
        X[k, 2 * n] = 1 if h else -1
    pen = np.full(2 * n + 1, RIDGE)
    # the home-court term is shrunk toward the prior instead of toward zero
    prior = np.zeros(2 * n + 1)
    prior[2 * n] = HOME_COURT_PRIOR / 2 if value == "team_score" else 0
    A = X.T @ X + np.diag(pen)
    b = X.T @ (y - mean) + pen * prior
    beta = np.linalg.solve(A, b)
    off = {a: float(beta[idx[a]]) for a in abbrs}
    dfn = {a: float(beta[n + idx[a]]) for a in abbrs}
    return off, dfn, float(beta[2 * n]) * 2, mean


def summarize_teams(g, sched):
    teams = {}
    abbrs = sorted(g.team_abbreviation.unique())
    names = g.drop_duplicates("team_abbreviation").set_index("team_abbreviation")
    # SRS-style ratings on points, and adjusted efficiency on points per 100 possessions
    g = g.copy()
    g["ortg"] = 100 * g.team_score / g.poss
    o_pts, d_pts, hca_pts, _ = ridge_ratings(g, "team_score", abbrs)
    o_eff, d_eff, hca_eff, lg_eff = ridge_ratings(g, "ortg", abbrs)

    for a in abbrs:
        t = g[g.team_abbreviation == a]
        n = len(t)
        row = names.loc[a]
        S = t.sum(numeric_only=True)
        w = int((t.margin > 0).sum())
        l = n - w
        hm, rd = t[t.home == 1], t[t.home == 0]
        last10 = t.tail(10)
        streak_n, streak_w = 0, None
        for m in reversed(t.margin.tolist()):
            won = m > 0
            if streak_w is None:
                streak_w = won
            if won != streak_w:
                break
            streak_n += 1
        poss, oposs = S.poss, S.o_poss
        fga, ofga = S.field_goals_attempted, S.o_field_goals_attempted
        mov = t.margin.mean()
        osrs, dsrs = o_pts[a], d_pts[a]
        teams[a] = {
            "abbr": a,
            "team": row.team_display_name,
            "short": row.team_short_display_name,
            "color": row.team_color,
            "alt": row.team_alternate_color,
            "conf": DIV_OF.get(a, " ").split(" ")[0],
            "division": DIV_OF.get(a, ""),
            "record": {
                "w": w, "l": l,
                "home": f"{int((hm.margin > 0).sum())}-{int((hm.margin < 0).sum())}",
                "road": f"{int((rd.margin > 0).sum())}-{int((rd.margin < 0).sum())}",
                "last10": f"{int((last10.margin > 0).sum())}-{int((last10.margin < 0).sum())}",
                "streak": (("W" if streak_w else "L") + str(streak_n)) if streak_n else "",
                "mov": r1(mov),
                "srs": r1(osrs + dsrs),
                "osrs": r1(osrs),
                "dsrs": r1(dsrs),
                "sos": r1(osrs + dsrs - mov),
            },
            "offense": {
                "ppg": r1(t.team_score.mean()),
                "ortg": r1(100 * S.team_score / poss),
                "adjOrtg": r1(lg_eff + o_eff[a]),
                "efg": r1(100 * (S.field_goals_made + 0.5 * S.three_point_field_goals_made) / fga),
                "tovPct": r1(100 * S.tov / poss),
                "orbPct": r1(100 * S.offensive_rebounds / (S.offensive_rebounds + S.o_defensive_rebounds)),
                "ftr": r1(100 * S.free_throws_attempted / fga),
                "threeRate": r1(100 * S.three_point_field_goals_attempted / fga),
                "threePct": r1(100 * S.three_point_field_goals_made / max(1, S.three_point_field_goals_attempted)),
                "threesG": r1(S.three_point_field_goals_made / n),
                "ftPct": r1(100 * S.free_throws_made / max(1, S.free_throws_attempted)),
                "astG": r1(S.assists / n),
                "rebG": r1(S.total_rebounds / n),
                "paintG": r1(S.points_in_paint / n),
                "fastG": r1(S.fast_break_points / n),
            },
            "defense": {
                "papg": r1(t.o_team_score.mean()),
                "drtg": r1(100 * S.o_team_score / oposs),
                "adjDrtg": r1(lg_eff - d_eff[a]),
                "efg": r1(100 * (S.o_field_goals_made + 0.5 * S.o_three_point_field_goals_made) / ofga),
                "tovPct": r1(100 * S.o_tov / oposs),
                "drbPct": r1(100 * S.defensive_rebounds / (S.defensive_rebounds + S.o_offensive_rebounds)),
                "ftr": r1(100 * S.o_free_throws_attempted / ofga),
                "threeRate": r1(100 * S.o_three_point_field_goals_attempted / ofga),
                "threePct": r1(100 * S.o_three_point_field_goals_made / max(1, S.o_three_point_field_goals_attempted)),
                "threesG": r1(S.o_three_point_field_goals_made / n),
                "stlG": r1(S.steals / n),
                "blkG": r1(S.blocks / n),
                "paintG": r1(S.o_points_in_paint / n) if "o_points_in_paint" in t else None,
            },
            "pace": r1(t.pace48.mean()),
            "net": r1(100 * S.team_score / poss - 100 * S.o_team_score / oposs),
            "adjNet": r1(o_eff[a] + d_eff[a]),
            "games": [
                {
                    "id": str(x.game_id), "date": x.date.strftime("%Y-%m-%d"),
                    "opp": x.opponent_team_abbreviation, "at": int(x.home == 0),
                    "pts": int(x.team_score), "oppPts": int(x.o_team_score),
                    "res": ("W" if x.margin > 0 else "L") + f" {int(x.team_score)}-{int(x.o_team_score)}",
                    "ot": int(x.team_min >= 260),
                }
                for x in t.itertuples()
            ],
        }
    league = {
        "ortg": r1(100 * g.team_score.sum() / g.poss.sum()),
        "pace": r1(g.pace48.mean()),
        "ppg": r1(g.team_score.mean()),
        "homeCourt": r1(hca_pts),
        "homeCourtEff": r1(hca_eff),
    }
    return teams, league


# ---------------------------------------------------------------- players

def summarize_players(pb, g, teams):
    pb = pb[pb.season_type == 2].copy()
    pb["minutes"] = pd.to_numeric(pb["minutes"], errors="coerce")
    played = pb[pb.minutes.fillna(0) > 0].copy()
    played["date"] = pd.to_datetime(played.game_date)
    played = played.sort_values(["date", "game_id"])
    num = ["points", "rebounds", "assists", "three_point_field_goals_made", "three_point_field_goals_attempted",
           "field_goals_made", "field_goals_attempted", "free_throws_made", "free_throws_attempted",
           "steals", "blocks", "turnovers", "offensive_rebounds"]
    for c in num:
        played[c] = pd.to_numeric(played[c], errors="coerce").fillna(0)

    logs = {}
    for a, t in teams.items():
        tp = played[played.team_abbreviation == a]
        team_games_n = len(t["games"])
        last_game = t["games"][-1]["id"] if t["games"] else None
        rows = []
        for pid, p in tp.groupby("athlete_id"):
            n = len(p)
            S = p[num].sum()
            last5 = p.tail(5)
            key = f"{a}_{pid}"
            # where the player was in the team's last game: played, or listed out and why
            lg = pb[(pb.game_id.astype(str) == last_game) & (pb.athlete_id == pid)]
            out_reason = None
            if not lg.empty and (lg.minutes.fillna(0).iloc[0] == 0):
                reason = str(lg.reason.iloc[0] or "")
                if reason and reason.upper() != "COACH'S DECISION":
                    out_reason = reason.title()
            info = p.iloc[-1]
            rows.append({
                "player": info.athlete_display_name,
                "short": info.athlete_short_name,
                "pos": info.athlete_position_abbreviation or "",
                "id": str(pid),
                "log": key,
                "gp": n,
                "gs": int(p.starter.fillna(False).astype(bool).sum()),
                "min": r1(p.minutes.mean()),
                "pts": r1(S.points / n),
                "reb": r1(S.rebounds / n),
                "ast": r1(S.assists / n),
                "threes": r1(S.three_point_field_goals_made / n),
                "stl": r1(S.steals / n),
                "blk": r1(S.blocks / n),
                "tov": r1(S.turnovers / n),
                "fgPct": r1(100 * S.field_goals_made / S.field_goals_attempted) if S.field_goals_attempted else None,
                "threePct": r1(100 * S.three_point_field_goals_made / S.three_point_field_goals_attempted) if S.three_point_field_goals_attempted else None,
                "ftPct": r1(100 * S.free_throws_made / S.free_throws_attempted) if S.free_throws_attempted else None,
                "pra": r1((S.points + S.rebounds + S.assists) / n),
                "l5pts": r1(last5.points.mean()),
                "l5min": r1(last5.minutes.mean()),
                "share": r1(100 * n / max(1, team_games_n), 0),
                "lastOut": out_reason,
            })
            logs[key] = [
                {
                    "d": x.date.strftime("%Y-%m-%d"), "opp": x.opponent_team_abbreviation,
                    "at": int(x.home_away == "away"), "min": int(round(x.minutes)),
                    "pts": int(x.points), "reb": int(x.rebounds), "ast": int(x.assists),
                    "fg": f"{int(x.field_goals_made)}-{int(x.field_goals_attempted)}",
                    "tpm": int(x.three_point_field_goals_made), "tpa": int(x.three_point_field_goals_attempted),
                    "stl": int(x.steals), "blk": int(x.blocks), "tov": int(x.turnovers),
                    "gs": int(bool(x.starter)), "res": "W" if x.team_winner else "L",
                }
                for x in p.tail(LOG_GAMES).iloc[::-1].itertuples()
            ]
        rows.sort(key=lambda r: (-(r["min"] or 0) * r["gp"]))
        t["players"] = rows[:PLAYER_ROWS]
        t["rotation"] = len([r for r in rows if (r["min"] or 0) >= 12 and r["share"] >= 50])
    return logs


def defense_vs_position(pb, teams):
    """Points, rebounds, assists and threes a defense allows per game to guards, forwards and centers
    (ESPN's position labels: G, F, C), with the league rank (1 = allows the fewest)."""
    pb = pb[(pb.season_type == 2) & (pd.to_numeric(pb.minutes, errors="coerce").fillna(0) > 0)].copy()
    for c in ["points", "rebounds", "assists", "three_point_field_goals_made"]:
        pb[c] = pd.to_numeric(pb[c], errors="coerce").fillna(0)
    by = (pb.groupby(["opponent_team_abbreviation", "game_id", "athlete_position_abbreviation"])
          [["points", "rebounds", "assists", "three_point_field_goals_made"]].sum().reset_index())
    avg = by.groupby(["opponent_team_abbreviation", "athlete_position_abbreviation"]).mean(numeric_only=True)
    for pos in ["G", "F", "C"]:
        sub = avg.xs(pos, level=1) if pos in avg.index.get_level_values(1) else None
        if sub is None:
            continue
        ranks = sub.points.rank(method="min")
        for a, t in teams.items():
            if a not in sub.index:
                continue
            x = sub.loc[a]
            t.setdefault("vsPos", {})[pos] = {
                "pts": r1(x.points), "reb": r1(x.rebounds), "ast": r1(x.assists),
                "threes": r1(x.three_point_field_goals_made), "rank": int(ranks.loc[a]),
            }


# ---------------------------------------------------------------- schedule

def espn_lines(day):
    """The current spread and total for each game on an ESPN scoreboard date, by ESPN game id."""
    try:
        url = ESPN_SCOREBOARD.format(d=day.strftime("%Y%m%d"))
        req = urllib.request.Request(url, headers={"User-Agent": "nba-matchup-dashboard"})
        with urllib.request.urlopen(req, timeout=15) as r:
            js = json.load(r)
    except Exception as e:  # not reachable from every machine; the browser fetches it anyway
        return None
    out = {}
    for ev in js.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        odds = (comp.get("odds") or [None])[0]
        if not odds:
            continue
        out[str(ev.get("id"))] = {"details": (odds.get("details") or "").strip(), "total": odds.get("overUnder")}
    return out


def home_spread(details, away, home):
    """ESPN's 'BOS -6.5' as points the home team gives (+ = home favored)."""
    if not details:
        return None
    if details.lower().startswith(("even", "pk", "pick")):
        return 0.0
    parts = details.rsplit(" ", 1)
    if len(parts) != 2:
        return None
    try:
        pts = abs(float(parts[1]))
    except ValueError:
        return None
    ab = parts[0].strip().upper()
    if ab == home.upper():
        return pts
    if ab == away.upper():
        return -pts
    return None


def rest_days(team_dates, abbr, day):
    """Days off before `day` (0 = second night of a back-to-back) and games in the 6 days before it."""
    prev = [d for d in team_dates.get(abbr, []) if d < day]
    if not prev:
        return None, 0
    last = max(prev)
    return (day - last).days - 1, sum(1 for d in prev if (day - d).days <= 6)


def build_schedule(sched, teams, today, published):
    s = sched[sched.season_type == 2].copy()
    s["et"] = pd.to_datetime(s.date, utc=True).dt.tz_convert(ET)
    s["day"] = s.et.dt.date
    s = s[(s.home_abbreviation != "TBD") & (s.away_abbreviation != "TBD")]
    team_dates = {}
    for x in s.itertuples():
        for a in (x.home_abbreviation, x.away_abbreviation):
            team_dates.setdefault(a, []).append(x.day)

    # the slate: today if it has a game still to play, else the next day with games
    future = s[(s.day >= today)]
    pending = future[~future.status_type_completed.astype(bool)]
    slate_day = pending.day.min() if not pending.empty else (future.day.min() if not future.empty else s.day.max())
    first = slate_day - timedelta(days=SLATE_DAYS_BACK)
    last = slate_day + timedelta(days=SLATE_DAYS_AHEAD)
    window = s[(s.day >= first) & (s.day <= last)].sort_values(["et", "game_id"])

    old = {}
    if published and published.get("season") == int(s.season.iloc[0]):
        for gm in published.get("games", []):
            old[gm["id"]] = gm
    lines = espn_lines(slate_day) or {}

    games = []
    for x in window.itertuples():
        gid = str(x.game_id)
        away, home = x.away_abbreviation, x.home_abbreviation
        done = bool(x.status_type_completed)
        ar, ag7 = rest_days(team_dates, away, x.day)
        hr, hg7 = rest_days(team_dates, home, x.day)
        gm = {
            "id": gid,
            "date": x.day.isoformat(),
            "start": pd.Timestamp(x.date).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ") if pd.notna(x.date) else None,
            "timeValid": bool(x.time_valid),
            "away": away, "home": home,
            "awayName": x.away_display_name, "homeName": x.home_display_name,
            "arena": x.venue_full_name, "city": ", ".join(v for v in [x.venue_address_city, x.venue_address_state] if isinstance(v, str) and v),
            "neutral": bool(x.neutral_site),
            "tv": x.broadcast_name if isinstance(x.broadcast_name, str) else "",
            "note": x.notes_headline if isinstance(x.notes_headline, str) and x.notes_headline.strip() else "",
            "awayRest": ar, "homeRest": hr, "awayG7": ag7, "homeG7": hg7,
            "altitude": ALTITUDE.get(home) if not x.neutral_site else None,
        }
        if done:
            gm["awayScore"] = int(x.away_score) if pd.notna(x.away_score) else None
            gm["homeScore"] = int(x.home_score) if pd.notna(x.home_score) else None
        ln = lines.get(gid)
        if ln:
            gm["spread"] = home_spread(ln["details"], away, home)
            gm["total"] = ln["total"]
        prev = old.get(gid)
        if prev and prev.get("lineOpen"):
            gm["lineOpen"] = prev["lineOpen"]
        elif gm.get("spread") is not None or gm.get("total") is not None:
            gm["lineOpen"] = {"spread": gm.get("spread"), "total": gm.get("total"), "at": datetime.now(ET).strftime("%Y-%m-%d %H:%M")}
        games.append(gm)
    return slate_day, games


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int)
    ap.add_argument("--out", default="data/data.json")
    ap.add_argument("--src", default=None, help="folder for the downloaded parquet files")
    ap.add_argument("--today", default=None, help="the date to build for, YYYY-MM-DD (default: today in New York)")
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else datetime.now(ET).date()
    season = args.season or season_for(today)
    src = Path(args.src or (Path(__file__).resolve().parent.parent / ".cache"))
    src.mkdir(parents=True, exist_ok=True)

    sched = fetch_parquet("schedule", season, src)
    tb = fetch_parquet("team_box", season, src)
    pb = fetch_parquet("player_box", season, src)

    g = team_games(tb, pb)
    if g.empty:
        sys.exit(f"no finished regular-season games in the {season} data yet")
    teams, league = summarize_teams(g, sched)
    logs = summarize_players(pb, g, teams)
    defense_vs_position(pb, teams)

    out = Path(args.out)
    published = None
    if out.exists():
        try:
            published = json.loads(out.read_text())
        except Exception:
            published = None
    slate_day, games = build_schedule(sched, teams, today, published)

    through = g.date.max().strftime("%Y-%m-%d")
    data = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "seasonLabel": f"{season - 1}-{str(season)[2:]}",
        "throughDate": through,
        "gamesCounted": int(len(g) // 2),
        "slateDate": slate_day.isoformat(),
        "games": games,
        "teams": teams,
        "gameLogs": logs,
        "league": league,
        "divisions": DIVISIONS,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    n_slate = sum(1 for x in games if x["date"] == slate_day.isoformat())
    with_line = sum(1 for x in games if x["date"] == slate_day.isoformat() and x.get("spread") is not None)
    note(f"{len(teams)} teams, {data['gamesCounted']} games through {through}; slate {slate_day} has {n_slate} games, "
         f"{with_line} with an ESPN line")
    if with_line == 0:
        note("no ESPN lines in the build (the page fetches them in the browser)")


if __name__ == "__main__":
    main()
