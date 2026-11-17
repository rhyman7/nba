// One game: header (live score and current line), Head to Head, then both full team cards.
const gameHeader = document.getElementById("gameHeader");

init();

async function init() {
  try {
    await loadData();
  } catch (err) {
    loadError(gameHeader);
    return;
  }
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  const id = new URLSearchParams(location.search).get("game");
  const g = id ? findGame(id) : null;
  if (!g || !team(g.away) || !team(g.home)) {
    gameHeader.innerHTML = `<div class="empty-note">That game isn't on the schedule this site covers right now. <a href="index.html">See tonight's matchups</a> or <a href="compare.html">compare any two teams</a>.</div>`;
    return;
  }
  const back = document.querySelector(".back-link");
  back.href = dayHref(g.date);
  back.textContent = g.date === DATA.slateDate ? "All matchups" : `${fmtDay(g.date, { month: "short", day: "numeric" })} games`;
  document.title = `${g.away} ${g.neutral ? "vs" : "@"} ${g.home} · NBA Matchups`;
  const parts = renderMatchupParts(g);
  gameHeader.innerHTML = parts.head;
  document.getElementById("edges").innerHTML = parts.edges;
  document.getElementById("teamCards").innerHTML = parts.cards;

  startLive(g.date, () => {
    refreshHero(g);
    const L = liveFor(g), el = document.getElementById("heroLive");
    if (!el || !L || (L.state !== "in" && L.state !== "post")) return;
    el.hidden = false;
    el.innerHTML = `${L.state === "in" ? '<span class="live-badge">Live</span> ' : ""}${escapeHtml(L.detail || "")}`;
    for (const side of ["away", "home"]) {
      const s = document.querySelector(`.hero-team[data-side="${side}"] .hero-score`);
      if (s && L[side] && L[side].score != null) { s.hidden = false; s.textContent = L[side].score; }
    }
  });
}
