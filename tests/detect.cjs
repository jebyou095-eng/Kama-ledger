const assert = require('node:assert/strict');
const fs = require('fs');
(async () => {
  const d = await import('../src/detect.js');
  const load = (n) => JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/' + n + '-words.json', 'utf8'));
  const f1 = d.detectPanels(load('f1').words), f2 = d.detectPanels(load('f2').words), f3 = d.detectPanels(load('f3').words), f4 = d.detectPanels(load('f4').words);
  const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  // frame 1 (1600x900): every panel found, at the right place
  assert.deepEqual(Object.keys(f1).sort(), ['budget', 'chat', 'market', 'popup', 'recipe']);
  assert.equal(f1.market.rows.length, 6, 'six market rows');
  assert.ok(inside(f1.market.box, 600, 200) && inside(f1.market.box, 800, 380), 'market box covers the rows');
  assert.ok(inside(f1.popup.box, 1000, 260) && inside(f1.popup.box, 1100, 330), 'popup box');
  assert.ok(inside(f1.recipe.box, 250, 205), 'recipe box covers the item name');
  assert.ok(inside(f1.chat.box, 40, 775) && inside(f1.chat.box, 300, 790), 'chat box');
  assert.ok(inside(f1.budget.box, 1500, 825) , 'budget box');
  // frame 2 (1920x1080, different position and a 1.3x interface): same panels, found independently of layout
  ['market', 'popup', 'recipe'].forEach((k) => assert.ok(f2[k], 'f2 ' + k));
  assert.equal(f2.market.rows.length, 6);
  assert.ok(f2.market.rows[0].cy < f2.market.rows[5].cy);
  assert.ok(f2.market.pitch > f1.market.pitch * 1.2, 'row pitch follows the interface scale');
  // frame 3: only the popup and the chat exist, nothing else is invented
  assert.ok(f3.popup && !f3.market && !f3.recipe && !f3.budget, 'f3 popup only');
  // frame 4: no panel, nothing detected
  assert.deepEqual(Object.keys(f4), []);
  console.log('panel detection checks passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
