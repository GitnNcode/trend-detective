# Validation table

Lane 1 owns producing the numbers in Stage 2 (see PLAN.md). This file is the template and the method, so the table is ready to fill. **No result is entered yet; do not fill a cell with a number that the pipeline did not produce.**

## Table

Filled from the pipeline output on 2026-11-15 (`app/` Validation product, and the same engine calls in Node). Reference files are in `data/validation/` (see its README).

| Check | Our value (MERRA-2) | Published value | Source | Agree? |
|---|---|---|---|---|
| Global mean 2 m air temperature trend, 1980-2025 | +0.165 °C/decade (95% CI +0.134 to +0.196) | +0.208 °C/decade (95% CI +0.184 to +0.232), our fit to GISTEMP v4 annual (J-D) means for the same years | `data/validation/GLB.Ts+dSST.csv`, https://data.giss.nasa.gov/gistemp/ | Yes: the 95% intervals overlap (+0.184 to +0.196); yearly anomalies correlate at r = 0.97 |
| September Arctic sea ice extent trend, 1980-2024 | -11.7 % per decade of our 1981-2010 mean (95% CI -13.7 to -9.7); mean 6.47 M km² | -12.4 % per decade over 1980-2024 from the NSIDC Sea Ice Index September extents (95% CI -14.3 to -10.6); -12.1 % per decade over 1979-2024, matching the published -12.1 to -12.2 % | `data/validation/N_09_extent.csv`, https://nsidc.org/data/g02135 | Yes: within 0.7 % per decade; yearly extents correlate at r = 0.99 |
| September 2012 (record-low) extent | 3.56 M km² | 3.57 M km² (NSIDC monthly mean) | as above | Yes |

## Method notes

**Temperature.** Do not quote a published per-decade number from memory or a secondary source. Download the GISTEMP v4 global annual (or monthly) series and fit the same linear trend over exactly the same years as ours. Differences of a few hundredths of a degree per decade between a reanalysis and an observational product are normal; compare intervals, not just point values. Our proposed agreement rule: the two 95% intervals overlap.

**Sea ice.** The published NSIDC figure is **extent** (area of cells with at least 15% ice) from passive-microwave data, relative to the 1981-2010 September mean, over 1979-2024. MERRA-2 provides a sea ice **fraction** that is largely derived from other ice products, and our engine's band area is not identical to extent. State the definition we used (for example, area where fraction is at least 0.15, in km²) and compute the same relative trend (percent per decade of our own 1981-2010 mean), over 1980-2024 because MERRA-2 starts in 1980. Treat a match within a few percent per decade as agreement. Explain any gap rather than hiding it.

**Why the published sea ice figure carries an end year.** NSIDC reports different rates for different periods (for example 13.4% per decade through 2020 versus about 12.1 to 12.2% through 2024), so always quote it with its period.

## Datasets used in validation (add citations when final)

See `REFERENCES.md`: GISTEMP v4 (Lenssen et al. 2024; GISTEMP Team), NSIDC Sea Ice Index, NASA Earth Science Vital Signs.

## Result statement

MERRA-2 agrees with both independent records. Its global warming rate since 1980 (+0.165 °C per decade) is a little lower than the GISTEMP thermometer record (+0.208 °C per decade), but the two 95% intervals overlap and the year-to-year anomalies track each other closely (r = 0.97); a slightly lower rate in a reanalysis is a known difference, partly because the reanalysis 2 m temperature over sea ice and data-sparse areas is constrained differently from GISTEMP's interpolation. For September Arctic sea ice, our extent-like measure (area of 1° cells with at least 15% ice, north of 50°N) falls by 11.7% per decade against 12.4% in the NSIDC Sea Ice Index over the same years, and the 2012 record low matches to within 0.01 M km². The trends the app reports are therefore consistent with NASA's and NSIDC's published records, with MERRA-2 slightly conservative on global warming.
