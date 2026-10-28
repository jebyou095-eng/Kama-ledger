(async () => {
  const assert = require('node:assert/strict');
  const c = await import('../src/kamo-cloud.js');
  const { createNotebook } = await import('../src/kamo-notebook.js');

  // ---- prompt: only the items the question names, never the whole ledger ----
  const snap = [{ id: 1, name: 'Ocre', price: 900 }, { id: 2, name: 'Bois de Frêne', price: 50 }, { id: 3, name: 'Secret Item', price: 123456 }];
  const an = (r) => ({ price: r.price, ageDays: 2, median: 1000, week: -5 });
  const ctx = c.pickContext('should I buy ocre now?', snap, an, (r) => (r.id === 1 ? { cost: 700, profit: 200 } : null));
  assert.deepEqual(ctx.ids, [1]);
  const msgs = c.buildMessages('should I buy ocre now?', ctx), all = JSON.stringify(msgs);
  assert.ok(/Ocre/.test(all) && /900/.test(all) && /craftProfit/.test(all));
  assert.ok(!/Secret Item|123456|Frêne/.test(all), 'unrelated items never leave the PC');
  assert.equal(c.pickContext('hello there friend', snap, an).items.length, 0);
  assert.ok(!/CONTEXT/.test(c.buildMessages('hello there friend', { items: [] })[1].content));
  assert.ok(c.buildMessages('x'.repeat(900), ctx)[1].content.length < 700, 'question is capped');

  // ---- tidy ----
  assert.equal(c.tidy('<think>hmm</think>**Yes!** Buy it.'), 'Yes! Buy it.');
  assert.ok(c.tidy('A sentence. '.repeat(60)).length <= 401);

  // ---- cascade: first that answers wins, 429 cools a provider down, bad key is skipped ----
  let t = 0; const log = [];
  const fake = (plan) => async (req) => { log.push(req.provider); return plan[req.provider](req); };
  const S = { keys: { groq: 'gsk_12345678', sambanova: 'sn_12345678', gemini: '' }, models: { groq: 'my-model' } };
  let casc = c.createCascade(fake({ groq: () => ({ ok: true, text: 'Buy it!' }), sambanova: () => ({ ok: true, text: 'no' }) }), { now: () => t });
  let r = await casc.ask('q q', { items: [] }, S);
  assert.deepEqual([r.ok, r.text, r.provider], [true, 'Buy it!', 'groq']); assert.deepEqual(log, ['groq']);
  log.length = 0;
  casc = c.createCascade(fake({ groq: () => ({ ok: false, status: 429 }), sambanova: () => ({ ok: true, text: 'From sn' }) }), { now: () => t, cooldown: 60000 });
  r = await casc.ask('q q', { items: [] }, S); assert.equal(r.provider, 'sambanova'); assert.deepEqual(log, ['groq', 'sambanova']);
  log.length = 0; r = await casc.ask('q q', { items: [] }, S); assert.deepEqual(log, ['sambanova'], 'groq is cooling down');
  t = 61000; log.length = 0; await casc.ask('q q', { items: [] }, S); assert.deepEqual(log, ['groq', 'sambanova'], 'groq is tried again after the cooldown');
  // a refused key is skipped for a long time; with no key set nothing is tried
  casc = c.createCascade(fake({ groq: () => ({ ok: false, status: 401 }), sambanova: () => ({ ok: false, status: 500 }) }), { now: () => t });
  r = await casc.ask('q q', { items: [] }, S); assert.equal(r.ok, false); assert.ok(r.tried.some((x) => x.status === 401));
  assert.equal(c.createCascade(fake({}), {}).configured({ keys: {} }), false);
  assert.equal(c.createCascade(fake({}), {}).configured({ keys: { groq: ' short ' } }), false);
  // a transport that throws is just a failure; the model name from the settings is used
  let seen = null; casc = c.createCascade(async (q) => { seen = seen || q; throw new Error('offline'); }, { now: () => t });
  r = await casc.ask('q q', { items: [] }, S); assert.equal(r.ok, false); assert.equal(seen.model, 'my-model'); assert.equal(seen.key, 'gsk_12345678');
  // the Test button explains itself
  casc = c.createCascade(fake({ groq: () => ({ ok: false, status: 401 }) }), { now: () => t });
  assert.match((await casc.test('groq', S)).why, /refused/);
  assert.match((await casc.test('gemini', S)).why, /Paste a key/);
  assert.equal((await c.createCascade(fake({ groq: () => ({ ok: true, text: 'Hello you!' }) })).test('groq', S)).ok, true);

  // ---- notebook: cloud answers are kept, expire when they depend on prices, and your correction wins ----
  const nb = createNotebook({ load: () => '', save: () => {} });
  const e = nb.learn('is ocre worth buying', 'Yes, 20% under median.', 'cloud', [1], Date.now(), 3600000);
  assert.ok(nb.lookup('is ocre worth buying', [1]), 'kept');
  const old = Date.now; Date.now = () => old() + 2 * 3600000;
  assert.equal(nb.lookup('is ocre worth buying', [1]), null, 'price answers expire'); Date.now = old;
  const f = nb.learn('what is a kama in dofus', 'The money of Dofus.', 'cloud', [], Date.now(), 0);
  nb.vote(f.id, false); nb.correct(f.id, 'Kamas are the currency.');
  assert.match(nb.lookup('what is a kama in dofus', []).entry.a, /currency/);
  console.log('kamo-cloud checks passed');
})();
(async () => {
  const { buildMessages } = await import('../src/kamo-cloud.js');
  const sys = buildMessages('what is the capital of Peru', { items: [] })[0].content;
  require('assert').ok(/anything/i.test(sys) && !/only talk about|only answer/i.test(sys), 'Kamo may answer outside the market');
  require('assert').ok(/never invent prices/i.test(sys), 'still never invents prices');
  console.log('kamo-cloud scope check passed');
})();
