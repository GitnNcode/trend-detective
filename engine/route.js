// Route mode: how many months a year a shipping route is open. Pure, no DOM.

import { normLon, latOf, lonOf, lonIndex, thresholdBounds, EARTH_RADIUS_KM } from "./grid.js";
import { parseMonth, monthOfIndex, seasonPlan } from "./time.js";

const rad = Math.PI / 180;

function cellOf(grid, lat, lon) {
  const i = Math.round((lat - grid.lat0) / grid.dlat);
  if (i < 0 || i >= grid.nlat) return null;
  const j = lonIndex(grid, lon);
  return j < 0 ? null : { i, j };
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
// dropped. Returns [[lat, lon], ...], each the centre of a sampled cell, so
// the map can draw exactly the path routeOpen tests.
export function sampleRoute(route, grid, opts = {}) {
  return sampleCells(route, grid, opts).map((c) => [c.lat, c.lon]);
}

// The same samples with their grid indices: [{ lat, lon, i, j }].
export function sampleCells(route, grid, { greatCircle = route?.greatCircle ?? false } = {}) {
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

// routeOpen(v, route, { max, greatCircle, months })
//
// A month is open if every route sample with data is <= max (samples on
// missing cells, such as land, are ignored; a month with no valid sample is
// not open). `months` limits which calendar months are checked (default all
// twelve); only years with every one of those months in the record are
// reported.
//   samples            [[lat, lon], ...], the same as sampleRoute
//   openMonths[y]      number of open months in years[y]
//   openMonthList[y]   which months (1..12) were open
//   chokePointIndex    index into `samples` of the point that blocks the
//                      route in the most checked months (value above max);
//                      -1 if the route was never blocked or has no samples
export function routeOpen(v, route, opts = {}) {
  const max = opts.max ?? 0.15;
  const { hi } = thresholdBounds(null, max);
  const { entry } = v;
  const cells = sampleCells(route, entry.grid, opts);
  const plan = seasonPlan(opts.months);
  const { year: y0, month: m0 } = parseMonth(entry.start);

  const byYear = new Map();
  const blockCount = new Int32Array(cells.length);
  for (let t = 0; t < entry.nt; t++) {
    const { year, month } = monthOfIndex(y0, m0, t);
    if (!plan.selected[month]) continue;
    let valid = 0, open = true;
    for (let k = 0; k < cells.length; k++) {
      const val = v.value(t, cells[k].i, cells[k].j);
      if (val !== val) continue;
      valid++;
      if (val > hi) { open = false; blockCount[k]++; }
    }
    if (valid === 0) open = false;
    const sy = year + plan.yearShift[month];
    if (!byYear.has(sy)) byYear.set(sy, { n: 0, open: [] });
    const rec = byYear.get(sy);
    rec.n++;
    if (open) rec.open.push(month);
  }

  const years = [...byYear.keys()].filter((y) => byYear.get(y).n === plan.count).sort((a, b) => a - b);
  const openMonths = years.map((y) => byYear.get(y).open.length);
  const openMonthList = years.map((y) => byYear.get(y).open);

  let chokePointIndex = -1, best = 0;
  for (let k = 0; k < cells.length; k++) if (blockCount[k] > best) { best = blockCount[k]; chokePointIndex = k; }

  const samples = cells.map((c) => [c.lat, c.lon]);
  return {
    years,
    openMonths,
    openMonthList,
    samples,
    chokePointIndex,
    // Extras beyond the contract.
    chokePoint: chokePointIndex >= 0 ? samples[chokePointIndex] : null,
    sampleCells: cells,
    max,
    months: Array.from({ length: 12 }, (_, k) => k + 1).filter((m) => plan.selected[m]),
  };
}

// bestPath(v, route, { max, months })
//
// The shortest open-water path between a route's two ends, found fresh for
// every month instead of following the fixed waypoints. A cell is passable
// when its value is at or below `max` (land and other missing cells never
// are). Moves go to the eight neighbouring cells; each step costs the great
// circle distance between cell centres, so the path is the shortest sea
// distance through open water on the grid. Dijkstra, one run per checked
// month. Ends that fall on land snap to the nearest cell with data.
//   years[y]       as routeOpen
//   lengthKm[y]    shortest open path in years[y] over the checked months,
//                  NaN when no month had one
//   bestMonth[y]   the month (1..12) of that path, 0 when none
//   paths[y]       [[lat, lon], ...] cell centres of that path, or null
//   fixedKm        length of the fixed route as routeOpen samples it, for
//                  comparison
// ponytail: cell-centre grid at 1° x 1.25°, so lengths are rough (about
// ±5%) and narrow straits may close; a finer grid is the upgrade path.
export function bestPath(v, route, opts = {}) {
  const max = opts.max ?? 0.15;
  const { hi } = thresholdBounds(null, max);
  const { entry } = v;
  const g = entry.grid;
  const { nlat, nlon } = g;
  const wrap = nlon * g.dlon >= 359.999;
  const pts = route.points ?? route;
  const n = nlat * nlon;

  // Step lengths: along a row, along a column, and diagonally up from row i.
  const ew = new Float64Array(nlat), diag = new Float64Array(nlat);
  for (let i = 0; i < nlat; i++) {
    const la = latOf(g, i);
    ew[i] = hav(la, 0, la, g.dlon);
    diag[i] = i + 1 < nlat ? hav(la, 0, la + g.dlat, g.dlon) : Infinity;
  }
  const ns = hav(0, 0, g.dlat, 0);

  const snap = (lat, lon) => {
    let best = -1, bd = Infinity;
    for (let c = 0; c < n; c++) {
      const i = Math.floor(c / nlon), j = c % nlon;
      if (!(v.value(0, i, j) === v.value(0, i, j))) continue;
      const d = hav(lat, lon, latOf(g, i), lonOf(g, j));
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  const src = snap(pts[0][0], normLon(pts[0][1]));
  const dst = snap(pts.at(-1)[0], normLon(pts.at(-1)[1]));

  const plan = seasonPlan(opts.months);
  const { year: y0, month: m0 } = parseMonth(entry.start);
  const byYear = new Map();
  const dist = new Float64Array(n), prev = new Int32Array(n), open = new Uint8Array(n);

  for (let t = 0; t < entry.nt; t++) {
    const { year, month } = monthOfIndex(y0, m0, t);
    if (!plan.selected[month]) continue;
    const sy = year + plan.yearShift[month];
    if (!byYear.has(sy)) byYear.set(sy, { n: 0, km: NaN, month: 0, path: null });
    const rec = byYear.get(sy);
    rec.n++;
    if (src < 0 || dst < 0) continue;

    for (let c = 0; c < n; c++) {
      const val = v.value(t, Math.floor(c / nlon), c % nlon);
      open[c] = val === val && val <= hi ? 1 : 0;
    }
    if (!open[src] || !open[dst]) continue;
    const km = dijkstra(src, dst, open, dist, prev, nlat, nlon, wrap, ew, ns, diag);
    if (km < (rec.km === rec.km ? rec.km : Infinity)) {
      rec.km = km; rec.month = month;
      const path = [];
      for (let c = dst; c >= 0; c = c === src ? -1 : prev[c]) path.push([latOf(g, Math.floor(c / nlon)), lonOf(g, c % nlon)]);
      rec.path = path.reverse();
    }
  }

  const years = [...byYear.keys()].filter((y) => byYear.get(y).n === plan.count).sort((a, b) => a - b);
  const fixed = sampleCells(route, g, opts);
  let fixedKm = 0;
  for (let k = 1; k < fixed.length; k++) fixedKm += hav(fixed[k - 1].lat, fixed[k - 1].lon, fixed[k].lat, fixed[k].lon);
  return {
    years,
    lengthKm: Float64Array.from(years, (y) => byYear.get(y).km),
    bestMonth: years.map((y) => byYear.get(y).month),
    paths: years.map((y) => byYear.get(y).path),
    fixedKm,
    max,
  };
}

function hav(la1, lo1, la2, lo2) {
  const a = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Dijkstra on the 8-connected grid with a binary heap. Fills dist and prev;
// returns the distance to dst (Infinity if unreachable).
function dijkstra(src, dst, open, dist, prev, nlat, nlon, wrap, ew, ns, diag) {
  dist.fill(Infinity); prev.fill(-1);
  const heap = [], key = [];
  const push = (c, d) => {
    let k = heap.length; heap.push(c); key.push(d);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (key[p] <= d) break;
      heap[k] = heap[p]; key[k] = key[p]; k = p;
    }
    heap[k] = c; key[k] = d;
  };
  const pop = () => {
    const top = heap[0], lastC = heap.pop(), lastD = key.pop();
    if (heap.length) {
      let k = 0;
      for (;;) {
        let m = 2 * k + 1;
        if (m >= heap.length) break;
        if (m + 1 < heap.length && key[m + 1] < key[m]) m++;
        if (key[m] >= lastD) break;
        heap[k] = heap[m]; key[k] = key[m]; k = m;
      }
      heap[k] = lastC; key[k] = lastD;
    }
    return top;
  };
  dist[src] = 0; push(src, 0);
  while (heap.length) {
    const d0 = key[0], c = pop();
    if (d0 > dist[c]) continue;
    if (c === dst) return d0;
    const i = Math.floor(c / nlon), j = c % nlon;
    for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      if (ii < 0 || ii >= nlat) continue;
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        let jj = j + dj;
        if (jj < 0 || jj >= nlon) { if (!wrap) continue; jj = (jj + nlon) % nlon; }
        const nc = ii * nlon + jj;
        if (!open[nc]) continue;
        const step = !di ? ew[i] : !dj ? ns : diag[Math.min(i, ii)];
        const nd = d0 + step;
        if (nd < dist[nc]) { dist[nc] = nd; prev[nc] = c; push(nc, nd); }
      }
    }
  }
  return Infinity;
}
