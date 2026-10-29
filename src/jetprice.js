// How good is the roll (jet) of one equipment, and what is a fair asking price for it?
// The chart median mixes every roll and forged items, so it is only the middle of the market; the cheapest current listing stands for a low roll.
import { norm, similarity } from './market.js';

export const PREMIUM = 1.5;   // assumption, not game data: a perfect roll asks about this many times the median
export const TIER_LABEL = { low: 'low', medium: 'medium', high: 'high', top: 'top notch' };

const same = (a, b) => a === b || similarity(a, b) >= 0.8;

// stats: parsed tooltip stats [{ key, label, value }]; effects: the item's [[effectId, min, max]]; names: { effectId: label }.
// Each stat is placed between the item's minimum (0) and maximum (1); the roll is the average. Stats the item does not have are exo/forged extras.
export function rollOf(stats, effects, names) {
  const have = (effects || []).map((e) => ({ min: e[1], max: e[2], key: norm(String((names || {})[e[0]] || '')) })).filter((e) => e.key);
  const pos = [], exo = []; let atMax = 0, ranged = 0;
  (stats || []).forEach((s) => {
    if (!(s.value > 0)) return;
    const e = have.find((h) => same(h.key, s.key));
    if (!e) { exo.push(s.label); return; }
    if (e.max <= e.min) return;   // fixed stats (1 PA) say nothing about the roll
    const p = Math.max(0, Math.min(1, (s.value - e.min) / (e.max - e.min)));
    pos.push(p); ranged++; if (p >= 0.999) atMax++;
  });
  if (!pos.length) return null;
  const pct = Math.round((pos.reduce((a, b) => a + b, 0) / pos.length) * 100);
  return { pct, tier: pct < 30 ? 'low' : pct < 60 ? 'medium' : pct < 85 ? 'high' : 'top', perfect: atMax === ranged, n: pos.length, exo };
}

// Asking price from the roll: the cheapest listing now (floor) is a low roll, the chart median a middling one, a perfect roll asks PREMIUM x median.
export function askPrice(pct, floor, median, premium) {
  const p = Math.max(0, Math.min(100, pct)) / 100, M = median > 0 ? median : null, F = floor > 0 && (!M || floor <= M) ? floor : null, X = premium || PREMIUM;
  let v = null;
  if (M && p > 0.5) v = M + (M * X - M) * ((p - 0.5) / 0.5);
  else if (M && F) v = F + (M - F) * (p / 0.5);
  else if (F && !M) v = p <= 0.3 ? F : null;
  else if (M) v = null;
  if (v === null) return M && p <= 0.5 ? { max: Math.round(M), lo: null, hi: null, v: null } : null;
  return { v: Math.round(v), lo: Math.round(v * 0.92), hi: Math.round(v * 1.08) };
}

// units sold per day from a chart's "articles vendus" and its span
export function salesSpeed(sold, span) {
  const days = { '24h': 1, '7d': 7, '30d': 30 }[span]; if (!(sold >= 0) || !days) return null;
  const perDay = sold / days;
  return { perDay: Math.round(perDay * 10) / 10, level: perDay >= 10 ? 'easy' : perDay >= 3 ? 'normal' : perDay >= 1 ? 'slow' : 'hard' };
}
const SAYS = { easy: 'easy to sell', normal: 'sells at a normal pace', slow: 'slow to sell', hard: 'hard to sell' };
const f0 = (v) => Math.round(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ');

// All the pieces are optional; says only what it can back up.
export function sellAdvice({ name, chart, roll, floor, floorDays }) {
  const out = [];
  const sp = chart ? salesSpeed(chart.sold, chart.span) : null;
  if (sp) out.push(name + ' ' + SAYS[sp.level] + ' (about ' + f0(sp.perDay) + ' sold a day on the ' + chart.span + ' chart).');
  else out.push('I have no sales figure for ' + name + ' yet: read its price chart to know if it sells easily.');
  if (roll) {
    const forged = roll.exo.length ? ' It carries extra stat(s) (' + roll.exo.join(', ') + '): forged items sell differently, price it by hand.' : '';
    out.push('Your jet is ' + TIER_LABEL[roll.tier] + (roll.perfect ? ' (perfect)' : '') + ': ' + roll.pct + '% of the way from the minimum to the maximum.' + forged);
    const a = askPrice(roll.pct, floor, chart && chart.median, PREMIUM);
    if (a && a.v) out.push('A fair asking price is about ' + f0(a.v) + ' (' + f0(a.lo) + ' to ' + f0(a.hi) + ').');
    else if (a && a.max) out.push('Ask no more than the median (' + f0(a.max) + '); scan the cheapest listing to get a number.');
    else out.push('Read the price chart and scan the cheapest listing to get a number.');
    if (a && a.v) out.push('Rule of thumb: the cheapest listing' + (floor ? ' (' + f0(floor) + ')' : '') + ' is a low roll, the median (' + f0(chart.median) + ') a middling one, a perfect roll about ' + PREMIUM + 'x the median. Compare with the live listings.');
  }
  if (floorDays !== null && floorDays !== undefined && floorDays > 3) out.push('Your scanned price is ' + floorDays + ' days old: scan the item again first.');
  if (chart && chart.median) out.push('The chart median mixes every roll and forged items, so treat it as the middle of the market, not your price.');
  return out.join(' ');
}
