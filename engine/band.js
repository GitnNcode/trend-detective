// Shift mode: follow a fixed-value band (for example "air below 0 °C" or
// "wind above 30 m/s") across the map year by year, and say whether it is
// shifting, expanding, or contracting. Pure, no DOM.

import { annualFields } from "./fields.js";
import { regionCells, rowAreasKm2, latOf, lonOf, lonInRange, KM_PER_DEG_LAT } from "./grid.js";
import { linearTrend, mannKendall, significanceLevel, fmt, fmtP, MIN_YEARS } from "./stats.js";

// bandTrack(v, { min, max, months, region, hemisphere })
//
// A cell is in the band for a year when its annual (or seasonal) mean is
// >= min and <= max; a null or missing bound is open. Cells outside `region`
// are never in the band.
//
// Edges. Each longitude column is scanned from the equator side to the pole
// side within one hemisphere (`hemisphere` "N" or "S"; by default "S" only if
// the region lies wholly south of the equator). Missing cells are skipped.
// The longest unbroken run of in-band cells in that column is the band there.
// Its equatorward edge is where that run meets an out-of-band cell on the
// equator side, its poleward edge where it meets one on the pole side. An end
// of the run that reaches the edge of the region or grid is not an edge and
// is NaN. The edge latitude is interpolated linearly to where the field
// crosses the threshold between the two cells, so it moves smoothly rather
// than in whole grid steps.
//
// edgeLat (the contract field) is the edge that faces out of the band:
//   - the band sits on the pole side (cold air below 0 °C, sea ice above 15%):
//     edgeLat is the most equatorward in-band latitude, the equatorward edge
//   - the band sits on the equator side (open water below 15% ice):
//     edgeLat is the most poleward in-band latitude, the poleward edge
//   - the band is a strip with both edges (a jet core): edgeLat is the
//     poleward edge, and bandSummary uses both edges
// Which case applies is decided from the data: whichever edge is found more
// often over all years and columns, or "strip" when both are found in
// comparable numbers. `edgeKind` and `bandShape` report the choice.
export function bandTrack(v, opts = {}) {
  const { min = null, max = null, months, region = null } = opts;
  const grid = v.entry.grid;
  const { nlat, nlon } = grid;
  const { years, fields, ncell } = annualFields(v, months);
  const ny = years.length;

  const inRegion = new Uint8Array(ncell);
  for (const c of regionCells(grid, region).cells) inRegion[c] = 1;
  const areas = rowAreasKm2(grid);
  const lo = min ?? -Infinity, hi = max ?? Infinity;
  const inBand = (val) => val === val && val >= lo && val <= hi;

  const hemisphere = opts.hemisphere ?? defaultHemisphere(grid, region);
  const hemSign = hemisphere === "S" ? -1 : 1;

  // Rows to scan, ordered from the equator side to the pole side.
  const latMin = region ? Math.min(region.latMin, region.latMax) : -90;
  const latMax = region ? Math.max(region.latMin, region.latMax) : 90;
  const scanRows = [];
  for (let i = 0; i < nlat; i++) {
    const lat = latOf(grid, i);
    if (lat < latMin - 1e-9 || lat > latMax + 1e-9) continue;
    if (hemisphere === "N" ? lat < 0 : lat > 0) continue;
    scanRows.push(i);
  }
  if (hemisphere === "S") scanRows.reverse();
  const activeCol = new Uint8Array(nlon);
  for (let j = 0; j < nlon; j++) {
    activeCol[j] = !region || lonInRange(lonOf(grid, j), region.lonMin, region.lonMax) ? 1 : 0;
  }

  const areaKm2 = new Array(ny);
  const centroidLat = new Array(ny);
  const centroidLon = new Array(ny);
  const eqEdge = new Array(ny);
  const poEdge = new Array(ny);
  let nEq = 0, nPo = 0;

  const rad = Math.PI / 180;
  const colLat = new Float64Array(scanRows.length);
  const colVal = new Float64Array(scanRows.length);

  const crossing = (inLat, inVal, outLat, outVal) => {
    const th = outVal > hi ? hi : lo;
    let f = (th - inVal) / (outVal - inVal);
    if (!(f >= 0)) f = 0; else if (f > 1) f = 1;
    return inLat + f * (outLat - inLat);
  };

  for (let y = 0; y < ny; y++) {
    const base = y * ncell;
    let area = 0, sLat = 0, sx = 0, sy = 0;
    for (let i = 0; i < nlat; i++) {
      const lat = latOf(grid, i), a = areas[i];
      for (let j = 0; j < nlon; j++) {
        const c = i * nlon + j;
        if (!inRegion[c] || !inBand(fields[base + c])) continue;
        area += a;
        sLat += a * lat;
        const lon = lonOf(grid, j) * rad;
        sx += a * Math.cos(lon);
        sy += a * Math.sin(lon);
      }
    }
    areaKm2[y] = area;
    centroidLat[y] = area > 0 ? sLat / area : NaN;
    centroidLon[y] = area > 0 ? Math.atan2(sy, sx) / rad : NaN;

    const eq = new Array(nlon).fill(NaN);
    const po = new Array(nlon).fill(NaN);
    for (let j = 0; j < nlon; j++) {
      if (!activeCol[j]) continue;
      let m = 0;
      for (const i of scanRows) {
        const val = fields[base + i * nlon + j];
        if (val !== val) continue;
        colLat[m] = latOf(grid, i);
        colVal[m] = val;
        m++;
      }
      // Longest run of in-band cells.
      let bestStart = -1, bestLen = 0;
      for (let k = 0; k < m;) {
        if (!inBand(colVal[k])) { k++; continue; }
        let e = k;
        while (e + 1 < m && inBand(colVal[e + 1])) e++;
        if (e - k + 1 > bestLen) { bestLen = e - k + 1; bestStart = k; }
        k = e + 1;
      }
      if (bestLen === 0) continue;
      const s = bestStart, e = bestStart + bestLen - 1;
      if (s > 0) { eq[j] = crossing(colLat[s], colVal[s], colLat[s - 1], colVal[s - 1]); nEq++; }
      if (e < m - 1) { po[j] = crossing(colLat[e], colVal[e], colLat[e + 1], colVal[e + 1]); nPo++; }
    }
    eqEdge[y] = eq;
    poEdge[y] = po;
  }

  let bandShape, edgeKind, edgeLat;
  if (nEq === 0 && nPo === 0) {
    bandShape = "none"; edgeKind = "none"; edgeLat = poEdge;
  } else if (Math.min(nEq, nPo) >= 0.5 * Math.max(nEq, nPo)) {
    bandShape = "strip"; edgeKind = "poleward"; edgeLat = poEdge;
  } else if (nEq > nPo) {
    bandShape = "poleward"; edgeKind = "equatorward"; edgeLat = eqEdge;
  } else {
    bandShape = "equatorward"; edgeKind = "poleward"; edgeLat = poEdge;
  }

  const maskCache = new Map();
  function mask(yearIndex) {
    if (maskCache.has(yearIndex)) return maskCache.get(yearIndex);
    const out = new Uint8Array(ncell);
    if (yearIndex >= 0 && yearIndex < ny) {
      const base = yearIndex * ncell;
      for (let c = 0; c < ncell; c++) out[c] = inRegion[c] && inBand(fields[base + c]) ? 1 : 0;
    }
    maskCache.set(yearIndex, out);
    return out;
  }

  return {
    years,
    areaKm2,
    centroidLat,
    centroidLon,
    edgeLat,
    mask,
    // Extras beyond the contract.
    equatorwardEdgeLat: eqEdge,
    polewardEdgeLat: poEdge,
    edgeKind,
    bandShape,
    hemisphere,
    hemSign,
    min,
    max,
    units: v.entry.units ?? "",
  };
}

