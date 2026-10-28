// Kamo checks himself and says, in plain words, what is missing and what Claude needs to know. Pure: the app passes in the facts.
// state: { desktop, providers: [{ id, label }], keys: { id: bool }, test: { ok, why, provider } | null, errors: n, scan: { popupAvg, popupLots } | null, perf: verdict | null }
export function diagnose(s) {
  const out = [], any = (s.providers || []).filter((p) => s.keys && s.keys[p.id]);
  if (!s.desktop) out.push({ id: 'browser', level: 'warn', say: 'I am in the browser, so I cannot reach the cloud or the game. Open the desktop app.', tell: 'running in browser, not desktop' });
  if (s.desktop && !any.length) out.push({ id: 'nokey', level: 'need', say: 'I have no cloud key yet, so I can only answer from my own notes. Paste a free Groq or Gemini key in my menu.', tell: 'no cloud key set' });
  if (s.desktop && any.length && !s.test) out.push({ id: 'untested', level: 'need', say: 'A key is saved but never tested. Press Test in my menu.', tell: 'key saved, Test never run' });
  if (s.test && !s.test.ok) out.push({ id: 'testfail', level: 'need', say: 'My last Test failed: ' + String(s.test.why || '').slice(0, 140), tell: 'Test failed (' + (s.test.provider || '?') + '): ' + String(s.test.why || '').slice(0, 200) });
  if (s.errors > 0) out.push({ id: 'errors', level: 'warn', say: s.errors + ' error' + (s.errors > 1 ? 's' : '') + ' happened in the app since it opened.', tell: s.errors + ' app errors recorded' });
  if (s.scan && s.scan.popupAvg === null) out.push({ id: 'noavg', level: 'warn', say: 'My last popup scan found no average price, so lot prices may be unchecked.', tell: 'popup scan without average price' });
  if (s.scan && s.scan.popupLots === 0) out.push({ id: 'nolots', level: 'warn', say: 'My last popup scan found no lot prices.', tell: 'popup scan without lots' });
  if (s.perf === 'laggy') out.push({ id: 'laggy', level: 'warn', say: 'The performance check said the app is laggy.', tell: 'performance verdict laggy' });
  return out;
}

// The bubble text: at most three items, then the one sentence to say to Claude.
export function speak(list) {
  if (!list.length) return { ok: true, text: 'All good on my side! Nothing for Claude to check.' };
  const top = list.sort((a, b) => (a.level === 'need' ? 0 : 1) - (b.level === 'need' ? 0 : 1)).slice(0, 3);
  return { ok: false, text: top.map((x) => '• ' + x.say).join('\n') + '\nThen open Claude and say: "read Kamo\'s status".', tell: top.map((x) => x.tell).join('; ') };
}
