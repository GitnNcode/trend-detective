// Inspector: result cards in the style of a weather app's modules: a
// condition-colored "sky" background (clear = significant, partly cloudy =
// suggestive, overcast = not significant), a large headline number, and
// rounded translucent cards with small icon headers, range capsules and
// gauges. Mostly graphics, few words.
// Written with Claude and reviewed by the team.

import * as E from "../../engine/index.js";
import * as D from "../data.js";
import { varStyle } from "../palettes.js";
import { app, actions, defOf, unitsOf, frameYear, setTime, setPlaying, seasonCode, monthsLabel } from "../main.js";
import { fmtNum, signed, absUnits, nearestCityName, niceStep } from "./workstation.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pTxt = (p) => (!Number.isFinite(p) ? "–" : p < 0.001 ? "<0.001" : p.toFixed(3));
const dispUnits = (id) => E.displayUnits(unitsOf(id));
const code = (id) => varStyle(id).code;

const ICON = {
  trend: '<path d="M2 12l4-4 3 3 5-6"/><path d="M10 5h4v4"/>',
  check: '<circle cx="8" cy="8" r="6"/><path d="M5.3 8.2l1.9 1.9 3.6-4"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.5"/>',
  compass: '<circle cx="8" cy="8" r="6"/><path d="M8 3.6l1.5 4.4L8 12.4 6.5 8z"/>',
  arrows: '<path d="M2 6h11l-2.4-2.4M14 10H3l2.4 2.4"/>',
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  wind: '<path d="M2 6h8a2 2 0 1 0-2-2M2 9.5h10.5a2 2 0 1 1-2 2M2 13h5"/>',
  list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".8"/><circle cx="2.8" cy="8" r=".8"/><circle cx="2.8" cy="12" r=".8"/>',
  pin: '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>',
  ship: '<path d="M2.5 10.5l1.5 3h8l1.5-3zM8 2.5v8M8 4l3.5 4.5H8"/>',
  chart: '<path d="M2.5 13.5h11M4 11l2.5-3.5 2.5 2 3-5"/>',
  table: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M6.5 6.5v6.5"/>',
  seal: '<path d="M8 1.8l1.6 1.2 2-.2.6 1.9 1.7 1.1-.6 1.9.6 1.9-1.7 1.1-.6 1.9-2-.2L8 14.2l-1.6-1.2-2 .2-.6-1.9-1.7-1.1.6-1.9-.6-1.9 1.7-1.1.6-1.9 2 .2z"/><path d="M5.6 8.1l1.6 1.6 3.2-3.4"/>',
};
const icon = (k) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICON[k] ?? ""}</svg>`;
const card = (ic, title, body, { half = false, right = "" } = {}) =>
  `<section class="wcard ${half ? "half" : ""}"><header>${icon(ic)}<span>${esc(title)}</span>${right ? `<em>${right}</em>` : ""}</header>${body}</section>`;

// ---------------------------------------------------------------- skeleton
function skeleton() {
  const el = $("#inspector");
  if ($("#iChart")) return;
  el.innerHTML = `
    <div class="whero" id="iHero"></div>
    <div class="wgrid" id="iA"></div>
    <section class="wcard" id="iChartCard"><header id="iChartHdr"></header><div class="chart-box" id="iChart"></div></section>
    <div class="wgrid" id="iB"></div>
    <div class="wfoot" id="iFoot"></div>`;
}

export function ensureChart() {
  skeleton();
  if (app.chart || !app.C) return;
  app.chart = app.C.createChart($("#iChart"), { height: 150 });
  app.chart.onClick?.((year) => {
    const f = app.frames;
    if (!f) return;
    const k = f.years.findIndex((y) => Math.floor(y) >= year);
    if (k >= 0) { setPlaying(false); setTime(k); }
  });
}

// ---------------------------------------------------------------- graphics
// Range capsule (like a 10-day forecast row): track, colored 95% range, dot at the estimate.
function capsule(lo, hi, est, { span, w = 252, colorLo = "#5ac8fa", colorHi = "#ff9500" } = {}) {
  const m = span ?? Math.max(Math.abs(lo), Math.abs(hi), Math.abs(est), 1e-9) * 1.25;
  const X = (v) => 6 + ((Math.max(-m, Math.min(m, v)) + m) / (2 * m)) * (w - 12);
  const fin = [lo, hi, est].every(Number.isFinite);
  const id = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg class="capsule" viewBox="0 0 ${w} 26" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${colorLo}"/><stop offset="1" stop-color="${colorHi}"/></linearGradient></defs>
    <rect x="6" y="9" width="${w - 12}" height="6" rx="3" fill="#e5e5ea"/>
    ${fin ? `<rect x="${X(lo)}" y="9" width="${Math.max(6, X(hi) - X(lo))}" height="6" rx="3" fill="url(#${id})"/>` : ""}
    <line x1="${X(0)}" y1="4" x2="${X(0)}" y2="20" stroke="#aeaeb2" stroke-width="1"/>
    ${fin ? `<circle cx="${X(est)}" cy="12" r="5" fill="#fff" stroke="rgba(0,0,0,0.28)" stroke-width="1" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.25))"/>` : ""}
    <text x="${X(0)}" y="26" fill="#8e8e93" font-size="8" text-anchor="middle">0</text>
  </svg>`;
}

// Gradient gauge with a marker (like a UV-index or air-quality module).
function gaugeBar(frac, { stops = ["#34c759", "#ffd60a", "#ff9f0a", "#ff453a"], w = 252 } = {}) {
  const id = "u" + Math.random().toString(36).slice(2, 8);
  const x = 6 + Math.max(0, Math.min(1, frac)) * (w - 12);
  return `<svg class="capsule" viewBox="0 0 ${w} 18" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" x2="1">${stops.map((c, k) => `<stop offset="${k / (stops.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient></defs>
    <rect x="6" y="6" width="${w - 12}" height="6" rx="3" fill="url(#${id})"/>
    <circle cx="${x}" cy="9" r="5.5" fill="#fff" stroke="rgba(0,0,0,0.3)" stroke-width="1"/></svg>`;
}

// Compass dial (like a wind module): ring, cardinal letters, arrow, value in the centre.
function dial(bearing, value, unit, { coherent = true } = {}) {
  const ok = Number.isFinite(bearing) && coherent;
  const a = ((bearing ?? 0) - 90) * Math.PI / 180;
  const ticks = Array.from({ length: 36 }, (_, k) => {
    const r = (k * 10 - 90) * Math.PI / 180, long = k % 9 === 0;
    return `<line x1="${60 + Math.cos(r) * (long ? 44 : 47)}" y1="${60 + Math.sin(r) * (long ? 44 : 47)}" x2="${60 + Math.cos(r) * 51}" y2="${60 + Math.sin(r) * 51}" stroke="${long ? "#636366" : "#c7c7cc"}" stroke-width="${long ? 1.4 : 1}"/>`;
  }).join("");
  const tip = [60 + Math.cos(a) * 50, 60 + Math.sin(a) * 50], tail = [60 - Math.cos(a) * 50, 60 - Math.sin(a) * 50];
  return `<svg class="dial" viewBox="0 0 120 120">
    ${ticks}
    <text x="60" y="22" text-anchor="middle" font-size="9" fill="#1c1c1e" font-weight="600">N</text>
    <text x="99" y="63" text-anchor="middle" font-size="9" fill="#8e8e93">E</text>
    <text x="60" y="104" text-anchor="middle" font-size="9" fill="#8e8e93">S</text>
    <text x="21" y="63" text-anchor="middle" font-size="9" fill="#8e8e93">W</text>
    ${ok ? `<line x1="${tail[0]}" y1="${tail[1]}" x2="${tip[0]}" y2="${tip[1]}" stroke="#007aff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M${tip[0]} ${tip[1]} L${tip[0] - Math.cos(a - 0.5) * 11} ${tip[1] - Math.sin(a - 0.5) * 11} L${tip[0] - Math.cos(a + 0.5) * 11} ${tip[1] - Math.sin(a + 0.5) * 11}Z" fill="#007aff"/>
      <circle cx="${tail[0]}" cy="${tail[1]}" r="3" fill="#007aff"/>` : ""}
    <circle cx="60" cy="60" r="23" fill="#f2f2f7"/>
    <text x="60" y="61" text-anchor="middle" font-size="15" fill="#1c1c1e" font-weight="600">${esc(value)}</text>
    <text x="60" y="74" text-anchor="middle" font-size="8.5" fill="#8e8e93">${esc(unit)}</text></svg>`;
}

