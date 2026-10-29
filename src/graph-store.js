// What Kamo has learned from price charts: one entry per item and time span (24h, 7d, 30d), kept on this computer only.
import { analyzeGraph } from './graph-math.js';

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ORDER = { '24h': 0, '7d': 1, '30d': 2 };

export function createGraphStore(load, save) {
  let db = {}; try { db = JSON.parse(load() || '{}') || {}; } catch (e) { db = {}; }
  const persist = () => { try { save(JSON.stringify(db)); } catch (e) { /* storage may be unavailable */ } };
  return {
    add(g, now) {
      if (!g || !g.name || !g.span || !(g.points || []).length) return null;
      const k = nrm(g.name) + '|' + g.span;
      db[k] = { name: g.name, level: g.level || null, span: g.span, median: g.median || null, avg: g.avg || null, sold: g.sold || null, points: g.points, at: now, sure: !!g.sure };
      const keys = Object.keys(db); if (keys.length > 60) keys.sort((a, b) => db[a].at - db[b].at).slice(0, keys.length - 60).forEach((x) => delete db[x]);
      persist(); return db[k];
    },
    all() { return Object.keys(db).map((k) => db[k]); },
    // the charts of the item a question talks about, shortest span first
    forQuestion(q) {
      const n = ' ' + nrm(q) + ' ';
      return this.all().filter((e) => nrm(e.name).length >= 4 && n.includes(' ' + nrm(e.name) + ' ')).sort((a, b) => ORDER[a.span] - ORDER[b.span]);
    },
  };
}

const ago = (ms) => { const h = Math.round(ms / 3600000); return h < 1 ? 'just now' : h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; };
// One short answer from the stored charts of one item.
export function describe(entries, now) {
  if (!entries || !entries.length) return null;
  const e = entries[0], a = analyzeGraph(e); if (!a || !a.text) return null;
  const more = entries.length > 1 ? ' (I also know its ' + entries.slice(1).map((x) => x.span).join(' and ') + ' chart.)' : '';
  return e.name + ', ' + e.span + ' chart read ' + ago(now - e.at) + ': ' + a.text + more;
}
