// Trend Detective app controller: state, data loading, per-product analysis,
// and wiring between the map, chart and workstation chrome.
// Written with Claude and reviewed by the team.

import * as E from "../engine/index.js";
import * as D from "./data.js";
import { varStyle, rampLUT, trendRamp } from "./palettes.js";
import { MapView } from "./map/map.js";
import { createStore, toHash, fromHash } from "./state.js";
import * as W from "./ui/workstation.js";
import { renderSheet } from "./ui/sheet.js";
import { CasePlayer } from "./ui/cases.js";
import { renderAbout } from "./ui/about.js";

export const MODES = [
  { id: "series", label: "Time series", short: "SERIES" },
  { id: "map", label: "Trend map", short: "MAP" },
  { id: "band", label: "Shift: track a value", short: "SHIFT" },
  { id: "flow", label: "Climate velocity", short: "VELOCITY" },
  { id: "twin", label: "Climate analog", short: "ANALOG" },
  { id: "route", label: "Sea-ice route", short: "ROUTE" },
  { id: "lineup", label: "Field lineup", short: "LINEUP" },
  { id: "atlas", label: "Trend atlas", short: "ATLAS" },
];

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const DEFAULTS = {
  mode: "band", variable: "t2m", regionId: "europe", custom: null, months: ALL_MONTHS,
  band: { min: 10, max: null }, route: "nsr", overlayRoute: null, proj: "auto", cadence: "annual",
  layerView: "trend", chartKind: "trend", deseason: true,
  showTrail: true, showTrack: true, showFirst: true, showRings: false, showDipole: false,
  twin: null, prompt: null, cells: false, contours: true, coast: true, grid: true, hatch: true,
};

export const app = {
  S: null, content: null, catalog: null, map: null, chart: null, A: null, C: null,
  R: {}, frames: null, t: 0, playing: false, speed: 1, memo: new Map(),
  get state() { return this.S.get(); },
  set(patch) { return this.S.set(patch); },
};
window.TD = app;

