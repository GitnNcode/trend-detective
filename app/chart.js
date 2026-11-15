// Written with Claude and reviewed by the team.
//
// chart.js: the Trend Detective chart module (Lane 3, /app).
// Vanilla ES module, Canvas 2D, no libraries, no build step. The look is a
// plain printed scientific figure (think Panoply or a NOAA report): light
// background, 1px axis box with inward ticks, flat fills, no glow, no rounded shapes.
//
//   import { createChart, drawSparkline, stripeColor } from "./chart.js";
//
//   const chart = createChart(containerEl, { height: 220 }); // appends a <canvas>
//   chart.update(spec);          // draw, or morph from the previous spec (450 ms ease-out)
//   chart.setCursor(year|null);  // playhead; cheap, never re-animates. Integer = that year,
//                                // decimal = position on the time axis (Jan = Y.0, Jul = Y.5)
//   chart.onHover(fn);           // fn(year|null, { value, x, y, fit }); returns an unsubscribe fn
//   chart.onClick(fn);           // fn(year) on click, tap, drag-scrub or Enter; returns an unsubscribe fn
//   chart.resize([height]);      // re-measure and repaint (also re-reads the CSS colours)
//   chart.destroy();
//
// spec fields
//   kind        "series" | "bars" | "stripes" | "seasonal" (default "series")
//   units       y-axis units, e.g. "°C", "m/s", "km²", "%"
//   color       colour of the data marks (default var(--chart-series))
//   format      fn(number) -> string for the hover readout. Used as-is; units are
//               appended only when the result is a bare number.
//   tickFormat  fn(number) -> string for y tick labels (default: step-aware, no units)
//   cursorYear, title (small caps, top left inside the plot), emptyText
//   series      years, values (NaN = gap), monthly { x, values }, fit, extendTo,
//               markers [{ year, label, color }], refLine { value, label }, invertY
//   bars        years, values, max, color, fit
//   stripes     years, values, palette "temp" | "wet" | "ice"
//   seasonal    months [1..12], early[12], late[12], earlyLabel, lateLabel
//
// Annual values sit at integer years on a decimal-year axis, so a monthly point
// for March 2012 sits at 2012 + 2.5 / 12 and a yearly bar or stripe spans
// [Y - 0.5, Y + 0.5].
//
// Colours come from CSS custom properties on the container, read at draw time,
// with these light-theme defaults: --chart-axis #333333 (box, ticks),
// --chart-text #333333 (tick labels), --chart-muted #666666 (units, legend,
// crosshair), --chart-grid rgba(0,0,0,0.07), --chart-series #1a1a1a,
// --chart-fit #d62728, --chart-band rgba(0,0,0,0.08), --chart-cursor #e08a00,
// --chart-early #1f77b4, --chart-late #d62728, --chart-marker #555555,
// --chart-bg-readout #ffffff, --chart-readout-border #333333,
// --chart-readout-text #111111. The canvas background is always transparent.

const TOKENS = {
  axis: ["--chart-axis", "#333333"],
  text: ["--chart-text", "#333333"],
  muted: ["--chart-muted", "#666666"],
  grid: ["--chart-grid", "rgba(0,0,0,0.07)"],
  series: ["--chart-series", "#1a1a1a"],
  fit: ["--chart-fit", "#d62728"],
  band: ["--chart-band", "rgba(0,0,0,0.08)"],
  cursor: ["--chart-cursor", "#e08a00"],
  early: ["--chart-early", "#1f77b4"],
  late: ["--chart-late", "#d62728"],
  marker: ["--chart-marker", "#555555"],
  readoutBg: ["--chart-bg-readout", "#ffffff"],
  readoutBorder: ["--chart-readout-border", "#333333"],
  readoutText: ["--chart-readout-text", "#111111"],
};
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const FONT = `11px ${SANS}`;
const TITLE_FONT = `600 10px ${SANS}`;
const MORPH_MS = 450;
const MAX_DPR = 2;
const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KINDS = new Set(["series", "bars", "stripes", "seasonal"]);

const isFin = Number.isFinite;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

function readTheme(el) {
  let cs = null;
  try { cs = el && el.isConnected ? getComputedStyle(el) : null; } catch { cs = null; }
  const th = {};
  for (const k in TOKENS) {
    const [name, fallback] = TOKENS[k];
    th[k] = (cs && cs.getPropertyValue(name).trim()) || fallback;
  }
  return th;
}

// ---------------------------------------------------------------------------
// Colour helpers

const colorCache = new Map();
let probe = null;

// Any CSS colour -> [r, g, b, a] (0-255, alpha 0-1), resolved by painting one
// pixel, so named colours, hsl(), oklch() and color-mix() all work. Null if
// the string is not a colour.
function toRGBA(css) {
  const key = String(css);
  if (colorCache.has(key)) return colorCache.get(key);
  let out = null;
  try {
    if (!probe) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      probe = c.getContext("2d", { willReadFrequently: true });
    }
    probe.fillStyle = "#010203";
    probe.fillStyle = key;
    if (probe.fillStyle !== "#010203" || /^\s*#010203\s*$/i.test(key)) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
  } catch { out = null; }
  if (colorCache.size > 256) colorCache.clear();
  colorCache.set(key, out);
  return out;
}

