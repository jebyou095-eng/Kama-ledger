import './style.css';
import JSZip from 'jszip';
import { initTheme } from './theme.js';
import { initItems } from './items-ui.js';
import { parseLots } from './items.js';
import { parseBudget, parseMarketChart, parsePopup, snapItem } from './market.js';
import { mergeIndex, SUBTYPES, pageItems, lastPage } from './gamedata.js';
import * as scan from './scan.js';
import { runDiagnostics } from './diag.js';
import { APP_BUILD } from './diag-plan.js';
import { analyzePanel, cleanTransactionPatch, mergeLedgerHistory, normLine as normalizeTransactionLine, removeLedgerEntry, transactionLines, transactionToLine, updateLedgerEntry } from './transactions.js';

/*CORE*/
function num(s) {
  s = String(s || '').toLowerCase().replace(/[\s  ,]/g, '');
  if (!s) return NaN;
  var m;
  if (m = s.match(/^(\d+(?:\.\d+)?)kk$/)) return Math.round(m[1] * 1e6);
  if (m = s.match(/^(\d+\.\d+)m$/)) return Math.round(m[1] * 1e6);
  if (m = s.match(/^(\d+)m(\d{1,3})?$/)) return +m[1] * 1e6 + (m[2] ? +m[2] * Math.pow(10, 6 - m[2].length) : 0);
  if (m = s.match(/^(\d+(?:\.\d+)?)k$/)) return Math.round(m[1] * 1e3);
  return /^\d+(\.\d+)?$/.test(s) ? +s : NaN;
}
function tax(p, mode) {
  var t = p * 0.02;
  return mode === 'ceil' ? Math.ceil(t - 1e-9) : Math.round(t);
}
function parseLog(text) {
  var t = text.replace(/[  ]/g, ' ').replace(/(\([\d ]+)\s*\n\s*kamas\)/g, '$1 kamas)');
  var items = {}, total = 0, n = 0, income = 0, flags = [];
    t.split('\n').forEach(function (l, i) { 
    l = l.trim();
    if (!l) return;
    var m;
    if (m = l.match(/Banque\s*:\s*\+\s*([\d ]+)\s*Kamas/i)) {
      income += +m[1].replace(/ /g, '');
      return;
    }
    if (/n'est plus disponible|Vous avez créé/i.test(l)) return;
    if (m = l.match(/^(?:\[\d{1,2}:\d{2}\]\s*)?(\d[\d ]*?) x \[(.+?)\] \(([\d ]+) kamas\)/)) {
      var q = +m[1].replace(/ /g, ''), p = +m[3].replace(/ /g, ''), k = m[2];
      if ([1, 10, 100, 1000].indexOf(q) < 0) flags.push('line ' + (i + 1) + ': odd quantity ' + q + ' -> ' + l);
      var it = items[k] || (items[k] = { qty: 0, spent: 0, lines: 0 });
      it.qty += q; it.spent += p; it.lines++; total += p; n++;
      return;
    }
    flags.push('line ' + (i + 1) + ': unreadable -> ' + l);
  });
  return { items, total, lines: n, income, flags };
}
function runesFor(jet, sw, rw, lvl, coef) {
  return (3 * jet * sw * lvl / 200 + 1) / rw * coef / 100;
}
function fixDigits(s) {
  return s
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^\d ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function joinWrapped(t) {
  return t.replace(/[  ]/g, ' ').replace(/(\([\dOolIS ]+)\s*\n\s*k\w{2,4}\s*\)/gi, '$1 kamas)');
}
function normLine(raw) {
  return normalizeTransactionLine(raw);
}
function ocrToLines(t) {
  return joinWrapped(t).split('\n').map(normLine).filter(Boolean);
}
function nk(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function stitch(caps) {
  var out = [], warns = [];
  caps.forEach(function (L, ci) {
    if (!out.length) { out = L.slice(); return; }
    var best = 0, max = Math.min(out.length, L.length);
    for (var k = max; k >= 1; k--) {
      var ok = 0;
      for (var i = 0; i < k; i++) if (nk(out[out.length - k + i]) === nk(L[i])) ok++;
      if (ok === k || (k >= 4 && ok >= Math.ceil(k * 0.85))) { best = k; break; }
    }
    if (!best) {
      warns.push('Capture ' + (ci + 1) + ': no overlap with the previous one, lines may be missing.');
      out = out.concat(L);
    } else {
      var u = {};
      L.slice(0, best).forEach(function (x) { u[nk(x)] = 1; });
      if (Object.keys(u).length === 1 && best < L.length) warns.push('Capture ' + (ci + 1) + ': overlap is ' + best + ' identical line(s), real repeats could be hidden. Check the count.');
      out = out.concat(L.slice(best));
    }
  });
  return { lines: out, warns };
}
function parseLoose(t) {
  try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/([:\[,]\s*)-?(NaN|Infinity)(?=\s*[,}\]])/g, '$1null')); }
}
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\[\]()'’]/g, ' ').replace(/\s+/g, ' ').trim();
}
function effLabel(s) {
  return String(s || '').replace(/\{[^}]*\}/g, '').replace(/#\d/g, '').replace(/^[-\s%]+/, '').replace(/\s+/g, ' ').trim();
}
function buildIndex(raw) {
  var fr = raw.fr || {}, nm = function (id) { var s = fr[String(id)]; return s == null ? '' : String(s); };
  var types = {};
  (raw.types || []).forEach(function (t) { types[t.id] = nm(t.nameId); });
  var effs = {};
  (raw.effects || []).forEach(function (e) {
    var l = effLabel(nm(e.descriptionId));
    if (l) effs[e.id] = l;
  });
  var rec = {}, nr = 0;
  (raw.recipes || []).forEach(function (r) {
    var a = [];
    (r.ingredientIds || []).forEach(function (g, i) { a.push([g, (r.quantities || [])[i] || 1]); });
    if (a.length && !rec[r.resultId]) { rec[r.resultId] = a; nr++; }
  });
  var items = [];
  (raw.items || []).forEach(function (it) {
    var n = nm(it.nameId);
    if (!n) return;
    var e = (it.possibleEffects || []).map(function (x) { return [x.effectId, x.diceNum || 0, x.diceSide || x.diceNum || 0]; });
    items.push([it.id, n, it.level || 0, it.typeId, rec[it.id] || 0, e]);
  });
  return { v: 1, built: (raw.built || new Date().toISOString().slice(0, 10)), recipes: nr, types, effs, items };
}
function prepIndex(idx) {
  var byId = {}, byN = {};
  idx.items.forEach(function (a) {
    byId[a[0]] = a;
    var k = normName(a[1]);
    (byN[k] || (byN[k] = [])).push(a);
  });
  return { idx, byId, byN, keys: Object.keys(byN) };
}
function pickItem(P, q) {
  var h = P.byN[normName(q)];
  if (!h) return null;
  for (var i = 0; i < h.length; i++) if (h[i][4]) return h[i];
  return h[0];
}
function searchItems(P, q, lim) {
  var k = normName(q); if (k.length < 2) return [];
  var s = [], c = [];
  for (var i = 0; i < P.keys.length; i++) {
    var p = P.keys[i].indexOf(k);
    if (p === 0) s.push(P.keys[i]);
    else if (p > 0) c.push(P.keys[i]);
    if (s.length >= lim) break;
  }
  return s.concat(c).slice(0, lim).map(function (x) { return pickItem(P, x); });
}
function lev(a, b, m) {
  if (Math.abs(a.length - b.length) > m) return m + 1;
  var p = [], i, j;
  for (j = 0; j <= b.length; j++) p[j] = j;
  for (i = 1; i <= a.length; i++) {
    var c = [i], mn = i;
    for (j = 1; j <= b.length; j++) {
      c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (c[j] < mn) mn = c[j];
    }
    if (mn > m) return m + 1;
    p = c;
  }
  return p[b.length];
}
function suggest(P, q) {
  var k = normName(q), best = null, bd = 3;
  for (var i = 0; i < P.keys.length; i++) {
    var d = lev(k, P.keys[i], 2);
    if (d < bd) { bd = d; best = P.keys[i]; if (!d) break; }
  }
  return best ? P.byN[best][0][1] : null;
}
var KNOWN = { vitalite: [0.2, 1], force: [1, 1], intelligence: [1, 1], agilite: [1, 1], sagesse: [3, 3], prospection: [3, 3], 'dommage feu': [20, 20] };
/*END*/

var F = function (x) { return isFinite(x) ? Math.round(x).toLocaleString('fr-FR') : '-'; };
var $ = function (id) { return document.getElementById(id); };

// Tabs in the order of the work: collect prices (Items, Scan), then the calculators, then stored data.
var tabs = [['items', 'Items'], ['cap', 'Scan'], ['log', 'Chat log'], ['craft', 'Craft'], ['rec', 'Recycling'], ['bri', 'Brisage'], ['tax', 'Sell & tax'], ['db', 'History'], ['data', 'Game data']];
var TAB_GROUP = { items: 'Work', craft: 'Calculators', db: 'Stored data' };
function loadFlowProfile() {
  try {
    var saved = JSON.parse(localStorage.getItem('kamaLedgerFlow') || '{}');
    return { views: saved.views || {}, actions: saved.actions || {}, preferredCapture: saved.preferredCapture || null };
  } catch (e) { return { views: {}, actions: {}, preferredCapture: null }; }
}
var flowProfile = loadFlowProfile();
function saveFlowProfile() {
  try { localStorage.setItem('kamaLedgerFlow', JSON.stringify(flowProfile)); } catch (e) {}
}
function recordAction(action) {
  flowProfile.actions[action] = (flowProfile.actions[action] || 0) + 1;
  saveFlowProfile();
  renderWorkflow();
}
function renderWorkflow() {}   // the old 'frequent tools' strip was removed from the header