// ---------- helpers ----------
export function regionOf(s = app.state) {
  if (s.custom) return { id: "custom", name: "Box", type: "custom", ...s.custom };
  return app.content.regions.find((r) => r.id === s.regionId) ?? app.content.regions[0];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthsLabel(months) {
  const m = [...months].sort((a, b) => a - b);
  if (m.length === 12) return "all year";
  if (m.length === 1) return MONTH_NAMES[m[0] - 1];
  return months.map((x) => MONTH_NAMES[x - 1]).join(" ");
}
export function seasonCode(months) {
  const m = [...months].sort((a, b) => a - b).join(",");
  const named = { "1,2,3,4,5,6,7,8,9,10,11,12": "ANN", "1,2,12": "DJF", "3,4,5": "MAM", "6,7,8": "JJA", "9,10,11": "SON" };
  if (named[m]) return named[m];
  return months.map((x) => "JFMAMJJASOND"[x - 1]).join("");
}

function memo(key, fn) {
  if (app.memo.has(key)) return app.memo.get(key);
  const v = fn();
  app.memo.set(key, v);
  if (app.memo.size > 80) app.memo.delete(app.memo.keys().next().value);
  return v;
}
const mkey = (s) => [...s.months].sort((a, b) => a - b).join(".");
const rkey = (r) => `${r.latMin},${r.latMax},${r.lonMin},${r.lonMax}`;
export const defOf = (id) => app.content.definitions[id] ?? { name: id, plain: "", why: "" };
export const unitsOf = (id) => D.entryOf(id)?.units ?? "";

// ---------- loading ----------
function showLoader(text, frac) {
  document.getElementById("loader").hidden = false;
  document.getElementById("loaderText").textContent = text;
  document.getElementById("loaderBar").style.width = `${Math.round((frac ?? 0) * 100)}%`;
}
const hideLoader = () => { document.getElementById("loader").hidden = true; };

export async function ensureVars(ids) {
  const missing = ids.filter((id) => !D.isLoaded(id));
  if (!missing.length) return Promise.all(ids.map((id) => D.getVar(id)));
  const size = (id) => { const e = D.entryOf(id); return e.nt * e.grid.nlat * e.grid.nlon * 2; };
  const total = missing.reduce((s, id) => s + size(id), 0);
  const prog = new Map(missing.map((id) => [id, 0]));
  const upd = () => {
    let done = 0;
    for (const id of missing) done += prog.get(id) * size(id);
    showLoader(`READ ${missing.map((id) => varStyle(id).code).join(" ")}  ${(done / 1e6).toFixed(1)}/${(total / 1e6).toFixed(0)} MB`, done / total);
  };
  upd();
  const out = await Promise.all(ids.map((id) => D.getVar(id, (f) => { prog.set(id, f); upd(); })));
  hideLoader();
  W.updateMeter();
  return out;
}

// ---------- frames ----------
function ensureField(v) {
  const s = app.state;
  const monthly = s.cadence === "monthly" && v.entry.nt <= app.map.gl.maxLayers;
  const key = `${v.entry.id}|${monthly ? "m" : "a" + mkey(s)}`;
  const st = varStyle(v.entry.id);
  app.map.setFieldStyle({ lut: rampLUT(st.ramp), cdom: st.domain, gamma: st.gamma ?? 1, levels: st.levels });
  if (app.fieldKey === key) return;
  const range = D.valueRange(v);
  const prevYear = app.frames ? frameYear(app.t) : null;
  let data, labels, years, layers;
  if (monthly) {
    data = D.packMonthly(v, range);
    labels = E.timeLabels(v.entry).map((t) => `${MONTH_NAMES[Number(t.slice(5, 7)) - 1].toUpperCase()} ${t.slice(0, 4)}`);
    layers = v.entry.nt;
    const y0 = Number(v.entry.start.slice(0, 4)), m0 = Number(v.entry.start.slice(5, 7));
    years = labels.map((_, k) => y0 + (m0 - 1 + k) / 12);
  } else {
    const af = E.annualFields(v, s.months);
    data = D.packAnnual(af, range);
    labels = af.years.map(String);
    layers = af.years.length;
    years = af.years.slice();
  }
  app.map.setField(data, v.entry.grid, layers, range);
  app.frames = { monthly, labels, years, n: layers, key };
  app.fieldKey = key;
  let t = layers - 1;
  if (prevYear != null && Number.isFinite(prevYear)) {
    const k = years.findIndex((y) => y >= prevYear - 1e-6);
    if (k >= 0) t = k;
  }
  setTime(t);
}

export function frameYear(t) {
  const f = app.frames;
  if (!f) return NaN;
  return f.years[Math.max(0, Math.min(f.n - 1, Math.round(t)))];
}

export function setTime(t) {
  const f = app.frames;
  if (!f) return;
  app.t = Math.max(0, Math.min(f.n - 1, t));
  app.map.setTime(Math.floor(app.t + 1e-6));
  const yr = frameYear(app.t);
  app.chart?.setCursor?.(f.monthly ? yr : Math.round(yr));
  if (app.R.track && app.map.overlay.track) {
    const yi = Math.round(Math.floor(yr) - app.R.track.years[0]);
    app.map.overlay.track.current = Math.max(0, Math.min(app.R.track.years.length - 1, yi));
    app.map.requestRender();
  }
  W.updateFrame();
}

let lastTick = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (app.playing && app.frames) {
    const rate = (app.frames.monthly ? 8 : 4) * app.speed;
    let t = app.t + dt * rate;
    if (t >= app.frames.n - 0.0001) { t = app.frames.n - 1; setPlaying(false); }
    const before = Math.floor(app.t + 1e-6);
    app.t = t;
    if (Math.floor(t + 1e-6) !== before || !app.playing) setTime(t);
  }
  requestAnimationFrame(tick);
}

export function setPlaying(p) {
  if (p && app.frames && app.t >= app.frames.n - 1.001) setTime(0);
  app.playing = p;
  W.renderToolbar();
}

// ---------- projection ----------
function autoProjection(s, region) {
  if (s.proj !== "auto") return { kind: s.proj, south: region.latMax <= -50 };
  if (s.variable === "seaice" || s.mode === "route") return { kind: "polar", south: false };
  if (region.latMin >= 55 && region.latMax - region.latMin < 50) return { kind: "polar", south: false };
  if (region.latMax <= -55) return { kind: "polar", south: true };
  return { kind: "flat", south: false };
}

function framingRegion(s, region) {
  if (s.mode === "twin") {
    const h = s.twin ?? defaultTwin();
    return { latMin: Math.max(-85, h.lat - 22), latMax: Math.min(85, h.lat + 22), lonMin: h.lon - 34, lonMax: h.lon + 34 };
  }
  return region;
}

