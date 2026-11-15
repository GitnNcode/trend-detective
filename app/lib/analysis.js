// Written with Claude and reviewed by the team.
//
// Trend Detective: extra analyses for the interface (Lane 3, app/lib).
//
// Browser ES module. Pure functions, no DOM, no Node imports. Everything is
// built on the engine (../../engine/index.js); see engine/README.md for the
// conventions used here:
//   - flat cell index c = i*nlon + j, row i runs south to north
//   - missing values are NaN after loading
//   - engine slopes are per year; "perDecade" fields here are per decade
//
// Exports
//   velocityField(v, months, opts)               climate velocity map: how fast a fixed value moves (km/yr)
//   velocitySummary(field, region, opts)         median/mean speed and mean direction inside a region
//   detectionHorizon(annual, opts)               years of data needed to detect a trend (Weatherhead et al. 1998)
//   detectionSentence(h, units, level)           plain-English line for a detectionHorizon result
//   climateTwin(vars, lat, lon, opts)            where a place's 1980s climate lives today, and the reverse
//   greatCircle, destination, bearingName, landMaskFrom    helpers
//   lineup(varsById, region, months)             every variable's trend in one region, strongest evidence first
//   dipole(v, track, months, opts)               one moving zone, two opposite local trends
//   distributionShift(v, region, months, opts)   histogram of the early decade vs the late decade
//   seasonalCycle(v, region, opts)               monthly climatology, base vs recent period
//   extrapolate(years, values, untilYear, level) trend line plus prediction interval (the "cone")
//
// Results are cached per Var in WeakMaps, so calling again on user interaction
// is cheap. Treat returned arrays as read-only: some are shared with the cache.

import {
  annualFields, trendMap, regionSeries, deseasonalize, annualMeans, linearTrend, mannKendall,
  verdict, rowAreasKm2, regionCells, latOf, lonOf, normLon, KM_PER_DEG_LAT, EARTH_RADIUS_KM,
  fmt, displayUnits, seasonPlan, MISSING, MIN_YEARS,
} from "../../engine/index.js";

const RAD = Math.PI / 180;

// Plain names used inside sentences. opts.label overrides them.
const PLAIN = {
  t2m: "air temperature",
  t500: "air temperature 5 km up",
  wind250: "jet-level wind speed",
  tqv: "water vapor",
  precip: "precipitation",
  evap: "evaporation",
  seaice: "sea ice cover",
  soilwet: "soil wetness",
  snow: "snow on the ground",
  runoff: "runoff",
};

// ---------------------------------------------------------------------------
// Caches and small helpers

const varCache = new WeakMap();

function cacheOf(v) {
  let c = varCache.get(v);
  if (!c) {
    c = { trend: new Map(), series: new Map(), velocity: new Map(), temp: new Map(), precip: new Map() };
    varCache.set(v, c);
  }
  return c;
}

// Get-or-compute in a bounded Map (oldest entry dropped first), so drawing
// many custom regions cannot grow memory without limit.
function remember(map, key, make, max = 32) {
  if (map.has(key)) return map.get(key);
  const value = make();
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
  return value;
}

const monthsKey = (months) => seasonPlan(months).key;
const regionKey = (r) => (r ? `${r.latMin},${r.latMax},${r.lonMin},${r.lonMax}` : "all");
const isFullCircle = (grid) => grid.nlon * grid.dlon >= 359.999;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const finite = Number.isFinite;

// Engine trendMap, once per Var and month filter.
function trendOf(v, months) {
  return remember(cacheOf(v).trend, monthsKey(months), () => trendMap(v, months), 16);
}

// Engine regionSeries, once per Var and region.
function seriesOf(v, region) {
  return remember(cacheOf(v).series, regionKey(region), () => regionSeries(v, region ?? null), 48);
}

// Area-weighted quantiles (q in 0..1) by sorting. Inputs hold no NaN. Fine
// for one value per grid cell (about 13 000).
function weightedQuantiles(vals, wts, qs) {
  const n = vals.length;
  if (n === 0) return qs.map(() => NaN);
  const idx = new Uint32Array(n);
  for (let k = 0; k < n; k++) idx[k] = k;
  idx.sort((a, b) => vals[a] - vals[b]);
  let total = 0;
  for (let k = 0; k < n; k++) total += wts[k];
  return qs.map((q) => {
    const target = q * total;
    let cum = 0;
    for (let k = 0; k < n; k++) {
      cum += wts[idx[k]];
      if (cum >= target) return vals[idx[k]];
    }
    return vals[idx[n - 1]];
  });
}

// Area-weighted quantiles of a large sample from a fine histogram: one pass,
// accurate to 1/4096 of the data range, plenty for choosing display edges.
function histogramQuantiles(vals, wts, n, qs) {
  let lo = Infinity, hi = -Infinity, total = 0;
  for (let k = 0; k < n; k++) {
    const x = vals[k];
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    total += wts[k];
  }
  if (!(total > 0)) return qs.map(() => NaN);
  if (hi === lo) return qs.map(() => lo);
  const NB = 4096;
  const hist = new Float64Array(NB);
  const scale = NB / (hi - lo);
  for (let k = 0; k < n; k++) {
    let b = Math.floor((vals[k] - lo) * scale);
    if (b >= NB) b = NB - 1;
    hist[b] += wts[k];
  }
  return qs.map((q) => {
    const target = q * total;
    let cum = 0;
    for (let b = 0; b < NB; b++) {
      const next = cum + hist[b];
      if (next >= target && hist[b] > 0) return lo + (b + (target - cum) / hist[b]) / scale;
      cum = next;
    }
    return hi;
  });
}

