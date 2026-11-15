// Landing hero over the spinning globe. Written with Claude and reviewed by the team.

import { actions } from "../main.js";

export function renderLanding(app) {
  const el = document.getElementById("landing");
  const cats = app.catalog.variables;
  let values = 0;
  for (const v of cats) values += v.nt * v.grid.nlat * v.grid.nlon;
  const years = Math.floor(cats[0].nt / 12);
  el.innerHTML = `
    <div class="hero">
      <div class="kicker">NASA Space Apps 2026 · Earth System Trend Detective</div>
      <h1>Don't watch the number.<br/><em>Watch it move.</em></h1>
      <p class="lede">Most tools pin a place and show its temperature rising. We pin a <b>value</b> (the freezing line, the jet stream core, the sea-ice edge) and show you <b>where on Earth it is going</b>, how fast, and whether the change is statistically real.</p>
      <div class="versus">
        <div class="vs">
          <div class="t">Everyone else</div>
          <div class="d">Fix the place. Watch the value change.</div>
          <svg viewBox="0 0 220 46"><path d="M8 38 L40 34 L64 36 L92 28 L120 30 L150 22 L178 18 L210 10" fill="none" stroke="#8b98ad" stroke-width="2"/><circle cx="210" cy="10" r="3.5" fill="#8b98ad"/><path d="M8 42h204" stroke="rgba(148,163,184,.25)"/></svg>
        </div>
        <div class="vs ours">
          <div class="t">Trend Detective</div>
          <div class="d">Fix the value. Watch the place move.</div>
          <svg viewBox="0 0 220 46" class="moving">
            <path d="M6 40 C50 30 80 44 120 34 S190 30 214 36" fill="none" stroke="rgba(76,201,255,.55)" stroke-width="1.6" stroke-dasharray="4 4"/>
            <path class="iso" d="M6 30 C50 20 80 34 120 24 S190 20 214 26" fill="none" stroke="#ff8a3d" stroke-width="2.4"/>
            <path d="M110 30 l0 -16 m-5 5 l5 -5 5 5" stroke="#ffc061" stroke-width="1.6" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <div class="ctas">
        <button class="btn primary" id="ctaStart">Start investigating →</button>
        <button class="btn" id="ctaCase"><span class="dot live"></span>Watch a 60-second case</button>
        <button class="btn ghost" id="ctaTwin">Where did my climate go?</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="n" data-count="${values}" data-fmt="M">0</div><div class="l">NASA monthly values</div></div>
        <div class="stat"><div class="n" data-count="${cats.length}">0</div><div class="l">Earth variables</div></div>
        <div class="stat"><div class="n" data-count="${years}">0</div><div class="l">Years of record</div></div>
        <div class="stat"><div class="n" data-count="${cats[0].grid.nlat * cats[0].grid.nlon}" data-fmt="k">0</div><div class="l">Cells per map</div></div>
      </div>
    </div>
    <div></div>`;
  const style = document.createElement("style");
  style.textContent = `.moving .iso{animation:isoMove 3.2s ease-in-out infinite alternate}@keyframes isoMove{from{transform:translateY(10px)}to{transform:translateY(-8px)}}`;
  el.appendChild(style);
  el.querySelector("#ctaStart").addEventListener("click", () => actions.enterApp(app.content.usecases.find((u) => u.id === "freezing_line") ?? { mode: "band", variable: "t2m", region: "nhem", months: [12, 1, 2], band: { min: null, max: 0 }, prompt: "Where is the freezing line going?" }));
  el.querySelector("#ctaCase").addEventListener("click", () => { actions.enterApp(); setTimeout(() => app.cases.start(app.content.cases[0]?.id), 500); });
  el.querySelector("#ctaTwin").addEventListener("click", () => actions.enterApp({ mode: "twin", variable: "t2m", region: "global", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], prompt: "Where did my hometown's climate go?" }));
  countUp(el);
}

function countUp(root) {
  const els = root.querySelectorAll("[data-count]");
  const t0 = performance.now();
  const fmt = (x, f) => (f === "M" ? (x / 1e6).toFixed(1) + " M" : f === "k" ? Math.round(x).toLocaleString("en-US") : String(Math.round(x)));
  const step = (now) => {
    const f = Math.min(1, (now - t0) / 1800);
    const e = 1 - Math.pow(1 - f, 3);
    els.forEach((el) => { el.textContent = fmt(Number(el.dataset.count) * e, el.dataset.fmt); });
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
