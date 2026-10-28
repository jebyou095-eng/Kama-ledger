// Reads the lot rows of the price popup cell by cell: the lot size and the price are each cropped, enlarged and read as digits only.
// The whole-popup read confuses 8/3, drops thousands and loses coloured prices; the cell read does not.
import { recognize, brightText, whiteText } from './scan.js';

const SIZES = [1, 10, 100, 1000];

// y-bands of the lighter row bars, found on a strip near the popup's left edge. prof: luminance per pixel row from the popup top.
export function findBands(prof, minH) {
  const s = prof.slice().sort((a, b) => a - b), base = s[Math.floor(s.length * 0.3)];
  const rows = []; let st = -1;
  prof.forEach((v, i) => {
    const on = v > base + 6;
    if (on && st < 0) st = i;
    if (!on && st >= 0) { if (i - st >= minH) rows.push([st, i]); st = -1; }
  });
  if (st >= 0 && prof.length - st >= minH) rows.push([st, prof.length]);
  return rows;
}

export function vote(v) { const c = {}; v.forEach((x) => { if (x > 0) c[x] = (c[x] || 0) + 1; }); const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; return best && c[best] >= 2 ? Number(best) : null; }

export function digits(t) { const d = String(t || '').replace(/\D/g, ''); return d ? Number(d) : null; }

export async function readLotRows(frame, pb) {
  const g = frame.getContext('2d'), sx = Math.round(pb.x + pb.w * 0.03), prof = [];
  const y0 = Math.max(0, Math.round(pb.y)), y1 = Math.min(frame.height, Math.round(pb.y + pb.h));
  for (let y = y0; y < y1; y++) { const d = g.getImageData(sx, y, 6, 1).data; let s = 0; for (let i = 0; i < 24; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; prof.push(s / 6); }
  const bands = findBands(prof, Math.max(6, pb.h * 0.04)).slice(-4);
  const out = {};
  for (const [a, z] of bands) {
    const y = y0 + a, h = z - a, opt = { psm: 7, whitelist: '0123456789 ' };
    const q = await recognize(whiteText(frame, { x: pb.x + pb.w * 0.15, y: y + h * 0.15, w: pb.w * 0.2, h: h * 0.7 }, 5), opt);
    // three differently enlarged and thresholded reads of the price vote; the answer must be agreed by at least two
    const box = { x: pb.x + pb.w * 0.34, y: y + h * 0.15, w: pb.w * 0.365, h: h * 0.7 };
    const votes = await Promise.all([[4, 0.55], [5, 0.62], [6, 0.7]].map(([k, f]) => recognize(brightText(frame, box, k, f), opt).then((d) => digits(d.text))));
    const price = vote(votes), qty = digits(q.text);
    if (SIZES.includes(qty) && price > 0 && !(qty in out)) out[qty] = price;
  }
  return out;
}
