import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadVariable, regionSeries, fromBuffer, rowAreasKm2, regionCells, EARTH_RADIUS_KM, lonInRange,
} from "../index.js";
import { makeEntry, encode, toBytes, synthVar, GLOBAL, ARCTIC } from "./fixtures.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("loadVariable reads the contract file format through catalog.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "td-engine-"));
  try {
    const entry = makeEntry({ id: "t2m", file: "t2m.bin", nt: 24, scale: 0.01, offset: -10 });
    const data = encode(entry, ({ t, i, j }) => (i === 3 && j === 4 && t === 1 ? NaN : t + i / 100 + j / 1000));
    await writeFile(join(dir, "t2m.bin"), toBytes(data));
    await writeFile(join(dir, "catalog.json"), JSON.stringify({ variables: [entry] }));

    const catalog = JSON.parse(await readFile(join(dir, "catalog.json"), "utf8"));
    const v = await loadVariable(catalog.variables[0], pathToFileURL(dir).href);
    assert.equal(v.data.length, 24 * 91 * 144);
    close(v.value(5, 10, 20), 5.12, 0.006);
    close(v.value(0, 0, 0), 0, 0.006);
    assert.ok(Number.isNaN(v.value(1, 3, 4)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fromBuffer rejects a file of the wrong size and handles odd byte offsets", () => {
  const entry = makeEntry({ nt: 2, grid: { ...GLOBAL } });
  assert.throws(() => fromBuffer(entry, new ArrayBuffer(10)), /expected/);
  const bytes = toBytes(encode(entry, () => 1.5));
  const padded = new Uint8Array(bytes.length + 1);
  padded.set(bytes, 1);
  const v = fromBuffer(entry, padded.subarray(1));
  close(v.value(1, 50, 50), 1.5, 1e-9);
});

test("cell areas add up to the surface of the Earth", () => {
  for (const grid of [GLOBAL, { nlat: 181, nlon: 288, lat0: -90, lon0: -180, dlat: 1, dlon: 1.25 }]) {
    const rows = rowAreasKm2(grid);
    const total = rows.reduce((s, a) => s + a, 0) * grid.nlon;
    close(total / (4 * Math.PI * EARTH_RADIUS_KM ** 2), 1, 1e-9);
  }
});

test("regionSeries is the area-weighted mean and skips missing cells", () => {
  // Value = sin(lat): the area-weighted mean over a symmetric band is 0, and
  // over 0..90 it is the mean of sin over the sphere cap.
  const v = synthVar({ nt: 12 }, ({ lat, lon }) => (lon === 0 && lat === 10 ? NaN : 100 * Math.sin((lat * Math.PI) / 180)));
  const all = regionSeries(v, null);
  for (const x of all.values) close(x, 0, 0.02);
  assert.equal(all.t[0], "1980-01");
  assert.equal(all.t[11], "1980-12");

  const north = regionSeries(v, { latMin: 0, latMax: 90, lonMin: -180, lonMax: 180 });
  // Area-weighted mean of sin(lat) over the cells it covers: the equator row
  // spans -1..1, so the cap runs from -1 to 90 degrees.
  const s0 = Math.sin((-1 * Math.PI) / 180);
  close(north.values[0], (100 * (1 - s0 * s0)) / 2 / (1 - s0), 0.02);
});

test("regions crossing the date line and tiny regions", () => {
  const v = synthVar({ nt: 1 }, ({ lon }) => lon);
  const dl = regionSeries(v, { latMin: -10, latMax: 10, lonMin: 170, lonMax: -170 });
  // Cells at 170..177.5 and -180..-170 average near the date line, not 0.
  const { cells } = regionCells(GLOBAL, { latMin: -10, latMax: 10, lonMin: 170, lonMax: -170 });
  assert.equal(cells.length, 11 * (4 + 5));
  assert.ok(Math.abs(dl.values[0]) < 30);
  assert.ok(lonInRange(175, 170, -170) && lonInRange(-175, 170, -170) && !lonInRange(0, 170, -170));

  // A box smaller than one cell falls back to the nearest cell.
  const tiny = regionSeries(v, { latMin: 40.3, latMax: 40.4, lonMin: -74.1, lonMax: -73.9 });
  close(tiny.values[0], -75, 1e-9);
});

test("regional sea ice grid", () => {
  const v = synthVar({ nt: 12, grid: ARCTIC, scale: 0.0001, units: "0 to 1" }, ({ lat }) => (lat >= 80 ? 1 : 0));
  const s = regionSeries(v, { latMin: 80, latMax: 90, lonMin: -180, lonMax: 180 });
  close(s.values[0], 1, 1e-9);
  const out = regionSeries(v, { latMin: -10, latMax: 10, lonMin: 0, lonMax: 10 });
  assert.ok(out.values.every((x) => Number.isNaN(x)));
});
