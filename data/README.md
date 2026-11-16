# /data (Lane 1)

Binary variable files and `catalog.json` in the format defined in `PLAN.md` (Int16 little-endian `[nt, nlat, nlon]`, missing = -32768, real = stored * scale + offset).

- `mock/`: synthetic `t2m`, `wind250`, `seaice` with known signals, for building against before real data lands. Not NASA data.
- `<id>.bin` + `catalog.json` (this folder): real MERRA-2 output from the pipeline.

## Pipeline

```bash
uv venv .venv && uv pip install -r data/pipeline/requirements.txt
cd data/pipeline
python make_mock.py            # regenerate mock/
python test_build.py           # self-check of build.py on fake native files, no login
python fetch.py t2m wind250 seaice precip   # needs Earthdata login, see below
python build.py                # raw/ -> ../<id>.bin + ../catalog.json
python check.py                # annual area means per variable; exit 1 if anything is off
```

Earthdata credentials come from `~/.netrc` (`machine urs.earthdata.nasa.gov login USER password PASS`, `chmod 600`) or `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD`. Never commit them. `fetch.py` pulls one field per month through OPeNDAP (about 1 MB each) into `pipeline/raw/` (gitignored) and skips what is already there, so it is safe to re-run.

## Processing notes

- Collection and field names in `PLAN.md` were checked against the MERRA-2 File Specification (GMAO Office Note 9). All twelve fields exist as listed.
- Coarsening: area-weighted mean of native 0.5° x 0.625° cells onto each variable's grid. Native cells on a target edge are shared evenly. A target cell is missing when less than half its area has data.
- Units: K to °C; kg m⁻² s⁻¹ to mm/day (x 86400).
- `wind250` is the speed of the monthly-mean wind (`hypot(U250, V250)`), which is somewhat lower than the monthly mean of instantaneous speed. Fine for trends; do not quote it as absolute jet speed.
- `seaice` is ice fraction of the ocean, from `FRSEAICE` and the constant `FROCEAN` (M2C0NXASM). Native cells with `FROCEAN < 0.5` are land and stored as missing, never 0. `build.py` checks whether `FRSEAICE` is per grid box or per ocean tile and prints which.
- Land variables (`soilwet`, `snow`, `runoff`) are undefined over ocean in MERRA-2 and stay missing.
- The record is the run of consecutive months from 1980-01; a gap ends it (contract: no gaps).
- Real files: all ten variables, 1980-01 to 2026-09 (561 months). 2026 is a partial year.
- Added on 2026-11-15 for the app (same pipeline, same grid, same contract format):
  - `u250`, `v250`: eastward and northward wind at 250 hPa (m/s), for the wind-vector loop. The speed of their monthly means matches `wind250` (for example 35.5 vs 35.6 m/s at 40°N 60°W, January 2000).
  - `aod`: total aerosol optical depth at 550 nm (M2TMNXAER TOTEXTTAU), unitless, for the "city air" regions.
  - `fzlev`: height of the 0 °C level in metres above sea level. Per native cell and month, a straight-line temperature profile between the ground (T2M at the surface height PHIS/g) and 500 hPa (T500 at height H500) is solved for 0 °C; it is the ground height where T2M is already at or below 0 °C, and H500 where T500 is still above 0 °C. Then coarsened like every other field. It is an estimate (real profiles are not straight lines) and is best used for trends.
- Fetch for these: `python fetch.py u250 v250 aod fzlev`, then `python build.py u250 v250 aod fzlev` (needs the Earthdata login and the GES DISC application approved).
- `u10`, `v10` (added 2026-11-15): eastward and northward wind at 10 m (M2TMNXSLV U10M, V10M), for the shipping-route product. `python fetch.py u10 v10`, then `python build.py u10 v10`.
- `ocean/` (added 2026-11-15, `python ocean.py`): `mask.bin`, the MERRA-2 ocean fraction (M2C0NXASM FROCEAN) on the native 0.5 x 0.625 grid as uint8 percent, the land/sea grid for tanker routing; `currents.bin`, a monthly climatology (2008-2017) of surface current from ECCO V4r4 (EVEL, NVEL, top level), on a 1 deg grid, int16 [12, 2, 180, 360] at 0.001 m/s; `ocean.json` describes both. ECCO dataset: ECCO Ocean Velocity, Monthly Mean 0.5 Degree (Version 4 Release 4), PO.DAAC short name ECCO_L4_OCEAN_VEL_05DEG_MONTHLY_V4R4.
- Known issue: `precip` (PRECTOTCORR) has a spike over southern Italy in 2026-02 (up to 134 mm/day on our grid, 415 at native resolution). It comes from NASA's recent, preliminary months and is left as delivered. `runoff` inherits it (up to 165 mm/day there), because MERRA-2's land model is driven by that precipitation. Use complete years up to 2025 for trends.

## First check against published numbers

| Quantity | Ours (MERRA-2) | Published |
|---|---|---|
| September Arctic sea ice extent trend, 1980-2024 | -11.7% of the 1981-2010 mean per decade | NSIDC: about -12% per decade (1979-2024) |
| September 2012 extent (record low) | 3.56 M km² | NSIDC: 3.39 M km² |
| Global mean 2 m temperature trend, 1980-2025 | +0.165 °C per decade | GISTEMP v4: about +0.19 °C per decade (to fill exactly in docs/VALIDATION.md) |

Extent here is the area of cells with ice fraction at least 0.15 on our 1° grid north of 50°N.

## Datasets

- Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavgM_2d_slv_Nx (M2TMNXSLV) v5.12.4, GES DISC, doi:10.5067/AP1B0BA5PD2K
- GMAO (2015), MERRA-2 tavgM_2d_flx_Nx (M2TMNXFLX) v5.12.4, GES DISC, doi:10.5067/0JRLVL8YV2Y4
- GMAO (2015), MERRA-2 tavgM_2d_lnd_Nx (M2TMNXLND) v5.12.4, GES DISC, doi:10.5067/8S35XF81C28F
- GMAO (2015), MERRA-2 const_2d_asm_Nx (M2C0NXASM) v5.12.4, GES DISC, doi:10.5067/ME5QX6Q5IGGU
- GMAO (2015), MERRA-2 tavgM_2d_aer_Nx (M2TMNXAER) v5.12.4, GES DISC, doi:10.5067/FH9A0MLJPC7N
- Gelaro, R., et al. (2017), The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2), J. Climate, 30, 5419-5454.

Libraries (for Lane 4's References): numpy, xarray, netCDF4, earthaccess, requests. Pipeline only; nothing here ships to the browser.

Code and data in this folder were written with Claude and reviewed by the team.
