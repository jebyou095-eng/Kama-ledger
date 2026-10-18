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

### Capture hotkey and correcting what OCR read
- **Hotkey:** with the desktop app running and a screen or window shared, press the capture hotkey (default Ctrl+Shift+K, change it in the Capture tab) while you are in the game. It captures the shared window and beeps; it only reads pixels and sends nothing to the game. A browser cannot do this, so in the browser Esc captures while the page is focused.
- **Review before saving:** after Read all, every recognised purchase and sale appears in an editable table (type, item, quantity, amount). Fix anything wrong, use the suggestion button for misspelled names (needs the Data tab loaded), delete bad lines, then press Save to ledger. Nothing reaches the ledger until you save.
- **Edit later:** in Database > Ledger History, click a name, quantity or amount to correct it, or use the delete button. Edited rows are marked.

The original single-file version remains available at `kama-ledger.html` for Chrome or Edge.

Tabs: Log total, Capture (screen share + OCR), Database (every capture), Recycling, Sell & tax, Brisage, Craft, Data.

## Launching the app (Windows)

1. Install Node.js (LTS) once from https://nodejs.org.
2. Double-click **Start Kama Ledger.bat**. The first run installs what it needs (internet, a few minutes); after that it opens the app in a few seconds.

The game data (19 382 items, 4 402 recipes, Datafus) is bundled, so the **Items** tab works immediately.

## Items and Ingredients lists

The **Items** tab is your market list. Type an item name to add it: if it has a recipe, its ingredients are added to the Ingredients list too. Each row shows price, value if recycled, value if concassed (brisage), what you can craft with it, and whether crafting is worth it:

- green: profit after the 2% listing tax is more than the neutral band (default 2% of the craft cost)
- grey: within the band, cost = profit
- red: loss if crafted

Click a row to open it: prices by lot (1 / 10 / 100 / 1 000, or paste the popup text), average price, articles sold (easy to sell from the threshold in the toolbar), Pépites if recycled, value if concassed, the ingredient prices, and the price history. Prices older than 7 days are flagged. The data is saved on the computer in the IndexedDB stores `Items` and `Ingredients`; **Export Items + Ingredients** writes `Items.json` and `Ingredients.json`, and **Import** reads them back.

Items newer than Datafus (Dec 2024) are not in the game data: they can be added as custom ingredients (prices only, no recipe).

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
