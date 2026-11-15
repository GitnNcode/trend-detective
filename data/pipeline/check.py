"""Reload every .bin in a data dir and print area-weighted mean per year.

Run: python data/pipeline/check.py            (real data in data/)
     python data/pipeline/check.py data/mock  (mock)
Fails loudly on wrong file size, all-missing slices or out-of-range values.
"""
import json
import sys
from pathlib import Path

import numpy as np

from fmt import lats, months, read_var

# loose physical bounds on monthly-mean cell values, in stored units
# (precip: monsoon coasts reach ~70 mm/day on our grid; 150 catches only broken data)
BOUNDS = {
    "t2m": (-80, 50), "t500": (-60, 5), "wind250": (0, 120), "tqv": (0, 80),
    "precip": (0, 150), "evap": (-2, 20), "seaice": (0, 1.001), "soilwet": (0, 1.001),
    "snow": (0, 1e6), "runoff": (0, 200),
}


def check(datadir):
    datadir = Path(datadir)
    ok = True
    for e in json.loads((datadir / "catalog.json").read_text())["variables"]:
        g = e["grid"]
        size = (datadir / e["file"]).stat().st_size
        want = e["nt"] * g["nlat"] * g["nlon"] * 2
        if size != want:
            print(f"FAIL {e['id']}: {size} bytes, expected {want}")
            ok = False
            continue
        v = read_var(datadir, e)
        lo, hi = np.nanmin(v), np.nanmax(v)
        bad_t = int(np.all(np.isnan(v), axis=(1, 2)).sum())
        miss = np.isnan(v).mean()
        b = BOUNDS.get(e["id"])
        flag = ""
        if b and (lo < b[0] or hi > b[1]):
            flag += f"  OUT OF RANGE {b}"
        if bad_t:
            flag += f"  {bad_t} ALL-MISSING MONTHS"
        ok &= not flag
        print(f"\n{e['id']} [{e['units']}] nt={e['nt']} grid={g['nlat']}x{g['nlon']} "
              f"min={lo:.4g} max={hi:.4g} missing={miss:.1%}{flag}")

        w = np.cos(np.radians(lats(g)))[None, :, None] * ~np.isnan(v)
        monthly = np.nansum(v * w, axis=(1, 2)) / w.sum(axis=(1, 2))
        years, _ = months(e["start"], e["nt"])
        full = [y for y in np.unique(years) if (years == y).sum() == 12]
        annual = np.array([monthly[years == y].mean() for y in full])
        for y, a in zip(full, annual):
            print(f"  {y} {a:.4g}")
        slope = np.polyfit(full, annual, 1)[0]
        print(f"  trend of area mean: {slope * 10:+.4g} {e['units']}/decade")
    return ok


if __name__ == "__main__":
    sys.exit(0 if check(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]) else 1)
