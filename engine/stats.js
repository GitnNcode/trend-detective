// Time-series statistics: deseasonalizing, annual means, OLS trend with a
// t-test, Mann-Kendall with an autocorrelation correction, and the verdict.
// Pure functions, no DOM, no dependencies.

import { seasonPlan, monthOfIndex } from "./time.js";

// ---------------------------------------------------------------------------
// Special functions

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta function (Lentz's method).
function betacf(a, b, x) {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b).
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// Two-sided p-value for Student's t with df degrees of freedom.
export function tTwoSidedP(t, df) {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  if (df <= 0) return NaN;
  return betai(df / 2, 0.5, df / (df + t * t));
}

const tCritCache = new Map();
// Critical t such that the two-sided p equals alpha (default 0.05).
export function tCritical(df, alpha = 0.05) {
  const key = df + ":" + alpha;
  if (tCritCache.has(key)) return tCritCache.get(key);
  let lo = 0, hi = 1;
  while (tTwoSidedP(hi, df) > alpha) hi *= 2;
  for (let k = 0; k < 100; k++) {
    const mid = 0.5 * (lo + hi);
    if (tTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid;
  }
  const v = 0.5 * (lo + hi);
  tCritCache.set(key, v);
  return v;
}

// Complementary error function, fractional error below 1.2e-7.
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

// Two-sided p-value for a standard normal z.
export function zTwoSidedP(z) {
  if (Number.isNaN(z)) return NaN;
  return Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
}

// ---------------------------------------------------------------------------
// Helpers

function finitePairs(xs, ys) {
  const x = [], y = [];
  for (let k = 0; k < ys.length; k++) {
    const yk = ys[k], xk = xs[k];
    if (Number.isFinite(yk) && Number.isFinite(xk)) { x.push(xk); y.push(yk); }
  }
  return { x, y };
}

function median(arr) {
  if (arr.length === 0) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

// ---------------------------------------------------------------------------
// Series transforms

// Remove the monthly climatology (mean of each calendar month over the whole
// record). Missing months stay NaN.
export function deseasonalize(series) {
  const n = series.values.length;
  const sum = new Float64Array(13), cnt = new Float64Array(13);
  const month = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const m = Number(series.t[k].slice(5, 7));
    month[k] = m;
    const v = series.values[k];
    if (Number.isFinite(v)) { sum[m] += v; cnt[m]++; }
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const m = month[k];
    out[k] = cnt[m] > 0 ? series.values[k] - sum[m] / cnt[m] : NaN;
  }
  return { t: series.t.slice(), values: out };
}

// Annual (or seasonal) means. `months` filters calendar months; omit for all
// twelve. A season that wraps the new year (for example [12, 1, 2]) is
// labelled by the year of its January, so DJF 2001 is Dec 2000 to Feb 2001.
// A year appears only if every requested month is inside the record; its
// value is NaN if any of those months is missing.
export function annualMeans(series, months) {
  const plan = seasonPlan(months);
  const n = series.values.length;
  if (n === 0) return { years: [], values: new Float64Array(0) };
  const first = series.t[0];
  const y0 = Number(first.slice(0, 4)), m0 = Number(first.slice(5, 7));
  const acc = new Map(); // seasonYear -> [sum, nPresent, nInRecord]
  for (let k = 0; k < n; k++) {
    const { year, month } = monthOfIndex(y0, m0, k);
    if (!plan.selected[month]) continue;
    const sy = year + plan.yearShift[month];
    let a = acc.get(sy);
    if (!a) { a = [0, 0, 0]; acc.set(sy, a); }
    a[2]++;
    const v = series.values[k];
    if (Number.isFinite(v)) { a[0] += v; a[1]++; }
  }
  const years = [...acc.keys()].filter((y) => acc.get(y)[2] === plan.count).sort((a, b) => a - b);
  const values = new Float64Array(years.length);
  years.forEach((y, k) => {
    const a = acc.get(y);
    values[k] = a[1] === plan.count ? a[0] / a[1] : NaN;
  });
  return { years, values };
}

// ---------------------------------------------------------------------------
// Trend tests

// Ordinary least squares of value on year, with a t-test on the slope.
// Slope is per year. NaN values are skipped. Needs at least 3 finite points;
// otherwise slope and p are NaN.
export function linearTrend(annual) {
  const { x, y } = finitePairs(annual.years, annual.values);
  const n = x.length;
  const empty = { slope: NaN, intercept: NaN, ci95: [NaN, NaN], p: NaN, r2: NaN, n };
  if (n < 3) return empty;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += x[k]; my += y[k]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    const dx = x[k] - mx, dy = y[k] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return empty;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const rss = Math.max(0, syy - slope * sxy);
  const df = n - 2;
  const se = Math.sqrt(rss / df / sxx);
  let p;
  if (se === 0) p = slope === 0 ? 1 : 0;
  else p = tTwoSidedP(slope / se, df);
  const half = tCritical(df) * se;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, ci95: [slope - half, slope + half], p, r2, n };
}

// Mann-Kendall trend test with tie correction.
//   tau       Kendall's tau-b between year and value
//   p         two-sided p, normal approximation with continuity correction
//   pAutocorr same test with the variance inflated for lag-1 autocorrelation
//             (Yue and Wang 2004 effective sample size). The lag-1
//             autocorrelation is taken from the Sen-detrended series and only
//             inflates the variance (a negative value is treated as zero), so
//             pAutocorr >= p always.
//   senSlope  median of pairwise slopes, per year
export function mannKendall(annual) {
  const { x, y } = finitePairs(annual.years, annual.values);
  const n = x.length;
  if (n < 3) return { tau: NaN, p: NaN, pAutocorr: NaN, senSlope: NaN, n, r1: NaN };

  let s = 0;
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = y[j] - y[i];
      s += d > 0 ? 1 : d < 0 ? -1 : 0;
      const dx = x[j] - x[i];
      if (dx !== 0) slopes.push(d / dx);
    }
  }
  const senSlope = median(slopes);

  // Tie groups in the values.
  const sorted = Float64Array.from(y).sort();
  let tieTerm = 0, tiePairs = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const t = j - i + 1;
    if (t > 1) { tieTerm += t * (t - 1) * (2 * t + 5); tiePairs += (t * (t - 1)) / 2; }
    i = j + 1;
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const n0 = (n * (n - 1)) / 2;
  const tauDen = Math.sqrt(n0 * (n0 - tiePairs));
  const tau = tauDen > 0 ? s / tauDen : 0;

  const zOf = (v) => (v <= 0 ? 0 : s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0);
  const p = varS > 0 ? zTwoSidedP(zOf(varS)) : 1;

  // Lag-1 autocorrelation of the Sen-detrended series.
  let mean = 0;
  const r = new Float64Array(n);
  for (let k = 0; k < n; k++) { r[k] = y[k] - senSlope * x[k]; mean += r[k]; }
  mean /= n;
  let num = 0, den = 0;
  for (let k = 0; k < n; k++) {
    const d = r[k] - mean;
    den += d * d;
    if (k + 1 < n) num += d * (r[k + 1] - mean);
  }
  const r1 = den > 0 ? num / den : 0;
  let cf = 1;
  if (r1 > 0) {
    const rho = Math.min(r1, 0.99);
    let pow = 1;
    for (let k = 1; k < n; k++) { pow *= rho; cf += 2 * (1 - k / n) * pow; }
  }
  const pAutocorr = varS > 0 ? zTwoSidedP(zOf(varS * cf)) : 1;

  return { tau, p, pAutocorr, senSlope, n, r1 };
}

