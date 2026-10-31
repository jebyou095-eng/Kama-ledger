(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  const mk = fs.readFileSync(__dirname + '/../src/market.js', 'utf8').replace(/export /g, '');
  const jp = fs.readFileSync(__dirname + '/../src/jetprice.js', 'utf8').replace(/^import .*$/m, '').replace(/export /g, '');
  const k = new Function(mk + jp + ';return { rollOf, askPrice, salesSpeed, sellAdvice };')();
  // Talisman Songe, real game ranges
  const eff = [[125, 251, 300], [118, 41, 60], [126, 21, 30], [111, 1, 1], [176, 11, 15]], names = { 125: 'Vitalité', 118: 'Force', 126: 'Intelligence', 111: 'PA', 176: 'Prospection' };
  const st = (a) => a.map(([label, value]) => ({ label, key: label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), value }));
  const top = k.rollOf(st([['Vitalité', 300], ['Force', 60], ['Intelligence', 30], ['PA', 1], ['Prospection', 15]]), eff, names);
  assert.equal(top.pct, 100); assert.equal(top.tier, 'top'); assert.equal(top.perfect, true); assert.equal(top.n, 4, 'fixed PA is ignored');
  const low = k.rollOf(st([['Vitalité', 251], ['Force', 41], ['Intelligence', 21], ['Prospection', 11]]), eff, names); assert.equal(low.pct, 0); assert.equal(low.tier, 'low');
  const mid = k.rollOf(st([['Vitalité', 275], ['Force', 50], ['Intelligence', 25], ['Prospection', 13]]), eff, names); assert.ok(mid.pct > 35 && mid.pct < 60 && mid.tier === 'medium', 'medium ' + mid.pct);
  const hi = k.rollOf(st([['Vitalité', 290], ['Force', 55], ['Intelligence', 28], ['Prospection', 14]]), eff, names); assert.equal(hi.tier, 'high');
  assert.deepEqual(k.rollOf(st([['Critique', 2], ['Vitalité', 300]]), eff, names).exo, ['Critique'], 'a stat the item lacks is an exo/forged extra');
  assert.equal(k.rollOf(st([['Vitalité', 0]]), eff, names), null);
  // real OCR noise seen on the player's PC: trailing "ce", plural "Dommages"
  const e2 = [[428, 2, 5], [125, 10, 20]], n2 = { 428: 'Dommage Air', 125: 'Vitalité' };
  const noisy = k.rollOf(st([['Dommages Air ce', 5], ['Vitalité', 20]]), e2, n2); assert.deepEqual(noisy.exo, [], 'noise after a label is not an exo stat'); assert.equal(noisy.pct, 100);
  // price: floor at 0%, median at 50%, 1.5x median at 100%; never invents a number without the pieces
  assert.equal(k.askPrice(0, 2e6, 3e6).v, 2e6); assert.equal(k.askPrice(50, 2e6, 3e6).v, 3e6); assert.equal(k.askPrice(100, 2e6, 3e6).v, 4.5e6); assert.equal(k.askPrice(75, 2e6, 3e6).v, 3.75e6);
  assert.equal(k.askPrice(80, null, 3e6).v > 3e6, true); assert.equal(k.askPrice(20, null, 3e6).v, null); assert.equal(k.askPrice(20, null, null), null);
  assert.equal(k.askPrice(10, 5e6, 3e6).v, null, 'a floor above the median is a bad scan: ignored');
  // sales speed
  assert.equal(k.salesSpeed(47, '24h').level, 'easy'); assert.equal(k.salesSpeed(329, '7d').level, 'easy'); assert.equal(k.salesSpeed(5, '7d').level, 'hard'); assert.equal(k.salesSpeed(21, '7d').level, 'normal'); assert.equal(k.salesSpeed(14, '7d').level, 'slow'); assert.equal(k.salesSpeed(5, null), null);
  // advice text
  const t = k.sellAdvice({ name: 'Talisman Songe', chart: { sold: 47, span: '24h', median: 3324999 }, roll: top, floor: 2900000, floorDays: 5 });
  assert.match(t, /easy to sell/); assert.match(t, /top notch \(perfect\)/); assert.match(t, /fair asking price is about 4 987 499/); assert.match(t, /5 days old/); assert.match(t, /mixes every roll/);
  assert.match(k.sellAdvice({ name: 'Bois', chart: null, roll: null }), /no sales figure/);
  const src = (f) => fs.readFileSync(__dirname + '/../src/' + f, 'utf8');
  assert.ok(/import \{ rollOf, sellAdvice \}/.test(src('kamo.js')) && /sellAnswer\(raw\)/.test(src('kamo.js')), 'sell advice wired into kamo.js');
  assert.ok(/item: ti, at: Date.now\(\)/.test(src('livescan.js')), 'the scanned tooltip keeps its item');
  assert.ok(/function gameItem/.test(src('items-ui.js')) && /gameItem, exportSnapshot/.test(src('items-ui.js')), 'items-ui exposes gameItem');
  assert.ok(/P\.idx && P\.idx\.effs/.test(src('items-ui.js')), 'stat names come from the game index');
  console.log('jetprice checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
