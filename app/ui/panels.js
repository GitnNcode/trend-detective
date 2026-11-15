// DOM rendering for the mode tabs, the question panel (left), the evidence
// panel (right), the map HUD (title, tools, legend, data meter) and the hover
// tooltip. Written with Claude and reviewed by the team.

import * as E from "../../engine/index.js";
import * as D from "../data.js";
import { ICONS } from "./icons.js";
import { VARS, varStyle, rampCss, trendRamp, rampColor } from "../palettes.js";
import { actions, MODES, regionOf, monthsLabel, defOf, unitsOf, frameYear, setTime } from "../main.js";
import { exportCaseFile } from "./export.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const SEASONS = [["Year", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], ["DJF", [12, 1, 2]], ["MAM", [3, 4, 5]], ["JJA", [6, 7, 8]], ["SON", [9, 10, 11]]];

export function fmtNum(x, sig = 3) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 1 : 2) + " M";
  if (a >= 1e4) return Math.round(x).toLocaleString("en-US");
  return E.fmt(x, sig);
}
const signed = (x, sig = 2) => (Number.isFinite(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + fmtNum(Math.abs(x), sig) : "–");

function dispUnits(id) {
  const u = unitsOf(id);
  return E.displayUnits(u);
}

// ---------- mode tabs ----------
export function renderModeTabs(app) {
  const nav = $("#modeTabs");
  nav.innerHTML = MODES.map((m) => `<button class="mode-tab ${m.star ? "star" : ""}" data-mode="${m.id}" title="${esc(m.hint)}">${ICONS[m.icon]}<span>${m.label}</span></button>`).join("");
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".mode-tab");
    if (b) actions.setMode(b.dataset.mode);
  });
}

function syncTabs(app) {
  document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === app.state.mode));
}

// ---------- chart ----------
export function ensureChart(app) {
  if (app.chart || !app.C) return;
  buildRightSkeleton();
  app.chart = app.C.createChart($("#evChart"), { height: 200 });
  app.chart.onClick?.((year) => {
    const f = app.frames;
    if (!f) return;
    const k = f.years.findIndex((y) => Math.floor(y) >= year);
    if (k >= 0) setTime(k);
  });
}

function buildRightSkeleton() {
  const rp = $("#rightPanel");
  if ($("#evChart")) return;
  rp.innerHTML = `
    <div class="ev-head" id="evHead"></div>
    <div class="pad">
      <div class="card verdict" id="evVerdict"></div>
      <div class="card" id="evChartCard"><div class="ct" id="evChartHead"></div><div class="chart-wrap" id="evChart"></div><div class="hint" id="evChartNote"></div></div>
      <div class="card" id="evClock"></div>
      <div class="card" id="evInsight"></div>
      <div class="export-row">
        <button class="btn primary" id="exportBtn">${ICONS.download.replace("<svg", '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2"')} Export case file</button>
        <button class="btn" id="linkBtn" title="Copy a link to this exact investigation">Copy link</button>
      </div>
    </div>`;
  $("#exportBtn").addEventListener("click", () => exportCaseFile(window.TD));
  $("#linkBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied. It reopens this exact investigation."); } catch { toast(location.href); }
  });
}

// ---------- everything ----------
export function renderAll(app) {
  syncTabs(app);
  renderLeft(app);
  buildRightSkeleton();
  renderRight(app);
  renderHud(app);
  renderTools(app);
  renderLegend(app);
  renderDataHud(app);
}

