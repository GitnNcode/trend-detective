// Workstation chrome: menu bar, loop toolbar, inspector, colorbar, product
// legend and status bar. Mostly graphical, few words.
// Written with Claude and reviewed by the team.

import * as E from "../../engine/index.js";
import * as D from "../data.js";
import { VARS, varStyle, trendRamp, stepColor, rampColor, RAMPS, zoneSoft } from "../palettes.js";
import { app, actions, MODES, regionOf, monthsLabel, defOf, unitsOf, frameYear, setTime, setPlaying, seasonCode, hasVar } from "../main.js";
import { exportPlot } from "./export.js";
import { recordLoop } from "./record.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const SEASONS = [["ANN", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], ["DJF", [12, 1, 2]], ["MAM", [3, 4, 5]], ["JJA", [6, 7, 8]], ["SON", [9, 10, 11]]];

export function fmtNum(x, sig = 3) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
  if (a >= 1e4) return Math.round(x).toLocaleString("en-US");
  return E.fmt(x, sig);
}
export const signed = (x, sig = 2) => (Number.isFinite(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + fmtNum(Math.abs(x), sig) : "–");
// Round a rough axis step to 1, 2, 2.5 or 5 times a power of ten.
export function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const pTxt = (p) => (!Number.isFinite(p) ? "–" : p < 0.001 ? "<.001" : p.toFixed(3).replace(/^0/, ""));
const dispUnits = (id) => E.displayUnits(unitsOf(id));
// Units for absolute values (fractions shown as %); dispUnits is for rates.
export const absUnits = (id) => (/0 to 1/.test(unitsOf(id)) ? { factor: 100, label: "%" } : { factor: 1, label: unitsOf(id) });
const code = (id) => varStyle(id).code;

// ---------------------------------------------------------------- menus
let openMenu = null;
export function renderMenubar() {
  const s = app.state, c = app.content;
  const region = regionOf(s);
  const mode = MODES.find((m) => m.id === s.mode);
  const radio = (on) => (on ? "●" : "");
  const check = (on) => (on ? "✓" : "");
  const groups = new Map();
  for (const r of c.regions) { const t = r.type ?? "other"; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(r); }
  const menus = [
    { id: "file", label: "File", items: [
      { label: "Export figure (PNG)", key: "E", act: () => exportPlot(app) },
      { label: "Record loop as video", key: "R", act: () => recordLoop() },
      { label: "Copy link to this view", key: "L", act: () => copyLink() },
    ] },
    { id: "product", label: "Product", cur: mode.label, items: MODES.map((m, k) => ({ label: m.label, key: String(k + 1), mark: radio(s.mode === m.id), act: () => actions.setMode(m.id) })) },
    { id: "field", label: "Field", cur: code(s.variable), items: app.catalog.variables.filter((v) => !varStyle(v.id).hidden).map((v) => ({ label: `${code(v.id).padEnd(9, " ")} ${defOf(v.id).name}`, key: v.units, mark: radio(s.variable === v.id), title: defOf(v.id).plain, disabled: s.mode === "route" && v.id !== "seaice", act: () => actions.setVariable(v.id) })) },
    { id: "region", label: "Region", cur: s.custom ? "Box" : region.name, items: [...[...groups.entries()].flatMap(([t, rs]) => [{ hdr: t }, ...rs.map((r) => ({ label: r.name, mark: radio(!s.custom && s.regionId === r.id), act: () => actions.setRegion(r.id) }))]), { sep: true }, { label: "Draw box on map", key: "B", mark: radio(!!s.custom), act: () => startDraw() }] },
    { id: "season", label: "Season", cur: seasonCode(s.months) + (s.period ? ` · ${s.period[0]}–${s.period[1]}` : ""), items: [
      ...SEASONS.map(([n, m]) => ({ label: { ANN: "Annual mean", DJF: "Dec–Feb (DJF)", MAM: "Mar–May (MAM)", JJA: "Jun–Aug (JJA)", SON: "Sep–Nov (SON)" }[n], mark: radio(sameSet(m, s.months)), act: () => actions.setMonths(m) })),
      { sep: true }, { hdr: "Trend period" },
      ...[[null, "Full record"], [[1980, 2002], "1980–2002"], [[2003, 2025], "2003–2025"], [[2013, 2025], "Since 2013"]].map(([pr, lab]) => ({ label: lab, mark: radio(JSON.stringify(s.period ?? null) === JSON.stringify(pr)), act: () => actions.set({ period: pr }) })),
      { sep: true }, { hdr: "Single months (toggle)" },
      ...["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((name, k) => ({ label: name, mark: s.months.length < 12 && s.months.includes(k + 1) ? "✓" : "", keep: true, act: () => {
        const set = new Set(s.months.length === 12 ? [] : s.months);
        set.has(k + 1) ? set.delete(k + 1) : set.add(k + 1);
        actions.setMonths([...set].sort((a, c) => a - c));
      } })),
    ] },
    { id: "display", label: "Display", items: [
      { hdr: "Projection" },
      ...[["auto", "3D globe"], ["flat", "Flat map (cylindrical equidistant)"], ["polar", "Polar stereographic"]].map(([k, l]) => ({ label: l, mark: radio(s.proj === k || (k === "auto" && s.proj === "globe")), act: () => actions.set({ proj: k }) })),
      { label: "Rotation rings on the globe", mark: check(s.gizmo), act: () => actions.toggle("gizmo") },
      { sep: true }, { hdr: "Fill" },
      { label: "Shaded contours", mark: radio(!s.cells), act: () => actions.set({ cells: false }) },
      { label: "Grid cells", mark: radio(s.cells), act: () => actions.set({ cells: true }) },
      { label: "Contour lines", mark: check(s.contours), act: () => actions.toggle("contours") },
      { label: "Coastlines", mark: check(s.coast), act: () => actions.toggle("coast") },
      { label: "Lat/lon grid", mark: check(s.grid), act: () => actions.toggle("grid") },
      { sep: true }, { hdr: "Shift" },
      { label: "Previous edges", mark: check(s.showTrail), act: () => actions.toggle("showTrail") },
      { label: "First-year edge", mark: check(s.showFirst), act: () => actions.toggle("showFirst") },
      { label: "Track and cone", mark: check(s.showTrack), act: () => actions.toggle("showTrack") },
      { label: "Edge history (all years)", mark: check(s.showRings), act: () => actions.toggle("showRings") },
      { label: "Arrived / left areas", mark: check(s.showDipole), act: () => actions.toggle("showDipole") },
      { sep: true }, { hdr: "Trend" },
      { label: "Hatch p ≥ 0.05", mark: check(s.hatch), act: () => actions.toggle("hatch") },
      { label: "Remove seasonal cycle", mark: check(s.deseason), act: () => actions.toggle("deseason") },
      { label: "Monthly values in chart", mark: check(s.showMonthly), act: () => actions.toggle("showMonthly") },
    ] },
    { id: "proc", label: "Procedures", items: [
      { hdr: "Guided" },
      ...c.cases.map((cs) => ({ label: cs.title, key: `${cs.steps.length} steps`, act: () => app.cases.start(cs.id) })),
      { sep: true }, { hdr: "Questions" },
      ...c.usecases.map((q) => ({ label: q.prompt, key: MODES.find((m) => m.id === q.mode)?.short ?? q.mode, mark: radio(s.prompt === q.prompt), act: () => actions.applyAction(q, q.prompt) })),
    ] },
    { id: "help", label: "Help", items: [{ label: "Methods and data", act: () => { $("#aboutModal").hidden = false; } }, { label: "Keys: space play · ←/→ frame · 1–9, 0 product", disabled: true }, { label: "B box · E export · R record · L link", disabled: true }, { label: "Globe rings: X tilt · Y spin · Z roll · Shift snaps 5°", disabled: true }] },
  ];
  const bar = $("#menubar");
  bar.innerHTML = `<div class="appname"><svg viewBox="0 0 16 16"><path d="M1 11c3-4 5-4 7-2s4 2 7-2" stroke="#ffd400" stroke-width="1.6" fill="none"/><path d="M1 6c3-4 5-4 7-2s4 2 7-2" stroke="#7d838a" stroke-width="1.2" fill="none"/></svg>Trend Detective</div>
    ${menus.map((m) => `<div class="menu ${openMenu === m.id ? "open" : ""}" data-m="${m.id}"><button>${m.label}${m.cur ? `<span class="cur">${esc(m.cur)}</span>` : ""}</button>
      <div class="menu-drop">${m.items.map((it, k) => it.sep ? `<div class="sep"></div>` : it.hdr ? `<div class="hdr">${esc(it.hdr)}</div>` : `<button class="mi" data-k="${k}" ${it.disabled ? "disabled style=\"opacity:.4\"" : ""} ${it.title ? `title="${esc(it.title)}"` : ""}><span class="chk">${it.mark ?? ""}</span><span>${esc(it.label)}</span><span class="key">${esc(it.key ?? "")}</span></button>`).join("")}</div></div>`).join("")}
    <div class="spacer"></div><div class="src">NASA MERRA-2 · monthly · 1980–2026</div>`;
  bar.querySelectorAll(".menu").forEach((el) => {
    const m = menus.find((x) => x.id === el.dataset.m);
    el.querySelector(":scope > button").addEventListener("click", (e) => { e.stopPropagation(); openMenu = openMenu === m.id ? null : m.id; renderMenubar(); });
    el.addEventListener("mouseenter", () => { if (openMenu && openMenu !== m.id) { openMenu = m.id; renderMenubar(); } });
    el.querySelectorAll(".mi").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const it = m.items[Number(b.dataset.k)];
      if (!it?.keep) openMenu = null;
      renderMenubar();
      if (it && !it.disabled) it.act?.();
    }));
  });
}
document.addEventListener("click", () => { if (openMenu) { openMenu = null; renderMenubar(); } });

