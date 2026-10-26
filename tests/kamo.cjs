const assert = require('node:assert/strict');
(async () => {
  const b = await import('../src/kamo-brain.js');
  const DAY = 86400000, now = new Date(2026, 9, 23, 21, 30).getTime();
  const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };   // deterministic "random"

  // ---- voice: varied, never the same line twice in a row, three personalities, every key filled ----
  const vo = b.createVoice({ rng: seq(0.1, 0.4, 0.7, 0.95), voice: 'merchant' });
  const n = vo.pool('chatter').length, lines = []; for (let i = 0; i < n; i++) lines.push(vo.say('chatter'));
  assert.equal(new Set(lines).size, n, 'no repeated line before the pool is used up');
  for (let i = 0; i < 30; i++) { const nx = vo.say('chatter'); assert.notEqual(nx, lines[lines.length - 1], 'never the same line twice in a row'); lines.push(nx); }
  b.VOICES.forEach((v) => {
    const x = b.createVoice({ voice: v });
    ['share', 'scanning', 'moverDown', 'moverUp', 'bargain', 'recap', 'habitHour', 'curious', 'dance', 'nap', 'joke', 'tour', 'chatter'].forEach((k) => {
      assert.ok(x.pool(k).length >= 2, v + ' has several variants for ' + k);
    });
  });
  assert.match(b.createVoice({ rng: () => 0 }).say('moverDown', { name: 'Ocre', pct: 34, from: '1 000', to: '660' }), /Ocre/, 'variables are filled in');
  assert.ok(!/\{\w+\}/.test(b.createVoice().say('hi')), 'no unfilled placeholder');

  // ---- he never apologises: unknown questions get a curious answer with a hint ----
  b.VOICES.forEach((v) => {
    const x = b.createVoice({ voice: v });
    for (let i = 0; i < 6; i++) {
      const t = x.say('curious', { hint: b.curiousHint({ pending: 2, best: { name: 'Bonnet' } }, { movers: [{}], bargains: [] }, Math.random) });
      assert.ok(!/sorry|apolog|do not understand|don't understand|did not get/i.test(t), 'no apology: ' + t);
      assert.ok(t.length > 20, 'the answer gives something to do');
    }
  });

  // ---- understanding: commands, questions, typos, fun ----
  assert.deepEqual(b.understand('go to scan'), { intent: 'go', tab: 'cap', label: 'scan' });
  assert.equal(b.understand('add Bonnet Vicieux').name, 'Bonnet Vicieux');
  assert.equal(b.understand('what changed?').intent, 'movers');
  assert.equal(b.understand('any bargains').intent, 'bargains');
  assert.equal(b.understand('bargans please').intent, 'bargains', 'one typo is forgiven');
  assert.equal(b.understand('what do you know about me').intent, 'habits');
  assert.equal(b.understand('give me a recap').intent, 'recap');
  assert.equal(b.understand('dance!').intent, 'dance');
  assert.equal(b.understand('jump').intent, 'jump');
  assert.equal(b.understand('price of Bonnet Vicieux').intent, 'item');
  assert.equal(b.understand('recipe of Coiffe').recipe, true);
  assert.equal(b.understand('what should I craft').intent, 'best');
  assert.equal(b.understand('what is old').intent, 'old');
  assert.equal(b.understand('qwertyuiop').intent, 'lookup', 'unknown text is looked up as an item name, then answered with curiosity');
  assert.equal(b.understand('   '), null);

  // ---- market analysis from price history ----
  const h = (...p) => p.map(([d, v]) => [now - d * DAY, v]);
  const recs = [
    { id: 1, name: 'Ocre', price: 660, priceAt: now - 0.1 * DAY, history: h([6, 1000], [3, 1000], [0.1, 660]) },        // dropped 34%, also a bargain
    { id: 2, name: 'Pepite', price: 500, priceAt: now - 0.2 * DAY, history: h([5, 400], [0.2, 500]) },                   // up 25%
    { id: 3, name: 'Calme', price: 100, priceAt: now - 0.2 * DAY, history: h([5, 100], [0.2, 102]) },                    // steady
    { id: 4, name: 'Vieux', price: 900, priceAt: now - 40 * DAY, history: h([60, 500], [40, 900]) },                     // old move: ignored
    { id: 5, name: 'Fou', price: 300, priceAt: now - 0.1 * DAY, history: h([9, 100], [7, 500], [5, 120], [3, 480], [0.1, 300]) },
    { id: 6, name: 'Neuf', price: 50, priceAt: now, history: [] },
  ];
  const a = b.analyzeMarket(recs, now);
  assert.deepEqual(a.movers.map((m) => m.name), ['Fou', 'Ocre', 'Pepite'], 'movers are ordered by size of the move');
  const ocre = a.movers.find((m) => m.name === 'Ocre');
  assert.equal(ocre.dir, 'down'); assert.equal(ocre.pct, 34); assert.equal(ocre.from, 1000); assert.equal(ocre.to, 660);
  assert.equal(a.movers.find((m) => m.name === 'Pepite').dir, 'up');
  assert.ok(!a.movers.some((m) => m.name === 'Calme'), 'a 2% change is not news');
  assert.ok(!a.movers.some((m) => m.name === 'Vieux'), 'a move older than a week is not news');
  assert.equal(a.bargains[0].name, 'Ocre'); assert.equal(a.bargains[0].avg, 1000);
  assert.ok(a.volatile.some((v) => v.name === 'Fou'), 'wild swings are flagged');
  assert.equal(b.analyzeMarket([], now).movers.length, 0);

  // ---- habits learned from counters ----
  const mem = b.normalizeMem({
    scans: [new Date(2026, 9, 20, 21).getTime(), new Date(2026, 9, 21, 21).getTime(), new Date(2026, 9, 22, 22).getTime(), new Date(2026, 9, 23, 21).getTime()],
    tabs: { items: 40, craft: 12, cap: 7 }, accepts: 18, refused: 2,
    days: { [b.dayKey(now)]: 1, [b.dayKey(now - DAY)]: 1, [b.dayKey(now - 2 * DAY)]: 1 },
  });
  const hb = b.analyzeHabits(mem, now);
  assert.equal(hb.usualHour, 21);
  assert.equal(hb.favTab, 'craft', 'the Items home tab does not count as a favourite');
  assert.equal(hb.acceptRate, 90);
  assert.equal(hb.streak, 3);
  assert.deepEqual(hb.facts.map((f) => f.key).sort(), ['habitAccept', 'habitHour', 'habitStreak', 'habitTab']);
  assert.equal(b.analyzeHabits(b.normalizeMem({}), now).facts.length, 0, 'nothing is invented from no data');
  assert.equal(b.normalizeMem({ scans: 'x', tabs: 5 }).scans.length, 0, 'damaged memory is repaired');

  // ---- autonomy: what he decides to do alone ----
  const base = () => ({ now, rng: seq(0.5), gap: 0, sinceAct: 1e9, idleMs: 30000, auto: true, canScan: true, st: { stream: true, scanning: false, live: false }, sum: { pending: 0, clean: 0, stale: 0, best: null, tracked: 5 }, market: { movers: [], bargains: [] }, habits: { facts: [] }, mem: b.normalizeMem({}) });
  assert.equal(b.planNext(Object.assign(base(), { auto: false })), null, 'autonomy off: he does nothing alone');
  assert.equal(b.planNext(Object.assign(base(), { idleMs: 1000 })), null, 'you are busy: he does not pester');
  assert.equal(b.planNext(Object.assign(base(), { st: { stream: true, scanning: true } })), null, 'never interrupts a scan');
  assert.equal(b.planNext(Object.assign(base(), { sinceAct: 100, gap: 9000 })), null, 'cooldown between actions');
  assert.equal(b.planNext(Object.assign(base(), { idleMs: 200000 })).kind, 'nap');
  assert.equal(b.planNext(Object.assign(base(), { sum: { pending: 4, clean: 4, stale: 0, best: null } })).kind, 'point-pending');
  const stale = Object.assign(base(), { sum: { pending: 0, clean: 0, stale: 12, best: null }, idleMs: 70000 });
  assert.equal(b.planNext(stale).kind, 'scan', 'old prices + shared screen + you away: he scans');
  assert.notEqual(b.planNext(Object.assign({}, stale, { st: { stream: false, scanning: false } })).kind, 'scan', 'no shared screen: no scan');
  assert.notEqual(b.planNext(Object.assign({}, stale, { canScan: false })).kind, 'scan');
  const m2 = b.normalizeMem({ lastAutoScan: now - 60000 });
  assert.notEqual(b.planNext(Object.assign({}, stale, { mem: m2 })).kind, 'scan', 'not twice in 10 minutes');
  const mv = Object.assign(base(), { market: { movers: [ocre], bargains: [] } });
  const p1 = b.planNext(mv);
  assert.equal(p1.kind, 'mover'); assert.equal(p1.item.name, 'Ocre');
  mv.mem.seen[p1.seen] = now;   // once told, he does not repeat himself
  assert.notEqual((b.planNext(mv) || {}).kind, 'mover', 'a mover is announced once');
  // left alone for a while he always has something to do, and it varies
  const kinds = new Set(); let r = 0.01;
  for (let i = 0; i < 40; i++, r = (r + 0.137) % 1) kinds.add(b.planNext(Object.assign(base(), { rng: () => r, sum: { pending: 0, clean: 0, stale: 0, best: { name: 'x' }, tracked: 3 } })).kind);
  ['wander', 'chatter', 'point-best', 'play'].forEach((k) => assert.ok(kinds.has(k), 'he sometimes does: ' + k));
  const tour = b.planNext(Object.assign(base(), { rng: () => 0.1 }));
  assert.ok(tour && ['tour', 'wander'].includes(tour.kind));
  console.log('kamo brain checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
