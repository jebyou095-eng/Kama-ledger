# Kama Ledger

Offline Dofus market helper (Windows desktop app, Electron). It reads your game screen, matches every item to the game data, keeps prices for items and ingredients, and shows which crafts are worth it.

## Start it

1. Install Node.js (LTS) once from https://nodejs.org.
2. Double-click **Start Kama Ledger.bat**. First run installs what it needs (internet, a few minutes). The launcher repairs itself once if the build fails and writes `build-log.txt`.
3. For a clean slate: **Game data tab → Danger zone**, or **Reset Kama Ledger data.bat**.

## The tabs

| Group | Tab | What it is for |
|---|---|---|
| Work | **Items** | Your item and ingredient lists with prices, craft profit (green / grey / red), the craft tree, categories, and the **Prices waiting for your approval** window |
| Work | **Scan** | Share the game window, scan (button, hotkey or live), diagnostics, manual areas, the older screenshot reader |
| Work | **Chat log** | Paste chat lines to total purchases and sales |
| Calculators | Craft · Recycling · Brisage · Sell & tax | The calculators |
| Stored data | **History** | Saved captures and the ledger history |
| Stored data | **Game data** | Update recipes/levels/images, look up an item, advanced loading, erase everything |

## How a scan works

1. **Scan → Share screen or window** (the game).
2. **Scan now**, the capture hotkey (default Ctrl+Shift+K), or tick **Live scan**.
3. The app finds the panels itself (market list, lot popup, Recettes, budget, chat), reads names, levels and prices, and matches each name to the game data. Unreadable names are ignored.
4. Prices wait in **Items → Prices waiting for your approval**. Select, **Accept** or **Refuse**. Fix a name by picking an item from the suggestions. Tick *Accept clean matches automatically* to skip the window for confident matches.

Nothing the scan reads is written to your lists before you accept it (unless you turn that option on). Chat purchases/sales and the budget are saved directly.

## Game data

**Game data → Update game data** downloads current items, recipes, levels and icons from the public Dofus data service (api.dofusdu.de), once. Item recipes can also be edited by hand in an item's detail panel. Edited recipes are tagged and survive updates.

## Exports

**Items → Export all categories** writes Items, Ingredients, Crafts, Recycles and Brisage as five JSON files.

## Diagnostics

**Scan → Diagnostics for Claude** reads the current screen (or screenshot files) like a scan, writes nothing to your lists, and saves one small `.json` file. What it tests is defined in `src/diag-plan.js`.

## For developers

See `docs/ARCHITECTURE.md`. `npm test` runs all tests, `npm run build` builds, `npm run start` runs the desktop app from source.
