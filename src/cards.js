// Finds the separate cards (rows with a gap between them) of the market list from a column of brightness values.
// lum[y] = typical brightness of line y across the list. Cards are tall runs of one level; the gaps between them are thin runs of another.
export function cardRuns(lum, minH) {
  const tol = 5, mh = minH || 14, runs = [];
  let cur = null;
  lum.forEach((v, y) => {
    if (cur && Math.abs(v - cur.sum / cur.n) <= tol) { cur.sum += v; cur.n++; cur.y1 = y; }
    else { if (cur) runs.push(cur); cur = { y0: y, y1: y, sum: v, n: 1 }; }
  });
  if (cur) runs.push(cur);
  const tall = runs.filter((r) => r.n >= mh).map((r) => ({ ...r, m: r.sum / r.n }));
  if (!tall.length) return [];
  // the card level is the one with the most height in tall runs
  let best = null;
  tall.forEach((r) => { const g = tall.filter((o) => Math.abs(o.m - r.m) <= tol); const tot = g.reduce((s, o) => s + o.n, 0); if (!best || tot > best.tot) best = { tot, level: r.m, g }; });
  // thin gaps can blur into their neighbours, so cut again tightly around the card level
  const cards = []; let st = -1;
  const lv = best.g.reduce((t, o) => t + o.m * o.n, 0) / best.tot;
  for (let y = 0; y <= lum.length; y++) {
    let on = y < lum.length && Math.abs(lum[y] - lv) <= 3.5;
    if (!on && y < lum.length && lum[y] > lv + 3.5 && st >= 0) { let k = y; while (k < lum.length && lum[k] > lv + 3.5 && k - y < 7) k++; if (k < lum.length && k - y < 7 && Math.abs(lum[k] - lv) <= 3.5) { on = true; } }   // bright text crossing the card is not a gap
    if (on && st < 0) st = y;
    if (!on && st >= 0) { if (y - st >= 3) cards.push({ y0: st, y1: y - 1, n: y - st }); st = -1; }
  }
  const big = cards.filter((r) => r.n >= mh);
  if (!big.length) return [];
  const hs = big.map((r) => r.n).sort((a, c) => a - c), typ = hs[hs.length >> 1];
  return big.filter((r) => r.n >= typ * 0.6 && r.n <= typ * 2.4).map((r) => ({ y0: r.y0, y1: r.y1, level: lv }));
}
// Walks sideways from x0 until the brightness stops matching the card level; returns the first x that is no longer card.
export function edge(vals, from, step, level, tol) {
  let x = from, miss = 0, first = from;
  while (x >= 0 && x < vals.length) {
    if (Math.abs(vals[x] - level) > (tol || 10)) { if (!miss) first = x; miss++; if (miss >= 2) return first - step; } else miss = 0;
    x += step;
  }
  return Math.max(0, Math.min(vals.length - 1, (miss ? first : x) - step));
}
