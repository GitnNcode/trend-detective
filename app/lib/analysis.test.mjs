// Tests for app/lib/analysis.js. Run from the repo root:
//   node --test app/lib/analysis.test.mjs
// 1. Synthetic data with known answers (always runs).
// 2. Smoke tests and timings on the real MERRA-2 files in /data (skipped when
//    data/catalog.json is not there).
// Written with Claude and reviewed by the team.

import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as E from "../../engine/index.js";
import * as A from "./analysis.js";

const close = (a, b, tol, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const KM = E.KM_PER_DEG_LAT;

// Seeded random numbers (mulberry32 + Box-Muller).
function rng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    let u = 0;
    while (u === 0) u = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
  return { uniform, normal };
}

// A Var in the contract format: Int16, real = raw * scale + offset, NaN -> missing.
// fn({ lat, lon, year, month, k }) gives the value, k = years since 1980.
function synth(grid, fn, { nYears = 46, scale = 0.001, offset = 0, units = "°C", id = "test" } = {}) {
  const nt = nYears * 12;
  const entry = { id, file: `${id}.bin`, units, start: "1980-01", nt, grid, scale, offset };
  const { nlat, nlon, lat0, lon0, dlat, dlon } = grid;
  const data = new Int16Array(nt * nlat * nlon);
  for (let t = 0; t < nt; t++) {
    const year = 1980 + Math.floor(t / 12), month = (t % 12) + 1;
    for (let i = 0; i < nlat; i++) {
      for (let j = 0; j < nlon; j++) {
        const val = fn({ lat: lat0 + i * dlat, lon: lon0 + j * dlon, year, month, k: year - 1980 });
        data[(t * nlat + i) * nlon + j] = Number.isFinite(val)
          ? Math.max(-32767, Math.min(32767, Math.round((val - offset) / scale)))
          : E.MISSING;
      }
    }
  }
  return E.makeVar(entry, data);
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const noBadText = (s, where) => {
  assert.equal(typeof s, "string", where);
  assert.ok(s.length > 0, `${where}: empty sentence`);
  assert.ok(!/NaN|undefined|Infinity|null/.test(s), `${where}: ${s}`);
};

// ---------------------------------------------------------------------------
// Climate velocity

test("velocity: uniform warming on a north-south ramp moves isotherms down-gradient at slope/gradient", () => {
  // T rises 0.5 °C per degree of latitude toward the north and warms 0.03 °C/yr
  // everywhere, so each isotherm slides south at 0.03 / (0.5 / 111.195) km/yr.
  const grid = { nlat: 31, nlon: 144, lat0: -30, lon0: -180, dlat: 2, dlon: 2.5 };
  const v = synth(grid, ({ lat, k }) => 10 + 0.5 * lat + 0.03 * k, { nYears: 20 });
  const f = A.velocityField(v);
  const expected = 0.03 / (0.5 / KM); // 6.67 km/yr
  for (let c = 0; c < grid.nlat * grid.nlon; c++) {
    close(f.v[c], -expected, 0.005 * expected, `v[${c}]`);
    close(f.u[c], 0, 0.005 * expected, `u[${c}]`);
    close(f.speed[c], expected, 0.005 * expected, `speed[${c}]`);
    close(f.gradY[c], 0.5 / KM, 1e-6, `gradY[${c}]`);
  }
  close(f.medianSpeed, expected, 0.005 * expected, "medianSpeed");
  close(f.meanSpeed, expected, 0.005 * expected, "meanSpeed");
  assert.ok(f.cap >= f.medianSpeed);
  assert.equal(f.speedUnits, "km/yr");
  const s = A.velocitySummary(f, { latMin: -10, latMax: 10, lonMin: -50, lonMax: 50 });
  close(s.medianKmPerDecade, expected * 10, 0.005 * expected * 10, "summary median");
  close(s.bearingDeg, 180, 0.5, "bearing");
  assert.equal(s.bearingName, "south");
  close(s.coherence, 1, 1e-3, "coherence");
  assert.ok(s.cells > 0);
});

test("velocity: east-west ramp uses dx = dlon * 111.195 * cos(lat), and grid edges are one-sided", () => {
  // Regional grid (not a full circle), so the first and last columns are edges.
  const grid = { nlat: 21, nlon: 40, lat0: 0, lon0: 0, dlat: 2, dlon: 2.5 };
  const v = synth(grid, ({ lon, k }) => 5 + 0.2 * lon + 0.03 * k, { nYears: 20 });
  const f = A.velocityField(v);
  for (let i = 0; i < grid.nlat; i++) {
    const lat = i * 2;
    const expected = (0.03 * KM * Math.cos((lat * Math.PI) / 180)) / 0.2; // km/yr, toward the west
    for (const j of [0, 1, 20, 38, 39]) {
      const c = i * grid.nlon + j;
      close(f.u[c], -expected, 0.005 * expected, `u at lat ${lat} col ${j}`);
      close(f.v[c], 0, 0.005 * expected, `v at lat ${lat} col ${j}`);
    }
  }
});

test("velocity: cells next to missing data use one-sided differences; flat places are held down by the floor", () => {
  const grid = { nlat: 31, nlon: 144, lat0: -30, lon0: -180, dlat: 2, dlon: 2.5 };
  const hole = (lat, lon) => lat >= -4 && lat <= 4 && lon >= -10 && lon <= 10;
  const v = synth(grid, ({ lat, lon, k }) => (hole(lat, lon) ? NaN : 10 + 0.5 * lat + 0.03 * k), { nYears: 20 });
  const f = A.velocityField(v);
  const expected = 0.03 / (0.5 / KM);
  let checked = 0;
  for (let c = 0; c < grid.nlat * grid.nlon; c++) {
    const lat = -30 + 2 * Math.floor(c / 144), lon = -180 + 2.5 * (c % 144);
    if (hole(lat, lon)) { assert.ok(Number.isNaN(f.speed[c])); continue; }
    close(f.v[c], -expected, 0.005 * expected, `v next to hole at ${lat},${lon}`);
    checked++;
  }
  assert.ok(checked > 4000);

  // A field that is flat in the south: speed never exceeds |slope| / floor.
  const flat = synth(grid, ({ lat, k }) => (lat < 0 ? 10 : 10 + 0.5 * lat) + 0.03 * k, { nYears: 20 });
  const g = A.velocityField(flat);
  assert.ok(g.gradFloor > 0);
  for (let c = 0; c < g.speed.length; c++) {
    if (Number.isNaN(g.speed[c])) continue;
    assert.ok(g.speed[c] <= 0.03 / g.gradFloor + 1e-6, `speed ${g.speed[c]} above the floor bound`);
  }
  // An explicit cap and floor are passed through.
  const h = A.velocityField(flat, undefined, { cap: 12, gradFloor: 0.001 });
  assert.equal(h.cap, 12);
  assert.equal(h.gradFloor, 0.001);
});

// ---------------------------------------------------------------------------
// Detection horizon

function ar1Series(years, slope, sigma, phi, seed) {
  const r = rng(seed);
  let e = 0;
  return {
    years,
    values: Float64Array.from(years, (y, k) => {
      e = k === 0 ? r.normal() * sigma : phi * e + Math.sqrt(1 - phi * phi) * sigma * r.normal();
      return 3 + slope * (y - years[0]) + e;
    }),
  };
}

// The same quantities computed independently here.
function reference(annual, perYear) {
  const x = annual.years, y = Array.from(annual.values), n = x.length;
  const mx = x.reduce((s, a) => s + a, 0) / n, my = y.reduce((s, a) => s + a, 0) / n;
  let sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sxx += (x[k] - mx) ** 2; sxy += (x[k] - mx) * (y[k] - my); }
  const b = sxy / sxx;
  const r = y.map((yk, k) => yk - my - b * (x[k] - mx));
  const rss = r.reduce((s, a) => s + a * a, 0);
  let num = 0;
  for (let k = 0; k + 1 < n; k++) num += r[k] * r[k + 1];
  const sigma = Math.sqrt(rss / (n - 2));
  const phi = Math.min(0.95, Math.max(-0.9, num / rss));
  const g = Math.sqrt((1 + phi) / (1 - phi));
  const nStar = Math.pow(((3.3 * sigma * Math.sqrt(12 / perYear)) / Math.abs(b)) * g, 2 / 3);
  const B = (4 / (3 * Math.sqrt(nStar))) * g;
  return { b, sigma, phi, nStar, nLow: nStar * Math.exp(-B), nHigh: nStar * Math.exp(B) };
}

