// Calendar helpers shared by the engine. Pure, no DOM.

// Parse "YYYY-MM" into numbers.
export function parseMonth(s) {
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
}

// Calendar month of time index k when index 0 is (y0, m0).
export function monthOfIndex(y0, m0, k) {
  const z = m0 - 1 + k;
  return { year: y0 + Math.floor(z / 12), month: (z % 12) + 1 };
}

export function monthLabel(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Time labels for every step of a catalog entry.
export function timeLabels(entry) {
  const { year, month } = parseMonth(entry.start);
  const t = new Array(entry.nt);
  for (let k = 0; k < entry.nt; k++) {
    const m = monthOfIndex(year, month, k);
    t[k] = monthLabel(m.year, m.month);
  }
  return t;
}

// How a month filter maps onto season years.
//   selected[m]  1 if calendar month m (1..12) is used
//   yearShift[m] 1 if month m counts toward the next year's season
//   count        number of selected months
// A season that crosses the new year (it contains both 12 and 1 but not all
// months) is labelled by the year of its January: the months from the start
// of the season up to December shift forward one year.
export function seasonPlan(months) {
  const selected = new Uint8Array(13);
  const yearShift = new Uint8Array(13);
  const list = (months && months.length ? months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    .map(Number)
    .filter((m) => m >= 1 && m <= 12);
  for (const m of list) selected[m] = 1;
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  const count = sorted.length;
  if (count < 12 && selected[1] && selected[12]) {
    // Find the largest gap between consecutive selected months; the season
    // starts right after it.
    let bestGap = -1, start = sorted[0];
    for (let k = 0; k < count; k++) {
      const a = sorted[k], b = sorted[(k + 1) % count];
      const gap = (b - a + 12) % 12;
      if (gap > bestGap) { bestGap = gap; start = b; }
    }
    if (start !== 1) for (let m = start; m <= 12; m++) if (selected[m]) yearShift[m] = 1;
  }
  return { selected, yearShift, count, key: sorted.join(",") };
}
