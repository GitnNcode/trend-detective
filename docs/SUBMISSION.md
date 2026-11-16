# Submission draft

Maps to the project page fields in `SUBMISSION_REQUIREMENTS.md`. Items in `[BRACKETS]` are not known yet and must be filled in by the team. Numbers below come from the Stage 2 real-data run (see `VALIDATION.md` and `DEMO_SCRIPT.md`).

---

## Project Name

Trend Detective `[confirm final name]`

## High-Level Project Summary

Trend Detective is a free website that turns a student into a data detective. Most trend tools fix a place and show its value changing; Trend Detective also does the reverse: it fixes a value (air at or above 10 °C, wind above 40 m/s, sea ice above 15%) and shows where on Earth that value is found each year, how fast it is moving, and whether the change is statistically significant. Students pick a question or build their own (variable, region, season), see the time series since 1980, the rate of change with a 95% interval, and a plain verdict from two tests. A trend map, a two-region comparison and an "arrived / left" view show how one variable can rise in one place and fall in another from a single cause. Further views follow climate velocity, a city's climate analog, shipping-route ice, all ten variables at once, and a validation against independent NASA and NSIDC records. It runs entirely in the browser from NASA MERRA-2 files: nothing to install, no login.

## Link to Project Demo

`[URL: public video of 30 seconds or less, or 7-slide deck. See DEMO_SCRIPT.md]`

## Link to Final Project

`[URL of deployed site]` · Source: https://github.com/GitnNcode/trend-detective

## Detailed Project Description

**What it does.** The user picks a guided question or a variable, region and season, then a product:

- *Time series:* region-averaged series (seasonal cycle optionally removed), rate per decade with a 95% interval, t-test and Mann-Kendall verdict, a "detection" estimate of how many years a trend of that size needs (Weatherhead et al. 1998), plus stripes and seasonal-cycle views.
- *Trend map:* the trend in every grid cell, with non-significant cells hatched, and the share of area rising, falling or unclear.
- *Shift (our core idea):* fix a value and follow the zone that has it, frame by frame like a weather loop: the zone is highlighted, earlier edges fade behind it, the first year's edge stays as a dashed line, a storm-track style path follows the zone's centre, an "edge history" view draws every year's edge at once, and an "arrived / left" view shows where the zone moved in and out. Example: Europe's 10 °C annual-mean zone has moved north about 114 km per decade since 1980 (significant).
- *Compare regions:* the same variable in two places, e.g. evaporation falling over the Amazon (-0.15 mm/day per decade) while rising over the North Atlantic (+0.086), both significant.
- *Climate velocity* and a *vector loop:* how fast a place would have to move to keep its climate (median 44 km per decade over land), shown as arrows that change with moving 15-year windows; and 250 hPa wind arrows that follow the jet stream month by month.
- *Climate analog:* where a city's 1980s climate is found today (Paris: about 885 km to the northeast).
- *Sea-ice route:* open-water months on the Northern Sea Route (+0.23 months per decade, significant; first open month in 2008).
- *Field lineup* and *trend atlas:* all ten variables tested at once for one region, or mapped side by side.
- *Validation:* MERRA-2 against NASA GISTEMP v4 (global warming +0.165 vs +0.208 °C per decade, intervals overlap, r = 0.97) and the NSIDC Sea Ice Index (September ice -11.7 vs -12.4 % per decade, r = 0.99).
- Guided procedures (the jet stream, the Arctic lane, climate on the move, the spreading hot spot, one cause and two trends) play step by step with narration; any view can be exported as a figure or shared as a link.

**How it addresses the four challenge objectives.**

1. *Identify variables of interest.* MERRA-2 variables (surface and upper-air temperature, jet-stream wind and its components, water vapor, precipitation, evaporation, sea ice, soil wetness, snow mass, runoff, aerosol haze and the height of the freezing level), each with a plain definition and a reason it might trend. About 40 sample questions map everyday curiosity to a variable, region, season and view (no AI in the app), and the field lineup tests every variable for a region at once so students can see which ones are changing.
2. *Acquire the data for a region.* About 25 preset regions (desert, rainforest, estuary, city air, ocean, polar, continents, hemispheres) plus a user-drawn box. Series are area-weighted by true cell area, with missing cells skipped.
3. *Generate and visualize a time series.* Monthly means from 1980 to the latest available month, shown as annual means with a trend line and shaded 95% interval.
4. *Basic statistical analysis and significance.* Ordinary least-squares slope with a t-test and confidence interval, plus the Mann-Kendall test with an autocorrelation correction and Sen's slope. A trend is "significant" only if both tests give p < 0.05, "suggestive" if only one passes or p < 0.10, and otherwise "none", with a note that a longer record may be needed.

