// Kamo's analyst: understands price questions typed in plain words, answers them from the user's own price history,
// and learns which questions come back often. Pure logic (no DOM), offline.
import { nrm, fmt } from './kamo-brain.js';

const DAY = 86400000;
const clean = (s) => nrm(s).replace(/['’]/g, ' ').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('the a an of for to is it me my i you what whats how do does did can should and or ou et le la les un une de du des est que qui quel quelle combien pour moi mon ma mes this that in on at with about now today'.split(' '));

// Levenshtein ratio, 0..1
function ratio(a, b) {
  if (a === b) return 1;
  const n = a.length, m = b.length; if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}

// names: [{ id, name }]. Finds the items a sentence talks about, in order of appearance, without overlaps.
export function findItems(raw, names) {
  const q = clean(raw), toks = q.split(' ').filter(Boolean), found = [], used = new Array(toks.length).fill(false);
  const list = (names || []).map((n) => ({ id: n.id, name: n.name, key: clean(n.name) })).filter((n) => n.key.length >= 3).sort((a, b) => b.key.length - a.key.length);
  for (const n of list) {
    const nt = n.key.split(' '), L = nt.length;
    let best = null;
    for (let i = 0; i + L <= toks.length; i++) {
      if (used.slice(i, i + L).some(Boolean)) continue;
      const s = toks.slice(i, i + L).join(' ');
      const r = s === n.key ? 1 : (L === 1 && n.key.length < 6 ? 0 : ratio(s, n.key));
      if (r >= (n.key.length >= 8 ? 0.84 : 0.9) && (!best || r > best.r)) best = { i, r };
    }
    if (best) { for (let k = best.i; k < best.i + L; k++) used[k] = true; found.push({ id: n.id, name: n.name, at: best.i }); }
  }
  return found.sort((a, b) => a.at - b.at);
}

const WORDS = {
  compare: /\b(compare|comparer|versus|vs|entre|better|mieux|lequel|which)\b/,
  trend: /\b(trend|history|historique|evolution|evolve|moved|moving|variation|change|changed|going|monte|monter|baisse|baisser|hausse|depuis|since|week|semaine)\b|\bup or down\b/,
  worth: /\b(worth|buy|buying|acheter|achete|sell|selling|vendre|vend|good time|bon moment|cher|expensive|cheap|pas cher|rentable|should)\b/,
};

// Returns an analyst intent or null (the older keyword reader then takes over).
export function parseAsk(raw, names) {
  const items = findItems(raw, names);
  if (!items.length) return null;
  const q = clean(raw);
  if (items.length >= 2 && WORDS.compare.test(q + ' ')) return { intent: 'compare', ids: items.slice(0, 2).map((x) => x.id), names: items.slice(0, 2).map((x) => x.name) };
  if (items.length >= 2 && /\b(or|ou|vs|and|et)\b/.test(q) && WORDS.worth.test(q)) return { intent: 'compare', ids: items.slice(0, 2).map((x) => x.id), names: items.slice(0, 2).map((x) => x.name) };
  const it = items[0];
  if (WORDS.worth.test(q)) return { intent: 'worth', id: it.id, name: it.name, sell: /\b(sell|selling|vendre|vend)\b/.test(q) };
  if (WORDS.trend.test(q)) return { intent: 'trend', id: it.id, name: it.name };
  return null;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// What the history says about one item. rec: { id, name, price, priceAt, history:[[ts,price]], jetClean, jetSpecial }
export function analyzeItem(rec, now) {
  const h = ((rec && rec.history) || []).filter((p) => Array.isArray(p) && p[1] > 0);
  const vals = h.slice(-12).map((p) => p[1]);
  const out = { name: rec.name, price: rec.price || null, ageDays: rec.priceAt ? Math.floor((now - rec.priceAt) / DAY) : null, n: h.length, median: median(vals), min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, verdict: 'unknown', vsMedian: null, week: null, jet: null };
  if (out.price && out.median && vals.length >= 3) {
    out.vsMedian = Math.round(((out.price - out.median) / out.median) * 100);
    out.verdict = out.vsMedian <= -10 ? 'cheap' : out.vsMedian >= 15 ? 'high' : 'fair';
  }
  const old = h.filter((p) => now - p[0] >= 6 * DAY).pop();
  if (old && out.price) out.week = Math.round(((out.price - old[1]) / old[1]) * 100);
  if (rec.jetClean) out.jet = { clean: rec.jetClean.price, specials: (rec.jetSpecial || []).map((s) => s.price) };
  return out;
}

const age = (d) => (d === null ? '' : d === 0 ? ' (today)' : ' (' + d + ' d old)');

export function explainTrend(a) {
  if (!a.price) return a.name + ': no price yet, scan it first.';
  if (a.n < 2) return a.name + ' is at ' + fmt(a.price) + age(a.ageDays) + '. I have only one price for it, so I cannot say which way it moves yet.';
  let s = a.name + ' is at ' + fmt(a.price) + age(a.ageDays) + '. Over my last ' + Math.min(a.n, 12) + ' prices: usually ' + fmt(a.median) + ', from ' + fmt(a.min) + ' to ' + fmt(a.max) + '.';
  if (a.week !== null) s += ' ' + (a.week === 0 ? 'Flat' : (a.week > 0 ? 'Up ' : 'Down ') + Math.abs(a.week) + '%') + ' since about a week ago.';
  return s + jetLine(a);
}

export function explainWorth(a, sell) {
  if (!a.price) return a.name + ': no price yet, scan it first.';
  if (a.verdict === 'unknown') return a.name + ' is at ' + fmt(a.price) + age(a.ageDays) + ', but I have only ' + a.n + ' price' + (a.n === 1 ? '' : 's') + ' for it. Scan it a few more times and I can tell you if it is a good moment.' + jetLine(a);
  const v = a.vsMedian, rel = Math.abs(v) + '% ' + (v < 0 ? 'under' : 'over') + ' its usual ' + fmt(a.median);
  let s;
  if (sell) s = a.verdict === 'high' ? 'Good time to sell ' + a.name + ': ' + fmt(a.price) + ' is ' + rel + '.' : a.verdict === 'cheap' ? 'Wait before selling ' + a.name + ': ' + fmt(a.price) + ' is ' + rel + '.' : a.name + ' is at a normal price (' + fmt(a.price) + ', ' + rel + '). Nothing special about selling now.';
  else s = a.verdict === 'cheap' ? 'Good moment to buy ' + a.name + ': ' + fmt(a.price) + ' is ' + rel + '.' : a.verdict === 'high' ? 'I would wait on ' + a.name + ': ' + fmt(a.price) + ' is ' + rel + '.' : a.name + ' is at a normal price (' + fmt(a.price) + ', ' + rel + '). Not a bargain, not a trap.';
  if (a.ageDays !== null && a.ageDays >= 3) s += ' (the price is ' + a.ageDays + ' days old, scan it to be sure)';
  return s + jetLine(a);
}

export function explainCompare(a, b) {
  const fmtv = (x) => x.name + ' ' + (x.price ? fmt(x.price) : 'no price') + (x.verdict !== 'unknown' ? ' (' + (x.vsMedian > 0 ? '+' : '') + x.vsMedian + '% vs usual)' : '');
  let s = fmtv(a) + '  vs  ' + fmtv(b) + '.';
  if (a.verdict !== 'unknown' && b.verdict !== 'unknown') {
    const better = a.vsMedian < b.vsMedian ? a : b;
    s += ' ' + (a.vsMedian === b.vsMedian ? 'Both sit equally far from their usual price.' : better.name + ' is the better buy right now: it is further under its usual price.');
  } else s += ' I do not have enough prices on both to say which is the better buy.';
  return s;
}

function jetLine(a) {
  if (!a.jet) return '';
  let s = '\nEquipment: the price is that of the cheapest clean-roll listing (' + fmt(a.jet.clean) + ').';
  if (a.jet.specials.length) s += ' Forged or exo listings seen: ' + a.jet.specials.map(fmt).join(', ') + ', not counted.';
  return s;
}

// ---------------------------------------------------------------- learning what you ask
// mem.qs: { key: { label, n, last, id? } }. A question is "the same" when it has the same intent and items, or the same words.
export function questionKey(u, raw) {
  if (u && u.ids) return u.intent + ':' + u.ids.slice().sort().join(',');
  if (u && u.id) return u.intent + ':' + u.id;
  if (u && u.intent && u.intent !== 'lookup' && u.intent !== 'item') return u.intent;
  return 'q:' + clean(raw).split(' ').filter((t) => t && !STOP.has(t)).sort().join(' ');
}

export function learnQuestion(mem, key, raw, now, id) {
  if (!key || key === 'q:') return;
  const qs = mem.qs || (mem.qs = {});
  const e = qs[key] || (qs[key] = { label: '', n: 0, last: 0 });
  e.n++; e.last = now; e.label = String(raw).trim().slice(0, 60);
  if (id) e.id = id;
  const keys = Object.keys(qs);
  if (keys.length > 60) keys.sort((a, b) => qs[a].last - qs[b].last).slice(0, keys.length - 60).forEach((k) => delete qs[k]);
  keys.forEach((k) => { if (now - qs[k].last > 60 * DAY && qs[k].n < 3) delete qs[k]; });
}

// Questions asked 3 times or more in the last 30 days become buttons. `skip`: labels already shown as buttons.
export function promoted(mem, now, max, skip) {
  const sk = new Set((skip || []).map(clean));
  return Object.values(mem.qs || {}).filter((e) => e.n >= 3 && now - e.last < 30 * DAY && !sk.has(clean(e.label)))
    .sort((a, b) => b.n - a.n || b.last - a.last).slice(0, max || 3).map((e) => ({ label: e.label, n: e.n }));
}

// Items you keep asking about are watched: Kamo tells you about smaller moves for them.
export function watched(mem) {
  return new Set(Object.values(mem.qs || {}).filter((e) => e.n >= 3 && e.id).map((e) => e.id));
}
