import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linearTrend, mannKendall, verdict, deseasonalize, annualMeans, significanceLevel, fmt,
} from "../index.js";
import { tTwoSidedP, tCritical, zTwoSidedP, erfc } from "../stats.js";
import { rng, annualOf, range } from "./fixtures.js";
import { timeLabels } from "../time.js";

const YEARS = range(1980, 2024);
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("distribution functions match textbook values", () => {
  close(tTwoSidedP(2.228, 10), 0.05, 2e-4);
  close(tTwoSidedP(1.96, 1e6), 0.05, 2e-4);
  close(tCritical(10), 2.228, 1e-3);
  close(tCritical(43), 2.017, 1e-3);
  close(zTwoSidedP(1.959964), 0.05, 1e-6);
  close(erfc(0), 1, 1e-7);
  close(erfc(1), 0.157299, 1e-6);
});

test("linearTrend recovers a known slope and its 95% interval covers it", () => {
  const r = rng(7);
  let covered = 0;
  const trials = 400;
  for (let k = 0; k < trials; k++) {
    const a = annualOf(YEARS, (y) => 14 + 0.03 * (y - 1980) + 0.15 * r.normal());
    const t = linearTrend(a);
    if (t.ci95[0] <= 0.03 && 0.03 <= t.ci95[1]) covered++;
    if (k === 0) {
      close(t.slope, 0.03, 0.006);
      assert.ok(t.p < 1e-6);
      assert.ok(t.r2 > 0.8 && t.r2 <= 1);
    }
  }
  const share = covered / trials;
  assert.ok(share > 0.92 && share < 0.98, `coverage ${share}`);
});

test("linearTrend is exact on a clean line and skips NaN", () => {
  const values = Float64Array.from(YEARS, (y) => 2 - 0.5 * (y - 2000));
  values[3] = NaN; values[10] = NaN;
  const t = linearTrend({ years: YEARS, values });
  close(t.slope, -0.5, 1e-12);
  close(t.intercept, 2 + 0.5 * 2000, 1e-8);
  assert.equal(t.n, YEARS.length - 2);
  assert.ok(t.p < 1e-12);
});

test("linearTrend on a constant series gives zero slope and p = 1", () => {
  const t = linearTrend(annualOf(YEARS, () => 5));
  assert.equal(t.slope, 0);
  assert.equal(t.p, 1);
});

test("mannKendall: monotonic series, Sen slope, ties", () => {
  const mk = mannKendall(annualOf(YEARS, (y) => 0.2 * (y - 1980)));
  close(mk.tau, 1, 1e-12);
  close(mk.senSlope, 0.2, 1e-12);
  assert.ok(mk.p < 1e-10);
  assert.ok(mk.pAutocorr >= mk.p);

  const flat = mannKendall(annualOf(YEARS, () => 3));
  assert.equal(flat.tau, 0);
  assert.equal(flat.p, 1);
  assert.equal(flat.pAutocorr, 1);

  // Heavy ties still produce finite results.
  const steps = mannKendall(annualOf(YEARS, (y) => Math.floor((y - 1980) / 10)));
  assert.ok(steps.tau > 0.8 && steps.tau <= 1);
  assert.ok(Number.isFinite(steps.p) && steps.p < 1e-6);
});

test("autocorrelation correction is more cautious on red noise", () => {
  const r = rng(11);
  let rawHits = 0, corrHits = 0;
  const trials = 300;
  for (let k = 0; k < trials; k++) {
    let x = 0;
    const a = annualOf(YEARS, () => (x = 0.7 * x + r.normal()));
    const mk = mannKendall(a);
    assert.ok(mk.pAutocorr >= mk.p - 1e-15);
    if (mk.p < 0.05) rawHits++;
    if (mk.pAutocorr < 0.05) corrHits++;
  }
  // Uncorrected MK over-detects badly on AR(1) noise; the correction cuts it.
  assert.ok(corrHits < rawHits * 0.7, `raw ${rawHits}, corrected ${corrHits}`);
  assert.ok(corrHits / trials < 0.15, `corrected false positive rate ${corrHits / trials}`);
});

test("pure noise comes back 'none' about 95% of the time over 200 trials", (t) => {
  const r = rng(2026);
  const counts = { significant: 0, suggestive: 0, none: 0 };
  for (let k = 0; k < 200; k++) {
    const a = annualOf(YEARS, () => r.normal());
    const v = verdict(linearTrend(a), mannKendall(a), "°C");
    counts[v.level]++;
    assert.ok(!v.sentence.includes("NaN"));
  }
  t.diagnostic(`noise verdicts: ${JSON.stringify(counts)}`);
  // "significant" needs both tests, so false alarms sit at or below 5%.
  assert.ok(counts.significant <= 12, `significant ${counts.significant}`);
  // "suggestive" (one test, or both under 0.10) adds a few more.
  assert.ok(counts.none >= 176, `none ${counts.none} of 200`);
});

