import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOcean, planVoyage, canalAccess, search, snap } from "../tanker.js";

const FINE = { nlat: 361, nlon: 576, lat0: -90, lon0: -180, dlat: 0.5, dlon: 0.625 };
const WIND = { nlat: 91, nlon: 144, lat0: -90, lon0: -180, dlat: 2, dlon: 2.5 };
const n = FINE.nlat * FINE.nlon;
const calm = () => ({ wu: new Float32Array(n), wv: new Float32Array(n), ice: new Float32Array(n), cu: new Float32Array(n), cv: new Float32Array(n) });

// All sea, except a north-south wall along 32.5°E from 40°S to the pole: the
// Suez canal cells cut through it, and there is open water south of 40°S.
// Land north of 80°N, so the only other way is round the south end.
function walledOcean() {
  const maskPct = new Uint8Array(n).fill(100);
  const j = Math.round((32.5 + 180) / 0.625);
  for (let i = 0; i < FINE.nlat; i++) if (-90 + i * 0.5 > -40) maskPct[i * FINE.nlon + j] = 0;
  for (let i = 0; i < FINE.nlat; i++) if (-90 + i * 0.5 >= 80) maskPct.fill(0, i * FINE.nlon, (i + 1) * FINE.nlon); // polar land cap
  return makeOcean({ maskPct, maskGrid: FINE, windGrid: WIND });
}

test("canal access follows draught and beam", () => {
  assert.match(canalAccess("vlcc").suez, /too deep/);
  assert.match(canalAccess("vlcc").panama, /too deep|too wide/);
  assert.equal(canalAccess("aframax").suez, null);
  assert.equal(canalAccess("aframax").panama, null);
  assert.match(canalAccess("suezmax").panama, /too deep/);
});

test("planVoyage prices the canal and the detour, and a VLCC must take the detour", () => {
  const oc = walledOcean(), wx = calm();
  const src = snap(oc, 30, 20), dst = snap(oc, 30, 45);
  const base = { src, dst, speedKn: 13, iceClass: false, fuelPrice: 600, objective: "cost" };
  const af = planVoyage(oc, wx, { ...base, cls: "aframax" });
  assert.equal(af.options.length, 2);
  assert.deepEqual(af.best.canals, ["suez"]);
  assert.ok(af.best.tolls > 0 && af.options[1].tolls === 0);
  assert.ok(af.options[1].days > 5 * af.best.days, "the way round the wall is far longer");
  const vl = planVoyage(oc, wx, { ...base, cls: "vlcc" });
  assert.equal(vl.options.length, 1);
  assert.deepEqual(vl.best.canals, []);
  assert.ok(Math.abs(vl.best.days - af.options[1].days) < 1e-9, "same detour, same days");
  assert.ok(vl.best.fuelT > af.options[1].fuelT, "a VLCC burns more per day");
});

test("a following current speeds the ship up, a head current slows it", () => {
  const oc = walledOcean(), wx = calm();
  wx.cu.fill(1); // 1 m/s eastward everywhere
  const a = snap(oc, 20, -40), b = snap(oc, 20, -10);
  const east = search(oc, wx, oc.sea, a, b, { speedKn: 13, iceMax: 0.15 });
  const west = search(oc, wx, oc.sea, b, a, { speedKn: 13, iceMax: 0.15 });
  const still = search(oc, calm(), oc.sea, a, b, { speedKn: 13, iceMax: 0.15 });
  assert.ok(east.hours < still.hours && still.hours < west.hours);
});

test("ice blocks a normal tanker and slows an ice-class one", () => {
  const oc = walledOcean(), wx = calm();
  const a = snap(oc, 72, 60), b = snap(oc, 72, 120);
  for (let c = 0; c < n; c++) if (oc.lat[c] >= 55) wx.ice[c] = 0.3;
  const base = { src: a, dst: b, cls: "aframax", speedKn: 13, fuelPrice: 600, objective: "time" };
  assert.equal(planVoyage(oc, wx, { ...base, iceClass: false }).best, null);
  const ic = planVoyage(oc, wx, { ...base, iceClass: true }).best;
  const open = planVoyage(oc, calm(), { ...base, iceClass: false }).best;
  assert.ok(ic && ic.days > open.days * 1.5);
});
