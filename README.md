# Spoonfed

See how much of the politics in your feed you actually chose.

Spoonfed reads a TikTok or YouTube watch history in the browser and reports:

- **Chosen vs. fed:** what share of your political videos came right after you searched for that topic, and what share the app picked for you.
- **The funnel:** how many different voices your political videos came from each week, and whether that number is shrinking.
- **Framing:** how much was presented as a fight and how much explained something.
- **Blind spots:** what the U.S. House voted on while your history was recorded, next to what your feed showed you.
- **Who fed you:** your top political sources. You rate them yourself, because Spoonfed never labels anyone as left or right.
- **Go find it:** three tasks built from your report, each pointing to a primary source such as a bill or a roll call.

Nothing is uploaded. There is no server, no account and no AI model. Every rule is a plain file in `docs/data/`.

## Run it

The site is static and lives in `docs/`.

- **GitHub Pages:** in your repo's Settings, open Pages, set the source to "Deploy from a branch", then pick `main` and `/docs`.
- **Locally:** run `cd docs && python3 -m http.server 8000`, then open http://localhost:8000. Opening `index.html` straight from your file browser won't work, because browsers block it from reading the rule files.

## Files

```
docs/
  index.html            the site (Analyze, How it works, Research, About)
  css/style.css
  js/engine.js          parsing and every calculation; runs in the browser and in Node
  js/app.js             drawing the report, saving ratings and results in the browser
  js/vendor/jszip.min.js  opens .zip downloads (MIT license)
  data/topics.json      political topic keyword lists
  data/tone.json        conflict and explaining word lists
  data/house-votes.json House roll call votes (House Clerk), with topics
  samples/              two fictional sample histories (TikTok and YouTube formats)
scripts/
  make_samples.py       regenerates the fictional samples
  refresh_votes.py      adds new House votes from clerk.house.gov
tests/
  engine.test.js        unit tests:  node tests/engine.test.js
```

## Update the House votes

```
python3 scripts/refresh_votes.py 2026 315 340
```

This pulls roll calls 315 to 340 for 2026 from the House Clerk. It keeps only final-passage style votes and assigns a topic from the title. Check new entries by hand. If the title doesn't say what a bill covers, set its topic yourself or leave it `null`.

## Sample data

The files in `docs/samples/` are invented. The users, creators, titles and searches are all fictional. They follow the real TikTok and Google Takeout file layouts, so the same code reads real downloads.

## License

MIT
