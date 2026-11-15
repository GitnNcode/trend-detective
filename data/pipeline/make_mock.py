"""Mock t2m, wind250 and seaice in the exact contract format -> data/mock/.

Smooth climatology + seasonal cycle + region-dependent trend + noise.
Built-in signals other lanes can test against:
  t2m      Arctic (>60N) warms 0.6 C/decade, rest 0.2 C/decade,
           North Atlantic "warming hole" (45-60N, 50-20W) cools 0.1 C/decade.
  wind250  NH jet core moves poleward 0.3 deg/decade, SH jet steady.
  seaice   ice edge retreats north 1.0 deg/decade in September, 0.3 in March.
           Land cells are missing (crude boxes for Eurasia, N America, Greenland).

Run: python data/pipeline/make_mock.py
"""
from pathlib import Path

import numpy as np

from fmt import GLOBAL_GRID, SEAICE_GRID, START, lats, lons, months, write_catalog, write_var

NT = 552  # 1980-01 .. 2025-12
OUT = Path(__file__).resolve().parents[1] / "mock"
rng = np.random.default_rng(42)

years, mons = months(START, NT)
yr = (years - 1980 + (mons - 0.5) / 12)[:, None, None]  # fractional years since 1980
phase = (2 * np.pi * (mons - 1) / 12)[:, None, None]    # 0 in January


def t2m():
    la, lo = np.meshgrid(lats(GLOBAL_GRID), lons(GLOBAL_GRID), indexing="ij")
    clim = 27 - 50 * np.sin(np.radians(la)) ** 2
    # seasonal cycle: cold in Jan north, cold in Jul south, bigger toward poles
    seas = -np.sign(la) * (2 + 18 * np.abs(np.sin(np.radians(la)))) * np.cos(phase)
    trend = np.where(la > 60, 0.06, 0.02)
    hole = (la >= 45) & (la <= 60) & (lo >= -50) & (lo <= -20)
    trend = np.where(hole, -0.01, trend)
    noise = rng.normal(0, 0.8, (NT, *la.shape)) + rng.normal(0, 0.15, (NT, 1, 1))
    return clim + seas + trend * yr + noise


def wind250():
    la, lo = np.meshgrid(lats(GLOBAL_GRID), lons(GLOBAL_GRID), indexing="ij")
    winter = np.cos(phase)  # +1 in NH winter
    nh_core = 40 - 5 * winter + 0.03 * yr
    nh_speed = 25 + 10 * winter
    sh_core = -45 + 3 * winter
    sh_speed = 25 - 5 * winter
    wave = 1 + 0.25 * np.cos(np.radians(2 * lo + 60))  # stationary-wave-ish zonal variation
    w = (nh_speed * np.exp(-((la - nh_core) / 8) ** 2) + sh_speed * np.exp(-((la - sh_core) / 8) ** 2)) * wave
    w = w + 5 + rng.normal(0, 2.0, (NT, *la.shape))
    return np.clip(w, 0, None)


def seaice():
    la, lo = np.meshgrid(lats(SEAICE_GRID), lons(SEAICE_GRID), indexing="ij")
    seas = np.cos(phase - 2 * np.pi * 2 / 12)  # +1 in March (max ice), -1 in September
    edge = 72 - 8 * seas - 5 * np.cos(np.radians(lo - 20))  # Atlantic side ice-free further north
    retreat = (0.065 - 0.035 * seas) * yr  # ~1.0 deg/decade in Sept, ~0.3 in March
    edge = edge + retreat + rng.normal(0, 0.8, (NT, 1, lo.shape[1]))
    ice = np.clip((la - edge) / 3, 0, 1) * 0.97 + rng.normal(0, 0.02, (NT, *la.shape))
    ice = np.clip(ice, 0, 1)
    land = (
        ((lo >= 30) & (lo <= 180) & (la <= 68))         # northern Eurasia
        | ((lo >= 5) & (lo < 30) & (la >= 58) & (la <= 70))  # Scandinavia
        | ((lo >= -170) & (lo <= -55) & (la <= 68))     # northern N America
        | ((lo >= -55) & (lo <= -20) & (la >= 60) & (la <= 83))  # Greenland
    )
    ice[:, land] = np.nan
    return ice


if __name__ == "__main__":
    note = "MOCK (synthetic, not NASA data): "
    entries = [
        write_var(OUT, "t2m", t2m(), GLOBAL_GRID, "°C", note + "MERRA-2 M2TMNXSLV, variable T2M",
                  {"min": None, "max": 0}),
        write_var(OUT, "wind250", wind250(), GLOBAL_GRID, "m/s", note + "MERRA-2 M2TMNXSLV, U250 and V250",
                  {"min": 30, "max": None}),
        write_var(OUT, "seaice", seaice(), SEAICE_GRID, "0 to 1", note + "MERRA-2 M2TMNXFLX, variable FRSEAICE",
                  {"min": None, "max": 0.15}),
    ]
    write_catalog(OUT, entries)
    print(f"wrote {len(entries)} mock variables to {OUT}")