// ---------- left panel ----------
function renderLeft(app) {
  const s = app.state, c = app.content;
  const lp = $("#leftPanel");
  const region = regionOf(s);
  const modeDef = MODES.find((m) => m.id === s.mode);
  const qs = c.usecases;
  const rel = qs.filter((q) => q.mode === s.mode);
  const others = qs.filter((q) => q.mode !== s.mode);
  const ordered = [...rel, ...others];
  const showAll = app._showAllQ;
  const list = showAll ? ordered : ordered.slice(0, 4);
  const def = defOf(s.variable);
  const vs = varStyle(s.variable);

  lp.innerHTML = `
    <div class="section">
      <p class="eyebrow"><span class="num">01</span> The question <span class="rule"></span></p>
      <h2 class="h-display">${s.prompt ? esc(s.prompt) : `${esc(modeDef.hint)}.`}</h2>
      <div class="qgroup">
        ${list.map((q, k) => `<button class="q ${q.prompt === s.prompt ? "on" : ""} ${q.isNew ? "new" : ""}" data-q="${qs.indexOf(q)}">
          <span class="qi">${ICONS[q.mode] ?? ICONS.series}</span>
          <span><div class="qt">${esc(q.prompt)}</div><div class="qm">${esc(VARS[q.variable]?.short ?? q.variable)} · ${esc(regionName(c, q.region))} · ${esc(monthsLabel(q.months ?? [1,2,3,4,5,6,7,8,9,10,11,12]))}</div></span>
        </button>`).join("")}
        ${ordered.length > 4 ? `<button class="btn ghost small" id="moreQ">${showAll ? "Show fewer" : `Show all ${ordered.length} questions`}</button>` : ""}
      </div>
    </div>
    ${modeControls(app)}
    <div class="section">
      <p class="eyebrow"><span class="num">03</span> The suspect variable <span class="rule"></span></p>
      <div class="vars">
        ${app.catalog.variables.map((v) => {
          const st = varStyle(v.id);
          const disabled = (s.mode === "route" && v.id !== "seaice");
          return `<button class="var ${v.id === s.variable ? "on" : ""}" data-var="${v.id}" ${disabled ? "disabled style=\"opacity:.35\"" : ""} title="${esc(defOf(v.id).plain)}">
            <span class="sw" style="background:${rampCss(st.ramp, { dir: "135deg" })}"></span>
            <span><span class="vn">${esc(st.short)}</span><span class="vu">${esc(v.units)}</span></span>
          </button>`;
        }).join("")}
      </div>
      <div class="defbox"><b>${esc(def.name)}.</b> ${esc(def.plain)}<div class="why">Why it might trend: ${esc(def.why)}</div></div>
    </div>
    <div class="section">
      <p class="eyebrow"><span class="num">04</span> The scene <span class="rule"></span></p>
      <div class="label">Region</div>
      <div class="row">
        <select class="select" id="regionSel">
          ${s.custom ? `<option value="custom" selected>Your drawn region</option>` : ""}
          ${groupRegions(c.regions).map(([type, rs]) => `<optgroup label="${esc(type)}">${rs.map((r) => `<option value="${r.id}" ${!s.custom && r.id === s.regionId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <button class="btn icon ${app.map.drawMode ? "active" : ""}" id="drawBtn" title="Draw your own region on the map (or hold Shift and drag)">${ICONS.draw.replace("<svg", '<svg style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8"')}</button>
      </div>
      <p class="hint">${esc(region.name)} · ${fmtBox(region)}${region.type && region.type !== "custom" ? ` · ${esc(region.type)}` : ""}</p>
      <div class="label" style="margin-top:12px">Season <b>${esc(monthsLabel(s.months))}</b></div>
      <div class="months">${MONTH_LETTERS.map((l, k) => `<button data-m="${k + 1}" class="${s.months.includes(k + 1) ? "on" : ""}" title="${["January","February","March","April","May","June","July","August","September","October","November","December"][k]}">${l}</button>`).join("")}</div>
      <div class="season-presets">${SEASONS.map(([n, m]) => `<button class="chip ${sameSet(m, s.months) ? "on" : ""}" data-season="${m.join(",")}">${n}</button>`).join("")}</div>
      ${s.mode !== "band" && s.mode !== "route" ? `<label class="row small muted" style="margin-top:10px;gap:6px"><input type="checkbox" id="deseason" ${s.deseason ? "checked" : ""}/> Remove the seasonal cycle before testing</label>` : ""}
    </div>
    <div class="section">
      <p class="eyebrow"><span class="num">05</span> Case files <span class="rule"></span></p>
      <div class="case-cards">
        ${c.cases.map((cs) => `<button class="case-card" data-case="${cs.id}"><span class="play">▶</span><div class="ct">${esc(cs.title)}</div><div class="cm">${cs.steps.length} STEPS${cs.isNew ? " · NEW" : ""}</div></button>`).join("")}
      </div>
    </div>`;

  lp.querySelectorAll(".q[data-q]").forEach((b) => b.addEventListener("click", () => {
    const q = qs[Number(b.dataset.q)];
    actions.applyAction(q, q.prompt);
  }));
  $("#moreQ", lp)?.addEventListener("click", () => { app._showAllQ = !app._showAllQ; renderLeft(app); });
  lp.querySelectorAll(".var[data-var]").forEach((b) => b.addEventListener("click", () => actions.setVariable(b.dataset.var)));
  $("#regionSel", lp).addEventListener("change", (e) => { if (e.target.value !== "custom") actions.setRegion(e.target.value); });
  $("#drawBtn", lp).addEventListener("click", () => {
    app.map.drawMode = !app.map.drawMode;
    $("#map").classList.toggle("drawing", app.map.drawMode);
    toast(app.map.drawMode ? "Drag a box on the map to set your own region." : "Drawing cancelled.");
    renderLeft(app);
  });
  lp.querySelectorAll(".months button").forEach((b) => b.addEventListener("click", () => {
    const m = Number(b.dataset.m);
    const set = new Set(s.months.length === 12 ? [] : s.months);
    set.has(m) ? set.delete(m) : set.add(m);
    actions.setMonths([...set].sort((a, b2) => a - b2));
  }));
  lp.querySelectorAll("[data-season]").forEach((b) => b.addEventListener("click", () => actions.setMonths(b.dataset.season.split(",").map(Number))));
  $("#deseason", lp)?.addEventListener("change", (e) => actions.set({ deseason: e.target.checked }));
  lp.querySelectorAll("[data-case]").forEach((b) => b.addEventListener("click", () => app.cases.start(b.dataset.case)));
  bindModeControls(app, lp);
}

function regionName(c, id) { return c.regions.find((r) => r.id === id)?.name ?? id ?? ""; }
function sameSet(a, b) { return a.length === b.length && a.every((x) => b.includes(x)); }
function fmtBox(r) {
  const la = (x) => `${Math.abs(x)}°${x >= 0 ? "N" : "S"}`;
  const lo = (x) => `${Math.abs(x)}°${x >= 0 ? "E" : "W"}`;
  if (r.lonMax - r.lonMin >= 359) return `${la(r.latMin)} to ${la(r.latMax)}`;
  return `${la(r.latMin)}–${la(r.latMax)}, ${lo(r.lonMin)}–${lo(r.lonMax)}`;
}
function groupRegions(regions) {
  const m = new Map();
  for (const r of regions) { const t = r.type ?? "other"; if (!m.has(t)) m.set(t, []); m.get(t).push(r); }
  return [...m.entries()];
}

function modeControls(app) {
  const s = app.state, R = app.R;
  if (s.mode === "band") {
    const vs = varStyle(s.variable);
    const u = unitsOf(s.variable);
    const b = s.band;
    const which = b.min != null && b.max != null ? "between" : b.min != null ? "above" : "below";
    const val = which === "below" ? b.max : b.min;
    const dom = vs.domain;
    return `<div class="section">
      <p class="eyebrow"><span class="num">02</span> Shift: pick the value to follow <span class="rule"></span></p>
      <div class="seg bandmode" id="bandWhich">
        <button data-w="above" class="${which === "above" ? "on" : ""}">At or above</button>
        <button data-w="below" class="${which === "below" ? "on" : ""}">At or below</button>
        <button data-w="between" class="${which === "between" ? "on" : ""}">Between</button>
      </div>
      <div class="thresh">
        <canvas class="hist" id="histCanvas"></canvas>
        ${which === "between" ? `
          <div class="label">From <b>${fmtNum(b.min)} ${esc(u)}</b></div>
          <input type="range" class="range" id="thrMin" min="${dom[0]}" max="${dom[1]}" step="${vs.step}" value="${b.min}">
          <div class="label">To <b>${fmtNum(b.max)} ${esc(u)}</b></div>
          <input type="range" class="range" id="thrMax" min="${dom[0]}" max="${dom[1]}" step="${vs.step}" value="${b.max}">` : `
          <div class="label">Threshold <b>${fmtNum(val)} ${esc(u)}</b></div>
          <input type="range" class="range" id="thrOne" min="${dom[0]}" max="${dom[1]}" step="${vs.step}" value="${val}">`}
        <div class="thresh-legend"><span><i style="background:#4cc9ff"></i>${R.dist ? `${R.dist.periods?.early?.join?.("–") ?? "first decade"}` : "first decade"}</span><span><i style="background:#ff8a3d"></i>${R.dist ? `${R.dist.periods?.late?.join?.("–") ?? "last decade"}` : "last decade"}</span><span>${R.dist && Number.isFinite(R.dist.shift) ? `mean ${signed(R.dist.shift)} ${esc(u)}` : ""}</span></div>
      </div>
      <p class="hint">The orange zone is every place where the ${esc(defOf(s.variable).name.toLowerCase())} is ${which === "between" ? `between ${fmtNum(b.min)} and ${fmtNum(b.max)}` : `${which === "above" ? "at or above" : "at or below"} ${fmtNum(val)}`} ${esc(u)} that year. Press play and watch it travel.</p>
      <div class="row wrap" style="margin-top:10px">
        <button class="chip ${s.showTrail ? "on" : ""}" data-tog="showTrail">Ghost trail</button>
        <button class="chip ${s.showFirst ? "on" : ""}" data-tog="showFirst">1980 outline</button>
        <button class="chip ${s.showTrack ? "on" : ""}" data-tog="showTrack">Track + cone</button>
        <button class="chip ${s.showRings ? "on" : ""}" data-tog="showRings">Tree rings</button>
        <button class="chip ${s.showDipole ? "on" : ""}" data-tog="showDipole">Arrived vs left</button>
      </div>
    </div>`;
  }
  if (s.mode === "route") {
    return `<div class="section">
      <p class="eyebrow"><span class="num">02</span> The route <span class="rule"></span></p>
      <div class="row wrap">${app.content.routes.filter((r) => r.id !== "nyc_lon").map((r) => `<button class="chip ${r.id === s.route ? "on" : ""}" data-route="${r.id}">${esc(r.name)}</button>`).join("")}</div>
      <div class="label" style="margin-top:12px">Open water means ice at most <b>${Math.round((s.band.max ?? 0.15) * 100)}%</b></div>
      <input type="range" class="range" id="routeMax" min="0.05" max="0.5" step="0.01" value="${s.band.max ?? 0.15}">
      <p class="hint">A month counts as open only if every point along the route is open water. Land cells are ignored. The grid is about 110 km, so narrow straits are approximate.</p>
    </div>`;
  }
  if (s.mode === "twin") {
    const cities = app.content.cities ?? [];
    const pop = ["Chicago", "Phoenix", "Madrid", "Paris", "Moscow", "Delhi", "Beijing", "Tokyo", "Lagos", "São Paulo", "Sydney", "Mexico City"].map((n) => cities.find((c) => c.name === n)).filter(Boolean);
    return `<div class="section">
      <p class="eyebrow"><span class="num">02</span> Your hometown <span class="rule"></span></p>
      <div class="searchbox">
        <input class="text" id="citySearch" placeholder="Search a city…" autocomplete="off" />
        <div class="results" id="cityResults" hidden></div>
      </div>
      <div class="city-chips">${pop.map((c) => `<button class="chip ${s.twin?.name === c.name ? "on" : ""}" data-city="${esc(c.name)}">${esc(c.name)}</button>`).join("")}</div>
      <p class="hint">Or click anywhere on land. We compare the 1980s climate (temperature, seasonal swing, rainfall) with the last decade and look for where each one lives now.</p>
    </div>`;
  }
  if (s.mode === "flow") {
    return `<div class="section">
      <p class="eyebrow"><span class="num">02</span> Climate flow <span class="rule"></span></p>
      <p class="insight">Each streak shows which way and how fast the <strong>${esc(defOf(s.variable).name.toLowerCase())}</strong> you have today is moving across the map. Brighter, faster streaks mean you would have to travel farther each decade to keep the same value.</p>
      <p class="hint">Climate velocity = trend over time ÷ how quickly the value changes across space (Loarie et al., 2009). Flat places (oceans, plains) can have very fast velocities even when the trend is small.</p>
    </div>`;
  }
  if (s.mode === "lineup" || s.mode === "atlas") {
    return `<div class="section">
      <p class="eyebrow"><span class="num">02</span> ${s.mode === "lineup" ? "Lineup" : "Planet scan"} <span class="rule"></span></p>
      <p class="insight">${s.mode === "lineup"
        ? `All ten variables are tested for <strong>${esc(regionOf(s).name)}</strong>, ${esc(monthsLabel(s.months))}. The strongest evidence stands first. Click a suspect to open its time series.`
        : `Every variable's trend in every grid cell, ${esc(monthsLabel(s.months))}. Faded areas are not significant. Click a map to open it.`}</p>
    </div>`;
  }
  return "";
}

function bindModeControls(app, lp) {
  const s = app.state;
  lp.querySelectorAll("[data-tog]").forEach((b) => b.addEventListener("click", () => actions.toggle(b.dataset.tog)));
  if (s.mode === "band") {
    const vs = varStyle(s.variable);
    $("#bandWhich", lp)?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const b = s.band;
      const cur = b.min ?? b.max ?? (vs.domain[0] + vs.domain[1]) / 2;
      if (btn.dataset.w === "above") actions.setBand({ min: cur, max: null });
      else if (btn.dataset.w === "below") actions.setBand({ min: null, max: cur });
      else {
        const span = (vs.domain[1] - vs.domain[0]) * 0.1;
        actions.setBand({ min: round(cur - span / 2, vs.step), max: round(cur + span / 2, vs.step) });
      }
    });
    const live = (fn) => (e) => {
      // Update the label while dragging; commit on release.
      const lab = e.target.previousElementSibling?.querySelector("b");
      if (lab) lab.textContent = `${fmtNum(Number(e.target.value))} ${unitsOf(s.variable)}`;
      if (e.type === "change") fn(Number(e.target.value));
    };
    for (const [id, fn] of [
      ["thrOne", (v) => actions.setBand(s.band.max != null ? { min: null, max: v } : { min: v, max: null })],
      ["thrMin", (v) => actions.setBand({ min: Math.min(v, s.band.max), max: s.band.max })],
      ["thrMax", (v) => actions.setBand({ min: s.band.min, max: Math.max(v, s.band.min) })],
    ]) {
      const el = $("#" + id, lp);
      if (el) { el.addEventListener("input", live(fn)); el.addEventListener("change", live(fn)); }
    }
    drawHistogram(app);
  }
  if (s.mode === "route") {
    lp.querySelectorAll("[data-route]").forEach((b) => b.addEventListener("click", () => actions.set({ route: b.dataset.route })));
    $("#routeMax", lp)?.addEventListener("change", (e) => actions.setBand({ min: null, max: Number(e.target.value) }));
    $("#routeMax", lp)?.addEventListener("input", (e) => { const l = e.target.previousElementSibling.querySelector("b"); if (l) l.textContent = Math.round(Number(e.target.value) * 100) + "%"; });
  }
  if (s.mode === "twin") {
    const input = $("#citySearch", lp), res = $("#cityResults", lp);
    const cities = app.content.cities ?? [];
    input?.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { res.hidden = true; return; }
      const hits = cities.filter((c) => c.name.toLowerCase().includes(q) || (c.country ?? "").toLowerCase().includes(q)).slice(0, 8);
      res.innerHTML = hits.map((c) => `<button data-city="${esc(c.name)}"><span>${esc(c.name)}</span><small>${esc(c.country ?? "")}</small></button>`).join("") || `<button disabled><span class="muted">No match. Click the map instead.</span></button>`;
      res.hidden = false;
    });
    lp.querySelectorAll("[data-city]").forEach((b) => b.addEventListener("click", () => pickCity(app, b.dataset.city)));
    res?.addEventListener("click", (e) => { const b = e.target.closest("[data-city]"); if (b) pickCity(app, b.dataset.city); });
  }
}

function pickCity(app, name) {
  const c = (app.content.cities ?? []).find((x) => x.name === name);
  if (c) actions.set({ twin: { lat: c.lat, lon: c.lon, name: c.name } });
}

const round = (x, step) => Math.round(x / step) * step;

function drawHistogram(app) {
  const cv = $("#histCanvas");
  const dist = app.R.dist;
  if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth || 280, h = cv.clientHeight || 70;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!dist || !dist.edges) return;
  const vs = varStyle(app.state.variable);
  const lo = vs.domain[0], hi = vs.domain[1];
  const x = (v) => ((v - lo) / (hi - lo)) * w;
  const maxY = Math.max(...dist.early, ...dist.late) || 1;
  const draw = (arr, color, fill) => {
    ctx.beginPath();
    ctx.moveTo(x(dist.edges[0]), h);
    for (let k = 0; k < arr.length; k++) {
      const xm = x((dist.edges[k] + dist.edges[k + 1]) / 2);
      ctx.lineTo(xm, h - 4 - (arr[k] / maxY) * (h - 12));
    }
    ctx.lineTo(x(dist.edges[dist.edges.length - 1]), h);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  draw(dist.early, "rgba(76,201,255,0.9)", "rgba(76,201,255,0.12)");
  draw(dist.late, "rgba(255,138,61,0.95)", "rgba(255,138,61,0.16)");
  const b = app.state.band;
  ctx.fillStyle = "rgba(255,192,97,0.12)";
  const a = b.min == null ? 0 : x(b.min), z = b.max == null ? w : x(b.max);
  ctx.fillRect(Math.min(a, z), 0, Math.abs(z - a), h);
  ctx.strokeStyle = "#ffc061";
  ctx.setLineDash([3, 3]);
  for (const t of [b.min, b.max]) if (t != null) { ctx.beginPath(); ctx.moveTo(x(t), 0); ctx.lineTo(x(t), h); ctx.stroke(); }
  ctx.setLineDash([]);
}

// ---------- right panel ----------
function stampHtml(level, slam = true) {
  const text = level === "significant" ? "Significant" : level === "suggestive" ? "Suggestive" : "Not proven";
  return `<div class="stamp ${level} ${slam ? "slam" : ""}">${text}</div>`;
}

function renderRight(app) {
  const s = app.state, R = app.R;
  if (!R.v) return;
  const region = R.region;
  const def = defOf(s.variable);
  const { factor, label: uLabel } = dispUnits(s.variable);
  const head = $("#evHead");
  head.innerHTML = `
    <p class="eyebrow">The evidence <span class="rule"></span></p>
    <div class="h-display" style="font-size:22px">${esc(def.name)}</div>
    <div class="ev-chips">
      <span class="chip"><b>${esc(region.name)}</b></span>
      <span class="chip">${esc(monthsLabel(s.months))}</span>
      <span class="chip">${R.annual.years[0] ?? ""}–${R.annual.years[R.annual.years.length - 1] ?? ""}</span>
      <span class="chip">MERRA-2</span>
    </div>`;

  const verdictEl = $("#evVerdict"), clockEl = $("#evClock"), insightEl = $("#evInsight");
  const chartHead = $("#evChartHead"), chartNote = $("#evChartNote");
  const key = JSON.stringify([s.mode, s.variable, region.id, region.latMin, region.lonMin, s.months, s.band, s.route, s.twin]);
  const slam = app._lastVerdictKey !== key;
  app._lastVerdictKey = key;

  // ---- verdict card ----
  if (s.mode === "band" && R.bandSummary) {
    const bs = R.bandSummary;
    const km = bs.edgeShiftKmPerDecade;
    verdictEl.innerHTML = `${stampHtml(bs.level, slam)}
      <div class="ct">Shift verdict</div>
      <div class="rate ${km > 0 ? "up" : "down"}">${Number.isFinite(km) ? signed(km, 2) : "–"}<small>km / decade ${Number.isFinite(km) ? (km >= 0 ? "poleward" : "toward the equator") : ""}</small></div>
      <div class="ci">Zone area ${Number.isFinite(bs.areaPctPerDecade) ? signed(bs.areaPctPerDecade, 2) + "% per decade" : "–"} · kind: <b style="color:#fff">${esc(bs.kind)}</b></div>
      <div class="ps"><span class="pv ${bs.edgeP < 0.05 ? "pass" : ""}">edge t-test ${E.fmtP(bs.edgeP)}</span><span class="pv ${bs.areaP < 0.05 ? "pass" : ""}">area t-test ${E.fmtP(bs.areaP)}</span><span class="pv">${R.track.years.length} years</span></div>
      <div class="sentence">${esc(bs.sentence)}</div>`;
  } else if (s.mode === "route" && R.routeVerdict) {
    const vd = R.routeVerdict;
    const om = R.routeOpen.openMonths;
    const firstOpen = R.routeOpen.years.find((y, k) => om[k] > 0);
    verdictEl.innerHTML = `${stampHtml(vd.level, slam)}
      <div class="ct">Open-water months on the route</div>
      <div class="rate ${vd.perDecade > 0 ? "up" : "down"}">${signed(vd.perDecade, 2)}<small>months open / decade</small></div>
      <div class="ci">95% range ${signed(vd.ci95PerDecade[0])} to ${signed(vd.ci95PerDecade[1])} · first open year: <b style="color:#fff">${firstOpen ?? "never"}</b></div>
      <div class="ps"><span class="pv ${vd.pT < 0.05 ? "pass" : ""}">t-test ${E.fmtP(vd.pT)}</span><span class="pv ${vd.pMK < 0.05 ? "pass" : ""}">Mann–Kendall ${E.fmtP(vd.pMK)}</span><span class="pv">${vd.n} years</span></div>
      <div class="sentence">${esc(vd.sentence.replace(/percentage points/g, "months"))}</div>`;
  } else if (s.mode === "twin" && R.twin) {
    verdictEl.innerHTML = twinCard(app);
  } else if (s.mode === "flow" && R.flowSummary) {
    const fs = R.flowSummary;
    const kmDec = fs.medianKmPerDecade;
    const mPerDay = (kmDec * 1000) / 3652.5;
    verdictEl.innerHTML = `
      <div class="ct">Climate velocity · ${esc(region.name)}</div>
      <div class="rate up">${fmtNum(kmDec, 2)}<small>km / decade, typical</small></div>
      <div class="ci">Heading ${esc(fs.bearingName ?? "")} on average · ≈ ${fmtNum(mPerDay, 2)} m per day</div>
      <div class="kpis">
        <div class="kpi hot"><div class="k">Median, whole map</div><div class="v">${fmtNum(R.flow.medianSpeed * 10, 2)} <small>km/dec</small></div></div>
        <div class="kpi"><div class="k">${R.flowLand ? "Median over land" : "Mean in region"}</div><div class="v">${fmtNum(R.flowLand ? R.flowLand.medianKmPerDecade : fs.meanKmPerDecade, 2)} <small>km/dec</small></div></div>
      </div>
      <div class="sentence">To keep the same ${esc(def.name.toLowerCase())} you had in ${R.flow.years?.[0] ?? 1980}, a typical spot in ${esc(region.name)} would have to move about <strong style="color:#fff">${fmtNum(kmDec, 2)} km every decade</strong>, roughly ${fmtNum(mPerDay, 2)} m every day, heading ${esc(fs.bearingName ?? "")}.</div>`;
  } else {
    const vd = R.verdict;
    if (R.empty) {
      verdictEl.innerHTML = `<div class="ct">Verdict</div><div class="sentence">This variable has no data in ${esc(region.name)} (${s.variable === "seaice" ? "sea ice only exists north of 50°N" : "land variables are blank over the ocean, sea ice over land"}). Try another region.</div>`;
    } else {
      const up = vd.perDecade > 0;
      verdictEl.innerHTML = `${stampHtml(vd.level, slam)}
        <div class="ct">Rate of change</div>
        <div class="rate ${up ? "up" : "down"}">${signed(vd.perDecade * factor, 2)}<small>${esc(uLabel)} / decade</small></div>
        <div class="ci">95% range ${signed(vd.ci95PerDecade[0] * factor)} to ${signed(vd.ci95PerDecade[1] * factor)} ${esc(uLabel)} per decade</div>
        <div class="ps"><span class="pv ${vd.pT < 0.05 ? "pass" : ""}">t-test ${E.fmtP(vd.pT)}</span><span class="pv ${vd.pMK < 0.05 ? "pass" : ""}">Mann–Kendall ${E.fmtP(vd.pMK)}</span><span class="pv">${vd.n} years</span></div>
        <div class="sentence">${esc(vd.sentence)}</div>`;
    }
  }

  // ---- chart ----
  const C = app.chart;
  let spec = null;
  const units = unitsOf(s.variable);
  const vsF = (x) => `${fmtNum(x * factor, 3)} ${uLabel}`;
  const tabs = (opts) => `<span>${opts.title}</span><span class="seg chart-tabs">${opts.tabs.map(([k, l]) => `<button data-ck="${k}" class="${s.chartKind === k ? "on" : ""}">${l}</button>`).join("")}</span>`;
  if (s.mode === "band" && R.bandSummary) {
    const kind = ["edge", "area"].includes(s.chartKind) ? s.chartKind : "edge";
    chartHead.innerHTML = tabs({ title: kind === "edge" ? "Where is the zone's edge?" : "How big is the zone?", tabs: [["edge", "Edge"], ["area", "Area"]] });
    if (kind === "edge") {
      const edge = R.bandSummary.edgeMeanLat;
      const det = R.edgeDetection;
      spec = { kind: "series", years: R.track.years, values: edge, units: "° latitude", fit: true, color: "#ff8a3d", format: (v) => `${fmtNum(Math.abs(v), 3)}°${v >= 0 ? "N" : "S"}`, emptyText: "The edge runs into the region border in most years.", extendTo: det && det.status === "pending" && det.etaYear < 2100 ? Math.max(det.etaYear + 2, R.track.years.at(-1) + 5) : undefined, markers: det && det.status === "pending" && det.etaYear < 2100 ? [{ year: det.etaYear, label: `Detectable ≈ ${det.etaYear}`, color: "#ffb020" }] : [] };
      chartNote.textContent = "Average latitude of the zone's outer edge each year, with the best-fit line and its 95% band.";
    } else {
      spec = { kind: "series", years: R.track.years, values: R.track.areaKm2.map((a) => a / 1e6), units: "M km²", fit: true, color: "#ffc061", format: (v) => `${fmtNum(v, 3)} M km²` };
      chartNote.textContent = "Total area inside the zone each year.";
    }
  } else if (s.mode === "route" && R.routeOpen) {
    chartHead.innerHTML = `<span>Open months per year</span>`;
    spec = { kind: "bars", years: R.routeOpen.years, values: R.routeOpen.openMonths, max: R.routeOpen.months.length, units: "months", fit: true, color: "#4cc9ff", format: (v) => `${v} of ${R.routeOpen.months.length} months` };
    chartNote.textContent = `Each bar counts the months (${monthsLabel(R.routeOpen.months)}) when the whole route was open water.`;
  } else if (s.mode === "twin" && R.twin) {
    chartHead.innerHTML = `<span>Then vs now at ${esc(R.home.name ?? "home")}</span>`;
    spec = twinSeasonal(app);
    chartNote.textContent = "Monthly temperature cycle at your spot: the 1980s versus the last decade.";
  } else if (!R.empty) {
    const kind = ["trend", "stripes", "seasons"].includes(s.chartKind) ? s.chartKind : "trend";
    chartHead.innerHTML = tabs({ title: "Time series", tabs: [["trend", "Trend"], ["stripes", "Stripes"], ["seasons", "Seasons"]] });
    const det = R.detection;
    if (kind === "trend") {
      const showMonthly = s.months.length === 12;
      let monthly = null;
      if (showMonthly) {
        const src = s.deseason ? null : R.rs;
        const base = src ?? R.rs;
        const x = base.t.map((t) => Number(t.slice(0, 4)) + (Number(t.slice(5, 7)) - 0.5) / 12);
        monthly = { x, values: Array.from(base.values) };
      }
      const pending = det && det.status === "pending" && det.etaYear < 2100;
      spec = { kind: "series", years: R.annual.years, values: R.annual.values, units, monthly, fit: true, color: varAccent(s.variable), format: vsF, extendTo: pending ? Math.max(det.etaYear + 2, R.annual.years.at(-1) + 5) : undefined, markers: pending ? [{ year: det.etaYear, label: `Detectable ≈ ${det.etaYear}`, color: "#ffb020" }] : [] };
      chartNote.textContent = showMonthly ? "Thin line: raw monthly values. Dots: yearly means. Dashed: best fit with its 95% band." : `Dots: ${monthsLabel(s.months)} mean for each year. Dashed: best fit with its 95% band.`;
    } else if (kind === "stripes") {
      const tr = varStyle(s.variable).trend;
      spec = { kind: "stripes", years: R.annual.years, values: R.annual.values, units, palette: tr === "heat" ? "temp" : tr === "wet" ? "wet" : "ice" };
      chartNote.textContent = "One stripe per year, colored by how far it sits above or below the average.";
    } else {
      const sc = app.A ? memoSeasonal(app) : null;
      spec = sc ? { kind: "seasonal", months: sc.months, early: sc.early, late: sc.late, earlyLabel: (sc.periods?.base ?? [1980, 1989]).join("–"), lateLabel: (sc.periods?.recent ?? [2016, 2025]).join("–"), units } : null;
      chartNote.textContent = "The average year, month by month: first decade versus last decade.";
    }
  } else {
    chartHead.innerHTML = `<span>Time series</span>`;
    spec = { kind: "series", years: [], values: [], emptyText: "No data in this region" };
    chartNote.textContent = "";
  }
  chartHead.querySelectorAll("[data-ck]").forEach((b) => b.addEventListener("click", () => actions.set({ chartKind: b.dataset.ck })));
  if (C && spec) {
    spec.cursorYear = Math.floor(frameYear(app.t));
    C.update(spec);
  }

  // ---- detection clock ----
  const det = s.mode === "band" ? R.edgeDetection : s.mode === "route" ? R.routeDetection : ["flow", "twin"].includes(s.mode) ? null : R.detection;
  if (det && app.A && !R.empty) {
    const pct = Math.max(0, Math.min(1, det.progress ?? 0));
    const r = 34, circ = 2 * Math.PI * r;
    const color = det.status === "detectable" ? "#ff5d5d" : det.status === "never" ? "#8b98ad" : "#ffb020";
    const big = det.status === "detectable" ? "Now" : det.status === "never" ? "∞" : `≈ ${det.etaYear}`;
    clockEl.hidden = false;
    clockEl.innerHTML = `<div class="ct">Detection clock <span class="badge">Weatherhead 1998</span></div>
      <div class="clock">
        <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"/>
          <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${circ * pct} ${circ}" transform="rotate(-90 42 42)" style="filter:drop-shadow(0 0 6px ${color})"/>
          <text x="42" y="40" text-anchor="middle" font-family="JetBrains Mono" font-size="13" fill="#fff">${Math.round(det.nYears)}</text>
          <text x="42" y="54" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#8b98ad">/ ${Number.isFinite(det.nStar) && det.nStar < 999 ? Math.round(det.nStar) : "∞"} yrs</text></svg>
        <div><div class="big" style="color:${color}">${big}</div><div class="sub">${esc(app.A.detectionSentence(det, units))}</div></div>
      </div>`;
  } else {
    clockEl.hidden = true;
  }

  // ---- insight ----
  insightEl.hidden = false;
  if (s.mode === "band" && R.dipole) {
    const st = R.dipole.stats;
    const per = (x) => `${signed(x * factor, 2)} ${uLabel}/dec`;
    insightEl.innerHTML = `<div class="ct">One cause, two trends <button class="chip ${s.showDipole ? "on" : ""}" data-tog="showDipole">${s.showDipole ? "Showing on map" : "Show on map"}</button></div>
      <div class="insight">${esc(R.dipole.sentence)}</div>
      <div class="kpis">
        <div class="kpi hot"><div class="k">Where it arrived</div><div class="v">${per(st.arrived.meanPerDecade)}</div><div class="small muted">${fmtNum(st.arrived.areaKm2 / 1e6, 2)} M km² · ${Math.round(st.arrived.fracSignificant * 100)}% significant</div></div>
        <div class="kpi cold"><div class="k">Where it left</div><div class="v">${per(st.left.meanPerDecade)}</div><div class="small muted">${fmtNum(st.left.areaKm2 / 1e6, 2)} M km² · ${Math.round(st.left.fracSignificant * 100)}% significant</div></div>
      </div>
      <div class="dipole-key"><span><i style="background:#ff7a29"></i>arrived (in the zone ${R.dipole.late.join("–")}, not ${R.dipole.early.join("–")})</span></div>
      <div class="dipole-key" style="margin-top:4px"><span><i style="background:#43c7ff"></i>left (in the zone ${R.dipole.early.join("–")}, not ${R.dipole.late.join("–")})</span></div>`;
  } else if (s.mode === "map" && R.tmap) {
    const census = trendCensus(R.tmap, R.v.entry.grid, region);
    insightEl.innerHTML = `<div class="ct">Trend census · ${esc(region.name)}</div>
      <div class="census"><i style="width:${census.down * 100}%;background:#4cc9ff"></i><i style="width:${census.flat * 100}%;background:rgba(255,255,255,0.12)"></i><i style="width:${census.up * 100}%;background:#ff8a3d"></i></div>
      <div class="census-l"><span>${Math.round(census.down * 100)}% falling</span><span>${Math.round(census.flat * 100)}% not significant</span><span>${Math.round(census.up * 100)}% rising</span></div>
      <p class="insight" style="margin-top:12px">${census.up > 0.05 && census.down > 0.05 ? `<strong>Same variable, opposite trends.</strong> Part of this region is rising while another part is falling. Often one cause is behind both: a zone that moves makes values rise where it arrives and fall where it leaves.` : `Share of the area (by true cell area) with a significant trend (p &lt; 0.05).`}</p>
      <button class="btn small" id="toShift">See it as a moving zone →</button>`;
    $("#toShift")?.addEventListener("click", () => actions.set({ mode: "band", band: varStyle(s.variable).band, showDipole: true }));
  } else if (s.mode === "route" && R.routeOpen) {
    const ro = R.routeOpen;
    const lastK = ro.years.length - 1;
    insightEl.innerHTML = `<div class="ct">Ship's log</div>
      <div class="kpis"><div class="kpi cold"><div class="k">${ro.years[0]}–${ro.years[Math.min(9, lastK)]}</div><div class="v">${fmtNum(avg(ro.openMonths.slice(0, 10)), 2)} <small>months open</small></div></div>
      <div class="kpi hot"><div class="k">${ro.years[Math.max(0, lastK - 9)]}–${ro.years[lastK]}</div><div class="v">${fmtNum(avg(ro.openMonths.slice(-10)), 2)} <small>months open</small></div></div></div>
      <p class="insight" style="margin-top:10px">${ro.chokePoint ? `The choke point (red ring) sits near <strong>${fmtNum(ro.chokePoint[0], 3)}°N, ${fmtNum(Math.abs(ro.chokePoint[1]), 3)}°${ro.chokePoint[1] >= 0 ? "E" : "W"}</strong>: the stretch that stays icy in the most months.` : ""}</p>`;
  } else if (s.mode === "flow") {
    insightEl.innerHTML = `<div class="ct">How to read the flow</div><p class="insight">Streaks point the way the ${esc(def.name.toLowerCase())} values are moving. Where the variable rises, its values slide toward places that used to have higher values (for warming, toward the poles and uphill). Speed is the trend divided by how quickly the value changes across the land or sea. That is why flat regions race and mountains crawl.</p>`;
  } else if (s.mode === "twin" && R.twin) {
    const d = R.twin.home.drift;
    insightEl.innerHTML = `<div class="ct">What changed at home</div>
      <div class="kpis"><div class="kpi hot"><div class="k">Average temperature</div><div class="v">${signed(d.dT, 2)} <small>°C</small></div></div>
      <div class="kpi"><div class="k">Rain + snow</div><div class="v">${signed(d.dPpct, 2)} <small>%</small></div></div></div>
      <p class="hint" style="margin-top:10px">The climate twin is found by comparing three numbers for every land cell within 2,500 km: average temperature, the gap between the warmest and coldest month, and precipitation. The match quality says how close the best match is.</p>`;
  } else if (s.mode === "lineup" && R.lineup) {
    const sig = R.lineup.filter((x) => !x.empty && x.verdict.level === "significant").length;
    insightEl.innerHTML = `<div class="ct">Lineup summary</div><p class="insight"><strong>${sig} of ${R.lineup.filter((x) => !x.empty).length}</strong> variables show a significant trend in ${esc(region.name)} (${esc(monthsLabel(s.months))}). The top suspect is <strong>${esc(defOf(R.lineup[0].id).name)}</strong>.</p>`;
  } else {
    insightEl.innerHTML = `<div class="ct">Next clue</div><p class="insight">A single average can hide opposite changes inside the region. Switch to <strong>Trend map</strong> to see where it changes, or to <strong>Shift</strong> to follow a fixed value as it moves.</p>
      <div class="row" style="margin-top:8px"><button class="btn small" data-go="map">Trend map →</button><button class="btn small" data-go="band">Shift →</button></div>`;
    insightEl.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => actions.setMode(b.dataset.go)));
  }
  insightEl.querySelectorAll("[data-tog]").forEach((b) => b.addEventListener("click", () => actions.toggle(b.dataset.tog)));
}

function memoSeasonal(app) {
  const s = app.state, r = app.R.region;
  const key = `${s.variable}|${r.latMin},${r.latMax},${r.lonMin},${r.lonMax}`;
  app._seasonal ??= new Map();
  if (!app._seasonal.has(key)) app._seasonal.set(key, app.A.seasonalCycle(app.R.v, r));
  return app._seasonal.get(key);
}

function twinSeasonal(app) {
  const R = app.R;
  const t2m = D.cachedVar("t2m");
  if (!t2m || !app.A) return null;
  const h = R.home;
  const box = { latMin: h.lat - 1, latMax: h.lat + 1, lonMin: h.lon - 1.25, lonMax: h.lon + 1.25 };
  const sc = app.A.seasonalCycle(t2m, box);
  return { kind: "seasonal", months: sc.months, early: sc.early, late: sc.late, earlyLabel: (sc.periods?.base ?? [1980, 1989]).join("–"), lateLabel: (sc.periods?.recent ?? [2016, 2025]).join("–"), units: "°C" };
}

function twinCard(app) {
  const R = app.R, tw = R.twin, h = R.home;
  const tn = tw.thenNow, nw = tw.nowWas;
  const near = (p) => nearestCityName(app, p.lat, p.lon, 450);
  const q = (x) => `<span class="badge" style="background:${x === "good" ? "rgba(74,222,128,.15)" : x === "fair" ? "rgba(255,176,32,.15)" : "rgba(255,93,93,.15)"};color:${x === "good" ? "#4ade80" : x === "fair" ? "#ffb020" : "#ff5d5d"}">${x} match</span>`;
  const row = (lab, a, b, unit, sig = 3) => {
    const d = b - a;
    return `<tr><td>${lab}</td><td>${fmtNum(a, sig)} ${unit}</td><td>${fmtNum(b, sig)} ${unit}</td><td class="delta ${d > 0 ? "up" : "down"}">${signed(d, 2)}</td></tr>`;
  };
  return `<div class="ct">Climate twin · ${esc(h.name ?? `${h.lat.toFixed(1)}, ${h.lon.toFixed(1)}`)} ${q(tn.quality)}</div>
    <div class="twin-line">${esc(h.name ?? "This spot")}'s 1980s climate now lives <em>${fmtNum(tn.distKm, 2)} km ${esc(tn.bearingName)}</em>${near(tn) ? `, near ${esc(near(tn))}` : ""}.</div>
    <p class="insight" style="margin-top:10px">And the climate ${esc(h.name ?? "it")} has today was found <strong>${fmtNum(nw.distKm, 2)} km ${esc(nw.bearingName)}</strong>${near(nw) ? ` (near ${esc(near(nw))})` : ""} in the 1980s. ${q(nw.quality)}</p>
    <table class="fp-table"><thead><tr><th>Fingerprint</th><th>${tw.periods.base.join("–")}</th><th>${tw.periods.recent.join("–")}</th><th>Change</th></tr></thead><tbody>
      ${row("Mean temperature", h.then.tMean, h.now.tMean, "°C")}
      ${row("Warmest − coldest month", h.then.tRange, h.now.tRange, "°C")}
      ${row("Rain + snow", h.then.pMean, h.now.pMean, "mm/d")}
    </tbody></table>`;
}

function avg(a) { const f = a.filter(Number.isFinite); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : NaN; }

function varAccent(id) {
  const t = varStyle(id).trend;
  return t === "wet" ? "#3fd0c9" : t === "ice" ? "#7cd2ff" : "#ff8a3d";
}

function trendCensus(tm, grid, region) {
  const { cells, rows } = E.regionCells(grid, region);
  const areas = E.rowAreasKm2(grid);
  let up = 0, down = 0, flat = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], w = areas[rows[k]];
    const s = tm.slope[c], p = tm.p[c];
    if (!Number.isFinite(s)) continue;
    if (p < 0.05) (s > 0 ? (up += w) : (down += w)); else flat += w;
  }
  const tot = up + down + flat || 1;
  return { up: up / tot, down: down / tot, flat: flat / tot };
}

// ---------- HUD ----------
function renderHud(app) {
  const s = app.state, R = app.R;
  const el = $("#hudTitle");
  if (!R.v) return;
  const def = defOf(s.variable);
  const modeLabel = { series: "values", map: "trend 1980–2025", band: "shift", route: "route", flow: "climate velocity", twin: "climate twin", lineup: "lineup", atlas: "atlas" }[s.mode];
  el.innerHTML = `<div class="hud-year" id="hudYear"></div>
    <div class="hud-sub"><b>${esc(def.name)}</b> · ${esc(monthsLabel(s.months))} · ${esc(R.region.name)} · ${esc(modeLabel)}</div>
    ${s.prompt ? `<div class="hud-q">${esc(s.prompt)}</div>` : ""}`;
  renderHudYear(app);
}

export function renderHudYear(app) {
  const el = document.getElementById("hudYear");
  if (!el || !app.frames) return;
  const lab = app.frames.labels[Math.round(app.t)] ?? "";
  const s = app.state;
  if (s.mode === "map" && s.layerView === "trend") { el.innerHTML = `${app.frames.years[0] | 0}<small>→ ${app.frames.years[app.frames.n - 1] | 0}</small>`; return; }
  if (s.mode === "flow") { el.innerHTML = `${app.R.flow?.years?.[0] ?? 1980}<small>→ ${app.R.flow?.years?.at(-1) ?? 2025}</small>`; return; }
  if (app.frames.monthly) {
    const [m, y] = lab.split(" ");
    el.innerHTML = `${y}<small>${m}</small>`;
  } else el.textContent = lab;
}

export function renderTools(app) {
  const s = app.state;
  const el = $("#hudTools");
  const kind = app.map.kind;
  const projBtn = (k, label, icon) => `<button data-proj="${k}" class="${kind === k && s.proj !== "auto" ? "on" : kind === k ? "on" : ""}" title="${label}">${ICONS[icon]}${label}</button>`;
  el.innerHTML = `
    <div class="toolgroup">${projBtn("globe", "Globe", "globe")}${projBtn("flat", "Flat", "flat")}${projBtn("polar", "Polar", "polar")}</div>
    ${s.mode === "map" ? `<div class="toolgroup"><button data-lv="trend" class="${s.layerView === "trend" ? "on" : ""}">Trend</button><button data-lv="field" class="${s.layerView === "field" ? "on" : ""}">Values by year</button></div>` : ""}
    ${s.mode === "band" ? `<div class="toolgroup">
      <button data-tog="showTrail" class="${s.showTrail ? "on" : ""}" title="Ghost trail of the last 10 years">${ICONS.trail}Trail</button>
      <button data-tog="showTrack" class="${s.showTrack ? "on" : ""}" title="Hurricane-style track of the zone's centre">${ICONS.track}Track</button>
      <button data-tog="showRings" class="${s.showRings ? "on" : ""}" title="Every year's edge at once">${ICONS.rings}Rings</button>
      <button data-tog="showDipole" class="${s.showDipole ? "on" : ""}" title="Where the zone arrived vs where it left">${ICONS.dipole}Dipole</button></div>` : ""}`;
  el.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.proj;
    const r = regionOf(s);
    actions.set({ proj: k });
    if (k === "polar") app.map.setProjection("polar", { south: r.latMax <= -50 });
  }));
  el.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => actions.set({ layerView: b.dataset.lv })));
  el.querySelectorAll("[data-tog]").forEach((b) => b.addEventListener("click", () => actions.toggle(b.dataset.tog)));
}