async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast("Copy the address bar"); }
}

function startDraw() {
  app.map.drawMode = true;
  toast("Drag a box on the map");
}

// ---------------------------------------------------------------- toolbar
export function renderToolbar() {
  const s = app.state;
  const tb = $("#toolbar");
  const play = app.playing ? `<svg viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>` : `<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z"/></svg>`;
  const vs = varStyle(s.variable);
  let prod = "";
  if (s.mode === "band") {
    const b = s.band, au = absUnits(s.variable);
    const which = b.min != null && b.max != null ? "between" : b.min != null ? "above" : "below";
    prod = `<span class="tlabel">Zone</span><div class="tg">
      <button class="tb ${which === "above" ? "on" : ""}" data-w="above" title="At or above">≥</button>
      <button class="tb ${which === "below" ? "on" : ""}" data-w="below" title="At or below">≤</button>
      <button class="tb ${which === "between" ? "on" : ""}" data-w="between" title="Between">↔</button></div>
      ${which === "between" ? `<input class="tinput" id="thrMin" type="number" step="${vs.step * au.factor}" value="${r6(b.min * au.factor)}"><span class="tlabel">–</span><input class="tinput" id="thrMax" type="number" step="${vs.step * au.factor}" value="${r6(b.max * au.factor)}">`
        : `<input class="tinput" id="thrOne" type="number" step="${vs.step * au.factor}" value="${r6((which === "below" ? b.max : b.min) * au.factor)}">`}
      <span class="tlabel">${esc(au.label)}</span>
      <input class="trange" id="thrRange" type="range" min="${vs.domain[0]}" max="${vs.domain[1]}" step="${vs.step}" value="${which === "below" ? b.max : b.min}" title="Threshold">`;
  } else if (s.mode === "route") {
    prod = `<span class="tlabel">Route</span><select class="tselect" id="routeSel">${app.content.routes.filter((r) => r.id !== "nyc_lon").map((r) => `<option value="${r.id}" ${r.id === s.route ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
      <span class="tlabel">Open ≤</span><input class="tinput" id="routeMax" type="number" min="5" max="50" step="1" value="${Math.round((s.band.max ?? 0.15) * 100)}"><span class="tlabel">% ice</span>`;
  } else if (s.mode === "twin") {
    prod = `<span class="tlabel">Location</span><input class="tinput" id="cityIn" list="cityList" style="width:150px;text-align:left" value="${esc(s.twin?.name ?? "")}" placeholder="City or click map"><datalist id="cityList">${(app.content.cities ?? []).map((c) => `<option value="${esc(c.name)}">${esc(c.country)}</option>`).join("")}</datalist>`;
  } else if (s.mode === "map") {
    prod = `<div class="tg"><button class="tb ${s.layerView === "trend" ? "on" : ""}" data-lv="trend">Trend</button><button class="tb ${s.layerView === "field" ? "on" : ""}" data-lv="field">Field</button></div>`;
  } else if (s.mode === "compare") {
    prod = `<span class="tlabel">vs</span><select class="tselect" id="cmpSel">${app.content.regions.filter((r) => r.type !== "global").map((r) => `<option value="${r.id}" ${r.id === s.compareId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`;
  } else if (s.mode === "vectors") {
    const windOk = hasVar("u250") && hasVar("v250");
    prod = `<span class="tlabel">Arrows</span><div class="tg"><button class="tb ${s.vecSource !== "wind" ? "on" : ""}" data-vs="velocity">Climate velocity</button><button class="tb ${s.vecSource === "wind" ? "on" : ""}" data-vs="wind" ${windOk ? "" : 'disabled title="Needs the U250 and V250 fields from the data pipeline"'}>Wind 250 hPa</button></div>
      ${s.vecSource !== "wind" ? `<select class="tselect" id="winSel" title="Years in each moving window">${[11, 15, 21].map((w) => `<option value="${w}" ${s.vecWindow === w ? "selected" : ""}>${w}-year window</option>`).join("")}</select>` : ""}`;
  }
  tb.innerHTML = `
    <div class="tg">
      <button class="tb icon" data-f="first" title="First frame"><svg viewBox="0 0 12 12"><rect x="1.5" y="2" width="1.6" height="8"/><path d="M10.5 2v8L4 6z"/></svg></button>
      <button class="tb icon" data-f="prev" title="Step back (←)"><svg viewBox="0 0 12 12"><path d="M9 2v8L3 6z"/></svg></button>
      <button class="tb icon ${app.playing ? "on" : ""}" data-f="play" title="Loop (space)">${play}</button>
      <button class="tb icon" data-f="next" title="Step forward (→)"><svg viewBox="0 0 12 12"><path d="M3 2v8l6-4z"/></svg></button>
      <button class="tb icon" data-f="last" title="Last frame"><svg viewBox="0 0 12 12"><path d="M1.5 2v8L8 6z"/><rect x="8.9" y="2" width="1.6" height="8"/></svg></button>
    </div>
    <span class="frameread" id="frameRead"></span>
    <input class="trange" id="frameRange" type="range" min="0" max="${Math.max(0, (app.frames?.n ?? 1) - 1)}" step="1" value="${Math.round(app.t)}" title="Frame" style="width:150px">
    <select class="tselect" id="rateSel" title="Loop rate">${[0.5, 1, 2, 4].map((r) => `<option value="${r}" ${app.speed === r ? "selected" : ""}>${r === 0.5 ? "½" : r}× speed</option>`).join("")}</select>
    <div class="tsep"></div>
    <div class="tg"><button class="tb ${s.cadence !== "monthly" ? "on" : ""}" data-cad="annual" title="One frame per year (season mean)">Yr</button><button class="tb ${s.cadence === "monthly" ? "on" : ""}" data-cad="monthly" title="One frame per month">Mo</button></div>
    <div class="tsep"></div>
    <div class="tg">${SEASONS.map(([n, m]) => `<button class="tb ${sameSet(m, s.months) ? "on" : ""}" data-season="${m.join(",")}">${n}</button>`).join("")}</div>
    ${prod ? `<div class="tsep"></div>${prod}` : ""}
    </div>`;
  tb.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
    const n = app.frames?.n ?? 1;
    const f = b.dataset.f;
    if (f === "play") setPlaying(!app.playing);
    else { setPlaying(false); setTime(f === "first" ? 0 : f === "last" ? n - 1 : Math.round(app.t) + (f === "next" ? 1 : -1)); }
  }));
  $("#frameRange", tb).addEventListener("input", (e) => { setPlaying(false); setTime(Number(e.target.value)); });
  $("#rateSel", tb).addEventListener("change", (e) => { app.speed = Number(e.target.value); });
  tb.querySelectorAll("[data-cad]").forEach((b) => b.addEventListener("click", () => actions.set({ cadence: b.dataset.cad })));
  tb.querySelectorAll("[data-season]").forEach((b) => b.addEventListener("click", () => actions.setMonths(b.dataset.season.split(",").map(Number))));
  tb.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => actions.set({ layerView: b.dataset.lv })));
  tb.querySelectorAll("[data-vs]").forEach((b) => b.addEventListener("click", () => actions.set(b.dataset.vs === "wind" ? { vecSource: "wind", variable: "wind250" } : { vecSource: "velocity", variable: s.variable === "wind250" ? "t2m" : s.variable, cadence: "annual" })));
  $("#winSel", tb)?.addEventListener("change", (e) => actions.set({ vecWindow: Number(e.target.value) }));
  $("#cmpSel", tb)?.addEventListener("change", (e) => actions.set({ compareId: e.target.value }));
  tb.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => {
    const bnd = s.band, cur = bnd.min ?? bnd.max ?? (vs.domain[0] + vs.domain[1]) / 2;
    if (b.dataset.w === "above") actions.setBand({ min: cur, max: null });
    else if (b.dataset.w === "below") actions.setBand({ min: null, max: cur });
    else { const half = (vs.domain[1] - vs.domain[0]) * 0.05; actions.setBand({ min: round(cur - half, vs.step), max: round(cur + half, vs.step) }); }
  }));
  const one = $("#thrOne", tb), rng = $("#thrRange", tb), auf = absUnits(s.variable).factor;
  const commitOne = (v) => actions.setBand(s.band.max != null && s.band.min == null ? { min: null, max: v } : { min: v, max: null });
  one?.addEventListener("change", () => commitOne(Number(one.value) / auf));
  rng?.addEventListener("input", () => { if (one) one.value = r6(Number(rng.value) * auf); });
  rng?.addEventListener("change", () => {
    if (one) commitOne(Number(rng.value));
    else actions.setBand({ min: Number(rng.value), max: Math.max(Number(rng.value), s.band.max) });
  });
  $("#thrMin", tb)?.addEventListener("change", (e) => actions.setBand({ min: Math.min(Number(e.target.value) / auf, s.band.max), max: s.band.max }));
  $("#thrMax", tb)?.addEventListener("change", (e) => actions.setBand({ min: s.band.min, max: Math.max(Number(e.target.value) / auf, s.band.min) }));
  $("#routeSel", tb)?.addEventListener("change", (e) => actions.set({ route: e.target.value }));
  $("#routeMax", tb)?.addEventListener("change", (e) => actions.setBand({ min: null, max: Math.max(1, Math.min(60, Number(e.target.value))) / 100 }));
  $("#cityIn", tb)?.addEventListener("change", (e) => {
    const c = (app.content.cities ?? []).find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (c) actions.set({ twin: { lat: c.lat, lon: c.lon, name: c.name } });
  });

  updateFrame();
}
const round = (x, step) => Math.round(x / step) * step;
const r6 = (x) => (x == null ? "" : Math.round(x * 1e6) / 1e6);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// ---------------------------------------------------------------- per-frame
export function updateFrame() {
  const f = app.frames;
  if (!f) return;
  const k = Math.round(app.t);
  const lab = f.labels[k] ?? "";
  const fr = $("#frameRead");
  if (fr) fr.textContent = `${lab}  ${k + 1}/${f.n}`;
  const rng = $("#frameRange");
  if (rng && document.activeElement !== rng) rng.value = String(k);
  const yr = $("#legendYear");
  if (yr) yr.textContent = staticTime() ?? lab;
  const st = $("#stFrame");
  if (st) st.textContent = `FRAME ${k + 1}/${f.n}  ${staticTime() ?? lab}`;
}