test("detectionHorizon matches the Weatherhead formula (annual version, and the literal monthly one)", () => {
  const annual = ar1Series(range(1980, 2025), 0.012, 0.15, 0.3, 11);
  for (const perYear of [1, 12]) {
    const h = A.detectionHorizon(annual, { perYear });
    const ref = reference(annual, perYear);
    close(h.slope, ref.b, 1e-12, "slope");
    close(h.sigma, ref.sigma, 1e-12, "sigma");
    close(h.phi, ref.phi, 1e-12, "phi");
    close(h.nStar, ref.nStar, 1e-9, "nStar");
    close(h.nLow, ref.nLow, 1e-9, "nLow");
    close(h.nHigh, ref.nHigh, 1e-9, "nHigh");
    assert.equal(h.nYears, 46);
    assert.equal(h.firstYear, 1980);
    assert.equal(h.lastYear, 2025);
    assert.equal(h.etaYear, 1980 + Math.ceil(ref.nStar) - 1);
    close(h.progress, 46 / ref.nStar, 1e-12, "progress");
    assert.equal(h.status, 46 >= ref.nStar ? "detectable" : "pending");
  }
  // Default is the annual version.
  assert.equal(A.detectionHorizon(annual).nStar, A.detectionHorizon(annual, { perYear: 1 }).nStar);
});

