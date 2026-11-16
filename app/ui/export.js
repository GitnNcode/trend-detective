// Export the current display as a plain figure PNG: title, map, colorbar
// and a one-line statistics caption, like a printed analysis chart.
// Written with Claude and reviewed by the team.

import { app, defOf, unitsOf, seasonCode } from "../main.js";
import { analogKm } from "./inspector.js";

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export function exportPlot(app) {
  const s = app.state, R = app.R;
  if (!R.v) return;
  const map = app.map.snapshot();
  const cb = document.querySelector("#colorbar canvas");
  const dpr = app.map.dpr;
  const W = map.width, pad = Math.round(16 * dpr);
  const titleH = Math.round(40 * dpr), capH = Math.round(54 * dpr);
  const cbH = cb ? cb.height : 0;
  const c = document.createElement("canvas");
  c.width = W; c.height = titleH + map.height + cbH + capH;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  const title = document.querySelector("#figTitle .t")?.textContent ?? defOf(s.variable).name;
  const year = document.getElementById("legendYear")?.textContent ?? "";
  ctx.fillStyle = "#111";
  ctx.font = `600 ${Math.round(15 * dpr)}px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillText(title, pad, titleH / 2);
  ctx.textAlign = "right";
  ctx.font = `700 ${Math.round(20 * dpr)}px ${SANS}`;
  ctx.fillText(year, W - pad, titleH / 2);
  ctx.textAlign = "left";
  ctx.drawImage(map, 0, titleH);
  if (cb) ctx.drawImage(cb, 0, titleH + map.height, cb.width * (W / cb.width), cb.height);
  ctx.fillStyle = "#333";
  ctx.font = `${Math.round(12 * dpr)}px ${SANS}`;
  const y0 = titleH + map.height + cbH + capH * 0.38;
  ctx.fillText(statsLine(app), pad, y0);
  ctx.fillStyle = "#777";
  ctx.font = `${Math.round(10.5 * dpr)}px ${SANS}`;
  ctx.fillText(`Data: NASA MERRA-2 monthly means (GMAO, GES DISC), ${R.v.entry.source}. Trend Detective, NASA Space Apps 2026.`, pad, y0 + 20 * dpr);
  c.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trend-detective_${s.mode}_${s.variable}_${(R.region.id ?? "region").replace(/[^a-z0-9_]/gi, "")}_${seasonCode(s.months)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

function statsLine(app) {
  const s = app.state, R = app.R;
  const pf = (p) => (!Number.isFinite(p) ? "n/a" : p < 0.001 ? "<0.001" : p.toFixed(3));
  const sg = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + x.toPrecision(2) : "n/a");
  const lvl = (l) => (l === "significant" ? "significant" : l === "suggestive" ? "suggestive" : "not significant");
  if (s.mode === "band" && R.bandSummary) {
    const b = R.bandSummary;
    return `Edge shift ${sg(b.edgeShiftKmPerDecade)} km/decade (poleward +), edge p ${pf(b.edgeP)}; area ${sg(b.areaPctPerDecade)} %/decade, p ${pf(b.areaP)}; ${b.kind}, ${lvl(b.level)}; n = ${R.track.years.length} years.`;
  }
  if (s.mode === "ship" && s.voy && app.voyage?.options?.[0]) {
    const v = s.voy, V = app.voyage, b = V.options[0];
    return `${v.from.name} to ${v.to.name}, ${v.cls} at ${v.speedKn} kn, ${V.year}-${String(v.month).padStart(2, "0")}: ${b.days.toFixed(1)} days via ${b.via.join(", ") || "open sea"}, ${Math.round(b.km)} km, about $${(b.cost / 1e6).toFixed(2)}M, ${Math.round(b.fuelT)} t fuel, ${Math.round(b.co2T)} t CO2 (MERRA-2 wind and ice, ECCO currents).`;
  }
  if (s.mode === "ship" && R.ship) {
    const sh = R.ship, y = sh.years.length - 1;
    const arctic = (v) => v.includes("Northern Sea Route") || v.includes("Northwest Passage");
    const n = sh.lanes.filter((l) => arctic(l.via[y])).length, f = sh.forecast.lanes.filter((l) => arctic(l.via.at(-1) ?? [])).length;
    return `Fastest sea routes for ${sh.lanes.length} lanes, ${sh.years[0]}-${sh.years[y]}: ${n} use an Arctic route in ${sh.years[y]}${sh.forecast.years.length ? `, ${f} in the ${sh.forecast.years.at(-1)} projection` : ""} (MERRA-2 sea ice${sh.inputs.wind ? " and 10 m wind" : ""}).`;
  }
  if (s.mode === "route" && R.routeVerdict) {
    const v = R.routeVerdict;
    return `Open-water months ${sg(v.perDecade)} per decade (95%: ${sg(v.ci95PerDecade[0])} to ${sg(v.ci95PerDecade[1])}); t-test p ${pf(v.pT)}; Mann–Kendall p ${pf(v.pMK)}; ${lvl(v.level)}; n = ${v.n}.${bestLine(R.bestPath)}`;
  }
  if (s.mode === "flow" && R.flowSummary) return `Climate velocity: median ${R.flowSummary.medianKmPerDecade.toPrecision(3)} km/decade, mean ${R.flowSummary.meanKmPerDecade.toPrecision(3)} km/decade over the region.`;
  if (s.mode === "twin" && R.twin) {
    const t = R.twin.thenNow, n = R.twin.nowWas;
    return `1980s climate now ${analogKm(t) != null ? "about " + analogKm(t) + " km " + t.bearingName : "has no close match"} (${t.quality}); today's climate was ${analogKm(n) != null ? "about " + analogKm(n) + " km " + n.bearingName : "not closely matched"} in the 1980s (${n.quality}).`;
  }
  const v = R.verdict;
  const pct = /0 to 1/.test(unitsOf(s.variable));
  const f = pct ? 100 : 1, u = pct ? "pp" : unitsOf(s.variable);
  return `Trend ${sg(v.perDecade * f)} ${u}/decade (95%: ${sg(v.ci95PerDecade[0] * f)} to ${sg(v.ci95PerDecade[1] * f)}); t-test p ${pf(v.pT)}; Mann–Kendall p ${pf(v.pMK)}; ${lvl(v.level)}; n = ${v.n} years.`;
}

// Sea-ice route: the latest year's shortest open-water path, if any.
function bestLine(bp) {
  const k = bp ? bp.years.findLastIndex((_, i) => Number.isFinite(bp.lengthKm[i])) : -1;
  return k < 0 ? "" : ` Shortest open path ${Math.round(bp.lengthKm[k])} km in ${bp.years[k]} (fixed route ${Math.round(bp.fixedKm)} km).`;
}