function stackBar(parts) {
  let x = 6;
  const w = 240;
  return `<svg class="capsule" viewBox="0 0 252 16" preserveAspectRatio="none"><rect x="6" y="5" width="${w}" height="6" rx="3" fill="#e5e5ea"/>
    ${parts.map(([f, c]) => { const r = `<rect x="${x}" y="5" width="${Math.max(0, f * w)}" height="6" fill="${c}"/>`; x += f * w; return r; }).join("")}</svg>`;
}

// ---------------------------------------------------------------- blocks
const statusWord = (level) => (level === "significant" ? "Significant" : level === "suggestive" ? "Suggestive" : "Not significant");
const skyOf = (level) => (level === "significant" ? "clear" : level === "suggestive" ? "partly" : "overcast");

function pCards(pT, pMK, n) {
  const one = (title, p) => card("check", title, `<div class="wbig">${pTxt(p)}</div><div class="wcap">${p < 0.05 ? "below 0.05" : p < 0.1 ? "below 0.10" : "above 0.10"}${title === "Mann–Kendall" ? " · autocorr." : ` · ${n} yr`}</div>`, { half: true });
  return one("t-test", pT) + one("Mann–Kendall", pMK);
}

// ponytail: grid cells are ~200 km, so hide poor matches and anything under a cell, round the rest to 50 km.
export function analogKm(p) {
  if (!p || p.quality === "poor" || !Number.isFinite(p.distKm) || p.distKm < 200) return null;
  return Math.round(p.distKm / 50) * 50;
}

