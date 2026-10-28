// Pure readers for the Dofus market screens. They work on OCR words ({text, x0, y0, x1, y1}) and OCR text lines,
// so they can be tested without a browser. The browser part (cropping, OCR calls) is in scan.js.

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\[\]()'’.,:;!?|_]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
}

// "1 416 666", "14l6 666", "2m100" -> number. Letters that OCR confuses with digits are repaired first.
export function cleanInt(text) {
  const t = String(text || '').replace(/[  ]/g, ' ').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const digits = t.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

// Words of a stacked read (several row crops in one image), grouped back into the row they came from.
// Every word goes to exactly ONE band: the nearest one, and only when its centre is within MAX_OFF of it.
// (The old rule accepted words 14 px outside a band while bands were 28 px apart, so a word in the gap was read by two rows.)
const MAX_OFF = 10;
export function bandLines(data, bands) {
  const words = ((data && data.words) || []).filter((w) => String(w.text).trim());
  const mine = bands.map(() => []);
  words.forEach((w) => {
    const c = (w.bbox.y0 + w.bbox.y1) / 2;
    let best = -1, bestD = Infinity;
    bands.forEach(([y0, y1], i) => { const d = c < y0 ? y0 - c : c > y1 ? c - y1 : 0; if (d < bestD) { bestD = d; best = i; } });
    if (best >= 0 && bestD <= MAX_OFF) mine[best].push(w);
  });
  return mine.map((list) => {
    const sorted = list.slice().sort((p, q) => (p.bbox.y0 + p.bbox.y1) / 2 - (q.bbox.y0 + q.bbox.y1) / 2);
    const lines = [];
    sorted.forEach((w) => {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2, last = lines[lines.length - 1];
      if (last && Math.abs(cy - last.cy) < (w.bbox.y1 - w.bbox.y0) * 0.7) last.w.push(w); else lines.push({ cy, w: [w] });
    });
    return {
      lines: lines.map((l) => l.w.sort((p, q) => p.bbox.x0 - q.bbox.x0).map((w) => w.text).join(' ')),
      conf: list.length ? list.reduce((t, w) => t + w.confidence, 0) / list.length : 0,
    };
  });
}

// One number from the lines of a row: the line with the most digits. Never glue lines together
// ("1 200" + a stray "45" must not become 120045).
export function bandNumber(lines) {
  let best = null, bestN = 0;
  (lines || []).forEach((l) => { const n = String(l).replace(/[^\dOolIS|B]/g, '').length; if (n > bestN) { bestN = n; best = l; } });
  return best === null ? null : cleanInt(best);
}

// A number written with French grouping ("2 045 319"). The coin icon after a price is often read as a digit or a letter ("2 045 319 l",
// "1 390 000 5"): after the first group, every further group must be exactly three digits, so a trailing stray character is dropped
// instead of being glued on as an extra digit.
export function cleanGrouped(text) {
  const t = String(text || '').replace(/[\u00a0\u202f]/g, ' ').trim().split(/\s+/).map((g) => g.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'));
  const digits = []; 
  for (let i = 0; i < t.length; i++) {
    const g = t[i].replace(/\D/g, '');
    if (!g) { if (digits.length) break; continue; }
    if (digits.length === 0) digits.push(g); else if (g.length === 3 && /^\d{3}$/.test(t[i])) digits.push(g); else break;
  }
  return digits.length ? Number(digits.join('')) : null;
}

export function wordsOf(ocrWords, scale) {
  const k = scale || 1;
  return (ocrWords || []).filter((w) => String(w.text || '').trim()).map((w) => ({
    text: String(w.text).trim(),
    x0: w.bbox.x0 / k, y0: w.bbox.y0 / k, x1: w.bbox.x1 / k, y1: w.bbox.y1 / k,
    conf: w.confidence,
  }));
}

// Column boundaries from the header words (Nom / Niveau / Prix moyen), or fractions of the width when the header is not in view.
export function findColumns(words, width) {
  const header = (re) => words.find((w) => re.test(norm(w.text)) && w.y0 < 40);
  const nom = header(/^nom$/), niv = header(/^niveau$/), prix = header(/^prix$/);
  const cols = { nameX0: width * 0.14, levelX0: width * 0.62, levelX1: width * 0.78, priceX0: width * 0.78, fromHeader: false };
  if (niv) {
    const cx = (niv.x0 + niv.x1) / 2, half = Math.max((niv.x1 - niv.x0) * 0.9, width * 0.08);
    cols.levelX0 = cx - half; cols.levelX1 = cx + half; cols.fromHeader = true;
    if (!prix) cols.priceX0 = cols.levelX1;
  }
  if (prix) { cols.priceX0 = Math.max(prix.x0 - width * 0.07, cols.levelX1); cols.fromHeader = true; }
  if (nom) cols.nameX0 = Math.max(nom.x0 - 4, 0);
  if (nom || niv || prix) cols.headerBottom = Math.max(...[nom, niv, prix].filter(Boolean).map((w) => w.y1)) + 2;
  return cols;
}

// One anchor per row: the 1-3 digit numbers inside the level column.
export function rowAnchors(words, cols) {
  const levels = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2;
    return cx >= cols.levelX0 && cx <= cols.levelX1 && /^\d{1,3}$/.test(w.text) && (cols.headerBottom === undefined || w.y0 > cols.headerBottom);
  }).sort((a, b) => a.y0 - b.y0);
  const anchors = [];
  levels.forEach((w) => {
    const cy = (w.y0 + w.y1) / 2, last = anchors[anchors.length - 1];
    if (last && Math.abs(cy - last.cy) < (w.y1 - w.y0) * 1.2) return;
    anchors.push({ cy, level: Number(w.text), h: w.y1 - w.y0 });
  });
  let pitch = 0;
  if (anchors.length > 1) {
    const gaps = anchors.slice(1).map((a, i) => a.cy - anchors[i].cy).sort((a, b) => a - b);
    pitch = gaps[Math.floor(gaps.length / 2)];
  } else if (anchors.length) pitch = anchors[0].h * 3.2;
  anchors.forEach((a) => { a.y0 = a.cy - pitch / 2; a.y1 = a.cy + pitch / 2; });
  return anchors;
}

