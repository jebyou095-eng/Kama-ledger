import { cardRuns, edge } from './cards.js';
import { detectPanels } from './detect.js';
import { bandLines, bandNumber, cleanInt, findColumns, rowAnchors, splitNameType, wordsOf } from './market.js';

// Browser side of the scanner: offline OCR worker, image clean-up, and one reader per game panel.
let pool = null, loading = null, rowCache = { key: '', rows: [] };
const POOL_SIZE = Math.max(1, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('OCR engine files are missing (ocr/tesseract.min.js).'));
    document.head.appendChild(s);
  });
}

// A few OCR workers so independent panels can be read at the same time (as many as the CPU can afford).
export function getWorker() {
  if (pool) return Promise.resolve(pool.list[0]);
  if (!loading) {
    loading = (async () => {
      const base = new URL('./ocr/', document.baseURI).href;
      await loadScript(base + 'tesseract.min.js');
      const make = (core) => window.Tesseract.createWorker('fra', 1, { workerPath: base + 'worker.min.js', corePath: base + core, langPath: base, gzip: true, workerBlobURL: false });
      let core = 'tesseract-core-simd-lstm.wasm.js';
      let first;
      try { first = await make(core); } catch (e) { core = 'tesseract-core-lstm.wasm.js'; first = await make(core); }
      const more = await Promise.all(Array.from({ length: POOL_SIZE - 1 }, () => make(core).catch(() => null)));
      pool = { list: [first, ...more.filter(Boolean)], free: [], waiting: [] };
      pool.free = pool.list.slice();
      return first;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}
function acquire() {
  return new Promise((res) => { if (pool.free.length) res(pool.free.pop()); else pool.waiting.push(res); });
}
function release(w) { const next = pool.waiting.shift(); if (next) next(w); else pool.free.push(w); }

export async function recognize(canvas, opts) {
  await getWorker();
  const w = await acquire();
  try {
    // setParameters is a round trip to the worker: skip it when this worker already has the same settings
    const want = { tessedit_pageseg_mode: String((opts && opts.psm) || 6), tessedit_char_whitelist: (opts && opts.whitelist) || '' };
    const key = want.tessedit_pageseg_mode + '|' + want.tessedit_char_whitelist;
    if (w.__klParams !== key) { await w.setParameters(want); w.__klParams = key; }
    return (await w.recognize(canvas)).data;
  } finally { release(w); }
}

export const textLines = (data) => String(data.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function cropScaled(src, box, k) {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(box.w * k)); c.height = Math.max(4, Math.round(box.h * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  return c;
}

// Light, uncoloured pixels (white UI text) become black on white. Gold coins, coloured icons and the dark panel disappear.
export function whiteText(src, box, k, bias) {
  const c = cropScaled(src, box, k), g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height), p = img.data, hist = new Array(256).fill(0);
  for (let i = 0; i < p.length; i += 4) hist[Math.round(0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2])]++;
  const total = p.length / 4;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sB = 0, best = 0, thr = 140;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const between = wB * wF * Math.pow(sB / wB - (sum - sB) / wF, 2);
    if (between > best) { best = between; thr = t; }
  }
  thr = Math.max(thr, 110) + (bias || 0);
  for (let i = 0; i < p.length; i += 4) {
    const mx = Math.max(p[i], p[i + 1], p[i + 2]), mn = Math.min(p[i], p[i + 1], p[i + 2]);
    const lum = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    const text = lum > thr && (mx === 0 ? 0 : (mx - mn) / mx) < 0.4;
    p[i] = p[i + 1] = p[i + 2] = text ? 0 : 255; p[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Like whiteText but keeps coloured text too (red/green/orange prices). Crop must exclude the gold kama icon.
export function brightText(src, box, k, frac) {
  const c = cropScaled(src, box, k), g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height), p = img.data;
  let mx = 0; for (let i = 0; i < p.length; i += 4) mx = Math.max(mx, 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]);
  const thr = Math.max(110, mx * (frac || 0.62));
  for (let i = 0; i < p.length; i += 4) {
    const lum = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    p[i] = p[i + 1] = p[i + 2] = lum > thr ? 0 : 255; p[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Greyscale + contrast + invert: for coloured chat text.
export function greyInvert(src, box, k) {
  const c = cropScaled(src, box, k), g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height), p = img.data;
  let mn = 255, mx = 0;
  for (let i = 0; i < p.length; i += 4) { const v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const sc = 255 / Math.max(1, mx - mn);
  for (let i = 0; i < p.length; i += 4) { const v = 255 - (p[i] - mn) * sc; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

export function cropBox(frame, frac) {
  const x = Math.round(frac.x * frame.width), y = Math.round(frac.y * frame.height);
  return { x, y, w: Math.max(8, Math.min(frame.width - x, Math.round(frac.w * frame.width))), h: Math.max(8, Math.min(frame.height - y, Math.round(frac.h * frame.height))) };
}

export function icon(frame, box) {
  if (box.w < 6 || box.h < 6) return null;
  const c = document.createElement('canvas'); c.width = 40; c.height = 40;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(frame, box.x, box.y, box.w, box.h, 0, 0, 40, 40);
  return c.toDataURL('image/jpeg', 0.82);
}

// Square item icon: the row's height, ending just before the name column.
function squareLeft(box, cols, y0, h) {
  const side = Math.min(h, Math.max(8, cols.nameX0));
  return { x: box.x + Math.max(0, cols.nameX0 - side - 2), y: box.y + y0 + (h - side) / 2, w: side, h: side };
}

// Market list ("Hôtel de vente"): one entry per row with the raw name, type, level, price and icon.
export async function readMarketList(frame, frac, typeNames, layout) {
  const box = cropBox(frame, frac), K = 3;
  if (layout) return readMarketRows(frame, box, layout, typeNames);
  const first = await recognize(whiteText(frame, { x: box.x, y: box.y, w: box.w, h: box.h }, K), { psm: 6 });
  const words = wordsOf(first.words, K);
  const cols = findColumns(words, box.w);
  const anchors = rowAnchors(words, cols);
  return { ...(await readRows(frame, box, cols, anchors, typeNames)), columnsFromHeader: cols.fromHeader };
}

async function readMarketRows(frame, box, L, typeNames) {
  const cols = { nameX0: L.cols.nameX0 - box.x, levelX0: L.cols.levelX0 - box.x, levelX1: L.cols.levelX1 - box.x, priceX0: L.cols.priceX0 - box.x, headerBottom: L.headerBottom - box.y };
  const anchors = L.rows.map((r) => ({ cy: r.cy - box.y, y0: r.y0 - box.y, y1: r.y1 - box.y, level: NaN }));
  return { ...(await readRows(frame, box, cols, anchors, typeNames)), columnsFromHeader: true };
}

// Several row crops stacked into one image, so one OCR call reads all rows instead of one call per row.
function stack(crops) {
  const GAP = 28, w = Math.max(...crops.map((c) => c.width)), h = crops.reduce((t, c) => t + c.height + GAP, GAP);
  const c = document.createElement('canvas'); c.width = w + 2 * GAP; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const bands = []; let y = GAP;
  crops.forEach((cr) => { g.drawImage(cr, GAP, y); bands.push([y, y + cr.height]); y += cr.height + GAP; });
  return { canvas: c, bands };
}
// Slow path for one row: several renderings, a read is trusted only when its digit count equals the glyphs on screen.
// The renderings are read at the same time (the worker pool shares them), not one after another.
async function priceByVoting(frame, at, cols, box) {
  const crops = [[3, 0], [4, 0], [4, 30], [6, 0], [5, 45]].map(([k, bias]) => whiteText(frame, at(cols.priceX0, box.w), k, bias));
  const glyphs = countGlyphs(crops[0]);
  const priceReads = (await Promise.all(crops.map((crop) => recognize(crop, { psm: 7, whitelist: '0123456789 ' })))).map((d) => {
    const v = cleanInt(d.text);
    return { v: v && v > 0 ? v : null, ok: v !== null && v > 0 && String(v).length === glyphs };
  });
  // The glyph count is only a hint (it can miscount): every read votes, a read whose digit count matches gets a small bonus.
  const votes = {}, count = {};
  priceReads.filter((r) => r.v).forEach((r) => { count[r.v] = (count[r.v] || 0) + 1; votes[r.v] = (votes[r.v] || 0) + 1 + (r.ok ? 0.5 : 0); });
  const top = Object.entries(votes).sort((x, y) => y[1] - x[1] || String(y[0]).length - String(x[0]).length)[0];
  const allSame = priceReads.length > 0 && priceReads.every((r) => r.v && r.v === priceReads[0].v);
  return { price: top ? Number(top[0]) : null, sure: (!!top && count[top[0]] >= 2 && (!Object.keys(count).some((k) => k !== top[0] && count[k] >= count[top[0]]))) || allSame, reads: priceReads.map((r) => r.v), glyphs };
}

async function readRows(frame, box, cols, anchors, typeNames) {
  const t0 = performance.now();
  const rowsIn = [];
  for (const a of anchors) {
    const y0 = Math.max(a.y0, cols.headerBottom || 0), y1 = Math.min(a.y1, box.h), h = y1 - y0;
    if (h < 8) continue;
    rowsIn.push({ a, y0, h, at: (x0, x1) => ({ x: box.x + x0, y: box.y + y0, w: Math.max(4, x1 - x0), h }) });
  }
  if (!rowsIn.length) return { rows: [], ms: 0 };
  // Rows that look exactly like a row read in the last scan (even if the list moved up or down) keep their reading.
  const layoutKey = [cols.nameX0, cols.levelX0, cols.priceX0, box.w].map((v) => Math.round(v / 6)).join(',');
  rowsIn.forEach((r) => { try { r.fp = fingerprint(frame, r.at(cols.nameX0, box.w)); } catch (e) { r.fp = null; } });
  const old = rowCache.key === layoutKey ? rowCache.rows.slice() : [];
  const reused = new Map();
  rowsIn.forEach((r, i) => { const j = old.findIndex((o) => r.fp && sameFingerprint(o.fp, r.fp)); if (j >= 0) { reused.set(i, old[j].row); old.splice(j, 1); } });
  const allIn = rowsIn.slice();
  const todo = rowsIn.filter((_, i) => !reused.has(i));
  rowsIn.length = 0; todo.forEach((r) => rowsIn.push(r));
  if (!rowsIn.length) {
    const rowsOnly = allIn.map((r, i) => ({ ...reused.get(i), cy: box.y + r.y0 + r.h / 2, icon: icon(frame, squareLeft(box, cols, r.y0, r.h)), cached: true }));
    rowCache = { key: layoutKey, rows: allIn.map((r, i) => ({ fp: r.fp, row: rowsOnly[i] })) };
    return { rows: rowsOnly, ms: Math.round(performance.now() - t0), cached: rowsOnly.length };
  }
  // Fast path: three stacked reads (names, levels, prices) plus a second price read at another scale.
  const nameCrops = rowsIn.map((r) => whiteText(frame, r.at(cols.nameX0, cols.levelX0 - 3), 4));
  const lvlCrops = rowsIn.map((r) => whiteText(frame, r.at(cols.levelX0, cols.levelX1), 4));
  const priceA = rowsIn.map((r) => whiteText(frame, r.at(cols.priceX0, box.w), 4));
  const priceB = rowsIn.map((r) => whiteText(frame, r.at(cols.priceX0, box.w), 6));
  const glyphs = priceA.map(countGlyphs);
  const sn = stack(nameCrops), sl = stack(lvlCrops), sa = stack(priceA), sb = stack(priceB);
  // The four reads are independent: they run together on the worker pool.
  const [dn, dl, da, db] = await Promise.all([
    recognize(sn.canvas, { psm: 6 }),
    recognize(sl.canvas, { psm: 6, whitelist: '0123456789 ' }),
    recognize(sa.canvas, { psm: 6, whitelist: '0123456789 ' }),
    recognize(sb.canvas, { psm: 6, whitelist: '0123456789 ' }),
  ]);
  const names = bandLines(dn, sn.bands), lvls = bandLines(dl, sl.bands), pa = bandLines(da, sa.bands), pb = bandLines(db, sb.bands);
  // Rows that need a slow retry (unreadable name, doubtful price, bad level) are retried together, not one row after another.
  const rows = await Promise.all(rowsIn.map(async (r, i) => {
    let nm = names[i], lines = nm.lines;
    const nameJob = (!lines.length || nm.conf < 60)
      ? recognize(whiteText(frame, r.at(cols.nameX0, cols.levelX0 - 3), 4), { psm: 6 }).then((d) => { lines = textLines(d); nm = { conf: d.confidence || 0 }; })
      : null;
    const va = bandNumber(pa[i].lines), vb = bandNumber(pb[i].lines);
    const priceJob = (va !== null && va === vb && String(va).length === glyphs[i])
      ? Promise.resolve({ price: va, sure: true, reads: [va, vb] })
      : priceByVoting(frame, r.at, cols, box);
    let lv = bandNumber(lvls[i].lines);
    const lvJob = (!lv || lv > 200)
      ? recognize(whiteText(frame, r.at(cols.levelX0, cols.levelX1), 4), { psm: 7, whitelist: '0123456789' }).then((d) => { lv = cleanInt(d.text); })
      : null;
    const [v] = await Promise.all([priceJob, nameJob, lvJob]);
    const { name, type } = splitNameType(lines, typeNames);
    return { rawName: name, nameConf: Math.round(nm.conf || 0), type, level: lv && lv <= 200 ? lv : (r.a.level || null), price: v.price, priceSure: v.sure, priceReads: v.reads, glyphs: glyphs[i], cy: box.y + r.y0 + r.h / 2, cx: box.x + box.w * 0.55, bx: box.x, by: box.y + r.y0, bw: box.w, bh: r.h, fw: frame.width, fh: frame.height, icon: icon(frame, squareLeft(box, cols, r.y0, r.h)) };
  }));
  const real = rows.filter((r) => !((r.nameConf < 40 || !r.priceSure) && !/[A-Za-zÀ-ÿ]{4,}/.test(r.rawName || "")));
  // put the reused rows back in their places, then remember the trustworthy ones for the next scan
  const fresh = new Map(); rows.forEach((r, i) => fresh.set(todo[i], r));
  const merged = [], keep = [];
  allIn.forEach((r, i) => {
    let row, wasCached = false;
    if (reused.has(i)) { row = { ...reused.get(i), cy: box.y + r.y0 + r.h / 2, by: box.y + r.y0, bh: r.h, icon: icon(frame, squareLeft(box, cols, r.y0, r.h)), cached: true }; wasCached = true; }
    else { const f = fresh.get(r); row = f && real.includes(f) ? f : null; }
    if (!row) return;
    merged.push(row);
    if (r.fp && (wasCached || (row.priceSure && row.nameConf >= 60))) keep.push({ fp: r.fp, row });
  });
  rowCache = { key: layoutKey, rows: keep };
  return { rows: merged, ms: Math.round(performance.now() - t0), cached: reused.size };
}

// ---- "Have I already read exactly this?" ----
// A fingerprint is a small grey picture of a region split in blocks. Two regions are the same when every block is nearly the same:
// then the text is the same and the earlier reading is reused instead of running OCR again (capture noise stays under the limit,
// one changed digit goes far over it).
export function fingerprint(frame, box) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.max(4, Math.min(frame.width - x, Math.round(box.w))), h = Math.max(4, Math.min(frame.height - y, Math.round(box.h)));
  const FW = 192, FH = Math.max(8, Math.min(48, Math.round(FW * h / w)));
  const c = document.createElement('canvas'); c.width = FW; c.height = FH;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(frame, x, y, w, h, 0, 0, FW, FH);
  const p = g.getImageData(0, 0, FW, FH).data, v = new Uint8Array(FW * FH);
  for (let i = 0; i < v.length; i++) v[i] = 0.3 * p[i * 4] + 0.59 * p[i * 4 + 1] + 0.11 * p[i * 4 + 2];
  return { v, w: FW, h: FH };
}
export function sameFingerprint(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return false;
  const BW = 8, rows = Math.max(1, Math.floor(a.h / 4)), bx = a.w / BW, by = a.h / rows, nb = BW * rows;
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const k = Math.min(rows - 1, Math.floor(y / by)) * BW + Math.min(BW - 1, Math.floor(x / bx));
    sum[k] += Math.abs(a.v[y * a.w + x] - b.v[y * a.w + x]); cnt[k]++;
  }
  for (let k = 0; k < nb; k++) if (cnt[k] && sum[k] / cnt[k] > 4) return false;
  return true;
}
const textCache = new Map();   // "mode|box" -> { fp, lines }

export async function readText(frame, frac, mode) {
  const box = cropBox(frame, frac);
  const key = mode + '|' + Math.round(box.x / 12) + ',' + Math.round(box.y / 12) + ',' + Math.round(box.w / 12) + ',' + Math.round(box.h / 12);
  let fp = null;
  try { fp = fingerprint(frame, box); const hit = textCache.get(key); if (hit && sameFingerprint(hit.fp, fp)) return hit.lines.slice(); } catch (e) { fp = null; }
  const data = await recognize(mode === 'grey' ? greyInvert(frame, box, 3) : whiteText(frame, box, 3), { psm: 6 });
  const lines = textLines(data);
  if (fp) textCache.set(key, { fp, lines: lines.slice() });
  return lines;
}

export async function readNumber(frame, frac) {
  const box = cropBox(frame, frac);
  const data = await recognize(whiteText(frame, box, 4), { psm: 7, whitelist: '0123456789 ' });
  return String(data.text || '').trim();
}

export function frameFromVideo(video) {
  if (!video || !video.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0);
  return c;
}

export function frameFromUrl(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0); res(c); };
    im.onerror = () => rej(new Error('Could not read the image.'));
    im.src = url;
  });
}

// Number of dark glyphs in a black-on-white crop (flood fill). A round, hollow blob at the end is the coin icon and is not counted.
export function countGlyphs(canvas) {
  const w = canvas.width, h = canvas.height, data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = data[i * 4] < 128 ? 1 : 0;
  const seen = new Uint8Array(w * h), comps = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || seen[start]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !dark[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    comps.push({ x0, y0, x1, y1, area, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const tall = Math.max(0, ...comps.map((c) => c.h));
  let glyphs = comps.filter((c) => c.h >= tall * 0.6 && c.area > 6).sort((a, b) => a.x0 - b.x0);
  const last = glyphs[glyphs.length - 1];
  if (last && last.w / last.h > 0.85 && last.area / (last.w * last.h) < 0.6) glyphs = glyphs.slice(0, -1);
  return glyphs.length;
}

// Sparse full-frame reading, split into vertical strips so every worker of the pool reads one at the same time.
// Strips overlap by more than a word; a word is kept only by the strip that owns its centre, so nothing is read twice or cut.
async function sparseWords(c, k) {
  await getWorker();
  const n = Math.max(1, Math.min(4, poolSize()));
  const toWords = (data, dx) => (data.words || []).filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), x0: (w.bbox.x0 + dx) / k, y0: w.bbox.y0 / k, x1: (w.bbox.x1 + dx) / k, y1: w.bbox.y1 / k, conf: Math.round(w.confidence) }));
  if (n === 1) return toWords(await recognize(c, { psm: 11 }), 0);
  const W = c.width, H = c.height, ov = Math.round(260 * k);
  const parts = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const own0 = Math.round(W * i / n), own1 = Math.round(W * (i + 1) / n);
    const x0 = Math.max(0, own0 - ov), x1 = Math.min(W, own1 + ov);
    const t = document.createElement('canvas'); t.width = x1 - x0; t.height = H;
    t.getContext('2d', { willReadFrequently: true }).drawImage(c, x0, 0, x1 - x0, H, 0, 0, x1 - x0, H);
    return toWords(await recognize(t, { psm: 11 }), x0).filter((w) => { const cx = (w.x0 + w.x1) / 2 * k; return cx >= own0 && (cx < own1 || i === n - 1); });
  }));
  return parts.flat();
}

