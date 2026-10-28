// Kamo's offline skills: small calculations he does instantly, without internet and without a key.
// The skills live in data (skills/skills.json); the maths is a short list of audited functions here. A skill with no examples, an unknown
// function or a reply that uses a field it cannot fill is refused by tests/skills.cjs, so a bad skill cannot be added by accident.
import SKILLS from './skills/skills.json';

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const SP = /[\u00a0\u202f]/g;
const fmt = (v) => { const r = Math.round(v * 100) / 100; return r.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(SP, ' '); };
const sgn = (v, f) => (v > 0 ? '+' : '') + f(v);

// numbers in the order they appear: "7 771", "7771", "1,5k", "2m"; a number followed by % is a tax/percent, not a figure
export function extract(raw) {
  const t = String(raw || '').replace(SP, ' '), nums = []; let pct = null;
  const re = /(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s*(%|[km]\b)?/gi; let m;
  while ((m = re.exec(t))) {
    let v = Number(m[1].replace(/ /g, '').replace(',', '.'));
    if (m[2] === '%') { pct = v; continue; }
    if (m[2]) v *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
    nums.push(v);
  }
  return { nums, pct };
}

export const COMPUTE = {
  unit: (n) => (n.qty > 0 ? { total: fmt(n.total), qty: fmt(n.qty), unit: fmt(n.total / n.qty) } : null),
  change: (n) => { if (!(n.from > 0)) return null; const d = n.to - n.from, p = (d / n.from) * 100; return { from: fmt(n.from), to: fmt(n.to), pct: sgn(p, (x) => fmt(x) + ' %'), diff: sgn(d, fmt) }; },
  profit: (n, pct) => { const k = 1 - (pct || 0) / 100, qty = n.qty > 0 ? n.qty : 1, net = n.sell * k - n.buy; return { net: sgn(net, fmt), qty: fmt(qty), total: sgn(net * qty, fmt), taxText: pct ? fmt(pct) + ' % tax' : 'no tax' }; },
  breakeven: (n, pct) => { const k = 1 - (pct || 0) / 100; return k > 0 && n.buy > 0 ? { buy: fmt(n.buy), sell: fmt(Math.ceil(n.buy / k)), taxText: pct ? fmt(pct) + ' % tax' : 'no tax' } : null; },
};

export const fill = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v && v[k] !== undefined ? v[k] : ''));

// the skill whose keyword is in the question and whose required numbers are all there; longest matching keyword wins
export function runSkill(raw, skills) {
  const q = nrm(raw), { nums, pct } = extract(raw); let best = null;
  (skills || SKILLS).forEach((s) => {
    const hit = s.keywords.filter((k) => q.includes(nrm(k))).sort((a, b) => b.length - a.length)[0];
    if (!hit) return;
    const need = s.numbers.map((x) => x.replace('?', '')), req = s.numbers.filter((x) => !x.endsWith('?')).length;
    if (nums.length < req) return;
    const n = {}; need.forEach((k, i) => { if (i < nums.length) n[k] = nums[i]; });
    const vars = COMPUTE[s.compute] && COMPUTE[s.compute](n, pct); if (!vars) return;
    if (!best || hit.length > best.len) best = { id: s.id, len: hit.length, text: fill(s.reply, vars) };
  });
  return best;
}
export { SKILLS };
