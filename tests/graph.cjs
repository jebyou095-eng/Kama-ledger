(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  const rd = (f) => fs.readFileSync(__dirname + '/../src/' + f, 'utf8');
  const mk = rd('market.js').replace(/export /g, '');
  const gm = rd('graph-math.js').replace(/^import .*$/m, '').replace(/export /g, '');
  const gs = rd('graph-store.js').replace(/^import .*$/m, '').replace(/export /g, '');
  const k = new Function(mk + gm + gs + ';return { fitAxis, sampleSeries, parseStats, classifySpan, analyzeGraph, createGraphStore, describe };')();
  // axis: one misread label (19535 for 19533, a junk 1995, a 7 497 536 typo) must not bend the fit
  const ticks = [[254, 19951], [286, 19867], [317, 19784], [349, 19700], [381, 19617], [413, 19535], [444, 19449], [476, 19366], [507, 19282]].map(([y, v]) => ({ y, v }));
  const fit = k.fitAxis(ticks.concat([{ y: 319, v: 190786 }, { y: 351, v: 1970046 }]));
  assert.ok(fit && fit.n >= 8, 'axis fitted by the agreeing labels'); assert.ok(Math.abs(fit.at(349) - 19700) < 3 && Math.abs(fit.at(254) - 19951) < 3);
  assert.equal(k.fitAxis(ticks.slice(0, 2)), null, 'too few labels');
  // statistics line, including the OCR spellings seen on real screenshots
  assert.deepEqual(k.parseStats('Prix médian : 19 704 Prix moyen : 19 694 * 1628 articles vendus'), { median: 19704, avg: 19694, sold: 1628 });
  assert.deepEqual(k.parseStats('Price median : 19 704 Prix moyen : 19 694 * 1628 articles vendus'), { median: 19704, avg: 19694, sold: 1628 });
  assert.deepEqual(k.parseStats('Prix nedian : 3 324 999 Prix n‘oyen : 4 974 903 + 47 articles vendus'), { median: 3324999, avg: 4974903, sold: 47 });
  assert.equal(k.classifySpan(['9:42', 'PM', '1:42', 'AM', '5:42', 'AM']), '24h'); assert.equal(k.classifySpan('10/21 10/22 10/23 10/24 10/25 10/26 10/27 10/28'.split(' ')), '7d');
  assert.equal(k.classifySpan('9:28 10,5 10/8 10/13 0/18 10/23 10/28'.split(' ')), '30d', 'one misread date is not a clock');
  // reading: average far above the median says to trust the median; current price against the median gives buy/sell
  const pts = [[0, 4e6], [0.2, 3.4e6], [0.4, 3.2e6], [0.6, 3.3e6], [0.8, 3.0e6], [1, 2.9e6]];
  const a = k.analyzeGraph({ median: 3324999, avg: 4974903, sold: 47, span: '24h', points: pts });
  assert.match(a.text, /trust the median/); assert.match(a.text, /good moment to buy/); assert.ok(a.facts.vsMedianPct < -8);
  assert.equal(k.analyzeGraph({ points: [[0, 1]] }), null, 'too few points');
  // sampling keeps the last value and the highest
  const cols = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i === 100 ? 10 : 100 })); const s = k.sampleSeries(cols, (y) => 1000 - y, 20);
  assert.equal(s[s.length - 1][1], 900); assert.ok(s.some((p) => p[1] === 990), 'spike kept');
  // store: remembered per item and span, found from a question, bounded
  let mem = ''; const st = k.createGraphStore(() => mem, (t) => { mem = t; });
  st.add({ name: 'Talisman Songe', level: 200, span: '7d', median: 3743901, avg: 4707270, sold: 329, points: pts, sure: true }, 1000);
  st.add({ name: 'Talisman Songe', level: 200, span: '24h', median: 3324999, avg: 4974903, sold: 47, points: pts, sure: true }, 2000);
  const f = st.forQuestion('is the talisman songe trending up?'); assert.equal(f.length, 2); assert.equal(f[0].span, '24h');
  assert.equal(st.forQuestion('what about the bois').length, 0);
  assert.match(k.describe(f, 2000 + 3 * 3600000), /Talisman Songe, 24h chart read 3 h ago/);
  assert.equal(k.createGraphStore(() => mem, () => {}).all().length, 2, 'survives a restart');
  console.log('graph checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