function staticTime() {
  const s = app.state, f = app.frames;
  if (s.mode === "twin") return "1980s → 2016–25";
  if (s.mode === "validate" || s.mode === "compare") return `${Math.floor(f.years[0])}–${Math.floor(f.years[f.n - 1])}`;
  if (s.mode === "vectors" && s.vecSource !== "wind" && app.R.vecLabel) return app.R.vecLabel;
  if ((s.mode === "map" && s.layerView === "trend") || s.mode === "flow" || s.mode === "atlas" || s.mode === "lineup") return `${Math.floor(f.years[0])}–${Math.floor(f.years[f.n - 1])}`;
  return null;
}

// ---------------------------------------------------------------- figure title
export function renderLegend() {
  const s = app.state, R = app.R;
  if (!R.v) return;
  const el = $("#figTitle");
  const def = defOf(s.variable), au = absUnits(s.variable), u = au.label;
  const where = R.region.type === "global" ? "Global" : R.region.name;
  let t;
  if (s.mode === "band") {
    const b = s.band;
    const F = (x) => fmtNum(x * au.factor);
    const thr = b.min != null && b.max != null ? `${F(b.min)} to ${F(b.max)} ${u}` : b.min != null ? `≥ ${F(b.min)} ${u}` : `≤ ${F(b.max)} ${u}`;
    t = `${def.name}: zone ${thr}`;
  } else if (s.mode === "map" && s.layerView === "trend") t = `${def.name}: linear trend per decade`;
  else if (s.mode === "flow") t = `${def.name}: climate velocity`;
  else if (s.mode === "route") t = `Sea ice fraction: ${R.route?.name ?? "route"}`;
  else if (s.mode === "twin") t = `Climate analog: ${R.home?.name ?? "selected point"}`;
  else if (s.mode === "lineup") t = `All fields: ${where}`;
  else if (s.mode === "atlas") t = `All fields: linear trend per decade`;
  else if (s.mode === "vectors") t = s.vecSource === "wind" ? "Wind at 250 hPa (jet-stream level)" : `${def.name}: climate velocity, moving ${s.vecWindow}-year window`;
  else if (s.mode === "validate") t = "Validation: MERRA-2 against independent records";
  else if (s.mode === "compare") t = `${def.name}: trend per decade, ${R.region.name} vs ${R.regionB?.name ?? ""}`;
  else t = def.name;
  el.innerHTML = `<div class="t">${esc(t)} <span>· ${esc(where)} · ${esc(seasonCode(s.months) === "ANN" ? "annual mean" : seasonCode(s.months) + " mean")}</span></div><div class="yr" id="legendYear"></div>`;
  updateFrame();
}