// ---------- update ----------
let token = 0;
export async function update(changed = []) {
  const my = ++token;
  const s = app.state;
  const region = regionOf(s);
  try {
    if (!app.A) app.A = await import("./lib/analysis.js").catch((e) => { console.warn("analysis.js not ready", e); return null; });
    if (!app.C) app.C = await import("./chart.js").catch((e) => { console.warn("chart.js not ready", e); return null; });
    if (my !== token) return;
    W.ensureChart();
    app.map.setOptions({ cells: s.cells, contours: s.contours, coast: s.coast, grid: s.grid });

    if (changed.some((k) => ["regionId", "custom", "variable", "proj", "mode", "init", "twin"].includes(k))) {
      const pk = autoProjection(s, region);
      const was = app.map.kind + app.map.polarSouth;
      app.map.setProjection(pk.kind, { south: pk.south });
      if (changed.some((k) => ["regionId", "custom", "init", "twin", "mode"].includes(k)) || was !== pk.kind + pk.south) {
        app.map.fitRegion(framingRegion(s, region), { animate: !changed.includes("init") });
      }
    }

    const v = (await ensureVars([s.variable]))[0];
    if (my !== token) return;
    ensureField(v);

    const R = { v, region };
    const months = s.months, units = v.entry.units, A = app.A;
    const rs = memo(`rs|${s.variable}|${rkey(region)}`, () => E.regionSeries(v, region));
    const ds = memo(`ds|${s.variable}|${rkey(region)}`, () => E.deseasonalize(rs));
    const annual = memo(`an|${s.variable}|${rkey(region)}|${mkey(s)}|${s.deseason}`, () => E.annualMeans(s.deseason && months.length < 12 ? ds : rs, months));
    R.rs = rs; R.annual = annual;
    R.trend = E.linearTrend(annual);
    R.mk = E.mannKendall(annual);
    R.verdict = E.verdict(R.trend, R.mk, units);
    R.empty = !annual.values.some(Number.isFinite);
    R.detection = A ? A.detectionHorizon(annual) : null;
    if (["map", "band", "series", "lineup"].includes(s.mode)) R.tmap = memo(`tm|${s.variable}|${mkey(s)}`, () => E.trendMap(v, months));

    if (s.mode === "band") {
      const b = s.band;
      R.track = memo(`bt|${s.variable}|${rkey(region)}|${mkey(s)}|${b.min}|${b.max}`, () => E.bandTrack(v, { min: b.min, max: b.max, months, region }));
      R.bandSummary = E.bandSummary(R.track);
      if (A) {
        R.dipole = memo(`dp|${s.variable}|${rkey(region)}|${mkey(s)}|${b.min}|${b.max}`, () => A.dipole(v, R.track, months));
        const edge = R.bandSummary.edgeMeanLat;
        if (edge && edge.some(Number.isFinite)) R.edgeDetection = A.detectionHorizon({ years: R.track.years, values: Float64Array.from(edge) });
        const lastY = R.track.years[R.track.years.length - 1];
        const cl = Float64Array.from(R.track.centroidLat), co = Float64Array.from(unwrapLons(R.track.centroidLon));
        if (cl.some(Number.isFinite)) { R.coneLat = A.extrapolate(R.track.years, cl, lastY + 25); R.coneLon = A.extrapolate(R.track.years, co, lastY + 25); }
      }
    }
    if (s.mode === "route") {
      const route = app.content.routes.find((r) => r.id === s.route) ?? app.content.routes[0];
      R.route = route;
      R.routeOpen = memo(`ro|${s.variable}|${route.id}|${mkey(s)}|${s.band.max}`, () => E.routeOpen(v, route, { max: s.band.max ?? 0.15, months }));
      const ann = { years: R.routeOpen.years, values: Float64Array.from(R.routeOpen.openMonths) };
      R.routeTrend = E.linearTrend(ann);
      R.routeMK = E.mannKendall(ann);
      R.routeVerdict = E.verdict(R.routeTrend, R.routeMK, "months");
      R.routeDetection = A ? A.detectionHorizon(ann) : null;
    }
    if (s.mode === "flow" && A) {
      R.flow = memo(`vf|${s.variable}|${mkey(s)}`, () => A.velocityField(v, months));
      R.flowSummary = A.velocitySummary(R.flow, region);
      const soil = D.cachedVar("soilwet");
      if (soil) {
        const land = memo("landmask", () => A.landMaskFrom(soil));
        R.flowLand = memo(`vfl|${s.variable}|${mkey(s)}`, () => ({ medianKmPerDecade: A.velocitySummary(R.flow, null, { mask: land }).medianKmPerDecade }));
      }
    }
    if (s.mode === "twin" && A) {
      const [t2m, precip, soil] = await ensureVars(["t2m", "precip", "soilwet"]);
      if (my !== token) return;
      const land = memo("landmask", () => A.landMaskFrom(soil));
      const home = s.twin ?? defaultTwin();
      R.home = home;
      R.twin = memo(`tw|${home.lat}|${home.lon}`, () => A.climateTwin({ t2m, precip }, home.lat, home.lon, { landMask: land }));
      R.tmapT2m = memo(`tm|t2m|${ALL_MONTHS.join(".")}`, () => E.trendMap(t2m, ALL_MONTHS));
    }
    if ((s.mode === "lineup" || s.mode === "atlas") && A) {
      const ids = D.variableIds();
      const vs = await ensureVars(ids);
      if (my !== token) return;
      const byId = Object.fromEntries(ids.map((id, k) => [id, vs[k]]));
      R.byId = byId;
      if (s.mode === "lineup") R.lineup = memo(`lu|${rkey(region)}|${mkey(s)}`, () => A.lineup(byId, region, months));
      else R.atlas = ids.map((id) => ({ id, v: byId[id], tm: memo(`tm|${id}|${mkey(s)}`, () => E.trendMap(byId[id], months)) }));
    }
    if (my !== token) return;
    app.R = R;
    applyScene();
    W.renderAll();
    renderSheet(app);
    history.replaceState(null, "", toHash(s));
  } catch (err) {
    console.error(err);
    hideLoader();
    W.toast(`Error: ${err.message}`);
  }
}

