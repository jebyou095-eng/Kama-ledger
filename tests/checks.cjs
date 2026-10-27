const assert = require('assert');
(async () => {
  const M = await import('../src/checks.js');
  assert.equal(typeof M.createChecks, 'function');
  console.log('checks checks passed');
})();
