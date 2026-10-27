// Performance evaluator: separate from the app, runs only when you press the button.
// It samples the app for a few seconds in three conditions (normal, Kamo hidden, animations paused),
// then says which part costs the most. Nothing is sent anywhere; the result stays on screen (and an optional file).

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// frames: array of frame durations (ms); lags: setInterval overshoot (ms); longTasks: durations (ms); secs: sample length
export function summarize(frames, lags, longTasks, secs) {
  const fps = frames.length / Math.max(0.1, secs);
  return {
    fps: Math.round(fps * 10) / 10,
    p95Frame: Math.round(pct(frames, 0.95)),
    worstFrame: Math.round(Math.max(0, ...frames)),
    slowFrames: frames.filter((f) => f > 50).length,
    p95Lag: Math.round(pct(lags, 0.95)),
    longTasks: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((s, x) => s + x, 0)),
  };
}

export function grade(s) {
  if (s.fps >= 50 && s.p95Frame <= 24 && s.longTasks <= secsLimit(s)) return 'smooth';
  if (s.fps >= 30 && s.p95Frame <= 50) return 'ok';
  return 'laggy';
}
const secsLimit = () => 3;

// runs = { normal, noKamo, paused } summaries (+ info). Returns { verdict, findings[], tips[] }.
export function analyze(runs, info) {
  const f = [], tips = [], n = runs.normal, k = runs.noKamo, p = runs.paused, i = info || {};
  const verdict = grade(n);
  if (verdict === 'smooth') f.push('The app is running smoothly (' + n.fps + ' fps).');
  else f.push('Average ' + n.fps + ' fps, slowest 5% of frames took ' + n.p95Frame + ' ms' + (n.longTasks ? ', ' + n.longTasks + ' freezes totalling ' + n.longTaskMs + ' ms' : '') + '.');
  if (k && verdict !== 'smooth' && k.fps - n.fps >= 8) { f.push('Kamo himself costs about ' + Math.round(k.fps - n.fps) + ' fps (hidden: ' + k.fps + ').'); tips.push('Untick Kamo\'s walking in the Kamo menu, or set Sound to Off, or hide him while you work.'); }
  if (p && verdict !== 'smooth' && p.fps - n.fps >= 8) { f.push('Page animations cost about ' + Math.round(p.fps - n.fps) + ' fps (paused: ' + p.fps + ').'); tips.push('Turn on "Reduce motion" in Windows (Settings → Accessibility → Visual effects); the app follows it.'); }
  if (n.p95Lag >= 40 && n.longTasks) { f.push('The main thread is blocked in bursts (p95 delay ' + n.p95Lag + ' ms): something heavy runs on it.'); tips.push('A scan, the voice engine or a big list is probably running. Try again with scanning stopped.'); }
  if (i.heapMB && i.heapMB > 400) { f.push('Memory use is high (' + i.heapMB + ' MB).'); tips.push('Restart the app; if it comes back fast, a leak exists. Send me this report.'); }
  if (i.storageKB && i.storageKB > 3000) { f.push('Saved data is large (' + i.storageKB + ' KB in local storage).'); tips.push('Old notebook or history entries may be slowing saves. Export a backup, then trim.'); }
  if (i.voice === 'loading') f.push('The voice engine was still loading during the test (this is normal for the first minute).');
  if (i.scanning) f.push('Scanning was on during the test, so part of the load is the scan itself.');
  if (!tips.length && verdict !== 'smooth') tips.push('No single culprit found. Send me the saved report file and I will dig further.');
  return { verdict, findings: f, tips };
}

function sample(ms) {
  return new Promise((resolve) => {
    const frames = [], lags = [], longs = []; let last = performance.now(), stop = false, po = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }); po.observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
    let t0 = performance.now(), expect = t0 + 100;
    const iv = setInterval(() => { const now = performance.now(); lags.push(Math.max(0, now - expect)); expect = now + 100; }, 100);
    const tick = (now) => {
      if (stop) return;
      frames.push(now - last); last = now;
      if (now - t0 >= ms) { stop = true; clearInterval(iv); if (po) po.disconnect(); resolve(summarize(frames.slice(1), lags, longs, (now - t0) / 1000)); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// opts: { seconds, status(text), kamoEl, info() }
export async function runPerf(opts) {
  const o = opts || {}, secs = (o.seconds || 4) * 1000, say = o.status || (() => {});
  const runs = {};
  say('1/3 measuring normally…'); runs.normal = await sample(secs);
  const el = o.kamoEl, was = el ? el.hidden : false;
  if (el) { say('2/3 measuring with Kamo hidden…'); el.hidden = true; runs.noKamo = await sample(secs); el.hidden = was; }
  say('3/3 measuring with animations paused…');
  const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
  document.head.appendChild(st); runs.paused = await sample(secs); st.remove();
  const info = o.info ? o.info() : {};
  try { if (performance.memory) info.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch { /* n/a */ }
  try { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } info.storageKB = Math.round(n / 1024); } catch { /* n/a */ }
  return { runs, info, result: analyze(runs, info), at: new Date().toISOString() };
}

// ---- automatic guard: watches for sustained freezes and calms the decorative animations by itself ----
// Pure decision step (tested): ratio = share of the window the page was blocked by long tasks.
export function guardStep(st, blockedMs, windowMs) {
  const bad = blockedMs / Math.max(1, windowMs) > 0.15;
  const n = { bad: bad ? st.bad + 1 : 0, good: bad ? 0 : st.good + 1, calm: st.calm };
  if (!n.calm && n.bad >= 2) n.calm = true;          // two bad windows in a row: calm down
  else if (n.calm && n.good >= 6) n.calm = false;    // a calm minute: bring the animations back
  return n;
}

export function startGuard(onChange, windowMs) {
  const win = windowMs || 10000; let st = { bad: 0, good: 0, calm: false }, blocked = 0, po = null;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) blocked += e.duration; }); po.observe({ entryTypes: ['longtask'] }); } catch { return { stop() {}, get calm() { return false; } }; }
  const iv = setInterval(() => {
    if (document.hidden) { blocked = 0; return; }
    const was = st.calm; st = guardStep(st, blocked, win); blocked = 0;
    if (st.calm !== was) { try { onChange(st.calm); } catch { /* ui gone */ } }
  }, win);
  return { stop() { clearInterval(iv); if (po) po.disconnect(); }, get calm() { return st.calm; } };
}
