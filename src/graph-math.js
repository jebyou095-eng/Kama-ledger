// Pure helpers for the game's "Cours du marché" price chart: calibration, series, statistics and a plain-words reading.
import { cleanGrouped } from './market.js';

// ticks: [{ y, v }] pixel row and value of each y-axis label. Finds the straight line v = a*y + b that most labels agree with
// (a misread label is simply outvoted), so one wrong digit cannot bend the whole chart.
export function fitAxis(ticks) {
  const t = (ticks || []).filter((k) => Number.isFinite(k.y) && k.v > 0);
  if (t.length < 3) return null;
  const range = Math.max(...t.map((k) => k.v)) - Math.min(...t.map((k) => k.v)), tol = Math.max(1, range * 0.004);
  let best = null;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
    if (t[j].y === t[i].y) continue;
    const a = (t[j].v - t[i].v) / (t[j].y - t[i].y), b = t[i].v - a * t[i].y;
    if (!(a < 0)) continue;   // values fall as y grows downwards
    const inl = t.filter((k) => Math.abs(a * k.y + b - k.v) <= tol);
    if (!best || inl.length > best.n) best = { a, b, n: inl.length, of: t.length, inl };
  }
  if (!best || best.n < Math.min(4, t.length)) return null;
  // least squares over the agreeing labels: the labels are rounded, so the fitted line is a little better than any one of them
  const n = best.inl.length, sy = best.inl.reduce((s, k) => s + k.y, 0), sv = best.inl.reduce((s, k) => s + k.v, 0);
  const syy = best.inl.reduce((s, k) => s + k.y * k.y, 0), syv = best.inl.reduce((s, k) => s + k.y * k.v, 0), den = n * syy - sy * sy;
  const A = den ? (n * syv - sy * sv) / den : best.a, B = den ? (sv - A * sy) / n : best.b;
  return { a: A, b: B, n: best.n, of: best.of, ticks: best.inl, at: (y) => A * y + B, y: (v) => (v - B) / A };
}

// cols: [{ x, y }] curve top per pixel column (y null where nothing was found). Returns up to n points, oldest first, always keeping the highest and lowest.
export function sampleSeries(cols, at, n) {
  const ok = (cols || []).filter((c) => c.y !== null && c.y !== undefined);
  if (ok.length < 2) return [];
  const x0 = ok[0].x, x1 = ok[ok.length - 1].x, span = Math.max(1, x1 - x0), pts = [];
  const bucket = Math.max(1, Math.floor(ok.length / (n || 72)));
  for (let i = 0; i < ok.length; i += bucket) {
    const chunk = ok.slice(i, i + bucket), hi = chunk.reduce((m, c) => (c.y < m.y ? c : m), chunk[0]);   // smaller y = higher value
    pts.push([Math.round(((hi.x - x0) / span) * 1000) / 1000, Math.round(at(hi.y))]);
  }
  const last = ok[ok.length - 1]; pts[pts.length - 1] = [1, Math.round(at(last.y))];
  return pts;
}

export function parseStats(text) {
  const t = String(text || '').replace(/[  ]/g, ' ');
  const num = (re) => { const m = t.match(re); return m ? cleanGrouped(m[1]) : null; };
  // the labels are often misspelt by OCR ("redian", "n'edion"); the order is what is stable: Prix médian, Prix moyen, N articles
  const seg = t.split(/pri[a-z]{1,3}\b/i).slice(1), after = (s) => { const k = s.indexOf(':'); return cleanGrouped(k >= 0 ? s.slice(k + 1) : s.replace(/^\D*/, '')); };
  const sold = t.match(/([\dOolISB ]{1,12}?)\s*art[il1]c/i);
  return { median: seg[0] ? after(seg[0]) : null, avg: seg[1] ? after(seg[1]) : null, sold: sold ? cleanGrouped(sold[1]) : null };
}

// 24h charts label the x axis with clock times, 7d and 30d with dates
export function classifySpan(labels) {
  const L = (labels || []).map((s) => String(s));
  const clock = L.filter((s) => /\d[:.]\d\d/.test(s)).length, ampm = L.filter((s) => /^(am|pm)$/i.test(s)).length;
  if (clock >= 3 || ampm >= 2) return '24h';   // clock times; one stray "9:28" is a misread date
  const d = L.map((s) => s.match(/(\d{1,2})\s*[\/\-,.;:]\s*(\d{1,2})/)).filter(Boolean).map((m) => Number(m[1]) * 31 + Number(m[2]));
  if (d.length >= 2) { const span = Math.abs(d[d.length - 1] - d[0]); return span >= 20 ? '30d' : '7d'; }
  return null;
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
const f0 = (v) => Math.round(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ');

// g: { median, avg, sold, points:[[x,v]], span }. Returns facts plus one sentence in plain words.
export function analyzeGraph(g) {
  const pts = (g.points || []).map((p) => p[1]).filter((v) => v > 0);
  if (pts.length < 4) return null;
  const cur = pts[pts.length - 1], hi = Math.max(...pts), lo = Math.min(...pts), med = g.median || null, avg = g.avg || null;
  const third = Math.max(2, Math.floor(pts.length / 3)), head = pts.slice(0, third), tail = pts.slice(-third);
  const mean = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };   // the middle value: one huge spike must not fake a trend
  const trend = pct(mean(tail), mean(head));
  const fromMed = med ? pct(cur, med) : null;
  const skew = med && avg ? pct(avg, med) : null;           // average far above the median = a few huge sales pull it up
  const swing = med ? ((hi - lo) / med) * 100 : null;
  const facts = { current: cur, high: hi, low: lo, trendPct: trend, vsMedianPct: fromMed, skewPct: skew, swingPct: swing };
  const words = [];
  if (skew !== null && Math.abs(skew) >= 15) words.push('The average (' + f0(avg) + ') is ' + (skew > 0 ? 'far above' : 'far below') + ' the median (' + f0(med) + '): a few extreme sales distort it, so trust the median.');
  if (fromMed !== null) {
    if (fromMed <= -8) words.push('Now ' + f0(cur) + ', ' + f0(Math.abs(fromMed)) + '% under the median: a good moment to buy.');
    else if (fromMed >= 8) words.push('Now ' + f0(cur) + ', ' + f0(fromMed) + '% over the median: better to sell than buy.');
    else words.push('Now ' + f0(cur) + ', close to the median.');
  }
  if (trend !== null && Math.abs(trend) >= 5) words.push('The ' + (g.span || 'recent') + ' trend is ' + (trend > 0 ? 'up' : 'down') + ' ' + f0(Math.abs(trend)) + '%.');
  if (swing !== null && swing >= 60) words.push('It swings a lot (low ' + f0(lo) + ', high ' + f0(hi) + ').');
  if (g.sold && g.sold < 30) words.push('Only ' + g.sold + ' sold: thin market.');
  return { facts, text: words.join(' ') };
}
