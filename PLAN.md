# Trend Detective: contract and four briefs

NASA Space Apps 2026, "Be An Earth System Trend Detective!"
Team of 4. Two stages only. Inside each stage all four lanes run at the same time.

How to use this file: each teammate pastes the whole CONTRACT section plus their own brief into their Claude.

---

## Stages

| Stage | When (PT) | What happens | Lanes in parallel |
|---|---|---|---|
| 1. Build | Now to Sunday noon | Each lane builds its folder against this contract and the mock data | 4 |
| 2. Stitch and ship | Sunday noon to 9 PM | Merge, fix, validate, record, submit | 4 |

Nobody waits on anybody in Stage 1. The only shared dependency is this contract, and it is already fixed. Lane 3 and Lane 2 use mock data until Lane 1's real files land; the file format is identical, so swapping is a file copy.

Rule: you only edit files inside your own folder. If the contract needs to change, post it in the group chat first, then edit this file.

---

## CONTRACT

### Product in one paragraph

A static website (no backend, no API keys) that walks a student through being a data detective: pick a question, get a suggested NASA variable and region, see the time series, get the rate of change and whether it is significant, see a map of where the trend flips sign, then use Shift mode to watch a fixed-value band move across the map. Two watchable demo cases: the jet stream at 250 hPa, and the Arctic sea ice edge with a shipping route.

### Data source

All data is NASA MERRA-2 monthly means, 1980-01 to the latest month available, from NASA GES DISC with the shared Earthdata login. MERRA-2 is named in the challenge text. Fallback if a download fails: NASA GISTEMP v4 gridded temperature (single file, no login).

### Repo layout and ownership

```
/data       Lane 1   catalog.json, <id>.bin, /data/pipeline/*.py, /data/mock/
/engine     Lane 2   grid.js, stats.js, band.js, route.js, /engine/test/
/app        Lane 3   index.html, app.js, map.js, chart.js, styles
/content    Lane 4   definitions.json, usecases.json, regions.json, routes.json, cases.json
/docs       Lane 4   README, submission text, demo script, validation table
PLAN.md     shared   this file
```

Stack: vanilla JS ES modules, Tailwind via CDN, d3-geo for projections, canvas for the map and chart. No React, no build step. Python only in `/data/pipeline`.

### Data file format (Lane 1 writes, Lane 2 reads)

One binary file per variable: `/data/<id>.bin`

- Int16, little-endian, shape `[nt, nlat, nlon]`, row-major (time outermost).
- Latitude runs south to north. Longitude runs west to east starting at -180.
- Real value = stored * scale + offset. Missing = -32768.
- Time index 0 is the `start` month in the catalog; one step per month, no gaps.

`/data/catalog.json`:

```json
{
  "variables": [
    {
      "id": "t2m",
      "file": "t2m.bin",
      "source": "MERRA-2 M2TMNXSLV, variable T2M",
      "units": "°C",
      "start": "1980-01",
      "nt": 561,
      "grid": { "nlat": 91, "nlon": 144, "lat0": -90, "lon0": -180, "dlat": 2.0, "dlon": 2.5 },
      "scale": 0.01,
      "offset": 0,
      "defaultBand": { "min": null, "max": 0 }
    }
  ]
}
```

The grid block is per variable, so a variable may use a finer or regional grid (sea ice should). Code must never hardcode grid size.

### Variable list (ids are fixed; Lane 1 verifies the MERRA-2 names first)

| id | Meaning | MERRA-2 collection and field | Stored units |
|---|---|---|---|
| t2m | Air temperature at 2 m | M2TMNXSLV, T2M | °C |
| t500 | Temperature at 500 hPa | M2TMNXSLV, T500 | °C |
| wind250 | Wind speed at 250 hPa | M2TMNXSLV, U250 and V250 | m/s |
| tqv | Water vapor in the air column | M2TMNXSLV, TQV | kg/m² |
| precip | Precipitation | M2TMNXFLX, PRECTOTCORR | mm/day |
| evap | Evaporation | M2TMNXFLX, EVAP | mm/day |
| seaice | Sea ice fraction | M2TMNXFLX, FRSEAICE | 0 to 1 |
| soilwet | Root-zone soil wetness | M2TMNXLND, GWETROOT | 0 to 1 |
| snow | Snow mass | M2TMNXLND, SNOMAS | kg/m² |
| runoff | Runoff | M2TMNXLND, RUNOFF | mm/day |

Default grid: 2.0° lat by 2.5° lon, global. `seaice`: 1.0° by 1.25°, 50°N to 90°N only.

### Engine API (Lane 2 writes, Lane 3 calls)

All functions are pure, exported from `/engine/index.js`, no DOM access.

