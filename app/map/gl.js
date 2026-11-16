// WebGL2 field renderer. A full-screen fragment shader inverse-projects each
// pixel (cylindrical equidistant, the 3D globe seen through a perspective
// camera, or polar stereographic, using d3-geo's conventions), samples the data from a texture array (one layer per
// year or month), and draws it the way operational meteorology displays do:
// discrete color steps with crisp contour edges (or raw grid cells), thin
// contour lines, hatching for non-significant cells, and for Shift mode a
// grayscale field with an IR-style enhancement of the tracked zone.
// Written with Claude and reviewed by the team.

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform vec2 u_res;
uniform float u_dpr;
uniform int u_proj;        // 0 cylindrical, 1 globe (perspective), 2 stereographic
uniform float u_k;
uniform vec2 u_t;
uniform mat3 u_rotM;       // view-space unit vector -> geographic unit vector
uniform float u_cam;       // globe: camera distance from the centre, in globe radii
uniform float u_clip;
uniform vec4 u_frame;      // device px: x0, y0, x1, y1 (top-left origin)

uniform sampler2DArray u_field;
uniform vec4 u_grid;       // lat0, dlat, lon0, dlon
uniform vec2 u_gsize;      // nlon, nlat
uniform float u_layerA;
uniform float u_layerB;
uniform float u_mix;
uniform float u_nLayers;
uniform float u_hasField;
uniform float u_cells;     // 1 = raw grid cells (nearest)

uniform sampler2D u_cmap;
uniform vec2 u_cdom;
uniform float u_gamma;
uniform float u_levels;
uniform float u_contours;
uniform float u_gray;      // 1 = draw the field in grayscale (Shift base)

uniform int u_layer;       // 0 field, 1 aux diverging + significance, 2 aux sequential
uniform sampler2D u_aux;
uniform sampler2D u_auxCmap;
uniform float u_auxLevels;
uniform float u_pHatch;

uniform vec2 u_band;
uniform float u_bandOn;
uniform float u_bandSoft;
uniform float u_trailN;
uniform float u_firstOn;
uniform float u_ringsOn;
uniform sampler2D u_ringRamp;
uniform sampler2D u_zoneRamp;

uniform vec4 u_region;
uniform float u_regionOn;
uniform float u_isoOn;
uniform float u_iso;
uniform sampler2D u_dipole;
uniform float u_dipoleOn;
uniform vec3 u_nodata;

out vec4 outColor;
const float PI = 3.141592653589793;

// mu: cosine of the angle between the surface normal and the line of sight
// (1 facing the camera, 0 at the limb). edge: distance to the limb in
// projection units. Both are only meaningful on the globe.
bool inverseProject(vec2 p, out vec2 ll, out float mu, out float edge) {
  float rho = length(p);
  float lam, phi;
  mu = 1.0; edge = 1e6;
  if (u_proj == 0) {
    if (abs(p.x) > PI || abs(p.y) > PI * 0.5) return false;
    lam = p.x; phi = p.y;
  } else {
    float sc, cc;
    if (u_proj == 1) {
      // General perspective projection of a unit sphere from distance u_cam.
      float lim = (u_cam - 1.0) / (u_cam + 1.0);
      float r2 = rho * rho;
      edge = sqrt(lim) - rho;
      if (r2 >= lim) return false;
      sc = rho > 1e-9 ? (u_cam - sqrt(1.0 - r2 / lim)) / ((u_cam - 1.0) / rho + rho / (u_cam - 1.0)) : 0.0;
      sc = clamp(sc, 0.0, 1.0);
      cc = sqrt(1.0 - sc * sc);
      mu = clamp((u_cam * cc - 1.0) / sqrt(u_cam * u_cam - 2.0 * u_cam * cc + 1.0), 0.0, 1.0);
    } else {
      float c = 2.0 * atan(rho);
      if (c > u_clip) return false;
      sc = sin(c); cc = cos(c);
    }
    lam = atan(p.x * sc, rho * cc);
    phi = rho > 1e-9 ? asin(clamp(p.y * sc / rho, -1.0, 1.0)) : 0.0;
  }
  float cp = cos(phi);
  vec3 g = u_rotM * vec3(cos(lam) * cp, sin(lam) * cp, sin(phi));
  ll = vec2(degrees(atan(g.y, g.x)), degrees(asin(clamp(g.z, -1.0, 1.0))));
  return true;
}

vec2 cellUV(vec2 uv) { return u_cells > 0.5 ? (floor(uv * u_gsize) + 0.5) / u_gsize : uv; }

vec2 sampleLayer(vec2 uv, float layer) {
  vec2 s = texture(u_field, vec3(cellUV(uv), layer)).rg;
  return vec2(s.g > 0.001 ? s.r / s.g : 0.0, s.g);
}

