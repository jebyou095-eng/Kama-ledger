#!/usr/bin/env node
// Kama Ledger MCP server: lets Claude, Codex or any MCP tool ask questions about your price list.
// Read-only. It reads kama-snapshot.json, which the Kama Ledger desktop app saves after every change.
// No dependencies: speaks MCP (JSON-RPC, one message per line) on stdin/stdout.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeItem, explainCompare, explainTrend, explainWorth, findItems } from '../src/kamo-ai.js';
import { analyzeMarket } from '../src/kamo-brain.js';

const DAY = 86400000;
function snapshotPath() {
  if (process.env.KAMA_SNAPSHOT) return process.env.KAMA_SNAPSHOT;
  const bases = process.platform === 'win32' ? [process.env.APPDATA] : process.platform === 'darwin' ? [join(homedir(), 'Library', 'Application Support')] : [join(homedir(), '.config')];
  for (const b of bases.filter(Boolean)) for (const n of ['Kama Ledger', 'kama-ledger']) { const f = join(b, n, 'kama-snapshot.json'); if (existsSync(f)) return f; }
  return join(bases[0] || homedir(), 'Kama Ledger', 'kama-snapshot.json');
}
function load() {
  const file = snapshotPath();
  if (!existsSync(file)) throw new Error('No price list found yet (' + file + '). Open Kama Ledger (desktop app) and scan or add an item; it saves the list a few seconds after each change.');
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  snap.ageMin = Math.max(0, Math.round((Date.now() - (snap.at || statSync(file).mtimeMs)) / 60000));
  return snap;
}
const fmt = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('fr-FR') : '-');
const head = (snap) => '(Kama Ledger list saved ' + (snap.ageMin < 2 ? 'just now' : snap.ageMin < 120 ? snap.ageMin + ' min ago' : Math.round(snap.ageMin / 60) + ' h ago') + ', ' + snap.items.length + ' items)\n';

function pick(snap, q) {
  const s = String(q || '').trim();
  if (/^\d+$/.test(s)) { const r = snap.items.find((x) => String(x.id) === s); if (r) return r; }
  const hit = findItems(s, snap.items.map((r) => ({ id: r.id, name: r.name })));
  if (hit.length) return snap.items.find((r) => r.id === hit[0].id);
  const n = s.toLowerCase();
  return snap.items.find((r) => r.name.toLowerCase() === n) || snap.items.find((r) => r.name.toLowerCase().includes(n)) || null;
}
const need = (snap, q) => { const r = pick(snap, q); if (!r) throw new Error('No item matching "' + q + '" in the list. Use search_items to see the names.'); return r; };

// Kamo's inbox: questions he could not answer ("let me ask a friend") and the answers sent back to him. Only these two small files are ever written.
const friendDir = () => dirname(snapshotPath());
const readJsonFile = (f, d) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d; } catch { return d; } };
const writeJsonFile = (f, o) => { const t = f + '.tmp'; writeFileSync(t, JSON.stringify(o)); renameSync(t, f); };
const qFile = () => join(friendDir(), 'kama-questions.json'), aFile = () => join(friendDir(), 'kama-answers.json');
const answered = () => new Set((readJsonFile(aFile(), { answers: [] }).answers || []).map((a) => a.id));
function addAnswer(a) {
  const cur = readJsonFile(aFile(), { v: 1, answers: [] }); cur.answers = (cur.answers || []).filter((x) => x.id !== a.id).concat([a]).slice(-200);
  writeJsonFile(aFile(), cur);
}

