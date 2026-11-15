// Regression tests for the Codex (gpt-6.1-sol) review findings on 69b1bd5.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mannKendall, linearTrend, verdict, bandTrack, bandSummary, routeOpen, sampleRoute, regionSeries, regionCells, makeVar,
} from "../index.js";
import { synthVar, encode, makeEntry, ARCTIC, range } from "./fixtures.js";

test("a perfect line is significant: rounding noise is not autocorrelation", () => {
  const years = range(1980, 2024);
  const a = { years, values: Float64Array.from(years, (_, i) => 0.01 * i) };
  const mk = mannKendall(a);
  assert.equal(mk.r1, 0);
  assert.ok(mk.pAutocorr < 1e-10);
  assert.equal(verdict(linearTrend(a), mk, "°C").level, "significant");
});

test("a field exactly at the threshold is inside the band, as in routeOpen", () => {
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, nt: 24 }, () => 0.15);
  const track = bandTrack(v, { max: 0.15 });
  assert.ok(track.areaKm2[0] > 0);
  assert.ok(track.mask(0).some((x) => x === 1));
  assert.deepEqual(routeOpen(v, { points: [[75, 30], [75, 40]] }, { max: 0.15 }).openMonths, [12, 12]);
});

test("years with missing data are not counted as zero band area", () => {
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, nt: 30 * 12 }, ({ k }) => (k < 15 ? 0.05 : NaN));
  const track = bandTrack(v, { max: 0.15 });
  assert.ok(track.areaKm2.slice(15).every(Number.isNaN));
  const s = bandSummary(track);
  assert.equal(s.level, "none");
  assert.ok(!/shrinking/.test(s.sentence));
  assert.ok(!/NaN/.test(s.sentence));
});

test("a separate patch further on does not take over the edge", () => {
  // Open water 50-65N and a polynya at 80-82N; ice elsewhere.
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, nt: 10 * 12 }, ({ lat }) =>
    (lat <= 65 || (lat >= 80 && lat <= 82) ? 0 : 1));
  const track = bandTrack(v, { max: 0.15 });
  assert.equal(track.edgeKind, "poleward");
  assert.ok(Math.abs(track.edgeLat[0][0] - 65.15) < 1e-6, `edge ${track.edgeLat[0][0]}`);
});

test("regional grids: no wrap-around in the tiny-region fallback or route sampling", () => {
  const grid = { nlat: 5, nlon: 3, lat0: 50, lon0: 10, dlat: 1, dlon: 1 };
  assert.equal(regionCells(grid, { latMin: 51, latMax: 51, lonMin: 100, lonMax: 100 }).cells.length, 0);
  const entry = makeEntry({ grid, nt: 12, scale: 0.0001 });
  const v = makeVar(entry, encode(entry, () => 0.1));
  assert.ok(regionSeries(v, { latMin: 51, latMax: 51, lonMin: 100, lonMax: 100 }).values.every(Number.isNaN));

  assert.deepEqual(sampleRoute({ points: [[51, 9.9]] }, grid), [[51, 10]]);
  assert.deepEqual(routeOpen(v, { points: [[51, 9.9]] }, { max: 0.15 }).openMonths, [12]);
});
