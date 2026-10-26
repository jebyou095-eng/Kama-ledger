(async () => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const { parseTooltip, classify, learnBase } = await import('../src/jet.js');
  const { detectTooltip } = await import('../src/detect.js');
  const t1 = ['(e Talisman Songe ;', 'Niveau 200 +  Amulette ,', 'PA 204 °', 'STATUT |', '& Empêche les futures forgemagies', 'c', 'EFFETS u', '= 2% Critique', '« 289 Vitalité €', 'Ÿ 57 Force 4', '# 1PA \'', '@ 15 Dommages Neutre', 'æ 3% Résistance Air |', '+“ O Tacle', 'niHnemnes GA AA q'];
  const t2 = ['2. Talisman Songe', 'EFFETS', '« 300 Vitalité €', 'Ÿ 59 Force |', '# 1PA', 'D 9 Prospection', '@ 14 Dommages Neutre', '@ 8% Résistance Air ‘', 'w 8 Tacie', 'de 15 Dommages Critiques ‘', '10e A ;'];
  const a = parseTooltip(t1), b = parseTooltip(t2);
  assert.equal(a.statut, true); assert.equal(b.statut, false);
  assert.deepEqual(a.stats.map((s) => [s.label, s.value, s.pct]), [['Critique', 2, true], ['Vitalité', 289, false], ['Force', 57, false], ['PA', 1, false], ['Dommages Neutre', 15, false], ['Résistance Air', 3, true], ['Tacle', 0, false]]);
  assert.deepEqual(b.stats.map((s) => s.value), [300, 59, 1, 9, 14, 8, 8, 15]);
  // a clean listing teaches the usual stat list; the forged one then shows its extra stat
  const base = learnBase([], b);
  assert.equal(classify(b, base).modified, false);
  const c = classify(a, base);
  assert.equal(c.modified, true); assert.deepEqual(c.exo, ['Critique']);
  assert.equal(classify(parseTooltip(['EFFETS', '3 Vitalité']), []).modified, false);
  for (const f of ['tt1', 'tt2']) {
    const words = JSON.parse(fs.readFileSync(__dirname + '/fixtures/frames/' + f + '-words.json', 'utf8')).words;
    const d = detectTooltip(words);
    assert.ok(d, f); assert.equal(d.statut, f === 'tt1');
    assert.ok(d.box.x > 440 && d.box.x < 470 && d.box.w > 250 && d.box.y < 430 && d.box.y + d.box.h > 780 && d.box.y + d.box.h < 810, f + ' box ' + JSON.stringify(d.box));
  }
  console.log('jet checks passed');
})();
