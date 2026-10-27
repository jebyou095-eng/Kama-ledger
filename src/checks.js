// The checks: diagnostics file, performance check and the guided test session. Moved out of main.js.
// They reach the rest of the app through getEnv() (a small object of getters that main.js provides).
import * as scan from './scan.js';
import { parseLots } from './items.js';
import { parseBudget, parsePopup, snapItem } from './market.js';
import { runDiagnostics } from './diag.js';
import { APP_BUILD } from './diag-plan.js';
import { STEPS as SESS_STEPS, newSession, onEvent as sessOn, report as sessReport } from './session.js';

export function createChecks(getEnv) {
  var $ = function (id) { return document.getElementById(id); };
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
    var btn = this, st = $('diag-status'), E = getEnv(), P = E.P, stream = E.stream, stillFrame = E.stillFrame;
    if (!P) { st.textContent = 'Load the game data first (Data tab).'; return; }
    if (!stream && !diagFrames.length && !stillFrame) { st.textContent = 'Share the game window first (Start screen share), or choose screenshot file(s).'; return; }
    if (getEnv().scanning) { st.textContent = 'A scan is running, try again in a few seconds.'; return; }
    btn.disabled = true; getEnv().scanning = true;
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
      if (sess) res.session = sessReport(sess, Date.now(), APP_BUILD);
      if (window.klPopups && window.klPopups.length) res.popups = window.klPopups;
      if (window.klLastScan && window.klLastScan.tooltip) res.tooltip = window.klLastScan.tooltip;
      var text = JSON.stringify(res);
      var name = 'kama-diag-' + res.plan + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
      sessEvent({ type: 'diag', ms: res.totalMs });
      st.textContent = 'Done in ' + (res.totalMs / 1000).toFixed(1) + ' s. File saved: ' + name + ' (' + Math.round(text.length / 1024) + ' KB). Send it to Claude.';
    } catch (e) { st.textContent = 'Diagnostics failed: ' + e.message; }
    getEnv().scanning = false; btn.disabled = false;
  });

  /* ---- performance evaluator: separate module, runs only on the button ---- */
  var perfLast = null;
  $('perf-run').addEventListener('click', async function () {
    var btn = this, st = $('perf-status'), out = $('perf-out'); btn.disabled = true; out.textContent = '';
    try {
      var P = await import('./perf.js');
      perfLast = await P.runPerf({ seconds: 4, status: function (t) { st.textContent = t; }, kamoEl: document.querySelector('.kamo'), info: function () { return { scanning: !!getEnv().scanning }; } });
      var r = perfLast.result, tag = { smooth: 'SMOOTH', ok: 'OK, small hiccups', laggy: 'LAGGY' }[r.verdict];
      out.textContent = 'Verdict: ' + tag + '\n' + r.findings.map(function (x) { return '• ' + x; }).join('\n') + (r.tips.length ? '\n\nWhat to do:\n' + r.tips.map(function (x) { return '→ ' + x; }).join('\n') : '');
      st.textContent = 'Done.'; $('perf-save').hidden = false;
    } catch (e) { st.textContent = 'Check failed: ' + e.message; }
    btn.disabled = false;
  });
  $('perf-save').addEventListener('click', function () {
    if (!perfLast) return;
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(Object.assign({ build: APP_BUILD }, perfLast), null, 1)], { type: 'application/json' }));
    a.download = 'kama-perf-' + perfLast.at.replace(/[:.]/g, '-').slice(0, 19) + '.json'; a.click();
  });

  /* ---- guided test session: the app ticks the steps off by itself while you do them in the game ---- */
  var sess = null, sessEl = null;
  function sessEvent(ev) {
    if (!sess || sess.end) return;
    var before = sess.step; sess.hint = '';
    sessOn(sess, ev, Date.now());
    renderSess();
    if (sess.step !== before && SESS_STEPS[sess.step] && SESS_STEPS[sess.step].key === 'diag') setTimeout(sessAutoDiag, 1500);
  }
  function sessAutoDiag() {
    if (!sess || sess.end || !SESS_STEPS[sess.step] || SESS_STEPS[sess.step].key !== 'diag') return;
    if (getEnv().scanning) { setTimeout(sessAutoDiag, 2000); return; }
    $('diag-run').click();
  }
  function renderSess() {
    if (!sess) { if (sessEl) sessEl.hidden = true; return; }
    if (!sessEl) {
      sessEl = document.createElement('aside'); sessEl.id = 'sess'; sessEl.setAttribute('aria-label', 'Guided test session');
      sessEl.addEventListener('click', function (e) {
        if (e.target.closest('[data-sess-stop]')) { sess = null; renderSess(); }
        else if (e.target.closest('[data-sess-copy]')) { var t = sessReport(sess, Date.now(), APP_BUILD); try { navigator.clipboard.writeText(t); e.target.textContent = 'Copied'; } catch (err) {  } }
      });
      document.body.appendChild(sessEl);
    }
    sessEl.hidden = false;
    var done = sess.done.length, cur = SESS_STEPS[sess.step];
    var rows = SESS_STEPS.map(function (st, i) {
      var d = sess.done[i], state = d ? 'ok' : i === sess.step ? 'now' : 'next';
      return '<li class="' + state + '"><span class="sk">' + (d ? '✓' : i + 1) + '</span><span class="st">' + st.title + (d ? '<small>' + d.took.toFixed(1) + ' s' + (d.note ? ' · ' + d.note : '') + '</small>' : '') + '</span></li>';
    }).join('');
    sessEl.innerHTML = '<div class="sh"><b>Guided test</b><span>' + done + ' / ' + SESS_STEPS.length + '</span></div>' +
      (cur ? '<div class="sn"><b>Now:</b> ' + cur.hint + (sess.hint ? '<br><em>' + sess.hint + '</em>' : '') + '</div>' : '<div class="sn"><b>All done.</b> The diagnostics file was saved: send it to Claude.</div>') +
      '<ol>' + rows + '</ol><div class="sb">' + (sess.end ? '<button type="button" class="btn" data-sess-copy>Copy report</button>' : '') + '<button type="button" class="btn" data-sess-stop>' + (sess.end ? 'Close' : 'Stop') + '</button></div>';
  }
  $('sess-start').addEventListener('click', function () {
    sess = newSession(Date.now()); renderSess();
    if (getEnv().stream) sessEvent({ type: 'share' });
  });
  return { sessEvent: sessEvent };
}
