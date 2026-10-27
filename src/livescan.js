// Live scan and the scan itself: reads each new screen of the shared game window and turns it into prices, lots, jets and marks.
// Moved out of main.js. It reaches the rest of the app through getEnv(), a small object of getters that main.js provides.
export function createLiveScan(getEnv) {
  var liveTimer = null, liveLast = null, livePrev = null, refreshing = false;
  async function liveTick() {
    var E = getEnv(), $ = E.$, scan = E.scan, snapItem = E.snapItem, parsePopup = E.parsePopup, parseLots = E.parseLots, parseTooltip = E.parseTooltip, parseMarketChart = E.parseMarketChart, parseBudget = E.parseBudget, transactionLines = E.transactionLines, normalizeTransactionLine = E.normalizeTransactionLine, saveLedgerTransactions = E.saveLedgerTransactions, itemsUi = E.itemsUi, F = E.F, recordAction = E.recordAction, sessEvent = E.sessEvent, profileKeys = E.profileKeys, PROFILE_TYPES = E.PROFILE_TYPES, updateCaptureControls = E.updateCaptureControls, kamoRef = E.kamoRef, stream = E.stream, P = E.P, profile = E.profile;
    if (!$('live-scan').checked || !stream || E.scanning) return;
    var frame = scan.frameFromVideo($('vid'));
    if (!frame) return;
    var sig = scan.signature(frame);
    var moving = scan.sigDiff(sig, livePrev) > 2.5;   // still changing: wait until the picture holds still
    livePrev = sig;
    if (moving || scan.sigDiff(sig, liveLast) < 4) return;   // unchanged since the last scan
    liveLast = sig;
    var r = await scanFrame(frame);   // every frame is read on its own, nothing is merged between frames
    if (r && r.empty) $('scan-status').textContent = 'Live scan on: waiting for a market, lot, recipe or chat panel...';
  }
  function init() { var E0 = getEnv(), $ = E0.$; $('live-scan').addEventListener('change', function () {
    var E = getEnv(), stream = E.stream, updateCaptureControls = E.updateCaptureControls;
    clearInterval(liveTimer); liveLast = null; livePrev = null;
    if (this.checked) {
      if (!stream) { this.checked = false; $('scan-status').textContent = 'Share the game window first.'; return; }
      liveTimer = setInterval(function () { liveTick().catch(function () {}); }, 1200);
      $('scan-status').textContent = 'Live scan on.';
    }
    updateCaptureControls();
  }); }
  function bestNameInLines(lines, minScore) {
    var E = getEnv(), snapItem = E.snapItem, P = E.P;
    var best = null;
    lines.slice(0, 10).forEach(function (l) {
      var s = snapItem(P, l, NaN, '');
      if (s && s.score >= minScore && (!best || s.score > best.score)) best = s;
    });
    return best;
  }
  async function scanFrame(frame) {
    var E = getEnv(), $ = E.$, scan = E.scan, snapItem = E.snapItem, parsePopup = E.parsePopup, parseLots = E.parseLots, parseTooltip = E.parseTooltip, parseMarketChart = E.parseMarketChart, parseBudget = E.parseBudget, transactionLines = E.transactionLines, normalizeTransactionLine = E.normalizeTransactionLine, saveLedgerTransactions = E.saveLedgerTransactions, itemsUi = E.itemsUi, F = E.F, recordAction = E.recordAction, sessEvent = E.sessEvent, profileKeys = E.profileKeys, PROFILE_TYPES = E.PROFILE_TYPES, updateCaptureControls = E.updateCaptureControls, kamoRef = E.kamoRef, stream = E.stream, P = E.P, profile = E.profile;
    var tStart = performance.now();
    if (E.scanning) { $('scan-status').textContent = 'A scan is already running.'; return; }
    E.scanning = true;
    var prof = profile, quick = false;
    if (!profileKeys().length) {
      // Same game window as the last scan: skip the slow full-screen detection and read the panels where they were.
      prof = scan.cachedProfile(frame);
      if (prof) { quick = true; window.klTiming = { detect: 0 }; }
      else {
        $('scan-status').textContent = 'Looking for the game panels...';
        try { prof = await scan.autoDetect(frame); window.klTiming = { detect: Math.round(performance.now() - tStart) }; } catch (e) { E.scanning = false; $('scan-status').textContent = 'Could not read the screen: ' + e.message; return; }
      }
    }
    var keys = PROFILE_TYPES.map(function (t) { return t[0]; }).filter(function (k) { return prof[k]; });
    if (!keys.length) { E.scanning = false; $('scan-status').textContent = 'No game panel on screen (open the market, a lot, Recettes or the chat).'; return { empty: true }; }
    var types = P ? Object.values(P.idx.types) : [];
    $('scan-status').textContent = 'Scanning ' + keys.join(', ') + '...';
    var marketBad = false, info = { market: null, popup: null, chat: false }, lastLots = null, lastPopupItem = null, lastAvg = 0, marks = [], nextHint = '';
    async function readKey(k) {
      var tk = performance.now();
      try {
        if (k === 'market') {
          var m = await scan.readMarketList(frame, prof.market, types, prof._layout && prof._layout.market);
          info.market = { rows: m.rows.length, cached: m.cached || 0 };
          if (quick && !(m.rows.length && m.rows.filter(function (r) { return r.priceSure || r.nameConf >= 50; }).length * 2 >= m.rows.length)) { marketBad = true; return null; }   // the list is not where it was
          var rows = m.rows.map(function (r) { var s = P ? snapItem(P, r.rawName, r.level, r.type) : null; return Object.assign({ a: s ? s.item : null, score: s ? s.score : 0, sim: s ? s.sim : 0 }, r); });
          window.klLastScan = Object.assign(window.klLastScan || {}, { market: m.rows });
          var cards = []; try { cards = scan.marketCards(frame, prof.market); } catch (e) { cards = []; }
          if (cards.length) cards.forEach(function (c) { var hit = rows.find(function (r) { var f = r.cy / r.fh; return f > c.y && f < c.y + c.h; }); marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, kind: hit && hit.a && hit.priceSure ? 'read' : 'look' }); });
          if (cards.length) { var cph = cards.map(function (c) { return c.h; }).sort()[cards.length >> 1] * frame.height, c0 = cards[0], wr = (c0.x + c0.w) * frame.width + 0.23 * cph; marks.push({ x: (wr - 11.1 * cph) / frame.width, y: Math.max(0.01, c0.y - 1.96 * cph / frame.height), w: 11.1 * cph / frame.width, h: 0.03, kind: 'win' }); }   // the top edge of the market window (where Kamo may lie down)
          if (!cards.length) rows.forEach(function (r) { if (r.bw) marks.push({ x: (r.bx + r.fw * 0.004) / r.fw, y: r.by / r.fh, w: (r.bw - r.fw * 0.008) / r.fw, h: r.bh / r.fh, kind: r.a && r.priceSure ? 'read' : 'look' }); });
          var res = await itemsUi.applyMarket(rows);
          try { var obs = itemsUi.observeMarket(rows); if (obs.length && kamoRef) kamoRef.observe(obs, (function () { try { return stream.getVideoTracks()[0].getSettings().displaySurface || ''; } catch (e) { return ''; } })()); } catch (e) { /* remarks are optional */ }
          return ('Market ' + rows.length + ' rows: ' + res.staged + ' waiting for approval' + (res.auto ? ', ' + res.auto + ' registered' : '') + (res.review ? ' (' + res.review + ' need a look)' : '') + (res.skipped ? ', ' + res.skipped + ' without price' : '') + (res.ignored ? ', ' + res.ignored + ' unreadable ignored' : '') + (m.columnsFromHeader ? '' : ' (no header in the region, default columns used)'));
        } else if (k === 'popup') {
          var pl = await scan.readText(frame, prof.popup, 'white');
          var pop = parsePopup(pl), lots = parseLots(pl.join('\n'), pop.avg);
          if (!Object.keys(lots).length && !pop.avg) return quick ? null : 'Popup: could not read it';
          window.klLastScan = Object.assign(window.klLastScan || {}, { popup: { lines: pl, pop: pop, lots: lots } });
          info.popup = { id: pop.name, lots: Object.keys(lots).length };
          (window.klPopups = window.klPopups || []).push({ lines: pl, pop: pop, lots: lots, offers: lots.offers || null }); window.klPopups = window.klPopups.slice(-6);
          var ps = P ? snapItem(P, pop.name, pop.level, pop.type) : null;
          // name line missing or buried in noise: look for the name in any title line, then for the one item whose price is this average
          if (P && !(ps && ps.score >= 0.9)) ps = bestNameInLines(pl, 0.85) || ps;
          if (P && !(ps && ps.score >= 0.9)) { var byAvg = itemsUi.itemByAvg(pop.avg, pop.level); var ba = byAvg && P.idx.items.find(function (a) { return String(a[0]) === String(byAvg); }); if (ba) ps = { item: ba, score: 0.9, sim: 0.5 }; }
          var pb = (prof._raw && prof._raw.popup) || prof.popup, pk = frame.width / 1534;   // the whole panel: the box starts at the item name, the panel is a little wider and taller
          marks.push({ x: Math.max(0, pb.x - 77 * pk / frame.width), y: Math.max(0, pb.y - 40 * pk / frame.height), w: pb.w + 107 * pk / frame.width, h: pb.h + 52 * pk / frame.height, kind: 'read', label: Object.keys(lots).length + ' lot' + (Object.keys(lots).length === 1 ? '' : 's') });
          lastLots = lots; lastAvg = pop.avg; lastPopupItem = ps && ps.score >= 0.9 ? ps.item : null;
          var pr = await itemsUi.stagePopup({ a: ps && ps.score >= 0.9 ? ps.item : null, name: pop.name, level: pop.level, avg: pop.avg, lots: lots });
          return (pr.ignored ? 'Popup: item not recognised, ignored' : 'Popup ' + pr.name + ': ' + pr.lots + ' lot price(s) ' + (pr.auto ? 'registered' : 'waiting for approval'));
        } else if (k === 'tooltip') {
          var tl = await scan.readText(frame, prof.tooltip, 'grey');
          var tip = parseTooltip(tl);
          if (!tip.found || !tip.stats.length) return null;
          var tn = P ? bestNameInLines(tl, 0.85) : null, ti = tn ? tn.item : lastPopupItem;
          if (!ti) return 'Hover box: item not recognised';
          // the listing under the mouse: find its lit-up row, read just that row
          var hb = prof.popup ? scan.hoveredBand(frame, prof.popup) : null, hline = hb ? await scan.readText(frame, hb, 'white') : [];
          var hl = hb ? parseLots(hline.join('\n'), lastAvg).list : [], hp = hl.length && hl[0].size === 1 ? hl[0].total : null;
          window.klLastScan = Object.assign(window.klLastScan || {}, { tooltip: { lines: tl, tip: tip, rowLine: hline, price: hp } });
          info.tooltip = { name: ti[1], statut: tip.statut, price: hp };
          var jr = await itemsUi.applyJet({ a: ti, tip: tip, price: hp });
          marks.push({ x: prof.tooltip.x, y: prof.tooltip.y, w: prof.tooltip.w, h: prof.tooltip.h, kind: jr.modified ? 'look' : 'ok', label: jr.modified ? 'exo / forged' : 'clean roll' });
          return 'Hover box ' + jr.name + ': ' + (jr.modified ? 'modified (' + jr.why + ')' + (hp ? ', ' + F(hp) + ' noted as a special price, hover the next listing' : '') : 'clean roll' + (jr.set ? ', price set to ' + F(hp) : hp ? '' : ', hover shows no listing price')) ;
        } else if (k === 'chart') {
          var cl = await scan.readText(frame, prof.chart, 'white');
          var ch = parseMarketChart(cl), cn = P ? bestNameInLines(cl, 0.8) : null;
          if (!cn) return 'Cours du marché: item name not recognised';
          await itemsUi.applyChart({ a: cn.item, sold: ch.sold, avg: ch.avg, median: ch.median });
          return ('Cours du marché ' + cn.item[1] + ': ' + (ch.sold !== null ? ch.sold + ' sold' : 'no “articles vendus” found'));
        } else if (k === 'recipe') {
          var rl = await scan.readText(frame, prof.recipe, 'white');
          var rn = P ? bestNameInLines(rl, 0.85) : null;
          if (!rn) return 'Recettes: item name not recognised';
          var ar = await itemsUi.addItemRow(rn.item);
          return ('Recettes: ' + ar.name + (ar.created ? ' added with ' + ar.ingredients + ' ingredients' : ' already listed'));
        } else if (k === 'budget') {
          var bv = parseBudget(await scan.readNumber(frame, prof.budget));
          if (bv === null) return 'Budget: unreadable';
          await itemsUi.setBudget(bv);
          return ('Budget ' + F(bv));
        } else if (k === 'chat') {
          var cl2 = await scan.readText(frame, prof.chat, 'grey');
          info.chat = true;
          var tx = transactionLines(cl2.map(normalizeTransactionLine));
          if (tx.length) await saveLedgerTransactions(tx, ['chat-' + new Date().toISOString().slice(0, 10)]);
          return ('Chat: ' + tx.length + ' purchase/sale line(s) saved');
        }
      } catch (e) { return k + ': ' + e.message; } finally { (window.klTiming = window.klTiming || {})[k] = Math.round(performance.now() - tk); }
    }
    // the hover box needs the lots of the popup read in the same scan: it goes last
    var readGroup = async function (ks) { var a = await Promise.all(ks.filter(function (k) { return k !== 'tooltip'; }).map(readKey)); if (ks.indexOf('tooltip') >= 0) a.push(await readKey('tooltip')); return a; };
    var out = (await readGroup(keys)).filter(Boolean);
    if (quick && marketBad) { scan.forgetProfile(); E.scanning = false; return scanFrame(frame); }   // layout changed: detect again, then read
    E.scanning = false;
    var text = out.join(' · ') + ' (' + ((performance.now() - tStart) / 1000).toFixed(1) + ' s)';
    $('scan-status').textContent = 'Done. ' + text;
    await itemsUi.logScan(text);
    recordAction('scan');
    sessEvent({ type: 'scan', ms: performance.now() - tStart, market: info.market, popup: info.popup, chat: info.chat });
    // highlight what was read on the game screen, and say what to scan next
    try {
      nextHint = info.tooltip ? (info.tooltip.statut ? 'Forged one noted. Hover the next listing.' : 'Clean roll saved. Scroll the list or open the next item.') : info.popup ? 'Lots read. Hover the cheapest listing for its jets, or open the next item.' : info.market ? 'List read. Open an item to scan its lots.' : '';
      if (kamoRef && kamoRef.marks) kamoRef.marks(marks, nextHint, (function () { try { return stream.getVideoTracks()[0].getSettings().displaySurface || ''; } catch (e) { return ''; } })(), frame.width, frame.height);
    } catch (e) { /* highlights are optional */ }
    // A quick scan did not look for new panels: do it now, out of the way, and read whatever has appeared (a popup that opened, say).
    if (quick && !profileKeys().length && !refreshing) {
      refreshing = true;
      scan.autoDetect(frame).then(async function (np) {
        var added = Object.keys(np).filter(function (k) { return !prof[k]; });
        if (added.length && !E.scanning) { E.scanning = true; var p2 = prof; prof = np; var more = (await readGroup(added)).filter(Boolean); prof = p2; E.scanning = false; if (more.length) { $('scan-status').textContent = $('scan-status').textContent + ' · ' + more.join(' · '); try { if (kamoRef && kamoRef.marks) kamoRef.marks(marks, nextHint, (function () { try { return stream.getVideoTracks()[0].getSettings().displaySurface || ''; } catch (e) { return ''; } })(), frame.width, frame.height); } catch (e) { /* optional */ } } }
      }).catch(function () {}).then(function () { refreshing = false; });
    }
  }
  var refreshing = false;
  return { init: init, scanFrame: scanFrame };
}
