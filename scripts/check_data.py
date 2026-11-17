#!/usr/bin/env python3
"""Sanity checks on data/data.json before it is published. Exits non-zero on a failure."""
import json
import sys

d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "data/data.json"))
fail = []
teams = d["teams"]
if len(teams) != 30:
    fail.append(f"{len(teams)} teams, expected 30")
for a, t in teams.items():
    if not t.get("players"):
        fail.append(f"{a}: no players")
    o, df = t["offense"], t["defense"]
    if not (85 <= o["ppg"] <= 140 and 85 <= df["papg"] <= 140):
        fail.append(f"{a}: points per game out of range ({o['ppg']}, {df['papg']})")
    if not (90 <= o["adjOrtg"] <= 135 and 90 <= df["adjDrtg"] <= 135):
        fail.append(f"{a}: adjusted ratings out of range")
    if not (90 <= t["pace"] <= 112):
        fail.append(f"{a}: pace {t['pace']} out of range")
    for r in t["players"]:
        if r["log"] not in d["gameLogs"]:
            fail.append(f"{a}: {r['player']} has no game log")
wins = sum(t["record"]["w"] for t in teams.values())
losses = sum(t["record"]["l"] for t in teams.values())
if wins != losses or wins != d["gamesCounted"]:
    fail.append(f"wins {wins}, losses {losses}, games {d['gamesCounted']} don't agree")
slate = [g for g in d["games"] if g["date"] == d["slateDate"]]
if not slate:
    fail.append("no games on the slate date")
for g in d["games"]:
    if g["away"] not in teams or g["home"] not in teams:
        fail.append(f"game {g['id']}: unknown team")
if fail:
    print("\n".join("FAIL: " + f for f in fail))
    sys.exit(1)
print(f"ok: 30 teams, {d['gamesCounted']} games through {d['throughDate']}, slate {d['slateDate']} with {len(slate)} games")
