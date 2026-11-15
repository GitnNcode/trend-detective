// WebGL2 field renderer. One full-screen fragment shader inverse-projects
// every pixel (equirectangular, orthographic globe or polar stereographic, with
// the same math and rotation conventions as d3-geo), samples the data from a
// texture array (one layer per year or month, hardware bilinear filtering),
// and composites the layers: field, trend with significance fog, Shift-mode
// heat zone with its ghost trail, first-year outline, year rings, dipole tint,
// isolines and region spotlight.
// Written with Claude and reviewed by the team.

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform vec2 u_res;
uniform float u_dpr;
uniform int u_proj;        // 0 equirectangular, 1 orthographic, 2 stereographic
uniform float u_k;         // device px per unit of the raw projection
uniform vec2 u_t;          // translate (device px, from top-left)
uniform vec2 u_rot;        // d3 rotate (lambda, phi) in radians
uniform float u_clip;      // stereographic clip angle (radians)

uniform sampler2DArray u_field;
uniform vec4 u_grid;       // lat0, dlat, lon0, dlon
uniform vec2 u_gsize;      // nlon, nlat
uniform float u_layerA;
uniform float u_layerB;
uniform float u_mix;
uniform float u_nLayers;
uniform float u_hasField;

uniform sampler2D u_cmap;
uniform vec2 u_cdom;
uniform float u_gamma;
uniform float u_bright;
uniform float u_sat;

uniform int u_layer;       // 0 field, 1 aux diverging (+ p fog), 2 aux sequential
uniform sampler2D u_aux;
uniform sampler2D u_auxCmap;
uniform float u_auxGamma;
uniform float u_pFog;

uniform vec2 u_band;       // lo, hi in normalized field units (+-1000 = open)
uniform float u_bandOn;
uniform float u_bandSoft;
uniform float u_trailN;
uniform float u_trailStep;
uniform float u_firstOn;
uniform float u_firstLayer;
uniform float u_ringsOn;
uniform float u_ringStep;
uniform sampler2D u_ringRamp;
uniform sampler2D u_zoneRamp;
uniform float u_pulse;

uniform vec4 u_region;     // latMin, latMax, lonMin, lonMax (degrees)
uniform float u_regionOn;
uniform float u_isoOn;
uniform float u_iso;
uniform sampler2D u_dipole;
uniform float u_dipoleOn;
uniform vec3 u_ocean;
uniform float u_light;

out vec4 outColor;
const float PI = 3.141592653589793;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Screen (device px, top-left origin) -> (lon, lat) degrees. Mirrors d3-geo:
// screen = translate + k * [x, -y], raw inverse, then inverse rotation.
bool inverseProject(vec2 p, out vec2 ll, out float zc) {
  float rho = length(p);
  float lam, phi;
  zc = 1.0;
  if (u_proj == 0) {
    if (abs(p.x) > PI || abs(p.y) > PI * 0.5) return false;
    lam = p.x; phi = p.y;
  } else {
    float c;
    if (u_proj == 1) {
      if (rho > 1.0) return false;
      c = asin(rho);
    } else {
      c = 2.0 * atan(rho);
      if (c > u_clip) return false;
    }
    float sc = sin(c), cc = cos(c);
    zc = cc;
    lam = atan(p.x * sc, rho * cc);
    phi = rho > 1e-9 ? asin(clamp(p.y * sc / rho, -1.0, 1.0)) : 0.0;
  }
  float cp = cos(phi);
  vec3 q = vec3(cos(lam) * cp, sin(lam) * cp, sin(phi));
  float cd = cos(u_rot.y), sd = sin(u_rot.y);
  float l2 = atan(q.y, q.x * cd + q.z * sd);
  float p2 = asin(clamp(q.z * cd - q.x * sd, -1.0, 1.0));
  l2 -= u_rot.x;
  l2 = mod(l2 + PI, 2.0 * PI) - PI;
  ll = vec2(degrees(l2), degrees(p2));
  return true;
}