test("detectionHorizon: at the predicted n*, an annual trend is detected about 90% of the time", () => {
  // White noise, sigma = 1, slope chosen so the annual-data n* is 30 years.
  const sigma = 1, n = 30;
  const omega = (3.3 * Math.sqrt(12) * sigma) / Math.pow(n, 1.5);
  const r = rng(5);
  const trials = 600;
  let hits = 0;
  for (let k = 0; k < trials; k++) {
    const years = range(1980, 1980 + n - 1);
    const values = Float64Array.from(years, (y) => omega * (y - 1980) + sigma * r.normal());
    if (E.linearTrend({ years, values }).p < 0.05) hits++;
  }
  const rate = hits / trials;
  assert.ok(rate > 0.84 && rate < 0.95, `detection rate at n* = ${rate}`);
  // The literal (monthly-data) formula would have promised detection after
  // only (3.3 sigma / omega)^(2/3) = n / 12^(1/3) years.
  close(Math.pow((3.3 * sigma) / omega, 2 / 3), n / Math.cbrt(12), 1e-9, "literal n*");
});

// Noise with its own trend removed, so the fitted slope is exactly `slope`.
function exactSlopeSeries(years, slope, sigma, seed) {
  const r = rng(seed);
  const e = years.map(() => sigma * r.normal());
  const n = years.length;
  const mx = years.reduce((s, a) => s + a, 0) / n, me = e.reduce((s, a) => s + a, 0) / n;
  let sxx = 0, sxe = 0;
  for (let k = 0; k < n; k++) { sxx += (years[k] - mx) ** 2; sxe += (years[k] - mx) * (e[k] - me); }
  const b = sxe / sxx;
  return { years, values: Float64Array.from(years, (y, k) => 3 + slope * (y - years[0]) + e[k] - me - b * (y - mx)) };
}

test("detectionHorizon edge cases and sentences", () => {
  const years = range(1980, 2025);
  // Strong trend, little noise: n* about 8 years, detectable.
  const strong = A.detectionHorizon(exactSlopeSeries(years, 0.05, 0.1, 3));
  close(strong.slope, 0.05, 1e-12, "exact slope");
  assert.equal(strong.status, "detectable");
  noBadText(A.detectionSentence(strong, "°C"), "detectable");
  assert.match(A.detectionSentence(strong, "°C"), /^Long enough/);
  // Weak trend, more noise: n* about 57 years, pending, with a year.
  const weak = A.detectionHorizon(exactSlopeSeries(years, 0.004, 0.15, 4));
  assert.equal(weak.status, "pending");
  assert.ok(weak.etaYear > 2025 && weak.etaLow <= weak.etaYear && weak.etaYear <= weak.etaHigh);
  const ws = A.detectionSentence(weak, "°C");
  noBadText(ws, "pending");
  assert.match(ws, /more years? of data \(around \d{4}\)/);
  // ...but if the verdict already says significant, the line does not contradict it.
  assert.match(A.detectionSentence(weak, "°C", "significant"), /^Already visible/);
  // Tiny trend: never.
  const tiny = A.detectionHorizon(exactSlopeSeries(years, 0.00001, 0.3, 5));
  assert.equal(tiny.status, "never");
  noBadText(A.detectionSentence(tiny, "mm/day"), "never");
  // Flat line, too few years, all NaN, fraction units: no throw, no NaN text.
  const flat = A.detectionHorizon({ years, values: Float64Array.from(years, () => 2) });
  assert.equal(flat.status, "never");
  noBadText(A.detectionSentence(flat, "°C"), "flat");
  const few = A.detectionHorizon({ years: [2000, 2001, 2002], values: [1, 2, 4] });
  assert.equal(few.status, "never");
  assert.equal(few.reason, "no-data");
  noBadText(A.detectionSentence(few, "°C"), "few");
  const none = A.detectionHorizon({ years, values: new Float64Array(years.length).fill(NaN) });
  assert.equal(none.nYears, 0);
  noBadText(A.detectionSentence(none, "0 to 1"), "none");
  noBadText(A.detectionSentence(tiny, "0 to 1"), "fraction");
  noBadText(A.detectionSentence(undefined, "°C"), "undefined input");
});