// Ordinary least squares of y on x over finite pairs, sorted by x. This is
// the same fit as engine linearTrend; we also need the residuals and the
// slope's standard error, which linearTrend does not return.
function olsFit(xsIn, ysIn) {
  const pairs = [];
  const m = Math.min(xsIn?.length ?? 0, ysIn?.length ?? 0);
  for (let k = 0; k < m; k++) {
    const x = Number(xsIn[k]), y = Number(ysIn[k]);
    if (finite(x) && finite(y)) pairs.push([x, y]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const x = pairs.map((p) => p[0]);
  const y = pairs.map((p) => p[1]);
  const out = { n, x, y, slope: NaN, xMean: NaN, yMean: NaN, sxx: NaN, sigma: NaN, se: NaN, resid: [] };
  if (n < 3) return out;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += x[k]; my += y[k]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sxx += (x[k] - mx) ** 2; sxy += (x[k] - mx) * (y[k] - my); }
  if (!(sxx > 0)) return out;
  const slope = sxy / sxx;
  const resid = y.map((yk, k) => yk - my - slope * (x[k] - mx));
  let rss = 0;
  for (const r of resid) rss += r * r;
  const sigma = Math.sqrt(rss / (n - 2));
  return { n, x, y, slope, xMean: mx, yMean: my, sxx, sigma, se: sigma / Math.sqrt(sxx), resid };
}

// Standard normal quantile (Acklam's rational approximation, relative error
// about 1e-9).
function normalQuantile(p) {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Student-t quantile. Exact for 1 and 2 degrees of freedom, otherwise the
// Cornish-Fisher expansion (Abramowitz and Stegun 26.7.5): within 0.1% at
// 3 degrees of freedom and far better beyond. The engine's tCritical is not
// part of its public index, so we do not import it.
function tQuantile(p, df) {
  if (!(df > 0)) return NaN;
  if (df === 1) return Math.tan(Math.PI * (p - 0.5));
  if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
  const z = normalQuantile(p);
  const z2 = z * z, z3 = z2 * z, z5 = z3 * z2, z7 = z5 * z2, z9 = z7 * z2;
  const g1 = (z3 + z) / 4;
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
  const g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

// "1.2 °C" or, for 0-to-1 fractions, "3.4 percentage points".
function amountText(x, units) {
  const { factor, label } = displayUnits(units);
  const s = fmt(Math.abs(x) * factor);
  return label ? `${s} ${label}` : s;
}

// A threshold value: "40 m/s", "0 °C", or "15%" for fractions.
function thresholdText(x, units) {
  const { factor } = displayUnits(units);
  if (factor === 100) return `${fmt(x * 100)}%`;
  return units ? `${fmt(x)} ${units}` : fmt(x);
}

// ---------------------------------------------------------------------------
// 1. Climate velocity (Loarie et al. 2009, Nature 462, 1052-1055)
//
// The speed at which a fixed value (an isotherm, say) moves across the map:
// local trend divided by the local spatial gradient. If the value rises, the
// line of equal value moves down-gradient, toward where it used to be lower.

// 3x3 smoothing that skips missing cells. Opposite neighbours are used in
// pairs (both or neither), so a field that is a straight ramp passes through
// unchanged, even at coasts and at the grid edge. A missing centre stays
// missing, so land-only fields do not bleed over the ocean.
function smooth3x3(src, nlat, nlon, wrap) {
  const out = new Float32Array(src.length).fill(NaN);
  const at = (i, j) => {
    if (i < 0 || i >= nlat) return NaN;
    if (j < 0 || j >= nlon) {
      if (!wrap) return NaN;
      j = (j + nlon) % nlon;
    }
    return src[i * nlon + j];
  };
  const PAIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let i = 0; i < nlat; i++) {
    for (let j = 0; j < nlon; j++) {
      const c0 = src[i * nlon + j];
      if (c0 !== c0) continue;
      let s = c0, n = 1;
      for (const [di, dj] of PAIRS) {
        const a = at(i + di, j + dj), b = at(i - di, j - dj);
        if (a === a && b === b) { s += a + b; n += 2; }
      }
      out[i * nlon + j] = s / n;
    }
  }
  return out;
}

// Central difference, one-sided when a neighbour is missing, NaN if both are.
function diff(before, here, after, step) {
  const okB = before === before, okA = after === after;
  if (okB && okA) return (after - before) / (2 * step);
  if (okA) return (after - here) / step;
  if (okB) return (here - before) / step;
  return NaN;
}

// Gradient of a field in units per km. dx = dlon * 111.195 * cos(lat) km,
// dy = dlat * 111.195 km. Longitude wraps on full-circle grids. A pole row
// has no east-west direction, so its gradient is NaN.
function gradient(field, grid) {
  const { nlat, nlon, dlat, dlon } = grid;
  const wrap = isFullCircle(grid);
  const gradX = new Float32Array(nlat * nlon).fill(NaN);
  const gradY = new Float32Array(nlat * nlon).fill(NaN);
  const dy = dlat * KM_PER_DEG_LAT;
  for (let i = 0; i < nlat; i++) {
    const cosLat = Math.cos(latOf(grid, i) * RAD);
    if (!(cosLat > 1e-6)) continue;
    const dx = dlon * KM_PER_DEG_LAT * cosLat;
    for (let j = 0; j < nlon; j++) {
      const c = i * nlon + j;
      const f0 = field[c];
      if (f0 !== f0) continue;
      const jw = j > 0 ? j - 1 : wrap ? nlon - 1 : -1;
      const je = j < nlon - 1 ? j + 1 : wrap ? 0 : -1;
      const gx = diff(jw >= 0 ? field[i * nlon + jw] : NaN, f0, je >= 0 ? field[i * nlon + je] : NaN, dx);
      const gy = diff(i > 0 ? field[c - nlon] : NaN, f0, i < nlat - 1 ? field[c + nlon] : NaN, dy);
      if (gx === gx && gy === gy) { gradX[c] = gx; gradY[c] = gy; }
    }
  }
  return { gradX, gradY };
}

// Per-cell area in km² for every flat index, and the matching weights for a
// list of cells.
function cellWeights(grid, cells) {
  const rows = rowAreasKm2(grid);
  const w = new Float64Array(cells.length);
  for (let k = 0; k < cells.length; k++) w[k] = rows[Math.floor(cells[k] / grid.nlon)];
  return w;
}

// Everything in the velocity field that does not depend on opts.gradFloor or
// opts.cap: trend, climatology, gradient. Cached per Var and month filter.
function velocityBase(v, months, smooth) {
  const key = monthsKey(months) + (smooth ? "" : "|raw");
  return remember(cacheOf(v).velocity, key, () => {
    const grid = v.entry.grid;
    const { nlat, nlon } = grid;
    const ncell = nlat * nlon;
    const tm = trendOf(v, months);
    const { years, fields } = annualFields(v, months);

    // Climatology: mean of the annual (or seasonal) fields, skipping NaN.
    const sum = new Float64Array(ncell);
    const cnt = new Uint32Array(ncell);
    for (let y = 0; y < years.length; y++) {
      const off = y * ncell;
      for (let c = 0; c < ncell; c++) {
        const x = fields[off + c];
        if (x === x) { sum[c] += x; cnt[c]++; }
      }
    }
    const raw = new Float32Array(ncell).fill(NaN);
    for (let c = 0; c < ncell; c++) if (cnt[c]) raw[c] = sum[c] / cnt[c];
    const clim = smooth ? smooth3x3(raw, nlat, nlon, isFullCircle(grid)) : raw;
    const { gradX, gradY } = gradient(clim, grid);

    // Area-weighted median of |grad C| over cells with a gradient.
    const all = Int32Array.from({ length: ncell }, (_, c) => c);
    const w = cellWeights(grid, all);
    const mags = [], wts = [];
    for (let c = 0; c < ncell; c++) {
      const gx = gradX[c];
      if (gx === gx) { mags.push(Math.hypot(gx, gradY[c])); wts.push(w[c]); }
    }
    const [medianGrad] = weightedQuantiles(mags, wts, [0.5]);
    return { years: tm.years, slope: tm.slope, p: tm.p, clim, gradX, gradY, medianGrad, areas: w };
  }, 8);
}

/**
 * Climate velocity (Loarie et al. 2009) for every cell.
 *
 * slope and p come from engine trendMap(v, months). The climatology is the
 * per-cell mean of annualFields(v, months) over all years, lightly smoothed
 * (3x3). Its gradient is in units per km. The velocity is
 *   (u, v) = -slope * grad C / max(|grad C|, gradFloor)^2      km per year
 * so a rising value moves its isoline down-gradient. gradFloor keeps flat
 * places (tropical oceans, plateaus) from producing near-infinite speeds.
 *
 * @param v       engine Var
 * @param months  optional month filter (1..12), as for trendMap
 * @param opts    { gradFloor (units/km; default 0.1 x area-weighted median |grad C|),
 *                  cap (km/yr; default area-weighted 98th percentile of speed),
 *                  smooth (default true) }
 * @returns { years, slope, p, clim, gradX, gradY, u, v, speed, cap, grid, units,
 *            medianSpeed, meanSpeed, gradFloor, speedUnits: "km/yr" }
 *   u = eastward, v = northward, both km/yr; speed is uncapped; cap is for the
 *   colour scale only. Per-cell arrays are Float32Array, index c = i*nlon + j,
 *   NaN where there is no trend or no gradient. medianSpeed and meanSpeed are
 *   area-weighted over valid cells, km/yr. units are the variable's units.
 */
export function velocityField(v, months, opts = {}) {
  const base = velocityBase(v, months, opts.smooth !== false);
  const grid = v.entry.grid;
  const ncell = grid.nlat * grid.nlon;
  const floor = finite(opts.gradFloor) && opts.gradFloor >= 0 ? opts.gradFloor : 0.1 * base.medianGrad;
  const { slope, gradX, gradY, areas } = base;
  const u = new Float32Array(ncell).fill(NaN);
  const vn = new Float32Array(ncell).fill(NaN);
  const speed = new Float32Array(ncell).fill(NaN);
  const vals = [], wts = [];
  let sum = 0, sw = 0;
  for (let c = 0; c < ncell; c++) {
    const s = slope[c], gx = gradX[c], gy = gradY[c];
    if (s !== s || gx !== gx) continue; // gradY is NaN exactly when gradX is
    const g = Math.hypot(gx, gy);
    const den = Math.max(g, finite(floor) ? floor : 0);
    if (!(den > 0)) continue; // a perfectly flat field has no isolines to move
    const k = -s / (den * den);
    u[c] = k * gx;
    vn[c] = k * gy;
    const sp = (Math.abs(s) * g) / (den * den);
    speed[c] = sp;
    vals.push(sp);
    wts.push(areas[c]);
    sum += areas[c] * sp;
    sw += areas[c];
  }
  const [medianSpeed, p98] = weightedQuantiles(vals, wts, [0.5, 0.98]);
  const cap = finite(opts.cap) && opts.cap > 0 ? opts.cap : p98;
  return {
    years: base.years,
    slope: base.slope,
    p: base.p,
    clim: base.clim,
    gradX,
    gradY,
    u,
    v: vn,
    speed,
    cap,
    grid,
    units: v.entry.units ?? "",
    medianSpeed,
    meanSpeed: sw > 0 ? sum / sw : NaN,
    // Extras beyond the spec.
    gradFloor: floor,
    speedUnits: "km/yr",
  };
}

/**
 * Summary of a velocityField inside a region (null = everywhere).
 *
 * @param field   velocityField result
 * @param region  { latMin, latMax, lonMin, lonMax } or null
 * @param opts    { mask: Uint8Array per cell (1 = keep), e.g. a land mask }
 * @returns { medianKmPerDecade, meanKmPerDecade, bearingDeg, bearingName, cells,
 *            meanVectorKmPerDecade, coherence }
 *   Medians and means are area-weighted over cells with a velocity. bearingDeg
 *   is the direction of the area-weighted mean vector (0 = north, 90 = east).
 *   coherence = |mean vector| / mean speed, from 0 (directions cancel out, so
 *   the bearing means little) to 1 (everything moves the same way).
 */
/**
 * Climate velocity through time: the same quantity as velocityField, but
 * computed in a moving window (default 15 years) centred on every year, so
 * the arrows' direction and length change as the loop plays. The window is
 * shifted, not shrunk, at the ends of the record so every frame uses the
 * same number of years. The gradient floor is fixed from the full record so
 * frames are comparable.
 *
 * @returns { years (window centres), frames: [{ u, v, speed, slope }], window,
 *            cap (98th percentile of speed over all frames), medianSpeed, grid }
 */
export function velocitySeries(v, months, opts = {}) {
  const win = Math.max(5, Math.round(opts.window ?? 15)) | 1;
  const key = `${monthsKey(months)}|win${win}`;
  return remember(cacheOf(v).velocity, key, () => {
    const grid = v.entry.grid;
    const { nlat, nlon } = grid;
    const ncell = nlat * nlon;
    const wrap = isFullCircle(grid);
    const { years, fields } = annualFields(v, months);
    const ny = years.length;
    const base = velocityBase(v, months, true);
    const floor = 0.1 * base.medianGrad;
    const areas = base.areas;
    const n = Math.min(win, ny);
    const half = (n - 1) / 2;
    const frames = [];
    const allSpeeds = [], allW = [];
    const sumY = new Float64Array(ncell), sumXY = new Float64Array(ncell), cnt = new Float64Array(ncell);
    const sumX = new Float64Array(ncell), sumXX = new Float64Array(ncell);
    for (let y = 0; y < ny; y++) {
      let a = Math.round(y - half);
      a = Math.max(0, Math.min(ny - n, a));
      const b = a + n - 1;
      sumY.fill(0); sumXY.fill(0); cnt.fill(0); sumX.fill(0); sumXX.fill(0);
      for (let k = a; k <= b; k++) {
        const x = k - a, off = k * ncell;
        for (let c = 0; c < ncell; c++) {
          const val = fields[off + c];
          if (val !== val) continue;
          cnt[c]++; sumX[c] += x; sumXX[c] += x * x; sumY[c] += val; sumXY[c] += x * val;
        }
      }
      const slope = new Float32Array(ncell).fill(NaN);
      const mean = new Float32Array(ncell).fill(NaN);
      for (let c = 0; c < ncell; c++) {
        const m = cnt[c];
        if (m < Math.max(5, n * 0.7)) continue;
        const sxx = sumXX[c] - (sumX[c] * sumX[c]) / m;
        if (!(sxx > 0)) continue;
        slope[c] = (sumXY[c] - (sumX[c] * sumY[c]) / m) / sxx;
        mean[c] = sumY[c] / m;
      }
      const clim = smooth3x3(mean, nlat, nlon, wrap);
      const { gradX, gradY } = gradient(clim, grid);
      const u = new Float32Array(ncell).fill(NaN), vn = new Float32Array(ncell).fill(NaN), speed = new Float32Array(ncell).fill(NaN);
      for (let c = 0; c < ncell; c++) {
        const s = slope[c], gx = gradX[c], gy = gradY[c];
        if (s !== s || gx !== gx) continue;
        const g = Math.hypot(gx, gy);
        const den = Math.max(g, floor);
        if (!(den > 0)) continue;
        const kk = -s / (den * den);
        u[c] = kk * gx; vn[c] = kk * gy;
        speed[c] = (Math.abs(s) * g) / (den * den);
        if (y % 3 === 0) { allSpeeds.push(speed[c]); allW.push(areas[c]); }
      }
      frames.push({ u, v: vn, speed, slope, window: [years[a], years[b]] });
    }
    const [medianSpeed, p98] = weightedQuantiles(allSpeeds, allW, [0.5, 0.98]);
    return { years: years.slice(), frames, window: n, cap: p98, medianSpeed, grid, units: v.entry.units ?? "" };
  }, 8);
}

export function velocitySummary(field, region, opts = {}) {
  const grid = field.grid;
  const ncell = grid.nlat * grid.nlon;
  const mask = opts.mask ?? null;
  if (mask && mask.length !== ncell) throw new Error("velocitySummary: mask does not match the field's grid");
  const { cells } = regionCells(grid, region ?? null);
  const w = cellWeights(grid, cells);
  const vals = [], wts = [];
  let su = 0, sv = 0, ss = 0, sw = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    if (mask && !mask[c]) continue;
    const s = field.speed[c], uu = field.u[c], vv = field.v[c];
    if (!(s === s && uu === uu && vv === vv)) continue;
    const a = w[k];
    vals.push(s); wts.push(a);
    su += a * uu; sv += a * vv; ss += a * s; sw += a;
  }
  if (!vals.length) {
    return { medianKmPerDecade: NaN, meanKmPerDecade: NaN, bearingDeg: NaN, bearingName: "", cells: 0, meanVectorKmPerDecade: NaN, coherence: NaN };
  }
  const [median] = weightedQuantiles(vals, wts, [0.5]);
  const mu = su / sw, mv = sv / sw, mean = ss / sw;
  const mag = Math.hypot(mu, mv);
  const bearingDeg = mag > 0 ? (Math.atan2(mu, mv) / RAD + 360) % 360 : NaN;
  return {
    medianKmPerDecade: median * 10,
    meanKmPerDecade: mean * 10,
    bearingDeg,
    bearingName: bearingName(bearingDeg),
    cells: vals.length,
    meanVectorKmPerDecade: mag * 10,
    coherence: mean > 0 ? mag / mean : NaN,
  };
}

// ---------------------------------------------------------------------------
// 2. Detection horizon (Weatherhead et al. 1998, JGR 103(D14), 17149-17161)
//
// Weatherhead's formula n* = [(3.3 sigma / |omega|) sqrt((1+phi)/(1-phi))]^(2/3)
// is written for MONTHLY data: it rests on sd(slope) ~ sigma / n^1.5, which
// holds for 12 points a year. Our inputs are annual means (one point a year),
// where sd(slope) ~ sqrt(12) sigma / n^1.5. So sigma is multiplied by
// sqrt(12 / perYear), perYear = 1 by default. Without that factor the formula
// promises detection about 2.3 times too early: in a simulation, a trend was
// detected only about 12% of the time at that n* instead of the intended 90%
// (see analysis.test.mjs). perYear: 12 reproduces the literal formula.

/**
 * Years of data needed to detect the current trend (90% chance at the 5% level).
 *
 * @param annual  { years, values } (NaN skipped), e.g. from engine annualMeans
 * @param opts    { perYear (default 1, see above), k (default 3.3), maxYears (default 300) }
 * @returns { nStar, nLow, nHigh, nYears, firstYear, lastYear, etaYear, etaLow, etaHigh,
 *            progress, sigma, phi, slope, status, reason }
 *   sigma: residual standard deviation around the OLS line (n - 2 dof).
 *   phi: lag-1 autocorrelation of the residuals, clamped to [-0.9, 0.95].
 *   [nLow, nHigh] = n* x exp(-/+B), B = 4/(3 sqrt(n*)) sqrt((1+phi)/(1-phi)).
 *   etaYear = firstYear + ceil(nStar) - 1 (and the same for etaLow / etaHigh).
 *   progress = nYears / nStar.
 *   status: "detectable" (nYears >= nStar), "pending", or "never" (no trend,
 *   too few years, or nStar > maxYears). reason: null, "no-data", "no-trend"
 *   or "too-small" says why.
 */
export function detectionHorizon(annual, opts = {}) {
  const k = finite(opts.k) ? opts.k : 3.3;
  const perYear = finite(opts.perYear) && opts.perYear > 0 ? opts.perYear : 1;
  const maxYears = finite(opts.maxYears) ? opts.maxYears : 300;
  const fit = olsFit(annual?.years ?? [], annual?.values ?? []);
  const n = fit.n;
  const out = {
    nStar: NaN, nLow: NaN, nHigh: NaN,
    nYears: n,
    firstYear: n ? fit.x[0] : NaN,
    lastYear: n ? fit.x[n - 1] : NaN,
    etaYear: NaN, etaLow: NaN, etaHigh: NaN,
    progress: NaN,
    sigma: fit.sigma,
    phi: NaN,
    slope: fit.slope,
    status: "never",
    reason: "no-data",
  };
  if (n < MIN_YEARS || !finite(fit.slope)) return out;

  // Lag-1 autocorrelation of the residuals, from consecutive years only.
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += fit.resid[i] ** 2;
    if (i + 1 < n && fit.x[i + 1] - fit.x[i] === 1) num += fit.resid[i] * fit.resid[i + 1];
  }
  const phi = clamp(den > 0 ? num / den : 0, -0.9, 0.95);
  out.phi = phi;

  const omega = Math.abs(fit.slope);
  if (!(omega > 0)) {
    out.nStar = Infinity;
    out.reason = "no-trend";
    return out;
  }
  const ar = Math.sqrt((1 + phi) / (1 - phi));
  const nStar = ((k * fit.sigma * Math.sqrt(12 / perYear)) / omega * ar) ** (2 / 3);
  const B = nStar > 0 ? (4 / (3 * Math.sqrt(nStar))) * ar : 0;
  const eta = (m) => out.firstYear + Math.max(1, Math.ceil(m)) - 1;
  out.nStar = nStar;
  out.nLow = nStar * Math.exp(-B);
  out.nHigh = nStar * Math.exp(B);
  out.etaYear = eta(nStar);
  out.etaLow = eta(out.nLow);
  out.etaHigh = eta(out.nHigh);
  out.progress = nStar > 0 ? n / nStar : Infinity;
  if (!(nStar <= maxYears)) {
    out.status = "never";
    out.reason = "too-small";
  } else {
    out.status = n >= nStar ? "detectable" : "pending";
    out.reason = null;
  }
  return out;
}

