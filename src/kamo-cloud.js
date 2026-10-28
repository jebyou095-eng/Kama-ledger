// Kamo's free-cloud tier: when his notebook has no answer, he asks a free online model (Groq first, then SambaNova, then Gemini) with YOUR key.
// Pure logic: builds a tiny prompt, tries the providers in order, cools a provider down when it says "too many requests".
// The real HTTP call is made by the Electron main process (IPC brain:chat), so the page never needs network access and keys never touch a URL.
import { findItems } from './kamo-ai.js';

// Order = who is tried first. Model names change over time at the providers, so they are editable in the settings box.
export const PROVIDERS = [
  { id: 'groq', label: 'Groq', model: 'llama-3.3-70b-versatile', help: 'console.groq.com → API Keys' },
  { id: 'sambanova', label: 'SambaNova', model: 'Meta-Llama-3.3-70B-Instruct', help: 'cloud.sambanova.ai → API' },
  { id: 'gemini', label: 'Gemini', model: 'gemini-2.5-flash', help: 'aistudio.google.com → Get API key' },
];

const SYSTEM = 'You are Kamo, a cute little gold coin who helps a player track their Dofus market (prices in kamas). '
  + 'Answer in at most 2 short, friendly sentences, in the language of the question. '
  + 'Use the CONTEXT numbers when they are given; never invent prices. If you do not know, say so briefly. '
  + 'You only talk: you never click or type in the game.';

// Only the items the question talks about, a few numbers each. Never the whole ledger.
// snap: [{ id, name, price, priceAt, history }]; analyze: (rec) => { price, ageDays, median, verdict, week }; extra: (rec) => { cost, profit } | null
export function pickContext(question, snap, analyze, extra) {
  const names = (snap || []).map((r) => ({ id: r.id, name: r.name }));
  const found = findItems(question, names).slice(0, 3), by = new Map((snap || []).map((r) => [r.id, r]));
  const items = found.map((f) => {
    const rec = by.get(f.id); if (!rec) return null;
    const a = analyze(rec) || {}, x = (extra && extra(rec)) || {};
    const o = { name: rec.name };
    if (a.price) o.price = a.price; if (a.ageDays !== null && a.ageDays !== undefined) o.ageDays = a.ageDays;
    if (a.median) o.median = a.median; if (a.week !== null && a.week !== undefined) o.weekPct = a.week;
    if (x.cost) o.craftCost = x.cost; if (x.profit !== null && x.profit !== undefined) o.craftProfit = x.profit;
    return { id: rec.id, o };
  }).filter(Boolean);
  return { ids: items.map((i) => i.id), items: items.map((i) => i.o) };
}

export function buildMessages(question, ctx) {
  const q = String(question || '').trim().slice(0, 300);
  const c = ctx && ctx.items && ctx.items.length ? '\nCONTEXT (the player\'s own prices): ' + JSON.stringify(ctx.items) : '';
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: q + c }];
}

// Keep it short and plain: no markdown, at most ~2 sentences / 400 characters.
export function tidy(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > 400) { const cut = t.slice(0, 400), k = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); t = k > 120 ? cut.slice(0, k + 1) : cut.replace(/\s\S*$/, '') + '…'; }
  return t;
}

// settings: { keys: { groq: '...' }, models: { groq: '...' } }. transport(req) => Promise<{ ok, text, status, retryAfter, error }>
export function createCascade(transport, opts) {
  const o = Object.assign({ cooldown: 60000, badKey: 3600000, now: () => Date.now() }, opts);
  const until = {}, state = {};
  const model = (p, s) => ((s.models && s.models[p.id]) || p.model || '').trim();
  const usable = (s) => PROVIDERS.filter((p) => ((s.keys && s.keys[p.id]) || '').trim().length >= 8);
  async function one(p, s, messages) {
    let r; try { r = await transport({ provider: p.id, key: s.keys[p.id].trim(), model: model(p, s), messages }); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    if (r && r.ok && tidy(r.text)) { until[p.id] = 0; state[p.id] = 'ok'; return { ok: true, text: tidy(r.text), provider: p.id }; }
    const st = (r && r.status) || 0;
    if (st === 429 || st >= 500) { until[p.id] = o.now() + Math.max(o.cooldown, (r.retryAfter || 0) * 1000); state[p.id] = st === 429 ? 'busy' : 'down'; }
    else if (st === 401 || st === 403) { until[p.id] = o.now() + o.badKey; state[p.id] = 'key'; }
    else state[p.id] = st === 400 || st === 404 ? 'model' : 'error';
    return { ok: false, status: st, error: (r && r.error) || '', detail: (r && r.detail) || '', provider: p.id };
  }
  return {
    configured: (s) => usable(s).length > 0,
    // first provider that answers wins; the rest are tried only after a failure
    async ask(question, ctx, s) {
      const messages = buildMessages(question, ctx), tried = [];
      for (const p of usable(s)) {
        if ((until[p.id] || 0) > o.now()) { tried.push({ provider: p.id, skipped: true }); continue; }
        const r = await one(p, s, messages); if (r.ok) return r; tried.push(r);
      }
      return { ok: false, tried };
    },
    // the "Test" button: one provider, a tiny request, a human reason when it fails
    async test(id, s) {
      const p = PROVIDERS.find((x) => x.id === id); if (!p) return { ok: false, why: 'Unknown provider.' };
      if (!((s.keys && s.keys[id]) || '').trim()) return { ok: false, why: 'Paste a key first.' };
      until[id] = 0;
      const r = await one(p, s, [{ role: 'user', content: 'Say hello in three words.' }]);
      return r.ok ? { ok: true, why: 'Works: "' + r.text.slice(0, 60) + '"' } : { ok: false, why: reason(r) };
    },
    status: () => ({ ...state }),
  };
}

export function reason(r) {
  const st = r.status || 0;
  if (st === 401 || st === 403) return 'The key was refused. Check that you copied it fully.';
  if (st === 429) return 'Rate limit reached. Wait a minute and try again.';
  if (st === 400 || st === 404) return 'The model name was not accepted. Check it in the box.' + (r.detail ? ' Groq says: ' + r.detail : '');
  if (st >= 500) return 'The service is having trouble. Try later.';
  return r.error ? 'No answer: ' + String(r.error).slice(0, 80) : 'No answer. Check your internet.';
}
