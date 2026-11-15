# Analysis notes: real numbers for the narration

Computed with `app/lib/analysis.js` on the real MERRA-2 monthly files in `/data` (1980-01 to 2026-09). Regions are from `content/regions.json`. Unless a row says otherwise:

- **Grid:** 2° x 2.5° global.
- **Annual statistics:** complete years 1980-2025. The partial year 2026 is dropped.
- **Seasonal statistics:** a season counts once it is complete. September 2026 and DJF 2025-26 are in the record, so the "late" window for those runs to 2026, and 2026 is preliminary NASA data.
- **Land mask:** `landMaskFrom(soilwet)`, 3658 of 13104 cells. MERRA-2's land fields leave out the Greenland and Antarctic ice sheets, so those count as "not land".

Rates are per decade. "Clear" means p < 0.05.

```js
const land = landMaskFrom(vars.soilwet);
velocitySummary(velocityField(vars.t2m), region, { mask: land });          // section 1
climateTwin({ t2m: vars.t2m, precip: vars.precip }, lat, lon, { landMask: land }); // section 2
lineup(vars, region);                                                       // section 3, all months
dipole(v, bandTrack(v, { min, max, months, region }), months);             // section 4
```

## 1. Climate velocity of air temperature (t2m, annual means 1980-2025)

How fast a fixed yearly-average temperature moves across the map: the local warming rate divided by how quickly temperature changes with distance.

| Area | Median km/decade | Mean km/decade | Mean direction (coherence 0-1) |
|---|---|---|---|
| **Whole globe** | **39** | 73 | none (0.10) |
| **Land** | **44** | 77 | none (0.12) |
| Not land (ocean + ice sheets) | 36 | 71 | none (0.12) |
| Northern Hemisphere land | 43 | 65 | north (0.38) |
| NH land 30-70°N | 37.5 | 51 | north (0.66) |
| Southern Hemisphere land | 51 | 111 | south-southwest (0.31) |
| Tropics 23°S-23°N | 91 | 126 | none (0.08) |
| Siberia | 43 | 56 | north-northeast (0.92) |
| North Atlantic | 25 | 27 | north-northwest (0.83) |
| Arctic | 84 | 134 | north-northeast (0.45) |
| Amazon | 271 | 291 | west-southwest (0.45) |

- **Quote:** "On land, places with a given yearly average temperature moved about 44 km per decade (median), roughly 200 km between 1980 and 2025. In northern mid-latitudes they moved north."
- **Context:** the same files give mean warming of +0.165 °C per decade for the globe and +0.25 °C per decade over land. 185 of 3658 land cells cooled.
- **Defaults used:** gradient floor 4.6e-4 °C/km (0.1 x the median gradient); colour cap 37 km/yr (98th percentile).
- **Sensitivity:** without the 3x3 smoothing, the medians are 36 km/decade for the globe and 36 for land.
- **For comparison:** Burrows et al. (2011, *Science* 334:652) reported roughly 27 km/decade on land and 22 km/decade in the ocean for 1960-2009 on a 1° grid (from memory; check before quoting). Ours is higher, which fits the faster warming since 1980 and our coarser grid.
- **Do not quote the tropical or Amazon speeds as "how fast things must move".** Temperature there barely changes with distance, so tiny gradients make huge speeds.
- **A "coherence" near 0 means directions cancel out**, so the mean direction is meaningless.

## 2. Climate twins (base 1980-1989, recent 2016-2025, land only, search radius 2500 km)

Fingerprint: mean temperature, seasonal range (warmest minus coldest month) and log precipitation.
**then → now:** where home's 1980s climate is found today. **now → was:** where home's present climate was found in the 1980s.
Match quality from climate distance d: good < 0.5, fair < 1.2, poor otherwise.

| City | Change at home (1980s → 2016-25) | then → now | now → was |
|---|---|---|---|
| Chicago | +1.65 °C, rain +5% | 343 km ENE, near Flint, Michigan (fair, d 1.16) | 567 km ESE, southeastern Ohio (fair, 0.66) |
| Phoenix | +1.46 °C, rain −22% | 252 km SE, upland east of Tucson (**good**, 0.37) | no real match (poor, 2.07) |
| Paris | +1.77 °C, rain −6% | 885 km NE, Fehmarn Belt, German-Danish Baltic (**good**, 0.35) | 446 km SSE, near Le Puy-en-Velay, Massif Central (fair, 0.81) |
| Madrid | +1.22 °C, rain +12% | no real match (poor, 1.47) | 2217 km E, Thessaly, northern Greece (**good**, 0.48) |
| Delhi | **−0.27 °C**, rain **+29%** | 267 km NW, near Sirsa, Haryana (fair, 1.10) | 284 km ESE, near Shahjahanpur, Uttar Pradesh (fair, 0.99) |
| Moscow | +1.33 °C, rain +5% | 277 km NE, near Kostroma (fair, 0.96) | 351 km SW, near Bryansk (fair, 0.98) |
| São Paulo | +1.11 °C, rain **−30%** | no real match (poor, 1.93) | 623 km NE, eastern Minas Gerais near Ipatinga (fair, 1.18) |
| Sydney | +0.91 °C, rain −8% | 115 km W, tablelands west of Sydney (fair, 0.85) | no real match (poor, 1.44) |
| Lagos | +0.77 °C, rain +9% | 165 km NNE, near Oyo (**good**, 0.23) | 640 km W, central Ghana near Sunyani (poor, 1.25) |
| Tokyo | +1.48 °C, rain **+21%** | no real match (poor, 1.47) | 515 km WSW, near Tokushima, Shikoku (**good**, 0.48) |

