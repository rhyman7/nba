// Team colors: TEAM_COLORS[abbr] = [primary, secondary], from ESPN's team list (ESPN abbreviations).
// The primary fills the team's block; the secondary letters it. teamColors() derives readable
// versions of both for the dark page and for print. Same helpers as the NFL and CFB sites.
const TEAM_COLORS = {
  ATL: ["#C8102E", "#FDB927"], BKN: ["#000000", "#FFFFFF"], BOS: ["#008348", "#FFFFFF"], CHA: ["#008CA8", "#1D1060"],
  CHI: ["#CE1141", "#000000"], CLE: ["#860038", "#BC945C"], DAL: ["#0064B1", "#BBC4CA"], DEN: ["#0E2240", "#FEC524"],
  DET: ["#1D428A", "#C8102E"], GS: ["#FDB927", "#1D428A"], HOU: ["#CE0E2D", "#000000"], IND: ["#0C2340", "#FFD520"],
  LAC: ["#12173F", "#C8102E"], LAL: ["#552583", "#FDB927"], MEM: ["#5D76A9", "#12173F"], MIA: ["#98002E", "#000000"],
  MIL: ["#00471B", "#EEE1C6"], MIN: ["#266092", "#79BC43"], NO: ["#0A2240", "#B4975A"], NY: ["#1D428A", "#F58426"],
  OKC: ["#007AC1", "#EF3B24"], ORL: ["#0150B5", "#9CA0A3"], PHI: ["#1D428A", "#E01234"], PHX: ["#29127A", "#E56020"],
  POR: ["#E03A3E", "#000000"], SA: ["#000000", "#C4CED4"], SAC: ["#5A2D81", "#6A7A82"], TOR: ["#D91244", "#000000"],
  UTAH: ["#4E008E", "#79A3DC"], WSH: ["#E31837", "#002B5C"],
};
const TC_FALLBACK = ["#3A3F47", "#F2F1EE"];   // a team the table doesn't know
const TC_PANEL = "#1b1d21", TC_PAPER = "#ffffff", TC_DARK = "#111214";

function tcRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function tcLum(hex) {
  const [r, g, b] = tcRgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function tcContrast(a, b) {
  const x = tcLum(a), y = tcLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tcHsl(hex) {
  const [r, g, b] = tcRgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function tcHex(h, s, l) {
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const rgb = s ? [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)] : [l, l, l];
  return "#" + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
// The same hue, made lighter (dir 1), darker (dir -1) or whichever is closer (dir 0)
// until it reads against bg.
function tcReadable(hex, bg, floor, dir) {
  if (tcContrast(hex, bg) >= floor) return hex;
  const [h, s, l] = tcHsl(hex);
  for (let step = 1; step <= 100; step++) {
    for (const d of dir ? [dir] : [1, -1]) {
      const x = l + (d * step) / 100;
      if (x < 0 || x > 1) continue;
      const c = tcHex(h, s, x);
      if (tcContrast(c, bg) >= floor) return c;
    }
  }
  return tcContrast("#ffffff", bg) >= tcContrast(TC_DARK, bg) ? "#ffffff" : TC_DARK;
}

// The secondary color as lettering on the team's block. It is used exactly as listed
// whenever it can be read there: 3:1 against the block for the big bold lettering (the
// abbreviation, the name and the score), 4.5:1 for the small lines under the name. Grays
// are held to 4.5:1 at any size, because a gray that only just clears 3:1 looks muddy on a color.
// Lettering is never black. A black secondary letters the block in white, and so does a
// secondary darker than the block that can't be read on it (it is never darkened further).
// A lighter secondary that falls short moves lighter in the same hue, so gold stays gold;
// if that would wash it out, or no lighter shade reads, the lettering is white.
function tcLetter(sec, bg, big) {
  if (!sec) return "#ffffff";
  const [h, s, l] = tcHsl(sec), rgb = tcRgb(sec);
  const neutral = Math.max(...rgb) - Math.min(...rgb) < 0.1;   // black, white or gray
  if (neutral && l < 0.3) return "#ffffff";                    // black (or near it)
  const floor = big && (!neutral || l > 0.85) ? 3 : 4.5;
  if (tcContrast(sec, bg) >= floor) return sec;
  if (neutral || tcLum(sec) <= tcLum(bg)) return "#ffffff";
  for (let step = 1; step <= 100; step++) {
    const x = l + step / 100;
    if (x > 1) break;
    const c = tcHex(h, s, x);
    if (tcContrast(c, bg) < floor) continue;
    return l >= 0.25 && l <= 0.8 && x > 0.9 ? "#ffffff" : c;
  }
  return "#ffffff";
}

const TC_CACHE = {};
// bg: the block's fill. on: black or white lettering on it. on2: the secondary color as the
// block's big lettering; on2s: the same for the small lines on the block. ink: the team color
// as text, bars and dials on the dark page. inkp: the same for print.
function teamColors(key) {
  if (TC_CACHE[key]) return TC_CACHE[key];
  const [bg, sec] = TEAM_COLORS[key] || TC_FALLBACK;
  const on = tcContrast("#ffffff", bg) >= tcContrast(TC_DARK, bg) ? "#ffffff" : TC_DARK;
  const on2 = tcLetter(sec, bg, true), on2s = tcLetter(sec, bg, false);
  // a black or gray primary with a colorful secondary: the secondary carries the team on the page
  const base = tcHsl(bg)[1] < 0.15 && sec && tcHsl(sec)[1] > 0.3 ? sec : bg;
  return (TC_CACHE[key] = {
    bg, on, on2, on2s,
    ink: tcReadable(base, TC_PANEL, 4.6, 1),
    inkp: tcReadable(base, TC_PAPER, 4.5, -1),
  });
}
// Inline custom properties for an element that shows one team.
function teamVars(key) {
  const c = teamColors(key);
  return `--tc:${c.bg};--tc-on:${c.on};--tc-on2:${c.on2};--tc-on2s:${c.on2s};--tc-ink:${c.ink};--tc-inkp:${c.inkp}`;
}
// The team's block: its abbreviation, lettered in the secondary color, on its primary color.
function slabHtml(abbr, key) {
  const a = String(abbr || "");
  return `<span class="slab${a.length > 4 ? " long" : ""}" style="${teamVars(key)}">${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
}
