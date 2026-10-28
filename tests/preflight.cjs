(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  const src = fs.readFileSync(__dirname + '/../src/kamo-preflight.js', 'utf8').replace(/export /g, '');
  const { diagnose, speak } = new Function(src + ';return { diagnose, speak };')();
  const P = [{ id: 'groq', label: 'Groq' }, { id: 'gemini', label: 'Gemini' }];
  const base = { desktop: true, providers: P, keys: {}, test: null, errors: 0, scan: null, perf: null };
  assert.deepEqual(diagnose({ ...base, keys: { groq: true }, test: { ok: true, why: 'Works' } }), [], 'healthy: nothing to report');
  assert.equal(speak([]).ok, true);
  assert.deepEqual(diagnose(base).map((x) => x.id), ['nokey']);
  assert.deepEqual(diagnose({ ...base, keys: { groq: true } }).map((x) => x.id), ['untested']);
  const f = diagnose({ ...base, keys: { groq: true }, test: { ok: false, why: 'Groq says: model not found', provider: 'groq' }, errors: 2 });
  assert.deepEqual(f.map((x) => x.id), ['testfail', 'errors']);
  const s = speak(f); assert.match(s.text, /model not found/); assert.match(s.text, /read Kamo's status/); assert.match(s.tell, /Test failed \(groq\)/);
  assert.deepEqual(diagnose({ ...base, desktop: false }).map((x) => x.id), ['browser'], 'browser: no key advice');
  assert.deepEqual(diagnose({ ...base, keys: { gemini: true }, test: { ok: true, why: '' }, scan: { popupAvg: null, popupLots: 0 } }).map((x) => x.id), ['noavg', 'nolots']);
  assert.ok(speak(Array.from({ length: 6 }, (_, i) => ({ id: i, level: 'warn', say: 'x' + i, tell: 't' }))).text.split('•').length <= 4, 'at most three items');
  console.log('preflight checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
