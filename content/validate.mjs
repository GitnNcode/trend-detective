// Validates the five /content JSON files against the shapes in PLAN.md and
// cross-checks references between them.  Run:  node content/validate.mjs
// Exit code 0 = all good, 1 = at least one error.  No dependencies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

const VARIABLE_IDS = ["t2m", "t500", "wind250", "tqv", "precip", "evap", "seaice", "soilwet", "snow", "runoff"];
const MODES = ["series", "map", "band", "route"];
const REGION_TYPES = ["desert", "rainforest", "estuary", "city air", "ocean", "polar", "global"];
const REQUIRED_REGIONS = ["arctic", "natlantic"];
const REQUIRED_ROUTES = ["nsr", "nwp", "nyc_lon"];
const SEAICE_LAT_MIN = 50; // seaice grid covers 50N to 90N only
const MIN_BOX_DEG = { lat: 2.0, lon: 2.5 }; // a region smaller than one default grid cell has no data

const isStr = (s) => typeof s === "string" && s.trim().length > 0;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const hasOnly = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k));

function checkMonths(file, where, months) {
  if (!Array.isArray(months) || months.length === 0) return err(file, `${where}: months must be a non-empty array`);
  if (!months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) err(file, `${where}: months must be integers 1-12`);
  if (new Set(months).size !== months.length) err(file, `${where}: months has duplicates`);
}

function checkBand(file, where, band) {
  if (!band || typeof band !== "object") return err(file, `${where}: band object required`);
  const { min, max } = band;
  if (!(min === null || isNum(min)) || !(max === null || isNum(max))) return err(file, `${where}: band.min/max must be number or null`);
  if (min === null && max === null) err(file, `${where}: band needs at least one of min/max`);
  if (min !== null && max !== null && min >= max) err(file, `${where}: band.min must be < band.max`);
}

// ---- definitions ----
const definitions = load("definitions.json");
{
  const f = "definitions.json";
  for (const id of VARIABLE_IDS) {
    const d = definitions[id];
    if (!d) { err(f, `missing variable ${id}`); continue; }
    for (const k of ["name", "plain", "why"]) if (!isStr(d[k])) err(f, `${id}.${k} must be a non-empty string`);
    if (!hasOnly(d, ["name", "plain", "why"])) err(f, `${id} has keys outside name/plain/why`);
    for (const k of ["plain", "why"]) if (isStr(d[k]) && (d[k].match(/[.!?](\s|$)/g) || []).length !== 1) err(f, `${id}.${k} should be exactly one sentence`);
  }
  for (const id of Object.keys(definitions)) if (!VARIABLE_IDS.includes(id)) err(f, `unknown variable id ${id}`);
}

// ---- regions ----
const regions = load("regions.json");
const regionById = new Map();
{
  const f = "regions.json";
  if (!Array.isArray(regions)) err(f, "must be an array");
  else {
    if (regions.length < 12 || regions.length > 15) err(f, `needs 12-15 presets, has ${regions.length}`);
    for (const r of regions) {
      const w = `region ${r.id}`;
      if (!isStr(r.id) || !/^[a-z0-9_]+$/.test(r.id)) err(f, `${w}: id must be lowercase snake_case`);
      if (regionById.has(r.id)) err(f, `${w}: duplicate id`);
      regionById.set(r.id, r);
      if (!isStr(r.name)) err(f, `${w}: name required`);
      if (!REGION_TYPES.includes(r.type)) err(f, `${w}: type must be one of ${REGION_TYPES.join(", ")}`);
      if (!hasOnly(r, ["id", "name", "type", "latMin", "latMax", "lonMin", "lonMax"])) err(f, `${w}: unexpected keys`);
      if (![r.latMin, r.latMax, r.lonMin, r.lonMax].every(isNum)) { err(f, `${w}: lat/lon bounds must be numbers`); continue; }
      if (r.latMin < -90 || r.latMax > 90 || r.latMin >= r.latMax) err(f, `${w}: bad latitude range`);
      if (r.lonMin < -180 || r.lonMax > 180 || r.lonMin >= r.lonMax) err(f, `${w}: bad longitude range (lonMin < lonMax within -180..180; no date-line crossing)`);
      if (r.latMax - r.latMin < MIN_BOX_DEG.lat || r.lonMax - r.lonMin < MIN_BOX_DEG.lon) err(f, `${w}: smaller than one grid cell`);
    }
    for (const id of REQUIRED_REGIONS) if (!regionById.has(id)) err(f, `missing required region ${id}`);
    for (const t of ["desert", "rainforest", "estuary", "city air", "ocean", "polar"])
      if (!regions.some((r) => r.type === t)) err(f, `no preset of type ${t}`);
  }
}

// ---- routes ----
const routes = load("routes.json");
const routeById = new Map();
{
  const f = "routes.json";
  if (!Array.isArray(routes)) err(f, "must be an array");
  else {
    for (const r of routes) {
      if (!isStr(r.id) || !isStr(r.name)) err(f, `route needs id and name`);
      if (routeById.has(r.id)) err(f, `duplicate route ${r.id}`);
      routeById.set(r.id, r);
      if (!hasOnly(r, ["id", "name", "points"])) err(f, `route ${r.id}: unexpected keys`);
      if (!Array.isArray(r.points) || r.points.length < 2) { err(f, `route ${r.id}: needs >= 2 points`); continue; }
      r.points.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum)) return err(f, `route ${r.id}[${i}]: must be [lat, lon]`);
        if (Math.abs(p[0]) > 90 || p[1] < -180 || p[1] > 180) err(f, `route ${r.id}[${i}]: out of range (lat -90..90, lon -180..180)`);
      });
    }
    for (const id of REQUIRED_ROUTES) if (!routeById.has(id)) err(f, `missing required route ${id}`);
  }
}