tabs.forEach(function (t, i) {
  if (TAB_GROUP[t[0]]) { var g = document.createElement('span'); g.className = 'nav-group'; g.textContent = TAB_GROUP[t[0]]; $('nav').appendChild(g); }
  var b = document.createElement('button');
  b.textContent = t[1];
  b.onclick = function () { show(t[0]); };
  b.id = 'b-' + t[0];
  $('nav').appendChild(b);
});
function show(k) {
  tabs.forEach(function (t) {
    $('t-' + t[0]).classList.toggle('on', t[0] === k);
    $('b-' + t[0]).classList.toggle('on', t[0] === k);
  });
  try { localStorage.tab = k; } catch (e) {}
  flowProfile.views[k] = (flowProfile.views[k] || 0) + 1;
  saveFlowProfile();
  renderWorkflow();
  if (k === 'db' && typeof renderDB === 'function') showDatabaseView(databaseView);
}
function runLog() {
  var r = parseLog($('log').value);
  $('logres').innerHTML = 'Spent: <span class="big">' + F(r.total) + '</span> kamas in ' + r.lines + ' lines' + (r.income ? ' &nbsp; Income logged: ' + F(r.income) : '');
  var rows = Object.keys(r.items).map(function (k) {
    var o = r.items[k];
    var inf = itemInfo(k);
    return '<tr><td>' + esc(k) + '</td><td>' + esc(inf[0]) + '</td><td style="text-align:left" class="' + (inf[0] === '?' ? 'bad' : 'mu') + '">' + esc(inf[1]) + '</td><td>' + F(o.qty) + '</td><td>' + F(o.spent) + '</td><td>' + F(o.spent / o.qty) + '</td></tr>';
  }).join('');
  var chk = Object.keys(r.items).reduce(function (a, k) { return a + r.items[k].spent; }, 0);
  $('logout').innerHTML = '<table><thead><tr><th>Item</th><th>Lvl</th><th style="text-align:left">Type</th><th>Qty</th><th>Spent</th><th>Avg / unit</th></tr></thead><tbody>' + rows + '</tbody></table><p class="mu">Sum check: ' + F(chk) + (chk === r.total ? ' (matches)' : ' MISMATCH') + '</p>' + (r.flags.length ? '<p class="bad">' + r.flags.length + ' flagged line(s), not counted:</p>' + r.flags.map(function (f) { return '<div class="flag">' + f.replace(/</g, '&lt;') + '</div>'; }).join('') : '');
}
function netP() {
  var L = num($('pl').value);
  return (L - tax(L, $('rnd').value)) / 1000;
}
function addRow(v) {
  v = v || ['', '', '', '', ''];
  var tr = document.createElement('tr');
  tr.innerHTML = [0, 1, 2, 3].map(function (i) { return '<td><input value="' + v[i] + '" ' + (i ? 'style="text-align:right"' : '') + '></td>'; }).join('') + '<td class="v"></td><td class="p"></td><td class="c"></td><td class="s"></td><td class="r"></td>';
  tr.addEventListener('input', calcRec);
  $('rt').tBodies[0].appendChild(tr);
  calcRec();
}
function calcRec() {
  var np = netP(), mg = num($('mg').value) / 100;
  $('net').textContent = isFinite(np) ? np.toFixed(3) : '-';
  var tot = 0;
  [].forEach.call($('rt').tBodies[0].rows, function (tr) {
    var i = tr.querySelectorAll('input'), u = num(i[1].value), pd = num(i[2].value), py = num(i[3].value);
    var val = py * np, pr = val - pd;
    tot += isFinite(pr) ? pr : 0;
    tr.querySelector('.v').textContent = F(val);
    var p = tr.querySelector('.p');
    p.textContent = F(pr);
    p.className = 'p ' + (pr >= 0 ? 'ok' : 'bad');
    tr.querySelector('.c').textContent = isFinite(pd / py) ? (pd / py).toFixed(1) : '-';
    tr.querySelector('.s').textContent = isFinite(val / u) ? (val / u * (1 - mg)).toFixed(1) : '-';
    tr.querySelector('.r').textContent = F(pd / 0.98);
  });
  $('rsum').innerHTML = 'Total profit: <span class="' + (tot >= 0 ? 'ok' : 'bad') + '">' + F(tot) + '</span>';
}
['pl', 'rnd', 'mg'].forEach(function (i) { $(i).addEventListener('input', function () { calcRec(); calcTax(); }); });
function calcTax() {
  var L = num($('lp').value), c = num($('lc').value), t = tax(L, $('rnd').value);
  $('tx1').textContent = F(t);
  $('tx2').textContent = F(L - t);
  $('tx3').textContent = isFinite(c) ? F(c / 0.98) : '-';
  $('tx4').textContent = isFinite(c) ? F(L - t - c) : '-';
}
['lp', 'lc'].forEach(function (i) { $(i).addEventListener('input', calcTax); });
function addB(v) {
  v = v || ['', '', '', '', ''];
  var tr = document.createElement('tr');
  tr.innerHTML = [0, 1, 2, 3, 4].map(function (i) { return '<td><input value="' + v[i] + '" ' + (i ? 'style="text-align:right"' : '') + '></td>'; }).join('') + '<td class="n"></td><td class="w"></td>';
  tr.addEventListener('input', calcB);
  $('bt').tBodies[0].appendChild(tr);
  calcB();
}
var lastBriValue = 0;
function calcB() {
  var l = num($('bl').value), c = num($('bc').value), tr = 0, tv = 0, v100 = 0;
  [].forEach.call($('bt').tBodies[0].rows, function (r) {
    var i = r.querySelectorAll('input'), j = num(i[1].value), sw = num(i[2].value), rw = num(i[3].value), pr = num(i[4].value);
    var n = runesFor(j, sw, rw, l, c), n1 = runesFor(j, sw, rw, l, 100);
    r.querySelector('.n').textContent = isFinite(n) ? n.toFixed(1) : '-';
    var w = n * pr;
    r.querySelector('.w').textContent = F(w);
    if (isFinite(n)) tr += n;
    if (isFinite(w)) tv += w;
    if (isFinite(n1 * pr)) v100 += n1 * pr;
  });
  lastBriValue = tv;
  $('bsum').innerHTML = 'Runes: ' + F(tr) + ' &nbsp; Value: ' + F(tv);
  var ip = num($('bp').value);
  $('bmin').textContent = (isFinite(ip) && v100 > 0) ? 'Minimum coefficient to break even (after 2% tax on selling the runes): ' + (ip / (0.98 * v100) * 100).toFixed(0) + '%  (value at 100% = ' + F(v100) + ')' : 'Enter rune prices and the item price to get the break-even coefficient.';
}
['bl', 'bc', 'bp'].forEach(function (i) { $(i).addEventListener('input', calcB); });

