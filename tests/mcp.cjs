(async () => {
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const DAY = 86400000, now = Date.now();
  const h = (vals) => vals.map((v, i) => [now - (vals.length - i) * 2 * DAY, v]);
  const snap = { v: 1, at: now, budget: 5296226, pending: 2, items: [
    { id: 3, name: 'Ocre', kind: 'ingredient', price: 80, priceAt: now - DAY, history: h([100, 102, 98, 101, 99, 80]), recipe: [] },
    { id: 2, name: 'Talisman Songe', kind: 'item', level: 200, price: 2700000, priceAt: now, history: h([2700000, 2750000]), jetClean: { price: 2700000 }, jetSpecial: [{ price: 2698999 }], recipe: [{ id: 3, name: 'Ocre', qty: 4, price: 80 }], craftCost: 320, craftProfit: 2699680 },
  ] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kama-')), 'kama-snapshot.json'); fs.writeFileSync(file, JSON.stringify(snap));
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'kama-mcp.mjs')], { env: { ...process.env, KAMA_SNAPSHOT: file } });
  const out = []; let buf = ''; p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const wait = async (id) => { for (let i = 0; i < 100; i++) { const r = out.find((x) => x.id === id); if (r) return r; await new Promise((r2) => setTimeout(r2, 50)); } throw new Error('no reply ' + id); };
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await wait(1)).result.serverInfo.name, 'kama-ledger');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (await wait(2)).result.tools.map((t) => t.name);
  ['overview', 'search_items', 'get_item', 'price_history', 'should_buy', 'compare', 'movers', 'bargains', 'best_crafts', 'stale_prices'].forEach((n) => assert.ok(tools.includes(n), n));
  const call = async (id, name, args) => { send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); const r = await wait(id); return r.result.content[0].text; };
  assert.match(await call(3, 'overview', {}), /Budget: 5.296.226/);
  assert.match(await call(4, 'get_item', { item: 'talisman songe' }), /clean-roll listing/);
  assert.match(await call(5, 'should_buy', { item: 'ocre' }), /Good moment to buy Ocre/);
  assert.match(await call(6, 'movers', {}), /Ocre: -/);
  assert.match(await call(7, 'best_crafts', {}), /Talisman Songe/);
  send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_item', arguments: { item: 'zzzz' } } });
  assert.equal((await wait(8)).result.isError, true);
  // Kamo's inbox
  fs.writeFileSync(path.join(path.dirname(file), 'kama-questions.json'), JSON.stringify({ v: 1, questions: [{ id: 'q1', q: 'what drops from the Tofu?', at: 1 }] }));
  assert.match(await call(9, 'kamo_questions', {}), /q1  what drops/);
  assert.match(await call(10, 'kamo_answer', { id: 'q1', answer: 'Feathers!' }), /Sent to Kamo/);
  const ans = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'kama-answers.json'), 'utf8')).answers;
  assert.equal(ans[0].answer, 'Feathers!'); assert.equal(ans[0].q, 'what drops from the Tofu?');
  assert.match(await call(11, 'kamo_questions', {}), /no open questions/);
  await call(12, 'kamo_say', { text: 'Hello!' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'kama-answers.json'), 'utf8')).answers.some((a) => a.id.startsWith('say:')));
  send({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'kamo_answer', arguments: { id: 'nope', answer: 'x' } } });
  assert.equal((await wait(13)).result.isError, true);
  p.kill();
  console.log('mcp checks passed');
})();
