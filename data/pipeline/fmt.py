"""Contract file format: Int16 little-endian [nt, nlat, nlon], missing = -32768.

Shared by make_mock.py, build.py and check.py so the format lives in one place.
"""
import json
from pathlib import Path

import numpy as np

MISSING = -32768
START = "1980-01"

GLOBAL_GRID = {"nlat": 91, "nlon": 144, "lat0": -90.0, "lon0": -180.0, "dlat": 2.0, "dlon": 2.5}
SEAICE_GRID = {"nlat": 41, "nlon": 288, "lat0": 50.0, "lon0": -180.0, "dlat": 1.0, "dlon": 1.25}


# id -> (collection, fields, units, grid, defaultBand). Names checked against the
# MERRA-2 File Specification (GMAO Office Note 9). Fluxes are kg m-2 s-1 natively.
VARIABLES = {
    "t2m":     ("M2TMNXSLV", ["T2M"], "°C", GLOBAL_GRID, {"min": None, "max": 0}),
    "wind250": ("M2TMNXSLV", ["U250", "V250"], "m/s", GLOBAL_GRID, {"min": 30, "max": None}),
    "seaice":  ("M2TMNXFLX", ["FRSEAICE"], "0 to 1", SEAICE_GRID, {"min": None, "max": 0.15}),
    "precip":  ("M2TMNXFLX", ["PRECTOTCORR"], "mm/day", GLOBAL_GRID, {"min": 5, "max": None}),
    "t500":    ("M2TMNXSLV", ["T500"], "°C", GLOBAL_GRID, {"min": None, "max": -20}),
    "tqv":     ("M2TMNXSLV", ["TQV"], "kg/m²", GLOBAL_GRID, {"min": 40, "max": None}),
    "evap":    ("M2TMNXFLX", ["EVAP"], "mm/day", GLOBAL_GRID, {"min": 3, "max": None}),
    "soilwet": ("M2TMNXLND", ["GWETROOT"], "0 to 1", GLOBAL_GRID, {"min": None, "max": 0.3}),
    "snow":    ("M2TMNXLND", ["SNOMAS"], "kg/m²", GLOBAL_GRID, {"min": 10, "max": None}),
    "runoff":  ("M2TMNXLND", ["RUNOFF"], "mm/day", GLOBAL_GRID, {"min": 1, "max": None}),
    # Added for the app's wind-vector loop and the "city air" regions.
    "u250":    ("M2TMNXSLV", ["U250"], "m/s", GLOBAL_GRID, {"min": 20, "max": None}),
    "v250":    ("M2TMNXSLV", ["V250"], "m/s", GLOBAL_GRID, {"min": 5, "max": None}),
    "aod":     ("M2TMNXAER", ["TOTEXTTAU"], "AOD", GLOBAL_GRID, {"min": 0.3, "max": None}),
    # Height of the 0 °C level (m above sea level), from T2M, T500, H500 and surface height.
    "fzlev":   ("M2TMNXSLV", ["T2M", "T500", "H500"], "m", GLOBAL_GRID, {"min": 4000, "max": None}),
}
CONST = ("M2C0NXASM", ["FROCEAN", "PHIS"])  # ocean fraction (masks land out of seaice); surface geopotential (fzlev)


def lats(grid):
    return grid["lat0"] + grid["dlat"] * np.arange(grid["nlat"])


def lons(grid):
    return grid["lon0"] + grid["dlon"] * np.arange(grid["nlon"])


def months(start, nt):
    y, m = map(int, start.split("-"))
    k = (y * 12 + m - 1) + np.arange(nt)
    return k // 12, k % 12 + 1  # years, months (1..12)


def pack(values):
    """float array with NaN for missing -> (int16 array, scale, offset).

    Scale spans the actual range over 65000 steps, so every variable keeps
    4+ significant digits regardless of units.
    """
    finite = values[np.isfinite(values)]
    lo, hi = float(finite.min()), float(finite.max())
    scale = float(f"{max((hi - lo) / 65000, 1e-9):.6g}")
    offset = scale * round((hi + lo) / 2 / scale)  # a whole number of steps, so 0 packs exactly
    q = np.round((values - offset) / scale)
    q = np.where(np.isfinite(q), q, MISSING).astype("<i2")
    return q, scale, offset


def unpack(q, scale, offset):
    v = q.astype(np.float64) * scale + offset
    v[q == MISSING] = np.nan
    return v


def write_var(outdir, vid, values, grid, units, source, default_band, start=START):
    """Write <vid>.bin and return its catalog entry. values: float [nt, nlat, nlon], NaN = missing."""
    assert values.shape[1:] == (grid["nlat"], grid["nlon"]), values.shape
    q, scale, offset = pack(values)
    Path(outdir).mkdir(parents=True, exist_ok=True)
    q.tofile(Path(outdir) / f"{vid}.bin")
    return {
        "id": vid,
        "file": f"{vid}.bin",
        "source": source,
        "units": units,
        "start": start,
        "nt": int(values.shape[0]),
        "grid": grid,
        "scale": scale,
        "offset": offset,
        "defaultBand": default_band,
    }


def write_catalog(outdir, entries):
    """Merge entries into <outdir>/catalog.json by id, keeping any variables already there."""
    path = Path(outdir) / "catalog.json"
    old = json.loads(path.read_text())["variables"] if path.exists() else []
    by_id = {e["id"]: e for e in old}
    by_id.update({e["id"]: e for e in entries})
    order = ["t2m", "t500", "wind250", "tqv", "precip", "evap", "seaice", "soilwet", "snow", "runoff", "aod", "fzlev", "u250", "v250"]
    out = sorted(by_id.values(), key=lambda e: order.index(e["id"]) if e["id"] in order else 99)
    path.write_text(json.dumps({"variables": out}, indent=2, ensure_ascii=False) + "\n")


def read_var(datadir, entry):
    g = entry["grid"]
    q = np.fromfile(Path(datadir) / entry["file"], dtype="<i2")
    q = q.reshape(entry["nt"], g["nlat"], g["nlon"])
    return unpack(q, entry["scale"], entry["offset"])
