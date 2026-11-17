// Shared helpers for every page: data loading, the date strip, lines and live scores from ESPN,
// the game header, Head to Head and the team card. Built on the NFL and CFB dashboards' design.
let DATA = null;
let VIEW_DATE = null;     // the day the board is showing (YYYY-MM-DD)

const MINUS = "−";
function dispNum(v) { return String(v).replace("-", MINUS); }
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function sgn(v, d = 1) { return v == null ? "—" : (v > 0 ? "+" : "") + dispNum(Number(v).toFixed(d)); }

async function loadData() {
  const res = await fetch("data/data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  DATA = await res.json();
  DATA.teamList = Object.values(DATA.teams).sort((a, b) => a.team.localeCompare(b.team));
  const want = new URLSearchParams(location.search).get("date");
  VIEW_DATE = want && daysOnStrip().includes(want) ? want : DATA.slateDate;
  try { initDateNav(); } catch (e) { /* the strip is optional */ }
  try { initPlayerPanel(); } catch (e) { /* so are the game logs */ }
  return DATA;
}

function loadError(target) {
  target.innerHTML = `<div class="empty-note">Couldn't load the stats. Try refreshing in a minute.</div>`;
}

/* ---------------- dates ---------------- */

function daysOnStrip() {
  return [...new Set((DATA.games || []).map(g => g.date))].sort();
}
function dayMode(d) {
  d = d || VIEW_DATE;
  return d === DATA.slateDate ? "current" : d < DATA.slateDate ? "past" : "upcoming";
}
function dayHref(d) { return d === DATA.slateDate ? "index.html" : `index.html?date=${d}`; }
function fmtDay(d, opts) {
  return new Date(d + "T12:00:00").toLocaleDateString(undefined, opts || { weekday: "long", month: "short", day: "numeric" });
}

// The date strip in the top bar: a few finished days, the slate, and the week ahead.
function initDateNav() {
  const nav = document.querySelector(".topbar .topnav");
  if (!nav || nav.querySelector(".weeknav")) return;
  const page = document.body.dataset.page;
  const el = document.createElement("div");
  el.className = "weeknav no-print";
  el.setAttribute("role", "navigation");
  el.setAttribute("aria-label", "Days");
  el.innerHTML = `<span class="wk-label">Day</span>` + daysOnStrip().map(d => {
    const state = d === DATA.slateDate ? "now" : d < DATA.slateDate ? "past" : "next";
    const n = DATA.games.filter(g => g.date === d).length;
    const sel = page === "week" && d === VIEW_DATE;
    return `<a href="${dayHref(d)}" class="wk ${state}${sel ? " sel" : ""}"${sel ? ' aria-current="page"' : ""} title="${escapeHtml(`${fmtDay(d)}: ${n} game${n === 1 ? "" : "s"}`)}">${escapeHtml(fmtDay(d, { month: "numeric", day: "numeric" }))}</a>`;
  }).join("");
  const tools = document.createElement("div");
  tools.className = "navtools";
  tools.appendChild(el);
  nav.appendChild(tools);
  if (page === "week" && VIEW_DATE !== DATA.slateDate) nav.querySelectorAll(":scope > a.active").forEach(a => a.classList.remove("active"));
  const focus = el.querySelector(".sel") || el.querySelector(".now");
  if (focus) el.scrollLeft = focus.offsetLeft - (el.clientWidth - focus.offsetWidth) / 2;
}

/* ---------------- games and lines ---------------- */

const LIVE = {};    // { [id]: { state, detail, away: {score}, home: {score} } }, from live.js
const LINES = {};   // { [id]: { details: "BOS -6.5", total: 221.5 } }, from live.js
function liveFor(g) { return LIVE[g.id] || null; }
function team(abbr) { return DATA.teams[abbr] || null; }
function gamesOn(d) { return (DATA.games || []).filter(g => g.date === d); }
function findGame(id) { return (DATA.games || []).find(g => g.id === id) || null; }
function gameStart(g) { return g.start ? new Date(g.start) : new Date(g.date + "T19:00:00"); }
function isFinal(g) { return g.awayScore != null && g.homeScore != null; }
function fmtRecord(t) { return `${t.record.w}-${t.record.l}`; }

// Current line: ESPN's in the browser (live.js) when it names one of the teams, else the build's.
// spread = points the favorite gives; fav = "away" | "home".
function lineFor(g) {
  let fav = null, spread = null, pick = false;
  const cur = LINES[g.id];
  if (cur && cur.details) {
    if (/^(even|pk|pick)/i.test(cur.details)) pick = true;
    else {
      const m = cur.details.match(/^(.+?)\s+-(\d+(?:\.\d+)?)$/);
      if (m) {
        const ab = m[1].trim().toUpperCase();
        if (ab === g.away.toUpperCase()) fav = "away";
        else if (ab === g.home.toUpperCase()) fav = "home";
        if (fav) spread = parseFloat(m[2]);
      }
    }
  }
  if (!pick && !fav && g.spread != null) {
    if (g.spread === 0) pick = true;
    else { fav = g.spread > 0 ? "home" : "away"; spread = Math.abs(g.spread); }
  }
  const total = cur && cur.total != null ? cur.total : (g.total != null ? g.total : null);
  if (!pick && !fav && total == null) return null;
  return { fav, spread, pick, total };
}
function spreadText(g) {
  const ln = lineFor(g);
  if (!ln) return "";
  return ln.pick ? "Pick'em" : ln.fav ? `${g[ln.fav]} ${MINUS}${ln.spread}` : "";
}
function heroTotalText(g) {
  const ln = lineFor(g);
  return ln && ln.total != null ? `Total ${ln.total}` : "";
}
function impliedTotals(g) {
  const ln = lineFor(g);
  if (!ln || ln.total == null) return null;
  const half = ln.pick || !ln.fav ? 0 : ln.spread / 2;
  const fav = ln.total / 2 + half, dog = ln.total / 2 - half;
  return { away: +(ln.fav === "home" ? dog : fav).toFixed(1), home: +(ln.fav === "home" ? fav : dog).toFixed(1) };
}
function impliedText(g) {
  const it = impliedTotals(g);
  return it ? `Implied ${g.away} ${it.away}, ${g.home} ${it.home}` : "";
}
function spreadLabel(g, homeSpread) {
  if (homeSpread == null) return null;
  if (homeSpread === 0) return "PK";
  return homeSpread > 0 ? `${g.home} ${MINUS}${homeSpread}` : `${g.away} ${MINUS}${-homeSpread}`;
}
// What the line opened at (the first build of the day that had one), when it has moved since.
function lineMove(g) {
  const o = g.lineOpen, ln = lineFor(g);
  if (!o || !ln || isFinal(g)) return null;
  const cur = ln.pick ? 0 : ln.fav === "home" ? ln.spread : ln.fav === "away" ? -ln.spread : null;
  return {
    spread: cur != null && o.spread != null && Math.abs(cur - o.spread) >= 0.5 ? spreadLabel(g, o.spread) : null,
    total: ln.total != null && o.total != null && Math.abs(ln.total - o.total) >= 0.5 ? o.total : null,
  };
}
function lineMoveText(g) {
  const m = lineMove(g);
  if (!m) return "";
  const bits = [m.spread ? `spread opened ${m.spread}` : null, m.total != null ? `total opened ${m.total}` : null].filter(Boolean);
  return bits.length ? `Since this morning: ${bits.join(", ")}` : "No line move today";
}

// Rest going into the game: "2nd night of a back-to-back", "1 day off", "3 days off".
function restText(days) {
  if (days == null) return "season opener";
  if (days === 0) return "back-to-back";
  return `${days} day${days === 1 ? "" : "s"} off`;
}
function restTag(g, side) {
  const d = g[side + "Rest"];
  if (d === 0) return `<span class="rest-tag b2b" title="Played yesterday">B2B</span>`;
  if (d != null && d >= 3) return `<span class="rest-tag rested" title="${d} days off">${d}d rest</span>`;
  return "";
}
// The rest spot in one line, for the game header and the board.
function restLine(g) {
  const bits = [`${g.away} ${restText(g.awayRest)}`, `${g.home} ${restText(g.homeRest)}`];
  const edge = g.awayRest != null && g.homeRest != null && g.awayRest !== g.homeRest
    ? `, ${g.awayRest > g.homeRest ? g.away : g.home} better rested` : "";
  return `Rest: ${bits.join(", ")}${edge}`;
}

/* ---------------- ranks ---------------- */

function leagueRank(getter, value, higherIsBetter) {
  const all = DATA.teamList.map(getter).filter(v => typeof v === "number");
  return 1 + all.filter(v => (higherIsBetter ? v > value : v < value)).length;
}
const EDGE_SD = 1.0;
function zScore(getter, value, higherIsBetter) {
  const all = DATA.teamList.map(getter).filter(v => typeof v === "number");
  const m = all.reduce((a, b) => a + b, 0) / all.length;
  const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, all.length - 1)) || 1;
  return (higherIsBetter ? 1 : -1) * (value - m) / sd;
}
function fmtRank(r) { return r == null ? "—" : "#" + r; }