test("significance rule", () => {
  assert.equal(significanceLevel(0.01, 0.02), "significant");
  assert.equal(significanceLevel(0.01, 0.3), "suggestive");
  assert.equal(significanceLevel(0.3, 0.04), "suggestive");
  assert.equal(significanceLevel(0.08, 0.09), "suggestive");
  assert.equal(significanceLevel(0.08, 0.2), "none");
  assert.equal(significanceLevel(NaN, NaN), "none");
});

test("verdict never says NaN, even with too little or missing data", () => {
  const few = { years: [2000, 2001, 2002], values: Float64Array.from([1, NaN, 2]) };
  const v = verdict(linearTrend(few), mannKendall(few), "°C");
  assert.equal(v.level, "none");
  assert.ok(!v.sentence.includes("NaN"));
  assert.match(v.sentence, /not enough years/);

  const allMissing = annualOf(YEARS, () => NaN);
  const w = verdict(linearTrend(allMissing), mannKendall(allMissing), "m/s");
  assert.equal(w.level, "none");
  assert.ok(!w.sentence.includes("NaN"));

  const empty = verdict(undefined, undefined, "");
  assert.equal(empty.level, "none");
});

test("verdict sentences by level, with units", () => {
  const up = annualOf(YEARS, (y) => 0.025 * (y - 1980) + 0.05 * Math.sin(y));
  const s = verdict(linearTrend(up), mannKendall(up), "°C");
  assert.equal(s.level, "significant");
  assert.equal(s.direction, "rising");
  assert.match(s.sentence, /^Rising by about 0\.25 °C per decade/);

  const tight = annualOf(range(1980, 1989), (y) => 0.05 * (y - 1980) + 0.001 * Math.sin(y));
  const tv = verdict(linearTrend(tight), mannKendall(tight), "°C");
  const [, lo, hi] = tv.sentence.match(/95% range (\S+) to (\S+)\)/);
  assert.notEqual(lo, hi);

  const flat = annualOf(YEARS, (y) => Math.sin(y * 1.7));
  const n = verdict(linearTrend(flat), mannKendall(flat), "mm/day");
  assert.equal(n.level, "none");
  assert.match(n.sentence, /longer record/);

  const ice = annualOf(YEARS, (y) => 0.8 - 0.004 * (y - 1980) + 0.01 * Math.cos(y));
  const f = verdict(linearTrend(ice), mannKendall(ice), "0 to 1");
  assert.match(f.sentence, /^Falling by about 4 percentage points per decade/);
});

test("fmt keeps two significant figures without exponents", () => {
  assert.equal(fmt(0.213), "0.21");
  assert.equal(fmt(12.3), "12");
  assert.equal(fmt(0.0042), "0.0042");
  assert.equal(fmt(0.1), "0.1");
  assert.equal(fmt(-1.25), "-1.3");
  assert.equal(fmt(NaN), "unknown");
});

test("deseasonalize removes the seasonal cycle", () => {
  const t = timeLabels({ start: "1980-01", nt: 120 });
  const values = Float64Array.from(t, (s, k) => 10 * Math.sin((2 * Math.PI * Number(s.slice(5))) / 12) + 0.001 * k);
  values[5] = NaN;
  const d = deseasonalize({ t, values });
  assert.ok(Number.isNaN(d.values[5]));
  for (let k = 0; k < 120; k++) if (k !== 5) assert.ok(Math.abs(d.values[k]) < 0.1);
});

test("annualMeans: complete years only, NaN for a missing month, DJF wraps", () => {
  // 1980-01 .. 1982-06: 1982 is incomplete.
  const t = timeLabels({ start: "1980-01", nt: 30 });
  const values = Float64Array.from(t, (s) => Number(s.slice(0, 4)) - 1980 + Number(s.slice(5)) / 100);
  const all = annualMeans({ t, values });
  assert.deepEqual(all.years, [1980, 1981]);
  close(all.values[0], 0.065, 1e-12);

  const sep = annualMeans({ t, values }, [9]);
  assert.deepEqual(sep.years, [1980, 1981]);
  close(sep.values[1], 1.09, 1e-12);

  // DJF 1981 = Dec 1980, Jan 1981, Feb 1981. DJF 1980 lacks Dec 1979.
  const djf = annualMeans({ t, values }, [12, 1, 2]);
  assert.deepEqual(djf.years, [1981, 1982]);
  close(djf.values[0], (0.12 + 1.01 + 1.02) / 3, 1e-12);

  const holed = values.slice();
  holed[13] = NaN; // Feb 1981
  const h = annualMeans({ t, values: holed });
  assert.ok(Number.isNaN(h.values[1]));
});