```js
// types
// Region = { latMin, latMax, lonMin, lonMax }
// Series = { t: string[] ("YYYY-MM"), values: Float64Array }
// Annual = { years: number[], values: Float64Array }
// Months = number[] (1 to 12), optional season filter; omit for all months

loadVariable(entry, baseUrl)            // -> Promise<Var>  { entry, data: Int16Array, value(t,i,j) }
regionSeries(v, region)                 // -> Series, cos(lat) weighted mean, missing skipped
deseasonalize(series)                   // -> Series, monthly climatology removed
annualMeans(series, months)             // -> Annual
linearTrend(annual)                     // -> { slope, intercept, ci95: [lo, hi], p, r2 }   slope per year
mannKendall(annual)                     // -> { tau, p, pAutocorr, senSlope }
verdict(trend, mk, units)               // -> { level: "significant" | "suggestive" | "none", sentence }
trendMap(v, months)                     // -> { slope: Float32Array, p: Float32Array }  per cell, per year
bandTrack(v, { min, max, months, region })
  // -> { years, areaKm2: number[], centroidLat: number[], centroidLon: number[],
  //      edgeLat: number[][]  (per year, per longitude column, NaN if no band),
  //      mask(yearIndex): Uint8Array }
bandSummary(track)
  // -> { areaTrend, edgeShiftKmPerDecade, edgeP,
  //      kind: "shift" | "expansion" | "contraction" | "none", sentence }
routeOpen(v, route, { max })
  // -> { years, openMonths: number[], chokePointIndex }  a month is open if every route point is <= max
```

Significance rule used everywhere: "significant" if p < 0.05 on both the t-test and autocorrelation-corrected Mann-Kendall, "suggestive" if only one passes or p < 0.10, otherwise "none". A "none" verdict still shows the trend and says a longer record may be needed.

### Content shapes (Lane 4 writes, Lane 3 reads)

```json
// definitions.json
{ "t2m": { "name": "Air temperature", "plain": "How warm the air is about head height.", "why": "One sentence on why it might trend." } }

// regions.json
[ { "id": "sahel", "name": "Sahel", "type": "desert edge", "latMin": 10, "latMax": 20, "lonMin": -15, "lonMax": 35 } ]

// usecases.json   the sample-prompt table; no AI involved
[ { "prompt": "Is the Arctic losing its summer ice?", "variable": "seaice", "region": "arctic", "months": [9], "mode": "band", "band": { "min": null, "max": 0.15 } } ]

// routes.json
[ { "id": "nsr", "name": "Northern Sea Route", "points": [[69.0, 33.0], [77.5, 100.0], [66.0, -170.0]] } ]

// cases.json   watchable demos
[ { "id": "jet", "title": "Is the jet stream moving?",
    "steps": [ { "text": "Narration shown on screen.", "action": { "variable": "wind250", "region": "natlantic", "mode": "series" } } ] } ]
```

`mode` is one of `"series"`, `"map"`, `"band"`, `"route"`. Region `type` values follow the challenge text where possible: desert, rainforest, estuary, city air, ocean, polar.

---

## LANE 1 BRIEF: Data (Python)

Paste the CONTRACT section above, then this.

You own `/data`. Build the pipeline that turns NASA MERRA-2 monthly data into the binary files and `catalog.json` defined in the contract.

Do these in order:

1. In the first 45 minutes, write `/data/pipeline/make_mock.py` and commit `/data/mock/catalog.json` plus mock `.bin` files for `t2m`, `wind250`, and `seaice` in the exact contract format. Use a smooth climatology with a seasonal cycle, a small trend that differs by region, and noise. Other lanes are building against this.
2. Verify every MERRA-2 collection and field name in the variable table against the GES DISC file spec. If one is wrong or missing, post the fix in the group chat and update the table.
3. Write `/data/pipeline/fetch.py` using `earthaccess` (or GES DISC OPeNDAP subset URLs) to pull only the needed fields. Do not download whole files if subsetting works. Credentials come from a `.netrc` or environment variables, never committed.
4. Write `/data/pipeline/build.py`: coarsen by area-weighted averaging to each variable's grid, convert units, pack to Int16 with a scale that keeps at least 3 significant digits, write `.bin` and `catalog.json`.
5. Priority order for real data: `t2m`, `wind250`, `seaice`, `precip`, then the rest.
6. Write `/data/pipeline/check.py` that reloads each `.bin` and prints the global mean per year, so obviously wrong files are caught.

Done when: real files for at least the first four variables are in `/data`, and `check.py` output looks physically sane.