/* ---------------- one game: header, Head to Head, team cards ---------------- */

function renderMatchupParts(g) {
  const away = team(g.away), home = team(g.home);
  const edges = `
    <h3 class="section-title">Head to head</h3>
    <div class="edge-grid">
      ${edgePanel(away, home)}
      ${edgePanel(home, away)}
    </div>
    ${pacePanel(g, away, home)}
    <p class="edge-key">Longer bar, better rank. Ranks are out of 30. The edge goes to the side with the better rank; the bar turns team color when that side is also at least one league standard deviation better. Adj. ratings are points per 100 possessions adjusted for the opponents each team has faced and for home court; the other rows are raw season numbers. The Four Factors: eFG% counts a three as 1.5 makes; TOV% is turnovers per 100 possessions; offensive rebounding faces the defense's defensive rebound rate; FT rate is free throw attempts per 100 shots. For a defense, lower is better on every row except forced turnovers and defensive rebounds.</p>`;
  const cards = `<h3 class="section-title">Full team stats</h3>` + renderTeamCard(away, g) + renderTeamCard(home, g);
  return { head: renderHero(g, away, home), edges, cards };
}

function renderHero(g, away, home) {
  const final = isFinal(g);
  const d = gameStart(g);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = final ? "Final" : !g.timeValid ? "Time TBD" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const facts = [`${day}, ${time}`, [g.arena, g.city].filter(Boolean).join(", "), g.tv ? `TV: ${g.tv}` : null]
    .filter(Boolean).map(f => `<span>${escapeHtml(f)}</span>`);
  if (g.neutral) facts.push(`<span>Neutral site</span>`);
  if (g.note) facts.push(`<span>${escapeHtml(g.note)}</span>`);
  if (g.altitude) facts.push(`<span>Altitude ${g.altitude.toLocaleString()} ft</span>`);
  const line = spreadText(g), total = heroTotalText(g), imp = impliedText(g), move = lineMoveText(g);
  return `
  <div class="mh-week">${escapeHtml(fmtDay(g.date))}</div>
  <div class="game-hero">
    ${heroTeam(away, g.neutral ? "Team 1" : "Away", final ? g.awayScore : null, final ? g.homeScore : null, "away")}
    <div class="hero-mid">
      <div class="hero-live" id="heroLive" hidden></div>
      <div class="hero-line" id="heroLine"${line ? "" : " hidden"}>${escapeHtml(line)}</div>
      <div class="hero-total" id="heroTotal"${total ? "" : " hidden"}>${escapeHtml(total)}</div>
      <div class="hero-info hero-implied" id="heroImplied"${imp ? "" : " hidden"}>${escapeHtml(imp)}</div>
      <div class="hero-info hero-move" id="heroMove"${move ? "" : " hidden"}>${escapeHtml(move)}</div>
    </div>
    ${heroTeam(home, g.neutral ? "Team 2" : "Home", final ? g.homeScore : null, final ? g.awayScore : null, "home")}
  </div>
  <div class="hero-facts">${facts.join("")}</div>
  <div class="hero-ref">${escapeHtml(restLine(g))}${g.awayG7 != null ? `. Games in the last 7 days: ${g.away} ${g.awayG7}, ${g.home} ${g.homeG7}` : ""}</div>`;
}