// Name lines -> {name, type}. The last line is the item type ("Chapeau") when it looks like one.
export function splitNameType(lines, typeNames) {
  const clean = (lines || []).map((l) => String(l).replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1);
  if (!clean.length) return { name: '', type: '' };
  if (clean.length === 1) return { name: clean[0], type: '' };
  const last = clean[clean.length - 1];
  const known = (typeNames || []).some((t) => similarity(t, last) >= 0.72);
  return known ? { name: clean.slice(0, -1).join(' '), type: last } : { name: clean.join(' '), type: '' };
}

// Match an OCR name to the game data. The level is a strong filter: only items of that level compete.
// What OCR typically gets wrong, folded away so "Aerruyne" and "Aermyne" (rn/m) compare equal.
export function fold(s, loose) {
  let t = norm(s).replace(/rru|rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/[1|]/g, 'l').replace(/0/g, 'o').replace(/5/g, 's').replace(/\s+/g, '');
  if (loose) t = t.replace(/[aeo]/g, 'a').replace(/[il]/g, 'l').replace(/[uv]/g, 'u').replace(/[cd]/g, 'c');
  return t;
}

export function snapItem(P, rawName, level, rawType) {
  if (!P || !rawName) return null;
  const key = norm(rawName);
  if (!key) return null;
  if (!P.byLevel) {
    P.byLevel = {};
    P.idx.items.forEach((a) => { (P.byLevel[a[2]] || (P.byLevel[a[2]] = [])).push(a); });
  }
  // Same level + same name once OCR confusions are folded away: if exactly one item fits, that is it.
  if (Number.isFinite(level) && P.byLevel[level]) {
    const k1 = fold(rawName), k2 = fold(rawName, true);
    let same = P.byLevel[level].filter((a) => fold(a[1]) === k1);
    if (!same.length) same = P.byLevel[level].filter((a) => fold(a[1], true) === k2);
    if (same.length === 1) return { item: same[0], score: 0.99, sim: 0.99, exact: true, folded: true };
    if (same.length > 1) {
      const ranked = same.map((a) => ({ a, s: similarity(rawName, a[1]) })).sort((x, y) => y.s - x.s);
      if (ranked[0].s - ranked[1].s >= 0.1) return { item: ranked[0].a, score: 0.99, sim: 0.99, exact: true, folded: true };
      return { item: ranked[0].a, score: ranked[0].s, sim: ranked[0].s, exact: false, ambiguous: true };
    }
  }
  const typeKey = norm(rawType);
  const score = (a) => {
    let s = similarity(key, a[1]);
    if (typeKey && P.idx.types[a[3]] && norm(P.idx.types[a[3]]) === typeKey) s += 0.05;
    return s;
  };
  const best = (list) => list.reduce((acc, a) => { const s = score(a); return s > acc.score ? { item: a, score: s, sim: similarity(key, a[1]) } : acc; }, { item: null, score: 0, sim: 0 });
  let hit = { item: null, score: 0 };
  if (Number.isFinite(level) && P.byLevel[level]) hit = best(P.byLevel[level]);
  if (!hit.item || hit.score < 0.8) {
    const exact = P.byN[key];
    if (exact) hit = { item: exact.find((a) => a[4]) || exact[0], score: 1, sim: 1 };
    else if (!hit.item || hit.score < 0.6) {
      // Level mismatch: only accept a near-identical name (the level may have been misread, but a loose match would be a guess).
      const wide = best(P.idx.items.filter((a) => Math.abs(a[1].length - rawName.length) <= 3));
      const need = Number.isFinite(level) ? 0.92 : 0.62;
      if (wide.score > hit.score && wide.score >= need) hit = wide;
      else if (Number.isFinite(level) && hit.score < need) hit = { item: null, score: 0 };
    }
  }
  if (!hit.item || hit.score < 0.62) return null;
  return { item: hit.item, score: Math.min(1, hit.score), sim: hit.sim, exact: hit.sim >= 0.99 };
}

