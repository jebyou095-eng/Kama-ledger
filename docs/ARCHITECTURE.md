# Architecture

```
index.html            all screens (one <section id="t-…"> per tab)
src/
  main.js             app shell (still the biggest file): tabs, capture queue + OCR review, ledger/history, calculators, startup; wires the modules below
  core.js             pure core moved out of main.js: chat-log parsing, tax, item index + search (tests/run-tests.cjs runs THIS file)
  livescan.js         live scan + scanFrame (reads each new screen: market, popup, tooltip, chart, recipe, budget, chat)
  capture.js          screen/window share: picker, start/stop, controls
  checks.js           diagnostics file, performance check button, guided test session
  perf.js             performance evaluator (button) + automatic lag guard (calm mode)
  hotkey.js           pure hotkey helpers
  cards.js            market card detection (luminance runs) used for the highlight boxes
  kamo*.js            Kamo: kamo.js hub; brain (lines), ai (price Q&A), notebook (learned answers), cloud (Groq/SambaNova/Gemini), friend (Claude file),
                      motion (walk/lie/dizzy), sound + tts-core + tts-worker + voice-index (recorded and live voice), overlay.js (the see-through window)
  items.js            pure item/ingredient logic: prices, lots, craft cost/profit, craft tree (tested)
  items-ui.js         the Items tab: list, filters, categories, detail panel, recipe editing, images, approval window
  market.js           pure readers/matchers for market text: columns, names, level-aware matching, OCR-confusion folding (tested)
  detect.js           pure panel finder: from full-screen OCR words to boxes for market / popup / recipe / budget / chat (tested)
  scan.js             browser side of scanning: OCR worker pool, image clean-up, row reading, auto-detect, crops
  gamedata.js         pure merge of the downloaded game data into the item index (tested)
  transactions.js     chat purchase/sale parsing and ledger history (tested)
  diag.js, diag-plan.js   diagnostics button and the plan it runs
  data/kama-data.json shipped game data index
electron/             desktop shell: window, hotkey, screen picker, game-data download bridge
public/ocr/           offline OCR engine and French language data
tests/                node tests (npm test); tests/fixtures/frames = saved OCR words of mock game screens
```

Data lives in the browser store of the desktop app: IndexedDB `kama-ledger` (stores `shots`, `meta`, `Items`, `Ingredients`) and a few `localStorage` keys (`kl-…`).

Scan pipeline: `scan.autoDetect` (full-screen sparse OCR) → `detect.detectPanels` → per panel reader in `scan.js` → `market.snapItem` (match to game data) → `items-ui.applyMarket / stagePopup` (staged in the approval window) → accept → `applyPrice`.

## Split modules reach main.js through `scanEnv` (getters, read lazily)
`main.js` still owns shared variables (`stream`, `P`, `profile`, `scanning`...). Split-out modules (`livescan`, `checks`, `capture`) get a `getEnv()` that returns `scanEnv`;
read the value at call time (`var E = getEnv()`), never cache it at load. When moving code mechanically, never regex-replace a name inside a string (it once broke `global-auto-toggle`).
Check a moved file for undefined names before shipping; `tests/*.cjs` exist for each module and a headless scan of `tests/fixtures/frames/f1.png` must still read every panel.

## Things learned the hard way
- The overlay window is excluded from screen capture (`setContentProtection`), otherwise the scanner reads Kamo, rings and its own yellow boxes.
- Overlay marks are mapped against the overlay's REAL bounds (`capture:frame-rect`); Windows can shrink it to the work area.
- Windows PowerShell `Invoke-WebRequest` with its progress bar took 30+ minutes for 90 MB: the start script uses `curl.exe`.
- The live voice runs in `tts-worker.js` (off the page); the first live sentence only wakes it up.
- `tests/run-tests.cjs` once ran a stale copy of the core inside `kama-ledger.html`; it now runs `src/core.js`. `kama-ledger.html` is the old single-file app, unused (candidate for deletion, ask the user).