// ---------------------------------------------------------------------------
// Geometry helpers

test("greatCircle, destination, bearingName", () => {
  const g = A.greatCircle(0, 0, 0, 1);
  close(g.distKm, 111.195, 0.01, "one degree");
  close(g.bearingDeg, 90, 1e-9, "east");
  close(A.greatCircle(0, 0, 1, 0).bearingDeg, 0, 1e-9, "north");
  close(A.greatCircle(0, 0, 0, -1).bearingDeg, 270, 1e-9, "west");
  close(A.greatCircle(10, 0, 0, 0).bearingDeg, 180, 1e-9, "south");
  close(A.greatCircle(0, 179.5, 0, -179.5).distKm, 111.195, 0.01, "across the date line");
  close(A.greatCircle(0, 0, 0, 180).distKm, Math.PI * E.EARTH_RADIUS_KM, 1e-6, "antipode");
  assert.equal(A.greatCircle(5, 5, 5, 5).distKm, 0);
  for (const [lat, lon, b, d] of [[41.88, -87.63, 30, 400], [-33.9, 151.2, 250, 1200], [70, 170, 80, 900]]) {
    const [la, lo] = A.destination(lat, lon, b, d);
    const back = A.greatCircle(lat, lon, la, lo);
    close(back.distKm, d, 1e-6, "round trip distance");
    close(back.bearingDeg, b, 1e-6, "round trip bearing");
  }
  assert.equal(A.bearingName(0), "north");
  assert.equal(A.bearingName(359), "north");
  assert.equal(A.bearingName(22.5), "north-northeast");
  assert.equal(A.bearingName(45), "northeast");
  assert.equal(A.bearingName(90), "east");
  assert.equal(A.bearingName(200), "south-southwest");
  assert.equal(A.bearingName(-90), "west");
  assert.equal(A.bearingName(NaN), "");
});

// ---------------------------------------------------------------------------
// Climate twins

test("climateTwin: uniform warming on a north-south gradient sends home's old climate north", () => {
  // T falls 0.4 °C per degree toward the pole and warms 0.05 °C/yr; the
  // seasonal cycle is the same everywhere and rain varies only east-west.
  // Base 1980-1989 vs recent 2016-2025 is 36 years apart, so +1.8 °C, which
  // is 4.5 degrees of latitude, about 500 km.
  const grid = { nlat: 41, nlon: 49, lat0: 0, lon0: -60, dlat: 2, dlon: 2.5 };
  const t2m = synth(grid, ({ lat, month, k }) => 25 - 0.4 * lat + 0.05 * k + 8 * Math.cos((2 * Math.PI * (month - 7)) / 12), { scale: 0.002, id: "t2m" });
  const precip = synth(grid, ({ lon }) => 2 * Math.exp(0.02 * lon), { units: "mm/day", id: "precip" });
  const tw = A.climateTwin({ t2m, precip }, 40, 0);
  close(tw.home.drift.dT, 1.8, 0.01, "dT");
  close(tw.home.drift.dRange, 0, 0.01, "dRange");
  close(tw.home.drift.dPpct, 0, 0.1, "dPpct");
  close(tw.home.then.tRange, 16, 0.01, "tRange");
  assert.ok(tw.thenNow.found && tw.nowWas.found);
  close(tw.thenNow.lat, 44.5, 1.5, "thenNow lat");
  close(tw.thenNow.lon, 0, 1.5, "thenNow lon");
  assert.ok(tw.thenNow.bearingDeg < 10 || tw.thenNow.bearingDeg > 350, `thenNow bearing ${tw.thenNow.bearingDeg}`);
  assert.equal(tw.thenNow.bearingName, "north");
  close(tw.thenNow.distKm, 500, 170, "thenNow distance");
  close(tw.nowWas.lat, 35.5, 1.5, "nowWas lat");
  close(tw.nowWas.bearingDeg, 180, 10, "nowWas bearing");
  assert.equal(tw.thenNow.quality, "good");
  assert.deepEqual(tw.periods, { base: [1980, 1989], recent: [2016, 2025] });

  // A land mask restricts the search: only cells west of -20 count as land.
  const mask = new Uint8Array(grid.nlat * grid.nlon);
  for (let c = 0; c < mask.length; c++) if (-60 + 2.5 * (c % grid.nlon) <= -20) mask[c] = 1;
  const west = A.climateTwin({ t2m, precip }, 40, -40, { landMask: mask });
  assert.ok(west.thenNow.lon <= -20 + 1e-6);
  // Home far from any land within the radius: nothing found, no throw.
  const lost = A.climateTwin({ t2m, precip }, 40, 50, { landMask: mask, radiusKm: 500 });
  assert.equal(lost.thenNow.found, false);
  assert.equal(lost.thenNow.quality, "poor");
  assert.equal(lost.thenNow.bearingName, "");
  // A stricter precipitation scale is honoured.
  const strict = A.climateTwin({ t2m, precip }, 40, 0, { scales: { logP: 0.01 } });
  close(strict.thenNow.lon, 0, 0.5, "strict lon");
});

