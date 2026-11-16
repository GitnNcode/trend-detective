// Shipping lanes: the fastest sea path between two ports, year by year, and a
// five-year projection from the recent trend. Pure, no DOM.
//
// The ocean is the 2° x 2.5° global grid. A ship moves to any of the eight
// neighbouring ocean cells; each step costs sailing time:
//   hours = km / (speed * (1 - windLoss) * iceFactor)
//   windLoss  = min(maxLoss, windK * W² * f), W the 10 m wind speed, f = 1 for
//               a head wind, 0.6 abeam, 0.2 astern (added resistance from wind
//               and the waves it raises)
//   iceFactor = 1 / (1 + iceK * c) for ice fraction c up to iceBlock; above
//               that the cell is closed. Ice-free water gives 1.
// Each year uses the season-mean wind and ice. A* with straight-line distance
// at full speed as the heuristic (never an overestimate, so paths are optimal
// on the grid).
//
// ponytail: monthly-mean wind vectors understate real wind (gusts and storms
// average out), the grid is about 200 km, and canals and narrow straits are
// opened by hand ("gates"). No tolls, draught limits or piracy routing.
// Good for how routes shift with ice and wind, not for navigation.

import { latOf, lonOf, normLon, MISSING, EARTH_RADIUS_KM, KM_PER_DEG_LAT, makeVar } from "./grid.js";
import { annualFields } from "./fields.js";
import { sampleCells } from "./route.js";

const rad = Math.PI / 180;

export const SHIP = {
  speedKmh: 14 * 1.852, // 14 knots, a typical tanker or bulk carrier service speed
  windK: 0.0015,        // 10 m/s head wind -> 15% slower
  maxLoss: 0.6,
  iceK: 4,              // 15% ice -> 37% slower, 50% ice -> 3x slower
  iceBlock: 0.5,        // more ice than this: closed
  southLimit: -56,      // no Antarctic ice data on our grid, and icebergs: closed south of here (Drake Passage stays open)
};

// Canals and straits narrower than a grid cell, forced open.
export const GATES = [
  { name: "Suez Canal, Red Sea and Gulf of Aden", points: [[31.5, 32.3], [30, 32.5], [28, 33.5], [25, 35.5], [20, 38.5], [15, 41.5], [12.5, 43.5], [12, 46], [12.5, 48], [12.5, 51], [11.5, 53]] },
  { name: "Panama Canal", points: [[10.5, -80], [9, -79.6], [7, -79.6]] },
  { name: "Strait of Gibraltar and Alboran Sea", points: [[36, -8], [36, -5.5], [36.5, -3], [37, 0], [38, 3]] },
  { name: "Strait of Sicily", points: [[38, 8], [37.5, 10.5], [36.5, 13]] },
  { name: "Strait of Hormuz and Gulf of Oman", points: [[26.7, 50.5], [26.5, 53], [26.5, 56], [25, 58], [23, 60], [22, 62]] },
  { name: "Strait of Malacca", points: [[6, 95], [4, 99], [2, 102], [1.2, 104], [1.5, 106]] },
  { name: "Dover Strait", points: [[49.5, -1], [51, 1.5], [52, 3.5]] },
  { name: "Bering Strait", points: [[63, -170], [66, -169], [68.5, -168]] },
  { name: "Lombok and Makassar Straits", points: [[-11, 116], [-8.5, 115.8], [-6, 117], [-3, 118], [0, 119], [2, 119.5], [4, 120], [6, 121]] },
];

// Where a path counts as going "via" somewhere, for the lane summaries.
const VIA = [
  { name: "Suez", test: (la, lo) => la > 26 && la < 32.5 && lo > 31 && lo < 35 },
  { name: "Panama", test: (la, lo) => la > 6 && la < 11 && lo > -81 && lo < -78 },
  { name: "Cape of Good Hope", test: (la, lo) => la < -33 && lo > 12 && lo < 32 },
  { name: "Cape Horn", test: (la, lo) => la < -54 && lo > -75 && lo < -60 },
  { name: "Malacca", test: (la, lo) => la > 0 && la < 7 && lo > 95 && lo < 104 },
  // East of the Vilkitsky Strait (about 100°E), so Kara Sea ports like Sabetta
  // sailing west do not count.
  { name: "Northern Sea Route", test: (la, lo) => la >= 70 && lo > 95 && lo < 180 },
  { name: "Northwest Passage", test: (la, lo) => la >= 68 && lo > -125 && lo < -80 },
];

