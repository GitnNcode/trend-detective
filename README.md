# Trend Detective

NASA Space Apps Challenge 2026: *Be An Earth System Trend Detective!*

**Live site:** https://trend-detective-pipeline.vercel.app · **Source:** https://github.com/GitnNcode/trend-detective

Trend Detective is a free website that lets a student act as a data detective with NASA climate data. Pick a question (or a variable, a region and a season), see the time series since 1980, get the rate of change per decade with a 95% range, and a plain verdict on whether the trend is statistically significant. It runs entirely in the browser: nothing to install, no account, no API keys.

## What it does

- **Time series** for any region: annual means since 1980, trend line, rate per decade with a 95% interval, t-test and Mann-Kendall verdict, a "years needed to detect" estimate, stripes and seasonal-cycle views.
- **Trend map:** the trend in every grid cell, with non-significant cells hatched, so you can see where one variable rises in one place and falls in another.
- **Shift:** fix a value (air at or above 10 °C, sea ice above 15%) and watch where on Earth it is found each year, and how fast that zone moves.
- **Compare regions, climate velocity, climate analog for a city, sea-ice routes, a lineup of every variable, and a trend atlas.**
- **Validation** against independent records: NASA GISTEMP v4 and the NSIDC Sea Ice Index (see below).
- **Guided procedures** that play step by step with narration, plus a welcome tour and preset questions in the Procedures menu. Any view can be exported as a figure or shared as a link.

## What counts as significant

A trend is **significant** if p < 0.05 on both the t-test and the autocorrelation-corrected Mann-Kendall test, **suggestive** if only one passes or p < 0.10, otherwise **none**. A "none" result is still a finding, shown with a note that a longer record may be needed.

## NASA data

NASA MERRA-2 monthly means, January 1980 to the latest available month, from NASA GES DISC:

| Collection | Fields used |
|---|---|
| M2TMNXSLV (single-level diagnostics) | 2 m air temperature, 500 hPa temperature and height, 250 hPa wind (U, V), total column water vapor |
| M2TMNXFLX (surface fluxes) | precipitation (PRECTOTCORR), evaporation, sea ice fraction (FRSEAICE) |
| M2TMNXLND (land surface) | root-zone soil wetness, snow mass, runoff |
| M2TMNXAER (aerosols) | total aerosol optical depth at 550 nm |
| M2C0NXASM (constants) | ocean fraction, surface geopotential (for freezing-level height) |

Validation references: NASA GISS Surface Temperature Analysis (GISTEMP v4) and the NSIDC Sea Ice Index (G02135). Full citations are in [docs/REFERENCES.md](docs/REFERENCES.md).

## Validation

| Check | MERRA-2 (this app) | Independent record | Agrees? |
|---|---|---|---|
| Global 2 m temperature trend, 1980-2025 | +0.165 °C/decade (95% CI +0.134 to +0.196) | GISTEMP v4: +0.208 °C/decade (95% CI +0.184 to +0.232), same years, same fit | Yes: intervals overlap; yearly anomalies r = 0.97 |
| September Arctic sea ice trend | -11.7% per decade | NSIDC Sea Ice Index: -12.4% per decade | Yes: r = 0.99 |

MERRA-2 runs slightly below GISTEMP on global warming, a known difference for reanalyses. Details: [docs/VALIDATION.md](docs/VALIDATION.md).

## Limits

- Linear trends on roughly 45 years of monthly data. Non-linear change is out of scope.
- MERRA-2 is a model-assimilated reanalysis, not a direct measurement. Precipitation, evaporation, soil wetness, snow and runoff carry more uncertainty than temperature.
- Grid cells are 2.0° by 2.5° (about 200 km), 1.0° by 1.25° for sea ice. Narrow straits, small estuaries and single cities are blurred, so climate-analog distances are rounded to 50 km and poor or sub-cell matches are not shown.

## Running it locally

Serve the repository root with any static file server (ES modules do not load from `file://`):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/app/. Tests: `cd engine && npm test` and `node app/lib/analysis.test.mjs`; content check: `node content/validate.mjs`.

## How it is built

- `/data`: a Python pipeline (numpy, xarray, netCDF4, earthaccess) pulls MERRA-2 from GES DISC, coarsens it, and packs each variable into an Int16 binary file plus `catalog.json`.
- `/engine`: dependency-free JavaScript statistics (area-weighted region series, OLS with t-test, Mann-Kendall with autocorrelation correction and Sen's slope, trend maps, band tracking).
- `/app`: vanilla JavaScript, WebGL2 map renderer, canvas charts, d3 for projections, topojson-client and Natural Earth coastlines.
- `/content`: variable definitions, regions, preset questions, routes and guided procedures.
- Hosted as static files on Vercel. No backend.

## Team

| Name | Role |
|---|---|
| Aditya Mishra | Developer, ideator, visual designer |
| David Chen | Developer, data analysis |
| Sricharan Vagvala | Developer, ideator, data analysis |
| Daniel Garcia | Developer, visual designer |

## Use of AI

We used **Claude (Anthropic)** as a coding and writing assistant. It helped write and review code across the data pipeline, the statistics engine and the web interface, and it drafted the plain-language variable definitions, preset questions, guided-procedure narration and documentation. Several secondary products (climate velocity, the vector loop, the climate analog, the field lineup and atlas, the detection estimate and the region comparison) were suggested by Claude after the team settled on its core idea. The team chose the challenge approach, reviewed the code and checked the results against NASA GISTEMP and NSIDC records.

AI-assisted code is marked in source file headers ("Written with Claude and reviewed by the team") and in git commit trailers (`Co-Authored-By: Claude`). The app itself does not call any AI model: every number is computed from NASA data in the browser.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with or endorsed by NASA.
