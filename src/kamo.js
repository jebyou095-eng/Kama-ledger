// Kamo: the market helper. A small gold coin who lives in the app: he walks around, points at things, comments on price moves,
// learns your habits and (when his autonomy is on) acts on his own inside this app.
// Brain (what to say / do): kamo-brain.js. Body (walking, pointing): kamo-motion.js. This file connects them to the page.
// Hard limits: he never clicks or types in the game, and never touches Remove / Refuse / Import (see BLOCK below).
import { createMover } from './kamo-motion.js';
import { analyzeItem, explainCompare, explainTrend, explainWorth, learnQuestion, parseAsk, questionKey, watched } from './kamo-ai.js';
import { createSound, envOf } from './kamo-sound.js';
import { LIES } from './kamo-motion.js';
import { applyAnswers, newQuestion, shouldAsk } from './kamo-friend.js';
import { createNotebook } from './kamo-notebook.js';
import { PROVIDERS, createCascade, pickContext } from './kamo-cloud.js';
import { VOICES, analyzeHabits, analyzeMarket, createVoice, curiousHint, dayKey, fmt, normalizeMem, planNext, recapVars, tabName, tabTip, understand } from './kamo-brain.js';

export const SVG = `
<svg class="kamo-svg" viewBox="-80 -98 160 200" aria-hidden="true">
  <ellipse class="k-shadow" cx="0" cy="94" rx="44" ry="7"/>
  <g class="k-legs"><path class="k-leg k-leg-l" d="M-22 78v14"/><path class="k-leg k-leg-r" d="M22 78v14"/></g>
  <g class="k-body">
    <g class="k-arm k-arm-l"><path d="M-52 14q-20 10 -15 32"/></g>
    <g class="k-arm k-arm-r"><path d="M52 14q20 10 15 32"/></g>
    <g class="k-point"><path d="M52 14h50"/><circle cx="106" cy="14" r="8"/><path class="k-finger" d="M110 10l14 4 -14 4z"/></g>
    <circle class="k-rim" cx="0" cy="8" r="56"/><circle class="k-face-bg" cx="0" cy="2" r="56"/>
    <circle class="k-ring" cx="0" cy="2" r="46"/>
    <ellipse class="k-shine" cx="-30" cy="-26" rx="13" ry="6" transform="rotate(-35 -30 -26)"/>
    <circle class="k-cheek k-cheek-l" cx="-34" cy="16" r="7"/><circle class="k-cheek" cx="34" cy="16" r="7"/>
    <g class="k-back"><path d="M-24 -20q24 -26 48 0M-16 2q16 -14 32 0M-8 20q8 -8 16 0"/></g>
    <g class="k-swirl"><path d="M-14 -6m-7 0a7 7 0 1 1 7 7a4 4 0 1 1 -4 -4M14 -6m-7 0a7 7 0 1 1 7 7a4 4 0 1 1 -4 -4"/></g>
    <g class="k-face" transform="translate(0 4)">
      <g class="k-shades"><rect x="-28" y="-14" width="24" height="17" rx="6"/><rect x="4" y="-14" width="24" height="17" rx="6"/><path d="M-4 -7h8"/></g>
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
  <g class="k-stars"><text x="-40" y="-84">★</text><text x="22" y="-90">★</text><text x="-6" y="-100">✦</text></g>
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();

  const mover = createMover(root, {});
  const home = () => ({ x: mover.size / 2 + 20, y: window.innerHeight - 10 });

  // ---- voice: several lines per situation per personality, never the same one twice in a row ----
  const talk = createVoice({ voice: store('kl-kamo-voice') });
  const sound = createSound({ mode: store('kl-kamo-sound') || 'voice', onTalk: (on, file, env) => { root.classList.toggle('talking', on); emitBody({ talk: on, env: on ? (file ? envOf(file) : env || '') : '' }); }, onLevel: (l) => { root.classList.toggle('lip', l >= 0); if (l >= 0) root.style.setProperty('--mouth', l.toFixed(2)); } });
  const snd = $('kamo-sound'); if (snd) { snd.value = sound.mode; snd.addEventListener('change', () => { sound.setMode(snd.value); store('kl-kamo-sound', sound.mode); say(sound.mode === 'off' ? 'Okay, quiet mode.' : sound.mode === 'speak' ? 'Hello! This is my talking voice.' : 'Chirp chirp! Do you like my little voice?', 'happy', 4000); }); }
  const sel = $('kamo-voice'); if (sel) sel.value = talk.voice;
  // The status line is recomputed every tick: keep the chosen variant stable for a while so it does not flicker or retype.
  const lineCache = new Map();
  const T = (key, vars) => {
    const id = key + '|' + talk.voice + '|' + JSON.stringify(vars || {}), hit = lineCache.get(id);
    if (hit && now() - hit.t < 180000) return hit.line;
    const line = talk.say(key, vars); lineCache.set(id, { line, t: now() });
    if (lineCache.size > 60) lineCache.delete(lineCache.keys().next().value);
    return line;
  };

  // ---- settings: hands (click in this app), outside (floating over the screen), autonomy (acts and walks on his own) ----
  let hands = store('kl-kamo-hands') === '1', outside = store('kl-kamo-outside') === '1', auto = store('kl-kamo-auto') !== '0';
  let curActs = [], lastPayload = null, hidden = store('kl-kamo-off') === '1';
  const hx = $('kamo-hands'), ox = $('kamo-outside'), ax = $('kamo-auto');
  const SAFE = '#nav button,#items-add,#items-add-btn,.pn-accept,#scan-now,#global-share-toggle,.irow-main,.slot,#items-view button,.hero-card';
  const BLOCK = '.f-del,.pn-refuse,.f-imgdel,.f-rdel,.f-rreset,#items-export';   // nothing destructive is ever touched
  const touchable = (el) => !!(el && el.closest && el.closest(SAFE) && !el.closest(BLOCK));
  const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length);
  const HAND = '<svg viewBox="0 0 48 48" width="44" height="44"><path d="M14 22V9a3 3 0 0 1 6 0v13l3-1.5a3 3 0 0 1 3 0l1 .5 2-.8a3 3 0 0 1 3 0l1 .6 1.5-.4a3 3 0 0 1 3.5 3V34c0 6-5 11-11 11h-4c-4 0-7-2-9-5L6 31a3 3 0 0 1 4.5-4L14 30z" fill="#fff" stroke="#3a2418" stroke-width="2.5" stroke-linejoin="round"/></svg>';

  function ringOn(el, ms) {
    const r = el.getBoundingClientRect(), ring = document.createElement('div'); ring.className = 'kring';
    ring.style.left = (r.left - 6) + 'px'; ring.style.top = (r.top - 6) + 'px'; ring.style.width = (r.width + 12) + 'px'; ring.style.height = (r.height + 12) + 'px';
    document.body.appendChild(ring); setTimeout(() => ring.remove(), ms);
  }
  // He walks next to an element and points his arm at it.
  async function approach(el, ms) {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect(), spot = mover.standBeside(r);
    await mover.walkTo(spot.x, spot.y);
    mover.aimAt(r.left + r.width / 2, r.top + r.height / 2, ms || 3500);
    ringOn(el, ms || 3500);
    return true;
  }
  // Pointing (and, with hands on, pressing) one allowed control of this app.
  async function touch(el, opts) {
    opts = opts || {};
    if (!touchable(el)) return false;
    el.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' });
    if (!reduce()) await sleep(380);
    await approach(el, 3600);
    const r = el.getBoundingClientRect(), kb = root.querySelector('.kamo-btn').getBoundingClientRect();
    const hand = document.createElement('div'); hand.className = 'kamo-hand'; hand.innerHTML = HAND;
    hand.style.left = (kb.left + kb.width * 0.7) + 'px'; hand.style.top = (kb.top + kb.height * 0.4) + 'px';
    document.body.appendChild(hand);
    await sleep(30);
    hand.style.transform = 'translate(' + (r.left + r.width / 2 - kb.left - kb.width * 0.7 - 6) + 'px,' + (r.top + r.height / 2 - kb.top - kb.height * 0.4 - 2) + 'px)';
    await sleep(reduce() ? 0 : 800);
    const acted = !!(opts.act && hands);
    if (acted) {
      hand.classList.add('tap');
      await sleep(reduce() ? 0 : 220);
      if (opts.text !== undefined) { el.focus(); el.value = opts.text; el.dispatchEvent(new Event('input', { bubbles: true })); } else el.click();
    }
    setTimeout(() => { hand.classList.add('gone'); }, acted ? 500 : 3200);
    setTimeout(() => { hand.remove(); mover.clearAim(); }, acted ? 1100 : 3800);
    return acted;
  }
  if (hx) { hx.checked = hands; hx.addEventListener('change', () => { hands = hx.checked; store('kl-kamo-hands', hands ? '1' : '0'); say(hands ? 'Hands on! Tell me what to do ("go to scan", "add Bonnet Vicieux", "accept the clean ones") and I will do it. Only in this app, never in the game.' : 'Hands off. I will only point at things now.', 'happy', 6000); }); }
  if (ax) { ax.checked = auto; ax.addEventListener('change', () => { auto = ax.checked; store('kl-kamo-auto', auto ? '1' : '0'); say(auto ? 'Free at last! I will walk around, point things out and scan when your prices get old.' : 'Autonomy off. I stay put until you ask me.', auto ? 'happy' : 'idle', 6000); }); }

  // ---- outside: a see-through window over the screen. He walks, talks and points; he never clicks or types in the game. ----
  const bridge = window.kamaDesktopCapture;
  let ovPos = { fx: 0.06, fy: 0.97 }, lastShown = [];
  function emit(msg, m, acts, point, extra) {
    if (!outside || !bridge || !bridge.overlaySend) return;
    lastPayload = Object.assign({ mood: m, msg, acts: acts.map((a) => a.label), voice: talk.voice, point: point || null }, extra || {});
    bridge.overlaySend(lastPayload);
  }
  const emitBody = (extra) => { if (outside && bridge && bridge.overlaySend) bridge.overlaySend(extra); };
  function applyOutside() {
    root.hidden = hidden || outside; back.hidden = !hidden || outside;
    if (bridge && bridge.overlayShow) bridge.overlayShow(outside);
    if (outside && lastPayload) bridge.overlaySend(lastPayload);
  }
  if (ox) { ox.checked = outside; ox.disabled = !bridge || !bridge.overlayShow; ox.addEventListener('change', () => { outside = ox.checked; store('kl-kamo-outside', outside ? '1' : '0'); shownKey = ''; applyOutside(); if (outside) setTimeout(() => say('I am outside now! I can walk over your whole screen. I only watch and talk: I never click or type in the game.', 'happy', 6000), 600); }); }
  if (bridge && bridge.onOverlay) bridge.onOverlay((e) => { if (!e) return; if (e.type === 'body' && e.what === 'dizzy') { lastActive = now(); say(talk.say('dizzy'), 'sad', 4000); } else if (e.type === 'ask' && e.text) { lastActive = now(); ask(e.text); } else if (e.type === 'act' && curActs[e.i]) { lastActive = now(); curActs[e.i].run(); } else if (e.type === 'hide') { outside = false; if (ox) ox.checked = false; store('kl-kamo-outside', '0'); applyOutside(); } });

  // ---- memory: small counters kept on this computer, nothing else. This is what he learns from. ----
  const mem = normalizeMem(readJson('kl-kamo-mem', {}));
  mem.session = { start: now(), scans: 0, saved: 0 };
  const saveMem = () => store('kl-kamo-mem', JSON.stringify(mem));
  const dismissed = (k) => mem.dismissed[k] && now() - mem.dismissed[k] < 86400000;
  const dismiss = (k) => { mem.dismissed[k] = now(); saveMem(); shownKey = ''; };
  const touchDay = () => { mem.days[dayKey(now())] = 1; const h = new Date().getHours(); mem.hours[h] = (mem.hours[h] || 0) + 1; };
  window.addEventListener('kl-accepted', (e) => { const d = e.detail || {}; mem.accepts += d.n || 0; mem.session.saved += d.n || 0; if (d.allClean && d.n >= 3) mem.manualAll += 1; touchDay(); saveMem(); });
  window.addEventListener('kl-refused', (e) => { (e.detail || []).forEach((id) => { mem.refusals[id] = (mem.refusals[id] || 0) + 1; mem.refused += 1; }); saveMem(); });

  let override = null, shownKey = '', typer = 0, lastActive = now(), lastUser = now(), tipI = 0, nextIdle = now() + 15000, wasScanning = false, busy = false, lastAct = now(), gap = 12000, napAt = 0;
  const seenTabs = readJson('kl-kamo-tabs', {});
  function setHidden(v) { hidden = v; store('kl-kamo-off', v ? '1' : '0'); root.hidden = v || outside; back.hidden = !v || outside; }
  setHidden(hidden);
  if (outside) setTimeout(applyOutside, 800);
  const mood = (m) => { if (root.dataset.mood !== m) root.dataset.mood = m; };
  function hop() { if (reduce()) return; root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop'); }

  // ---- analysis of the user's own prices (cached for a few seconds: it is cheap but runs often) ----
  let mCache = null, mAt = 0;
  const market = () => { if (!mCache || now() - mAt > 20000) { mCache = analyzeMarket(o.items.snapshot ? o.items.snapshot() : [], now(), { watch: watched(mem) }); mAt = now(); } return mCache; };
  const habits = () => analyzeHabits(mem, now());

  function render(msg, m, acts) {
    const key = msg + '|' + m + '|' + acts.map((a) => a.label).join(',');
    if (key === shownKey) return;
    shownKey = key; mood(m); clearInterval(typer); curActs = acts; emit(msg, m, acts, null);
    actions.innerHTML = ''; text.textContent = '';
    const addActs = () => acts.forEach((a) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-act'; b.textContent = a.label; b.addEventListener('click', () => { lastActive = now(); a.run(); }); actions.appendChild(b); });
    if (reduce()) { text.textContent = msg; addActs(); return; }
    let i = 0; hop();
    typer = setInterval(() => { i += 2; text.textContent = msg.slice(0, i); if (i >= msg.length) { clearInterval(typer); addActs(); } }, 18);
  }
  function say(msg, m, ms, acts) { sound.say(msg, m); override = { msg, m, acts: acts || [], until: now() + (ms || 5000) }; lastActive = now(); tick(); }

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
      if (now() - mem.scans[mem.scans.length - 1] > 20 * 3600000 && Math.abs(h - med) <= 2) return { msg: T('scanDue'), m: 'happy', acts: [{ label: 'Scan now', run: o.actions.scan }, { label: 'Later', run: () => dismiss('due') }] };
    }
    return null;
  }

  function decide() {
    const st = o.getState(), sm = o.items.summary();
    if (st.scanning) return { msg: T('scanning'), m: 'scan', acts: [] };
    if (sm.pending > 0) {
      const acts = [];
      if (sm.clean > 0) acts.push({ label: 'Accept the ' + sm.clean + ' clean', run: async () => { const n = await o.items.acceptClean(); if (n) say(talk.say('acceptedN', { n, p: n > 1 ? 's' : '' }), 'happy', 4500); } });
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

  // ---- Ask Kamo: keyword understanding over the user's own data (not a language model). He never apologises for not knowing. ----
  const $q = (sel) => document.querySelector(sel);
  const chip = (label, q) => ({ label, run: () => ask(q) });
  const describe = (i, withRecipe) => {
    let s = i.name + ': ' + (i.price ? fmt(i.price) + ' kamas' : 'no price yet') + (i.days !== null ? ' (' + (i.days === 0 ? 'today' : i.days + ' d old') + ')' : '') + '.';
    if (i.kind === 'item' && i.cost !== null) s += '\nCraft cost ' + fmt(i.cost) + (i.profit !== null ? ', profit ' + (i.profit > 0 ? '+' : '') + fmt(i.profit) : '') + '.';
    if (withRecipe && i.recipe.length) s += '\n' + i.recipe.map((g) => '• ' + g.qty + ' × ' + g.name + (g.price ? ' (' + fmt(g.price) + ')' : ' (no price)')).join('\n');
    return s;
  };
  const moverLine = (m) => talk.say(m.dir === 'down' ? 'moverDown' : 'moverUp', { name: m.name, pct: m.pct, from: fmt(m.from), to: fmt(m.to) });
  const bargainLine = (b) => talk.say('bargain', { name: b.name, pct: b.pct, to: fmt(b.price), avg: fmt(b.avg) });
  function recapText() {
    const sm = o.items.summary(), rv = recapVars(mem, sm.best);
    if (!rv.scans && !rv.saved) return talk.say('recapNone');
    rv.best = sm.best ? talk.say('recapBest', { name: sm.best.name, profit: sm.best.profit }) : '';
    return talk.say('recap', rv);
  }
  // ---- his notebook: every answer from a higher tier is kept here, so he never asks the same thing twice ----
  const nb = createNotebook({ load: () => store('kl-kamo-nb') || '', save: (t) => store('kl-kamo-nb', t) });
  const fr = () => (mem.friend && mem.friend.open ? mem.friend : (mem.friend = { open: {}, seen: [], nudged: {} }));
  if (store('kl-kamo-nb-mig') !== '1') {   // the older list of taught answers moves into the notebook once
    let top = 0; readJson('kl-kamo-kb', []).forEach((e) => { if (e && e.q && e.answer) { nb.learn(e.q, e.answer, 'friend', [], e.at || now()); top = Math.max(top, e.at || 0); } });
    fr().kbAt = Math.max(fr().kbAt || 0, top); saveMem(); store('kl-kamo-nb-mig', '1');
  }
  // ---- the free cloud tier (Groq first): the HTTP call is made by the desktop app, with the key you pasted in the Kamo menu ----
  const cbridge = () => (bridge && bridge.brainChat ? bridge : null);
  const cloudCfg = () => { const c = readJson('kl-kamo-cloud', {}); return { keys: (c && c.keys) || {}, models: (c && c.models) || {} }; };
  const cloud = createCascade((req) => (cbridge() ? cbridge().brainChat(req) : Promise.resolve({ ok: false, error: 'only in the desktop app' })));
  // only the items the question names, a few numbers each: never the whole ledger
  const ctxFor = (raw) => pickContext(raw, o.items.snapshot ? o.items.snapshot() : [], (r) => analyzeItem(r, now()), (r) => { const i = o.items.lookup(r.name); return i ? { cost: i.cost, profit: i.profit } : null; });
  const ttlFor = (ctx) => (ctx.ids.length ? 12 * 3600000 : 0);   // an answer about today's prices is only kept for half a day
  // 👍 / 👎: a 👎 makes him ask what he should have said, and the next thing you type becomes the answer (it beats every other source)
  let pendingFix = null;
  const rate = (id) => [
    { label: '👍', run: () => { nb.vote(id, true); say('Thank you! I will trust that answer more.', 'happy', 3000, []); } },
    { label: '👎', run: () => { nb.vote(id, false); pendingFix = { id, at: now() }; say('Oops! What should I have said? Type it below and I will remember it.', 'sad', 40000, [{ label: 'Never mind', run: () => { pendingFix = null; say('Okay!', 'idle', 2000, []); } }]); } },
  ];
  function cardText() {
    const s = nb.stats(), c = s.count, asked = c.asked || 0, n = (k) => c[k] || 0;
    const rows = ['Questions asked: ' + asked, 'Answered by my rules: ' + n('rules'), 'From my notebook: ' + n('notebook'), 'From the cloud: ' + n('cloud'), 'From my friend (Claude): ' + n('friend'), 'Could not answer: ' + n('curious'),
      '👍 ' + n('up') + '   👎 ' + n('down') + '   Corrections: ' + n('corrections'), 'Notebook: ' + s.size + ' answers (' + s.by.user + ' yours, ' + s.by.friend + ' friend, ' + s.by.cloud + ' cloud)'];
    if (asked) rows.push('Answered by myself: ' + Math.round(((n('rules') + n('notebook')) * 100) / asked) + '%');
    return rows.join('\n');
  }

  // ---- "Wait a minute, I will ask a friend": what he cannot answer goes to Claude through the connector, the answer comes back here ----
  const fbridge = () => (typeof window !== 'undefined' && window.kamaDesktopCapture && window.kamaDesktopCapture.friendWrite ? window.kamaDesktopCapture : null);
  const pushQuestions = () => { const b = fbridge(); if (b) b.friendWrite(JSON.stringify({ v: 1, questions: Object.entries(fr().open).map(([id, v]) => ({ id, q: v.q, at: v.at })) })); };
  let friendTimer = 0;
  async function pollFriend() {
    const b = fbridge(); if (!b) return;
    let data = null; try { const t = await b.friendRead(); data = t ? JSON.parse(t) : null; } catch { data = null; }
    const f = fr(), asked = { ...f.open }, r = applyAnswers(f.open, data, f.seen), got = new Set(r.say.map((a) => a.id));
    const fresh = r.kb.filter((k) => !got.has(k.id) && (k.at || 0) > (f.kbAt || 0));   // things Claude taught him without being asked
    if (fresh.length) { fresh.forEach((k) => nb.learn(k.q, k.answer, 'friend', [], k.at)); f.kbAt = Math.max(...fresh.map((k) => k.at || 0)); saveMem(); }
    r.say.forEach((a, i) => {
      f.seen.push(a.id);
      let acts = []; const q = asked[a.id] && asked[a.id].q;
      if (q) { const c = ctxFor(q), e = nb.learn(q, a.text, 'friend', c.ids, now(), ttlFor(c)); nb.count('friend'); if (e) acts = rate(e.id); }
      setTimeout(() => say(a.text, 'happy', 16000, acts), i * 400);
    });
    if (r.say.length) { f.open = r.open; f.seen = f.seen.slice(-80); saveMem(); pushQuestions(); }
    Object.entries(f.open).forEach(([id, v]) => {
      if (now() - v.at > 4 * 60000 && !f.nudged[id]) { f.nudged[id] = 1; saveMem(); say('My friend has not answered yet. Open Claude and tell it: check Kamo\'s questions.', 'think', 14000, [{ label: 'Copy that for me', run: () => { try { navigator.clipboard.writeText('Check Kamo\'s questions and answer them.'); say('Copied! Paste it in Claude.', 'happy', 3500); } catch { /* clipboard not available */ } } }]); }
      if (now() - v.at > 3 * 3600000) delete f.open[id];
    });
    if (!Object.keys(f.open).length) { clearInterval(friendTimer); friendTimer = 0; }
  }
  const startFriendPoll = () => { if (!friendTimer) friendTimer = setInterval(() => { pollFriend().catch(() => {}); }, 5000); };
  function askFriendFile(raw) { const q = newQuestion(raw, now()); fr().open[q.id] = { q: q.q, at: q.at }; saveMem(); pushQuestions(); startFriendPoll(); }
  // The cloud tier: ask the free model; keep its answer; if it fails, the friend (Claude) is next, then the "curious" line.
  async function askCloud(raw, ctx, fallback) {
    const r = await cloud.ask(raw, ctx, cloudCfg());
    if (r.ok) { const e = nb.learn(raw, r.text, 'cloud', ctx.ids, now(), ttlFor(ctx)); nb.count('cloud'); say(r.text, 'happy', 22000, e ? rate(e.id) : []); return; }
    if (fbridge() && shouldAsk(raw)) { askFriendFile(raw); return; }
    nb.count('curious');
    const bad = (r.tried || []).some((t) => t.status === 401 || t.status === 403), f = fallback();
    say(bad ? 'My cloud key was refused. Check it in the Kamo menu.' : f.msg, bad ? 'sad' : f.m, 12000, bad ? [] : f.acts);
  }
  // The answer to something he does not know: his notebook, else the free cloud, else a friend (Claude), else the "curious" line.
  let tier = '';
  function friendAnswer(raw, fallback) {
    const ctx = ctxFor(raw), hit = nb.lookup(raw, ctx.ids);
    if (hit) { tier = 'notebook'; return { msg: hit.entry.a, m: 'happy', acts: rate(hit.entry.id) }; }
    if (!shouldAsk(raw)) { tier = 'curious'; return fallback(); }
    if (cbridge() && cloud.configured(cloudCfg())) { tier = 'pending'; return { msg: 'Wait a minute, let me ask a friend…', m: 'think', acts: [], ms: 25000, run: () => askCloud(raw, ctx, fallback) }; }
    if (!fbridge()) { tier = 'curious'; return fallback(); }
    tier = 'pending'; askFriendFile(raw);
    return { msg: 'Wait a minute, let me ask a friend…', m: 'think', acts: [] };
  }
  if (fbridge() && Object.keys(fr().open).length) startFriendPoll();

  // quick buttons: only the three usual ones. Repeated questions are learned in the background (watched items), never turned into more buttons.
  const quickChips = () => [chip('What changed?', 'what changed'), chip('Best crafts', 'best crafts'), chip('Bargains', 'bargains')];
  // questions about one item or two: answered from the price history
  function analyst(ai, raw) {
    const snap = o.items.snapshot(), by = (id) => snap.find((r) => r.id === id), t = now();
    learnQuestion(mem, questionKey(ai), raw, t, ai.intent === 'compare' ? null : ai.id); saveMem();
    if (ai.intent === 'compare') {
      const a = by(ai.ids[0]), b = by(ai.ids[1]);
      return { msg: explainCompare(analyzeItem(a, t), analyzeItem(b, t)), m: 'think', acts: [{ label: 'Open ' + a.name, run: () => o.actions.best(a.id) }, { label: 'Open ' + b.name, run: () => o.actions.best(b.id) }] };
    }
    const rec = by(ai.id), a = analyzeItem(rec, t);
    return { msg: ai.intent === 'trend' ? explainTrend(a) : explainWorth(a, ai.sell), m: a.verdict === 'cheap' ? 'happy' : 'think', acts: [{ label: 'Open ' + rec.name, run: () => o.actions.best(rec.id) }] };
  }
  function answer(raw) {
    const ai = parseAsk(raw, (o.items.snapshot ? o.items.snapshot() : []).map((r) => ({ id: r.id, name: r.name })));
    if (ai) return analyst(ai, raw);
    const u = understand(raw); if (!u) return null;
    mem.asks[u.intent] = (mem.asks[u.intent] || 0) + 1;
    if (u.intent !== 'item' && u.intent !== 'lookup') learnQuestion(mem, questionKey(u, raw), raw, now());
    saveMem();
    const sm = o.items.summary(), mk = market();
    const cm = quickChips();
    switch (u.intent) {
      case 'go': return { msg: hands ? 'On my way!' : 'It is the "' + u.label + '" tab, up there. Click it!', m: 'happy', acts: [], run: () => touch($q('#b-' + u.tab), { act: true }) };
      case 'add': return { msg: hands ? 'Adding ' + u.name + '…' : 'Type the name in the Add box, then press Add. I am pointing at it.', m: 'happy', acts: [], run: async () => { o.actions.add(); await sleep(150); const done = await touch($q('#items-add'), { act: true, text: u.name }); if (done) { await sleep(200); await touch($q('#items-add-btn'), { act: true }); say(u.name + ' added with its recipe.', 'happy', 4500); } else await touch($q('#items-add-btn'), { act: false }); } };
      case 'accept': return { msg: hands ? 'Accepting what is ticked…' : 'Press "Accept selected" in the approval window. I am pointing at it.', m: 'happy', acts: [], run: async () => { o.actions.show(); await sleep(500); await touch($q('.pn-accept'), { act: true }); } };
      case 'scan': return { msg: hands ? 'Scanning!' : 'Press "Scan now". I am pointing at it.', m: 'scan', acts: [], run: async () => { o.actions.scanTab && o.actions.scanTab(); await sleep(400); await touch($q('#scan-now'), { act: true }); } };
      case 'share': return { msg: hands ? 'Opening the share window…' : 'Press "Start screen share". I am pointing at it.', m: 'happy', acts: [], run: () => touch($q('#global-share-toggle'), { act: true }) };
      case 'where-add': return { msg: 'Right here!', m: 'happy', acts: [], run: () => touch($q('#items-add'), { act: false }) };
      case 'hi': return { msg: talk.say('hi'), m: 'happy', acts: cm };
      case 'thanks': return { msg: talk.say('thanks'), m: 'happy', acts: [] };
      case 'help': return { msg: talk.say('help'), m: 'think', acts: cm };
      case 'item': case 'lookup': {
        const info = o.items.lookup(String(u.name).replace(/[?!.]+$/, ''));
        learnQuestion(mem, info ? 'item:' + info.id : questionKey(u, raw), raw, now(), info ? info.id : null); saveMem();
        if (info) return { msg: describe(info, !!u.recipe), m: info.profit > 0 ? 'happy' : 'think', acts: info.kind === 'item' ? [{ label: 'Open graph', run: () => o.actions.best(info.id) }] : [] };
        if (u.intent === 'item') return { msg: talk.say('noItem', { q: String(u.name).trim() }), m: 'sad', acts: [] };
        return friendAnswer(raw, () => ({ msg: talk.say('curious', { hint: curiousHint(sm, mk) }), m: 'think', acts: cm }));   // not an item, not a command: ask a friend
      }
      case 'best': {
        const top = o.items.topCrafts(3);
        if (!top.length) return { msg: talk.say('noCraft'), m: 'sad', acts: [] };
        return { msg: talk.say('bestList') + '\n' + top.map((t, i) => (i + 1) + '. ' + t.name + '  +' + fmt(t.profit) + (t.cost ? '  (costs ' + fmt(t.cost) + ')' : '')).join('\n'), m: 'happy', acts: [{ label: 'Open the best', run: () => o.actions.best(top[0].id) }] };
      }
      case 'old': {
        const r = o.items.oldestPrices(5);
        if (!r.total) return { msg: talk.say('allFresh'), m: 'happy', acts: [] };
        return { msg: talk.say('oldList', { n: r.total }) + '\n' + r.list.map((x) => '• ' + x.name + (x.days === null ? ' (no price)' : ' (' + x.days + ' d)')).join('\n'), m: 'sad', acts: [{ label: 'Scan now', run: o.actions.scan }] };
      }
      case 'budget': { const b = o.items.budgetValue(); return b === null ? { msg: talk.say('noBudget'), m: 'sad', acts: [] } : { msg: talk.say('budget', { v: fmt(b) }), m: 'happy', acts: [] }; }
      case 'waiting': return { msg: sm.pending ? sm.pending + ' price' + (sm.pending > 1 ? 's' : '') + ' waiting, ' + sm.clean + ' clean.' : 'Nothing is waiting.', m: 'think', acts: sm.pending ? [{ label: 'Let me look', run: o.actions.show }] : [] };
      case 'movers': {
        if (!mk.movers.length) return { msg: talk.say('moverNone'), m: 'idle', acts: [chip('Bargains', 'bargains')] };
        const top = mk.movers.slice(0, 3);
        return { msg: top.map(moverLine).join('\n'), m: top[0].dir === 'down' ? 'happy' : 'think', acts: [{ label: 'Open ' + top[0].name, run: () => o.actions.best(top[0].id) }] };
      }
      case 'bargains': {
        if (!mk.bargains.length) return { msg: talk.say('bargainNone'), m: 'idle', acts: [chip('What changed?', 'what changed')] };
        const top = mk.bargains.slice(0, 3);
        return { msg: top.map(bargainLine).join('\n'), m: 'happy', acts: [{ label: 'Open ' + top[0].name, run: () => o.actions.best(top[0].id) }] };
      }
      case 'habits': {
        const h = habits();
        if (!h.facts.length) return { msg: talk.say('habitNone'), m: 'think', acts: [] };
        return { msg: h.facts.map((f) => talk.say(f.key, f.vars)).join('\n'), m: 'happy', acts: [] };
      }
      case 'recap': return { msg: recapText(), m: 'happy', acts: [] };
      case 'dance': return { msg: talk.say('dance'), m: 'happy', acts: [], run: () => playBody('dance') };
      case 'jump': return { msg: talk.say('jumpSay'), m: 'happy', acts: [], run: () => playBody('jump') };
      case 'lie': return { msg: talk.say('dance'), m: 'happy', acts: [], run: () => playBody('lie') };
      case 'turn': return { msg: talk.say('dance'), m: 'happy', acts: [], run: () => playBody('side') };
      case 'sing': return { msg: talk.say('sing'), m: 'happy', acts: [], run: () => playBody('dance') };
      case 'joke': return { msg: talk.say('joke'), m: 'happy', acts: [] };
      case 'walk': return { msg: talk.say('walkSay'), m: 'idle', acts: [], run: () => wander(true) };
      default: return friendAnswer(raw, () => ({ msg: talk.say('curious', { hint: curiousHint(sm, mk) }), m: 'think', acts: cm }));
    }
  }
  function ask(raw) {
    lastUser = now();
    if (pendingFix) {   // after a 👎, what you type next is the right answer
      const pf = pendingFix; pendingFix = null;
      if (/^(never ?mind|cancel|skip|annuler)\W*$/i.test(String(raw).trim())) { say('Okay!', 'idle', 2000, []); return; }
      if (now() - pf.at < 5 * 60000 && nb.correct(pf.id, raw)) { say('Got it! I will remember that.', 'happy', 4000, []); return; }
    }
    if (/\b(report card|bulletin|how smart are you)\b/i.test(String(raw))) { say(cardText(), 'happy', 22000, []); return; }
    tier = '';
    const a = answer(raw); if (!a) return;
    nb.count('asked'); if (tier !== 'pending') nb.count(tier || 'rules');
    say(a.msg, a.m, a.ms || (a.run ? 7000 : 22000), a.acts);
    if (a.run) setTimeout(() => { Promise.resolve(a.run()).catch(() => {}); }, 350);
  }
  root.querySelector('.kb-ask').addEventListener('submit', (e) => { e.preventDefault(); const v = qIn.value; qIn.value = ''; ask(v); });

  // ---- his body: walking, playing, pointing (in the app, or over the screen when he is outside) ----
  async function walkHome() { const h = home(); if (outside) { ovPos = { fx: 0.06, fy: 0.97 }; emitBody({ walk: ovPos }); return; } await mover.walkTo(h.x, h.y); }
  const POSE_NAMES = ['lie', 'lie-back', 'lie-belly'];
  // Lying down comes with his voice: a line that fits how he lies (awake, belly down, asleep) and, at the end, getting up.
  function lieLine() {
    const l = LIES[Math.floor(Math.random() * LIES.length)];
    const key = l[2] === 'sleep' ? 'lieSleep' : l[0] === 'lie-belly' ? 'lieBelly' : 'lieBack';
    return { l, key };
  }
  async function playBody(name) {
    if (outside) {
      const x = { play: name };
      let lie = null;
      if (name === 'lie') { lie = lieLine(); x.look = lie.l[1]; x.lmood = lie.l[2]; x.lpose = lie.l[0]; }
      // lying down: he goes to the top edge of the market window (or, failing that, on a card) and rests there
      if (POSE_NAMES.includes(name)) {
        const w = lastShown.find((m) => m.kind === 'win'), cards = lastShown.filter((m) => m.kind !== 'win' && m.w > 0.1 && m.h < 0.15);
        if (w) { x.walk = { fx: Math.min(0.95, Math.max(0.05, w.x + w.w * (0.2 + Math.random() * 0.6))), fy: Math.max(0.12, w.y + 0.004) }; x.fit = 0.085; ovPos = x.walk; }
        else if (cards.length) { const c = cards[Math.floor(Math.random() * cards.length)]; x.walk = { fx: Math.min(0.9, Math.max(0.1, c.x + c.w * 0.5)), fy: Math.min(0.97, c.y + c.h * 0.4) }; x.fit = c.h * 1.4; ovPos = x.walk; }
      }
      emitBody(x);
      if (lie) { setTimeout(() => say(talk.say(lie.key), lie.l[2] === 'sleep' ? 'idle' : 'happy', 4500), 1700); setTimeout(() => say(talk.say('getUp'), 'happy', 3000), 9400); }
      await sleep(2600); return;
    }
    if (name === 'lie') { const lie = lieLine(); setTimeout(() => say(talk.say(lie.key), 'happy', 4500), 400); setTimeout(() => say(talk.say('getUp'), 'happy', 3000), 9400); await mover.play('lie', 9000, 0, lie.l[1], lie.l[2], lie.l[0]); return; }
    mood('happy'); await mover.play(name);
  }
  // He walks to a random place: in the app, anywhere on the lower part of the window; outside, along the edges of the screen.
  async function wander(loud) {
    if (outside) {
      const spots = [[0.05, 0.97], [0.95, 0.97], [0.5, 0.98], [0.04, 0.55], [0.96, 0.55], [0.3, 0.98], [0.7, 0.98], [0.96, 0.25], [0.04, 0.25]];
      let s; do { s = spots[Math.floor(Math.random() * spots.length)]; } while (Math.abs(s[0] - ovPos.fx) < 0.05 && Math.abs(s[1] - ovPos.fy) < 0.05);
      ovPos = { fx: s[0], fy: s[1] }; emitBody({ walk: ovPos }); await sleep(2500); return;
    }
    const w = window.innerWidth, h = window.innerHeight;
    const px = mover.size / 2 + 10 + Math.random() * (w - mover.size - 20), py = h * (0.5 + Math.random() * 0.48);
    if (loud || Math.random() < 0.3) say(talk.say('walkSay'), 'idle', 2600);
    await mover.walkTo(px, py);
    if (Math.random() < 0.5) { root.classList.add('look'); setTimeout(() => root.classList.remove('look'), 2600); }
  }
  // Points at an element of the app. If it is not on screen (another tab), he points at the tab button instead.
  async function pointAt(sel, fallbackSel, line, m, ms, acts) {
    if (outside) { say(line, m || 'happy', ms || 7000, acts); return; }
    let el = $q(sel); if (!visible(el)) el = $q(fallbackSel);
    if (!visible(el)) { say(line, m || 'happy', ms || 7000, acts); return; }
    say(line, m || 'happy', ms || 7000, acts);
    await approach(el, 4200);
  }

  // ---- autonomy: when you are not asking him anything, he decides what to do ----
  async function behave(plan) {
    busy = true; lastAct = now();
    try {
      const sm = o.items.summary();
      switch (plan.kind) {
        case 'nap': await walkHome(); say(talk.say('nap'), 'idle', 4000); break;
        case 'wander': await wander(false); break;
        case 'chatter': say(Math.random() < 0.25 ? talk.say('joke') : talk.say('chatter'), 'idle', 7000); break;
        case 'play': say(talk.say(plan.move === 'jump' ? 'jumpSay' : 'dance'), 'happy', 3000); await playBody(plan.move); break;
        case 'point-pending': await pointAt('#items-review', '#b-items', talk.say('pendingPoint', { n: plan.n, p: plan.n > 1 ? 's' : '' }), 'think', 8000, sm.clean ? [{ label: 'Accept the ' + sm.clean + ' clean', run: async () => { const n = await o.items.acceptClean(); if (n) say(talk.say('acceptedN', { n, p: n > 1 ? 's' : '' }), 'happy', 4500); } }, { label: 'Let me look', run: o.actions.show }] : [{ label: 'Let me look', run: o.actions.show }]); break;
        case 'point-best': if (sm.best) await pointAt('.hero-card', '#b-items', talk.say('best', { name: sm.best.name, profit: sm.best.profit }), 'happy', 8000, [{ label: 'Show recipe', run: () => o.actions.best(sm.best.id) }]); else await wander(false); break;
        case 'scan': mem.lastAutoScan = now(); saveMem(); say(talk.say('autoScan'), 'scan', 4000); if (o.actions.scanQuiet) o.actions.scanQuiet(); break;
        case 'mover': say(moverLine(plan.item), plan.item.dir === 'down' ? 'happy' : 'think', 11000, [{ label: 'Open ' + plan.item.name, run: () => o.actions.best(plan.item.id) }]); if (!outside) { await wander(false); } break;
        case 'bargain': say(bargainLine(plan.item), 'happy', 11000, [{ label: 'Open ' + plan.item.name, run: () => o.actions.best(plan.item.id) }]); if (!outside) { await wander(false); } break;
        case 'recap': mem.lastRecap = now(); saveMem(); say(recapText(), 'happy', 10000); break;
        case 'habit': say(talk.say(plan.fact.key, plan.fact.vars), 'happy', 9000); break;
        case 'tour': await pointAt('#b-' + plan.tab, '#b-' + plan.tab, talk.say('tour', { tab: tabName(plan.tab), tip: tabTip(plan.tab) }), 'think', 9000); break;
        default: break;
      }
    } catch (e) { /* a failed behaviour must never break the app */ }
    busy = false;
  }
  function autoTick() {
    if (hidden || busy || !auto) return;
    const t = now();
    if (override && override.until > t) return;   // he is talking
    if (mover.isWalking()) return;
    const st = o.getState(), sm = o.items.summary();
    const plan = planNext({ now: t, rng: Math.random, gap, sinceAct: t - lastAct, idleMs: t - lastUser, auto, canScan: !!o.actions.scanQuiet, st, sum: sm, market: market(), habits: habits(), mem });
    if (!plan) return;
    if (plan.kind === 'nap') { if (root.dataset.mood === 'sleep' || t - napAt < 600000) return; napAt = t; }   // one nap announcement, not one every few seconds
    gap = 8000 + Math.random() * 9000;
    if (plan.seen) { mem.seen[plan.seen] = t; saveMem(); }
    behave(plan);
  }

  function tick() {
    if (hidden) return;
    const t = now(), st = o.getState();
    if (wasScanning && !st.scanning) { mem.scans.push(t); mem.scans = mem.scans.slice(-40); mem.session.scans += 1; touchDay(); saveMem(); mCache = null; }
    wasScanning = st.scanning;
    if (override && t > override.until) override = null;
    if (override && st.scanning) override = null;   // an ongoing scan always wins over tips
    if (document.activeElement === qIn && override) override.until = Math.max(override.until, t + 4000);
    const d = override ? { msg: override.msg, m: override.m, acts: override.acts } : decide();
    const asleep = !override && d.m === 'idle' && t - lastActive > 150000 && document.activeElement !== qIn && !busy;
    if (asleep) { mood('sleep'); if (!outside && !mover.isWalking()) { const h = home(), p = mover.pos(); if (Math.abs(p.x - h.x) > 6 || Math.abs(p.y - h.y) > 6) mover.walkTo(h.x, h.y); } } else {
      render(d.msg, d.m, d.acts);
      if (!override && d.m === 'idle' && t > nextIdle && !auto) {   // with autonomy off he only does small idle things in place
        nextIdle = t + 14000 + Math.random() * 16000;
        const r = Math.random();
        if (r < 0.4) { root.classList.add('look'); setTimeout(() => root.classList.remove('look'), 2600); }
        else if (r < 0.65) hop();
        else say(TIPS[tipI++ % TIPS.length], 'idle', 7000);
      }
    }
  }
  const wake = () => {
    lastActive = now(); lastUser = now();
    if (root.dataset.mood === 'sleep') { shownKey = ''; tick(); if (auto && !busy) say(talk.say('wake'), 'happy', 2500); }
  };
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  let lastMove = 0;
  window.addEventListener('pointermove', () => { const t = now(); if (t - lastMove > 1500) { lastMove = t; lastUser = t; } }, { passive: true });
  root.querySelector('.kamo-btn').addEventListener('click', () => { lastActive = now(); lastUser = now(); hop(); say(TAB_TIPS[o.getState().tab] || TIPS[tipI++ % TIPS.length], 'think', 9000); });
  root.querySelector('.kb-x').addEventListener('click', () => setHidden(true));
  back.addEventListener('click', () => { setHidden(false); shownKey = ''; lastActive = now(); tick(); });
  // ---- the settings box: provider, your key, model, Test, report card ----
  const pv = $('kamo-prov'), pk = $('kamo-key'), pm = $('kamo-model'), pt = $('kamo-test'), po = $('kamo-test-out'), ph = $('kamo-key-help'), pc = $('kamo-card');
  if (pv && pk && pm) {
    const saveCloud = (c) => store('kl-kamo-cloud', JSON.stringify(c));
    PROVIDERS.forEach((p) => { const op = document.createElement('option'); op.value = p.id; op.textContent = p.label; pv.appendChild(op); });
    const show = () => { const c = cloudCfg(), p = PROVIDERS.find((x) => x.id === pv.value) || PROVIDERS[0]; pk.value = c.keys[p.id] || ''; pm.value = c.models[p.id] || p.model; if (ph) ph.textContent = 'Get a free key: ' + p.help; if (po) po.textContent = ''; };
    const HELD = 'stored-securely';   // what the page keeps instead of the key once the desktop app holds it encrypted
    const secure = () => (bridge && bridge.brainKeySet ? bridge : null);
    const keep = async () => {
      const c = cloudCfg(), id = pv.value, p = PROVIDERS.find((x) => x.id === id), typed = pk.value.trim();
      c.models[id] = pm.value.trim() && pm.value.trim() !== p.model ? pm.value.trim() : '';
      if (typed === HELD) { saveCloud(c); return; }
      if (secure()) {
        try { const r = await secure().brainKeySet(id, typed); if (r && r.ok) { c.keys[id] = typed ? HELD : ''; pk.value = c.keys[id]; saveCloud(c); return; } } catch { /* fall through to the old way */ }
      }
      c.keys[id] = typed; saveCloud(c);
    };
    // keys saved by an older version move into the encrypted store once
    (async () => { if (!secure()) return; const c = cloudCfg(); let moved = false; for (const id of Object.keys(c.keys)) { const v = (c.keys[id] || '').trim(); if (v && v !== HELD) { try { const r = await secure().brainKeySet(id, v); if (r && r.ok) { c.keys[id] = HELD; moved = true; } } catch { /* keep as is */ } } } if (moved) { saveCloud(c); show(); } })();
    pv.addEventListener('change', show); pk.addEventListener('change', keep); pm.addEventListener('change', keep); show();
    if (pt) pt.addEventListener('click', async () => {
      await keep(); if (!cbridge()) { po.textContent = 'Only in the desktop app.'; return; }
      po.textContent = 'Testing…'; const r = await cloud.test(pv.value, cloudCfg()); po.textContent = (r.ok ? '✓ ' : '✗ ') + r.why; try { if (window.klStatus) window.klStatus.note('kamoTest', { provider: pv.value, model: pm.value || '(default)', keyHeld: !!pk.value, ok: r.ok, why: r.why, at: new Date().toISOString() }); } catch { /* optional */ }
    });
  }
  if (pc) pc.addEventListener('click', () => { if (hidden) setHidden(false); say(cardText(), 'happy', 22000, []); });
  if (sel) sel.addEventListener('change', () => { talk.setVoice(VOICES.includes(sel.value) ? sel.value : 'merchant'); store('kl-kamo-voice', talk.voice); shownKey = ''; if (hidden) setHidden(false); say(talk.say('voiceSet'), 'happy', 3500); });
  window.addEventListener('kl-toast', (e) => {
    const m = String(e.detail || ''); if (!m) return;
    const bad = /refused|could not|failed|not in the game|no game panel|nothing was changed|still need/i.test(m);
    say(m, bad ? 'sad' : 'happy', 4200);
  });
  setInterval(tick, 700); tick();
  setInterval(autoTick, 2000);
  // he walks in when the app opens
  if (!hidden && !outside && !reduce()) { mover.teleport(-mover.size, window.innerHeight - 10, true); setTimeout(() => { mover.walkTo(home().x, home().y).then(() => { if (auto) say(talk.say('hi'), 'happy', 5000); }); }, 700); }
  return {
    say, ask,
    async observe(list, surface) {
      if (!list || !list.length) return;
      const first = list[0];
      // pointing over the screen needs the whole screen to be shared (a shared window has no known position on screen)
      const canPoint = outside && surface === 'monitor' && first.fw && first.fh;
      let fx = canPoint ? first.cx / first.fw : 0, fy = canPoint ? first.cy / first.fh : 0;
      if (canPoint && bridge && bridge.frameRect) { try { const fr = await bridge.frameRect(first.fw, first.fh); if (fr) { fx = fr.fx + fx * fr.fw; fy = fr.fy + fy * fr.fh; } } catch { /* keep the plain fractions */ } }
      const point = canPoint ? { fx, fy, label: first.kind === 'cheap' ? 'cheap!' : 'pricey' } : null;
      const more = list.length > 1 ? '\n(+' + (list.length - 1) + ' more: ' + list.slice(1).map((x) => x.text.split(' is ')[0].split(' went ')[0]).join(', ') + ')' : '';
      say(first.text + more, first.mood, 14000, []);
      if (point) {   // he walks next to the item on the screen and points at it
        ovPos = { fx: Math.min(0.93, Math.max(0.07, fx + (fx > 0.5 ? -0.08 : 0.08))), fy: Math.min(0.97, Math.max(0.3, fy + 0.12)) };
        emit(first.text + more, first.mood, [], point, { walk: ovPos, aim: { fx, fy } });
      }
    },
    // Highlights over the game for what was just scanned. Works for a shared screen and, on Windows, for a shared window
    // (the app asks the system where the window is). Marks come as fractions of the shared picture.
    async marks(list, hint, surface, fw, fh) {
      if (!outside || !bridge || !bridge.overlaySend || !list || !list.length) return false;
      let fr = null;
      try { fr = bridge.frameRect ? await bridge.frameRect(fw, fh) : (surface === 'monitor' ? { fx: 0, fy: 0, fw: 1, fh: 1 } : null); } catch { fr = surface === 'monitor' ? { fx: 0, fy: 0, fw: 1, fh: 1 } : null; }
      if (!fr) { if (hint) say(hint + (surface === 'window' ? ' (I cannot find the game window on the screen, so no boxes.)' : ''), 'happy', 7000, []); return false; }
      const map = (m) => ({ ...m, x: fr.fx + m.x * fr.fw, y: fr.fy + m.y * fr.fh, w: m.w * fr.fw, h: m.h * fr.fh });
      const shown = list.map(map); lastShown = shown;
      emitBody({ marks: shown, marksTtl: 7000 });
      // he walks next to the last thing he read and points at it
      const t = shown[shown.length - 1], px = Math.min(0.97, Math.max(0.03, t.x + t.w * 0.5)), py = Math.min(0.97, Math.max(0.03, t.y + t.h * 0.5));
      const text = hint || 'Scanned!';
      ovPos = { fx: Math.min(0.93, Math.max(0.07, t.x + t.w + 0.05 > 0.95 ? t.x - 0.06 : t.x + t.w + 0.05)), fy: Math.min(0.96, Math.max(0.15, t.y + t.h + 0.07)) };
      say(text, 'happy', 8000, []);
      emit(text, 'happy', [], { fx: px, fy: py, label: 'scanned' }, { walk: ovPos, aim: { fx: px, fy: py } });
      return true;
    },
    onTab(k) {
      mem.tabs[k] = (mem.tabs[k] || 0) + 1; touchDay(); saveMem();   // what he learns: which tabs you use and when
      if (seenTabs[k] || !TAB_TIPS[k]) return; seenTabs[k] = 1; store('kl-kamo-tabs', JSON.stringify(seenTabs)); setTimeout(() => say(TAB_TIPS[k], 'think', 9000), 400);
    },
  };
}
