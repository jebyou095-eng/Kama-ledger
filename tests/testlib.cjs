(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const k = new Function(fs.readFileSync(__dirname + '/../src/testlib.js', 'utf8').replace(/export /g, '') + ';return { CATS, progress, summary, suggest, tagsOf, buildZip, crc32 };')();
  const it = (cat, w, h) => ({ cat, w, h });
  const p = k.progress([it('popup', 1534, 954), it('popup', 1534, 954), it('chart', 898, 625), it('nope', 1, 1)]);
  assert.equal(p.find((x) => x.id === 'popup').need, 28); assert.equal(p.find((x) => x.id === 'popup').needSizes, true, 'one size only');
  assert.equal(p.find((x) => x.id === 'market').n, 0);
  const full = Array.from({ length: 30 }, (_, i) => it('popup', i % 2 ? 1534 : 1920, i % 2 ? 954 : 1080));
  const q = k.progress(full).find((x) => x.id === 'popup'); assert.equal(q.done, true); assert.equal(q.needSizes, false);
  assert.match(k.summary([it('popup', 1, 1)]), /Item popup: 1 \/ 30 \(29 more\) — also needs a second window size/);
  assert.deepEqual(k.suggest(['market', 'popup'], false), ['popup', 'market'], 'a screenshot with a popup and a list gets both tags'); assert.deepEqual(k.suggest([], true), ['chart']); assert.deepEqual(k.suggest(['chat'], false), ['empty']); assert.deepEqual(k.suggest(['market'], false), ['market']);
  // tags: one picture counts once for every tag; old single-category saves still work
  const two = k.progress([{ tags: ['popup', 'market'], w: 1534, h: 954 }, { cat: 'popup', w: 1534, h: 954 }]);
  assert.equal(two.find((x) => x.id === 'popup').n, 2); assert.equal(two.find((x) => x.id === 'market').n, 1); assert.deepEqual(k.tagsOf({ cat: 'chart' }), ['chart']); assert.deepEqual(k.tagsOf({}), ['empty']);
  assert.equal(k.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'crc32 check value');
  // the zip must open with a real unzip tool and give back the same bytes
  const a = new Uint8Array([1, 2, 3, 4, 5]), b = new TextEncoder().encode(JSON.stringify({ ok: true }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-')), z = path.join(dir, 't.zip'); fs.writeFileSync(z, k.buildZip([{ name: 'popup/001.png', data: a }, { name: 'manifest.json', data: b }]));
  execFileSync('unzip', ['-q', '-o', z, '-d', path.join(dir, 'o')]);
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'o/popup/001.png'))], [1, 2, 3, 4, 5]); assert.equal(fs.readFileSync(path.join(dir, 'o/manifest.json'), 'utf8'), '{"ok":true}');
  console.log('testlib checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
