// Route mode: how many months a year a shipping route is open. Pure, no DOM.

import { normLon, latOf, lonOf } from "./grid.js";
import { parseMonth, monthOfIndex } from "./time.js";

const rad = Math.PI / 180;

function cellOf(grid, lat, lon) {
  const i = Math.round((lat - grid.lat0) / grid.dlat);
  if (i < 0 || i >= grid.nlat) return null;
  const off = ((((lon - grid.lon0) % 360) + 360) % 360) / grid.dlon;
  const j = Math.round(off) % grid.nlon;
  // Grids that do not wrap all the way round (regional) can miss a longitude.
  if (grid.nlon * grid.dlon < 359.999 && off > grid.nlon - 0.5) return null;
  return { i, j };
}

function slerp(a, b, f) {
  const [la1, lo1] = [a[0] * rad, a[1] * rad];
  const [la2, lo2] = [b[0] * rad, b[1] * rad];
  const p1 = [Math.cos(la1) * Math.cos(lo1), Math.cos(la1) * Math.sin(lo1), Math.sin(la1)];
  const p2 = [Math.cos(la2) * Math.cos(lo2), Math.cos(la2) * Math.sin(lo2), Math.sin(la2)];
  const dot = Math.min(1, Math.max(-1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return [a[0], a[1]];
  const s1 = Math.sin((1 - f) * om) / Math.sin(om), s2 = Math.sin(f * om) / Math.sin(om);
  const x = s1 * p1[0] + s2 * p2[0], y = s1 * p1[1] + s2 * p2[1], z = s1 * p1[2] + s2 * p2[2];
  return [Math.atan2(z, Math.hypot(x, y)) / rad, Math.atan2(y, x) / rad];
}

// Densify a route to about one sample per grid cell and map each sample to
// its cell. Between waypoints the path is a straight line in latitude and
// longitude, taking the short way round in longitude (ships follow coasts and
// waypoints, not great circles); pass { greatCircle: true } for flight paths.
// Consecutive samples in the same cell are merged and samples off the grid are
// dropped. Returns [{ lat, lon, i, j }], lat/lon being the cell centre.
export function sampleRoute(route, grid, { greatCircle = false } = {}) {
  const pts = route.points ?? route;
  const out = [];
  let last = -1;
  const push = (lat, lon) => {
    const cell = cellOf(grid, lat, lon);
    if (!cell) return;
    const key = cell.i * grid.nlon + cell.j;
    if (key === last) return;
    last = key;
    out.push({ lat: latOf(grid, cell.i), lon: lonOf(grid, cell.j), i: cell.i, j: cell.j });
  };
  if (pts.length === 1) push(pts[0][0], normLon(pts[0][1]));
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const dLat = b[0] - a[0];
    const dLon = normLon(b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(2 * Math.max(Math.abs(dLat) / grid.dlat, Math.abs(dLon) / grid.dlon)));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      if (greatCircle) {
        const [lat, lon] = slerp(a, b, f);
        push(lat, normLon(lon));
      } else {
        push(a[0] + f * dLat, normLon(a[1] + f * dLon));
      }
    }
  }
  return out;
}

// routeOpen(v, route, { max, greatCircle })
//
// A month is open if every route sample with data is <= max (samples on
// missing cells, such as land, are ignored; a month with no valid sample is
// not open). Only calendar years with all twelve months in the record are
// reported.
//   openMonths[y]      number of open months in years[y]
//   openMonthList[y]   which months (1..12) were open
//   chokePointIndex    index into `samples` of the point that most often
//                      blocks the route (highest value in a closed month);
//                      -1 if the route was never blocked or has no samples
export function routeOpen(v, route, opts = {}) {
  const max = opts.max ?? 0.15;
  const { entry } = v;
  const samples = sampleRoute(route, entry.grid, opts);
  const { year: y0, month: m0 } = parseMonth(entry.start);

  const byYear = new Map();
  const blockCount = new Int32Array(samples.length);
  for (let t = 0; t < entry.nt; t++) {
    const { year, month } = monthOfIndex(y0, m0, t);
    let valid = 0, open = true, worst = -Infinity, worstK = -1;
    for (let k = 0; k < samples.length; k++) {
      const val = v.value(t, samples[k].i, samples[k].j);
      if (val !== val) continue;
      valid++;
      if (val > max) open = false;
      if (val > worst) { worst = val; worstK = k; }
    }
    if (valid === 0) open = false;
    else if (!open) blockCount[worstK]++;
    if (!byYear.has(year)) byYear.set(year, { n: 0, open: [] });
    const rec = byYear.get(year);
    rec.n++;
    if (open) rec.open.push(month);
  }

  const years = [...byYear.keys()].filter((y) => byYear.get(y).n === 12).sort((a, b) => a - b);
  const openMonths = years.map((y) => byYear.get(y).open.length);
  const openMonthList = years.map((y) => byYear.get(y).open);

  let chokePointIndex = -1, best = 0;
  for (let k = 0; k < samples.length; k++) if (blockCount[k] > best) { best = blockCount[k]; chokePointIndex = k; }

  return {
    years,
    openMonths,
    chokePointIndex,
    // Extras beyond the contract.
    openMonthList,
    samples,
    chokePoint: chokePointIndex >= 0 ? samples[chokePointIndex] : null,
    max,
  };
}