// ---------------------------------------------------------------- colorbar
export function renderColorbar() {
  const s = app.state, R = app.R;
  if (!R.v) return;
  const box = $("#colorbar");
  let cv = box.querySelector("canvas");
  if (!cv) { cv = document.createElement("canvas"); box.appendChild(cv); }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = box.clientWidth, H = box.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.textBaseline = "top";
  const scene = app.map.scene;
  const vs = varStyle(s.variable);
  const { factor, label } = dispUnits(s.variable);
  const x0 = 50, x1 = Math.max(x0 + 100, W - 24), y = 6, h = 13;
  const bar = (n, colorOf, labels, title, xa = x0, xb = x1) => {
    const w = (xb - xa) / n;
    for (let k = 0; k < n; k++) { ctx.fillStyle = colorOf(k); ctx.fillRect(Math.round(xa + k * w), y, Math.ceil(w), h); }
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.strokeRect(Math.round(xa) + 0.5, y + 0.5, Math.round(xb - xa) - 1, h - 1);
    ctx.fillStyle = "#333"; ctx.textAlign = "center";
    const every = Math.max(1, Math.ceil((labels.length * 34) / (xb - xa)));
    labels.forEach((t, k) => { if (t != null && k % every === 0) { const x = xa + (k * (xb - xa)) / (labels.length - 1); ctx.fillText(t, x, y + h + 3); ctx.fillRect(Math.round(x), y + h, 1, 3); } });
    ctx.fillStyle = "#111";
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillText(title, (xa + xb) / 2, y + h + 19);
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  };
  if (scene.layer === 1 && R.tmapMax) {
    const tr = trendRamp(s.mode === "twin" ? "t2m" : s.variable), L = R.auxLevels ?? 12, mx = R.tmapMax * 10 * (s.mode === "twin" ? 1 : factor);
    bar(L, (k) => stepColor(tr.ramp, k, L, { flip: tr.flip }), Array.from({ length: L + 1 }, (_, k) => fmtNum(-mx + (2 * mx * k) / L, 2)), `${code(s.variable)} TREND  (${label} / decade)${s.hatch && s.mode !== "twin" ? "   hatched: p ≥ 0.05" : ""}`);
  } else if (scene.layer === 2 && (R.flow || R.vec?.series)) {
    const src = R.flow ?? R.vec.series;
    const L = 10, s0 = src.medianSpeed || 1, cap = src.cap || 1, lc = Math.log(1 + cap / s0);
    bar(L, (k) => stepColor("speed", k, L), Array.from({ length: L + 1 }, (_, k) => fmtNum((Math.exp((k / L) * lc) - 1) * s0 * 10, 2)), `${code(s.variable)} CLIMATE VELOCITY  (km / decade)   arrows: direction of travel`);
  } else if (s.mode === "band") {
    const L = vs.levels, lo = vs.domain[0], hi = vs.domain[1], g = vs.gamma ?? 1;
    const at = (k) => lo + (hi - lo) * Math.pow(k / L, 1 / g);
    const split = x0 + (x1 - x0) * 0.62;
    bar(L, (k) => { const v = Math.round((0.96 + (0.6 - 0.96) * (k + 0.5) / L) * 255); return `rgb(${v},${v},${v})`; }, Array.from({ length: L + 1 }, (_, k) => fmtNum(at(k) * absUnits(s.variable).factor, 2)), `${code(s.variable)}  (${absUnits(s.variable).label})`, x0, split - 16);
    if (s.showRings) {
      const yrs = app.frames.years;
      const bins = 10, n = yrs.length;
      const labels = Array.from({ length: bins + 1 }, (_, k) => k === bins ? String(Math.floor(yrs[n - 1])) : String(Math.floor(yrs[Math.min(n - 1, Math.floor((k * n) / bins))])));
      bar(bins, (k) => stepColor("rings", k, bins), labels, "EDGE BY YEAR", split, x1);
    } else {
      const soft = zoneSoft(s.variable);
      const b = s.band, base = b.min ?? b.max, dir = b.min != null ? 1 : -1;
      const af = absUnits(s.variable).factor;
      bar(5, (k) => stepColor("zone", k, 5), Array.from({ length: 6 }, (_, k) => fmtNum((base + dir * (soft * k) / 5) * af, 2)), `ZONE (${b.min != null ? "≥" : "≤"} ${fmtNum(base * af)} ${absUnits(s.variable).label})`, split, x1);
    }
  } else {
    const L = vs.levels, lo = vs.domain[0], hi = vs.domain[1], g = vs.gamma ?? 1;
    const at = (k) => lo + (hi - lo) * Math.pow(k / L, 1 / g);
    const au = absUnits(s.variable);
    bar(L, (k) => stepColor(vs.ramp, k, L), Array.from({ length: L + 1 }, (_, k) => fmtNum(at(k) * au.factor, 2)), `${code(s.variable)}  ${defOf(s.variable).name.toUpperCase()}  (${au.label})`);
  }
}

