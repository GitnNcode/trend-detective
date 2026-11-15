"""raw/ MERRA-2 monthly fields -> data/<id>.bin + data/catalog.json.

Per month: read native 0.5 x 0.625 field, derive the variable, convert units,
area-weight average onto the variable's grid (a target cell takes every native
cell whose centre falls inside it; NaN skipped; the cell is missing when under
half its area has data), then pack to Int16 (fmt.pack).

Missing rules from the contract: land is missing in seaice (native cells with
FROCEAN < 0.5), ocean is missing in land variables (MERRA-2 leaves LND fields
undefined there already).

Run: python data/pipeline/build.py                (every variable with raw data)
     python data/pipeline/build.py t2m seaice     (just these)
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import xarray as xr

from fmt import CONST, VARIABLES, lats, lons, write_catalog, write_var

HERE = Path(__file__).resolve().parent
SOURCE = {
    "t2m": "T2M", "t500": "T500", "wind250": "speed from monthly-mean U250 and V250",
    "tqv": "TQV", "precip": "PRECTOTCORR", "evap": "EVAP", "seaice": "FRSEAICE / FROCEAN, land masked",
    "soilwet": "GWETROOT", "snow": "SNOMAS", "runoff": "RUNOFF",
    "u250": "U250 (eastward wind)", "v250": "V250 (northward wind)", "aod": "TOTEXTTAU (total aerosol extinction AOT, 550 nm)",
}


def read_field(raw, sn, field, key):
    with xr.open_dataset(raw / sn / field / f"{key}.nc4") as ds:
        da = ds[field].squeeze(drop=True)  # drop the length-1 time axis
        da = da.sortby("lat").sortby("lon")
        return da.lat.values, da.lon.values, da.values.astype(np.float64)


def native_area(nlat_vals):
    """Relative area of native rows, exact at the poles (where cos(lat) is 0)."""
    d = np.radians(np.abs(np.diff(nlat_vals)).mean() / 2)
    r = np.radians(nlat_vals)
    return np.abs(np.sin(np.clip(r + d, -np.pi / 2, np.pi / 2)) - np.sin(np.clip(r - d, -np.pi / 2, np.pi / 2)))


class Coarsener:
    """Precomputed native->target cell mapping; call it on one 2D field."""

    def __init__(self, nlat_vals, nlon_vals, grid):
        # Each native cell is split into 4 quarters, each assigned to the target cell
        # holding its centre. MERRA-2 native centres sit exactly on target edges, so
        # this shares edge cells evenly instead of skewing every cell half a step.
        qlat = np.abs(np.diff(nlat_vals)).mean() / 4
        qlon = np.abs(np.diff(nlon_vals)).mean() / 4
        area = native_area(nlat_vals)[:, None] * np.ones(len(nlon_vals))
        idx, w, src = [], [], []
        flat = np.arange(area.size).reshape(area.shape)
        for dy in (-qlat, qlat):
            ii = np.floor((nlat_vals + dy - grid["lat0"]) / grid["dlat"] + 0.5).astype(int)
            for dx in (-qlon, qlon):
                jj = np.floor(((nlon_vals + dx - grid["lon0"]) % 360) / grid["dlon"] + 0.5).astype(int) % grid["nlon"]
                inside = np.broadcast_to(((ii >= 0) & (ii < grid["nlat"]))[:, None], area.shape)
                idx.append((ii[:, None] * grid["nlon"] + jj[None, :])[inside])
                w.append(area[inside] / 4)
                src.append(flat[inside])
        self.idx, self.w, self.src = np.concatenate(idx), np.concatenate(w), np.concatenate(src)
        self.n = grid["nlat"] * grid["nlon"]
        self.shape = (grid["nlat"], grid["nlon"])
        self.total = np.bincount(self.idx, self.w, self.n)

    def __call__(self, f):
        f = f.ravel()[self.src]
        ok = np.isfinite(f)
        wv = self.w * ok
        s = np.bincount(self.idx, np.where(ok, f, 0) * wv, self.n)
        ws = np.bincount(self.idx, wv, self.n)
        out = np.full(self.n, np.nan)
        good = ws >= 0.5 * self.total
        out[good] = s[good] / ws[good]
        return out.reshape(self.shape)


def ocean_fraction(raw):
    """FROCEAN on the native grid, or None if not fetched."""
    sn, (field,) = CONST
    files = sorted((raw / sn / field).glob("*.nc4")) if (raw / sn / field).exists() else []
    return read_field(raw, sn, field, files[0].stem)[2] if files else None


def derive(vid, f, frocean, tile_fraction):
    if vid in ("t2m", "t500"):
        return f[0] - 273.15
    if vid == "wind250":
        return np.hypot(f[0], f[1])  # ponytail: speed of the monthly-mean wind, not mean speed (no daily data)
    if vid in ("precip", "evap", "runoff"):
        return f[0] * 86400.0  # kg m-2 s-1 == mm/s -> mm/day
    if vid == "seaice":
        ice = f[0] if tile_fraction else f[0] / np.maximum(frocean, 1e-6)
        return np.where(frocean >= 0.5, np.clip(ice, 0, 1), np.nan)
    return f[0]


def build(vid, raw, out):
    sn, fields, units, grid, band = VARIABLES[vid]
    keys = [sorted(p.stem for p in (raw / sn / fl).glob("*.nc4")) if (raw / sn / fl).exists() else []
            for fl in fields]
    common = sorted(set.intersection(*map(set, keys)))
    if not common or common[0] != "198001":
        print(f"skip {vid}: no raw data starting 1980-01 under {raw / sn}")
        return None
    # contract: no gaps. Keep the run of consecutive months from 1980-01.
    run = []
    for k in common:
        want = 1980 * 12 + len(run)
        if int(k[:4]) * 12 + int(k[4:]) - 1 != want:
            print(f"  {vid}: gap before {k}, stopping at {run[-1]}")
            break
        run.append(k)

    frocean, tile_fraction = None, False
    if vid == "seaice":
        frocean = ocean_fraction(raw)
        if frocean is None:
            sys.exit("seaice needs FROCEAN: run fetch.py seaice")
        # The spec says FRSEAICE is "ice covered fraction of tile". If it ever exceeds
        # the ocean fraction it is per ocean tile already; otherwise it is per grid box.
        f0 = read_field(raw, sn, fields[0], run[len(run) // 2])[2]
        coastal = (frocean > 0.5) & (frocean < 0.9)
        tile_fraction = bool(np.any(f0[coastal] > frocean[coastal] + 0.01))
        print(f"  seaice: FRSEAICE is per {'ocean tile' if tile_fraction else 'grid box'}")

    la, lo, _ = read_field(raw, sn, fields[0], run[0])
    coarsen = Coarsener(la, lo, grid)
    vals = np.empty((len(run), grid["nlat"], grid["nlon"]))
    for t, k in enumerate(run):
        f = [read_field(raw, sn, fl, k)[2] for fl in fields]
        vals[t] = coarsen(derive(vid, f, frocean, tile_fraction))
    entry = write_var(out, vid, vals, grid, units,
                      f"MERRA-2 {sn}, {SOURCE[vid]}", band)
    print(f"built {vid}: {len(run)} months {run[0]}..{run[-1]}")
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vars", nargs="*", default=list(VARIABLES))
    ap.add_argument("--raw", type=Path, default=HERE / "raw")
    ap.add_argument("--out", type=Path, default=HERE.parent)
    a = ap.parse_args()
    entries = [e for v in a.vars if (e := build(v, a.raw, a.out))]
    if entries:
        write_catalog(a.out, entries)


if __name__ == "__main__":
    main()
