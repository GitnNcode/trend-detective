# Engine (Lane 2)

Pure ES modules, no dependencies, no DOM. Everything is exported from `index.js`, with the signatures in `PLAN.md`.

```js
import * as E from "../engine/index.js";

const catalog = await (await fetch(DATA_BASE + "catalog.json")).json();
const v = await E.loadVariable(catalog.variables.find((x) => x.id === "t2m"), DATA_BASE);

const annual = E.annualMeans(E.deseasonalize(E.regionSeries(v, region)), months);
const trend = E.linearTrend(annual);
const mk = E.mannKendall(annual);
const card = E.verdict(trend, mk, v.entry.units); // { level, sentence, perDecade, ci95PerDecade, pT, pMK }

const map = E.trendMap(v, months);                 // slope[c], p[c], c = i*nlon + j
const track = E.bandTrack(v, { min, max, months, region });
const shift = E.bandSummary(track);
const route = E.routeOpen(v, routes[0], { max: 0.15, months: [7, 8, 9, 10] });
const path = E.sampleRoute(routes[0], v.entry.grid);   // [[lat, lon], ...] to draw
```

## Commands

| Command | What it does |
|---|---|
| `cd engine && npm test` | Runs every test with `node --test` |
| `node engine/bench.js` | Times every call on synthetic data at real size, against a 200 ms budget |
| `node engine/bench.js data/mock` | The same on Lane 1's mock files (or `data` for the real ones) |
| `node engine/realcheck.js data content` | Runs every demo step and sample question on real data and prints the numbers (for Lane 4's narration), plus the validation checks |
| `TD_DATA_DIR=/path/to/data npm test` | Runs the data tests against another checkout's `/data` |

`test/pipeline.test.js` runs the whole API over `/data/mock` and `/data` as soon as a `catalog.json` shows up there. Until then those two tests are skipped.

## Conventions

- **Grid.** Cell `(i, j)` is centred at `lat0 + i*dlat`, `lon0 + j*dlon`. `i` runs south to north. The flat cell index is `c = i*nlon + j`, the same order as one time slice of the file. `trendMap`, `mask()` and `edgeLat[y][j]` all use it.
- **Missing values.** Missing is `NaN` everywhere after loading. Region means skip missing cells. A year counts only if every requested month is inside the record. Its value is `NaN` if any of those months is missing.
- **Seasons.** A season that crosses the new year is labelled by its January year: `[12, 1, 2]` for 2001 means Dec 2000 to Feb 2001.
- **Rates.** `linearTrend.slope` and `trendMap.slope` are per year. `verdict.perDecade`, `bandSummary.areaTrend` (km²) and `edgeShiftKmPerDecade` are per decade.
- **Fractions.** For units `"0 to 1"` the sentences use percentage points. The numeric fields stay in the stored units.
- **Significance.** "significant" means both the t-test p and the autocorrelation-corrected Mann-Kendall p are below 0.05. "suggestive" means one of them is below 0.05, or both are below 0.10. Anything else is "none". In tests on pure noise, 94% of runs come back "none" and 3.5% come back "significant".

## Decisions to know about

1. **Band edge rule.** As written in the brief, "most equatorward for `max` on a field that grows toward the pole" would put the sea-ice edge (`seaice <= 0.15`) at 50°N, the grid boundary. Instead, `bandTrack` finds the edge that faces out of the band from the data:
   - a band on the pole side (air below 0 °C) gets its equatorward edge
   - a band on the equator side (open water) gets its poleward edge, which is the ice edge
   - a strip (a jet core above 30 m/s) gets both edges

   `edgeKind` and `bandShape` say which case was chosen. Edges are interpolated to where the field crosses the threshold, so they move smoothly instead of in 2° steps.

   If the region's border clips one edge of a strip in most columns (the real North Atlantic jet does this), `bandSummary` follows the edge it can trace instead (`edgeUsed`). If neither edge can be traced in at least 3 columns, it tests only the size and the sentence says the edge runs into the region border.
2. **Shift vs expansion.**
   - Strip: the width trend decides expansion or contraction, and the centre-line trend decides shift. Area alone would make a band that moves poleward look like it is shrinking, because cells get smaller toward the pole.
   - One-edge band: the area trend decides expansion or contraction. If area is flat but the edge moves, it is a shift.
   - `edgeShiftKmPerDecade` is positive when the band moves poleward, in either hemisphere.
3. **Hemisphere.** Edges are traced in one hemisphere. That is the southern one only when the region lies wholly south of the equator, otherwise the northern one. You can override it with `hemisphere: "N" | "S"`. Area and centroid use the whole region.
4. **Routes.** The path between waypoints is a straight line in lat/lon, the short way round. Ships follow coasts and waypoints, not great circles. Pass `{ greatCircle: true }` for the flight path.
   - Missing cells (land) along a route are ignored.
   - `months` limits which months are checked (the demo uses July to October).
   - `samples` and `sampleRoute` are `[[lat, lon], ...]`, the centres of the cells actually tested.
   - `chokePointIndex` indexes `samples` (also returned). It points at the sample that is above `max` in the most months.
   - Only complete calendar years are reported.
5. **trendMap p** is the per-cell t-test only (fast enough to recompute on every interaction). The two-test verdict is used for region series and bands.

## Extras beyond the contract

The contract fields are unchanged. Some returns also carry extra fields:

| Function | Extra fields |
|---|---|
| `linearTrend` | `n` |
| `mannKendall` | `n`, `r1` |
| `verdict` | `perDecade`, `ci95PerDecade`, `pT`, `pMK`, `n`, `direction` |
| `trendMap` | `years` |
| `bandTrack` | `equatorwardEdgeLat`, `polewardEdgeLat`, `edgeKind`, `bandShape`, `hemisphere` |
| `bandSummary` | `level`, `areaPctPerDecade`, `areaP`, `widthChangeKmPerDecade`, `edgeMeanLat`, `edgeUsed`, `edgeColumns` |
| `routeOpen` | `chokePoint`, `sampleCells`, `months` |

`index.js` also exports helpers: `sampleCells` (the route samples with grid indices), `sampleRoute` (to draw the same path the engine samples), `latOf`, `lonOf`, `rowAreasKm2`, `regionCells`, `fromBuffer`, `significanceLevel`, `fmt`, `fmtP`, `timeLabels` and `annualFields`.

## Checked on real data

- Global mean 2 m temperature, 1980 to 2025: +0.165 °C per decade. This matches Lane 1's own check.
- September Arctic ice extent (cells with at least 15% ice), 1980 to 2024: -11.7% of the 1981 to 2010 mean per decade, and 3.56 M km² in 2012. This matches Lane 1's check. NSIDC gives about -12% per decade.
- All ten variables pass the full-pipeline test with no NaN sentences. The slowest call on real files takes 72 ms.

No libraries, fonts or images ship from this folder.

Code in this folder was written with Claude and reviewed by the team.
