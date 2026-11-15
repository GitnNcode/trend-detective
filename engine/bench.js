// Time every engine call against a 200 ms budget.
//   node engine/bench.js                 synthetic data at real size (1980-01 + 561 months)
//   node engine/bench.js data/mock       a folder with catalog.json and .bin files
//   node engine/bench.js data            the real files

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as E from "./index.js";
import { synthVar, rng, ARCTIC } from "./test/fixtures.js";

const BUDGET_MS = 200;
const rows = [];

function time(label, fn) {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  rows.push({ label, ms });
  return out;
}

async function loadAll(dir) {
  const base = pathToFileURL(resolve(dir) + "/").href;
  const catalog = JSON.parse(await readFile(resolve(dir, "catalog.json"), "utf8"));
  return Promise.all(catalog.variables.map((entry) => E.loadVariable(entry, base)));
}

function synthetic() {
  const r = rng(1);
  const nt = 561;
  return [
    synthVar({ id: "t2m", nt }, ({ lat, k, month }) => 25 - 0.5 * Math.abs(lat) + 0.03 * k + 6 * Math.cos((month - 7) / 1.9) + r.normal()),
    synthVar({ id: "wind250", nt, units: "m/s", defaultBand: { min: 30, max: null } }, ({ lat, k }) => 45 * Math.exp(-(((lat - 40 - 0.05 * k) / 9) ** 2)) + r.normal()),
    synthVar({ id: "seaice", nt, grid: ARCTIC, scale: 0.0001, units: "0 to 1", defaultBand: { min: null, max: 0.15 } },
      ({ lat, k, month }) => Math.min(1, Math.max(0, (lat - 72 - 0.1 * k - 6 * Math.cos((month - 3) / 1.9)) / 6))),
  ];
}

const dir = process.argv[2];
const vars = dir ? await loadAll(dir) : synthetic();
const region = { latMin: 35, latMax: 65, lonMin: -80, lonMax: 0 };
const route = { points: [[69.0, 33.0], [77.5, 100.0], [66.0, -170.0]] };

for (const v of vars) {
  const id = v.entry.id;
  const band = v.entry.defaultBand ?? { min: null, max: 0 };
  const s = time(`${id} regionSeries (global)`, () => E.regionSeries(v, null));
  time(`${id} regionSeries (box)`, () => E.regionSeries(v, region));
  const d = time(`${id} deseasonalize`, () => E.deseasonalize(s));
  const a = time(`${id} annualMeans`, () => E.annualMeans(d, [9]));
  time(`${id} linearTrend + mannKendall + verdict`, () => E.verdict(E.linearTrend(a), E.mannKendall(a), v.entry.units));
  time(`${id} trendMap (first call, builds annual fields)`, () => E.trendMap(v));
  time(`${id} trendMap (cached fields)`, () => E.trendMap(v));
  const tr = time(`${id} bandTrack (first call for [9])`, () => E.bandTrack(v, { ...band, months: [9] }));
  time(`${id} bandTrack (slider move, cached)`, () => E.bandTrack(v, { min: band.min, max: band.max == null ? null : band.max * 1.1, months: [9] }));
  time(`${id} bandSummary`, () => E.bandSummary(tr));
  time(`${id} mask(last year)`, () => tr.mask(tr.years.length - 1));
  time(`${id} routeOpen`, () => E.routeOpen(v, route, { max: band.max ?? 0.15 }));
}

let over = 0;
for (const { label, ms } of rows) {
  const flag = ms > BUDGET_MS ? "  OVER BUDGET" : "";
  if (flag) over++;
  console.log(`${ms.toFixed(1).padStart(8)} ms  ${label}${flag}`);
}
console.log(over ? `${over} call(s) over ${BUDGET_MS} ms` : `all calls under ${BUDGET_MS} ms`);
