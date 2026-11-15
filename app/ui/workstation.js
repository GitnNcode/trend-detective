// Workstation chrome: menu bar, loop toolbar, inspector, colorbar, product
// legend and status bar. Mostly graphical, few words.
// Written with Claude and reviewed by the team.

import * as E from "../../engine/index.js";
import * as D from "../data.js";
import { VARS, varStyle, trendRamp, stepColor, rampColor, RAMPS, zoneSoft } from "../palettes.js";
import { app, actions, MODES, regionOf, monthsLabel, defOf, unitsOf, frameYear, setTime, setPlaying, seasonCode } from "../main.js";
import { exportPlot } from "./export.js";

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
const pTxt = (p) => (!Number.isFinite(p) ? "–" : p < 0.001 ? "<.001" : p.toFixed(3).replace(/^0/, ""));
const dispUnits = (id) => E.displayUnits(unitsOf(id));
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
    { id: "product", label: "Product", cur: mode.label, items: MODES.map((m, k) => ({ label: m.label, key: String(k + 1), mark: radio(s.mode === m.id), act: () => actions.setMode(m.id) })) },
    { id: "field", label: "Field", cur: code(s.variable), items: app.catalog.variables.map((v) => ({ label: `${code(v.id).padEnd(9, " ")} ${defOf(v.id).name}`, key: v.units, mark: radio(s.variable === v.id), title: defOf(v.id).plain, disabled: s.mode === "route" && v.id !== "seaice", act: () => actions.setVariable(v.id) })) },
    { id: "region", label: "Region", cur: s.custom ? "Box" : region.name, items: [...[...groups.entries()].flatMap(([t, rs]) => [{ hdr: t }, ...rs.map((r) => ({ label: r.name, mark: radio(!s.custom && s.regionId === r.id), act: () => actions.setRegion(r.id) }))]), { sep: true }, { label: "Draw box on map", key: "B", mark: radio(!!s.custom), act: () => startDraw() }] },
    { id: "season", label: "Season", cur: seasonCode(s.months), items: [
      ...SEASONS.map(([n, m]) => ({ label: { ANN: "Annual mean", DJF: "Dec–Feb (DJF)", MAM: "Mar–May (MAM)", JJA: "Jun–Aug (JJA)", SON: "Sep–Nov (SON)" }[n], mark: radio(sameSet(m, s.months)), act: () => actions.setMonths(m) })),
      { sep: true }, { hdr: "Single months (toggle)" },
      ...["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((name, k) => ({ label: name, mark: s.months.length < 12 && s.months.includes(k + 1) ? "✓" : "", keep: true, act: () => {
        const set = new Set(s.months.length === 12 ? [] : s.months);
        set.has(k + 1) ? set.delete(k + 1) : set.add(k + 1);
        actions.setMonths([...set].sort((a, c) => a - c));
      } })),
    ] },
    { id: "display", label: "Display", items: [
      { hdr: "Projection" },
      ...[["auto", "Automatic"], ["flat", "Cylindrical equidistant"], ["globe", "Orthographic"], ["polar", "Polar stereographic"]].map(([k, l]) => ({ label: l, mark: radio(s.proj === k), act: () => actions.set({ proj: k }) })),
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
    { id: "help", label: "Help", items: [{ label: "Methods and data", act: () => { $("#aboutModal").hidden = false; } }, { label: "Keys: space play · ←/→ frame · 1–8 product", disabled: true }] },
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
    const b = s.band;
    const which = b.min != null && b.max != null ? "between" : b.min != null ? "above" : "below";
    prod = `<span class="tlabel">Zone</span><div class="tg">
      <button class="tb ${which === "above" ? "on" : ""}" data-w="above" title="At or above">≥</button>
      <button class="tb ${which === "below" ? "on" : ""}" data-w="below" title="At or below">≤</button>
      <button class="tb ${which === "between" ? "on" : ""}" data-w="between" title="Between">↔</button></div>
      ${which === "between" ? `<input class="tinput" id="thrMin" type="number" step="${vs.step}" value="${b.min}"><span class="tlabel">–</span><input class="tinput" id="thrMax" type="number" step="${vs.step}" value="${b.max}">`
        : `<input class="tinput" id="thrOne" type="number" step="${vs.step}" value="${which === "below" ? b.max : b.min}">`}
      <span class="tlabel">${esc(unitsOf(s.variable))}</span>
      <input class="trange" id="thrRange" type="range" min="${vs.domain[0]}" max="${vs.domain[1]}" step="${vs.step}" value="${which === "below" ? b.max : b.min}" title="Threshold">`;
  } else if (s.mode === "route") {
    prod = `<span class="tlabel">Route</span><select class="tselect" id="routeSel">${app.content.routes.filter((r) => r.id !== "nyc_lon").map((r) => `<option value="${r.id}" ${r.id === s.route ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
      <span class="tlabel">Open ≤</span><input class="tinput" id="routeMax" type="number" min="5" max="50" step="1" value="${Math.round((s.band.max ?? 0.15) * 100)}"><span class="tlabel">% ice</span>`;
  } else if (s.mode === "twin") {
    prod = `<span class="tlabel">Location</span><input class="tinput" id="cityIn" list="cityList" style="width:150px;text-align:left" value="${esc(s.twin?.name ?? "")}" placeholder="City or click map"><datalist id="cityList">${(app.content.cities ?? []).map((c) => `<option value="${esc(c.name)}">${esc(c.country)}</option>`).join("")}</datalist>`;
  } else if (s.mode === "map") {
    prod = `<div class="tg"><button class="tb ${s.layerView === "trend" ? "on" : ""}" data-lv="trend">Trend</button><button class="tb ${s.layerView === "field" ? "on" : ""}" data-lv="field">Field</button></div>`;
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
    <div class="tright">
      <button class="tb ${app.map.drawMode ? "on" : ""}" id="boxBtn" title="Draw a region box (or Shift+drag)"><svg viewBox="0 0 12 12"><path d="M1.5 1.5h9v9h-9z" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/></svg>Box</button>
      <button class="tb" id="pngBtn" title="Export the display as PNG">PNG</button>
      <button class="tb" id="linkBtn" title="Copy a link to this display">Link</button>
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
  tb.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => {
    const bnd = s.band, cur = bnd.min ?? bnd.max ?? (vs.domain[0] + vs.domain[1]) / 2;
    if (b.dataset.w === "above") actions.setBand({ min: cur, max: null });
    else if (b.dataset.w === "below") actions.setBand({ min: null, max: cur });
    else { const half = (vs.domain[1] - vs.domain[0]) * 0.05; actions.setBand({ min: round(cur - half, vs.step), max: round(cur + half, vs.step) }); }
  }));
  const one = $("#thrOne", tb), rng = $("#thrRange", tb);
  const commitOne = (v) => actions.setBand(s.band.max != null && s.band.min == null ? { min: null, max: v } : { min: v, max: null });
  one?.addEventListener("change", () => commitOne(Number(one.value)));
  rng?.addEventListener("input", () => { if (one) one.value = rng.value; });
  rng?.addEventListener("change", () => {
    if (one) commitOne(Number(rng.value));
    else actions.setBand({ min: Number(rng.value), max: Math.max(Number(rng.value), s.band.max) });
  });
  $("#thrMin", tb)?.addEventListener("change", (e) => actions.setBand({ min: Math.min(Number(e.target.value), s.band.max), max: s.band.max }));
  $("#thrMax", tb)?.addEventListener("change", (e) => actions.setBand({ min: s.band.min, max: Math.max(Number(e.target.value), s.band.min) }));
  $("#routeSel", tb)?.addEventListener("change", (e) => actions.set({ route: e.target.value }));
  $("#routeMax", tb)?.addEventListener("change", (e) => actions.setBand({ min: null, max: Math.max(1, Math.min(60, Number(e.target.value))) / 100 }));
  $("#cityIn", tb)?.addEventListener("change", (e) => {
    const c = (app.content.cities ?? []).find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (c) actions.set({ twin: { lat: c.lat, lon: c.lon, name: c.name } });
  });
  $("#boxBtn", tb).addEventListener("click", () => { app.map.drawMode = !app.map.drawMode; renderToolbar(); if (app.map.drawMode) toast("Drag a box on the map"); });
  $("#pngBtn", tb).addEventListener("click", () => exportPlot(app));
  $("#linkBtn", tb).addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast("Copy the address bar"); } });
  updateFrame();
}
const round = (x, step) => Math.round(x / step) * step;
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
  if ((s.mode === "map" && s.layerView === "trend") || s.mode === "flow" || s.mode === "atlas" || s.mode === "lineup") return `${Math.floor(f.years[0])}–${Math.floor(f.years[f.n - 1])}`;
  return null;
}

// ---------------------------------------------------------------- figure title
export function renderLegend() {
  const s = app.state, R = app.R;
  if (!R.v) return;
  const el = $("#figTitle");
  const def = defOf(s.variable), u = unitsOf(s.variable);
  const where = R.region.type === "global" ? "Global" : R.region.name;
  let t;
  if (s.mode === "band") {
    const b = s.band;
    const thr = b.min != null && b.max != null ? `${fmtNum(b.min)} to ${fmtNum(b.max)} ${u}` : b.min != null ? `≥ ${fmtNum(b.min)} ${u}` : `≤ ${fmtNum(b.max)} ${u}`;
    t = `${def.name}: zone ${thr}`;
  } else if (s.mode === "map" && s.layerView === "trend") t = `${def.name}: linear trend per decade`;
  else if (s.mode === "flow") t = `${def.name}: climate velocity`;
  else if (s.mode === "route") t = `Sea ice fraction: ${R.route?.name ?? "route"}`;
  else if (s.mode === "twin") t = `Climate analog: ${R.home?.name ?? "selected point"}`;
  else if (s.mode === "lineup") t = `All fields: ${where}`;
  else if (s.mode === "atlas") t = `All fields: linear trend per decade`;
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
  } else if (scene.layer === 2 && R.flow) {
    const L = 10, s0 = R.flow.medianSpeed || 1, cap = R.flow.cap || 1, lc = Math.log(1 + cap / s0);
    bar(L, (k) => stepColor("speed", k, L), Array.from({ length: L + 1 }, (_, k) => fmtNum((Math.exp((k / L) * lc) - 1) * s0 * 10, 2)), `${code(s.variable)} CLIMATE VELOCITY  (km / decade)   arrows: direction of travel`);
  } else if (s.mode === "band") {
    const L = vs.levels, lo = vs.domain[0], hi = vs.domain[1], g = vs.gamma ?? 1;
    const at = (k) => lo + (hi - lo) * Math.pow(k / L, 1 / g);
    const split = x0 + (x1 - x0) * 0.62;
    bar(L, (k) => { const v = Math.round((0.96 + (0.6 - 0.96) * (k + 0.5) / L) * 255); return `rgb(${v},${v},${v})`; }, Array.from({ length: L + 1 }, (_, k) => fmtNum(at(k), 2)), `${code(s.variable)}  (${unitsOf(s.variable)})`, x0, split - 16);
    if (s.showRings) {
      const yrs = app.frames.years;
      const bins = 10, n = yrs.length;
      const labels = Array.from({ length: bins + 1 }, (_, k) => k === bins ? String(Math.floor(yrs[n - 1])) : String(Math.floor(yrs[Math.min(n - 1, Math.floor((k * n) / bins))])));
      bar(bins, (k) => stepColor("rings", k, bins), labels, "EDGE BY YEAR", split, x1);
    } else {
      const soft = zoneSoft(s.variable);
      const b = s.band, base = b.min ?? b.max, dir = b.min != null ? 1 : -1;
      bar(5, (k) => stepColor("zone", k, 5), Array.from({ length: 6 }, (_, k) => fmtNum(base + dir * (soft * k) / 5, 2)), `ZONE (${b.min != null ? "≥" : "≤"} ${fmtNum(base)})`, split, x1);
    }
  } else {
    const L = vs.levels, lo = vs.domain[0], hi = vs.domain[1], g = vs.gamma ?? 1;
    const at = (k) => lo + (hi - lo) * Math.pow(k / L, 1 / g);
    bar(L, (k) => stepColor(vs.ramp, k, L), Array.from({ length: L + 1 }, (_, k) => fmtNum(at(k) * factor, 2)), `${code(s.variable)}  ${defOf(s.variable).name.toUpperCase()}  (${label})`);
  }
}

// ---------------------------------------------------------------- inspector
function inspectorSkeleton() {
  const el = $("#inspector");
  if ($("#iChart")) return;
  el.innerHTML = `
    <div class="isec" id="iHead"></div>
    <div class="isec" id="iA"></div>
    <div class="isec"><div class="ihdr" id="iChartHdr"></div><div class="chart-box" id="iChart"></div></div>
    <div class="isec" id="iB"></div>
    <div class="isec" id="iC"></div>`;
}

export function ensureChart() {
  inspectorSkeleton();
  if (app.chart || !app.C) return;
  app.chart = app.C.createChart($("#iChart"), { height: 150 });
  app.chart.onClick?.((year) => {
    const f = app.frames;
    if (!f) return;
    const k = f.years.findIndex((y) => Math.floor(y) >= year);
    if (k >= 0) { setPlaying(false); setTime(k); }
  });
}

const lamp = (cls, text) => `<span class="lamp ${cls}"><i></i>${text}</span>`;
const lampOf = (p) => (p < 0.05 ? "sig" : p < 0.1 ? "sug" : "");
const statusOf = (level, sentence = "") => `<span class="status ${level}" title="${esc(sentence)}">${level === "significant" ? "Significant" : level === "suggestive" ? "Suggestive" : "Not significant"}</span>`;

// Confidence-interval whisker: zero line, 95% range, estimate.
function ciPlot(est, lo, hi) {
  const m = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(est), 1e-9) * 1.15;
  const X = (v) => 8 + ((v + m) / (2 * m)) * 264;
  const fin = [est, lo, hi].every(Number.isFinite);
  return `<svg class="ciplot" viewBox="0 0 280 30" preserveAspectRatio="none">
    <line x1="8" y1="15" x2="272" y2="15" stroke="#c8c8c8"/>
    <line x1="${X(0)}" y1="5" x2="${X(0)}" y2="25" stroke="#666" stroke-dasharray="2 2"/>
    ${fin ? `<line x1="${X(lo)}" y1="15" x2="${X(hi)}" y2="15" stroke="#111" stroke-width="2"/>
    <line x1="${X(lo)}" y1="10" x2="${X(lo)}" y2="20" stroke="#111"/><line x1="${X(hi)}" y1="10" x2="${X(hi)}" y2="20" stroke="#111"/>
    <rect x="${X(est) - 3.5}" y="11.5" width="7" height="7" fill="#d62728" stroke="#111"/>` : ""}
    <text x="${X(0)}" y="29" fill="#666" font-size="8" text-anchor="middle" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">0</text>
  </svg>`;
}

// Detection gauge: record length vs years needed.
function gauge(det) {
  if (!det) return "";
  const n = det.nYears, ns = Number.isFinite(det.nStar) ? det.nStar : Infinity;
  const max = Math.max(n, Math.min(ns, 160)) * 1.08;
  const X = (v) => 4 + (Math.min(v, max) / max) * 272;
  const done = det.status === "detectable";
  return `<svg class="gauge" viewBox="0 0 280 34" preserveAspectRatio="none">
    <rect x="4" y="8" width="272" height="10" fill="#1f2125" stroke="#c8c8c8"/>
    <rect x="4" y="8" width="${X(n) - 4}" height="10" fill="${done ? "#1e8e3e" : "#9e9e9e"}"/>
    ${Number.isFinite(ns) && ns < 160 ? `<line x1="${X(ns)}" y1="3" x2="${X(ns)}" y2="23" stroke="#d62728" stroke-width="2"/>` : ""}
    <text x="4" y="31" fill="#555" font-size="9" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">n ${Math.round(n)} yr</text>
    <text x="276" y="31" fill="#d62728" font-size="9" text-anchor="end" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">n* ${Number.isFinite(ns) && ns < 999 ? Math.round(ns) : "∞"} yr</text>
  </svg>`;
}

function detectionBlock(det) {
  if (!det || !app.A) return "";
  const r = det.status === "detectable" ? `detectable since ~${det.etaYear}` : det.status === "never" ? "not this century" : `~${det.etaYear}`;
  return `<div class="ihdr">Detection <span class="r">${r}</span></div>${gauge(det)}`;
}

export function renderInspector() {
  inspectorSkeleton();
  const s = app.state, R = app.R;
  if (!R.v) return;
  const def = defOf(s.variable);
  const { factor, label } = dispUnits(s.variable);
  const yrs = `${R.annual.years[0] ?? ""}–${R.annual.years.at(-1) ?? ""}`;
  $("#iHead").innerHTML = `<div class="field-name">${esc(def.name)} <span class="info" title="${esc(def.plain + " " + def.why)}">i</span></div>
    <div class="field-sub">${esc(code(s.variable))} · ${esc(R.region.name)} · ${seasonCode(s.months)} · ${yrs}</div>`;
  const A = $("#iA"), B = $("#iB"), C = $("#iC"), ch = $("#iChartHdr");
  let spec = null;
  B.hidden = false; C.hidden = false;

  if (s.mode === "band" && R.bandSummary) {
    const bs = R.bandSummary, km = bs.edgeShiftKmPerDecade;
    A.innerHTML = `<div class="ihdr">Edge shift <span class="r">${esc(bs.kind)}</span></div>
      <div class="big"><span class="n">${signed(km, 2)}</span><span class="u">km/dec ${Number.isFinite(km) ? (km >= 0 ? "poleward" : "equatorward") : ""}</span></div>
      <div class="big" style="margin-top:6px"><span class="n" style="font-size:17px">${signed(bs.areaPctPerDecade, 2)}</span><span class="u">% area/dec</span></div>
      <div class="lamps">${lamp(lampOf(bs.edgeP), `edge ${pTxt(bs.edgeP)}`)}${lamp(lampOf(bs.areaP), `area ${pTxt(bs.areaP)}`)}<span>n ${R.track.years.length}</span></div>
      ${statusOf(bs.level, bs.sentence)}`;
    const kind = s.chartKind === "area" ? "area" : "edge";
    ch.innerHTML = `<span>${kind === "edge" ? "Edge latitude" : "Zone area"}</span><span class="seg"><button data-ck="edge" class="${kind === "edge" ? "on" : ""}">Edge</button><button data-ck="area" class="${kind === "area" ? "on" : ""}">Area</button></span>`;
    spec = kind === "edge"
      ? { kind: "series", years: R.track.years, values: R.bandSummary.edgeMeanLat, units: "°lat", fit: true, color: "#1a1a1a", format: (v) => `${fmtNum(Math.abs(v), 3)}°${v >= 0 ? "N" : "S"}`, emptyText: "edge not traceable" }
      : { kind: "series", years: R.track.years, values: R.track.areaKm2.map((a) => a / 1e6), units: "M km²", fit: true, color: "#1a1a1a", format: (v) => `${fmtNum(v, 3)} M km²` };
    B.innerHTML = detectionBlock(R.edgeDetection);
    if (R.dipole) {
      const st = R.dipole.stats;
      C.innerHTML = `<div class="ihdr">Arrived / left <span class="r">${R.dipole.early.join("–")} → ${R.dipole.late.join("–")}</span></div>${dipoleBars(st, factor, label)}`;
    } else C.hidden = true;
  } else if (s.mode === "route" && R.routeVerdict) {
    const vd = R.routeVerdict, ro = R.routeOpen;
    A.innerHTML = `<div class="ihdr">Open months <span class="r">${esc(R.route.name)}</span></div>
      <div class="big"><span class="n">${signed(vd.perDecade, 2)}</span><span class="u">months/dec</span></div>
      ${ciPlot(vd.perDecade, vd.ci95PerDecade[0], vd.ci95PerDecade[1])}
      <div class="lamps">${lamp(lampOf(vd.pT), `t ${pTxt(vd.pT)}`)}${lamp(lampOf(vd.pMK), `MK ${pTxt(vd.pMK)}`)}<span>n ${vd.n}</span></div>${statusOf(vd.level, vd.sentence.replace(/percentage points/g, "months"))}`;
    ch.innerHTML = `<span>Open months per year</span><span class="r">${monthsLabel(ro.months)}</span>`;
    spec = { kind: "bars", years: ro.years, values: ro.openMonths, max: ro.months.length, units: "mo", fit: true, color: "#1f6fb2", format: (v) => `${v}/${ro.months.length} mo` };
    B.innerHTML = detectionBlock(R.routeDetection);
    const first = ro.years.find((y, k) => ro.openMonths[k] > 0);
    C.innerHTML = `<div class="kv"><span>First open year</span><b>${first ?? "never"}</b><span>${ro.years[0]}–${ro.years[9]}</span><b>${fmtNum(avg(ro.openMonths.slice(0, 10)), 2)} mo</b><span>${ro.years.at(-10)}–${ro.years.at(-1)}</span><b>${fmtNum(avg(ro.openMonths.slice(-10)), 2)} mo</b><span>Choke point</span><b>${ro.chokePoint ? `${fmtNum(ro.chokePoint[0], 3)}N ${fmtNum(Math.abs(ro.chokePoint[1]), 3)}${ro.chokePoint[1] >= 0 ? "E" : "W"}` : "–"}</b></div>`;
  } else if (s.mode === "flow" && R.flowSummary) {
    const fs = R.flowSummary;
    A.innerHTML = `<div class="ihdr">Climate velocity <span class="r">median</span></div>
      <div class="flex"><div><div class="big"><span class="n">${fmtNum(fs.medianKmPerDecade, 2)}</span><span class="u">km/dec</span></div>
      <div class="kv" style="margin-top:8px"><span>Mean</span><b>${fmtNum(fs.meanKmPerDecade, 2)}</b><span>Global median</span><b>${fmtNum(R.flow.medianSpeed * 10, 2)}</b>${R.flowLand ? `<span>Land median</span><b>${fmtNum(R.flowLand.medianKmPerDecade, 2)}</b>` : ""}<span>m / day</span><b>${fmtNum((fs.medianKmPerDecade * 1000) / 3652.5, 2)}</b></div></div>
      ${compass(fs.bearingDeg, fs.coherence)}</div>`;
    ch.innerHTML = `<span>${esc(code(s.variable))} regional mean</span>`;
    spec = seriesSpec(s, R, factor, label);
    B.innerHTML = detectionBlock(R.detection);
    C.hidden = true;
  } else if (s.mode === "twin" && R.twin) {
    const tw = R.twin, h = R.home, tn = tw.thenNow, nw = tw.nowWas;
    const near = (p) => nearestCityName(app, p.lat, p.lon, 450);
    A.innerHTML = `<div class="ihdr">${esc(h.name ?? "Location")} 1980s climate now <span class="r">${tn.quality}</span></div>
      <div class="big"><span class="n">${tn.found === false || !Number.isFinite(tn.distKm) ? "none" : fmtNum(tn.distKm, 2)}</span><span class="u">${Number.isFinite(tn.distKm) ? `km ${esc(tn.bearingName)}` : ""}</span></div>
      ${near(tn) ? `<div class="field-sub">near ${esc(near(tn))}</div>` : ""}
      <div class="ihdr" style="margin-top:10px">Today's climate in the 1980s <span class="r">${nw.quality}</span></div>
      <div class="big"><span class="n" style="font-size:17px">${Number.isFinite(nw.distKm) ? fmtNum(nw.distKm, 2) : "none"}</span><span class="u">${Number.isFinite(nw.distKm) ? `km ${esc(nw.bearingName)}` : ""}</span></div>
      ${near(nw) ? `<div class="field-sub">near ${esc(near(nw))}</div>` : ""}`;
    ch.innerHTML = `<span>Monthly T2M cycle</span><span class="r">${tw.periods.base.join("–")} vs ${tw.periods.recent.join("–")}</span>`;
    spec = twinSeasonal(R);
    const d = tw.home.drift;
    B.innerHTML = `<table class="tbl"><thead><tr><th></th><th>${tw.periods.base[0]}s</th><th>now</th><th>Δ</th></tr></thead><tbody>
      ${row("T mean °C", h.then?.tMean ?? tw.home.then.tMean, tw.home.now.tMean)}
      ${row("T range °C", tw.home.then.tRange, tw.home.now.tRange)}
      ${row("Precip mm/d", tw.home.then.pMean, tw.home.now.pMean)}</tbody></table>`;
    C.hidden = true;
  } else if (s.mode === "lineup" && R.lineup) {
    A.innerHTML = trendBlock(R, factor, label);
    ch.innerHTML = `<span>Evidence by field</span><span class="r">t statistic</span>`;
    spec = null;
    B.innerHTML = lineupBars(R.lineup);
    C.hidden = true;
  } else if (s.mode === "atlas" && R.atlas) {
    A.innerHTML = `<div class="ihdr">Area with significant trend <span class="r">${seasonCode(s.months)}</span></div>${atlasCensus(R.atlas)}`;
    ch.innerHTML = `<span>${esc(code(s.variable))} global mean</span>`;
    spec = seriesSpec(s, R, factor, label);
    B.hidden = true; C.hidden = true;
  } else {
    A.innerHTML = R.empty ? `<div class="def">No data in this region.</div>` : trendBlock(R, factor, label);
    const kind = ["trend", "stripes", "seasons"].includes(s.chartKind) ? s.chartKind : "trend";
    ch.innerHTML = `<span>${kind === "trend" ? "Annual series" : kind === "stripes" ? "Anomaly stripes" : "Seasonal cycle"}</span><span class="seg"><button data-ck="trend" class="${kind === "trend" ? "on" : ""}">Series</button><button data-ck="stripes" class="${kind === "stripes" ? "on" : ""}">Stripes</button><button data-ck="seasons" class="${kind === "seasons" ? "on" : ""}">Cycle</button></span>`;
    spec = R.empty ? { kind: "series", years: [], values: [], emptyText: "no data" } : kind === "trend" ? seriesSpec(s, R, factor, label) : kind === "stripes" ? { kind: "stripes", years: R.annual.years, values: R.annual.values, units: unitsOf(s.variable), palette: varStyle(s.variable).trend === "heat" ? "temp" : varStyle(s.variable).trend === "wet" ? "wet" : "ice" } : seasonalSpec(R);
    B.innerHTML = detectionBlock(R.detection);
    if (s.mode === "map" && R.tmap) {
      const cz = census(R.tmap, R.v.entry.grid, R.region);
      C.innerHTML = `<div class="ihdr">Area <span class="r">p &lt; 0.05</span></div>${censusBar(cz)}`;
    } else C.hidden = true;
  }
  ch.querySelectorAll("[data-ck]").forEach((b) => b.addEventListener("click", () => actions.set({ chartKind: b.dataset.ck })));
  B.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => actions.set({ mode: "series", variable: b.dataset.var })));
  const chartSec = $("#iChart").parentElement;
  chartSec.hidden = !spec;
  if (app.chart && spec) {
    spec.cursorYear = Math.floor(frameYear(app.t));
    app.chart.update(spec);
  }
}

function seriesSpec(s, R, factor, label) {
  const det = R.detection;
  const pending = det && det.status === "pending" && det.etaYear < 2100;
  let monthly = null;
  if (s.showMonthly) {
    const src = s.deseason ? R.ds : R.rs;
    const sel = new Set(s.months);
    const x = [], vals = [];
    src.t.forEach((t, k) => { if (sel.has(Number(t.slice(5, 7)))) { x.push(Number(t.slice(0, 4)) + (Number(t.slice(5, 7)) - 0.5) / 12); vals.push(src.values[k]); } });
    // Anomalies are drawn around the annual mean so both share one axis.
    const off = s.deseason ? meanOf(Array.from(R.annual.values)) - meanOf(vals) : 0;
    monthly = { x, values: vals.map((v) => v + off) };
  }
  return { kind: "series", years: R.annual.years, values: R.annual.values, monthly, units: unitsOf(s.variable), fit: true, color: "#1a1a1a", format: (v) => `${fmtNum(v * factor, 3)} ${label}`, extendTo: pending ? Math.max(det.etaYear + 2, R.annual.years.at(-1) + 5) : undefined, markers: pending ? [{ year: det.etaYear, label: `detectable ~${det.etaYear}`, color: "#d62728" }] : [] };
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

function trendBlock(R, factor, label) {
  const vd = R.verdict;
  return `<div class="ihdr">Trend <span class="r">OLS · 95%</span></div>
    <div class="big"><span class="n">${signed(vd.perDecade * factor, 2)}</span><span class="u">${esc(label)}/dec</span></div>
    ${ciPlot(vd.perDecade * factor, vd.ci95PerDecade[0] * factor, vd.ci95PerDecade[1] * factor)}
    <div class="lamps">${lamp(lampOf(vd.pT), `t ${pTxt(vd.pT)}`)}${lamp(lampOf(vd.pMK), `MK ${pTxt(vd.pMK)}`)}<span>n ${vd.n}</span></div>
    ${statusOf(vd.level, vd.sentence)}`;
}

const row = (lab, a, b) => `<tr><td>${lab}</td><td>${fmtNum(a, 3)}</td><td>${fmtNum(b, 3)}</td><td class="${b - a > 0 ? "up" : "down"}">${signed(b - a, 2)}</td></tr>`;
const meanOf = (a) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : 0; };
const avg = (a) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : NaN; };

function dipoleBars(st, factor, label) {
  const a = st.arrived.meanPerDecade * factor, l = st.left.meanPerDecade * factor;
  const m = Math.max(Math.abs(a) || 0, Math.abs(l) || 0, 1e-9) * 1.1;
  const X = (v) => 140 + (v / m) * 120;
  const bar = (y, v, col, name, area, frac) => Number.isFinite(v) && area > 0
    ? `<rect x="${Math.min(140, X(v))}" y="${y}" width="${Math.abs(X(v) - 140)}" height="14" fill="${col}"/><text x="4" y="${y + 11}" fill="#555" font-size="10">${name}</text><text x="276" y="${y + 11}" fill="#111" font-size="10" text-anchor="end">${signed(v, 2)}</text>`
    : `<text x="4" y="${y + 11}" fill="#999" font-size="10">${name}</text><text x="276" y="${y + 11}" fill="#999" font-size="10" text-anchor="end">none</text>`;
  return `<svg class="mini" viewBox="0 0 280 54" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <line x1="140" y1="2" x2="140" y2="40" stroke="#888" stroke-dasharray="2 2"/>
    ${bar(4, a, "#d81b1b", "arrived", st.arrived.areaKm2, st.arrived.fracSignificant)}
    ${bar(24, l, "#2a66e0", "left", st.left.areaKm2, st.left.fracSignificant)}
    <text x="140" y="52" fill="#777" font-size="9" text-anchor="middle">${esc(label)}/dec</text></svg>`;
}

function compass(bearing, coherence) {
  const ok = Number.isFinite(bearing) && (coherence ?? 1) > 0.2;
  const len = ok ? 12 + 26 * Math.min(1, coherence ?? 1) : 0;
  const a = ((bearing ?? 0) - 90) * Math.PI / 180;
  const x = 46 + Math.cos(a) * len, y = 46 + Math.sin(a) * len;
  return `<svg class="compass" viewBox="0 0 92 92" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <circle cx="46" cy="46" r="38" fill="none" stroke="#c8c8c8"/>
    ${[0, 90, 180, 270].map((d) => { const r = (d - 90) * Math.PI / 180; return `<line x1="${46 + Math.cos(r) * 34}" y1="${46 + Math.sin(r) * 34}" x2="${46 + Math.cos(r) * 38}" y2="${46 + Math.sin(r) * 38}" stroke="#888"/>`; }).join("")}
    <text x="46" y="7" fill="#333" font-size="8" text-anchor="middle">N</text><text x="89" y="49" fill="#666" font-size="8" text-anchor="end">E</text>
    ${ok ? `<line x1="46" y1="46" x2="${x}" y2="${y}" stroke="#d62728" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="3" fill="#d62728"/>` : `<text x="46" y="50" fill="#777" font-size="9" text-anchor="middle">mixed</text>`}
    <circle cx="46" cy="46" r="2" fill="#111"/></svg>`;
}

function lineupBars(list) {
  const items = list.filter((x) => !x.empty);
  const m = Math.max(...items.map((x) => Math.abs(x.tStat) || 0), 3) * 1.05;
  const rowH = 17;
  const X = (v) => 150 + (v / m) * 110;
  return `<svg class="mini" viewBox="0 0 280 ${items.length * rowH + 14}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" style="cursor:pointer">
    <line x1="150" y1="0" x2="150" y2="${items.length * rowH}" stroke="#888"/>
    ${[-2, 2].map((t) => `<line x1="${X(t)}" y1="0" x2="${X(t)}" y2="${items.length * rowH}" stroke="#c8c8c8" stroke-dasharray="2 2"/>`).join("")}
    ${items.map((x, k) => {
      const y = k * rowH, t = x.tStat || 0;
      const col = x.verdict.level === "significant" ? (t > 0 ? "#d6604d" : "#4393c3") : x.verdict.level === "suggestive" ? "#d08a00" : "#c8c8c8";
      return `<g data-var="${x.id}"><rect x="0" y="${y}" width="280" height="${rowH}" fill="transparent"/>
        <text x="4" y="${y + 12}" fill="#222" font-size="10">${esc(varStyle(x.id).code)}</text>
        <rect x="${Math.min(150, X(t))}" y="${y + 3}" width="${Math.abs(X(t) - 150)}" height="${rowH - 6}" fill="${col}"/>
        <text x="${t >= 0 ? 276 : 92}" y="${y + 12}" fill="#555" font-size="9.5" text-anchor="end">${fmtNum(t, 2)}</text></g>`;
    }).join("")}
    <text x="${X(2)}" y="${items.length * rowH + 11}" fill="#777" font-size="8.5" text-anchor="middle">|t|=2</text></svg>`;
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

function censusBar(cz, w = 272) {
  const a = cz.down * w, b = cz.flat * w, c = cz.up * w;
  return `<svg class="mini" viewBox="0 0 280 30" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <rect x="4" y="2" width="${a}" height="12" fill="#4393c3"/><rect x="${4 + a}" y="2" width="${b}" height="12" fill="#dcdcdc"/><rect x="${4 + a + b}" y="2" width="${c}" height="12" fill="#d6604d"/>
    <text x="4" y="26" fill="#1f6fb2" font-size="9.5">${Math.round(cz.down * 100)}% ↓</text><text x="140" y="26" fill="#555" font-size="9.5" text-anchor="middle">${Math.round(cz.flat * 100)}% n.s.</text><text x="276" y="26" fill="#c0392b" font-size="9.5" text-anchor="end">${Math.round(cz.up * 100)}% ↑</text></svg>`;
}

function atlasCensus(items) {
  const rows = items.map((it) => ({ id: it.id, ...census(it.tm, it.v.entry.grid, null) }));
  return rows.map((r) => `<div style="display:grid;grid-template-columns:62px 1fr;align-items:center;gap:6px;margin:2px 0"><span style="font-size:11px;color:#222">${esc(varStyle(r.id).code)}</span>
    <svg viewBox="0 0 200 8" preserveAspectRatio="none" style="width:100%;height:8px"><rect width="${r.down * 200}" height="8" fill="#4393c3"/><rect x="${r.down * 200}" width="${r.flat * 200}" height="8" fill="#dcdcdc"/><rect x="${(r.down + r.flat) * 200}" width="${r.up * 200}" height="8" fill="#d6604d"/></svg></div>`).join("");
}

// ---------------------------------------------------------------- status bar
export function renderStatus() {
  const R = app.R;
  if (!R.v) return;
  const e = R.v.entry, g = e.grid;
  $("#statusbar").innerHTML = `<span id="stCursor">—</span><span id="stFrame"></span><span>${esc(e.source.split(",")[0])} · ${g.dlat}°×${g.dlon}° · ${(g.nlat * g.nlon).toLocaleString("en-US")} cells × ${e.nt} mo</span><span id="stMeter"></span><span>Code written with Claude, reviewed by the team · not affiliated with NASA</span>`;
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
  parts.push(`${code(s.variable)} ${Number.isFinite(val) ? fmtNum(val * factor, 3) + " " + label : "—"}`);
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