function detectionCard(det) {
  if (!det || !app.A) return "";
  const done = det.status === "detectable";
  const big = done ? (det.etaYear ?? "now") : det.status === "never" ? "—" : `~${det.etaYear}`;
  const word = done ? "Detectable" : det.status === "never" ? "Not this century" : "Not yet";
  const frac = Number.isFinite(det.nStar) ? det.nYears / det.nStar : 0;
  return card("clock", "Detection", `<div class="wrow"><div class="wbig">${big}</div><div class="wword">${word}</div></div>
    ${gaugeBar(Math.min(1, frac), { stops: ["#ff453a", "#ff9f0a", "#ffd60a", "#34c759"] })}
    <div class="wcap">${Number.isFinite(det.nStar) && det.nStar < 999 ? `${Math.round(det.nStar)} years needed to detect a trend this size; the record has ${Math.round(det.nYears)}` : `A trend this size may never be detectable; the record has ${Math.round(det.nYears)} years`}</div>`);
}

// Sea-ice route: the shortest open-water path between the route's ends,
// searched fresh each year rather than along the fixed waypoints.
function bestPathCard(bp) {
  if (!bp) return "";
  const km = (x) => `${Math.round(x).toLocaleString("en-US")} km`;
  const open = bp.years.map((y, k) => k).filter((k) => Number.isFinite(bp.lengthKm[k]));
  const last = open.at(-1);
  if (last == null) return card("ship", "Best open path", `<div class="wbig">none</div><div class="wcap">no open-water path between the route's ends in any year</div>`);
  const L = bp.lengthKm[last], d = L - bp.fixedKm;
  const vs = Math.abs(d) < 0.03 * bp.fixedKm ? "about the same as" : d < 0 ? `${km(-d)} shorter than` : `${km(d)} longer than`;
  const why = d >= 0.03 * bp.fixedKm ? ": the fixed route was blocked, so this is a detour around the ice" : "";
  return card("ship", "Best open path", `<div class="wbig">${km(L)}</div>
    <div class="wcap">shortest open-water path in ${bp.years[last]} (${MONTH_SHORT[bp.bestMonth[last] - 1]}), ${vs} the fixed route (${km(bp.fixedKm)})${why}. Found in ${open.length} of ${bp.years.length} years, first in ${bp.years[open[0]]}. Yellow line on the map; it follows the frame year.</div>`);
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hero(place, big, unit, line1, line2) {
  return `<div class="wplace">${esc(place)}</div>
    <div class="wnum">${big}<span>${esc(unit)}</span></div>
    <div class="wline">${line1}</div>${line2 ? `<div class="wline sub">${line2}</div>` : ""}`;
}

// ---------------------------------------------------------------- render
export function renderInspector() {
  skeleton();
  const s = app.state, R = app.R;
  if (!R.v) return;
  const root = $("#inspector");
  const { factor, label } = dispUnits(s.variable);
  const heroEl = $("#iHero"), A = $("#iA"), B = $("#iB"), ch = $("#iChartHdr"), foot = $("#iFoot");
  const where = R.region.type === "global" ? "Whole Earth" : R.region.name;
  const def = defOf(s.variable);
  let spec = null, level = "none", chartTitle = "", chartRight = "", tip = "";
  A.innerHTML = ""; B.innerHTML = "";

  if (s.mode === "band" && R.bandSummary) {
    const bs = R.bandSummary, km = bs.edgeShiftKmPerDecade;
    level = bs.level;
    tip = bs.sentence;
    const south = R.track?.hemisphere === "S";
    heroEl.innerHTML = hero(where, signed(km, 3), " km/dec", `${statusWord(bs.level)} · ${esc(bs.kind)}`, `Area ${signed(bs.areaPctPerDecade, 2)}% per decade · ${esc(def.name)}`);
    A.innerHTML = card("compass", "Edge", dial(Number.isFinite(km) ? (km >= 0 ? (south ? 180 : 0) : (south ? 0 : 180)) : NaN, signed(km, 3), "km/dec"), { half: true })
      + card("check", "Evidence", `<div class="wbig">${pTxt(bs.edgeP)}</div><div class="wcap">edge p-value</div><div class="wbig sm">${pTxt(bs.areaP)}</div><div class="wcap">area p-value · ${R.track.years.length} yr</div>`, { half: true });
    const kind = s.chartKind === "area" ? "area" : "edge";
    chartTitle = kind === "edge" ? "Edge latitude" : "Zone area";
    chartRight = `<span class="wseg"><button data-ck="edge" class="${kind === "edge" ? "on" : ""}">Edge</button><button data-ck="area" class="${kind === "area" ? "on" : ""}">Area</button></span>`;
    spec = kind === "edge"
      ? { kind: "series", years: R.track.years, values: R.bandSummary.edgeMeanLat, units: "°lat", fit: true, format: (v) => `${fmtNum(Math.abs(v), 3)}°${v >= 0 ? "N" : "S"}`, emptyText: "edge not traceable" }
      : { kind: "series", years: R.track.years, values: R.track.areaKm2.map((a) => a / 1e6), units: "M km²", fit: true, format: (v) => `${fmtNum(v, 3)} M km²` };
    B.innerHTML = detectionCard(R.edgeDetection) + (R.dipole ? dipoleCard(R.dipole, factor, label) : "");
  } else if (s.mode === "route" && R.routeVerdict) {
    const vd = R.routeVerdict, ro = R.routeOpen;
    level = vd.level;
    tip = vd.sentence.replace(/percentage points/g, "months");
    heroEl.innerHTML = hero(R.route.name, signed(vd.perDecade, 2), " months/dec", statusWord(vd.level), `L: ${signed(vd.ci95PerDecade[0], 2)}  H: ${signed(vd.ci95PerDecade[1], 2)}`);
    const first = ro.years.find((y, k) => ro.openMonths[k] > 0);
    A.innerHTML = card("ship", "First open", `<div class="wbig">${first ?? "never"}</div><div class="wcap">first year with an open month</div>`, { half: true })
      + card("chart", "Open months", `<div class="wbig">${fmtNum(avg(ro.openMonths.slice(-10)), 2)}</div><div class="wcap">per year, last 10 years (was ${fmtNum(avg(ro.openMonths.slice(0, 10)), 2)})</div>`, { half: true })
      + pCards(vd.pT, vd.pMK, vd.n) + bestPathCard(R.bestPath);
    chartTitle = "Open months per year"; chartRight = esc(monthsLabel(ro.months));
    spec = { kind: "bars", years: ro.years, values: ro.openMonths, max: ro.months.length, units: "mo", fit: true, color: "#5ac8fa", format: (v) => `${v}/${ro.months.length} mo` };
    B.innerHTML = detectionCard(R.routeDetection);
  } else if ((s.mode === "flow" || s.mode === "vectors") && (R.flowSummary || R.vecSummary)) {
    const fs = s.mode === "vectors" ? R.vecSummary : R.flowSummary;
    level = "significant";
    const kmd = fs?.medianKmPerDecade;
    if (s.mode === "vectors" && R.vecKind === "wind") {
      heroEl.innerHTML = hero(where, fmtNum(fs.meanSpeed, 3), " m/s", "Mean wind at 250 hPa", `${seasonCode(s.months)} average, ${R.vec.uaf.years[0]}–${R.vec.uaf.years.at(-1)}`);
      A.innerHTML = card("wind", "Mean wind", dial(fs.bearingDeg, fmtNum(fs.meanSpeed, 2), "m/s"), { half: true })
        + card("compass", "Direction", `<div class="wbig">${esc(fs.bearingName || "—")}</div><div class="wcap">mean flow over ${esc(where)}</div>`, { half: true });
      chartTitle = "Wind speed, regional mean"; spec = seriesSpec(s, R);
      B.innerHTML = "";
    } else {
      heroEl.innerHTML = hero(where, fmtNum(kmd, 3), " km/dec", s.mode === "vectors" ? `Climate velocity · ${R.vecWindow ?? ""}` : "Climate velocity", `≈ ${fmtNum((kmd * 1000) / 3652.5, 2)} m per day to keep the same ${esc(def.name.toLowerCase())}`);
      A.innerHTML = card("compass", "Heading", dial(fs?.bearingDeg, fmtNum(kmd, 3), "km/dec", { coherent: (fs?.coherence ?? 1) > 0.2 }), { half: true })
        + card("wind", "Speeds", `<div class="wkv"><span>Median</span><b>${fmtNum(kmd, 3)}</b><span>Mean</span><b>${fmtNum(fs?.meanKmPerDecade, 3)}</b>${R.flowLand ? `<span>Land</span><b>${fmtNum(R.flowLand.medianKmPerDecade, 3)}</b>` : ""}</div><div class="wcap">km per decade</div>`, { half: true });
      chartTitle = `${def.name}, regional mean`; spec = seriesSpec(s, R);
      B.innerHTML = detectionCard(R.detection);
    }
  } else if (s.mode === "twin" && R.twin) {
    const tw = R.twin, h = R.home, tn = tw.thenNow, nw = tw.nowWas;
    level = tn.quality === "good" ? "significant" : tn.quality === "fair" ? "suggestive" : "none";
    const near = (p) => nearestCityName(app, p.lat, p.lon, 450);
    const tOk = analogKm(tn) != null, nOk = analogKm(nw) != null;
    heroEl.innerHTML = tOk
      ? hero(h.name ?? "Selected point", analogKm(tn), " km", `1980s climate now lies ${esc(tn.bearingName || "—")}`, near(tn) ? `near ${esc(near(tn))} · ${tn.quality} match` : `${tn.quality} match`)
      : hero(h.name ?? "Selected point", "—", "", "No close match for the 1980s climate", tn.quality === "poor" ? "nearest candidates are poor matches" : "within one grid cell (about 200 km) or not found");
    A.innerHTML = card("pin", "Today's climate", nOk ? `<div class="wbig">${analogKm(nw)} km</div><div class="wcap">${esc(nw.bearingName || "")} in the 1980s${near(nw) ? `, near ${esc(near(nw))}` : ""} · ${nw.quality}</div>` : `<div class="wbig">—</div><div class="wcap">no close match in the 1980s</div>`, { half: true })
      + card("trend", "Warming", `<div class="wbig">${signed(tw.home.drift.dT, 2)}°</div><div class="wcap">mean temperature, 1980s → now</div>`, { half: true });
    chartTitle = "Monthly temperature"; chartRight = `${tw.periods.base.join("–")} vs ${tw.periods.recent.join("–")}`;
    spec = twinSeasonal(R);
    const row = (lab, a, b, u) => `<tr><td>${lab}</td><td>${fmtNum(a, 3)}</td><td>${fmtNum(b, 3)}</td><td>${signed(b - a, 2)}</td></tr>`;
    B.innerHTML = card("table", "Fingerprint", `<table class="wtbl"><tr><th></th><th>1980s</th><th>Now</th><th>Δ</th></tr>
      ${row("Mean °C", tw.home.then.tMean, tw.home.now.tMean)}${row("Range °C", tw.home.then.tRange, tw.home.now.tRange)}${row("Precip mm/d", tw.home.then.pMean, tw.home.now.pMean)}</table>`);
  } else if (s.mode === "lineup" && R.lineup) {
    const vd = R.verdict;
    const sig = R.lineup.filter((x) => !x.empty && x.verdict.level === "significant").length;
    level = sig ? "significant" : "none";
    heroEl.innerHTML = hero(where, String(sig), ` of ${R.lineup.filter((x) => !x.empty).length}`, "fields with a significant trend", `${seasonCode(s.months)} · ${R.lineup[0]?.annual?.years?.[0] ?? ""}–${R.lineup[0]?.annual?.years?.at(-1) ?? ""}`);
    A.innerHTML = card("list", "Ranked by evidence", lineupRows(R.lineup));
    chartTitle = `${def.name}`; spec = seriesSpec(s, R);
    B.innerHTML = "";
    void vd;
  } else if (s.mode === "atlas" && R.atlas) {
    level = "significant";
    heroEl.innerHTML = hero("Whole Earth", String(R.atlas.length), " fields", "Trend in every grid cell", `${seasonCode(s.months)} · 1980–2025`);
    A.innerHTML = card("grid", "Area with a significant trend", atlasRows(R.atlas));
    chartTitle = `${def.name}, global mean`; spec = seriesSpec(s, R);
  } else if (s.mode === "compare" && R.cmp) {
    const a = R.verdict, b = R.cmp.verdict;
    tip = `${R.region.name}: ${a.sentence}\n${R.regionB.name}: ${b.sentence}`;
    const sa = Math.sign(a.perDecade), sb = Math.sign(b.perDecade);
    const opposite = sa !== sb && sa !== 0 && sb !== 0;
    const both = a.level !== "none" && b.level !== "none";
    level = opposite && both ? (a.level === "significant" && b.level === "significant" ? "significant" : "suggestive") : "none";
    heroEl.innerHTML = hero(`${R.region.name} vs ${R.regionB.name}`, opposite ? (both ? "Opposite" : "Opposite?") : "Same way", "", `${esc(def.name)}`, opposite && both ? "One variable, opposite trends in two places" : opposite ? "Opposite signs, but not both clear yet" : "Both change in the same direction");
    const side = (name, vd, color) => card("trend", name, `<div class="wbig" style="color:${color}">${signed(vd.perDecade * factor, 2)}</div><div class="wcap">${esc(label)}/dec · ${statusWord(vd.level).toLowerCase()}</div>`, { half: true });
    A.innerHTML = side(R.region.name, a, "#1c1c1e") + side(R.regionB.name, b, "#007aff")
      + card("chart", "Both regions", dualPlot(R.annual, R.cmp.annual) + `<div class="wcap"><span style="color:#1c1c1e">■</span> ${esc(R.region.name)} &nbsp; <span style="color:#007aff">■</span> ${esc(R.regionB.name)} · yearly anomalies, dashed = trend</div>`);
    spec = null;
    B.innerHTML = "";
  } else if (s.mode === "validate" && R.validation) {
    const V = R.validation;
    level = "significant";
    heroEl.innerHTML = hero("Cross-check", fmtNum(V.t2m.r, 2), "", "MERRA-2 vs NASA GISTEMP, correlation of yearly anomalies", "Independent records agree on the trend");
    A.innerHTML = card("seal", "Global temperature", valRows([["MERRA-2", V.t2m.ours, "°C/dec"], ["GISTEMP v4", V.t2m.ref, "°C/dec"]], V.t2m.r))
      + card("seal", "September sea ice", valRows([["MERRA-2", V.ice.oursPct, "%/dec"], ["NSIDC index", V.ice.refPct, "%/dec"]], V.ice.r));
    chartTitle = "Global temperature anomaly"; chartRight = "vs 1981–2010";
    spec = null;
    B.innerHTML = "";
  } else {
    const vd = R.verdict;
    level = R.empty ? "none" : vd.level;
    tip = R.empty ? "" : vd.sentence;
    if (R.empty) {
      heroEl.innerHTML = hero(where, "—", "", "No data here", `${esc(def.name)} is not defined in this region`);
    } else {
      heroEl.innerHTML = hero(where, signed(vd.perDecade * factor, 3), ` ${label}/dec`, statusWord(vd.level) + ` · ${esc(vd.direction === "rising" ? "rising" : vd.direction === "falling" ? "falling" : "flat")}`, `L: ${signed(vd.ci95PerDecade[0] * factor, 2)}  H: ${signed(vd.ci95PerDecade[1] * factor, 2)}`);
      A.innerHTML = card("trend", "95% range", capsule(vd.ci95PerDecade[0] * factor, vd.ci95PerDecade[1] * factor, vd.perDecade * factor) + `<div class="wcap">${esc(label)} per decade · least-squares fit</div>`) + pCards(vd.pT, vd.pMK, vd.n);
    }
    const kind = ["trend", "stripes", "seasons"].includes(s.chartKind) ? s.chartKind : "trend";
    chartTitle = kind === "trend" ? "Yearly values" : kind === "stripes" ? "Stripes" : "Seasonal cycle";
    chartRight = `<span class="wseg"><button data-ck="trend" class="${kind === "trend" ? "on" : ""}">Series</button><button data-ck="stripes" class="${kind === "stripes" ? "on" : ""}">Stripes</button><button data-ck="seasons" class="${kind === "seasons" ? "on" : ""}">Cycle</button></span>`;
    spec = R.empty ? { kind: "series", years: [], values: [], emptyText: "no data" } : kind === "trend" ? seriesSpec(s, R) : kind === "stripes" ? { kind: "stripes", years: R.annual.years, values: R.annual.values, units: unitsOf(s.variable), palette: varStyle(s.variable).trend === "heat" ? "temp" : varStyle(s.variable).trend === "wet" ? "wet" : "ice" } : seasonalSpec(R);
    B.innerHTML = detectionCard(R.detection) + (s.mode === "map" && R.tmap ? areaCard(R) : "");
  }

  root.dataset.sky = skyOf(level);
  heroEl.title = tip;
  heroEl.setAttribute("aria-description", tip);
  ch.innerHTML = `${icon("chart")}<span>${esc(chartTitle)}</span>${chartRight ? `<em>${chartRight}</em>` : ""}`;
  foot.innerHTML = `<div class="wdef">${icon("pin")}<span><b>${esc(def.name)}.</b> ${esc(def.plain)}</span></div>`;
  ch.querySelectorAll("[data-ck]").forEach((b) => b.addEventListener("click", () => actions.set({ chartKind: b.dataset.ck })));
  A.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => actions.set({ mode: "series", variable: b.dataset.var })));
  $("#iChartCard").hidden = !spec;
  if (app.chart && spec) {
    spec.cursorYear = Math.floor(frameYear(app.t));
    app.chart.update(spec);
  }
}

