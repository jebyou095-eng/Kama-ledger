import { buildTree } from './items.js';
import { checkLots, checkPrice } from './filter.js';
import { classify, learnBase } from './jet.js';
import { matchVerdict, cleanName } from './market.js';
import { EASY_SOLD, LOT_SIZES, NEUTRAL_BAND, STALE_DAYS, evaluate, isStale, newEntry, parseLots, priceAgeDays, priceFromLots, reverseRecipes, setPrice, unitPrices } from './items.js';

// Items / Ingredients tab. Data is stored in IndexedDB object stores named "Items" and "Ingredients".
export function initItems(env) {
  const { $, F, num, esc } = env;
  let items = {}, ingredients = {}, usedIn = {}, usedFor = null, usedSig = '', effById = null, shown = 80;
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
  const commit = (rec) => { mapOf(rec)[rec.id] = rec; schedulePush(); return save(colOf(rec), rec); };
  // A copy of the user's list for outside readers (the MCP connector): written a few seconds after the last change, by the desktop app only.
  let pushTimer = null;
  function schedulePush() {
    const bridge = typeof window !== 'undefined' && window.kamaDesktopCapture;
    if (!bridge || !bridge.saveSnapshot) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(() => { try { bridge.saveSnapshot(JSON.stringify(exportSnapshot())); } catch { /* the snapshot is optional */ } }, 3000);
  }
  function exportSnapshot() {
    const c = ctx(), P = env.getP();
    const rows = everyRec().map((r) => {
      const ev = r.kind === 'item' ? evaluate(r, c) : null, row = c.byId[r.id];
      const recipe = r.kind === 'item' && row && row[4] ? row[4].map((g) => { const ig = ingredients[g[0]] || items[g[0]]; return { id: g[0], name: P && P.byId[g[0]] ? P.byId[g[0]][1] : (ig ? ig.name : '#' + g[0]), qty: g[1], price: ig && ig.price ? ig.price : null }; }) : [];
      return { id: r.id, name: r.name, kind: r.kind, level: r.level || null, price: r.price || null, priceAt: r.priceAt || null, avgPrice: r.avgPrice || null, sold: r.sold ?? null, history: (r.history || []).slice(-60), lots: r.lots || null, jetClean: r.jetClean || null, jetSpecial: r.jetSpecial || null, recipe, craftCost: ev ? ev.cost : null, craftProfit: ev ? ev.craft : null };
    });
    return { v: 1, at: Date.now(), budget: budget ? budget.value : null, pending: review.length, items: rows };
  }
  const wantIcon = (rec) => { setTimeout(() => gameIcon(rec).catch(() => {}), 0); return rec; };

  async function load() {
    (await all('Items')).forEach((r) => { items[r.id] = r; });
    (await all('Ingredients')).forEach((r) => { ingredients[r.id] = r; });
    render();
    await loadScanState();
    schedulePush();
  }

  function ctx() {
    const P = env.getP();
    const ov = Object.values(items).filter((r) => r.recipe);
    const sig = ov.map((r) => r.id + ':' + JSON.stringify(r.recipe)).join('|');
    if (P && (usedFor !== P || usedSig !== sig)) {
      const list = ov.length ? P.idx.items.map((it) => { const o = items[it[0]] && items[it[0]].recipe; return o ? [it[0], it[1], it[2], it[3], o, it[5]] : it; }) : P.idx.items;
      usedIn = reverseRecipes(list); usedFor = P; usedSig = sig;
      effById = ov.length ? Object.assign(Object.create(P.byId), Object.fromEntries(ov.map((r) => { const b = P.byId[r.id]; return [r.id, b ? [b[0], b[1], b[2], b[3], r.recipe, b[5]] : [r.id, r.name, r.level, r.typeId, r.recipe, []]]; }))) : P.byId;
    }
    return { byId: effById || (P ? P.byId : {}), ingredients, items, usedIn, pepiteNet: env.netP(), taxMode: env.taxMode(), band, easyFrom };
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
      made.push(commit(entry).then(() => wantIcon(entry)));
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
    await commit(rec); wantIcon(rec); await ensureIngredients(rec);
    open.add(rec.id); status('Added ' + hit[1] + (hit[4] ? ' with its ' + hit[4].length + ' ingredients.' : '.'));
    render();
  }


  const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  function toast(msg) {
    const box = $('toasts'); if (!box || !msg) return;
    try { window.dispatchEvent(new CustomEvent('kl-toast', { detail: msg })); } catch { /* ignore */ }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
  }
  function burst(el) {
    if (reduce() || !el) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('i'); c.className = 'coin';
      c.style.left = (r.left + r.width / 2) + 'px'; c.style.top = (r.top + r.height / 2) + 'px';
      c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px'); c.style.setProperty('--dy', (-60 - Math.random() * 90) + 'px');
      document.body.appendChild(c); setTimeout(() => c.remove(), 900);
    }
  }
  function countUp(el, from, to, plus) {
    if (!el) return;
    const fmt = (v) => (plus && v > 0 ? '+' : '') + F(v);
    if (reduce() || from === to || !isFinite(from) || !isFinite(to)) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 700;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  let lastBudget = null, lastHeroKey = '', lastHeroVal = 0, seenPrices = null;
  function status(t) { $('items-status').textContent = t; if (t) toast(t); }

  function rowHtml(rec, ev, maxAbs) {
    const o = open.has(rec.id), P = env.getP();
    const craftWith = rec.kind === 'ingredient'
      ? (ev.uses.length ? ev.uses.slice(0, 2).map((u) => esc(u.name) + (u.profit !== null ? ' <b class="' + (u.profit >= 0 ? 'ok' : 'bad') + '">' + money(u.profit, true) + '</b>' : '')).join('<br>') + (ev.uses.length > 2 ? '<br><small>+' + (ev.uses.length - 2) + ' more</small>' : '') : '<small>not used in recipes</small>')
      : '<small>' + ((P && ctx().byId[rec.id] && ctx().byId[rec.id][4]) ? ctx().byId[rec.id][4].length + ' ingredients' : '') + '</small>';
    const benefit = rec.kind === 'item'
      ? (ev.craft !== null ? '<b>' + money(ev.craft, true) + '</b><small>' + ({ go: 'worth crafting', neutral: 'cost = profit', loss: 'loss if crafted' }[ev.status]) + '</small>'
        : '<small>' + (ev.missing.length ? ev.missing.length + ' ingredient price(s) missing' : 'enter the price') + '</small>')
      : (ev.craft !== null ? '<b>' + money(ev.craft, true) + '</b><small>best craft using it</small>' : '<small>no tracked craft yet</small>');
    return '<article class="irow st-' + ev.status + (o ? ' open' : '') + '" data-id="' + rec.id + '">'
      + '<div class="irow-main" tabindex="0" role="button" aria-expanded="' + o + '">'
      + (rec.icon ? '<img class="icon" alt="" src="' + esc(rec.icon) + '">' : '<span class="icon">' + esc(initials(rec.name)) + '</span>')
      + '<span class="iname"><b>' + esc(rec.name) + '</b><small>' + (rec.level ? 'Lvl ' + rec.level + ' · ' : '') + (typeName(rec) ? esc(typeName(rec)) + ' · ' : '') + (rec.custom ? 'Custom ' : '') + (rec.kind === 'item' ? 'Item' : 'Ingredient') + '</small><small>' + age(rec) + (ev.sell !== 'unknown' ? ' · <span class="sell-' + ev.sell + '">' + (ev.sell === 'easy' ? 'easy to sell' : 'hard to sell') + '</span>' : '') + '</small></span>'
      + '<span class="icell"><label>Price</label><input class="f-price" inputmode="numeric" value="' + (rec.price ? F(rec.price) : '') + '" placeholder="kamas"></span>'
      + '<span class="icell"><label>If recycled</label><b>' + money(ev.recycled) + '</b></span>'
      + '<span class="icell"><label>If concassed</label><b>' + money(ev.concassed) + '</b></span>'
      + '<span class="icell wide"><label>' + (rec.kind === 'ingredient' ? 'What you can craft' : 'Crafting') + '</label>' + craftWith + '</span>'
      + '<span class="icell wide"><label>' + (rec.kind === 'item' ? 'Beneficial to craft?' : 'Best use') + '</label>' + benefit
      + (ev.craft !== null && maxAbs ? '<span class="pbar"><i style="width:' + Math.max(6, Math.round(Math.abs(ev.craft) / maxAbs * 100)) + '%"></i></span>' : '') + '</span>'
      + '</div>' + (o ? detailHtml(rec, ev) : '') + '</article>';
  }

  function treeHtml(rec, c0) {
    const P = env.getP(); if (!P) return '';
    const t = buildTree(rec.id, 1, (id) => c0.byId[id], (id) => { const r = ingredients[id] || items[id]; return r && r.price ? r.price : null; }, (id) => (P.byId[id] ? P.byId[id][1] : (ingredients[id] || items[id] || { name: '#' + id }).name));
    const li = (n, top) => '<li><span class="tn">' + (top ? '' : n.qty + ' × ') + esc(n.name) + '</span>' + (n.price ? ' <small>' + F(n.price) + ' each' + (n.qty > 1 && !top ? ' = ' + F(n.subtotal) : '') + '</small>' : (top ? '' : ' <small class="bad">no price</small>')) + (n.children.length ? '<ul>' + n.children.map((k) => li(k, false)).join('') + '</ul>' : '') + '</li>';
    return '<ul class="ctree">' + li(t, true) + '</ul>';
  }
  function iconControl(rec) {
    return '<div class="row"><label class="btn">' + (rec.icon ? 'Change image' : 'Upload image') + '<input class="f-img" type="file" accept="image/*" hidden></label>' + (rec.icon ? '<button class="btn f-imgdel" type="button">Remove image</button>' : '') + '</div>';
  }

  function detailHtml(rec, ev) {
    const P = env.getP(), c0 = ctx(), row = P && c0.byId[rec.id];
    const lots = LOT_SIZES.map((s) => '<label>' + (s === 1000 ? '1 000' : s) + ' <input class="f-lot" data-size="' + s + '" inputmode="numeric" value="' + (rec.lots && rec.lots[s] ? F(rec.lots[s]) : '') + '"></label>').join('');
    const per = unitPrices(rec.lots).map((u) => (u.size === 1000 ? '1 000' : u.size) + ' → ' + F(u.unit) + '/unit').join(' · ');
    let body = '<div class="idetail">' + iconControl(rec);
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
      body += '<h4>Ingredients ' + (rec.recipe ? '<span class="tag-edited">recipe edited by you</span>' : '<span class="mu">(game data, Dec 2024 — edit if it changed)</span>') + '</h4><table class="itab"><thead><tr><th>Ingredient</th><th>Qty</th><th>Price / unit</th><th>Subtotal</th><th>Updated</th><th></th></tr></thead><tbody>'
        + row[4].map((g, i) => { const ig = ingredients[g[0]] || items[g[0]], it = P.byId[g[0]]; const pr = ig && ig.price;
          return '<tr data-ing="' + g[0] + '" data-i="' + i + '"><td>' + esc(it ? it[1] : (ig ? ig.name : '#' + g[0])) + '</td><td><input class="f-qty" size="4" inputmode="numeric" value="' + g[1] + '"></td><td><input class="f-ing" inputmode="numeric" value="' + (pr ? F(pr) : '') + '"></td><td>' + (pr ? F(pr * g[1]) : '–') + '</td><td>' + (ig ? age(ig) : '') + '</td><td><button class="btn f-rdel" type="button" title="Remove this ingredient">✕</button></td></tr>'; }).join('')
        + '</tbody></table><div class="row"><input class="f-radd" list="items-dl" placeholder="Add an ingredient to this recipe"><input class="f-raddq" size="3" inputmode="numeric" value="1"><button class="btn f-raddb" type="button">Add</button>' + (rec.recipe ? '<button class="btn f-rreset" type="button">Back to game data</button>' : '') + '</div>'
        + '<p>Craft cost: <b>' + (ev.cost !== null ? F(ev.cost) : '–') + '</b>' + (rec.price ? ' · net after 2% tax: <b>' + F(rec.price - Math.round(rec.price * 0.02)) + '</b>' : '') + (ev.craft !== null ? ' · profit: <b class="' + (ev.craft >= 0 ? 'ok' : 'bad') + '">' + money(ev.craft, true) + '</b>' : '') + '</p>'
        + '<h4>Craft tree <button class="btn f-graph" type="button">Show graph</button></h4>' + treeHtml(rec, c0);
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


  let view = 'list';
  try { view = localStorage.getItem('kl-items-view') === 'slots' ? 'slots' : 'list'; } catch { /* storage unavailable */ }
  const recOf = (id) => items[id] || ingredients[id];
  const iconOf = (rec, id) => { const r = rec || recOf(id); return r && r.icon ? r.icon : ''; };
  const short = (n, k = 20) => (String(n).length > k ? String(n).slice(0, k - 1) + '…' : String(n));

  function graphSvg(rec) {
    const P = env.getP(), c0 = ctx();
    const tree = buildTree(rec.id, 1, (id) => c0.byId[id], (id) => { const r = ingredients[id] || items[id]; return r && r.price ? r.price : null; },
      (id) => (P && P.byId[id] ? P.byId[id][1] : (ingredients[id] || items[id] || { name: '#' + id }).name), 2);
    const W = 900, H = 600, cx = W / 2, cy = H / 2, nodes = [], edges = [];
    const kids = tree.children;
    const R1 = kids.length > 6 ? 205 : 180;
    kids.forEach((k, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, kids.length);
      const x = cx + R1 * Math.cos(a), y = cy + R1 * 0.82 * Math.sin(a);
      nodes.push({ n: k, x, y, s: 54 }); edges.push([cx, cy, x, y]);
      const sub = k.children.slice(0, 5);
      sub.forEach((g, j) => {
        const spread = Math.min(1.5, 0.45 * sub.length), aa = a + (sub.length === 1 ? 0 : (j / (sub.length - 1) - 0.5) * spread);
        const gx = x + 105 * Math.cos(aa), gy = y + 90 * Math.sin(aa);
        nodes.push({ n: g, x: Math.max(40, Math.min(W - 40, gx)), y: Math.max(30, Math.min(H - 40, gy)), s: 38 });
        edges.push([x, y, Math.max(40, Math.min(W - 40, gx)), Math.max(30, Math.min(H - 40, gy))]);
      });
    });
    const node = (o, root) => {
      const n = o.n, ic = root ? iconOf(rec) : iconOf(null, n.id), r = o.s / 2, x = o.x, y = o.y;
      const col = root ? 'var(--gnode-root)' : 'var(--gnode)';
      return '<g class="gn" data-id="' + n.id + '"><rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + o.s + '" height="' + o.s + '" rx="' + (r * 0.34) + '" fill="' + col + '"/>'
        + (ic ? '<image href="' + esc(ic) + '" x="' + (x - r + 4) + '" y="' + (y - r + 4) + '" width="' + (o.s - 8) + '" height="' + (o.s - 8) + '"/>'
          : '<text x="' + x + '" y="' + (y + o.s * 0.14) + '" text-anchor="middle" class="gi" font-size="' + (o.s * 0.38) + '">' + esc(initials(n.name)) + '</text>')
        + '<text x="' + x + '" y="' + (y + r + 15) + '" text-anchor="middle" class="gl">' + (root ? '' : n.qty + '× ') + esc(short(n.name)) + '</text>'
        + (n.price ? '<text x="' + x + '" y="' + (y + r + 29) + '" text-anchor="middle" class="gp">' + F(n.price) + '</text>' : '<text x="' + x + '" y="' + (y + r + 29) + '" text-anchor="middle" class="gp gm">no price</text>') + '</g>';
    };
    return '<svg class="graph" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Recipe graph of ' + esc(rec.name) + '">'
      + edges.map((e) => '<line x1="' + e[0] + '" y1="' + e[1] + '" x2="' + e[2] + '" y2="' + e[3] + '"/>').join('')
      + nodes.map((o) => node(o, false)).join('') + node({ n: tree, x: cx, y: cy, s: 96 }, true) + '</svg>';
  }
  function openGraph(id) {
    const rec = recOf(id), dlg = $('graph-dlg'); if (!rec || !dlg) return;
    const ev = evaluate(rec, ctx()), c0 = ctx(), row = c0.byId[id];
    const hasRecipe = rec.kind === 'item' && row && row[4] && row[4].length;
    dlg.innerHTML = '<div class="gdlg-head"><b>' + esc(rec.name) + '</b><span class="mu">' + (rec.level ? 'Lvl ' + rec.level : '') + '</span><span class="gsp"></span>'
      + '<button class="btn g-edit" type="button" data-id="' + id + '">Edit prices</button><button class="btn g-close" type="button">Close</button></div>'
      + '<div class="gstats"><div>Sell price<b>' + (rec.price ? F(rec.price) : '–') + '</b></div><div>Craft cost<b>' + (ev.cost !== null ? F(ev.cost) : '–') + '</b></div>'
      + '<div>Profit<b class="' + (ev.craft !== null && ev.craft < 0 ? 'bad' : 'ok') + '">' + money(ev.craft, true) + '</b></div></div>'
      + (hasRecipe ? graphSvg(rec) : '<p class="mu">' + (rec.kind === 'item' ? 'No recipe in the game data for this item.' : 'This is an ingredient: it has no recipe. Open an item that uses it to see where it goes.') + '</p>');
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }

  function slotHtml(rec, ev, maxAbs) {
    const w = ev.craft === null ? 0 : Math.max(8, Math.round(Math.abs(ev.craft) / maxAbs * 100));
    return '<button type="button" class="slot st-' + ev.status + '" data-id="' + rec.id + '" title="' + esc(rec.name) + '">'
      + (rec.level ? '<em>' + rec.level + '</em>' : '')
      + (rec.icon ? '<img class="icon" alt="" src="' + esc(rec.icon) + '">' : '<span class="icon">' + esc(initials(rec.name)) + '</span>')
      + '<span class="sn">' + esc(short(rec.name, 22)) + '</span><span class="sp">' + (rec.price ? F(rec.price) + ' K' : 'no price') + '</span>'
      + '<span class="pb"><i style="width:' + w + '%"></i></span></button>';
  }
  function heroHtml(rows) {
    const best = rows.filter((r) => r.rec.kind === 'item' && r.ev.craft !== null && r.ev.craft > 0).sort((a, b) => b.ev.craft - a.ev.craft)[0];
    const waiting = rows.filter((r) => r.ev.craft === null && r.rec.kind === 'item').length;
    if (!best) return '<div class="hero-empty"><b>No craft worth doing yet</b><span class="mu">Scan your ingredient prices: the best craft shows here as soon as all of its ingredients have a price.</span></div>';
    const r = best.rec;
    return '<button type="button" class="hero-card" data-id="' + r.id + '">' + (r.icon ? '<img class="icon big-icon" alt="" src="' + esc(r.icon) + '">' : '<span class="icon big-icon">' + esc(initials(r.name)) + '</span>')
      + '<span class="hero-txt"><small>Best craft right now</small><b class="hero-name">' + esc(r.name) + '</b><span class="hero-num">' + money(best.ev.craft, true) + '</span>'
      + '<small>sells ' + (r.price ? F(r.price) : '–') + ' · costs ' + (best.ev.cost !== null ? F(best.ev.cost) : '–') + (waiting ? ' · ' + waiting + ' crafts still missing a price' : '') + '</small></span></button>';
  }

  function syncView() {
    document.querySelectorAll('#items-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    $('items-list').classList.toggle('slots-grid', view === 'slots');
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
    const catOk = (r) => kind === 'all' || (kind === 'item' || kind === 'ingredient' ? r.rec.kind === kind : kind === 'craft' ? r.rec.kind === 'item' : kind === 'recycle' ? (r.rec.pepites > 0) : kind === 'brisage' ? (r.rec.concassed > 0) : true);
    rows = rows.filter((r) => catOk(r) && (st === 'all' || r.ev.status === st) && (!q || env.normName(r.rec.name).includes(q)));
    rows.sort((a, b) => sort === 'name' ? a.rec.name.localeCompare(b.rec.name) : sort === 'old' ? (a.rec.priceAt || 0) - (b.rec.priceAt || 0)
      : (ORDER[a.ev.status] - ORDER[b.ev.status]) || ((b.ev.craft ?? -Infinity) - (a.ev.craft ?? -Infinity)) || a.rec.name.localeCompare(b.rec.name));
    const heroRows = Object.values(items).map((rec) => ({ rec, ev: evaluate(rec, c) }));
    if ($('items-hero')) {
      $('items-hero').innerHTML = heroHtml(heroRows);
      const hn = $('items-hero').querySelector('.hero-num'), hc = $('items-hero').querySelector('.hero-card');
      if (hn && hc) { const key = hc.dataset.id, val = Number(hn.textContent.replace(/[^\d-]/g, '')) || 0; if (key !== lastHeroKey || val !== lastHeroVal) { countUp(hn, key === lastHeroKey ? lastHeroVal : 0, val, true); hc.classList.add('pop'); } lastHeroKey = key; lastHeroVal = val; }
    }
    syncView();
    const total = rows.length; rows = rows.slice(0, shown);
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.ev.craft || 0)));
    const prevSeen = seenPrices; seenPrices = {}; rows.forEach((r) => { seenPrices[r.rec.id] = r.rec.price || 0; });
    root.innerHTML = rows.length ? rows.map((r) => (view === 'slots' ? slotHtml(r.rec, r.ev, maxAbs) : rowHtml(r.rec, r.ev, maxAbs))).join('') + (total > rows.length ? '<button class="btn f-more" type="button">Show more (' + (total - rows.length) + ' left)</button>' : '') : '<p class="empty"><span class="empty-coin">K</span>Nothing here yet. Type an item name above and press Enter: its ingredients are added for you.</p>';
    if (prevSeen) root.querySelectorAll('[data-id]').forEach((n) => { const id = Number(n.dataset.id); if (id in prevSeen && prevSeen[id] !== seenPrices[id]) n.classList.add('flash'); });
  }

  function toIcon(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        const m = Math.min(im.width, im.height); g.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, s, s); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      im.src = url;
    });
  }
  // Official icon from the game data (64px). Replaces a screenshot crop, never an image you uploaded.
  const iconBusy = new Set();
  async function gameIcon(rec) {
    if (!rec || rec.iconSrc === 'upload' || rec.iconSrc === 'game' || iconBusy.has(rec.id) || !env.iconUrl) return;
    const url = env.iconUrl(rec.id); if (!url) return;
    iconBusy.add(rec.id);
    try {
      const d = await env.fetchImage(url);
      if (d) { const cur = items[rec.id] || ingredients[rec.id]; if (cur && cur.iconSrc !== 'upload') { await commit({ ...cur, icon: d, iconSrc: 'game' }); render(); } }
    } finally { iconBusy.delete(rec.id); }
  }
  async function fillIcons() {
    const todo = Object.values(items).concat(Object.values(ingredients)).filter((r) => r.iconSrc !== 'upload' && r.iconSrc !== 'game' && !r.custom);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < todo.length) await gameIcon(todo[i++]); }));
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
    const sl = e.target.closest('.slot'); if (sl) { openGraph(Number(sl.dataset.id)); return; }
    const gb = e.target.closest('.f-graph'); if (gb) { openGraph(Number(gb.closest('.irow').dataset.id)); return; }
    if (e.target.closest('.f-more')) { shown += 80; render(); return; }
    const card = e.target.closest('.irow'); if (!card) return;
    const id = Number(card.dataset.id), t = e.target;
    if (t.closest('.f-price,.f-lot,.f-avg,.f-sold,.f-pep,.f-conc,.f-ing,.f-note,.f-paste,.f-qty,.f-radd,.f-raddq,.f-img')) return;
    if (t.closest('.f-del')) { const rec = items[id] || ingredients[id]; if (rec && confirm('Remove ' + rec.name + ' from your list?')) { delete items[id]; delete ingredients[id]; open.delete(id); remove('Items', id); remove('Ingredients', id); render(); } return; }
    if (t.closest('.f-track')) { const tid = Number(t.closest('.f-track').dataset.track); const P = env.getP(); if (P && P.byId[tid]) { const rec = newEntry(P.byId[tid], Date.now()); commit(rec).then(() => ensureIngredients(rec)).then(render); } return; }
    if (t.closest('.f-imgdel')) { updateRec(id, (r) => { const n = { ...r }; delete n.icon; delete n.iconSrc; return n; }); return; }
    if (t.closest('.f-rdel')) { const i = Number(t.closest('tr').dataset.i); updateRec(id, (r) => { const cur = (ctx().byId[id] || [])[4] || []; return { ...r, recipe: cur.filter((_, k) => k !== i) }; }); return; }
    if (t.closest('.f-rreset')) { updateRec(id, (r) => { const n = { ...r }; delete n.recipe; return n; }); return; }
    if (t.closest('.f-raddb')) {
      const P = env.getP(), hit = P && env.pickItem(P, card.querySelector('.f-radd').value), q = Math.max(1, Math.round(Number(card.querySelector('.f-raddq').value) || 1));
      if (!hit) { status('Type the exact name of an ingredient that exists in the game data.'); return; }
      updateRec(id, (r) => { const cur = (ctx().byId[id] || [])[4] || []; return { ...r, recipe: cur.filter((g) => g[0] !== hit[0]).concat([[hit[0], q]]) }; }).then(() => ensureIngredients({ id }));
      return;
    }
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
    else if (t.matches('.f-qty')) { const i = Number(t.closest('tr').dataset.i), q = Math.max(1, Math.round(v || 1)); updateRec(id, (r) => { const cur = ((ctx().byId[id] || [])[4] || []).map((g) => g.slice()); if (cur[i]) cur[i][1] = q; return { ...r, recipe: cur }; }); }
    else if (t.matches('.f-img')) { const f = t.files && t.files[0]; if (f) toIcon(f).then((d) => updateRec(id, (r) => ({ ...r, icon: d, iconSrc: 'upload' }))).catch(() => status('That file could not be read as an image.')); }
    else if (t.matches('.f-note')) updateRec(id, (r) => ({ ...r, note: t.value }));
    else if (t.matches('.f-ing')) { const ing = card.querySelector('tr[data-ing="' + t.closest('tr').dataset.ing + '"]'); const iid = Number(ing.dataset.ing); const rec = ingredients[iid] || items[iid]; if (rec) updateRec(iid, (r) => setPrice(r, v, Date.now())); }
  });

  $('items-add').addEventListener('input', () => env.fillList('items-add', 'items-dl'));
  $('items-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') { add($('items-add').value); $('items-add').value = ''; } });
  $('items-hero').addEventListener('click', (e) => { const h = e.target.closest('.hero-card'); if (h) openGraph(Number(h.dataset.id)); });
  $('items-view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    view = b.dataset.v; try { localStorage.setItem('kl-items-view', view); } catch { /* ignore */ }
    render();
  });
  $('graph-dlg').addEventListener('click', (e) => {
    const dlg = $('graph-dlg');
    if (e.target === dlg || e.target.closest('.g-close')) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); return; }
    const ed = e.target.closest('.g-edit');
    if (ed) { const id = Number(ed.dataset.id); view = 'list'; open.add(id); dlg.close ? dlg.close() : dlg.removeAttribute('open'); render(); const el = document.querySelector('.irow[data-id="' + id + '"]'); if (el) el.scrollIntoView({ block: 'center' }); return; }
    const gn = e.target.closest('.gn'); if (gn && Number(gn.dataset.id) && recOf(Number(gn.dataset.id))) openGraph(Number(gn.dataset.id));
  });
  $('items-add-btn').addEventListener('click', () => { add($('items-add').value); $('items-add').value = ''; });
  ['items-kind', 'items-filter', 'items-sort'].forEach((id) => $(id).addEventListener('change', () => { shown = 80; render(); }));
  let searchT = null; $('items-search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { shown = 80; render(); }, 150); });
  $('items-band').value = String(Math.round(band * 100)); $('items-easy').value = String(easyFrom);
  $('items-band').addEventListener('change', () => { const v = Number($('items-band').value); if (v >= 0 && v < 100) { band = v / 100; put('kl-band', String(v)); render(); } });
  $('items-easy').addEventListener('change', () => { const v = Number($('items-easy').value); if (v > 0) { easyFrom = v; put('kl-easy', String(v)); render(); } });
  const download = (name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); };
  $('items-export').addEventListener('click', () => {
    const P = env.getP(), c = ctx(), it = Object.values(items), ing = Object.values(ingredients);
    const files = {
      'Items.json': it, 'Ingredients.json': ing,
      'Crafts.json': it.map((r) => ({ id: r.id, name: r.name, level: r.level, price: r.price, recipe: ((c.byId[r.id] || [])[4] || []).map((g) => ({ id: g[0], name: P && P.byId[g[0]] ? P.byId[g[0]][1] : '#' + g[0], qty: g[1], price: (ingredients[g[0]] || items[g[0]] || {}).price || null })), edited: !!r.recipe })),
      'Recycles.json': Object.values({ ...items, ...ingredients }).filter((r) => r.pepites > 0).map((r) => ({ id: r.id, name: r.name, pepites: r.pepites, price: r.price })),
      'Brisage.json': Object.values({ ...items, ...ingredients }).filter((r) => r.concassed > 0).map((r) => ({ id: r.id, name: r.name, concassed: r.concassed, price: r.price })),
    };
    Object.keys(files).forEach((n, i) => setTimeout(() => download(n, files[n]), i * 250));
  });
  $('items-import').addEventListener('change', async (e) => {
    let n = 0;
    if (!confirm('Import adds these entries and replaces any entry that has the same id (prices included). Continue?')) { e.target.value = ''; return; }
    for (const f of e.target.files) {
      try { const list = JSON.parse(await f.text()); for (const rec of Array.isArray(list) ? list : []) { if (rec && Number.isFinite(rec.id) && rec.name) { if (rec.icon && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(rec.icon)) delete rec.icon; await commit({ ...rec, kind: rec.kind === 'item' ? 'item' : 'ingredient' }); n++; } } } catch (err) { status('Could not read ' + f.name); }
    }
    e.target.value = ''; status(n + ' entries imported.'); render();
  });


  // ---- scanner hooks: everything below is cumulative (it updates what exists and creates what is new) ----
  let review = [], budget = null, scanLog = [];
  const nowTs = () => Date.now();

  async function ensureRec(a, name, level, icon) {
    const found = a ? (items[a[0]] || ingredients[a[0]]) : Object.values(ingredients).concat(Object.values(items)).find((r) => r.custom && env.normName(r.name) === env.normName(name));
    if (found) return { rec: found, created: false };
    const rec = a ? newEntry(a, nowTs())
      : { ...newEntry([-nowTs() - Math.floor(Math.random() * 1000), String(name).trim(), level || null, 0, 0, []], nowTs()), custom: true, kind: 'ingredient', note: 'Not in the game data (newer than Datafus). Prices only, no recipe.' };
    if (icon) rec.icon = icon;
    await commit(rec); wantIcon(rec);
    if (a) await ensureIngredients(rec);
    return { rec, created: true };
  }

  async function applyPrice(rec, price, icon) {
    let next = { ...rec };
    if (icon && !next.icon) next.icon = icon;
    // an item priced from a clean-roll listing keeps that price: the market average mixes every roll
    if (Number.isFinite(price) && price > 0) { if (!rec.jetClean) next = setPrice(next, price, nowTs()); next.avgPrice = price; }
    await commit(next);
    return next;
  }

  const MATCH_OK = 0.9; // below this the name goes to review: lookalike items (Coiffe d'Aermyne / d'Aerruyne) must not be merged silently
  async function persistReview() { await env.metaPut('scan-review', review); }
  async function persistLog() { await env.metaPut('scan-log', scanLog.slice(0, 30)); }

  // Scans never write prices directly: they are staged here, you approve them (or let confident ones through).
  let sel = new Set(), pfilter = 'all', autoAccept = false;
  try { autoAccept = localStorage.getItem('kl-autoaccept') === '1'; } catch (e) {}
  const stage = (e) => {
    review = review.filter((x) => !(x.kind === e.kind && x.itemId === e.itemId));
    review.unshift({ ...e, id: nowTs() + Math.random(), at: nowTs() });
    if (!e.why) sel.add(review[0].id);
  };
  async function acceptEntry(e) {
    const P = env.getP(), a = P && P.byId[e.itemId]; if (!a) return false;
    if (e.kind === 'popup') { await applyPopup({ a, name: a[1], level: a[2], avg: e.avg, lots: e.lots }); return true; }
    const { rec } = await ensureRec(a);     // existing tracked item: its price is updated, nothing new is created
    await applyPrice(rec, e.price, e.icon);
    return true;
  }
  // rows: [{ a, score, rawName, level, type, price, icon }] from the market list

  function summary() {
    const c = ctx(), all = Object.values(items).concat(Object.values(ingredients));
    const rows = Object.values(items).map((rec) => ({ rec, ev: evaluate(rec, c) }));
    const best = rows.filter((r) => r.ev.craft !== null && r.ev.craft > 0).sort((a, b) => b.ev.craft - a.ev.craft)[0];
    return { tracked: Object.keys(items).length, pending: review.length, clean: review.filter((r) => !r.why).length, stale: all.filter((r) => isStale(r.priceAt)).length, best: best ? { id: best.rec.id, name: best.rec.name, profit: F(best.ev.craft) } : null };
  }
  async function acceptClean() {
    const todo = review.filter((r) => !r.why); let ok = 0;
    for (const r of todo) { if (await acceptEntry(r)) { ok++; review = review.filter((x) => x !== r); sel.delete(r.id); } }
    if (ok) { await persistReview(); render(); renderReview(); }
    return ok;
  }

  // ---- helpers for Kamo (read-only answers about the user's own list) ----
  let ignored = new Set();
  try { ignored = new Set(JSON.parse(localStorage.getItem('kl-ignored') || '[]')); } catch { /* storage unavailable */ }
  const saveIgnored = () => { try { localStorage.setItem('kl-ignored', JSON.stringify([...ignored])); } catch { /* ignore */ } };
  const everyRec = () => Object.values(items).concat(Object.values(ingredients));
  function topCrafts(n) {
    const c = ctx();
    return Object.values(items).map((rec) => ({ rec, ev: evaluate(rec, c) })).filter((r) => r.ev.craft !== null && r.ev.craft > 0)
      .sort((a, b) => b.ev.craft - a.ev.craft).slice(0, n).map((r) => ({ id: r.rec.id, name: r.rec.name, profit: r.ev.craft, cost: r.ev.cost, price: r.rec.price }));
  }
  function oldestPrices(n) {
    const all = everyRec(), stale = all.filter((r) => isStale(r.priceAt));
    return { total: stale.length, list: stale.sort((a, b) => (a.priceAt || 0) - (b.priceAt || 0)).slice(0, n).map((r) => ({ name: r.name, days: priceAgeDays(r.priceAt) })) };
  }
  function lookup(q) {
    const nq = env.normName(q); if (!nq) return null;
    const all = everyRec();
    const rec = all.find((r) => env.normName(r.name) === nq) || all.find((r) => env.normName(r.name).includes(nq)) || all.find((r) => nq.includes(env.normName(r.name)));
    if (!rec) return null;
    const c = ctx(), ev = evaluate(rec, c), row = c.byId[rec.id], P = env.getP();
    const recipe = rec.kind === 'item' && row && row[4] ? row[4].map((g) => { const ig = ingredients[g[0]] || items[g[0]]; return { name: P && P.byId[g[0]] ? P.byId[g[0]][1] : (ig ? ig.name : '#' + g[0]), qty: g[1], price: ig && ig.price ? ig.price : null }; }) : [];
    return { id: rec.id, name: rec.name, kind: rec.kind, price: rec.price || null, days: priceAgeDays(rec.priceAt), cost: ev.cost, profit: ev.craft, recipe };
  }
  const setAutoAccept = (v) => { autoAccept = !!v; try { localStorage.setItem('kl-autoaccept', autoAccept ? '1' : '0'); } catch { /* ignore */ } renderReview(); };

  // Remarks about a market list that was just read, compared with the prices already in the list. Nothing is changed.
  function observeMarket(rows) {
    const out = [], best = topCrafts(1)[0], c = ctx(), need = new Set(best && c.byId[best.id] && c.byId[best.id][4] ? c.byId[best.id][4].map((g) => g[0]) : []);
    for (const r of rows) {
      if (!r.a || !r.price) continue;
      const known = items[r.a[0]] || ingredients[r.a[0]]; if (!known || !known.price) continue;
      const ch = (r.price - known.price) / known.price, pct = Math.round(Math.abs(ch) * 100);
      if (ch <= -0.12) out.push({ kind: 'cheap', mood: 'happy', cx: r.cx, cy: r.cy, fw: r.fw, fh: r.fh, text: r.a[1] + ' is ' + pct + '% cheaper than your last price (' + F(r.price) + ' instead of ' + F(known.price) + ').' + (need.has(r.a[0]) ? ' You need it for your best craft!' : '') });
      else if (ch >= 0.2) out.push({ kind: 'up', mood: 'think', cx: r.cx, cy: r.cy, fw: r.fw, fh: r.fh, text: r.a[1] + ' went up ' + pct + '% (' + F(r.price) + ' instead of ' + F(known.price) + '). Maybe wait.' });
    }
    return out.sort((a, b) => (a.kind === 'cheap' ? 0 : 1) - (b.kind === 'cheap' ? 0 : 1)).slice(0, 3);
  }
  async function applyMarket(rows) {
    const res = { staged: 0, auto: 0, review: 0, skipped: 0, ignored: 0 };
    for (let r of rows) {
      if (!Number.isFinite(r.price) || r.price <= 0) { res.skipped++; continue; }
      r = Object.assign({}, r, { rawName: cleanName(r.rawName) });
      if (!r.a) { res.ignored++; continue; }   // not an item of the game data: unreadable or gibberish, never stored
      if (ignored.has(r.a[0])) { res.ignored++; continue; }   // the user asked Kamo to ignore this item
      const known = items[r.a[0]] || ingredients[r.a[0]];
      // filtration: the price is checked against this item's own history; a misread is repaired from the other passes
      const chk = checkPrice(r.price, r.priceReads, known);
      if (chk.status === 'bad') { res.skipped++; continue; }
      if (chk.status === 'fixed') r.price = chk.price;
      const why = matchVerdict(r.sim, r.nameConf)
        || (chk.status === 'suspect' ? chk.reason : '')
        || (r.priceSure === false && chk.status === 'new' ? 'price read differently on each pass' : '');
      const e = { kind: 'market', itemId: r.a[0], rawName: r.rawName, level: r.level, type: r.type, price: r.price, icon: r.icon, why, old: known && known.price || null };
      if (!why && autoAccept) { await acceptEntry(e); res.auto++; continue; }
      stage(e); res.staged++; if (why) res.review++;
    }
    review = review.slice(0, 200);
    await persistReview(); render(); renderReview();
    return res;
  }
  async function stagePopup(p) {
    if (!p.a) return { ignored: true };
    const known = items[p.a[0]] || ingredients[p.a[0]];
    const lc = checkLots(p.lots || {}, p.avg, (p.lots || {}).offers);
    const why = lc.bad.length ? 'lot' + (lc.bad.length > 1 ? 's' : '') + ' ' + lc.bad.join(', ') + ' far from the average price' : '';
    const e = { kind: 'popup', itemId: p.a[0], rawName: p.name, level: p.level, avg: p.avg, lots: p.lots || {}, price: priceFromLots(p.lots || {}) || p.avg || null, why, old: known && known.price || null, icon: null };
    if (autoAccept && !why) { await acceptEntry(e); return { name: p.a[1], auto: true, lots: Object.keys(e.lots).length }; }
    stage(e); await persistReview(); renderReview();
    return { name: p.a[1], staged: true, lots: Object.keys(e.lots).length, review: !!why };
  }

  async function applyPopup(p) {
    const { rec, created } = await ensureRec(p.a, p.name, p.level, null);
    let next = { ...rec, lots: { ...(rec.lots || {}), ...(p.lots || {}) } };
    if (Number.isFinite(p.avg) && p.avg > 0) next.avgPrice = p.avg;
    const lotPrice = priceFromLots(next.lots);
    if (rec.jetClean) { /* priced from a clean-roll listing */ }
    else if (lotPrice) next = setPrice(next, lotPrice, nowTs());
    else if (p.avg) next = setPrice(next, p.avg, nowTs());
    await commit(next); render();
    return { name: rec.name, created, lots: Object.keys(p.lots || {}).length };
  }

  // The tooltip of the hovered listing says whether its roll is clean. A clean listing sets the item's price; a forged or exo one is only noted.
  async function applyJet(j) {
    const { rec } = await ensureRec(j.a, j.a[1], j.a[2], null);
    const c = classify(j.tip, rec.jetBase), ts = nowTs();
    let next = { ...rec };
    if (!c.modified) {
      next.jetBase = learnBase(rec.jetBase, j.tip);
      if (j.price > 0) { next.jetClean = { price: j.price, at: ts, stats: j.tip.stats.map((x) => [x.label, x.value]) }; next = setPrice(next, j.price, ts); }
    } else if (j.price > 0) {
      next.jetSpecial = (rec.jetSpecial || []).concat([{ price: j.price, why: c.why, at: ts }]).slice(-5);
    }
    await commit(next); render();
    return { name: rec.name, modified: c.modified, why: c.why, price: j.price || null, set: !c.modified && j.price > 0 };
  }

  async function applyChart(c) {
    const { rec, created } = await ensureRec(c.a, c.name, c.level, null);
    const next = { ...rec };
    if (Number.isFinite(c.sold)) next.sold = c.sold;
    if (Number.isFinite(c.avg) && c.avg > 0) next.avgPrice = c.avg;
    if (Number.isFinite(c.median) && c.median > 0) next.medianPrice = c.median;
    await commit(next); render();
    return { name: rec.name, created };
  }

  async function addItemRow(a) { const { rec, created } = await ensureRec(a); open.add(rec.id); render(); return { name: rec.name, created, ingredients: a[4] ? a[4].length : 0 }; }

  async function setBudget(v) {
    if (!Number.isFinite(v) || v < 0) return null;
    const prev = budget && budget.value;
    budget = { value: v, at: nowTs(), prev: prev === undefined ? null : prev, history: ((budget && budget.history) || []).concat([[nowTs(), v]]).slice(-300) };
    await env.metaPut('budget', budget); renderBudget();
    return budget;
  }

  function renderBudget() {
    const el = $('items-budget'); if (!el) return;
    if (!budget) { el.textContent = 'Budget: not scanned yet'; return; }
    const d = budget.prev !== null && budget.prev !== undefined ? budget.value - budget.prev : null;
    const prevB = lastBudget; lastBudget = budget.value;
    el.innerHTML = 'Budget: <b>' + F(budget.value) + '</b> ' + (d ? '<span class="' + (d > 0 ? 'ok' : 'bad') + '">' + (d > 0 ? '+' : '') + F(d) + '</span> ' : '') + '<span class="mu">(' + new Date(budget.at).toLocaleString('fr-FR') + ')</span>';
    if (prevB !== null && prevB !== budget.value) countUp(el.querySelector('b'), prevB, budget.value);
  }

  async function logScan(text) {
    scanLog.unshift({ at: nowTs(), text }); scanLog = scanLog.slice(0, 30);
    await persistLog(); renderScanLog();
  }
  function renderScanLog() {
    const el = $('items-scanlog'); if (!el) return;
    el.innerHTML = scanLog.length ? scanLog.slice(0, 5).map((l) => '<div><span class="mu">' + new Date(l.at).toLocaleTimeString('fr-FR') + '</span> ' + esc(l.text) + '</div>').join('') : '<span class="mu">No scan yet. Set your regions in the Capture tab, then press the hotkey in the game.</span>';
  }

  function renderReview() {
    const el = $('items-review'); if (!el) return;
    const P = env.getP();
    const list = review.filter((r) => pfilter === 'all' || (pfilter === 'ok' ? !r.why : !!r.why));
    el.hidden = !review.length;
    if (!review.length) { el.innerHTML = ''; return; }
    const nSel = review.filter((r) => sel.has(r.id)).length;
    el.innerHTML = '<div class="pn-head"><h4>Prices waiting for your approval (' + review.length + ')</h4>'
      + '<label class="chk"><input type="checkbox" class="pn-all"' + (list.length && list.every((r) => sel.has(r.id)) ? ' checked' : '') + '> Select all shown</label>'
      + '<select class="pn-filter"><option value="all"' + (pfilter === 'all' ? ' selected' : '') + '>All</option><option value="ok"' + (pfilter === 'ok' ? ' selected' : '') + '>Matched, nothing odd</option><option value="check"' + (pfilter === 'check' ? ' selected' : '') + '>Needs a look</option></select>'
      + '<label class="chk"><input type="checkbox" class="pn-auto"' + (autoAccept ? ' checked' : '') + '> Accept clean matches automatically</label>'
      + '<button class="btn primary-button pn-accept" type="button"' + (nSel ? '' : ' disabled') + '>Accept selected (' + nSel + ')</button>'
      + '<button class="btn stop-button pn-refuse" type="button"' + (nSel ? '' : ' disabled') + '>Refuse selected (' + nSel + ')</button></div>'
      + '<div class="pn-list">' + list.map((r) => {
        const a = P && P.byId[r.itemId];
        const diff = r.old && r.price ? Math.round((r.price / r.old - 1) * 100) : null;
        return '<div class="rv' + (r.why ? ' check' : '') + '" data-rv="' + r.id + '"><input type="checkbox" class="pn-sel"' + (sel.has(r.id) ? ' checked' : '') + ' aria-label="Select">'
          + (r.icon ? '<img class="icon" alt="" src="' + esc(r.icon) + '">' : '<span class="icon">' + esc(initials(a ? a[1] : r.rawName)) + '</span>')
          + '<span class="pn-nm"><input class="pn-name" id="pn-' + String(r.id).replace('.', '-') + '" list="items-dl" autocomplete="off" value="' + esc(a ? a[1] : '') + '" placeholder="Pick the right item" aria-label="Item">'
          + '<small>' + (r.kind === 'popup' ? 'Lot popup' : 'Market list') + (r.rawName && a && r.rawName !== a[1] ? ' · read as “' + esc(r.rawName) + '”' : '') + (r.level ? ' · lvl ' + r.level : '') + '</small></span>'
          + (r.kind === 'popup' ? '<span class="pn-lots">' + Object.keys(r.lots).map((k) => k + ': ' + F(r.lots[k])).join(' · ') + (r.avg ? ' · avg ' + F(r.avg) : '') + '</span>'
            : '<input class="pn-price" inputmode="numeric" value="' + F(r.price) + '" aria-label="Price">')
          + '<span class="pn-old">' + (r.old ? 'was ' + F(r.old) + (diff !== null && diff !== 0 ? ' (' + (diff > 0 ? '+' : '') + diff + '%)' : '') : 'new price') + '</span>'
          + (r.why ? '<span class="pn-why">⚠ ' + esc(r.why) + '</span>' : '<span class="pn-ok">✓ matched</span>')
          + '</div>';
      }).join('') + '</div>';
  }

  const pnEntry = (t) => { const row = t.closest('.rv'); return row && review.find((x) => String(x.id) === row.dataset.rv); };
  $('items-review').addEventListener('change', async (e) => {
    const t = e.target, P = env.getP();
    if (t.matches('.pn-all')) { review.filter((r) => pfilter === 'all' || (pfilter === 'ok' ? !r.why : !!r.why)).forEach((r) => (t.checked ? sel.add(r.id) : sel.delete(r.id))); return renderReview(); }
    if (t.matches('.pn-filter')) { pfilter = t.value; return renderReview(); }
    if (t.matches('.pn-auto')) { autoAccept = t.checked; try { localStorage.setItem('kl-autoaccept', autoAccept ? '1' : '0'); } catch (x) {} return; }
    const r = pnEntry(t); if (!r) return;
    if (t.matches('.pn-sel')) { t.checked ? sel.add(r.id) : sel.delete(r.id); return renderReview(); }
    if (t.matches('.pn-price')) { const v = numOrNull(t.value); if (v) { r.price = v; await persistReview(); } return renderReview(); }
    if (t.matches('.pn-name')) {
      const hit = P && env.pickItem(P, t.value);
      if (hit) { r.itemId = hit[0]; r.why = ''; const known = items[hit[0]] || ingredients[hit[0]]; r.old = known && known.price || null; sel.add(r.id); await persistReview(); }
      else status('That name is not in the game data. Pick one from the suggestions.');
      renderReview();
    }
  });
  $('items-review').addEventListener('input', (e) => { if (e.target.matches('.pn-name')) env.fillList(e.target.id, 'items-dl'); });
  $('items-review').addEventListener('click', async (e) => {
    const accept = e.target.closest('.pn-accept'), refuse = e.target.closest('.pn-refuse');
    if (!accept && !refuse) return;
    const chosen = review.filter((r) => sel.has(r.id));
    if (refuse) { try { window.dispatchEvent(new CustomEvent('kl-refused', { detail: chosen.map((r) => r.itemId) })); } catch { /* ignore */ } review = review.filter((r) => !sel.has(r.id)); sel.clear(); await persistReview(); renderReview(); status(chosen.length + ' price(s) refused.'); return; }
    if (accept) { burst(accept); try { window.dispatchEvent(new CustomEvent('kl-accepted', { detail: { n: chosen.length, allClean: chosen.length > 0 && chosen.every((r) => !r.why) } })); } catch { /* ignore */ } }
    let ok = 0, stuck = 0;
    for (const r of chosen) { if (await acceptEntry(r)) { ok++; review = review.filter((x) => x !== r); sel.delete(r.id); } else stuck++; }
    await persistReview(); render(); renderReview();
    status(ok + ' price(s) registered' + (stuck ? ', ' + stuck + ' still need an item picked' : '') + '.');
  });

  async function loadScanState() {
    review = ((await env.metaGet('scan-review')) || []).filter((x) => x.kind || x.suggestion).map((x) => (x.kind ? x : { ...x, kind: 'market', itemId: x.suggestion ? x.suggestion[0] : null }));
    sel = new Set(review.filter((x) => !x.why).map((x) => x.id));
    budget = (await env.metaGet('budget')) || null;
    scanLog = (await env.metaGet('scan-log')) || [];
    renderReview(); renderBudget(); renderScanLog();
  }

  const snapshot = () => everyRec().map((r) => ({ id: r.id, name: r.name, kind: r.kind, price: r.price || null, priceAt: r.priceAt || null, history: r.history || [], jetClean: r.jetClean || null, jetSpecial: r.jetSpecial || null }));
  // the game's own data for one item: its stat ranges and the stat names, for judging a roll
  function gameItem(id) { const P = env.getP(), row = P && P.byId && P.byId[id]; return row ? { name: row[1], effects: row[5] || [], names: (P.idx && P.idx.effs) || P.effs || {} } : null; }
  return { gameItem, exportSnapshot, snapshot, summary, acceptClean, observeMarket, topCrafts, oldestPrices, lookup, setAutoAccept, isAutoAccept: () => autoAccept,
    nameOf: (id) => { const r = items[id] || ingredients[id]; return r ? r.name : ''; },
    ignore: (id) => { ignored.add(id); saveIgnored(); }, budgetValue: () => (budget ? budget.value : null), openGraph, stagePopup, fillIcons, gameIcon, load, render, add, itemByAvg: (avg, level) => { if (!(avg > 0)) return null; const hit = Object.entries(items).filter(([, r]) => r && r.price > 0 && Math.abs(r.price - avg) / avg < 0.01 && (!Number.isFinite(level) || !r.level || r.level === level)); return hit.length === 1 ? hit[0][0] : null; }, applyMarket, applyPopup, applyJet, applyChart, addItemRow, setBudget, logScan, loadScanState, itemByName: (n) => Object.values(items).concat(Object.values(ingredients)).find((r) => env.normName(r.name) === env.normName(n)) };
}
