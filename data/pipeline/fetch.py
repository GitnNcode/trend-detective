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
    """{YYYYMM: (cloud opendap url, data url)}; a reprocessed stream (e.g. MERRA2_401) wins over the original."""
    temporal = None if short_name == CONST[0] else (start, end)
    out = {}
    for g in sorted(earthaccess.search_data(short_name=short_name, temporal=temporal),
                    key=lambda g: g["umm"]["GranuleUR"]):
        urls = [u["URL"] for u in g["umm"].get("RelatedUrls", [])]
        dap = next((u for u in urls if "opendap.earthdata.nasa.gov" in u), None)
        data = next((u for u in urls if u.endswith(".nc4") and "/data/" in u), None)
        m = re.search(r"\.(\d{6}|00000000)\.nc4$", g["umm"]["GranuleUR"])
        if m:
            out[m.group(1)[:6]] = (dap, data)
    return out


def fetch_one(session, key, urls, fields, dest):
    if dest.exists():
        return "skip"
    dap, data = urls
    attempts = []
    if dap:  # cloud Hyrax, DAP4
        attempts.append((dap + ".dap.nc4", {"dap4.ce": ";".join(f"/{f}" for f in fields + ["lat", "lon"])}))
    if data:  # GES DISC on-prem Hyrax, DAP2 netCDF4 response
        onprem = re.sub(r"^https://data\.gesdisc\.earthdata\.nasa\.gov/data/",
                        "https://goldsmr4.gesdisc.eosdis.nasa.gov/opendap/", data)
        attempts.append((onprem + ".nc4?" + ",".join(fields + ["lat", "lon"]), None))
    errors = []
    tmp = dest.with_suffix(".part")
    for url, params in attempts:
        try:
            r = session.get(url, params=params, timeout=300)
            r.raise_for_status()
            tmp.write_bytes(r.content)
            with xr.open_dataset(tmp) as ds:
                missing = [f for f in fields if f not in ds]
            if missing:
                raise ValueError(f"response lacks {missing}")
            tmp.rename(dest)
            return "ok"
        except Exception as e:  # try the next server, report all failures at the end
            errors.append(f"{url[:90]}: {e}")
            tmp.unlink(missing_ok=True)
    raise RuntimeError(f"{key}: " + " | ".join(errors))


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