const avg = (a) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : NaN; };
const meanOf = (a) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : 0; };

function seriesSpec(s, R) {
  const det = R.detection;
  const pending = det && det.status === "pending" && det.etaYear < 2100;
  const au = absUnits(s.variable);
  let monthly = null;
  if (s.showMonthly) {
    const src = s.deseason ? R.ds : R.rs;
    const sel = new Set(s.months);
    const x = [], vals = [];
    src.t.forEach((t, k) => { if (sel.has(Number(t.slice(5, 7)))) { x.push(Number(t.slice(0, 4)) + (Number(t.slice(5, 7)) - 0.5) / 12); vals.push(src.values[k]); } });
    const off = s.deseason ? meanOf(Array.from(R.annual.values)) - meanOf(vals) : 0;
    monthly = { x, values: vals.map((v) => v + off) };
  }
  return { kind: "series", years: R.annual.years, values: R.annual.values, monthly, units: unitsOf(s.variable), fit: true, format: (v) => `${fmtNum(v * au.factor, 3)} ${au.label}`, extendTo: pending ? Math.max(det.etaYear + 2, R.annual.years.at(-1) + 5) : undefined, markers: pending ? [{ year: det.etaYear, label: `~${det.etaYear}` }] : [] };
}

function seasonalSpec(R) {
  if (!app.A) return null;
  const sc = app.A.seasonalCycle(R.v, R.region);
  return { kind: "seasonal", months: sc.months, early: sc.early, late: sc.late, earlyLabel: (sc.periods?.base ?? [1980, 1989]).join("–"), lateLabel: (sc.periods?.recent ?? [2016, 2025]).join("–"), units: unitsOf(app.state.variable) };
}

