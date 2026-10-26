// Pure logic for the Items / Ingredients lists (no DOM, tested by tests/items.cjs).
export const STALE_DAYS = 7;
export const NEUTRAL_BAND = 0.02; // |profit| <= 2% of cost counts as "neutral"
export const EASY_SOLD = 10;      // "articles vendus" at or above this = easy to sell
export const LOT_SIZES = [1, 10, 100, 1000];

export function netAfterTax(price, mode) {
  const t = price * 0.02;
  return price - (mode === 'ceil' ? Math.ceil(t - 1e-9) : Math.round(t));
}

export function unitPrices(lots) {
  const out = [];
  LOT_SIZES.forEach((size) => {
    const total = Number(lots && lots[size]);
    if (Number.isFinite(total) && total > 0) out.push({ size, total, unit: total / size });
  });
  return out;
}

// Price used for the row: the 1-unit price when known, otherwise the cheapest per-unit price.
export function priceFromLots(lots) {
  const list = unitPrices(lots);
  if (!list.length) return null;
  const one = list.find((x) => x.size === 1);
  return one ? one.total : Math.round(Math.min(...list.map((x) => x.unit)));
}

// Reads the "Actual prices by the lot" popup text: "1 29", "10 444", "100 4 899", "1 000 29 877".
export function parseLots(text, avg) {
  const lots = {}, offers = {}, list = [], SIZES = [1, 10, 100, 1000];
  const rows = String(text || '').split(/\r?\n/);
  // A lot row always ends with its ACHETER button. Other lines with two numbers ("Prix moyen : 1 510", "en banque : 1 3") are not lots.
  const hasBtn = rows.some((r) => /ach[e3]t[e3]r/i.test(r));
  let ordinal = 0;
  rows.forEach((raw) => {
    const btn = /ach[e3]t[e3]r/i.test(raw);
    if (hasBtn && !btn) return;
    // Everything after the ACHETER button is icons and noise: never part of the price (a stray "5" there made 1 390 000 into 13 900 005).
    const cut = raw.split(/ach[e3]t[e3]r/i)[0];
    let line = cut.replace(/[  ]/g, ' ').replace(/[^\d ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) return;
    const row = ordinal++;
    let size = null, rest = line, explicit = false;
    // the size token may follow noise digits ("4 1 4000" from "4” ; 1 4000"): take the first position where size + grouped price fits
    let m = line.match(/^(1 ?000|100|10|1) (\d[\d ]*)$/);
    if (!m && btn) {
      const tk = line.split(' ');
      for (let i = 1; i < tk.length - 1 && !m; i++) {
        const sz = tk[i] === '1' && tk[i + 1] === '000' ? '1000' : tk[i];
        const from = sz === '1000' ? i + 2 : i + 1;
        if (!['1', '10', '100', '1000'].includes(sz) || from >= tk.length) continue;
        const r = tk.slice(from);
        if (/^\d{1,3}$/.test(r[0]) && r.slice(1).every((g) => g.length === 3) || (r.length === 1 && /^\d+$/.test(r[0]))) m = [null, sz, r.join(' ')];
      }
    }
    if (m) { size = Number(m[1].replace(/\D/g, '')); rest = m[2]; explicit = true; }
    else if (hasBtn && row < SIZES.length) {
      // the lot size was misread ("Oo", "00"): rows come in the order 1, 10, 100, 1000
      const t = line.split(' '), withSize = t.slice(), noSize = t.slice(1);
      size = SIZES[row];
      let pick = t.length > 1 && /^0+$/.test(t[0]) ? noSize : withSize;
      if (t.length > 1 && !/^0+$/.test(t[0])) {
        // is the first token a misread size ("200" for 1000) or the first digits of the price? the price of a lot of n is about n times the average
        const val = (a) => { const g = a.slice(); const k = [g[0]]; for (let i = 1; i < g.length && g[i].length === 3; i++) k.push(g[i]); return Number(k.join('')); };
        if (t[1].length !== 3) pick = noSize;
        else if (avg > 0) { const d = (a) => Math.abs(Math.log(Math.max(1, val(a)) / (avg * size))); pick = d(noSize) < d(withSize) ? noSize : withSize; }
      }
      rest = pick.join(' ');
    }
    if (!size || !/^\d[\d ]*$/.test(rest)) return;
    // grouped digits: after the first group, only groups of exactly three belong to the price
    const groups = rest.split(' '), keep = [groups[0]];
    for (let g = 1; g < groups.length && groups[g].length === 3; g++) keep.push(groups[g]);
    const total = Number(keep.join(''));
    if (!(total > 0)) return;
    // a guessed size that makes the unit price absurd (equipment lists every offer as a lot of 1): take the size that fits the average
    if (!explicit && avg > 0) {
      const fit = (z) => Math.abs(Math.log(total / z / avg));
      if (total / size < avg * 0.2 || total / size > avg * 5) { const alt = SIZES.slice().sort((x, y) => fit(x) - fit(y))[0]; if (fit(alt) < Math.log(5)) size = alt; }
    }
    (offers[size] = offers[size] || []).push(total); list.push({ size, total });
    // explicit rows (a high-value item lists several single offers) keep the cheapest; guessed rows keep the first
    if (explicit ? !(lots[size] <= total) : !lots[size]) lots[size] = total;
  });
  Object.defineProperty(lots, 'offers', { value: offers, enumerable: false });
  Object.defineProperty(lots, 'list', { value: list, enumerable: false });
  return lots;
}

export function priceAgeDays(ts, now) {
  if (!ts) return null;
  return Math.floor(((now || Date.now()) - ts) / 86400000);
}

export function isStale(ts, now) {
  const age = priceAgeDays(ts, now);
  return age === null || age >= STALE_DAYS;
}

export function setPrice(rec, price, ts) {
  const next = { ...rec };
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) { next.price = null; return next; }
  if (rec.price !== value) {
    next.history = (rec.history || []).concat([[ts, value]]).slice(-60);
    next.prevPrice = rec.price || null;
  }
  next.price = value;
  next.priceAt = ts;
  return next;
}

