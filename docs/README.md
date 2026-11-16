# Trend Detective

NASA Space Apps Challenge 2026: *Be An Earth System Trend Detective!*

A static website that walks a student through being a data detective. Pick a question, get a suggested NASA variable and region, see the time series, get the rate of change and whether it is statistically significant, see a map of where the trend flips sign, then use Shift mode to watch a fixed value (the 0 °C line, the jet core, the ice edge) move across the map. Further products: compare two regions, climate velocity and a moving vector loop, climate analogs for a city, sea-ice routes, a lineup of every variable, a trend atlas, and a validation against NASA GISTEMP and the NSIDC Sea Ice Index. No backend, no API keys, no login.

Guided demos: **Is the jet stream moving?**, **Is the Arctic lane opening?**, **Climate on the move**, **The spreading hot spot** and **One cause, two trends**.

## How it works

1. **Data** (`/data`): a Python pipeline pulls NASA MERRA-2 monthly means from GES DISC (1980 to the latest month), coarsens them to a 2.0° by 2.5° grid (1.0° by 1.25° for sea ice, 50°N to 90°N), and packs each variable into one Int16 binary file plus `catalog.json`.
2. **Engine** (`/engine`): pure JavaScript with no dependencies. Area-weighted region series, seasonal-cycle removal, annual means, OLS trend with t-test and 95% interval, Mann-Kendall with autocorrelation correction and Sen's slope, per-cell trend maps, band tracking, and route-open counting. Tests run with `node --test`.
3. **App** (`/app`): vanilla JS, WebGL2 map renderer, canvas charts, d3 for projections. Reads the engine and the content files. See `app/README.md`.
4. **Content** (`/content`): variable definitions, region presets, the sample-question table, route waypoints and the two guided cases. Check them with `node content/validate.mjs`.

## What counts as significant

A trend is **significant** if p < 0.05 on both the t-test and the autocorrelation-corrected Mann-Kendall test, **suggestive** if only one passes or p < 0.10, otherwise **none**. A "none" result is still shown, with a note that a longer record may be needed. Finding a trend that is not significant is a legitimate result.

## Limits

- Linear trends on roughly 45 years of monthly data. Non-linear change is out of scope.
- MERRA-2 is a model-assimilated reanalysis, not a direct measurement, and some variables (precipitation, evaporation, soil wetness, snow, runoff) are model products with more uncertainty than temperature.
- Cells are 2.0° by 2.5° (about 200 by 250 km at mid-latitudes). Narrow straits, small estuaries and single cities are blurred, so route results are a guide to the pattern, not a navigation chart.

## Running it

Serve the repository root with any static file server (ES modules do not load from `file://`), for example `python3 -m http.server 8000`, and open http://localhost:8000/app/ (the root page redirects there). `DATA_BASE` in `app/data.js` points at `../data/`; use `../data/mock/` for mock data.

## Repository layout

```
/data      Lane 1   data pipeline and binary files
/engine    Lane 2   statistics and analysis
/app       Lane 3   web interface
/content   Lane 4   definitions, regions, sample questions, routes, guided cases
/docs      Lane 4   this README, submission text, demo script, validation, references
PLAN.md             project contract and lane briefs
```

## AI-use disclosure

We used Claude (Anthropic) to help write code and text in this project. Claude-assisted files include the content JSON files and this documentation (written with Claude, edited and checked by the team) and `[the other lanes' code: each lane to confirm]`. Git commits made with Claude carry a `Co-Authored-By` trailer. `[Team to state which parts were written by hand.]`

## Docs index

| File | What it is |
|---|---|
| [`SUBMISSION_REQUIREMENTS.md`](SUBMISSION_REQUIREMENTS.md) | The verified 2026 rules: demo limits, fields, deadline, SI rules, judging criteria |
| [`SUBMISSION.md`](SUBMISSION.md) | Draft text for every project page field, plus a self-check against the five criteria |
| [`SUBMIT_CHECKLIST.md`](SUBMIT_CHECKLIST.md) | Tick-list to run before clicking "Submit for Judging" |
| [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) | 30-second video and 7-slide plans, narration fill-in table |
| [`VALIDATION.md`](VALIDATION.md) | Our trends checked against NASA GISTEMP and the NSIDC Sea Ice Index (filled) |
| [`REFERENCES.md`](REFERENCES.md) | Citations for data, validation sources and tools |
| [`OPEN_ITEMS.md`](OPEN_ITEMS.md) | Decisions and questions for the group chat |

## Data and references

NASA MERRA-2 monthly means from NASA GES DISC. Full citations: [`REFERENCES.md`](REFERENCES.md). Validation against published NASA and NSIDC numbers: [`VALIDATION.md`](VALIDATION.md).
