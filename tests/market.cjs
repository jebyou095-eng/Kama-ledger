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
