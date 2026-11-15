// Per-cell annual (or seasonal) mean fields, and the per-cell trend map.
// Annual fields are cached per Var and month filter, so moving a slider that
// calls bandTrack or trendMap again does not re-read the whole file.

import { MISSING } from "./grid.js";
import { seasonPlan, parseMonth, monthOfIndex } from "./time.js";
import { tTwoSidedP, MIN_YEARS } from "./stats.js";

const cache = new WeakMap();

// Returns { years, fields: Float32Array[nYears*ncell], ncell }.
// fields[y*ncell + c] is the mean over the selected months of season-year
// years[y] at cell c, or NaN if any of those months is missing at that cell.
// Only years whose selected months all fall inside the record are included.
export function annualFields(v, months) {
  const plan = seasonPlan(months);
  let perVar = cache.get(v);
  if (!perVar) { perVar = new Map(); cache.set(v, perVar); }
  const hit = perVar.get(plan.key);
  if (hit) return hit;

  const { entry, data } = v;
  const ncell = entry.grid.nlat * entry.grid.nlon;
  const scale = entry.scale ?? 1, offset = entry.offset ?? 0;
  const { year: y0, month: m0 } = parseMonth(entry.start);

  // Which time steps feed which season year.
  const steps = new Map(); // seasonYear -> time indices
  for (let t = 0; t < entry.nt; t++) {
    const { year, month } = monthOfIndex(y0, m0, t);
    if (!plan.selected[month]) continue;
    const sy = year + plan.yearShift[month];
    if (!steps.has(sy)) steps.set(sy, []);
    steps.get(sy).push(t);
  }
  const years = [...steps.keys()].filter((y) => steps.get(y).length === plan.count).sort((a, b) => a - b);

  const fields = new Float32Array(years.length * ncell);
  const sum = new Float64Array(ncell);
  const bad = new Uint8Array(ncell);
  years.forEach((sy, y) => {
    sum.fill(0); bad.fill(0);
    const ts = steps.get(sy);
    for (const t of ts) {
      const base = t * ncell;
      for (let c = 0; c < ncell; c++) {
        const raw = data[base + c];
        if (raw === MISSING) bad[c] = 1; else sum[c] += raw;
      }
    }
    const out = y * ncell, n = ts.length;
    for (let c = 0; c < ncell; c++) fields[out + c] = bad[c] ? NaN : (sum[c] / n) * scale + offset;
  });

  const result = { years, fields, ncell };
  perVar.set(plan.key, result);
  return result;
}

// OLS slope (per year) and two-sided t-test p for every cell, on annual or
// seasonal means. Cells with fewer than MIN_YEARS valid years are NaN.
// Index is the flat cell index c = i*nlon + j.
export function trendMap(v, months) {
  const { years, fields, ncell } = annualFields(v, months);
  const ny = years.length;
  const slope = new Float32Array(ncell).fill(NaN);
  const p = new Float32Array(ncell).fill(NaN);
  const x = years.map((yr) => yr - (years[0] ?? 0));
  for (let c = 0; c < ncell; c++) {
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < ny; y++) {
      const val = fields[y * ncell + c];
      if (val === val) { n++; sx += x[y]; sy += val; }
    }
    if (n < MIN_YEARS) continue;
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let y = 0; y < ny; y++) {
      const val = fields[y * ncell + c];
      if (val !== val) continue;
      const dx = x[y] - mx, dy = val - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0) continue;
    const b = sxy / sxx;
    const rss = Math.max(0, syy - b * sxy);
    const se = Math.sqrt(rss / (n - 2) / sxx);
    slope[c] = b;
    p[c] = se === 0 ? (b === 0 ? 1 : 0) : tTwoSidedP(b / se, n - 2);
  }
  return { slope, p, years };
}
