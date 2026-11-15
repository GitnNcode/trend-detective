// Run the engine the way the app does, on real files and real content, and
// print the numbers: validation checks, every demo case step and every
// sample question. Lane 4 uses this to put real numbers into the narration.
//   node engine/realcheck.js <dataDir> <contentDir>
//   node engine/realcheck.js data content

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as E from "./index.js";

const [dataDir = "data", contentDir = "content"] = process.argv.slice(2);
const readJson = async (p) => JSON.parse(await readFile(resolve(p), "utf8"));

const catalog = await readJson(`${dataDir}/catalog.json`);
const regions = Object.fromEntries((await readJson(`${contentDir}/regions.json`)).map((r) => [r.id, r]));
const routes = Object.fromEntries((await readJson(`${contentDir}/routes.json`)).map((r) => [r.id, r]));
const cases = await readJson(`${contentDir}/cases.json`);
const usecases = await readJson(`${contentDir}/usecases.json`);

const vars = new Map();
async function load(id) {
  if (!vars.has(id)) {
    const entry = catalog.variables.find((x) => x.id === id);
    if (!entry) throw new Error(`variable ${id} is not in ${dataDir}/catalog.json`);
    vars.set(id, await E.loadVariable(entry, pathToFileURL(resolve(dataDir) + "/").href));
  }
  return vars.get(id);
}

const regionOf = (id) => {
  if (!id || id === "global") return null;
  if (!regions[id]) throw new Error(`region ${id} is not in regions.json`);
  return regions[id];
};
const yearsText = (a) => `${a.years[0]}-${a.years.at(-1)}`;

async function run(action) {
  const v = await load(action.variable);
  const region = regionOf(action.region);
  const months = action.months;
  const units = v.entry.units;
  if (action.mode === "series") {
    const a = E.annualMeans(E.regionSeries(v, region), months);
    const vd = E.verdict(E.linearTrend(a), E.mannKendall(a), units);
    return `[${vd.level}] ${vd.sentence} (${yearsText(a)})`;
  }
  if (action.mode === "map") {
    const { slope, p } = E.trendMap(v, months);
    const { cells } = E.regionCells(v.entry.grid, region);
    let up = 0, down = 0, faded = 0, n = 0;
    for (const c of cells) {
      if (Number.isNaN(slope[c])) continue;
      n++;
      if (p[c] >= 0.05) faded++;
      else if (slope[c] > 0) up++;
      else down++;
    }
    const pct = (x) => `${Math.round((100 * x) / Math.max(1, n))}%`;
    return `cells with data ${n}: significant up ${pct(up)}, significant down ${pct(down)}, faded ${pct(faded)}`;
  }
  if (action.mode === "band") {
    const band = action.band ?? v.entry.defaultBand;
    const track = E.bandTrack(v, { min: band.min, max: band.max, months, region });
    const s = E.bandSummary(track);
    return `[${s.kind}/${s.level}] ${s.sentence} (shape ${track.bandShape}, edge ${track.edgeKind}, ` +
      `area ${E.fmt(track.areaKm2[0] / 1e6, 3)} -> ${E.fmt(track.areaKm2.at(-1) / 1e6, 3)} M km², ${track.years[0]}-${track.years.at(-1)})`;
  }
  if (action.mode === "route") {
    const route = routes[action.route];
    if (!route) throw new Error(`route ${action.route} is not in routes.json`);
    const r = E.routeOpen(v, route, { max: action.band?.max ?? 0.15, months });
    const a = { years: r.years, values: Float64Array.from(r.openMonths) };
    const vd = E.verdict(E.linearTrend(a), E.mannKendall(a), "months");
    const firstOpen = r.years.find((_, k) => r.openMonths[k] > 0);
    const recent = r.years.slice(-5).map((y, k) => `${y}:${r.openMonths[r.openMonths.length - 5 + k]}`).join(" ");
    const choke = r.chokePoint ? `${r.chokePoint[0]}N ${r.chokePoint[1]}E` : "none";
    return `[${vd.level}] open months per year: ${vd.sentence} First year with any open month: ${firstOpen ?? "never"}. ` +
      `Last five: ${recent}. Choke point ${choke}. ${r.samples.length} samples.`;
  }
  return `unknown mode ${action.mode}`;
}

// --- Validation against published numbers ---------------------------------
console.log("== Validation");
{
  const t2m = await load("t2m");
  const a = E.annualMeans(E.regionSeries(t2m, null));
  const t = E.linearTrend(a);
  console.log(`global t2m ${yearsText(a)}: ${E.fmt(t.slope * 10, 3)} °C per decade (95% ${E.fmt(t.ci95[0] * 10, 3)} to ${E.fmt(t.ci95[1] * 10, 3)})`);

  const ice = await load("seaice");
  const track = E.bandTrack(ice, { min: 0.15, months: [9] });
  const base = track.years.map((y, k) => (y >= 1981 && y <= 2010 ? track.areaKm2[k] : NaN)).filter((x) => !Number.isNaN(x));
  const baseMean = base.reduce((s, x) => s + x, 0) / base.length;
  const upTo2024 = { years: [], values: [] };
  track.years.forEach((y, k) => { if (y <= 2024) { upTo2024.years.push(y); upTo2024.values.push(track.areaKm2[k]); } });
  const it = E.linearTrend({ years: upTo2024.years, values: Float64Array.from(upTo2024.values) });
  const k2012 = track.years.indexOf(2012);
  console.log(`September Arctic extent (cells >= 0.15) ${upTo2024.years[0]}-2024: ${E.fmt((it.slope * 10 * 100) / baseMean, 3)}% of the 1981-2010 mean per decade; 2012: ${E.fmt(track.areaKm2[k2012] / 1e6, 3)} M km²`);
}

// --- Demo cases --------------------------------------------------------------
for (const c of cases) {
  console.log(`\n== Case: ${c.title}`);
  const seen = new Set();
  for (const [k, step] of c.steps.entries()) {
    const key = JSON.stringify(step.action);
    if (seen.has(key)) { console.log(`step ${k + 1}: same as before`); continue; }
    seen.add(key);
    console.log(`step ${k + 1} ${step.action.mode} ${step.action.variable} ${step.action.region} ${JSON.stringify(step.action.months)}${step.action.route ? " " + step.action.route : ""}`);
    console.log("  " + (await run(step.action)));
  }
}

// --- Sample questions --------------------------------------------------------
console.log("\n== Sample questions");
for (const u of usecases) {
  console.log(`${u.prompt}  [${u.variable} ${u.region} ${u.mode} ${JSON.stringify(u.months)}]`);
  console.log("  " + (await run(u)));
}
