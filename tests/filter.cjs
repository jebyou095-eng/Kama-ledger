const assert = require('node:assert/strict');
(async () => {
  const { checkPrice, checkLots, priceProfile } = await import('../src/filter.js');
  const rec = { price: 69, history: [[1, 69], [2, 70], [3, 68], [4, 69]] };
  assert.equal(priceProfile(rec).n, 4);
  // normal moves are accepted
  assert.equal(checkPrice(75, [75, 75], rec).status, 'ok');
  assert.equal(checkPrice(130, [], rec).status, 'ok');
  // the real failure in the v27 diagnostics: price 5 although 69 was read by the other passes
  const fixed = checkPrice(5, [null, 69, 69, 5, 69], rec);
  assert.equal(fixed.status, 'fixed'); assert.equal(fixed.price, 69);
  // nothing in the reads agrees with history: flagged, never silently saved
  const sus = checkPrice(5, [5, 4], rec);
  assert.equal(sus.status, 'suspect'); assert.match(sus.reason, /usually costs about 69/);
  // zero or missing prices are rejected, a first sighting is accepted
  assert.equal(checkPrice(0, [0], rec).status, 'bad');
  assert.equal(checkPrice(500, [], { price: null, history: [] }).status, 'new');
  // a volatile item gets a wider band
  const vol = { price: 100, history: [[1, 40], [2, 100], [3, 180], [4, 100]] };
  assert.equal(checkPrice(220, [], vol).status, 'ok');
  // lots: the real Galet popup is fine, a lot of 1 at 49 against an average of 2736 is not
  assert.deepEqual(checkLots({ 1: 4953, 10: 49776, 100: 299555, 1000: 2999982 }, 2736).bad, []);
  assert.deepEqual(checkLots({ 1: 49, 10: 27000 }, 2736).bad, [1]);
  assert.deepEqual(checkLots({ 1: 1258, 10: 14588, 100: 149999 }, 1510).bad, []);
  assert.deepEqual(checkLots({ 1: 4000 }, 127848).bad, [1]);
  assert.deepEqual(checkLots({ 1: 4000 }, 127848, { 1: [4000, 100000, 190000] }).bad, []);
  console.log('filter checks passed');
})();
