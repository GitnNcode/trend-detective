// Procedures: guided cases played step by step, narrated in a caption bar
// under the display, with back / next / auto-advance.
// Written with Claude and reviewed by the team.

import { actions, setPlaying } from "../main.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class CasePlayer {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById("caption");
    this.case = null;
    this.step = 0;
    this.auto = true;
    this.timer = null;
  }

  start(id) {
    const c = this.app.content.cases.find((x) => x.id === id) ?? this.app.content.cases[0];
    if (!c) return;
    this.case = c;
    this.auto = true;
    this.el.hidden = false;
    this.go(0);
  }

  // First visit: a one-line pointer to the guided tour (dismissible, remembered).
  hint() {
    let seen = false;
    try { seen = localStorage.getItem("td-hint") === "1"; } catch { /* storage blocked */ }
    if (seen || this.case) return;
    const first = this.app.content.cases.find((c) => c.id === "climate_on_the_move") ?? this.app.content.cases[0];
    if (!first) return;
    this.el.hidden = false;
    this.el.innerHTML = `<div class="step">Welcome</div>
      <div class="txt">Each white line on the globe is the fastest sea route between two big ports, worked out from NASA sea ice and wind data, over a map of how much wind and ice slow ships down. Press <b>Show past-year lanes</b> to see how the routes have moved since 1980. Press <b>Predict next 5 years</b> to see where the routes are heading, or take the guided tour, <b>${esc(first.title)}</b>.</div>
      <div class="ctl"><button class="tb on" data-go>Start tour</button><button class="tb icon" data-x title="Close">✕</button></div>`;
    const done = () => { try { localStorage.setItem("td-hint", "1"); } catch { /* ignore */ } };
    this.el.querySelector("[data-go]").addEventListener("click", () => { done(); this.start(first.id); });
    this.el.querySelector("[data-x]").addEventListener("click", () => { done(); this.el.hidden = true; });
  }

  stop() {
    clearTimeout(this.timer);
    this.case = null;
    this.el.hidden = true;
  }

  go(k) {
    const c = this.case;
    if (!c) return;
    this.step = Math.max(0, Math.min(c.steps.length - 1, k));
    const st = c.steps[this.step], prev = c.steps[this.step - 1];
    if (!prev || JSON.stringify(prev.action) !== JSON.stringify(st.action)) {
      actions.applyAction({ ...st.action, play: st.action.play ?? (st.action.mode === "band" && !st.action.showRings && st.action.year == null) }, c.title);
    }
    this.render();
    clearTimeout(this.timer);
    if (this.auto) this.timer = setTimeout(() => {
      if (!this.case) return;
      if (this.step < c.steps.length - 1) this.go(this.step + 1);
      else { this.auto = false; this.render(); }
    }, Math.max(8000, 4000 + st.text.length * 50));
  }

  render() {
    const c = this.case, st = c.steps[this.step];
    this.el.innerHTML = `<div class="step">${esc(c.title)} · ${this.step + 1}/${c.steps.length}</div>
      <div class="txt">${esc(st.text)}</div>
      <div class="ctl">
        <button class="tb" data-back ${this.step === 0 ? "disabled" : ""}>Back</button>
        <button class="tb ${this.auto ? "on" : ""}" data-auto title="Advance automatically">Auto</button>
        <button class="tb" data-next>${this.step === c.steps.length - 1 ? "Done" : "Next"}</button>
        <button class="tb icon" data-x title="Close">✕</button>
      </div>`;
    this.el.querySelector("[data-x]").addEventListener("click", () => this.stop());
    this.el.querySelector("[data-auto]").addEventListener("click", () => { this.auto = !this.auto; this.go(this.step); });
    this.el.querySelector("[data-back]").addEventListener("click", () => { this.auto = false; this.go(this.step - 1); });
    this.el.querySelector("[data-next]").addEventListener("click", () => {
      if (this.step === c.steps.length - 1) { this.stop(); setPlaying(false); return; }
      this.go(this.step + 1);
    });
  }
}
