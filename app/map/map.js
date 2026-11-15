// MapView: projections, interaction, the vector overlay (coastlines,
// graticule, region box, routes, hurricane-style track, cone, arrows, pins)
// and the render loop that drives the WebGL field renderer and particles.
// Written with Claude and reviewed by the team.

import * as d3 from "d3";
import * as topojson from "topojson-client";
import { FieldRenderer } from "./gl.js";
import { Particles } from "./particles.js";

const RAD = Math.PI / 180;
const WORLD_50 = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json";
const WORLD_110 = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

export class MapView {
  constructor(root, handlers = {}) {
    this.root = root;
    this.h = handlers;
    this.glCanvas = root.querySelector("#glCanvas");
    this.ovCanvas = root.querySelector("#overlayCanvas");
    this.ptCanvas = root.querySelector("#particleCanvas");
    this.ctx = this.ovCanvas.getContext("2d");
    this.gl = new FieldRenderer(this.glCanvas);
    this.particles = new Particles(this.ptCanvas);
    this.base = document.createElement("canvas");
    this.baseCtx = this.base.getContext("2d");

    this.kind = "globe";
    this.view = { lon: -20, lat: 22, zoom: 1 };
    this.offsetX = 0;          // fraction of width to shift the center (landing)
    this.autoRotate = false;
    this.polarSouth = false;
    this.fly = null;
    this.t = 0;
    this.layers = 1;
    this.norm = { min: 0, max: 1 };
    this.style = { cdom: [0, 1], gamma: 1 };
    this.scene = { layer: 0 };
    this.overlay = {};
    this.world = null;
    this.dirty = true;
    this.baseDirty = true;
    this.lowRes = false;
    this.drawMode = false;
    this._last = performance.now();
    this.fadeIn = 0;

    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(root);
    this._resize();
    this._bindPointer();
    requestAnimationFrame((t) => this._tick(t));
  }

  async loadBasemap() {
    try {
      const [land, countries] = await Promise.all([fetch(WORLD_50).then((r) => r.json()), fetch(WORLD_110).then((r) => r.json())]);
      this.world = {
        land: topojson.feature(land, land.objects.land),
        land110: topojson.feature(countries, countries.objects.land),
        borders: topojson.mesh(countries, countries.objects.countries, (a, b) => a !== b),
      };
    } catch (e) {
      console.warn("Basemap unavailable (offline?)", e);
      this.world = null;
    }
    this.baseDirty = true;
    this.requestRender();
  }

  // ---------- projection ----------
  get size() { return { w: this.w, h: this.h }; }

  projection(view = this.view, kind = this.kind) {
    const { w, h } = this;
    const cx = w / 2 + this.offsetX * w, cy = h / 2;
    const m = Math.min(w, h);
    let p;
    if (kind === "globe") {
      p = d3.geoOrthographic().rotate([-view.lon, -view.lat]).scale(m * 0.43 * view.zoom).translate([cx, cy]).clipAngle(90).precision(0.6);
    } else if (kind === "polar") {
      const south = this.polarSouth;
      const clipDeg = 52;
      const k = (m * 0.5 * 0.96) / Math.tan((clipDeg * RAD) / 2) * view.zoom;
      p = d3.geoStereographic().rotate([-view.lon, south ? 90 : -90]).scale(k).translate([cx, cy]).clipAngle(clipDeg).precision(0.6);
      p._clipDeg = clipDeg;
    } else {
      const k = Math.max(w / (2 * Math.PI), h / Math.PI) * view.zoom;
      const maxShift = Math.max(0, (Math.PI / 2) * k - h / 2);
      const ty = cy + clamp(view.lat * RAD * k, -maxShift, maxShift);
      p = d3.geoEquirectangular().rotate([-view.lon, 0]).scale(k).translate([cx, ty]).precision(0.6);
    }
    return p;
  }

