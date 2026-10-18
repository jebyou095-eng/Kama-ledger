import { EASY_SOLD, LOT_SIZES, NEUTRAL_BAND, STALE_DAYS, evaluate, isStale, newEntry, parseLots, priceAgeDays, priceFromLots, reverseRecipes, setPrice, unitPrices } from './items.js';

// Items / Ingredients tab. Data is stored in IndexedDB object stores named "Items" and "Ingredients".
export function initItems(env) {
  const { $, F, num, esc } = env;
  let items = {}, ingredients = {}, usedIn = {}, usedFor = null;
  const open = new Set();
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let band = Number(get('kl-band', NEUTRAL_BAND * 100)) / 100;
  let easyFrom = Number(get('kl-easy', EASY_SOLD));

  const store = (name, mode) => env.getDB().transaction(name, mode).objectStore(name);
  const all = (name) => new Promise((res) => {
    if (!env.getDB()) return res([]);
    try { const r = store(name, 'readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); } catch (e) { res([]); }
  });
  const save = (name, rec) => new Promise((res) => {
    if (!env.getDB()) return res(false);
    try { const t = env.getDB().transaction(name, 'readwrite'); t.objectStore(name).put(rec); t.oncomplete = () => res(true); t.onerror = t.onabort = () => res(false); } catch (e) { res(false); }
  });
  const remove = (name, id) => new Promise((res) => {
    if (!env.getDB()) return res();
    try { const t = env.getDB().transaction(name, 'readwrite'); t.objectStore(name).delete(id); t.oncomplete = t.onerror = () => res(); } catch (e) { res(); }
  });
  const colOf = (rec) => (rec.kind === 'item' ? 'Items' : 'Ingredients');
  const mapOf = (rec) => (rec.kind === 'item' ? items : ingredients);
  const commit = (rec) => { mapOf(rec)[rec.id] = rec; return save(colOf(rec), rec); };

  async function load() {
    (await all('Items')).forEach((r) => { items[r.id] = r; });
    (await all('Ingredients')).forEach((r) => { ingredients[r.id] = r; });
    render();
  }

  function ctx() {
    const P = env.getP();
    if (P && usedFor !== P) { usedIn = reverseRecipes(P.idx.items); usedFor = P; }
    return { byId: P ? P.byId : {}, ingredients, items, usedIn, pepiteNet: env.netP(), taxMode: env.taxMode(), band, easyFrom };
  }
  const typeName = (rec) => { const P = env.getP(); return P ? (P.idx.types[rec.typeId] || '') : ''; };
  const initials = (n) => String(n).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const age = (rec) => {
    const d = priceAgeDays(rec.priceAt);
    if (d === null) return '<span class="stale">no price yet</span>';
    return (isStale(rec.priceAt) ? '<span class="stale">⚠ ' : '<span>') + (d === 0 ? 'updated today' : d + ' day' + (d > 1 ? 's' : '') + ' ago') + '</span>';
  };
  const money = (v, plus) => (v === null || v === undefined || !isFinite(v) ? '–' : (plus && v > 0 ? '+' : '') + F(v));

  function ensureIngredients(rec) {
    const P = env.getP(); const row = P && P.byId[rec.id];
    const made = [];
    if (row && row[4]) row[4].forEach((g) => {
      if (ingredients[g[0]] || items[g[0]]) return;
      const it = P.byId[g[0]]; if (!it) return;
      const entry = { ...newEntry(it, Date.now()), kind: 'ingredient' };
      made.push(commit(entry));
    });
    return Promise.all(made);
  }

  async function add(name) {
    const P = env.getP();
    if (!P) { status('Game data is not loaded yet (Data tab).'); return; }
    const hit = env.pickItem(P, name);
    if (!hit) {
      const clean = String(name || '').trim();
      if (!clean) return;
      const dup = Object.values(ingredients).find((r) => r.custom && env.normName(r.name) === env.normName(clean));
      if (dup) { open.add(dup.id); render(); return; }
      const rec = { ...newEntry([-Date.now(), clean, null, 0, 0, []], Date.now()), custom: true, kind: 'ingredient', note: 'Not in the game data (newer than Datafus). Prices only, no recipe.' };
      await commit(rec); open.add(rec.id);
      status('"' + clean + '" is not in the game data, added as a custom ingredient (prices only).');
      render(); return;
    }
    if (items[hit[0]] || ingredients[hit[0]]) { open.add(hit[0]); status(hit[1] + ' is already in your list.'); render(); return; }
    const rec = newEntry(hit, Date.now());
    await commit(rec); await ensureIngredients(rec);
    open.add(rec.id); status('Added ' + hit[1] + (hit[4] ? ' with its ' + hit[4].length + ' ingredients.' : '.'));
    render();
  }

  function status(t) { $('items-status').textContent = t; }

  function rowHtml(rec, ev) {
    const o = open.has(rec.id), P = env.getP();
    const craftWith = rec.kind === 'ingredient'
      ? (ev.uses.length ? ev.uses.slice(0, 2).map((u) => esc(u.name) + (u.profit !== null ? ' <b class="' + (u.profit >= 0 ? 'ok' : 'bad') + '">' + money(u.profit, true) + '</b>' : '')).join('<br>') + (ev.uses.length > 2 ? '<br><small>+' + (ev.uses.length - 2) + ' more</small>' : '') : '<small>not used in recipes</small>')
      : '<small>' + ((P && P.byId[rec.id] && P.byId[rec.id][4]) ? P.byId[rec.id][4].length + ' ingredients' : '') + '</small>';
    const benefit = rec.kind === 'item'
      ? (ev.craft !== null ? '<b>' + money(ev.craft, true) + '</b><small>' + ({ go: 'worth crafting', neutral: 'cost = profit', loss: 'loss if crafted' }[ev.status]) + '</small>'
        : '<small>' + (ev.missing.length ? ev.missing.length + ' ingredient price(s) missing' : 'enter the price') + '</small>')
      : (ev.craft !== null ? '<b>' + money(ev.craft, true) + '</b><small>best craft using it</small>' : '<small>no tracked craft yet</small>');
    return '<article class="irow st-' + ev.status + (o ? ' open' : '') + '" data-id="' + rec.id + '">'
      + '<div class="irow-main" tabindex="0" role="button" aria-expanded="' + o + '">'
      + '<span class="icon">' + esc(initials(rec.name)) + '</span>'
      + '<span class="iname"><b>' + esc(rec.name) + '</b><small>' + (rec.level ? 'Lvl ' + rec.level + ' · ' : '') + (typeName(rec) ? esc(typeName(rec)) + ' · ' : '') + (rec.custom ? 'Custom ' : '') + (rec.kind === 'item' ? 'Item' : 'Ingredient') + '</small><small>' + age(rec) + (ev.sell !== 'unknown' ? ' · <span class="sell-' + ev.sell + '">' + (ev.sell === 'easy' ? 'easy to sell' : 'hard to sell') + '</span>' : '') + '</small></span>'
      + '<span class="icell"><label>Price</label><input class="f-price" inputmode="numeric" value="' + (rec.price ? F(rec.price) : '') + '" placeholder="kamas"></span>'
      + '<span class="icell"><label>If recycled</label><b>' + money(ev.recycled) + '</b></span>'
      + '<span class="icell"><label>If concassed</label><b>' + money(ev.concassed) + '</b></span>'
      + '<span class="icell wide"><label>' + (rec.kind === 'ingredient' ? 'What you can craft' : 'Crafting') + '</label>' + craftWith + '</span>'
      + '<span class="icell wide"><label>' + (rec.kind === 'item' ? 'Beneficial to craft?' : 'Best use') + '</label>' + benefit + '</span>'
      + '</div>' + (o ? detailHtml(rec, ev) : '') + '</article>';
  }

  function detailHtml(rec, ev) {
    const P = env.getP(), row = P && P.byId[rec.id];
    const lots = LOT_SIZES.map((s) => '<label>' + (s === 1000 ? '1 000' : s) + ' <input class="f-lot" data-size="' + s + '" inputmode="numeric" value="' + (rec.lots && rec.lots[s] ? F(rec.lots[s]) : '') + '"></label>').join('');
    const per = unitPrices(rec.lots).map((u) => (u.size === 1000 ? '1 000' : u.size) + ' → ' + F(u.unit) + '/unit').join(' · ');
    let body = '<div class="idetail">';
    body += '<div class="dgrid"><div><h4>Prices by lot</h4><div class="lots">' + lots + '</div><p class="mu">' + (per || 'Type the 4 lot prices, or paste the popup text below.') + '</p>'
      + '<textarea class="f-paste" rows="3" placeholder="Paste the lot popup text (1 29 / 10 444 / 100 4 899 / 1 000 29 877)"></textarea>'
      + '<div class="row"><button class="btn f-readlots" type="button">Read lots</button><button class="btn f-ocr" type="button">Use last capture text</button></div></div>'
      + '<div><h4>Market data</h4><div class="lots">'
      + '<label>Average price <input class="f-avg" inputmode="numeric" value="' + (rec.avgPrice ? F(rec.avgPrice) : '') + '"></label>'
      + '<label>Articles sold <input class="f-sold" inputmode="numeric" value="' + (rec.sold ?? '') + '"></label>'
      + '<label>Pépites if recycled <input class="f-pep" inputmode="numeric" value="' + (rec.pepites ?? '') + '"></label>'
      + '<label>Value if concassed <input class="f-conc" inputmode="numeric" value="' + (rec.concassed ?? '') + '"></label></div>'
      + '<div class="row"><button class="btn f-bri" type="button">Open in Brisage</button><button class="btn f-bri-use" type="button">Use Brisage tab value</button></div>'
      + '<p class="mu">Recycled value = Pépites × net Pépite price (Recycling tab). Easy to sell = articles sold ≥ ' + easyFrom + '.</p></div></div>';
    if (rec.kind === 'item' && row && row[4]) {
      body += '<h4>Ingredients (prices are shared with the Ingredients list)</h4><table class="itab"><thead><tr><th>Ingredient</th><th>Qty</th><th>Price / unit</th><th>Subtotal</th><th>Updated</th></tr></thead><tbody>'
        + row[4].map((g) => { const ig = ingredients[g[0]] || items[g[0]], it = P.byId[g[0]]; const pr = ig && ig.price;
          return '<tr data-ing="' + g[0] + '"><td>' + esc(it ? it[1] : '#' + g[0]) + '</td><td>' + g[1] + '</td><td><input class="f-ing" inputmode="numeric" value="' + (pr ? F(pr) : '') + '"></td><td>' + (pr ? F(pr * g[1]) : '–') + '</td><td>' + (ig ? age(ig) : '') + '</td></tr>'; }).join('')
        + '</tbody></table><p>Craft cost: <b>' + (ev.cost !== null ? F(ev.cost) : '–') + '</b>' + (rec.price ? ' · net after 2% tax: <b>' + F(rec.price - Math.round(rec.price * 0.02)) + '</b>' : '') + (ev.craft !== null ? ' · profit: <b class="' + (ev.craft >= 0 ? 'ok' : 'bad') + '">' + money(ev.craft, true) + '</b>' : '') + '</p>';
    }
    if (rec.kind === 'ingredient' && ev.uses.length) {
      body += '<h4>Recipes using it</h4><table class="itab"><thead><tr><th>Item</th><th>Qty</th><th>Profit per craft</th><th></th></tr></thead><tbody>'
        + ev.uses.slice(0, 40).map((u) => '<tr><td>' + esc(u.name) + '</td><td>' + u.qty + '</td><td>' + (u.profit !== null ? '<b class="' + (u.profit >= 0 ? 'ok' : 'bad') + '">' + money(u.profit, true) + '</b>' : (u.tracked ? 'prices missing' : 'not tracked')) + '</td><td>' + (u.tracked ? '' : '<button class="btn f-track" data-track="' + u.id + '" type="button">Track</button>') + '</td></tr>').join('') + '</tbody></table>';
    }
    const hist = (rec.history || []).slice(-8).reverse();
    body += '<h4>Price history</h4><p class="mu">' + (hist.length ? hist.map((h) => new Date(h[0]).toLocaleDateString('fr-FR') + ': ' + F(h[1])).join(' · ') : 'No history yet.') + '</p>';
    body += '<div class="row"><input class="f-note" placeholder="Note" value="' + esc(rec.note || '') + '"><button class="btn f-del" type="button">Remove from list</button></div></div>';
    return body;
  }

  const ORDER = { go: 0, neutral: 1, loss: 2, unknown: 3 };
  function render() {
    const root = $('items-list'); if (!root) return;
    const c = ctx();
    const kind = $('items-kind').value, st = $('items-filter').value, sort = $('items-sort').value, q = env.normName($('items-search').value);
    let rows = Object.values(items).concat(Object.values(ingredients)).map((rec) => ({ rec, ev: evaluate(rec, c) }));
    const stale = rows.filter((r) => isStale(r.rec.priceAt)).length;
    $('items-count').textContent = Object.keys(items).length + ' items · ' + Object.keys(ingredients).length + ' ingredients';
    $('items-stale').hidden = !stale;
    $('items-stale').textContent = stale ? '⚠ ' + stale + ' price' + (stale > 1 ? 's' : '') + ' missing or older than ' + STALE_DAYS + ' days. Time to refresh.' : '';
    rows = rows.filter((r) => (kind === 'all' || r.rec.kind === kind) && (st === 'all' || r.ev.status === st) && (!q || env.normName(r.rec.name).includes(q)));
    rows.sort((a, b) => sort === 'name' ? a.rec.name.localeCompare(b.rec.name) : sort === 'old' ? (a.rec.priceAt || 0) - (b.rec.priceAt || 0)
      : (ORDER[a.ev.status] - ORDER[b.ev.status]) || ((b.ev.craft ?? -Infinity) - (a.ev.craft ?? -Infinity)) || a.rec.name.localeCompare(b.rec.name));
    root.innerHTML = rows.length ? rows.map((r) => rowHtml(r.rec, r.ev)).join('') : '<p class="mu">Nothing here yet. Type an item name above and press Enter: its ingredients are added for you.</p>';
  }

  async function updateRec(id, fn) {
    const rec = items[id] || ingredients[id]; if (!rec) return;
    await commit(fn(rec)); render();
  }
  const numOrNull = (s) => { const v = num(s); return isFinite(v) && v >= 0 ? v : null; };
  function applyLots(rec, lots) {
    let next = { ...rec, lots };
    const p = priceFromLots(lots);
    if (p) next = setPrice(next, p, Date.now());
    return next;
  }

  $('items-list').addEventListener('click', (e) => {
    const card = e.target.closest('.irow'); if (!card) return;
    const id = Number(card.dataset.id), t = e.target;
    if (t.closest('.f-price,.f-lot,.f-avg,.f-sold,.f-pep,.f-conc,.f-ing,.f-note,.f-paste')) return;
    if (t.closest('.f-del')) { const rec = items[id] || ingredients[id]; if (rec && confirm('Remove ' + rec.name + ' from your list?')) { delete items[id]; delete ingredients[id]; open.delete(id); remove('Items', id); remove('Ingredients', id); render(); } return; }
    if (t.closest('.f-track')) { const tid = Number(t.closest('.f-track').dataset.track); const P = env.getP(); if (P && P.byId[tid]) { const rec = newEntry(P.byId[tid], Date.now()); commit(rec).then(() => ensureIngredients(rec)).then(render); } return; }
    if (t.closest('.f-readlots')) { const lots = parseLots(card.querySelector('.f-paste').value); if (!Object.keys(lots).length) { status('No lot lines recognised.'); return; } updateRec(id, (r) => applyLots(r, { ...r.lots, ...lots })); status('Lots read.'); return; }
    if (t.closest('.f-ocr')) { card.querySelector('.f-paste').value = env.getOcrText(); return; }
    if (t.closest('.f-bri')) { env.openBrisage((items[id] || ingredients[id]).name); return; }
    if (t.closest('.f-bri-use')) { const v = env.getBrisageValue(); if (v > 0) updateRec(id, (r) => ({ ...r, concassed: Math.round(v) })); else status('Fill the Brisage tab first (rune prices and jets).'); return; }
    if (t.closest('.idetail')) return;
    if (t.closest('.irow-main')) { open.has(id) ? open.delete(id) : open.add(id); render(); }
  });
  $('items-list').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('irow-main')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  });
  $('items-list').addEventListener('change', (e) => {
    const t = e.target, card = t.closest('.irow'); if (!card) return;
    const id = Number(card.dataset.id), v = numOrNull(t.value);
    if (t.matches('.f-price')) updateRec(id, (r) => setPrice(r, v, Date.now()));
    else if (t.matches('.f-lot')) updateRec(id, (r) => { const lots = { ...r.lots }; if (v) lots[t.dataset.size] = v; else delete lots[t.dataset.size]; return applyLots(r, lots); });
    else if (t.matches('.f-avg')) updateRec(id, (r) => ({ ...r, avgPrice: v }));
    else if (t.matches('.f-sold')) updateRec(id, (r) => ({ ...r, sold: v }));
    else if (t.matches('.f-pep')) updateRec(id, (r) => ({ ...r, pepites: v }));
    else if (t.matches('.f-conc')) updateRec(id, (r) => ({ ...r, concassed: v }));
    else if (t.matches('.f-note')) updateRec(id, (r) => ({ ...r, note: t.value }));
    else if (t.matches('.f-ing')) { const ing = card.querySelector('tr[data-ing="' + t.closest('tr').dataset.ing + '"]'); const iid = Number(ing.dataset.ing); const rec = ingredients[iid] || items[iid]; if (rec) updateRec(iid, (r) => setPrice(r, v, Date.now())); }
  });

  $('items-add').addEventListener('input', () => env.fillList('items-add', 'items-dl'));
  $('items-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') { add($('items-add').value); $('items-add').value = ''; } });
  $('items-add-btn').addEventListener('click', () => { add($('items-add').value); $('items-add').value = ''; });
  ['items-kind', 'items-filter', 'items-sort'].forEach((id) => $(id).addEventListener('change', render));
  $('items-search').addEventListener('input', render);
  $('items-band').value = String(Math.round(band * 100)); $('items-easy').value = String(easyFrom);
  $('items-band').addEventListener('change', () => { const v = Number($('items-band').value); if (v >= 0 && v < 100) { band = v / 100; put('kl-band', String(v)); render(); } });
  $('items-easy').addEventListener('change', () => { const v = Number($('items-easy').value); if (v > 0) { easyFrom = v; put('kl-easy', String(v)); render(); } });
  const download = (name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); };
  $('items-export').addEventListener('click', () => { download('Items.json', Object.values(items)); setTimeout(() => download('Ingredients.json', Object.values(ingredients)), 250); });
  $('items-import').addEventListener('change', async (e) => {
    let n = 0;
    for (const f of e.target.files) {
      try { const list = JSON.parse(await f.text()); for (const rec of Array.isArray(list) ? list : []) { if (rec && Number.isFinite(rec.id) && rec.name) { await commit({ ...rec, kind: rec.kind === 'item' ? 'item' : 'ingredient' }); n++; } } } catch (err) { status('Could not read ' + f.name); }
    }
    e.target.value = ''; status(n + ' entries imported.'); render();
  });

  return { load, render, add };
}
