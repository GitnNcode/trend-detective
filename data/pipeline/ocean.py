"""Ocean files for the tanker route planner -> data/ocean/.

1. mask.bin: ocean fraction on the MERRA-2 native 0.5 x 0.625 grid
   (M2C0NXASM FROCEAN), uint8 percent, [361 lat, 576 lon], lat from -90,
   lon from -180. Fine enough to follow coasts and most straits.
2. currents.bin: monthly climatology (2008-2017) of surface ocean current from
   ECCO V4r4 (EVEL, NVEL, top level, 0.5 deg), averaged onto a 1 deg grid,
   int16 [12 month, 2 (east, north), 180 lat, 360 lon], scale 0.001 m/s,
   -32768 = land. ECCO is a NASA ocean state estimate (model fitted to
   satellite and in-situ data), so it gives full coverage.
3. ocean.json: the grids and scales.

Needs the Earthdata login (same as fetch.py). Downloads ~120 small subsets.
Run: data/pipeline/.venv/bin/python data/pipeline/ocean.py
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import earthaccess
import numpy as np
import xarray as xr

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE.parent / "ocean"
ECCO = "ECCO_L4_OCEAN_VEL_05DEG_MONTHLY_V4R4"
YEARS = range(2008, 2018)


def dap_url(g):
    return next(u["URL"] for u in g["umm"]["RelatedUrls"] if "opendap.earthdata.nasa.gov" in u["URL"])


def get(session, url, ce, dest):
    if dest.exists():
        return dest
    r = session.get(url + ".dap.nc4", params={"dap4.ce": ce}, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"{dest.name}: HTTP {r.status_code} {r.text[:200]}")
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.rename(dest)
    return dest


def main():
    earthaccess.login()
    s = earthaccess.get_requests_https_session()
    OUT.mkdir(exist_ok=True)

    # 1. Ocean fraction, native grid.
    (RAW / "const").mkdir(parents=True, exist_ok=True)
    g = earthaccess.search_data(short_name="M2C0NXASM")[0]
    f = get(s, dap_url(g), "/FROCEAN;/lat;/lon", RAW / "const" / "FROCEAN.nc4")
    with xr.open_dataset(f) as ds:
        fr = ds["FROCEAN"].squeeze(drop=True).sortby("lat").sortby("lon")
        lat, lon = fr.lat.values, fr.lon.values
        pct = np.clip(np.round(fr.values * 100), 0, 100).astype(np.uint8)
    assert pct.shape == (361, 576), pct.shape
    pct.tofile(OUT / "mask.bin")
    mask_grid = {"nlat": 361, "nlon": 576, "lat0": float(lat[0]), "lon0": float(lon[0]), "dlat": 0.5, "dlon": 0.625}
    print("mask", mask_grid, f"{(pct >= 50).mean():.1%} ocean")

    # 2. ECCO surface currents, one file per month, top level only.
    (RAW / "ecco").mkdir(parents=True, exist_ok=True)
    grans = earthaccess.search_data(short_name=ECCO, temporal=(f"{YEARS[0]}-01-01", f"{YEARS[-1]}-12-31"))
    jobs = {}
    with ThreadPoolExecutor(8) as pool:
        for g in grans:
            name = g["umm"]["GranuleUR"]
            ym = name.split("mon_mean_")[1][:7]
            if int(ym[:4]) not in YEARS:
                continue
            jobs[ym] = pool.submit(get, s, dap_url(g), "/EVEL[0][0][0:359][0:719];/NVEL[0][0][0:359][0:719];/latitude;/longitude",
                                   RAW / "ecco" / f"{ym}.nc4")
    files = {}
    for ym, j in sorted(jobs.items()):
        try:
            files[ym] = j.result()
        except Exception as e:
            print("FAIL", ym, e, file=sys.stderr)
    print(f"ecco: {len(files)} months")
    if len(files) < 12 * len(YEARS) * 0.9:
        sys.exit("too many ECCO months missing")

    sums = np.zeros((12, 2, 360, 720))
    counts = np.zeros((12, 1, 360, 720))
    for ym, f in files.items():
        m = int(ym[5:]) - 1
        with xr.open_dataset(f) as ds:
            ds = ds.sortby("latitude").sortby("longitude")
            uv = np.stack([ds["EVEL"].values.reshape(360, 720), ds["NVEL"].values.reshape(360, 720)])
        ok = np.isfinite(uv[0])
        sums[m] += np.where(ok, uv, 0)
        counts[m, 0] += ok
    clim = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
    # 0.5 deg -> 1 deg: mean of each 2 x 2 block, missing when all four are land.
    blocks = clim.reshape(12, 2, 180, 2, 360, 2)
    with np.errstate(invalid="ignore"):
        cur = np.nanmean(blocks, axis=(3, 5))
    q = np.where(np.isfinite(cur), np.round(cur / 0.001), -32768).astype("<i2")
    q.tofile(OUT / "currents.bin")
    cur_grid = {"nlat": 180, "nlon": 360, "lat0": -89.5, "lon0": -179.5, "dlat": 1.0, "dlon": 1.0}
    print("currents max speed", float(np.nanmax(np.hypot(cur[:, 0], cur[:, 1]))), "m/s")

    meta = {
        "mask": {"file": "mask.bin", "type": "uint8", "units": "percent ocean", "grid": mask_grid,
                 "source": "MERRA-2 M2C0NXASM FROCEAN, native grid"},
        "currents": {"file": "currents.bin", "type": "int16", "scale": 0.001, "missing": -32768, "units": "m/s",
                     "shape": [12, 2, 180, 360], "grid": cur_grid, "years": [YEARS[0], YEARS[-1]],
                     "source": "ECCO V4r4 ocean velocity, monthly mean 0.5 deg, top level (EVEL, NVEL), monthly climatology"},
    }
    (OUT / "ocean.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
