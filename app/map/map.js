// MapView: projections, interaction and the vector overlay, drawn in the
// style of an operational meteorology display: a framed map with lat/lon
// labels, black coastlines, thin graticule, yellow region box, NHC-style
// track and cone, and vector arrows for climate velocity.
// The default view is a 3D globe: the sphere seen through a perspective
// camera. Dragging it keeps north up; three faint rotation rings around it
// (X tilt, Y spin, Z roll) turn it about one axis at a time.
// Written with Claude and reviewed by the team.

import * as d3 from "d3";
import * as topojson from "topojson-client";
import { FieldRenderer } from "./gl.js";

const RAD = Math.PI / 180;
const WORLD_50 = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json";
const WORLD_110 = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const MONO = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

// ---------- 3D globe ----------
// The camera sits CAM globe radii from the centre, so it sees a cap of
// LIMB_DEG degrees around the point it looks at (less than a hemisphere,
// as from a real viewpoint). LIMB_R is the radius of the disc in
// projection units.
const CAM = 3.6;
const LIMB_DEG = Math.acos(1 / CAM) / RAD;
const LIMB_R = Math.sqrt((CAM - 1) / (CAM + 1));
const perspR = (c) => ((CAM - 1) * Math.sin(c)) / (CAM - Math.cos(c));

// General (vertical) perspective projection, in d3's raw-projection form.
function perspectiveRaw(lam, phi) {
  const cp = Math.cos(phi), k = (CAM - 1) / (CAM - cp * Math.cos(lam));
  return [k * cp * Math.sin(lam), k * Math.sin(phi)];
}
perspectiveRaw.invert = (x, y) => {
  const r2 = x * x + y * y, rho = Math.sqrt(r2);
  const sc = (CAM - Math.sqrt(1 - (r2 * (CAM + 1)) / (CAM - 1))) / ((CAM - 1) / rho + rho / (CAM - 1));
  return [Math.atan2(x * sc, rho * Math.sqrt(1 - sc * sc)), rho ? Math.asin((y * sc) / rho) : 0];
};

// Unit quaternions for d3's three-axis rotation angles [lambda, phi, gamma],
// used to fly the globe along the shortest arc between two views.
const qFromAngles = ([l, f, g]) => {
  l *= RAD / 2; f *= RAD / 2; g *= RAD / 2;
  const sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(f), cp = Math.cos(f), sg = Math.sin(g), cg = Math.cos(g);
  return [cl * cp * cg + sl * sp * sg, sl * cp * cg - cl * sp * sg, cl * sp * cg + sl * cp * sg, cl * cp * sg - sl * sp * cg];
};
const qToAngles = (q) => [
  Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) / RAD,
  Math.asin(clamp(2 * (q[0] * q[2] - q[3] * q[1]), -1, 1)) / RAD,
  Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) / RAD,
];
const cartesian = ([lon, lat]) => { const cf = Math.cos(lat * RAD); return [cf * Math.cos(lon * RAD), cf * Math.sin(lon * RAD), Math.sin(lat * RAD)]; };
const rotOf = (v) => [-v.lon, -v.lat, v.roll ?? 0];
const viewOfRot = (r) => ({ lon: wrapLon(-r[0]), lat: -r[1], roll: r[2] });

// Column-major 3x3 matrix taking a view-space unit vector to a geographic
// one, for the shader (d3's rotation is linear, so three samples define it).
function rotationMatrix(rot) {
  const inv = d3.geoRotation(rot).invert;
  return new Float32Array([...cartesian(inv([0, 0])), ...cartesian(inv([90, 0])), ...cartesian(inv([0, 90]))]);
}

const COMPASS = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6 11 8H5z" fill="#ff3b30"/><path d="M5 8h6l-3 6.4z" fill="#aeaeb2"/></svg>`;

// ---------- rotation rings ----------
// A rotation gizmo around the globe, drawn as if seen a little from above
// and to the side: X (red, a tall ellipse) tilts the globe toward a pole,
// Y (green, a flat ellipse) spins it about its own axis, Z (blue, the circle
// round the outside) rolls the picture about the line of sight. The rings
// turn with the roll, so Y always lies along the equator's direction on
// screen. They are faint at rest and brighten on hover and while dragged.
const RINGS = {
  x: { rgb: "255,59,48", label: "Tilt" },
  y: { rgb: "52,199,89", label: "Spin" },
  z: { rgb: "0,122,255", label: "Roll" },
};
const RING_FLAT = 0.34; // short/long axis of the X and Y ellipses
const RING_SNAP = 5; // degrees, while Shift is held

