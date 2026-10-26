(async () => {
  const assert = require('node:assert/strict');
  const { planBlips } = await import('../src/kamo-sound.js');
  const a = planBlips('Scanned! Hover the next one?', 'happy'), b = planBlips('Scanned! Hover the next one?', 'happy');
  assert.deepEqual(a, b, 'same words, same chirps');
  assert.equal(a.length, 5);
  assert.ok(a.every((x) => x.freq > 380 && x.freq < 2000 && x.dur > 0 && x.dur <= 0.09));
  assert.ok(a[4].glide > 1, 'a question ends upward');
  assert.ok(planBlips('hello', 'sad')[0].freq < planBlips('hello', 'happy')[0].freq, 'sad is lower');
  assert.equal(planBlips('', 'idle').length, 0);
  assert.equal(planBlips('un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze', 'idle').length, 12);
  // every fixed line of his has a recording; lines with changing parts get a reaction clip by mood
  const { voiceFile, reactFiles } = await import('../src/kamo-sound.js');
  const { LINES } = await import('../src/kamo-brain.js');
  const fs = require('node:fs'), path = require('node:path');
  let n = 0;
  for (const v of Object.values(LINES)) for (const arr of v) for (const t of arr) if (!/\{\w+\}/.test(t)) { const f = voiceFile(t); assert.ok(f, 'no recording for: ' + t); assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'voice', f)), f); n++; }
  assert.ok(n >= 150);
  assert.ok(voiceFile('Wait a minute, let me ask a friend…'));
  assert.equal(voiceFile('Ocre jumped 12% today'), null);
  ['happy', 'think', 'sad', 'scan', 'idle'].forEach((m) => { assert.ok(reactFiles(m).length >= 1, m); reactFiles(m).forEach((f) => assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'voice', f)))); });
  const { envOf } = await import('../src/kamo-sound.js');
  assert.ok(envOf(voiceFile('Wait a minute, let me ask a friend…')).length > 10, 'loudness is stored for lip-sync');
  assert.ok(/^[0-9]+$/.test(envOf(voiceFile('Zzz... five more minutes...'))));
  const T = await import('../src/kamo-tts.js');
  assert.strictEqual(T.speakable('Ocre +12% (1 200 000 → 1350)'), 'Ocre plus 12 percent, 1200000 to 1350,');
  assert.deepStrictEqual(T.toTokens('hˈɛloʊ').slice(0, 1), [0]);
  assert.ok(T.chunkText('One. Two, three! ' + 'word '.repeat(80)).every((c) => c.length <= 230));
  assert.strictEqual(T.envFromAudio(new Float32Array(24000).fill(0.5), 24000, 1).length, 20);
  assert.ok(voiceFile('Zzz... five more minutes...'), 'the snore line is recorded');
  console.log('kamo-sound checks passed');
})();