vec2 sampleLayer(vec2 uv, float layer) {
  vec2 s = texture(u_field, vec3(uv, layer)).rg;
  return vec2(s.g > 0.001 ? s.r / s.g : 0.0, s.g);
}

vec2 sampleField(vec2 uv) {
  vec2 a = sampleLayer(uv, u_layerA);
  if (u_mix <= 0.0001) return a;
  vec2 b = sampleLayer(uv, u_layerB);
  return mix(a, b, u_mix);
}

float lonIn(float lon, float a, float b) {
  if (b - a >= 359.99) return 1.0;
  float width = mod(b - a + 720.0, 360.0);
  float off = mod(lon - a + 720.0, 360.0);
  return off <= width + 1e-3 ? 1.0 : 0.0;
}

float regionMask(vec2 ll) {
  if (ll.y < u_region.x || ll.y > u_region.y) return 0.0;
  return lonIn(ll.x, u_region.z, u_region.w);
}

float inBand(float v, float fw) {
  float a = u_band.x < -100.0 ? 1.0 : smoothstep(u_band.x - fw, u_band.x + fw, v);
  float b = u_band.y > 100.0 ? 1.0 : 1.0 - smoothstep(u_band.y - fw, u_band.y + fw, v);
  return a * b;
}

float bandDepth(float v) {
  float d = 1e3;
  if (u_band.x > -100.0) d = min(d, v - u_band.x);
  if (u_band.y < 100.0) d = min(d, u_band.y - v);
  return clamp(d / u_bandSoft, 0.0, 1.0);
}

