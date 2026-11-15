// Color ramps and per-variable display settings.
// Written with Claude and reviewed by the team.

// Each ramp is a list of [position 0..1, hex] stops (or plain hex, evenly spaced).
export const RAMPS = {
  temp: ["#1a0b3d", "#26307a", "#2f63c2", "#4fa3e6", "#a9dcf5", "#f3efe6", "#ffd28a", "#ff9a4a", "#f2552b", "#b8162d", "#5c0a24"],
  wind: ["#070a16", "#141a4d", "#2c2a8c", "#5b2fb5", "#9b35b8", "#d9479b", "#ff7a86", "#ffc0a8", "#fff4ec"],
  vapor: ["#0b0a14", "#17264a", "#1b5770", "#1f8f87", "#3fbf8a", "#a4e07a", "#f1f59b"],
  rain: ["#080c14", "#0f2240", "#164778", "#1b74b0", "#22a6d6", "#5fd2ec", "#b8f0fa", "#f2fdff"],
  evap: ["#0c0a0f", "#2d160f", "#5d2a10", "#99470f", "#d4741a", "#f5aa3e", "#ffe08a"],
  ice: ["#05101d", "#0b2440", "#1a4a78", "#3c7fb4", "#7db6df", "#c3e2f6", "#f4fbff"],
  soil: ["#2a170a", "#5a3517", "#8a5a26", "#a98b3e", "#8fb05a", "#4fae7d", "#22918f", "#156a8c"],
  snow: ["#070b14", "#15233d", "#2b4a75", "#5a83b5", "#9fc1e3", "#dceaf8", "#ffffff"],
  runoff: ["#080c14", "#0d2338", "#12406a", "#18649c", "#2a8fc9", "#60b9e6", "#bfe6fb"],
  speed: ["#0a0f1c", "#13294a", "#1a5272", "#22858a", "#5bb57c", "#c8d567", "#ffc054", "#ff7a3a", "#ff3d2e"],
  // Diverging trend ramps with a dark middle: no change stays dark, strong trends glow.
  heat: [[0, "#e6f6ff"], [0.12, "#7cd2ff"], [0.26, "#2f86f0"], [0.4, "#1d3f97"], [0.48, "#121a33"], [0.5, "#0c111c"], [0.52, "#2e1510"], [0.6, "#8f2b16"], [0.74, "#ef5a24"], [0.88, "#ffad55"], [1, "#fff1cc"]],
  wet: [[0, "#fff0d6"], [0.12, "#f4b569"], [0.26, "#c2702a"], [0.4, "#6f3713"], [0.48, "#24170e"], [0.5, "#0c111c"], [0.52, "#0d2424"], [0.6, "#155f5a"], [0.74, "#22a596"], [0.88, "#6fe8cf"], [1, "#e6fff8"]],
  // Ring years: old (blue) to recent (gold).
  rings: ["#3b6cf6", "#6d4cf0", "#a63fd8", "#e0418f", "#ff6a4a", "#ffa040", "#ffe08a"],
  // Shift-mode heat zone, from the zone's edge to its core.
  zone: ["#6b1d05", "#b83a0c", "#ff6a1f", "#ffa04a", "#ffd79a", "#fff6e0"],
};

// Display settings for every catalog variable id.
//   ramp: field ramp; domain: color domain in stored units; gamma < 1 stretches low values
//   trend: "heat" (rise = warm colors), "wet" (rise = teal), or "ice" (heat flipped: rise = cool colors)
//   short: compact name for chips; band: a sensible default Shift threshold
export const VARS = {
  t2m: { ramp: "temp", domain: [-40, 35], trend: "heat", short: "Air temp", band: { min: null, max: 0 }, step: 0.5 },
  t500: { ramp: "temp", domain: [-48, -4], trend: "heat", short: "Temp 5 km up", band: { min: null, max: -20 }, step: 0.5 },
  wind250: { ramp: "wind", domain: [0, 60], trend: "heat", short: "Jet wind", band: { min: 30, max: null }, step: 1 },
  tqv: { ramp: "vapor", domain: [0, 60], trend: "wet", short: "Water vapor", band: { min: 40, max: null }, step: 1 },
  precip: { ramp: "rain", domain: [0, 14], gamma: 0.55, trend: "wet", short: "Rain + snow", band: { min: 5, max: null }, step: 0.1 },
  evap: { ramp: "evap", domain: [0, 6.5], trend: "heat", short: "Evaporation", band: { min: 3, max: null }, step: 0.1 },
  seaice: { ramp: "ice", domain: [0, 1], trend: "ice", short: "Sea ice", band: { min: null, max: 0.15 }, step: 0.01 },
  soilwet: { ramp: "soil", domain: [0.05, 1], trend: "wet", short: "Soil wetness", band: { min: null, max: 0.3 }, step: 0.01 },
  snow: { ramp: "snow", domain: [0, 500], gamma: 0.5, trend: "ice", short: "Snow", band: { min: 10, max: null }, step: 1 },
  runoff: { ramp: "runoff", domain: [0, 6], gamma: 0.5, trend: "wet", short: "Runoff", band: { min: 1, max: null }, step: 0.1 },
};

export function varStyle(id) {
  return VARS[id] ?? { ramp: "temp", domain: [0, 1], trend: "heat", short: id, band: { min: null, max: null }, step: 0.1 };
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function normStops(ramp) {
  const list = RAMPS[ramp] ?? ramp;
  return list.map((s, k) => Array.isArray(s) ? [s[0], hexToRgb(s[1])] : [k / (list.length - 1), hexToRgb(s)]);
}

// 256-entry RGBA lookup table as a Uint8Array (for a 256x1 texture).
// `flip` reverses the ramp (used for the "ice" trend palette).
export function rampLUT(ramp, { flip = false, n = 256 } = {}) {
  const stops = normStops(ramp);
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    let t = k / (n - 1);
    if (flip) t = 1 - t;
    let a = 0;
    while (a < stops.length - 2 && t > stops[a + 1][0]) a++;
    const [p0, c0] = stops[a], [p1, c1] = stops[a + 1];
    const f = p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0;
    // Smoothstep inside each segment gives a softer ramp.
    const g = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
    for (let c = 0; c < 3; c++) out[k * 4 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * g);
    out[k * 4 + 3] = 255;
  }
  return out;
}

// CSS linear-gradient for legends.
export function rampCss(ramp, { flip = false, dir = "90deg" } = {}) {
  const lut = rampLUT(ramp, { flip, n: 24 });
  const parts = [];
  for (let k = 0; k < 24; k++) parts.push(`rgb(${lut[k * 4]},${lut[k * 4 + 1]},${lut[k * 4 + 2]}) ${((k / 23) * 100).toFixed(1)}%`);
  return `linear-gradient(${dir}, ${parts.join(", ")})`;
}

// Color for a value t in 0..1 as an "rgb()" string.
export function rampColor(ramp, t, { flip = false } = {}) {
  const lut = rampLUT(ramp, { flip, n: 64 });
  const k = Math.max(0, Math.min(63, Math.round(t * 63)));
  return `rgb(${lut[k * 4]},${lut[k * 4 + 1]},${lut[k * 4 + 2]})`;
}

export function trendRamp(id) {
  const t = varStyle(id).trend;
  if (t === "ice") return { ramp: "heat", flip: true };
  return { ramp: t, flip: false };
}
