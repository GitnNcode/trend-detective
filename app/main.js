// Trend Detective app controller: state, data loading, per-mode analysis,
// and wiring between the map, timeline, chart and panels.
// Written with Claude and reviewed by the team.

import * as E from "../engine/index.js";
import * as D from "./data.js";
import { varStyle, rampLUT, trendRamp, RAMPS } from "./palettes.js";
import { MapView } from "./map/map.js";
import { Timeline } from "./ui/timeline.js";
import { createStore, toHash, fromHash } from "./state.js";
import * as P from "./ui/panels.js";
import { renderLanding } from "./ui/landing.js";
import { CasePlayer } from "./ui/cases.js";
import { renderSheet } from "./ui/sheet.js";
import { renderAbout } from "./ui/about.js";

export const MODES = [
  { id: "series", label: "Time series", icon: "series", hint: "Fix a place, watch the value" },
  { id: "map", label: "Trend map", icon: "map", hint: "Where is it changing?" },
  { id: "band", label: "Shift", icon: "band", star: true, hint: "Fix a value, watch the place move" },
  { id: "flow", label: "Climate flow", icon: "flow", hint: "Climate velocity everywhere at once" },
  { id: "twin", label: "Climate twin", icon: "twin", hint: "Where did your climate go?" },
  { id: "route", label: "Routes", icon: "route", hint: "Is the Arctic lane opening?" },
  { id: "lineup", label: "Lineup", icon: "lineup", hint: "Interrogate all 10 variables" },
  { id: "atlas", label: "Atlas", icon: "atlas", hint: "Every variable, every cell" },
];

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const DEFAULTS = {
  view: "landing",
  mode: "band",
  variable: "t2m",
  regionId: "global",
  custom: null,
  months: ALL_MONTHS,
  band: { min: null, max: 0 },
  route: "nsr",
  overlayRoute: null,
  proj: "auto",
  cadence: "annual",
  layerView: "trend",
  chartKind: "trend",
  deseason: true,
  showTrail: true,
  showTrack: true,
  showFirst: true,
  showRings: false,
  showDipole: false,
  twin: null,
  prompt: null,
};

export const app = {
  S: null,
  content: null,
  catalog: null,
  map: null,
  timeline: null,
  chart: null,
  A: null,
  C: null,
  R: {},
  frames: null,
  t: 0,
  playing: false,
  speed: 1,
  loading: null,
  memo: new Map(),
  get state() { return this.S.get(); },
  set(patch, meta) { return this.S.set(patch, meta); },
};
window.TD = app; // handy for debugging in the console

// ---------- helpers ----------
export function regionOf(s = app.state) {
  if (s.custom) return { id: "custom", name: "Your region", type: "custom", ...s.custom };
  return app.content.regions.find((r) => r.id === s.regionId) ?? app.content.regions[0];
}

