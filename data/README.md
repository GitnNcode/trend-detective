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
- Gelaro, R., et al. (2017), The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2), J. Climate, 30, 5419-5454.

Libraries (for Lane 4's References): numpy, xarray, netCDF4, earthaccess, requests. Pipeline only; nothing here ships to the browser.

Code and data in this folder were written with Claude and reviewed by the team.
