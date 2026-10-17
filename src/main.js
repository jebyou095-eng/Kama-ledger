import './style.css';
import JSZip from 'jszip';
import { mergeLedgerHistory, normLine as normalizeTransactionLine, transactionLines } from './transactions.js';

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

var tabs = [['log', 'Log total'], ['cap', 'Capture'], ['db', 'Database'], ['rec', 'Recycling'], ['tax', 'Sell & tax'], ['bri', 'Brisage'], ['craft', 'Craft'], ['data', 'Data']];
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
function renderWorkflow() {
  var shortcuts = $('workflow-shortcuts');
  var used = tabs.filter(function (tab) { return flowProfile.views[tab[0]]; });
  used.sort(function (a, b) { return flowProfile.views[b[0]] - flowProfile.views[a[0]]; });
  shortcuts.replaceChildren();
  if (!used.length) {
    var note = document.createElement('span');
    note.className = 'mu';
    note.textContent = 'Your frequent tools will appear here as you work.';
    shortcuts.appendChild(note);
  } else {
    used.slice(0, 3).forEach(function (tab) {
      var shortcut = document.createElement('button');
      shortcut.type = 'button';
      shortcut.className = 'workflow-link';
      shortcut.textContent = tab[1];
      shortcut.addEventListener('click', function () { show(tab[0]); });
      shortcuts.appendChild(shortcut);
    });
  }
  var total = Object.keys(flowProfile.actions).reduce(function (sum, action) { return sum + flowProfile.actions[action]; }, 0);
  $('adaptive-message').textContent = total ? total + ' workflow interactions learned locally' : 'Your workflow stays on this device.';
}

