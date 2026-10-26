(async () => {
  const assert = require('node:assert/strict');
  const k = await import('../src/kamo-ai.js');
  const b = await import('../src/kamo-brain.js');
  const DAY = 86400000, now = new Date(2026, 9, 25, 12).getTime();
  const names = [{ id: 1, name: 'Anneau du Prespic' }, { id: 2, name: 'Talisman Songe' }, { id: 3, name: 'Ocre' }, { id: 4, name: "Anneau de l'Invocateur Satisfait" }];

  // finding items in a sentence, with typos and accents
  assert.deepEqual(k.findItems('is the Talisman Songe worth it', names).map((x) => x.id), [2]);
  assert.deepEqual(k.findItems('talisman songue prix', names).map((x) => x.id), [2]);
  assert.deepEqual(k.findItems("anneau de l invocateur satisfait vs anneau du prespic", names).map((x) => x.id), [4, 1]);
  assert.deepEqual(k.findItems('what is the weather', names), []);

  // intents
  assert.equal(k.parseAsk('should I buy Talisman Songe?', names).intent, 'worth');
  assert.equal(k.parseAsk('is Ocre a good time to sell', names).sell, true);
  assert.equal(k.parseAsk('how did Ocre move this week', names).intent, 'trend');
  assert.deepEqual(k.parseAsk('compare Ocre and Talisman Songe', names).ids, [3, 2]);
  assert.equal(k.parseAsk('Ocre', names), null, 'a bare name goes to the older price lookup');
  assert.equal(k.parseAsk('what changed', names), null);

  // analysis from history
  const rec = (price, vals) => ({ id: 3, name: 'Ocre', price, priceAt: now - DAY, history: vals.map((v, i) => [now - (vals.length - i) * 2 * DAY, v]) });
  const cheap = k.analyzeItem(rec(80, [100, 102, 98, 101, 99, 100]), now);
  assert.equal(cheap.verdict, 'cheap'); assert.equal(cheap.median, 100); assert.ok(cheap.vsMedian <= -10);
  assert.match(k.explainWorth(cheap, false), /Good moment to buy Ocre/);
  assert.match(k.explainWorth(cheap, true), /Wait before selling/);
  const high = k.analyzeItem(rec(130, [100, 102, 98, 101, 99, 100]), now);
  assert.match(k.explainWorth(high, false), /wait on Ocre/); assert.match(k.explainWorth(high, true), /Good time to sell/);
  const few = k.analyzeItem(rec(100, [100]), now);
  assert.equal(few.verdict, 'unknown'); assert.match(k.explainWorth(few), /only 1 price/);
  assert.match(k.explainTrend(cheap), /usually 100/);
  assert.match(k.explainCompare(cheap, high), /Ocre|better buy/);
  // equipment: the clean-roll price is said to be the reference
  const eq = k.analyzeItem({ ...rec(2700000, [2700000, 2750000, 2698000]), jetClean: { price: 2700000 }, jetSpecial: [{ price: 2698999 }] }, now);
  assert.match(k.explainTrend(eq), /clean-roll listing/); assert.match(k.explainTrend(eq), /Forged or exo/);

  // learning: a question asked 3 times becomes a button; an item asked 3 times becomes watched
  const mem = {};
  const key = k.questionKey({ intent: 'worth', id: 3 }, 'should I buy ocre');
  for (let i = 0; i < 2; i++) k.learnQuestion(mem, key, 'should I buy ocre?', now + i, 3);
  assert.equal(k.promoted(mem, now + 10, 3).length, 0, 'twice is not a habit yet');
  k.learnQuestion(mem, key, 'should I buy ocre?', now + 3, 3);
  assert.deepEqual(k.promoted(mem, now + 10, 3).map((p) => p.label), ['should I buy ocre?']);
  assert.ok(k.watched(mem).has(3));
  assert.equal(k.promoted(mem, now + 40 * DAY, 3).length, 0, 'old habits fade');
  // the same words in another order are the same question
  assert.equal(k.questionKey(null, 'prix du blé ?'), k.questionKey(null, 'blé prix'));
  // watched items: smaller moves are reported
  const r = [{ id: 3, name: 'Ocre', price: 106, priceAt: now, history: [[now - DAY, 100], [now, 106]] }];
  assert.equal(b.analyzeMarket(r, now).movers.length, 0);
  assert.equal(b.analyzeMarket(r, now, { watch: new Set([3]) }).movers[0].watched, true);
  console.log('kamo-ai checks passed');
})();
