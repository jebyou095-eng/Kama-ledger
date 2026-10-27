// Kamo's notebook: every answer he got from a higher tier (a friend, a free cloud model, you) is kept, so the same question never needs
// that tier twice. Questions are matched by meaning-ish (synonyms, word pairs, letter groups), offline, with no model download.
// Pure logic; the page gives it a place to save.
import { nrm } from './kamo-brain.js';

const DIM = 1024;
const STOP = new Set('the a an of for to is it me my i you what whats how do does did can should and or ou et le la les un une de du des est que qui quel quelle combien pour moi mon ma mes this that in on at with about now today please kamo tell give show are was be been there their much many how comment'.split(' '));
// words that mean the same thing for a market helper
const SYN = {};
[['price', 'prices', 'cost', 'costs', 'costing', 'worth', 'value', 'prix', 'coute', 'couter', 'valeur', 'tarif'], ['buy', 'buying', 'bought', 'purchase', 'acheter', 'achete', 'achat'], ['sell', 'selling', 'sold', 'vendre', 'vend', 'vente'],
  ['cheap', 'cheaper', 'cheapest', 'bargain', 'bargains', 'affaire', 'deal', 'deals', 'soldes'], ['dear', 'expensive', 'pricey', 'cher'], ['profit', 'profits', 'gain', 'gains', 'benefit', 'benefice', 'margin', 'rentable', 'profitable'],
  ['craft', 'crafts', 'crafting', 'craftable', 'fabriquer', 'fabrication'], ['up', 'rise', 'rising', 'increase', 'increased', 'hausse', 'monte', 'monter'], ['down', 'fall', 'falling', 'drop', 'dropped', 'decrease', 'baisse', 'baisser'],
  ['best', 'top', 'better', 'meilleur', 'meilleure', 'mieux'], ['recipe', 'recipes', 'ingredient', 'ingredients', 'recette', 'recettes'], ['quest', 'quests', 'quete', 'quetes'], ['where', 'ou', 'find', 'locate', 'trouver', 'trouve', 'location']]
  .forEach((g) => g.forEach((w) => { SYN[w] = g[0]; }));
