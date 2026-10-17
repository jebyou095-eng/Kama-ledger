> **Status note.** The app that exists today is the single file `kama-ledger.html` (plain HTML/JS, no build step). This SPEC is the longer-term design and still mentions React/Vite/Dexie; treat the stack there as optional. The domain rules (section 2), data model (4) and calculations (5) apply to both.

# Kama Ledger — Specification v3 (audited)

Personal, local-first profit tracker for Dofus crafting, recycling (Recyclage -> Pépites),
brisage (equipment -> runes) and flipping. Passive and read-only. It never clicks, buys,
lists, reads game memory or sniffs network traffic.

## 0. Rules and risk (read first)
- Ankama's terms on third-party tools were NOT verified. Check them before using screen capture.
  Pasted chat text is the primary, safest input. Screen capture is optional (phase 3).
- All data stays local (IndexedDB). If a cloud vision model is used for OCR fallback, frames leave
  the machine: make it opt-in, crop to game regions only, and show a notice.

## 1. Stack (default, change if you prefer)
TypeScript, Vite, React, Dexie (IndexedDB), Vitest, Tesseract.js (OCR, phase 3).
Money is stored as integer kamas. Never use floats for kamas. Rates (yield per unit) are decimals.
All totals are computed by code, never typed by hand.

## 2. Domain rules (verified from real sessions unless marked UNVERIFIED)
1. Chat purchase line: `[HH:MM] <qty> x [<Item>] (<price> kamas)`. The `[HH:MM]` prefix can be MISSING
   when a screenshot is cropped (fixtures/runes.txt has none): the parser must accept both.
   The quantity can contain a thousands space (`1 000 x`). Price is the TOTAL for the line
   (10 x Étoffe Mystérieuse (266 637) matches the 10-lot price). Thousands separators are spaces
   (possibly non-breaking). A line can wrap onto the next row (`... (212 995` / `kamas)`): join it.
2. Valid lot quantities: 1, 10, 100, 1000. Anything else is flagged.
3. Ignore, but log as events: `Banque : + N Kamas (vente : ...)` (a sale), `Cet objet n'est plus
   disponible...` (failed buy), `Vous avez créé ...`.
   N is probably the GROSS listing price, with the 2% already paid at listing time: observed amounts
   look like listing prices (154,999; 199,998; 69,994; 1,839,899) while the net-of-tax reading would
   imply odd listing prices (158,162; 204,080; 71,422). Still UNVERIFIED: confirm once with a known listing.
   Never deduct tax a second time from a Banque line.
4. Sale tax is 2% of the listing price, charged when LISTING, whether or not it sells
   (7,860 on 392,986). Rounding observed: 392,986->7,860; 400,994->8,020; 28,994->580; 2,899->58;
   296,989->5,940. Round-to-nearest and ceil both fit: UNVERIFIED which. Buying has no tax.
5. Net value of a Pépite = listing(1000-lot) - tax, divided by 1000. Example 392,986 -> 385.126.
   It moves with the market: always read it from settings, never hardcode.
6. Recycling (Recyclage): Pépites = units x yield_per_unit. Yield was linear in stack size in every
   test (Moustache précieuse 840/9600 = 0.0875; Dent de Wabbit 280.72/3000; Dard de Morfrelon
   1846.27/3180; Éclat Obscur 1291.98/706). Rounding of decimals in-game is UNVERIFIED: verify against
   the real inventory change once. Some items yield 0.00.
7. Recycling decision per item: value = yield_per_unit x net_pepite_price.
   break_even_unit_price = value. buy_stop = value x (1 - margin), margin default 10%.
   relist_price = paid / 0.98 (recovers cost after the 2% tax; the upfront tax is lost if it expires).
8. Brisage. Formula VALIDATED against 12 stacks from two real Concassage results
   (fixtures/brisage_validation.json: every stack within +1 of the formula, consistent with
   "whole part guaranteed + decimal = chance of one extra rune"). Keep versioned and editable.
   Pdb  = 3 x jet x STAT_WEIGHT x item_level / 200 + 1
   runes = (Pdb / RUNE_WEIGHT) x coefficient / 100
   STAT_WEIGHT is the weight of ONE POINT of the stat, NOT the weight of the rune. They differ for some
   stats: Vitalité stat weight 0.2 (rune Vi weight 1). Using the rune weight for Vitalité gives 1,571
   runes for the Collier du YeCh'Ti; the game gave 317, and 0.2 gives 316.4.
   Stat weights confirmed by real results: Vi 0.2, Fo/Ine/Age 1, Sa 3, Do 20, Prospe 3.
   Stat weights NOT yet confirmed (do not hardcode silently): Ini, Cha, Ré, Tac, Fui, Po, Cri, Ga Pa, etc.
   Where stat weight == rune weight the weight cancels and runes ~ 3 x jet x level / 200 x coef.
   Focus: chosen stat keeps 100% of Pdb, all other stats 50% (UNVERIFIED: no focused result seen yet).
   Rune weights come from the DoFocus guide; sources disagree (Po 51 in guide, 50 in forum): store source.
   Output the MINIMUM COEFFICIENT to break even before the user buys a batch.
   Coefficient drops when many of that item are broken in a session: warn on large batches.