  setProjection(kind, { south = false, animate = true } = {}) {
    if (kind === this.kind && south === this.polarSouth) return;
    this.kind = kind;
    this.polarSouth = south;
    if (kind === "polar") this.view = { lon: this.view.lon, lat: south ? -90 : 90, zoom: 1 };
    if (kind === "flat") this.view = { lon: this.view.lon, lat: 0, zoom: 1 };
    if (kind === "globe") this.view = { lon: this.view.lon, lat: clamp(this.view.lat, -60, 60), zoom: 1 };
    this.fly = null;
    if (animate) this.fadeIn = 0;
    this.baseDirty = true;
    this.requestRender();
    this.h.onViewChange?.();
  }

  flyTo(target, ms = 1300) {
    const from = { ...this.view };
    const to = { ...from, ...target };
    let dl = wrapLon(to.lon - from.lon);
    this.fly = { from, to: { ...to, lon: from.lon + dl }, t0: performance.now(), ms };
    this.requestRender();
  }

  // Frame a region in the current projection.
  fitRegion(region, { animate = true } = {}) {
    if (!region) return;
    const latMin = Math.min(region.latMin, region.latMax), latMax = Math.max(region.latMin, region.latMax);
    const span = (((region.lonMax - region.lonMin) % 360) + 360) % 360 || 360;
    const lonMid = wrapLon(region.lonMin + span / 2);
    const latMid = (latMin + latMax) / 2;
    const latSpan = latMax - latMin;
    const global = span >= 359 && latSpan >= 170;
    let target;
    if (this.kind === "globe") {
      const ang = Math.max(latSpan, span * Math.cos(latMid * RAD));
      target = global ? { lon: this.view.lon, lat: 18, zoom: 1 } : { lon: lonMid, lat: clamp(latMid, -70, 70), zoom: clamp(70 / Math.max(ang, 8), 1, 5.5) };
    } else if (this.kind === "flat") {
      target = global ? { lon: 0, lat: 0, zoom: 1 } : { lon: lonMid, lat: latMid, zoom: clamp(Math.min(360 / (span * 1.8), 180 / (latSpan * 2.2)), 1, 9) };
    } else {
      target = { lon: span >= 359 ? this.view.lon : lonMid, zoom: clamp(36 / Math.max(10, 90 - Math.abs(latMin)), 0.75, 2.4) };
    }
    if (animate) this.flyTo(target); else { this.view = { ...this.view, ...target }; this.baseDirty = true; this.requestRender(); }
  }

  // ---------- data ----------
  setField(data, grid, layers, norm) {
    this.gl.setField(data, grid, layers);
    this.grid = grid;
    this.layers = layers;
    this.norm = norm;
    this.requestRender();
  }
  setFieldStyle({ lut, cdom, gamma = 1 }) {
    if (lut) this.gl.setLUT("cmap", lut);
    this.style = { cdom, gamma };
    this.requestRender();
  }
  setAux(data, grid, { lut, gamma = 1 } = {}) {
    this.gl.setAux(data, grid);
    if (lut) this.gl.setLUT("auxCmap", lut);
    this.auxGamma = gamma;
    this.requestRender();
  }
  setDipole(data, grid) { this.gl.setDipole(data, grid); this.requestRender(); }
  setRamps({ rings, zone }) {
    if (rings) this.gl.setLUT("ringRamp", rings);
    if (zone) this.gl.setLUT("zoneRamp", zone);
  }
  setScene(scene) { this.scene = { ...scene }; this.requestRender(); }
  setOverlay(ov) { this.overlay = { ...ov }; this.requestRender(); }
  setTime(t) { this.t = clamp(t, 0, Math.max(0, this.layers - 1)); this.requestRender(); }
  normalize(x) { return (x - this.norm.min) / (this.norm.max - this.norm.min); }

  requestRender() { this.dirty = true; }