function refreshHero(g) {
  for (const [id, fn] of [["heroLine", spreadText], ["heroTotal", heroTotalText], ["heroImplied", impliedText], ["heroMove", lineMoveText]]) {
    const el = document.getElementById(id);
    if (el) { const t = fn(g); el.textContent = t || ""; el.hidden = !t; }
  }
}

function heroTeam(t, side, score, otherScore, sideKey) {
  const rec = `${fmtRecord(t)}, net ${sgn(t.adjNet)} adj.`;
  const lost = score !== null && otherScore !== null && score < otherScore;
  return `
    <div class="hero-team" data-side="${sideKey}" style="${teamVars(t.abbr)}">
      <div class="hero-side">${side}</div>
      <div class="hero-name">${escapeHtml(t.team)}</div>
      <div class="hero-score${lost ? " lost" : ""}"${score === null ? " hidden" : ""}>${score === null ? "" : score}</div>
      <div class="hero-rec">${escapeHtml(rec)}</div>
    </div>`;
}

const f1 = v => v.toFixed(1);
// label, offense getter, defense getter, offense higher-better, defense higher-better, format
const EDGE_ROWS = [
  ["Adj. rating / 100", t => t.offense.adjOrtg, t => t.defense.adjDrtg, true, false, f1],
  ["Points / G", t => t.offense.ppg, t => t.defense.papg, true, false, f1],
  ["Rating / 100", t => t.offense.ortg, t => t.defense.drtg, true, false, f1],
  "Four Factors",
  ["eFG %", t => t.offense.efg, t => t.defense.efg, true, false, f1],
  ["Turnover %", t => t.offense.tovPct, t => t.defense.tovPct, false, true, f1],
  ["Off. reb % / Def. reb %", t => t.offense.orbPct, t => t.defense.drbPct, true, true, f1],
  ["FT rate", t => t.offense.ftr, t => t.defense.ftr, true, false, f1],
  "Shooting",
  ["3PA rate", t => t.offense.threeRate, t => t.defense.threeRate, true, false, f1],
  ["3P %", t => t.offense.threePct, t => t.defense.threePct, true, false, f1],
  ["Threes / G", t => t.offense.threesG, t => t.defense.threesG, true, false, f1],
  ["Paint pts / G", t => t.offense.paintG, t => t.defense.paintG, true, false, f1],
];

