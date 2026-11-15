// Multi-panel displays: the trend atlas (10 small trend maps) and the field
// lineup (10 small time-series plots, strongest evidence first).
// Written with Claude and reviewed by the team.

import * as d3 from "d3";
import * as E from "../../engine/index.js";
import { actions, defOf, unitsOf, seasonCode } from "../main.js";
import { varStyle, rampLUT, trendRamp } from "../palettes.js";
import { fmtNum, signed } from "./workstation.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FONT = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export function renderSheet(app) {
  const el = document.getElementById("sheet");
  const s = app.state, R = app.R;
  if (!["lineup", "atlas"].includes(s.mode)) { el.hidden = true; el.innerHTML = ""; el.dataset.key = ""; return; }
  el.hidden = false;
  if (s.mode === "lineup" && R.lineup) lineup(app, el);
  if (s.mode === "atlas" && R.atlas) atlas(app, el);
}

function lineup(app, el) {
  const s = app.state, R = app.R;
  const key = JSON.stringify(["lu", R.region.latMin, R.region.latMax, R.region.lonMin, R.region.lonMax, s.months]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const list = R.lineup;
  el.innerHTML = `<div class="panels">${list.map((x, k) => {
    const vd = x.verdict, { factor, label } = E.displayUnits(x.units);
    const lvl = x.empty ? "none" : vd.level;
    return `<button class="pnl" data-id="${x.id}">
      <div class="pt"><span>${k + 1}. ${esc(varStyle(x.id).short)}</span><span class="v">${x.empty ? "no data" : `${signed(vd.perDecade * factor, 2)} ${esc(label)}/dec`}</span></div>
      <canvas data-k="${k}" height="120"></canvas>
      <div class="lampline"><span class="lamp ${x.empty ? "" : lvl === "significant" ? "sig" : lvl === "suggestive" ? "sug" : ""}"><i></i></span>${x.empty ? "outside the field's coverage" : `${lvl === "significant" ? "significant" : lvl === "suggestive" ? "suggestive" : "not significant"} · t ${fmtNum(x.tStat, 2)}`}</div>
    </button>`;
  }).join("")}</div><p class="sheet-note">Regional anomaly series, ${esc(seasonCode(s.months))}, ordered by strength of evidence (t-test and autocorrelation-corrected Mann–Kendall). Dashed red: least-squares trend. Click a panel to open it.</p>`;
  el.querySelectorAll(".pnl").forEach((b) => b.addEventListener("click", () => actions.set({ mode: "series", variable: b.dataset.id })));
  requestAnimationFrame(() => el.querySelectorAll("canvas[data-k]").forEach((cv) => {
    const x = list[Number(cv.dataset.k)];
    if (x && !x.empty) miniPlot(cv, x.annual.years, Array.from(x.annual.values), x.trend);
  }));
}

function miniPlot(cv, years, values, trend) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = cv.clientWidth || 200, H = cv.clientHeight || 110;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const fin = values.filter(Number.isFinite);
  const mean = fin.reduce((a, b) => a + b, 0) / Math.max(1, fin.length);
  const an = values.map((v) => v - mean);
  let lo = Math.min(...an.filter(Number.isFinite)), hi = Math.max(...an.filter(Number.isFinite));
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;
  const L = 6, Rr = W - 6, T = 6, B = H - 16;
  const x = (y) => L + ((y - years[0]) / Math.max(1, years[years.length - 1] - years[0])) * (Rr - L);
  const yv = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(L, Math.round(yv(0)) + 0.5); ctx.lineTo(Rr, Math.round(yv(0)) + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let pen = false;
  an.forEach((v, k) => { if (!Number.isFinite(v)) { pen = false; return; } pen ? ctx.lineTo(x(years[k]), yv(v)) : ctx.moveTo(x(years[k]), yv(v)); pen = true; });
  ctx.stroke();
  if (Number.isFinite(trend?.slope)) {
    const ym = years.reduce((a, b) => a + b, 0) / years.length;
    const f = (yr) => trend.slope * (yr - ym);
    ctx.strokeStyle = "#d62728";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x(years[0]), yv(f(years[0]))); ctx.lineTo(x(years.at(-1)), yv(f(years.at(-1)))); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, B + 3);
  ctx.fillStyle = "#333";
  ctx.font = FONT;
  ctx.textAlign = "center";
  for (const yr of [1980, 2000, 2020]) if (yr >= years[0] && yr <= years.at(-1)) {
    ctx.textAlign = x(yr) < 20 ? "left" : x(yr) > W - 20 ? "right" : "center";
    ctx.fillText(String(yr), x(yr) < 20 ? 2 : x(yr), H - 3);
    ctx.fillRect(Math.round(x(yr)), B + 3, 1, -4);
  }
}