function defaultHemisphere(grid, region) {
  if (region) return Math.max(region.latMin, region.latMax) <= 0 ? "S" : "N";
  const top = latOf(grid, grid.nlat - 1);
  return top <= 0 ? "S" : "N";
}

// Mean anomaly across longitude columns for each year. Columns with an edge
// in fewer than 70% of years are dropped, and each column's own mean is
// removed first, so columns dropping in and out do not fake a shift.
// Returns { values: Float64Array (degrees), meanLat, nColumns }.
export function edgeSeries(edges, minShare = 0.7) {
  const ny = edges.length;
  const nlon = ny ? edges[0].length : 0;
  const keep = [];
  const colMean = new Float64Array(nlon);
  for (let j = 0; j < nlon; j++) {
    let n = 0, s = 0;
    for (let y = 0; y < ny; y++) {
      const e = edges[y][j];
      if (e === e) { n++; s += e; }
    }
    if (n >= Math.max(MIN_YEARS, minShare * ny)) { keep.push(j); colMean[j] = s / n; }
  }
  const values = new Float64Array(ny);
  let meanLat = 0;
  for (const j of keep) meanLat += colMean[j];
  meanLat = keep.length ? meanLat / keep.length : NaN;
  for (let y = 0; y < ny; y++) {
    let n = 0, s = 0;
    for (const j of keep) {
      const e = edges[y][j];
      if (e === e) { n++; s += e - colMean[j]; }
    }
    values[y] = n ? s / n : NaN;
  }
  return { values, meanLat, nColumns: keep.length };
}

