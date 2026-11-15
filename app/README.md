# /app (Lane 3): Trend Detective interface

A static single-page app (no backend, no build step). It reads `/data` (Lane 1), calls `/engine` (Lane 2) and shows `/content` (Lane 4), plus app-side additions in `app/extra/` and `app/lib/`.

## Run it

Serve the repository root with any static server and open `/app/`:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000/app/ (the root `index.html` redirects there). `DATA_BASE` in `app/data.js` points at `../data/`; switch it to `../data/mock/` to use mock data.

## Layout

- **Menu bar:** Product, Field, Region, Season, Display (projection, fill, overlays), Procedures (guided cases and the question table), Help (methods and data).
- **Toolbar:** loop controls (first, back, play, forward, last), frame slider and speed, yearly or monthly frames, season presets, and product controls (Shift threshold, route, location). On the right: draw a region box, export PNG, copy a link.
- **Display:** a framed map (cylindrical equidistant, orthographic or polar stereographic) with discrete color steps, contour edges, black coastlines, lat/lon labels and a colorbar.
- **Inspector:** the rate of change with its 95% interval, significance lamps (t-test, Mann–Kendall), the time series chart, the detection gauge and product extras.
- **Status bar:** the cursor readout (position, value, local trend), the current frame, the data source and the data volume loaded.

## Products

| Product | What it shows |
|---|---|
| Time series | Regional mean, trend, CI, significance; stripes and seasonal-cycle views |
| Trend map | Per-cell trend, hatched where p ≥ 0.05; area census |
| Shift | Fix a value, follow the zone that has it: IR-style enhancement on a gray field, previous edges, first-year edge, NHC-style track and cone, edge history (all years), arrived/left areas, edge km/decade |
| Climate velocity | Trend ÷ spatial gradient (km/decade) with direction vectors |
| Climate analog | Where a place's 1980s climate is now, and where today's climate was in the 1980s |
| Sea-ice route | Open-water months per year along the Northern Sea Route or Northwest Passage, with the choke point |
| Field lineup | All ten fields tested for one region, ranked by evidence |
| Trend atlas | Ten per-field trend maps on one display |

Keys: space plays the loop; ← and → step one frame; 1–8 switch products; B draws a region box.

## Files

| File | Role |
|---|---|
| `main.js` | State, data loading, per-product analysis, scene setup |
| `data.js` | Catalog, content, streamed `.bin` loading, texture packing |
| `map/gl.js` | WebGL2 renderer (inverse projection, discrete fills, zone enhancement, hatching) |
| `map/map.js` | Projections, interaction, vector overlay (frame, coastlines, tracks, arrows) |
| `ui/workstation.js` | Menus, toolbar, inspector, colorbar, figure title, status bar |
| `ui/sheet.js` | Multi-panel atlas and lineup |
| `ui/cases.js` | Procedure (guided case) player |
| `ui/export.js` | PNG figure export |
| `chart.js` | Canvas charts (series, bars, stripes, seasonal, sparkline) |
| `lib/analysis.js` | Climate velocity, detection horizon, climate analogs, lineup, dipole, distribution shift, extrapolation (tests: `node --test app/lib/analysis.test.mjs`) |
| `lib/ANALYSIS_NOTES.md` | Real numbers computed with those functions, for narration |
| `extra/*.json` | App-side questions, cases, regions and the city list |

## References

- d3 v7 and topojson-client v3 (ISC licence), world-atlas v2 (Natural Earth data), loaded from jsDelivr.
- Loarie et al. (2009), *Nature* 462: climate velocity. Weatherhead et al. (1998), *J. Geophys. Res.*: years needed to detect a trend. Yue and Wang (2004): autocorrelation-corrected Mann–Kendall.

Code and text in this folder were written with Claude and reviewed by the team.
