// Demo director: drives the app along a fixed timeline for the 30-second
// demo video (scene changes, a pointer that opens menus, simple captions,
// title and end cards). Loaded only by app/dev/record-demo.mjs; it never
// runs in normal use. Written with Claude and reviewed by the team.

import { app, setTime, setPlaying, ensureVars } from "../main.js";

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const DURATION = 29.0;

// [start, end, text]: read these aloud for the voice-over.
export const CAPTIONS = [
  [0.2, 2.2, "This is Trend Detective."],
  [2.2, 6.1, "Most tools pin a place and watch its numbers change."],
  [6.1, 10.0, "We pin a number, 10 °C, and watch where it goes."],
  [10.0, 14.6, "Europe's 10 °C zone has moved north about 114 km per decade."],
  [14.6, 18.8, "Same variable, opposite trends: cleaner air over Europe, hazier over India."],
  [18.8, 22.7, "Arrows show where each climate is heading, and how fast."],
  [22.7, 26.9, "Every trend is tested, then checked against NASA and NSIDC records."],
  [26.9, 29.0, "Try it free, in any browser."],
];

const EUROPE = { mode: "band", variable: "t2m", regionId: "europe", custom: null, months: ALL, band: { min: 10, max: null }, showTrail: true, showFirst: true, showRings: false, showTrack: false, showDipole: false, proj: "auto", cadence: "annual", period: null, chartKind: "edge", prompt: null };
const COMPARE = { mode: "compare", variable: "aod", regionId: "europe", compareId: "indo_gangetic", custom: null, months: ALL, proj: "auto", cadence: "annual", period: null, hatch: true, chartKind: "trend" };
const VECTORS = { mode: "vectors", variable: "t2m", regionId: "global", custom: null, vecSource: "velocity", vecWindow: 15, months: ALL, proj: "auto", cadence: "annual", period: null };
const VALIDATE = { mode: "validate", variable: "t2m", regionId: "global", custom: null, months: ALL, period: null };

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const settle = async () => { await app.lastUpdate; await raf(); await raf(); };
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let els = null;
let cursor = { x: 1300, y: 700 };
let path = [];       // [time, x, y]
let rings = [];      // click times
let events = [];     // [time, async fn]
let nextEvent = 0;

function center(sel, dx = 0, dy = 0) {
  const el = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy];
}

function menuButton(label) {
  return [...document.querySelectorAll(".menu > button")].find((b) => b.textContent.trim().startsWith(label));
}

function menuItem(text) {
  return [...document.querySelectorAll(".menu.open .mi")].find((b) => b.textContent.includes(text));
}

// Pointer goes to an element (resolved when the move starts), then clicks.
function moveTo(t0, t1, target, opts = {}) {
  events.push([t0, async () => {
    const el = typeof target === "function" ? target() : target;
    const c = el && center(el, opts.dx ?? 0, opts.dy ?? 0);
    if (c) path.push([t0, cursor.x, cursor.y], [t1, c[0], c[1]]);
  }]);
}
function click(t, fn) {
  rings.push(t);
  events.push([t, fn]);
}

function openMenu(label) {
  return async () => { menuButton(label)?.click(); await raf(); };
}
function hover(text) {
  return async () => {
    document.querySelectorAll(".mi.demo-hover").forEach((e) => e.classList.remove("demo-hover"));
    const it = menuItem(text);
    if (it) { it.scrollIntoView({ block: "nearest" }); it.classList.add("demo-hover"); }
    await raf();
  };
}
function choose(text) {
  return async () => { const it = menuItem(text); if (it) it.click(); await settle(); };
}