export { renderInspector, ensureChart } from "./inspector.js";
import { renderInspector } from "./inspector.js";

// ---------------------------------------------------------------- status bar
export function renderStatus() {
  const R = app.R;
  if (!R.v) return;
  const e = R.v.entry, g = e.grid;
  $("#statusbar").innerHTML = `<span id="stCursor">—</span><span id="stFrame"></span><span>${esc(e.source.split(",")[0])} · ${g.dlat}°×${g.dlon}° · ${(g.nlat * g.nlon).toLocaleString("en-US")} cells × ${e.nt} mo</span><span id="stMeter"></span><span>NASA Space Apps 2026 · Not affiliated with NASA</span>`;
  updateMeter();
  updateFrame();
}

export function updateMeter() {
  const el = $("#stMeter");
  if (el) el.textContent = `${D.meter.loaded.size}/${app.catalog.variables.length} fields · ${fmtNum(D.meter.values, 3)} values · ${(D.meter.bytes / 1e6).toFixed(0)} MB`;
}

export function hover(ll) {
  const el = $("#stCursor");
  if (!el) return;
  const s = app.state, R = app.R;
  if (!ll || !R.v) { el.textContent = "—"; return; }
  const v = R.v, g = v.entry.grid;
  const { factor, label } = dispUnits(s.variable);
  const parts = [`${Math.abs(ll.lat).toFixed(2)}${ll.lat >= 0 ? "N" : "S"} ${Math.abs(ll.lon).toFixed(2)}${ll.lon >= 0 ? "E" : "W"}`];
  const f = app.frames;
  let val = NaN;
  if (f && !f.monthly) {
    const af = E.annualFields(v, s.months), k = Math.round(app.t);
    val = D.sampleGrid(af.fields.subarray(k * af.ncell, (k + 1) * af.ncell), g, ll.lat, ll.lon);
  } else if (f) {
    const i = Math.round((ll.lat - g.lat0) / g.dlat), j = ((Math.round((ll.lon - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
    if (i >= 0 && i < g.nlat) val = v.value(Math.round(app.t), i, j);
  }
  const au = absUnits(s.variable);
  parts.push(`${code(s.variable)} ${Number.isFinite(val) ? fmtNum(val * au.factor, 3) + " " + au.label : "—"}`);
  if (R.tmap) {
    const sl = D.sampleGrid(R.tmap.slope, g, ll.lat, ll.lon), p = D.sampleGrid(R.tmap.p, g, ll.lat, ll.lon);
    if (Number.isFinite(sl)) parts.push(`trend ${signed(sl * 10 * factor, 2)}/dec ${p < 0.05 ? "*" : "n.s."}`);
  }
  if (s.mode === "flow" && R.flow) {
    const sp = D.sampleGrid(R.flow.speed, g, ll.lat, ll.lon), u = D.sampleGrid(R.flow.u, g, ll.lat, ll.lon), vv = D.sampleGrid(R.flow.v, g, ll.lat, ll.lon);
    if (Number.isFinite(sp)) parts.push(`velocity ${fmtNum(sp * 10, 2)} km/dec → ${app.A?.bearingName ? app.A.bearingName((Math.atan2(u, vv) * 180 / Math.PI + 360) % 360) : ""}`);
  }
  el.innerHTML = parts.map((p, k) => (k === 1 ? `<span class="hl">${esc(p)}</span>` : esc(p))).join("   ");
}

export function nearestCityName(appRef, lat, lon, maxKm = 600) {
  let best = null, bd = Infinity;
  for (const c of appRef.content.cities ?? []) {
    const r = Math.PI / 180, dA = (c.lat - lat) * r, dO = (c.lon - lon) * r;
    const h = Math.sin(dA / 2) ** 2 + Math.cos(lat * r) * Math.cos(c.lat * r) * Math.sin(dO / 2) ** 2;
    const d = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd <= maxKm ? best.name : null;
}

// ---------------------------------------------------------------- toast
let toastT = null;
export function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, ms);
}

export function renderAll() {
  renderMenubar();
  renderToolbar();
  renderLegend();
  renderColorbar();
  renderInspector();
  renderStatus();
  document.getElementById("map").dataset.kind = app.map.kind;
}
