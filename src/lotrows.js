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

// Reads the rows. Fast path: ONE pixel read for the whole strip (a read per pixel row made popups take 15 to 40 s on a real screen).
// Returns { lots, diag }: lots by size, diag for the status file (bands found, what each cell said, how long it took).
export async function readLotRows(frame, pb) {
  const t0 = Date.now(), ctx = frame.getContext('2d', { willReadFrequently: true }), sx = Math.round(pb.x + pb.w * 0.03), prof = [];
  const y0 = Math.max(0, Math.round(pb.y)), y1 = Math.min(frame.height, Math.round(pb.y + pb.h)), H = y1 - y0;
  if (H < 20 || sx < 0 || sx + 6 > frame.width) return { lots: {}, diag: { bands: 0, ms: 0 } };
  const d = ctx.getImageData(sx, y0, 6, H).data;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < 6; x++) { const i = (y * 6 + x) * 4; s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; } prof.push(s / 6); }
  const found = findBands(prof, Math.max(6, pb.h * 0.04)), bands = found.length === 4 ? found : found.slice(-4), reads = [], lots = {};
  const opt = { psm: 7, whitelist: '0123456789 ' };
  for (let i = 0; i < bands.length; i++) {
    const y = y0 + bands[i][0], h = bands[i][1] - bands[i][0];
    const q = await recognize(whiteText(frame, { x: pb.x + pb.w * 0.15, y: y + h * 0.15, w: pb.w * 0.2, h: h * 0.7 }, 4), opt);
    // three differently enlarged and thresholded reads of the price vote; the answer must be agreed by at least two
    const box = { x: pb.x + pb.w * 0.34, y: y + h * 0.15, w: pb.w * 0.365, h: h * 0.7 };
    const votes = await Promise.all([[3, 0.55], [4, 0.62], [5, 0.7]].map(([k, f]) => recognize(brightText(frame, box, k, f), opt).then((r) => digits(r.text))));
    reads.push({ qty: digits(q.text), votes });
  }
  // sizes: the OCR'd size when it is a real lot size, else (four rows) the fixed order 1, 10, 100, 1000
  reads.forEach((r, i) => {
    const size = SIZES.includes(r.qty) ? r.qty : (reads.length === 4 ? SIZES[i] : null), price = vote(r.votes);
    if (size && price > 0 && !(size in lots)) lots[size] = price;
  });
  return { lots, diag: { bands: found.length, used: bands.length, reads, ms: Date.now() - t0 } };
}
