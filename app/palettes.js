// Color tables in the style of operational meteorology displays: discrete,
// evenly stepped, no glow. Written with Claude and reviewed by the team.

export const RAMPS = {
  // NWS-style temperature table (cold purple to hot dark red)
  temp: ["#5b1a8f", "#3d2fa8", "#2450c8", "#1f86d8", "#22b5c9", "#3fbf86", "#94cf4a", "#e8e34a", "#f5b236", "#ee7a26", "#dd3f1f", "#b3141c", "#6e0a12"],
  // Jet-stream analysis style
  wind: ["#1a1a1a", "#273663", "#2754a6", "#2a7bd6", "#38a7ec", "#7fd0f5", "#a684f0", "#c847db", "#e3239c", "#f22651", "#ff6a2a"],
  // Precipitable water style
  vapor: ["#4a3218", "#7a5a30", "#a89a58", "#78b878", "#3e9ea0", "#2f6fc0", "#3b3fbf", "#7d20bf", "#bf1f9f"],
  // QPF style (dry dark, then greens, yellows, reds, magentas)
  rain: ["#1c1c1c", "#2f5f2f", "#3f8f3f", "#6fbf5f", "#bfe060", "#f0e040", "#f0a830", "#e06020", "#c02020", "#a01060", "#c040c0", "#f0a0f0"],
  evap: ["#1c1c1c", "#3b2a14", "#6b4a1e", "#9c6e26", "#c99530", "#eabf3f", "#f6e07f"],
  ice: ["#081733", "#12305e", "#1f4f8a", "#3d78b5", "#6fa3d6", "#a8cbea", "#dbeaf7", "#ffffff"],
  soil: ["#5a3200", "#8c5a1e", "#b98a3c", "#d8c070", "#b8d080", "#70b070", "#2f9a8a", "#1a6aa0", "#123f80"],
  snow: ["#1c1c1c", "#33415e", "#4f6c9a", "#7d9ccb", "#adc6e8", "#dbe7f7", "#ffffff"],
  runoff: ["#1c1c1c", "#1c3550", "#1f5585", "#2f7fbf", "#4fa8e0", "#8fd0f0", "#d0f0ff"],
  speed: ["#262626", "#4b2991", "#2a4fb0", "#1f8fd0", "#2fbfa0", "#7fd34e", "#d8e23a", "#f9a825", "#f4511e", "#c62828"],
  // Aerosol optical depth: clean (pale) to hazy (dark brown)
  aerosol: ["#f7f4e6", "#efe3ad", "#e8c662", "#dc9a33", "#bf6522", "#8e3a1a", "#561f12"],
  // Signed wind component: easterly blue, westerly red
  uwind: ["#2c4f9e", "#4f7fcc", "#94b8e6", "#eef1f4", "#f2b98f", "#dc6f45", "#a8331c"],
  // ColorBrewer RdBu (reversed): falling blue, rising red
  heat: ["#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"],
  // ColorBrewer BrBG: drying brown, wetting teal
  wet: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
  // Shift-mode base field: plain grayscale
  gray: ["#2a2a2a", "#c8c8c8"],
  // IR-enhancement style for the tracked zone: edge to core
  zone: ["#b8b800", "#e0a000", "#d40000", "#e000e0", "#ff9cff"],
  // Edge history ("spaghetti"), one color per 5-year bin
  rings: ["#1f4e9c", "#2f7fd0", "#22a0a0", "#3fa83f", "#9ac43a", "#e0c020", "#f08c1a", "#e04a1a", "#c0182a", "#8a0a3a"],
};

