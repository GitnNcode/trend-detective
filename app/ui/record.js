// Record the current loop (title, map and colorbar) as a WebM video, frame by
// frame, for demos and slides. Uses canvas.captureStream + MediaRecorder.
// Written with Claude and reviewed by the team.

import { app, setTime, setPlaying } from "../main.js";
import { toast } from "./workstation.js";

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
let busy = false;

export async function recordLoop() {
  if (busy || !app.frames) return;
  if (typeof MediaRecorder === "undefined") { toast("This browser cannot record video"); return; }
  busy = true;
  const display = document.getElementById("display");
  const dpr = app.map.dpr;
  const map = app.map;
  const cb = document.querySelector("#colorbar canvas");
  const titleH = Math.round(40 * dpr);
  const W = map.glCanvas.width, H = titleH + map.glCanvas.height + (cb ? cb.height : 0);
  const c = document.createElement("canvas");
  c.width = W - (W % 2); c.height = H - (H % 2);
  const ctx = c.getContext("2d");
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  const paint = () => {
    map._render();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    const title = document.querySelector("#figTitle .t")?.textContent ?? "";
    const year = document.getElementById("legendYear")?.textContent ?? "";
    ctx.fillStyle = "#1c1c1e";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(14 * dpr)}px ${SANS}`;
    ctx.fillText(title, 16 * dpr, titleH / 2);
    ctx.textAlign = "right";
    ctx.font = `600 ${Math.round(22 * dpr)}px ${SANS}`;
    ctx.fillText(year, c.width - 16 * dpr, titleH / 2);
    ctx.textAlign = "left";
    ctx.drawImage(map.glCanvas, 0, titleH);
    ctx.drawImage(map.ovCanvas, 0, titleH);
    if (cb) ctx.drawImage(cb, 0, titleH + map.glCanvas.height, c.width, cb.height);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    display.style.outline = "3px solid rgba(255,59,48,0.65)";
    toast("Recording the loop…", 1500);
    setPlaying(false);
    const n = app.frames.n;
    const hold = app.frames.monthly ? 70 : 260;
    setTime(0);
    paint();
    rec.start(250);
    await wait(500);
    for (let k = 0; k < n; k++) {
      setTime(k);
      const until = performance.now() + hold;
      while (performance.now() < until) { paint(); await new Promise((r) => requestAnimationFrame(r)); }
    }
    const end = performance.now() + 1500;
    while (performance.now() < end) { paint(); await new Promise((r) => requestAnimationFrame(r)); }
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    const a = document.createElement("a");
    const s = app.state;
    a.href = URL.createObjectURL(blob);
    a.download = `trend-detective_${s.mode}_${s.variable}_${s.regionId}.${(mimeType || "video/webm").includes("mp4") ? "mp4" : "webm"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Saved ${(blob.size / 1e6).toFixed(1)} MB video`);
  } catch (e) {
    console.error(e);
    toast("Recording failed: " + e.message);
  } finally {
    display.style.outline = "";
    busy = false;
  }
}