/**
 * One plain-English line for a detectionHorizon result.
 *
 * @param h      detectionHorizon result
 * @param units  the variable's units (used in the "never" line)
 * @param level  optional verdict level ("significant" | "suggestive" | "none").
 *               If omitted, h.verdictLevel is used when present (lineup sets
 *               it), so the line never contradicts the verdict card.
 */
export function detectionSentence(h, units, level) {
  if (!h || h.reason === "no-data" || !(h.nYears >= MIN_YEARS)) {
    return "There are not enough years with data yet to say how long a trend would take to show up.";
  }
  const lvl = level ?? h.verdictLevel;
  if (h.status === "never") {
    if (h.reason === "no-trend") return "There is no change to detect here: the trend line is flat.";
    return `The change (about ${amountText(h.slope * 10, units)} per decade) is too small compared with the noise ` +
      `(about ${amountText(h.sigma, units)} from year to year) to expect a detection in this century.`;
  }
  if (h.status === "detectable") {
    if (lvl && lvl !== "significant") {
      return "This record is long enough to catch a trend this size, but the two tests do not fully agree yet, so treat it as a hint.";
    }
    return "Long enough: this record already has the years needed to detect a trend this size.";
  }
  // pending
  if (lvl === "significant") {
    return `Already visible in this record, sooner than the roughly ${Math.round(h.nStar)} years a trend this size usually needs.`;
  }
  const more = Math.max(1, h.etaYear - h.lastYear);
  return `At this rate and noise, about ${more} more year${more === 1 ? "" : "s"} of data (around ${h.etaYear}) should be enough to call it.`;
}

