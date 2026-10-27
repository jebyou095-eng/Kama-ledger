const assert = require('assert'), fs = require('fs');
(async () => {
  const M = await import('../src/capture.js');
  assert.equal(typeof M.createCapture, 'function');
  const src = fs.readFileSync(__dirname + '/../src/capture.js', 'utf8');
  assert.ok(!/\$\('[^']*getEnv\(\)/.test(src), 'no element id was mangled by the move');
  console.log('capture checks passed');
})();