**Beyond the objectives.** The challenge notes that one variable can trend in opposite directions in different regions. The trend map and the paired sample questions (for example Arctic versus Antarctic temperature, Sahel versus Mediterranean rainfall) are built to show exactly that. The challenge suggests watchable examples; the two guided cases are those.

**Benefits.** It lowers the barrier to real climate-data analysis: no coding, no account, no download. Students learn the difference between a trend and a significant trend, and see that a result that is not significant is still a finding. Teachers get two ready-made guided cases.

**Goals.** Help high school and college students, and members of the public with some science background, find a variable, pick a place, and judge for themselves whether a change in the Earth system is real. `[Team: add any further goals]`

**Honest limits.** Linear trends only, on a record of roughly 45 years. MERRA-2 is a model-assimilated reanalysis, not a direct measurement. Grid cells are 2.0° by 2.5° (1.0° by 1.25° for sea ice), so narrow features such as straits and small estuaries are blurred. A trend that is not significant is reported as such.

**Tools.** Vanilla JavaScript (ES modules), WebGL2 (map rendering), HTML canvas (charts), d3 v7 (map projections and paths), topojson-client and world-atlas (Natural Earth coastlines). A Python pipeline (`/data/pipeline`: numpy, xarray, netCDF4, earthaccess) builds the data files. No backend; hosted as static files on GitHub Pages `[confirm URL]`.

## Use of Super Intelligence (SI)

Draft answer (not shown to judges; judges do see SI acknowledgements inside the project):

We used Claude (Anthropic) as a coding and writing assistant: it helped write and review code in the data pipeline, statistics engine and interface, and it drafted the plain-language variable definitions, sample questions, demo narration and documentation. `[TEAM TO CONFIRM and edit: who came up with the idea and approach; the guide says SI should not be used to devise the idea of how to solve the challenge. State accurately what the team did and what SI did.]` `[Add once true: our trends were checked against published NASA and NSIDC figures, see VALIDATION.md.]` Acknowledgements appear in the repository README and in each folder's README, in git commit trailers, and in the site's Help → Methods and data dialog. `[TEAM: several product features (climate velocity, the vector loop, the climate analog, the field lineup and atlas, the detection estimate, the region comparison) were suggested by Claude after the team's core idea; say so here if they stay in the submission.]`

## NASA Data

NASA MERRA-2 monthly mean fields, January 1980 to the latest available month, from NASA GES DISC (Goddard Earth Sciences Data and Information Services Center):

- M2TMNXSLV (single-level diagnostics): 2 m air temperature, 500 hPa temperature and height, 250 hPa wind (U and V), total column water vapor.
- M2TMNXFLX (surface flux diagnostics): precipitation (PRECTOTCORR), evaporation, sea ice fraction (FRSEAICE, land masked with FROCEAN).
- M2TMNXLND (land surface diagnostics): root-zone soil wetness, snow mass, runoff.
- M2TMNXAER (aerosol diagnostics): total aerosol optical depth at 550 nm.
- M2C0NXASM (constants): ocean fraction and surface geopotential (for the freezing-level height).

Validation: NASA GISS Surface Temperature Analysis (GISTEMP v4) global means, and the NSIDC Sea Ice Index (G02135) September extents. Both files are in `data/validation/`.

## Space Agency Partner Data and Other References

See `REFERENCES.md` for full citations. Include every code library, font, image and text source here, even open source ones, because the form requires it. `[Lane 3: add every CDN library, font and image actually shipped; Lane 1: add every Python package]`

---

## Self-check against the five judging criteria

Each project is scored 1 to 5 on these (Judging & Awards Guide, 2026). Use this to decide what the final site, demo and description must visibly show. "Gap" means something still to do, not a claim we can make today.

| Criterion | What the guide rewards | What we can point to | Gap / to do |
|---|---|---|---|
| Impact | Real problem, reach, who it helps | Students and the public can test whether a change in the Earth system is real, with no install or login | Say who it is for (high school, college, public) in the demo |
| Creativity | Original idea or meaningful improvement | Significance verdict in plain language, trend sign-flip map, Shift mode, guided cases | Show Shift mode on screen in the demo; it is the most distinctive feature |
| Validity | Scientifically sound, feasible, usable | Two significance tests, honest limits, checks against GISTEMP and NSIDC | Fill `VALIDATION.md` with real numbers; test on a second machine |
| Relevance | Directly addresses the challenge, NASA data is core | Maps to all four challenge objectives; MERRA-2 is the only data source | Name MERRA-2 and GES DISC in the demo, not just the description |
| Presentation | Clear story, structured, compelling demo and full project | Demo script and slide plan in `DEMO_SCRIPT.md` | Record it; keep to the 30-second or 7-slide limit |

The guide says the project page is "the page that the judges will review" and that more information helps judges rate it, so fill every field fully rather than minimally.
