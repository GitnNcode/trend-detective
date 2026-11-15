// End-to-end runs of the whole Engine API the way the interface calls it.
// 1. On synthetic data with missing land cells (always runs).
// 2. On Lane 1's files in /data/mock and /data, when they exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as E from "../index.js";
import { synthVar, rng, ARCTIC } from "./fixtures.js";

const REGIONS = [
  null,
  { latMin: 10, latMax: 20, lonMin: -15, lonMax: 35 },
  { latMin: 66, latMax: 90, lonMin: -180, lonMax: 180 },
  { latMin: 35, latMax: 65, lonMin: -80, lonMax: 0 },
  { latMin: -10, latMax: 10, lonMin: 170, lonMax: -170 },
  { latMin: 40.6, latMax: 40.8, lonMin: -74.1, lonMax: -73.9 },
];
const ROUTES = [
  { id: "nsr", points: [[69.0, 33.0], [77.5, 100.0], [66.0, -170.0]] },
  { id: "nyc-lhr", points: [[40.6, -73.8], [51.5, -0.5]] },
];

function noNaNText(obj, where) {
  assert.ok(!/NaN|undefined/.test(obj.sentence), `${where}: ${obj.sentence}`);
}

function runAll(v, label) {
  const units = v.entry.units;
  for (const region of REGIONS) {
    const s = E.regionSeries(v, region);
    assert.equal(s.values.length, v.entry.nt);
    for (const series of [s, E.deseasonalize(s)]) {
      for (const months of [undefined, [9], [12, 1, 2]]) {
        const a = E.annualMeans(series, months);
        const vd = E.verdict(E.linearTrend(a), E.mannKendall(a), units);
        assert.ok(["significant", "suggestive", "none"].includes(vd.level));
        noNaNText(vd, `${label} verdict ${JSON.stringify(region)} ${months}`);
      }
    }
  }
  const tm = E.trendMap(v);
  assert.equal(tm.slope.length, v.entry.grid.nlat * v.entry.grid.nlon);
  const band = v.entry.defaultBand ?? { min: null, max: 0 };
  for (const region of [null, REGIONS[2], REGIONS[3]]) {
    const track = E.bandTrack(v, { min: band.min, max: band.max, region });
    assert.equal(track.edgeLat.length, track.years.length);
    assert.equal(track.mask(0).length, v.entry.grid.nlat * v.entry.grid.nlon);
    const sum = E.bandSummary(track);
    assert.ok(["shift", "expansion", "contraction", "none"].includes(sum.kind));
    noNaNText(sum, `${label} band`);
  }
  for (const route of ROUTES) {
    const r = E.routeOpen(v, route, { max: band.max ?? 0.15 });
    assert.equal(r.openMonths.length, r.years.length);
  }
}

test("whole pipeline on synthetic data with missing land cells", () => {
  const r = rng(1);
  const land = (lat, lon) => lat > 60 && lat < 75 && lon > 60 && lon < 140;
  const t2m = synthVar({ id: "t2m", nt: 30 * 12 + 7 }, ({ lat, lon, k, month }) =>
    lat < -80 && lon > 0 ? NaN : 25 - 0.5 * Math.abs(lat) + 0.03 * k + 6 * Math.cos((month - 7) / 1.9) + r.normal());
  runAll(t2m, "t2m");
  const ice = synthVar({ id: "seaice", grid: ARCTIC, scale: 0.0001, units: "0 to 1", nt: 30 * 12, defaultBand: { min: null, max: 0.15 } },
    ({ lat, lon, k, month }) => (land(lat, lon) ? NaN : Math.min(1, Math.max(0, (lat - 72 - 0.1 * k - 6 * Math.cos((month - 3) / 1.9)) / 6))));
  runAll(ice, "seaice");
});

// TD_DATA_DIR points at another checkout's /data folder (for example Lane 1's
// branch before it is merged).
const root = process.env.TD_DATA_DIR
  ? process.env.TD_DATA_DIR.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../../data/", import.meta.url));
for (const dir of ["mock/", ""]) {
  const catalogPath = root + dir + "catalog.json";
  const exists = await access(catalogPath).then(() => true, () => false);
  test(`whole pipeline on /data/${dir}catalog.json`, { skip: exists ? false : "file not there yet" }, async (t) => {
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    for (const entry of catalog.variables) {
      const v = await E.loadVariable(entry, pathToFileURL(root + dir).href);
      const t0 = performance.now();
      runAll(v, entry.id);
      t.diagnostic(`${entry.id}: full run ${(performance.now() - t0).toFixed(0)} ms`);
    }
  });
}