export function newEntry(item, ts) {
  // item = compact index row [id, name, level, typeId, recipe|0, effects]
  return {
    id: item[0], name: item[1], level: item[2], typeId: item[3],
    kind: item[4] ? 'item' : 'ingredient',
    price: null, priceAt: null, history: [], lots: {}, avgPrice: null, sold: null,
    pepites: null, concassed: null, note: '', addedAt: ts,
  };
}

export function reverseRecipes(items) {
  const map = {};
  items.forEach((it) => {
    if (!it[4]) return;
    it[4].forEach((g) => { (map[g[0]] || (map[g[0]] = [])).push([it[0], g[1]]); });
  });
  return map;
}

export function craftCost(recipe, ingredients) {
  let cost = 0;
  const missing = [];
  (recipe || []).forEach((g) => {
    const price = ingredients[g[0]] && ingredients[g[0]].price;
    if (Number.isFinite(price) && price > 0) cost += price * g[1];
    else missing.push(g[0]);
  });
  return { cost, missing };
}

export function craftStatus(profit, cost, band) {
  if (!Number.isFinite(profit) || !Number.isFinite(cost)) return 'unknown';
  const limit = (band === undefined ? NEUTRAL_BAND : band) * Math.abs(cost);
  if (profit > limit) return 'go';
  if (profit < -limit) return 'loss';
  return 'neutral';
}

export function sellability(sold, easyFrom) {
  if (!Number.isFinite(sold) || sold === null) return 'unknown';
  return sold >= (easyFrom || EASY_SOLD) ? 'easy' : 'hard';
}

// Everything one row needs. ctx: { index byId, ingredients, items, usedIn, pepiteNet, taxMode, band, easyFrom }
export function evaluate(rec, ctx) {
  const out = { status: 'unknown', craft: null, cost: null, missing: [], recycled: null, concassed: rec.concassed ?? null, uses: [], sell: sellability(rec.sold, ctx.easyFrom) };
  const idx = ctx.byId[rec.id];
  if (Number.isFinite(rec.pepites) && Number.isFinite(ctx.pepiteNet)) out.recycled = Math.round(rec.pepites * ctx.pepiteNet);
  if (rec.kind === 'item' && idx && idx[4]) {
    const { cost, missing } = craftCost(idx[4], ctx.ingredients);
    out.missing = missing;
    if (!missing.length) {
      out.cost = cost;
      if (Number.isFinite(rec.price) && rec.price > 0) {
        out.craft = Math.round(netAfterTax(rec.price, ctx.taxMode) - cost);
        out.status = craftStatus(out.craft, cost, ctx.band);
      }
    }
  } else if (rec.kind === 'ingredient') {
    (ctx.usedIn[rec.id] || []).forEach(([itemId, qty]) => {
      const tracked = ctx.items[itemId];
      const row = ctx.byId[itemId];
      const entry = { id: itemId, name: row ? row[1] : '#' + itemId, qty, tracked: !!tracked, profit: null };
      if (tracked && Number.isFinite(tracked.price) && tracked.price > 0) {
        const { cost, missing } = craftCost(row[4], ctx.ingredients);
        if (!missing.length) entry.profit = Math.round(netAfterTax(tracked.price, ctx.taxMode) - cost);
      }
      out.uses.push(entry);
    });
    out.uses.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
    const best = out.uses.find((u) => u.profit !== null);
    if (best) { out.craft = best.profit; out.status = best.profit > 0 ? 'go' : best.profit < 0 ? 'loss' : 'neutral'; }
  }
  return out;
}

// Craft tree: item -> ingredients -> their own ingredients (when they are craftable too).
// rowOf(id) returns the compact index row (recipe at [4]); priceOf(id) the tracked price or null; nameOf(id) the name.
export function buildTree(id, qty, rowOf, priceOf, nameOf, depth = 3, seen = []) {
  const row = rowOf(id), price = priceOf(id);
  const node = { id, name: nameOf(id), qty, price, subtotal: price ? price * qty : null, children: [] };
  if (depth > 0 && row && row[4] && !seen.includes(id)) {
    node.children = row[4].map((g) => buildTree(g[0], g[1], rowOf, priceOf, nameOf, depth - 1, seen.concat(id)));
  }
  return node;
}