vec2 sampleField(vec2 uv) {
  vec2 a = sampleLayer(uv, u_layerA);
  if (u_mix <= 0.0001) return a;
  return mix(a, sampleLayer(uv, u_layerB), u_mix);
}

float lonIn(float lon, float a, float b) {
  if (b - a >= 359.99) return 1.0;
  float width = mod(b - a + 720.0, 360.0);
  float off = mod(lon - a + 720.0, 360.0);
  return off <= width + 1e-3 ? 1.0 : 0.0;
}

float inBand(float v) {
  float a = u_band.x < -100.0 ? 1.0 : step(u_band.x, v);
  float b = u_band.y > 100.0 ? 1.0 : step(v, u_band.y);
  return a * b;
}

float edgeDist(float v) {
  float d = 1e3;
  if (u_band.x > -100.0) d = min(d, abs(v - u_band.x));
  if (u_band.y < 100.0) d = min(d, abs(v - u_band.y));
  return d;
}

float lineAA(float distPx, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, distPx);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 p = vec2((frag.x - u_t.x) / u_k, (u_t.y - frag.y) / u_k);
  vec2 ll = vec2(0.0);
  float mu = 1.0, edge = 1e6;
  bool ok = inverseProject(p, ll, mu, edge);

  vec2 uv = vec2(((ll.x - u_grid.z) / u_grid.w + 0.5) / u_gsize.x,
                 ((ll.y - u_grid.x) / u_grid.y + 0.5) / u_gsize.y);
  float fi = (ll.y - u_grid.x) / u_grid.y;
  float inLat = (fi >= -0.5 && fi <= u_gsize.y - 0.5) ? 1.0 : 0.0;
  vec2 s = sampleField(uv);
  float val = s.x;
  float valid = step(0.5, s.g) * inLat * u_hasField;
  float fw = max(fwidth(val), 1e-6);

  bool inFrame = frag.x >= u_frame.x && frag.y >= u_frame.y && frag.x <= u_frame.z && frag.y <= u_frame.w;
  if (!ok || !inFrame) { outColor = vec4(0.0); return; }

  vec3 col = u_nodata;
  float lw = u_dpr;   // 1 CSS px

  if (u_layer == 0) {
    float t = clamp((val - u_cdom.x) / (u_cdom.y - u_cdom.x), 0.0, 1.0);
    t = pow(t, u_gamma);
    float f = t * u_levels;
    float tq = u_levels > 0.5 ? (min(floor(f), u_levels - 1.0) + 0.5) / u_levels : t;
    vec3 c = texture(u_cmap, vec2(tq, 0.5)).rgb;
    if (u_gray > 0.5) c = vec3(mix(0.96, 0.6, tq));
    if (u_contours > 0.5 && u_levels > 0.5 && u_cells < 0.5 && u_gray < 0.5) {
      float g = fract(f);
      float d = min(g, 1.0 - g) / max(fwidth(f), 1e-6);
      c = mix(c, c * 0.45, lineAA(d, 0.5 * lw) * step(0.001, t) * step(t, 0.999));
    }
    col = mix(u_nodata, c, valid);
  } else {
    vec2 auv = cellUV(uv);
    vec4 a = texture(u_aux, auv);
    float av = a.g > 0.001 ? a.r / a.g : 0.0;
    float ap = a.g > 0.001 ? a.b / a.g : 1.0;
    float avalid = step(0.5, a.g) * inLat;
    vec3 c;
    if (u_layer == 1) {
      float t = clamp(av * 0.5 + 0.5, 0.0, 1.0);
      float L = u_auxLevels;
      float tq = (min(floor(t * L), L - 1.0) + 0.5) / L;
      c = texture(u_auxCmap, vec2(tq, 0.5)).rgb;
      if (u_pHatch > 0.5 && ap >= 0.05) {
        c = mix(c, vec3(0.93), 0.62);
        float h = fract((frag.x + frag.y) / (7.0 * u_dpr));
        c *= 1.0 - 0.42 * step(h, 1.0 / 7.0 * 1.4);
      }
    } else {
      float t = clamp(av, 0.0, 1.0);
      float L = u_auxLevels;
      float tq = (min(floor(t * L), L - 1.0) + 0.5) / L;
      c = texture(u_auxCmap, vec2(tq, 0.5)).rgb;
    }
    col = mix(u_nodata, c, avalid);
  }

  if (u_dipoleOn > 0.5) {
    vec2 m = texture(u_dipole, cellUV(uv)).rg;
    float arr = step(0.5, m.r) * inLat, lef = step(0.5, m.g) * inLat;
    float h1 = step(fract((frag.x + frag.y) / (6.0 * u_dpr)), 0.34);
    float h2 = step(fract((frag.x - frag.y) / (6.0 * u_dpr)), 0.34);
    col = mix(col, vec3(0.86, 0.1, 0.1), arr * (0.35 + 0.5 * h1));
    col = mix(col, vec3(0.15, 0.4, 0.9), lef * (0.35 + 0.5 * h2));
  }

  if (u_bandOn > 0.5) {
    float cur = floor(u_layerA + u_mix + 0.001);
    for (int k = 1; k <= 12; k++) {
      if (float(k) > u_trailN) break;
      float L = cur - float(k);
      if (L < 0.0) break;
      vec2 sk = sampleLayer(uv, L);
      float e = lineAA(edgeDist(sk.x) / fw, 0.5 * lw) * step(0.5, sk.y) * inLat;
      col = mix(col, vec3(0.3), e * (0.7 - 0.08 * float(k)));
    }
    float ib = inBand(val) * valid;
    float depth = clamp(min(u_band.x > -100.0 ? val - u_band.x : 1e3, u_band.y < 100.0 ? u_band.y - val : 1e3) / u_bandSoft, 0.0, 0.9999);
    vec3 enh = texture(u_zoneRamp, vec2((floor(depth * 5.0) + 0.5) / 5.0, 0.5)).rgb;
    col = mix(col, enh, ib);
    col = mix(col, vec3(0.0), lineAA(edgeDist(val) / fw, 0.6 * lw) * valid);
    if (u_firstOn > 0.5) {
      vec2 s0 = sampleLayer(uv, 0.0);
      float e0 = lineAA(edgeDist(s0.x) / fw, 0.75 * lw) * step(0.5, s0.y) * inLat;
      float dash = step(0.5, fract((frag.x + frag.y) / (10.0 * u_dpr)));
      col = mix(col, vec3(0.0, 0.34, 0.9), e0 * dash);
    }
  }

  if (u_ringsOn > 0.5) {
    for (int i = 0; i < 160; i++) {
      float L = float(i);
      if (L >= u_nLayers) break;
      vec2 si = sampleLayer(uv, L);
      float e = lineAA(edgeDist(si.x) / fw, 0.6 * lw) * step(0.5, si.y) * inLat;
      float bin = floor(L / max(1.0, u_nLayers) * 10.0);
      vec3 rc = texture(u_ringRamp, vec2((bin + 0.5) / 10.0, 0.5)).rgb;
      col = mix(col, rc, e);
    }
  }

  if (u_isoOn > 0.5) {
    col = mix(col, vec3(0.9, 0.1, 0.1), lineAA(abs(val - u_iso) / fw, 0.75 * lw) * valid);
  }

  if (u_regionOn > 0.5) {
    float r = (ll.y >= u_region.x && ll.y <= u_region.y) ? lonIn(ll.x, u_region.z, u_region.w) : 0.0;
    col = mix(mix(col, vec3(1.0), 0.6), col, r);
  }

  float alpha = 1.0;
  if (u_proj == 1) {
    // Sphere shading: darken toward the limb so the disc reads as a ball,
    // and fade the last pixel so the silhouette is not jagged.
    col *= 1.0 - 0.5 * pow(1.0 - mu, 2.6);
    alpha = clamp(edge * u_k / u_dpr, 0.0, 1.0);
  }
  outColor = vec4(col * alpha, alpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Shader compile failed: " + log);
  }
  return s;
}

