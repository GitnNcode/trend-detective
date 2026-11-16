// Tanker voyage planning off the main thread. Loads the fine ocean mask,
// currents, 10 m wind and sea ice itself (the browser cache already holds the
// big files), then answers { type: "plan", id, voyage } with a stream of
// messages: "now" (route options for the latest year), "forecast" (next five
// years), "months" (best month to sail), "history" (every year, in batches),
// "done". A newer plan cancels the one in progress.

import * as E from "../engine/index.js";
import * as T from "../engine/tanker.js";
import { projectStates } from "../engine/shipping.js";

const BASE = new URL("../data/", import.meta.url).href;
let ready = null, current = 0;

async function bin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

async function init() {
  const cat = await (await fetch(BASE + "catalog.json")).json();
  const load = async (id) => {
    const e = cat.variables.find((x) => x.id === id);
    return e ? E.fromBuffer(e, await bin(BASE + e.file)) : null;
  };
  const om = await (await fetch(BASE + "ocean/ocean.json")).json();
  const [mask, cur, u, v, ice] = await Promise.all([bin(BASE + "ocean/" + om.mask.file), bin(BASE + "ocean/" + om.currents.file), load("u10"), load("v10"), load("seaice")]);
  const windGrid = (u ?? { entry: { grid: { nlat: 91, nlon: 144, lat0: -90, lon0: -180, dlat: 2, dlon: 2.5 } } }).entry.grid;
  const oc = T.makeOcean({
    maskPct: new Uint8Array(mask), maskGrid: om.mask.grid,
    currents: new Int16Array(cur), currentGrid: om.currents.grid, currentScale: om.currents.scale,
    windGrid, iceGrid: ice?.entry.grid ?? null,
  });
  return { oc, u, v, ice, windN: windGrid.nlat * windGrid.nlon };
}

// Per-year { u, v, ice } for one calendar month.
function monthStates(ctx, month) {
  const sets = [ctx.u, ctx.v, ctx.ice].map((x) => x && E.annualFields(x, [month]));
  const years = sets.filter(Boolean).reduce((ys, s) => ys.filter((y) => s.years.includes(y)), sets.find(Boolean).years);
  const pick = (a, yr, n) => (a ? a.fields.subarray(a.years.indexOf(yr) * a.ncell, (a.years.indexOf(yr) + 1) * a.ncell) : new Float32Array(n));
  return {
    years,
    states: years.map((yr) => ({ u: pick(sets[0], yr, ctx.windN), v: pick(sets[1], yr, ctx.windN), ice: sets[2] ? pick(sets[2], yr) : null })),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const slim = (o) => o && { via: o.via, canals: o.canals, km: o.km, days: o.days, fuelT: o.fuelT, co2T: o.co2T, tolls: o.tolls, cost: o.cost, path: o.path };

async function plan(id, voy) {
  const t0 = performance.now();
  const ctx = await (ready ??= init());
  if (id !== current) return;
  const oc = ctx.oc;
  const v = { ...voy, src: T.snap(oc, voy.from.lat, voy.from.lon), dst: T.snap(oc, voy.to.lat, voy.to.lon) };
  const access = T.canalAccess(voy.cls);
  const run = (st, month) => T.planVoyage(oc, T.weather(oc, st, month), v);

  const ms = monthStates(ctx, voy.month);
  const last = ms.years.length - 1;
  const now = run(ms.states[last], voy.month);
  postMessage({ type: "now", id, year: ms.years[last], options: now.options.map(slim), access });
  await tick(); if (id !== current) return;

  const proj = projectStates({ years: ms.years, states: ms.states.map((s) => (s.ice ? s : { u: s.u, v: s.v })) }, 5, { window: 20 });
  const fc = [];
  for (const st of proj.states) {
    fc.push(slim(run({ u: st.u, v: st.v, ice: st.ice ?? null }, voy.month).best));
    await tick(); if (id !== current) return;
  }
  postMessage({ type: "forecast", id, years: proj.years, best: fc });

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const s = monthStates(ctx, m), k = s.years.indexOf(ms.years[last]) >= 0 ? s.years.indexOf(ms.years[last]) : s.years.length - 1;
    const b = run(s.states[k], m).best;
    months.push(b ? { month: m, year: s.years[k], days: b.days, cost: b.cost, via: b.via } : { month: m, year: s.years[k], days: NaN, cost: NaN, via: [] });
    await tick(); if (id !== current) return;
  }
  postMessage({ type: "months", id, rows: months });

  const hist = [];
  for (let y = 0; y < ms.years.length; y++) {
    hist.push(slim(run(ms.states[y], voy.month).best));
    if (y % 6 === 5 || y === ms.years.length - 1) postMessage({ type: "history", id, years: ms.years.slice(0, hist.length), best: hist.slice() });
    await tick(); if (id !== current) return;
  }
  postMessage({ type: "done", id, ms: Math.round(performance.now() - t0) });
}

onmessage = (e) => {
  const { type, id, voyage } = e.data;
  if (type !== "plan") return;
  current = id;
  plan(id, voyage).catch((err) => postMessage({ type: "error", id, message: String(err?.message ?? err) }));
};
