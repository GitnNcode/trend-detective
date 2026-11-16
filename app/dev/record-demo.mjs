// Record the demo video: drives the app in headless Chromium frame by frame
// (app/dev/demo-director.js) and encodes the frames with ffmpeg.
//
//   node app/dev/record-demo.mjs out.mp4                 full video (1920x1080, 30 fps)
//   node app/dev/record-demo.mjs stills/ --at 1,5,12     single PNG stills for checking
//
// Needs: the app served at APP_URL (default http://localhost:8765/app/),
// ffmpeg on PATH, and a Chromium binary (CHROME, default: Playwright's
// headless shell). Optional TEAM and MEMBERS env vars add them to the title.
// Written with Claude and reviewed by the team.

import { spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] ?? "demo.mp4";
const atIdx = process.argv.indexOf("--at");
const stills = atIdx > 0 ? process.argv[atIdx + 1].split(",").map(Number) : null;
const CHROME = process.env.CHROME ?? join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const APP_URL = process.env.APP_URL ?? "http://localhost:8765/app/#mode=band&variable=t2m&regionId=europe&months=1.2.3.4.5.6.7.8.9.10.11.12&band=10~";
const W = 1920, H = 1080, FPS = 30, PORT = 9333;

const profile = await mkdtemp(join(tmpdir(), "td-demo-"));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--hide-scrollbars", "--force-color-profile=srgb", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let k = 0; k < 100 && !target; k++) {
  await sleep(150);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
}
if (!target) throw new Error("Chromium did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: APP_URL });
for (let k = 0; k < 200; k++) {
  await sleep(200);
  try { if (await evaluate("!!(window.TD && TD.R && TD.R.v && document.getElementById('loader').hidden)")) break; } catch { /* page still loading */ }
}
const probeIdx = process.argv.indexOf("--probe");
if (probeIdx > 0) {
  try { console.log(JSON.stringify(await evaluate(process.argv[probeIdx + 1]))); }
  finally { ws.close(); chrome.kill("SIGTERM"); await sleep(300); await rm(profile, { recursive: true, force: true }); }
  process.exit(0);
}
const opts = JSON.stringify({ team: process.env.TEAM ?? "", members: process.env.MEMBERS ?? "" });
const info = await evaluate(`import('/app/dev/demo-director.js').then((m) => m.install(${opts}))`);
console.log(`director ready, ${info.duration} s`);

const shot = async (format) => Buffer.from((await send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: 95 } : {}) })).data, "base64");

try {
  if (stills) {
    await mkdir(out, { recursive: true });
    const n = Math.round(Math.max(...stills) * FPS);
    for (let f = 0; f <= n; f++) {
      const t = f / FPS;
      await evaluate(`DEMO.frame(${t})`);
      if (stills.some((s) => Math.round(s * FPS) === f)) {
        await writeFile(join(out, `still-${t.toFixed(1)}s.png`), await shot("png"));
        console.log(`still ${t.toFixed(1)} s`);
      }
    }
  } else {
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((r) => ff.on("close", r));
    const frames = Math.round(info.duration * FPS);
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await evaluate(`DEMO.frame(${f / FPS})`);
      const buf = await shot("jpeg");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (f % 60 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    const code = await done;
    console.log(code === 0 ? `wrote ${out}` : `ffmpeg exited with ${code}`);
  }
} finally {
  ws.close();
  chrome.kill("SIGTERM");
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
