import { detectPanels } from './detect.js';
import { cleanInt, findColumns, rowAnchors, splitNameType, wordsOf } from './market.js';

// Browser side of the scanner: offline OCR worker, image clean-up, and one reader per game panel.
let pool = null, loading = null;
const POOL_SIZE = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

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
    await w.setParameters({ tessedit_pageseg_mode: String((opts && opts.psm) || 6), tessedit_char_whitelist: (opts && opts.whitelist) || '' });
    return (await w.recognize(canvas)).data;
  } finally { release(w); }
}

export const textLines = (data) => String(data.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function cropScaled(src, box, k) {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(box.w * k)); c.height = Math.max(4, Math.round(box.h * k));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  return c;
}

// Light, uncoloured pixels (white UI text) become black on white. Gold coins, coloured icons and the dark panel disappear.
export function whiteText(src, box, k, bias) {
  const c = cropScaled(src, box, k), g = c.getContext('2d');
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

// Greyscale + contrast + invert: for coloured chat text.
export function greyInvert(src, box, k) {
  const c = cropScaled(src, box, k), g = c.getContext('2d');
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
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
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
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const bands = []; let y = GAP;
  crops.forEach((cr) => { g.drawImage(cr, GAP, y); bands.push([y, y + cr.height]); y += cr.height + GAP; });
  return { canvas: c, bands };
}
// Words of a stacked read, grouped back into the row they came from.
function bandLines(data, bands) {
  const words = (data.words || []).filter((w) => String(w.text).trim());
  return bands.map(([y0, y1]) => {
    const mine = words.filter((w) => (w.bbox.y0 + w.bbox.y1) / 2 >= y0 - 14 && (w.bbox.y0 + w.bbox.y1) / 2 <= y1 + 14).sort((p, q) => (p.bbox.y0 + p.bbox.y1) / 2 - (q.bbox.y0 + q.bbox.y1) / 2);
    const lines = [];
    mine.forEach((w) => { const cy = (w.bbox.y0 + w.bbox.y1) / 2, last = lines[lines.length - 1]; if (last && Math.abs(cy - last.cy) < (w.bbox.y1 - w.bbox.y0) * 0.7) { last.w.push(w); } else lines.push({ cy, w: [w] }); });
    return { lines: lines.map((l) => l.w.sort((p, q) => p.bbox.x0 - q.bbox.x0).map((w) => w.text).join(' ')), conf: mine.length ? mine.reduce((t, w) => t + w.confidence, 0) / mine.length : 0 };
  });
}

// Slow path for one row: several renderings, a read is trusted only when its digit count equals the glyphs on screen.
async function priceByVoting(frame, at, cols, box) {
  const priceReads = []; let glyphs = null;
  for (const [k, bias] of [[3, 0], [4, 0], [4, 30], [6, 0], [5, 45]]) {
    const crop = whiteText(frame, at(cols.priceX0, box.w), k, bias);
    if (glyphs === null) glyphs = countGlyphs(crop);
    const d = await recognize(crop, { psm: 7, whitelist: '0123456789 ' });
    const v = cleanInt(d.text);
    priceReads.push({ v, ok: v !== null && String(v).length === glyphs });
  }
  const votes = {};
  priceReads.filter((r) => r.ok).forEach((r) => { votes[r.v] = (votes[r.v] || 0) + 1; });
  const top = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
  const fallback = priceReads.find((r) => r.v);
  const allSame = priceReads.length > 0 && priceReads.every((r) => r.v && r.v === priceReads[0].v);
  return { price: top ? Number(top[0]) : (fallback ? fallback.v : null), sure: (!!top && top[1] >= 2) || (allSame && (glyphs === 0 || String(priceReads[0].v).length === glyphs)), reads: priceReads.map((r) => r.v), glyphs };
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
  // Fast path: three stacked reads (names, levels, prices) plus a second price read at another scale.
  const nameCrops = rowsIn.map((r) => whiteText(frame, r.at(cols.nameX0, cols.levelX0 - 3), 4));
  const lvlCrops = rowsIn.map((r) => whiteText(frame, r.at(cols.levelX0, cols.levelX1), 4));
  const priceA = rowsIn.map((r) => whiteText(frame, r.at(cols.priceX0, box.w), 4));
  const priceB = rowsIn.map((r) => whiteText(frame, r.at(cols.priceX0, box.w), 6));
  const glyphs = priceA.map(countGlyphs);
  const sn = stack(nameCrops), sl = stack(lvlCrops), sa = stack(priceA), sb = stack(priceB);
  const dn = await recognize(sn.canvas, { psm: 6 });
  const dl = await recognize(sl.canvas, { psm: 6, whitelist: '0123456789 ' });
  const da = await recognize(sa.canvas, { psm: 6, whitelist: '0123456789 ' });
  const db = await recognize(sb.canvas, { psm: 6, whitelist: '0123456789 ' });
  const names = bandLines(dn, sn.bands), lvls = bandLines(dl, sl.bands), pa = bandLines(da, sa.bands), pb = bandLines(db, sb.bands);
  const rows = [];
  for (let i = 0; i < rowsIn.length; i++) {
    const r = rowsIn[i];
    let nm = names[i], lines = nm.lines;
    if (!lines.length || nm.conf < 60) {   // slow path for an unreadable name
      const d = await recognize(whiteText(frame, r.at(cols.nameX0, cols.levelX0 - 3), 4), { psm: 6 });
      lines = textLines(d); nm = { conf: d.confidence || 0 };
    }
    const va = cleanInt(pa[i].lines.join('')), vb = cleanInt(pb[i].lines.join(''));
    let price, sure, reads;
    if (va !== null && va === vb && String(va).length === glyphs[i]) { price = va; sure = true; reads = [va, vb]; }
    else { const v = await priceByVoting(frame, r.at, cols, box); price = v.price; sure = v.sure; reads = v.reads; }
    let lv = cleanInt(lvls[i].lines.join(''));
    if (!lv || lv > 200) { const d = await recognize(whiteText(frame, r.at(cols.levelX0, cols.levelX1), 4), { psm: 7, whitelist: '0123456789' }); lv = cleanInt(d.text); }
    const { name, type } = splitNameType(lines, typeNames);
    rows.push({ rawName: name, nameConf: Math.round(nm.conf || 0), type, level: lv && lv <= 200 ? lv : (r.a.level || null), price, priceSure: sure, priceReads: reads, glyphs: glyphs[i], icon: icon(frame, squareLeft(box, cols, r.y0, r.h)) });
  }
  return { rows, ms: Math.round(performance.now() - t0) };
}

export async function readText(frame, frac, mode) {
  const box = cropBox(frame, frac);
  const data = await recognize(mode === 'grey' ? greyInvert(frame, box, 3) : whiteText(frame, box, 3), { psm: 6 });
  return textLines(data);
}

export async function readNumber(frame, frac) {
  const box = cropBox(frame, frac);
  const data = await recognize(whiteText(frame, box, 4), { psm: 7, whitelist: '0123456789 ' });
  return String(data.text || '').trim();
}

export function frameFromVideo(video) {
  if (!video || !video.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

export function frameFromUrl(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); res(c); };
    im.onerror = () => rej(new Error('Could not read the image.'));
    im.src = url;
  });
}