float edgeDist(float v) {
  float d = 1e3;
  if (u_band.x > -100.0) d = min(d, abs(v - u_band.x));
  if (u_band.y < 100.0) d = min(d, abs(v - u_band.y));
  return d;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 p = vec2((frag.x - u_t.x) / u_k, (u_t.y - frag.y) / u_k);
  vec2 ll = vec2(0.0);
  float zc = 1.0;
  bool ok = inverseProject(p, ll, zc);

  // Sample before branching so screen-space derivatives stay defined.
  vec2 uv = vec2(((ll.x - u_grid.z) / u_grid.w + 0.5) / u_gsize.x,
                 ((ll.y - u_grid.x) / u_grid.y + 0.5) / u_gsize.y);
  float fi = (ll.y - u_grid.x) / u_grid.y;
  float inLat = (fi >= -0.5 && fi <= u_gsize.y - 0.5) ? 1.0 : 0.0;
  vec2 s = sampleField(uv);
  float val = s.x;
  float valid = smoothstep(0.3, 0.7, s.y) * inLat * u_hasField;
  float fw = max(fwidth(val), 1e-5);

  if (!ok) {
    if (u_proj == 1) {
      float d = length(p) - 1.0;
      float glow = exp(-d * 26.0) * 0.55 + exp(-d * 7.0) * 0.12;
      outColor = vec4(vec3(0.32, 0.62, 1.0) * glow, glow);
    } else {
      outColor = vec4(0.0);
    }
    return;
  }

  vec3 col = u_ocean;
  if (u_layer == 0) {
    float t = clamp((val - u_cdom.x) / (u_cdom.y - u_cdom.x), 0.0, 1.0);
    t = pow(t, u_gamma);
    vec3 c = texture(u_cmap, vec2(t, 0.5)).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, u_sat) * u_bright;
    col = mix(u_ocean, c, valid);
  } else {
    vec4 a = texture(u_aux, uv);
    float av = a.g > 0.001 ? a.r / a.g : 0.0;
    float ap = a.g > 0.001 ? a.b / a.g : 1.0;
    float avalid = smoothstep(0.3, 0.7, a.g) * inLat;
    vec3 c;
    if (u_layer == 1) {
      c = texture(u_auxCmap, vec2(clamp(av * 0.5 + 0.5, 0.0, 1.0), 0.5)).rgb;
      if (u_pFog > 0.5) {
        float sig = 1.0 - smoothstep(0.035, 0.07, ap);
        float hatch = step(0.6, fract((frag.x - frag.y) / (6.0 * u_dpr)));
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 fog = mix(vec3(l), c, 0.3) * 0.55 + vec3(hatch * 0.045);
        c = mix(fog, c, sig);
      }
      c *= u_bright;
    } else {
      c = texture(u_auxCmap, vec2(pow(clamp(av, 0.0, 1.0), u_auxGamma), 0.5)).rgb * u_bright;
    }
    col = mix(u_ocean, c, avalid);
  }

  if (u_dipoleOn > 0.5) {
    vec2 m = texture(u_dipole, uv).rg;
    float arr = smoothstep(0.25, 0.6, m.r) * inLat;
    float lef = smoothstep(0.25, 0.6, m.g) * inLat;
    float stripe = step(0.5, fract((frag.x + frag.y) / (8.0 * u_dpr)));
    col = mix(col, vec3(1.0, 0.47, 0.16), arr * (0.58 + 0.2 * stripe));
    col = mix(col, vec3(0.26, 0.78, 1.0), lef * (0.58 + 0.2 * stripe));
  }

  if (u_bandOn > 0.5) {
    float trail = 0.0;
    float cur = floor(u_layerA + u_mix + 0.001);
    for (int k = 1; k <= 24; k++) {
      if (float(k) > u_trailN) break;
      float L = cur - float(k) * u_trailStep;
      if (L < 0.0) break;
      vec2 sk = sampleLayer(uv, L);
      float ib = inBand(sk.x, fw) * smoothstep(0.3, 0.7, sk.y) * inLat;
      trail = max(trail, ib * (1.0 - (float(k) - 1.0) / u_trailN));
    }
    col = mix(col, vec3(0.62, 0.17, 0.05), trail * 0.55);

    float ib = inBand(val, fw) * valid;
    float depth = bandDepth(val);
    vec3 heat = texture(u_zoneRamp, vec2(0.12 + 0.88 * depth, 0.5)).rgb;
    heat *= 0.92 + 0.08 * u_pulse;
    col = mix(col, heat, ib * 0.92);
    float e = 1.0 - smoothstep(0.55, 1.6, edgeDist(val) / fw);
    col = mix(col, vec3(1.0, 0.95, 0.85), e * valid);

    if (u_firstOn > 0.5) {
      vec2 s0 = sampleLayer(uv, u_firstLayer);
      float e0 = 1.0 - smoothstep(0.5, 1.5, edgeDist(s0.x) / fw);
      float dash = step(0.42, fract((frag.x + frag.y * 0.6) / (10.0 * u_dpr)));
      col = mix(col, vec3(0.72, 0.92, 1.0), e0 * dash * smoothstep(0.3, 0.7, s0.y) * inLat * 0.95);
    }
  }

  if (u_ringsOn > 0.5) {
    for (int i = 0; i < 200; i++) {
      float L = float(i) * u_ringStep;
      if (L >= u_nLayers) break;
      vec2 si = sampleLayer(uv, L);
      float e = 1.0 - smoothstep(0.3, 1.2, edgeDist(si.x) / fw);
      float vi = smoothstep(0.3, 0.7, si.y) * inLat;
      vec3 rc = texture(u_ringRamp, vec2(L / max(1.0, u_nLayers - 1.0), 0.5)).rgb;
      col = mix(col, rc, e * vi * 0.92);
    }
  }

  if (u_isoOn > 0.5) {
    float e = 1.0 - smoothstep(0.5, 1.5, abs(val - u_iso) / fw);
    col = mix(col, vec3(1.0, 0.86, 0.6), e * valid * 0.9);
  }

  if (u_regionOn > 0.5) {
    col *= mix(0.36, 1.0, regionMask(ll));
  }

  if (u_proj == 1) {
    vec3 n = vec3(p.x, p.y, zc);
    vec3 L = normalize(vec3(-0.5, 0.55, 0.75));
    float diff = max(dot(n, L), 0.0);
    col *= mix(1.0, 0.42 + 0.78 * diff, u_light);
    float rim = pow(1.0 - zc, 2.6);
    col += vec3(0.22, 0.5, 1.0) * rim * 0.42 * u_light;
  }

  col += (hash(frag) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
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

function lutTexture(gl, lut) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
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

    // Texture units: 0 field array, 1 cmap, 2 aux, 3 auxCmap, 4 ringRamp, 5 zoneRamp, 6 dipole
    this.tex = {};
    const blank = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]);
    this.tex.cmap = lutTexture(gl, blank);
    this.tex.auxCmap = lutTexture(gl, blank);
    this.tex.ringRamp = lutTexture(gl, blank);
    this.tex.zoneRamp = lutTexture(gl, blank);
    this.tex.field = gl.createTexture();
    this.tex.aux = gl.createTexture();
    this.tex.dipole = gl.createTexture();
    this.fieldInfo = null;
    this.setAux(null);
    this.setDipole(null);
    this._emptyField();
  }

  _emptyField() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex.field);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG16F, 1, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
    this._params(gl.TEXTURE_2D_ARRAY, true);
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

  // data: Float32Array RG interleaved, layers x nlat x nlon.
  setField(data, grid, layers) {
    const gl = this.gl;
    if (layers > this.maxLayers) throw new Error(`Too many layers (${layers} > ${this.maxLayers})`);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex.field);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG16F, grid.nlon, grid.nlat, layers, 0, gl.RG, gl.FLOAT, data);
    const full = grid.nlon * grid.dlon >= 359.99;
    this._params(gl.TEXTURE_2D_ARRAY, full);
    this.fieldInfo = { grid, layers };
  }

  // data: Float32Array RGBA per cell (value*valid, valid, p*valid, 0), or null.
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

  // data: Uint8Array RG per cell (arrived*255, left*255), or null.
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

  // p: all uniform values (see MapView.render).
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
      gl.uniform1i(u[name], unit);
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
    f2("u_rot", p.rotL, p.rotP);
    f1("u_clip", p.clip ?? Math.PI);
    f4("u_grid", g.lat0, g.dlat, g.lon0, g.dlon);
    f2("u_gsize", g.nlon, g.nlat);
    f1("u_layerA", p.layerA ?? 0);
    f1("u_layerB", p.layerB ?? 0);
    f1("u_mix", p.mix ?? 0);
    f1("u_nLayers", this.fieldInfo?.layers ?? 1);
    f1("u_hasField", this.fieldInfo ? 1 : 0);
    f2("u_cdom", p.cdom[0], p.cdom[1]);
    f1("u_gamma", p.gamma ?? 1);
    f1("u_bright", p.bright ?? 1);
    f1("u_sat", p.sat ?? 1);
    i1("u_layer", p.layer ?? 0);
    f1("u_auxGamma", p.auxGamma ?? 1);
    f1("u_pFog", p.pFog ? 1 : 0);
    f2("u_band", p.band?.[0] ?? -1000, p.band?.[1] ?? 1000);
    f1("u_bandOn", p.bandOn ? 1 : 0);
    f1("u_bandSoft", p.bandSoft ?? 0.08);
    f1("u_trailN", p.trailN ?? 0);
    f1("u_trailStep", p.trailStep ?? 1);
    f1("u_firstOn", p.firstOn ? 1 : 0);
    f1("u_firstLayer", p.firstLayer ?? 0);
    f1("u_ringsOn", p.ringsOn ? 1 : 0);
    f1("u_ringStep", p.ringStep ?? 1);
    f1("u_pulse", p.pulse ?? 0);
    const r = p.region;
    f4("u_region", r?.latMin ?? -90, r?.latMax ?? 90, r?.lonMin ?? -180, r?.lonMax ?? 180);
    f1("u_regionOn", r ? 1 : 0);
    f1("u_isoOn", p.isoOn ? 1 : 0);
    f1("u_iso", p.iso ?? 0);
    f1("u_dipoleOn", p.dipoleOn ? 1 : 0);
    const oc = p.ocean ?? [0.035, 0.05, 0.085];
    f3("u_ocean", oc[0], oc[1], oc[2]);
    f1("u_light", p.light ?? 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
