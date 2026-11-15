// Full-stage sheets: the suspect lineup (all 10 variables tested for one
// region) and the planet-scan atlas (every variable's trend map).
// Written with Claude and reviewed by the team.

import * as d3 from "d3";
import { actions, defOf, monthsLabel, unitsOf } from "../main.js";
import { varStyle, rampLUT, trendRamp } from "../palettes.js";
import * as E from "../../engine/index.js";
import { fmtNum } from "./panels.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const signed = (x, sig = 2) => (Number.isFinite(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + fmtNum(Math.abs(x), sig) : "–");

export function renderSheet(app) {
  const el = document.getElementById("sheet");
  const s = app.state, R = app.R;
  if (s.view !== "app" || !["lineup", "atlas"].includes(s.mode)) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (s.mode === "lineup" && R.lineup) lineup(app, el);
  if (s.mode === "atlas" && R.atlas) atlas(app, el);
}

function lineup(app, el) {
  const s = app.state, R = app.R;
  const key = JSON.stringify(["lu", R.region.latMin, R.region.lonMin, R.region.latMax, R.region.lonMax, s.months]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const list = R.lineup;
  el.innerHTML = `
    <div class="sheet-head">
      <div><h2>The lineup: <em>${esc(R.region.name)}</em></h2>
      <p>Ten suspects, one region, ${esc(monthsLabel(s.months))}, ${list[0]?.annual?.years?.[0] ?? 1980}–${list[0]?.annual?.years?.at(-1) ?? 2025}. Each one is tested with a t-test and an autocorrelation-corrected Mann–Kendall test. The strongest evidence stands on the left.</p></div>
      <button class="btn" id="lineupClose">Back to the map</button>
    </div>
    <div class="lineup-wall">
      ${list.map((x, k) => {
        const st = varStyle(x.id);
        const { factor, label } = E.displayUnits(x.units);
        const vd = x.verdict;
        const lvl = x.empty ? "none" : vd.level;
        return `<button class="suspect ${x.empty ? "empty" : ""} ${k === 0 && !x.empty && lvl === "significant" ? "rank1" : ""}" data-id="${x.id}" style="animation-delay:${k * 60}ms">
          <div class="no">SUSPECT #${String(k + 1).padStart(2, "0")}</div>
          <div class="sn">${esc(defOf(x.id).name)}</div>
          <div class="sr ${vd.perDecade > 0 ? "up" : "down"}">${x.empty ? "no data here" : `${signed(vd.perDecade * factor, 2)} ${esc(label)}/dec`}</div>
          <canvas data-spark="${k}"></canvas>
          ${x.empty ? "" : `<div class="stamp ${lvl}">${lvl === "significant" ? "Significant" : lvl === "suggestive" ? "Suggestive" : "Not proven"}</div>`}
          <div class="small muted" style="margin-top:6px;font-family:var(--font-mono);font-size:10.5px">${x.empty ? "" : `t = ${fmtNum(x.tStat, 2)} · p ${vd.pT < 0.001 ? "< 0.001" : "= " + fmtNum(vd.pT, 2)}`}</div>
        </button>`;
      }).join("")}
    </div>`;
  el.querySelector("#lineupClose").addEventListener("click", () => actions.setMode("series"));
  el.querySelectorAll(".suspect").forEach((b) => b.addEventListener("click", () => { actions.set({ mode: "series", variable: b.dataset.id }); }));
  el.querySelectorAll("canvas[data-spark]").forEach((cv) => {
    const x = list[Number(cv.dataset.spark)];
    if (!x || x.empty) return;
    const color = varStyle(x.id).trend === "wet" ? "#3fd0c9" : varStyle(x.id).trend === "ice" ? "#7cd2ff" : "#ff8a3d";
    if (app.C?.drawSparkline) app.C.drawSparkline(cv, Array.from(x.annual.values), { color, fit: true, width: cv.clientWidth || 140, height: 46 });
  });
}

function atlas(app, el) {
  const s = app.state, R = app.R;
  const key = JSON.stringify(["at", s.months]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const items = R.atlas;
  el.innerHTML = `
    <div class="sheet-head">
      <div><h2>Planet scan: <em>every variable, every cell</em></h2>
      <p>${items.length} variables × ${(items[0].v.entry.grid.nlat * items[0].v.entry.grid.nlon).toLocaleString("en-US")} grid cells, one trend test per cell (${esc(monthsLabel(s.months))}). Faded and hatched cells are not significant. The bar under each map is the share of the area that is significantly rising (orange) or falling (blue).</p></div>
      <button class="btn" id="atlasClose">Back to the map</button>
    </div>
    <div class="atlas-grid">
      ${items.map((it, k) => `<button class="atlas-card" data-id="${it.id}" style="animation-delay:${k * 50}ms">
        <div class="an"><b>${esc(defOf(it.id).name)}</b><span>${esc(unitsOf(it.id))}/decade</span></div>
        <canvas data-k="${k}" width="720" height="360"></canvas>
        <div class="census" data-c="${k}"></div><div class="census-l" data-cl="${k}"></div>
      </button>`).join("")}
    </div>`;
  el.querySelector("#atlasClose").addEventListener("click", () => actions.setMode("map"));
  el.querySelectorAll(".atlas-card").forEach((b) => b.addEventListener("click", () => actions.set({ mode: "map", variable: b.dataset.id, layerView: "trend", regionId: "global", custom: null })));
  // Render maps progressively so the page stays responsive.
  let k = 0;
  const next = () => {
    if (k >= items.length || el.dataset.key !== key) return;
    drawAtlasCard(app, el, items[k], k);
    k++;
    setTimeout(next, 16);
  };
  next();
}

function drawAtlasCard(app, el, it, k) {
  const cv = el.querySelector(`canvas[data-k="${k}"]`);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const g = it.v.entry.grid, tm = it.tm;
  const tr = trendRamp(it.id);
  const lut = rampLUT(tr.ramp, { flip: tr.flip });
  const vals = [];
  for (const x of tm.slope) if (Number.isFinite(x)) vals.push(Math.abs(x));
  vals.sort((a, b) => a - b);
  const mx = vals[Math.floor(vals.length * 0.98)] || 1;
  // Paint the grid at native resolution, then scale it up smoothly.
  const src = document.createElement("canvas");
  src.width = g.nlon; src.height = g.nlat;
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(g.nlon, g.nlat);
  let up = 0, down = 0, tot = 0;
  const areas = E.rowAreasKm2(g);
  for (let i = 0; i < g.nlat; i++) {
    for (let j = 0; j < g.nlon; j++) {
      const c = i * g.nlon + j;
      const row = g.nlat - 1 - i;
      const o = (row * g.nlon + j) * 4;
      const sl = tm.slope[c], p = tm.p[c];
      if (!Number.isFinite(sl)) { img.data[o] = 9; img.data[o + 1] = 13; img.data[o + 2] = 22; img.data[o + 3] = 255; continue; }
      tot += areas[i];
      if (p < 0.05) (sl > 0 ? (up += areas[i]) : (down += areas[i]));
      const t = Math.max(0, Math.min(255, Math.round((sl / mx * 0.5 + 0.5) * 255)));
      let r = lut[t * 4], gg = lut[t * 4 + 1], b = lut[t * 4 + 2];
      if (!(p < 0.05)) { const l = 0.3 * r + 0.59 * gg + 0.11 * b; r = (l * 0.7 + r * 0.3) * 0.55; gg = (l * 0.7 + gg * 0.3) * 0.55; b = (l * 0.7 + b * 0.3) * 0.55; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // seaice covers only 50-90N: place it in its latitude band.
  const y0 = ((90 - (g.lat0 + (g.nlat - 1) * g.dlat + g.dlat / 2)) / 180) * H;
  const y1 = ((90 - (g.lat0 - g.dlat / 2)) / 180) * H;
  ctx.fillStyle = "#05080f";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, 0, Math.max(0, y0), W, Math.min(H, y1) - Math.max(0, y0));
  const world = app.map.world;
  if (world) {
    const proj = d3.geoEquirectangular().fitSize([W, H], { type: "Sphere" });
    const path = d3.geoPath(proj, ctx);
    ctx.beginPath();
    path(world.land110);
    ctx.strokeStyle = "rgba(235,242,250,0.55)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  const cen = el.querySelector(`[data-c="${k}"]`), cl = el.querySelector(`[data-cl="${k}"]`);
  const fu = up / (tot || 1), fd = down / (tot || 1);
  cen.innerHTML = `<i style="width:${fd * 100}%;background:#4cc9ff"></i><i style="width:${(1 - fu - fd) * 100}%;background:rgba(255,255,255,0.1)"></i><i style="width:${fu * 100}%;background:#ff8a3d"></i>`;
  cl.innerHTML = `<span>${Math.round(fd * 100)}% falling</span><span>±${fmtNum(mx * 10, 2)} scale</span><span>${Math.round(fu * 100)}% rising</span>`;
}
