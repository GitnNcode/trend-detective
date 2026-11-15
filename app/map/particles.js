// Climate-velocity particles: thousands of short-lived tracers that drift in
// the direction a fixed value (an isotherm, an isohyet...) is moving, with
// speed shown by color and pace. Written with Claude and reviewed by the team.

const RAD = Math.PI / 180;
const COLORS = ["#3aa8ff", "#4cc9ff", "#7fe0d0", "#c8e66a", "#ffd166", "#ffa94d", "#ff7a3d", "#ff4b2e"];

export class Particles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = false;
    this.field = null;
    this.parts = [];
    this.sig = "";
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.clear();
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // field: { u, v, speed (km/yr), grid, cap }
  setField(field) {
    this.field = field;
    this.enabled = !!field;
    this.parts = [];
    this.clear();
    if (!field) return;
    let s0 = field.medianSpeed;
    if (!(s0 > 0)) s0 = 1;
    this.s0 = s0;
    this.logCap = Math.log(1 + (field.cap || s0 * 20) / s0);
  }

  _sample(lat, lon) {
    const f = this.field, g = f.grid;
    const fi = (lat - g.lat0) / g.dlat;
    if (fi < 0 || fi > g.nlat - 1) return null;
    const fj = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon;
    const i0 = Math.floor(fi), i1 = Math.min(g.nlat - 1, i0 + 1);
    const j0 = Math.floor(fj) % g.nlon, j1 = (j0 + 1) % g.nlon;
    const fy = fi - i0, fx = fj - Math.floor(fj);
    let u = 0, v = 0, s = 0, w = 0;
    const add = (i, j, wt) => {
      const c = i * g.nlon + j;
      const uu = f.u[c], vv = f.v[c], ss = f.speed[c];
      if (uu === uu && vv === vv && ss === ss) { u += uu * wt; v += vv * wt; s += ss * wt; w += wt; }
    };
    add(i0, j0, (1 - fx) * (1 - fy)); add(i0, j1, fx * (1 - fy)); add(i1, j0, (1 - fx) * fy); add(i1, j1, fx * fy);
    if (w < 0.5) return null;
    return { u: u / w, v: v / w, s: s / w };
  }

  _spawn(proj, kind) {
    for (let tries = 0; tries < 12; tries++) {
      const x = Math.random() * this.w, y = Math.random() * this.h;
      const ll = proj.invert([x, y]);
      if (!ll || !Number.isFinite(ll[0])) continue;
      const back = proj(ll);
      if (!back || Math.abs(back[0] - x) > 1 || Math.abs(back[1] - y) > 1) continue;
      if (kind === "flat" && (ll[0] < -180 || ll[0] > 180)) continue;
      if (!this._sample(ll[1], ll[0])) continue;
      return { lon: ll[0], lat: ll[1], age: Math.floor(Math.random() * 60), max: 50 + Math.random() * 60 };
    }
    return null;
  }

  step(proj, dt, kind) {
    if (!this.enabled || !this.field) return;
    const ctx = this.ctx, dpr = this.dpr;
    const sig = proj.rotate().join(",") + "|" + proj.scale().toFixed(2) + "|" + proj.translate().join(",");
    if (sig !== this.sig) { this.clear(); this.sig = sig; }
    const target = Math.round(Math.min(5200, Math.max(1500, (this.w * this.h) / 260)));
    while (this.parts.length < target) {
      const p = this._spawn(proj, kind);
      if (!p) break;
      this.parts.push(p);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.915)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.15;
    ctx.lineCap = "round";
    const buckets = COLORS.map(() => []);
    const degPerPx = 1 / (proj.scale() * RAD);
    for (let k = 0; k < this.parts.length; k++) {
      const p = this.parts[k];
      const smp = this._sample(p.lat, p.lon);
      if (!smp || p.age++ > p.max) {
        const np = this._spawn(proj, kind);
        if (np) this.parts[k] = np; else { this.parts.splice(k, 1); k--; }
        continue;
      }
      const mag = Math.hypot(smp.u, smp.v);
      if (!(mag > 0)) { p.age = p.max + 1; continue; }
      const t = Math.min(1, Math.log(1 + smp.s / this.s0) / this.logCap);
      const px = 0.35 + 2.4 * t;
      const stepDeg = px * degPerPx;
      const nlat = p.lat + (smp.v / mag) * stepDeg;
      const nlon = p.lon + ((smp.u / mag) * stepDeg) / Math.max(0.15, Math.cos(p.lat * RAD));
      const a = proj([p.lon, p.lat]), b = proj([nlon, nlat]);
      p.lat = Math.max(-89.5, Math.min(89.5, nlat));
      p.lon = ((((nlon + 180) % 360) + 360) % 360) - 180;
      if (!a || !b || Math.abs(b[0] - a[0]) > 40) continue;
      buckets[Math.min(COLORS.length - 1, Math.floor(t * COLORS.length))].push(a[0], a[1], b[0], b[1]);
    }
    for (let c = 0; c < COLORS.length; c++) {
      const seg = buckets[c];
      if (!seg.length) continue;
      ctx.beginPath();
      for (let k = 0; k < seg.length; k += 4) { ctx.moveTo(seg[k], seg[k + 1]); ctx.lineTo(seg[k + 2], seg[k + 3]); }
      ctx.strokeStyle = COLORS[c];
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
