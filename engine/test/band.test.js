import { test } from "node:test";
import assert from "node:assert/strict";
import { bandTrack, bandSummary, trendMap, annualFields, rowAreasKm2, KM_PER_DEG_LAT } from "../index.js";
import { synthVar, rng, ARCTIC } from "./fixtures.js";

const within = (a, b, rel) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} not within ${rel * 100}% of ${b}`);
const seasonal = (month) => Math.cos((2 * Math.PI * (month - 1)) / 12);

test("trendMap recovers a per-cell slope pattern", () => {
  const r = rng(3);
  const v = synthVar({ nt: 40 * 12 }, ({ lat, lat: _l, lon, k, month }) =>
    lon === 0 && lat === 0 ? NaN : 5 * seasonal(month) + 0.002 * lat * k + 0.05 * r.normal());
  const { slope, p, years } = trendMap(v);
  assert.equal(years.length, 40);
  const nlon = 144;
  const at = (lat, lon) => ((lat + 90) / 2) * nlon + (lon + 180) / 2.5;
  within(slope[at(60, 50)], 0.12, 0.05);
  within(slope[at(-40, -100)], -0.08, 0.05);
  assert.ok(p[at(60, 50)] < 1e-6);
  assert.ok(Number.isNaN(slope[at(0, 0)]));
  // Cached: same object for the same months, different for a season.
  assert.equal(annualFields(v), annualFields(v, []));
  assert.notEqual(annualFields(v), annualFields(v, [6, 7, 8]));
});

test("a strip band moving 1° per decade reports about 111 km per decade as a shift", (t) => {
  // A jet: wind peaks at a latitude that moves north 0.1° a year.
  const r = rng(5);
  const v = synthVar({ units: "m/s", nt: 45 * 12 }, ({ lat, k, month }) => {
    const c = 40 + 0.1 * k + 2 * seasonal(month);
    return 45 * Math.exp(-(((lat - c) / 9) ** 2)) + 0.5 * r.normal();
  });
  const region = { latMin: 10, latMax: 80, lonMin: -80, lonMax: 0 };
  const track = bandTrack(v, { min: 30, max: null, region });
  assert.equal(track.bandShape, "strip");
  assert.equal(track.years.length, 45);
  const s = bandSummary(track);
  t.diagnostic(`strip: ${s.edgeShiftKmPerDecade.toFixed(1)} km/decade, kind ${s.kind}`);
  within(s.edgeShiftKmPerDecade, KM_PER_DEG_LAT, 0.08);
  assert.equal(s.kind, "shift");
  assert.ok(s.edgeP < 0.001);
  assert.match(s.sentence, /shifting poleward \(north\) by about 11\d km per decade/);
  assert.ok(Math.abs(s.widthChangeKmPerDecade) < 15);
  // Edges sit either side of the core.
  const j = (-40 + 180) / 2.5;
  const mid = track.polewardEdgeLat[0][j] - track.equatorwardEdgeLat[0][j];
  assert.ok(mid > 5 && mid < 20);
});

test("a strip clipped by the region border falls back to the edge it can follow", () => {
  // As in the real North Atlantic jet: the equatorward edge crosses the
  // region's southern border partway through the record.
  const r = rng(12);
  const v = synthVar({ units: "m/s", nt: 45 * 12 }, ({ lat, k }) => {
    const c = 40 + 0.1 * k;
    return 45 * Math.exp(-(((lat - c) / 9) ** 2)) + 0.5 * r.normal();
  });
  const track = bandTrack(v, { min: 30, region: { latMin: 36, latMax: 80, lonMin: -80, lonMax: 0 } });
  assert.equal(track.bandShape, "strip");
  const s = bandSummary(track);
  assert.equal(s.edgeUsed, "poleward");
  within(s.edgeShiftKmPerDecade, KM_PER_DEG_LAT, 0.1);
  assert.equal(s.kind, "shift");

  // A region too narrow to hold either edge: the sentence says so.
  const narrow = bandSummary(bandTrack(v, { min: 30, region: { latMin: 41, latMax: 45, lonMin: -80, lonMax: 0 } }));
  assert.equal(narrow.edgeUsed, "none");
  assert.match(narrow.sentence, /runs into the border of the region/);
});

test("a cold cap whose edge retreats 1° per decade is a contraction with a poleward edge shift", (t) => {
  const r = rng(6);
  const v = synthVar({ nt: 45 * 12 }, ({ lat, k, month }) => {
    const freeze = 55 + 0.1 * k;
    return 0.6 * (freeze - Math.abs(lat)) + 8 * seasonal(month) * (lat > 0 ? -1 : 1) + 0.6 * r.normal();
  });
  const track = bandTrack(v, { min: null, max: 0, region: { latMin: 0, latMax: 90, lonMin: -180, lonMax: 180 } });
  assert.equal(track.hemisphere, "N");
  assert.equal(track.bandShape, "poleward");
  assert.equal(track.edgeKind, "equatorward");
  const s = bandSummary(track);
  t.diagnostic(`cap: ${s.edgeShiftKmPerDecade.toFixed(1)} km/decade, area ${s.areaPctPerDecade.toFixed(1)}%/decade`);
  within(s.edgeShiftKmPerDecade, KM_PER_DEG_LAT, 0.08);
  assert.equal(s.kind, "contraction");
  assert.ok(s.areaTrend < 0);
  assert.match(s.sentence, /shrinking/);

  // mask(0) area matches areaKm2[0].
  const m = track.mask(0);
  const rows = rowAreasKm2(v.entry.grid);
  let area = 0;
  for (let c = 0; c < m.length; c++) if (m[c]) area += rows[Math.floor(c / 144)];
  within(area, track.areaKm2[0], 1e-9);
});

test("southern hemisphere: poleward is south, still reported as positive", () => {
  const v = synthVar({ nt: 30 * 12 }, ({ lat, k }) => 0.6 * (55 + 0.1 * k - Math.abs(lat)));
  const track = bandTrack(v, { max: 0, region: { latMin: -90, latMax: -1, lonMin: -180, lonMax: 180 } });
  assert.equal(track.hemisphere, "S");
  const s = bandSummary(track);
  within(s.edgeShiftKmPerDecade, KM_PER_DEG_LAT, 0.05);
  assert.match(s.sentence, /poleward \(south\)/);
});

test("open water south of a retreating ice edge: expansion, edge moving poleward", (t) => {
  // Sea ice grid (50N to 90N), September only. Ice edge moves north 1°/decade.
  const r = rng(8);
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, units: "0 to 1", nt: 45 * 12 }, ({ lat, k, month }) => {
    const edge = 72 + 0.1 * k + 6 * seasonal(month);
    return Math.min(1, Math.max(0, (lat - edge) / 6 + 0.03 * r.normal()));
  });
  const track = bandTrack(v, { max: 0.15, months: [9] });
  assert.equal(track.bandShape, "equatorward");
  assert.equal(track.edgeKind, "poleward");
  const s = bandSummary(track);
  t.diagnostic(`ice: ${s.edgeShiftKmPerDecade.toFixed(1)} km/decade, area ${s.areaPctPerDecade.toFixed(1)}%/decade`);
  within(s.edgeShiftKmPerDecade, KM_PER_DEG_LAT, 0.08);
  assert.equal(s.kind, "expansion");
});

test("a band with no trend is 'none', and an empty band says so", () => {
  const r = rng(9);
  const v = synthVar({ nt: 40 * 12, units: "m/s" }, ({ lat }) => 45 * Math.exp(-(((lat - 45) / 9) ** 2)) + 1.5 * r.normal());
  const s = bandSummary(bandTrack(v, { min: 30, region: { latMin: 10, latMax: 80, lonMin: -80, lonMax: 0 } }));
  assert.notEqual(s.level, "significant");
  assert.equal(s.kind, "none");
  assert.ok(!s.sentence.includes("NaN"));

  const empty = bandSummary(bandTrack(v, { min: 500 }));
  assert.equal(empty.kind, "none");
  assert.match(empty.sentence, /No part of the map/);
});