function unwrapLons(lons) {
  const out = Array.from(lons);
  for (let k = 1; k < out.length; k++) {
    if (!Number.isFinite(out[k]) || !Number.isFinite(out[k - 1])) continue;
    while (out[k] - out[k - 1] > 180) out[k] -= 360;
    while (out[k] - out[k - 1] < -180) out[k] += 360;
  }
  return out;
}

export function defaultTwin() {
  const c = app.content.cities?.find((x) => x.name === "Paris") ?? { name: "Paris", lat: 48.86, lon: 2.35 };
  return { lat: c.lat, lon: c.lon, name: c.name };
}

function robustMax(arr) {
  const a = [];
  for (const x of arr) if (Number.isFinite(x)) a.push(Math.abs(x));
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return a[Math.floor(a.length * 0.98)] || a[a.length - 1] || 1;
}

function niceMax(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 5 ? 5 : m <= 6 ? 6 : 10) * p;
}

function packTrend(tm, maxAbs) {
  const n = tm.slope.length, out = new Float32Array(n * 4);
  for (let c = 0; c < n; c++) {
    const s = tm.slope[c];
    if (!Number.isFinite(s)) continue;
    out[4 * c] = Math.max(-1, Math.min(1, s / maxAbs));
    out[4 * c + 1] = 1;
    out[4 * c + 2] = Number.isFinite(tm.p[c]) ? tm.p[c] : 1;
  }
  return out;
}

function packDipole(dp, grid) {
  const n = grid.nlat * grid.nlon, out = new Uint8Array(n * 2);
  for (let c = 0; c < n; c++) { out[2 * c] = dp.arrived[c] ? 255 : 0; out[2 * c + 1] = dp.left[c] ? 255 : 0; }
  return out;
}