test("landMaskFrom marks cells with any valid value in the first 24 months", () => {
  const grid = { nlat: 5, nlon: 8, lat0: 0, lon0: 0, dlat: 2, dlon: 2.5 };
  const v = synth(grid, ({ lon, year }) => (lon < 10 || (lon < 15 && year === 1981) ? 0.5 : NaN), { nYears: 3, units: "0 to 1" });
  const m = A.landMaskFrom(v);
  for (let c = 0; c < m.length; c++) {
    const lon = 2.5 * (c % 8);
    assert.equal(m[c], lon < 15 ? 1 : 0, `cell ${c}`);
  }
});

// ---------------------------------------------------------------------------
// Lineup, dipole, distribution, seasonal cycle, extrapolation

test("lineup sorts by evidence and puts empty variables last", () => {
  const grid = { nlat: 11, nlon: 16, lat0: 0, lon0: -20, dlat: 2, dlon: 2.5 };
  const r = rng(9);
  const strong = synth(grid, ({ k, month }) => 20 + 0.05 * k + 3 * Math.cos(month) + 0.1 * r.normal(), { id: "strong" });
  const noise = synth(grid, () => 5 + r.normal(), { id: "noise", units: "mm/day" });
  const empty = synth(grid, ({ lat }) => (lat > 15 ? 0.3 : NaN), { id: "empty", units: "0 to 1" });
  // A trace amount below one storage step that "jumps" late in the record:
  // its verdict beats the pure-noise one, but it is negligible, so it sorts
  // after real signals.
  const trace = synth(grid, ({ k, lat }) => (k > 40 && lat === 4 ? 0.001 : 0), { id: "trace", units: "kg/m²" });
  const region = { latMin: 0, latMax: 10, lonMin: -20, lonMax: 15 };
  const rows = A.lineup({ empty, trace, noise, strong }, region);
  assert.deepEqual(rows.map((x) => x.id), ["strong", "noise", "trace", "empty"]);
  assert.equal(rows[0].verdict.level, "significant");
  assert.ok(rows[0].tStat > 10);
  assert.equal(rows[2].negligible, true);
  assert.notEqual(rows[2].verdict.level, "none");
  assert.equal(rows[1].verdict.level, "none");
  assert.equal(rows[1].negligible, false);
  assert.equal(rows[3].empty, true);
  assert.equal(rows[0].empty, false);
  for (const row of rows) {
    noBadText(row.verdict.sentence, row.id);
    noBadText(A.detectionSentence(row.detection, row.units), `${row.id} detection`);
    assert.equal(row.annual.years.length, row.annual.values.length);
  }
  // A Map works too, and a season filter.
  const rowsMap = A.lineup(new Map([["strong", strong]]), region, [6, 7, 8]);
  assert.equal(rowsMap[0].id, "strong");
});

