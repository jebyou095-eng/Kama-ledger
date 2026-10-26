// The filtration stage: a reading is checked against what the app already knows before it is saved. Pure functions, no DOM.
//   checkPrice  a market price against that item's own history: accept, repair from the other OCR reads, or flag
//   checkLots   the four lot prices of a popup against its average price
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const pos = (v) => Number.isFinite(v) && v > 0;

// What this item usually costs: the median of its last prices, with the lowest and highest it has had.
export function priceProfile(rec) {
  const vals = ((rec && rec.history) || []).map((p) => p && p[1]).filter(pos).slice(-8);
  if (!vals.length && rec && pos(rec.price)) vals.push(rec.price);
  if (!vals.length) return null;
  return { ref: median(vals), min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

export function checkPrice(price, reads, rec) {
  const prof = priceProfile(rec);
  if (!pos(price)) return { status: 'bad', price: null, reason: 'no price read' };
  if (!prof) return { status: 'new', price };
  // generous: prices move, but a 69 that reads as 5 is not a market move
  const lo = Math.min(prof.ref * 0.5, prof.min * 0.7), hi = Math.max(prof.ref * 2, prof.max * 1.4);
  const inBand = (v) => pos(v) && v >= lo && v <= hi;
  if (inBand(price)) return { status: 'ok', price, ref: prof.ref };
  const others = [...new Set((reads || []).filter(pos))].filter(inBand).sort((a, b) => Math.abs(Math.log(a / prof.ref)) - Math.abs(Math.log(b / prof.ref)));
  if (others.length) return { status: 'fixed', price: others[0], ref: prof.ref, reason: 'read ' + price + ', other passes and history say ' + others[0] };
  return { status: 'suspect', price, ref: prof.ref, reason: 'price ' + price + ' but this item usually costs about ' + Math.round(prof.ref) };
}

// Lot price / lot size is the price of one unit: it should stay near the average price of the item.
export function checkLots(lots, avg, offers) {
  const bad = [];
  if (!pos(avg)) return { bad, ok: Object.keys(lots || {}).length > 0 };
  Object.entries(lots || {}).forEach(([size, total]) => {
    const unit = total / Number(size);
    // several offers of one size: the cheapest being far under the average is a real listing, not a misread
    const many = offers && offers[size] && offers[size].length >= 3;
    if (!pos(unit) || (!many && unit < avg * 0.2) || unit > avg * 5) bad.push(Number(size));
  });
  return { bad, ok: true };
}
