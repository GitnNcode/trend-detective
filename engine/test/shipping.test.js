import { test } from "node:test";
import assert from "node:assert/strict";
import { fastestPath, SHIP } from "../index.js";
import { projectStates, viaOf } from "../shipping.js";
import { GLOBAL } from "./fixtures.js";

const n = GLOBAL.nlat * GLOBAL.nlon;
const cell = (lat, lon) => Math.round((lat + 90) / 2) * GLOBAL.nlon + Math.round((lon + 180) / 2.5);
const calm = () => ({ u: new Float32Array(n), v: new Float32Array(n), ice: new Float32Array(n) });

// Sea everywhere except a wall along 0°E from 40°S to 40°N with a gap at the equator.
function walled() {
  const sea = new Uint8Array(n).fill(1);
  for (let lat = -40; lat <= 40; lat += 2) if (lat !== 0) sea[cell(lat, 0)] = 0;
  return sea;
}

test("fastestPath goes through the gap, and ice closes it", () => {
  const sea = walled(), st = calm();
  const p = fastestPath(GLOBAL, sea, st, cell(10, -20), cell(10, 20));
  assert.ok(p.cells.includes(cell(0, 0)), "passes the equatorial gap");
  assert.ok(Math.abs(p.hours - p.km / SHIP.speedKmh) < 1e-6, "calm, ice-free: time is distance at full speed");

  st.ice[cell(0, 0)] = 0.9;
  const around = fastestPath(GLOBAL, sea, st, cell(10, -20), cell(10, 20));
  assert.ok(!around.cells.includes(cell(0, 0)));
  assert.ok(around.km > p.km, "detour around the wall is longer");

  // Light ice is passable but slow.
  st.ice[cell(0, 0)] = 0.1;
  const slow = fastestPath(GLOBAL, sea, st, cell(10, -20), cell(10, 20));
  assert.ok(slow.hours > p.hours);
});

test("a head wind costs time, a following wind barely does", () => {
  const sea = new Uint8Array(n).fill(1);
  const head = calm(), tail = calm();
  head.u.fill(-10); tail.u.fill(10);
  const a = fastestPath(GLOBAL, sea, head, cell(40, -40), cell(40, -10));
  const b = fastestPath(GLOBAL, sea, tail, cell(40, -40), cell(40, -10));
  const still = fastestPath(GLOBAL, sea, calm(), cell(40, -40), cell(40, -10));
  assert.ok(a.hours > b.hours && b.hours > still.hours);
  assert.ok(a.hours / still.hours > 1.1 && b.hours / still.hours < 1.05);
});

test("projectStates extends each cell's line and clamps ice", () => {
  const years = Array.from({ length: 20 }, (_, k) => 2000 + k);
  const states = years.map((y) => {
    const st = calm();
    st.ice[0] = 0.8 - 0.04 * (y - 2000); // reaches 0.04 in 2019, below 0 by 2021
    st.u[0] = 0.1 * (y - 2000);
    return st;
  });
  const p = projectStates({ years, states }, 5, { window: 20 });
  assert.deepEqual(p.years, [2020, 2021, 2022, 2023, 2024]);
  assert.ok(Math.abs(p.states[0].ice[0] - 0) < 1e-6, "clamped at 0");
  assert.ok(Math.abs(p.states[0].u[0] - 2.0) < 1e-4);
  assert.ok(Math.abs(p.states[4].u[0] - 2.4) < 1e-4);
});

test("viaOf names the passages a path uses", () => {
  assert.deepEqual(viaOf([[30, 32.5], [12, 45], [3, 100]]), ["Suez", "Malacca"]);
  assert.deepEqual(viaOf([[75, 100], [74, 150]]), ["Northern Sea Route"]);
});
