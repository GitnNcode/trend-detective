# Submission draft

Maps to the project page fields in `SUBMISSION_REQUIREMENTS.md`. Items in `[BRACKETS]` are not known yet and must be filled in by the team. Nothing below states a measured result: Stage 2 adds real numbers.

---

## Project Name

Trend Detective `[confirm final name]`

## High-Level Project Summary

Trend Detective is a free website that turns a student into a data detective. They pick a question, such as "Is the Arctic losing its summer ice?", and the site suggests a NASA variable and region, draws its time series from 1980 onward, reports the rate of change with a confidence interval, and says plainly whether the trend is statistically significant. A trend map shows where the same variable changes in opposite directions, and Shift mode lets users watch a fixed-value band, such as the jet stream core or the Arctic ice edge, move across the map year by year. Two guided demos, the jet stream and the Arctic shipping lane, show how it works. It runs entirely in the browser from pre-built NASA MERRA-2 files, so there is nothing to install, no login and no API key. Non-significant results are presented as findings, not errors, because learning when the evidence is not strong enough is part of the science.

## Link to Project Demo

`[URL: public video of 30 seconds or less, or 7-slide deck. See DEMO_SCRIPT.md]`

## Link to Final Project

`[URL of deployed site]` · Source: https://github.com/GitnNcode/trend-detective

## Detailed Project Description

**What it does.** The user answers a guided question, or picks a variable and a region manually. The tool shows (1) a plain-language definition of the variable, (2) the region-averaged time series with seasonal cycle optionally removed, (3) the rate of change per decade with a 95% confidence interval, (4) a significance verdict, (5) a map of the trend in every grid cell with non-significant cells faded, and (6) Shift mode, which draws where a chosen value band lies each year and reports how far its edge moved.

**How it addresses the four challenge objectives.**

1. *Identify variables of interest.* Ten MERRA-2 variables (surface and upper-air temperature, jet-stream wind, water vapor, precipitation, evaporation, sea ice, soil wetness, snow mass, runoff), each with a one-sentence plain definition and a one-sentence reason it might trend. A table of 15 sample questions maps everyday curiosity to a variable, region, season and view, with no AI in the app.
2. *Acquire the data for a region.* 15 preset regions (desert, rainforest, estuary, city air, ocean, polar, global) plus a user-drawn box. Series are area-weighted by cos(latitude), with missing cells skipped.
3. *Generate and visualize a time series.* Monthly means from 1980 to the latest available month, shown as annual means with a trend line and shaded 95% interval.
4. *Basic statistical analysis and significance.* Ordinary least-squares slope with a t-test and confidence interval, plus the Mann-Kendall test with an autocorrelation correction and Sen's slope. A trend is "significant" only if both tests give p < 0.05, "suggestive" if only one passes or p < 0.10, and otherwise "none", with a note that a longer record may be needed.

**Beyond the objectives.** The challenge notes that one variable can trend in opposite directions in different regions. The trend map and the paired sample questions (for example Arctic versus Antarctic temperature, Sahel versus Mediterranean rainfall) are built to show exactly that. The challenge suggests watchable examples; the two guided cases are those.

**Benefits.** It lowers the barrier to real climate-data analysis: no coding, no account, no download. Students learn the difference between a trend and a significant trend, and see that a result that is not significant is still a finding. Teachers get two ready-made guided cases.

**Goals.** Help high school and college students, and members of the public with some science background, find a variable, pick a place, and judge for themselves whether a change in the Earth system is real. `[Team: add any further goals]`

**Honest limits.** Linear trends only, on a record of roughly 45 years. MERRA-2 is a model-assimilated reanalysis, not a direct measurement. Grid cells are 2.0° by 2.5° (1.0° by 1.25° for sea ice), so narrow features such as straits and small estuaries are blurred. A trend that is not significant is reported as such.

**Tools.** Vanilla JavaScript (ES modules), HTML canvas, d3-geo, Tailwind CSS. A Python pipeline (`/data/pipeline`) builds the data files. No backend. `[Lane 3: confirm hosting and final tool list]`

## Use of Super Intelligence (SI)

Draft answer (not shown to judges; judges do see SI acknowledgements inside the project):

We used Claude (Anthropic) as a coding and writing assistant: it helped write and review code in the data pipeline, statistics engine and interface, and it drafted the plain-language variable definitions, sample questions, demo narration and documentation. `[TEAM TO CONFIRM and edit: who came up with the idea and approach; the guide says SI should not be used to devise the idea of how to solve the challenge. State accurately what the team did and what SI did.]` `[Add once true: our trends were checked against published NASA and NSIDC figures, see VALIDATION.md.]` Acknowledgements appear in the repository README and in each folder's README, in git commit trailers, and `[on the site footer: Lane 3]`.

## NASA Data

NASA MERRA-2 monthly mean fields, 1980 to the latest available month, from NASA GES DISC (Goddard Earth Sciences Data and Information Services Center):

- M2TMNXSLV (single-level diagnostics): 2 m air temperature, 500 hPa temperature, 250 hPa winds, total column water vapor.
- M2TMNXFLX (surface flux diagnostics): precipitation, evaporation, sea ice fraction. `[Lane 1: confirm the sea ice field and collection]`
- M2TMNXLND (land surface diagnostics): root-zone soil wetness, snow mass, runoff.

Validation references: NASA GISS Surface Temperature Analysis (GISTEMP v4), and NSIDC sea ice index figures published through NASA. `[Lane 1: list what was actually used]`

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
