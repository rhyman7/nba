// The board: every game on the day in view, grouped by tip-off time, with live scores and the
// current line from ESPN (live.js). index.html?date=YYYY-MM-DD shows another day on the strip.
const gameList = document.getElementById("gameList");

init();

async function init() {
  try {
    await loadData();
  } catch (err) {
    loadError(gameList);
    return;
  }
  const games = gamesOn(VIEW_DATE);
  const mode = dayMode();
  const title = mode === "current" && VIEW_DATE === todayEt() ? "Tonight's Matchups" : fmtDay(VIEW_DATE);
  document.getElementById("weekTitle").textContent = title;
  if (mode !== "current") document.title = `${fmtDay(VIEW_DATE, { month: "short", day: "numeric" })} · NBA Matchups`;
  if (!games.length) {
    gameList.innerHTML = `<div class="empty-note">No games on ${escapeHtml(fmtDay(VIEW_DATE))}. <a href="index.html">See the current slate</a>.</div>`;
    return;
  }
  const count = `${games.length} game${games.length === 1 ? "" : "s"}`;
  document.getElementById("weekSub").textContent =
    mode === "past" ? `${count}, final scores.`
    : mode === "upcoming" ? `${count} on the schedule. Lines show up as books post them.`
    : `${count}. Team stats through ${fmtDay(DATA.throughDate, { month: "short", day: "numeric" })}. Pick a game for the full matchup.`;

  const confSel = document.getElementById("confFilter");
  confSel.innerHTML = `<option value="">Conferences</option>` + ["East", "West"].map(c =>
    `<option value="${c}">${c}</option>` + Object.keys(DATA.divisions).filter(d => d.startsWith(c))
      .map(d => `<option value="${d}">   ${d.replace(c + " ", "")}</option>`).join("")).join("");
  const rerender = () => renderDay(games);
  [confSel, document.getElementById("teamSearch")].forEach(el => el.addEventListener("input", rerender));
  rerender();
  startLive(VIEW_DATE, rerender);
}

function todayEt() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function filterGames(games) {
  const conf = document.getElementById("confFilter").value;
  const q = document.getElementById("teamSearch").value.trim().toLowerCase();
  return games.filter(g => {
    const sides = [team(g.away), team(g.home)].filter(Boolean);
    if (conf && !sides.some(t => t.division === conf || t.conf === conf)) return false;
    if (q && !sides.some(t => t.team.toLowerCase().includes(q) || t.abbr.toLowerCase() === q)) return false;
    return true;
  });
}

function renderDay(allGames) {
  const games = filterGames(allGames);
  if (!games.length) { gameList.innerHTML = `<div class="empty-note">No games match those filters.</div>`; return; }
  const groups = [];
  const live = games.filter(g => (liveFor(g) || {}).state === "in");
  if (live.length) groups.push({ label: "Live now", live: true, games: live });
  const fmtTime = d => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  games.filter(g => !live.includes(g)).slice().sort((a, b) => gameStart(a) - gameStart(b)).forEach(g => {
    const key = g.timeValid ? fmtTime(gameStart(g)) : "Time TBD";
    let grp = groups[groups.length - 1];
    if (!grp || grp.live || grp.key !== key) groups.push(grp = { key, label: key, games: [] });
    grp.games.push(g);
  });
  gameList.innerHTML = `
    <div class="board-cols" aria-hidden="true"><span>Away</span><span></span><span>Home</span><span>Spread</span><span>Total</span><span>Implied score</span><span>Where</span></div>`
    + groups.map(grp => `
    <section class="day-group">
      <h2 class="day-label">${grp.live ? '<span class="live-dot"></span>' : ""}${escapeHtml(grp.label)}${grp.games.length > 1 ? ` <span class="day-count">${grp.games.length} games</span>` : ""}</h2>
      ${grp.games.map(gameRow).join("")}
    </section>`).join("");
}

function rowTeam(g, sideKey) {
  const t = team(g[sideKey]);
  const otherKey = sideKey === "away" ? "home" : "away";
  const L = liveFor(g);
  let score = isFinal(g) ? g[sideKey + "Score"] : null, other = isFinal(g) ? g[otherKey + "Score"] : null, done = isFinal(g);
  if (L && (L.state === "in" || L.state === "post") && L[sideKey]) {
    score = L[sideKey].score; other = L[otherKey] ? L[otherKey].score : null; done = L.state === "post";
  }
  const lost = done && score != null && other != null && score < other;
  const sub = !t ? "" : score != null || dayMode() === "past" ? fmtRecord(t)
    : `${fmtRecord(t)}, net ${sgn(t.adjNet)}`;
  const name = t ? t.team : g[sideKey + "Name"] || g[sideKey];
  return `<div class="gr-team ${sideKey}${lost ? " lost" : ""}">
    ${slabHtml(g[sideKey], g[sideKey])}
    <div class="gr-tx"><div class="gr-name">${escapeHtml(name)} ${score == null ? restTag(g, sideKey) : ""}</div><div class="gr-sub">${escapeHtml(sub)}</div></div>
    ${score != null ? `<span class="gr-score">${score}</span>` : ""}
  </div>`;
}

function gameRow(g) {
  const L = liveFor(g);
  const isLive = !!L && L.state === "in";
  const done = isFinal(g) || (!!L && L.state === "post");
  const started = isLive || done;
  const ln = lineFor(g), it = impliedTotals(g), mv = started ? null : lineMove(g);
  const spread = spreadText(g) || "—";
  const total = ln && ln.total != null ? ln.total : "—";
  let status;
  if (isLive) status = `<div class="gr-big"><span class="live-badge">Live</span> ${escapeHtml(L.detail || "")}</div>`;
  else if (done) status = `<div class="gr-big">${escapeHtml((L && L.state === "post" && L.detail) || "Final")}</div>`;
  else status = it ? `<span class="imp-pre">Implied </span>${escapeHtml(g.away)} ${it.away}, ${escapeHtml(g.home)} ${it.home}` : "";
  const bits = [g.city, g.tv, g.note, g.altitude ? "altitude" : null].filter(Boolean);
  const open = dayMode() === "upcoming" && !started ? `<a class="game-row upcoming" href="matchup.html?game=${encodeURIComponent(g.id)}">`
    : `<a class="game-row${isLive ? " live" : ""}${done ? " done" : ""}" href="matchup.html?game=${encodeURIComponent(g.id)}">`;
  return `${open}
    ${rowTeam(g, "away")}
    <div class="gr-at">${g.neutral ? "vs" : "at"}</div>
    ${rowTeam(g, "home")}
    <div class="gr-spread"><div class="gr-big">${escapeHtml(spread)}</div>${mv && mv.spread ? `<div class="gr-sub gr-move">opened ${escapeHtml(mv.spread)}</div>` : ""}</div>
    <div class="gr-total"><div class="gr-big"><span class="ou-pre">O/U </span>${total}</div>${mv && mv.total != null ? `<div class="gr-sub gr-move">opened ${mv.total}</div>` : ""}</div>
    <div class="gr-implied">${status}</div>
    <div class="gr-where"><div>${escapeHtml(g.arena || "")}</div><div class="gr-sub">${escapeHtml(bits.join(". "))}</div></div>
  </a>`;
}