function edgePanel(offTeam, defTeam) {
  const n = DATA.teamList.length;
  const ov = teamVars(offTeam.abbr), dv = teamVars(defTeam.abbr);
  const oa = escapeHtml(offTeam.abbr), da = escapeHtml(defTeam.abbr);
  const rows = EDGE_ROWS.map(row => {
    if (typeof row === "string") return `<div class="tape-group">${escapeHtml(row)}</div>`;
    const [label, offGet, defGet, offHi, defHi, fmt] = row;
    const o = offGet(offTeam), d = defGet(defTeam);
    if (o == null || d == null) return "";
    const show = v => dispNum(fmt ? fmt(v) : v);
    const or = leagueRank(offGet, o, offHi), dr = leagueRank(defGet, d, defHi);
    const gap = zScore(offGet, o, offHi) - zScore(defGet, d, defHi);
    const side = or < dr ? "off" : dr < or ? "def" : "";
    const big = gap >= EDGE_SD ? "off" : gap <= -EDGE_SD ? "def" : "";
    const w = r => Math.round(((n + 1 - r) / n) * 100);
    const edge = side === "off" ? `<b class="tc" style="${ov}">${oa}</b>`
      : side === "def" ? `<b class="tc" style="${dv}">${da}</b>` : `<span class="even">Even</span>`;
    return `<div class="tape">
      <span class="lbl">${label}</span>
      <span class="num"><b>${show(o)}</b> <span class="rk">#${or}</span></span>
      <span class="tl"><i class="tb${side === "off" && big === "off" ? " on" : ""}" style="width:${w(or)}%;${ov}"></i></span>
      <span class="tr"><i class="tb${side === "def" && big === "def" ? " on" : ""}" style="width:${w(dr)}%;${dv}"></i></span>
      <span><b>${show(d)}</b> <span class="rk">#${dr}</span></span>
      <span class="num edge">${edge}</span>
    </div>`;
  }).join("");
  return `
  <div class="edge-panel">
    <h4><span class="tc" style="${ov}">${oa} offense</span> against <span class="tc" style="${dv}">${da} defense</span></h4>
    <div class="tape tape-h"><span></span><span class="num">${oa} offense</span><span></span><span></span><span>${da} defense</span><span class="num">Edge</span></div>
    ${rows}
  </div>`;
}

