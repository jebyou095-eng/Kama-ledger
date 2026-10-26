(async () => {
  const assert = require('node:assert/strict');
  const f = await import('../src/kamo-friend.js');
  assert.equal(f.shouldAsk('hi'), false); assert.equal(f.shouldAsk('how do I get a perfect roll on an amulet?'), true);
  const kb = [{ q: 'how do I get a perfect roll on an amulet', answer: 'Use runes.', at: 1 }];
  assert.equal(f.kbMatch(kb, 'how to get a perfect roll on amulet?').answer, 'Use runes.');
  assert.equal(f.kbMatch(kb, 'what is the weather'), null);
  const q = f.newQuestion('what drops from the Tofu?', 1000); assert.ok(q.id.startsWith('q'));
  const open = { [q.id]: { q: q.q, at: 1000 } };
  const r = f.applyAnswers(open, { answers: [{ id: q.id, q: q.q, answer: 'Feathers.', at: 2000 }, { id: 'say:1', answer: 'Hello from your friend!' }] }, []);
  assert.deepEqual(r.say.map((x) => x.text), ['Feathers.', 'Hello from your friend!']);
  assert.deepEqual(r.open, {}); assert.equal(r.kb.length, 1);
  assert.equal(f.applyAnswers(open, { answers: [{ id: q.id, answer: 'x' }] }, [q.id]).say.length, 0, 'already shown');
  assert.equal(f.applyAnswers({}, { answers: [{ id: 'q-old', answer: 'x' }] }, []).say.length, 0, 'not asked by this app');
  console.log('kamo-friend checks passed');
})();