test("dipole: a band that moves north has opposite trends where it arrived and where it left", () => {
  // A jet-like ridge of wind whose axis moves 0.15 degrees north per year.
  const grid = { nlat: 46, nlon: 36, lat0: 0, lon0: -180, dlat: 2, dlon: 10 };
  const v = synth(grid, ({ lat, k }) => 50 * Math.exp(-(((lat - 40 - 0.15 * k) / 8) ** 2)), { units: "m/s", id: "wind250", scale: 0.002 });
  const track = E.bandTrack(v, { min: 40, max: null });
  const d = A.dipole(v, track);
  assert.deepEqual(d.early, [1980, 1989]);
  assert.deepEqual(d.late, [2016, 2025]);
  assert.ok(d.stats.arrived.cells > 0 && d.stats.left.cells > 0 && d.stats.stayed.cells > 0);
  assert.ok(d.stats.arrived.meanPerDecade > 0, "wind rises where the jet arrived");
  assert.ok(d.stats.left.meanPerDecade < 0, "wind falls where the jet left");
  assert.equal(d.oppositeSigns, true);
  assert.ok(d.stats.arrived.fracSignificant > 0.5);
  noBadText(d.sentence, "dipole");
  assert.match(d.sentence, /two opposite local trends/);
  // Masks are disjoint and per cell.
  for (let c = 0; c < d.arrived.length; c++) assert.ok(d.arrived[c] + d.left[c] + d.stayed[c] <= 1);

  // A band that only grows: one trend, said honestly.
  const grow = synth(grid, ({ lat, k }) => 50 * Math.exp(-(((lat - 40) / (6 + 0.1 * k)) ** 2)), { units: "m/s", id: "wind250", scale: 0.002 });
  const g = A.dipole(grow, E.bandTrack(grow, { min: 40 }));
  assert.equal(g.oppositeSigns, false);
  assert.equal(g.stats.left.cells, 0);
  noBadText(g.sentence, "growing band");
  assert.match(g.sentence, /mostly spread into new places/);
  assert.match(g.sentence, /this is one trend, not two opposite ones/);
  // A band that left places while the long-term trend there went up: a swing.
  // The ridge sits at 44 N in the 1980s, 40 N in the last decade, but the
  // record's linear trend at 44 N is upward because of a late jump back.
  const swing = synth(grid, ({ lat, k }) => {
    const c = k < 10 ? 44 : k < 36 ? 47 : 40;
    return 50 * Math.exp(-(((lat - c) / 4) ** 2));
  }, { units: "m/s", id: "wind250", scale: 0.002 });
  const s = A.dipole(swing, E.bandTrack(swing, { min: 40 }));
  noBadText(s.sentence, "swing");
  assert.ok(s.stats.left.cells > 0 && s.stats.arrived.cells > 0);
  // A band with no members, and a malformed track: no throw.
  noBadText(A.dipole(v, E.bandTrack(v, { min: 500 })).sentence, "empty band");
  noBadText(A.dipole(v, { years: [] }).sentence, "no track");
});

test("distributionShift and seasonalCycle see a uniform warming", () => {
  const grid = { nlat: 11, nlon: 16, lat0: 0, lon0: -20, dlat: 2, dlon: 2.5 };
  const v = synth(grid, ({ lat, month, k }) => 20 - 0.3 * lat + 0.03 * k + 5 * Math.cos((2 * Math.PI * (month - 7)) / 12));
  const ds = A.distributionShift(v, null);
  assert.equal(ds.edges.length, 41);
  assert.equal(ds.early.length, 40);
  close(ds.early.reduce((s, x) => s + x, 0), 1, 1e-9, "early sums to 1");
  close(ds.late.reduce((s, x) => s + x, 0), 1, 1e-9, "late sums to 1");
  close(ds.shift, 0.03 * 36, 0.01, "shift"); // 1984.5 -> 2020.5
  assert.deepEqual(ds.periods, { early: [1980, 1989], late: [2016, 2025] });
  const an = A.distributionShift(v, null, undefined, { anomaly: true, bins: 10 });
  assert.equal(an.edges.length, 11);
  close(an.shift, 0.03 * 36, 0.01, "anomaly shift");
  const sc = A.seasonalCycle(v, { latMin: 0, latMax: 20, lonMin: -20, lonMax: 17.5 });
  assert.equal(sc.early.length, 12);
  for (let m = 0; m < 12; m++) close(sc.late[m] - sc.early[m], 0.03 * 36, 0.01, `month ${m + 1}`);
  close(sc.early[6] - sc.early[0], 10, 0.05, "July minus January");
  // Region with no cells and no data: no throw.
  const none = synth(grid, () => NaN);
  assert.equal(A.distributionShift(none, null).edges.length, 0);
  assert.ok(A.seasonalCycle(none, null).early.every(Number.isNaN));
});