Best lines: "Paris's 1980s climate now lives about 900 km to the northeast, on the Baltic coast between Germany and Denmark." · "Tokyo today has the climate that Tokushima, 500 km to the southwest, had in the 1980s." · "Lagos's 1980s climate has moved about 165 km inland, to around Oyo." · "Phoenix today is hotter and drier than anywhere within 2,500 km was in the 1980s: at this grid scale, it has no climate twin."

## 3. Variable lineup (all months, annual means 1980-2025)

Top three of ten variables per region. n* = years needed to detect a trend this size (Weatherhead et al. 1998, annual-data form; see section 5).

| Region | 1st | 2nd | 3rd |
|---|---|---|---|
| Arctic | water vapor +0.23 kg/m² (t 11.8; n* 20) | air temp 5 km up +0.43 °C (t 11.2; n* 22) | sea ice −1.9 percentage points (t −10.0; n* 25) |
| Sahel | air temp +0.20 °C (t 4.7; n* 48) | water vapor +0.38 kg/m² (t 3.6; n* 57) | air temp 5 km up +0.098 °C (t 3.2; n* 53) |
| Amazon | evaporation −0.15 mm/day (t −8.2; n* 37) | air temp +0.32 °C (t 6.3; n* 33) | precipitation −0.31 mm/day (t −5.6; n* 38) |
| North Atlantic | air temp 5 km up +0.35 °C (t 9.4; n* 24) | evaporation +0.086 mm/day (t 8.9; n* 29) | water vapor +0.35 kg/m² (t 8.8; n* 29) |
| Siberia | water vapor +0.19 kg/m² (t 5.1; n* 35) | air temp 5 km up +0.18 °C (t 3.3; n* 46) | air temp +0.28 °C (t 2.9; n* 45) |

All 15 are "significant" (both tests p < 0.05).

### "How long until we know?" (not significant yet)

| Region, variable | Rate per decade | Verdict | n* years | Expected year |
|---|---|---|---|---|
| Sahel, precipitation | +0.062 mm/day | suggestive | 96 | about 2076 |
| Sahel, runoff | +0.047 mm/day | suggestive | 76 | about 2055 |
| Arctic, precipitation | +0.0076 mm/day | none | 89 | about 2069 |
| Arctic, jet-level wind | −0.089 m/s | none | 122 | about 2102 |
| Siberia, snow | −0.99 kg/m² | none | 89 | about 2069 |
| North Atlantic, snow | −2.2 kg/m² | suggestive | 71 | about 2050 |

Whole-globe air temperature: +0.165 °C per decade, n* = 28 years. A trend that size became detectable around 2008.

## 4. Dipoles: one moving zone, two opposite local trends

Early and late = first and last 10 years of each band's record. A side counts only if it is at least 20% of the area that changed.

| Case | Arrived | Left | Opposite? |
|---|---|---|---|
| Jet-level wind ≥ 40 m/s, DJF, North Atlantic | none | 0.74 M km², +0.12 m/s, 0% clear | no |
| Sea ice ≤ 15%, September, Arctic | 2.59 M km², −12.6 pp, 97% clear | 0.015 M km² (3 cells) | no |
| Air temperature ≤ 0 °C, all months, globe | 0.54 M km², −0.11 °C (Southern Ocean) | 3.63 M km², +0.33 °C, 81% clear | no |
| **Rain ≥ 2 mm/day, Jul-Sep, West Africa 0-25°N, 20°W-40°E** | 0.30 M km², **+0.25** mm/day, **100% clear** (Sahara's edge, 16-18°N) | 0.37 M km², **−0.23** mm/day, **100% clear** (Gulf of Guinea coast) | **yes** |
| **Rain ≥ 6 mm/day, all months, tropics 20°S-20°N** | 5.2 M km², +0.51 mm/day, 71% clear | 8.7 M km², −0.36 mm/day, 53% clear | **yes** |

**Best narration example:** "The West African summer rain belt moved north. Rain rose by 0.25 mm/day per decade at the desert's edge, where the rain belt arrived, and fell by 0.23 mm/day per decade along the Gulf of Guinea, where it left. One moving rain belt, two opposite local trends." (Over the ocean MERRA-2 rain is model-based.)

## 5. Results that look odd, and why

1. **Delhi cools (−0.27 °C) and gets 29% wetter** in its 2° cell (trend −0.10 °C/decade, p = 0.12). Likely reanalysis behaviour over the irrigated, hazy Indo-Gangetic Plain. Do not use Delhi as a warming example.
2. **São Paulo rain drops 30%** (4.79 → 3.25 mm/day decade means). Not checked against rain gauges.
3. **Phoenix's "then → now" points southeast**, toward a cooler upland cell east of Tucson.
4. **Madrid's present climate** best matches 1980s Greece, 2,200 km away.
5. **Sydney's two answers land in nearly the same inland cell** (coarse coastline). Tokyo's "then → now" is poor because Japan got wetter everywhere.
6. **Jet-level wind** is the speed of the monthly-mean wind; quote changes, not absolute speeds.
7. **Amazon "snow"** is a trace; `lineup` marks it `negligible`.
8. **Detection horizons are about 2.3× the textbook formula**, which assumes monthly data; for annual means the noise needs a √12 factor (verified by simulation). `detectionHorizon(annual, { perYear: 12 })` gives the literal formula.
9. **Southern Ocean cooling** (54-64°S) matches the observed 1979-2015 Southern Ocean surface cooling.

Code and these notes were written with Claude and reviewed by the team.