export function applyScene() {
  const s = app.state, R = app.R, map = app.map;
  const region = R.region, global = region.type === "global";
  const scene = { layer: 0, region: global || s.mode === "twin" ? null : region, noBlend: true };
  const ov = { region: global || s.mode === "twin" ? null : region, routes: [] };
  const style = varStyle(s.variable);
  map.setRamps({ rings: rampLUT("rings"), zone: rampLUT("zone") });
  map.setDipole(null);

  const trendLayer = (tm, id) => {
    const tr = trendRamp(id);
    R.tmapMax = niceMax(robustMax(tm.slope));
    map.setAux(packTrend(tm, R.tmapMax), R.v.entry.grid, { lut: rampLUT(tr.ramp, { flip: tr.flip }), levels: 12 });
    scene.layer = 1;
    scene.pHatch = s.hatch;
  };

  if (s.mode === "map" && s.layerView === "trend" && R.tmap) trendLayer(R.tmap, s.variable);
  if (s.mode === "band") {
    const b = s.band;
    scene.gray = true;
    scene.band = [b.min, b.max];
    scene.bandOn = !s.showRings;
    scene.trailN = s.showTrail && !s.showRings ? 5 : 0;
    scene.firstOn = s.showFirst && !app.frames.monthly && !s.showRings;
    scene.ringsOn = s.showRings && !app.frames.monthly;
    scene.bandSoft = ((style.domain[1] - style.domain[0]) * 0.12) / (map.norm.max - map.norm.min);
    if (s.showDipole && R.dipole) { map.setDipole(packDipole(R.dipole, R.v.entry.grid), R.v.entry.grid); scene.dipoleOn = true; }
    const lonSpan = (((region.lonMax - region.lonMin) % 360) + 360) % 360 || 360;
    if (s.showTrack && R.track && !global && lonSpan < 300 && !s.showRings) {
      const pts = R.track.years.map((y, k) => ({ year: y, lat: R.track.centroidLat[k], lon: R.track.centroidLon[k] }));
      ov.track = { points: pts, current: Math.max(0, Math.min(pts.length - 1, Math.round(Math.floor(frameYear(app.t)) - R.track.years[0]))) };
      if (R.coneLat?.ok !== false && R.coneLat && R.coneLon) {
        ov.cone = R.coneLat.years.map((y, k) => {
          const dLat = (R.coneLat.hi[k] - R.coneLat.lo[k]) / 2;
          const dLon = ((R.coneLon.hi[k] - R.coneLon.lo[k]) / 2) * Math.cos((R.coneLat.mean[k] * Math.PI) / 180);
          return { lat: R.coneLat.mean[k], lon: ((R.coneLon.mean[k] + 540) % 360) - 180, rKm: Math.min(2000, Math.hypot(dLat, dLon) * 111.2) };
        }).filter((c, k) => k % 2 === 1 && Number.isFinite(c.lat));
      }
    }
  }
  if (s.mode === "route" && R.routeOpen) {
    ov.routes.push({ points: R.routeOpen.samples, color: "#ffffff" });
    ov.choke = R.routeOpen.chokePoint;
    scene.iso = s.band.max ?? 0.15;
  }
  if (s.overlayRoute && s.mode !== "route") {
    const r = app.content.routes.find((x) => x.id === s.overlayRoute);
    if (r) ov.routes.push({ points: r.points, color: "#ffffff", dash: [7, 5] });
  }
  if (s.mode === "flow" && R.flow) {
    const sp = R.flow.speed, cap = R.flow.cap || 1, s0 = R.flow.medianSpeed || 1, lc = Math.log(1 + cap / s0);
    const aux = new Float32Array(sp.length * 4);
    for (let c = 0; c < sp.length; c++) if (Number.isFinite(sp[c])) { aux[4 * c] = Math.min(1, Math.log(1 + sp[c] / s0) / lc); aux[4 * c + 1] = 1; }
    map.setAux(aux, R.v.entry.grid, { lut: rampLUT("speed"), levels: 10 });
    scene.layer = 2;
    ov.vectors = { u: R.flow.u, v: R.flow.v, speed: R.flow.speed, grid: R.v.entry.grid, s0, cap };
  }
  if (s.mode === "twin" && R.twin) {
    const t2m = D.cachedVar("t2m");
    if (t2m && R.tmapT2m) {
      const tr = trendRamp("t2m");
      R.tmapMax = niceMax(robustMax(R.tmapT2m.slope));
      map.setAux(packTrend(R.tmapT2m, R.tmapMax), t2m.entry.grid, { lut: rampLUT(tr.ramp), levels: 12 });
      scene.layer = 1;
      scene.pHatch = false;
    }
    const tw = R.twin;
    ov.pins = [{ lat: R.home.lat, lon: R.home.lon, label: R.home.name ?? "Home" }];
    ov.arrows = [];
    if (tw.thenNow && Number.isFinite(tw.thenNow.lat)) ov.arrows.push({ from: [R.home.lat, R.home.lon], to: [tw.thenNow.lat, tw.thenNow.lon], color: "#ff3b30", label: "1980s climate now" });
    if (tw.nowWas && Number.isFinite(tw.nowWas.lat)) ov.arrows.push({ from: [R.home.lat, R.home.lon], to: [tw.nowWas.lat, tw.nowWas.lon], color: "#4aa3ff", label: "today's climate, 1980s", labelDy: 12 });
  }
  map.setScene(scene);
  map.setOverlay(ov);
  setTime(app.t);
}

