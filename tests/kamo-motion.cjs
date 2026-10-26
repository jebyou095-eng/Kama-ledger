const assert = require('node:assert');
(async () => {
  const { createShake } = await import('../src/kamo-motion.js');
  const { cardRuns, edge } = await import('../src/cards.js');
  // shaking: quick back and forth
  const s = createShake(); let hit = false;
  for (let i = 0; i < 14; i++) hit = s.push((i % 2 ? 40 : -40), 0, i * 80) || hit;
  assert.ok(hit, 'a shake is noticed');
  // a plain drag is not a shake
  const d = createShake(); let bad = false;
  for (let i = 0; i < 30; i++) bad = d.push(i * 12, i * 3, i * 30) || bad;
  assert.ok(!bad, 'a drag is not a shake');
  // slow wiggles are not a shake either
  const w = createShake(); let slow = false;
  for (let i = 0; i < 14; i++) slow = w.push((i % 2 ? 40 : -40), 0, i * 400) || slow;
  assert.ok(!slow);
  // cards: three cards of 40 lines separated by 3-line gaps, bright text across one of them, header and footer around
  const lum = []; const put = (n, v) => { for (let i = 0; i < n; i++) lum.push(v); };
  put(30, 34); put(40, 48); put(3, 34); put(40, 48); lum.fill(90, 50, 54); put(3, 34); put(40, 48); put(60, 34);
  const runs = cardRuns(lum, 14);
  assert.strictEqual(runs.length, 3, 'three cards');
  assert.deepStrictEqual(runs.map((r) => r.y1 - r.y0 + 1), [40, 40, 40]);
  assert.ok(runs[1].y0 === 73 && runs[0].y1 === 69, 'the gap between cards stays empty');
  // sideways edge
  const row = [34, 34, 48, 48, 48, 48, 48, 34, 34];
  assert.strictEqual(edge(row, 4, -1, 48, 10), 2);
  assert.strictEqual(edge(row, 4, 1, 48, 10), 6);
  console.log('kamo-motion checks passed');
})();
