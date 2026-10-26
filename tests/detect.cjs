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
// Regression: words straight from the real OCR engine (not hand-saved). The market list's own "Prix moyen" header used to be taken
// for the popup's, which anchored the popup box 100 px too far left and cut the bottom lot row off.
(async () => {
  const d = await import('../src/detect.js'), fs = require('fs'), assert = require('node:assert/strict');
  const live = (n) => JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/' + n + '-live-words.json', 'utf8')).words;
  const f1 = d.detectPanels(live('f1')), p = f1.popup.box, m = f1.market.box;
  assert.ok(p.x >= m.x + m.w, 'popup starts to the right of the market list (no overlap)');
  assert.ok(p.x > 880 && p.x < 915, 'popup left edge near 900, was ' + p.x);
  assert.ok(p.y > 185 && p.y < 210, 'popup top near 200, was ' + p.y);
  assert.ok(p.x + p.w > 1130 && p.x + p.w < 1160, 'popup right edge near 1146');
  assert.ok(p.y + p.h >= 368, 'popup includes the 1 000 lot row (ends near 372), ended at ' + (p.y + p.h));
  const f2 = d.detectPanels(live('f2')); assert.ok(f2.popup && f2.popup.box.x > f2.market.box.x + f2.market.box.w, 'f2: popup right of market');
  const f3 = d.detectPanels(live('f3')); assert.ok(f3.popup && !f3.market, 'f3: popup only');
  console.log('live OCR popup checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
// Regression on a REAL game screen (Dofus 3 UI, 1920x1200, from a user's diagnostics file): the market table has a filter sidebar
// (NIVEAUX / CATEGORIES) on its left, and stray digits in the price column. Truth: 8 rows, "Nom" column at x~899.
(async () => {
  const d = await import('../src/detect.js'), fs = require('fs'), assert = require('node:assert/strict');
  const real = (n) => JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/real-' + n + '-words.json', 'utf8')).words;
  const f0 = d.detectPanels(real('f0')), m = f0.market;
  assert.equal(m.rows.length, 8, 'eight market rows, no phantom row from stray digits');
  assert.ok(m.cols.nameX0 > 880 && m.cols.nameX0 < 905, 'name column starts at the Nom header (~896), not in the sidebar; was ' + m.cols.nameX0);
  assert.ok(m.box.x > 800, 'market box excludes the filter sidebar; box.x was ' + m.box.x);
  const ys = m.rows.map((r) => r.cy), truth = [362, 436, 511, 588, 663, 737, 813, 889];
  truth.forEach((t, i) => assert.ok(Math.abs(ys[i] - t) < 12, 'row ' + i + ' at ' + t + ', got ' + ys[i]));
  assert.ok(f0.popup && f0.popup.box.y <= 442, 'popup box includes the item title line');
  const f1 = d.detectPanels(real('f1')); assert.ok(f1.popup && !f1.market, 'second real frame: popup only');
  console.log('real game screen checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

// Real screen from a diagnostics file: the popup lists four lots (1, 10, 100, 1000); the box must reach the last one,
// and the chat is found even when its timestamps were not read.
(async () => {
  const d = await import('../src/detect.js');
  const load = (n) => JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/' + n + '-words.json', 'utf8')).words;
  const p = d.detectPanels(load('real-f2'));
  assert.ok(p.popup, 'popup found');
  assert.ok(p.popup.box.y + p.popup.box.h >= 765, 'popup box reaches the 1000 lot row (y 755-765), got bottom ' + (p.popup.box.y + p.popup.box.h));
  const nostamp = load('real-f2').filter((w) => !/^[\[(]\d{1,2}[:.;]\d{2}[\])]$/.test(w.text));
  assert.ok(d.detectPanels(nostamp).chat, 'chat found without timestamps');
  console.log('four-lot popup + chat fallback checks passed');
})();

(async () => {
  const d = await import('../src/detect.js');
  const w = JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/real-f3-words.json', 'utf8')).words;
  const b = d.detectPanels(w).popup.box;
  assert.ok(b.y <= 384, 'popup box includes the item name line (y 384), top is ' + b.y);
  console.log('popup title line checks passed');
})();