function twinSeasonal(R) {
  const t2m = D.cachedVar("t2m");
  if (!t2m || !app.A) return null;
  const h = R.home;
  const sc = app.A.seasonalCycle(t2m, { latMin: h.lat - 1, latMax: h.lat + 1, lonMin: h.lon - 1.25, lonMax: h.lon + 1.25 });
  return { kind: "seasonal", months: sc.months, early: sc.early, late: sc.late, earlyLabel: (sc.periods?.base ?? [1980, 1989]).join("–"), lateLabel: (sc.periods?.recent ?? [2016, 2025]).join("–"), units: "°C" };
}

function dipoleCard(dp, factor, label) {
  const st = dp.stats;
  const a = st.arrived.meanPerDecade * factor, l = st.left.meanPerDecade * factor;
  const m = Math.max(Math.abs(a) || 0, Math.abs(l) || 0, 1e-9) * 1.2;
  const row = (name, v, area, color) => `<div class="wlrow"><span>${name}</span>${area > 0 && Number.isFinite(v) ? capsule(Math.min(0, v), Math.max(0, v), v, { span: m, w: 150, colorLo: color, colorHi: color }) : `<span class="wcap">none</span>`}<b>${area > 0 && Number.isFinite(v) ? signed(v, 2) : ""}</b></div>`;
  return card("arrows", "Where it arrived and left", row("Arrived", a, st.arrived.areaKm2, "#ff3b30") + row("Left", l, st.left.areaKm2, "#5ac8fa") + `<div class="wcap">${esc(label)} per decade, ${dp.early.join("–")} → ${dp.late.join("–")}</div>`);
}