function renderLegend(app) {
  const s = app.state, R = app.R, el = $("#hudLegend");
  if (!R.v) return;
  const vs = varStyle(s.variable);
  const { factor, label } = dispUnits(s.variable);
  const scene = app.map.scene;
  let html = "";
  if (scene.layer === 1 && R.tmapMax) {
    const tr = trendRamp(s.variable);
    const mx = R.tmapMax * 10 * factor;
    html = `<div class="lt"><span>Trend per decade</span><span>${esc(label)}</span></div>
      <div class="bar" style="background:${rampCss(tr.ramp, { flip: tr.flip })}"></div>
      <div class="ticks"><span>${signed(-mx, 2)}</span><span>0</span><span>${signed(mx, 2)}</span></div>
      <div class="keys"><span><i style="background:repeating-linear-gradient(135deg,#6b7280 0 2px,#2a3140 2px 5px)"></i>faded + hatched = not significant (p ≥ 0.05)</span></div>`;
  } else if (scene.layer === 2 && R.flow) {
    html = `<div class="lt"><span>Climate velocity</span><span>km / decade</span></div>
      <div class="bar" style="background:${rampCss("speed")}"></div>
      <div class="ticks"><span>0</span><span>${fmtNum(R.flow.medianSpeed * 10, 2)}</span><span>${fmtNum(R.flow.cap * 10, 2)}+</span></div>
      <div class="keys"><span><i style="background:linear-gradient(90deg,#3aa8ff,#ffd166,#ff4b2e)"></i>streaks: direction and speed the values travel</span></div>`;
  } else {
    html = `<div class="lt"><span>${esc(defOf(s.variable).name)}</span><span>${esc(unitsOf(s.variable))}</span></div>
      <div class="bar" style="background:${rampCss(vs.ramp)}"></div>
      <div class="ticks"><span>${fmtNum(vs.domain[0])}</span><span>${fmtNum(vs.gamma ? vs.domain[0] + (vs.domain[1] - vs.domain[0]) * Math.pow(0.5, 1 / vs.gamma) : (vs.domain[0] + vs.domain[1]) / 2)}</span><span>${fmtNum(vs.domain[1])}</span></div>`;
    if (s.mode === "band") {
      html += `<div class="keys">
        <span><i style="background:linear-gradient(90deg,#b83a0c,#ff6a1f,#ffd79a)"></i>the zone this year (core is brighter)</span>
        ${s.showTrail ? `<span><i style="background:#7a2610"></i>ghost trail: where it was in the last 10 years</span>` : ""}
        ${s.showFirst ? `<span><i class="dash" style="border-color:#b8ebff"></i>edge in ${app.frames.years[0] | 0}</span>` : ""}
        ${s.showTrack ? `<span><i class="line" style="border-color:#ffa040"></i>track of the zone's centre, cone = trend continued</span>` : ""}
        ${s.showRings ? `<span><i style="background:linear-gradient(90deg,#3b6cf6,#e0418f,#ffe08a)"></i>tree rings: every year's edge, old → new</span>` : ""}
        ${s.showDipole ? `<span><i style="background:#ff7a29"></i>arrived</span><span><i style="background:#43c7ff"></i>left</span>` : ""}
      </div>`;
    }
    if (s.mode === "route") html += `<div class="keys"><span><i class="line" style="border-color:#ffd99a"></i>${Math.round((s.band.max ?? 0.15) * 100)}% ice line (open water inside)</span><span><i style="background:#ff5d5d;border-radius:50%;width:8px"></i>choke point</span></div>`;
    if (s.mode === "twin") html += `<div class="keys"><span><i class="line" style="border-color:#ff8a3d"></i>where its 1980s climate is now</span><span><i class="line" style="border-color:#4cc9ff"></i>where today's climate was in the 1980s</span></div>`;
  }
  el.innerHTML = `<div class="legend">${html}</div>`;
}

export function renderDataHud(app) {
  const s = app.state, R = app.R, el = $("#hudData");
  if (!R.v) return;
  const e = R.v.entry, g = e.grid;
  const cells = g.nlat * g.nlon;
  el.innerHTML = `<div class="hud-data">
    <b>NASA MERRA-2</b> · ${esc(e.source.split(",")[0].replace("MERRA-2 ", ""))} · ${g.dlat}° × ${g.dlon}° grid<br/>
    ${cells.toLocaleString("en-US")} cells × ${e.nt} months = <b>${fmtNum(cells * e.nt, 3)}</b> values in this variable<br/>
    ${D.meter.loaded.size} of ${app.catalog.variables.length} variables in memory · <b>${fmtNum(D.meter.values, 3)}</b> values · ${(D.meter.bytes / 1e6).toFixed(0)} MB streamed
  </div>`;
}

// ---------- tooltip ----------
export function hover(app, ll, pt) {
  const tip = $("#tooltip");
  if (!ll || !app.R.v || app.state.view !== "app") { tip.hidden = true; return; }
  const s = app.state, R = app.R, v = R.v, g = v.entry.grid;
  const { factor, label } = dispUnits(s.variable);
  const lat = ll.lat, lon = ll.lon;
  const coord = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  let val = NaN;
  const f = app.frames;
  if (f && !f.monthly) {
    const af = E.annualFields(v, s.months);
    const k = Math.round(app.t);
    val = D.sampleGrid(af.fields.subarray(k * af.ncell, (k + 1) * af.ncell), g, lat, lon);
  } else if (f) {
    const i = Math.round((lat - g.lat0) / g.dlat), j = ((Math.round((lon - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
    if (i >= 0 && i < g.nlat) val = v.value(Math.round(app.t), i, j);
  }
  const lines = [`<div>${coord} · ${esc(f?.labels[Math.round(app.t)] ?? "")}</div>`];
  lines.push(`<div class="tv">${Number.isFinite(val) ? `${fmtNum(val * factor, 3)} ${esc(label)}` : "no data"}</div>`);
  if (R.tmap) {
    const sl = D.sampleGrid(R.tmap.slope, g, lat, lon), p = D.sampleGrid(R.tmap.p, g, lat, lon);
    if (Number.isFinite(sl)) lines.push(`<div>trend <b>${signed(sl * 10 * factor, 2)} ${esc(label)}/dec</b> · ${p < 0.05 ? '<b style="color:#ff8a80">significant</b>' : "not significant"}</div>`);
  }
  if (s.mode === "flow" && R.flow) {
    const sp = D.sampleGrid(R.flow.speed, g, lat, lon), u = D.sampleGrid(R.flow.u, g, lat, lon), vv = D.sampleGrid(R.flow.v, g, lat, lon);
    if (Number.isFinite(sp)) {
      const brg = (Math.atan2(u, vv) * 180 / Math.PI + 360) % 360;
      lines.push(`<div>climate moving <b>${fmtNum(sp * 10, 2)} km/dec</b> toward ${bearingWord(brg)}</div>`);
    }
  }
  if (s.mode === "twin") lines.push(`<div style="color:#ffc061">click to make this your hometown</div>`);
  tip.innerHTML = lines.join("");
  tip.hidden = false;
  const W = $("#map").clientWidth;
  tip.style.left = Math.min(pt.x, W - 240) + "px";
  tip.style.top = pt.y + "px";
}

function bearingWord(b) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(b / 22.5) % 16];
}

export function nearestCityName(app, lat, lon, maxKm = 600) {
  let best = null, bd = Infinity;
  for (const c of app.content.cities ?? []) {
    const d = hav(lat, lon, c.lat, c.lon);
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd <= maxKm ? best.name : null;
}

function hav(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- toast ----------
let toastT = null;
export function toast(msg, ms = 3200) {
  const el = $("#mapToast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, ms);
}