export function monthsLabel(months) {
  const m = [...months].sort((a, b) => a - b);
  if (m.length === 12) return "all year";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const key = m.join(",");
  const seasons = { "1,2,12": "Dec–Feb", "3,4,5": "Mar–May", "6,7,8": "Jun–Aug", "9,10,11": "Sep–Nov" };
  if (seasons[key]) return seasons[key];
  if (m.length === 1) return names[m[0] - 1];
  // contiguous run (possibly wrapping)
  return months.map((x) => names[x - 1]).join(" ");
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

export function defOf(id) {
  return app.content.definitions[id] ?? { name: id, plain: "", why: "" };
}
export function unitsOf(id) {
  return D.entryOf(id)?.units ?? "";
}

// ---------- loading UI ----------
const loaderEl = () => document.getElementById("loader");
function showLoader(text, frac) {
  const el = loaderEl();
  el.hidden = false;
  document.getElementById("loaderText").textContent = text;
  document.getElementById("loaderBar").style.width = `${Math.round((frac ?? 0) * 100)}%`;
}
function hideLoader() { loaderEl().hidden = true; }

export async function ensureVars(ids, label) {
  const missing = ids.filter((id) => !D.isLoaded(id));
  if (!missing.length) return Promise.all(ids.map((id) => D.getVar(id)));
  const prog = new Map(missing.map((id) => [id, 0]));
  const total = missing.reduce((s, id) => { const e = D.entryOf(id); return s + e.nt * e.grid.nlat * e.grid.nlon * 2; }, 0);
  const update = () => {
    let done = 0;
    for (const id of missing) { const e = D.entryOf(id); done += prog.get(id) * e.nt * e.grid.nlat * e.grid.nlon * 2; }
    const mb = (total / 1e6).toFixed(0);
    showLoader(`${label ?? "Streaming NASA MERRA-2"} · ${missing.length > 1 ? missing.length + " variables, " : ""}${(done / 1e6).toFixed(1)} / ${mb} MB`, done / total);
  };
  update();
  const out = await Promise.all(ids.map((id) => D.getVar(id, (f) => { prog.set(id, f); update(); })));
  hideLoader();
  return out;
}

// ---------- frames (timeline) ----------
function ensureField(v) {
  const s = app.state;
  const monthly = s.cadence === "monthly" && v.entry.nt <= app.map.gl.maxLayers;
  const key = `${v.entry.id}|${monthly ? "m" : "a" + mkey(s)}`;
  if (app.fieldKey === key) return false;
  const range = D.valueRange(v);
  const style = varStyle(v.entry.id);
  let data, labels, years, layers;
  const prevYear = app.frames ? frameYear(app.t) : null;
  if (monthly) {
    data = D.packMonthly(v, range);
    labels = E.timeLabels(v.entry).map((t) => {
      const [y, m] = t.split("-");
      return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
    });
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
  app.map.setFieldStyle({ lut: rampLUT(style.ramp), cdom: style.domain, gamma: style.gamma ?? 1 });
  app.frames = { monthly, labels, years, n: layers, key };
  app.fieldKey = key;
  const ticks = [];
  labels.forEach((lab, k) => {
    const y = Math.floor(years[k]);
    const isFirstOfYear = !monthly || lab.startsWith("Jan");
    if (isFirstOfYear && y % 10 === 0) ticks.push({ i: k, label: String(y) });
  });
  app.timeline.setRange(labels, ticks);
  app.timeline.setCadence(monthly ? "monthly" : "annual");
  // Keep the same moment when switching cadence; otherwise jump to the latest frame.
  let t = layers - 1;
  if (prevYear != null && Number.isFinite(prevYear)) {
    const k = years.findIndex((y) => y >= prevYear - 1e-6);
    if (k >= 0) t = k;
  }
  setTime(t);
  return true;
}

export function frameYear(t) {
  const f = app.frames;
  if (!f) return NaN;
  const k = Math.max(0, Math.min(f.n - 1, t));
  const a = Math.floor(k), b = Math.min(f.n - 1, a + 1);
  return f.years[a] + (f.years[b] - f.years[a]) * (k - a);
}

export function setTime(t) {
  const f = app.frames;
  if (!f) return;
  app.t = Math.max(0, Math.min(f.n - 1, t));
  app.map.setTime(app.t);
  app.timeline.setValue(app.t);
  const yr = frameYear(app.t);
  app.chart?.setCursor?.(f.monthly ? yr : Math.round(yr));
  P.renderHudYear(app);
  // Track marker follows the playhead in Shift mode.
  if (app.R.track && app.map.overlay.track) {
    const yi = Math.round(Math.floor(yr) - app.R.track.years[0]);
    app.map.overlay.track.current = Math.max(0, Math.min(app.R.track.years.length - 1, yi));
  }
}

// ---------- playback ----------
let lastTick = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (app.playing && app.frames) {
    const rate = (app.frames.monthly ? 7 : 2.4) * app.speed;
    let t = app.t + dt * rate;
    if (t >= app.frames.n - 1) {
      t = app.frames.n - 1;
      if (app.loop) t = 0; else setPlaying(false);
    }
    setTime(t);
  }
  requestAnimationFrame(tick);
}

export function setPlaying(p) {
  if (p && app.frames && app.t >= app.frames.n - 1.001) setTime(0);
  app.playing = p;
  app.timeline.setPlaying(p);
}

// ---------- projection choice ----------
function autoProjection(s, region) {
  if (s.proj !== "auto") return { kind: s.proj, south: region.latMax <= -50 };
  if (s.variable === "seaice") return { kind: "polar", south: false };
  if (region.latMin >= 55 && region.latMax - region.latMin < 50) return { kind: "polar", south: false };
  if (region.latMax <= -55) return { kind: "polar", south: true };
  const span = (((region.lonMax - region.lonMin) % 360) + 360) % 360 || 360;
  if (span >= 359 && region.latMax - region.latMin >= 170) return { kind: s.mode === "twin" ? "globe" : "flat", south: false };
  return { kind: "globe", south: false };
}

// ---------- the main update ----------
let token = 0;
export async function update(changed = []) {
  const my = ++token;
  const s = app.state;
  const region = regionOf(s);
  try {
    if (!app.A) app.A = await import("./lib/analysis.js").catch((e) => { console.warn("analysis.js not ready", e); return null; });
    if (!app.C) app.C = await import("./chart.js").catch((e) => { console.warn("chart.js not ready", e); return null; });
    if (my !== token) return;
    P.ensureChart(app);

    if (s.view === "landing") { await landingVisual(my); return; }

    // Projection and framing
    if (changed.some((k) => ["regionId", "custom", "variable", "proj", "mode", "view", "init"].includes(k))) {
      const pk = autoProjection(s, region);
      const was = app.map.kind + app.map.polarSouth;
      app.map.setProjection(pk.kind, { south: pk.south });
      const frameIt = changed.some((k) => ["regionId", "custom", "init", "view"].includes(k)) || was !== pk.kind + pk.south;
      if (frameIt && s.view === "app") app.map.fitRegion(region, { animate: true });
    }

    const v = (await ensureVars([s.variable], `Loading ${defOf(s.variable).name}`))[0];
    if (my !== token) return;
    ensureField(v);

    const R = { v, region };
    const months = s.months;
    const units = v.entry.units;
    const A = app.A;

    // Region series and verdict (used by most modes)
    const rs = memo(`rs|${s.variable}|${rkey(region)}`, () => E.regionSeries(v, region));
    const ds = memo(`ds|${s.variable}|${rkey(region)}`, () => E.deseasonalize(rs));
    const annual = memo(`an|${s.variable}|${rkey(region)}|${mkey(s)}|${s.deseason}`, () => E.annualMeans(s.deseason && months.length < 12 ? ds : rs, months));
    R.rs = rs; R.annual = annual;
    R.trend = E.linearTrend(annual);
    R.mk = E.mannKendall(annual);
    R.verdict = E.verdict(R.trend, R.mk, units);
    R.empty = !annual.values.some(Number.isFinite);
    R.detection = A ? A.detectionHorizon(annual) : null;

    const needTrend = ["map", "band", "series", "twin", "lineup"].includes(s.mode);
    if (needTrend) R.tmap = memo(`tm|${s.variable}|${mkey(s)}`, () => E.trendMap(v, months));

    if (s.mode === "band") {
      const b = s.band;
      R.track = memo(`bt|${s.variable}|${rkey(region)}|${mkey(s)}|${b.min}|${b.max}`, () => E.bandTrack(v, { min: b.min, max: b.max, months, region }));
      R.bandSummary = E.bandSummary(R.track);
      if (A) {
        R.dipole = memo(`dp|${s.variable}|${rkey(region)}|${mkey(s)}|${b.min}|${b.max}`, () => A.dipole(v, R.track, months));
        R.dist = memo(`ds2|${s.variable}|${rkey(region)}|${mkey(s)}`, () => A.distributionShift(v, region, months));
        const edge = R.bandSummary.edgeMeanLat;
        if (edge && edge.some(Number.isFinite)) R.edgeDetection = A.detectionHorizon({ years: R.track.years, values: Float64Array.from(edge) });
        // Hurricane-style cone: extrapolate the centroid track.
        const lastY = R.track.years[R.track.years.length - 1];
        const cl = Float64Array.from(R.track.centroidLat), co = Float64Array.from(unwrapLons(R.track.centroidLon));
        if (cl.some(Number.isFinite)) {
          R.coneLat = A.extrapolate(R.track.years, cl, lastY + 25);
          R.coneLon = A.extrapolate(R.track.years, co, lastY + 25);
        }
      }
    }
    if (s.mode === "route") {
      const route = app.content.routes.find((r) => r.id === s.route) ?? app.content.routes[0];
      R.route = route;
      R.routeOpen = memo(`ro|${s.variable}|${route.id}|${mkey(s)}|${s.band.max}`, () => E.routeOpen(v, route, { max: s.band.max ?? 0.15, months }));
      const ann = { years: R.routeOpen.years, values: Float64Array.from(R.routeOpen.openMonths) };
      R.routeAnnual = ann;
      R.routeTrend = E.linearTrend(ann);
      R.routeMK = E.mannKendall(ann);
      R.routeVerdict = E.verdict(R.routeTrend, R.routeMK, "months");
      R.routeDetection = A ? A.detectionHorizon(ann) : null;
    }
    if (s.mode === "flow" && A) {
      R.flow = memo(`vf|${s.variable}|${mkey(s)}`, () => A.velocityField(v, months));
      R.flowSummary = A.velocitySummary(R.flow, region);
      if (s.variable === "t2m" || D.isLoaded("soilwet")) {
        const soil = D.cachedVar("soilwet");
        if (soil) {
          const land = memo("landmask", () => A.landMaskFrom(soil));
          R.flowLand = memo(`vfl|${s.variable}|${mkey(s)}`, () => landSummary(R.flow, land));
        }
      }
    }
    if (s.mode === "twin" && A) {
      const [t2m, precip, soil] = await ensureVars(["t2m", "precip", "soilwet"], "Loading the climate fingerprint (temperature, rain, land)");
      if (my !== token) return;
      const land = memo("landmask", () => A.landMaskFrom(soil));
      const home = s.twin ?? defaultTwin();
      R.home = home;
      R.twin = memo(`tw|${home.lat}|${home.lon}`, () => A.climateTwin({ t2m, precip }, home.lat, home.lon, { landMask: land }));
    }
    if ((s.mode === "lineup" || s.mode === "atlas") && A) {
      const ids = D.variableIds();
      const vs = await ensureVars(ids, s.mode === "lineup" ? "Bringing in all 10 suspects" : "Scanning the whole planet");
      if (my !== token) return;
      const byId = Object.fromEntries(ids.map((id, k) => [id, vs[k]]));
      if (s.mode === "lineup") R.lineup = memo(`lu|${rkey(region)}|${mkey(s)}`, () => A.lineup(byId, region, months));
      else R.atlas = ids.map((id) => ({ id, v: byId[id], tm: memo(`tm|${id}|${mkey(s)}`, () => E.trendMap(byId[id], months)) }));
    }
    if (my !== token) return;
    app.R = R;
    applyScene();
    P.renderAll(app);
    renderSheet(app);
    history.replaceState(null, "", toHash(s));
  } catch (err) {
    console.error(err);
    hideLoader();
    P.toast(`Something went wrong: ${err.message}`);
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

function landSummary(flow, land) {
  const g = flow.grid;
  const areas = E.rowAreasKm2(g);
  const vals = [];
  for (let c = 0; c < flow.speed.length; c++) {
    if (!land[c]) continue;
    const s = flow.speed[c];
    if (Number.isFinite(s)) vals.push([s, areas[Math.floor(c / g.nlon)]]);
  }
  vals.sort((a, b) => a[0] - b[0]);
  const tot = vals.reduce((s, x) => s + x[1], 0);
  let acc = 0, med = NaN;
  for (const [s, w] of vals) { acc += w; if (acc >= tot / 2) { med = s; break; } }
  return { medianKmPerDecade: med * 10 };
}

export function defaultTwin() {
  const c = app.content.cities?.find((x) => x.name === "Chicago") ?? { name: "Chicago", lat: 41.88, lon: -87.63 };
  return { lat: c.lat, lon: c.lon, name: c.name };
}

// Push mode-specific layers into the map.
export function applyScene() {
  const s = app.state, R = app.R, map = app.map;
  const region = R.region;
  const global = region.type === "global";
  const scene = { layer: 0, region: global ? null : region, bright: 1, sat: 1 };
  const ov = { region: global ? null : region, regionLabel: global ? null : region.name, routes: [] };
  const style = varStyle(s.variable);
  map.setRamps({ rings: rampLUT("rings"), zone: rampLUT("zone") });
  map.particles.setField(null);

  if (s.mode === "map" || (s.mode === "series" && s.layerView === "trend" && false)) {
    if (s.layerView === "trend" && R.tmap) {
      const tr = trendRamp(s.variable);
      map.setAux(packTrend(R.tmap, R.v.entry.grid, (R.tmapMax = robustMax(R.tmap.slope))), R.v.entry.grid, { lut: rampLUT(tr.ramp, { flip: tr.flip }) });
      scene.layer = 1;
      scene.pFog = true;
    }
  }
  if (s.mode === "band") {
    const b = s.band;
    scene.band = [b.min, b.max];
    scene.bandOn = !s.showRings;
    scene.bright = 0.5;
    scene.sat = 0.35;
    scene.trailN = s.showTrail ? (app.frames.monthly ? 8 : 10) : 0;
    scene.trailStep = 1;
    scene.firstOn = s.showFirst && !app.frames.monthly;
    scene.firstLayer = 0;
    scene.ringsOn = s.showRings && !app.frames.monthly;
    scene.ringStep = 1;
    const span = style.domain[1] - style.domain[0];
    scene.bandSoft = (span * 0.12) / (map.norm.max - map.norm.min);
    if (s.showDipole && R.dipole) {
      map.setDipole(packDipole(R.dipole, R.v.entry.grid), R.v.entry.grid);
      scene.dipoleOn = true;
    } else map.setDipole(null);
    const lonSpan = (((region.lonMax - region.lonMin) % 360) + 360) % 360 || 360;
    if (s.showTrack && R.track && region.type !== "global" && lonSpan < 300) {
      const pts = R.track.years.map((y, k) => ({ year: y, lat: R.track.centroidLat[k], lon: R.track.centroidLon[k] }));
      ov.track = { points: pts, current: Math.max(0, Math.min(pts.length - 1, Math.round(Math.floor(frameYear(app.t)) - R.track.years[0]))) };
      if (R.coneLat && R.coneLon) {
        ov.cone = R.coneLat.years.filter((_, k) => k % 2 === 1).map((y, kk) => {
          const k = kk * 2 + 1;
          const dLat = (R.coneLat.hi[k] - R.coneLat.lo[k]) / 2;
          const dLon = (R.coneLon.hi[k] - R.coneLon.lo[k]) / 2 * Math.cos(R.coneLat.mean[k] * Math.PI / 180);
          return { lat: R.coneLat.mean[k], lon: ((R.coneLon.mean[k] + 540) % 360) - 180, rKm: Math.min(2500, Math.hypot(dLat, dLon) * 111.2) };
        });
        ov.coneLabel = `if the trend simply continued → ${R.coneLat.years[R.coneLat.years.length - 1]}`;
      }
    }
  } else {
    map.setDipole(null);
  }
  if (s.mode === "route" && R.routeOpen) {
    ov.routes.push({ points: R.routeOpen.samples, color: "#ffffff", glow: "rgba(76,201,255,0.9)", width: 2.4, label: R.route.name });
    ov.choke = R.routeOpen.chokePoint;
    scene.iso = s.band.max ?? 0.15;
  }
  if (s.overlayRoute && s.mode !== "route") {
    const r = app.content.routes.find((x) => x.id === s.overlayRoute);
    // d3 draws each segment as a great-circle arc, which is what a flight follows.
    if (r) ov.routes.push({ points: r.points, color: "#ffffff", glow: "rgba(255,138,61,0.9)", width: 2, dash: [8, 6], label: r.name });
  }
  if (s.mode === "flow" && R.flow) {
    const sp = R.flow.speed, g = R.v.entry.grid;
    const cap = R.flow.cap || 1;
    const aux = new Float32Array(sp.length * 4);
    const s0 = R.flow.medianSpeed || 1;
    const lc = Math.log(1 + cap / s0);
    for (let c = 0; c < sp.length; c++) {
      const val = sp[c];
      if (Number.isFinite(val)) { aux[4 * c] = Math.min(1, Math.log(1 + val / s0) / lc); aux[4 * c + 1] = 1; }
    }
    map.setAux(aux, g, { lut: rampLUT("speed"), gamma: 1 });
    scene.layer = 2;
    scene.bright = 0.42;
    map.particles.setField(R.flow);
  }
  if (s.mode === "twin" && R.twin) {
    const tw = R.twin, now = performance.now();
    ov.pins = [{ lat: R.home.lat, lon: R.home.lon, label: R.home.name ?? "Home", color: "#ffffff" }];
    ov.arrows = [];
    if (tw.thenNow && Number.isFinite(tw.thenNow.lat)) ov.arrows.push({ from: [R.home.lat, R.home.lon], to: [tw.thenNow.lat, tw.thenNow.lon], color: "#ff8a3d", label: "its 1980s climate is here now", t0: now });
    if (tw.nowWas && Number.isFinite(tw.nowWas.lat)) ov.arrows.push({ from: [R.home.lat, R.home.lon], to: [tw.nowWas.lat, tw.nowWas.lon], color: "#4cc9ff", label: "its climate today was here in the 1980s", labelDy: 18, t0: now + 300 });
    scene.bright = 0.62;
    scene.region = null;
    ov.region = null;
  }
  map.setScene(scene);
  map.setOverlay(ov);
  setTime(app.t);
}

function robustMax(arr) {
  const a = [];
  for (const x of arr) if (Number.isFinite(x)) a.push(Math.abs(x));
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return a[Math.floor(a.length * 0.98)] || a[a.length - 1] || 1;
}

function packTrend(tm, grid, maxAbs) {
  const n = tm.slope.length;
  const out = new Float32Array(n * 4);
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
  const n = grid.nlat * grid.nlon;
  const out = new Uint8Array(n * 2);
  for (let c = 0; c < n; c++) { out[2 * c] = dp.arrived[c] ? 255 : 0; out[2 * c + 1] = dp.left[c] ? 255 : 0; }
  return out;
}

// ---------- actions used by panels ----------
export const actions = {
  setMode(mode) {
    const s = app.state;
    const patch = { mode };
    if (mode === "route") Object.assign(patch, { variable: "seaice", regionId: "arctic", custom: null, months: [7, 8, 9, 10], band: { min: null, max: 0.15 }, route: s.route ?? "nsr" });
    if (mode === "band" && s.band.min == null && s.band.max == null) patch.band = varStyle(s.variable).band;
    if (mode === "twin" && !s.twin) patch.twin = defaultTwin();
    if (mode === "flow" && s.variable === "seaice") patch.variable = "t2m";
    if (mode === "map") patch.layerView = "trend";
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
  setCustomRegion(box) { app.set({ custom: box, prompt: null }); P.toast("Custom region set. Every result now uses your box."); },
  setMonths(months) { app.set({ months: months.length ? months : ALL_MONTHS, prompt: null }); },
  setBand(band) { app.set({ band }); },
  toggle(key) { app.set({ [key]: !app.state[key] }); },
  set(patch) { app.set(patch); },
  applyAction(a, prompt) {
    const patch = {
      mode: a.mode ?? "series",
      variable: a.variable ?? app.state.variable,
      regionId: a.region ?? app.state.regionId,
      custom: null,
      months: a.months ?? ALL_MONTHS,
      overlayRoute: a.mode !== "route" && a.route ? a.route : null,
      prompt: prompt ?? null,
    };
    if (a.band) patch.band = a.band;
    else if (patch.mode === "band") patch.band = varStyle(patch.variable).band;
    if (a.mode === "route") patch.route = a.route ?? "nsr";
    if (a.twin) patch.twin = a.twin;
    if (a.proj) patch.proj = a.proj; else patch.proj = "auto";
    if (a.layerView) patch.layerView = a.layerView; else if (patch.mode === "map") patch.layerView = "trend";
    for (const k of ["showRings", "showDipole", "showTrail", "showTrack", "cadence"]) if (k in a) patch[k] = a[k];
    if (!("showRings" in a) && patch.mode === "band") patch.showRings = false;
    if (!("showDipole" in a) && patch.mode === "band") patch.showDipole = false;
    if (!("cadence" in a)) patch.cadence = "annual";
    app.set(patch);
    if (a.play) setTimeout(() => { setTime(0); setPlaying(true); }, 900);
    if (a.year != null) setTimeout(() => { const k = app.frames?.years.indexOf(a.year); if (k >= 0) setTime(k); }, 700);
  },
  enterApp(action) {
    app.set({ view: "app" });
    document.getElementById("app").dataset.view = "app";
    app.map.autoRotate = false;
    app.map.offsetX = 0;
    if (action) setTimeout(() => actions.applyAction(action, action.prompt), 350);
  },
  goLanding() {
    setPlaying(false);
    app.cases?.stop();
    document.getElementById("app").dataset.view = "landing";
    landingScene();
    app.set({ view: "landing" });
  },
  play: (p) => setPlaying(p),
  seek: (t) => setTime(t),
};

// The landing globe: the 1980-2025 warming trend of every grid cell.
async function landingVisual(my) {
  const v = await D.getVar("t2m");
  if (my !== token) return;
  ensureField(v);
  const tm = memo(`tm|t2m|${ALL_MONTHS.join(".")}`, () => E.trendMap(v, ALL_MONTHS));
  const tr = trendRamp("t2m");
  const aux = packTrend(tm, v.entry.grid, robustMax(tm.slope));
  // Lift the mid-tones so moderate warming reads as warm, not brown.
  for (let k = 0; k < aux.length; k += 4) aux[k] = Math.sign(aux[k]) * Math.pow(Math.abs(aux[k]), 0.6);
  app.map.setAux(aux, v.entry.grid, { lut: rampLUT(tr.ramp, { flip: tr.flip }) });
  app.map.particles.setField(null);
  app.map.setDipole(null);
  app.map.setScene({ layer: 1, pFog: false, bright: 1.15 });
  app.map.setOverlay({});
  if (app.map.kind !== "globe") app.map.setProjection("globe");
  history.replaceState(null, "", location.pathname);
}

// The landing shows a slowly spinning globe of the 1980-2025 warming map.
function landingScene() {
  app.map.setProjection("globe");
  app.map.view = { lon: -30, lat: 18, zoom: 1.05 };
  app.map.offsetX = window.innerWidth > 1100 ? 0.2 : 0;
  app.map.autoRotate = true;
}

// ---------- boot ----------
async function boot() {
  const map = new MapView(document.getElementById("map"), {
    onHover: (ll, pt) => P.hover(app, ll, pt),
    onClick: (ll) => {
      if (app.state.mode === "twin") app.set({ twin: { lat: ll.lat, lon: ll.lon, name: P.nearestCityName(app, ll.lat, ll.lon) } });
    },
    onRegion: (box) => { app.map.drawMode = false; actions.setCustomRegion(box); P.renderTools(app); },
    onViewChange: () => {},
  });
  app.map = map;
  app.timeline = new Timeline(document.getElementById("timeline"), {
    onPlay: (p) => setPlaying(p),
    onSeek: (t) => { setTime(t); },
    onSpeed: (sp) => { app.speed = sp; },
    onCadence: (c) => app.set({ cadence: c }),
  });
  map.loadBasemap();
  const [catalog, content] = await Promise.all([D.loadCatalog(), D.loadContent()]);
  app.catalog = catalog;
  app.content = content;

  const fromUrl = fromHash();
  const initial = { ...DEFAULTS, ...fromUrl };
  if (Object.keys(fromUrl).length) initial.view = "app";
  app.S = createStore(initial);
  document.getElementById("app").dataset.view = initial.view;
  app.S.subscribe((s, changed) => {
    document.getElementById("app").dataset.mode = s.mode;
    const heavy = changed.filter((k) => !["chartKind"].includes(k));
    if (heavy.length) update(changed);
    else P.renderAll(app);
  });
  document.getElementById("app").dataset.mode = initial.mode;

  P.renderModeTabs(app);
  renderLanding(app);
  renderAbout(app);
  app.cases = new CasePlayer(app);
  const appEl = document.getElementById("app");
  const fit = () => appEl.classList.toggle("left-collapsed", innerWidth < 1280 && innerWidth > 1100);
  fit();
  addEventListener("resize", fit);
  document.getElementById("drawerBtn").addEventListener("click", () => appEl.classList.toggle("left-open"));
  document.getElementById("map").addEventListener("pointerdown", () => appEl.classList.remove("left-open"));
  document.getElementById("leftPanel").addEventListener("click", (e) => {
    if (e.target.closest(".q, .case-card")) appEl.classList.remove("left-open");
  });
  document.getElementById("brandBtn").addEventListener("click", () => actions.goLanding());
  document.getElementById("casesBtn").addEventListener("click", () => app.cases.open());
  document.getElementById("aboutBtn").addEventListener("click", () => { document.getElementById("aboutModal").hidden = false; });
  bindKeys();
  if (initial.view === "landing") landingScene();
  await update(["init"]);
  requestAnimationFrame(tick);
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!app.playing); }
    else if (e.key === "ArrowRight") setTime(Math.round(app.t) + 1);
    else if (e.key === "ArrowLeft") setTime(Math.round(app.t) - 1);
    else if (e.key === "Escape") { document.getElementById("aboutModal").hidden = true; app.map.drawMode = false; }
    else if (/^[1-8]$/.test(e.key) && app.state.view === "app") actions.setMode(MODES[Number(e.key) - 1].id);
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById("loader").hidden = false;
  document.getElementById("loaderText").textContent = "Could not start: " + e.message;
});
