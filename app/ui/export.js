// "Export case file": composes the current map, chart and verdict into a
// shareable PNG styled like a detective's case file.
// Written with Claude and reviewed by the team.

import { defOf, monthsLabel } from "../main.js";

export async function exportCaseFile(app) {
  const s = app.state, R = app.R;
  if (!R.v) return;
  await document.fonts?.ready;
  const W = 1600, H = 1000;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // Paper
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b111d"); bg.addColorStop(1, "#060a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(148,163,184,0.06)";
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Header
  const id = "TD-" + hash(location.hash).toString(36).toUpperCase().slice(0, 6);
  ctx.fillStyle = "#ff8a3d";
  ctx.font = "700 15px JetBrains Mono";
  ctx.fillText(`CASE FILE ${id}`, 56, 62);
  ctx.fillStyle = "#8b98ad";
  ctx.font = "500 14px JetBrains Mono";
  ctx.fillText(`TREND DETECTIVE · NASA MERRA-2 · ${new Date().toISOString().slice(0, 10)}`, 260, 62);
  ctx.fillStyle = "rgba(255,138,61,0.6)";
  ctx.fillRect(56, 78, W - 112, 2);

  // Title
  const def = defOf(s.variable);
  const title = s.prompt ?? `${def.name} · ${R.region.name}`;
  ctx.fillStyle = "#ffffff";
  ctx.font = "400 46px 'Instrument Serif'";
  wrap(ctx, title, 56, 136, 1000, 50, 2);
  ctx.fillStyle = "#8b98ad";
  ctx.font = "500 15px JetBrains Mono";
  ctx.fillText(`${def.name.toUpperCase()} · ${R.region.name.toUpperCase()} · ${monthsLabel(s.months).toUpperCase()} · ${R.annual.years[0]}–${R.annual.years.at(-1)} · MODE: ${s.mode.toUpperCase()}`, 56, 228);

  // Map
  const snap = app.map.snapshot();
  const mx = 56, my = 252, mw = 980, mh = 560;
  ctx.save();
  roundRect(ctx, mx, my, mw, mh, 16);
  ctx.clip();
  ctx.fillStyle = "#04070d";
  ctx.fillRect(mx, my, mw, mh);
  const sc = Math.max(mw / snap.width, mh / snap.height);
  const dw = snap.width * sc, dh = snap.height * sc;
  ctx.drawImage(snap, mx + (mw - dw) / 2, my + (mh - dh) / 2, dw, dh);
  ctx.restore();
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  roundRect(ctx, mx, my, mw, mh, 16);
  ctx.stroke();
  ctx.fillStyle = "rgba(4,7,13,0.75)";
  roundRect(ctx, mx + 16, my + 16, 150, 44, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "300 30px JetBrains Mono";
  ctx.fillText(document.getElementById("hudYear")?.textContent?.slice(0, 4) ?? "", mx + 30, my + 49);

  // Verdict column
  const vx = 1080;
  const v = verdictNumbers(app);
  ctx.fillStyle = "#5b6679";
  ctx.font = "600 13px JetBrains Mono";
  ctx.fillText(v.heading.toUpperCase(), vx, 276);
  ctx.fillStyle = v.up ? "#ffd2b0" : "#bfe9ff";
  ctx.font = "500 58px JetBrains Mono";
  ctx.fillText(v.big, vx, 344);
  ctx.fillStyle = "#8b98ad";
  ctx.font = "500 16px JetBrains Mono";
  ctx.fillText(v.unit, vx, 374);
  ctx.font = "14px JetBrains Mono";
  wrap(ctx, v.small, vx, 410, 460, 22, 3);
  stamp(ctx, v.level, vx + 300, 300);
  ctx.fillStyle = "#cfd8e6";
  ctx.font = "17px Inter";
  wrap(ctx, v.sentence, vx, 500, 464, 27, 9);

  // Chart
  const chartCanvas = document.querySelector("#evChart canvas");
  if (chartCanvas) {
    const cy = 760, ch = 180, cw = 464;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    roundRect(ctx, vx - 12, cy - 12, cw + 24, ch + 24, 12);
    ctx.fill();
    const s2 = Math.min(cw / chartCanvas.width, ch / chartCanvas.height);
    ctx.drawImage(chartCanvas, vx, cy, chartCanvas.width * s2, chartCanvas.height * s2);
  }

  // Footer
  ctx.fillStyle = "#5b6679";
  ctx.font = "13px JetBrains Mono";
  ctx.fillText("Data: NASA MERRA-2 (GMAO, GES DISC), doi:10.5067/AP1B0BA5PD2K and companions · Tests: OLS t-test + Mann–Kendall (autocorrelation-corrected)", 56, 850);
  ctx.fillText("Made with Trend Detective · NASA Space Apps 2026 · Not affiliated with NASA · Code written with Claude and reviewed by the team", 56, 874);
  ctx.fillStyle = "#8b98ad";
  ctx.font = "13px JetBrains Mono";
  wrap(ctx, location.href, 56, 910, 980, 18, 2);

  c.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trend-detective-${s.mode}-${s.variable}-${R.region.id ?? "region"}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

function verdictNumbers(app) {
  const s = app.state, R = app.R;
  const sg = (x, d = 2) => (Number.isFinite(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toPrecision(d) : "–");
  if (s.mode === "band" && R.bandSummary) {
    const b = R.bandSummary;
    return { heading: "Shift verdict", big: sg(b.edgeShiftKmPerDecade, 2), unit: "km per decade (positive = poleward)", small: `Zone area ${sg(b.areaPctPerDecade)}% per decade · kind: ${b.kind}`, level: b.level, sentence: b.sentence, up: b.edgeShiftKmPerDecade > 0 };
  }
  if (s.mode === "route" && R.routeVerdict) {
    const v = R.routeVerdict;
    return { heading: `Open months · ${R.route.name}`, big: sg(v.perDecade, 2), unit: "months open per decade", small: `t-test p=${fmtP(v.pT)} · Mann–Kendall p=${fmtP(v.pMK)} · ${v.n} years`, level: v.level, sentence: v.sentence.replace(/percentage points/g, "months"), up: v.perDecade > 0 };
  }
  if (s.mode === "twin" && R.twin) {
    const t = R.twin.thenNow;
    return { heading: `Climate twin · ${R.home.name ?? ""}`, big: `${Math.round(t.distKm)} km`, unit: `toward the ${t.bearingName}`, small: `Match quality: ${t.quality} · ${R.twin.periods.base.join("–")} climate found in ${R.twin.periods.recent.join("–")}`, level: t.quality === "good" ? "significant" : t.quality === "fair" ? "suggestive" : "none", sentence: `The 1980s climate of ${R.home.name ?? "this place"} (mean temperature, seasonal swing, rainfall) is now found about ${Math.round(t.distKm)} km ${t.bearingName}. Its present climate existed ${Math.round(R.twin.nowWas.distKm)} km ${R.twin.nowWas.bearingName} in the 1980s.`, up: true };
  }
  const v = R.verdict;
  const f = v.perDecade;
  const unit = (window.TD.catalog.variables.find((x) => x.id === s.variable)?.units ?? "");
  const pct = /0 to 1/.test(unit);
  return { heading: "Rate of change", big: sg(pct ? f * 100 : f, 2), unit: `${pct ? "percentage points" : unit} per decade`, small: `95% range ${sg((pct ? 100 : 1) * v.ci95PerDecade[0])} to ${sg((pct ? 100 : 1) * v.ci95PerDecade[1])} · t-test p=${fmtP(v.pT)} · Mann–Kendall p=${fmtP(v.pMK)} · ${v.n} years`, level: v.level, sentence: v.sentence, up: f > 0 };
}

const fmtP = (p) => (!Number.isFinite(p) ? "?" : p < 0.001 ? "<0.001" : p.toFixed(3));

function stamp(ctx, level, x, y) {
  const text = level === "significant" ? "SIGNIFICANT" : level === "suggestive" ? "SUGGESTIVE" : "NOT PROVEN";
  const color = level === "significant" ? "#ff5d5d" : level === "suggestive" ? "#ffb020" : "#8b98ad";
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.16);
  ctx.font = "700 24px JetBrains Mono";
  const w = ctx.measureText(text).width + 30;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  roundRect(ctx, -w / 2, -26, w, 50, 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, 0, 8);
  // ink speckle
  ctx.globalCompositeOperation = "destination-out";
  for (let k = 0; k < 140; k++) {
    ctx.beginPath();
    ctx.arc((Math.random() - 0.5) * w, (Math.random() - 0.5) * 50, Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function wrap(ctx, text, x, y, maxW, lh, maxLines = 10) {
  const words = String(text).split(/\s+/);
  let line = "", n = 0;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lh);
      line = w;
      n++;
      if (n >= maxLines - 1) { line = words.slice(words.indexOf(w)).join(" "); break; }
    } else line = test;
  }
  if (line) {
    while (ctx.measureText(line).width > maxW && line.length > 4) line = line.slice(0, -5) + "…";
    ctx.fillText(line, x, y + n * lh);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hash(s) {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