9. Rune tiers: brisage yields basic runes only; 3 basic -> 1 Pa, 3 Pa -> 1 Ra. Selling mixed tiers can
   beat selling all basic. Price each tier separately.
10. The HDV shows only the cheapest listing per lot size. Buying many units climbs the price
    (Moustaches 29 -> 38 per unit after ~11,000 units). Model price creep, do not assume the quoted price.
11. Pépite value depends on the lot size you sell: at 392,987 (1000-lot) it is 393 each, but the 100-lot
    (42,630) is 426 each, the 10-lot (4,977) 498 and the single (619). The 1000-lot is the cheapest per unit,
    so it is the conservative default. Make the lot size a setting and show the alternatives.
12. Rounding: kamas are integers. Compute fractional Pépites x price in full precision, then round the
    final kama amount once (half up). Store the TOTAL price of a purchase; derive unit price, never the reverse.
13. A line whose total / qty is far (> 3x) from the item's last PriceSnapshot unit price is probably a
    misread quantity (seen once: `1 x [Kamatrix] (6 689 kamas)` is a 10-lot price). Flag it, do not fix it silently.
14. The Recyclage panel shows `n/800`: a limit on item rows per recycle (UNVERIFIED meaning). Warn near it.
15. Calculator inputs must accept the user's shorthand: `2m1` = 2,100,000, `50kk` = 50,000,000,
    `2 285 800`, `2,285,800`. Reject ambiguous input instead of guessing (a bare `-3,005,012` is an amount,
    not an instruction: ask).

## 3. Pipeline
Input -> Normalizer -> Parser -> Validator -> Dedupe/Stitch -> Store -> Calc engine -> UI

### 3.1 Inputs
- Paste box (phase 1). Screenshot drop (phase 3). Live screen share (phase 3, optional).

### 3.2 Parser constraints (catch OCR errors)
- qty in {1,10,100,1000}; price > 0; unit price within a tolerance band of the last PriceSnapshot
  (flag, do not reject); OCR confusions 5/S, 1/l/I, 0/O in numbers; item name matched against the
  catalog with fuzzy matching, new names flagged for confirmation.
- Every parsed line carries: confidence, raw text, source (paste/frame id), edit history.
- Unreadable or cut-off lines are FLAGGED, never guessed.

### 3.3 Dedupe / stitching (critical)
Real logs contain genuine identical repeats (six identical `1 x Corne de Père Phorreur (995)` lines in
one minute). Do NOT dedupe by (time, item, price). Stitch overlapping screenshots by sequence overlap:
find the longest suffix of the previous capture equal to a prefix of the next; drop only that overlap.
If the overlap is ambiguous (all-identical lines), flag it and ask. Show a gap warning when no overlap is
found. Live capture must sample on change at ~5-10 fps, not every 1-2 s.

### 3.4 Dates
Chat lines have only HH:MM. Store a session date; handle midnight rollover (logs span 21:11 -> 04:53).

## 4. Data model
Item(id, name, category, level, avg_price, aliases)
Yield(item_id, yield_per_unit, measured_stack, measured_yield, date, game_version, source)
Recipe(id, product_item, profession, level, ingredients[{item_id, qty}], forge_rune_cost)
PriceSnapshot(item_id, lot_size, price, at)
Purchase(id, item_id, qty, total_price, at, project_id, cost_type: cash|owned_stock, confidence, source)
Listing(id, item_id, qty, list_price, tax_paid, status: active|sold|expired|cancelled, at, sold_at)
Sale(id, listing_id|null, gross, tax, net, at)   // from "Banque : +" lines when no listing matches
Stock(item_id, qty, location: inventory|bank|havre_sac, as_of)
Project(id, name, type: craft|recycle|brisage|flip, status, notes)
BrisageResult(id, item_id, coefficient, runes{rune: qty}, game_estimate_value, at)
Setting(tax_rate=0.02, safety_margin=0.10, pepite_listing_price, scenarios=[-0.05,-0.10])
Adjustment(id, project_id, amount, label)  // every manual edit is its own labelled line, never silent

