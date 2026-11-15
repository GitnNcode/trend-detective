# Validation table

Lane 1 owns producing the numbers in Stage 2 (see PLAN.md). This file is the template and the method, so the table is ready to fill. **No result is entered yet; do not fill a cell with a number that the pipeline did not produce.**

## Table

| Check | Our value (MERRA-2) | Published value | Source | Agree? |
|---|---|---|---|---|
| Global mean 2 m air temperature trend, `[start year]`-`[end year]` | `[slope ± 95% CI, °C/decade]` | `[computed from GISTEMP v4 for the same years]` | https://data.giss.nasa.gov/gistemp/ | `[ ]` |
| September Arctic sea ice trend, 1979-2024 reference | `[% per decade relative to our 1981-2010 mean, or km² per decade]` | About -12.1 to -12.2 % per decade of the 1981-2010 average (NSIDC-based, 1979-2024) | https://www.climate.gov/news-features/understanding-climate/climate-change-minimum-Arctic-sea-ice-extent , https://climate.nasa.gov/vital-signs/arctic-sea-ice | `[ ]` |

## Method notes

**Temperature.** Do not quote a published per-decade number from memory or a secondary source. Download the GISTEMP v4 global annual (or monthly) series and fit the same linear trend over exactly the same years as ours. Differences of a few hundredths of a degree per decade between a reanalysis and an observational product are normal; compare intervals, not just point values. Our proposed agreement rule: the two 95% intervals overlap.

**Sea ice.** The published NSIDC figure is **extent** (area of cells with at least 15% ice) from passive-microwave data, relative to the 1981-2010 September mean, over 1979-2024. MERRA-2 provides a sea ice **fraction** that is largely derived from other ice products, and our engine's band area is not identical to extent. State the definition we used (for example, area where fraction is at least 0.15, in km²) and compute the same relative trend (percent per decade of our own 1981-2010 mean), over 1980-2024 because MERRA-2 starts in 1980. Treat a match within a few percent per decade as agreement. Explain any gap rather than hiding it.

**Why the published sea ice figure carries an end year.** NSIDC reports different rates for different periods (for example 13.4% per decade through 2020 versus about 12.1 to 12.2% through 2024), so always quote it with its period.

## Datasets used in validation (add citations when final)

See `REFERENCES.md`: GISTEMP v4 (Lenssen et al. 2024; GISTEMP Team), NSIDC Sea Ice Index, NASA Earth Science Vital Signs.

## Result statement (write after the table is filled)

`[One honest paragraph: where we agree, where we do not, and why.]`
