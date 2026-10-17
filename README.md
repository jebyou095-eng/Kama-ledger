# Kama Ledger

Offline Dofus profit tracker with a Windows desktop app and a browser-compatible legacy build.

## Windows desktop app
Run `npm run package:win` to create the branded x64 installer at
`release/windows/Kama-Ledger-Setup-1.0.0-x64.exe`. The installer creates Start Menu and desktop shortcuts.
The desktop app includes a screen/window picker, Stop sharing control, OCR capture, and local IndexedDB storage.
Its workflow shortcuts learn your most-used tabs and preferred capture source locally; this profile can be reset
from the app header. No interaction profile is uploaded.

To run the desktop app from source, use `npm run start`. To build a portable executable instead of an installer,
use `npm run package:portable`.

The original single-file version remains available at `kama-ledger.html` for Chrome or Edge.

Tabs: Log total, Capture (screen share + OCR), Database (every capture), Recycling, Sell & tax, Brisage, Craft, Data.

## Game data (Datafus)
1. Open the Data tab.
2. Choose the Datafus zip, the `Datafus-master` folder, or just these files:
   `data/B/entities_json/Items.part00.json`, `Recipes.part00.json`, `ItemTypes.part00.json`, `Effects.part00.json`
   and `data/C/translations_json/i18n_fr.json`.
3. It takes a few seconds, keeps only names, levels, types, recipes and stats (about 1.5 MB), and saves them in the browser.
   Next time it loads by itself. "Export compact file" saves `kama-data.json`, which can be loaded instead of the big zip.

Used by: Log total (level, type, typo suggestions), Craft (recipe cost and profit), Brisage (level and stats filled from the item), Data (search).
Datafus stops at Dofus 2 / December 2024: newer items or changed recipes are missing.

## Tests
`npm test` (39 checks, no install needed). Pure logic sits between `/*CORE*/` and `/*END*/` in the legacy html.