// Zero-setup mode: one sparse OCR pass over the whole frame finds every panel by its own text.
// Returns fractions of the frame, one box per panel that is actually on screen.
export async function autoDetect(frame, kOverride) {
  const k = kOverride || Math.min(2, Math.max(1.4, 1500 / frame.height));
  const c = document.createElement('canvas');
  c.width = Math.round(frame.width * k); c.height = Math.round(frame.height * k);
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(frame, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let mn = 255, mx = 0;
  for (let i = 0; i < p.length; i += 4) { const v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const sc = 255 / Math.max(1, mx - mn);
  for (let i = 0; i < p.length; i += 4) { const v = 255 - (p[i] - mn) * sc; p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0);
  const words = await sparseWords(c, k);
  const found = detectPanels(words), out = {}, W = frame.width, H = frame.height;
  Object.keys(found).forEach((key) => {
    const b = found[key].box, x = Math.max(0, b.x), y = Math.max(0, b.y);
    out[key] = { x: x / W, y: y / H, w: Math.min(W - x, b.w) / W, h: Math.min(H - y, b.h) / H };
  });
  Object.defineProperty(out, '_layout', { value: found, enumerable: false });
  Object.defineProperty(out, '_words', { value: words, enumerable: false });
  Object.defineProperty(out, '_k', { value: k, enumerable: false });
  lastProfile = { W, H, t: Date.now(), out };
  return out;
}

// The panels found by the last full detection: reused while the game window stays the same size, so a rescan can skip the
// slowest step. The popup box is made taller (its height depends on how many lots the item has; reading empty space is harmless).
let lastProfile = null;
export function cachedProfile(frame) {
  if (!lastProfile || lastProfile.W !== frame.width || lastProfile.H !== frame.height || Date.now() - lastProfile.t > 10 * 60 * 1000) return null;
  const o = lastProfile.out, out = {};
  Object.keys(o).forEach((key) => { if (key !== 'tooltip') out[key] = { ...o[key] }; });   // the hover box follows the mouse: never reuse its place
  if (out.popup) out.popup.h = Math.min(1 - out.popup.y, out.popup.h + 0.09);
  if (!Object.keys(out).length) return null;
  Object.defineProperty(out, '_layout', { value: o._layout, enumerable: false });
  Object.defineProperty(out, '_cached', { value: true, enumerable: false });
  if (o.popup) Object.defineProperty(out, '_raw', { value: { popup: { ...o.popup } }, enumerable: false });   // the popup box as detected, before it was made taller for reading
  return out;
}
// Which lot row is under the mouse? The game lights it up. Looks at a strip of the rows' background (between the star and the price)
// and returns the band of that row as a fraction box of the frame (full popup width), or null when no row stands out.
export function hoveredBand(frame, frac) {
  const b = cropBox(frame, frac);
  const x0 = Math.round(b.x + b.w * 0.36), x1 = Math.round(b.x + b.w * 0.45);
  if (x1 - x0 < 3) return null;
  const g = document.createElement('canvas'); g.width = x1 - x0; g.height = b.h;
  const cx = g.getContext('2d', { willReadFrequently: true }); cx.drawImage(frame, x0, b.y, x1 - x0, b.h, 0, 0, x1 - x0, b.h);
  const d = cx.getImageData(0, 0, g.width, g.height).data, lum = [];
  for (let y = 0; y < g.height; y++) { const v = []; for (let x = 0; x < g.width; x++) { const i = (y * g.width + x) * 4; v.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]); } v.sort((a, c) => a - c); lum.push(v[v.length >> 1]); }
  const low = lum.slice(Math.floor(lum.length * 0.4)).sort((a, c) => a - c), base = low[low.length >> 1];
  const runs = []; let cur = null;
  const close = () => { if (cur && cur.n >= 8) { cur.m = cur.sum / cur.n; runs.push(cur); } cur = null; };
  lum.forEach((v, y) => { if (v > base - 6) { if (!cur) cur = { y0: y, sum: 0, n: 0 }; cur.sum += v; cur.n++; cur.y1 = y; } else close(); });
  close();
  // a lot row is as tall as most of the bright runs; thin bright bits (text lines of the header) are not rows
  const hs = runs.map((r) => r.n).sort((a, c) => a - c), typ = hs[hs.length >> 1] || 0;
  const best = runs.filter((r) => r.n >= typ * 0.7 && r.m > base + 12).sort((a, c) => c.m - a.m)[0];
  if (!best) return null;
  const pad = 2;
  return { x: b.x / frame.width, y: (b.y + best.y0 - pad) / frame.height, w: b.w / frame.width, h: (best.n + 2 * pad) / frame.height };
}
// The separate cards of the market list as fraction boxes of the frame (gaps between them stay empty).
export function marketCards(frame, frac) {
  const b = cropBox(frame, frac);
  const xa = Math.round(b.x + b.w * 0.68), xb = Math.round(b.x + b.w * 0.96);
  if (xb - xa < 6 || b.h < 30) return [];
  const g = document.createElement('canvas'); g.width = frame.width; g.height = b.h;
  const cx = g.getContext('2d', { willReadFrequently: true }); cx.drawImage(frame, 0, b.y, frame.width, b.h, 0, 0, frame.width, b.h);
  const d = cx.getImageData(0, 0, g.width, g.height).data;
  const L = (x, y) => { const i = (y * g.width + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  const lum = [];
  for (let y = 0; y < b.h; y++) { const v = []; for (let x = xa; x < xb; x += 2) v.push(L(x, y)); v.sort((p, q) => p - q); lum.push(v[v.length >> 1]); }
  const found = cardRuns(lum, Math.max(12, Math.round(frame.height * 0.02))).map((r) => {
    const row = []; for (let x = 0; x < g.width; x++) { const v = []; for (let y = r.y0 + 1; y <= Math.min(r.y0 + 3, r.y1); y++) v.push(L(x, y)); row.push(v.reduce((a, c) => a + c, 0) / v.length); }
    const xm = Math.round((xa + xb) / 2), l = edge(row, xm, -1, r.level, 10), rr = edge(row, xm, 1, r.level, 10);
    return { x: l / frame.width, y: (b.y + r.y0) / frame.height, w: (rr - l + 1) / frame.width, h: (r.y1 - r.y0 + 1) / frame.height };
  }).filter((c) => c.w > 0.1);
  // one list: all cards share the same left and right edge (a popup lying over a card must not shorten it)
  if (found.length) { const l = Math.min(...found.map((c) => c.x)), r = Math.max(...found.map((c) => c.x + c.w)); found.forEach((c) => { c.x = l; c.w = r - l; }); }
  return found;
}
export function forgetProfile() { lastProfile = null; }

// Tiny greyscale fingerprint used to tell "the screen changed" from "same screen".
export function signature(frame) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 27;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(frame, 0, 0, 48, 27);
  const p = g.getImageData(0, 0, 48, 27).data, out = new Uint8Array(48 * 27);
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * p[i * 4] + 0.59 * p[i * 4 + 1] + 0.11 * p[i * 4 + 2];
  return out;
}
export function sigDiff(a, b) {
  if (!a || !b) return 255;
  let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
  return t / a.length;
}

export const poolSize = () => (pool ? pool.list.length : 0);
export function cropJpeg(frame, box, maxW, q) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.max(8, Math.min(frame.width - x, Math.round(box.w))), h = Math.max(8, Math.min(frame.height - y, Math.round(box.h)));
  const k = Math.min(1, maxW / w);
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d', { willReadFrequently: true }).drawImage(frame, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
export const cacheStats = () => ({ n: rowCache.rows.length, key: rowCache.key });