// ---------------------------------------------------------------------------
// 3. Climate twins: "Where did your hometown's climate go?" (climate analogs)

const COMPASS = [
  "north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest",
];

/** 16-point compass name for a bearing in degrees (0 = north). "" if not finite. */
export function bearingName(deg) {
  if (!finite(deg)) return "";
  return COMPASS[((Math.round(deg / 22.5) % 16) + 16) % 16];
}

/**
 * Great-circle distance (km, haversine) and initial bearing from point 1 to
 * point 2 (degrees, 0 = north, 90 = east, in [0, 360)).
 */
export function greatCircle(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const distKm = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const bearingDeg = distKm > 0 ? (Math.atan2(y, x) / RAD + 360) % 360 : 0;
  return { distKm, bearingDeg };
}

/** Point reached from (lat, lon) after distKm along bearingDeg. Returns [lat, lon]. */
export function destination(lat, lon, bearingDeg, distKm) {
  const d = distKm / EARTH_RADIUS_KM, b = bearingDeg * RAD, p1 = lat * RAD;
  const p2 = Math.asin(clamp(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b), -1, 1));
  const l2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, normLon(l2 / RAD)];
}

/**
 * Land mask from a land-only Var (use soilwet): 1 where the Var has any valid
 * value in the first 24 months. MERRA-2's land fields leave out the ice
 * sheets (Greenland, Antarctica), so those count as not land.
 */
export function landMaskFrom(v) {
  const { nlat, nlon } = v.entry.grid;
  const ncell = nlat * nlon;
  const mask = new Uint8Array(ncell);
  const nt = Math.min(24, v.entry.nt);
  for (let t = 0; t < nt; t++) {
    const base = t * ncell;
    for (let c = 0; c < ncell; c++) if (v.data[base + c] !== MISSING) mask[c] = 1;
  }
  return mask;
}

// Per-cell monthly climatology over the years [y0, y1]: Float32Array of
// 12 * ncell, month m (1..12) at (m - 1) * ncell + c, NaN with no data.
function monthlyClimatology(v, [y0, y1]) {
  const { entry, data } = v;
  const ncell = entry.grid.nlat * entry.grid.nlon;
  const scale = entry.scale ?? 1, offset = entry.offset ?? 0;
  const sy = Number(entry.start.slice(0, 4)), sm = Number(entry.start.slice(5, 7));
  const sum = new Float64Array(12 * ncell);
  const cnt = new Uint16Array(12 * ncell);
  for (let year = y0; year <= y1; year++) {
    for (let m = 1; m <= 12; m++) {
      const t = (year - sy) * 12 + (m - sm);
      if (t < 0 || t >= entry.nt) continue;
      const base = t * ncell, out = (m - 1) * ncell;
      for (let c = 0; c < ncell; c++) {
        const raw = data[base + c];
        if (raw !== MISSING) { sum[out + c] += raw; cnt[out + c]++; }
      }
    }
  }
  const mon = new Float32Array(12 * ncell);
  for (let k = 0; k < mon.length; k++) mon[k] = cnt[k] ? (sum[k] / cnt[k]) * scale + offset : NaN;
  return mon;
}

