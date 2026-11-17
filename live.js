// Live scores and the current line, fetched in the viewer's browser from ESPN's public
// scoreboard for the day on the page. The feed is unofficial, so every read is defensive:
// if anything fails, the page stays as it was built from data.json.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const POLL_LIVE_MS = 30 * 1000;

async function espnScoreboard(day) {
  const res = await fetch(`${ESPN_BASE}/scoreboard?dates=${day.replace(/-/g, "")}`, { cache: "no-store" });
  if (!res.ok) throw new Error("ESPN HTTP " + res.status);
  return res.json();
}

const numOr = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

function readEvent(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const type = ((comp.status || ev.status || {}).type) || {};
  const out = { state: type.state || null, detail: type.shortDetail || type.detail || "" };
  (comp.competitors || []).forEach(c => {
    const side = c.homeAway === "home" ? "home" : c.homeAway === "away" ? "away" : null;
    if (side) out[side] = { abbr: (c.team && c.team.abbreviation) || "", score: numOr(c.score) };
  });
  const odds = (comp.odds || [])[0];
  if (odds) {
    const total = typeof odds.overUnder === "number" ? odds.overUnder : parseFloat(odds.overUnder);
    LINES[String(ev.id)] = { details: typeof odds.details === "string" ? odds.details.trim() : "", total: Number.isFinite(total) ? total : null };
  }
  return out;
}

// Fill LIVE and LINES for one day's games and call onUpdate; keep polling while a game is on.
function startLive(day, onUpdate) {
  let timer = null;
  const tick = async () => {
    try {
      const sb = await espnScoreboard(day);
      (sb.events || []).forEach(ev => { LIVE[String(ev.id)] = readEvent(ev); });
      onUpdate();
    } catch (e) { /* leave the page as built */ }
    const anyLive = Object.values(LIVE).some(L => L.state === "in");
    const soon = gamesOn(day).some(g => !isFinal(g) && Math.abs(gameStart(g) - Date.now()) < 20 * 60 * 1000);
    clearTimeout(timer);
    if (anyLive || soon) timer = setTimeout(tick, POLL_LIVE_MS);
  };
  tick();
}
