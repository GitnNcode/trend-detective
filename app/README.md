# /app (Lane 3): Trend Detective interface

A static single-page app (no backend, no build step). It reads `/data` (Lane 1), calls `/engine` (Lane 2) and shows `/content` (Lane 4), plus app-side additions in `app/extra/` and `app/lib/`.

## Run it

Serve the repository root with any static server and open `/app/`:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000/app/ (the root `index.html` redirects there). `DATA_BASE` in `app/data.js` points at `../data/`; switch it to `../data/mock/` to use mock data.

## Layout

- **Menu bar:** File (export figure, record loop, copy link), Product, Field, Region, Season (and trend period), Display (projection, fill, overlays), Procedures (guided cases and the question table), Help (methods and data).
- **Toolbar:** loop controls (first, back, play, forward, last), frame slider and speed, yearly or monthly frames, season presets, and product controls (Shift threshold, route, location, comparison region, arrow source).
- **Display:** a 3D globe by default (a perspective view of the sphere: drag to turn it with north kept up; three faint rotation rings around it turn it one axis at a time, X (red) tilting it toward a pole, Y (green) spinning it about its axis and Z (blue) rolling the picture, with Shift snapping to 5°; scroll to zoom; the compass button turns north back up; Display can hide the rings), or a flat cylindrical equidistant or polar stereographic map from the Display menu. All use discrete color steps, contour edges, black coastlines, lat/lon labels and a colorbar.
- **Inspector:** result cards: the headline rate with its 95% range, the two p-values, the chart, the detection gauge and product extras (compass dials, range bars).
- **Status bar:** the cursor readout (position, value, local trend), the current frame, the data source and the data volume loaded.

## Products

| Product | What it shows |
|---|---|
| Tanker voyage planner (in Shipping routes) | Two oil terminals, tanker class, speed, month, fuel price: best route on a 0.5° grid with wind, currents and ice, priced options via each canal, best month to sail, every year since 1980, and five years ahead. Runs in a Web Worker (`app/ship-worker.js`) |
| Shipping routes (opens first) | The fastest sea route between 11 pairs of big ports for every year since 1980, from sea ice and 10 m wind, drawn as year-coloured bands; a button projects the next five years from the recent trend |
| Time series | Regional mean, trend, CI, significance; stripes and seasonal-cycle views |
| Trend map | Per-cell trend, hatched where p ≥ 0.05; area census |
| Shift | Fix a value, follow the zone that has it: IR-style enhancement on a gray field, previous edges, first-year edge, NHC-style track and cone, edge history (all years), arrived/left areas, edge km/decade |
| Climate velocity | Trend ÷ spatial gradient (km/decade) with direction vectors |
| Climate analog | Where a place's 1980s climate is now, and where today's climate was in the 1980s |
| Sea-ice route | Open-water months per year along the Northern Sea Route or Northwest Passage, with the choke point, plus the shortest open-water path between its ends each year (yellow line) |
| Field lineup | All ten fields tested for one region, ranked by evidence |
| Trend atlas | Per-field trend maps on one display |
| Compare regions | The same variable in two places: opposite-trend verdict, both outlined on the trend map |
| Vector loop | White arrows that change every frame: climate velocity in moving 15-year windows, or 250 hPa wind (U, V) month by month |
| Validation | MERRA-2 against NASA GISTEMP v4 and the NSIDC Sea Ice Index (`data/validation/`) |

Also: a trend period (full record, 1980-2002, 2003-2025, since 2013) in the Season menu; File → Export figure, Record loop as video, Copy link.

Keys: space plays the loop; ← and → step one frame; 1–9 and 0 switch products; B draws a region box; E exports; R records; L copies a link.

## Files

| File | Role |
|---|---|
| `main.js` | State, data loading, per-product analysis, scene setup |
| `data.js` | Catalog, content, streamed `.bin` loading, texture packing |
| `map/gl.js` | WebGL2 renderer (inverse projection, sphere shading, discrete fills, zone enhancement, hatching) |
| `map/map.js` | Projections (3D globe camera, flat, polar), drag-to-turn interaction and the globe's rotation rings, vector overlay (frame, coastlines, tracks, arrows) |
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
