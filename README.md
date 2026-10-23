# Kilowhen

When to use electricity so the grid's dirtiest, most expensive power plants stay off.

Kilowhen is one interactive scene of a real day on New York's power grid.

- **The ridge** is New York's forecast electricity demand for every hour, from NYISO.
- **The amber** is demand above the peaker line, when the grid has to switch on its last and most expensive plants. Smokestacks in the town light up to match.
- **Drag your appliances** (dryer, dishwasher, car charger) out of the amber hours and watch the cost of each one change.
- **Slide "Homes doing what you did"** from just you up to half of New York's 17th district (U.S. Census household counts) and watch the ridge redraw and the stacks go dark.
- **Stagger the homes** spreads everyone's shifted power into the quietest hours, so the community doesn't just create a new peak at 1 AM.
- **Play the day** runs all 24 hours in ten seconds.

There's no account, no tracking and no AI. The "How it works" panel explains every formula.

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

## Demo tips

- Add `?at=2026-10-23T18` to the URL to start the scene at 6 PM on a given day.
- Use the left and right arrow keys on the scene to step through the hours, or on an appliance to move it.

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