export class FieldRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("This browser does not support WebGL2.");
    this.gl = gl;
    this.canvas = canvas;
    this.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Program link failed: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) {
      const info = gl.getActiveUniform(prog, k);
      this.u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    this.tex = {};
    for (const name of ["cmap", "auxCmap", "ringRamp", "zoneRamp"]) this.tex[name] = this._lut(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]));
    this.tex.field = gl.createTexture();
    this.tex.aux = gl.createTexture();
    this.tex.dipole = gl.createTexture();
    this.fieldInfo = null;
    this.setAux(null);
    this.setDipole(null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex.field);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG16F, 1, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
    this._params(gl.TEXTURE_2D_ARRAY, true);
  }

  _lut(lut) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _params(target, wrapLon) {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapLon ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setLUT(name, lut) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
  }

  setField(data, grid, layers) {
    const gl = this.gl;
    if (layers > this.maxLayers) throw new Error(`Too many layers (${layers} > ${this.maxLayers})`);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex.field);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG16F, grid.nlon, grid.nlat, layers, 0, gl.RG, gl.FLOAT, data);
    this._params(gl.TEXTURE_2D_ARRAY, grid.nlon * grid.dlon >= 359.99);
    this.fieldInfo = { grid, layers };
  }

  setAux(data, grid) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.aux);
    if (!data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      this._params(gl.TEXTURE_2D, true);
      return;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, grid.nlon, grid.nlat, 0, gl.RGBA, gl.FLOAT, data);
    this._params(gl.TEXTURE_2D, grid.nlon * grid.dlon >= 359.99);
  }

  setDipole(data, grid) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.dipole);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(2));
      this._params(gl.TEXTURE_2D, true);
      return;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, grid.nlon, grid.nlat, 0, gl.RG, gl.UNSIGNED_BYTE, data);
    this._params(gl.TEXTURE_2D, grid.nlon * grid.dlon >= 359.99);
  }

  resize(w, h, dpr) {
    const c = this.canvas;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  }

  draw(p) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const bind = (unit, target, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
      if (u[name]) gl.uniform1i(u[name], unit);
    };
    bind(0, gl.TEXTURE_2D_ARRAY, this.tex.field, "u_field");
    bind(1, gl.TEXTURE_2D, this.tex.cmap, "u_cmap");
    bind(2, gl.TEXTURE_2D, this.tex.aux, "u_aux");
    bind(3, gl.TEXTURE_2D, this.tex.auxCmap, "u_auxCmap");
    bind(4, gl.TEXTURE_2D, this.tex.ringRamp, "u_ringRamp");
    bind(5, gl.TEXTURE_2D, this.tex.zoneRamp, "u_zoneRamp");
    bind(6, gl.TEXTURE_2D, this.tex.dipole, "u_dipole");
    const f1 = (n, v) => u[n] && gl.uniform1f(u[n], v);
    const f2 = (n, a, b) => u[n] && gl.uniform2f(u[n], a, b);
    const f3 = (n, a, b, c) => u[n] && gl.uniform3f(u[n], a, b, c);
    const f4 = (n, a, b, c, d) => u[n] && gl.uniform4f(u[n], a, b, c, d);
    const i1 = (n, v) => u[n] && gl.uniform1i(u[n], v);
    const g = this.fieldInfo?.grid ?? { lat0: -90, dlat: 180, lon0: -180, dlon: 360, nlat: 1, nlon: 1 };
    f2("u_res", this.canvas.width, this.canvas.height);
    f1("u_dpr", p.dpr);
    i1("u_proj", p.proj);
    f1("u_k", p.k);
    f2("u_t", p.tx, p.ty);
    if (u.u_rotM) gl.uniformMatrix3fv(u.u_rotM, false, p.rotM);
    f1("u_cam", p.cam ?? 3.6);
    f1("u_clip", p.clip ?? Math.PI);
    const fr = p.frame ?? [0, 0, this.canvas.width, this.canvas.height];
    f4("u_frame", fr[0], fr[1], fr[2], fr[3]);
    f4("u_grid", g.lat0, g.dlat, g.lon0, g.dlon);
    f2("u_gsize", g.nlon, g.nlat);
    f1("u_layerA", p.layerA ?? 0);
    f1("u_layerB", p.layerB ?? 0);
    f1("u_mix", p.mix ?? 0);
    f1("u_nLayers", this.fieldInfo?.layers ?? 1);
    f1("u_hasField", this.fieldInfo ? 1 : 0);
    f1("u_cells", p.cells ? 1 : 0);
    f2("u_cdom", p.cdom[0], p.cdom[1]);
    f1("u_gamma", p.gamma ?? 1);
    f1("u_levels", p.levels ?? 0);
    f1("u_contours", p.contours ? 1 : 0);
    f1("u_gray", p.gray ? 1 : 0);
    i1("u_layer", p.layer ?? 0);
    f1("u_auxLevels", p.auxLevels ?? 12);
    f1("u_pHatch", p.pHatch ? 1 : 0);
    f2("u_band", p.band?.[0] ?? -1000, p.band?.[1] ?? 1000);
    f1("u_bandOn", p.bandOn ? 1 : 0);
    f1("u_bandSoft", p.bandSoft ?? 0.08);
    f1("u_trailN", p.trailN ?? 0);
    f1("u_firstOn", p.firstOn ? 1 : 0);
    f1("u_ringsOn", p.ringsOn ? 1 : 0);
    const r = p.region;
    f4("u_region", r?.latMin ?? -90, r?.latMax ?? 90, r?.lonMin ?? -180, r?.lonMax ?? 180);
    f1("u_regionOn", r ? 1 : 0);
    f1("u_isoOn", p.isoOn ? 1 : 0);
    f1("u_iso", p.iso ?? 0);
    f1("u_dipoleOn", p.dipoleOn ? 1 : 0);
    const nd = p.nodata ?? [0.84, 0.84, 0.84];
    f3("u_nodata", nd[0], nd[1], nd[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
