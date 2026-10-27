const assert = require('assert');
(async () => {
  const P = await import('../src/perf.js');
  const good = P.summarize(Array(240).fill(16.6), Array(40).fill(1), [], 4);
  assert.equal(P.grade(good), 'smooth');
  const bad = P.summarize(Array(60).fill(66), Array(40).fill(60), [200, 300, 250, 400], 4);
  assert.equal(P.grade(bad), 'laggy');
  const r = P.analyze({ normal: bad, noKamo: good, paused: bad }, { heapMB: 500, storageKB: 4000, voice: 'loading' });
  assert.equal(r.verdict, 'laggy');
  assert.ok(r.findings.some((x) => /Kamo himself/.test(x)) && r.tips.length >= 3);
  assert.equal(P.analyze({ normal: good }, {}).verdict, 'smooth');
  console.log('perf checks passed');
})();