var Q = [], region = null, auto = false, stream = null, lastSmall = null, x0 = 0, y0 = 0, dragging = false;
var captureSources = [], captureSourceType = 'screen', captureSelection = null, capturePickerResolve = null, pendingCaptureSource = null, activeCaptureSource = null;
var interactionEnabled = false;
var unclassifiedCaptures = [];
function renderCaptureSources() {
  var list = $('capture-sources');
  var sources = captureSources.filter(function (source) { return source.type === captureSourceType; });
  list.replaceChildren();
  $('capture-empty').hidden = sources.length > 0;
  $('capture-share').disabled = !sources.some(function (source) { return source.id === captureSelection; });
  sources.forEach(function (source) {
    var option = document.createElement('button');
    option.type = 'button';
    option.className = 'source-option' + (source.id === captureSelection ? ' selected' : '');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(source.id === captureSelection));
    var thumbnail = document.createElement('img');
    thumbnail.src = source.thumbnail;
    thumbnail.alt = '';
    var name = document.createElement('span');
    name.textContent = source.name;
    option.append(thumbnail, name);
    option.addEventListener('click', function () {
      captureSelection = source.id;
      renderCaptureSources();
    });
    list.appendChild(option);
  });
}
function chooseCaptureSource(sources) {
  captureSources = Array.isArray(sources) ? sources : [];
  var preferred = flowProfile.preferredCapture;
  var matchingPreferred = preferred && captureSources.find(function (source) { return source.type === preferred.type && source.name === preferred.name; });
  captureSourceType = preferred ? preferred.type : 'screen';
  captureSelection = matchingPreferred ? matchingPreferred.id : null;
  $('capture-picker').hidden = false;
  $('picker-screens').classList.toggle('on', captureSourceType === 'screen');
  $('picker-screens').setAttribute('aria-selected', String(captureSourceType === 'screen'));
  $('picker-windows').classList.toggle('on', captureSourceType === 'window');
  $('picker-windows').setAttribute('aria-selected', String(captureSourceType === 'window'));
  renderCaptureSources();
  return new Promise(function (resolve) { capturePickerResolve = resolve; });
}
function closeCapturePicker(sourceId) {
  $('capture-picker').hidden = true;
  if (capturePickerResolve) {
    capturePickerResolve(sourceId || null);
    capturePickerResolve = null;
  }
}
function setCaptureSourceType(type) {
  captureSourceType = type;
  captureSelection = null;
  var screenTab = type === 'screen';
  $('picker-screens').classList.toggle('on', screenTab);
  $('picker-screens').setAttribute('aria-selected', String(screenTab));
  $('picker-windows').classList.toggle('on', !screenTab);
  $('picker-windows').setAttribute('aria-selected', String(!screenTab));
  renderCaptureSources();
}
$('picker-screens').addEventListener('click', function () { setCaptureSourceType('screen'); });
$('picker-windows').addEventListener('click', function () { setCaptureSourceType('window'); });
$('capture-share').addEventListener('click', function () {
  pendingCaptureSource = captureSources.find(function (source) { return source.id === captureSelection; }) || null;
  closeCapturePicker(captureSelection);
});
$('capture-cancel').addEventListener('click', function () { closeCapturePicker(); });
$('capture-picker-close').addEventListener('click', function () { closeCapturePicker(); });
$('capture-picker').addEventListener('click', function (event) {
  if (event.target === this) closeCapturePicker();
});
function showCaptureStream(s) {
  stream = s;
  activeCaptureSource = pendingCaptureSource;
  if (window.kamaDesktopCapture) window.kamaDesktopCapture.setSharing(true);
  $('vid').srcObject = s;
  $('vid').play();
  $('vw').style.display = 'block';
  $('stop-share').hidden = false;
  $('game-interaction').disabled = !window.kamaDesktopCapture || !activeCaptureSource || activeCaptureSource.type !== 'window';
  $('interaction-status').hidden = $('game-interaction').disabled;
  var sourceName = pendingCaptureSource ? pendingCaptureSource.name : 'shared screen or window';
  $('capture-status').textContent = 'Sharing ' + sourceName + '.';
  if (pendingCaptureSource) {
    flowProfile.preferredCapture = { type: pendingCaptureSource.type, name: pendingCaptureSource.name };
    pendingCaptureSource = null;
    saveFlowProfile();
  }
  recordAction('share');
  updateCaptureControls();
  var videoTrack = s.getVideoTracks()[0];
  if (videoTrack) videoTrack.onended = function () { endCapture(false); };
}
function updateCaptureControls() {
  $('global-share-toggle').textContent = stream ? 'Stop screen share' : 'Start screen share';
  $('global-auto-toggle').textContent = 'Auto capture ' + (auto ? 'on' : 'off');
  $('global-auto-toggle').disabled = !stream;
  $('game-interaction').textContent = 'Game input: ' + (interactionEnabled ? 'on' : 'off');
  $('game-interaction').setAttribute('aria-pressed', String(interactionEnabled));
  $('game-interaction').classList.toggle('game-input-on', interactionEnabled);
  $('game-interaction').disabled = !stream || !window.kamaDesktopCapture || !activeCaptureSource || activeCaptureSource.type !== 'window';
}
function endCapture(stopTracks) {
  var activeStream = stream;
  stream = null;
  if (window.kamaDesktopCapture) window.kamaDesktopCapture.setSharing(false);
  activeCaptureSource = null;
  auto = false;
  lastSmall = null;
  interactionEnabled = false;
  if (window.kamaDesktopCapture) window.kamaDesktopCapture.setInteractionEnabled(false);
  if (stopTracks && activeStream) activeStream.getTracks().forEach(function (track) { track.stop(); });
  $('vid').srcObject = null;
  $('vw').style.display = 'none';
  $('stop-share').hidden = true;
  $('autobtn').textContent = 'Auto capture: off';
  $('capture-status').textContent = 'Screen sharing stopped.';
  $('interaction-status').hidden = true;
  updateCaptureControls();
}
function stopShare() {
  if (!stream) return;
  recordAction('stop-share');
  endCapture(true);
}
async function toggleGameInteraction() {
  if (!window.kamaDesktopCapture || !stream || !activeCaptureSource || activeCaptureSource.type !== 'window') return;
  var requestedState = !interactionEnabled;
  var result = await window.kamaDesktopCapture.setInteractionEnabled(requestedState);
  interactionEnabled = !!(result && result.enabled);
  updateCaptureControls();
  $('interaction-status').textContent = interactionEnabled
    ? 'Manual input is on: click the game preview or press a single key while Kama Ledger is focused. Turn Game input off to stop forwarding.'
    : (result && result.reason) || 'Manual input is off.';
  if (interactionEnabled) $('vid').focus();
}
function toggleShare() {
  if (stream) {
    stopShare();
    return;
  }
  show('cap');
  shareScreen();
}
function shareScreen() {
  var bridge = window.kamaDesktopCapture;
  if (!bridge) {
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      .then(showCaptureStream)
      .catch(function (e) { alert('Could not share the window: ' + e.message); });
    return;
  }

  bridge.listSources()
    .then(chooseCaptureSource)
    .then(function (sourceId) {
      if (!sourceId) return null;
      return bridge.selectSource(sourceId, pendingCaptureSource && pendingCaptureSource.name).then(function (selected) {
        if (!selected) throw new Error('The selected screen or window is no longer available.');
        return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      });
    })
    .then(function (s) { if (s) showCaptureStream(s); })
    .catch(function (e) { alert('Could not share the window: ' + e.message); });
}
$('game-interaction').addEventListener('click', toggleGameInteraction);
$('vid').addEventListener('click', function (event) {
  if (!interactionEnabled || !stream || !window.kamaDesktopCapture) return;
  var bounds = this.getBoundingClientRect();
  var point = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  window.kamaDesktopCapture.sendClick(point).then(function (result) {
    if (result && !result.ok) $('interaction-status').textContent = result.reason;
  }).catch(showInputError);
});
document.addEventListener('keydown', function (event) {
  if (!interactionEnabled || !stream || !window.kamaDesktopCapture || $('capture-picker').hidden === false) return;
  var target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
  if (['Enter', 'Space', 'Tab', 'Backspace', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].indexOf(event.key) !== -1 || /^[a-z0-9]$/i.test(event.key)) {
    event.preventDefault();
    window.kamaDesktopCapture.sendKey(event.key).then(showInputResult).catch(showInputError);
  }
});
function showInputResult(result) {
  if (result && !result.ok) $('interaction-status').textContent = result.reason;
}
function showInputError(error) {
  $('interaction-status').textContent = 'Input error: ' + error.message;
}
var reviewRows = [];
var reviewSourceIds = null;
var lastSavedKeys = [];
function setReview(transactions, fresh) {
  reviewRows = transactions.map(function (transaction) { return Object.assign({}, transaction); });
  if (fresh) lastSavedKeys = [];
  renderReview();
}
function syncReviewText() {
  $('ocrtext').value = reviewRows.map(transactionToLine).join('\n');
  $('review-status').textContent = reviewRows.length
    ? reviewRows.length + ' line(s). Edit anything wrong, then save.'
    : 'Nothing left to save.';
}
function matchInfo(name) {
  if (!P) return { text: '', bad: false };
  var found = pickItem(P, name);
  if (found) return { text: 'Lv ' + found[2] + ' ' + (P.idx.types[found[3]] || ''), bad: false };
  var guess = suggest(P, name);
  return { text: guess ? 'not in data' : 'not in data', bad: true, guess: guess };
}
function renderReview() {
  var box = $('transaction-preview');
  box.replaceChildren();
  $('review-actions').hidden = !reviewRows.length;
  if (!reviewRows.length) {
    if ($('ocrtext').value.trim()) {
      var empty = document.createElement('p');
      empty.className = 'mu';
      empty.textContent = 'No sale or purchase lines recognized.';
      box.appendChild(empty);
    }
    return;
  }
  var table = document.createElement('table');
  table.className = 'review-table';
  var head = table.createTHead().insertRow();
  ['Type', 'Item', 'Qty', 'Amount (kamas)', 'Check', ''].forEach(function (label) {
    var th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  });
  var body = table.createTBody();
  reviewRows.forEach(function (row, index) {
    var tr = body.insertRow();
    tr.className = row.type;
    var typeCell = tr.insertCell(), type = document.createElement('select');
    [['purchase', 'Bought'], ['sale', 'Sold']].forEach(function (option) {
      var o = document.createElement('option');
      o.value = option[0]; o.textContent = option[1]; type.appendChild(o);
    });
    type.value = row.type;
    type.addEventListener('change', function () { row.type = type.value; syncReviewText(); renderReview(); });
    typeCell.appendChild(type);

    var itemCell = tr.insertCell(), item = document.createElement('input');
    item.value = row.item; item.setAttribute('list', 'review-names'); item.setAttribute('aria-label', 'Item name');
    var matchCell = document.createElement('td');
    function paintMatch() {
      var info = matchInfo(row.item);
      matchCell.replaceChildren();
      matchCell.className = 'match' + (info.bad ? ' bad' : '');
      matchCell.append(info.text);
      if (info.guess) {
        var use = document.createElement('button');
        use.type = 'button'; use.className = 'row-button'; use.textContent = 'use "' + info.guess + '"';
        use.addEventListener('click', function () { row.item = info.guess; syncReviewText(); renderReview(); });
        matchCell.append(' ', use);
      }
    }
    item.addEventListener('input', function () {
      row.item = item.value;
      var list = $('review-names');
      list.replaceChildren();
      if (P) searchItems(P, item.value, 15).forEach(function (found) { var o = document.createElement('option'); o.value = found[1]; list.appendChild(o); });
      syncReviewText(); paintMatch();
    });
    itemCell.appendChild(item);
    var qtyCell = tr.insertCell(), qty = document.createElement('input');
    qty.className = 'num'; qty.value = row.quantity || ''; qty.setAttribute('aria-label', 'Quantity'); qty.inputMode = 'numeric';
    qty.addEventListener('input', function () { var n = Number(String(qty.value).replace(/\D/g, '')); row.quantity = n > 0 ? n : null; syncReviewText(); });
    qtyCell.appendChild(qty);
    var amountCell = tr.insertCell(), amount = document.createElement('input');
    amount.className = 'num'; amount.value = row.amount; amount.setAttribute('aria-label', 'Amount in kamas'); amount.inputMode = 'numeric';
    amount.addEventListener('input', function () { var n = Number(String(amount.value).replace(/\D/g, '')); row.amount = isFinite(n) ? n : 0; syncReviewText(); });
    amountCell.appendChild(amount);
    tr.appendChild(matchCell);
    var delCell = tr.insertCell(), del = document.createElement('button');
    del.type = 'button'; del.className = 'row-button'; del.textContent = '×'; del.title = 'Remove this line'; del.setAttribute('aria-label', 'Remove this line');
    del.addEventListener('click', function () { reviewRows.splice(index, 1); syncReviewText(); renderReview(); });
    delCell.appendChild(del);
    paintMatch();
  });
  box.appendChild(table);
}
function renderTransactionPreview() { reviewSourceIds = null; setReview(transactionLines($('ocrtext').value.split('\n')), true); }
async function saveReview() {
  if (!reviewRows.length) return;
  var ids = reviewSourceIds || Q.map(function (capture) { return capture.id; }).filter(function (id) { return id != null; });
  var existing = await metaGet('ledger-history') || [];
  if (lastSavedKeys.length) existing = existing.filter(function (entry) { return lastSavedKeys.indexOf(entry.key) < 0; });
  var before = existing.map(function (entry) { return entry.key; });
  ledgerHistory = mergeLedgerHistory(existing, reviewRows, ids, Date.now());
  lastSavedKeys = ledgerHistory.map(function (entry) { return entry.key; }).filter(function (key) { return before.indexOf(key) < 0; });
  await metaPut('ledger-history', ledgerHistory);
  renderLedgerHistory();
  $('review-status').textContent = 'Saved ' + reviewRows.length + ' line(s) to the ledger. You can keep editing and save again to replace them.';
}
$('review-save').addEventListener('click', saveReview);
$('ocrtext').addEventListener('input', renderTransactionPreview);
$('show-unclassified').addEventListener('click', function () {
  $('unclassified-list').hidden = !$('unclassified-list').hidden;
});
function renderUnclassified() {
  var list = $('unclassified-list');
  $('unclassified-count').textContent = 'Unclassified: ' + unclassifiedCaptures.length;
  list.replaceChildren();
  unclassifiedCaptures.forEach(function (capture, index) {
    var row = document.createElement('div');
    row.className = 'unclassified-row';
    var excerpt = document.createElement('pre');
    excerpt.textContent = capture.lines.join('\n');
    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Label unclassified panel');
    [['', 'Choose panel…'], ['chat', 'Chat'], ['recipes', 'Recettes'], ['market-list', 'Hôtel de vente'], ['market-chart', 'Cours du marché'], ['inventory', 'Inventaire'], ['brisage', 'Brisage']].forEach(function (optionData) {
      var option = document.createElement('option');
      option.value = optionData[0];
      option.textContent = optionData[1];
      select.appendChild(option);
    });
    var label = document.createElement('button');
    label.className = 'btn';
    label.textContent = 'Apply label';
    label.addEventListener('click', async function () {
      if (!select.value) return;
      try {
        var analyzed = analyzePanel(capture.lines, select.value);
        if (analyzed.panel === 'chat') {
          $('ocrtext').value = analyzed.transactions.map(function (transaction) { return transaction.line; }).join('\n');
          renderTransactionPreview();
          reviewSourceIds = capture.sourceIds;
          show('cap');
        }
        else if (analyzed.panel === 'recipes') {
          var prior = await metaGet('recipe-observations') || [];
          prior.push({ capturedAt: capture.createdAt, sourceIds: capture.sourceIds, ingredients: analyzed.ingredients });
          await metaPut('recipe-observations', prior);
        }
        else {
          var observations = await metaGet('panel-observations') || [];
          observations.push({ capturedAt: capture.createdAt, sourceIds: capture.sourceIds, panel: analyzed.panel, lines: analyzed.lines });
          await metaPut('panel-observations', observations);
        }
        unclassifiedCaptures.splice(index, 1);
        await metaPut('unclassified-captures', unclassifiedCaptures);
        renderUnclassified();
        $('ocrst').textContent = analyzed.label + ' label applied.';
      } catch (error) {
        $('ocrst').textContent = 'Could not save panel classification: ' + error.message;
      }
    });
    row.append(excerpt, select, label);
    list.appendChild(row);
  });
}
function drawMode() {
  var o = $('ov');
  var on = o.style.pointerEvents !== 'auto';
  o.style.pointerEvents = on ? 'auto' : 'none';
  $('rgbtn').textContent = on ? 'Drag on the video...' : 'Set region';
}
$('ov').addEventListener('mousedown', function (e) {
  var r = this.getBoundingClientRect();
  x0 = (e.clientX - r.left) / r.width;
  y0 = (e.clientY - r.top) / r.height;
  dragging = true;
});
$('ov').addEventListener('mousemove', function (e) {
  if (!dragging) return;
  var r = this.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  var drawn = {
    x: Math.max(0, Math.min(x, x0)),
    y: Math.max(0, Math.min(y, y0)),
    w: Math.min(1, Math.abs(x - x0)),
    h: Math.min(1, Math.abs(y - y0))
  };
  if (profileTarget) drawRect = drawn; else region = drawn;
  var g = $('rg');
  g.style.display = 'block';
  g.style.left = drawn.x * 100 + '%';
  g.style.top = drawn.y * 100 + '%';
  g.style.width = drawn.w * 100 + '%';
  g.style.height = drawn.h * 100 + '%';
});
$('ov').addEventListener('mouseup', function () {
  dragging = false;
  this.style.pointerEvents = 'none';
  $('rgbtn').textContent = 'Set region';
  if (profileTarget) finishProfileRegion();
});
function grab() {
  var v = $('vid');
  if (!v.videoWidth) return null;
  var r = region && region.w > 0.02 && region.h > 0.02 ? region : { x: 0, y: 0, w: 1, h: 1 };
  var sx = Math.round(r.x * v.videoWidth), sy = Math.round(r.y * v.videoHeight), sw = Math.max(8, Math.round(r.w * v.videoWidth)), sh = Math.max(8, Math.round(r.h * v.videoHeight));
  var c = document.createElement('canvas');
  c.width = sw; c.height = sh; c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}