test("extrapolate gives the textbook prediction interval and covers about 95% of future years", () => {
  const years = range(1980, 2025);
  const r = rng(21);
  const values = Float64Array.from(years, (y) => 14 + 0.02 * (y - 1980) + 0.12 * r.normal());
  values[7] = NaN;
  const ex = A.extrapolate(years, values, 2050);
  assert.equal(ex.ok, true);
  assert.deepEqual(ex.years, range(2026, 2050));
  assert.equal(ex.fitYears.length, years.length);
  // Same slope as the engine, and the t quantile matches the engine's 95% interval.
  const t = E.linearTrend({ years, values });
  close(ex.slope, t.slope, 1e-12, "slope");
  const n = t.n, xs = years.filter((_, k) => Number.isFinite(values[k]));
  const xbar = xs.reduce((s, x) => s + x, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - xbar) ** 2, 0);
  const se = ex.sigma / Math.sqrt(sxx);
  const tcrit = (t.ci95[1] - t.slope) / se;
  const k = ex.years.length - 1, x0 = ex.years[k];
  const half = tcrit * ex.sigma * Math.sqrt(1 + 1 / n + (x0 - xbar) ** 2 / sxx);
  close(ex.hi[k] - ex.mean[k], half, 1e-4 * half, "prediction half-width");
  close(ex.mean[k], t.intercept + t.slope * x0, 1e-9, "mean");
  // Coverage of the 2030 value.
  let inside = 0;
  const trials = 400;
  for (let s = 0; s < trials; s++) {
    const vals = Float64Array.from(years, (y) => 14 + 0.02 * (y - 1980) + 0.12 * r.normal());
    const e = A.extrapolate(years, vals, 2030);
    const truth = 14 + 0.02 * 50 + 0.12 * r.normal();
    if (truth >= e.lo.at(-1) && truth <= e.hi.at(-1)) inside++;
  }
  const cov = inside / trials;
  assert.ok(cov > 0.91 && cov < 0.99, `coverage ${cov}`);
  // Too few points, an until year inside the record, and an 80% level.
  assert.equal(A.extrapolate([2000, 2001], [1, 2], 2010).ok, false);
  assert.equal(A.extrapolate(years, values, 2000).years.length, 0);
  const e80 = A.extrapolate(years, values, 2050, 0.8);
  assert.ok(e80.hi.at(-1) - e80.lo.at(-1) < ex.hi.at(-1) - ex.lo.at(-1));
});

// ---------------------------------------------------------------------------
// Real data

const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
const contentDir = fileURLToPath(new URL("../../content/", import.meta.url));
const haveData = await access(dataDir + "catalog.json").then(() => true, () => false);
const BUDGET_MS = 300;