// Pace and the schedule spot for both teams: possessions per 48, net rating, rest, recent form.
function pacePanel(g, a, h) {
  const both = (a.pace + h.pace) / 2;
  const rk = (get, v, hi) => `<span class="rk">#${leagueRank(get, v, hi)}</span>`;
  const row = (t, side) => `<tr>
      <td><span class="pace-team">${slabHtml(t.abbr, t.abbr)} ${escapeHtml(t.team)}</span></td>
      <td class="num"><b>${t.pace.toFixed(1)}</b> ${rk(x => x.pace, t.pace, true)}</td>
      <td class="num"><b>${sgn(t.adjNet)}</b> ${rk(x => x.adjNet, t.adjNet, true)}</td>
      <td class="num">${escapeHtml(t.record.home)} / ${escapeHtml(t.record.road)}</td>
      <td class="num">${escapeHtml(t.record.last10)}${t.record.streak ? `, ${escapeHtml(t.record.streak)}` : ""}</td>
      <td class="num">${escapeHtml(restText(g[side + "Rest"]))}</td>
    </tr>`;
  return `<div class="pace-panel">
    <div class="pace-head">
      <h4>Pace, form and rest</h4>
      <span class="pace-sum">Both teams average <b>${both.toFixed(1)} possessions per 48</b> (league ${DATA.league.pace})</span>
    </div>
    <div class="pace-scroll"><table>
      <thead><tr><th>Team</th><th class="num">Pace</th><th class="num">Adj. net / 100</th><th class="num">Home / road</th><th class="num">Last 10</th><th class="num">Rest</th></tr></thead>
      <tbody>${row(a, "away")}${row(h, "home")}</tbody>
    </table></div>
    <p class="bet-note">Pace is possessions per 48 minutes, both teams' average in each game. Adj. net is the adjusted offensive rating minus the adjusted defensive rating. League home court so far: ${dispNum(DATA.league.homeCourt)} points.</p>
  </div>`;
}

function badge(label, value, title) {
  const cls = value > 0 ? "pos" : value < 0 ? "neg" : "";
  return `<div class="badge"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="label">${label}</span><span class="value ${cls}">${dispNum(value)}</span></div>`;
}
function miniStat(label, value, avg) {
  return `<div class="mini-stat"><div class="val">${value}</div><div class="lbl">${label}</div>${avg != null ? `<div class="avg">avg ${avg}</div>` : ""}</div>`;
}
function leagueAvg(get) {
  const v = DATA.teamList.map(get).filter(x => typeof x === "number");
  return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1);
}
function range(get) {
  const v = DATA.teamList.map(get);
  const lo = Math.min(...v), hi = Math.max(...v), pad = (hi - lo) * 0.1 || 1;
  return { min: lo - pad, max: hi + pad };
}

function renderTeamCard(t, g) {
  if (!t) return "";
  const o = t.offense, d = t.defense;
  const R = (get, v, hi) => leagueRank(get, v, hi);
  return `
  <div class="team-card" data-team="${escapeHtml(t.abbr)}" style="${teamVars(t.abbr)}">
    <div class="team-card-header">
      <div class="team-name-block">
        ${slabHtml(t.abbr, t.abbr)}
        <h2>${escapeHtml(t.team)}</h2>
        <div class="record"><b>${fmtRecord(t)}</b> <span class="rec-sub">${escapeHtml(t.division)}. Home ${escapeHtml(t.record.home)}, road ${escapeHtml(t.record.road)}, last 10 ${escapeHtml(t.record.last10)}</span></div>
      </div>
      <div class="rating-badges">
        ${badge("SoS", t.record.sos, "Strength of schedule: average opponent rating, in points")}
        ${badge("OSRS", t.record.osrs, "Offensive rating in points, adjusted for opponents")}
        ${badge("DSRS", t.record.dsrs, "Defensive rating in points, adjusted for opponents")}
        ${badge("SRS", t.record.srs, "Simple Rating System: points better than an average team on a neutral floor")}
      </div>
      <button class="print-btn print-btn-single no-print" type="button" onclick="window.print()">Print</button>
    </div>

    <div class="stat-columns">
      <div class="stat-col offense">
        <h3>Offense</h3>
        <div class="gauges">
          ${gaugeBlock("Points/G", o.ppg, range(x => x.offense.ppg), R(x => x.offense.ppg, o.ppg, true))}
          ${gaugeBlock("Adj. rating", o.adjOrtg, range(x => x.offense.adjOrtg), R(x => x.offense.adjOrtg, o.adjOrtg, true))}
        </div>
        <div class="mini-stats">
          ${miniStat("eFG %", o.efg, leagueAvg(x => x.offense.efg))}
          ${miniStat("3P %", o.threePct, leagueAvg(x => x.offense.threePct))}
          ${miniStat("TOV %", o.tovPct, leagueAvg(x => x.offense.tovPct))}
        </div>
      </div>
      <div class="center-col">
        <div class="rank-line"><div class="lbl">Net rating</div><div class="val">${sgn(t.adjNet)} <span>adj.</span> ${fmtRank(R(x => x.adjNet, t.adjNet, true))}</div></div>
        <div class="rank-line"><div class="lbl">Pace</div><div class="val">${t.pace} ${fmtRank(R(x => x.pace, t.pace, true))}</div></div>
        <div class="rank-line"><div class="lbl">Rotation</div><div class="val">${t.rotation} <span>players at 12+ min</span></div></div>
      </div>
      <div class="stat-col defense">
        <h3>Defense</h3>
        <div class="gauges">
          ${gaugeBlock("Allowed/G", d.papg, range(x => x.defense.papg), R(x => x.defense.papg, d.papg, false))}
          ${gaugeBlock("Adj. rating", d.adjDrtg, range(x => x.defense.adjDrtg), R(x => x.defense.adjDrtg, d.adjDrtg, false))}
        </div>
        <div class="mini-stats">
          ${miniStat("Opp eFG %", d.efg, leagueAvg(x => x.defense.efg))}
          ${miniStat("Opp 3P %", d.threePct, leagueAvg(x => x.defense.threePct))}
          ${miniStat("Forced TOV %", d.tovPct, leagueAvg(x => x.defense.tovPct))}
        </div>
      </div>
    </div>

    <div class="tables-row nba-tables">
      ${playerTable(t)}
    </div>

    <div class="defpos-row nba-defpos">
      ${["G", "F", "C"].map(p => defPosBlock(p, t.vsPos && t.vsPos[p])).join("")}
    </div>
    ${recentGames(t)}
  </div>`;
}