// Temperature part of the fingerprint: mean of the 12 monthly climatologies
// and their range (warmest minus coldest month). Cached per Var and period.
function tempStats(v, period) {
  return remember(cacheOf(v).temp, period.join("-"), () => {
    const ncell = v.entry.grid.nlat * v.entry.grid.nlon;
    const mon = monthlyClimatology(v, period);
    const tMean = new Float32Array(ncell).fill(NaN);
    const tRange = new Float32Array(ncell).fill(NaN);
    for (let c = 0; c < ncell; c++) {
      let s = 0, lo = Infinity, hi = -Infinity, ok = true;
      for (let m = 0; m < 12; m++) {
        const x = mon[m * ncell + c];
        if (x !== x) { ok = false; break; }
        s += x;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (ok) { tMean[c] = s / 12; tRange[c] = hi - lo; }
    }
    return { tMean, tRange };
  }, 8);
}

// Precipitation part: mean rate (mm/day) and log(P + 0.1). Cached per Var and period.
function precipStats(v, period) {
  return remember(cacheOf(v).precip, period.join("-"), () => {
    const ncell = v.entry.grid.nlat * v.entry.grid.nlon;
    const mon = monthlyClimatology(v, period);
    const pMean = new Float32Array(ncell).fill(NaN);
    const logP = new Float32Array(ncell).fill(NaN);
    for (let c = 0; c < ncell; c++) {
      let s = 0, ok = true;
      for (let m = 0; m < 12; m++) {
        const x = mon[m * ncell + c];
        if (x !== x) { ok = false; break; }
        s += x;
      }
      if (ok) {
        const p = Math.max(0, s / 12);
        pMean[c] = p;
        logP[c] = Math.log(p + 0.1);
      }
    }
    return { pMean, logP };
  }, 8);
}

function fingerprints(t2m, precip, period) {
  return { ...tempStats(t2m, period), ...precipStats(precip, period) };
}

// Cell centres as lat/lon and unit vectors, once per grid object.
const geoCache = new WeakMap();
function cellGeometry(grid) {
  let g = geoCache.get(grid);
  if (g) return g;
  const { nlat, nlon } = grid;
  const n = nlat * nlon;
  g = { lat: new Float64Array(n), lon: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
  for (let i = 0; i < nlat; i++) {
    const la = latOf(grid, i);
    for (let j = 0; j < nlon; j++) {
      const c = i * nlon + j, lo = lonOf(grid, j);
      g.lat[c] = la; g.lon[c] = lo;
      g.x[c] = Math.cos(la * RAD) * Math.cos(lo * RAD);
      g.y[c] = Math.cos(la * RAD) * Math.sin(lo * RAD);
      g.z[c] = Math.sin(la * RAD);
    }
  }
  geoCache.set(grid, g);
  return g;
}

// Bilinear interpolation of the fingerprint at (lat, lon). Corners without
// data are skipped and the weights renormalised. With a land mask, only land
// corners are used when there is at least one (a hometown is on land, and a
// coarse coastal cell can be mostly sea).
function interpolateFingerprint(fp, grid, lat, lon, landMask) {
  const { nlat, nlon, lat0, lon0, dlat, dlon } = grid;
  const wrap = isFullCircle(grid);
  const fi = clamp((lat - lat0) / dlat, 0, nlat - 1);
  const i0 = Math.min(Math.floor(fi), Math.max(0, nlat - 2));
  const i1 = Math.min(i0 + 1, nlat - 1);
  const ti = fi - i0;
  let fj = ((((lon - lon0) % 360) + 360) % 360) / dlon;
  if (!wrap) fj = clamp(fj, 0, nlon - 1);
  let j0 = Math.floor(fj);
  const tj = fj - j0;
  let j1 = j0 + 1;
  if (wrap) { j0 %= nlon; j1 %= nlon; } else { j0 = Math.min(j0, nlon - 1); j1 = Math.min(j1, nlon - 1); }
  const corners = [
    [i0 * nlon + j0, (1 - ti) * (1 - tj)],
    [i0 * nlon + j1, (1 - ti) * tj],
    [i1 * nlon + j0, ti * (1 - tj)],
    [i1 * nlon + j1, ti * tj],
  ];
  const valid = ([c]) => finite(fp.tMean[c]) && finite(fp.tRange[c]) && finite(fp.pMean[c]);
  let use = corners.filter(valid);
  if (landMask) {
    const land = use.filter(([c]) => landMask[c]);
    if (land.length) use = land;
  }
  let sw = 0, t = 0, r = 0, p = 0;
  for (const [c, w0] of use) {
    // Tiny floor: when home sits exactly on a cell centre whose data is
    // unusable, the zero-weight corners still give an answer.
    const w = w0 + 1e-12;
    sw += w; t += w * fp.tMean[c]; r += w * fp.tRange[c]; p += w * fp.pMean[c];
  }
  if (!(sw > 0)) return { tMean: NaN, tRange: NaN, pMean: NaN, logP: NaN };
  const pMean = p / sw;
  return { tMean: t / sw, tRange: r / sw, pMean, logP: Math.log(pMean + 0.1) };
}

function qualityOf(d) {
  return d < 0.5 ? "good" : d < 1.2 ? "fair" : "poor";
}

// Best-matching place for `target` among the candidate cells' fingerprints:
// the soft-min weighted centroid of the best K cells that lie within
// clusterKm of the single best cell. Without that limit, two good matches far
// apart (northern Greece and Spain for Madrid) average to a point in the sea
// between them.
function findAnalog(target, fp, cand, geo, home, K, soft, scales, clusterKm) {
  const none = {
    lat: NaN, lon: NaN, distKm: NaN, bearingDeg: NaN, bearingName: "", climateDistance: NaN,
    quality: "poor", found: false, bestDistance: NaN, spreadKm: NaN, climate: { tMean: NaN, tRange: NaN, pMean: NaN },
  };
  if (!(finite(target.tMean) && finite(target.tRange) && finite(target.logP))) return none;
  // Pass 1: climate distance of every candidate, and the single best cell.
  const dist = new Float64Array(cand.length).fill(NaN);
  let best = -1;
  for (let k = 0; k < cand.length; k++) {
    const c = cand[k];
    const a = (fp.tMean[c] - target.tMean) / scales.tMean;
    const b = (fp.tRange[c] - target.tRange) / scales.tRange;
    const e = (fp.logP[c] - target.logP) / scales.logP;
    const d = Math.sqrt(a * a + b * b + e * e);
    dist[k] = d;
    if (d === d && (best < 0 || d < dist[best])) best = k;
  }
  if (best < 0) return none;
  // Pass 2: the best K cells near the best one.
  const cb = cand[best];
  const top = []; // { c, d } ascending by d, at most K long
  for (let k = 0; k < cand.length; k++) {
    const d = dist[k];
    if (d !== d || (top.length === K && d >= top[K - 1].d)) continue;
    const c = cand[k];
    if (k !== best && greatCircle(geo.lat[cb], geo.lon[cb], geo.lat[c], geo.lon[c]).distKm > clusterKm) continue;
    let i = top.length;
    while (i > 0 && top[i - 1].d > d) i--;
    top.splice(i, 0, { c, d });
    if (top.length > K) top.pop();
  }

  // Soft-min weights on the distance relative to the best cell,
  // exp(-(d - dBest)^2 / (2 soft^2)): the best cell has weight 1 and one that
  // is 0.25 worse has 0.61, however good or poor the best match is. (Plain
  // exp(-d^2 / ...) snaps to a single cell whenever all matches are poor.)
  // The location is the weighted mean of unit vectors.
  const d0 = top[0].d;
  let sw = 0, sx = 0, sy = 0, sz = 0, sd = 0, sT = 0, sR = 0, sP = 0;
  for (const t of top) {
    const { c, d } = t;
    const w = Math.exp(-((d - d0) ** 2) / (2 * soft * soft));
    t.w = w;
    sw += w;
    sx += w * geo.x[c]; sy += w * geo.y[c]; sz += w * geo.z[c];
    sd += w * d;
    sT += w * fp.tMean[c]; sR += w * fp.tRange[c]; sP += w * fp.pMean[c];
  }
  const norm = Math.hypot(sx, sy, sz);
  const lat = norm > 1e-12 ? Math.asin(clamp(sz / norm, -1, 1)) / RAD : geo.lat[top[0].c];
  const lon = norm > 1e-12 ? normLon(Math.atan2(sy, sx) / RAD) : geo.lon[top[0].c];
  const { distKm, bearingDeg } = greatCircle(home.lat, home.lon, lat, lon);
  const climateDistance = sd / sw;
  // How far the weighted cells sit from the answer. Large means the good
  // matches are in separate places and the centroid lies between them.
  let spread = 0;
  for (const { c, w } of top) spread += w * greatCircle(lat, lon, geo.lat[c], geo.lon[c]).distKm;
  return {
    lat, lon, distKm, bearingDeg, bearingName: bearingName(bearingDeg),
    climateDistance, quality: qualityOf(climateDistance),
    found: true,
    bestDistance: d0,
    spreadKm: spread / sw,
    climate: { tMean: sT / sw, tRange: sR / sw, pMean: sP / sw },
  };
}

/**
 * Climate twins: where home's base-period climate lives today (thenNow), and
 * where home's recent climate used to live (nowWas).
 *
 * Fingerprint per cell and period: mean annual temperature (°C), seasonal
 * range (warmest minus coldest calendar-month mean, °C) and ln(P + 0.1) with
 * P the mean precipitation (mm/day). Climate distance:
 *   sqrt((dT / 1.0)^2 + (dRange / 2.0)^2 + (dlnP / 0.15)^2)
 * The home fingerprint is bilinearly interpolated at (lat, lon).
 *
 * @param vars  { t2m, precip } engine Vars on the same grid
 * @param opts  { base: [1980, 1989], recent: [2016, 2025], radiusKm: 2500,
 *                landMask (Uint8Array, 1 = land; restricts the search and the
 *                home interpolation to land), scales: { tMean: 1, tRange: 2, logP: 0.15 },
 *                best: 6, softness: 0.25,
 *                clusterKm: 750 (only cells this close to the single best cell
 *                are averaged; Infinity = plain best 6) }
 * @returns { home: { lat, lon, then: { tMean, tRange, pMean }, now: {...},
 *                    drift: { dT, dRange, dPpct } },
 *            thenNow: { lat, lon, distKm, bearingDeg, bearingName, climateDistance,
 *                       quality: "good" | "fair" | "poor", found, bestDistance, spreadKm, climate },
 *            nowWas: { ...same }, periods: { base, recent } }
 *   The answer is the soft-min centroid of the best 6 cells within clusterKm
 *   of the best one, weighted exp(-(d - dBest)^2 / (2 x 0.25^2)), so it moves
 *   smoothly. climateDistance
 *   is the weighted mean distance of those cells (quality: < 0.5 good,
 *   < 1.2 fair, else poor); bestDistance the single best cell; spreadKm how
 *   far those cells sit from the answer; climate the matched fingerprint.
 *   With no candidate cell (all sea within the radius, say) found is false.
 */
export function climateTwin(vars, lat, lon, opts = {}) {
  const t2m = vars?.t2m, precip = vars?.precip;
  if (!t2m?.entry || !precip?.entry) throw new TypeError("climateTwin needs vars.t2m and vars.precip");
  const grid = t2m.entry.grid, pg = precip.entry.grid;
  if (grid.nlat !== pg.nlat || grid.nlon !== pg.nlon || grid.lat0 !== pg.lat0 || grid.lon0 !== pg.lon0) {
    throw new Error("climateTwin: t2m and precip must be on the same grid");
  }
  const ncell = grid.nlat * grid.nlon;
  const base = opts.base ?? [1980, 1989];
  const recent = opts.recent ?? [2016, 2025];
  const scales = { tMean: 1.0, tRange: 2.0, logP: 0.15, ...(opts.scales ?? {}) };
  const radiusKm = finite(opts.radiusKm) ? opts.radiusKm : 2500;
  const K = Math.max(1, Math.round(opts.best ?? 6));
  const soft = finite(opts.softness) && opts.softness > 0 ? opts.softness : 0.25;
  const clusterKm = opts.clusterKm > 0 ? opts.clusterKm : 750;
  const landMask = opts.landMask ?? null;
  if (landMask && landMask.length !== ncell) throw new Error("climateTwin: landMask does not match the grid");

  const fpBase = fingerprints(t2m, precip, base);
  const fpRecent = fingerprints(t2m, precip, recent);
  const home = { lat: clamp(Number(lat), -90, 90), lon: normLon(Number(lon)) };
  const then = interpolateFingerprint(fpBase, grid, home.lat, home.lon, landMask);
  const now = interpolateFingerprint(fpRecent, grid, home.lat, home.lon, landMask);

  // Candidate cells: within radiusKm of home, and on land when masked.
  const geo = cellGeometry(grid);
  const cand = [];
  if (finite(home.lat) && finite(home.lon)) {
    for (let c = 0; c < ncell; c++) {
      if (landMask && !landMask[c]) continue;
      if (greatCircle(home.lat, home.lon, geo.lat[c], geo.lon[c]).distKm <= radiusKm) cand.push(c);
    }
  }

  const pick = (fp) => ({ tMean: fp.tMean, tRange: fp.tRange, pMean: fp.pMean });
  return {
    home: {
      lat: home.lat,
      lon: home.lon,
      then: pick(then),
      now: pick(now),
      drift: {
        dT: now.tMean - then.tMean,
        dRange: now.tRange - then.tRange,
        dPpct: then.pMean > 0 ? (100 * (now.pMean - then.pMean)) / then.pMean : NaN,
      },
    },
    thenNow: findAnalog(then, fpRecent, cand, geo, home, K, soft, scales, clusterKm),
    nowWas: findAnalog(now, fpBase, cand, geo, home, K, soft, scales, clusterKm),
    periods: { base: [...base], recent: [...recent] },
  };
}

// ---------------------------------------------------------------------------
// 4. Suspect lineup: every variable's trend in one region

const LEVEL_RANK = { significant: 0, suggestive: 1, none: 2 };

/**
 * For each Var: regionSeries -> deseasonalize -> annualMeans(months) ->
 * linearTrend, mannKendall, verdict, plus tStat (slope / standard error) and
 * detectionHorizon. Sorted by evidence: significant, then suggestive, then
 * none, then |tStat| descending. A Var with no data in the region (sea ice
 * south of 50°N, land variables over open ocean) has empty: true and comes last.
 *
 * negligible: true marks a Var that is essentially absent in the region: its
 * regional mean size is below one storage step of the file (entry.scale),
 * like snow over the Amazon (about 0.00001 kg/m² against a step of 0.037).
 * Its "trend" is rounding noise from a cell or two, so it sorts after every
 * other non-empty Var, whatever its verdict says.
 *
 * @param varsById  { id: Var } or Map(id -> Var)
 * @param region    { latMin, latMax, lonMin, lonMax } or null for everywhere
 * @param months    optional month filter
 * @returns [{ id, units, annual, trend, mk, verdict, tStat, detection, empty, negligible }]
 *   annual holds anomalies (the seasonal cycle removed), ready for a sparkline.
 *   detection.verdictLevel is set so detectionSentence agrees with the verdict.
 */
export function lineup(varsById, region, months) {
  const entries = varsById instanceof Map ? [...varsById.entries()] : Object.entries(varsById ?? {});
  const rows = [];
  for (const [id, v] of entries) {
    if (!v?.entry) continue;
    const units = v.entry.units ?? "";
    const raw = seriesOf(v, region);
    const anomalies = remember(cacheOf(v).series, "anom:" + regionKey(region), () => deseasonalize(raw), 48);
    const annual = annualMeans(anomalies, months);
    let nFinite = 0;
    for (const x of annual.values) if (finite(x)) nFinite++;
    let sumAbs = 0, nRaw = 0;
    for (const x of raw.values) if (finite(x)) { sumAbs += Math.abs(x); nRaw++; }
    const step = Math.abs(v.entry.scale ?? 0);
    const negligible = nRaw > 0 && step > 0 && sumAbs / nRaw < step;
    const trend = linearTrend(annual);
    const mk = mannKendall(annual);
    const vd = verdict(trend, mk, units);
    const fit = olsFit(annual.years, annual.values);
    let tStat = NaN;
    if (finite(fit.slope)) tStat = fit.se > 0 ? fit.slope / fit.se : fit.slope === 0 ? 0 : Math.sign(fit.slope) * Infinity;
    const detection = detectionHorizon(annual);
    detection.verdictLevel = vd.level;
    rows.push({ id, units, annual, trend, mk, verdict: vd, tStat, detection, empty: nFinite === 0, negligible });
  }
  const absT = (r) => (Number.isNaN(r.tStat) ? 0 : Math.abs(r.tStat));
  rows.sort((a, b) =>
    (a.empty - b.empty) ||
    (a.negligible - b.negligible) ||
    ((LEVEL_RANK[a.verdict.level] ?? 3) - (LEVEL_RANK[b.verdict.level] ?? 3)) ||
    (absT(b) - absT(a) || 0));
  return rows;
}

// ---------------------------------------------------------------------------
// 5. Dipole: one moving zone, two opposite local trends

function earlyLateWindows(years, window) {
  const ny = years.length;
  const w = Math.max(1, Math.min(Math.round(finite(window) ? window : 10), Math.floor(ny / 2)));
  return { w, early: [years[0], years[w - 1]], late: [years[ny - w], years[ny - 1]] };
}

function groupStats(mask, slope, p, areas, nlon) {
  let cells = 0, areaKm2 = 0, sw = 0, sm = 0, sp = 0, swp = 0;
  for (let c = 0; c < mask.length; c++) {
    if (!mask[c]) continue;
    const a = areas[Math.floor(c / nlon)];
    cells++;
    areaKm2 += a;
    const s = slope[c];
    if (s === s) { sw += a; sm += a * s; }
    const pc = p[c];
    if (pc === pc) { swp += a; if (pc < 0.05) sp += a; }
  }
  return {
    cells,
    areaKm2,
    meanPerDecade: sw > 0 ? (sm / sw) * 10 : NaN,
    fracSignificant: swp > 0 ? sp / swp : NaN,
  };
}

/**
 * Where a band (from engine bandTrack) arrived, left and stayed between the
 * first and last `window` years, and the trend of v in each of those places.
 * A cell is in the band early (late) when it is in the band in at least half
 * of those years.
 *
 * @param v       engine Var whose trend is measured (normally the band's own Var)
 * @param track   engine bandTrack result (years, mask(yearIndex), min, max)
 * @param months  month filter for trendMap (normally the band's months)
 * @param opts    { window: 10, minCells: 3, minShare: 0.2, label: plain name used in the sentence }
 * @returns { early: [y0, y1], late: [y0, y1], arrived, left, stayed (Uint8Array per cell),
 *            stats: { arrived, left, stayed } each { cells, areaKm2, meanPerDecade, fracSignificant },
 *            oppositeSigns, sentence, units, window }
 *   meanPerDecade is area-weighted, in the Var's units per decade;
 *   fracSignificant is the area share with trendMap p < 0.05.
 *   A side (arrived or left) counts only with at least minCells cells and at
 *   least minShare of the area that changed (arrived + left), so a zone that
 *   mostly grew or mostly shrank is reported as one trend. oppositeSigns is
 *   true only when both sides count and their mean trends have opposite signs.
 */
export function dipole(v, track, months, opts = {}) {
  const grid = v.entry.grid;
  const ncell = grid.nlat * grid.nlon;
  const units = v.entry.units ?? "";
  const label = opts.label ?? PLAIN[v.entry.id] ?? "the value";
  const minCells = finite(opts.minCells) ? opts.minCells : 3;
  const years = track?.years ?? [];
  const emptyStats = () => ({ cells: 0, areaKm2: 0, meanPerDecade: NaN, fracSignificant: NaN });
  const result = (sentence, extra = {}) => ({
    early: [NaN, NaN], late: [NaN, NaN],
    arrived: new Uint8Array(ncell), left: new Uint8Array(ncell), stayed: new Uint8Array(ncell),
    stats: { arrived: emptyStats(), left: emptyStats(), stayed: emptyStats() },
    oppositeSigns: false, sentence, units, ...extra,
  });
  if (years.length < 2 || typeof track?.mask !== "function") {
    return result("There are not enough years in this band to compare an early and a late period.");
  }
  if (track.mask(0).length !== ncell) {
    return result("The band and the variable are on different grids, so they cannot be compared place by place.");
  }

  const { w, early, late } = earlyLateWindows(years, opts.window);
  const ny = years.length;
  const eCount = new Uint16Array(ncell), lCount = new Uint16Array(ncell);
  for (let y = 0; y < w; y++) { const m = track.mask(y); for (let c = 0; c < ncell; c++) eCount[c] += m[c]; }
  for (let y = ny - w; y < ny; y++) { const m = track.mask(y); for (let c = 0; c < ncell; c++) lCount[c] += m[c]; }
  const arrived = new Uint8Array(ncell), left = new Uint8Array(ncell), stayed = new Uint8Array(ncell);
  for (let c = 0; c < ncell; c++) {
    const e = 2 * eCount[c] >= w, l = 2 * lCount[c] >= w;
    if (l && !e) arrived[c] = 1;
    else if (e && !l) left[c] = 1;
    else if (e && l) stayed[c] = 1;
  }

  const { slope, p } = trendOf(v, months);
  const areas = rowAreasKm2(grid);
  const stats = {
    arrived: groupStats(arrived, slope, p, areas, grid.nlon),
    left: groupStats(left, slope, p, areas, grid.nlon),
    stayed: groupStats(stayed, slope, p, areas, grid.nlon),
  };
  const A = stats.arrived, L = stats.left;
  // A side counts only if it has a few cells and at least minShare of the
  // area that changed (arrived + left). A zone that mostly grows or mostly
  // shrinks is one trend, not a dipole.
  const minShare = finite(opts.minShare) ? opts.minShare : 0.2;
  const moved = A.areaKm2 + L.areaKm2;
  const present = (s) => s.cells >= minCells && s.areaKm2 >= minShare * moved && finite(s.meanPerDecade) && s.meanPerDecade !== 0;
  const pA = present(A), pL = present(L);
  const oppositeSigns = pA && pL && Math.sign(A.meanPerDecade) !== Math.sign(L.meanPerDecade);
  const sentence = dipoleSentence({ A, L, stayed: stats.stayed, pA, pL, oppositeSigns, early, late, track, units, label, minCells });
  return { early, late, arrived, left, stayed, stats, oppositeSigns, sentence, units, window: w };
}

function areaText(km2) {
  if (km2 >= 1e6) return `${fmt(km2 / 1e6)} million km²`;
  if (km2 >= 1e3) return `${fmt(km2 / 1e3)} thousand km²`;
  return `${fmt(km2)} km²`;
}

// The dipole sentence, high-school level. It reports only what the numbers
// support: a two-sided pattern needs both sides, opposite signs and clear
// trends; a zone that mostly grew or shrank is one trend; and a side whose
// long-term trend goes the "wrong" way (the zone left, yet the value rose) is
// a decade-to-decade swing, not a steady change.
function dipoleSentence({ A, L, stayed, pA, pL, oppositeSigns, early, late, track, units, label, minCells }) {
  const min = track.min ?? null, max = track.max ?? null;
  const zone = min != null && max != null
    ? `${label} is between ${thresholdText(min, units)} and ${thresholdText(max, units)}`
    : min != null ? `${label} is ${thresholdText(min, units)} or more`
      : max != null ? `${label} is ${thresholdText(max, units)} or less` : `${label} is in the band`;
  const intro = `From ${early[0]}–${early[1]} to ${late[0]}–${late[1]}, the zone where ${zone}`;
  const dir = (s) => (s.meanPerDecade > 0 ? "up" : "down");
  const rate = (s) => `about ${amountText(s.meanPerDecade, units)} per decade`;
  const isClear = (s) => s.fracSignificant >= 0.5;
  const clarity = (s) => {
    if (!finite(s.fracSignificant)) return "";
    const pct = Math.round(100 * s.fracSignificant);
    if (pct === 0) return " (not a clear trend anywhere in that area)";
    return isClear(s) ? ` (a clear trend in ${pct}% of that area)` : ` (a clear trend in only ${pct}% of that area)`;
  };
  // Where the zone arrives, the value should rise for "min or more" and fall
  // for "max or less"; where it leaves, the opposite. 0 = no expectation.
  const expectArrive = min != null && max == null ? 1 : max != null && min == null ? -1 : 0;

  if (pA && pL && oppositeSigns) {
    const both = `${intro} moved. Where it arrived, ${label} went ${dir(A)} by ${rate(A)}${clarity(A)}; ` +
      `where it left, it went ${dir(L)} by ${rate(L)}${clarity(L)}.`;
    return isClear(A) && isClear(L)
      ? `${both} One moving zone makes two opposite local trends, and an average over the whole region would blur them together.`
      : `${both} That is the pattern a moving zone makes, but the trends are not clear everywhere yet, so treat it as a hint.`;
  }
  if (pA && pL) {
    return `${intro} moved, but ${label} went ${dir(A)} both where it arrived (${rate(A)}) and where it left (${rate(L)}). ` +
      `So this is not just a zone sliding over: the change runs the same way on both sides.`;
  }
  if (pA || pL) {
    const G = pA ? A : L, O = pA ? L : A;
    const head = pA
      ? `${intro} mostly spread into new places: it moved into ${areaText(A.areaKm2)} and left ${L.areaKm2 > 0 ? "only " + areaText(L.areaKm2) : "none"}.`
      : `${intro} mostly pulled back: it left ${areaText(L.areaKm2)} and moved into ${A.areaKm2 > 0 ? "only " + areaText(A.areaKm2) : "none"}.`;
    const expect = pA ? expectArrive : -expectArrive;
    if (expect !== 0 && Math.sign(G.meanPerDecade) !== expect) {
      return `${head} Yet over the whole record, ${label} there did not go ${expect > 0 ? "up" : "down"}: it went ${dir(G)} by ` +
        `${rate(G)}${clarity(G)}. So the difference between those two decades looks like a slow up-and-down swing, not a steady trend.`;
    }
    const where = pA ? "Where it arrived" : "Where it left";
    const hint = O.cells >= minCells && finite(O.meanPerDecade) && Math.sign(O.meanPerDecade) === -Math.sign(G.meanPerDecade) && isClear(O)
      ? ` In the small area it ${pA ? "left" : "moved into"}, ${label} went ${dir(O)} instead: a hint of a second, opposite trend, but this is mainly one trend.`
      : ` Because it hardly ${pA ? "left anywhere" : "moved anywhere new"}, this is one trend, not two opposite ones.`;
    return `${head} ${where}, ${label} went ${dir(G)} by ${rate(G)}${clarity(G)}.${hint}`;
  }
  if (stayed.cells > 0) {
    return `${intro} stayed in about the same place, so there are no places it arrived in or left to compare.`;
  }
  return `The zone where ${zone} barely appears here in ${early[0]}–${early[1]} or ${late[0]}–${late[1]}, so there is nothing to compare.`;
}

// ---------------------------------------------------------------------------
// 6. Distribution shift: early decade vs late decade

/**
 * Area-weighted histogram of per-cell annual (or seasonal) means inside the
 * region, for the first and last `window` years (all place-years of each
 * window). Both histograms share edges spanning the 1st to 99th percentile of
 * the two windows together; values beyond fall into the end bins, so each
 * histogram sums to 1.
 *
 * @param opts  { bins: 40, window: 10, anomaly: false (true subtracts each
 *                cell's own mean over all years, like the "shifting bell
 *                curve" charts; useful for big regions) }
 * @returns { edges (bins + 1), early, late (area fractions), earlyMean, lateMean,
 *            shift (lateMean - earlyMean), units, periods: { early, late }, anomaly }
 */
export function distributionShift(v, region, months, opts = {}) {
  const bins = Math.max(1, Math.round(finite(opts.bins) ? opts.bins : 40));
  const grid = v.entry.grid;
  const units = v.entry.units ?? "";
  const { years, fields, ncell } = annualFields(v, months);
  const ny = years.length;
  const emptyOut = { edges: [], early: [], late: [], earlyMean: NaN, lateMean: NaN, shift: NaN, units, periods: { early: [NaN, NaN], late: [NaN, NaN] }, anomaly: !!opts.anomaly };
  if (ny < 2) return emptyOut;
  const { w, early, late } = earlyLateWindows(years, opts.window);
  const { cells } = regionCells(grid, region ?? null);
  const wc = cellWeights(grid, cells);

  let ref = null;
  if (opts.anomaly) {
    ref = new Float64Array(cells.length).fill(NaN);
    for (let k = 0; k < cells.length; k++) {
      let s = 0, n = 0;
      for (let y = 0; y < ny; y++) {
        const x = fields[y * ncell + cells[k]];
        if (x === x) { s += x; n++; }
      }
      if (n) ref[k] = s / n;
    }
  }

  // Every valid place-year of both windows; early ones first.
  const cap = 2 * w * cells.length;
  const vals = new Float64Array(cap), wts = new Float64Array(cap);
  let n = 0;
  const take = (y0, y1) => {
    const start = n;
    for (let y = y0; y <= y1; y++) {
      for (let k = 0; k < cells.length; k++) {
        let x = fields[y * ncell + cells[k]];
        if (x !== x) continue;
        if (ref) { const r = ref[k]; if (r !== r) continue; x -= r; }
        vals[n] = x; wts[n] = wc[k]; n++;
      }
    }
    return [start, n];
  };
  const eRange = take(0, w - 1);
  const lRange = take(ny - w, ny - 1);
  if (n === 0) return { ...emptyOut, periods: { early, late } };

  let [lo, hi] = histogramQuantiles(vals, wts, n, [0.01, 0.99]);
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }
  const step = (hi - lo) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, b) => lo + b * step);
  const hist = ([a, b]) => {
    const h = new Array(bins).fill(0);
    let sw = 0, sm = 0;
    for (let k = a; k < b; k++) {
      const bin = clamp(Math.floor((vals[k] - lo) / step), 0, bins - 1);
      h[bin] += wts[k];
      sw += wts[k];
      sm += wts[k] * vals[k];
    }
    return { h: sw > 0 ? h.map((x) => x / sw) : h, mean: sw > 0 ? sm / sw : NaN };
  };
  const E = hist(eRange), L = hist(lRange);
  return {
    edges,
    early: E.h,
    late: L.h,
    earlyMean: E.mean,
    lateMean: L.mean,
    shift: L.mean - E.mean,
    units,
    periods: { early, late },
    anomaly: !!opts.anomaly,
  };
}