// ---------- actions ----------
export const actions = {
  setMode(mode) {
    const s = app.state;
    const patch = { mode, prompt: null };
    if (mode === "route") Object.assign(patch, { variable: "seaice", regionId: "arctic", custom: null, months: [7, 8, 9, 10], band: { min: null, max: 0.15 }, route: s.route ?? "nsr" });
    if (mode === "band" && s.band.min == null && s.band.max == null) patch.band = varStyle(s.variable).band;
    if (mode === "twin") { if (!s.twin) patch.twin = defaultTwin(); patch.variable = "t2m"; }
    if (mode === "flow" && s.variable === "seaice") patch.variable = "t2m";
    if (mode === "map") patch.layerView = "trend";
    if (mode === "atlas") Object.assign(patch, { regionId: "global", custom: null });
    app.set(patch);
  },
  setVariable(id) {
    const s = app.state;
    const patch = { variable: id, prompt: null };
    if (s.mode === "band") patch.band = varStyle(id).band;
    if (id === "seaice" && regionOf(s).latMin < 50) { patch.regionId = "arctic"; patch.custom = null; }
    app.set(patch);
  },
  setRegion(id) { app.set({ regionId: id, custom: null, prompt: null }); },
  setCustomRegion(box) { app.set({ custom: box, prompt: null }); },
  setMonths(months) { app.set({ months: months.length ? months : ALL_MONTHS, prompt: null }); },
  setBand(band) { app.set({ band }); },
  toggle(key) { app.set({ [key]: !app.state[key] }); },
  set(patch) { app.set(patch); },
  applyAction(a, prompt) {
    const patch = {
      mode: a.mode ?? "series", variable: a.variable ?? app.state.variable, regionId: a.region ?? app.state.regionId, custom: null,
      months: a.months ?? ALL_MONTHS, overlayRoute: a.mode !== "route" && a.route ? a.route : null, prompt: prompt ?? null,
      proj: a.proj ?? "auto", cadence: a.cadence ?? "annual",
    };
    if (a.band) patch.band = a.band; else if (patch.mode === "band") patch.band = varStyle(patch.variable).band;
    if (a.mode === "route") patch.route = a.route ?? "nsr";
    if (a.twin) patch.twin = a.twin;
    patch.layerView = a.layerView ?? (patch.mode === "map" ? "trend" : app.state.layerView);
    patch.showRings = !!a.showRings;
    patch.showDipole = !!a.showDipole;
    if ("showTrack" in a) patch.showTrack = a.showTrack;
    app.set(patch);
    if (a.play) setTimeout(() => { setTime(0); setPlaying(true); }, 700);
    else if (a.year != null) setTimeout(() => { const k = app.frames?.years.indexOf(a.year); if (k >= 0) setTime(k); }, 600);
  },
};

// ---------- boot ----------
async function boot() {
  app.map = new MapView(document.getElementById("map"), {
    onHover: (ll) => W.hover(ll),
    onClick: (ll) => { if (app.state.mode === "twin") app.set({ twin: { lat: ll.lat, lon: ll.lon, name: W.nearestCityName(app, ll.lat, ll.lon, 250) } }); },
    onRegion: (box) => { app.map.drawMode = false; actions.setCustomRegion(box); },
  });
  app.map.loadBasemap();
  const [catalog, content] = await Promise.all([D.loadCatalog(), D.loadContent()]);
  app.catalog = catalog;
  app.content = content;
  app.S = createStore({ ...DEFAULTS, ...fromHash() });
  app.S.subscribe((s, changed) => {
    document.getElementById("app").dataset.mode = s.mode;
    if (changed.length === 1 && changed[0] === "chartKind") W.renderInspector();
    else update(changed);
  });
  renderAbout(app);
  app.cases = new CasePlayer(app);
  bindKeys();
  new ResizeObserver(() => { if (app.R.v) W.renderColorbar(); }).observe(document.getElementById("colorbar"));
  await update(["init"]);
  requestAnimationFrame(tick);
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!app.playing); }
    else if (e.key === "ArrowRight") { setPlaying(false); setTime(Math.round(app.t) + 1); }
    else if (e.key === "ArrowLeft") { setPlaying(false); setTime(Math.round(app.t) - 1); }
    else if (e.key === "Escape") { document.getElementById("aboutModal").hidden = true; app.map.drawMode = false; }
    else if (e.key === "b" || e.key === "B") { app.map.drawMode = true; W.toast("Drag a box on the map"); }
    else if (/^[1-8]$/.test(e.key)) actions.setMode(MODES[Number(e.key) - 1].id);
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById("loader").hidden = false;
  document.getElementById("loaderText").textContent = "Could not start: " + e.message;
});