  // ---------- events ----------
  _resize() {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.root.dataset.size = this.w < 640 ? "sm" : this.w < 980 ? "md" : "lg";
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl.resize(this.w, this.h, this.dpr);
    for (const c of [this.ovCanvas, this.base]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.particles.resize(this.w, this.h, this.dpr);
    this.baseDirty = true;
    this.requestRender();
  }

  invert(x, y) {
    const p = this.projection();
    const ll = p.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    // Reject points outside the drawn map.
    const back = p(ll);
    if (!back || Math.hypot(back[0] - x, back[1] - y) > 1.5) return null;
    if (this.kind === "polar") {
      const c = d3.geoDistance(ll, [0, this.polarSouth ? -90 : 90]) / RAD;
      if (c > p._clipDeg) return null;
    }
    return { lon: wrapLon(ll[0]), lat: ll[1] };
  }

  _bindPointer() {
    const el = this.root;
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const pt = this._pt(e);
      if (this.drawMode || e.shiftKey) {
        const ll = this.invert(pt.x, pt.y);
        if (ll) { drag = { draw: true, start: ll, sx: pt.x, sy: pt.y, cur: ll }; el.classList.add("drawing"); }
        return;
      }
      drag = { x: pt.x, y: pt.y, sx: pt.x, sy: pt.y, view: { ...this.view }, moved: false, vx: 0, vy: 0, t: performance.now() };
      this.fly = null;
      this.inertia = null;
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      const pt = this._pt(e);
      if (!drag) {
        const ll = this.invert(pt.x, pt.y);
        this.hover = ll ? { ...ll, x: pt.x, y: pt.y } : null;
        this.h.onHover?.(this.hover, pt);
        return;
      }
      if (drag.draw) {
        const ll = this.invert(pt.x, pt.y);
        if (ll) drag.cur = ll;
        this.drawBox = this._boxFrom(drag.start, drag.cur, pt.x >= drag.sx);
        this.requestRender();
        return;
      }
      const dx = pt.x - drag.x, dy = pt.y - drag.y;
      if (Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 3) drag.moved = true;
      const now = performance.now();
      const dt = Math.max(1, now - drag.t);
      drag.vx = dx / dt; drag.vy = dy / dt; drag.t = now;
      drag.x = pt.x; drag.y = pt.y;
      this._panBy(dx, dy, pt);
      this.lowRes = true;
      this.h.onHover?.(null, pt);
    });
    const end = (e) => {
      if (!drag) return;
      el.classList.remove("dragging", "drawing");
      const pt = this._pt(e);
      if (drag.draw) {
        const box = this.drawBox;
        this.drawBox = null;
        if (box && Math.abs(box.latMax - box.latMin) > 1 && Math.abs(pt.x - drag.sx) > 6) this.h.onRegion?.(box);
        drag = null;
        this.requestRender();
        return;
      }
      if (!drag.moved) {
        const ll = this.invert(pt.x, pt.y);
        if (ll) this.h.onClick?.(ll, pt);
      } else if (Math.hypot(drag.vx, drag.vy) > 0.15) {
        this.inertia = { vx: drag.vx * 16, vy: drag.vy * 16 };
      }
      drag = null;
      this.lowRes = false;
      this.baseDirty = true;
      this.requestRender();
      this.h.onViewChange?.();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => { if (!drag) { this.hover = null; this.h.onHover?.(null); } });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0016);
      const lim = this.kind === "flat" ? [1, 14] : this.kind === "globe" ? [0.7, 9] : [0.6, 5];
      const pt = this._pt(e);
      const before = this.kind === "flat" ? this.invert(pt.x, pt.y) : null;
      this.view.zoom = clamp(this.view.zoom * f, lim[0], lim[1]);
      if (before) {
        // Keep the point under the cursor fixed while zooming the flat map.
        const after = this.invert(pt.x, pt.y);
        if (after) { this.view.lon -= wrapLon(after.lon - before.lon); this.view.lat -= after.lat - before.lat; }
      }
      this.fly = null;
      this.baseDirty = true;
      this.requestRender();
      clearTimeout(this._wheelT);
      this.lowRes = true;
      this._wheelT = setTimeout(() => { this.lowRes = false; this.baseDirty = true; this.requestRender(); this.h.onViewChange?.(); }, 160);
    }, { passive: false });
  }

  _pt(e) {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _panBy(dx, dy, pt) {
    const p = this.projection();
    const k = p.scale();
    if (this.kind === "globe") {
      this.view.lon -= (dx / k) / RAD * 0.92;
      this.view.lat = clamp(this.view.lat + (dy / k) / RAD * 0.92, -85, 85);
    } else if (this.kind === "flat") {
      this.view.lon -= (dx / k) / RAD;
      this.view.lat = clamp(this.view.lat + (dy / k) / RAD, -80, 80);
    } else {
      const [cx, cy] = p.translate();
      if (pt) {
        const a1 = Math.atan2(pt.y - dy - cy, pt.x - dx - cx), a2 = Math.atan2(pt.y - cy, pt.x - cx);
        this.view.lon += ((a2 - a1) / RAD) * (this.polarSouth ? -1 : 1);
      }
    }
    this.view.lon = wrapLon(this.view.lon);
    this.baseDirty = true;
    this.requestRender();
  }

  _boxFrom(a, b, eastward) {
    let lonMin = eastward ? a.lon : b.lon, lonMax = eastward ? b.lon : a.lon;
    const box = {
      latMin: Math.round(Math.min(a.lat, b.lat) * 2) / 2,
      latMax: Math.round(Math.max(a.lat, b.lat) * 2) / 2,
      lonMin: Math.round(lonMin * 2) / 2,
      lonMax: Math.round(lonMax * 2) / 2,
    };
    return box;
  }

  // ---------- render loop ----------
  _tick(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    let animating = false;
    if (this.fly) {
      const f = clamp((now - this.fly.t0) / this.fly.ms, 0, 1);
      const e = ease(f);
      const { from, to } = this.fly;
      // Zoom out a little mid-flight on the globe for a cinematic arc.
      const hop = this.kind === "globe" ? Math.sin(Math.PI * e) * 0.18 * Math.min(from.zoom, to.zoom) : 0;
      this.view = {
        lon: wrapLon(from.lon + (to.lon - from.lon) * e),
        lat: from.lat + (to.lat - from.lat) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e - hop,
      };
      this.lowRes = f < 1;
      this.baseDirty = true;
      animating = true;
      if (f >= 1) { this.fly = null; this.lowRes = false; this.h.onViewChange?.(); }
    } else if (this.inertia) {
      this._panBy(this.inertia.vx * dt * 60, this.inertia.vy * dt * 60);
      this.inertia.vx *= 0.9; this.inertia.vy *= 0.9;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.05) { this.inertia = null; this.lowRes = false; this.baseDirty = true; }
      else this.lowRes = true;
      animating = true;
    } else if (this.autoRotate && this.kind === "globe") {
      this.view.lon = wrapLon(this.view.lon + dt * 5);
      this.baseDirty = true;
      this.lowRes = true;
      animating = true;
    }
    if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt * 2.5); animating = true; this.glCanvas.style.opacity = this.fadeIn; }

    const pulseOn = this.scene.bandOn || this.overlay.track || (this.overlay.arrows && this.overlay.arrows.length) || this.overlay.choke;
    if (pulseOn) animating = true;
    if (this.dirty || animating) {
      this.dirty = false;
      this._render(now);
    }
    if (this.particles.enabled) this.particles.step(this.projection(), dt, this.kind);
    requestAnimationFrame((t) => this._tick(t));
  }

  _render(now) {
    const p = this.projection();
    const [tx, ty] = p.translate();
    const rot = p.rotate();
    const k = p.scale();
    const dpr = this.dpr;
    const s = this.scene;
    const n = this.norm, span = n.max - n.min || 1;
    const nz = (x) => (x == null ? null : (x - n.min) / span);
    const layerA = Math.floor(this.t), mix = this.t - layerA;
    const pulse = 0.5 + 0.5 * Math.sin(now / 420);
    this.gl.draw({
      dpr,
      proj: this.kind === "flat" ? 0 : this.kind === "globe" ? 1 : 2,
      k: k * dpr, tx: tx * dpr, ty: ty * dpr,
      rotL: rot[0] * RAD, rotP: rot[1] * RAD,
      clip: (p._clipDeg ?? 180) * RAD,
      layerA, layerB: Math.min(this.layers - 1, layerA + 1), mix,
      cdom: [nz(this.style.cdom[0]), nz(this.style.cdom[1])],
      gamma: this.style.gamma,
      bright: s.bright ?? 1,
      sat: s.sat ?? 1,
      layer: s.layer ?? 0,
      auxGamma: this.auxGamma ?? 1,
      pFog: s.pFog,
      band: s.band ? [s.band[0] == null ? -1000 : nz(s.band[0]), s.band[1] == null ? 1000 : nz(s.band[1])] : null,
      bandOn: s.bandOn,
      bandSoft: s.bandSoft ?? 0.08,
      trailN: s.trailN ?? 0,
      trailStep: s.trailStep ?? 1,
      firstOn: s.firstOn,
      firstLayer: s.firstLayer ?? 0,
      ringsOn: s.ringsOn,
      ringStep: s.ringStep ?? 1,
      pulse,
      region: s.region ?? null,
      isoOn: s.iso != null,
      iso: s.iso != null ? nz(s.iso) : 0,
      dipoleOn: s.dipoleOn,
      light: this.kind === "globe" ? 1 : 0,
    });
    this._drawOverlay(p, now);
  }

  _drawBase(p) {
    const ctx = this.baseCtx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const path = d3.geoPath(p, ctx);
    ctx.lineJoin = "round";
    // Graticule
    ctx.beginPath();
    path(d3.geoGraticule10());
    ctx.strokeStyle = "rgba(160,180,210,0.075)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    if (this.world) {
      ctx.beginPath();
      path(this.world.borders);
      ctx.strokeStyle = "rgba(230,238,247,0.13)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.beginPath();
      path(this.lowRes ? this.world.land110 : this.world.land);
      ctx.strokeStyle = "rgba(236,242,250,0.62)";
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    if (this.kind !== "flat") {
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = this.kind === "globe" ? "rgba(120,180,255,0.35)" : "rgba(160,180,210,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.kind === "polar") {
      // Latitude labels along one meridian.
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillStyle = "rgba(160,180,210,0.5)";
      for (const lat of [50, 60, 70, 80]) {
        const xy = p([this.view.lon + 180 + 45, this.polarSouth ? -lat : lat]);
        if (xy) ctx.fillText(`${lat}°${this.polarSouth ? "S" : "N"}`, xy[0] + 3, xy[1] - 3);
      }
    }
  }

  _drawOverlay(p, now) {
    if (this.baseDirty) { this._drawBase(p); this.baseDirty = false; }
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ovCanvas.width, this.ovCanvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const path = d3.geoPath(p, ctx);
    const ov = this.overlay;
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);

    // Region box
    const box = this.drawBox ?? ov.region;
    if (box && !(box.lonMax - box.lonMin >= 359 && box.latMax - box.latMin >= 170)) {
      const fullLon = box.lonMax - box.lonMin >= 359;
      ctx.beginPath();
      if (fullLon) {
        // A latitude band: draw only its parallels (skip the pole and the seam).
        const par = (lat) => d3.range(-180, 180.01, 2).map((lo) => [lo, lat]);
        const lines = [];
        if (box.latMin > -89.5) lines.push(par(box.latMin));
        if (box.latMax < 89.5) lines.push(par(box.latMax));
        path({ type: "MultiLineString", coordinates: lines });
      } else path({ type: "LineString", coordinates: boxRing(box) });
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -now / 60;
      ctx.strokeStyle = this.drawBox ? "rgba(76,201,255,0.95)" : "rgba(255,192,97,0.9)";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = this.drawBox ? "rgba(76,201,255,0.7)" : "rgba(255,150,60,0.7)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      if (ov.regionLabel && !this.drawBox && !fullLon) {
        const corner = p([box.lonMin, box.latMax]);
        if (corner) label(ctx, ov.regionLabel, corner[0] + 4, corner[1] - 8, "rgba(255,192,97,0.95)");
      }
    }

    // Routes
    for (const r of ov.routes ?? []) {
      ctx.beginPath();
      path({ type: "LineString", coordinates: r.points.map(([la, lo]) => [lo, la]) });
      ctx.strokeStyle = r.color ?? "rgba(255,255,255,0.9)";
      ctx.lineWidth = r.width ?? 2;
      ctx.shadowColor = r.glow ?? "rgba(76,201,255,0.8)";
      ctx.shadowBlur = 10;
      if (r.dash) { ctx.setLineDash(r.dash); ctx.lineDashOffset = -now / 40; }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      if (r.label) {
        const mid = r.points[Math.floor(r.points.length / 2)];
        const xy = p([mid[1], mid[0]]);
        if (xy) label(ctx, r.label, xy[0] + 8, xy[1] - 10, "#bfe9ff");
      }
    }
    if (ov.choke) {
      const xy = p([ov.choke[1], ov.choke[0]]);
      if (xy) {
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], 6 + pulse * 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,93,93,${0.85 - pulse * 0.6})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ff5d5d";
        ctx.fill();
        label(ctx, "choke point", xy[0] + 10, xy[1] + 4, "#ffb3b3");
      }
    }

    // Forecast cone (union of circles, filled once)
    if (ov.cone && ov.cone.length) {
      ctx.beginPath();
      for (const c of ov.cone) {
        const xy = p([c.lon, c.lat]);
        if (!xy) continue;
        const edge = p([c.lon, Math.min(89.9, c.lat + c.rKm / 111.2)]);
        const r = edge ? Math.max(3, Math.hypot(edge[0] - xy[0], edge[1] - xy[1])) : 6;
        ctx.moveTo(xy[0] + r, xy[1]);
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
      }
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill("nonzero");
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const last = ov.cone[ov.cone.length - 1];
      const xy = p([last.lon, last.lat]);
      if (xy && ov.coneLabel) label(ctx, ov.coneLabel, xy[0] + 10, xy[1] + 16, "rgba(255,255,255,0.75)");
    }

    // Hurricane-style track of the zone's centre
    if (ov.track && ov.track.points.length > 1) {
      const pts = ov.track.points;
      const cur = ov.track.current ?? pts.length - 1;
      const xyAll = pts.map((q) => (Number.isFinite(q.lat) && Number.isFinite(q.lon) ? p([q.lon, q.lat]) : null));
      ctx.lineWidth = 2;
      for (let k = 1; k < pts.length; k++) {
        const a = xyAll[k - 1], b = xyAll[k];
        if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > this.w * 0.4) continue;
        const f = k / (pts.length - 1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = k <= cur ? ringColor(f, 0.95) : "rgba(255,255,255,0.12)";
        ctx.stroke();
      }
      for (let k = 0; k < pts.length; k++) {
        const xy = xyAll[k];
        if (!xy || k > cur) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], k % 10 === 0 ? 3.2 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = ringColor(k / (pts.length - 1), 1);
        ctx.fill();
        if (pts[k].year % 10 === 0) label(ctx, String(pts[k].year), xy[0] + 6, xy[1] - 6, "rgba(255,255,255,0.75)", true);
      }
      const c = xyAll[Math.min(cur, pts.length - 1)];
      if (c) cyclone(ctx, c[0], c[1], now);
    }

    // Arrows (climate twin)
    for (const a of ov.arrows ?? []) {
      const interp = d3.geoInterpolate([a.from[1], a.from[0]], [a.to[1], a.to[0]]);
      const coords = d3.range(0, 1.0001, 0.02).map(interp);
      const prog = Math.min(1, (now - (a.t0 ?? 0)) / 1400);
      const shown = coords.slice(0, Math.max(2, Math.round(coords.length * ease(prog))));
      ctx.beginPath();
      path({ type: "LineString", coordinates: shown });
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 12;
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -now / 30;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const tip = shown[shown.length - 1], prev = shown[Math.max(0, shown.length - 3)];
      const t1 = p(tip), t0 = p(prev);
      if (t1 && t0) {
        const ang = Math.atan2(t1[1] - t0[1], t1[0] - t0[0]);
        ctx.beginPath();
        ctx.moveTo(t1[0] + Math.cos(ang) * 4, t1[1] + Math.sin(ang) * 4);
        ctx.lineTo(t1[0] - Math.cos(ang - 0.45) * 13, t1[1] - Math.sin(ang - 0.45) * 13);
        ctx.lineTo(t1[0] - Math.cos(ang + 0.45) * 13, t1[1] - Math.sin(ang + 0.45) * 13);
        ctx.closePath();
        ctx.fillStyle = a.color;
        ctx.fill();
        if (prog >= 1 && a.label) label(ctx, a.label, t1[0] + 10, t1[1] + (a.labelDy ?? -10), a.color);
      }
    }

    // Pins
    for (const pin of ov.pins ?? []) {
      const xy = p([pin.lon, pin.lat]);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 9 + pulse * 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 - pulse * 0.45})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 5.5, 0, Math.PI * 2);
      ctx.fillStyle = pin.color ?? "#fff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#04070d";
      ctx.stroke();
      if (pin.label) label(ctx, pin.label, xy[0] + 12, xy[1] + 4, "#fff");
    }

    // Hover crosshair
    if (this.hover && !this.drawBox) {
      const { x, y } = this.hover;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.moveTo(x - 14, y); ctx.lineTo(x - 9, y);
      ctx.moveTo(x + 9, y); ctx.lineTo(x + 14, y);
      ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 9);
      ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 14);
      ctx.stroke();
    }
  }

  // Composite of the map layers (for the case-file export).
  snapshot() {
    this._render(performance.now());
    const c = document.createElement("canvas");
    c.width = this.glCanvas.width; c.height = this.glCanvas.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.glCanvas, 0, 0);
    if (this.particles.enabled) { ctx.globalCompositeOperation = "screen"; ctx.drawImage(this.ptCanvas, 0, 0); ctx.globalCompositeOperation = "source-over"; }
    ctx.drawImage(this.ovCanvas, 0, 0);
    return c;
  }
}

