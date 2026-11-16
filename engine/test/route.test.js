import { test } from "node:test";
import assert from "node:assert/strict";
import { routeOpen, sampleRoute, linearTrend, mannKendall, verdict } from "../index.js";
import { synthVar, ARCTIC, GLOBAL } from "./fixtures.js";

test("sampleRoute gives about one sample per cell and takes the short way across the date line", () => {
  const s = sampleRoute({ points: [[75, 30], [75, 150]] }, ARCTIC);
  assert.equal(s.length, 120 / 1.25 + 1);
  for (let k = 1; k < s.length; k++) assert.ok(Math.abs(s[k][1] - s[k - 1][1]) <= 1.25 + 1e-9);

  const dl = sampleRoute({ points: [[70, 170], [70, -170]] }, ARCTIC);
  assert.equal(dl.length, 20 / 1.25 + 1);
  assert.ok(dl.every(([, lon]) => lon >= 170 || lon <= -170));

  // Points off the regional grid are dropped.
  const off = sampleRoute({ points: [[40, 0], [60, 0]] }, ARCTIC);
  assert.ok(off.every(([lat]) => lat >= 50));

  const gc = sampleRoute({ points: [[40.6, -73.8], [51.5, -0.5]] }, GLOBAL, { greatCircle: true });
  // The New York to London great circle bulges north of both ends.
  assert.ok(Math.max(...gc.map(([lat]) => lat)) >= 52);
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
  assert.ok(Math.abs(r.chokePoint[1] - 100) < 1);
  assert.equal(r.samples[r.chokePointIndex], r.chokePoint);

  // Only the requested months are checked.
  const summer = routeOpen(v, { points: [[75, 30], [75, 150]] }, { max: 0.15, months: [7, 8, 9, 10] });
  assert.equal(summer.years.at(-1), 2019, "the record ends 2020-05, before Jul-Oct 2020");
  assert.deepEqual(summer.openMonthList[summer.years.indexOf(1995)], [8, 9]);
  assert.deepEqual(summer.months, [7, 8, 9, 10]);

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

test("bestPath finds the shortest open-water path each year and shortens it when ice retreats", async () => {
  const { bestPath } = await import("../index.js");
  // September only. Before 1990 nothing is open. 1990-1999 only the 72N row
  // is open. From 2000 everything north of 72N is open, so the path can bend
  // poleward like a great circle and gets shorter. Land (missing) at 73N
  // 90E never blocks.
  const v = synthVar({ grid: ARCTIC, scale: 0.0001, units: "0 to 1", start: "1980-01", nt: 40 * 12 },
    ({ lat, lon, year, month }) => {
      if (lat === 73 && Math.abs(lon - 90) < 0.1) return NaN;
      if (month !== 9 || year < 1990) return 0.9;
      if (lat === 72 && lon >= 15 && lon <= 161) return 0.05;
      if (year >= 2000 && lat >= 72) return 0.05;
      return 0.9;
    });
  const r = bestPath(v, { points: [[72, 17.5], [72, 160]] }, { max: 0.15, months: [9] });
  const at = (y) => r.years.indexOf(y);
  assert.ok(Number.isNaN(r.lengthKm[at(1985)]));
  assert.equal(r.paths[at(1985)], null);

  const row = r.lengthKm[at(1995)];
  const rowKm = (160 - 17.5) / 1.25 * 2 * 6371.0088 * Math.asin(Math.cos(72 * Math.PI / 180) * Math.sin(0.625 * Math.PI / 180));
  assert.ok(Math.abs(row - rowKm) / rowKm < 0.01, `row path ${row} vs ${rowKm}`);
  assert.ok(r.paths[at(1995)].every(([lat]) => lat === 72));
  assert.equal(r.bestMonth[at(1995)], 9);

  const late = r.lengthKm[at(2005)];
  assert.ok(late < 0.95 * row, `open Arctic path ${late} should beat the row ${row}`);
  assert.ok(Math.max(...r.paths[at(2005)].map(([lat]) => lat)) > 74);
  assert.ok(r.fixedKm > 0);
});
