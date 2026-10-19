// Finds the Dofus panels in a full-frame OCR pass, from their own text. No drawing, no fixed layout:
// every position is derived from where the words are, and sizes are measured in units of the text itself.
// Input words: [{text, x0, y0, x1, y1, conf}] in frame pixels.

const letters = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

function sim(a, b) {
  const x = letters(a), y = letters(b);
  if (!x || !y) return 0;
  const m = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) m[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - m[x.length][y.length] / Math.max(x.length, y.length);
}
export const like = (word, target, min) => sim(word, target) >= (min || 0.75);

const cx = (w) => (w.x0 + w.x1) / 2;
const cy = (w) => (w.y0 + w.y1) / 2;
const hh = (w) => w.y1 - w.y0;
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function toLines(words) {
  const sorted = words.slice().sort((a, b) => a.x0 - b.x0);
  const lines = [];
  sorted.forEach((w) => {
    const last = lines[lines.length - 1];
    const mine = lines.filter((l) => Math.abs(cy(w) - l.cy) <= Math.max(hh(w), l.h) * 0.6 && w.x0 - Math.max(...l.words.map((q) => q.x1)) < Math.max(hh(w), l.h) * 3 && w.x0 >= Math.min(...l.words.map((q) => q.x0)) - 1);
    const hit = mine[mine.length - 1];
    if (hit) {
      const last = hit;
      last.words.push(w);
      last.cy = (last.cy * (last.words.length - 1) + cy(w)) / last.words.length;
      last.h = Math.max(last.h, hh(w));
    } else lines.push({ words: [w], cy: cy(w), h: hh(w) });
  });
  lines.forEach((l) => {
    l.words.sort((a, b) => a.x0 - b.x0);
    l.text = l.words.map((w) => w.text).join(' ');
    l.x0 = Math.min(...l.words.map((w) => w.x0)); l.x1 = Math.max(...l.words.map((w) => w.x1));
    l.y0 = Math.min(...l.words.map((w) => w.y0)); l.y1 = Math.max(...l.words.map((w) => w.y1));
  });
  lines.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  return lines;
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

// ---- market list (Hôtel de vente): header "Nom / Niveau / Prix moyen" + one row per level number ----
export function detectMarket(words) {
  const nivs = words.filter((w) => letters(w.text).length >= 5 && like(w.text, 'niveau', 0.78));
  for (const niv of nivs) {
    const sameLine = (w) => Math.abs(cy(w) - cy(niv)) <= Math.max(hh(niv), hh(w)) * 0.8;
    const prix = words.find((w) => sameLine(w) && w.x0 > niv.x1 && like(w.text, 'prix', 0.74) && letters(w.text).length >= 3);
    if (!prix) continue;
    const moyen = words.find((w) => sameLine(w) && w.x0 >= prix.x1 - 2 && like(w.text, 'moyen', 0.7));
    const nom = words.find((w) => sameLine(w) && w.x1 < niv.x0 && like(w.text, 'nom', 0.8));
    const hw = Math.max(niv.x1 - niv.x0, 12);
    const headerBottom = Math.max(niv.y1, prix.y1) + 2;
    const levelX0 = cx(niv) - 0.9 * hw, levelX1 = cx(niv) + 0.9 * hw;
    const priceX0 = Math.max(prix.x0 - 0.6 * hw, levelX1 + 2);
    let priceX1 = (moyen ? moyen.x1 : prix.x1) + 0.9 * hw;

    const below = words.filter((w) => w.y0 > headerBottom);
    const levelWords = below.filter((w) => cx(w) >= levelX0 && cx(w) <= levelX1 && /^\d{1,3}$/.test(w.text.trim()) && +w.text >= 1 && +w.text <= 200);
    const priceWords = below.filter((w) => cx(w) >= priceX0 && cx(w) <= priceX1 + hw && digitsOf(w.text).length >= 1 && /\d/.test(w.text));
    if (!levelWords.length && !priceWords.length) continue;
    priceWords.forEach((w) => { if (w.x1 + 2 > priceX1) priceX1 = w.x1 + 2; });

    const tall = median(levelWords.map(hh).concat(priceWords.map(hh))) || hh(niv);
    const ys = (list) => list.map(cy).sort((a, b) => a - b);
    const gaps = (arr) => arr.slice(1).map((v, i) => v - arr[i]).filter((g) => g > tall * 1.2);
    let pitch = median(gaps(ys(levelWords))) || median(gaps(ys(priceWords))) || tall * 3.2;
    const centres = ys(levelWords.concat(priceWords));
    const anchors = [];
    centres.forEach((y) => { const last = anchors[anchors.length - 1]; if (last && y - last < pitch * 0.45) return; anchors.push(y); });
    if (anchors.length > 1) pitch = median(anchors.slice(1).map((v, i) => v - anchors[i])) || pitch;
    const rows = anchors.map((y) => ({ cy: y, y0: Math.max(headerBottom, y - pitch / 2), y1: y + pitch / 2 }));

    // name column starts at the leftmost confident word of the rows (icons are not text)
    const nameWords = below.filter((w) => w.x1 < levelX0 && w.conf >= 55 && letters(w.text).length >= 2 && rows.some((r) => cy(w) >= r.y0 && cy(w) <= r.y1));
    const firsts = rows.map((r) => Math.min(...nameWords.filter((w) => cy(w) >= r.y0 && cy(w) <= r.y1).map((w) => w.x0))).filter(isFinite);
    let nameX0 = firsts.length ? median(firsts) - 3 : (nom ? nom.x0 - 2 : niv.x0 - 6 * hw);
    nameX0 = Math.min(nameX0, levelX0 - 6 * hw * 0.2);
    const iconSide = pitch * 0.8;
    return {
      kind: 'market', rows, pitch, headerBottom,
      cols: { nameX0, levelX0, levelX1, priceX0, priceX1, iconX0: nameX0 - iconSide - 4 },
      box: { x: nameX0 - iconSide - 6, y: niv.y0 - 2, w: priceX1 - (nameX0 - iconSide - 6), h: rows[rows.length - 1].y1 - niv.y0 + 2 },
    };
  }
  return null;
}

// ---- lot popup: title / "Niv. N • type" / "Prix moyen : N" / lot rows with ACHETER buttons ----
export function detectPopup(words) {
  const lines = toLines(words);
  const isPrix = (l) => l.words.some((w) => /^prix/.test(letters(w.text))) && l.words.some((w) => /moyen/.test(letters(w.text)));
  const buy = lines.filter((l) => l.words.some((w) => like(w.text, 'acheter', 0.72) && letters(w.text).length >= 5));
  const qty = lines.filter((l) => l.words.some((w) => /^quantit/.test(letters(w.text))) || /inventaire\s*:/i.test(l.text));
  for (const P of lines.filter((l) => isPrix(l) && !l.words.some((w) => like(w.text, 'niveau', 0.78) && letters(w.text).length >= 5))) {
    // the lot list sits below the "Prix moyen" line: ACHETER buttons, or the "Quantité … en inventaire" line
    const lower = buy.concat(qty).filter((l) => l.cy > P.cy && l.cy < P.cy + P.h * 18 && l.x1 > P.x0 - P.h * 3 && l.x0 < P.x1 + P.h * 14);
    if (!lower.length) continue;
    // the "Niv." line is the one above (or the same line when OCR merged title and level)
    const top = lines.filter((q) => q.cy <= P.cy + 1 && P.cy - q.cy < P.h * 4 && q.x0 >= P.x0 - 3 * P.h && q.x0 < P.x1).sort((a, b) => a.cy - b.cy)[0] || P;
    const last = lower.sort((a, b) => b.y1 - a.y1)[0];
    const side = Math.max(P.y1 - top.y0, P.h * 3);
    const x1 = Math.max(P.x1, ...lower.map((l) => l.x1)) + 8 * P.h;
    const x0 = Math.min(top.x0, P.x0) - 5 * P.h;
    const y0 = top.y0 - top.h * 0.5;
    return {
      kind: 'popup',
      box: { x: x0, y: y0, w: x1 - x0, h: last.y1 + last.h * 0.4 - y0 },
      icon: { x: x0 - side * 0.2, y: y0, w: side, h: side },
    };
  }
  return null;
}

// ---- Recettes window: title word, item name on the line(s) just below ----
export function detectRecipe(words) {
  const lines = toLines(words);
  const t = lines.find((l) => l.words.length <= 2 && l.words.some((w) => letters(w.text).length >= 6 && like(w.text, 'recettes', 0.8)));
  if (!t) return null;
  const w = t.words.find((x) => like(x.text, 'recettes', 0.8));
  const tw = Math.max(w.x1 - w.x0, 20), th = Math.max(hh(w), 8);
  const x = cx(w) - 3.6 * tw, y = t.y1 + 1;
  return { kind: 'recipe', box: { x: Math.max(0, x), y, w: 7.2 * tw, h: 7.5 * th }, title: w };
}

// ---- chat: lines that start with a [hh:mm] stamp ----
const STAMP = /^[\[(]?\s*\d{1,2}\s*[:.;]\s*\d{2}\s*[\])]?$/;
export function detectChat(words) {
  const lines = toLines(words);
  const stamped = lines.filter((l) => STAMP.test(l.words[0].text) || /^[\[(]\d{1,2}[:.;]\d{2}[\])]/.test(l.words[0].text));
  if (!stamped.length) return null;
  // largest group of stamped lines that are close together
  const groups = [];
  stamped.forEach((l) => { const g = groups[groups.length - 1]; if (g && l.cy - g[g.length - 1].cy < l.h * 4) g.push(l); else groups.push([l]); });
  const best = groups.sort((a, b) => b.length - a.length)[0];
  const x0 = Math.min(...best.map((l) => l.x0)) - 6, x1 = Math.max(...best.map((l) => l.x1)) + 30;
  const y0 = Math.min(...best.map((l) => l.y0)) - 2, last = best[best.length - 1];
  return { kind: 'chat', box: { x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - x0, h: last.y1 + last.h * 1.3 - y0 }, lines: best.length };
}

// ---- budget: the lowest large number under the "Inventaire" title ----
export function detectBudget(words) {
  const lines = toLines(words);
  const t = lines.find((l) => l.words.length <= 2 && l.words.some((w) => letters(w.text).length >= 8 && like(w.text, 'inventaire', 0.8)) && /^[IiLl1|]/.test(l.words[0].text));
  if (!t) return null;
  const w = t.words.find((x) => like(x.text, 'inventaire', 0.8));
  const tw = Math.max(w.x1 - w.x0, 20);
  const near = lines.filter((l) => l.y0 > t.y1 + t.h * 6 && cx(l.words[l.words.length - 1]) >= cx(w) - 3 * tw && cx(l.words[0]) <= cx(w) + 3 * tw);
  const cands = [];
  near.forEach((l) => {
    // merge neighbouring digit groups ("4 941 069") into one number
    let cur = null;
    l.words.filter((x) => cx(x) >= cx(w) - 3 * tw && cx(x) <= cx(w) + 3 * tw).forEach((x) => {
      const d = digitsOf(x.text);
      if (d && /^[\d\s.,©®●o]+$/i.test(x.text) && d.length >= 1) {
        if (cur && x.x0 - cur.x1 < l.h * 1.6) { cur.x1 = x.x1; cur.d += d; } else { cur = { x0: x.x0, x1: x.x1, y0: x.y0, y1: x.y1, d }; cands.push(cur); }
      } else cur = null;
    });
  });
  const money = cands.filter((c) => c.d.length >= 4).sort((a, b) => b.y1 - a.y1)[0];
  if (!money) return null;
  const pad = (money.y1 - money.y0) * 0.5;
  return { kind: 'budget', box: { x: money.x0 - pad, y: money.y0 - pad, w: money.x1 - money.x0 + 2 * pad + (money.y1 - money.y0) * 1.2, h: money.y1 - money.y0 + 2 * pad } };
}

export function detectPanels(words) {
  const clean = words.filter((w) => w && w.text && w.x1 > w.x0 && w.y1 > w.y0);
  const out = {};
  [['market', detectMarket], ['popup', detectPopup], ['recipe', detectRecipe], ['chat', detectChat], ['budget', detectBudget]].forEach(([k, fn]) => {
    const r = fn(clean);
    if (r) out[k] = r;
  });
  return out;
}
