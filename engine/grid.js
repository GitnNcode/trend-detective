// Loading variables and working with their grids. Pure apart from the fetch
// in loadVariable. No DOM.
//
// Grid conventions (from the contract):
//   cell (i, j) is centred at lat0 + i*dlat, lon0 + j*dlon
//   i runs south to north, j runs west to east from lon0 (normally -180)
//   flat cell index c = i*nlon + j, the same order as one time slice of the file
//   data index = (t*nlat + i)*nlon + j

import { timeLabels } from "./time.js";

export const MISSING = -32768;
export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_KM; // 111.195 km

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function normLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function latOf(grid, i) {
  return grid.lat0 + i * grid.dlat;
}

export function lonOf(grid, j) {
  return normLon(grid.lon0 + j * grid.dlon);
}

// True area of each latitude row's cells in km², clipped at the poles, so a
// cell centred on a pole covers only the half that exists. Interior cells are
// proportional to cos(lat).
export function rowAreasKm2(grid) {
  const { nlat, dlat, dlon } = grid;
  const out = new Float64Array(nlat);
  const rad = Math.PI / 180;
  for (let i = 0; i < nlat; i++) {
    const lat = latOf(grid, i);
    const top = Math.min(90, lat + dlat / 2) * rad;
    const bot = Math.max(-90, lat - dlat / 2) * rad;
    out[i] = EARTH_RADIUS_KM * EARTH_RADIUS_KM * dlon * rad * Math.abs(Math.sin(top) - Math.sin(bot));
  }
  return out;
}

// Build a Var from raw bytes in the contract format (Int16 little-endian,
// [nt, nlat, nlon]). Accepts an ArrayBuffer or any typed-array view
// (including a Node Buffer).
export function fromBuffer(entry, buffer) {
  const { nlat, nlon } = entry.grid;
  const expected = entry.nt * nlat * nlon;
  const view = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength !== expected * 2) {
    throw new Error(
      `${entry.file ?? entry.id}: expected ${expected * 2} bytes for nt=${entry.nt}, ` +
      `nlat=${nlat}, nlon=${nlon}, got ${view.byteLength}`,
    );
  }
  let data;
  if (LITTLE_ENDIAN && view.byteOffset % 2 === 0) {
    data = new Int16Array(view.buffer, view.byteOffset, expected);
  } else if (LITTLE_ENDIAN) {
    data = new Int16Array(view.slice().buffer);
  } else {
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    data = new Int16Array(expected);
    for (let k = 0; k < expected; k++) data[k] = dv.getInt16(2 * k, true);
  }
  return makeVar(entry, data);
}

export function makeVar(entry, data) {
  const { nlat, nlon } = entry.grid;
  const scale = entry.scale ?? 1;
  const offset = entry.offset ?? 0;
  return {
    entry,
    data,
    value(t, i, j) {
      const raw = data[(t * nlat + i) * nlon + j];
      return raw === MISSING ? NaN : raw * scale + offset;
    },
  };
}

function joinUrl(baseUrl, file) {
  if (!baseUrl) return file;
  return baseUrl.endsWith("/") ? baseUrl + file : baseUrl + "/" + file;
}

