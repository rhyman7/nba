// Compare any two teams: Head to Head both ways and both team cards.
const team1Select = document.getElementById("team1Select");
const team2Select = document.getElementById("team2Select");
const out = document.getElementById("teamCards");

init();

async function init() {
  try {
    await loadData();
  } catch (err) {
    loadError(out);
    return;
  }
  const opts = DATA.teamList.map(t => `<option value="${t.abbr}">${escapeHtml(t.team)}</option>`).join("");
  team1Select.innerHTML = team2Select.innerHTML = opts;
  const p = new URLSearchParams(location.search);
  const pick = (k, store, fb) => { const v = (p.get(k) || safeGet(store) || "").toUpperCase(); return DATA.teams[v] ? v : fb; };
  team1Select.value = pick("t1", "nba_team1", DATA.teamList[0].abbr);
  team2Select.value = pick("t2", "nba_team2", DATA.teamList[1].abbr);
  [team1Select, team2Select].forEach(s => s.addEventListener("change", render));
  document.getElementById("printBothBtn").addEventListener("click", () => window.print());
  render();
}

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

function render() {
  const a = team(team1Select.value), b = team(team2Select.value);
  safeSet("nba_team1", a.abbr);
  safeSet("nba_team2", b.abbr);
  // a neutral-floor game with no rest information
  const g = { away: a.abbr, home: b.abbr, awayRest: null, homeRest: null };
  out.innerHTML = `<h3 class="section-title">Head to head</h3>
    <div class="edge-grid">${edgePanel(a, b)}${edgePanel(b, a)}</div>`
    + renderTeamCard(a, g) + renderTeamCard(b, g);
}