const stem = (w) => (w.length > 5 && /(ing|ed)$/.test(w) ? w.replace(/(ing|ed)$/, '') : w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
export const words = (s) => nrm(s).replace(/['’]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map((t) => SYN[t] || SYN[stem(t)] || stem(t));
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % DIM; };

export function vectorize(text) {
  const w = words(text), v = new Map(), add = (k, x) => { const i = hash(k); v.set(i, (v.get(i) || 0) + x); };
  w.forEach((t, i) => { add('w:' + t, 1); if (i) add('b:' + w[i - 1] + '_' + t, 0.6); if (t.length > 4) for (let j = 0; j + 3 <= t.length; j++) add('c:' + t.slice(j, j + 3), 0.25); });
  let n = 0; v.forEach((x) => { n += x * x; }); n = Math.sqrt(n) || 1;
  return { v, n, count: w.length };
}
export function cosine(a, b) {
  if (!a.count || !b.count) return 0;
  let d = 0; (a.v.size < b.v.size ? a.v : b.v).forEach((x, i) => { const y = (a.v.size < b.v.size ? b.v : a.v).get(i); if (y) d += x * y; });
  return d / (a.n * b.n);
}
const numbersOf = (s) => (String(s).match(/\d+/g) || []).join(',');
const TRUST = { user: 3, friend: 2, cloud: 1 };

export function createNotebook(io) {
  const MAX = 400;
  let data = { v: 1, entries: [], count: {} };
  try { const t = io && io.load && io.load(); if (t) { const d = JSON.parse(t); if (d && Array.isArray(d.entries)) data = { v: 1, entries: d.entries, count: d.count || {} }; } } catch { /* a fresh notebook */ }
  const save = () => { try { io && io.save && io.save(JSON.stringify(data)); } catch { /* the notebook is optional */ } };
  const cache = new WeakMap();
  const vec = (e) => { let c = cache.get(e); if (!c) { c = vectorize(e.q); cache.set(e, c); } return c; };
  const sameItems = (a, b) => { const x = (a || []).slice().sort().join('|'), y = (b || []).slice().sort().join('|'); return x === y; };
  const worth = (e) => (e.hits || 0) + (e.up || 0) * 2 - (e.down || 0) * 3 + (TRUST[e.src] || 0) * 2;
  function best(q, items, min) {
    const qv = vectorize(q); if (qv.count < 2) return null;
    let top = null;
    data.entries.forEach((e) => {
      if (e.off || (e.exp && e.exp < Date.now()) || !sameItems(e.items, items) || numbersOf(e.q) !== numbersOf(q)) return;
      const s = cosine(qv, vec(e));
      if (s >= min && (!top || s > top.score || (s === top.score && (TRUST[e.src] || 0) > (TRUST[top.entry.src] || 0)))) top = { score: s, entry: e };
    });
    return top;
  }
  return {
    count(k) { data.count[k] = (data.count[k] || 0) + 1; save(); },
    // The best kept answer for this question (about the same items), or null. 0.72 is "clearly the same question".
    lookup(q, items, min) {
      const t = best(q, items || [], min || 0.72); if (!t) return null;
      t.entry.hits = (t.entry.hits || 0) + 1; t.entry.last = Date.now(); save(); return t;
    },
    // ttl (ms): an answer that depends on today's prices is only kept for a while.
    learn(q, a, src, items, now, ttl) {
      q = String(q || '').trim().slice(0, 300); a = String(a || '').trim().slice(0, 700); if (!q || !a) return null;
      const t = best(q, items || [], 0.9), at = now || Date.now();
      if (t) { if ((TRUST[src] || 0) >= (TRUST[t.entry.src] || 0)) { t.entry.a = a; t.entry.src = src; t.entry.at = at; t.entry.off = false; t.entry.exp = ttl ? at + ttl : 0; save(); } return t.entry; }
      const e = { id: 'n' + at.toString(36) + Math.floor(Math.random() * 1e4).toString(36), q, a, src: src || 'cloud', items: (items || []).slice(), at, last: at, hits: 0, up: 0, down: 0, exp: ttl ? at + ttl : 0 };
      data.entries.push(e);
      if (data.entries.length > MAX) { data.entries.sort((x, y) => worth(y) - worth(x) || (y.last || 0) - (x.last || 0)); data.entries.length = MAX; }
      save(); return e;
    },
    vote(id, up) {
      const e = data.entries.find((x) => x.id === id); if (!e) return null;
      if (up) e.up = (e.up || 0) + 1; else { e.down = (e.down || 0) + 1; if (e.down >= 2 && e.down > (e.up || 0)) e.off = true; }
      this.count(up ? 'up' : 'down'); save(); return e;
    },
    // You said what the answer should have been: that wins over everything.
    correct(id, a) {
      const e = data.entries.find((x) => x.id === id); if (!e) return null;
      e.a = String(a).trim().slice(0, 700); e.src = 'user'; e.exp = 0; e.off = false; e.down = 0; e.at = Date.now(); this.count('corrections'); save(); return e;
    },
    forget(id) { data.entries = data.entries.filter((x) => x.id !== id); save(); },
    clear() { data = { v: 1, entries: [], count: data.count }; save(); },
    stats() {
      const by = { user: 0, friend: 0, cloud: 0 }; let hits = 0, off = 0;
      data.entries.forEach((e) => { by[e.src] = (by[e.src] || 0) + 1; hits += e.hits || 0; if (e.off) off++; });
      return { size: data.entries.length, by, hits, off, count: { ...data.count } };
    },
    all: () => data.entries.slice(),
    export: () => JSON.stringify(data, null, 1),
  };
}
