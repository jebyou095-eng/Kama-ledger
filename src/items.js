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
export function parseLots(text) {
  const lots = {};
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/[  ]/g, ' ').replace(/[^\d ]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = line.match(/^(1 ?000|100|10|1) (\d[\d ]*)$/);
    if (!m) return;
    const size = Number(m[1].replace(/\D/g, ''));
    const total = Number(m[2].replace(/\D/g, ''));
    if (total > 0 && !lots[size]) lots[size] = total;
  });
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