// ---------------------------------------------------------------------------
// Verdict

export const MIN_YEARS = 5;

// The significance rule used everywhere:
//   significant  both the t-test p and the autocorrelation-corrected
//                Mann-Kendall p are below 0.05
//   suggestive   exactly one of them is below 0.05, or both are below 0.10
//   none         otherwise
export function significanceLevel(pT, pMK) {
  const a = Number.isFinite(pT) ? pT : 1;
  const b = Number.isFinite(pMK) ? pMK : 1;
  if (a < 0.05 && b < 0.05) return "significant";
  if (a < 0.05 || b < 0.05 || (a < 0.1 && b < 0.1)) return "suggestive";
  return "none";
}

// Number formatting for sentences: two significant figures, no exponent
// notation for ordinary magnitudes.
export function fmt(x, sig = 2) {
  if (!Number.isFinite(x)) return "unknown";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e-4 && a < 1e6) {
    const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    return x.toFixed(Math.min(digits, 6)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return x.toExponential(sig - 1);
}

export function fmtP(p) {
  if (!Number.isFinite(p)) return "p unknown";
  if (p < 0.001) return "p < 0.001";
  return "p = " + (p < 0.01 ? p.toFixed(3) : p.toFixed(2));
}

const FRACTION_UNITS = /^(0 to 1|0-1|fraction|1|)$/i;

// Units shown in sentences. A 0-to-1 fraction is shown in percentage points.
export function displayUnits(units) {
  const u = (units ?? "").trim();
  if (FRACTION_UNITS.test(u)) return { factor: 100, label: "percentage points" };
  return { factor: 1, label: u };
}

function withUnits(x, label) {
  return label ? `${fmt(x)} ${label}` : fmt(x);
}

// Plain-language verdict built from linearTrend and mannKendall results.
// Never returns NaN text: too few years gives level "none" with a sentence
// saying so.
export function verdict(trend, mk, units) {
  const n = Math.min(trend?.n ?? 0, mk?.n ?? Infinity);
  const { factor, label } = displayUnits(units);
  const perDecade = (trend?.slope ?? NaN) * 10;
  const ci = (trend?.ci95 ?? [NaN, NaN]).map((v) => v * 10);
  const base = {
    perDecade,
    ci95PerDecade: ci,
    pT: trend?.p ?? NaN,
    pMK: mk?.pAutocorr ?? NaN,
    n,
    direction: "flat",
  };

  if (!(n >= MIN_YEARS) || !Number.isFinite(perDecade)) {
    return {
      ...base,
      level: "none",
      sentence: `There are not enough years with data to measure a trend here (found ${n}, need at least ${MIN_YEARS}).`,
    };
  }

  const level = significanceLevel(trend.p, mk.pAutocorr);
  const direction = perDecade > 0 ? "rising" : perDecade < 0 ? "falling" : "flat";
  const rate = withUnits(Math.abs(perDecade) * factor, label);
  const range = `${fmt(ci[0] * factor)} to ${fmt(ci[1] * factor)}`;
  const ps = `t-test ${fmtP(trend.p)}, Mann-Kendall ${fmtP(mk.pAutocorr)}`;
  const years = `${n} years`;

  let sentence;
  if (level === "significant") {
    sentence = `${cap(direction)} by about ${rate} per decade (95% range ${range}). ` +
      `Both tests agree this is very unlikely to be chance (${ps}, ${years}).`;
  } else if (level === "suggestive") {
    sentence = `Possibly ${direction}, by about ${rate} per decade (95% range ${range}), ` +
      `but the evidence is mixed (${ps}, ${years}). Treat this as a hint, not a finding.`;
  } else if (direction === "flat") {
    sentence = `No change detected over ${years}. A longer record may be needed to see a trend.`;
  } else {
    sentence = `No clear trend. The change of ${perDecade > 0 ? "+" : "-"}${rate} per decade ` +
      `is small compared with the ups and downs from year to year (${ps}, ${years}). ` +
      `A longer record may be needed.`;
  }
  return { ...base, level, direction, sentence };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
