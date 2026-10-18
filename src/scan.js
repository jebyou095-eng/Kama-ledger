import { cleanInt, findColumns, rowAnchors, splitNameType, wordsOf } from './market.js';

// Browser side of the scanner: offline OCR worker, image clean-up, and one reader per game panel.
let worker = null, loading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('OCR engine files are missing (ocr/tesseract.min.js).'));
    document.head.appendChild(s);
  });
}

export function getWorker() {
  if (worker) return Promise.resolve(worker);
  if (!loading) {
    loading = (async () => {
      const base = new URL('./ocr/', document.baseURI).href;
      await loadScript(base + 'tesseract.min.js');
      const make = (core) => window.Tesseract.createWorker('fra', 1, { workerPath: base + 'worker.min.js', corePath: base + core, langPath: base, gzip: true, workerBlobURL: false });
      try { worker = await make('tesseract-core-simd-lstm.wasm.js'); } catch (e) { worker = await make('tesseract-core-lstm.wasm.js'); }
      return worker;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export async function recognize(canvas, opts) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: String((opts && opts.psm) || 6), tessedit_char_whitelist: (opts && opts.whitelist) || '' });
  return (await w.recognize(canvas)).data;
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

// Market list ("Hôtel de vente"): one entry per row with the raw name, type, level, price and icon.
export async function readMarketList(frame, frac, typeNames) {
  const box = cropBox(frame, frac), K = 3;
  const first = await recognize(whiteText(frame, { x: box.x, y: box.y, w: box.w, h: box.h }, K), { psm: 6 });
  const words = wordsOf(first.words, K);
  const cols = findColumns(words, box.w);
  const anchors = rowAnchors(words, cols);
  const rows = [];
  for (const a of anchors) {
    const y0 = Math.max(a.y0, cols.headerBottom || 0), y1 = Math.min(a.y1, box.h), h = y1 - y0;
    if (h < 8) continue;
    const at = (x0, x1) => ({ x: box.x + x0, y: box.y + y0, w: Math.max(4, x1 - x0), h });
    const nameBox = at(cols.nameX0, cols.levelX0 - 3);
    const nameData = await recognize(whiteText(frame, nameBox, 4), { psm: 6 });
    // Price: several renderings; a read is trusted only when its digit count equals the number of glyphs on screen
    // (OCR tends to drop digits inside runs of 1s).
    const priceReads = [];
    let glyphs = null;
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
    const price = top ? Number(top[0]) : (fallback ? fallback.v : null), sure = (!!top && top[1] >= 2) || allSame;
    const levelData = await recognize(whiteText(frame, at(cols.levelX0, cols.levelX1), 4), { psm: 7, whitelist: '0123456789' });
    const { name, type } = splitNameType(textLines(nameData), typeNames);
    const lv = cleanInt(levelData.text);
    rows.push({
      rawName: name, nameConf: Math.round(nameData.confidence || 0), type, level: lv && lv <= 200 ? lv : a.level, price, priceSure: sure, priceReads: priceReads.map((r) => r.v), glyphs,
      icon: icon(frame, at(0, Math.max(8, cols.nameX0 - 2))),
    });
  }
  return { rows, columnsFromHeader: cols.fromHeader };
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