function push(url, src) {
  var rec = { ts: Date.now(), url, text: null, src: src || 'auto' };
  return dbAdd(rec).then(function (id) {
    Q.push({ id, url });
    renderQ();
    if ($('t-db').classList.contains('on')) showDatabaseView(databaseView);
    return id;
  });
}
function snap() {
  var c = grab();
  if (c) { recordAction('snap'); push(c.toDataURL('image/png'), 'snap'); } else alert('Share the game window first.');
}
document.addEventListener('keydown', function (event) {
  var target = event.target;
  var isTyping = !!(target && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ));
  if (event.key === 'Escape' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (interactionEnabled && stream && window.kamaDesktopCapture) {
      event.preventDefault();
      window.kamaDesktopCapture.sendKey('Escape').catch(function () {});
      return;
    }
    event.preventDefault();
    if (!$('capture-picker').hidden) {
      closeCapturePicker();
      return;
    }
    snap();
  }
});
function toggleAuto() {
  if (!stream) { alert('Share the game window first.'); return; }
  auto = !auto; lastSmall = null; $('autobtn').textContent = 'Auto capture: ' + (auto ? 'ON' : 'off');
  updateCaptureControls();
  recordAction('auto-capture');
}
setInterval(function () {
  if (!auto || !stream) return;
  if (Q.length >= 150) { toggleAuto(); return; }
  var c = grab(); if (!c) return;
  var s = document.createElement('canvas'); s.width = 96; s.height = 64;
  var g = s.getContext('2d'); g.drawImage(c, 0, 0, 96, 64);
  var d = g.getImageData(0, 0, 96, 64).data, gr = new Uint8Array(96 * 64);
  for (var i = 0; i < gr.length; i++) gr[i] = (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3;
  var take = !lastSmall;
  if (lastSmall) {
    var t = 0;
    for (i = 0; i < gr.length; i++) t += Math.abs(gr[i] - lastSmall[i]);
    take = t / gr.length > 4;
  }
  if (take) { lastSmall = gr; push(c.toDataURL('image/png'), 'auto'); }
}, 600);
function renderQ() {
  $('qn').textContent = Q.length;
  $('q').innerHTML = Q.map(function (o, i) { return '<div style="position:relative"><img src="' + o.url + '" style="height:64px;border:1px solid var(--bd);display:block"><button class="btn" style="position:absolute;top:0;right:0;padding:0 6px" onclick="delQ(' + i + ')">×</button></div>'; }).join('');
}
function delQ(i) { Q.splice(i, 1); renderQ(); }
function clearQ() { Q = []; renderQ(); }
function addFiles(fs) {
  [].forEach.call(fs, function (f) {
    if (!/^image\//.test(f.type)) return;
    var r = new FileReader();
    r.onload = function () { push(r.result, 'file'); };
    r.readAsDataURL(f);
  });
}
$('fi').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
document.addEventListener('paste', function (e) {
  if (!$('t-cap').classList.contains('on')) return;
  var it = e.clipboardData && e.clipboardData.files;
  if (it && it.length) { e.preventDefault(); addFiles(it); }
});
$('t-cap').addEventListener('dragover', function (e) { e.preventDefault(); });
$('t-cap').addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
function loadTess() {
  return new Promise(function (res, rej) {
    if (window.Tesseract) return res();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = res;
    s.onerror = function () { rej(new Error('Could not load the OCR engine. It needs internet the first time.')); };
    document.head.appendChild(s);
  });
}
function prep(url) {
  return new Promise(function (res) {
    var im = new Image();
    im.onload = function () {
      var k = im.width < 900 ? 3 : 2, c = document.createElement('canvas');
      c.width = im.width * k; c.height = im.height * k;
      var g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, c.width, c.height);
      var d = g.getImageData(0, 0, c.width, c.height), p = d.data, mn = 255, mx = 0, v, i;
      for (i = 0; i < p.length; i += 4) {
        v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
        p[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
      }
      var sc = 255 / Math.max(1, mx - mn);
      for (i = 0; i < p.length; i += 4) {
        v = 255 - (p[i] - mn) * sc;
        p[i] = p[i + 1] = p[i + 2] = v;
        p[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      res(c);
    };
    im.src = url;
  });
}
async function readAll() {
  if (!Q.length) { $('ocrst').textContent = 'Queue is empty.'; return; }
  try {
    $('ocrst').textContent = 'Loading OCR engine...';
    var w = await scan.getWorker();
    await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
    var caps = [];
    for (var i = 0; i < Q.length; i++) {
      $('ocrst').textContent = 'Reading ' + (i + 1) + ' / ' + Q.length;
      var r = await w.recognize(await prep(Q[i].url));
      caps.push(ocrToLines(r.data.text));
      if (Q[i].id != null) await dbUpdate(Q[i].id, { text: r.data.text });
    }
    var s = stitch(caps);
    var panel = analyzePanel(s.lines, $('capture-region-label').value);
    var transactions = panel.panel === 'chat' ? panel.transactions : [];
    $('ocrtext').value = panel.panel === 'chat' ? transactions.map(function (transaction) { return transaction.line; }).join('\n') : '';
    renderTransactionPreview();
    var sourceIds = Q.map(function (capture) { return capture.id; }).filter(function (id) { return id != null; });
    if (panel.panel === 'unclassified') {
      unclassifiedCaptures.push({ id: Date.now(), sourceIds: sourceIds, lines: s.lines, createdAt: Date.now() });
      await metaPut('unclassified-captures', unclassifiedCaptures);
      renderUnclassified();
    }
    $('ocrwarn').innerHTML = s.warns.map(function (x) { return '<div>' + x + '</div>'; }).join('');
    if ($('t-db').classList.contains('on')) renderDB();
    $('ocrst').textContent = panel.panel === 'unclassified'
      ? 'Panel title was not recognized. Capture added to Unclassified for manual labeling.'
      : panel.panel === 'chat'
        ? (transactions.length ? 'Chat: found ' + transactions.length + ' sale/purchase line(s). Check them, fix anything wrong, then press Save to ledger.' : 'Chat recognized; no purchase or bank-credit sale lines found.')
        : panel.label + ' recognized. ' + (panel.ingredients ? panel.ingredients.length + ' recipe ingredient(s) found; market and other values remain unconfirmed.' : 'Panel text retained for review, not added to the trade ledger.');
  } catch (e) { $('ocrst').textContent = 'Error: ' + e.message; }
}
function toLog() { $('log').value = $('ocrtext').value; show('log'); runLog(); }

var DB = null;
var ledgerHistory = [];
var databaseView = 'captures';
try {
  var savedCaptureRegionLabel = localStorage.getItem('kamaLedgerCaptureRegion');
  if (savedCaptureRegionLabel && $('capture-region-label').querySelector('option[value="' + savedCaptureRegionLabel + '"]')) $('capture-region-label').value = savedCaptureRegionLabel;
} catch (e) {}
$('capture-region-label').addEventListener('change', function () {
  try { localStorage.setItem('kamaLedgerCaptureRegion', this.value); } catch (e) {}
});
function dbOpen() {
  return new Promise(function (res) {
    try {
      var r = indexedDB.open('kama-ledger', 3);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('shots')) d.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('Items')) d.createObjectStore('Items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('Ingredients')) d.createObjectStore('Ingredients', { keyPath: 'id' });
      };
      r.onsuccess = function () { DB = r.result; res(); };
      r.onerror = function () { res(); };
    } catch (e) { res(); }
  });
}
function dbs(m) { return DB.transaction('shots', m).objectStore('shots'); }
function dbAdd(rec) {
  return new Promise(function (res) {
    if (!DB) return res(null);
    var q = dbs('readwrite').add(rec);
    q.onsuccess = function () { res(q.result); };
    q.onerror = function () { res(null); };
  });
}
function dbAll() {
  return new Promise(function (res) {
    if (!DB) return res([]);
    var q = dbs('readonly').getAll();
    q.onsuccess = function () { res(q.result); };
    q.onerror = function () { res([]); };
  });
}
function dbUpdate(id, patch) {
  return new Promise(function (res) {
    if (!DB) return res();
    var s = dbs('readwrite'), g = s.get(id);
    g.onsuccess = function () {
      if (!g.result) return res();
      var o = g.result;
      for (var k in patch) o[k] = patch[k];
      s.put(o).onsuccess = function () { res(); };
    };
    g.onerror = function () { res(); };
  });
}
async function saveLedgerTransactions(transactions, captureIds) {
  if (!transactions.length) return;
  var existing = await metaGet('ledger-history') || [];
  ledgerHistory = mergeLedgerHistory(existing, transactions, captureIds, Date.now());
  await metaPut('ledger-history', ledgerHistory);
  renderLedgerHistory();
}
function showDatabaseView(view) {
  databaseView = view;
  var captures = view === 'captures';
  $('db-captures-tab').classList.toggle('on', captures);
  $('db-captures-tab').setAttribute('aria-selected', String(captures));
  $('db-ledger-tab').classList.toggle('on', !captures);
  $('db-ledger-tab').setAttribute('aria-selected', String(!captures));
  $('db-captures-view').hidden = !captures;
  $('db-ledger-view').hidden = captures;
  if (captures) renderDB(); else renderLedgerHistory();
}
function ledgerTotals() {
  var totals = ledgerHistory.reduce(function (result, entry) {
    result[entry.type] += Number(entry.amount) || 0;
    return result;
  }, { sale: 0, purchase: 0 });
  $('ledger-summary').textContent = 'Sales: +' + F(totals.sale) + ' kamas  |  Purchases: -' + F(totals.purchase) + ' kamas  |  Net: ' + (totals.sale - totals.purchase >= 0 ? '+' : '-') + F(Math.abs(totals.sale - totals.purchase)) + ' kamas';
}
async function editLedger(key, patch) {
  ledgerHistory = updateLedgerEntry(ledgerHistory, key, patch);
  await metaPut('ledger-history', ledgerHistory);
  ledgerTotals();
}
function renderLedgerHistory() {
  var rows = $('ledger-table').tBodies[0];
  if (!rows) return;
  var sorted = ledgerHistory.slice().sort(function (a, b) { return b.recordedAt - a.recordedAt; });
  rows.replaceChildren();
  ledgerTotals();
  $('ledger-empty').hidden = sorted.length > 0;
  sorted.forEach(function (entry) {
    var row = document.createElement('tr');
    row.className = entry.type === 'sale' ? 'ledger-sale' : 'ledger-purchase';
    function cell(node) { var td = document.createElement('td'); td.append(node); row.appendChild(td); return td; }
    cell(entry.time || fmtT(entry.recordedAt));
    var type = document.createElement('select');
    [['purchase', 'Bought'], ['sale', 'Sold']].forEach(function (option) {
      var o = document.createElement('option'); o.value = option[0]; o.textContent = option[1]; type.appendChild(o);
    });
    type.value = entry.type;
    type.addEventListener('change', function () { editLedger(entry.key, { type: type.value }).then(renderLedgerHistory); });
    cell(type);
    var item = document.createElement('input');
    item.value = entry.item; item.setAttribute('aria-label', 'Item name');
    item.addEventListener('change', function () {
      if (!item.value.trim()) { item.value = entry.item; return; }
      entry.item = item.value.trim();
      editLedger(entry.key, { item: item.value });
    });
    var itemCell = cell(item);
    if (entry.edited) { var tag = document.createElement('span'); tag.className = 'edited-tag'; tag.textContent = 'edited'; itemCell.appendChild(tag); }
    var qty = document.createElement('input');
    qty.className = 'num'; qty.value = entry.quantity || ''; qty.setAttribute('aria-label', 'Quantity'); qty.inputMode = 'numeric';
    qty.addEventListener('change', function () { var n = Number(String(qty.value).replace(/\D/g, '')); editLedger(entry.key, { quantity: n > 0 ? n : null }); });
    cell(qty);
    var amount = document.createElement('input');
    amount.className = 'num'; amount.value = entry.amount; amount.setAttribute('aria-label', 'Amount in kamas'); amount.inputMode = 'numeric';
    amount.addEventListener('change', function () { var n = Number(String(amount.value).replace(/\D/g, '')); editLedger(entry.key, { amount: n }).then(function () { amount.value = n; }); });
    cell(amount);
    cell(entry.sourceCaptureIds && entry.sourceCaptureIds.length ? entry.sourceCaptureIds.join(', ') : 'Manual OCR');
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'row-button'; del.textContent = '×'; del.title = 'Delete this entry'; del.setAttribute('aria-label', 'Delete this entry');
    del.addEventListener('click', async function () {
      if (!confirm('Delete this entry from the ledger?')) return;
      ledgerHistory = removeLedgerEntry(ledgerHistory, entry.key);
      await metaPut('ledger-history', ledgerHistory);
      renderLedgerHistory();
    });
    cell(del);
    rows.appendChild(row);
  });
}
async function loadLedgerHistory() {
  ledgerHistory = await metaGet('ledger-history') || [];
  renderLedgerHistory();
}
async function loadUnclassifiedCaptures() {
  unclassifiedCaptures = await metaGet('unclassified-captures') || [];
  renderUnclassified();
}
$('db-captures-tab').addEventListener('click', function () { showDatabaseView('captures'); });
$('db-ledger-tab').addEventListener('click', function () { showDatabaseView('ledger'); });
function dbDel(ids) {
  return new Promise(function (res) {
    if (!DB || !ids.length) return res();
    var s = dbs('readwrite');
    ids.forEach(function (i) { s.delete(i); });
    s.transaction.oncomplete = function () { res(); };
  });
}
var dbSelected = {}, dbCache = [];
function fmtT(ts) {
  var d = new Date(ts), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}
async function renderDB() {
  if (!DB) {
    $('dbinfo').innerHTML = '<span class="bad">Storage is not available in this browser (private window?). Captures work but are not saved.</span>';
    return;
  }
  var all = await dbAll();
  dbCache = all;
  var f = $('dbf').value, sh = all.filter(function (o) { return f === 'all' || (f === 'read' ? o.text != null : o.text == null); }).sort(function (a, b) { return b.ts - a.ts; });
  var bytes = all.reduce(function (a, o) { return a + o.url.length; }, 0), est = '';
  try {
    var e = await navigator.storage.estimate();
    est = ' of about ' + Math.round(e.quota / 1048576) + ' MB available';
  } catch (x) {}
  $('dbinfo').innerHTML = '<b>' + all.length + '</b> capture(s), ' + (bytes / 1048576).toFixed(1) + ' MB used' + est;
  $('dbgrid').innerHTML = sh.map(function (o) {
    return '<div style="width:170px;border:1px solid var(--bd);border-radius:8px;padding:6px"><label><input type="checkbox" style="width:auto" data-id="' + o.id + '" ' + (dbSelected[o.id] ? 'checked' : '') + ' onchange="dbSelected[' + o.id + ']=this.checked"> #'+o.id+'</label>' + '<img src="' + o.url + '" style="width:100%;height:90px;object-fit:cover;cursor:pointer;display:block;margin:4px 0" onclick="dbView(' + o.id + ')"><div class="mu">' + fmtT(o.ts) + '<br>' + o.src + ' &middot; ' + (o.text != null ? '<span class="ok">read</span>' : 'not read') + '</div></div>';
  }).join('') || '<span class="mu">Nothing here yet.</span>';
}
$('dbf').addEventListener('change', renderDB);
function dbSel(on) {
  dbCache.forEach(function (o) { dbSelected[o.id] = on; });
  [].forEach.call(document.querySelectorAll('#dbgrid input'), function (i) { i.checked = on; });
}
function dbView(id) {
  var o = dbCache.filter(function (x) { return x.id === id; })[0];
  if (!o) return;
  $('dbmimg').src = o.url;
  $('dbmtxt').textContent = o.text != null ? o.text : '(not read yet)';
  $('dbmodal').style.display = 'block';
}
function selIds() {
  return Object.keys(dbSelected).filter(function (k) { return dbSelected[k]; }).map(Number);
}
function dbToQueue() {
  var ids = selIds();
  dbCache.filter(function (o) { return ids.indexOf(o.id) >= 0 && !Q.some(function (q) { return q.id === o.id; }); }).sort(function (a, b) { return a.ts - b.ts; }).forEach(function (o) {
    Q.push({ id: o.id, url: o.url });
  });
  renderQ();
  show('cap');
}
async function dbDelSel() {
  var ids = selIds();
  if (!ids.length) return;
  if (!confirm('Delete ' + ids.length + ' capture(s) permanently?')) return;
  await dbDel(ids);
  ids.forEach(function (i) { delete dbSelected[i]; });
  Q = Q.filter(function (q) { return ids.indexOf(q.id) < 0; });
  renderQ();
  renderDB();
}
function dbExport() {
  var inc = $('dbimg').checked, ids = selIds(), rows = dbCache.filter(function (o) { return !ids.length || ids.indexOf(o.id) >= 0; }).sort(function (a, b) { return a.ts - b.ts; }).map(function (o) {
    var r = { id: o.id, time: fmtT(o.ts), source: o.src, text: o.text };
    if (inc) r.image = o.url;
    return r;
  });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 1)], { type: 'application/json' }));
  a.download = 'kama-captures.json';
  a.click();
}