function buildTimeline() {
  // Scene 2: press play on the loop.
  moveTo(2.3, 2.9, () => document.querySelector('[data-f="play"]'));
  click(2.95, async () => {});
  moveTo(5.0, 6.4, () => document.getElementById("map"), { dx: 60, dy: 10 });
  moveTo(8.8, 9.6, () => document.getElementById("iHero"), { dy: 10 });
  // Scene 3: Display > Edge history (all years).
  moveTo(10.2, 10.7, () => menuButton("Display"));
  click(10.75, openMenu("Display"));
  moveTo(10.9, 11.5, () => menuItem("Edge history"));
  events.push([11.4, hover("Edge history")]);
  click(11.9, choose("Edge history"));
  moveTo(12.4, 13.2, () => document.querySelector("#iA .wcard"), { dy: 4 });
  // Scene 4: Procedures > the haze question.
  moveTo(13.5, 14.0, () => menuButton("Procedures"));
  click(14.05, openMenu("Procedures"));
  moveTo(14.1, 14.45, () => menuItem("cleaner over Europe"));
  events.push([14.35, hover("cleaner over Europe")]);
  click(14.6, async () => { await choose("cleaner over Europe")(); app.set(COMPARE); await settle(); });
  moveTo(15.4, 16.6, () => document.getElementById("iHero"), { dx: 128, dy: 8 });
  // Scene 5: Product > Vector loop.
  moveTo(17.6, 18.1, () => menuButton("Product"));
  click(18.15, openMenu("Product"));
  moveTo(18.2, 18.6, () => menuItem("Vector loop"));
  events.push([18.5, hover("Vector loop")]);
  click(18.8, async () => { await choose("Vector loop")(); app.set(VECTORS); await settle(); });
  moveTo(19.4, 21.0, () => document.getElementById("map"), { dx: -120, dy: -40 });
  // Scene 6: Product > Validation.
  moveTo(21.7, 22.2, () => menuButton("Product"));
  click(22.25, openMenu("Product"));
  moveTo(22.3, 22.6, () => menuItem("Validation"));
  events.push([22.5, hover("Validation")]);
  click(22.7, async () => { await choose("Validation")(); app.set(VALIDATE); await settle(); });
  moveTo(23.6, 25.0, () => document.querySelector("#iA .wcard"), { dy: 8 });
  events.sort((a, b) => a[0] - b[0]);
  rings.sort((a, b) => a - b);
}

function overlayCard(id, html) {
  const d = document.createElement("div");
  d.id = id;
  d.style.cssText = "position:fixed;inset:0;z-index:900;display:grid;place-content:center;justify-items:center;gap:10px;background:#fff;opacity:0;pointer-events:none;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',Helvetica,Arial,sans-serif;color:#1c1c1e";
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
}

