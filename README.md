# Kilowhen

When to use electricity so the grid's dirtiest, most expensive power plants stay off.

Kilowhen reads public, hourly grid data and turns it into everyday decisions:

- **Now:** whether to run the big appliances right now or wait, and how long. The Peaker Clock shows the whole day at a glance, with peak hours marked.
- **Plan my day:** pick your appliances (car charger, dryer, dishwasher, water heater and so on). Kilowhen finds the start time for each one that costs the grid the least before your deadline, and shows the savings and the energy moved out of peak hours. Add your utility's time-of-use rates to see bill savings.
- **If we all did it:** how many megawatts a town, district, state or the whole country would take off the evening peak if some share of homes did the same thing, compared with the size of a peaker plant.
- **This week:** every hour of the week as a heatmap, the cheapest and priciest hours, and how much the answer changes between New York's 11 zones.

No account, no tracking and no AI. Every formula is on the How it works page.

## Data

- **New York:** NYISO public market data (no key needed). This includes day-ahead zonal prices (LBMP), the ISO load forecast, and the real-time fuel mix.
- **Other U.S. regions:** the EIA Hourly Electric Grid Monitor (Form EIA-930). There is no free hourly price outside New York, so these regions are timed by expected emissions instead.
- **Households:** U.S. Census Bureau.

The files in `docs/data/` are refreshed every 30 minutes by `.github/workflows/refresh.yml`.

## Turn on live updates

1. Push this repo to GitHub.
2. In Settings, open Pages and set the source to deploy from the `main` branch, `/docs` folder.
3. In Settings, open Actions, then General. Under "Workflow permissions", choose "Read and write permissions".
4. In the Actions tab, open "Refresh grid data" and click "Run workflow" once. After that it runs on its own every 30 minutes.
5. Optional, to add the rest of the U.S.: get a free key at https://www.eia.gov/opendata/register.php. Then add it in Settings under Secrets and variables, Actions, as a new repository secret named `EIA_API_KEY`.

## Run locally

```
cd docs && python3 -m http.server 8000
```

Then open http://localhost:8000. To pin the app to a moment for a demo, add `?at=2026-10-23T18` to the URL.

## Files

```
docs/                 the app (GitHub Pages serves this folder)
  index.html, css/app.css, js/app.js
  js/engine.js        all calculations; runs in the browser and in Node
  data/ny.json        New York grid data (built by scripts/build_ny.py)
  data/regions.json   which regions are available
  data/places.json    household counts (U.S. Census)
scripts/
  fetch_ny.py         downloads the latest NYISO files and rebuilds ny.json
  build_ny.py         turns raw NYISO CSV files into ny.json
  fetch_eia.py        adds other U.S. regions from EIA (needs EIA_API_KEY)
tests/engine.test.js  node tests/engine.test.js
```

## License

MIT
