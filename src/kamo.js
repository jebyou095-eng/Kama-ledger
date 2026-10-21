// Kamo: the market helper. A small animated coin character that shows what the app is doing and offers the next useful action.
// He only reads app state and calls actions the user could click anyway; he never changes anything by himself.
const SVG = `
<svg class="kamo-svg" viewBox="-80 -98 160 200" aria-hidden="true">
  <ellipse class="k-shadow" cx="0" cy="94" rx="44" ry="7"/>
  <g class="k-legs"><path d="M-22 78v14M22 78v14" /></g>
  <g class="k-body">
    <g class="k-arm k-arm-l"><path d="M-52 14q-20 10 -15 32"/></g>
    <g class="k-arm k-arm-r"><path d="M52 14q20 10 15 32"/></g>
    <circle class="k-rim" cx="0" cy="8" r="56"/><circle class="k-face-bg" cx="0" cy="2" r="56"/>
    <circle class="k-ring" cx="0" cy="2" r="46"/>
    <ellipse class="k-shine" cx="-30" cy="-26" rx="13" ry="6" transform="rotate(-35 -30 -26)"/>
    <circle class="k-cheek" cx="-34" cy="16" r="7"/><circle class="k-cheek" cx="34" cy="16" r="7"/>
    <g class="k-face" transform="translate(0 4)">
      <g class="k-eyes k-open"><circle class="k-white" cx="-14" cy="-6" r="10"/><circle class="k-white" cx="14" cy="-6" r="10"/>
        <g class="k-pupils"><circle class="k-pupil" cx="-14" cy="-5" r="5"/><circle class="k-pupil" cx="14" cy="-5" r="5"/></g>
        <rect class="k-lid" x="-26" y="-18" width="52" height="24" rx="10"/></g>
      <g class="k-eyes k-happy"><path d="M-24 -4q10 -13 20 0M4 -4q10 -13 20 0"/></g>
      <g class="k-eyes k-sad"><circle class="k-pupil" cx="-14" cy="-3" r="5"/><circle class="k-pupil" cx="14" cy="-3" r="5"/><path class="k-brow" d="M-24 -11l14 -6M24 -11l-14 -6"/><path class="k-tear" d="M-20 4q-3 7 0 9q3 -2 0 -9z"/></g>
      <g class="k-eyes k-sleep"><path d="M-24 -4q10 7 20 0M4 -4q10 7 20 0"/></g>
      <path class="k-m k-m-idle" d="M-10 18q10 6 20 0"/>
      <path class="k-m k-m-happy" d="M-16 12q16 26 32 0z"/>
      <ellipse class="k-m k-m-scan" cx="0" cy="20" rx="6" ry="5"/>
      <path class="k-m k-m-sad" d="M-10 25q10 -8 20 0"/>
      <ellipse class="k-m k-m-sleep" cx="0" cy="21" rx="4" ry="3"/>
    </g>
    <g class="k-cap"><path d="M-30 -48q30 -36 60 0q-30 -10 -60 0z"/><circle cx="0" cy="-72" r="7"/></g>
    <g class="k-glass"><circle cx="64" cy="26" r="13"/><path d="M73 36l12 14"/></g>
  </g>
  <g class="k-zzz"><text x="38" y="-62">z</text><text x="54" y="-78">Z</text></g>
  <g class="k-sparks"><path d="M-62 -40l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><path d="M66 -30l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/><path d="M52 -62l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/></g>
</svg>`;

const TAB_TIPS = {
  items: 'This is your market list. Green rows are worth crafting, red ones lose kamas. Click a row to edit it, or a slot to see its recipe graph.',
  cap: 'Scan tab: share the game window once, then press your hotkey in the game. I find the market panels by myself, nothing to draw.',
  log: 'Paste your chat log here and I will add up what you spent.',
  craft: 'Craft calculator: ingredient prices in, profit out.',
  rec: 'Recycling: how many Pépites an item gives and what they sell for.',
  bri: 'Brisage: rune prices and jets, to see if breaking an item pays.',
  tax: 'Sell and tax: the price to list at so you keep what you want after the 2% tax.',
  db: 'History: every scan and price I saved, so you can look back.',
  data: 'Game data: update it here when the game changes. I download the recipes and item pictures.',
};
const TIPS = [
  'Tip: the hotkey works while you are inside the game. Press it when the market list is open.',
  'Tip: ingredient prices matter. A craft only shows up as green once all its ingredients have a price.',
  'Tip: "Accept clean matches" in the approval window saves a click every scan.',
  'Tip: click a slot to open its recipe graph. Click an ingredient there to follow it down.',
  'Tip: grey means cost equals profit. Change how wide grey is in Filters and sorting.',
  'Tip: scan the ingredient market too. Most crafts depend on it.',
];

