const assert = require('assert');
(async () => {
  const H = await import('../src/hotkey.js');
  assert.equal(H.hotkeyLabel('CommandOrControl+Shift+K'), 'Ctrl+Shift+K');
  assert.equal(H.accelFromEvent({ key: 'k', ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+K');
  assert.equal(H.accelFromEvent({ key: 'F9' }), 'F9');
  assert.equal(H.accelFromEvent({ key: 'a' }), null);
  assert.equal(H.accelFromEvent({ key: 'Control' }), null);
  console.log('hotkey checks passed');
})();
