# /data/validation: independent records used to check MERRA-2

Small, public, no-login reference files used by the app's Validation product and by `docs/VALIDATION.md`. Downloaded 2026-11-15.

| File | What it is | Source |
|---|---|---|
| `GLB.Ts+dSST.csv` | NASA GISTEMP v4 global-mean land-ocean temperature anomalies (°C relative to 1951-1980), monthly and annual (J-D column) | https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv |
| `N_09_extent.csv` | NSIDC Sea Ice Index v4 (G02135), Northern Hemisphere September extent and area, million km² | https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv |

Citations:
- GISTEMP Team (2026): GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute for Space Studies. Lenssen, N., et al. (2024), J. Geophys. Res. Atmos., 129, e2023JD040179.
- Fetterer, F., K. Knowles, W. N. Meier, M. Savoie, and A. K. Windnagel (2017, updated daily). Sea Ice Index, Version 3/4 (G02135). Boulder, Colorado USA. NSIDC: National Snow and Ice Data Center.

The app re-baselines GISTEMP to 1981-2010 before comparing anomalies, and compares September extents with MERRA-2's area of 1° cells with at least 15% ice north of 50°N.