// Lot popup ("Aile du Tofu Maléfique / Niv. 26 / Prix moyen : 25 / lots...") from OCR text lines.
export function parsePopup(lines) {
  const clean = (lines || []).map((l) => String(l).replace(/[  ]/g, ' ').trim()).filter(Boolean);
  const out = { name: '', level: null, avg: null, type: '' };
  const LV = '[\\dOSIlBZ]{1,3}', lvNum = (t) => { const n = Number(String(t).replace(/[Oo]/g, '0').replace(/[SsB]/g, (c) => (c === 'B' ? '8' : '5')).replace(/[Il]/g, '1').replace(/Z/g, '2')); return Number.isFinite(n) ? n : null; };
  const idx = clean.findIndex((l) => new RegExp('niv\\.?\\s*' + LV + '(?![A-Za-z])', 'i').test(l));
  if (idx >= 0) {
    out.name = idx > 0 ? clean[idx - 1].replace(/[^\p{L}\p{N}' \-()]/gu, '').trim() : '';
    const m = clean[idx].match(new RegExp('niv\\.?\\s*(' + LV + ')(?![A-Za-z])', 'i'));
    if (m) out.level = lvNum(m[1]);
    const t = clean[idx].replace(new RegExp('niv\\.?\\s*' + LV + '(?![A-Za-z])', 'i'), '').replace(/[^\p{L} ]/gu, ' ').trim();
    out.type = t;
  } else if (clean.length) out.name = clean[0];
  const avg = clean.join('\n').match(/prix\s*moyen\s*:?\s*([\dOolI ]+)/i);
  if (avg) out.avg = cleanGrouped(avg[1]);
  return out;
}

export function parseBudget(text) {
  const v = cleanInt(String(text || '').split(/\r?\n/).find((l) => /\d/.test(l)) || '');
  return v !== null && v >= 0 && v < 1e12 ? v : null;
}

// "Cours du marché": best effort. Looks for "articles vendus" and the median / average price.
export function parseMarketChart(lines) {
  const text = (lines || []).join('\n');
  const num = (re) => { const m = text.match(re); return m ? cleanInt(m[1]) : null; };
  return {
    sold: num(/articles?\s+vendus?\D{0,12}([\dOolI ]+)/i),
    median: num(/m[ée]dian\w*\D{0,12}([\dOolI ]+)/i),
    avg: num(/moyen\w*\D{0,12}([\dOolI ]+)/i),
  };
}

// Decides whether a matched name can be saved without a human look. Returns '' when safe, otherwise the reason.
// A clean OCR read that still differs from the game data is probably a different (newer) item with a similar name,
// while a low-confidence read that is close to a real name is probably just an OCR typo.
export const CONFIDENT_READ = 86;
export const AUTO_SCORE = 0.9;
export function matchVerdict(score, nameConf) {
  if (score >= 0.99) return '';
  if (score < AUTO_SCORE) return 'name match uncertain';
  if (Number.isFinite(nameConf) && nameConf >= CONFIDENT_READ) return 'clean read differs from the game data: newer item with a similar name?';
  return '';
}

// Drops OCR noise from a name: stray symbols, one-letter fragments, and tokens with no vowel.
// Returns '' when nothing readable is left (so gibberish never reaches the lists).
export function cleanName(raw) {
  const toks = String(raw || '').replace(/[|_~=<>{}\[\]\\^*#@©®●•»«]/g, ' ').split(/\s+/).filter(Boolean);
  const keep = toks.filter((t) => {
    if (/^(de|du|d'|la|le|les|des|et|à|au|aux)$/i.test(t) || /^d'/i.test(t) || /^l'/i.test(t)) return true;
    const l = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (l.length < 2) return false;
    if (l.length / t.length < 0.7) return false;
    return /[aeiouyàâéèêëîïôöùûü]/i.test(l);
  });
  const out = keep.join(' ').trim();
  return out.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3 ? out : '';
}
