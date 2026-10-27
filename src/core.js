// Pure core: parsing of the chat log, prices, tax, and the item index/search. No page needed.
// tests/run-tests.cjs runs this very file (the import and export lines are stripped there).
import { normLine as normalizeTransactionLine } from './transactions.js';
function num(s) {
  s = String(s || '').toLowerCase().replace(/[\s  ,]/g, '');
  if (!s) return NaN;
  var m;
  if (m = s.match(/^(\d+(?:\.\d+)?)kk$/)) return Math.round(m[1] * 1e6);
  if (m = s.match(/^(\d+\.\d+)m$/)) return Math.round(m[1] * 1e6);
  if (m = s.match(/^(\d+)m(\d{1,3})?$/)) return +m[1] * 1e6 + (m[2] ? +m[2] * Math.pow(10, 6 - m[2].length) : 0);
  if (m = s.match(/^(\d+(?:\.\d+)?)k$/)) return Math.round(m[1] * 1e3);
  return /^\d+(\.\d+)?$/.test(s) ? +s : NaN;
}
function tax(p, mode) {
  var t = p * 0.02;
  return mode === 'ceil' ? Math.ceil(t - 1e-9) : Math.round(t);
}
function parseLog(text) {
  var t = text.replace(/[  ]/g, ' ').replace(/(\([\d ]+)\s*\n\s*kamas\)/g, '$1 kamas)');
  var items = {}, total = 0, n = 0, income = 0, flags = [];
    t.split('\n').forEach(function (l, i) { 
    l = l.trim();
    if (!l) return;
    var m;
    if (m = l.match(/Banque\s*:\s*\+\s*([\d ]+)\s*Kamas/i)) {
      income += +m[1].replace(/ /g, '');
      return;
    }
    if (/n'est plus disponible|Vous avez créé/i.test(l)) return;
    if (m = l.match(/^(?:\[\d{1,2}:\d{2}\]\s*)?(\d[\d ]*?) x \[(.+?)\] \(([\d ]+) kamas\)/)) {
      var q = +m[1].replace(/ /g, ''), p = +m[3].replace(/ /g, ''), k = m[2];
      if ([1, 10, 100, 1000].indexOf(q) < 0) flags.push('line ' + (i + 1) + ': odd quantity ' + q + ' -> ' + l);
      var it = items[k] || (items[k] = { qty: 0, spent: 0, lines: 0 });
      it.qty += q; it.spent += p; it.lines++; total += p; n++;
      return;
    }
    flags.push('line ' + (i + 1) + ': unreadable -> ' + l);
  });
  return { items, total, lines: n, income, flags };
}
function runesFor(jet, sw, rw, lvl, coef) {
  return (3 * jet * sw * lvl / 200 + 1) / rw * coef / 100;
}
function fixDigits(s) {
  return s
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^\d ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function joinWrapped(t) {
  return t.replace(/[  ]/g, ' ').replace(/(\([\dOolIS ]+)\s*\n\s*k\w{2,4}\s*\)/gi, '$1 kamas)');
}
function normLine(raw) {
  return normalizeTransactionLine(raw);
}
function ocrToLines(t) {
  return joinWrapped(t).split('\n').map(normLine).filter(Boolean);
}
function nk(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function stitch(caps) {
  var out = [], warns = [];
  caps.forEach(function (L, ci) {
    if (!out.length) { out = L.slice(); return; }
    var best = 0, max = Math.min(out.length, L.length);
    for (var k = max; k >= 1; k--) {
      var ok = 0;
      for (var i = 0; i < k; i++) if (nk(out[out.length - k + i]) === nk(L[i])) ok++;
      if (ok === k || (k >= 4 && ok >= Math.ceil(k * 0.85))) { best = k; break; }
    }
    if (!best) {
      warns.push('Capture ' + (ci + 1) + ': no overlap with the previous one, lines may be missing.');
      out = out.concat(L);
    } else {
      var u = {};
      L.slice(0, best).forEach(function (x) { u[nk(x)] = 1; });
      if (Object.keys(u).length === 1 && best < L.length) warns.push('Capture ' + (ci + 1) + ': overlap is ' + best + ' identical line(s), real repeats could be hidden. Check the count.');
      out = out.concat(L.slice(best));
    }
  });
  return { lines: out, warns };
}
function parseLoose(t) {
  try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/([:\[,]\s*)-?(NaN|Infinity)(?=\s*[,}\]])/g, '$1null')); }
}
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\[\]()'’]/g, ' ').replace(/\s+/g, ' ').trim();
}
function effLabel(s) {
  return String(s || '').replace(/\{[^}]*\}/g, '').replace(/#\d/g, '').replace(/^[-\s%]+/, '').replace(/\s+/g, ' ').trim();
}
function buildIndex(raw) {
  var fr = raw.fr || {}, nm = function (id) { var s = fr[String(id)]; return s == null ? '' : String(s); };
  var types = {};
  (raw.types || []).forEach(function (t) { types[t.id] = nm(t.nameId); });
  var effs = {};
  (raw.effects || []).forEach(function (e) {
    var l = effLabel(nm(e.descriptionId));
    if (l) effs[e.id] = l;
  });
  var rec = {}, nr = 0;
  (raw.recipes || []).forEach(function (r) {
    var a = [];
    (r.ingredientIds || []).forEach(function (g, i) { a.push([g, (r.quantities || [])[i] || 1]); });
    if (a.length && !rec[r.resultId]) { rec[r.resultId] = a; nr++; }
  });
  var items = [];
  (raw.items || []).forEach(function (it) {
    var n = nm(it.nameId);
    if (!n) return;
    var e = (it.possibleEffects || []).map(function (x) { return [x.effectId, x.diceNum || 0, x.diceSide || x.diceNum || 0]; });
    items.push([it.id, n, it.level || 0, it.typeId, rec[it.id] || 0, e]);
  });
  return { v: 1, built: (raw.built || new Date().toISOString().slice(0, 10)), recipes: nr, types, effs, items };
}
function prepIndex(idx) {
  var byId = {}, byN = {};
  idx.items.forEach(function (a) {
    byId[a[0]] = a;
    var k = normName(a[1]);
    (byN[k] || (byN[k] = [])).push(a);
  });
  return { idx, byId, byN, keys: Object.keys(byN) };
}
function pickItem(P, q) {
  var h = P.byN[normName(q)];
  if (!h) return null;
  for (var i = 0; i < h.length; i++) if (h[i][4]) return h[i];
  return h[0];
}
function searchItems(P, q, lim) {
  var k = normName(q); if (k.length < 2) return [];
  var s = [], c = [];
  for (var i = 0; i < P.keys.length; i++) {
    var p = P.keys[i].indexOf(k);
    if (p === 0) s.push(P.keys[i]);
    else if (p > 0) c.push(P.keys[i]);
    if (s.length >= lim) break;
  }
  return s.concat(c).slice(0, lim).map(function (x) { return pickItem(P, x); });
}
function lev(a, b, m) {
  if (Math.abs(a.length - b.length) > m) return m + 1;
  var p = [], i, j;
  for (j = 0; j <= b.length; j++) p[j] = j;
  for (i = 1; i <= a.length; i++) {
    var c = [i], mn = i;
    for (j = 1; j <= b.length; j++) {
      c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (c[j] < mn) mn = c[j];
    }
    if (mn > m) return m + 1;
    p = c;
  }
  return p[b.length];
}
function suggest(P, q) {
  var k = normName(q), best = null, bd = 3;
  for (var i = 0; i < P.keys.length; i++) {
    var d = lev(k, P.keys[i], 2);
    if (d < bd) { bd = d; best = P.keys[i]; if (!d) break; }
  }
  return best ? P.byN[best][0][1] : null;
}
var KNOWN = { vitalite: [0.2, 1], force: [1, 1], intelligence: [1, 1], agilite: [1, 1], sagesse: [3, 3], prospection: [3, 3], 'dommage feu': [20, 20] };

export { num, tax, parseLog, runesFor, fixDigits, joinWrapped, normLine, ocrToLines, nk, stitch, parseLoose, normName, effLabel, buildIndex, prepIndex, pickItem, searchItems, lev, suggest, KNOWN };
