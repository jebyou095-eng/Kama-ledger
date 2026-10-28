// The test gate for Kamo's skills: every skill must be well formed, own its examples exactly, and never overlap another skill.
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  let src = fs.readFileSync(__dirname + '/../src/kamo-skills.js', 'utf8').replace(/^import SKILLS.*$/m, '');
  const data = JSON.parse(fs.readFileSync(__dirname + '/../src/skills/skills.json', 'utf8'));
  src = 'const SKILLS = ' + JSON.stringify(data) + ';\n' + src.replace(/export \{ SKILLS \};/, '').replace(/export /g, '');
  const k = new Function(src + ';return { extract, COMPUTE, runSkill, fill };')();
  const norm = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ');
  const ids = new Set();
  data.forEach((s) => {
    assert.ok(/^[a-z]+$/.test(s.id) && !ids.has(s.id), 'unique id ' + s.id); ids.add(s.id);
    assert.ok(typeof k.COMPUTE[s.compute] === 'function', s.id + ': unknown function');
    assert.ok(s.keywords.length && s.numbers.length && s.title && s.reply, s.id + ': incomplete');
    assert.ok(s.examples && s.examples.length >= 1, s.id + ': a skill needs at least one example');
    s.examples.forEach((e) => {
      const r = k.runSkill(e.ask, data);
      assert.ok(r, s.id + ': example does not fire: ' + e.ask);
      assert.equal(r.id, s.id, s.id + ': example fires another skill (' + r.id + '): ' + e.ask);
      assert.equal(norm(r.text), norm(e.reply), s.id + ': wrong reply for ' + e.ask);
      assert.ok(!/\{\w+\}/.test(r.text) && !/NaN|undefined|Infinity/.test(r.text), s.id + ': unfilled reply');
    });
  });
  // ordinary talk must never be taken by a skill
  ['hello', 'what are the best crafts', 'is Noix de Kokoko worth buying', 'what changed', 'profit', 'how much each'].forEach((q) => assert.equal(k.runSkill(q, data), null, 'must not fire: ' + q));
  assert.deepEqual(k.extract('buy 1,5k sell 2m tax 2%'), { nums: [1500, 2000000], pct: 2 });
  assert.equal(k.runSkill('100 each for 0 qty', data), null, 'division by zero is refused');
  console.log('skills gate passed (' + data.length + ' skills)');
})().catch((e) => { console.error(e); process.exit(1); });
