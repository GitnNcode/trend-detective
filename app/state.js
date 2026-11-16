// Tiny observable store with URL-hash persistence.
// Written with Claude and reviewed by the team.

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch, meta = {}) {
      const changed = Object.keys(patch).filter((k) => !same(state[k], patch[k]));
      if (!changed.length) return [];
      state = { ...state, ...patch };
      for (const fn of subs) fn(state, changed, meta);
      return changed;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// Keys that make a shareable link.
const HASH_KEYS = ["mode", "variable", "regionId", "months", "band", "route", "proj", "cadence", "twin", "custom", "compareId", "vecSource", "vecWindow"];

export function toHash(s) {
  const q = new URLSearchParams();
  for (const k of HASH_KEYS) {
    const v = s[k];
    if (v == null) continue;
    if (k === "months") q.set(k, v.join("."));
    else if (k === "band") q.set(k, `${v.min ?? ""}~${v.max ?? ""}`);
    else if (k === "twin") q.set(k, `${v.lat.toFixed(2)}~${v.lon.toFixed(2)}~${v.name ?? ""}`);
    else if (k === "custom") q.set(k, [v.latMin, v.latMax, v.lonMin, v.lonMax].join("~"));
    else q.set(k, String(v));
  }
  return "#" + q.toString();
}

export function fromHash(hash = location.hash) {
  const out = {};
  if (!hash || hash.length < 2) return out;
  const q = new URLSearchParams(hash.slice(1));
  for (const [k, v] of q) {
    if (!HASH_KEYS.includes(k)) continue;
    if (k === "months") out.months = v.split(".").map(Number).filter((m) => m >= 1 && m <= 12);
    else if (k === "band") {
      const [a, b] = v.split("~");
      out.band = { min: a === "" ? null : Number(a), max: b === "" ? null : Number(b) };
    } else if (k === "twin") {
      const [la, lo, ...name] = v.split("~");
      out.twin = { lat: Number(la), lon: Number(lo), name: name.join("~") || null };
    } else if (k === "custom") {
      const [a, b, c, d] = v.split("~").map(Number);
      out.custom = { latMin: a, latMax: b, lonMin: c, lonMax: d };
    } else if (k === "vecWindow") out[k] = Number(v) || 15;
    else out[k] = v;
  }
  return out;
}