export class MapView {
  constructor(root, handlers = {}) {
    this.root = root;
    this.handlers = handlers;
    this.glCanvas = root.querySelector("#glCanvas");
    this.ovCanvas = root.querySelector("#overlayCanvas");
    this.ctx = this.ovCanvas.getContext("2d");
    this.gl = new FieldRenderer(this.glCanvas);
    this.base = document.createElement("canvas");
    this.baseCtx = this.base.getContext("2d");
    this.kind = "flat";
    this.view = { lon: 0, lat: 0, roll: 0, zoom: 1 };
    this.polarSouth = false;
    this.fly = null;
    // The rings live on their own canvas, so exports and recordings (which
    // copy the field and overlay canvases) leave them out.
    this.gzCanvas = document.createElement("canvas");
    this.gzCanvas.className = "layer gizmo";
    this.gzCtx = this.gzCanvas.getContext("2d");
    this.ovCanvas.after(this.gzCanvas);
    this.gz = { hover: null, active: null, near: false, pt: null };
    this.compass = document.createElement("button");
    this.compass.type = "button";
    this.compass.className = "compass no-map-events";
    this.compass.title = "Turn north up";
    this.compass.setAttribute("aria-label", "Turn north up");
    this.compass.innerHTML = COMPASS;
    this.compass.hidden = true;
    this.compass.addEventListener("click", () => this.flyTo({ roll: 0 }, 500));
    root.appendChild(this.compass);
    this.t = 0;
    this.layers = 1;
    this.norm = { min: 0, max: 1 };
    this.style = { cdom: [0, 1], gamma: 1, levels: 12 };
    this.scene = { layer: 0 };
    this.overlay = {};
    this.options = { cells: false, contours: true, coast: true, grid: true, gizmo: true };
    this.world = null;
    this.dirty = true;
    this.baseDirty = true;
    this.lowRes = false;
    this.drawMode = false;
    this._last = performance.now();
    new ResizeObserver(() => this._resize()).observe(root);
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
    }
    this.baseDirty = true;
    this.requestRender();
  }

  // ---------- projection ----------
  // Plot frame inside the canvas (room for lat/lon labels on flat maps).
  frame() {
    const { w, h } = this;
    if (this.kind === "flat") return { x0: 36, y0: 8, x1: w - 8, y1: h - 20 };
    return { x0: 0, y0: 0, x1: w, y1: h };
  }

  projection(view = this.view, kind = this.kind) {
    const f = this.frame();
    const fw = f.x1 - f.x0, fh = f.y1 - f.y0;
    const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
    const m = Math.min(fw, fh);
    let p;
    if (kind === "globe") {
      const base = d3.geoProjection(perspectiveRaw).rotate(rotOf(view)).scale((m * 0.46 * view.zoom) / LIMB_R).translate([cx, cy]).clipAngle(LIMB_DEG - 1e-4).precision(0.6);
      // d3 projects points on the far side too; hide them, so pins, tracks
      // and labels behind the globe are not drawn through it.
      const centre = [view.lon, view.lat], lim = LIMB_DEG * RAD;
      p = Object.assign((ll) => (d3.geoDistance(ll, centre) > lim ? null : base(ll)), base);
      p._clipDeg = LIMB_DEG;
    } else if (kind === "polar") {
      const clipDeg = 50;
      const k = (m * 0.5 * 0.94) / Math.tan((clipDeg * RAD) / 2) * view.zoom;
      p = d3.geoStereographic().rotate([-view.lon, this.polarSouth ? 90 : -90]).scale(k).translate([cx, cy]).clipAngle(clipDeg).precision(0.6);
      p._clipDeg = clipDeg;
    } else {
      const k = Math.max(fw / (2 * Math.PI), fh / Math.PI) * view.zoom;
      const maxShift = Math.max(0, (Math.PI / 2) * k - fh / 2);
      const ty = cy + clamp(view.lat * RAD * k, -maxShift, maxShift);
      p = d3.geoEquirectangular().rotate([-view.lon, 0]).scale(k).translate([cx, ty]).precision(0.6);
    }
    return p;
  }

  setProjection(kind, { south = false } = {}) {
    if (kind === this.kind && south === this.polarSouth) return;
    this.kind = kind;
    this.polarSouth = south;
    if (kind === "polar") this.view = { lon: 0, lat: south ? -90 : 90, zoom: 1 };
    if (kind === "flat") this.view = { lon: this.view.lon, lat: 0, zoom: 1 };
    if (kind === "globe") this.view = { lon: this.view.lon, lat: clamp(this.view.lat, -60, 60), roll: 0, zoom: 1 };
    this.fly = null;
    this.gz.hover = this.gz.active = null;
    this.root.classList.remove("ring-hover");
    this.baseDirty = true;
    this.requestRender();
  }

  flyTo(target, ms = 900) {
    const from = { ...this.view };
    const to = { ...from, ...target };
    this.fly = { from, to: { ...to, lon: from.lon + wrapLon(to.lon - from.lon) }, t0: performance.now(), ms };
    // The globe turns along the shortest arc between the two orientations.
    if (this.kind === "globe") {
      const q0 = qFromAngles(rotOf(from));
      let q1 = qFromAngles(rotOf(to));
      if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) q1 = q1.map((x) => -x);
      this.fly.q0 = q0; this.fly.q1 = q1;
    }
    this.requestRender();
  }

  fitRegion(region, { animate = true } = {}) {
    if (!region) return;
    const latMin = Math.min(region.latMin, region.latMax), latMax = Math.max(region.latMin, region.latMax);
    const span = (((region.lonMax - region.lonMin) % 360) + 360) % 360 || 360;
    const lonMid = wrapLon(region.lonMin + span / 2);
    const latMid = (latMin + latMax) / 2, latSpan = latMax - latMin;
    const global = span >= 359 && latSpan >= 170;
    let target;
    if (this.kind === "globe") {
      const ring = span >= 359;
      if (global) target = { lon: 0, lat: 15, zoom: 1 };
      else if (ring && (latMin >= 40 || latMax <= -40)) {
        // A cap around a pole: look straight down on it.
        const north = latMin >= 40;
        target = { lon: 0, lat: north ? 90 : -90, zoom: globeZoom(90 - (north ? latMin : -latMax)) };
      } else if (ring) target = { lon: 0, lat: clamp(latMid, -60, 60), zoom: 1 };
      else {
        // Angular radius of the box about its centre, from points on its edge.
        let ang = 0;
        for (const la of [latMin, latMid, latMax]) for (const f of [0, 0.5, 1]) ang = Math.max(ang, d3.geoDistance([lonMid, latMid], [region.lonMin + span * f, la]) / RAD);
        target = { lon: lonMid, lat: latMid, zoom: globeZoom(ang) };
      }
      target.roll = 0;
    } else if (this.kind === "flat") {
      target = global || span >= 359 ? { lon: 0, lat: span >= 359 ? clamp(latMid, -60, 60) * (latSpan < 120 ? 1 : 0) : 0, zoom: global ? 1 : clamp(180 / (latSpan * 1.25), 1, 3) } : { lon: lonMid, lat: latMid, zoom: clamp(Math.min(360 / (span * 1.5), 180 / (latSpan * 1.6)), 1, 9) };
    } else {
      const edge = this.polarSouth ? Math.abs(latMax) : Math.abs(latMin);
      target = { lon: span >= 359 ? 0 : lonMid, zoom: clamp(44 / Math.max(10, 90 - edge), 0.95, 2.6) };
    }
    if (animate) this.flyTo(target); else { this.view = { ...this.view, ...target }; this.baseDirty = true; this.requestRender(); }
  }

  // ---------- data ----------
  setField(data, grid, layers, norm) { this.gl.setField(data, grid, layers); this.grid = grid; this.layers = layers; this.norm = norm; this.requestRender(); }
  setFieldStyle({ lut, cdom, gamma = 1, levels = 12 }) { if (lut) this.gl.setLUT("cmap", lut); this.style = { cdom, gamma, levels }; this.requestRender(); }
  setAux(data, grid, { lut, levels = 12 } = {}) { this.gl.setAux(data, grid); if (lut) this.gl.setLUT("auxCmap", lut); this.auxLevels = levels; this.requestRender(); }
  setDipole(data, grid) { this.gl.setDipole(data, grid); this.requestRender(); }
  setRamps({ rings, zone }) { if (rings) this.gl.setLUT("ringRamp", rings); if (zone) this.gl.setLUT("zoneRamp", zone); }
  setScene(scene) { this.scene = { ...scene }; this.requestRender(); }
  setOverlay(ov) { this.overlay = { ...ov }; this.baseDirty = true; this.requestRender(); }
  setVectors(vec) { this.overlay = { ...this.overlay, vectors: vec }; this.requestRender(); }
  setOptions(o) { this.options = { ...this.options, ...o }; this.baseDirty = true; this.requestRender(); }
  setTime(t) { this.t = clamp(t, 0, Math.max(0, this.layers - 1)); this.requestRender(); }
  requestRender() { this.dirty = true; }

  // ---------- events ----------
  _resize() {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.root.dataset.size = this.w < 640 ? "sm" : this.w < 980 ? "md" : "lg";
    this.gl.resize(this.w, this.h, this.dpr);
    for (const c of [this.ovCanvas, this.base, this.gzCanvas]) { c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr); }
    this.baseDirty = true;
    this.requestRender();
  }

  invert(x, y) {
    const f = this.frame();
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) return null;
    const p = this.projection();
    const ll = p.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    const back = p(ll);
    if (!back || Math.hypot(back[0] - x, back[1] - y) > 1.5) return null;
    if (this.kind === "polar" && d3.geoDistance(ll, [0, this.polarSouth ? -90 : 90]) / RAD > p._clipDeg) return null;
    return { lon: wrapLon(ll[0]), lat: ll[1] };
  }

  _bindPointer() {
    const el = this.root;
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".no-map-events")) return;
      el.setPointerCapture(e.pointerId);
      const pt = this._pt(e);
      if (this.drawMode || e.shiftKey) {
        const ll = this.invert(pt.x, pt.y);
        if (ll) drag = { draw: true, start: ll, sx: pt.x, sy: pt.y, cur: ll };
        return;
      }
      this.fly = null;
      el.classList.add("dragging");
      const ring = this._ringAt(pt, e.pointerType);
      this.gz.hover = ring;
      el.classList.toggle("ring-hover", !!ring);
      if (ring) {
        // A rotation ring: turn about that one axis.
        const v = this.view;
        drag = { ring, x: pt.x, y: pt.y, raw: ring === "x" ? v.lat : ring === "y" ? v.lon : v.roll ?? 0 };
        this.gz.active = ring;
        this.gz.pt = pt;
        if (this.hover) { this.hover = null; this.handlers.onHover?.(null); }
        this.requestRender();
        return;
      }
      drag = { x: pt.x, y: pt.y, sx: pt.x, sy: pt.y, moved: false };
    });
    el.addEventListener("pointermove", (e) => {
      const pt = this._pt(e);
      if (!drag) {
        const ring = e.target.closest(".no-map-events") ? null : this._ringAt(pt, e.pointerType);
        if (ring !== this.gz.hover) el.classList.toggle("ring-hover", !!ring);
        this.gz.hover = ring;
        this.gz.near = true;
        this.gz.pt = pt;
        if (ring) {
          if (this.hover) { this.hover = null; this.handlers.onHover?.(null); }
          this.requestRender();
          return;
        }
        const ll = this.invert(pt.x, pt.y);
        this.hover = ll ? { ...ll, x: pt.x, y: pt.y } : null;
        this.handlers.onHover?.(this.hover, pt);
        this.requestRender();
        return;
      }
      if (drag.draw) {
        const ll = this.invert(pt.x, pt.y);
        if (ll) drag.cur = ll;
        this.drawBox = this._boxFrom(drag.start, drag.cur, pt.x >= drag.sx);
        this.baseDirty = true;
        this.requestRender();
        return;
      }
      if (drag.ring) { this._turnRing(drag, pt, e.shiftKey); return; }
      const dx = pt.x - drag.x, dy = pt.y - drag.y;
      if (Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 3) drag.moved = true;
      drag.x = pt.x; drag.y = pt.y;
      this.lowRes = true;
      if (this.kind === "globe") this._turnBy(dx, dy);
      else this._panBy(dx, dy, pt);
    });
    const end = (e) => {
      if (!drag) return;
      el.classList.remove("dragging");
      const pt = this._pt(e);
      // A lifted finger hovers nothing; a mouse may have stopped on a ring.
      this.gz.active = null;
      this.gz.hover = e.pointerType === "touch" ? null : this._ringAt(pt, e.pointerType);
      this.gz.pt = pt;
      el.classList.toggle("ring-hover", !!this.gz.hover);
      if (drag.draw) {
        const box = this.drawBox;
        this.drawBox = null;
        if (box && Math.abs(box.latMax - box.latMin) > 1 && Math.abs(pt.x - drag.sx) > 6) this.handlers.onRegion?.(box);
      } else if (!drag.ring && !drag.moved) {
        // A press that did not move (and was not on a ring) is a click.
        const ll = this.invert(pt.x, pt.y);
        if (ll) this.handlers.onClick?.(ll, pt);
      }
      drag = null;
      this.lowRes = false;
      this.baseDirty = true;
      this.requestRender();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => {
      if (drag) return;
      this.hover = null;
      this.gz.hover = null;
      this.gz.near = false;
      el.classList.remove("ring-hover");
      this.handlers.onHover?.(null);
      this.requestRender();
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0016);
      const lim = this.kind === "flat" ? [1, 14] : this.kind === "globe" ? [0.7, 9] : [0.6, 5];
      const pt = this._pt(e);
      const before = this.kind === "flat" ? this.invert(pt.x, pt.y) : null;
      this.view.zoom = clamp(this.view.zoom * f, lim[0], lim[1]);
      if (before) {
        const after = this.invert(pt.x, pt.y);
        if (after) { this.view.lon -= wrapLon(after.lon - before.lon); this.view.lat -= after.lat - before.lat; }
      }
      this.fly = null;
      this.lowRes = true;
      this.baseDirty = true;
      this.requestRender();
      clearTimeout(this._wheelT);
      this._wheelT = setTimeout(() => { this.lowRes = false; this.baseDirty = true; this.requestRender(); }, 160);
    }, { passive: false });
  }

  _pt(e) { const r = this.root.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _panBy(dx, dy, pt) {
    const p = this.projection();
    const k = p.scale();
    if (this.kind === "flat") {
      this.view.lon -= (dx / k) / RAD;
      this.view.lat = clamp(this.view.lat + (dy / k) / RAD, -80, 80);
    } else if (pt) {
      const [cx, cy] = p.translate();
      const a1 = Math.atan2(pt.y - dy - cy, pt.x - dx - cx), a2 = Math.atan2(pt.y - cy, pt.x - cx);
      this.view.lon += ((a2 - a1) / RAD) * (this.polarSouth ? -1 : 1);
    }
    this.view.lon = wrapLon(this.view.lon);
    this.baseDirty = true;
    this.requestRender();
  }

  // Dragging the globe itself: sideways spins it about its axis, up and
  // down tilts it toward a pole (no further than looking straight down on
  // it), so north stays up; only the Z ring changes the roll. The surface
  // near the centre follows the pointer, along the rolled screen axes.
  _turnBy(dx, dy) {
    const k = this.projection().scale(), r = (this.view.roll ?? 0) * RAD;
    const east = dx * Math.cos(r) - dy * Math.sin(r), south = dx * Math.sin(r) + dy * Math.cos(r);
    this.view.lon = wrapLon(this.view.lon - east / k / RAD);
    this.view.lat = clamp(this.view.lat + south / k / RAD, -90, 90);
    this.baseDirty = true;
    this.requestRender();
  }

  // Dragging a rotation ring turns the globe about that axis only, at the
  // same rate as dragging the globe: X (tilt) and Y (spin) take the
  // pointer's movement across and along the rolled equator, Z (roll) its
  // angle around the centre. Holding Shift snaps to RING_SNAP degrees.
  _turnRing(drag, pt, snap) {
    const p = this.projection(), [cx, cy] = p.translate(), k = p.scale();
    const r = (this.view.roll ?? 0) * RAD, dx = pt.x - drag.x, dy = pt.y - drag.y;
    if (drag.ring === "z") {
      const da = Math.atan2(pt.y - cy, pt.x - cx) - Math.atan2(drag.y - cy, drag.x - cx);
      drag.raw -= Math.atan2(Math.sin(da), Math.cos(da)) / RAD;
    } else if (drag.ring === "y") drag.raw -= (dx * Math.cos(r) - dy * Math.sin(r)) / k / RAD;
    else drag.raw = clamp(drag.raw + (dx * Math.sin(r) + dy * Math.cos(r)) / k / RAD, -90, 90);
    drag.x = pt.x; drag.y = pt.y;
    const v = snap ? Math.round(drag.raw / RING_SNAP) * RING_SNAP : drag.raw;
    if (drag.ring === "x") this.view.lat = clamp(v, -90, 90);
    else if (drag.ring === "y") this.view.lon = wrapLon(v);
    else this.view.roll = wrapLon(v);
    this.gz.pt = pt;
    this.lowRes = true;
    this.baseDirty = true;
    this.requestRender();
  }

  // Screen geometry of the rotation rings: the globe's centre and disc
  // radius R, the X/Y ring radius rg and Z ring radius rz (kept inside the
  // frame), and the rolled screen axes ex (east) and ey (south).
  _gizmo(p = this.projection()) {
    if (this.kind !== "globe" || this.drawMode || this.options.gizmo === false) return null;
    const [cx, cy] = p.translate(), R = p.scale() * LIMB_R, f = this.frame();
    const room = Math.min(cx - f.x0, f.x1 - cx, cy - f.y0, f.y1 - cy) - 3;
    const rz = Math.max(40, Math.min(R + 15, room)), r = (this.view.roll ?? 0) * RAD;
    return { cx, cy, R, rz, rg: rz - 8, ex: [Math.cos(r), -Math.sin(r)], ey: [Math.sin(r), Math.cos(r)], roll: r };
  }

  // Points along a ring, each flagged visible or not: the back halves of
  // X and Y pass behind the globe and show only beyond its edge.
  _ringPts(g, key, n = 120) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      const [u, w, front] = key === "x" ? [g.rg * RING_FLAT * c, g.rg * s, c >= 0] : key === "y" ? [g.rg * c, g.rg * RING_FLAT * s, s >= 0] : [g.rz * c, g.rz * s, true];
      pts.push([g.cx + u * g.ex[0] + w * g.ey[0], g.cy + u * g.ex[1] + w * g.ey[1], front || Math.hypot(u, w) > g.R + 0.5]);
    }
    return pts;
  }

  // The ring under a screen point, if any (the nearest within a few pixels).
  _ringAt(pt, pointerType) {
    const g = this._gizmo();
    if (!g) return null;
    let best = null, bd = pointerType === "touch" ? 14 : 7;
    for (const key of ["x", "y", "z"]) {
      const pts = this._ringPts(g, key);
      for (let i = 1; i < pts.length; i++) {
        if (!pts[i][2] || !pts[i - 1][2]) continue;
        const d = segDist(pt.x, pt.y, pts[i - 1], pts[i]);
        if (d < bd) { bd = d; best = key; }
      }
    }
    return best;
  }

  _boxFrom(a, b, eastward) {
    const r = (x) => Math.round(x * 2) / 2;
    return { latMin: r(Math.min(a.lat, b.lat)), latMax: r(Math.max(a.lat, b.lat)), lonMin: r(eastward ? a.lon : b.lon), lonMax: r(eastward ? b.lon : a.lon) };
  }

  // ---------- render loop ----------
  _tick(now) {
    try { this._frame(now); } catch (e) { if (!this._err) { console.error("map frame failed", e); this._err = true; } }
    requestAnimationFrame((t) => this._tick(t));
  }

  _frame(now) {
    if (this.fly) {
      const f = clamp((now - this.fly.t0) / this.fly.ms, 0, 1), e = ease(f);
      const { from, to, q0, q1 } = this.fly;
      const zoom = from.zoom + (to.zoom - from.zoom) * e;
      if (q0 && f < 1) {
        const q = q0.map((x, k) => x + (q1[k] - x) * e), n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        this.view = { ...viewOfRot(qToAngles(q.map((x) => x / n))), zoom };
      } else {
        this.view = { lon: wrapLon(from.lon + (to.lon - from.lon) * e), lat: from.lat + (to.lat - from.lat) * e, roll: (from.roll ?? 0) + ((to.roll ?? 0) - (from.roll ?? 0)) * e, zoom };
      }
      this.lowRes = f < 1;
      this.baseDirty = true;
      this.dirty = true;
      if (f >= 1) this.fly = null;
    }
    if (this.dirty) { this.dirty = false; this._render(); }
  }

  _render() {
    const p = this.projection();
    const [tx, ty] = p.translate(), rot = p.rotate(), k = p.scale();
    const dpr = this.dpr, s = this.scene, n = this.norm, span = n.max - n.min || 1;
    const nz = (x) => (x == null ? null : (x - n.min) / span);
    const layerA = Math.floor(this.t), mix = this.t - layerA;
    const f = this.frame();
    this.gl.draw({
      dpr, proj: this.kind === "flat" ? 0 : this.kind === "globe" ? 1 : 2,
      k: k * dpr, tx: tx * dpr, ty: ty * dpr, rotM: rotationMatrix(rot), cam: CAM,
      clip: (p._clipDeg ?? 180) * RAD,
      frame: [f.x0 * dpr, f.y0 * dpr, f.x1 * dpr, f.y1 * dpr],
      layerA, layerB: Math.min(this.layers - 1, layerA + 1), mix: s.noBlend ? 0 : mix,
      cells: this.options.cells, contours: this.options.contours,
      cdom: [nz(this.style.cdom[0]), nz(this.style.cdom[1])], gamma: this.style.gamma, levels: this.style.levels,
      gray: s.gray, layer: s.layer ?? 0, auxLevels: this.auxLevels ?? 12, pHatch: s.pHatch,
      band: s.band ? [s.band[0] == null ? -1000 : nz(s.band[0]), s.band[1] == null ? 1000 : nz(s.band[1])] : null,
      bandOn: s.bandOn, bandSoft: s.bandSoft ?? 0.08, trailN: s.trailN ?? 0, firstOn: s.firstOn, ringsOn: s.ringsOn,
      region: s.region ?? null, isoOn: s.iso != null, iso: s.iso != null ? nz(s.iso) : 0, dipoleOn: s.dipoleOn,
      nodata: [0.84, 0.84, 0.84],
    });
    this._drawOverlay(p);
    this._updateCompass(p);
    this._drawGizmo(p);
  }

  // The rotation rings: faint at rest, a little stronger while the pointer
  // is over the map, bright (with a light casing) on hover, and brightest
  // while dragged, when the other two fade almost away. A small readout
  // next to the pointer names the ring and the value it is changing.
  _drawGizmo(p) {
    const ctx = this.gzCtx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.gzCanvas.width, this.gzCanvas.height);
    const g = this._gizmo(p);
    if (!g) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ui = this.gz, rot = -g.roll, F = g.rg * RING_FLAT;
    const level = (key) => (ui.active ? (ui.active === key ? 3 : 0) : ui.hover === key ? 2 : 1);
    const ALPHA = [0.1, ui.near ? 0.42 : 0.26, 0.9, 1], WIDTH = [1, 1.25, 2, 2.4];
    const stroke = (key, path, depth = 1) => {
      const lv = level(key);
      if (lv >= 2) {
        ctx.beginPath(); path();
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * depth})`; ctx.lineWidth = WIDTH[lv] + 2.5; ctx.stroke();
      }
      ctx.beginPath(); path();
      ctx.strokeStyle = `rgba(${RINGS[key].rgb},${ALPHA[lv] * depth})`; ctx.lineWidth = WIDTH[lv]; ctx.stroke();
    };
    const half = (key, a0, a1) => () => (key === "x" ? ctx.ellipse(g.cx, g.cy, F, g.rg, rot, a0, a1) : ctx.ellipse(g.cx, g.cy, g.rg, F, rot, a0, a1));
    // Back halves (behind the globe): only what sticks out past its edge.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, this.h);
    ctx.arc(g.cx, g.cy, g.R, 0, 2 * Math.PI);
    ctx.clip("evenodd");
    stroke("x", half("x", Math.PI / 2, 1.5 * Math.PI), 0.55);
    stroke("y", half("y", Math.PI, 2 * Math.PI), 0.55);
    ctx.restore();
    stroke("z", () => ctx.arc(g.cx, g.cy, g.rz, 0, 2 * Math.PI));
    // Front halves, the hovered or dragged ring on top.
    for (const key of ["x", "y"].sort((a, b) => level(a) - level(b))) stroke(key, key === "x" ? half("x", -Math.PI / 2, Math.PI / 2) : half("y", 0, Math.PI));

    const key = ui.active ?? ui.hover;
    if (!key || !ui.pt) return;
    const v = this.view, deg = (x, pos, neg) => `${Math.abs(x).toFixed(1)}°${x > 0 ? pos : x < 0 ? neg : ""}`;
    const roll = Math.round(v.roll ?? 0);
    const text = `${RINGS[key].label} ${key === "x" ? deg(v.lat, "N", "S") : key === "y" ? deg(wrapLon(v.lon), "E", "W") : `${roll < 0 ? "−" : ""}${Math.abs(roll)}°`}`;
    const letter = key.toUpperCase();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.font = `700 ${MONO}`;
    const lw = ctx.measureText(`${letter} `).width;
    ctx.font = MONO;
    const tw = lw + ctx.measureText(text).width;
    let x = ui.pt.x + 14, y = ui.pt.y - 14;
    if (x + tw > this.w - 6) x = ui.pt.x - 14 - tw;
    if (y < 10) y = ui.pt.y + 18;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.font = `700 ${MONO}`;
    ctx.strokeText(letter, x, y);
    ctx.fillStyle = `rgb(${RINGS[key].rgb})`;
    ctx.fillText(letter, x, y);
    ctx.font = MONO;
    ctx.strokeText(text, x + lw, y);
    ctx.fillStyle = "#222";
    ctx.fillText(text, x + lw, y);
  }

  // The compass shows which way north points at the centre of the globe and
  // appears only once the globe has been tipped away from north-up.
  _updateCompass(p) {
    let deg = 0;
    if (this.kind === "globe") {
      const { lon, lat } = this.view, up = lat < 89;
      const a = p([lon, lat]), b = p([lon, lat + (up ? 1 : -1)]);
      if (a && b) deg = Math.atan2((b[0] - a[0]) * (up ? 1 : -1), -(b[1] - a[1]) * (up ? 1 : -1)) / RAD;
    }
    const show = Math.abs(deg) > 1.5 && !this.fly;
    if (this.compass.hidden === show) this.compass.hidden = !show;
    if (show) this.compass.firstElementChild.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  _drawBase(p) {
    const ctx = this.baseCtx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = this.frame();
    const path = d3.geoPath(p, ctx);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
    ctx.clip();
    // Optional land fill (ocean-only fields): paints the coarse field's
    // overhang off the land, so the real coastline is the edge.
    if (this.world && this.options.landFill) {
      ctx.beginPath();
      path(this.lowRes ? this.world.land110 : this.world.land);
      ctx.fillStyle = this.options.landFill;
      ctx.fill();
    }
    if (this.options.grid) {
      const step = this._gridStep(p);
      ctx.beginPath();
      path(d3.geoGraticule().step([step, step]).extentMinor([[-180, -90], [180, 90.001]])());
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.world && this.options.coast) {
      ctx.beginPath();
      path(this.world.borders);
      ctx.strokeStyle = "rgba(0,0,0,0.42)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.beginPath();
      path(this.lowRes ? this.world.land110 : this.world.land);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    // Frame and labels
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    if (this.kind === "flat") {
      ctx.strokeRect(Math.round(f.x0) + 0.5, Math.round(f.y0) + 0.5, Math.round(f.x1 - f.x0) - 1, Math.round(f.y1 - f.y0) - 1);
      this._flatLabels(ctx, p, f);
    } else {
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.stroke();
      if (this.kind === "polar") this._polarLabels(ctx, p);
      else if (this.options.grid && !this.lowRes) this._globeLabels(ctx, p);
    }
  }

  // Lat/lon labels on the globe: meridians are named along a parallel near
  // the centre of the view, parallels along a meridian near it.
  _globeLabels(ctx, p) {
    const step = this._gridStep(p);
    const c = [this.view.lon, this.view.lat];
    const placed = [];
    ctx.font = MONO;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const put = (text, ll) => {
      if (d3.geoDistance(ll, c) / RAD > LIMB_DEG - 14) return;
      const xy = p(ll);
      if (!xy || placed.some((q) => Math.hypot(q[0] - xy[0], q[1] - xy[1]) < 30)) return;
      placed.push(xy);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(text, xy[0], xy[1]);
      ctx.fillStyle = "#222";
      ctx.fillText(text, xy[0], xy[1]);
    };
    // Looking down on a pole, the meridians are named well away from it,
    // where they have spread apart.
    const row = Math.abs(c[1]) > 60 ? Math.sign(c[1]) * (90 - step * 3.5) : Math.floor(c[1] / step) * step + step / 2;
    const col = Math.floor(c[0] / step) * step + step / 2;
    for (let lat = Math.ceil(-89 / step) * step; lat < 90; lat += step) put(lat === 0 ? "EQ" : `${Math.abs(lat)}${lat < 0 ? "S" : "N"}`, [col, lat]);
    for (let lon = -180; lon < 180; lon += step) put(lon === 0 ? "0" : lon === -180 ? "180" : `${Math.abs(lon)}${lon < 0 ? "W" : "E"}`, [lon, row]);
  }

  _gridStep(p) {
    const k = p.scale();
    const degPerPx = 1 / (k * RAD);
    const want = degPerPx * 90;
    return [5, 10, 15, 20, 30, 45, 60].find((s) => s >= want) ?? 60;
  }

  _flatLabels(ctx, p, f) {
    const step = this._gridStep(p);
    ctx.font = MONO;
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let lon = -180; lon < 180; lon += step) {
      const lat0 = p.invert([(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2])?.[1] ?? 0;
      const xy = p([lon, lat0]);
      if (!xy || xy[0] < f.x0 + 8 || xy[0] > f.x1 - 8) continue;
      ctx.fillText(lon === 0 ? "0" : `${Math.abs(lon)}${lon < 0 ? "W" : "E"}`, xy[0], f.y1 + 5);
      ctx.fillRect(Math.round(xy[0]), f.y1, 1, 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let lat = -90 + step; lat < 90; lat += step) {
      const lon0 = p.invert([(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2])?.[0] ?? 0;
      const xy = p([lon0, lat]);
      if (!xy || xy[1] < f.y0 + 6 || xy[1] > f.y1 - 6) continue;
      ctx.fillText(lat === 0 ? "EQ" : `${Math.abs(lat)}${lat < 0 ? "S" : "N"}`, f.x0 - 6, xy[1]);
      ctx.fillRect(f.x0 - 4, Math.round(xy[1]), 4, 1);
    }
  }

  _polarLabels(ctx, p) {
    ctx.font = MONO;
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const edge = 90 - p._clipDeg + 2;
    const sgn = this.polarSouth ? -1 : 1;
    for (let lon = -180; lon < 180; lon += 30) {
      const xy = p([lon, sgn * (edge + 1.5)]);
      if (xy) ctx.fillText(lon === 0 ? "0" : lon === -180 ? "180" : `${Math.abs(lon)}${lon < 0 ? "W" : "E"}`, xy[0], xy[1]);
    }
    for (const lat of [50, 60, 70, 80]) {
      if (lat < edge) continue;
      const xy = p([this.view.lon + 45 * sgn, sgn * lat]);
      if (xy) ctx.fillText(`${lat}${sgn > 0 ? "N" : "S"}`, xy[0], xy[1]);
    }
  }

  // Arrows on a regular screen grid: white with a thin dark casing, length
  // by speed (linear for winds, logarithmic for climate velocity).
  _drawVectors(ctx, p, f) {
    const V = this.overlay.vectors;
    const g = V.grid, sp = 27;
    const lin = V.scale === "linear";
    const s0 = V.s0 || 1, lc = Math.log(1 + (V.cap || s0 * 20) / s0);
    const pole = [0, this.polarSouth ? -90 : 90];
    const segs = [];
    for (let y = f.y0 + sp / 2; y < f.y1; y += sp) {
      for (let x = f.x0 + sp / 2; x < f.x1; x += sp) {
        const inv = p.invert([x, y]);
        if (!inv || !Number.isFinite(inv[0])) continue;
        const back = p(inv);
        if (!back || Math.hypot(back[0] - x, back[1] - y) > 1.5) continue;
        if (this.kind === "polar" && d3.geoDistance(inv, pole) / RAD > p._clipDeg) continue;
        const ll = { lon: wrapLon(inv[0]), lat: inv[1] };
        const smp = sampleUV(V, g, ll.lat, ll.lon);
        if (!smp) continue;
        const mag = Math.hypot(smp.u, smp.v);
        if (!(mag > 0)) continue;
        const t = lin ? Math.min(1, mag / (V.max || 50)) : Math.min(1, Math.log(1 + smp.s / s0) / lc);
        if (lin && t < 0.04) continue;
        const len = lin ? 3 + 19 * t : 4 + 16 * t;
        const d = 0.5 / Math.max(0.2, Math.cos(ll.lat * RAD));
        const q = p([ll.lon + (smp.u / mag) * d, ll.lat + (smp.v / mag) * 0.5]);
        if (!q) continue;
        let ux = q[0] - x, uy = q[1] - y;
        const n = Math.hypot(ux, uy) || 1;
        ux /= n; uy /= n;
        segs.push([x - (ux * len) / 2, y - (uy * len) / 2, x + (ux * len) / 2, y + (uy * len) / 2, ux, uy]);
      }
    }
    const pass = (color, lw, head) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
      ctx.beginPath();
      for (const [, , x2, y2, ux, uy] of segs) {
        ctx.moveTo(x2 + ux * head * 0.4, y2 + uy * head * 0.4);
        ctx.lineTo(x2 - ux * head - uy * head * 0.62, y2 - uy * head + ux * head * 0.62);
        ctx.lineTo(x2 - ux * head + uy * head * 0.62, y2 - uy * head - ux * head * 0.62);
        ctx.closePath();
      }
      ctx.fill();
    };
    pass("rgba(0,0,0,0.55)", 2.8, 5.2);
    pass(V.color ?? "#ffffff", 1.3, 4.2);
  }

  _drawOverlay(p) {
    if (this.baseDirty) { this._drawBase(p); this.baseDirty = false; }
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ovCanvas.width, this.ovCanvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = this.frame();
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
    ctx.clip();
    const path = d3.geoPath(p, ctx);
    const ov = this.overlay;

    // Arrows change every frame, so they are drawn here, not in the cached base layer.
    if (ov.vectors && !this.lowRes) this._drawVectors(ctx, p, f);

    // Region box (solid yellow, AWIPS-style highlight)
    const box = this.drawBox ?? ov.region;
    if (box && !(box.lonMax - box.lonMin >= 359 && box.latMax - box.latMin >= 170)) {
      const fullLon = box.lonMax - box.lonMin >= 359;
      ctx.beginPath();
      if (fullLon) {
        const par = (lat) => d3.range(-180, 180.01, 2).map((lo) => [lo, lat]);
        const lines = [];
        if (box.latMin > -89.5) lines.push(par(box.latMin));
        if (box.latMax < 89.5) lines.push(par(box.latMax));
        path({ type: "MultiLineString", coordinates: lines });
      } else path({ type: "LineString", coordinates: boxRing(box) });
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = this.drawBox ? "#0b5cad" : "#111";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Second region (Compare product), drawn in blue
    if (ov.region2) {
      const b2 = ov.region2;
      ctx.beginPath();
      if (b2.lonMax - b2.lonMin >= 359) {
        const par = (lat) => d3.range(-180, 180.01, 2).map((lo) => [lo, lat]);
        const lines = [];
        if (b2.latMin > -89.5) lines.push(par(b2.latMin));
        if (b2.latMax < 89.5) lines.push(par(b2.latMax));
        path({ type: "MultiLineString", coordinates: lines });
      } else path({ type: "LineString", coordinates: boxRing(b2) });
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = "#007aff"; ctx.lineWidth = 1.8; ctx.stroke();
    }

    for (const r of ov.best ? [...(ov.routes ?? []), ov.best] : ov.routes ?? []) {
      const geo = { type: "LineString", coordinates: r.points.map(([la, lo]) => [lo, la]) };
      const w = r.width ?? 2;
      if (r.halo !== false) { ctx.beginPath(); path(geo); ctx.strokeStyle = "#000"; ctx.lineWidth = w + 2; ctx.stroke(); }
      ctx.beginPath(); path(geo);
      ctx.strokeStyle = r.color ?? "#fff"; ctx.lineWidth = w; ctx.globalAlpha = r.alpha ?? 1;
      if (r.dash) ctx.setLineDash(r.dash);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // Ports (Shipping routes): a dot and a name.
    if (ov.ports) {
      ctx.font = "600 10.5px -apple-system, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      for (const pt of ov.ports) {
        const xy = p([pt.lon, pt.lat]);
        if (!xy) continue;
        ctx.beginPath(); ctx.arc(xy[0], xy[1], 3.2, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#000"; ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.strokeText(pt.name, xy[0] + 6, xy[1]);
        ctx.fillStyle = "#fff"; ctx.fillText(pt.name, xy[0] + 6, xy[1]);
      }
    }
    if (ov.choke) {
      const xy = p([ov.choke[1], ov.choke[0]]);
      if (xy) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; xMark(ctx, xy[0], xy[1], 6);
        ctx.strokeStyle = "#d00000"; ctx.lineWidth = 2.5; xMark(ctx, xy[0], xy[1], 6);
      }
    }

    // NHC-style cone: translucent white with a dashed black outline
    if (ov.cone && ov.cone.length) {
      const start = ov.track?.points?.findLast?.((q) => Number.isFinite(q.lat));
      const pts = [];
      if (start) { const xy = p([start.lon, start.lat]); if (xy) pts.push({ x: xy[0], y: xy[1], r: 2 }); }
      for (const c of ov.cone) {
        const xy = p([c.lon, c.lat]);
        if (!xy) continue;
        const edge = p([c.lon, Math.min(89.9, c.lat + c.rKm / 111.2)]);
        pts.push({ x: xy[0], y: xy[1], r: edge ? Math.max(3, Math.hypot(edge[0] - xy[0], edge[1] - xy[1])) : 6 });
      }
      if (pts.length > 1) {
        const left = [], right = [];
        for (let k = 0; k < pts.length; k++) {
          const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
          let dx = b.x - a.x, dy = b.y - a.y;
          const n = Math.hypot(dx, dy) || 1;
          dx /= n; dy /= n;
          left.push([pts[k].x - dy * pts[k].r, pts[k].y + dx * pts[k].r]);
          right.push([pts[k].x + dy * pts[k].r, pts[k].y - dx * pts[k].r]);
        }
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
        ctx.beginPath();
        left.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.arc(last.x, last.y, last.r, ang + Math.PI / 2, ang - Math.PI / 2, true);
        for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // NHC-style track: black line, white dots, current position symbol
    if (ov.track && ov.track.points.length > 1) {
      const pts = ov.track.points, cur = ov.track.current ?? pts.length - 1;
      this._lastTag = null;
      const xy = pts.map((q) => (Number.isFinite(q.lat) && Number.isFinite(q.lon) ? p([q.lon, q.lat]) : null));
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (let k = 0; k <= cur && k < pts.length; k++) {
        const a = xy[k];
        if (!a) { pen = false; continue; }
        if (pen && Math.hypot(a[0] - xy[k - 1][0], a[1] - xy[k - 1][1]) > this.w * 0.4) pen = false;
        pen ? ctx.lineTo(a[0], a[1]) : ctx.moveTo(a[0], a[1]);
        pen = true;
      }
      ctx.stroke();
      for (let k = 0; k <= cur && k < pts.length; k++) {
        const a = xy[k];
        if (!a) continue;
        ctx.beginPath();
        ctx.arc(a[0], a[1], pts[k].year % 10 === 0 ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#000";
        ctx.stroke();
        if (pts[k].year % 20 === 0 && (!this._lastTag || Math.hypot(a[0] - this._lastTag[0], a[1] - this._lastTag[1]) > 34)) { tag(ctx, String(pts[k].year), a[0] + 7, a[1] - 9); this._lastTag = a; }
      }
      const c = xy[Math.min(cur, pts.length - 1)];
      if (c) stormSymbol(ctx, c[0], c[1]);
    }

    for (const a of ov.arrows ?? []) {
      const interp = d3.geoInterpolate([a.from[1], a.from[0]], [a.to[1], a.to[0]]);
      const coords = d3.range(0, 1.0001, 0.02).map(interp);
      ctx.beginPath(); path({ type: "LineString", coordinates: coords });
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath(); path({ type: "LineString", coordinates: coords });
      ctx.strokeStyle = a.color; ctx.lineWidth = 2.5; ctx.stroke();
      const t1 = p(coords[coords.length - 1]), t0 = p(coords[coords.length - 4]);
      if (t1 && t0) {
        const ang = Math.atan2(t1[1] - t0[1], t1[0] - t0[0]);
        ctx.beginPath();
        ctx.moveTo(t1[0] + Math.cos(ang) * 3, t1[1] + Math.sin(ang) * 3);
        ctx.lineTo(t1[0] - Math.cos(ang - 0.42) * 12, t1[1] - Math.sin(ang - 0.42) * 12);
        ctx.lineTo(t1[0] - Math.cos(ang + 0.42) * 12, t1[1] - Math.sin(ang + 0.42) * 12);
        ctx.closePath();
        ctx.fillStyle = a.color; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
        if (a.label) tag(ctx, a.label, t1[0] + 8, t1[1] + (a.labelDy ?? -8), a.color);
      }
    }

    for (const pin of ov.pins ?? []) {
      const xy = p([pin.lon, pin.lat]);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#000"; ctx.stroke();
      if (pin.label) tag(ctx, pin.label, xy[0] + 8, xy[1] + 4);
    }

    if (this.hover && !this.drawBox) {
      const { x, y } = this.hover;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y - 9); ctx.lineTo(Math.round(x) + 0.5, y + 9);
      ctx.moveTo(x - 9, Math.round(y) + 0.5); ctx.lineTo(x + 9, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  snapshot() {
    this._render();
    const c = document.createElement("canvas");
    c.width = this.glCanvas.width; c.height = this.glCanvas.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.glCanvas, 0, 0);
    ctx.drawImage(this.ovCanvas, 0, 0);
    return c;
  }
}

// Zoom for a cap of the given angular radius (degrees). Large regions keep
// the whole ball in view (zoom up to 1.08 still fits the frame); only small
// ones bring the camera in, toward the zoom at which the cap fills the view.
function globeZoom(angDeg) {
  const a = Math.min(angDeg * 1.25 + 3, LIMB_DEG) * RAD;
  const fill = clamp(LIMB_R / perspR(a), 1, 6);
  return fill <= 1.6 ? 1 + ((fill - 1) / 0.6) * 0.08 : 1.08 + (fill - 1.6) * 0.9;
}

function sampleUV(V, g, lat, lon) {
  const fi = (lat - g.lat0) / g.dlat;
  if (fi < 0 || fi > g.nlat - 1) return null;
  const fj = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon;
  const i0 = Math.floor(fi), i1 = Math.min(g.nlat - 1, i0 + 1);
  const j0 = Math.floor(fj) % g.nlon, j1 = (j0 + 1) % g.nlon;
  const fy = fi - i0, fx = fj - Math.floor(fj);
  let u = 0, v = 0, s = 0, w = 0;
  const add = (i, j, wt) => {
    const c = i * g.nlon + j;
    const uu = V.u[c], vv = V.v[c], ss = V.speed[c];
    if (uu === uu && vv === vv && ss === ss) { u += uu * wt; v += vv * wt; s += ss * wt; w += wt; }
  };
  add(i0, j0, (1 - fx) * (1 - fy)); add(i0, j1, fx * (1 - fy)); add(i1, j0, (1 - fx) * fy); add(i1, j1, fx * fy);
  return w < 0.5 ? null : { u: u / w, v: v / w, s: s / w };
}

// Distance from (x, y) to the segment from a to b (screen points).
function segDist(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  const t = l2 ? clamp(((x - a[0]) * vx + (y - a[1]) * vy) / l2, 0, 1) : 0;
  return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy);
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

// Small boxed annotation (white box, thin border, dark text).
function tag(ctx, text, x, y, color = "#111") {
  ctx.font = MONO;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 8;
  const X = Math.round(x) - 1, Y = Math.round(y) - 8;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(X, Y, w, 16);
  ctx.strokeStyle = color === "#111" ? "#666" : color;
  ctx.lineWidth = 1;
  ctx.strokeRect(X + 0.5, Y + 0.5, w - 1, 15);
  ctx.fillStyle = "#111";
  ctx.fillText(text, X + 4, Math.round(y) + 0.5);
}

function xMark(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

// Tropical-cyclone symbol, as on official track maps.
function stormSymbol(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#e00000";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -5, 8, Math.PI * 0.95, Math.PI * 1.6);
  ctx.moveTo(0, 5);
  ctx.arc(0, 5, 8, -Math.PI * 0.05, Math.PI * 0.6);
  ctx.stroke();
  ctx.restore();
}