export async function install(opts = {}) {
  try { localStorage.setItem("td-hint", "1"); } catch { /* ignore */ }
  setPlaying(false);
  document.getElementById("caption").hidden = true;
  // Instant framing: no fly animations while frames are captured.
  app.map.flyTo = (target) => { Object.assign(app.map.view, target); app.map.fly = null; app.map.baseDirty = true; app.map.requestRender(); };
  await ensureVars(["t2m", "aod", "seaice"]);
  const style = document.createElement("style");
  style.textContent = `.mi.demo-hover{background:#007aff!important;color:#fff!important}.mi.demo-hover .key,.mi.demo-hover .chk{color:#fff!important}`;
  document.head.appendChild(style);
  const team = opts.team ? `<div style="font-size:22px;color:#48484a;margin-top:6px">${opts.team}</div>` : "";
  const members = opts.members ? `<div style="font-size:17px;color:#8e8e93">${opts.members}</div>` : "";
  els = {
    title: overlayCard("demoTitle", `
      <svg viewBox="0 0 16 16" width="64" height="64"><path d="M1 11c3-4 5-4 7-2s4 2 7-2" stroke="#007aff" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M1 6c3-4 5-4 7-2s4 2 7-2" stroke="#c7c7cc" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
      <div style="font-size:72px;font-weight:600;letter-spacing:-0.02em">Trend Detective</div>
      <div style="font-size:30px;color:#48484a">Fix the value. Watch the place move.</div>
      ${team}${members}
      <div style="font-size:18px;color:#8e8e93;margin-top:14px">NASA Space Apps Challenge 2026 · Be an Earth System Trend Detective!</div>
      <div style="font-size:16px;color:#8e8e93">Data: NASA MERRA-2 monthly means, 1980–2026</div>`),
    end: overlayCard("demoEnd", `
      <div style="font-size:64px;font-weight:600;letter-spacing:-0.02em">Trend Detective</div>
      <div style="font-size:30px;color:#007aff;font-weight:500">trend-detective-pipeline.vercel.app</div>
      <div style="font-size:18px;color:#8e8e93;margin-top:10px">NASA MERRA-2 · checked against NASA GISTEMP and the NSIDC Sea Ice Index · free, no login</div>`),
    caption: (() => {
      const d = document.createElement("div");
      d.id = "demoCaption";
      d.style.cssText = "position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:950;max-width:1600px;white-space:nowrap;padding:12px 24px;border-radius:14px;background:rgba(28,28,30,0.86);color:#fff;font:600 30px/1.3 -apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif;text-align:center;opacity:0;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.18)";
      document.body.appendChild(d);
      return d;
    })(),
    pointer: (() => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;top:0;z-index:1000;pointer-events:none;width:30px;height:30px";
      d.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2.5v17.2l4.4-4.2 3.1 6.9 3-1.4-3-6.7h6.2z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
      document.body.appendChild(d);
      return d;
    })(),
    ring: (() => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;top:0;z-index:999;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(0,122,255,0.75);opacity:0";
      document.body.appendChild(d);
      return d;
    })(),
  };
  app.set(EUROPE);
  await settle();
  setTime(0);
  buildTimeline();
  window.DEMO = { frame, DURATION, CAPTIONS };
  return { duration: DURATION, captions: CAPTIONS };
}

function cursorAt(t) {
  // Last segment that has started.
  let x = cursor.x, y = cursor.y;
  for (let k = 0; k + 1 < path.length; k += 2) {
    const [a, x0, y0] = path[k], [b, x1, y1] = path[k + 1];
    if (t < a) break;
    const f = ease(clamp((t - a) / Math.max(0.001, b - a), 0, 1));
    x = x0 + (x1 - x0) * f; y = y0 + (y1 - y0) * f;
  }
  cursor = { x, y };
  return cursor;
}

export async function frame(t) {
  while (nextEvent < events.length && events[nextEvent][0] <= t + 1e-6) {
    await events[nextEvent][1]();
    nextEvent++;
  }
  const s = app.state;
  // Loops: the Shift zone 1980 -> 2025, then the climate-velocity windows.
  if (s.mode === "band" && t < 10.0) setTime(Math.round(clamp((t - 3.0) / 5.4, 0, 1) * (app.frames.n - 1)));
  else if (s.mode === "band") setTime(app.frames.n - 1);
  if (s.mode === "vectors") setTime(Math.round(clamp((t - 19.0) / 3.4, 0, 1) * (app.frames.n - 1)));

  els.title.style.opacity = String(1 - clamp((t - 1.9) / 0.4, 0, 1));
  els.end.style.opacity = String(clamp((t - 26.9) / 0.4, 0, 1));
  const cap = CAPTIONS.find(([a, b]) => t >= a && t < b);
  els.caption.textContent = cap ? cap[2] : "";
  els.caption.style.opacity = cap ? "1" : "0";
  const c = cursorAt(t);
  const showPointer = t > 2.2 && t < 26.8;
  els.pointer.style.opacity = showPointer ? "1" : "0";
  els.pointer.style.transform = `translate(${c.x - 4}px, ${c.y - 3}px)`;
  const lastClick = rings.filter((r) => r <= t).pop();
  const age = lastClick == null ? 9 : t - lastClick;
  els.ring.style.opacity = showPointer && age < 0.4 ? String(1 - age / 0.4) : "0";
  els.ring.style.transform = `translate(${c.x}px, ${c.y}px) scale(${0.5 + age * 1.6})`;
  await raf();
  await raf();
}