// ---------------------------------------------------------------------------
// 7. Seasonal cycle: base vs recent period

/**
 * Region-mean (area-weighted, engine regionSeries) climatology for each
 * calendar month, in the base and in the recent period.
 *
 * @param opts  { base: [1980, 1989], recent: [2016, 2025] }
 * @returns { months: [1..12], early: number[12], late: number[12],
 *            change: number[12] (late - early), periods: { base, recent }, units }
 */
export function seasonalCycle(v, region, opts = {}) {
  const base = opts.base ?? [1980, 1989];
  const recent = opts.recent ?? [2016, 2025];
  const s = seriesOf(v, region);
  const clim = ([y0, y1]) => {
    const sum = new Array(12).fill(0), cnt = new Array(12).fill(0);
    for (let k = 0; k < s.t.length; k++) {
      const year = Number(s.t[k].slice(0, 4)), m = Number(s.t[k].slice(5, 7));
      const x = s.values[k];
      if (year < y0 || year > y1 || !finite(x)) continue;
      sum[m - 1] += x;
      cnt[m - 1]++;
    }
    return sum.map((x, m) => (cnt[m] ? x / cnt[m] : NaN));
  };
  const early = clim(base), late = clim(recent);
  return {
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    early,
    late,
    change: late.map((x, m) => x - early[m]),
    periods: { base: [...base], recent: [...recent] },
    units: v.entry.units ?? "",
  };
}

