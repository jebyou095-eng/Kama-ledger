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
    const priceX0 = levelX1 + 2;   // right-aligned prices can start well left of the header word: never clip a leading digit
    let priceX1 = (moyen ? moyen.x1 : prix.x1) + 0.9 * hw;

    const below = words.filter((w) => w.y0 > headerBottom);
    // A price has at least two digits: a lone digit in the price column (scrollbar, coin icon, UI noise) used to create phantom rows
    // and stretch the price column. (OCR confidence is NOT used here: glued prices like "13841320" often come back at 0-50.)
    const levelWords = below.filter((w) => cx(w) >= levelX0 && cx(w) <= levelX1 && /^\d{1,3}$/.test(w.text.trim()) && +w.text >= 1 && +w.text <= 200);
    const priceWords = below.filter((w) => cx(w) >= priceX0 && cx(w) <= priceX1 + hw && digitsOf(w.text).length >= 2 && /\d/.test(w.text));
    if (!levelWords.length && !priceWords.length) continue;
    priceWords.forEach((w) => { if (w.x1 + 2 > priceX1) priceX1 = w.x1 + 2; });

    const tall = median(levelWords.map(hh).concat(priceWords.map(hh))) || hh(niv);
    const ys = (list) => list.map(cy).sort((a, b) => a - b);
    const gaps = (arr) => arr.slice(1).map((v, i) => v - arr[i]).filter((g) => g > tall * 1.2);
    let pitch = median(gaps(ys(levelWords))) || median(gaps(ys(priceWords))) || tall * 3.2;
    const centres = ys(levelWords.concat(priceWords));
    // A price garbled by OCR ("z2mmoe") still marks a row, but a single-digit word may only ADD one when it is far from every row we
    // already have; stray digits next to a real row (scrollbar, coin icon) are ignored.
    const rowGap = 0.6 * (median(gaps(centres)) || tall * 3.2);
    below.filter((w) => cx(w) >= priceX0 && cx(w) <= priceX1 + hw && /\d/.test(w.text) && digitsOf(w.text).length < 2).forEach((w) => { const y = cy(w); if (centres.every((c) => Math.abs(c - y) > rowGap)) centres.push(y); });
    centres.sort((a, b) => a - b);
    const anchors = [];
    // Words of one row sit at slightly different heights: group neighbours and take the median, so a stray word near a real row can
    // never replace it (a greedy "first one wins" kept a stray digit at y=492 and dropped the real row at y=513).
    const groups = [];
    centres.forEach((y) => { const g = groups[groups.length - 1]; if (g && y - g[g.length - 1] < pitch * 0.45) g.push(y); else groups.push([y]); });
    groups.forEach((g) => anchors.push(median(g)));
    if (anchors.length > 1) pitch = median(anchors.slice(1).map((v, i) => v - anchors[i])) || pitch;
    const rows = anchors.map((y) => ({ cy: y, y0: Math.max(headerBottom, y - pitch / 2), y1: y + pitch / 2 }));

    // name column starts at the leftmost confident word of the rows (icons are not text)
    // The "Nom" header is the authority for the column. Without it, only words within a plausible distance of the level column count:
    // the filter sidebar (NIVEAUX / CATEGORIES) sits to the left of the table on the same rows and used to drag the column 560 px away.
    const nameWords = below.filter((w) => w.x1 < levelX0 && w.x0 >= levelX0 - 7 * hw && w.conf >= 55 && letters(w.text).length >= 2 && rows.some((r) => cy(w) >= r.y0 && cy(w) <= r.y1));
    const firsts = rows.map((r) => Math.min(...nameWords.filter((w) => cy(w) >= r.y0 && cy(w) <= r.y1).map((w) => w.x0))).filter(isFinite);
    let nameX0 = nom && nom.conf >= 60 ? nom.x0 - 3 : (firsts.length ? median(firsts) - 3 : (nom ? nom.x0 - 2 : niv.x0 - 6 * hw));
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
  // Several lines can look like "Prix moyen": the popup's own, and the header of the market list next to it. Take the one with
  // the most popup evidence below it (ACHETER buttons, then the "Quantité ... en inventaire" line), not simply the first from the top.
  const cands = lines.filter((l) => isPrix(l) && !l.words.some((w) => like(w.text, 'niveau', 0.78) && letters(w.text).length >= 5)).map((P) => {
    const u = median(P.words.map(hh)) || P.h;
    const near = (l) => l.cy > P.cy && l.cy < P.cy + u * 20 && l.x1 > P.x0 - u * 8 && l.x0 < P.x1 + u * 20;
    const rowsBelow = (l) => l.cy > P.cy && l.cy < P.cy + u * 40 && l.x1 > P.x0 - u * 8 && l.x0 < P.x1 + u * 40;   // the lot rows run well to the right of the short "Prix moyen" line
    const q = qty.filter(near)[0], bs = buy.filter(rowsBelow);
    return { P, u, near, q, bs, score: bs.length * 10 + (q ? 5 : 0) - (q ? Math.abs(q.cy - P.cy) / (u * 20) : 0) };
  }).filter((c) => c.q || c.bs.length).sort((a, b) => b.score - a.score);
  if (cands.length) {
    const { P, u, q, bs } = cands[0];
    // the popup title: walk up from "Prix moyen" through the lines stacked right above it (item name, then its "Niv." line), stop at a gap
    let top = P;
    for (let n = 0; n < 3; n++) {
      const above = lines.filter((l) => l.cy < top.cy - 1 && top.cy - l.cy < u * 3.2 && Math.abs(l.x0 - P.x0) < 3 * u && l.x0 < P.x1).sort((a, b) => b.cy - a.cy)[0];
      if (!above) break;
      top = above;
    }
    const left = Math.min(top.x0, P.x0, q ? q.x0 : Infinity) - 3;
    const y0 = top.y0 - top.h * 0.5;
    const bottom = bs.length ? Math.max(...bs.map((l) => l.y1)) + 14 : (q ? q.y1 : P.y1) + 11 * u;
    // right edge: follow the words of the panel rows until a wide empty gap
    let right = Math.max(P.x1, q ? q.x1 : 0, ...bs.map((l) => l.x1));
    words.filter((w) => w.y0 >= P.y0 && w.y1 <= bottom + 4 && w.x0 >= left).sort((a, b) => a.x0 - b.x0).forEach((w) => { if (w.x0 - right < 5 * u) right = Math.max(right, w.x1); });
    // the category list of the market sits right next to the popup: the lot rows end at their ACHETER button, nothing beyond it is popup
    const btnRight = bs.map((l) => Math.max(...l.words.filter((w) => like(w.text, 'acheter', 0.72) && letters(w.text).length >= 5).map((w) => w.x1))).filter(isFinite);
    if (btnRight.length) right = Math.min(right, Math.max(...btnRight) + 2);
    right += 6;
    const side = Math.max(P.y1 - top.y0, u * 3);
    return { kind: 'popup', box: { x: left, y: y0, w: right - left, h: bottom - y0 }, icon: { x: left - side * 0.2, y: y0, w: side, h: side } };
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
// No timestamps were read (they are small and grey): use the "CHAT" tab label and the text lines under it.
function detectChatByLabel(lines) {
  const tab = lines.map((l) => ({ l, w: l.words.find((w) => letters(w.text) === 'chat' && (w.conf === undefined || w.conf >= 70)) })).filter((t) => t.w).sort((a, b) => b.l.cy - a.l.cy)[0];
  if (!tab) return null;
  const u = Math.max(8, tab.w.y1 - tab.w.y0), ty = (tab.w.y0 + tab.w.y1) / 2;
  const below = lines.filter((l) => l.cy > ty + u * 0.6 && l.x0 < tab.w.x0 + u * 3 && letters(l.text).length >= 6).sort((a, b) => a.cy - b.cy);
  const run = [];
  below.forEach((l) => { const last = run[run.length - 1]; if (!last || l.cy - last.cy < u * 4) run.push(l); });
  if (run.length < 2) return null;
  const x0 = Math.min(...run.map((l) => l.x0)) - 6, x1 = Math.max(...run.map((l) => l.x1)) + 30, y0 = tab.w.y1 + 2, last = run[run.length - 1];
  return { kind: 'chat', box: { x: Math.max(0, x0), y: y0, w: x1 - x0, h: last.y1 + last.h * 1.3 - y0 }, lines: run.length };
}

export function detectChat(words) {
  const lines = toLines(words);
  const stamped = lines.filter((l) => STAMP.test(l.words[0].text) || /^[\[(]\d{1,2}[:.;]\d{2}[\])]/.test(l.words[0].text));
  if (!stamped.length) return detectChatByLabel(lines);
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

// The hover box of an item: its EFFETS header, optionally a STATUT block above it, and POIDS below. Pixel box, like the other detectors.
export function detectTooltip(words) {
  const eff = words.find((w) => /^e?ffets$/i.test(letters(w.text)) && letters(w.text).length >= 5);
  if (!eff) return null;
  const u = Math.max(4, eff.y1 - eff.y0);
  const near = (w) => Math.abs(w.x0 - eff.x0) < u * 3;
  const poids = words.filter((w) => near(w) && w.y0 > eff.y1 && /^poids$/i.test(letters(w.text)))[0];
  if (!poids) return null;
  const st = words.filter((w) => near(w) && w.y1 < eff.y0 && eff.y0 - w.y0 < u * 8 && /^statut$/i.test(letters(w.text)))[0];
  const anchor = st ? st.y0 : eff.y0;
  const x = Math.max(0, eff.x0 - u * 1.4), y = Math.max(0, anchor - u * 14);
  return { kind: 'tooltip', box: { x, y, w: u * 45, h: poids.y0 - u * 0.5 - y }, statut: !!st };
}

export function detectPanels(words) {
  const clean = words.filter((w) => w && w.text && w.x1 > w.x0 && w.y1 > w.y0);
  const out = {};
  [['market', detectMarket], ['popup', detectPopup], ['recipe', detectRecipe], ['chat', detectChat], ['budget', detectBudget], ['tooltip', detectTooltip]].forEach(([k, fn]) => {
    const r = fn(clean);
    if (r) out[k] = r;
  });
  return out;
}
