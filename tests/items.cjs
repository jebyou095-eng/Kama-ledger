const assert = require('node:assert/strict');
(async () => {
  const m = await import('../src/items.js');
  const DAY = 86400000;
  // lots popup text (from the market screenshot)
  assert.deepEqual(m.parseLots('Lot Prix\n1 29\n10 444\n100 4 899\n1 000 29 877'), { 1: 29, 10: 444, 100: 4899, 1000: 29877 });
  assert.deepEqual(m.parseLots('1 000 29 877\nbruit'), { 1000: 29877 });
  assert.equal(m.priceFromLots({ 1: 29, 10: 444 }), 29);
  assert.equal(m.priceFromLots({ 10: 400, 100: 3000 }), 30);
  assert.equal(m.priceFromLots({}), null);
  // staleness / history
  assert.equal(m.isStale(null, 0), true);
  assert.equal(m.isStale(10 * DAY, 16 * DAY), false);
  assert.equal(m.isStale(10 * DAY, 17 * DAY), true);
  let rec = m.newEntry([5, 'Aile', 26, 15, 0, []], 1);
  assert.equal(rec.kind, 'ingredient');
  rec = m.setPrice(rec, 30, 100);
  rec = m.setPrice(rec, 30, 200);
  rec = m.setPrice(rec, 33, 300);
  assert.equal(rec.history.length, 2);
  assert.equal(rec.prevPrice, 30);
  assert.equal(rec.priceAt, 300);
  assert.equal(m.setPrice(rec, 'abc', 5).price, null);
  // status
  assert.equal(m.craftStatus(500, 10000), 'go');
  assert.equal(m.craftStatus(100, 10000), 'neutral');
  assert.equal(m.craftStatus(-100, 10000), 'neutral');
  assert.equal(m.craftStatus(-500, 10000), 'loss');
  assert.equal(m.craftStatus(NaN, 10000), 'unknown');
  assert.equal(m.sellability(12, 10), 'easy');
  assert.equal(m.sellability(3, 10), 'hard');
  assert.equal(m.sellability(null, 10), 'unknown');
  // row model: item 1 = 2 x ingredient 2 + 1 x ingredient 3
  const idx = [[1, 'Marteau', 90, 7, [[2, 2], [3, 1]], []], [2, 'Plume', 10, 15, 0, []], [3, 'Os', 10, 47, 0, []]];
  const byId = {}; idx.forEach((a) => { byId[a[0]] = a; });
  const usedIn = m.reverseRecipes(idx);
  assert.deepEqual(usedIn[2], [[1, 2]]);
  const ingredients = { 2: { price: 1000 }, 3: { price: 500 } };
  const item = { ...m.newEntry(idx[0], 1), price: 5000, pepites: 10, sold: 20 };
  const ctx = { byId, ingredients, items: { 1: item }, usedIn, pepiteNet: 300, taxMode: 'nearest', band: 0.02, easyFrom: 10 };
  const ev = m.evaluate(item, ctx);
  assert.equal(ev.cost, 2500);
  assert.equal(ev.craft, 5000 - 100 - 2500);
  assert.equal(ev.status, 'go');
  assert.equal(ev.recycled, 3000);
  assert.equal(ev.sell, 'easy');
  const loss = m.evaluate({ ...item, price: 2000 }, ctx);
  assert.equal(loss.status, 'loss');
  const partial = m.evaluate(item, { ...ctx, ingredients: { 2: { price: 1000 } } });
  assert.equal(partial.status, 'unknown');
  assert.deepEqual(partial.missing, [3]);
  const ing = m.evaluate({ ...m.newEntry(idx[1], 1), price: 1000 }, ctx);
  assert.equal(ing.uses.length, 1);
  assert.equal(ing.uses[0].profit, 2400);
  assert.equal(ing.status, 'go');
  const untracked = m.evaluate({ ...m.newEntry(idx[2], 1) }, { ...ctx, items: {} });
  assert.equal(untracked.status, 'unknown');
  assert.equal(untracked.uses[0].tracked, false);
  console.log('items logic checks passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
(async () => {
  const { buildTree } = await import('../src/items.js');
  const rows = { 1: [1, 'Chapeau', 1, 1, [[2, 3], [3, 1]], []], 2: [2, 'Fil', 1, 1, [[3, 2]], []], 3: [3, 'Laine', 1, 1, 0, []] };
  const t = buildTree(1, 1, (i) => rows[i], (i) => ({ 3: 10 }[i] || null), (i) => rows[i][1]);
  require('node:assert/strict').equal(t.children.length, 2);
  require('node:assert/strict').equal(t.children[0].children[0].subtotal, 20);
  rows[3][4] = [[1, 1]]; // cycle: must stop
  const c = buildTree(1, 1, (i) => rows[i], () => null, (i) => rows[i][1], 6);
  require('node:assert/strict').ok(JSON.stringify(c).length < 5000);
  console.log('tree checks passed');
})();

// real popup lines (v30 diagnostics): the "Prix moyen" and inventory lines are not lots, and misread lot sizes are inferred from the row order
(async () => {
  const { parseLots } = await import('../src/items.js');
  const lines = ['Prix moyen : 1 510 (< .', 'Quantité en banque : & 1 y 3', '1 1258 : ACHETER (D champignon', 'Oo 14588: : ACHETER Bb \\ ([) Coquille', '00 149999 : ACHETER À D ;'].join('\n');
  require('node:assert/strict').deepEqual(parseLots(lines), { 1: 1258, 10: 14588, 100: 149999 });
  console.log('lot row checks passed');
})();

(async () => {
  const { parseLots } = await import('../src/items.js');
  const { parsePopup } = await import('../src/market.js');
  const assert = require('node:assert/strict');
  const lines = ['Niv. SO + Galet', 'Prix moyen : 2 736 (<', 'Quantité en inventaire : & O', 'Prix', '1 4953 ‘ ACHETER', '10 49776 | ACHETER', '00 299 555. : ACHETER', '200 2999982 - ACHETER'];
  assert.deepEqual(parseLots(lines.join('\n'), 2736), { 1: 4953, 10: 49776, 100: 299555, 1000: 2999982 });
  assert.deepEqual(parseLots(lines.join('\n')), { 1: 4953, 10: 49776, 100: 299555, 1000: 2999982 });
  // high-value item: five single-unit offers, noise before the size token
  const am = ['Lot Prix à', '1 5e =', '4” ; 1 4000 ACHETER', 'ji € |', '_—e à 1 100000 ‘ ACHETER', '{ a 1 190 000 : : ACHETER', 'N 1 350 000 : * ACHETER', 'è 1 1770025 ! ACHETER'].join('\n');
  const al = parseLots(am, 127848);
  assert.deepEqual(al, { 1: 4000 }); assert.deepEqual(al.offers[1], [4000, 100000, 190000, 350000, 1770025]);
  const pop = parsePopup(lines);
  assert.equal(pop.level, 50); assert.equal(pop.avg, 2736); assert.equal(pop.name, '');
  assert.equal(parsePopup(['Galet', 'Niv.50 + Pierre', 'Prix moyen : 2 736']).name, 'Galet');
  console.log('real popup lot size + level checks passed');
})();