// ---- oil terminals (tanker planner) ----
{
  const f = "terminals.json";
  const terms = load(f);
  if (!Array.isArray(terms)) err(f, "must be an array");
  else {
    const ids = new Set();
    for (const t of terms) {
      if (!isStr(t.id) || !isStr(t.name) || !isStr(t.country)) err(f, "terminal needs id, name and country");
      if (ids.has(t.id)) err(f, `duplicate terminal ${t.id}`);
      ids.add(t.id);
      if (!isNum(t.lat) || !isNum(t.lon) || Math.abs(t.lat) > 90 || Math.abs(t.lon) > 180) err(f, `terminal ${t.id}: bad lat/lon`);
    }
  }
}

// ---- shipping lanes ----
{
  const f = "lanes.json";
  const lanes = load(f);
  const port = (p) => p && isStr(p.name) && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  if (!Array.isArray(lanes)) err(f, "must be an array");
  else {
    const ids = new Set();
    for (const l of lanes) {
      if (!isStr(l.id) || !isStr(l.name) || !isStr(l.cargo)) err(f, "lane needs id, name and cargo");
      if (ids.has(l.id)) err(f, `duplicate lane ${l.id}`);
      ids.add(l.id);
      if (!port(l.from) || !port(l.to)) err(f, `lane ${l.id}: from and to need name, lat, lon`);
    }
  }
}

// ---- shared action check (usecases rows and case-step actions) ----
function checkAction(file, where, a) {
  if (!VARIABLE_IDS.includes(a.variable)) err(file, `${where}: unknown variable ${a.variable}`);
  const region = regionById.get(a.region);
  if (!region) err(file, `${where}: unknown region ${a.region}`);
  if (!MODES.includes(a.mode)) err(file, `${where}: bad mode ${a.mode}`);
  if (a.months !== undefined) checkMonths(file, where, a.months);
  if (a.mode === "band") checkBand(file, where, a.band);
  if (a.mode === "route") {
    if (!routeById.has(a.route)) err(file, `${where}: route mode needs a known route id`);
    if (a.band) checkBand(file, where, a.band);
    else if (a.variable !== "seaice") err(file, `${where}: route mode needs band.max threshold`);
  }
  if (a.route !== undefined && !routeById.has(a.route)) err(file, `${where}: unknown route ${a.route}`);
  if (a.variable === "seaice" && region && region.latMin < SEAICE_LAT_MIN) err(file, `${where}: seaice only exists north of ${SEAICE_LAT_MIN}N but region ${a.region} reaches ${region.latMin}`);
}

// ---- usecases ----
const usecases = load("usecases.json");
{
  const f = "usecases.json";
  if (!Array.isArray(usecases)) err(f, "must be an array");
  else {
    if (usecases.length < 12 || usecases.length > 15) err(f, `needs 12-15 rows, has ${usecases.length}`);
    const prompts = new Set();
    usecases.forEach((u, i) => {
      const w = `row ${i} ("${u.prompt}")`;
      if (!isStr(u.prompt) || !u.prompt.trim().endsWith("?")) err(f, `${w}: prompt must be a question`);
      if (prompts.has(u.prompt)) err(f, `${w}: duplicate prompt`);
      prompts.add(u.prompt);
      if (!hasOnly(u, ["prompt", "variable", "region", "months", "mode", "band", "route"])) err(f, `${w}: unexpected keys`);
      if (u.months === undefined) err(f, `${w}: months required`);
      checkAction(f, w, u);
    });
    // The challenge's central point: one variable, opposite trends in two regions.
    const byVar = {};
    for (const u of usecases) if (u.mode === "series") (byVar[u.variable] ??= new Set()).add(u.region);
    const pairs = Object.entries(byVar).filter(([, s]) => s.size >= 2);
    if (pairs.length < 3) err(f, `needs >= 3 variables asked about in two or more regions (found ${pairs.length})`);
    const vars = new Set(usecases.map((u) => u.variable));
    for (const v of VARIABLE_IDS) if (!vars.has(v)) err(f, `no row uses variable ${v}`);
  }
}

// ---- cases ----
const cases = load("cases.json");
{
  const f = "cases.json";
  if (!Array.isArray(cases)) err(f, "must be an array");
  else {
    if (cases.length !== 2) err(f, `needs exactly 2 demos, has ${cases.length}`);
    for (const c of cases) {
      if (!isStr(c.id) || !isStr(c.title)) err(f, `case needs id and title`);
      if (!Array.isArray(c.steps) || c.steps.length < 5 || c.steps.length > 7) { err(f, `case ${c.id}: needs 5-7 steps`); continue; }
      c.steps.forEach((s, i) => {
        const w = `case ${c.id} step ${i + 1}`;
        if (!isStr(s.text)) err(f, `${w}: text required`);
        if (!s.action) return err(f, `${w}: action required`);
        checkAction(f, w, s.action);
      });
      const modes = c.steps.map((s) => s.action?.mode);
      // Order required by the brief: jet = series -> map -> band; arctic = series -> band -> route.
      const order = c.id === "jet" ? ["series", "map", "band"] : c.id === "arctic_lane" ? ["series", "band", "route"] : null;
      if (order) {
        let pos = -1;
        for (const m of order) {
          const nxt = modes.indexOf(m, pos + 1);
          if (nxt === -1) { err(f, `case ${c.id}: expected modes in order ${order.join(" -> ")}`); break; }
          pos = nxt;
        }
      }
    }
  }
}

if (errors.length) {
  console.error(`FAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`OK: ${Object.keys(definitions).length} definitions, ${regions.length} regions, ${usecases.length} usecases, ${routes.length} routes, ${cases.length} cases`);