// Per-variable display settings.
//   ramp/domain/levels: field color table, stored-unit domain, number of steps
//   gamma < 1 stretches the low end (skewed fields like rain)
//   trend: "heat" (rise = red), "wet" (rise = teal), "ice" (heat flipped: rise = blue)
//   code: short field code (as in model output), band: default Shift threshold
export const VARS = {
  t2m: { code: "T2M", ramp: "temp", domain: [-40, 35], levels: 15, trend: "heat", short: "Air temp", band: { min: 10, max: null }, step: 0.5 },
  t500: { code: "T500", ramp: "temp", domain: [-48, -4], levels: 11, trend: "heat", short: "Temp 500 hPa", band: { min: null, max: -20 }, step: 0.5 },
  wind250: { code: "WSPD250", ramp: "wind", domain: [0, 60], levels: 12, trend: "heat", short: "Wind 250 hPa", band: { min: 30, max: null }, step: 1 },
  tqv: { code: "TQV", ramp: "vapor", domain: [0, 60], levels: 12, trend: "wet", short: "Water vapor", band: { min: 40, max: null }, step: 1 },
  precip: { code: "PRECTOT", ramp: "rain", domain: [0, 14], levels: 14, gamma: 0.55, trend: "wet", short: "Precipitation", band: { min: 5, max: null }, step: 0.1 },
  evap: { code: "EVAP", ramp: "evap", domain: [0, 6.5], levels: 13, trend: "heat", short: "Evaporation", band: { min: 3, max: null }, step: 0.1 },
  seaice: { code: "FRSEAICE", ramp: "ice", domain: [0, 1], levels: 10, trend: "ice", short: "Sea ice", band: { min: null, max: 0.15 }, step: 0.01 },
  soilwet: { code: "GWETROOT", ramp: "soil", domain: [0.1, 1], levels: 9, trend: "wet", short: "Soil wetness", band: { min: null, max: 0.3 }, step: 0.01 },
  snow: { code: "SNOMAS", ramp: "snow", domain: [0, 500], levels: 10, gamma: 0.5, trend: "ice", short: "Snow mass", band: { min: 10, max: null }, step: 1 },
  runoff: { code: "RUNOFF", ramp: "runoff", domain: [0, 6], levels: 12, gamma: 0.5, trend: "wet", short: "Runoff", band: { min: 1, max: null }, step: 0.1 },
  aod: { code: "AOD", ramp: "aerosol", domain: [0, 1], levels: 10, gamma: 0.6, trend: "heat", short: "Aerosol haze", band: { min: 0.3, max: null }, step: 0.01 },
  u250: { code: "U250", ramp: "uwind", domain: [-40, 40], levels: 16, trend: "heat", short: "East wind 250", band: { min: 20, max: null }, step: 1, hidden: true },
  v250: { code: "V250", ramp: "uwind", domain: [-25, 25], levels: 10, trend: "heat", short: "North wind 250", band: { min: 5, max: null }, step: 1, hidden: true },
};

export function varStyle(id) {
  return VARS[id] ?? { code: id.toUpperCase(), ramp: "temp", domain: [0, 1], levels: 10, trend: "heat", short: id, band: { min: null, max: null }, step: 0.1 };
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Linear interpolation through evenly spaced stops; returns [r,g,b] for t in 0..1.
export function rampRgb(ramp, t, flip = false) {
  const list = (RAMPS[ramp] ?? ramp).map(hexToRgb);
  let x = Math.max(0, Math.min(1, flip ? 1 - t : t)) * (list.length - 1);
  const i = Math.min(list.length - 2, Math.floor(x)), f = x - i;
  return list[i].map((c, k) => Math.round(c + (list[i + 1][k] - c) * f));
}

// 256-entry RGBA lookup table (a 256x1 texture). The shader quantizes.
export function rampLUT(ramp, { flip = false, n = 256 } = {}) {
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const c = rampRgb(ramp, k / (n - 1), flip);
    out.set([c[0], c[1], c[2], 255], k * 4);
  }
  return out;
}

export function rampColor(ramp, t, { flip = false } = {}) {
  const c = rampRgb(ramp, t, flip);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Color of discrete step k of n (centre of the step), as used by the shader.
export function stepColor(ramp, k, n, { flip = false } = {}) {
  return rampColor(ramp, (k + 0.5) / n, { flip });
}

export function trendRamp(id) {
  const t = varStyle(id).trend;
  if (t === "ice") return { ramp: "heat", flip: true };
  return { ramp: t, flip: false };
}

// Width (in stored units) of the five enhancement steps inside a Shift zone.
export function zoneSoft(id) {
  const v = varStyle(id);
  if (v.domain[1] - v.domain[0] <= 1.0001 && v.domain[0] >= 0) return 0.5; // fractions: 10-point steps
  return (v.domain[1] - v.domain[0]) * ((v.gamma ?? 1) < 1 ? 0.4 : 0.12);
}
