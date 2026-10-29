# Screenshot test library

Real game screenshots with the true values next to them. Claude runs `node tests/screens/run.mjs` after every change to the readers
(needs `npx vite --port 5199`, and `PW=<path to playwright-core/index.js>` if playwright-core is not installed here) and gets a per-field score.

Layout: `tests/screens/<kind>/<name>.png` plus `<name>.json` with the truth. Kinds: `popup` (lots + average), `chart` (price chart), later `market` (list rows) and `tooltip` (jets).

popup json: `{ "kind": "popup", "name": "...", "avg": 79, "lots": { "1": 90, "10": 890, "100": 7771, "1000": 54995 } }`
chart json: `{ "kind": "chart", "name": "...", "level": 200, "span": "24h", "median": 3324999, "avg": 4974903, "sold": 47 }`

Take screenshots with the game UI clean (no Kamo ring or bubble over the panel). Full window is best; a tight crop around one panel also works.
Keep every failing screenshot: a failure is the most useful kind. Never delete one to make the score look better.