function hav(la1, lo1, la2, lo2) {
  const a = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// oceanMask(soil, ice?) -> Uint8Array on soil's (global) grid, 1 = sea.
// Sea is where the land field is missing; north of 50°N, cells that are all
// land in the finer sea-ice grid (Greenland, Arctic islands) are land too;
// south of SHIP.southLimit is closed; GATES are forced open.
export function oceanMask(soil, ice = null, { gates = GATES, southLimit = SHIP.southLimit } = {}) {
  const g = soil.entry.grid, n = g.nlat * g.nlon;
  const sea = new Uint8Array(n).fill(1);
  const nt = Math.min(24, soil.entry.nt);
  for (let t = 0; t < nt; t++) for (let c = 0; c < n; c++) if (soil.data[t * n + c] !== MISSING) sea[c] = 0;
  if (ice) {
    const map = iceMap(g, ice.entry.grid), ni = ice.entry.grid.nlat * ice.entry.grid.nlon;
    for (let c = 0; c < n; c++) {
      const list = map[c];
      if (list && list.length && list.every((k) => ice.data[k] === MISSING && ice.data[ni + k] === MISSING)) sea[c] = 0;
    }
  }
  // Below southLimit, and the pole rows (all one point: moving along them would be free).
  for (let i = 0; i < g.nlat; i++) if (latOf(g, i) < southLimit || latOf(g, i) > 88) sea.fill(0, i * g.nlon, (i + 1) * g.nlon);
  for (const gate of gates) for (const c of sampleCells(gate, g)) sea[c.i * g.nlon + c.j] = 1;
  return sea;
}

// For each global cell, the sea-ice cells whose centres fall inside it.
const iceMaps = new Map();
function iceMap(g, gi) {
  const key = JSON.stringify([g, gi]);
  if (iceMaps.has(key)) return iceMaps.get(key);
  const out = new Array(g.nlat * g.nlon);
  for (let ii = 0; ii < gi.nlat; ii++) {
    const la = latOf(gi, ii), i = Math.round((la - g.lat0) / g.dlat);
    if (i < 0 || i >= g.nlat) continue;
    for (let jj = 0; jj < gi.nlon; jj++) {
      const j = ((Math.round((normLon(lonOf(gi, jj)) - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
      (out[i * g.nlon + j] ??= []).push(ii * gi.nlon + jj);
    }
  }
  iceMaps.set(key, out);
  return out;
}

// seasonStates({ soil, ice, u, v }, months) -> { years, states: [{ u, v, ice }] }
// Season-mean 10 m wind and sea ice for every year, on the global grid. Any
// of ice, u, v may be null (that factor is then left out).
export function seasonStates({ soil, ice, u, v }, months) {
  const g = soil.entry.grid, n = g.nlat * g.nlon;
  const ua = u && annualFields(u, months), va = v && annualFields(v, months), ia = ice && annualFields(ice, months);
  const sets = [ua, va, ia].filter(Boolean);
  const years = sets.length ? sets[0].years.filter((y) => sets.every((s) => s.years.includes(y))) : annualFields(soil, months).years;
  const map = ice && iceMap(g, ice.entry.grid);
  const states = years.map((yr) => {
    const pick = (a) => {
      if (!a) return new Float32Array(n);
      const y = a.years.indexOf(yr);
      return a.fields.subarray(y * n, (y + 1) * n);
    };
    const st = { u: pick(ua), v: pick(va), ice: new Float32Array(n) };
    if (ia) {
      const ni = ia.ncell, f = ia.fields.subarray(ia.years.indexOf(yr) * ni, (ia.years.indexOf(yr) + 1) * ni);
      for (let c = 0; c < n; c++) {
        const list = map[c];
        if (!list) continue;
        let s = 0, k = 0;
        for (const q of list) if (f[q] === f[q]) { s += f[q]; k++; }
        st.ice[c] = k ? s / k : 0;
      }
    }
    return st;
  });
  return { years, states };
}

// projectStates(seasons, ahead, { window }) -> { years, states }
// Per cell, a straight line through the last `window` years of each field,
// extended `ahead` years past the record. Ice is clamped to 0..1.
// ponytail: linear per-cell extrapolation; year-to-year weather is not
// predictable this way, only the drift.
export function projectStates({ years, states }, ahead = 5, { window = 20 } = {}) {
  const k0 = Math.max(0, years.length - window), ys = years.slice(k0), m = ys.length;
  const last = years.at(-1), keys = Object.keys(states[0]);
  const xm = ys.reduce((a, b) => a + b, 0) / m;
  const sxx = ys.reduce((a, y) => a + (y - xm) ** 2, 0);
  const fit = (key) => {
    const n = states[0][key].length, a = new Float32Array(n), b = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      let sy = 0, sxy = 0, k = 0;
      for (let y = 0; y < m; y++) { const val = states[k0 + y][key][c]; if (val === val) { sy += val; k++; } }
      const ym = k ? sy / k : NaN;
      for (let y = 0; y < m; y++) { const val = states[k0 + y][key][c]; if (val === val) sxy += (ys[y] - xm) * (val - ym); }
      b[c] = sxx > 0 ? sxy / sxx : 0; a[c] = ym;
    }
    return { a, b };
  };
  const F = Object.fromEntries(keys.map((k) => [k, fit(k)]));
  const out = [];
  for (let h = 1; h <= ahead; h++) {
    const yr = last + h, st = {};
    for (const key of keys) {
      const n = F[key].a.length, f = new Float32Array(n);
      for (let c = 0; c < n; c++) f[c] = F[key].a[c] + F[key].b[c] * (yr - xm);
      if (key === "ice") for (let c = 0; c < n; c++) f[c] = Math.min(1, Math.max(0, f[c] || 0));
      st[key] = f;
    }
    out.push(st);
  }
  return { years: Array.from({ length: ahead }, (_, h) => last + h + 1), states: out };
}

// Nearest sea cell to a port.
export function snapPort(grid, sea, lat, lon) {
  let best = -1, bd = Infinity;
  for (let c = 0; c < sea.length; c++) {
    if (!sea[c]) continue;
    const d = hav(lat, lon, latOf(grid, Math.floor(c / grid.nlon)), lonOf(grid, c % grid.nlon));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Row geometry for the eight moves, cached per grid.
const geoms = new Map();
function geometry(g) {
  const key = JSON.stringify(g);
  if (geoms.has(key)) return geoms.get(key);
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
  const lat = new Float64Array(g.nlat * g.nlon), lon = new Float64Array(g.nlat * g.nlon);
  for (let c = 0; c < lat.length; c++) { lat[c] = latOf(g, Math.floor(c / g.nlon)); lon[c] = lonOf(g, c % g.nlon); }
  const out = { moves, km, he, hn, lat, lon };
  geoms.set(key, out);
  return out;
}

// fastestPath(grid, sea, state, src, dst, ship) -> { cells, km, hours } or null
export function fastestPath(grid, sea, state, src, dst, ship = SHIP) {
  const { nlat, nlon } = grid, n = nlat * nlon;
  const G = geometry(grid);
  const gS = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const hS = (c) => hav(G.lat[c], G.lon[c], G.lat[dst], G.lon[dst]) / ship.speedKmh;
  const heap = [], key = [];
  const push = (c, d) => {
    let k = heap.length; heap.push(c); key.push(d);
    while (k > 0) { const p = (k - 1) >> 1; if (key[p] <= d) break; heap[k] = heap[p]; key[k] = key[p]; k = p; }
    heap[k] = c; key[k] = d;
  };
  const pop = () => {
    const top = heap[0], lc = heap.pop(), ld = key.pop();
    if (heap.length) {
      let k = 0;
      for (;;) {
        let m = 2 * k + 1;
        if (m >= heap.length) break;
        if (m + 1 < heap.length && key[m + 1] < key[m]) m++;
        if (key[m] >= ld) break;
        heap[k] = heap[m]; key[k] = key[m]; k = m;
      }
      heap[k] = lc; key[k] = ld;
    }
    return top;
  };
  const open = (c) => sea[c] && !(state.ice[c] > ship.iceBlock);
  if (!open(src) || !open(dst)) return null;
  gS[src] = 0; push(src, hS(src));
  while (heap.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === dst) break;
    const i = Math.floor(c / nlon), j = c % nlon;
    for (let m = 0; m < 8; m++) {
      const [di, dj] = G.moves[m], ii = i + di;
      if (ii < 0 || ii >= nlat) continue;
      const nc = ii * nlon + ((j + dj + nlon) % nlon);
      if (done[nc] || !open(nc)) continue;
      const r = i * 8 + m;
      const wu = (state.u[c] + state.u[nc]) / 2 || 0, wv = (state.v[c] + state.v[nc]) / 2 || 0, W = Math.hypot(wu, wv);
      const f = W > 0 ? 0.6 - 0.4 * (wu * G.he[r] + wv * G.hn[r]) / W : 0.6;
      const loss = Math.min(ship.maxLoss, ship.windK * W * W * f);
      const iceF = 1 / (1 + ship.iceK * (state.ice[nc] || 0));
      const nd = gS[c] + G.km[r] / (ship.speedKmh * (1 - loss) * iceF);
      if (nd < gS[nc]) { gS[nc] = nd; prev[nc] = c; push(nc, nd + hS(nc)); }
    }
  }
  if (!done[dst]) return null;
  const cells = [];
  for (let c = dst; c !== -1; c = prev[c]) cells.push(c);
  cells.reverse();
  let km = 0;
  for (let k = 1; k < cells.length; k++) km += hav(G.lat[cells[k - 1]], G.lon[cells[k - 1]], G.lat[cells[k]], G.lon[cells[k]]);
  return { cells, km, hours: gS[dst] };
}

// shippingLanes(vars, lanes, { months, ahead, window, ship })
//   vars   { soil (land mask, required), ice, u, v } Vars; ice/u/v optional
//   lanes  [{ id, name, cargo, from: { name, lat, lon }, to: { ... } }]
// ->
//   { years, lanes: [{ id, name, cargo, from, to, paths[y]: [[lat, lon]] | null,
//                      km: Float64Array, days: Float64Array, via[y]: string[] }],
//     forecast: { years, lanes: same shape } , sea, inputs: { wind, ice } }
export function shippingLanes(vars, lanes, { months, ahead = 5, window = 20, ship = SHIP } = {}) {
  const g = vars.soil.entry.grid;
  const sea = oceanMask(vars.soil, vars.ice);
  const ends = lanes.map((l) => [snapPort(g, sea, l.from.lat, l.from.lon), snapPort(g, sea, l.to.lat, l.to.lon)]);
  const G = geometry(g);
  const run = (states) => lanes.map((l, k) => {
    const out = { id: l.id, name: l.name, cargo: l.cargo, from: l.from, to: l.to, paths: [], km: new Float64Array(states.length), days: new Float64Array(states.length), via: [] };
    states.forEach((st, y) => {
      const p = fastestPath(g, sea, st, ends[k][0], ends[k][1], ship);
      out.paths.push(p ? p.cells.map((c) => [G.lat[c], G.lon[c]]) : null);
      out.km[y] = p ? p.km : NaN;
      out.days[y] = p ? p.hours / 24 : NaN;
      out.via.push(p ? viaOf(out.paths[y]) : []);
    });
    return out;
  });
  const seasons = seasonStates(vars, months);
  const proj = seasons.years.length >= 5 ? projectStates(seasons, ahead, { window }) : { years: [], states: [] };
  return {
    years: seasons.years,
    lanes: run(seasons.states),
    forecast: { years: proj.years, lanes: run(proj.states) },
    sea,
    inputs: { wind: !!(vars.u && vars.v), ice: !!vars.ice },
  };
}

export function viaOf(points) {
  const out = [];
  for (const [la, lo] of points) for (const v of VIA) if (v.test(la, lo) && !out.includes(v.name)) out.push(v.name);
  return out;
}

// slowdownVar({ soil, ice, u, v }, ship) -> a Var "shipslow" on the global grid:
// for every month, how much slower than calm, ice-free water a ship sails in
// each sea cell, in percent. Wind counts at its average over all headings
// (f = 0.6, as abeam); ice as in fastestPath; cells closed by ice are 100.
// The closed far south is missing; land is filled near coasts (see below). This is the field the lanes are
// routed through, so it is the map behind them.
export function slowdownVar({ soil, ice, u, v }, ship = SHIP) {
  const g = soil.entry.grid, n = g.nlat * g.nlon;
  const sea = oceanMask(soil, ice);
  const nt = Math.min(...[soil, ice, u, v].filter(Boolean).map((x) => x.entry.nt));
  const map = ice && iceMap(g, ice.entry.grid), ni = ice ? ice.entry.grid.nlat * ice.entry.grid.nlon : 0;
  const is = ice ? ice.entry.scale ?? 1 : 1, io = ice ? ice.entry.offset ?? 0 : 0;
  const us = u ? u.entry.scale ?? 1 : 1, uo = u ? u.entry.offset ?? 0 : 0, vs = v ? v.entry.scale ?? 1 : 1, vo = v ? v.entry.offset ?? 0 : 0;
  const data = new Int16Array(nt * n).fill(MISSING);
  for (let t = 0; t < nt; t++) {
    for (let c = 0; c < n; c++) {
      if (!sea[c]) continue;
      let c2 = 0;
      if (map && map[c]) {
        let sum = 0, k = 0;
        for (const q of map[c]) { const r = ice.data[t * ni + q]; if (r !== MISSING) { sum += r * is + io; k++; } }
        c2 = k ? sum / k : 0;
      }
      let pct;
      if (c2 > ship.iceBlock) pct = 100;
      else {
        const ur = u ? u.data[t * n + c] : MISSING, vr = v ? v.data[t * n + c] : MISSING;
        const W = ur === MISSING || vr === MISSING ? 0 : Math.hypot(ur * us + uo, vr * vs + vo);
        const loss = Math.min(ship.maxLoss, ship.windK * W * W * 0.6);
        pct = 100 * (1 - (1 - loss) / (1 + ship.iceK * c2));
      }
      data[t * n + c] = Math.round(pct * 100);
    }
  }
  // Display only: extend the field two cells over the land edge (mean of the
  // sea cells within two cells), so coarse coastal cells do not leave grey gaps
  // at sea. The map paints the land on top, so the real coastline is the edge.
  const ring = [];
  for (let c = 0; c < n; c++) {
    if (sea[c]) continue;
    const i = Math.floor(c / g.nlon), j = c % g.nlon, la = latOf(g, i);
    if (la < ship.southLimit || la > 88) continue;
    const nb = [];
    for (let di = -2; di <= 2; di++) {
      const ii = i + di;
      if (ii < 0 || ii >= g.nlat) continue;
      for (let dj = -2; dj <= 2; dj++) { const q = ii * g.nlon + ((j + dj + g.nlon) % g.nlon); if (sea[q]) nb.push(q); }
    }
    if (nb.length) ring.push([c, nb]);
  }
  for (let t = 0; t < nt; t++) {
    const b = t * n;
    for (const [c, nb] of ring) {
      let s = 0, k = 0;
      for (const q of nb) { const r = data[b + q]; if (r !== MISSING) { s += r; k++; } }
      if (k) data[b + c] = Math.round(s / k);
    }
  }
  const entry = {
    id: "shipslow", file: null, units: "%", start: soil.entry.start, nt, grid: g, scale: 0.01, offset: 0,
    source: "computed in the browser from MERRA-2 U10M, V10M and FRSEAICE",
    defaultBand: { min: 10, max: null },
  };
  return makeVar(entry, data);
}