tabs.forEach(function (t, i) {
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
$('reset-profile').addEventListener('click', function () {
  flowProfile = { views: {}, actions: {}, preferredCapture: null };
  saveFlowProfile();
  renderWorkflow();
});
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
  $('bsum').innerHTML = 'Runes: ' + F(tr) + ' &nbsp; Value: ' + F(tv);
  var ip = num($('bp').value);
  $('bmin').textContent = (isFinite(ip) && v100 > 0) ? 'Minimum coefficient to break even (after 2% tax on selling the runes): ' + (ip / (0.98 * v100) * 100).toFixed(0) + '%  (value at 100% = ' + F(v100) + ')' : 'Enter rune prices and the item price to get the break-even coefficient.';
}
['bl', 'bc', 'bp'].forEach(function (i) { $(i).addEventListener('input', calcB); });

var Q = [], region = null, auto = false, stream = null, lastSmall = null, x0 = 0, y0 = 0, dragging = false;
var captureSources = [], captureSourceType = 'screen', captureSelection = null, capturePickerResolve = null, pendingCaptureSource = null, activeCaptureSource = null;
var interactionEnabled = false;
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
function renderTransactionPreview() {
  var preview = $('transaction-preview');
  var transactions = transactionLines($('ocrtext').value.split('\n'));
  preview.replaceChildren();
  transactions.forEach(function (transaction) {
    var line = document.createElement('div');
    line.className = 'transaction-line ' + transaction.type;
    var kind = document.createElement('strong');
    kind.textContent = transaction.type === 'sale' ? 'SOLD' : 'BOUGHT';
    var text = document.createElement('span');
    text.textContent = transaction.item + (transaction.quantity ? ' x' + transaction.quantity : '');
    var amount = document.createElement('b');
    amount.textContent = (transaction.type === 'sale' ? '+' : '-') + ' ' + F(transaction.amount) + ' kamas';
    line.append(kind, text, amount);
    preview.appendChild(line);
  });
  if (!transactions.length && $('ocrtext').value.trim()) {
    var empty = document.createElement('p');
    empty.className = 'mu';
    empty.textContent = 'No sale or purchase lines recognized.';
    preview.appendChild(empty);
  }
}
$('ocrtext').addEventListener('input', renderTransactionPreview);
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
  region = {
    x: Math.max(0, Math.min(x, x0)),
    y: Math.max(0, Math.min(y, y0)),
    w: Math.min(1, Math.abs(x - x0)),
    h: Math.min(1, Math.abs(y - y0))
  };
  var g = $('rg');
  g.style.display = 'block';
  g.style.left = region.x * 100 + '%';
  g.style.top = region.y * 100 + '%';
  g.style.width = region.w * 100 + '%';
  g.style.height = region.h * 100 + '%';
});
$('ov').addEventListener('mouseup', function () {
  dragging = false;
  this.style.pointerEvents = 'none';
  $('rgbtn').textContent = 'Set region';
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
  dbAdd(rec).then(function (id) {
    Q.push({ id, url });
    renderQ();
    if ($('t-db').classList.contains('on')) showDatabaseView(databaseView);
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
    await loadTess();
    var w = await Tesseract.createWorker('fra');
    try { await w.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
    var caps = [];
    for (var i = 0; i < Q.length; i++) {
      $('ocrst').textContent = 'Reading ' + (i + 1) + ' / ' + Q.length;
      var r = await w.recognize(await prep(Q[i].url));
      caps.push(ocrToLines(r.data.text));
      if (Q[i].id != null) await dbUpdate(Q[i].id, { text: r.data.text });
    }
    await w.terminate();
    var s = stitch(caps), transactions = transactionLines(s.lines);
    $('ocrtext').value = transactions.map(function (transaction) { return transaction.line; }).join('\n');
    renderTransactionPreview();
    await saveLedgerTransactions(transactions, Q.map(function (capture) { return capture.id; }).filter(function (id) { return id != null; }));
    $('ocrwarn').innerHTML = s.warns.map(function (x) { return '<div>' + x + '</div>'; }).join('');
    if ($('t-db').classList.contains('on')) renderDB();
    $('ocrst').textContent = transactions.length
      ? 'Found ' + transactions.length + ' sale/purchase line(s) from ' + Q.length + ' captures. Sales are green; purchases are red.'
      : 'No sale or purchase lines recognized in ' + Q.length + ' capture(s).';
  } catch (e) { $('ocrst').textContent = 'Error: ' + e.message; }
}
function toLog() { $('log').value = $('ocrtext').value; show('log'); runLog(); }

var DB = null;
var ledgerHistory = [];
var databaseView = 'captures';
function dbOpen() {
  return new Promise(function (res) {
    try {
      var r = indexedDB.open('kama-ledger', 2);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('shots')) d.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
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
function renderLedgerHistory() {
  var rows = $('ledger-table').tBodies[0];
  if (!rows) return;
  var sorted = ledgerHistory.slice().sort(function (a, b) { return b.recordedAt - a.recordedAt; });
  rows.replaceChildren();
  var totals = sorted.reduce(function (result, entry) {
    result[entry.type] += Number(entry.amount) || 0;
    return result;
  }, { sale: 0, purchase: 0 });
  $('ledger-summary').textContent = 'Sales: +' + F(totals.sale) + ' kamas  |  Purchases: -' + F(totals.purchase) + ' kamas';
  $('ledger-empty').hidden = sorted.length > 0;
  sorted.forEach(function (entry) {
    var row = document.createElement('tr');
    row.className = entry.type === 'sale' ? 'ledger-sale' : 'ledger-purchase';
    var cells = [entry.time || fmtT(entry.recordedAt), entry.type === 'sale' ? 'Sold' : 'Bought', entry.item, entry.quantity || '-', (entry.type === 'sale' ? '+' : '-') + ' ' + F(entry.amount) + ' kamas', entry.sourceCaptureIds && entry.sourceCaptureIds.length ? entry.sourceCaptureIds.join(', ') : 'Manual OCR'];
    cells.forEach(function (value) {
      var cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    rows.appendChild(row);
  });
}
async function loadLedgerHistory() {
  ledgerHistory = await metaGet('ledger-history') || [];
  renderLedgerHistory();
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
  if (!confirm('Remove the saved game data from this browser?')) return;
  await metaDel('index'); P = null; CRAFT = null; setStat('No data loaded.'); $('dres').innerHTML = ''; craftRender(); if ($('log').value) runLog();
}
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

dbOpen().then(function () { renderDB(); return loadLedgerHistory(); }).then(function () { return metaGet('index'); }).then(function (x) { if (x) setIdx(x); });
addRow(); addRow(); calcTax();
var st = 'log';
try { st = localStorage.tab || 'log'; } catch (e) {}
show(st);

window.$ = $;
window.show = show;
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