function atlas(app, el) {
  const s = app.state, R = app.R;
  const key = JSON.stringify(["at", s.months, s.hatch]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const items = R.atlas;
  el.innerHTML = `<div class="panels">${items.map((it, k) => `<button class="pnl" data-id="${it.id}">
      <div class="pt"><span>${esc(varStyle(it.id).short)}</span><span class="v" data-scale="${k}"></span></div>
      <canvas data-k="${k}"></canvas>
    </button>`).join("")}</div>
    <p class="sheet-note">Least-squares trend in every grid cell, ${esc(seasonCode(s.months))}, 1980–2025. Each panel has its own symmetric scale (red: rising, blue: falling; for sea ice and snow the colors are reversed so blue means more). Hatched: not significant (p ≥ 0.05). Click a panel to open it.</p>`;
  el.querySelectorAll(".pnl").forEach((b) => b.addEventListener("click", () => actions.set({ mode: "map", variable: b.dataset.id, layerView: "trend", regionId: "global", custom: null })));
  let k = 0;
  const next = () => {
    if (k >= items.length || el.dataset.key !== key) return;
    drawAtlas(app, el, items[k], k);
    k++;
    setTimeout(next, 10);
  };
  requestAnimationFrame(next);
}

function drawAtlas(app, el, it, k) {
  const cv = el.querySelector(`canvas[data-k="${k}"]`);
  if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = cv.clientWidth || 220, H = Math.round(W / 2);
  cv.style.height = H + "px";
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = it.v.entry.grid, tm = it.tm;
  const tr = trendRamp(it.id), lut = rampLUT(tr.ramp, { flip: tr.flip });
  const vals = [];
  for (const x of tm.slope) if (Number.isFinite(x)) vals.push(Math.abs(x));
  vals.sort((a, b) => a - b);
  let mx = vals[Math.floor(vals.length * 0.98)] || 1;
  const p10 = Math.pow(10, Math.floor(Math.log10(mx)));
  mx = Math.ceil(mx / p10 * 2) / 2 * p10;
  const L = 12;
  const proj = d3.geoEquirectangular().fitSize([W, H], { type: "Sphere" });
  const img = ctx.createImageData(W * dpr, H * dpr);
  const hatch = app.state.hatch;
  for (let py = 0; py < H * dpr; py++) {
    const lat = 90 - ((py + 0.5) / (H * dpr)) * 180;
    const i = Math.round((lat - g.lat0) / g.dlat);
    for (let px = 0; px < W * dpr; px++) {
      const o = (py * W * dpr + px) * 4;
      const lon = -180 + ((px + 0.5) / (W * dpr)) * 360;
      let r = 214, gg = 214, b = 214;
      if (i >= 0 && i < g.nlat) {
        const j = ((Math.round((lon - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
        const c = i * g.nlon + j, sl = tm.slope[c], p = tm.p[c];
        if (Number.isFinite(sl)) {
          const t = Math.max(0, Math.min(1, (sl / mx) * 0.5 + 0.5));
          const q = Math.min(L - 1, Math.floor(t * L));
          const li = Math.round(((q + 0.5) / L) * 255) * 4;
          r = lut[li]; gg = lut[li + 1]; b = lut[li + 2];
          if (hatch && !(p < 0.05)) {
            r = r + (237 - r) * 0.62; gg = gg + (237 - gg) * 0.62; b = b + (237 - b) * 0.62;
            if ((px + py) % Math.round(6 * dpr) < dpr) { r *= 0.6; gg *= 0.6; b *= 0.6; }
          }
        }
      }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const world = app.map.world;
  if (world) {
    ctx.beginPath();
    d3.geoPath(proj, ctx)(world.land110);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  const { factor, label } = E.displayUnits(unitsOf(it.id));
  const sc = el.querySelector(`[data-scale="${k}"]`);
  if (sc) sc.textContent = `±${fmtNum(mx * 10 * factor, 2)} ${label}/dec`;
}
