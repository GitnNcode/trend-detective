// Guided case player: steps through cases.json, applying each step's action
// and narrating it, with back / next / autoplay. Written with Claude and reviewed by the team.

import { actions, setPlaying } from "../main.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class CasePlayer {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById("casePlayer");
    this.caseId = null;
    this.step = 0;
    this.auto = true;
    this.timer = null;
    this.t0 = 0;
    this.dur = 0;
  }

  open() {
    const cases = this.app.content.cases;
    if (this.app.state.view !== "app") actions.enterApp();
    this.el.hidden = false;
    this.el.innerHTML = `<div class="cp-top"><span class="cp-title">Case files: pick one to watch</span><button class="btn small ghost" data-x>Close</button></div>
      <div class="case-cards" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-top:12px">${cases.map((c) => `<button class="case-card" data-case="${c.id}"><span class="play">▶</span><div class="ct">${esc(c.title)}</div><div class="cm">${c.steps.length} STEPS${c.isNew ? " · NEW" : ""}</div></button>`).join("")}</div>`;
    this.el.querySelector("[data-x]").addEventListener("click", () => this.stop());
    this.el.querySelectorAll("[data-case]").forEach((b) => b.addEventListener("click", () => this.start(b.dataset.case)));
  }

  start(id) {
    const c = this.app.content.cases.find((x) => x.id === id) ?? this.app.content.cases[0];
    if (!c) return;
    if (this.app.state.view !== "app") actions.enterApp();
    this.case = c;
    this.step = 0;
    this.auto = true;
    this.el.hidden = false;
    this.go(0);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.case = null;
    this.el.hidden = true;
  }

  go(k) {
    const c = this.case;
    if (!c) return;
    this.step = Math.max(0, Math.min(c.steps.length - 1, k));
    const st = c.steps[this.step];
    const prev = c.steps[this.step - 1];
    const changed = !prev || JSON.stringify(prev.action) !== JSON.stringify(st.action);
    if (changed) actions.applyAction({ ...st.action, play: st.action.play ?? st.action.mode === "band" }, c.title);
    this.render();
    clearInterval(this.timer);
    this.t0 = performance.now();
    this.dur = Math.max(7000, 3500 + st.text.length * 48);
    this.timer = setInterval(() => this.tick(), 100);
  }

  tick() {
    if (!this.case) return;
    const cur = this.el.querySelector(".cp-dots i.cur");
    const f = Math.min(1, (performance.now() - this.t0) / this.dur);
    if (cur) cur.style.setProperty("--p", `${(this.auto ? f : 0) * 100}%`);
    if (this.auto && f >= 1) {
      if (this.step < this.case.steps.length - 1) this.go(this.step + 1);
      else { this.auto = false; this.render(); }
    }
  }

  render() {
    const c = this.case, st = c.steps[this.step];
    this.el.innerHTML = `
      <div class="cp-top"><span class="cp-title">Case: ${esc(c.title)} · step ${this.step + 1} of ${c.steps.length}</span>
        <span class="row"><button class="btn small ghost" data-auto>${this.auto ? "Pause narration" : "Autoplay"}</button><button class="btn small ghost" data-x>✕</button></span></div>
      <div class="cp-text">${esc(st.text)}</div>
      <div class="cp-bottom">
        <button class="btn small" data-back ${this.step === 0 ? "disabled" : ""}>← Back</button>
        <div class="cp-dots">${c.steps.map((_, k) => `<i class="${k < this.step ? "done" : k === this.step ? "cur" : ""}"></i>`).join("")}</div>
        <button class="btn small primary" data-next>${this.step === c.steps.length - 1 ? "Finish" : "Next →"}</button>
      </div>`;
    this.el.querySelector("[data-x]").addEventListener("click", () => this.stop());
    this.el.querySelector("[data-auto]").addEventListener("click", () => { this.auto = !this.auto; this.t0 = performance.now(); this.render(); });
    this.el.querySelector("[data-back]").addEventListener("click", () => { this.auto = false; this.go(this.step - 1); });
    this.el.querySelector("[data-next]").addEventListener("click", () => {
      if (this.step === c.steps.length - 1) { this.stop(); setPlaying(false); return; }
      this.go(this.step + 1);
    });
  }
}
