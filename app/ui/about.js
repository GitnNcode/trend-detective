// Methods and data dialog. Written with Claude and reviewed by the team.

export function renderAbout(app) {
  const el = document.getElementById("aboutModal");
  const vars = app.catalog.variables;
  el.innerHTML = `<div class="modal-card">
    <button class="tb x" data-x>Close</button>
    <h2>Trend Detective: methods and data</h2>
    <p>Most trend tools pick a place and ask how its numbers changed. We wanted to ask the opposite question too: pick a value (air at 10 °C or warmer, wind above 40 m/s, sea ice above 15%) and ask where on Earth you find it each year. When that zone drifts, values go up where it arrives and down where it leaves. That is how a single cause can push two neighbouring regions in opposite directions.</p>
    <h3>Products</h3>
    <ul>
      <li><b>Time series:</b> area-weighted regional mean, yearly or seasonal, with an ordinary least-squares trend and its 95% confidence interval.</li>
      <li><b>Trend map:</b> the same test in every grid cell. Hatched cells are not significant (p ≥ 0.05).</li>
      <li><b>Shift:</b> each year's zone (values inside the threshold), its outer edge per longitude (interpolated to the threshold crossing), its area and its centre. The edge trend is reported in km per decade, poleward positive. The cone extends the centre's linear trend with its 95% prediction interval; it is not a forecast.</li>
      <li><b>Climate velocity:</b> the local trend divided by the spatial gradient of the long-term mean, in km per decade (Loarie et al., 2009, Nature 462).</li>
      <li><b>Climate analog:</b> each land cell gets a fingerprint for 1980–1989 and 2016–2025 (mean temperature, warmest minus coldest month, log precipitation). The best match within 2,500 km is located for both directions.</li>
      <li><b>Tanker voyage planner:</b> pick two oil terminals, a tanker class, speed, month and fuel price. The route is searched on NASA's 0.5° MERRA-2 land/sea grid (about 55 km) with A*, using 10 m wind, ECCO ocean currents (monthly climatology, 2008-2017) and sea ice. Canals are allowed only if the ship fits (a laden VLCC is too deep for Suez and too wide for Panama); the search is repeated with each used canal closed, and without the Arctic shortcut, so every realistic option is priced: days times (day rate plus fuel per day times fuel price) plus tolls, with fuel following the cube of speed and CO2 at 3.114 t per t of fuel. It also finds the best month to sail, the best route in every year since 1980, and a five-year projection from each cell's 20-year trend in wind and ice. Tolls, day rates and fuel curves are round public figures, not quotes.</li>
      <li><b>Shipping routes:</b> for each year and season, the fastest sea path between two ports on the 2° by 2.5° grid (A* search, eight neighbours). Each step costs sailing time at 14 knots, slowed by the 10 m wind (head wind most, following wind least) and by sea ice; water with more than 50% ice is closed, as is everything south of 56°S. Canals and narrow straits are opened by hand. Monthly-mean winds understate storms, so this shows how routes shift with ice and wind, not how to navigate. The prediction extends each cell's 20-year straight-line trend in ice and wind five years ahead and runs the same search.</li>
      <li><b>Sea-ice route:</b> a month is open when every point along the route has at most the chosen ice fraction.</li>
      <li><b>Best open path:</b> each year, the shortest path between the route's two ends through grid cells at or below the chosen ice fraction (Dijkstra on the 1° by 1.25° grid, eight neighbours, great-circle steps), in whichever checked month it is shortest. Lengths are rough, about ±5%, and straits narrower than a cell can close.</li>
      <li><b>Lineup and atlas:</b> every field tested at once for one region, or in every cell.</li>
    </ul>
    <h3>Significance</h3>
    <ul>
      <li>t-test on the least-squares slope, and a Mann–Kendall test with a lag-1 autocorrelation correction (Yue and Wang, 2004).</li>
      <li><b>Significant:</b> both p &lt; 0.05. <b>Suggestive:</b> one of them, or both p &lt; 0.10. Otherwise not significant. That is still an answer, not a failure: it means the change, if any, is hidden in the noise for now.</li>
      <li><b>Detection:</b> years of record needed to detect a trend of this size against this year-to-year noise (Weatherhead et al., 1998, J. Geophys. Res.), using the annual-mean form of the formula.</li>
    </ul>
    <h3>Data</h3>
    <ul>
      ${vars.map((v) => `<li><code>${v.id}</code>: ${v.source} (${v.units}), ${v.grid.dlat}° × ${v.grid.dlon}° grid, ${v.start} onward.</li>`).join("")}
      <li>Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 monthly collections M2TMNXSLV, M2TMNXFLX, M2TMNXLND, M2TMNXAER and M2C0NXASM, v5.12.4, GES DISC. Gelaro et al. (2017), J. Climate 30, 5419–5454.</li>
      <li>Coastlines and borders: Natural Earth via world-atlas.</li>
    </ul>
    <h3>Software</h3>
    <ul><li>d3 v7 and topojson-client v3 (ISC licence), world-atlas v2. The renderer, charts and statistics engine were written for this project.</li></ul>
    <h3>Limits</h3>
    <ul>
      <li>MERRA-2 is a reanalysis (a model constrained by observations). Grid cells are about 200 km across, so "city" and "estuary" regions mean the surrounding region.</li>
      <li>The record starts in 1980; recent months are preliminary, so trends use complete years.</li>
    </ul>
    <h3>AI use</h3>
    <p>The idea and approach came from our team. We used Claude (Anthropic) to help write and review code and text, and we checked the results against NASA GISTEMP and the NSIDC Sea Ice Index. The app itself never calls an AI model: every number you see is worked out from NASA data, right in your browser.</p>
  </div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) el.hidden = true; });
}
