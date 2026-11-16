// Oil tanker voyage planner. Pure, no DOM (runs in a Web Worker in the app).
//
// The ocean is the MERRA-2 native 0.5° x 0.625° grid (about 55 km), from its
// ocean fraction. A* finds the voyage with the least sailing time. Each step:
//   speed over ground = V * (1 - windLoss) * iceFactor + current along track
// with windLoss and iceFactor as in shipping.js, the current a monthly
// climatology (ECCO), and a floor of a quarter of V. Then the economics:
//   fuel per day  = fuelRef * (V / refSpeed)³   (cube law, fixed engine setting)
//   cost          = days * (day rate + fuel per day * fuel price) + canal tolls
//   CO2           = fuel * 3.114 (IMO factor for heavy fuel oil)
// Route options: the search runs with every canal the ship fits through, then
// again with each canal it used closed, so "via Suez" and "via the Cape" are
// both priced. Canal limits come from draught and beam (a laden VLCC is too
// deep for Suez and too wide for Panama).
//
// ponytail: tolls, day rates and fuel curves are round public figures, not
// quotes; no piracy, war-risk, port or ice-escort fees; one month's weather
// for the whole voyage; paths are straightened (time comes
// from the grid search, scaled to the straightened length). Good for
// comparing routes and seeing trends.

import { latOf, lonOf, normLon, MISSING, EARTH_RADIUS_KM, KM_PER_DEG_LAT } from "./grid.js";
import { sampleCells } from "./route.js";

const rad = Math.PI / 180;
const KN = 1.852; // km/h per knot

export const TANKERS = {
  vlcc:    { name: "VLCC",          dwt: 300000, draught: 22.0, beam: 60.0, speed: 13, refSpeed: 14, fuelRef: 62, dayRate: 45000 },
  suezmax: { name: "Suezmax",       dwt: 160000, draught: 17.0, beam: 48.0, speed: 13, refSpeed: 14, fuelRef: 46, dayRate: 38000 },
  aframax: { name: "Aframax",       dwt: 110000, draught: 14.8, beam: 44.0, speed: 13, refSpeed: 14, fuelRef: 39, dayRate: 32000 },
  lr1:     { name: "Panamax (LR1)", dwt: 75000,  draught: 13.0, beam: 32.3, speed: 13, refSpeed: 14, fuelRef: 32, dayRate: 26000 },
};

export const CANALS = {
  suez:   { name: "Suez Canal",   maxDraught: 20.1, maxBeam: 77.5, toll: { suezmax: 450000, aframax: 330000, lr1: 230000, vlcc: 600000 },
            points: [[31.6, 32.3], [31.0, 32.3], [30.5, 32.35], [29.95, 32.55], [29.4, 32.7], [28.8, 33.0], [28.2, 33.5], [27.6, 34.0]] },
  panama: { name: "Panama Canal", maxDraught: 15.2, maxBeam: 51.25, toll: { aframax: 420000, lr1: 280000, suezmax: 500000, vlcc: 600000 },
            points: [[9.6, -79.95], [9.3, -79.9], [9.1, -79.7], [8.9, -79.55], [8.6, -79.45]] },
};

// Straits narrower than a cell, always open.
export const STRAITS = [
  { name: "Strait of Gibraltar", points: [[35.95, -6.4], [35.95, -5.6], [36.1, -4.8]] },
  { name: "Bab-el-Mandeb", points: [[13.2, 43.1], [12.6, 43.4], [12.2, 43.9]] },
  { name: "Turkish Straits", points: [[41.4, 29.2], [41.0, 29.0], [40.8, 28.2], [40.4, 26.7], [40.0, 26.2]] },
  { name: "Danish Straits", points: [[57.8, 10.7], [56.6, 11.1], [55.6, 10.9], [54.9, 10.9], [54.5, 11.3]] },
  { name: "Singapore Strait", points: [[1.25, 103.4], [1.2, 104.0], [1.3, 104.5]] },
  { name: "Dover Strait", points: [[50.4, -0.5], [51.0, 1.5], [51.4, 2.2]] },
  { name: "Strait of Hormuz", points: [[26.2, 55.6], [26.55, 56.3], [26.0, 56.9], [25.4, 57.4]] },
];

const ICE = { open: 0.15, iceClass: 0.5, iceK: 4 };
const WIND = { k: 0.0015, maxLoss: 0.6 };

