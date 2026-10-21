# Architecture

```
index.html            all screens (one <section id="t-…"> per tab)
src/
  main.js             app shell: tabs, screen share, capture queue, calculators, startup; wires the modules below
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
