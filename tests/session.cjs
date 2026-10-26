const assert = require('node:assert/strict');
(async () => {
  const { STEPS, newSession, onEvent, report } = await import('../src/session.js');
  let t = 0; const s = newSession(t);
  const scan = (o) => onEvent(s, Object.assign({ type: 'scan', ms: 1000 }, o), (t += 5000));
  // out-of-order events do nothing: a scan before sharing is ignored
  scan({ market: { rows: 8, cached: 0 } }); assert.equal(s.step, 0);
  onEvent(s, { type: 'share' }, (t += 1000)); assert.equal(s.step, 1);
  scan({ market: { rows: 8, cached: 0 }, ms: 4200 }); assert.equal(s.step, 2);
  scan({ market: { rows: 8, cached: 3 } }); assert.equal(s.step, 2, 'partly reused is not "same screen"'); assert.match(s.hint, /5 of 8/);
  scan({ market: { rows: 8, cached: 8 }, ms: 60 }); assert.equal(s.step, 3);
  scan({ market: { rows: 8, cached: 8 } }); assert.equal(s.step, 3, 'a scroll needs new rows');
  scan({ market: { rows: 8, cached: 4 } }); assert.equal(s.step, 4);
  scan({ market: { rows: 8, cached: 8 }, popup: { id: 'Galet', lots: 4 } }); assert.equal(s.step, 5);
  scan({ market: { rows: 8, cached: 8 }, popup: { id: 'Galet', lots: 4 } }); assert.equal(s.step, 5, 'same item again is not a different item');
  scan({ market: { rows: 8, cached: 8 }, popup: { id: 'Viande', lots: 2 } }); assert.equal(s.step, 6);
  scan({ market: { rows: 8, cached: 8 }, popup: { id: 'Viande', lots: 2 } }); assert.equal(s.step, 6, 'popup still open');
  scan({ market: { rows: 8, cached: 8 } }); assert.equal(s.step, 7);
  scan({ market: { rows: 8, cached: 8 } }); assert.equal(s.step, 7, 'chat step needs chat');
  scan({ market: { rows: 8, cached: 8 }, chat: true }); assert.equal(s.step, 8);
  [3000, 800, 400, 300, 250].forEach((ms) => scan({ ms })); assert.equal(s.step, 9);
  assert.deepEqual(s.done[8].runMs, [3000, 800, 400, 300, 250]);
  onEvent(s, { type: 'diag', ms: 30000 }, (t += 1000)); assert.equal(s.step, STEPS.length); assert.ok(s.end);
  const r = report(s, t, 'v36'); assert.match(r, /10\. Diagnostics file \| done/); assert.match(r, /3\.0 \/ 0\.8/);
  console.log('guided session checks passed');
})();
