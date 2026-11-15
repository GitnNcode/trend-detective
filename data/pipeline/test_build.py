"""Self-check for build.py on fake native-grid MERRA-2 files. No login needed.

Run: python data/pipeline/test_build.py
"""
import json
import tempfile
from pathlib import Path

import numpy as np
import xarray as xr

import build
from fmt import read_var

LAT = np.arange(-90, 90.01, 0.5)
LON = np.arange(-180, 180, 0.625)
LA, LO = np.meshgrid(LAT, LON, indexing="ij")
LAND = (LA > 60) & (LA < 70) & (LO > 0) & (LO < 90)  # a land block inside the seaice grid


def put(raw, sn, field, key, arr):
    d = raw / sn / field
    d.mkdir(parents=True, exist_ok=True)
    arr = np.where(np.isnan(arr), 1e15, arr).astype("f4")[None]
    xr.Dataset({field: (("time", "lat", "lon"), arr)}, coords={"lat": LAT, "lon": LON, "time": [0]}) \
        .to_netcdf(d / f"{key}.nc4", encoding={field: {"_FillValue": np.float32(1e15)}})


def main():
    with tempfile.TemporaryDirectory() as tmp:
        raw, out = Path(tmp) / "raw", Path(tmp) / "out"
        put(raw, "M2C0NXASM", "FROCEAN", "000000", np.where(LAND, 0.0, 1.0))
        keys = [f"{1980 + k // 12}{k % 12 + 1:02d}" for k in range(14)] + ["198104"]  # gap after 198102
        for t, k in enumerate(keys):
            put(raw, "M2TMNXSLV", "T2M", k, 273.15 + 10 + 0.1 * LA + t * 0.0)
            put(raw, "M2TMNXSLV", "U250", k, np.full(LA.shape, 3.0))
            put(raw, "M2TMNXSLV", "V250", k, np.full(LA.shape, 4.0))
            ice = np.where(LAND, 0.0, np.clip((LA - 75) / 5, 0, 1))  # per grid box: 0 over land
            put(raw, "M2TMNXFLX", "FRSEAICE", k, ice)
            put(raw, "M2TMNXFLX", "PRECTOTCORR", k, np.full(LA.shape, 1 / 86400))
            put(raw, "M2TMNXLND", "GWETROOT", k, np.where(LAND, 0.4, np.nan))

        for v in ["t2m", "wind250", "seaice", "precip", "soilwet"]:
            build.write_catalog(out, [build.build(v, raw, out)])
        cat = {e["id"]: e for e in json.loads((out / "catalog.json").read_text())["variables"]}

        t2m = read_var(out, cat["t2m"])
        assert cat["t2m"]["nt"] == 14, "gap must truncate the record"
        g = cat["t2m"]["grid"]
        i = int((40 - g["lat0"]) / g["dlat"])  # row centred on 40N
        assert abs(t2m[0, i].mean() - 14.0) < 0.01, t2m[0, i].mean()  # 10 + 0.1*40, kelvin converted
        assert np.allclose(read_var(out, cat["wind250"]), 5.0, atol=1e-3)
        assert np.allclose(read_var(out, cat["precip"]), 1.0, atol=1e-3)  # mm/day

        ice = read_var(out, cat["seaice"])
        gi = cat["seaice"]["grid"]
        la = gi["lat0"] + gi["dlat"] * np.arange(gi["nlat"])
        lo = gi["lon0"] + gi["dlon"] * np.arange(gi["nlon"])
        land = (la[:, None] > 61) & (la[:, None] < 69) & (lo > 1) & (lo < 89)
        assert np.isnan(ice[0][land]).all(), "land must be missing in seaice, never 0"
        assert np.nanmax(ice) <= 1 and ice[0, -1, 0] > 0.99 and ice[0, 5, 0] == 0

        soil = read_var(out, cat["soilwet"])
        i, j = int((64 + 90) / 2), int((45 + 180) / 2.5)  # global cell at 64N 45E, inside the land block
        assert np.isnan(soil[0, 0, 0]) and abs(soil[0, i, j] - 0.4) < 1e-3, "ocean missing in land vars"
    print("test_build: all checks passed")


if __name__ == "__main__":
    main()