function combine(a, b, f) {
  return a.map((row, y) => row.map((x, j) => {
    const z = b[y][j];
    return x === x && z === z ? f(x, z) : NaN;
  }));
}

function trendOf(years, values) {
  const annual = { years, values };
  const t = linearTrend(annual);
  const mk = mannKendall(annual);
  return { slope: t.slope, p: t.p, pMK: mk.pAutocorr, level: significanceLevel(t.p, mk.pAutocorr), n: t.n };
}

function fmtArea(km2) {
  const a = Math.abs(km2);
  if (a >= 1e6) return `${fmt(a / 1e6)} million km²`;
  if (a >= 1e3) return `${fmt(a / 1e3)} thousand km²`;
  return `${fmt(a)} km²`;
}

// bandSummary(track)
//
//   areaTrend              band area change, km² per decade
//   areaPctPerDecade       the same as a percentage of the mean area
//   edgeShiftKmPerDecade   movement of the band, km per decade, positive
//                          means poleward. For a strip it is the movement of
//                          the band's centre line; otherwise of edgeLat.
//   edgeP                  t-test p for that movement
//   kind
//     strip:       width change significant  -> expansion / contraction
//                  else centre line moving    -> shift
//     single edge: area change significant    -> expansion / contraction
//                  else edge moving           -> shift
//     otherwise "none". "Significant" uses the same two-test rule as verdict.
export function bandSummary(track) {
  const years = track.years;
  const ny = years.length;
  const hemSign = track.hemSign ?? 1;
  const poleWord = hemSign > 0 ? "poleward (north)" : "poleward (south)";
  const eqWord = hemSign > 0 ? "toward the equator (south)" : "toward the equator (north)";
  const kmPerDecade = (degPerYear) => degPerYear * KM_PER_DEG_LAT * 10 * hemSign;

  const out = {
    areaTrend: NaN,
    edgeShiftKmPerDecade: NaN,
    edgeP: NaN,
    kind: "none",
    sentence: "",
    level: "none",
    areaPctPerDecade: NaN,
    areaP: NaN,
    widthChangeKmPerDecade: NaN,
    edgeMeanLat: new Array(ny).fill(NaN),
  };

  const meanArea = track.areaKm2.reduce((s, a) => s + a, 0) / Math.max(1, ny);
  if (ny < MIN_YEARS) {
    out.sentence = `There are not enough years with data to follow this band (found ${ny}, need at least ${MIN_YEARS}).`;
    return out;
  }
  if (!(meanArea > 0)) {
    out.sentence = "No part of the map falls inside this band in any year. Try a different threshold or region.";
    return out;
  }

  const area = trendOf(years, Float64Array.from(track.areaKm2));
  out.areaTrend = area.slope * 10;
  out.areaPctPerDecade = (area.slope * 10 * 100) / meanArea;
  out.areaP = area.p;

  const strip = track.bandShape === "strip";
  let move, width = null;
  let series;
  if (strip) {
    const center = combine(track.polewardEdgeLat, track.equatorwardEdgeLat, (p, e) => (p + e) / 2);
    const widths = combine(track.polewardEdgeLat, track.equatorwardEdgeLat, (p, e) => (p - e) * hemSign);
    series = edgeSeries(center);
    move = trendOf(years, series.values);
    const ws = edgeSeries(widths);
    width = trendOf(years, ws.values);
    out.widthChangeKmPerDecade = width.slope * KM_PER_DEG_LAT * 10;
  } else {
    series = edgeSeries(track.edgeLat);
    move = trendOf(years, series.values);
  }
  out.edgeShiftKmPerDecade = kmPerDecade(move.slope);
  out.edgeP = move.p;
  out.edgeMeanLat = Array.from(series.values, (d) => series.meanLat + d);
  out.edgeColumns = series.nColumns;

  const shiftKm = out.edgeShiftKmPerDecade;
  const shiftText = Number.isFinite(shiftKm)
    ? `${shiftKm >= 0 ? poleWord : eqWord} by about ${fmt(Math.abs(shiftKm))} km per decade`
    : "";
  const areaText = `${fmt(Math.abs(out.areaPctPerDecade))}% (${fmtArea(out.areaTrend)}) per decade`;
  const ps = (r) => `t-test ${fmtP(r.p)}, Mann-Kendall ${fmtP(r.pMK)}`;

  if (strip && width.level === "significant") {
    const grow = width.slope > 0;
    out.kind = grow ? "expansion" : "contraction";
    out.level = "significant";
    out.sentence = `The band is ${grow ? "widening" : "narrowing"} by about ` +
      `${fmt(Math.abs(out.widthChangeKmPerDecade))} km per decade (${ps(width)})` +
      (move.level === "significant" ? `, and its centre is moving ${shiftText}.` : ".");
  } else if (!strip && area.level === "significant") {
    const grow = area.slope > 0;
    out.kind = grow ? "expansion" : "contraction";
    out.level = "significant";
    out.sentence = `The band is ${grow ? "growing" : "shrinking"} by about ${areaText} (${ps(area)})` +
      (shiftText && move.level !== "none" ? `, and its edge is moving ${shiftText}.` : ".");
  } else if (move.level === "significant") {
    out.kind = "shift";
    out.level = "significant";
    out.sentence = `The band is shifting ${shiftText} (${ps(move)}), while its ` +
      `${strip ? "width" : "area"} stays about the same.`;
  } else {
    const hints = [];
    if (move.level === "suggestive" && shiftText) hints.push(`moving ${shiftText}`);
    if (strip && width.level === "suggestive") hints.push(`${width.slope > 0 ? "widening" : "narrowing"} by about ${fmt(Math.abs(out.widthChangeKmPerDecade))} km per decade`);
    if (!strip && area.level === "suggestive") hints.push(`${area.slope > 0 ? "growing" : "shrinking"} by about ${areaText}`);
    out.level = hints.length ? "suggestive" : "none";
    out.sentence = hints.length
      ? `There is a hint that the band is ${hints.join(" and ")}, but it is not strong enough to call a trend. A longer record may be needed.`
      : `No clear movement. The band's edge and size change only a little compared with the swings from year to year. A longer record may be needed.`;
  }
  return out;
}
