const assert = require('node:assert/strict');
(async () => {
  const m = await import('../src/market.js');
  const idx = require('../src/data/kama-data.json');
  const P = { idx, byId: {}, byN: {}, keys: [] };
  idx.items.forEach((a) => { P.byId[a[0]] = a; (P.byN[m.norm(a[1])] || (P.byN[m.norm(a[1])] = [])).push(a); });
  // numbers
  assert.equal(m.cleanInt('1 416 666'), 1416666);
  assert.equal(m.cleanInt('1 416 666 '), 1416666);
  assert.equal(m.cleanInt('l 4l6 666'), 1416666);
  assert.equal(m.cleanInt('abc'), null);
  assert.equal(m.parseBudget('4 941 069'), 4941069);
  assert.equal(m.parseBudget('Pods 22\n4 941 069'), 22);
  // name matching: level narrows the field, OCR typos are repaired
  let s = m.snapItem(P, "Soiffe d'Oshimo", 198, 'Chapeau');
  assert.equal(s.item[1], "Coiffe d'Oshimo");
  s = m.snapItem(P, "coiffe d'Hel Munster", 198, '');
  assert.equal(s.item[1], "Coiffe d'Hel Munster");
  s = m.snapItem(P, 'Aile du Tofu Malefique', 26, 'Aile');
  assert.equal(s.item[1], 'Aile du Tofu Maléfique');
  assert.equal(m.snapItem(P, 'Zzzz Qqqq Inconnu', 198, ''), null);
  assert.equal(m.snapItem(P, 'Coiffe de Rhine', 199, 'Chapeau'), null, 'item missing from Datafus must not be forced onto a wrong item');
  // name / type split
  const types = Object.values(idx.types);
  assert.deepEqual(m.splitNameType(["Coiffe d'Oshimo", 'Chapeau'], types), { name: "Coiffe d'Oshimo", type: 'Chapeau' });
  assert.deepEqual(m.splitNameType(['Aile du Tofu', 'Maléfique'], types).type, '');
  // columns and rows from a real OCR dump of a mock panel (words in panel pixels)
  const W = (t, x0, y0, x1, y1) => ({ text: t, x0, y0, x1, y1 });
  const words = [W('Nom', 49, 10, 68, 17), W('Niveau', 216, 6, 244, 21), W('Prix', 285, 10, 300, 17), W('moyen', 304, 12, 332, 19),
    W('199', 221, 38, 239, 46), W('14166660', 269, 38, 331, 46), W('198', 221, 77, 239, 85), W('198', 221, 116, 239, 124), W('Heaume', 48, 227, 93, 248)];
  const cols = m.findColumns(words, 342);
  assert.equal(cols.fromHeader, true);
  assert.ok(cols.levelX0 < 221 && cols.levelX1 > 239 && cols.priceX0 > cols.levelX1 - 1);
  const rows = m.rowAnchors(words, cols);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.level), [199, 198, 198]);
  assert.ok(Math.abs((rows[1].y0 + rows[1].y1) / 2 - 81) < 2 && rows[0].y1 - rows[0].y0 > 30);
  // fallback without header
  const bare = m.findColumns([W('199', 221, 38, 239, 46)], 342);
  assert.equal(bare.fromHeader, false);
  // popup
  const pop = m.parsePopup(['Aile du Tofu Maléfique', 'Niv. 26 • Aile', 'Prix moyen : 25', 'Quantité en inventaire : 0']);
  assert.deepEqual([pop.name, pop.level, pop.avg, pop.type], ['Aile du Tofu Maléfique', 26, 25, 'Aile']);
  // market chart
  const ch = m.parseMarketChart(['Cours du marché', 'Prix médian : 1 563 000', 'Prix moyen : 1 560 611', 'Articles vendus : 14']);
  assert.deepEqual([ch.sold, ch.median, ch.avg], [14, 1563000, 1560611]);
  assert.equal(m.matchVerdict(1, 92), '');
  assert.equal(m.matchVerdict(0.95, 80), '', 'low-confidence typo close to a real name is accepted');
  assert.match(m.matchVerdict(0.93, 92), /newer item/);
  assert.match(m.matchVerdict(0.8, 70), /uncertain/);
  console.log('market reader checks passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
(async () => {
  const { cleanName } = await import('../src/market.js');
  const assert = require('node:assert/strict');
  assert.equal(cleanName("Coiffe d'Aerruyne"), "Coiffe d'Aerruyne");
  assert.equal(cleanName("| Coiffe de Rhine ©"), "Coiffe de Rhine");
  assert.equal(cleanName("Ï xx |"), '');
  assert.equal(cleanName("Heaume Clochecuivre ®"), 'Heaume Clochecuivre');
  console.log('name clean-up checks passed');
})();
(async () => {
  const { snapItem, fold } = await import('../src/market.js');
  const assert = require('node:assert/strict');
  const P = { idx: { types: {}, items: [[1, "Coiffe d'Aermyne", 198, 1, 0, []], [2, "Coiffe d'Oshimo", 198, 1, 0, []], [3, 'Padgref', 120, 1, 0, []], [4, 'Podgrof', 120, 1, 0, []], [5, 'Heaume Clochecuivre', 198, 1, 0, []]] }, byN: {} };
  assert.equal(snapItem(P, "Coiffe d'Aerruyne", 198, '').item[0], 1, 'rn/m confusion resolved by level');
  assert.equal(snapItem(P, 'Heaume Clochacuivre', 198, '').item[0], 5, 'one wrong vowel resolved');
  assert.equal(snapItem(P, 'Padgref', 120, '').item[0], 3, 'exact stays exact even with a lookalike');
  assert.ok(snapItem(P, 'Podgref', 120, '').ambiguous, 'two real lookalikes stay ambiguous');
  assert.equal(snapItem(P, 'xqzt vvk', 198, ''), null, 'gibberish matches nothing');
  console.log('lookalike matching checks passed');
})();
(async () => {
  const { bandLines, bandNumber } = await import('../src/market.js');
  const assert = require('node:assert/strict');
  const w = (text, y0, y1, x0 = 0, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 30, y1 } });
  // three stacked rows, 28 px apart: [28,68] [96,136] [164,204]
  const bands = [[28, 68], [96, 136], [164, 204]];
  const out = bandLines({ words: [w('1200', 40, 60), w('450', 108, 128), w('999', 176, 196)] }, bands);
  assert.deepEqual(out.map((o) => o.lines), [['1200'], ['450'], ['999']], 'each word lands in its own row');
  // a stray word sitting exactly in the gap between row 1 and row 2 must go to ONE row only (it used to go to both)
  const gap = bandLines({ words: [w('1200', 40, 60), w('777', 76, 90), w('450', 108, 128)] }, bands);
  const all = gap.flatMap((o) => o.lines).filter((l) => l === '777').length;
  assert.equal(all, 0, 'a word in the middle of the gap belongs to no row (it used to be read by both)');
  // a word just outside a row's edge still belongs to that row, and only to that row
  const edge = bandLines({ words: [w('1200', 40, 60), w('88', 66, 78)] }, bands);
  assert.deepEqual(edge.map((o) => o.lines.length), [2, 0, 0]);
  // a word far from every row is dropped, not guessed
  const far = bandLines({ words: [w('55', 300, 320)] }, bands);
  assert.deepEqual(far.map((o) => o.lines), [[], [], []]);
  // numbers: never glue two lines together
  assert.equal(bandNumber(['1 200', '45']), 1200, 'longest digit line wins');
  assert.equal(bandNumber(['266 637']), 266637);
  assert.equal(bandNumber([]), null);
  console.log('stacked row reading checks passed');
})();
(async () => {
  const m = await import('../src/market.js'), it = await import('../src/items.js'), assert = require('node:assert/strict');
  // The coin icon after a price is read as a digit or a letter in real screens: it must not become part of the number.
  assert.equal(m.parsePopup(['Coiffe de la Reine des Voleurs', 'Niv. 200 + Chapeau', 'Prix moyen : 2 045 319 lv']).avg, 2045319);
  assert.equal(m.cleanGrouped('2 045 319 l'), 2045319); assert.equal(m.cleanGrouped('1 390 000 5'), 1390000);
  assert.equal(m.cleanGrouped('22 074'), 22074); assert.equal(m.cleanGrouped('5721'), 5721); assert.equal(m.cleanGrouped('abc'), null);
  assert.deepEqual(it.parseLots('1 1390000 : ACHETER 5 cs =\n1 1399999. : ACHETER y -'), { 1: 1390000 }, 'text after ACHETER is never part of the price');
  assert.deepEqual(it.parseLots('10 13 900 000 ACHETER 3'), { 10: 13900000 });
  console.log('coin-glyph number checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
(async () => {
  const { parsePopup } = await import('../src/market.js');
  const p = parsePopup(['Noix de Kokoko', 'Niv. 50 - Fruit', 'Prixmoyen:69  l&', 'Quantité en inventaire : 0']);
  require('assert').equal(p.avg, 69, 'average read even when OCR drops the space in "Prix moyen"');
  console.log('market popup average check passed');
})();
