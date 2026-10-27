const assert = require('assert');
(async () => {
  const M = await import('../src/livescan.js');
  assert.equal(typeof M.createLiveScan, 'function');
  console.log('livescan checks passed');
})();
