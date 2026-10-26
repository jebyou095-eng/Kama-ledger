// The guided test session: a list of things to do in the game, ticked off by the app itself as it sees them happen.
// Pure logic (no DOM). main.js sends events: { type: 'share' }, { type: 'scan', ms, market: { rows, cached } | null, popup: { id, lots } | null, chat: bool },
// { type: 'diag', ms }. The session reacts only to the current step, in order.
export const STEPS = [
  { key: 'share', title: 'Start sharing the game window', hint: 'Press Share and pick the Dofus window.', target: 45 },
  { key: 'first', title: 'First scan with the market list open', hint: 'Open a resource category in the market, then press Scan.', target: 60 },
  { key: 'same', title: 'Scan the same screen again', hint: 'Do not touch the game. Press Scan again.', target: 30 },
  { key: 'scroll', title: 'Scroll the list a few rows, then scan', hint: 'Scroll the market list by 3 or 4 rows and press Scan.', target: 45 },
  { key: 'popup1', title: 'Open an item popup and scan', hint: 'Click one item so its popup (lots) opens, then press Scan.', target: 60 },
  { key: 'popup2', title: 'Open a different item and scan', hint: 'Click another item, then press Scan.', target: 45 },
  { key: 'closed', title: 'Close the popup and scan', hint: 'Close the popup window in the game, then press Scan.', target: 30 },
  { key: 'chat', title: 'Scan with the chat visible', hint: 'Keep the chat on screen with a few lines, then press Scan.', target: 45 },
  { key: 'five', title: 'Five scans in a row', hint: 'Press Scan 5 times without changing the screen.', target: 90 },
  { key: 'diag', title: 'Diagnostics file', hint: 'The app makes the file by itself. Send it to Claude.', target: 60 },
];

export function newSession(now) { return { start: now, stepAt: now, step: 0, done: [], run: [], end: 0 }; }

const finish = (s, now, note, data) => {
  s.done.push({ key: STEPS[s.step].key, took: (now - s.stepAt) / 1000, note: note || '', ...(data || {}) });
  s.step += 1; s.stepAt = now; s.run = [];
  if (s.step >= STEPS.length) s.end = now;
};

// Returns the same session object, updated.
export function onEvent(s, ev, now) {
  if (!s || s.step >= STEPS.length || !ev) return s;
  const key = STEPS[s.step].key, sec = (v) => (v / 1000).toFixed(1) + ' s';
  const rows = ev.market ? ev.market.rows : 0, cached = ev.market ? ev.market.cached || 0 : 0;
  if (key === 'share' && ev.type === 'share') finish(s, now, 'sharing on');
  else if (ev.type === 'scan') {
    if (key === 'first' && rows >= 3) finish(s, now, rows + ' rows in ' + sec(ev.ms), { scanMs: ev.ms });
    else if (key === 'same' && rows >= 3 && cached === rows) finish(s, now, 'all ' + rows + ' rows reused, ' + sec(ev.ms), { scanMs: ev.ms });
    else if (key === 'same' && rows >= 3) s.hint = 'Some rows were read again (' + (rows - cached) + ' of ' + rows + '). Press Scan once more without touching the game.';
    else if (key === 'scroll' && rows >= 3 && cached > 0 && cached < rows) finish(s, now, (rows - cached) + ' new row(s) read, ' + sec(ev.ms), { scanMs: ev.ms });
    else if (key === 'popup1' && ev.popup && ev.popup.lots >= 1) { s.popupId = ev.popup.id; finish(s, now, ev.popup.id + ': ' + ev.popup.lots + ' lot(s), ' + sec(ev.ms), { scanMs: ev.ms, lots: ev.popup.lots }); }
    else if (key === 'popup2' && ev.popup && ev.popup.lots >= 1 && ev.popup.id !== s.popupId) finish(s, now, ev.popup.id + ': ' + ev.popup.lots + ' lot(s), ' + sec(ev.ms), { scanMs: ev.ms, lots: ev.popup.lots });
    else if (key === 'closed' && rows >= 3 && !ev.popup) finish(s, now, 'market read, no popup, ' + sec(ev.ms), { scanMs: ev.ms });
    else if (key === 'chat' && ev.chat) finish(s, now, 'chat read, ' + sec(ev.ms), { scanMs: ev.ms });
    else if (key === 'five') {
      s.run.push(ev.ms);
      if (s.run.length >= 5) { const r = s.run.slice(); finish(s, now, r.map((m) => (m / 1000).toFixed(1)).join(' / ') + ' s', { scanMs: r[r.length - 1], runMs: r }); }
    }
  } else if (key === 'diag' && ev.type === 'diag') finish(s, now, 'file saved in ' + sec(ev.ms));
  return s;
}

export function report(s, now, appVersion) {
  const total = ((s.end || now) - s.start) / 1000, f = (v) => (v == null ? '-' : v.toFixed(1) + ' s');
  const lines = ['Kama test session (' + (appVersion || '?') + '), total ' + f(total), ''];
  STEPS.forEach((st, i) => {
    const d = s.done[i];
    lines.push((i + 1) + '. ' + st.title + ' | ' + (d ? 'done in ' + f(d.took) + (d.note ? ' | ' + d.note : '') : i === s.step ? 'waiting' : 'not reached'));
  });
  return lines.join('\n');
}