test("real MERRA-2 data: every function runs fast with no NaN text", { skip: haveData ? false : "data/catalog.json not there" }, async (t) => {
  const catalog = JSON.parse(await readFile(dataDir + "catalog.json", "utf8"));
  const regions = Object.fromEntries(JSON.parse(await readFile(contentDir + "regions.json", "utf8")).map((r) => [r.id, r]));
  const base = pathToFileURL(dataDir).href;
  const vars = {};
  for (const entry of catalog.variables) vars[entry.id] = await E.loadVariable(entry, base);

  const timings = [];
  const time = (label, fn) => {
    const t0 = performance.now();
    const out = fn();
    const ms = performance.now() - t0;
    timings.push(`${label}: ${ms.toFixed(1)} ms`);
    assert.ok(ms < BUDGET_MS, `${label} took ${ms.toFixed(0)} ms`);
    return out;
  };

  // Climate velocity.
  const land = time("landMaskFrom(soilwet)", () => A.landMaskFrom(vars.soilwet));
  const vf = time("velocityField(t2m) first call", () => A.velocityField(vars.t2m));
  time("velocityField(t2m) cached", () => A.velocityField(vars.t2m));
  assert.ok(vf.medianSpeed > 0 && Number.isFinite(vf.meanSpeed) && vf.cap > vf.medianSpeed);
  const all = time("velocitySummary(global)", () => A.velocitySummary(vf, null));
  const onLand = time("velocitySummary(land)", () => A.velocitySummary(vf, null, { mask: land }));
  assert.ok(all.cells > 10000 && onLand.cells > 2000);
  assert.ok(onLand.medianKmPerDecade > 0 && all.medianKmPerDecade > 0);
  t.diagnostic(`t2m velocity median: global ${all.medianKmPerDecade.toFixed(1)}, land ${onLand.medianKmPerDecade.toFixed(1)} km/decade`);
  time("velocityField(seaice, Sep)", () => A.velocityField(vars.seaice, [9]));
  time("velocityField(wind250, DJF)", () => A.velocityField(vars.wind250, [12, 1, 2]));

  // Climate twins.
  const cities = [[41.88, -87.63], [33.45, -112.07], [48.86, 2.35], [-23.55, -46.63], [-33.87, 151.21], [6.52, 3.38]];
  for (const [la, lo] of cities) {
    const tw = time(`climateTwin(${la}, ${lo})`, () => A.climateTwin({ t2m: vars.t2m, precip: vars.precip }, la, lo, { landMask: land }));
    for (const a of [tw.thenNow, tw.nowWas]) {
      assert.ok(a.found, `twin found for ${la}, ${lo}`);
      assert.ok(["good", "fair", "poor"].includes(a.quality));
      for (const key of ["lat", "lon", "distKm", "bearingDeg", "climateDistance"]) assert.ok(Number.isFinite(a[key]), `${key} for ${la}, ${lo}`);
      assert.ok(a.bearingName.length > 0);
      assert.ok(land[Math.round((a.lat + 90) / 2) * 144 + (Math.round((a.lon + 180) / 2.5) % 144)] || a.distKm < 400);
    }
    assert.ok(tw.home.drift.dT > 0, `warming at ${la}, ${lo}`);
  }

  // Lineup in several regions.
  for (const id of ["arctic", "sahel", "amazon", "natlantic", "siberia", "global"]) {
    const rows = time(`lineup(${id})`, () => A.lineup(vars, id === "global" ? null : regions[id]));
    assert.equal(rows.length, 10);
    for (const row of rows) {
      noBadText(row.verdict.sentence, `${id} ${row.id}`);
      noBadText(A.detectionSentence(row.detection, row.units), `${id} ${row.id} detection`);
    }
    for (let k = 1; k < rows.length; k++) if (rows[k - 1].empty) assert.ok(rows[k].empty, "empty rows sort last");
    if (id === "sahel" || id === "amazon") {
      assert.equal(rows.at(-1).id, "seaice");
      assert.equal(rows.at(-1).empty, true);
    }
  }
  time("lineup(arctic, Sep) ", () => A.lineup(vars, regions.arctic, [9]));

  // Dipoles.
  const jet = E.bandTrack(vars.wind250, { min: 40, max: null, months: [12, 1, 2], region: regions.natlantic });
  const dj = time("dipole(wind250 DJF >= 40, natlantic)", () => A.dipole(vars.wind250, jet, [12, 1, 2]));
  noBadText(dj.sentence, "jet dipole");
  const ice = E.bandTrack(vars.seaice, { min: null, max: 0.15, months: [9], region: regions.arctic });
  const di = time("dipole(seaice Sep <= 0.15, arctic)", () => A.dipole(vars.seaice, ice, [9]));
  noBadText(di.sentence, "ice dipole");
  const frost = E.bandTrack(vars.t2m, { min: null, max: 0, region: regions.global });
  const dt = time("dipole(t2m <= 0 °C, global)", () => A.dipole(vars.t2m, frost));
  noBadText(dt.sentence, "frost dipole");
  // Different grids are refused politely.
  noBadText(A.dipole(vars.t2m, ice, [9]).sentence, "grid mismatch");

  // Distribution shift, seasonal cycle, extrapolation.
  const ds = time("distributionShift(t2m, global)", () => A.distributionShift(vars.t2m, null));
  close(ds.early.reduce((s, x) => s + x, 0), 1, 1e-9, "early sums to 1");
  assert.ok(ds.shift > 0);
  time("distributionShift(t2m, global, anomaly)", () => A.distributionShift(vars.t2m, null, undefined, { anomaly: true }));
  time("distributionShift(precip, sahel, JAS)", () => A.distributionShift(vars.precip, regions.sahel, [7, 8, 9]));
  const sc = time("seasonalCycle(seaice, arctic)", () => A.seasonalCycle(vars.seaice, regions.arctic));
  assert.ok(sc.late[8] < sc.early[8], "less September ice recently");
  const annual = E.annualMeans(E.regionSeries(vars.t2m, null));
  const ex = time("extrapolate(global t2m, 2050)", () => A.extrapolate(annual.years, annual.values, 2050));
  assert.ok(ex.ok && ex.mean.every(Number.isFinite) && ex.lo.every(Number.isFinite));
  const h = time("detectionHorizon(global t2m)", () => A.detectionHorizon(annual));
  noBadText(A.detectionSentence(h, "°C"), "global t2m detection");

  for (const line of timings) t.diagnostic(line);
});
