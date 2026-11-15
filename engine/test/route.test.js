import { test } from "node:test";
import assert from "node:assert/strict";
import { routeOpen, sampleRoute, linearTrend, mannKendall, verdict } from "../index.js";
import { synthVar, ARCTIC, GLOBAL } from "./fixtures.js";

test("sampleRoute gives about one sample per cell and takes the short way across the date line", () => {
  const s = sampleRoute({ points: [[75, 30], [75, 150]] }, ARCTIC);
  assert.equal(s.length, 120 / 1.25 + 1);
  for (let k = 1; k < s.length; k++) assert.ok(Math.abs(s[k].lon - s[k - 1].lon) <= 1.25 + 1e-9);

  const dl = sampleRoute({ points: [[70, 170], [70, -170]] }, ARCTIC);
  assert.equal(dl.length, 20 / 1.25 + 1);
  assert.ok(dl.every((p) => p.lon >= 170 || p.lon <= -170));

  // Points off the regional grid are dropped.
  const off = sampleRoute({ points: [[40, 0], [60, 0]] }, ARCTIC);
  assert.ok(off.every((p) => p.lat >= 50));

  const gc = sampleRoute({ points: [[40.6, -73.8], [51.5, -0.5]] }, GLOBAL, { greatCircle: true });
  // The New York to London great circle bulges north of both ends.
  assert.ok(Math.max(...gc.map((p) => p.lat)) >= 52);
});

test("routeOpen counts open months, ignores land, finds the choke point", () => {
  // Open water along 75N from 1990 in Aug-Oct, except one cell near 100E
  // that stays frozen in October. Land (missing) at 60E never blocks.
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, units: "0 to 1", start: "1980-01", nt: 40 * 12 + 5 },
    ({ lat, lon, year, month }) => {
      if (lat === 75 && Math.abs(lon - 60) < 1) return NaN;
      const openSeason = year >= 1990 && month >= 8 && month <= 10;
      if (!openSeason) return 0.9;
      if (month === 10 && Math.abs(lon - 100) < 0.7) return 0.6;
      return 0.05;
    });
  const r = routeOpen(v, { points: [[75, 30], [75, 150]] }, { max: 0.15 });
  assert.equal(r.years[0], 1980);
  assert.equal(r.years.at(-1), 2019, "the partial final year is left out");
  assert.equal(r.openMonths[0], 0);
  assert.equal(r.openMonths[r.years.indexOf(1995)], 2);
  assert.deepEqual(r.openMonthList[r.years.indexOf(1995)], [8, 9]);
  assert.ok(Math.abs(r.chokePoint.lon - 100) < 1);
  assert.equal(r.samples[r.chokePointIndex], r.chokePoint);

  // The open-month count feeds straight into the trend functions.
  const a = { years: r.years, values: Float64Array.from(r.openMonths) };
  const vd = verdict(linearTrend(a), mannKendall(a), "months");
  assert.ok(!vd.sentence.includes("NaN"));
});

test("a route with no data never counts as open", () => {
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, nt: 24 }, () => NaN);
  const r = routeOpen(v, { points: [[75, 30], [75, 40]] }, { max: 0.15 });
  assert.deepEqual(r.openMonths, [0, 0]);
  assert.equal(r.chokePointIndex, -1);
});
