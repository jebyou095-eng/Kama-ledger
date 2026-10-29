// The screenshot test library: what categories exist, how many of each are still needed, a category guess, and a plain zip writer.
export const CATS = [
  { id: 'popup', label: 'Item popup', hint: 'the small window with Lot / Prix rows (1, 10, 100, 1000) and "Prix moyen"', min: 30, best: 50 },
  { id: 'market', label: 'Market list', hint: 'the Hôtel de vente list: several items with Niveau and Prix moyen', min: 15, best: 25 },
  { id: 'chart', label: 'Price chart', hint: '"Cours du marché": the curve with 24 heures / 7 jours / 30 jours', min: 12, best: 20 },
  { id: 'tooltip', label: 'Hover box (jets)', hint: 'the box with EFFETS and the stat lines (Vitalité, Force…) of one listing or item', min: 10, best: 20 },
  { id: 'empty', label: 'Other / no price panel', hint: 'a game screen with no price panel (so he learns not to read things that are not there)', min: 3, best: 5 },
];
export const MIN_SIZES = 2;   // popups and charts must be seen at two window sizes at least

export function progress(items) {
  const by = {}; CATS.forEach((c) => { by[c.id] = { id: c.id, label: c.label, hint: c.hint, min: c.min, best: c.best, n: 0, sizes: {} }; });
  (items || []).forEach((it) => { const r = by[it.cat]; if (!r) return; r.n++; const s = it.w + 'x' + it.h; r.sizes[s] = (r.sizes[s] || 0) + 1; });
  return CATS.map((c) => {
    const r = by[c.id], need = Math.max(0, c.min - r.n), sizes = Object.keys(r.sizes).length;
    const wantSizes = c.id === 'popup' || c.id === 'chart';
    return { ...r, need, done: need === 0, sizeCount: sizes, needSizes: wantSizes && r.n > 0 && sizes < MIN_SIZES };
  });
}

export function summary(items) {
  return progress(items).map((p) => p.label + ': ' + p.n + ' / ' + p.min + (p.done ? ' ✓' : ' (' + p.need + ' more)') + (p.needSizes ? ' — also needs a second window size' : '')).join('\n');
}

// guess from what the app's own detector found: keys of the detected profile, and whether the chart reader was sure
export function suggest(profileKeys, chartSure) {
  const k = new Set(profileKeys || []);
  if (chartSure) return 'chart';
  if (k.has('popup')) return 'popup';
  if (k.has('tooltip')) return 'tooltip';
  if (k.has('market')) return 'market';
  return 'empty';
}

// ---- a minimal zip (stored, not compressed: PNGs are already compressed) ----
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function buildZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach((f) => {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, f.data);
    central.push({ name, crc, size, offset });
    offset += head.length + name.length + size;
  });
  const cd = [];
  central.forEach((c) => { cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]), c.name); });
  const cdSize = cd.reduce((s, a) => s + a.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...cd, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let p = 0; all.forEach((a) => { out.set(a, p); p += a.length; });
  return out;
}
