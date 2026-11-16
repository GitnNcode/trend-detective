# References and citations

DOIs below were resolved on 2026-11-14 and match the titles shown. Add anything else that ships in the final project (the guide requires every code library, font, image and text source to be listed, even open source ones).

## NASA data

- Global Modeling and Assimilation Office (GMAO) (2015), *MERRA-2 tavgM_2d_slv_Nx: 2d, Monthly mean, Time-Averaged, Single-Level, Assimilation, Single-Level Diagnostics V5.12.4*, Goddard Earth Sciences Data and Information Services Center (GES DISC). https://doi.org/10.5067/AP1B0BA5PD2K
- GMAO (2015), *MERRA-2 tavgM_2d_flx_Nx: 2d, Monthly mean, Time-Averaged, Single-Level, Assimilation, Surface Flux Diagnostics V5.12.4*, GES DISC. https://doi.org/10.5067/0JRLVL8YV2Y4
- GMAO (2015), *MERRA-2 tavgM_2d_lnd_Nx: 2d, Monthly mean, Time-Averaged, Single-Level, Assimilation, Land Surface Diagnostics V5.12.4*, GES DISC. https://doi.org/10.5067/8S35XF81C28F
- Gelaro, R., McCarty, W., Suárez, M. J., Todling, R., et al. (2017), The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2), *Journal of Climate*. https://doi.org/10.1175/JCLI-D-16-0758.1

## Validation sources

- GISTEMP Team, *GISS Surface Temperature Analysis (GISTEMP), version 4*, NASA Goddard Institute for Space Studies. https://data.giss.nasa.gov/gistemp/
- Lenssen, N., Schmidt, G. A., Hendrickson, M., Jacobs, P., et al. (2024), A NASA GISTEMPv4 Observational Uncertainty Ensemble, *Journal of Geophysical Research: Atmospheres*. https://doi.org/10.1029/2023JD040179
- NASA Earth Science Vital Signs, Arctic Sea Ice Minimum Extent (NSIDC data). https://climate.nasa.gov/vital-signs/arctic-sea-ice
- NOAA Climate.gov, Climate Change: Minimum Arctic Sea Ice Extent. https://www.climate.gov/news-features/understanding-climate/climate-change-minimum-Arctic-sea-ice-extent
- National Snow and Ice Data Center, Sea Ice Index. https://nsidc.org/data/seaice_index

## Challenge

- NASA Space Apps Challenge 2026, "Be An Earth System Trend Detective!". https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/

## More NASA data

- GMAO (2015), *MERRA-2 tavgM_2d_aer_Nx: 2d, Monthly mean, Time-averaged, Single-Level, Assimilation, Aerosol Diagnostics V5.12.4*, GES DISC. https://doi.org/10.5067/FH9A0MLJPC7N
- GMAO (2015), *MERRA-2 const_2d_asm_Nx: 2d, constants*, GES DISC. https://doi.org/10.5067/ME5QX6Q5IGGU
- Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. (2017, updated daily), *Sea Ice Index, Version 3/4* (G02135), NSIDC. https://nsidc.org/data/g02135

## Methods

- Loarie, S. R., et al. (2009), The velocity of climate change, *Nature* 462, 1052-1055 (climate velocity).
- Weatherhead, E. C., et al. (1998), Factors affecting the detection of trends, *J. Geophys. Res.* 103(D14), 17149-17161 (years needed to detect a trend).
- Yue, S., and Wang, C. (2004), The Mann-Kendall test modified by effective sample size to detect trend in serially correlated hydrological series, *Water Resources Management* 18, 201-218.
- Sen, P. K. (1968), Estimates of the regression coefficient based on Kendall's tau, *J. Am. Stat. Assoc.* 63, 1379-1389.

## Code and tools

- d3 v7.9.0 (ISC License), loaded from jsDelivr: projections, geographic paths, interpolation. https://d3js.org
- topojson-client v3.1.0 (ISC License), loaded from jsDelivr. https://github.com/topojson/topojson-client
- world-atlas v2.0.2 (ISC License; data from Natural Earth, public domain): coastlines and borders. https://github.com/topojson/world-atlas
- Python pipeline: numpy, xarray, netCDF4, earthaccess, requests (BSD/MIT/Apache licences).
- Fonts: the system font of the viewer's device (no web fonts are shipped). Icons are hand-drawn inline SVG. No images are shipped.

## AI assistance

- Claude (Anthropic) was used to help write code and text. See `README.md`.