function boxRing(b) {
  const pts = [];
  const span = (((b.lonMax - b.lonMin) % 360) + 360) % 360 || 360;
  const n = Math.max(8, Math.ceil(span / 2));
  for (let k = 0; k <= n; k++) pts.push([b.lonMin + (span * k) / n, b.latMax]);
  for (let k = 0; k <= 10; k++) pts.push([b.lonMin + span, b.latMax - ((b.latMax - b.latMin) * k) / 10]);
  for (let k = n; k >= 0; k--) pts.push([b.lonMin + (span * k) / n, b.latMin]);
  for (let k = 0; k <= 10; k++) pts.push([b.lonMin, b.latMin + ((b.latMax - b.latMin) * k) / 10]);
  return pts;
}

function label(ctx, text, x, y, color, small = false) {
  ctx.font = `${small ? 500 : 600} ${small ? 10 : 11}px JetBrains Mono, monospace`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(3,5,10,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const RING = [[59, 108, 246], [109, 76, 240], [166, 63, 216], [224, 65, 143], [255, 106, 74], [255, 160, 64], [255, 224, 138]];
function ringColor(f, a) {
  const x = Math.max(0, Math.min(1, f)) * (RING.length - 1);
  const i = Math.min(RING.length - 2, Math.floor(x)), t = x - i;
  const c = RING[i].map((v, k) => Math.round(v + (RING[i + 1][k] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// Tropical-cyclone style marker for the zone's current centre.
function cyclone(ctx, x, y, now) {
  const a = now / 500;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-a);
  ctx.shadowColor = "rgba(255,120,40,0.9)";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#ff8a3d";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -6.5, 9, Math.PI * 0.95, Math.PI * 1.55);
  ctx.moveTo(0, 6.5);
  ctx.arc(0, 6.5, 9, -Math.PI * 0.05, Math.PI * 0.55);
  ctx.stroke();
  ctx.restore();
}
