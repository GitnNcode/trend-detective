// Trend Detective engine. Every function is pure and touches no DOM.
// See engine/README.md for conventions (grid layout, units, edge rules).
//
// Types
//   Region = { latMin, latMax, lonMin, lonMax }   lonMin > lonMax crosses the date line
//   Series = { t: string[] ("YYYY-MM"), values: Float64Array }
//   Annual = { years: number[], values: Float64Array }
//   Months = number[] (1..12), optional season filter; omit for all months
//
// Contract API
//   loadVariable(entry, baseUrl)            -> Promise<Var> { entry, data: Int16Array, value(t,i,j) }
//   regionSeries(v, region)                 -> Series, cos(lat) weighted mean, missing skipped
//   deseasonalize(series)                   -> Series, monthly climatology removed
//   annualMeans(series, months)             -> Annual
//   linearTrend(annual)                     -> { slope, intercept, ci95: [lo, hi], p, r2, n }  slope per year
//   mannKendall(annual)                     -> { tau, p, pAutocorr, senSlope, n, r1 }
//   verdict(trend, mk, units)               -> { level, sentence, perDecade, ci95PerDecade, pT, pMK, n, direction }
//   trendMap(v, months)                     -> { slope: Float32Array, p: Float32Array, years }  per cell, per year
//   bandTrack(v, { min, max, months, region, hemisphere })
//     -> { years, areaKm2, centroidLat, centroidLon, edgeLat, mask(yearIndex),
//          equatorwardEdgeLat, polewardEdgeLat, edgeKind, bandShape, hemisphere }
//   bandSummary(track)
//     -> { areaTrend (km² per decade), edgeShiftKmPerDecade (positive = poleward), edgeP,
//          kind: "shift" | "expansion" | "contraction" | "none", sentence, level,
//          areaPctPerDecade, areaP, widthChangeKmPerDecade, edgeMeanLat }
//   routeOpen(v, route, { max, greatCircle, months })
//     -> { years, openMonths, openMonthList, samples: [[lat, lon]], chokePointIndex, chokePoint, months }
//   sampleRoute(route, grid, { greatCircle }) -> [[lat, lon], ...]  the path routeOpen samples
//   bestPath(v, route, { max, months })
//     -> { years, lengthKm, bestMonth, paths: ([[lat, lon]] | null)[], fixedKm }  shortest open-water path each year

export { loadVariable, regionSeries } from "./grid.js";
export { deseasonalize, annualMeans, linearTrend, mannKendall, verdict } from "./stats.js";
export { trendMap } from "./fields.js";
export { bandTrack, bandSummary } from "./band.js";
export { routeOpen, bestPath } from "./route.js";

// Helpers that the interface may also want.
export {
  fromBuffer, makeVar, regionCells, rowAreasKm2, latOf, lonOf, normLon, lonInRange,
  MISSING, EARTH_RADIUS_KM, KM_PER_DEG_LAT,
} from "./grid.js";
export { significanceLevel, fmt, fmtP, displayUnits, MIN_YEARS } from "./stats.js";
export { annualFields } from "./fields.js";
export { sampleRoute, sampleCells } from "./route.js";
export { timeLabels, seasonPlan } from "./time.js";
