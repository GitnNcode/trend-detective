// Loading the catalog, the content files and the variable binaries, with
// progress reporting and caching. Written with Claude and reviewed by the team.

import * as E from "../engine/index.js";

// One constant to switch between mock and real data (contract item).
export const DATA_BASE = new URL("../data/", import.meta.url).href;
export const CONTENT_BASE = new URL("../content/", import.meta.url).href;
export const EXTRA_BASE = new URL("./extra/", import.meta.url).href;

let catalog = null;
const vars = new Map();
const pending = new Map();
const ranges = new Map();

// Running totals, shown in the data HUD ("values crunched").
export const meter = { bytes: 0, values: 0, loaded: new Set(), listeners: new Set() };
function bump() { for (const fn of meter.listeners) fn(meter); }

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadCatalog() {
  if (!catalog) catalog = await json(DATA_BASE + "catalog.json");
  return catalog;
}

export function entryOf(id) {
  return catalog?.variables.find((v) => v.id === id) ?? null;
}

export function variableIds() {
  return catalog ? catalog.variables.map((v) => v.id) : [];
}

// Content from Lane 4, plus app-side extras (new modes and cases) appended.
export async function loadContent() {
  const [definitions, regions, usecases, routes, cases, lanes, terminals] = await Promise.all(
    ["definitions", "regions", "usecases", "routes", "cases", "lanes", "terminals"].map((n) => json(CONTENT_BASE + n + ".json")),
  );
  const extra = async (n, fallback) => {
    try { return await json(EXTRA_BASE + n + ".json"); } catch { return fallback; }
  };
  const [xUse, xCases, xRegions, cities, xDefs] = await Promise.all([
    extra("usecases", []), extra("cases", []), extra("regions", []), extra("cities", []), extra("definitions", {}),
  ]);
  const regionIds = new Set(regions.map((r) => r.id));
  return {
    definitions: { ...xDefs, ...definitions },
    regions: [...regions, ...xRegions.filter((r) => !regionIds.has(r.id))],
    usecases: [...usecases.map((u) => ({ ...u, source: "lane4" })), ...xUse.map((u) => ({ ...u, source: "app", isNew: true }))],
    routes,
    lanes,
    terminals,
    cases: [...cases, ...xCases.map((c) => ({ ...c, isNew: true }))],
    cities,
  };
}

// Fetch a variable's .bin with streamed progress. onProgress(fraction, id).
export function getVar(id, onProgress) {
  if (vars.has(id)) return Promise.resolve(vars.get(id));
  if (pending.has(id)) {
    const p = pending.get(id);
    if (onProgress) p.listeners.add(onProgress);
    return p.promise;
  }
  const entry = entryOf(id);
  if (!entry) return Promise.reject(new Error(`Unknown variable ${id}`));
  const listeners = new Set(onProgress ? [onProgress] : []);
  const promise = (async () => {
    const url = DATA_BASE + entry.file;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
    const expected = entry.nt * entry.grid.nlat * entry.grid.nlon * 2;
    let buf;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      buf = new Uint8Array(expected);
      let off = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (off + value.length > buf.length) {
          const bigger = new Uint8Array(Math.max(buf.length * 2, off + value.length));
          bigger.set(buf.subarray(0, off));
          buf = bigger;
        }
        buf.set(value, off);
        off += value.length;
        meter.bytes += value.length;
        for (const fn of listeners) fn(Math.min(1, off / expected), id);
      }
      buf = buf.subarray(0, off);
    } else {
      buf = new Uint8Array(await res.arrayBuffer());
      meter.bytes += buf.length;
    }
    const v = E.fromBuffer(entry, buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? buf.buffer : buf.slice().buffer);
    vars.set(id, v);
    pending.delete(id);
    meter.values += entry.nt * entry.grid.nlat * entry.grid.nlon;
    meter.loaded.add(id);
    bump();
    for (const fn of listeners) fn(1, id);
    return v;
  })();
  promise.catch(() => pending.delete(id));
  pending.set(id, { promise, listeners });
  return promise;
}

