// Methods, data, credits and AI disclosure. Written with Claude and reviewed by the team.

export function renderAbout(app) {
  const el = document.getElementById("aboutModal");
  const vars = app.catalog.variables;
  el.innerHTML = `<div class="modal-card">
    <button class="btn small modal-close" data-x>Close</button>
    <h2>How the detective works</h2>
    <p class="muted">Trend Detective turns 46 years of NASA reanalysis data into investigations a high-school student can run: pick a question, test whether a trend is real, and follow a fixed value as it moves across the planet.</p>

    <h3>The twist: fix the value, watch the place move</h3>
    <p>Most trend tools fix a place and watch a number change. Shift mode does the opposite: it fixes a value (air at or below 0 °C, wind at or above 40 m/s, water with at most 15% ice) and follows the zone that has that value, year by year. A zone that slides toward the pole makes values rise where it arrives and fall where it leaves. That is why the same variable can trend in opposite directions in two regions while one process drives both.</p>

    <h3>Statistics</h3>
    <ul>
      <li><b>Rate of change:</b> ordinary least squares on yearly (or seasonal) means, reported per decade with a 95% confidence interval.</li>
      <li><b>Significance:</b> a t-test on the slope and a Mann–Kendall test with a lag-1 autocorrelation correction (Yue and Wang, 2004). <i>Significant</i> means both give p &lt; 0.05; <i>suggestive</i> means one does, or both are below 0.10; otherwise <i>not proven</i>, which is a finding, not an error.</li>
      <li><b>Seasonal cycle:</b> monthly climatology removed before testing when a season is selected.</li>
      <li><b>Detection clock:</b> years of data needed to detect a trend of this size against this noise (Weatherhead et al., 1998, J. Geophys. Res.): n* = [3.3 σ / |ω| · √((1+φ)/(1−φ))]^(2/3).</li>
      <li><b>Shift:</b> each year's zone, its area (true cell area), its outer edge per longitude (interpolated to the threshold crossing) and its centre. The edge trend is converted to km per decade.</li>
      <li><b>Climate velocity:</b> trend over time divided by the spatial gradient of the long-term mean, in km per decade (Loarie et al., 2009, Nature).</li>
      <li><b>Climate twin:</b> climate analogs. Each land cell gets a fingerprint for 1980–1989 and 2016–2025 (mean temperature, warmest-minus-coldest month, log precipitation). The best match within 2,500 km is found and its position refined with a soft-min weighted centre.</li>
      <li><b>Trend continued cone:</b> a linear extrapolation of the zone's centre with its 95% prediction interval. It is not a forecast.</li>
    </ul>

    <h3>Data</h3>
    <ul>
      ${vars.map((v) => `<li><code>${v.id}</code>: ${v.source} (${v.units}), ${v.start} onward, ${v.grid.dlat}° × ${v.grid.dlon}° grid.</li>`).join("")}
      <li>Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 monthly collections M2TMNXSLV, M2TMNXFLX, M2TMNXLND, M2C0NXASM, v5.12.4, Goddard Earth Sciences Data and Information Services Center (GES DISC). Gelaro et al. (2017), J. Climate 30, 5419–5454.</li>
      <li>Coastlines and borders: Natural Earth via world-atlas (public domain).</li>
    </ul>

    <h3>Libraries and fonts</h3>
    <ul>
      <li>d3 v7 (ISC), topojson-client v3 (ISC), world-atlas v2 (ISC, Natural Earth data).</li>
      <li>Inter, JetBrains Mono, Instrument Serif (SIL Open Font License) via Google Fonts.</li>
      <li>Everything else (WebGL renderer, charts, statistics engine) was written for this project.</li>
    </ul>

    <h3>Limits</h3>
    <ul>
      <li>MERRA-2 is a reanalysis: a model constrained by observations, not raw satellite pixels. Grid cells are about 200 km, so city and estuary regions are really "the region around".</li>
      <li>The record starts in 1980, so some real trends are still "not proven". The detection clock shows how much longer we would need.</li>
      <li>The latest months of the record are preliminary; trends use complete years only.</li>
    </ul>

    <h3>AI use</h3>
    <p>Code and text were written with Claude (Anthropic) and reviewed by the team. No AI runs inside the app: the question list is a fixed table and every number is computed from the data in your browser.</p>
    <p class="muted small">Not affiliated with or endorsed by NASA.</p>
  </div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) el.hidden = true; });
}
