const assert = require('node:assert');
(async () => {
  const { createNotebook, cosine, vectorize } = await import('../src/kamo-notebook.js');
  const nb = createNotebook({ load: () => '', save: () => {} });
  // paraphrases of the same question match; different questions do not
  const sim = (a, b) => cosine(vectorize(a), vectorize(b));
  assert.ok(sim('what is the price of ocre', 'how much does ocre cost') >= 0.72, 'price / cost');
  assert.ok(sim('should I buy ocre now', 'is it a good time to purchase ocre') >= 0.6);
  assert.ok(sim('where do I find the Bouftou quest', 'where is the bouftou quest') >= 0.72);
  assert.ok(sim('what is the price of ocre', 'where do I find the bouftou quest') < 0.4);
  nb.learn('Where can I find the Bouftou quest?', 'Talk to the guard in Incarnam.', 'friend', []);
  const hit = nb.lookup('where is the bouftou quest', []);
  assert.ok(hit && /Incarnam/.test(hit.entry.a), 'a kept answer comes back for a paraphrase');
  assert.strictEqual(nb.lookup('where is the tofu quest', []), null, 'a different subject is not matched');
  // the same words about different items are different questions
  nb.learn('is it worth crafting this', 'Yes, +1200 profit.', 'cloud', ['i1']);
  assert.strictEqual(nb.lookup('is it worth crafting this', ['i2']), null);
  assert.ok(nb.lookup('is it worth crafting this', ['i1']));
  // numbers must match
  nb.learn('how much is 100 ocre worth', '5000', 'cloud', []);
  assert.strictEqual(nb.lookup('how much is 10 ocre worth', []), null);
  // your correction beats everything, a cloud answer never overwrites it
  const e = nb.lookup('where is the bouftou quest', []).entry;
  nb.correct(e.id, 'Actually it is in Astrub.');
  nb.learn('Where can I find the Bouftou quest?', 'Some other answer', 'cloud', []);
  assert.ok(/Astrub/.test(nb.lookup('where is the bouftou quest', []).entry.a));
  // two thumbs down switch an answer off
  const c = nb.learn('what is a prisme', 'a thing', 'cloud', []); nb.vote(c.id, false); nb.vote(c.id, false);
  assert.strictEqual(nb.lookup('what is a prisme', []), null);
  assert.ok(nb.stats().count.corrections === 1 && nb.stats().size >= 3);
  // it persists
  let saved = ''; const a = createNotebook({ load: () => '', save: (t) => { saved = t; } }); a.learn('best crafts today', 'Try X', 'friend', []);
  assert.ok(createNotebook({ load: () => saved, save: () => {} }).lookup('what are the best crafts today', []), 'reloaded');
  console.log('kamo-notebook checks passed');
})();
