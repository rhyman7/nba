// Ratings: every team's adjusted efficiency, Four Factors and SRS in one sortable table.
const out = document.getElementById("ratingsTable");

const COLS = [
  ["Team", t => t.team, null, "text"],
  ["W-L", t => t.record.w - t.record.l, t => fmtRecord(t)],
  ["Adj. net", t => t.adjNet, t => sgn(t.adjNet)],
  ["Adj. off", t => t.offense.adjOrtg],
  ["Adj. def", t => -t.defense.adjDrtg, t => t.defense.adjDrtg.toFixed(1)],
  ["Net", t => t.net, t => sgn(t.net)],
  ["SRS", t => t.record.srs, t => sgn(t.record.srs)],
  ["SoS", t => t.record.sos, t => sgn(t.record.sos)],
  ["Pace", t => t.pace],
  ["eFG%", t => t.offense.efg],
  ["TOV%", t => -t.offense.tovPct, t => t.offense.tovPct.toFixed(1)],
  ["ORB%", t => t.offense.orbPct],
  ["FT rate", t => t.offense.ftr],
  ["Opp eFG%", t => -t.defense.efg, t => t.defense.efg.toFixed(1)],
  ["Forced TOV%", t => t.defense.tovPct],
  ["DRB%", t => t.defense.drbPct],
  ["Opp FT rate", t => -t.defense.ftr, t => t.defense.ftr.toFixed(1)],
];
let sortCol = 2, sortDir = -1;

init();

async function init() {
  try {
    await loadData();
  } catch (err) {
    loadError(out);
    return;
  }
  document.getElementById("ratingsSub").textContent =
    `${DATA.gamesCounted} games through ${fmtDay(DATA.throughDate, { month: "long", day: "numeric" })}. League average ${DATA.league.ortg} points per 100 possessions, pace ${DATA.league.pace}, home court ${dispNum(DATA.league.homeCourt)} points.`;
  out.addEventListener("click", e => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    const c = +th.dataset.col;
    sortDir = c === sortCol ? -sortDir : (c === 0 ? 1 : -1);
    sortCol = c;
    render();
  });
  render();
}

function render() {
  const [, get] = COLS[sortCol];
  const rows = DATA.teamList.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir;
  });
  out.innerHTML = `<div class="pace-scroll"><table class="ratings-table">
    <thead><tr><th class="num">#</th>${COLS.map(([l, , , type], i) => `<th data-col="${i}" class="${type === "text" ? "" : "num"} sortable${i === sortCol ? " sorted" : ""}" title="Sort">${l}${i === sortCol ? (sortDir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((t, i) => `<tr><td class="num rk">${i + 1}</td>${COLS.map(([, g, fmt, type], k) => k === 0
      ? `<td><span class="pace-team">${slabHtml(t.abbr, t.abbr)} <a href="compare.html?t1=${t.abbr}">${escapeHtml(t.team)}</a></span></td>`
      : `<td class="num">${escapeHtml(fmt ? fmt(t) : Number(g(t)).toFixed(1))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}