var P = null, CRAFT = null;
function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function itemInfo(name) {
  if (!P) return ['-', ''];
  var a = pickItem(P, name);
  if (a) return [String(a[2]), P.idx.types[a[3]] || ''];
  var g = suggest(P, name);
  return ['?', g ? 'did you mean ' + g + '?' : 'not in data'];
}
function metaPut(k, v) {
  return new Promise(function (res) {
    if (!DB) return res(false);
    try {
      var t = DB.transaction('meta', 'readwrite');
      t.objectStore('meta').put(v, k);
      t.oncomplete = function () { res(true); };
      t.onerror = t.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}
function metaGet(k) {
  return new Promise(function (res) {
    if (!DB) return res(null);
    try {
      var r = DB.transaction('meta').objectStore('meta').get(k);
      r.onsuccess = function () { res(r.result || null); };
      r.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function metaDel(k) {
  return new Promise(function (res) {
    if (!DB) return res();
    try {
      var t = DB.transaction('meta', 'readwrite');
      t.objectStore('meta').delete(k);
      t.oncomplete = t.onerror = function () { res(); };
    } catch (e) { res(); }
  });
}
function setIdx(idx) {
  P = prepIndex(idx); CRAFT = null;
  $('dstat').innerHTML = 'Loaded: <b>' + F(idx.items.length) + '</b> items, <b>' + F(idx.recipes) + '</b> recipes (data built ' + esc(idx.built) + ').';
  if ($('log').value) runLog();
  craftRender();
  dataSearch();
  if (itemsUi) itemsUi.render();
}
function setStat(t) { $('dstat').textContent = t; }
async function loadFiles(files) {
  files = [].slice.call(files); if (!files.length) return;
  var srcs = [];
  try {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (/\.zip$/i.test(f.name)) {
        setStat('Opening ' + f.name + '...');
        var z = await JSZip.loadAsync(f);
        z.forEach(function (path, e) {
          if (!e.dir) srcs.push({ name: path.split('/').pop(), text: function () { return e.async('string'); } });
        });
      } else {
        srcs.push({ name: f.name, text: function (ff) { return function () { return ff.text(); }; }(f) });
      }
    }
    var pick = function (re) { return srcs.filter(function (x) { return re.test(x.name); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }); };
    var compact = pick(/^kama-data.*\.json$/i)[0];
    if (compact) {
      setStat('Reading compact file...');
      var idx = parseLoose(await compact.text());
      if (!idx || idx.v !== 1 || !idx.items) throw new Error('This compact file is not valid.');
      await finish(idx);
      return;
    }
    var raw = {}, need = [['items', /^items\.part\d+\.json$/i], ['recipes', /^recipes\.part\d+\.json$/i], ['types', /^itemtypes\.part\d+\.json$/i], ['effects', /^effects\.part\d+\.json$/i]];
    for (var n = 0; n < need.length; n++) {
      var fl = pick(need[n][1]); raw[need[n][0]] = [];
      for (var j = 0; j < fl.length; j++) {
        setStat('Reading ' + fl[j].name + '...');
        await tick();
        var o = parseLoose(await fl[j].text());
        raw[need[n][0]] = raw[need[n][0]].concat(o.data || []);
      }
    }
    var fr = pick(/^i18n_fr\.json$/i)[0];
    if (fr) {
      setStat('Reading ' + fr.name + '...');
      await tick();
      raw.fr = parseLoose(await fr.text());
    }
    var miss = [];
    if (!raw.items.length) miss.push('Items.part00.json (data/B/entities_json)');
    if (!raw.fr) miss.push('i18n_fr.json (data/C/translations_json)');
    if (miss.length) throw new Error('Missing: ' + miss.join(', ') + '. Found ' + srcs.length + ' file(s) in what you chose.');
    setStat('Building the compact index...');
    await tick();
    await finish(buildIndex(raw), !raw.recipes.length ? ' Warning: no recipes file found, Craft will be empty.' : '');
  } catch (e) { setStat('Could not load: ' + e.message); }
}
function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }
async function finish(idx, warn) {
  var ok = await metaPut('index', idx);
  setIdx(idx);
  $('dstat').innerHTML += (ok ? ' Saved in this browser.' : ' <span class="bad">Could not save in this browser, it will need loading again next time (use Export compact file).</span>') + (warn ? ' <span class="bad">' + esc(warn) + '</span>' : '');
}
async function dataClear() {
  if (!confirm('Remove the saved game data and go back to the data shipped with the app?')) return;
  await metaDel('index');
  location.reload();
}
async function resetEverything() {
  if (!confirm('Erase ALL Kama Ledger data on this computer (items, ingredients, prices, ledger, captures, scan regions, settings) and start fresh? This cannot be undone.')) return;
  try { if (DB) DB.close(); } catch (e) {}
  await new Promise(function (res) {
    try { var r = indexedDB.deleteDatabase('kama-ledger'); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; } catch (e) { res(); }
  });
  try { localStorage.clear(); } catch (e) {}
  location.reload();
}
window.resetEverything = resetEverything;
function dataExport() {
  if (!P) { alert('Load data first.'); return; }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(P.idx)], { type: 'application/json' }));
  a.download = 'kama-data.json';
  a.click();
}
$('dfile').addEventListener('change', function (e) { loadFiles(e.target.files); });
$('dfold').addEventListener('change', function (e) { loadFiles(e.target.files); });
function dataSearch() {
  var q = $('dq').value, b = $('dres');
  if (!P) { b.innerHTML = ''; return; }
  var r = searchItems(P, q, 30);
  b.innerHTML = r.length ? '<table><thead><tr><th>Item</th><th>Lvl</th><th style="text-align:left">Type</th><th>Id</th><th style="text-align:left">Recipe</th></tr></thead><tbody>' + r.map(function (a) {
    return '<tr><td>' + esc(a[1]) + '</td><td>' + a[2] + '</td><td style="text-align:left">' + esc(P.idx.types[a[3]] || '') + '</td><td>' + a[0] + '</td><td style="text-align:left" class="mu">' + (a[4] ? a[4].map(function (g) { var i = P.byId[g[0]]; return g[1] + ' ' + esc(i ? i[1] : '#' + g[0]); }).join(', ') : '') + '</td></tr>';
  }).join('') + '</tbody></table>' : (q.length > 1 ? '<p class="mu">No match.</p>' : '');
}
$('dq').addEventListener('input', dataSearch);
function fillList(inp, dl) {
  var b = $(dl); b.innerHTML = ''; if (!P) return;
  searchItems(P, $(inp).value, 25).forEach(function (a) { var o = document.createElement('option'); o.value = a[1]; b.appendChild(o); });
}
function getPrices() { try { return JSON.parse(localStorage.klprices || '{}'); } catch (e) { return {}; } }
function craftRender() {
  var tb = $('ct').tBodies[0], res = $('cres'), q = $('cq').value;
  if (!P) { tb.innerHTML = ''; CRAFT = null; res.textContent = 'Load the data first (Data tab).'; return; }
  var a = pickItem(P, q);
  if (!a) { tb.innerHTML = ''; CRAFT = null; var g = q.length > 2 ? suggest(P, q) : null; res.textContent = q ? ('No item with that name.' + (g ? ' Did you mean ' + g + '?' : '')) : ''; return; }
  if (!a[4]) { tb.innerHTML = ''; CRAFT = null; res.textContent = a[1] + ' has no craft recipe in the data.'; return; }
  if (CRAFT !== a[0]) { CRAFT = a[0]; tb.innerHTML = ''; var pr = getPrices(); a[4].forEach(function (g) { var it = P.byId[g[0]], tr = document.createElement('tr'); tr.dataset.id = g[0]; tr.dataset.q = g[1]; var td = function (t) { var c = document.createElement('td'); c.textContent = t; return c; }; tr.appendChild(td(it ? it[1] : '#' + g[0])); tr.appendChild(td(g[1])); tr.appendChild(td('')); var c = document.createElement('td'), i = document.createElement('input'); i.style.textAlign = 'right'; i.value = pr[g[0]] || ''; c.appendChild(i); tr.appendChild(c); tr.appendChild(td('')); tb.appendChild(tr); }); }
  var n = num($('cn').value); if (!isFinite(n) || n < 1) n = 1; var cost = 0, miss = 0, pr2 = getPrices();
  [].forEach.call(tb.rows, function (tr) {
    var p = num(tr.querySelector('input').value), q1 = +tr.dataset.q;
    if (isFinite(p)) { pr2[tr.dataset.id] = tr.querySelector('input').value; cost += p * q1; } else miss++;
    tr.cells[2].textContent = F(q1 * n); tr.cells[4].textContent = isFinite(p) ? F(p * q1 * n) : '-';
  });
  try { localStorage.klprices = JSON.stringify(pr2); } catch (e) {}
  var h = 'Cost per craft: <span class="big">' + F(cost) + '</span> &nbsp; for ' + F(n) + ': <b>' + F(cost * n) + '</b>' + (miss ? ' <span class="bad">(' + miss + ' ingredient price(s) missing, cost is incomplete)</span>' : '');
  var sp = num($('cs').value);
  if (isFinite(sp) && !miss) {
    var tx = tax(sp, $('rnd').value), pf = sp - tx - cost;
    h += '<br>Listing at ' + F(sp) + ': tax ' + F(tx) + ', you receive ' + F(sp - tx) + ', profit per item <b class="' + (pf >= 0 ? 'ok' : 'bad') + '">' + F(pf) + '</b>, total <b class="' + (pf >= 0 ? 'ok' : 'bad') + '">' + F(pf * n) + '</b>' + '<br><span class="mu">Break-even listing price: about ' + F(Math.ceil(cost / 0.98)) + '</span>';
  }
  res.innerHTML = h;
}
$('cq').addEventListener('input', function () { fillList('cq', 'cdl'); craftRender(); });
$('cn').addEventListener('input', craftRender); $('cs').addEventListener('input', craftRender); $('ct').addEventListener('input', craftRender);
function fillBrisage() {
  if (!P) return;
  var a = pickItem(P, $('bi').value);
  if (!a) { $('bnote').textContent = $('bi').value ? 'Item not found in the data.' : ''; return; }
  $('bl').value = a[2];
  var tb = $('bt').tBodies[0]; tb.innerHTML = '';
  var seen = {}, kn = 0, un = 0;
  a[5].forEach(function (e) {
    var lab = P.idx.effs[e[0]];
    if (!lab || seen[lab]) return;
    seen[lab] = 1;
    var k = KNOWN[normName(lab)];
    k ? kn++ : un++;
    addB([lab, Math.max(e[1], e[2]), k ? k[0] : '', k ? k[1] : '', '']);
  });
  calcB();
  $('bnote').textContent = a[1] + ': level ' + a[2] + '. Jets are pre-filled with the maximum of the item range, replace them with your item\'s real jets. ' + (un ? un + ' stat(s) have no confirmed weight yet (empty), fill them or ignore them.' : '');
}
$('bi').addEventListener('input', function () { fillList('bi', 'bdl'); });
$('bi').addEventListener('change', fillBrisage);
[['Vitalité', 216, 0.2, 1, ''], ['Force', 49, 1, 1, ''], ['Intelligence', 48, 1, 1, ''], ['Agilité', 48, 1, 1, ''], ['Sagesse', 26, 3, 3, ''], ['Dommages Feu', 10, 20, 20, ''], ['Prospection', 7, 3, 3, '']].forEach(addB);

var itemsUi = null;
initTheme();
itemsUi = initItems({
  $: $, F: F, num: num, esc: esc, normName: normName, pickItem: pickItem,
  getDB: function () { return DB; }, getP: function () { return P; }, metaGet: metaGet, metaPut: metaPut,
  netP: netP, taxMode: function () { return $('rnd').value; },
  fillList: fillList,
  iconUrl: function (id) { var g = P && P.idx.icons && P.idx.icons[id]; return g ? 'https://api.dofusdu.de/dofus3/v1/img/item/' + g + '-64.png' : null; },
  fetchImage: async function (url) { var b = window.kamaDesktopCapture; if (!b || !b.gameImage) return null; var r = await b.gameImage(url); return r && r.ok ? r.dataUrl : null; },
  getOcrText: function () { return $('ocrtext').value; },
  getBrisageValue: function () { return lastBriValue; },
  openBrisage: function (name) { $('bi').value = name; fillBrisage(); show('bri'); }
});
dbOpen().then(function () { renderDB(); return loadLedgerHistory(); }).then(function () { return loadUnclassifiedCaptures(); }).then(function () { return metaGet('index'); }).then(async function (x) {
  // The game data shipped with the app wins unless the saved copy is strictly newer: an older saved copy
  // (from an earlier version of the app) used to hide the bundled data and caused wrong matches.
  var bundled = null;
  try { bundled = (await import('./data/kama-data.json')).default; } catch (e) { bundled = null; }
  var usable = function (d) { return d && Array.isArray(d.items) && d.items.length > 1000 && d.types && d.effs; };
  if (usable(bundled) && (!usable(x) || String(x.built || '') <= String(bundled.built || ''))) { x = bundled; metaPut('index', x); }
  if (x) setIdx(x);
  return itemsUi.load();
});
addRow(); addRow(); calcTax();
var st = 'items';
try { st = localStorage.tab || 'items'; } catch (e) {}
show(st);

window.$ = $;
window.show = show;

/* ---- game data update (current recipes, levels, new items, icons) ---- */
var GD = 'https://api.dofusdu.de/dofus3/v1/fr/items/';
async function gdJson(path) {
  var r;
  for (var tries = 0; tries < 4; tries++) {
    r = await window.kamaDesktopCapture.gameJson(GD + path);
    if (r && r.ok) break;
    if (r && r.status && r.status !== 429 && r.status < 500) break;
    await new Promise(function (res) { setTimeout(res, 600 * (tries + 1) * (tries + 1)); });
  }
  if (!r || !r.ok) { var e = new Error(r && r.status ? 'HTTP ' + r.status : (r && r.error) || 'no answer'); e.status = r && r.status; throw e; }
  return r.json;
}
$('gd-update').addEventListener('click', async function () {
  var b = window.kamaDesktopCapture, st = $('gd-status');
  if (!b || !b.gameJson) { st.textContent = 'This works in the desktop app only (it needs internet access once).'; return; }
  if (!P) { st.textContent = 'Load the game data first.'; return; }
  this.disabled = true;
  var all = [], notes = [], failed = [];
  try {
    for (var s = 0; s < SUBTYPES.length; s++) {
      var sub = SUBTYPES[s], first;
      try { first = await gdJson(sub + '?fields[item]=recipe&page[size]=100&page[number]=1'); } catch (e) { notes.push(sub + ': ' + (e.status === 404 ? 'not offered' : 'FAILED (' + e.message + ')')); if (e.status !== 404) failed.push(sub); continue; }
      var got = pageItems(first).slice(), pages = lastPage(first), n = 2, done = false, err = null;
      // Page count comes from the "last" link; if it is missing, keep going until a page comes back short.
      while (!done && n <= Math.max(pages, 400)) {
        var batch = [];
        for (var q = 0; q < 4 && n <= Math.max(pages, 400); q++) batch.push(n++);
        st.textContent = 'Downloading ' + sub + ' (page ' + batch[0] + (pages > 1 ? '/' + pages : '') + ')...';
        var outs = await Promise.all(batch.map(async function (pg) {
          try { return pageItems(await gdJson(sub + '?fields[item]=recipe&page[size]=100&page[number]=' + pg)); } catch (e) { if (e.status === 404 || e.status === 400) return []; err = e; return null; }
        }));
        if (outs.some(function (o) { return o === null; })) { failed.push(sub); notes.push(sub + ': stopped early (' + err.message + ')'); break; }
        outs.forEach(function (o) { got = got.concat(o); if (o.length < 100) done = true; });
        if (pages > 1 && n > pages) done = true;
      }
      all = all.concat(got); notes.push(sub + ' ' + got.length);
    }
    if (failed.length) throw new Error(failed.join(', ') + ' could not be downloaded completely (' + notes.join('; ') + '). Nothing was changed, try again in a minute');
    if (all.length < 1000) throw new Error('only ' + all.length + ' items came back, so nothing was changed');
    var withRecipe = all.filter(function (x) { return x && x.recipe && x.recipe.length; }).length;
    if (withRecipe < 100) throw new Error('the service sent items without recipes (' + withRecipe + '), so nothing was changed');
    var meta = null; try { meta = (await window.kamaDesktopCapture.gameJson('https://api.dofusdu.de/dofus3/v1/meta/version')).json; } catch (e) {}
    var res = mergeIndex(P.idx, all, new Date().toISOString().slice(0, 10));
    metaPut('index', res.idx); setIdx(res.idx);
    st.textContent = 'Updated' + (meta && meta.version ? ' to game version ' + meta.version : '') + ': ' + res.stats.added + ' new items, ' + res.stats.recipeFixed + ' recipes changed (' + notes.join(', ') + '). Loading images...';
    await itemsUi.fillIcons();
    st.textContent = st.textContent.replace('Loading images...', 'Images loaded.');
  } catch (e) { st.textContent = 'Update failed (nothing was changed): ' + e.message; }
  this.disabled = false;
});
/* ---- scan profile: named regions drawn once, then one key press reads them all ---- */
var PROFILE_TYPES = [
  ['market', 'Market list (rows: image, name, level, average price)'],
  ['popup', 'Lot popup (prices by lot)'],
  ['chart', 'Cours du marché (articles vendus)'],
  ['recipe', 'Recettes window (item to craft)'],
  ['budget', 'Budget (kamas in inventory)'],
  ['chat', 'Chat (purchases and sales)']
];
var profile = {}, profileTarget = null, drawRect = null, scanning = false, stillFrame = null;
try { profile = JSON.parse(localStorage.getItem('kl-profile') || '{}') || {}; } catch (e) { profile = {}; }
function saveProfile() { try { localStorage.setItem('kl-profile', JSON.stringify(profile)); } catch (e) {} }
function profileKeys() { return PROFILE_TYPES.map(function (t) { return t[0]; }).filter(function (k) { return profile[k]; }); }
function showPreviewArea() { $('vw').style.display = 'block'; }
function renderProfile() {
  $('profile-list').innerHTML = PROFILE_TYPES.map(function (t) {
    var set = !!profile[t[0]];
    return '<div class="profile-row"><span class="swatch" data-k="' + t[0] + '"></span><span>' + esc(t[1]) + '</span><span class="mu">' + (set ? 'set' : 'not set') + '</span>'
      + '<button class="btn" type="button" data-set="' + t[0] + '">' + (set ? 'Redraw' : 'Draw') + '</button>'
      + (set ? '<button class="btn" type="button" data-clear="' + t[0] + '">Clear</button>' : '') + '</div>';
  }).join('');
  var boxes = $('pboxes'); boxes.innerHTML = '';
  profileKeys().forEach(function (k, i) {
    var r = profile[k], d = document.createElement('div');
    d.className = 'pbox'; d.style.cssText = 'left:' + r.x * 100 + '%;top:' + r.y * 100 + '%;width:' + r.w * 100 + '%;height:' + r.h * 100 + '%;';
    d.innerHTML = '<span>' + esc(k) + '</span>'; boxes.appendChild(d);
  });
}
$('profile-list').addEventListener('click', function (e) {
  var set = e.target.closest('[data-set]'), clr = e.target.closest('[data-clear]');
  if (clr) { delete profile[clr.dataset.clear]; saveProfile(); renderProfile(); return; }
  if (!set) return;
  if (!stream && !stillFrame) { $('scan-status').textContent = 'Share the game window first, or load a screenshot to draw on.'; return; }
  profileTarget = set.dataset.set; drawRect = null;
  showPreviewArea();
  $('ov').style.pointerEvents = 'auto';
  $('scan-status').textContent = 'Drag a rectangle around the ' + profileTarget + ' area on the preview.';
});
function finishProfileRegion() {
  var key = profileTarget; profileTarget = null;
  $('rg').style.display = 'none';
  if (drawRect && drawRect.w > 0.01 && drawRect.h > 0.01) {
    profile[key] = { x: drawRect.x, y: drawRect.y, w: drawRect.w, h: drawRect.h };
    saveProfile();
    $('scan-status').textContent = key + ' region saved.';
  }
  renderProfile();
}
$('scan-still').addEventListener('change', function () {
  var f = this.files && this.files[0]; this.value = '';
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    scan.frameFromUrl(r.result).then(function (c) {
      stillFrame = c; $('vid').poster = r.result; showPreviewArea();
      $('scan-status').textContent = 'Screenshot loaded (' + c.width + 'x' + c.height + '). Draw your regions on it.';
    });
  };
  r.readAsDataURL(f);
});
$('scan-file').addEventListener('change', async function () {
  var files = [].slice.call(this.files); this.value = '';
  for (var i = 0; i < files.length; i++) {
    var url = await new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(files[i]); });
    await scanFrame(await scan.frameFromUrl(url));
  }
});
$('scan-now').addEventListener('click', function () { scanNow(); });
function scanNow() {
  var frame = stream ? scan.frameFromVideo($('vid')) : stillFrame;
  if (!frame) { $('scan-status').textContent = 'Nothing to scan: share the game window first.'; return Promise.resolve(); }
  return scanFrame(frame);
}
/* ---- diagnostics: one click, one small file; writes nothing to your lists ---- */
var diagFrames = [];
$('diag-files').addEventListener('change', async function () {
  var files = [].slice.call(this.files); this.value = ''; diagFrames = [];
  for (var i = 0; i < files.length; i++) {
    var url = await new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(files[i]); });
    diagFrames.push(await scan.frameFromUrl(url));
  }
  $('diag-status').textContent = diagFrames.length + ' screenshot(s) loaded. Click “Run diagnostics”.';
});
$('diag-run').addEventListener('click', async function () {
  var btn = this, st = $('diag-status');
  if (!P) { st.textContent = 'Load the game data first (Data tab).'; return; }
  if (!stream && !diagFrames.length && !stillFrame) { st.textContent = 'Share the game window first (Start screen share), or choose screenshot file(s).'; return; }
  if (scanning) { st.textContent = 'A scan is running, try again in a few seconds.'; return; }
  btn.disabled = true; scanning = true;
  try {
    var plan = (await import('./diag-plan.js')).PLAN;
    var res = await runDiagnostics({
      P: P, snapItem: snapItem, parsePopup: parsePopup, parseLots: parseLots, parseBudget: parseBudget, appVersion: APP_BUILD,
      includeChat: $('diag-chat').checked, status: function (t) { st.textContent = t; },
      grab: async function (n) {
        if (diagFrames.length) return diagFrames[n] || null;
        if (stream) return scan.frameFromVideo($('vid'));
        return stillFrame;
      }
    });
    var text = JSON.stringify(res);
    var name = 'kama-diag-' + res.plan + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
    st.textContent = 'Done in ' + (res.totalMs / 1000).toFixed(1) + ' s. File saved: ' + name + ' (' + Math.round(text.length / 1024) + ' KB). Send it to Claude.';
  } catch (e) { st.textContent = 'Diagnostics failed: ' + e.message; }
  scanning = false; btn.disabled = false;
});
/* ---- live scan: watches the shared window, scans each new screen once it has settled ---- */
var liveTimer = null, liveLast = null, livePrev = null;
async function liveTick() {
  if (!$('live-scan').checked || !stream || scanning) return;
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
$('live-scan').addEventListener('change', function () {
  clearInterval(liveTimer); liveLast = null; livePrev = null;
  if (this.checked) {
    if (!stream) { this.checked = false; $('scan-status').textContent = 'Share the game window first.'; return; }
    liveTimer = setInterval(function () { liveTick().catch(function () {}); }, 1200);
    $('scan-status').textContent = 'Live scan on.';
  }
});
function bestNameInLines(lines, minScore) {
  var best = null;
  lines.slice(0, 10).forEach(function (l) {
    var s = snapItem(P, l, NaN, '');
    if (s && s.score >= minScore && (!best || s.score > best.score)) best = s;
  });
  return best;
}
async function scanFrame(frame) {
  var tStart = performance.now();
  if (scanning) { $('scan-status').textContent = 'A scan is already running.'; return; }
  scanning = true;
  var prof = profile;
  if (!profileKeys().length) {
    $('scan-status').textContent = 'Looking for the game panels...';
    try { prof = await scan.autoDetect(frame); window.klTiming = { detect: Math.round(performance.now() - tStart) }; } catch (e) { scanning = false; $('scan-status').textContent = 'Could not read the screen: ' + e.message; return; }
  }
  var keys = PROFILE_TYPES.map(function (t) { return t[0]; }).filter(function (k) { return prof[k]; });
  if (!keys.length) { scanning = false; $('scan-status').textContent = 'No game panel on screen (open the market, a lot, Recettes or the chat).'; return { empty: true }; }
  var types = P ? Object.values(P.idx.types) : [];
  $('scan-status').textContent = 'Scanning ' + keys.join(', ') + '...';
  async function readKey(k) {
    var tk = performance.now();
    try {
      if (k === 'market') {
        var m = await scan.readMarketList(frame, prof.market, types, prof._layout && prof._layout.market);
        var rows = m.rows.map(function (r) { var s = P ? snapItem(P, r.rawName, r.level, r.type) : null; return Object.assign({ a: s ? s.item : null, score: s ? s.score : 0, sim: s ? s.sim : 0 }, r); });
        window.klLastScan = Object.assign(window.klLastScan || {}, { market: m.rows });
        var res = await itemsUi.applyMarket(rows);
        return ('Market ' + rows.length + ' rows: ' + res.staged + ' waiting for approval' + (res.auto ? ', ' + res.auto + ' registered' : '') + (res.review ? ' (' + res.review + ' need a look)' : '') + (res.skipped ? ', ' + res.skipped + ' without price' : '') + (res.ignored ? ', ' + res.ignored + ' unreadable ignored' : '') + (m.columnsFromHeader ? '' : ' (no header in the region, default columns used)'));
      } else if (k === 'popup') {
        var pl = await scan.readText(frame, prof.popup, 'white');
        var pop = parsePopup(pl), lots = parseLots(pl.join('\n'));
        if (pop.name.length < 3 || (!Object.keys(lots).length && !pop.avg)) return 'Popup: could not read it';
        window.klLastScan = Object.assign(window.klLastScan || {}, { popup: { lines: pl, pop: pop, lots: lots } });
        var ps = P ? snapItem(P, pop.name, pop.level, pop.type) : null;
        var pr = await itemsUi.stagePopup({ a: ps && ps.score >= 0.9 ? ps.item : null, name: pop.name, level: pop.level, avg: pop.avg, lots: lots });
        return (pr.ignored ? 'Popup: item not recognised, ignored' : 'Popup ' + pr.name + ': ' + pr.lots + ' lot price(s) ' + (pr.auto ? 'registered' : 'waiting for approval'));
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
        var tx = transactionLines(cl2.map(normalizeTransactionLine));
        if (tx.length) await saveLedgerTransactions(tx, ['chat-' + new Date().toISOString().slice(0, 10)]);
        return ('Chat: ' + tx.length + ' purchase/sale line(s) saved');
      }
    } catch (e) { return k + ': ' + e.message; } finally { (window.klTiming = window.klTiming || {})[k] = Math.round(performance.now() - tk); }
  }
  var out = (await Promise.all(keys.map(readKey))).filter(Boolean);
  scanning = false;
  var text = out.join(' · ') + ' (' + ((performance.now() - tStart) / 1000).toFixed(1) + ' s)';
  $('scan-status').textContent = 'Done. ' + text;
  await itemsUi.logScan(text);
  recordAction('scan');
}
renderProfile();
/* ---- capture hotkey (desktop app) ---- */
var DEFAULT_HOTKEY = 'CommandOrControl+Shift+K';
var hotkeyRecording = false;
function hotkeyLabel(accelerator) { return String(accelerator || '').replace('CommandOrControl', 'Ctrl'); }
function accelFromEvent(event) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].indexOf(event.key) >= 0) return null;
  var key = event.key;
  var names = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  if (names[key]) key = names[key];
  else if (key.length === 1) key = key.toUpperCase();
  if (!/^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Space|Up|Down|Left|Right|Tab|Enter|Backspace|Insert|Delete|Home|End|PageUp|PageDown)$/.test(key)) return null;
  var mods = [];
  if (event.ctrlKey || event.metaKey) mods.push('CommandOrControl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (!mods.length && !/^F\d/.test(key)) return null;
  return mods.concat(key).join('+');
}
function beep() {
  if (!$('beep').checked) return;
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.value = 0.06;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.09);
    osc.onended = function () { ctx.close(); };
  } catch (e) {}
}
function hotkeyCapture() {
  if (profileKeys().length || stream || stillFrame) { beep(); return scanNow(); }
  if (!stream) { $('hotkey-status').textContent = 'Hotkey pressed, but no screen or window is being shared yet. Share the game window first.'; return Promise.resolve(null); }
  var canvas = grab();
  if (!canvas) { $('hotkey-status').textContent = 'The shared window has no picture yet.'; return Promise.resolve(null); }
  recordAction('hotkey');
  return push(canvas.toDataURL('image/png'), 'hotkey').then(function (id) {
    beep();
    $('hotkey-status').textContent = 'Captured' + (id != null ? ' #' + id : '') + ' at ' + new Date().toLocaleTimeString() + '. Queue: ' + Q.length;
    return id;
  });
}
async function applyHotkey(accelerator) {
  var bridge = window.kamaDesktopCapture;
  var result = await bridge.setHotkey(accelerator);
  if (result && result.ok) {
    try { localStorage.setItem('kl-hotkey', accelerator); } catch (e) {}
    $('hotkey').value = hotkeyLabel(accelerator);
    $('hotkey-status').textContent = 'Hotkey set to ' + hotkeyLabel(accelerator) + '. It is active while a screen or window is shared; press it in the game to capture.';
    return true;
  }
  $('hotkey-status').textContent = (result && result.reason) || 'Could not set that hotkey.';
  return false;
}
function initHotkey() {
  var bridge = window.kamaDesktopCapture;
  if (!bridge || !bridge.setHotkey) {
    $('hotkey').value = 'Esc';
    $('hotkey-set').disabled = true;
    $('hotkey-status').textContent = 'A hotkey that works inside the game needs the desktop app. In a browser, Esc captures while this page is focused.';
    return;
  }
  if (bridge.onHotkey) bridge.onHotkey(function () { hotkeyCapture(); });
  var saved = DEFAULT_HOTKEY;
  try { saved = localStorage.getItem('kl-hotkey') || DEFAULT_HOTKEY; } catch (e) {}
  $('hotkey').value = hotkeyLabel(saved);
  applyHotkey(saved).then(function (ok) {
    if (!ok && saved !== DEFAULT_HOTKEY) applyHotkey(DEFAULT_HOTKEY);
  });
  $('hotkey-set').addEventListener('click', function () {
    hotkeyRecording = true;
    $('hotkey').classList.add('recording');
    $('hotkey').value = 'Press the new keys...';
    $('hotkey-status').textContent = 'Press the key or combination you want. Esc cancels.';
  });
  document.addEventListener('keydown', async function (event) {
    if (!hotkeyRecording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      hotkeyRecording = false;
      $('hotkey').classList.remove('recording');
      try { $('hotkey').value = hotkeyLabel(localStorage.getItem('kl-hotkey') || DEFAULT_HOTKEY); } catch (e) {}
      $('hotkey-status').textContent = '';
      return;
    }
    var accelerator = accelFromEvent(event);
    if (!accelerator) { $('hotkey-status').textContent = 'Use a function key (F1-F24) or Ctrl/Alt/Shift plus a key.'; return; }
    hotkeyRecording = false;
    $('hotkey').classList.remove('recording');
    var ok = await applyHotkey(accelerator);
    if (!ok) { try { $('hotkey').value = hotkeyLabel(localStorage.getItem('kl-hotkey') || DEFAULT_HOTKEY); } catch (e) {} }
  }, true);
}
initHotkey();

window.runLog = runLog;
window.addRow = addRow;
window.addB = addB;
window.calcRec = calcRec;
window.calcB = calcB;
window.calcTax = calcTax;
window.shareScreen = shareScreen;
window.stopShare = stopShare;
window.toggleShare = toggleShare;
window.drawMode = drawMode;
window.toggleAuto = toggleAuto;
window.snap = snap;
window.readAll = readAll;
window.toLog = toLog;
window.delQ = delQ;
window.clearQ = clearQ;
window.dbSel = dbSel;
window.dbToQueue = dbToQueue;
window.dbDelSel = dbDelSel;
window.dbExport = dbExport;
window.dbView = dbView;
window.dataExport = dataExport;
window.dataClear = dataClear;
window.loadFiles = loadFiles;
window.fillList = fillList;
window.itemInfo = itemInfo;
window.itemInfo = itemInfo;
window.metaGet = metaGet;
window.metaPut = metaPut;
window.metaDel = metaDel;
window.setIdx = setIdx;
window.setStat = setStat;
window.dataSearch = dataSearch;
window.fillBrisage = fillBrisage;

window.loadTess = loadTess;
window.getPrices = getPrices;
window.craftRender = craftRender;