export const VIA = [
  { name: "Suez", test: (la, lo) => la > 29 && la < 31.8 && lo > 32 && lo < 32.9 },
  { name: "Panama", test: (la, lo) => la > 8.4 && la < 9.8 && lo > -80.2 && lo < -79.3 },
  { name: "Cape of Good Hope", test: (la, lo) => la < -33 && lo > 12 && lo < 32 },
  { name: "Cape Horn", test: (la, lo) => la < -54 && lo > -75 && lo < -60 },
  { name: "Malacca", test: (la, lo) => la > 0.8 && la < 7 && lo > 95 && lo < 104 },
  { name: "Lombok", test: (la, lo) => la > -9.5 && la < -3 && lo > 115 && lo < 120 },
  { name: "Northern Sea Route", test: (la, lo) => la >= 70 && lo > 95 && lo < 180 },
  { name: "Northwest Passage", test: (la, lo) => la >= 68 && lo > -125 && lo < -80 },
  { name: "Gibraltar", test: (la, lo) => la > 35.5 && la < 36.5 && lo > -6.5 && lo < -4.5 },
];

function hav(la1, lo1, la2, lo2) {
  const a = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const nearest = (g, lat, lon) => {
  const i = Math.round((lat - g.lat0) / g.dlat);
  if (i < 0 || i >= g.nlat) return -1;
  const j = ((Math.round((normLon(lon) - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
  return i * g.nlon + j;
};

// makeOcean({ maskPct, maskGrid, currents, currentGrid, windGrid, iceGrid })
// -> the fixed context every plan reuses: sea mask, canal cells, lookups from
// each fine cell to the wind, ice and current grids, and step geometry.
export function makeOcean({ maskPct, maskGrid: g, currents = null, currentGrid = null, currentScale = 0.001, windGrid, iceGrid = null, threshold = 50 }) {
  const n = g.nlat * g.nlon;
  const sea = new Uint8Array(n);
  for (let c = 0; c < n; c++) sea[c] = maskPct[c] >= threshold ? 1 : 0;
  // Close the rows at the poles: every cell there is the same point, so moving
  // along them would cost nothing and let a route jump across the cap.
  for (let i = 0; i < g.nlat; i++) if (Math.abs(latOf(g, i)) > 88) sea.fill(0, i * g.nlon, (i + 1) * g.nlon);
  for (const s of STRAITS) for (const c of sampleCells(s, g)) sea[c.i * g.nlon + c.j] = 1;
  const canalCells = {};
  for (const [id, cn] of Object.entries(CANALS)) {
    canalCells[id] = sampleCells(cn, g).map((c) => c.i * g.nlon + c.j).filter((c) => !sea[c]);
  }
  const lat = new Float64Array(n), lon = new Float64Array(n);
  const wIdx = new Int32Array(n), iIdx = new Int32Array(n).fill(-1), cIdx = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    lat[c] = latOf(g, Math.floor(c / g.nlon)); lon[c] = lonOf(g, c % g.nlon);
    wIdx[c] = nearest(windGrid, lat[c], lon[c]);
    if (iceGrid) iIdx[c] = nearest(iceGrid, lat[c], lon[c]);
    if (currentGrid) cIdx[c] = nearest(currentGrid, lat[c], lon[c]);
  }
  // Step geometry for the eight moves, per row.
  const moves = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di || dj) moves.push([di, dj]);
  const km = new Float64Array(g.nlat * 8), he = new Float64Array(g.nlat * 8), hn = new Float64Array(g.nlat * 8);
  for (let i = 0; i < g.nlat; i++) {
    const la = latOf(g, i);
    moves.forEach(([di, dj], m) => {
      const lb = la + di * g.dlat;
      km[i * 8 + m] = hav(la, 0, lb, dj * g.dlon);
      const e = dj * g.dlon * Math.cos(((la + lb) / 2) * rad) * KM_PER_DEG_LAT, nn = di * g.dlat * KM_PER_DEG_LAT, h = Math.hypot(e, nn) || 1;
      he[i * 8 + m] = e / h; hn[i * 8 + m] = nn / h;
    });
  }
  let cmax = 0;
  if (currents) for (let k = 0; k < currents.length; k++) if (currents[k] !== MISSING) cmax = Math.max(cmax, Math.abs(currents[k]) * currentScale);
  return { grid: g, n, sea, canalCells, lat, lon, wIdx, iIdx, cIdx, moves, km, he, hn, currents, currentGrid, currentScale, cmax: cmax * Math.SQRT2 };
}

// Per-cell weather for one month: { wu, wv, ice, cu, cv } on the fine grid.
// wind: { u, v } Float32Arrays on windGrid; ice: Float32Array on iceGrid or
// null; month 1..12 picks the current climatology.
export function weather(oc, { u, v, ice }, month) {
  const n = oc.n, wu = new Float32Array(n), wv = new Float32Array(n), ic = new Float32Array(n), cu = new Float32Array(n), cv = new Float32Array(n);
  const cg = oc.currentGrid, cn = cg ? cg.nlat * cg.nlon : 0, base = (month - 1) * 2 * cn;
  for (let c = 0; c < n; c++) {
    if (!oc.sea[c]) continue; // canal cells keep calm water
    const w = oc.wIdx[c];
    if (w >= 0) { wu[c] = u[w] || 0; wv[c] = v[w] || 0; }
    const k = oc.iIdx[c];
    if (ice && k >= 0) ic[c] = ice[k] || 0;
    const q = oc.cIdx[c];
    if (oc.currents && q >= 0) {
      const a = oc.currents[base + q], b = oc.currents[base + cn + q];
      if (a !== MISSING && b !== MISSING) { cu[c] = a * oc.currentScale; cv[c] = b * oc.currentScale; }
    }
  }
  return { wu, wv, ice: ic, cu, cv };
}

export function snap(oc, lat, lon) {
  let best = -1, bd = Infinity;
  const { sea, n } = oc;
  for (let c = 0; c < n; c++) {
    if (!sea[c]) continue;
    const d = hav(lat, lon, oc.lat[c], oc.lon[c]);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// A* over the fine grid. open: Uint8Array of usable cells. Returns
// { cells, km, hours } or null.
export function search(oc, wx, open, src, dst, { speedKn, iceMax }) {
  const { grid: g, n } = oc, nlon = g.nlon, nlat = g.nlat;
  const V = speedKn * KN, vmax = V + oc.cmax * 3.6;
  const gS = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const h = (c) => hav(oc.lat[c], oc.lon[c], oc.lat[dst], oc.lon[dst]) / vmax;
  // Binary heap in typed arrays.
  let cap = 1 << 16, size = 0, hc = new Int32Array(cap), hk = new Float64Array(cap);
  const push = (c, d) => {
    if (size === cap) { cap *= 2; const a = new Int32Array(cap), b = new Float64Array(cap); a.set(hc); b.set(hk); hc = a; hk = b; }
    let k = size++;
    while (k > 0) { const p = (k - 1) >> 1; if (hk[p] <= d) break; hc[k] = hc[p]; hk[k] = hk[p]; k = p; }
    hc[k] = c; hk[k] = d;
  };
  const pop = () => {
    const top = hc[0], lc = hc[--size], ld = hk[size];
    let k = 0;
    for (;;) {
      let m = 2 * k + 1;
      if (m >= size) break;
      if (m + 1 < size && hk[m + 1] < hk[m]) m++;
      if (hk[m] >= ld) break;
      hc[k] = hc[m]; hk[k] = hk[m]; k = m;
    }
    hc[k] = lc; hk[k] = ld;
    return top;
  };
  const ok = (c) => open[c] && !(wx.ice[c] > iceMax);
  if (!ok(src) || !ok(dst)) return null;
  gS[src] = 0; push(src, h(src));
  while (size) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === dst) break;
    const i = Math.floor(c / nlon), j = c % nlon;
    for (let m = 0; m < 8; m++) {
      const mv = oc.moves[m], ii = i + mv[0];
      if (ii < 0 || ii >= nlat) continue;
      const nc = ii * nlon + ((j + mv[1] + nlon) % nlon);
      if (done[nc] || !ok(nc)) continue;
      const r = i * 8 + m, he = oc.he[r], hn = oc.hn[r];
      const wu = (wx.wu[c] + wx.wu[nc]) / 2, wv = (wx.wv[c] + wx.wv[nc]) / 2, W = Math.hypot(wu, wv);
      const f = W > 0 ? 0.6 - 0.4 * (wu * he + wv * hn) / W : 0.6;
      const loss = Math.min(WIND.maxLoss, WIND.k * W * W * f);
      const iceF = 1 / (1 + ICE.iceK * wx.ice[nc]);
      const along = ((wx.cu[c] + wx.cu[nc]) * he + (wx.cv[c] + wx.cv[nc]) * hn) * 1.8; // mean current, m/s -> km/h
      const sog = Math.max(0.25 * V, V * (1 - loss) * iceF + along);
      const nd = gS[c] + oc.km[r] / sog;
      if (nd < gS[nc]) { gS[nc] = nd; prev[nc] = c; push(nc, nd + h(nc)); }
    }
  }
  if (!done[dst]) return null;
  const cells = [];
  for (let c = dst; c !== -1; c = prev[c]) cells.push(c);
  cells.reverse();
  let km = 0;
  for (let k = 1; k < cells.length; k++) km += hav(oc.lat[cells[k - 1]], oc.lon[cells[k - 1]], oc.lat[cells[k]], oc.lon[cells[k]]);
  return { cells, km, hours: gS[dst] };
}

// Straighten a grid path for drawing: from each kept point, jump to the
// farthest later point whose straight segment stays in open water.
export function smooth(oc, cells, open) {
  const g = oc.grid, out = [cells[0]];
  const clear = (a, b) => {
    const la1 = oc.lat[a], lo1 = oc.lon[a], la2 = oc.lat[b], dlo = normLon(oc.lon[b] - lo1);
    const steps = Math.ceil(3 * Math.max(Math.abs(la2 - la1) / g.dlat, Math.abs(dlo) / g.dlon));
    for (let s = 1; s < steps; s++) {
      const c = nearest(g, la1 + (la2 - la1) * (s / steps), lo1 + dlo * (s / steps));
      if (c < 0 || !open[c]) return false;
    }
    return true;
  };
  let k = 0;
  while (k < cells.length - 1) {
    let j = Math.min(cells.length - 1, k + 80);
    while (j > k + 1 && !clear(cells[k], cells[j])) j--;
    out.push(cells[j]);
    k = j;
  }
  return out.map((c) => [oc.lat[c], oc.lon[c]]);
}

// The Arctic shortcuts: the Russian Arctic east of the Kara Sea ports and the
// North American Arctic. Closed when pricing the "southern" alternative.
const arcticShortcut = (la, lo) => la >= 66 && ((lo > 75 && lo <= 180) || (lo >= -180 && lo < -60));

export function viaOf(points) {
  const out = [];
  for (const [la, lo] of points) for (const v of VIA) if (v.test(la, lo) && !out.includes(v.name)) out.push(v.name);
  return out;
}

// Canals this ship can use, and why not for the others.
export function canalAccess(cls) {
  const t = TANKERS[cls], out = {};
  for (const [id, c] of Object.entries(CANALS)) {
    out[id] = t.draught > c.maxDraught ? `too deep laden (${t.draught} m, limit ${c.maxDraught} m)`
      : t.beam > c.maxBeam ? `too wide (${t.beam} m, limit ${c.maxBeam} m)` : null;
  }
  return out;
}

// planVoyage(oc, wx, voyage) -> { options: [...], best } for one month's weather.
//   voyage { src, dst (fine cells), cls, speedKn, iceClass, fuelPrice, objective: "cost" | "time" }
// Each option: { via, canals, km, days, fuelT, co2T, tolls, cost, path (straightened [[lat, lon]]) }
export function planVoyage(oc, wx, v) {
  const t = TANKERS[v.cls], access = canalAccess(v.cls);
  const iceMax = v.iceClass ? ICE.iceClass : ICE.open;
  const allowed = Object.keys(CANALS).filter((id) => !access[id]);
  const openWith = (ids, noArctic) => {
    const o = oc.sea.slice();
    for (const id of ids) for (const c of oc.canalCells[id]) o[c] = 1;
    if (noArctic) for (let c = 0; c < oc.n; c++) if (arcticShortcut(oc.lat[c], oc.lon[c])) o[c] = 0;
    return o;
  };
  const fuelDay = t.fuelRef * (v.speedKn / t.refSpeed) ** 3;
  const price = (r, open) => {
    const pts = r.cells.map((c) => [oc.lat[c], oc.lon[c]]);
    const used = Object.keys(CANALS).filter((id) => oc.canalCells[id].some((c) => r.cells.includes(c)));
    // Distance along the straightened path (the grid zigzag adds 5-8%); time
    // scaled by the same ratio.
    const path = smooth(oc, r.cells, open);
    let km = 0;
    for (let k = 1; k < path.length; k++) km += hav(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]);
    const days = (r.hours * (km / r.km)) / 24, fuelT = days * fuelDay, tolls = used.reduce((s, id) => s + (CANALS[id].toll[v.cls] ?? 0), 0);
    return {
      via: viaOf(pts), canals: used, km, days, fuelT, co2T: fuelT * 3.114, tolls,
      cost: days * (t.dayRate + fuelDay * v.fuelPrice) + tolls, path,
    };
  };
  const options = [], seen = new Set();
  const tryOpen = (ids, noArctic = false) => {
    const key = ids.slice().sort().join(",") + (noArctic ? "|south" : "");
    if (seen.has(key)) return null;
    seen.add(key);
    const open = openWith(ids, noArctic);
    const r = search(oc, wx, open, v.src, v.dst, { speedKn: v.speedKn, iceMax });
    if (!r) return null;
    const o = price(r, open);
    if (!options.some((x) => x.via.join() === o.via.join() && x.canals.join() === o.canals.join())) options.push(o);
    return o;
  };
  // All usable canals, then each used canal closed in turn (one level deep),
  // and if the best route is an Arctic shortcut, the best one without it.
  const first = tryOpen(allowed);
  if (first) for (const id of first.canals) tryOpen(allowed.filter((x) => x !== id));
  if (first && first.via.some((x) => x === "Northern Sea Route" || x === "Northwest Passage")) tryOpen(allowed, true);
  const key = v.objective === "time" ? "days" : "cost";
  options.sort((a, b) => a[key] - b[key]);
  return { options, best: options[0] ?? null };
}
