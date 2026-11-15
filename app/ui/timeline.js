// Bottom timeline: play/pause, a scrubbable track with a sparkline of the
// current story, decade ticks, speed and cadence switches.
// Written with Claude and reviewed by the team.

import { ICONS } from "./icons.js";

export class Timeline {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.n = 1;
    this.t = 0;
    this.labels = [];
    this.spark = null;
    this.playing = false;
    el.innerHTML = `
      <button class="play" id="tlPlay" title="Play / pause (space)">${ICONS.play}</button>
      <div class="track" id="tlTrack"><canvas></canvas></div>
      <div class="tl-right">
        <div class="seg" id="tlSpeed" title="Playback speed">
          <button data-v="0.5">½×</button><button data-v="1" class="on">1×</button><button data-v="2">2×</button><button data-v="4">4×</button>
        </div>
        <div class="seg" id="tlCadence" title="Step by year (season mean) or by month">
          <button data-v="annual" class="on">Years</button><button data-v="monthly">Months</button>
        </div>
      </div>`;
    this.canvas = el.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.playBtn = el.querySelector("#tlPlay");
    this.playBtn.addEventListener("click", () => this.h.onPlay?.(!this.playing));
    el.querySelector("#tlSpeed").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("#tlSpeed button").forEach((x) => x.classList.toggle("on", x === b));
      this.h.onSpeed?.(Number(b.dataset.v));
    });
    el.querySelector("#tlCadence").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.h.onCadence?.(b.dataset.v);
    });
    const track = el.querySelector("#tlTrack");
    let drag = false;
    const seek = (e) => {
      const r = track.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left - this.padL) / (r.width - this.padL - this.padR)));
      this.h.onSeek?.(f * (this.n - 1));
    };
    track.addEventListener("pointerdown", (e) => { drag = true; track.setPointerCapture(e.pointerId); seek(e); });
    track.addEventListener("pointermove", (e) => {
      const r = track.getBoundingClientRect();
      const f = (e.clientX - r.left - this.padL) / (r.width - this.padL - this.padR);
      this.hoverT = f >= 0 && f <= 1 ? f * (this.n - 1) : null;
      if (drag) seek(e); else this.draw();
    });
    track.addEventListener("pointerleave", () => { this.hoverT = null; this.draw(); });
    track.addEventListener("pointerup", () => { drag = false; });
    new ResizeObserver(() => this.draw()).observe(track);
    this.padL = 10; this.padR = 10;
  }

  setCadence(c) {
    this.el.querySelectorAll("#tlCadence button").forEach((x) => x.classList.toggle("on", x.dataset.v === c));
  }

  setRange(labels, ticks) {
    this.labels = labels;
    this.n = Math.max(1, labels.length);
    this.ticks = ticks;
    this.draw();
  }

  setSpark(values, color = "#ff8a3d") {
    this.spark = values ? { values, color } : null;
    this.draw();
  }

  setValue(t) { this.t = t; this.draw(); }

  setPlaying(p) {
    this.playing = p;
    this.playBtn.innerHTML = p ? ICONS.pause : ICONS.play;
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const r = c.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    ctx.clearRect(0, 0, w, h);
    const L = this.padL, R = w - this.padR, base = h - 16;
    const xOf = (t) => L + (this.n > 1 ? (t / (this.n - 1)) * (R - L) : 0);

    // Sparkline area
    if (this.spark && this.spark.values.length > 1) {
      const vals = this.spark.values;
      let lo = Infinity, hi = -Infinity;
      for (const v of vals) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi > lo) {
        const yOf = (v) => base - 4 - ((v - lo) / (hi - lo)) * (base - 10);
        const m = vals.length;
        const xs = (k) => L + (m > 1 ? (k / (m - 1)) * (R - L) : 0);
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < m; k++) {
          if (!Number.isFinite(vals[k])) continue;
          if (!started) { ctx.moveTo(xs(k), yOf(vals[k])); started = true; } else ctx.lineTo(xs(k), yOf(vals[k]));
        }
        const grad = ctx.createLinearGradient(0, 4, 0, base);
        grad.addColorStop(0, hexA(this.spark.color, 0.32));
        grad.addColorStop(1, hexA(this.spark.color, 0));
        ctx.strokeStyle = hexA(this.spark.color, 0.85);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.lineTo(xs(m - 1), base);
        ctx.lineTo(xs(0), base);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    // Base line and played portion
    ctx.fillStyle = "rgba(148,163,184,0.18)";
    ctx.fillRect(L, base, R - L, 2);
    const px = xOf(this.t);
    const g = ctx.createLinearGradient(L, 0, px, 0);
    g.addColorStop(0, "rgba(255,138,61,0.25)");
    g.addColorStop(1, "rgba(255,138,61,1)");
    ctx.fillStyle = g;
    ctx.fillRect(L, base, Math.max(0, px - L), 2);

    // Ticks
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    for (const tk of this.ticks ?? []) {
      const x = xOf(tk.i);
      ctx.fillStyle = "rgba(148,163,184,0.45)";
      ctx.fillRect(x - 0.5, base - 3, 1, 7);
      ctx.fillStyle = "rgba(139,152,173,0.85)";
      ctx.fillText(tk.label, x, h - 2);
    }

    // Hover
    if (this.hoverT != null) {
      const x = xOf(this.hoverT);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x - 0.5, 4, 1, base - 4);
      const lab = this.labels[Math.round(this.hoverT)] ?? "";
      bubble(ctx, lab, x, 12, "rgba(255,255,255,0.12)", "#e8eef7");
    }

    // Playhead
    ctx.shadowColor = "rgba(255,138,61,0.9)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff8a3d";
    ctx.fillRect(px - 1, 4, 2, base - 2);
    ctx.beginPath();
    ctx.arc(px, base + 1, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ff8a3d";
    ctx.stroke();
    const lab = this.labels[Math.round(this.t)] ?? "";
    if (this.hoverT == null) bubble(ctx, lab, px, 12, "#ff8a3d", "#1b0b02");
  }
}

function bubble(ctx, text, x, y, bg, fg) {
  ctx.font = "600 10.5px JetBrains Mono, monospace";
  const w = ctx.measureText(text).width + 12;
  const bx = Math.max(2, Math.min(ctx.canvas.width / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1) - w - 2, x - w / 2));
  ctx.fillStyle = bg;
  roundRect(ctx, bx, y - 9, w, 17, 5);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.fillText(text, bx + 6, y + 3.5);
  ctx.textAlign = "center";
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

function hexA(hex, a) {
  if (hex.startsWith("rgb")) return hex.replace(/rgba?\(([^)]+)\)/, (_, inner) => `rgba(${inner.split(",").slice(0, 3).join(",")},${a})`);
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