// The colour at a fraction of its own alpha, as an rgba() string.
function fade(css, a) {
  const c = toRGBA(css) || toRGBA(TOKENS.series[1]) || [26, 26, 26, 1];
  return `rgba(${c[0]},${c[1]},${c[2]},${+(c[3] * a).toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Number formatting

const nfCache = new Map();
function nf(d) {
  let f = nfCache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    nfCache.set(d, f);
  }
  return f;
}
const signed = (s) => (s.charAt(0) === "-" ? MINUS + s.slice(1) : s);
const trimZeros = (s) => (s.indexOf(".") < 0 || s.indexOf("e") >= 0 ? s : s.replace(/0+$/, "").replace(/\.$/, ""));
const prec3 = (x) => { const s = x.toPrecision(3); return s.indexOf("e") >= 0 ? String(Math.round(x)) : s; };

// Default value format: 2-3 significant digits, "1.2 M" from a million up,
// "1.2e-5" for tiny or enormous magnitudes, a true minus sign.
function smartFormat(v) {
  if (!isFin(v)) return "–";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a < 1e-3 || a >= 1e15) return signed(v.toExponential(1).replace("e+", "e"));
  if (a >= 1e12) return signed(trimZeros(prec3(v / 1e12))) + " T";
  if (a >= 1e9) return signed(trimZeros(prec3(v / 1e9))) + " B";
  if (a >= 999999.5) return signed(trimZeros(prec3(v / 1e6))) + " M";
  if (a >= 999.5) return signed(nf(0).format(v));
  return signed(trimZeros(prec3(v)));
}

// Decimals needed to print every multiple of a 1-2-2.5-5 step exactly.
function decimalsFor(step) {
  const e = Math.floor(Math.log10(step) + 1e-9);
  const m = step / Math.pow(10, e);
  return clamp(-e + (e <= 0 && Math.abs(m - 2.5) < 1e-6 ? 1 : 0), 0, 8);
}

// Tick label format for a given tick step: one style for the whole axis.
function tickFormatter(step, maxAbs) {
  if (!(step > 0) || !isFin(step)) return smartFormat;
  if (maxAbs >= 1e6 && maxAbs < 1e15) {
    const [div, suf] = maxAbs >= 1e12 ? [1e12, " T"] : maxAbs >= 1e9 ? [1e9, " B"] : [1e6, " M"];
    const d = decimalsFor(step / div);
    return (v) => (Math.abs(v) < step * 1e-6 ? "0" : signed(nf(d).format(v / div)) + suf);
  }
  if (maxAbs >= 1e15 || step < 1e-3) {
    const digits = clamp(Math.floor(Math.log10(maxAbs || step)) - Math.floor(Math.log10(step)), 0, 4);
    return (v) => (Math.abs(v) < step * 1e-6 ? "0" : signed(v.toExponential(digits).replace("e+", "e")));
  }
  const d = decimalsFor(step);
  return (v) => signed(nf(d).format(Math.abs(v) < step * 1e-6 ? 0 : v));
}

// Wrap a user formatter so a throwing or empty result falls back to the default.
function safeFormat(fn, fallback) {
  if (typeof fn !== "function") return fallback;
  return (v) => {
    try {
      const s = fn(v);
      return s == null || s === "" ? fallback(v) : String(s);
    } catch { return fallback(v); }
  };
}

// Join a formatted value and its units ("3.56 M km²", "45%").
function joinUnits(s, units) {
  if (!units) return s;
  return /^(%|‰|°[NSEW]?)$/.test(units) ? s + units : s + " " + units;
}

// For user formatters: add units only to a bare number. Strings that already
// carry text (such as "3 of 4 months" or "65.2°N") are left alone.
function withUnits(s, units) {
  return /^[\s\d.,+\-−eE]+$/.test(s) ? joinUnits(s, units) : s;
}

// ---------------------------------------------------------------------------
// Axis ticks

// 4 to maxCount (+1 if needed) "nice" ticks (1, 2, 2.5, 5 x 10^k) inside [lo, hi].
function niceTicks(lo, hi, maxCount = 5) {
  if (!isFin(lo) || !isFin(hi)) return { ticks: [], step: NaN };
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const e0 = Math.floor(Math.log10((hi - lo) / maxCount));
  const cands = [];
  for (let e = e0 - 1; e <= e0 + 2; e++) for (const m of [1, 2, 2.5, 5]) cands.push(m * Math.pow(10, e));
  cands.sort((a, b) => a - b);
  let prev = null;
  for (const step of cands) {
    const k0 = Math.ceil(lo / step - 1e-9), k1 = Math.floor(hi / step + 1e-9), count = k1 - k0 + 1;
    if (count <= maxCount) {
      // Prefer 4-5 ticks: if this step leaves fewer than 4, one more tick is better.
      const use = count < 4 && prev && prev.count <= maxCount + 1 ? prev : { step, k0, k1 };
      const ticks = [];
      for (let k = use.k0; k <= use.k1; k++) ticks.push(+(k * use.step).toPrecision(12));
      return { ticks, step: use.step };
    }
    prev = { step, k0, k1, count };
  }
  return { ticks: [lo, hi], step: hi - lo };
}

// Year ticks: decades when they fit, otherwise 20/50/100 or 5/2/1 years.
// Returns major tick years plus a minor step (0 for none).
function yearTicks(x0, x1, plotW) {
  const span = Math.max(1e-9, x1 - x0);
  const maxN = Math.max(2, Math.floor(plotW / 46));
  let step = 10;
  if (span / 10 > maxN) step = [20, 25, 50, 100, 200, 500, 1000].find((s) => span / s <= maxN) || 1000;
  else if (span / 10 < 1.5) step = [5, 2, 1].find((s) => span / s >= 1.5 && span / s <= maxN) || 1;
  const major = [];
  for (let y = Math.ceil(x0 / step - 1e-9) * step; y <= x1 + 1e-9; y += step) major.push(y);
  const pxPerYear = plotW / span;
  let minor = 0;
  for (const m of step >= 10 ? [1, step / 10, step / 5, step / 2] : [1]) {
    if (m < step && Number.isInteger(m) && m * pxPerYear >= 4) { minor = m; break; }
  }
  return { major, step, minor };
}

// ---------------------------------------------------------------------------
// Statistics: Student t quantile and ordinary least squares with a 95% band

// P(|T| <= t) for integer df, written with theta = atan(t / sqrt(df))
// (Abramowitz and Stegun 26.7.3 and 26.7.4). Exact.
function tAbsCdfTheta(th, df) {
  const s = Math.sin(th), c = Math.cos(th), c2 = c * c;
  let sum = 0;
  if (df % 2 === 1) {
    let term = c;
    for (let k = 1; 2 * k + 1 <= df; k++) { sum += term; term *= (c2 * (2 * k)) / (2 * k + 1); }
    return (2 / Math.PI) * (th + s * sum);
  }
  let term = 1;
  for (let k = 0; 2 * k + 2 <= df; k++) { sum += term; term *= (c2 * (2 * k + 1)) / (2 * k + 2); }
  return s * sum;
}

// Standard normal quantile, Abramowitz and Stegun 26.2.23 (|error| < 4.5e-4).
function zQuantile(p) {
  const q = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return p < 0.5 ? -z : z;
}

const tqCache = new Map();
// Quantile of Student's t: exact bisection for integer df up to 400,
// Cornish-Fisher expansion (A&S 26.7.5) beyond that, where it is accurate.
function tQuantile(p, df) {
  if (!(df > 0) || !(p > 0 && p < 1)) return NaN;
  if (p === 0.5) return 0;
  const key = p + ":" + df;
  if (tqCache.has(key)) return tqCache.get(key);
  const target = Math.abs(2 * p - 1);
  let t;
  if (Number.isInteger(df) && df <= 400) {
    let lo = 0, hi = Math.PI / 2;
    for (let i = 0; i < 64; i++) {
      const mid = 0.5 * (lo + hi);
      if (tAbsCdfTheta(mid, df) < target) lo = mid; else hi = mid;
    }
    t = Math.sqrt(df) * Math.tan(0.5 * (lo + hi));
  } else {
    const z = Math.abs(zQuantile((1 + target) / 2)), z2 = z * z;
    const g1 = (z2 * z + z) / 4;
    const g2 = (5 * z2 * z2 * z + 16 * z2 * z + 3 * z) / 96;
    const g3 = (3 * z2 * z2 * z2 * z + 19 * z2 * z2 * z + 17 * z2 * z - 15 * z) / 384;
    t = z + g1 / df + g2 / (df * df) + g3 / (df * df * df);
  }
  const out = p < 0.5 ? -t : t;
  tqCache.set(key, out);
  return out;
}

// OLS of y on x (non-finite pairs skipped). half(x) is the 95% confidence
// half-width of the mean line: t(0.975, n-2) * s * sqrt(1/n + (x - xbar)^2 / Sxx).
function fitOLS(xs, ys) {
  const N = Math.min(xs.length, ys.length);
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < N; i++) {
    if (isFin(xs[i]) && isFin(ys[i])) { n++; sx += xs[i]; sy += ys[i]; }
  }
  if (n < 2) return null;
  const xbar = sx / n, ybar = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < N; i++) {
    if (isFin(xs[i]) && isFin(ys[i])) { const dx = xs[i] - xbar; sxx += dx * dx; sxy += dx * (ys[i] - ybar); }
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx, intercept = ybar - slope * xbar;
  let rss = 0;
  for (let i = 0; i < N; i++) {
    if (isFin(xs[i]) && isFin(ys[i])) { const r = ys[i] - (intercept + slope * xs[i]); rss += r * r; }
  }
  const df = n - 2;
  const s = df > 0 ? Math.sqrt(rss / df) : NaN;
  const tc = df > 0 ? tQuantile(0.975, df) : NaN;
  return {
    n, slope, intercept, xbar, sxx, s,
    at: (x) => intercept + slope * x,
    half: (x) => (df > 0 ? tc * s * Math.sqrt(1 / n + ((x - xbar) * (x - xbar)) / sxx) : NaN),
  };
}

// ---------------------------------------------------------------------------
// Stripe palettes, listed from anomaly -1 to +1

const PALETTES = {
  // Classic warming stripes: blue (cold) -> near white -> red (warm).
  temp: ["#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#c6dbef", "#deebf7", "#f7f7f7",
    "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"],
  // Dry (brown) -> near white -> wet (teal).
  wet: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
  // Less ice (red, then dark blue) -> ocean blue -> more ice (teal, then white).
  ice: ["#9e1b32", "#6b2150", "#2b2e6e", "#1f4f8f", "#2f7fa8", "#4fb0c6", "#86d4dc", "#c4ecef", "#f2fcfd"],
};
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const PAL_RGB = {};
for (const k in PALETTES) PAL_RGB[k] = PALETTES[k].map(hexRGB);
const MISSING_RGB = [204, 204, 204];

function stripeRGB(norm, palette) {
  const stops = PAL_RGB[palette] || PAL_RGB.temp;
  if (!isFin(norm)) return MISSING_RGB.slice();
  const t = ((clamp(norm, -1, 1) + 1) / 2) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return [Math.round(lerp(a[0], b[0], f)), Math.round(lerp(a[1], b[1], f)), Math.round(lerp(a[2], b[2], f))];
}

/**
 * Colour for a normalised anomaly in one of the stripe palettes.
 * @param {number} anomalyNorm  -1..1 (clamped); NaN gives a neutral grey
 * @param {"temp"|"wet"|"ice"} [palette="temp"]  "temp": blue -> white -> red;
 *   "wet": brown -> white -> teal (wetter = teal); "ice": higher = cooler colours
 * @returns {string} "rgb(r, g, b)"
 */
export function stripeColor(anomalyNorm, palette = "temp") {
  const c = stripeRGB(+anomalyNorm, palette);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ---------------------------------------------------------------------------
// Drawing helpers

// Coordinate of a crisp line of width lw (CSS px): centred on a device pixel
// when the device width is odd, on a pixel edge when it is even.
function crisp(v, dpr, lw = 1) {
  const w = Math.max(1, Math.round(lw * dpr));
  return (w % 2 ? Math.floor(v * dpr) + 0.5 : Math.round(v * dpr)) / dpr;
}
const snapPx = (v, dpr) => Math.round(v * dpr) / dpr;

function hLine(g, x0, x1, y) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
function vLine(g, x, y0, y1) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }

// Truncate text with an ellipsis so it fits maxW (ctx font must be set).
function fitText(g, text, maxW) {
  if (maxW <= 0) return "";
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

let measureCtx = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = FONT;
  return measureCtx;
}

// ---------------------------------------------------------------------------
// Scenes. A spec becomes a scene: a data-space description of what to draw.
// Animation interpolates two scenes and layout is computed per frame, so a
// resize in the middle of a morph needs no special handling.

function numArray(a) {
  if (!a || typeof a.length !== "number") return [];
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) { const v = a[i]; out[i] = v == null || v === "" ? NaN : +v; }
  return out;
}

// Pairs with a finite x, sorted by x, duplicate x dropped (first one wins).
function pairs(xsIn, vsIn) {
  const xs = numArray(xsIn), vs = numArray(vsIn);
  const n = Math.min(xs.length, vs.length);
  let idx = [];
  for (let i = 0; i < n; i++) if (isFin(xs[i])) idx.push(i);
  let sorted = true;
  for (let k = 1; k < idx.length; k++) if (xs[idx[k]] <= xs[idx[k - 1]]) { sorted = false; break; }
  if (!sorted) {
    idx.sort((a, b) => xs[a] - xs[b] || a - b);
    idx = idx.filter((v, k) => k === 0 || xs[v] !== xs[idx[k - 1]]);
  }
  const X = new Float64Array(idx.length), V = new Float64Array(idx.length);
  idx.forEach((i, k) => { X[k] = xs[i]; V[k] = vs[i]; });
  return { x: X, v: V };
}

function extent(arr, lo = Infinity, hi = -Infinity) {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (isFin(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return [lo, hi];
}

// Exact match in an ascending array, or -1.
function indexOf(xs, x) {
  let lo = 0, hi = xs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (xs[m] === x) return m;
    if (xs[m] < x) lo = m + 1; else hi = m - 1;
  }
  return -1;
}

// Index of the nearest value in an ascending array, or -1 if empty.
function nearestIndex(xs, x) {
  const n = xs.length;
  if (!n) return -1;
  if (x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return x - xs[lo] <= xs[hi] - x ? lo : hi;
}

// Cheap content hash, so an update() with unchanged data does not re-animate.
const hashF = new Float64Array(1), hashI = new Int32Array(hashF.buffer);
function hashNums(h, arr) {
  if (!arr) return Math.imul(h ^ 0x5bd1e995, 16777619);
  for (let i = 0; i < arr.length; i++) {
    hashF[0] = arr[i];
    h = Math.imul(h ^ hashI[0], 16777619);
    h = Math.imul(h ^ hashI[1], 16777619);
  }
  return Math.imul(h ^ arr.length, 16777619);
}
function signature(sc) {
  let h = 0x811c9dc5;
  h = hashNums(h, sc.years); h = hashNums(h, sc.values);
  h = hashNums(h, sc.monthly && sc.monthly.x); h = hashNums(h, sc.monthly && sc.monthly.v);
  h = hashNums(h, sc.months); h = hashNums(h, sc.early); h = hashNums(h, sc.late);
  const meta = [sc.kind, sc.units, sc.color, sc.title, sc.emptyText, sc.invertY, sc.fit, sc.extendTo, sc.max,
    sc.palette, sc.earlyLabel, sc.lateLabel, JSON.stringify(sc.markers || null), JSON.stringify(sc.refLine || null)];
  return h + "|" + meta.join("|");
}

function buildScene(spec) {
  const s = spec && typeof spec === "object" ? spec : {};
  const kind = KINDS.has(s.kind) ? s.kind : "series";
  const units = s.units != null ? String(s.units) : "";
  const fmt = typeof s.format === "function" ? safeFormat(s.format, smartFormat) : null;
  const sc = {
    kind, units,
    color: s.color ? String(s.color) : "",
    readout: (v) => (!isFin(v) ? "no data" : fmt ? withUnits(fmt(v), units) : joinUnits(smartFormat(v), units)),
    userTick: typeof s.tickFormat === "function" ? safeFormat(s.tickFormat, smartFormat) : null,
    title: s.title ? String(s.title) : "",
    emptyText: s.emptyText ? String(s.emptyText) : "No data",
    invertY: !!s.invertY,
    empty: true,
    dom: { x0: 0, x1: 1, y0: 0, y1: 1 },
    yTicks: [], yStep: NaN, tickFmt: smartFormat, padL: 30,
  };
  if (kind === "seasonal") buildSeasonal(sc, s); else buildYearly(sc, s);
  finishAxis(sc);
  sc.sig = signature(sc);
  return sc;
}

function buildYearly(sc, s) {
  const { x: years, v: values } = pairs(s.years, s.values);
  sc.years = years;
  sc.values = values;
  if (!years.length) return;
  const first = years[0], last = years[years.length - 1];
  sc.dom = { x0: first - 0.5, x1: last + 0.5, y0: 0, y1: 1 };
  let [lo, hi] = extent(values);
  if (!(lo <= hi)) return; // all NaN: empty, but keep the year domain
  sc.empty = false;

  if (sc.kind === "series") {
    if (s.monthly && s.monthly.x) {
      const m = pairs(s.monthly.x, s.monthly.values);
      if (m.x.length) {
        sc.monthly = { x: m.x, v: m.v };
        [lo, hi] = extent(m.v, lo, hi);
        sc.dom.x0 = Math.min(sc.dom.x0, m.x[0]);
        sc.dom.x1 = Math.max(sc.dom.x1, m.x[m.x.length - 1]);
      }
    }
    sc.fit = !!s.fit;
    const ext = s.extendTo == null ? NaN : +s.extendTo;
    sc.extendTo = isFin(ext) && ext > last ? ext : null;
    if (sc.extendTo != null) sc.dom.x1 = Math.max(sc.dom.x1, sc.extendTo + 0.5);
    sc.markers = (Array.isArray(s.markers) ? s.markers : [])
      .filter((m) => m && m.year != null && isFin(+m.year))
      .map((m) => ({ year: +m.year, label: m.label != null ? String(m.label) : "", color: m.color ? String(m.color) : "", a: 1 }));
    const rl = s.refLine;
    sc.refLine = rl && rl.value != null && isFin(+rl.value)
      ? { value: +rl.value, label: rl.label != null ? String(rl.label) : "", color: rl.color ? String(rl.color) : "", a: 1 }
      : null;
    if (sc.refLine) { lo = Math.min(lo, sc.refLine.value); hi = Math.max(hi, sc.refLine.value); }
    if (sc.fit) {
      // Keep the fit and most of its band in view; a very wide future band is clipped.
      const f = fitOLS(years, values);
      if (f) {
        const span = hi - lo || Math.abs(hi) || 1;
        const ends = [first, last];
        if (sc.extendTo != null) ends.push(sc.extendTo);
        for (const x of ends) {
          const c = f.at(x), hw = f.half(x), h = isFin(hw) ? Math.min(hw, span * 0.6) : 0;
          lo = Math.min(lo, c - h);
          hi = Math.max(hi, c + h);
        }
      }
    }
    const pad = (hi - lo) * 0.07 || Math.abs(hi) * 0.1 || 1;
    sc.dom.y0 = lo - pad;
    sc.dom.y1 = hi + pad;
  } else if (sc.kind === "bars") {
    const mx = s.max == null ? NaN : +s.max;
    sc.max = isFin(mx) && mx > 0 ? mx : Math.max(hi, 0) || 1;
    sc.fit = !!s.fit;
    const y0 = Math.min(0, lo), y1 = Math.max(sc.max, hi);
    sc.dom.y0 = y0 < 0 ? y0 - (y1 - y0) * 0.05 : 0;
    sc.dom.y1 = y1 + (y1 - y0) * 0.05;
  } else {
    // Stripes: anomaly from the mean of all finite values, symmetric scale at
    // the 95th percentile of |anomaly|.
    sc.palette = PAL_RGB[s.palette] ? s.palette : "temp";
    let sum = 0, n = 0;
    for (const v of values) if (isFin(v)) { sum += v; n++; }
    const mean = sum / n;
    const abs = [];
    for (const v of values) if (isFin(v)) abs.push(Math.abs(v - mean));
    abs.sort((a, b) => a - b);
    const q = 0.95 * (abs.length - 1), qi = Math.floor(q);
    const p95 = lerp(abs[qi], abs[Math.min(qi + 1, abs.length - 1)], q - qi);
    sc.mean = mean;
    sc.scale = p95 > 0 ? p95 : 1;
    sc.rgb = new Float32Array(values.length * 3);
    sc.missing = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isFin(v)) { sc.missing[i] = 1; continue; }
      const c = stripeRGB((v - mean) / sc.scale, sc.palette);
      sc.rgb[3 * i] = c[0]; sc.rgb[3 * i + 1] = c[1]; sc.rgb[3 * i + 2] = c[2];
    }
  }
}

function buildSeasonal(sc, s) {
  const ms = numArray(s.months && s.months.length ? s.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const e = numArray(s.early), l = numArray(s.late);
  const idx = [];
  for (let i = 0; i < ms.length; i++) if (isFin(ms[i])) idx.push(i);
  idx.sort((a, b) => ms[a] - ms[b]);
  sc.months = idx.map((i) => ms[i]);
  sc.early = idx.map((i) => (isFin(e[i]) ? e[i] : NaN));
  sc.late = idx.map((i) => (isFin(l[i]) ? l[i] : NaN));
  sc.earlyLabel = s.earlyLabel != null ? String(s.earlyLabel) : "early";
  sc.lateLabel = s.lateLabel != null ? String(s.lateLabel) : "late";
  sc.dom = { x0: 0.5, x1: 12.5, y0: 0, y1: 1 };
  if (sc.months.length) {
    sc.dom.x0 = Math.min(0.5, sc.months[0] - 0.5);
    sc.dom.x1 = Math.max(12.5, sc.months[sc.months.length - 1] + 0.5);
  }
  let [lo, hi] = extent(sc.early);
  [lo, hi] = extent(sc.late, lo, hi);
  if (!(lo <= hi)) return;
  sc.empty = false;
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  sc.dom.y0 = lo - pad;
  sc.dom.y1 = hi + pad;
}

// Y ticks, their label format and the left padding they need.
function finishAxis(sc) {
  if (sc.kind === "stripes") { sc.padL = 0; return; }
  const { ticks, step } = niceTicks(sc.dom.y0, sc.dom.y1, 5);
  sc.yTicks = sc.empty ? [] : ticks;
  sc.yStep = step;
  sc.tickFmt = sc.userTick || tickFormatter(step, Math.max(Math.abs(sc.dom.y0), Math.abs(sc.dom.y1)));
  const m = measurer();
  let w = 0;
  for (const t of sc.yTicks) w = Math.max(w, m.measureText(sc.tickFmt(t)).width);
  sc.padL = Math.max(14, Math.ceil(w) + 8);
}

// ---------------------------------------------------------------------------
// Interpolation between two scenes of the same kind

function sampleAt(xs, vs, x) {
  const n = xs.length;
  if (!n) return NaN;
  if (x <= xs[0]) return vs[0];
  if (x >= xs[n - 1]) return vs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  if (xs[lo] === x) return vs[lo];
  const a = vs[lo], b = vs[hi];
  if (!isFin(a)) return b;
  if (!isFin(b)) return a;
  return a + ((b - a) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

// Values of b, each starting from a's value at the same x (or a's nearest end).
function morph(ax, av, bx, bv, e) {
  const out = new Float64Array(bv.length);
  for (let i = 0; i < bv.length; i++) {
    const v1 = bv[i];
    if (!isFin(v1)) { out[i] = NaN; continue; }
    const v0 = ax && ax.length ? sampleAt(ax, av, bx[i]) : NaN;
    out[i] = isFin(v0) ? v0 + (v1 - v0) * e : v1;
  }
  return out;
}

const sameNums = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function interpScene(a, b, e) {
  const o = Object.assign({}, b);
  o.dom = {
    x0: lerp(a.dom.x0, b.dom.x0, e), x1: lerp(a.dom.x1, b.dom.x1, e),
    y0: lerp(a.dom.y0, b.dom.y0, e), y1: lerp(a.dom.y1, b.dom.y1, e),
  };
  o.padL = lerp(a.padL, b.padL, e);
  if (!sameNums(a.yTicks, b.yTicks)) { o.oldTicks = a.yTicks; o.oldTickFmt = a.tickFmt; o.tickMix = e; }
  if (b.kind === "series" || b.kind === "bars") {
    o.values = morph(a.years, a.values, b.years, b.values, e);
    if (b.kind === "series") {
      if (b.monthly) {
        o.monthly = a.monthly
          ? { x: b.monthly.x, v: morph(a.monthly.x, a.monthly.v, b.monthly.x, b.monthly.v, e) }
          : { x: b.monthly.x, v: b.monthly.v, a: e };
      }
      o.fitA = b.fit && !a.fit ? e : 1;
      o.markers = b.markers.map((m, i) => {
        const p = a.markers && a.markers[i];
        return p ? { ...m, year: lerp(p.year, m.year, e) } : { ...m, a: e };
      });
      if (b.refLine) {
        const p = a.refLine;
        o.refLine = p ? { ...b.refLine, value: lerp(p.value, b.refLine.value, e) } : { ...b.refLine, a: e };
      }
    }
  } else if (b.kind === "stripes") {
    o.rgb = new Float32Array(b.rgb.length);
    for (let i = 0; i < b.years.length; i++) {
      const j = b.missing[i] ? -1 : indexOf(a.years, b.years[i]);
      const ok = j >= 0 && !a.missing[j];
      for (let c = 0; c < 3; c++) {
        const v1 = b.rgb[3 * i + c];
        o.rgb[3 * i + c] = ok ? lerp(a.rgb[3 * j + c], v1, e) : v1;
      }
    }
  } else {
    const pick = (av, bv) => bv.map((v, i) => (isFin(v) && isFin(av[i]) && a.months[i] === b.months[i] ? lerp(av[i], v, e) : v));
    o.early = pick(a.early, b.early);
    o.late = pick(a.late, b.late);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Layout: plot box and scales for the current canvas size

function layout(sc, W, H) {
  const stripes = sc.kind === "stripes";
  const header = stripes ? (sc.title ? 16 : 0) : sc.units || sc.kind === "seasonal" ? 17 : 8;
  const padL = stripes ? 0 : Math.round(sc.padL);
  const padR = stripes ? 0 : 8;
  const left = padL, top = header;
  const right = Math.max(left + 10, W - padR), bottom = Math.max(top + 10, H - 18);
  const w = right - left, h = bottom - top, d = sc.dom;
  const kx = w / (d.x1 - d.x0 || 1), ky = h / (d.y1 - d.y0 || 1);
  return {
    W, H, left, right, top, bottom, w, h,
    sx: (x) => left + (x - d.x0) * kx,
    ix: (px) => d.x0 + (px - left) / kx,
    sy: sc.invertY ? (v) => top + (v - d.y0) * ky : (v) => bottom - (v - d.y0) * ky,
  };
}

// ---------------------------------------------------------------------------
// Static layer (cached; redrawn on data, animation frames, resize)

function renderBase(g, sc, L, th, dpr) {
  g.font = FONT;
  g.lineCap = "butt";
  g.lineJoin = "round";
  g.setLineDash([]);
  g.globalAlpha = 1;
  if (sc.empty) {
    if (sc.kind !== "stripes") drawFrame(g, L, th, dpr);
    drawHeader(g, sc, L, th, dpr);
    g.fillStyle = th.muted;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(fitText(g, sc.emptyText, L.w - 16), (L.left + L.right) / 2, (L.top + L.bottom) / 2);
    return;
  }
  if (sc.kind === "stripes") { drawStripes(g, sc, L, th, dpr); drawHeader(g, sc, L, th, dpr); return; }
  drawGrid(g, sc, L, th, dpr);
  g.save();
  g.beginPath();
  g.rect(L.left, L.top, L.w, L.h);
  g.clip();
  if (sc.kind === "series") drawSeries(g, sc, L, th, dpr);
  else if (sc.kind === "bars") drawBars(g, sc, L, th, dpr);
  else drawSeasonal(g, sc, L, th, dpr);
  g.restore();
  drawFrame(g, L, th, dpr);
  drawYTicks(g, sc, L, th, dpr);
  drawXTicks(g, sc, L, th, dpr);
  drawHeader(g, sc, L, th, dpr);
}

function drawFrame(g, L, th, dpr) {
  g.strokeStyle = th.axis;
  g.lineWidth = 1;
  const x0 = crisp(L.left, dpr), x1 = crisp(L.right, dpr), y0 = crisp(L.top, dpr), y1 = crisp(L.bottom, dpr);
  g.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

// The tick sets to draw: during a morph the old set fades out as the new one fades in.
function tickSets(sc) {
  const sets = [];
  if (sc.oldTicks && sc.tickMix < 1) sets.push({ ticks: sc.oldTicks, fmt: sc.oldTickFmt || sc.tickFmt, a: 1 - sc.tickMix, step: NaN });
  sets.push({ ticks: sc.yTicks, fmt: sc.tickFmt, a: sc.oldTicks ? sc.tickMix : 1, step: sc.yStep });
  return sets.filter((s) => s.a > 0.01 && s.ticks.length);
}

function drawGrid(g, sc, L, th, dpr) {
  g.lineWidth = 1;
  for (const s of tickSets(sc)) {
    g.globalAlpha = s.a;
    g.strokeStyle = th.grid;
    g.setLineDash([1, 2]);
    for (const t of s.ticks) {
      const y = L.sy(t);
      if (y > L.top + 1.5 && y < L.bottom - 1.5) hLine(g, L.left + 1, L.right - 1, crisp(y, dpr));
    }
  }
  g.setLineDash([]);
  g.globalAlpha = 1;
  // A faint solid zero line when the axis crosses zero (anomalies, negative bars).
  const d = sc.dom;
  if (d.y0 < 0 && d.y1 > 0) {
    const y = L.sy(0);
    if (y > L.top + 1.5 && y < L.bottom - 1.5) {
      g.strokeStyle = sc.kind === "bars" ? fade(th.axis, 0.8) : fade(th.text, 0.25);
      hLine(g, L.left + 1, L.right - 1, crisp(y, dpr));
    }
  }
}

function drawYTicks(g, sc, L, th, dpr) {
  g.lineWidth = 1;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const s of tickSets(sc)) {
    g.globalAlpha = s.a;
    g.strokeStyle = th.axis;
    g.fillStyle = th.text;
    for (const t of s.ticks) {
      const y = L.sy(t);
      if (y < L.top - 0.5 || y > L.bottom + 0.5) continue;
      const yc = crisp(y, dpr);
      hLine(g, L.left, L.left + 5, yc);
      hLine(g, L.right - 5, L.right, yc);
      g.fillText(s.fmt(t), L.left - 4, y);
    }
    // Minor ticks for the current set only.
    if (isFin(s.step) && s.step > 0) {
      const px = Math.abs(L.sy(s.step) - L.sy(0));
      const minor = px / 5 >= 4 ? s.step / 5 : px / 2 >= 4 ? s.step / 2 : 0;
      if (minor) {
        const k0 = Math.ceil(Math.min(sc.dom.y0, sc.dom.y1) / minor - 1e-9), k1 = Math.floor(Math.max(sc.dom.y0, sc.dom.y1) / minor + 1e-9);
        const per = Math.round(s.step / minor);
        for (let k = k0; k <= k1; k++) {
          if (k % per === 0) continue;
          const y = L.sy(k * minor);
          if (y < L.top + 1 || y > L.bottom - 1) continue;
          const yc = crisp(y, dpr);
          hLine(g, L.left, L.left + 3, yc);
          hLine(g, L.right - 3, L.right, yc);
        }
      }
    }
  }
  g.globalAlpha = 1;
}

function drawXTicks(g, sc, L, th, dpr) {
  g.lineWidth = 1;
  g.strokeStyle = th.axis;
  g.fillStyle = th.text;
  g.textAlign = "center";
  g.textBaseline = "top";
  const tick = (x, len) => { vLine(g, x, L.bottom, L.bottom - len); vLine(g, x, L.top, L.top + len); };
  if (sc.kind === "seasonal") {
    const every = L.w / 12 < 10 ? 2 : 1;
    for (let m = 1; m <= 12; m++) {
      const x = L.sx(m);
      if (x < L.left || x > L.right) continue;
      tick(crisp(x, dpr), 4);
      if ((m - 1) % every === 0) g.fillText("JFMAMJJASOND"[m - 1], x, L.bottom + 4);
    }
    return;
  }
  const { major, minor } = yearTicks(sc.dom.x0, sc.dom.x1, L.w);
  if (minor) {
    for (let y = Math.ceil(sc.dom.x0 / minor) * minor; y <= sc.dom.x1; y += minor) {
      if (major.indexOf(y) >= 0) continue;
      const x = L.sx(y);
      if (x > L.left + 1 && x < L.right - 1) tick(crisp(x, dpr), 3);
    }
  }
  let lastRight = -Infinity;
  for (const y of major) {
    const x = L.sx(y);
    if (x < L.left - 0.5 || x > L.right + 0.5) continue;
    tick(crisp(x, dpr), 5);
    const label = String(y), tw = g.measureText(label).width;
    const cx = clamp(x, tw / 2 + 1, L.W - tw / 2 - 1);
    if (cx - tw / 2 < lastRight + 6) continue;
    g.fillText(label, cx, L.bottom + 4);
    lastRight = cx + tw / 2;
  }
}

// Units at the top left of the y axis, the legend at the top right, the title
// in small caps inside the plot (above the stripes for "stripes").
function drawHeader(g, sc, L, th, dpr) {
  g.fillStyle = th.muted;
  g.textBaseline = "middle";
  g.textAlign = "left";
  let unitsRight = L.left;
  if (sc.units && sc.kind !== "stripes") {
    const u = fitText(g, sc.units, Math.max(40, L.w * 0.6));
    g.fillText(u, L.left, L.top - 9);
    unitsRight = L.left + g.measureText(u).width;
  }
  if (sc.kind === "seasonal" && !sc.empty) drawLegend(g, sc, L, th, dpr, unitsRight);
  if (sc.title) {
    g.font = TITLE_FONT;
    g.fillStyle = th.muted;
    g.textAlign = "left";
    g.textBaseline = "top";
    const t = sc.title.toUpperCase();
    if (sc.kind === "stripes") g.fillText(fitText(g, t, L.w), L.left, 3);
    else g.fillText(fitText(g, t, L.w - 12), L.left + 6, L.top + 5);
    g.font = FONT;
  }
}

function drawLegend(g, sc, L, th, dpr, minX) {
  const items = [[sc.earlyLabel, th.early], [sc.lateLabel, sc.color || th.late]];
  const sw = 12, gap = 4, sep = 12;
  const widths = items.map(([t]) => g.measureText(t).width);
  const total = widths.reduce((s, w) => s + sw + gap + w, 0) + sep * (items.length - 1);
  let x = L.right - total, y = L.top - 9;
  if (x < minX + 12) { x = L.right - total - 6; y = L.top + 11; } // no room above: inside, top right
  g.textAlign = "left";
  g.textBaseline = "middle";
  items.forEach(([t, c], k) => {
    g.strokeStyle = c;
    g.lineWidth = 1.25;
    hLine(g, x, x + sw, snapPx(y, dpr));
    x += sw + gap;
    g.fillStyle = th.muted;
    g.fillText(t, x, y);
    x += widths[k] + sep;
  });
}

// Polyline through finite points; NaN breaks the line.
function trace(g, xs, vs, L) {
  let pen = false;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (!isFin(v)) { pen = false; continue; }
    const x = L.sx(xs[i]), y = L.sy(v);
    if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
  }
}

function drawSeries(g, sc, L, th, dpr) {
  const col = sc.color || th.series;
  const yrs = sc.years, vals = sc.values, n = yrs.length;
  const first = yrs[0], last = yrs[n - 1];

  const r = sc.refLine;
  if (r) {
    const y = crisp(L.sy(r.value), dpr);
    g.globalAlpha = r.a ?? 1;
    g.strokeStyle = r.color || th.muted;
    g.lineWidth = 1;
    g.setLineDash([6, 3]);
    hLine(g, L.left, L.right, y);
    g.setLineDash([]);
    if (r.label) {
      const above = y - 14 >= L.top;
      g.fillStyle = th.muted;
      g.textAlign = "right";
      g.textBaseline = above ? "bottom" : "top";
      g.fillText(r.label, L.right - 6, above ? y - 2 : y + 3);
    }
    g.globalAlpha = 1;
  }

  if (sc.monthly) {
    g.globalAlpha = 0.35 * (sc.monthly.a ?? 1);
    g.strokeStyle = col;
    g.lineWidth = 0.75;
    g.beginPath();
    trace(g, sc.monthly.x, sc.monthly.v, L);
    g.stroke();
    g.globalAlpha = 1;
  }

  const f = sc.fit ? fitOLS(yrs, vals) : null;
  if (f) {
    const fa = sc.fitA ?? 1;
    const xEnd = sc.extendTo != null ? Math.max(last, sc.extendTo) : last;
    if (f.n >= 3) {
      const N = 48, xAt = (k) => first + ((xEnd - first) * k) / N;
      g.globalAlpha = fa;
      g.fillStyle = th.band;
      g.beginPath();
      for (let k = 0; k <= N; k++) { const x = xAt(k); g.lineTo(L.sx(x), L.sy(f.at(x) + f.half(x))); }
      for (let k = N; k >= 0; k--) { const x = xAt(k); g.lineTo(L.sx(x), L.sy(f.at(x) - f.half(x))); }
      g.closePath();
      g.fill();
    }
    g.globalAlpha = fa;
    g.strokeStyle = th.fit;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(L.sx(first), L.sy(f.at(first)));
    g.lineTo(L.sx(last), L.sy(f.at(last)));
    g.stroke();
    if (xEnd > last) {
      // Extrapolation: finer dashes, same colour.
      g.setLineDash([1.5, 2.5]);
      g.beginPath();
      g.moveTo(L.sx(last), L.sy(f.at(last)));
      g.lineTo(L.sx(xEnd), L.sy(f.at(xEnd)));
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  g.strokeStyle = col;
  g.lineWidth = 1.25;
  g.beginPath();
  trace(g, yrs, vals, L);
  g.stroke();

  // Annual points: small squares; a point with no neighbours is always drawn.
  const pxPerYear = L.w / Math.max(1e-9, sc.dom.x1 - sc.dom.x0);
  const s = Math.max(2, Math.round(2.5 * dpr)) / dpr;
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!isFin(v)) continue;
    const lone = !(i > 0 && isFin(vals[i - 1])) && !(i < n - 1 && isFin(vals[i + 1]));
    if (pxPerYear < 3.5 && !lone) continue;
    g.fillRect(snapPx(L.sx(yrs[i]) - s / 2, dpr), snapPx(L.sy(v) - s / 2, dpr), s, s);
  }

  for (const m of sc.markers || []) {
    const x = L.sx(m.year);
    if (x < L.left - 0.5 || x > L.right + 0.5) continue;
    const mc = m.color || th.marker;
    g.globalAlpha = m.a ?? 1;
    g.strokeStyle = mc;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    vLine(g, crisp(x, dpr), L.top, L.bottom);
    g.setLineDash([]);
    if (m.label) {
      const tw = g.measureText(m.label).width;
      const onRight = x + 4 + tw <= L.right - 3;
      g.fillStyle = th.text;
      g.textAlign = onRight ? "left" : "right";
      g.textBaseline = "top";
      g.fillText(m.label, onRight ? x + 4 : x - 4, L.top + 4);
    }
    g.globalAlpha = 1;
  }
}

// Left and right x edges of year y's bar or stripe, in whole device pixels.
function yearCell(L, y, dpr) {
  return [snapPx(L.sx(y - 0.5), dpr), snapPx(L.sx(y + 0.5), dpr)];
}

function drawBars(g, sc, L, th, dpr) {
  const col = sc.color || th.series;
  const base = snapPx(L.sy(clamp(0, Math.min(sc.dom.y0, sc.dom.y1), Math.max(sc.dom.y0, sc.dom.y1))), dpr);
  g.fillStyle = fade(col, 0.8);
  for (let i = 0; i < sc.years.length; i++) {
    const v = sc.values[i];
    if (!isFin(v)) continue;
    let [xa, xb] = yearCell(L, sc.years[i], dpr);
    xa += 1; // the 1px gap between neighbouring bars
    if (xb - xa > 36) { const c = (xa + xb) / 2; xa = snapPx(c - 18, dpr); xb = xa + 36; }
    const yv = snapPx(L.sy(v), dpr);
    const top = Math.min(yv, base), h = Math.abs(base - yv);
    if (h > 0 && xb > xa) g.fillRect(xa, top, xb - xa, h);
  }
  if (sc.fit) {
    const f = fitOLS(sc.years, sc.values);
    if (f) {
      const a = sc.years[0], b = sc.years[sc.years.length - 1];
      g.strokeStyle = th.fit;
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(L.sx(a), L.sy(f.at(a)));
      g.lineTo(L.sx(b), L.sy(f.at(b)));
      g.stroke();
      g.setLineDash([]);
    }
  }
}

function drawStripes(g, sc, L, th, dpr) {
  const top = snapPx(L.top, dpr), bottom = snapPx(L.bottom, dpr);
  for (let i = 0; i < sc.years.length; i++) {
    const [xa, xb] = yearCell(L, sc.years[i], dpr);
    if (xb <= xa) continue;
    g.fillStyle = sc.missing[i]
      ? `rgb(${MISSING_RGB[0]},${MISSING_RGB[1]},${MISSING_RGB[2]})`
      : `rgb(${Math.round(sc.rgb[3 * i])},${Math.round(sc.rgb[3 * i + 1])},${Math.round(sc.rgb[3 * i + 2])})`;
    g.fillRect(xa, top, xb - xa, bottom - top);
  }
  // Plain decade labels under the stripes.
  const { major } = yearTicks(sc.dom.x0, sc.dom.x1, L.w);
  g.fillStyle = th.text;
  g.textAlign = "center";
  g.textBaseline = "top";
  let lastRight = -Infinity;
  for (const y of major) {
    const x = L.sx(y);
    if (x < L.left || x > L.right) continue;
    const label = String(y), tw = g.measureText(label).width;
    const cx = clamp(x, tw / 2 + 1, L.W - tw / 2 - 1);
    if (cx - tw / 2 < lastRight + 6) continue;
    g.fillText(label, cx, L.bottom + 4);
    lastRight = cx + tw / 2;
  }
}

// Monotone cubic (Steffen) control points for points sorted by x, so a smooth
// curve never overshoots the data.
function monotoneSegs(P) {
  const n = P.length, out = [];
  if (n < 2) return out;
  const dx = [], s = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = P[i + 1][0] - P[i][0];
    s[i] = dx[i] ? (P[i + 1][1] - P[i][1]) / dx[i] : 0;
  }
  const m = new Array(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const h0 = dx[i - 1], h1 = dx[i], s0 = s[i - 1], s1 = s[i];
    const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    m[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    out.push([P[i][0] + h, P[i][1] + m[i] * h, P[i + 1][0] - h, P[i + 1][1] - m[i + 1] * h]);
  }
  return out;
}

// Add a smooth curve to the current path: forward starts with moveTo,
// reverse continues the path from the last point back to the first.
function curve(g, P, segs, reverse) {
  const n = P.length;
  if (!reverse) {
    g.moveTo(P[0][0], P[0][1]);
    for (let i = 0; i < n - 1; i++) { const c = segs[i]; g.bezierCurveTo(c[0], c[1], c[2], c[3], P[i + 1][0], P[i + 1][1]); }
  } else {
    g.lineTo(P[n - 1][0], P[n - 1][1]);
    for (let i = n - 2; i >= 0; i--) { const c = segs[i]; g.bezierCurveTo(c[2], c[3], c[0], c[1], P[i][0], P[i][1]); }
  }
}

function drawSeasonal(g, sc, L, th, dpr) {
  const ce = th.early, cl = sc.color || th.late;
  const pts = (arr) => sc.months.map((m, i) => [L.sx(m), L.sy(arr[i]), isFin(arr[i])]);
  const pe = pts(sc.early), pl = pts(sc.late);

  // Area between the curves, in runs where both are finite. Clipping to either
  // side of the early curve splits it by the sign of (late - early).
  const runs = [];
  let cur = [];
  for (let i = 0; i < sc.months.length; i++) {
    if (pe[i][2] && pl[i][2]) cur.push(i);
    else { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  for (const run of runs) {
    const E = run.map((i) => pe[i]), Lt = run.map((i) => pl[i]);
    const sE = monotoneSegs(E), sL = monotoneSegs(Lt);
    for (const [higher, color] of [[true, cl], [false, ce]]) {
      const edge = higher !== sc.invertY ? L.top - 2 : L.bottom + 2;
      g.save();
      g.beginPath();
      curve(g, E, sE, false);
      g.lineTo(E[E.length - 1][0], edge);
      g.lineTo(E[0][0], edge);
      g.closePath();
      g.clip();
      g.beginPath();
      curve(g, Lt, sL, false);
      curve(g, E, sE, true);
      g.closePath();
      g.fillStyle = fade(color, 0.1);
      g.fill();
      g.restore();
    }
  }

  const s = Math.max(2, Math.round(2.5 * dpr)) / dpr;
  for (const [P, color] of [[pe, ce], [pl, cl]]) {
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 1.25;
    let run = [];
    const flush = () => {
      if (run.length > 1) { g.beginPath(); curve(g, run, monotoneSegs(run), false); g.stroke(); }
      else if (run.length === 1) g.fillRect(snapPx(run[0][0] - s / 2, dpr), snapPx(run[0][1] - s / 2, dpr), s, s);
      run = [];
    };
    for (const p of P) { if (p[2]) run.push(p); else flush(); }
    flush();
  }
}

// ---------------------------------------------------------------------------
// Overlay: playhead, hover crosshair and readout, drawn over the cached layer

function renderOverlay(g, sc, L, th, dpr, cursor, hover) {
  if (!sc || sc.empty) return;
  g.font = FONT;
  g.setLineDash([]);
  g.lineCap = "butt";
  g.globalAlpha = 1;
  if (cursor != null && sc.kind !== "seasonal") drawCursor(g, sc, L, th, dpr, cursor);
  if (hover) drawHover(g, sc, L, th, dpr, hover);
}

// Bar extent for year index i, matching drawBars.
function barBox(sc, L, i, dpr) {
  let [xa, xb] = yearCell(L, sc.years[i], dpr);
  xa += 1;
  if (xb - xa > 36) { const c = (xa + xb) / 2; xa = snapPx(c - 18, dpr); xb = xa + 36; }
  const base = snapPx(L.sy(clamp(0, Math.min(sc.dom.y0, sc.dom.y1), Math.max(sc.dom.y0, sc.dom.y1))), dpr);
  const yv = snapPx(L.sy(sc.values[i]), dpr);
  return [xa, Math.min(yv, base), xb - xa, Math.abs(base - yv)];
}

function drawCursor(g, sc, L, th, dpr, c) {
  g.strokeStyle = th.cursor;
  g.lineWidth = 1;
  const i = indexOf(sc.years, Math.floor(c + 1e-6));
  if (sc.kind === "stripes") {
    if (i < 0) return;
    const [xa, xb] = yearCell(L, sc.years[i], dpr);
    if (xb - xa >= 2) g.strokeRect(xa + 0.5, snapPx(L.top, dpr) + 0.5, xb - xa - 1, snapPx(L.bottom, dpr) - snapPx(L.top, dpr) - 1);
    else vLine(g, crisp((xa + xb) / 2, dpr), L.top, L.bottom);
    return;
  }
  const x = L.sx(c);
  if (x >= L.left - 0.5 && x <= L.right + 0.5) vLine(g, crisp(x, dpr), L.top, L.bottom);
  if (i < 0 || !isFin(sc.values[i])) return;
  if (sc.kind === "series") {
    const px = L.sx(sc.years[i]), py = L.sy(sc.values[i]);
    if (py < L.top - 4 || py > L.bottom + 4) return;
    g.strokeRect(snapPx(px - 4, dpr) + 0.5, snapPx(py - 4, dpr) + 0.5, 7, 7);
  } else {
    // The playhead's year: its bar at full opacity, covering the line inside it.
    const [bx, by, bw, bh] = barBox(sc, L, i, dpr);
    if (bw > 0 && bh > 0) {
      g.fillStyle = sc.color || th.series;
      g.fillRect(bx, by, bw, bh);
    }
  }
}

function drawHover(g, sc, L, th, dpr, h) {
  g.lineWidth = 1;
  g.strokeStyle = th.muted;
  g.setLineDash([1, 2]);
  if (sc.kind === "seasonal") {
    const i = h.i, m = sc.months[i], x = L.sx(m);
    vLine(g, crisp(x, dpr), L.top, L.bottom);
    g.setLineDash([]);
    const e = sc.early[i], l = sc.late[i];
    const ys = [e, l].filter(isFin).map(L.sy);
    const ay = ys.length ? Math.min(...ys) : (L.top + L.bottom) / 2;
    drawReadout(g, L, th, dpr, x, ay, [
      { text: MONTHS[Math.round(m) - 1] || String(m) },
      { text: `${sc.earlyLabel}  ${sc.readout(e)}`, swatch: th.early },
      { text: `${sc.lateLabel}  ${sc.readout(l)}`, swatch: sc.color || th.late },
    ]);
    return;
  }
  const yr = h.year, x = L.sx(yr);
  let value, text;
  if (h.proj) {
    const f = sc.fit ? fitOLS(sc.years, sc.values) : null;
    value = f ? f.at(yr) : NaN;
    text = f ? `${yr}  fit ${sc.readout(value)}` : String(yr);
  } else {
    value = sc.values[h.i];
    text = `${yr}  ${sc.readout(value)}`;
    if (sc.kind === "stripes" && isFin(value)) {
      const an = value - sc.mean;
      text += `  (${an >= 0 ? "+" : ""}${sc.readout(an)})`;
    }
  }
  vLine(g, crisp(x, dpr), L.top, L.bottom);
  const yv = isFin(value) && sc.kind !== "stripes" ? L.sy(value) : NaN;
  if (yv >= L.top && yv <= L.bottom) hLine(g, L.left, L.right, crisp(yv, dpr));
  g.setLineDash([]);
  const ay = isFin(yv) ? clamp(yv, L.top, L.bottom) : isFin(h.py) ? h.py : (L.top + L.bottom) / 2;
  drawReadout(g, L, th, dpr, x, ay, [{ text }]);
}

// Square-cornered readout box: --chart-bg-readout fill, 1px border, dark text.
function drawReadout(g, L, th, dpr, ax, ay, rows) {
  g.font = FONT;
  g.textAlign = "left";
  g.textBaseline = "middle";
  const padX = 6, padY = 3, lh = 15, sw = 10;
  let w = 0;
  for (const r of rows) w = Math.max(w, g.measureText(r.text).width + (r.swatch ? sw + 4 : 0));
  const bw = Math.ceil(w) + padX * 2, bh = rows.length * lh + padY * 2;
  let x = ax + 8;
  if (x + bw > L.W - 1) x = ax - 8 - bw;
  x = Math.max(1, Math.min(x, L.W - 1 - bw));
  let y = ay - 8 - bh;
  if (y < 1) y = ay + 8;
  y = Math.max(1, Math.min(y, L.H - 1 - bh));
  x = snapPx(x, dpr);
  y = snapPx(y, dpr);
  g.fillStyle = th.readoutBg;
  g.fillRect(x, y, bw, bh);
  g.strokeStyle = th.readoutBorder;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
  rows.forEach((r, k) => {
    const cy = y + padY + lh * k + lh / 2;
    let tx = x + padX;
    if (r.swatch) {
      g.strokeStyle = r.swatch;
      g.lineWidth = 1.25;
      hLine(g, tx, tx + sw, snapPx(cy, dpr));
      tx += sw + 4;
    }
    g.fillStyle = th.readoutText;
    g.fillText(r.text, tx, cy + 0.5);
  });
}

// ---------------------------------------------------------------------------
// createChart

const toCursor = (v) => (v == null || v === "" || !isFin(+v) ? null : +v);
const KIND_NAMES = { series: "Time series", bars: "Bar chart", stripes: "Climate stripes", seasonal: "Seasonal cycle" };

/**
 * Create a chart inside containerEl. Appends a <canvas> that fills the
 * container's width; its height is fixed in CSS px (opts.height, default 220).
 * See the top of this file for the spec fields.
 * @param {HTMLElement} container
 * @param {{ height?: number }} [opts]
 */
export function createChart(container, opts = {}) {
  if (!container || typeof container.appendChild !== "function") {
    throw new TypeError("createChart(containerEl, opts): containerEl must be a DOM element");
  }
  const canvas = document.createElement("canvas");
  canvas.className = "td-chart";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Chart");
  Object.assign(canvas.style, {
    display: "block", width: "100%", maxWidth: "100%", touchAction: "pan-y", cursor: "crosshair",
    webkitTapHighlightColor: "transparent", userSelect: "none",
  });
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const base = document.createElement("canvas");
  const bctx = base.getContext("2d");

  const heightOf = (h) => (h != null && isFin(+h) && +h > 0 ? Math.max(40, Math.round(+h)) : 220);
  let cssH = heightOf(opts && opts.height), cssW = 0, dpr = 1;
  let target = null, from = null, scene = null, L = null;
  let animating = false, animStart = 0, raf = 0, baseDirty = true, destroyed = false;
  let cursor = null, hover = null, hoverKey = "", dragging = false, lastSeek = null;
  const hoverFns = new Set(), clickFns = new Set();
  const motionMQ = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  canvas.style.height = cssH + "px";

  // Size the canvas backing store to the CSS box times devicePixelRatio (<= 2).
  function measure() {
    const w = canvas.getBoundingClientRect().width || container.clientWidth || 0;
    const d = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
    const pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(cssH * d));
    canvas.style.height = cssH + "px";
    if (w === cssW && d === dpr && canvas.width === pw && canvas.height === ph) return false;
    cssW = w;
    dpr = d;
    canvas.width = base.width = pw;
    canvas.height = base.height = ph;
    baseDirty = true;
    return true;
  }

  function paint() {
    if (destroyed) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!scene || cssW < 2) return;
    const th = readTheme(container);
    L = layout(scene, cssW, cssH);
    if (baseDirty) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, base.width, base.height);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBase(bctx, scene, L, th, dpr);
      baseDirty = false;
    }
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderOverlay(ctx, scene, L, th, dpr, cursor, resolveHover());
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    if (animating) {
      const p = clamp((now - animStart) / MORPH_MS, 0, 1);
      if (p >= 1) { animating = false; from = null; scene = target; }
      else scene = interpScene(from, target, easeOut(p));
      baseDirty = true;
    }
    paint();
    if (animating) raf = requestAnimationFrame(frame);
  }
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(frame); };

  function update(spec) {
    if (destroyed) return api;
    const s = spec && typeof spec === "object" ? spec : {};
    if ("cursorYear" in s) cursor = toCursor(s.cursorYear);
    const next = buildScene(s);
    if (target && next.sig === target.sig) {
      // Same data: take the new formatters without re-animating.
      target = next;
      if (!animating) scene = next;
    } else {
      const shown = scene;
      const reduce = !!(motionMQ && motionMQ.matches);
      const morphable = !reduce && cssW > 1 && shown && !shown.empty && !next.empty && shown.kind === next.kind;
      target = next;
      if (morphable) {
        from = shown; // mid-morph scenes are complete scenes, so rapid updates chain smoothly
        animStart = performance.now();
        animating = true;
        scene = interpScene(from, target, 0);
      } else {
        animating = false;
        from = null;
        scene = next;
      }
    }
    baseDirty = true;
    describe();
    schedule();
    return api;
  }

  function describe() {
    const sc = target;
    let s = sc.title || KIND_NAMES[sc.kind];
    if (sc.empty) s += ". " + sc.emptyText;
    else if (sc.kind === "seasonal") s += `, ${sc.earlyLabel} versus ${sc.lateLabel}`;
    else {
      s += `, ${sc.years[0]} to ${sc.years[sc.years.length - 1]}`;
      const f = sc.fit ? fitOLS(sc.years, sc.values) : null;
      if (f) s += `, trend ${f.slope >= 0 ? "+" : ""}${smartFormat(f.slope * 10)}${sc.units ? " " + sc.units : ""} per decade`;
    }
    canvas.setAttribute("aria-label", s + ". Arrow keys read values.");
  }

  // ---- hover, click, drag-scrub, keyboard

  // Hover is kept in data terms ({ year } or { month }) so it survives updates.
  function resolveHover() {
    if (!hover || !scene || scene.empty) return null;
    if (scene.kind === "seasonal") {
      const i = hover.month == null ? -1 : indexOf(scene.months, hover.month);
      return i < 0 ? null : { i, py: hover.py };
    }
    if (hover.month != null) return null;
    if (hover.proj) {
      const last = scene.years[scene.years.length - 1];
      return scene.kind === "series" && scene.extendTo != null && hover.year > last && hover.year <= scene.extendTo + 0.5 ? hover : null;
    }
    const i = indexOf(scene.years, hover.year);
    return i < 0 ? null : { year: hover.year, i, py: hover.py };
  }

  function hitTest(px, py) {
    if (!scene || scene.empty || !L) return null;
    if (px < L.left - 12 || px > L.right + 12 || py < L.top - 16 || py > L.bottom + 20) return null;
    const x = L.ix(clamp(px, L.left, L.right));
    if (scene.kind === "seasonal") {
      const i = nearestIndex(scene.months, x);
      return i < 0 ? null : { month: scene.months[i], py };
    }
    const yrs = scene.years, last = yrs[yrs.length - 1];
    if (scene.kind === "series" && scene.extendTo != null && x > last + 0.5) {
      return { year: clamp(Math.round(x), last + 1, Math.max(last + 1, Math.floor(scene.extendTo))), proj: true, py };
    }
    const i = nearestIndex(yrs, x);
    return i < 0 ? null : { year: yrs[i], py };
  }

  function emitHover() {
    if (!hoverFns.size) return;
    const r = resolveHover();
    let year = null, info = { value: NaN, x: NaN, y: NaN, fit: NaN };
    const t = target;
    if (r && t && L) {
      if (t.kind === "seasonal") {
        const i = r.i;
        info = { value: t.late[i], early: t.early[i], late: t.late[i], month: t.months[i], x: L.sx(t.months[i]), y: L.sy(t.late[i]), fit: NaN };
      } else {
        const f = t.kind !== "stripes" && t.fit ? fitOLS(t.years, t.values) : null;
        const fit = f ? f.at(r.year) : NaN;
        const value = r.proj ? NaN : t.values[r.i];
        info = { value, x: L.sx(r.year), y: isFin(value) ? L.sy(value) : isFin(fit) ? L.sy(fit) : NaN, fit };
        if (r.proj) info.projected = true;
        else year = r.year;
      }
    }
    for (const fn of hoverFns) { try { fn(year, info); } catch (e) { console.error(e); } }
  }

  function setHover(h) {
    hover = h;
    schedule();
    const key = !h ? "" : h.proj ? "p" + h.year : h.month != null ? "m" + h.month : "y" + h.year;
    if (key === hoverKey) return;
    hoverKey = key;
    emitHover();
  }

  function emitClick(year) {
    for (const fn of clickFns) { try { fn(year); } catch (e) { console.error(e); } }
  }
  function seek(h) {
    if (!h || h.proj || h.month != null || h.year == null || h.year === lastSeek) return;
    lastSeek = h.year;
    emitClick(h.year);
  }

  const local = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  function onDown(ev) {
    if (ev.button !== 0 || ev.isPrimary === false) return;
    const [px, py] = local(ev);
    const h = hitTest(px, py);
    setHover(h);
    if (!h || h.proj || h.month != null) return;
    dragging = true;
    lastSeek = null;
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
    seek(h);
  }
  function onMove(ev) {
    const [px, py] = local(ev);
    let h = hitTest(px, py);
    if (dragging && !h && L) h = hitTest(clamp(px, L.left, L.right), clamp(py, L.top, L.bottom));
    setHover(h);
    if (dragging) seek(h);
  }
  function onUp(ev) {
    if (!dragging) return;
    dragging = false;
    lastSeek = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  }
  function onLeave(ev) {
    if (dragging || ev.pointerType === "touch") return;
    setHover(null);
  }
  function onKey(ev) {
    if (!scene || scene.empty) return;
    const seasonal = scene.kind === "seasonal";
    const xs = seasonal ? scene.months : scene.years;
    if (!xs.length) return;
    const k = ev.key;
    if ((k === "Enter" || k === " ") && hover && !seasonal && !hover.proj && hover.year != null) {
      ev.preventDefault();
      emitClick(hover.year);
      return;
    }
    if (k === "Escape") { if (hover) { ev.preventDefault(); setHover(null); } return; }
    const atX = hover && !hover.proj ? (seasonal ? hover.month : hover.year)
      : !seasonal && cursor != null ? Math.floor(cursor + 1e-6) : xs[xs.length - 1];
    let i = nearestIndex(xs, isFin(atX) ? atX : xs[xs.length - 1]);
    if (k === "ArrowLeft" || k === "ArrowRight") i += (k === "ArrowLeft" ? -1 : 1) * (ev.shiftKey ? 10 : 1);
    else if (k === "Home") i = 0;
    else if (k === "End") i = xs.length - 1;
    else return;
    ev.preventDefault();
    i = clamp(i, 0, xs.length - 1);
    setHover(seasonal ? { month: xs[i], py: NaN, kb: true } : { year: xs[i], py: NaN, kb: true });
  }
  function onBlur() { if (hover && hover.kb) setHover(null); }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("blur", onBlur);

  // Repaint synchronously on resize: resizing a canvas clears it.
  const onResize = () => { if (!destroyed && measure()) paint(); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  window.addEventListener("resize", onResize);
  measure();

  const api = {
    /** The <canvas> element (for export). */
    canvas,
    /** Draw spec, morphing from the previous one (450 ms; instant with reduced motion). */
    update,
    /** Playhead at a year (integer) or decimal-year position; null hides it. */
    setCursor(year) {
      const c = toCursor(year);
      if (c !== cursor) { cursor = c; schedule(); }
      return api;
    },
    /** fn(year|null, { value, x, y, fit }) as the pointer or arrow keys move. Returns an unsubscribe fn. */
    onHover(fn) {
      if (typeof fn !== "function") return () => {};
      hoverFns.add(fn);
      return () => hoverFns.delete(fn);
    },
    /** fn(year) on click, tap, drag-scrub across years, or Enter. Returns an unsubscribe fn. */
    onClick(fn) {
      if (typeof fn !== "function") return () => {};
      clickFns.add(fn);
      return () => clickFns.delete(fn);
    },
    /** Re-measure and repaint (also picks up CSS colour changes). Optional new height in CSS px. */
    resize(height) {
      if (destroyed) return api;
      if (height != null) cssH = heightOf(height);
      measure();
      baseDirty = true;
      paint();
      return api;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("blur", onBlur);
      hoverFns.clear();
      clickFns.clear();
      canvas.remove();
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Sparkline

/**
 * Tiny HiDPI sparkline for lineup cards: 1px line, faint dashed OLS fit and a
 * 2px square end marker. Sizes the canvas itself; NaN values break the line.
 * @param {HTMLCanvasElement} canvas
 * @param {ArrayLike<number>} values
 * @param {{ color?: string, fit?: boolean, width?: number, height?: number, highlightLast?: boolean }} [opts]
 * @returns {{ slope: number } | null} the fit slope per step, when a fit was drawn
 */
export function drawSparkline(canvas, values, opts = {}) {
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const o = opts || {};
  const w = Math.max(8, Math.round(isFin(+o.width) && +o.width > 0 ? +o.width : canvas.clientWidth || 120));
  const h = Math.max(8, Math.round(isFin(+o.height) && +o.height > 0 ? +o.height : canvas.clientHeight || 32));
  const dpr = clamp((typeof window !== "undefined" && window.devicePixelRatio) || 1, 1, MAX_DPR);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const th = readTheme(canvas);
  const col = o.color || th.series;
  const vs = numArray(values);
  const n = vs.length;
  let [lo, hi] = extent(vs);
  g.lineWidth = 1;
  if (!(lo <= hi)) {
    g.strokeStyle = th.muted;
    g.setLineDash([1, 2]);
    hLine(g, 2, w - 2, crisp(h / 2, dpr));
    return null;
  }
  const f = o.fit !== false && n > 2 ? fitOLS(vs.map((_, i) => i), vs) : null;
  if (f) [lo, hi] = extent([f.at(0), f.at(n - 1)], lo, hi);
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = 2.5;
  const sx = (i) => pad + (n > 1 ? (i / (n - 1)) * (w - 2 * pad) : (w - 2 * pad) / 2);
  const sy = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  if (f) {
    g.strokeStyle = fade(th.fit, 0.6);
    g.setLineDash([3, 2]);
    g.beginPath();
    g.moveTo(sx(0), sy(f.at(0)));
    g.lineTo(sx(n - 1), sy(f.at(n - 1)));
    g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = col;
  g.lineJoin = "round";
  g.beginPath();
  let pen = false;
  for (let i = 0; i < n; i++) {
    if (!isFin(vs[i])) { pen = false; continue; }
    if (pen) g.lineTo(sx(i), sy(vs[i])); else { g.moveTo(sx(i), sy(vs[i])); pen = true; }
  }
  g.stroke();
  if (o.highlightLast !== false) {
    let i = n - 1;
    while (i >= 0 && !isFin(vs[i])) i--;
    if (i >= 0) {
      g.fillStyle = col;
      g.fillRect(snapPx(sx(i) - 1, dpr), snapPx(sy(vs[i]) - 1, dpr), 2, 2);
    }
  }
  return f ? { slope: f.slope } : null;
}