// ---------------------------------------------------------------------------
// 8. Extrapolation with a prediction interval (the "hurricane cone")

/**
 * OLS line through (years, values) (NaN skipped) and its PREDICTION interval
 * for each future year: where a single future annual value is expected to
 * fall, mean +/- t * s * sqrt(1 + 1/n + (x - xbar)^2 / Sxx). It assumes
 * independent residuals; with year-to-year memory the true cone is a bit wider.
 *
 * @returns { years, mean, lo, hi } for lastYear+1..untilYear, plus
 *          { fitYears, fitMean } over the record and
 *          { slope (per year), intercept, sigma, n, level, ok }.
 *          With fewer than 3 points, the arrays are empty and ok is false.
 */
export function extrapolate(years, values, untilYear, level = 0.95) {
  const lvl = finite(level) && level > 0 && level < 1 ? level : 0.95;
  const fit = olsFit(years ?? [], values ?? []);
  const out = {
    years: [], mean: [], lo: [], hi: [], fitYears: [], fitMean: [],
    slope: fit.slope, intercept: NaN, sigma: fit.sigma, n: fit.n, level: lvl, ok: false,
  };
  if (!finite(fit.slope)) return out;
  const at = (x) => fit.yMean + fit.slope * (x - fit.xMean);
  for (const y of years) {
    const x = Number(y);
    if (finite(x)) { out.fitYears.push(x); out.fitMean.push(at(x)); }
  }
  const tq = tQuantile(1 - (1 - lvl) / 2, fit.n - 2);
  const last = fit.x[fit.n - 1];
  const end = Math.floor(Number(untilYear));
  for (let y = last + 1; y <= end; y++) {
    const half = tq * fit.sigma * Math.sqrt(1 + 1 / fit.n + (y - fit.xMean) ** 2 / fit.sxx);
    const m = at(y);
    out.years.push(y);
    out.mean.push(m);
    out.lo.push(m - half);
    out.hi.push(m + half);
  }
  out.intercept = fit.yMean - fit.slope * fit.xMean;
  out.ok = true;
  return out;
}