const TOOLS = [
  { name: 'kamo_questions', description: 'Questions that Kamo (the in-app assistant) could not answer and asked a friend about. Answer each with kamo_answer.', inputSchema: { type: 'object', properties: {} },
    run() { const done = answered(), q = (readJsonFile(qFile(), { questions: [] }).questions || []).filter((x) => !done.has(x.id)); return q.length ? q.map((x) => x.id + '  ' + x.q).join('\n') : 'Kamo has no open questions.'; } },
  { name: 'kamo_answer', description: 'Answer one of Kamo\'s questions. Kamo shows the answer in his speech bubble (short, friendly, one or two sentences) and remembers it for next time unless remember is false.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, answer: { type: 'string' }, remember: { type: 'boolean' } }, required: ['id', 'answer'] },
    run(_s, a) {
      const q = (readJsonFile(qFile(), { questions: [] }).questions || []).find((x) => x.id === a.id);
      if (!q) throw new Error('No open question with that id. Use kamo_questions to list them.');
      addAnswer({ id: q.id, q: q.q, answer: String(a.answer).slice(0, 600), at: Date.now(), remember: a.remember !== false });
      return 'Sent to Kamo: ' + String(a.answer).slice(0, 80);
    } },
  { name: 'kamo_status', description: 'Technical status saved by the desktop app: build, Kamo provider/model and last Test result, last scan (popup lines, lots, market rows), performance verdict and recent errors. Read this first when something does not work. Never contains keys.', inputSchema: { type: 'object', properties: {} },
    run() { const f = join(friendDir(), 'kama-status.json'); if (!existsSync(f)) return 'No status file yet: open the desktop app (v69 or later) once.'; return readFileSync(f, 'utf8'); } },
  { name: 'kamo_say', description: 'Make Kamo say something in his speech bubble over the game (short and friendly).', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run(_s, a) { addAnswer({ id: 'say:' + Date.now(), answer: String(a.text).slice(0, 600), at: Date.now(), remember: false }); return 'Kamo will say it.'; } },
  { name: 'overview', description: 'Summary of the user\'s Kama Ledger list: item count, budget, waiting prices, stale prices, best craft.', inputSchema: { type: 'object', properties: {} },
    run(snap) {
      const items = snap.items.filter((r) => r.kind === 'item'), stale = snap.items.filter((r) => !r.priceAt || Date.now() - r.priceAt > 3 * DAY);
      const best = items.filter((r) => r.craftProfit > 0).sort((a, b) => b.craftProfit - a.craftProfit)[0];
      return head(snap) + 'Budget: ' + (snap.budget ? fmt(snap.budget) : 'unknown') + ' kamas\nTracked items (craftable): ' + items.length + ', ingredients: ' + (snap.items.length - items.length) + '\nPrices waiting for approval in the app: ' + snap.pending + '\nOlder than 3 days or missing: ' + stale.length + '\nBest craft: ' + (best ? best.name + ' (profit ' + fmt(best.craftProfit) + ')' : 'none with a profit');
    } },
  { name: 'search_items', description: 'Find items in the list by part of a name.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run(snap, a) { const q = String(a.query || '').toLowerCase(), r = snap.items.filter((x) => x.name.toLowerCase().includes(q)).slice(0, a.limit || 15); return head(snap) + (r.length ? r.map((x) => x.id + '  ' + x.name + (x.kind === 'item' ? ' [craft]' : ' [ingredient]') + '  ' + (x.price ? fmt(x.price) : 'no price')).join('\n') : 'Nothing matches.'); } },
  { name: 'get_item', description: 'Everything known about one item (by name or id): price and age, lots, recipe with ingredient prices, craft cost and profit, equipment clean-roll price.', inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    run(snap, a) {
      const r = need(snap, a.item), d = r.priceAt ? Math.floor((Date.now() - r.priceAt) / DAY) : null;
      let s = head(snap) + r.name + ' (#' + r.id + ', ' + (r.kind === 'item' ? 'craftable' : 'ingredient') + (r.level ? ', level ' + r.level : '') + ')\nPrice: ' + (r.price ? fmt(r.price) + ' kamas' + (d !== null ? ', ' + (d === 0 ? 'today' : d + ' days old') : '') : 'none yet');
      if (r.avgPrice) s += '\nMarket average seen: ' + fmt(r.avgPrice);
      if (r.sold != null) s += '\nSold: ' + r.sold;
      if (r.lots && Object.keys(r.lots).length) s += '\nLots: ' + Object.entries(r.lots).map(([k, v]) => 'x' + k + ' = ' + fmt(v)).join(', ');
      if (r.recipe && r.recipe.length) s += '\nRecipe:\n' + r.recipe.map((g) => '  ' + g.qty + ' x ' + g.name + (g.price ? ' (' + fmt(g.price) + ')' : ' (no price)')).join('\n');
      if (r.craftCost != null) s += '\nCraft cost ' + fmt(r.craftCost) + (r.craftProfit != null ? ', profit ' + fmt(r.craftProfit) : '');
      if (r.jetClean) s += '\nEquipment: price is the cheapest clean-roll listing (' + fmt(r.jetClean.price) + ').' + (r.jetSpecial && r.jetSpecial.length ? ' Forged or exo listings seen: ' + r.jetSpecial.map((x) => fmt(x.price)).join(', ') + '.' : '');
      return s;
    } },
  { name: 'price_history', description: 'Price history of one item, oldest first, with usual price and trend.', inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    run(snap, a) { const r = need(snap, a.item), h = (r.history || []).filter((p) => p[1] > 0); return head(snap) + explainTrend(analyzeItem(r, Date.now())) + (h.length ? '\nHistory:\n' + h.slice(-30).map((p) => '  ' + new Date(p[0]).toISOString().slice(0, 10) + '  ' + fmt(p[1])).join('\n') : ''); } },
  { name: 'should_buy', description: 'Is now a good moment to buy (or sell) this item, compared with its usual price?', inputSchema: { type: 'object', properties: { item: { type: 'string' }, sell: { type: 'boolean' } }, required: ['item'] },
    run(snap, a) { return head(snap) + explainWorth(analyzeItem(need(snap, a.item), Date.now()), !!a.sell); } },
  { name: 'compare', description: 'Compare two items: which is the better buy now.', inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
    run(snap, a) { return head(snap) + explainCompare(analyzeItem(need(snap, a.a), Date.now()), analyzeItem(need(snap, a.b), Date.now())); } },
  { name: 'movers', description: 'Items whose price moved recently (default last 7 days, at least 10%).', inputSchema: { type: 'object', properties: { days: { type: 'number' }, min_percent: { type: 'number' } } },
    run(snap, a) { const m = analyzeMarket(snap.items, Date.now(), { horizonDays: a.days || 7, moveMin: (a.min_percent || 10) / 100 }).movers.slice(0, 15); return head(snap) + (m.length ? m.map((x) => x.name + ': ' + (x.dir === 'up' ? '+' : '-') + x.pct + '% (' + fmt(x.from) + ' -> ' + fmt(x.to) + ')').join('\n') : 'Nothing moved that much.'); } },
  { name: 'bargains', description: 'Items currently priced well under their own usual price.', inputSchema: { type: 'object', properties: {} },
    run(snap) { const b = analyzeMarket(snap.items, Date.now()).bargains.slice(0, 15); return head(snap) + (b.length ? b.map((x) => x.name + ': ' + fmt(x.price) + ' is ' + x.pct + '% under its usual ' + fmt(x.avg)).join('\n') : 'No bargain right now.'); } },
  { name: 'best_crafts', description: 'The most profitable crafts at the current prices.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    run(snap, a) { const t = snap.items.filter((r) => r.kind === 'item' && r.craftProfit > 0).sort((x, y) => y.craftProfit - x.craftProfit).slice(0, a.limit || 5); return head(snap) + (t.length ? t.map((r, i) => (i + 1) + '. ' + r.name + '  profit ' + fmt(r.craftProfit) + ' (cost ' + fmt(r.craftCost) + ', sells ' + fmt(r.price) + ')').join('\n') : 'No craft shows a profit with the prices known.'); } },
  { name: 'stale_prices', description: 'Prices that are missing or old and should be scanned again.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    run(snap, a) { const o = snap.items.map((r) => ({ r, d: r.priceAt ? Math.floor((Date.now() - r.priceAt) / DAY) : 9999 })).filter((x) => x.d >= 3).sort((x, y) => y.d - x.d).slice(0, a.limit || 15); return head(snap) + (o.length ? o.map((x) => x.r.name + (x.d === 9999 ? ' (no price)' : ' (' + x.d + ' d)')).join('\n') : 'All prices are fresh.'); } },
];

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }
export function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return reply(id, { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'kama-ledger', version: '1.0.0' }, instructions: 'Read-only view of the user\'s Dofus price list (Kama Ledger). The only things that can be written are answers to Kamo (kamo_answer, kamo_say). Prices are in kamas. Equipment prices are the cheapest clean-roll listing; forged and exo listings are kept apart.' });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === (params && params.name));
    if (!t) return fail(id, -32602, 'Unknown tool');
    try { return reply(id, { content: [{ type: 'text', text: t.run(t.name.startsWith('kamo_') ? null : load(), (params && params.arguments) || {}) }] }); }
    catch (e) { return reply(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
  }
  if (id !== undefined) fail(id, -32601, 'Method not found');   // notifications (no id) get no answer
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch (e) { fail(null, -32700, 'Parse error'); } } } });
