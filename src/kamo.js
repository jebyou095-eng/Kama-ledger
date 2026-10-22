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

// ---- Voices: every line Kamo says has three versions. {x} marks a value filled in at runtime. ----
const VOICES = ['merchant', 'sassy', 'sage'];
const V = {
  share: ['Share your game window and I will read the market for you!', 'Still no game window. I cannot read what I cannot see, you know.', 'Share the game window. Then I can work.'],
  addFirst: ['Nothing tracked yet! Type an item name and I will fetch its recipe too.', 'An empty list. Bold. Type an item name and I will do the rest.', 'The list is empty. Add one item to begin.'],
  scanning: ['Reading the market… hold on, I am matching every name to the game data!', 'Squinting at the market… no, do not touch anything.', 'Reading. One moment.'],
  pendingClean: ['{n} prices waiting, and all of them look clean!', '{n} prices waiting. Clean, for once.', '{n} prices wait for you. All clean.'],
  pendingMixed: ['{n} prices waiting: {c} look clean, {m} need{s} a look.', '{n} prices waiting. {c} are fine, {m} need{s} your human eyes.', '{n} prices wait. {c} clean, {m} to check.'],
  acceptedN: ['{n} price{p} saved. Lovely!', '{n} price{p} saved. You are welcome.', '{n} price{p} saved.'],
  best: ['Best craft right now: {name}, +{profit} kamas. Go go go!', '{name}. +{profit} kamas. Try not to overthink it.', 'Best craft: {name}, +{profit} kamas.'],
  stale: ['{n} prices are old or missing. A quick scan of the ingredient market fixes that!', '{n} stale prices. Shall we pretend that is fine, or scan?', '{n} prices have aged. A scan would renew them.'],
  live: ['Live scan is on. I am watching for new prices!', 'Live scan is on. I am watching. Always watching.', 'Live scan is on.'],
  ok: ['All up to date. Press the hotkey in the game whenever you want a fresh scan!', 'Everything is up to date. Suspiciously so.', 'All is current. Scan when the market moves.'],
  suggestAuto: ['You accept the clean batches every single time. Want me to do that part automatically?', 'You always accept the clean ones. Shall I just do it for you?', 'You always accept clean batches. Automate it?'],
  suggestIgnore: ['You refused {name} {n} times. Want me to stop asking about it?', '{name} again? Refused {n} times. Ignore it for good?', 'You refused {name} {n} times. Ignore it?'],
  scanDue: ['This is about when you usually scan. Ready when you are!', 'It is your usual scan hour. I did not forget. Did you?', 'Your usual scanning hour. The market has moved.'],
  hi: ['Hello, trader! Ask me about your prices.', 'Oh, hello. Ask me something useful.', 'Welcome. Ask.'],
  thanks: ['Any time! That is what a gold coin is for.', 'Do not mention it. Actually, do. Keep tipping.', 'Gladly.'],
  help: ['I can tell you your best crafts, the price or recipe of any tracked item, what is out of date, your budget and what is waiting. Try: "what should I craft?"', 'Ask me: "best crafts", "price of Bonnet Vicieux", "recipe of Coiffe d\'Oshimo", "what is old", "budget". I will manage.', 'Ask about: best crafts, an item price or recipe, old prices, budget, waiting prices.'],
  noCraft: ['No profitable craft yet. Give your ingredients a price and I will find one!', 'Nothing worth crafting yet. Ingredients need prices first, genius.', 'No craft pays yet. Price the ingredients first.'],
  bestList: ['Top crafts right now:', 'Fine. Here are the winners:', 'Best crafts:'],
  oldList: ['{n} prices are old. The oldest:', '{n} are stale. Worst offenders:', '{n} old prices. Oldest:'],
  allFresh: ['Every price is fresh!', 'Nothing is old. Impressive.', 'No old prices.'],
  budget: ['Your budget is {v} kamas.', 'You have {v} kamas. Spend wisely, or do not.', 'Budget: {v} kamas.'],
  noBudget: ['I have not seen your budget yet. Scan the screen when it is visible.', 'No budget scanned yet. I am not psychic.', 'No budget scanned yet.'],
  unknown: ['Hmm, I did not get that. Try "best crafts", "price of …" or "what is old".', 'No idea what you mean. Try "best crafts" or "price of …".', 'I do not understand. Try "help".'],
  noItem: ['I cannot find "{q}" in your list. Add it first!', '"{q}" is not on your list. Add it.', '"{q}" is not tracked.'],
  voiceSet: ['Cheerful merchant mode: on!', 'Sassy mode on. Do not say I did not warn you.', 'Calm trader mode. Breathe.'],
};
const fillTpl = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v && v[k] !== undefined ? v[k] : ''));
const nrm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function initKamo(o) {
  const $ = (id) => document.getElementById(id);
  const root = document.createElement('div');
  root.id = 'kamo'; root.className = 'kamo'; root.dataset.mood = 'idle';
  root.innerHTML = '<div class="kamo-bubble" role="status" aria-live="polite"><button class="kb-x" type="button" aria-label="Hide Kamo" title="Hide Kamo">×</button><div class="kb-text"></div><div class="kb-actions"></div>'
    + '<form class="kb-ask"><input class="kb-q" type="text" placeholder="Ask Kamo…" autocomplete="off" aria-label="Ask Kamo"><button class="kb-go" type="submit" aria-label="Send">Ask</button></form></div>'
    + '<button class="kamo-btn" type="button" aria-label="Kamo, your market helper. Click for a tip.">' + SVG + '</button>';
  document.body.appendChild(root);
  const back = document.createElement('button');
  back.id = 'kamo-back'; back.type = 'button'; back.hidden = true; back.title = 'Bring Kamo back'; back.textContent = 'K';
  document.body.appendChild(back);
  const text = root.querySelector('.kb-text'), actions = root.querySelector('.kb-actions'), qIn = root.querySelector('.kb-q');
  const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage unavailable */ } return null; };
  const readJson = (k, d) => { try { return JSON.parse(store(k) || '') || d; } catch { return d; } };

  let voice = VOICES.includes(store('kl-kamo-voice')) ? store('kl-kamo-voice') : 'merchant';
  const vi = () => VOICES.indexOf(voice);
  const T = (key, vars) => fillTpl(V[key][vi()], vars);
  const sel = $('kamo-voice'); if (sel) { sel.value = voice; }

  // ---- memory: small counters kept on this computer, nothing else ----
  const mem = Object.assign({ scans: [], manualAll: 0, refusals: {}, dismissed: {} }, readJson('kl-kamo-mem', {}));
  const saveMem = () => store('kl-kamo-mem', JSON.stringify(mem));
  const dismissed = (k) => mem.dismissed[k] && Date.now() - mem.dismissed[k] < 86400000;
  const dismiss = (k) => { mem.dismissed[k] = Date.now(); saveMem(); shownKey = ''; };
  window.addEventListener('kl-accepted', (e) => { const d = e.detail || {}; if (d.allClean && d.n >= 3) { mem.manualAll += 1; saveMem(); } });
  window.addEventListener('kl-refused', (e) => { (e.detail || []).forEach((id) => { mem.refusals[id] = (mem.refusals[id] || 0) + 1; }); saveMem(); });

  let hidden = store('kl-kamo-off') === '1', override = null, shownKey = '', typer = 0, lastActive = Date.now(), tipI = 0, nextIdle = Date.now() + 15000, wasScanning = false;
  const seenTabs = readJson('kl-kamo-tabs', {});
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

  // ---- learned suggestions: always a question, never an action taken on his own ----
  function suggestion() {
    if (mem.manualAll >= 3 && !o.items.isAutoAccept() && !dismissed('auto')) {
      return { msg: T('suggestAuto'), m: 'think', acts: [{ label: 'Yes, do it', run: () => { o.items.setAutoAccept(true); mem.manualAll = 0; saveMem(); say('Done. Clean matches are saved automatically from now on. You can switch it off in the approval window.', 'happy', 6000); } }, { label: 'Not now', run: () => dismiss('auto') }] };
    }
    const bad = Object.keys(mem.refusals).find((id) => mem.refusals[id] >= 3 && !dismissed('ign' + id) && o.items.nameOf(Number(id)));
    if (bad) {
      const name = o.items.nameOf(Number(bad));
      return { msg: T('suggestIgnore', { name, n: mem.refusals[bad] }), m: 'think', acts: [{ label: 'Ignore it', run: () => { o.items.ignore(Number(bad)); delete mem.refusals[bad]; saveMem(); say(name + ' will be ignored in future scans.', 'happy', 5000); } }, { label: 'Keep it', run: () => { mem.refusals[bad] = 0; saveMem(); dismiss('ign' + bad); } }] };
    }
    if (mem.scans.length >= 4 && !dismissed('due')) {
      const hrs = mem.scans.map((t) => new Date(t).getHours()).sort((a, b) => a - b), med = hrs[Math.floor(hrs.length / 2)], h = new Date().getHours();
      if (Date.now() - mem.scans[mem.scans.length - 1] > 20 * 3600000 && Math.abs(h - med) <= 2) return { msg: T('scanDue'), m: 'happy', acts: [{ label: 'Scan now', run: o.actions.scan }, { label: 'Later', run: () => dismiss('due') }] };
    }
    return null;
  }

  function decide() {
    const st = o.getState(), sm = o.items.summary();
    if (st.scanning) return { msg: T('scanning'), m: 'scan', acts: [] };
    if (sm.pending > 0) {
      const acts = [];
      if (sm.clean > 0) acts.push({ label: 'Accept the ' + sm.clean + ' clean', run: async () => { const n = await o.items.acceptClean(); if (n) say(T('acceptedN', { n, p: n > 1 ? 's' : '' }), 'happy', 4500); } });
      acts.push({ label: 'Let me look', run: o.actions.show });
      const miss = sm.pending - sm.clean;
      return { msg: sm.clean === sm.pending ? T('pendingClean', { n: sm.pending }) : T('pendingMixed', { n: sm.pending, c: sm.clean, m: miss, s: miss === 1 ? 's' : '' }), m: sm.clean === sm.pending ? 'happy' : 'think', acts };
    }
    const sg = suggestion(); if (sg) return sg;
    if (!st.stream) return { msg: T('share'), m: 'idle', acts: [{ label: 'Share the game', run: o.actions.share }] };
    if (!sm.tracked) return { msg: T('addFirst'), m: 'idle', acts: [{ label: 'Add an item', run: o.actions.add }] };
    if (sm.stale >= 10) return { msg: T('stale', { n: sm.stale }), m: 'sad', acts: [{ label: 'Scan now', run: o.actions.scan }] };
    if (sm.best) return { msg: T('best', { name: sm.best.name, profit: sm.best.profit }), m: 'happy', acts: [{ label: 'Show recipe', run: () => o.actions.best(sm.best.id) }] };
    return { msg: st.live ? T('live') : T('ok'), m: 'idle', acts: [] };
  }

  // ---- Ask Kamo: keyword understanding over the user's own data (not a language model) ----
  const F = (v) => (isFinite(v) ? Math.round(v).toLocaleString('fr-FR') : '-');
  const chip = (label, q) => ({ label, run: () => ask(q) });
  function answer(raw) {
    const q = nrm(raw).trim(); if (!q) return null;
    const cm = [chip('Best crafts', 'best crafts'), chip('What is old?', 'what is old'), chip('Budget', 'budget')];
    if (/\b(hi|hello|hey|salut|bonjour|salam)\b/.test(q)) return { msg: T('hi'), m: 'happy', acts: cm };
    if (/(thank|merci|shukran)/.test(q)) return { msg: T('thanks'), m: 'happy', acts: [] };
    if (/(^|\b)(help|aide|what can you|que sais)/.test(q)) return { msg: T('help'), m: 'think', acts: cm };
    const named = q.match(/(?:price|prix|cost|how much(?: is| for)?|worth|recipe|recette|ingredients?|ingredient|combien)\s+(?:of|for|de|du|d'|la|le|les)?\s*(.+)$/);
    const wantsRecipe = /(recipe|recette|ingredient)/.test(q);
    if (named && named[1] && !/^(craft|crafts|profit)$/.test(named[1].trim())) {
      const info = o.items.lookup(named[1].replace(/[?!.]+$/, ''));
      if (!info) return { msg: T('noItem', { q: named[1].trim() }), m: 'sad', acts: [] };
      return { msg: describe(info, wantsRecipe), m: info.profit > 0 ? 'happy' : 'think', acts: info.kind === 'item' ? [{ label: 'Open graph', run: () => o.actions.best(info.id) }] : [] };
    }
    if (/(best|craft|profit|rentable|should i|what to make|meilleur)/.test(q)) {
      const top = o.items.topCrafts(3);
      if (!top.length) return { msg: T('noCraft'), m: 'sad', acts: [] };
      return { msg: T('bestList') + '\n' + top.map((t, i) => (i + 1) + '. ' + t.name + '  +' + F(t.profit) + (t.cost ? '  (costs ' + F(t.cost) + ')' : '')).join('\n'), m: 'happy', acts: [{ label: 'Open the best', run: () => o.actions.best(top[0].id) }] };
    }
    if (/(old|stale|refresh|outdated|missing|vieux|ancien)/.test(q)) {
      const r = o.items.oldestPrices(5);
      if (!r.total) return { msg: T('allFresh'), m: 'happy', acts: [] };
      return { msg: T('oldList', { n: r.total }) + '\n' + r.list.map((x) => '• ' + x.name + (x.days === null ? ' (no price)' : ' (' + x.days + ' d)')).join('\n'), m: 'sad', acts: [{ label: 'Scan now', run: o.actions.scan }] };
    }
    if (/(budget|kamas|argent|how much do i have)/.test(q)) { const b = o.items.budgetValue(); return b === null ? { msg: T('noBudget'), m: 'sad', acts: [] } : { msg: T('budget', { v: F(b) }), m: 'happy', acts: [] }; }
    if (/(waiting|pending|approve|attente)/.test(q)) { const sm = o.items.summary(); return { msg: sm.pending ? sm.pending + ' price' + (sm.pending > 1 ? 's' : '') + ' waiting, ' + sm.clean + ' clean.' : 'Nothing is waiting.', m: 'think', acts: sm.pending ? [{ label: 'Let me look', run: o.actions.show }] : [] }; }
    const info = o.items.lookup(raw);
    if (info) return { msg: describe(info, false), m: 'think', acts: info.kind === 'item' ? [{ label: 'Open graph', run: () => o.actions.best(info.id) }] : [] };
    return { msg: T('unknown'), m: 'sad', acts: cm };
  }
  function describe(i, withRecipe) {
    let s = i.name + ': ' + (i.price ? F(i.price) + ' kamas' : 'no price yet') + (i.days !== null ? ' (' + (i.days === 0 ? 'today' : i.days + ' d old') + ')' : '') + '.';
    if (i.kind === 'item' && i.cost !== null) s += '\nCraft cost ' + F(i.cost) + (i.profit !== null ? ', profit ' + (i.profit > 0 ? '+' : '') + F(i.profit) : '') + '.';
    if (withRecipe && i.recipe.length) s += '\n' + i.recipe.map((g) => '• ' + g.qty + ' × ' + g.name + (g.price ? ' (' + F(g.price) + ')' : ' (no price)')).join('\n');
    return s;
  }
  function ask(raw) { const a = answer(raw); if (a) say(a.msg, a.m, 22000, a.acts); }
  root.querySelector('.kb-ask').addEventListener('submit', (e) => { e.preventDefault(); const v = qIn.value; qIn.value = ''; ask(v); });

  function tick() {
    if (hidden) return;
    const now = Date.now(), st = o.getState();
    if (wasScanning && !st.scanning) { mem.scans.push(now); mem.scans = mem.scans.slice(-20); saveMem(); }
    wasScanning = st.scanning;
    if (override && now > override.until) override = null;
    if (override && st.scanning) override = null;   // an ongoing scan always wins over tips
    if (document.activeElement === qIn && override) override.until = Math.max(override.until, now + 4000);
    const d = override ? { msg: override.msg, m: override.m, acts: override.acts } : decide();
    const asleep = !override && d.m === 'idle' && now - lastActive > 150000 && document.activeElement !== qIn;
    if (asleep) { mood('sleep'); } else {
      render(d.msg, d.m, d.acts);
      if (!override && d.m === 'idle' && now > nextIdle) {
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
  if (sel) sel.addEventListener('change', () => { voice = VOICES.includes(sel.value) ? sel.value : 'merchant'; store('kl-kamo-voice', voice); shownKey = ''; if (hidden) setHidden(false); say(T('voiceSet'), 'happy', 3500); });
  window.addEventListener('kl-toast', (e) => {
    const m = String(e.detail || ''); if (!m) return;
    const bad = /refused|could not|failed|not in the game|no game panel|nothing was changed|still need/i.test(m);
    say(m, bad ? 'sad' : 'happy', 4200);
  });
  setInterval(tick, 700); tick();
  return {
    say, ask,
    onTab(k) { if (seenTabs[k] || !TAB_TIPS[k]) return; seenTabs[k] = 1; store('kl-kamo-tabs', JSON.stringify(seenTabs)); setTimeout(() => say(TAB_TIPS[k], 'think', 9000), 400); },
  };
}