function census(tm, grid, region) {
  const { cells, rows } = E.regionCells(grid, region);
  const areas = E.rowAreasKm2(grid);
  let up = 0, down = 0, flat = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], w = areas[rows[k]], sl = tm.slope[c], p = tm.p[c];
    if (!Number.isFinite(sl)) continue;
    if (p < 0.05) (sl > 0 ? (up += w) : (down += w)); else flat += w;
  }
  const tot = up + down + flat || 1;
  return { up: up / tot, down: down / tot, flat: flat / tot };
}

function areaCard(R) {
  const cz = census(R.tmap, R.v.entry.grid, R.region);
  return card("grid", "Area with a significant trend", `${stackBar([[cz.down, "#5ac8fa"], [cz.flat, "#d1d1d6"], [cz.up, "#ff9500"]])}
    <div class="wtri"><span><b>${Math.round(cz.down * 100)}%</b> falling</span><span><b>${Math.round(cz.flat * 100)}%</b> unclear</span><span><b>${Math.round(cz.up * 100)}%</b> rising</span></div>`);
}

function lineupRows(list) {
  const items = list.filter((x) => !x.empty);
  const m = Math.max(...items.map((x) => Math.abs(x.tStat) || 0), 3) * 1.1;
  return items.map((x) => {
    const t = x.tStat || 0, { factor, label } = E.displayUnits(x.units);
    const col = x.verdict.level === "significant" ? (t > 0 ? "#ff9500" : "#5ac8fa") : x.verdict.level === "suggestive" ? "#ffcc00" : "#c7c7cc";
    return `<div class="wlrow click" data-var="${x.id}"><span>${esc(varStyle(x.id).short)}</span>${capsule(Math.min(0, t), Math.max(0, t), t, { span: m, w: 120, colorLo: col, colorHi: col })}<b>${signed(x.verdict.perDecade * factor, 2)}</b></div>`;
  }).join("") + `<div class="wcap">bar: t statistic · value: change per decade</div>`;
}

