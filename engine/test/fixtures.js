// Synthetic data in the exact contract format, for tests. Not a test file.

import { makeVar, MISSING } from "../grid.js";
import { monthOfIndex, parseMonth } from "../time.js";

export function rng(seed = 1) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
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

export const GLOBAL = { nlat: 91, nlon: 144, lat0: -90, lon0: -180, dlat: 2.0, dlon: 2.5 };
export const ARCTIC = { nlat: 41, nlon: 288, lat0: 50, lon0: -180, dlat: 1.0, dlon: 1.25 };

export function makeEntry(over = {}) {
  return {
    id: "test",
    file: "test.bin",
    source: "synthetic",
    units: "°C",
    start: "1980-01",
    nt: 45 * 12,
    grid: GLOBAL,
    scale: 0.01,
    offset: 0,
    defaultBand: { min: null, max: 0 },
    ...over,
  };
}

// Pack fn(ctx) into Int16 exactly as the data pipeline does. fn returns the
// real value or NaN for missing. ctx = { t, i, j, lat, lon, year, month, k }
// where k is years since the first year.
export function encode(entry, fn) {
  const { nlat, nlon, lat0, lon0, dlat, dlon } = entry.grid;
  const { year: y0, month: m0 } = parseMonth(entry.start);
  const data = new Int16Array(entry.nt * nlat * nlon);
  const scale = entry.scale, offset = entry.offset ?? 0;
  for (let t = 0; t < entry.nt; t++) {
    const { year, month } = monthOfIndex(y0, m0, t);
    for (let i = 0; i < nlat; i++) {
      const lat = lat0 + i * dlat;
      for (let j = 0; j < nlon; j++) {
        const lon = lon0 + j * dlon;
        const val = fn({ t, i, j, lat, lon, year, month, k: year - y0 });
        let raw = Number.isFinite(val) ? Math.round((val - offset) / scale) : MISSING;
        if (raw !== MISSING) raw = Math.max(-32767, Math.min(32767, raw));
        data[(t * nlat + i) * nlon + j] = raw;
      }
    }
  }
  return data;
}

export function synthVar(entryOver, fn) {
  const entry = makeEntry(entryOver);
  return makeVar(entry, encode(entry, fn));
}

// Little-endian bytes of an Int16Array, as written to /data/<id>.bin.
export function toBytes(data) {
  const buf = new Uint8Array(data.length * 2);
  const dv = new DataView(buf.buffer);
  for (let k = 0; k < data.length; k++) dv.setInt16(2 * k, data[k], true);
  return buf;
}

export function annualOf(years, fn) {
  return { years, values: Float64Array.from(years, fn) };
}

export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