// Fetch /data/<id>.bin and wrap it. baseUrl is the folder holding the file,
// for example "./data/mock/". A file: URL is read with node:fs, which keeps
// the engine usable from Node tests and scripts.
export async function loadVariable(entry, baseUrl) {
  const url = joinUrl(baseUrl, entry.file);
  if (url.startsWith("file:")) {
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(new URL(url));
    return fromBuffer(entry, buf);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  return fromBuffer(entry, await res.arrayBuffer());
}

// Inclusive threshold bounds with a small tolerance, so a value stored as
// exactly 0.15 counts as <= 0.15 even after Float32 rounding in the annual
// fields. 1e-6 relative is far below the Int16 storage step of any variable.
export function thresholdBounds(min, max) {
  const tol = (x) => 1e-6 * Math.max(1, Math.abs(x));
  return {
    lo: min == null ? -Infinity : min - tol(min),
    hi: max == null ? Infinity : max + tol(max),
  };
}

// Column index of the cell containing longitude `lon`, or -1 if a regional
// (not full-circle) grid does not cover it.
export function lonIndex(grid, lon) {
  let off = ((((lon - grid.lon0) % 360) + 360) % 360);
  if (off > 360 - grid.dlon / 2) off -= 360;
  const j = Math.round(off / grid.dlon);
  if (grid.nlon * grid.dlon >= 359.999) return ((j % grid.nlon) + grid.nlon) % grid.nlon;
  return j >= 0 && j < grid.nlon ? j : -1;
}

// Longitude range test that handles regions crossing the date line
// (lonMin > lonMax, for example 170 to -170) and full-circle regions.
export function lonInRange(lon, lonMin, lonMax) {
  if (lonMax - lonMin >= 360) return true;
  const width = (((lonMax - lonMin) % 360) + 360) % 360;
  const off = (((lon - lonMin) % 360) + 360) % 360;
  return off <= width + 1e-9;
}

// Cells whose centres fall inside the region box. A null region means the
// whole grid. If the box is smaller than a cell and holds no centre, the
// single nearest cell is used so point-like regions still work.
// Returns { cells: Int32Array of flat indices, rows: Int32Array of their i }.
export function regionCells(grid, region) {
  const { nlat, nlon } = grid;
  const cells = [];
  if (!region) {
    for (let c = 0; c < nlat * nlon; c++) cells.push(c);
  } else {
    const latMin = Math.min(region.latMin, region.latMax);
    const latMax = Math.max(region.latMin, region.latMax);
    const lonOk = new Uint8Array(nlon);
    for (let j = 0; j < nlon; j++) lonOk[j] = lonInRange(lonOf(grid, j), region.lonMin, region.lonMax) ? 1 : 0;
    for (let i = 0; i < nlat; i++) {
      const lat = latOf(grid, i);
      if (lat < latMin - 1e-9 || lat > latMax + 1e-9) continue;
      for (let j = 0; j < nlon; j++) if (lonOk[j]) cells.push(i * nlon + j);
    }
    if (cells.length === 0) {
      const cLat = (latMin + latMax) / 2;
      const span = (((region.lonMax - region.lonMin) % 360) + 360) % 360;
      const cLon = normLon(region.lonMin + span / 2);
      const i = Math.round((cLat - grid.lat0) / grid.dlat);
      const j = lonIndex(grid, cLon);
      if (i >= 0 && i < nlat && j >= 0) cells.push(i * nlon + j);
    }
  }
  const out = Int32Array.from(cells);
  const rows = new Int32Array(out.length);
  for (let k = 0; k < out.length; k++) rows[k] = Math.floor(out[k] / nlon);
  return { cells: out, rows };
}

// Area-weighted (cos latitude) regional mean for every month. Missing cells
// are skipped; a month with no valid cell is NaN.
export function regionSeries(v, region) {
  const { entry, data } = v;
  const grid = entry.grid;
  const ncell = grid.nlat * grid.nlon;
  const scale = entry.scale ?? 1, offset = entry.offset ?? 0;
  const { cells, rows } = regionCells(grid, region);
  const areas = rowAreasKm2(grid);
  const w = new Float64Array(cells.length);
  for (let k = 0; k < cells.length; k++) w[k] = areas[rows[k]];
  const values = new Float64Array(entry.nt);
  for (let t = 0; t < entry.nt; t++) {
    const base = t * ncell;
    let sw = 0, swv = 0;
    for (let k = 0; k < cells.length; k++) {
      const raw = data[base + cells[k]];
      if (raw === MISSING) continue;
      sw += w[k];
      swv += w[k] * raw;
    }
    values[t] = sw > 0 ? (swv / sw) * scale + offset : NaN;
  }
  return { t: timeLabels(entry), values };
}