function atlasRows(items) {
  return items.map((it) => {
    const cz = census(it.tm, it.v.entry.grid, null);
    return `<div class="wlrow"><span>${esc(varStyle(it.id).short)}</span>${stackBar([[cz.down, "#5ac8fa"], [cz.flat, "#d1d1d6"], [cz.up, "#ff9500"]])}<b>${Math.round((cz.up + cz.down) * 100)}%</b></div>`;
  }).join("");
}

function valRows(rows, r) {
  return rows.map(([name, v, u]) => `<div class="wkv"><span>${esc(name)}</span><b>${signed(v, 3)} ${esc(u)}</b></div>`).join("") + `<div class="wcap">correlation of yearly values r = ${fmtNum(r, 2)}</div>`;
}

// Two regions' yearly anomalies on one small plot (for Compare).
function dualPlot(a, b) {
  const W = 268, H = 120, L = 30, R = W - 6, T = 6, B = H - 16;
  const anom = (an) => { const v = Array.from(an.values); const f = v.filter(Number.isFinite); const m = f.reduce((x, y) => x + y, 0) / Math.max(1, f.length); return v.map((x) => x - m); };
  const ya = anom(a), yb = anom(b), years = a.years;
  const all = [...ya, ...yb].filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const X = (y) => L + ((y - years[0]) / Math.max(1, years.at(-1) - years[0])) * (R - L);
  const Y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
  const line = (vals, ys) => vals.map((v, k) => (Number.isFinite(v) ? `${X(ys[k]).toFixed(1)},${Y(v).toFixed(1)}` : null)).filter(Boolean).join(" ");
  const fit = (vals, ys) => { const t = E.linearTrend({ years: ys, values: Float64Array.from(vals) }); return [ys[0], ys.at(-1)].map((y) => `${X(y).toFixed(1)},${Y(t.intercept + t.slope * y).toFixed(1)}`).join(" "); };
  const step = niceStep((hi - lo) / 3), ticks = [];
  for (let k = Math.ceil(lo / step); k * step <= hi; k++) ticks.push(k * step);
  return `<svg class="capsule" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" fill="none" stroke="#d1d1d6"/>
    <line x1="${L}" y1="${Y(0)}" x2="${R}" y2="${Y(0)}" stroke="#d1d1d6" stroke-dasharray="2 2"/>
    ${ticks.map((v) => `<text x="${L - 4}" y="${Y(v) + 3}" font-size="8.5" fill="#8e8e93" text-anchor="end">${fmtNum(v, 2)}</text>`).join("")}
    ${[1980, 2000, 2020].filter((y) => y >= years[0] && y <= years.at(-1)).map((y) => `<text x="${X(y)}" y="${H - 4}" font-size="8.5" fill="#8e8e93" text-anchor="middle">${y}</text>`).join("")}
    <polyline points="${line(yb, b.years)}" fill="none" stroke="#007aff" stroke-width="1.3"/>
    <polyline points="${line(ya, years)}" fill="none" stroke="#1c1c1e" stroke-width="1.3"/>
    <polyline points="${fit(yb, b.years)}" fill="none" stroke="#007aff" stroke-width="1.4" stroke-dasharray="4 3"/>
    <polyline points="${fit(ya, years)}" fill="none" stroke="#1c1c1e" stroke-width="1.4" stroke-dasharray="4 3"/>
  </svg>`;
}