// A field computed in the browser (no .bin): add it to the catalog and the
// cache so every view can use it like a downloaded one.
export function registerVar(v) {
  const id = v.entry.id;
  if (!catalog.variables.some((e) => e.id === id)) catalog.variables.push(v.entry);
  vars.set(id, v);
  meter.loaded.add(id);
  bump();
}

export function isLoaded(id) { return vars.has(id); }
export function cachedVar(id) { return vars.get(id) ?? null; }

// Physical value range of the whole file (used to normalize textures).
export function valueRange(v) {
  const id = v.entry.id;
  if (ranges.has(id)) return ranges.get(id);
  const { data, entry } = v;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < data.length; k++) {
    const r = data[k];
    if (r === E.MISSING) continue;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  const s = entry.scale ?? 1, o = entry.offset ?? 0;
  let a = lo * s + o, b = hi * s + o;
  if (!(b > a)) { a = 0; b = 1; }
  const out = { min: a, max: b };
  ranges.set(id, out);
  return out;
}

// Pack fields into an interleaved RG Float32Array for a texture array:
// R = normalized value (premultiplied by validity), G = validity.
export function packAnnual(af, range) {
  const { fields, ncell, years } = af;
  const n = years.length;
  const out = new Float32Array(n * ncell * 2);
  const span = range.max - range.min;
  for (let k = 0; k < n * ncell; k++) {
    const val = fields[k];
    if (val === val) { out[2 * k] = (val - range.min) / span; out[2 * k + 1] = 1; }
  }
  return out;
}

export function packMonthly(v, range) {
  const { data, entry } = v;
  const s = entry.scale ?? 1, o = entry.offset ?? 0;
  const span = range.max - range.min;
  const out = new Float32Array(data.length * 2);
  for (let k = 0; k < data.length; k++) {
    const r = data[k];
    if (r !== E.MISSING) { out[2 * k] = (r * s + o - range.min) / span; out[2 * k + 1] = 1; }
  }
  return out;
}

// Mean over a set of annual-field years (indices), NaN-aware.
export function meanField(af, fromIdx, toIdx) {
  const { fields, ncell } = af;
  const out = new Float32Array(ncell);
  for (let c = 0; c < ncell; c++) {
    let s = 0, n = 0;
    for (let y = fromIdx; y <= toIdx; y++) {
      const val = fields[y * ncell + c];
      if (val === val) { s += val; n++; }
    }
    out[c] = n ? s / n : NaN;
  }
  return out;
}

// Bilinear sample of a per-cell Float32Array at (lat, lon) on a grid.
export function sampleGrid(arr, grid, lat, lon) {
  const fi = (lat - grid.lat0) / grid.dlat;
  if (fi < -0.5 || fi > grid.nlat - 0.5) return NaN;
  let fj = (((lon - grid.lon0) % 360) + 360) % 360 / grid.dlon;
  const i0 = Math.max(0, Math.min(grid.nlat - 1, Math.floor(fi)));
  const i1 = Math.min(grid.nlat - 1, i0 + 1);
  const j0 = Math.floor(fj) % grid.nlon, j1 = (j0 + 1) % grid.nlon;
  const fy = Math.max(0, Math.min(1, fi - i0)), fx = fj - Math.floor(fj);
  const g = (i, j) => arr[i * grid.nlon + j];
  const vals = [[g(i0, j0), (1 - fx) * (1 - fy)], [g(i0, j1), fx * (1 - fy)], [g(i1, j0), (1 - fx) * fy], [g(i1, j1), fx * fy]];
  let s = 0, w = 0;
  for (const [val, wt] of vals) if (val === val && wt > 0) { s += val * wt; w += wt; }
  return w > 0.25 ? s / w : NaN;
}
