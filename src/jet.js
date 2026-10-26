// Equipment prices depend on the roll (jet) of each listing. The tooltip of a listing tells whether it is a clean roll:
//   parseTooltip  reads the lines of the hover box into { statut, stats[] }
//   classify      says if the listing is modified (forgemagie / exo) and which stats are not part of the item's usual list
import { norm, similarity } from './market.js';

const clean = (l) => String(l || '').replace(/[|“”"«»]/g, ' ').replace(/\s+/g, ' ').trim();

export function parseTooltip(lines) {
  const L = (lines || []).map(clean);
  const ix = L.findIndex((l) => /^\W*[EF]FFETS|^\W*EFFETS/i.test(l) || /e?ffets\s*\S?$/i.test(l) && l.length < 12);
  const statut = L.some((l) => /statut/i.test(l)) || L.some((l) => /emp[eê]che.*forgem/i.test(l));
  const stats = [];
  if (ix < 0) return { found: false, statut, stats };
  for (let i = ix + 1; i < L.length; i++) {
    const l = L[i];
    if (/poids|prix\s*moyen/i.test(l)) break;
    // "= 2% Critique", "« 289 Vitalité €", "+“ O Tacle": a few icon characters, a number (O = 0), an optional %, then the label
    const m = l.match(/^[^\dOo]{0,4}\s*(-?\d{1,4}|[Oo])\s*(%?)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]+?)\s*[^A-Za-zÀ-ÿ]{0,3}$/);
    if (!m || !/[A-Za-zÀ-ÿ]{2,}/.test(m[3])) continue;
    const value = /^[Oo]$/.test(m[1]) ? 0 : Number(m[1]);
    const label = m[3].replace(/(\s+[A-Za-zÀ-ÿ])+$/, '').trim();   // icon noise after the label ("Vitalité a")
    if (label.length < 2) continue;
    stats.push({ label, key: norm(label), value, pct: !!m[2] });
  }
  return { found: true, statut, stats };
}

const same = (a, b) => a === b || similarity(a, b) >= 0.8;

// base: stat labels learned from clean listings of this item (normalised); empty on the first sighting.
export function classify(tip, base) {
  const known = base || [];
  const exo = known.length ? tip.stats.filter((s) => s.value > 0 && !known.some((k) => same(k, s.key))).map((s) => s.label) : [];
  const why = tip.statut ? 'forged (cannot be forgemagied again)' : exo.length ? 'extra stat: ' + exo.join(', ') : '';
  return { modified: tip.statut || exo.length > 0, exo, why };
}

export const learnBase = (base, tip) => {
  const out = (base || []).slice();
  tip.stats.forEach((s) => { if (s.value > 0 && !out.some((k) => same(k, s.key))) out.push(s.key); });
  return out;
};