Stage 2 job: produce the validation table for `/docs` (our global `t2m` trend versus NASA GISTEMP's published trend for the same years; our September Arctic ice area trend versus the published figure), and note every dataset with its citation.

---

## LANE 2 BRIEF: Engine (JavaScript, no UI)

Paste the CONTRACT section above, then this.

You own `/engine`. Implement the Engine API exactly as specified, as ES modules with no dependencies and no DOM access, plus tests runnable with `node --test`.

Do these in order:

1. In the first 45 minutes, commit `/engine/index.js` exporting every function with the correct signature. Stubs may return plausible fake values. Lane 3 is importing these immediately.
2. `grid.js`: `loadVariable`, `regionSeries` (cos-latitude weights, skip missing, handle regions that cross the date line).
3. `stats.js`: `deseasonalize`, `annualMeans`, `linearTrend` (OLS, t-based p-value and 95% interval), `mannKendall` (tie-corrected, plus a p-value with lag-1 autocorrelation variance correction, plus Sen's slope), `verdict`.
4. `trendMap`: OLS slope and p per cell on annual means.
5. `band.js`: `bandTrack` on annual (or season-filtered) fields. Area uses true cell area from latitude. `edgeLat` is the most equatorward latitude in each longitude column that is inside the band, for bands with `max` set on a field that grows toward the pole, and the most poleward otherwise; document the rule in a comment. `bandSummary` classifies: edges on both sides moving the same direction with flat area is a shift, area change with steady centroid is expansion or contraction, nothing significant is none.
6. `route.js`: `routeOpen`. Interpolate route points to roughly one sample per grid cell.
7. Tests: generate series with a known slope and check recovery; a pure-noise series should come back "none" about 95% of the time over 200 trials; a synthetic band that moves 1° per decade should report about 111 km per decade.

Done when: all tests pass on mock data and every function handles missing values without returning NaN verdicts.

Stage 2 job: run against real data, profile anything slower than 200 ms, and fix whatever integration turns up in `/engine`.

---

## LANE 3 BRIEF: Interface (HTML, Tailwind, vanilla JS)

Paste the CONTRACT section above, then this.

You own `/app` and the `main` branch. Build the single-page app that calls the engine and reads the content files. Light mode, minimal, dense; no component framework.

Do these in order:

1. In the first hour, get `index.html` loading `/data/mock/catalog.json`, calling the engine stubs, and showing a map and a chart, even if ugly. Add a single `DATA_BASE` constant so switching from mock to real data is one line.
2. Guided flow, left panel: a list of questions from `usecases.json` (the user picks one), or manual pickers for variable and region. Show the plain definition from `definitions.json` next to every variable name.
3. Chart, canvas: annual series, trend line, shaded 95% band, toggle for raw monthly versus seasonal cycle removed.
4. Verdict card: rate per decade with units, confidence interval, p-values, the `verdict` sentence. Non-significant results are shown as a finding, not an error.
5. Map, canvas plus d3-geo: equirectangular for global, polar stereographic for `seaice`. Layers: latest-year field, trend map with a diverging palette and non-significant cells faded, user-drawn region box.
6. Shift mode: threshold slider, year scrubber with play button, band outline for the current year over a faint outline of the first year, and the `bandSummary` sentence. Draw routes from `routes.json` and show open months per year when `mode` is `"route"`.
7. Case player: steps through `cases.json`, applying each step's `action` and showing its `text`, with next, back, and autoplay.

Done when: both demo cases play end to end on mock data with no console errors.

Stage 2 job: merge the other three folders, switch `DATA_BASE` to real data, deploy to Vercel or GitHub Pages, and polish.

---

## LANE 4 BRIEF: Content and ship

Paste the CONTRACT section above, then this.

You own `/content` and `/docs`. You write everything a user reads and everything the judges read.

Do these in order:

1. In the first 45 minutes, commit valid starter versions of all five content JSON files with at least two entries each, so Lane 3 can render them.
2. `definitions.json`: all ten variables. `plain` is one sentence a high school student understands. `why` is one sentence on what could make it trend.
3. `regions.json`: 12 to 15 presets covering the challenge's region types (desert, rainforest, estuary, city air) plus ocean and polar, including `arctic` and `natlantic`.
4. `usecases.json`: the sample-prompt table, 12 to 15 rows. Each row is a question a curious student would ask, mapped to a variable, region, season, and mode. Include at least three rows where the same variable trends opposite ways in two regions, since that is the challenge's central point. No AI in the app; this table is the whole recommendation feature.
5. `routes.json`: Northern Sea Route and Northwest Passage as waypoint lists; one North Atlantic great-circle flight path (New York to London) for the jet case.
6. `cases.json`: two demos, 5 to 7 steps each. "Is the jet stream moving?" walks series, then map, then band on `wind250`. "Is the Arctic lane opening?" walks series, then band, then route on `seaice`. Write the narration so it still reads correctly if the result is not significant; fill in actual numbers in Stage 2.
7. Read the 2026 Project Submission Guide and the Judging and Awards Guide tonight. Post the required demo format (slides or video, length limit) and the judging criteria in the group chat.
8. Draft `/docs/README.md` and the submission text: summary, how it addresses each of the four objectives, NASA data used, references, and the AI-use disclosure (we used Claude to help write code and text).

Done when: all five JSON files validate against the contract shapes and the submission draft has every required field.

Stage 2 job: put real numbers into the case narration, record the demo, test the deployed site on a second machine, and submit by 9 PM.

---

## Stage 2 checklist (Sunday noon to 9 PM, all four at once)

| Lane | Job |
|---|---|
| 1 | Validation table versus published NASA numbers; dataset citations |
| 2 | Real-data run, performance, engine bug fixes |
| 3 | Merge, deploy, UI polish; feature freeze at 5 PM |
| 4 | Real numbers in cases, record demo, second-machine test, submit |

Cut order if behind: route sampler, then the threshold slider, then the second case. Never cut: variable picker, region, time series, rate of change, significance. Those five are the challenge.
