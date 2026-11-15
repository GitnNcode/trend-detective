"""Download only the MERRA-2 fields we need, one small file per month.

Uses OPeNDAP subsetting, so each month is ~1 MB per field instead of a
100+ MB granule. Output: data/pipeline/raw/<collection>/<FIELD>/<YYYYMM>.nc4
(gitignored). Re-running skips months already on disk.

Credentials: Earthdata login from ~/.netrc
  (machine urs.earthdata.nasa.gov login USER password PASS)
or EARTHDATA_USERNAME / EARTHDATA_PASSWORD env vars. Never committed.

Run: python data/pipeline/fetch.py                 (all variables)
     python data/pipeline/fetch.py t2m wind250      (just these)
     python data/pipeline/fetch.py t2m --end 1980-12  (quick test)
"""
import argparse
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import earthaccess
import xarray as xr

from fmt import CONST, VARIABLES

RAW = Path(__file__).resolve().parent / "raw"


def granules(short_name, start, end):
    """{YYYYMM: cloud OPeNDAP url}; a reprocessed stream (e.g. MERRA2_401) wins over the original."""
    temporal = None if short_name == CONST[0] else (start, end)
    out = {}
    for g in sorted(earthaccess.search_data(short_name=short_name, temporal=temporal),
                    key=lambda g: g["umm"]["GranuleUR"]):
        urls = [u["URL"] for u in g["umm"].get("RelatedUrls", [])]
        dap = next((u for u in urls if "opendap.earthdata.nasa.gov" in u), None)
        m = re.search(r"\.(\d{6}|00000000)\.nc4$", g["umm"]["GranuleUR"])
        if m and dap:
            out[m.group(1)[:6]] = dap
    return out


def fetch_one(session, key, dap, fields, dest):
    """One DAP4 subset from NASA's cloud OPeNDAP (the old goldsmr4 server is retired, 410 Gone)."""
    if dest.exists():
        return "skip"
    tmp = dest.with_suffix(".part")
    r = session.get(dap + ".dap.nc4", params={"dap4.ce": ";".join(f"/{f}" for f in fields + ["lat", "lon"])},
                    timeout=300)
    if r.status_code != 200:
        # a 403 here usually means the account has not accepted the GES DISC EULA
        raise RuntimeError(f"{key}: HTTP {r.status_code} {r.text[:200]}")
    tmp.write_bytes(r.content)
    try:
        with xr.open_dataset(tmp) as ds:
            missing = [f for f in fields if f not in ds]
        if missing:
            raise RuntimeError(f"{key}: response lacks {missing}")
        tmp.rename(dest)
    finally:
        tmp.unlink(missing_ok=True)
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vars", nargs="*", default=list(VARIABLES))
    ap.add_argument("--start", default="1980-01")
    ap.add_argument("--end", default="2026-12")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    need = {}  # collection -> fields
    for v in a.vars:
        need.setdefault(VARIABLES[v][0], set()).update(VARIABLES[v][1])
    if "seaice" in a.vars:
        need[CONST[0]] = set(CONST[1])

    earthaccess.login()  # env vars, then ~/.netrc, then an interactive prompt
    session = earthaccess.get_requests_https_session()
    failed = 0
    for sn, fields in need.items():
        found = granules(sn, a.start, a.end)
        print(f"{sn}: {len(found)} granules, fields {sorted(fields)}")
        for f in sorted(fields):  # one file per field, so fetching more variables later never goes stale
            outdir = RAW / sn / f
            outdir.mkdir(parents=True, exist_ok=True)
            with ThreadPoolExecutor(a.workers) as pool:
                jobs = {k: pool.submit(fetch_one, session, k, u, [f], outdir / f"{k}.nc4")
                        for k, u in found.items()}
                for k, j in sorted(jobs.items()):
                    try:
                        j.result()
                    except Exception as e:
                        failed += 1
                        print(f"  FAIL {f} {e}", file=sys.stderr)
            print(f"  {f}: {len(list(outdir.glob('*.nc4')))} months on disk")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