// Number of dark glyphs in a black-on-white crop (flood fill). A round, hollow blob at the end is the coin icon and is not counted.
export function countGlyphs(canvas) {
  const w = canvas.width, h = canvas.height, data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
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

// Zero-setup mode: one sparse OCR pass over the whole frame finds every panel by its own text.
// Returns fractions of the frame, one box per panel that is actually on screen.
export async function autoDetect(frame, kOverride) {
  const k = kOverride || Math.min(2, Math.max(1.4, 1500 / frame.height));
  const c = document.createElement('canvas');
  c.width = Math.round(frame.width * k); c.height = Math.round(frame.height * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(frame, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let mn = 255, mx = 0;
  for (let i = 0; i < p.length; i += 4) { const v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const sc = 255 / Math.max(1, mx - mn);
  for (let i = 0; i < p.length; i += 4) { const v = 255 - (p[i] - mn) * sc; p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0);
  const data = await recognize(c, { psm: 11 });
  const words = (data.words || []).filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), x0: w.bbox.x0 / k, y0: w.bbox.y0 / k, x1: w.bbox.x1 / k, y1: w.bbox.y1 / k, conf: Math.round(w.confidence) }));
  const found = detectPanels(words), out = {}, W = frame.width, H = frame.height;
  Object.keys(found).forEach((key) => {
    const b = found[key].box, x = Math.max(0, b.x), y = Math.max(0, b.y);
    out[key] = { x: x / W, y: y / H, w: Math.min(W - x, b.w) / W, h: Math.min(H - y, b.h) / H };
  });
  Object.defineProperty(out, '_layout', { value: found, enumerable: false });
  Object.defineProperty(out, '_words', { value: words, enumerable: false });
  Object.defineProperty(out, '_k', { value: k, enumerable: false });
  return out;
}

// Tiny greyscale fingerprint used to tell "the screen changed" from "same screen".
export function signature(frame) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 27;
  const g = c.getContext('2d'); g.drawImage(frame, 0, 0, 48, 27);
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
  c.getContext('2d').drawImage(frame, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