## 5. Calculation engine
- cash_cost = sum(Purchase where cash). true_cost = cash_cost + market value of owned stock used + fees
  (forge rune, failed attempts).
- Sale: tax is paid at listing. net_if_sold = list_price - tax_paid. Expired listing = tax lost.
- Two profit numbers, clearly labelled:
  1) cash_position = net received - cash_cost.
  2) profit_on_sold_units = net received for sold units - cost basis of those units.
  Never call cash_position "realized profit".
- Unrealized = net market value of unsold output (at current prices) - its cost basis. Labelled estimate.
- Cost basis for partial sales: average cost by default (FIFO optional). Leftover stock keeps basis.
- Margin = profit / cost. ROI per day = profit / (cost x days locked). Rank by ROI/day, not profit alone.
- Craft vs buy = market listing net of tax - (ingredients + forge rune). Include price-creep range.
- Lot optimizer: cheapest mix of 1/10/100/1000 lots; warn when a lot price passes buy_stop.
- Sensitivity: show profit at current price, -5%, -10% (selling thousands of units moves the price:
  Pépite went 393 -> 385 net during the session).
- Sum check: every total shows its line items and a computed check.

## 6. Features by phase
1. Paste box, parser with constraints, sequence-overlap stitching, spend total with sum check, flagged lines.
2. Item catalog, yields per unit, recycling table (profitable with buy_stop / not profitable with
   relist price), Listing entity with upfront tax, Setting for Pépite price.
3. Screen capture with change detection, ROI regions (chat, market panel, recipe, recycler, brisage
   result), OCR-first reader, correction UI, confidence flags.
4. Projects, cost allocation, cash position vs profit on sold units, capital/ROI ranking, stock aging.
5. Brisage calculator with minimum coefficient, opportunity radar (scan saved yields against current
   prices: flag items priced below yield x net_pepite x (1 - margin)), depth and price-impact scenarios.

## 7. Screens
Live feed (lines, flags, running total) | Dashboard (today, per project, ranking, sensitivity, alerts) |
Projects | Recycling table (two tabs) | Stock | Price history | Settings | Audit log.

## 8. Alerts
Net Pépite price below a project's break-even | buy price above buy_stop | price drift > 10% vs last
snapshot | ingredient listed far above its average (e.g. 3x) | unsold stock older than N days.

## 9. Tests (Vitest)
Use fixtures/ as golden tests. Totals must match exactly. Include the cut-off and wrapped-line cases.
Add tests for: tax rounding, net Pépite price, lot-size validation, stitching with identical lines,
midnight rollover, brisage formula with a known item, break-even coefficient.

## 10. Known unknowns (ask the user, then record the answer in code comments)
1. Is `Banque : + N` the gross listing price (tax already paid at listing)? Evidence says yes, not proven.
   Test: list at a known price and compare with the bank line when it sells.
2. Does the game show only HH:MM in chat, or can it show dates?
3. Tax rounding: nearest or ceil?
4. How does the game round fractional recycler yields?
5. Is the brisage formula/weights table current for this game version?

## 11. Changelog of audit findings fixed in v3
Dedupe-by-triplet bug; tax charged at listing; "realized" mislabel; merged synthesis into brisage;
weights editable and sourced; yield stored per unit; capture rate raised; dates and rollover;
confidence/audit trail; fuzzy item catalog; capital/ROI ranking; price-impact model; totals computed in code.

## 12. v4 audit changelog (what v3 got wrong)
- Brisage formula used the RUNE weight; it must use the STAT weight (Vitalité 0.2). Verified on 12 real stacks.
- `Banque : +` was treated as possibly net of tax; evidence says gross (tax already paid at listing).
- runes.txt fixture had an invented timestamp (the screenshot had none). Fixed: no timestamp.
- Missing parser cases: no timestamp, `1 000 x` quantity, misread-quantity flag, shorthand like `2m1`/`50kk`.
- Pépite value assumed the 1000-lot only; the lot size is now a setting.
- Rounding rule for fractional yields x prices was missing.
- README told the builder to turn every file in fixtures/ into a test, but expected.json also holds constants
  (tax rounding, yields, brisage points); the prompt now names them.