export function initKamo(o) {
  const $ = (id) => document.getElementById(id);
  const root = document.createElement('div');
  root.id = 'kamo'; root.className = 'kamo'; root.dataset.mood = 'idle';
  root.innerHTML = '<div class="kamo-bubble" role="status" aria-live="polite"><button class="kb-x" type="button" aria-label="Hide Kamo" title="Hide Kamo">×</button><div class="kb-text"></div><div class="kb-actions"></div></div>'
    + '<button class="kamo-btn" type="button" aria-label="Kamo, your market helper. Click for a tip.">' + SVG + '</button>';
  document.body.appendChild(root);
  const back = document.createElement('button');
  back.id = 'kamo-back'; back.type = 'button'; back.hidden = true; back.title = 'Bring Kamo back'; back.textContent = 'K';
  document.body.appendChild(back);
  const text = root.querySelector('.kb-text'), actions = root.querySelector('.kb-actions'), bubble = root.querySelector('.kamo-bubble');
  const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage unavailable */ } return null; };
  let hidden = store('kl-kamo-off') === '1', override = null, shownKey = '', typer = 0, lastActive = Date.now(), tipI = 0, nextIdle = Date.now() + 15000;
  const seenTabs = (() => { try { return JSON.parse(store('kl-kamo-tabs') || '{}'); } catch { return {}; } })();

  function setHidden(v) { hidden = v; store('kl-kamo-off', v ? '1' : '0'); root.hidden = v; back.hidden = !v; }
  setHidden(hidden);
  const mood = (m) => { if (root.dataset.mood !== m) root.dataset.mood = m; };
  function hop() { if (reduce()) return; root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop'); }

  function render(msg, m, acts) {
    const key = msg + '|' + m + '|' + acts.map((a) => a.label).join(',');
    if (key === shownKey) return;
    shownKey = key; mood(m); clearInterval(typer);
    actions.innerHTML = ''; text.textContent = '';
    const addActs = () => acts.forEach((a) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-act'; b.textContent = a.label; b.addEventListener('click', () => { lastActive = Date.now(); a.run(); }); actions.appendChild(b); });
    if (reduce()) { text.textContent = msg; addActs(); return; }
    let i = 0; hop();
    typer = setInterval(() => { i += 2; text.textContent = msg.slice(0, i); if (i >= msg.length) { clearInterval(typer); addActs(); } }, 18);
  }
  function say(msg, m, ms, acts) { override = { msg, m, acts: acts || [], until: Date.now() + (ms || 5000) }; lastActive = Date.now(); tick(); }

  function decide() {
    const st = o.getState(), sm = o.items.summary();
    if (st.scanning) return { msg: 'Reading the market… hold on, I am matching every name to the game data.', m: 'scan', acts: [] };
    if (sm.pending > 0) {
      const acts = [];
      if (sm.clean > 0) acts.push({ label: 'Accept the ' + sm.clean + ' clean', run: async () => { const n = await o.items.acceptClean(); if (n) { say(n + ' price' + (n > 1 ? 's' : '') + ' saved. Nice!', 'happy', 4500); } } });
      acts.push({ label: 'Let me look', run: o.actions.show });
      return { msg: sm.pending + ' price' + (sm.pending > 1 ? 's' : '') + ' waiting for you. ' + (sm.clean === sm.pending ? 'All of them look clean.' : sm.clean + ' look clean, ' + (sm.pending - sm.clean) + (sm.pending - sm.clean === 1 ? ' needs' : ' need') + ' a look.'), m: sm.clean === sm.pending ? 'happy' : 'think', acts };
    }
    if (!st.stream) return { msg: 'Share your game window and I will read the market for you.', m: 'idle', acts: [{ label: 'Share the game', run: o.actions.share }] };
    if (!sm.tracked) return { msg: 'Nothing tracked yet. Type an item name and I will add its recipe too.', m: 'idle', acts: [{ label: 'Add an item', run: o.actions.add }] };
    if (sm.stale >= 10) return { msg: sm.stale + ' prices are old or missing. A quick scan of the ingredient market fixes that.', m: 'sad', acts: [{ label: 'Scan now', run: o.actions.scan }] };
    if (sm.best) return { msg: 'Best craft right now: ' + sm.best.name + ', +' + sm.best.profit + ' kamas.', m: 'happy', acts: [{ label: 'Show recipe', run: () => o.actions.best(sm.best.id) }] };
    return { msg: st.live ? 'Live scan is on. I am watching for new prices.' : 'All up to date. Press the hotkey in the game to scan again.', m: 'idle', acts: [] };
  }

  function tick() {
    if (hidden) return;
    const now = Date.now();
    if (override && now > override.until) override = null;
    if (override && o.getState().scanning) override = null;   // an ongoing scan always wins over tips
    const d = override ? { msg: override.msg, m: override.m, acts: override.acts } : decide();
    const asleep = !override && d.m === 'idle' && now - lastActive > 150000;
    if (asleep) { mood('sleep'); } else {
      render(d.msg, d.m, d.acts);
      if (!override && d.m === 'idle' && now > nextIdle) {            // small signs of life while nothing happens
        nextIdle = now + 14000 + Math.random() * 16000;
        const r = Math.random();
        if (r < 0.4) { root.classList.add('look'); setTimeout(() => root.classList.remove('look'), 2600); }
        else if (r < 0.65) hop();
        else say(TIPS[tipI++ % TIPS.length], 'idle', 7000);
      }
    }
  }
  const wake = () => { lastActive = Date.now(); if (root.dataset.mood === 'sleep') { shownKey = ''; tick(); } };
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));

  root.querySelector('.kamo-btn').addEventListener('click', () => { lastActive = Date.now(); hop(); say(TAB_TIPS[o.getState().tab] || TIPS[tipI++ % TIPS.length], 'think', 9000); });
  root.querySelector('.kb-x').addEventListener('click', () => setHidden(true));
  back.addEventListener('click', () => { setHidden(false); shownKey = ''; lastActive = Date.now(); tick(); });
  window.addEventListener('kl-toast', (e) => {
    const m = String(e.detail || ''); if (!m) return;
    const bad = /refused|could not|failed|not in the game|no game panel|nothing was changed|still need/i.test(m);
    say(m, bad ? 'sad' : 'happy', 4200);
  });
  setInterval(tick, 700); tick();
  return {
    say,
    onTab(k) { if (seenTabs[k] || !TAB_TIPS[k]) return; seenTabs[k] = 1; store('kl-kamo-tabs', JSON.stringify(seenTabs)); setTimeout(() => say(TAB_TIPS[k], 'think', 9000), 400); },
  };
}