const POS_NAME = { G: "guards", F: "forwards", C: "centers" };
function defPosBlock(pos, d) {
  const title = `Defense vs ${POS_NAME[pos]}`;
  if (!d) return `<div class="defpos-block"><h4>${title}</h4><div class="empty-note">No data</div></div>`;
  return `<div class="defpos-block">
    <h4>${title}</h4>
    <div class="defpos-stats">
      <div class="item"><div class="val">${fmtRank(d.rank)}</div><div class="lbl">rank</div></div>
      <div class="item"><div class="val">${d.pts}</div><div class="lbl">pts/G</div></div>
      <div class="item"><div class="val">${d.reb}</div><div class="lbl">reb/G</div></div>
      <div class="item"><div class="val">${d.ast}</div><div class="lbl">ast/G</div></div>
      <div class="item"><div class="val">${d.threes}</div><div class="lbl">3PM/G</div></div>
    </div>
  </div>`;
}

const PLAYER_COLS = [
  ["Player", "player"], ["GP", "gp"], ["Min", "min"], ["Pts", "pts"], ["Reb", "reb"], ["Ast", "ast"],
  ["3PM", "threes"], ["Stl", "stl"], ["Blk", "blk"], ["FG%", "fgPct"], ["3P%", "threePct"], ["PRA", "pra"], ["Last 5 pts", "l5pts"],
];
function playerTable(t) {
  const rows = t.players || [];
  if (!rows.length) return `<div class="table-block"><h4>Players</h4><div class="empty-note">No data</div></div>`;
  const head = PLAYER_COLS.map(([l, k]) => `<th class="${k === "player" ? "" : "num"}">${l}</th>`).join("");
  const body = rows.map(r => `<tr>${PLAYER_COLS.map(([, k]) => {
    if (k === "player") {
      const out = r.lastOut ? ` <span class="inj" title="Out last game: ${escapeHtml(r.lastOut)}">out last game</span>` : "";
      const nm = DATA.gameLogs[r.log]
        ? `<button type="button" class="plink" data-log="${escapeHtml(r.log)}" data-name="${escapeHtml(r.player)}" data-team="${escapeHtml(t.abbr)}">${escapeHtml(r.player)}</button>`
        : escapeHtml(r.player);
      return `<td>${nm} <span class="pt-pos">${escapeHtml(r.pos)}</span>${out}</td>`;
    }
    return `<td class="num">${r[k] == null ? "—" : dispNum(r[k])}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-block">
    <h4>Players <span class="th-note">top ${rows.length} by minutes, per game. Click a name for the game log.</span></h4>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

function recentGames(t) {
  const gs = (t.games || []).slice(-10).reverse();
  if (!gs.length) return "";
  return `<div class="recent">
    <h4>Last ${gs.length} games</h4>
    <div class="recent-list">${gs.map(e => `<span class="rg ${e.res[0] === "W" ? "pos" : "neg"}" title="${escapeHtml(fmtDay(e.date, { month: "short", day: "numeric" }))}">${e.at ? "@" : "vs"} ${escapeHtml(e.opp)} <b>${escapeHtml(e.res)}${e.ot ? " OT" : ""}</b></span>`).join("")}</div>
  </div>`;
}

function gaugeBlock(label, value, rng, rank) {
  return `<div class="gauge-block">
    ${gaugeSvg(value, rng.min, rng.max)}
    <div class="gauge-value">${value}</div>
    <div class="gauge-label">${label}</div>
    <div class="gauge-rank">${fmtRank(rank)} in NBA</div>
  </div>`;
}
function gaugeSvg(value, min, max) {
  const pct = (Math.max(min, Math.min(max, value)) - min) / (max - min || 1);
  const angle = 180 * pct, cx = 60, cy = 58, r = 46;
  const toXY = deg => { const rad = (deg * Math.PI) / 180; return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]; };
  const [sx, sy] = toXY(180), [ex, ey] = toXY(180 - angle);
  const nr = ((180 - angle) * Math.PI) / 180;
  return `<svg viewBox="0 0 120 66" width="120" height="66" aria-hidden="true">
    <path class="g-track" d="M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}" fill="none" stroke-width="8"/>
    <path class="g-arc" d="M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke-width="8"/>
    <line class="g-needle" x1="${cx}" y1="${cy}" x2="${(cx + (r - 6) * Math.cos(nr)).toFixed(2)}" y2="${(cy - (r - 6) * Math.sin(nr)).toFixed(2)}" stroke-width="2"/>
    <circle class="g-hub" cx="${cx}" cy="${cy}" r="3.5"/>
  </svg>`;
}

/* ---------------- player game log panel ---------------- */

function initPlayerPanel() {
  document.addEventListener("click", e => {
    const b = e.target.closest(".plink");
    if (b) { openLog(b.dataset.log, b.dataset.name, b.dataset.team); return; }
    if (e.target.closest(".log-close") || e.target.classList.contains("log-back")) closeLog();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLog(); });
}
function closeLog() { const p = document.getElementById("logPanel"); if (p) p.remove(); }
function openLog(key, name, abbr) {
  closeLog();
  const log = DATA.gameLogs[key] || [];
  const avg = k => log.length ? (log.reduce((s, e) => s + e[k], 0) / log.length).toFixed(1) : "—";
  const el = document.createElement("div");
  el.id = "logPanel";
  el.className = "log-back";
  el.innerHTML = `<div class="log-panel" role="dialog" aria-label="${escapeHtml(name)} game log" style="${teamVars(abbr)}">
    <div class="log-head">${slabHtml(abbr, abbr)}<h3>${escapeHtml(name)}</h3><button type="button" class="log-close" aria-label="Close">×</button></div>
    <p class="log-sub">Last ${log.length} games: ${avg("pts")} pts, ${avg("reb")} reb, ${avg("ast")} ast, ${avg("tpm")} threes, ${avg("min")} min</p>
    <div class="log-scroll"><table>
      <thead><tr><th>Date</th><th>Opp</th><th class="num">Min</th><th class="num">Pts</th><th class="num">Reb</th><th class="num">Ast</th><th class="num">FG</th><th class="num">3PM-A</th><th class="num">Stl</th><th class="num">Blk</th><th class="num">TO</th><th></th></tr></thead>
      <tbody>${log.map(e => `<tr><td>${escapeHtml(fmtDay(e.d, { month: "numeric", day: "numeric" }))}</td><td>${e.at ? "@" : "vs"} ${escapeHtml(e.opp)}</td>
        <td class="num">${e.min}${e.gs ? "" : "<span class=\"rk\"> b</span>"}</td><td class="num"><b>${e.pts}</b></td><td class="num">${e.reb}</td><td class="num">${e.ast}</td>
        <td class="num">${e.fg}</td><td class="num">${e.tpm}-${e.tpa}</td><td class="num">${e.stl}</td><td class="num">${e.blk}</td><td class="num">${e.tov}</td>
        <td class="${e.res === "W" ? "pos" : "neg"}">${e.res}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="bet-note">b = came off the bench.</p>
  </div>`;
  document.body.appendChild(el);
}
