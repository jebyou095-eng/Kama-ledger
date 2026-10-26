// Kamo's brain: everything he knows, notices and decides, with no DOM in it so it can be tested.
//   voice      what he says: every situation has several lines per personality, and he avoids repeating himself
//   analysis   price movers, bargains, volatility (from each item's price history), habits (from small local counters), session recap
//   understand turns what you type into an intent; anything unknown becomes a curious answer, never an apology
//   planNext   what he does on his own when nobody is asking him anything
// Nothing here writes data. The UI decides what is allowed to run (see kamo.js).

export const VOICES = ['merchant', 'sassy', 'sage'];
const DAY = 86400000;

export const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const fillTpl = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v && v[k] !== undefined ? v[k] : ''));
export const fmt = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('fr-FR') : '-');

// ---------------------------------------------------------------- lines: [merchant, sassy, sage], each a list of variants
export const LINES = {
  share: [['Share your game window and I will read the market for you!', 'Ready when you are: share the game window and I get to work!'], ['Still no game window. I cannot read what I cannot see, you know.', 'No window, no scan. Share it, boss.'], ['Share the game window. Then I can work.', 'When the window is shared, I will begin.']],
  addFirst: [['Nothing tracked yet! Type an item name and I will fetch its recipe too.', 'A fresh list! Add your first item and let us make some kamas.'], ['An empty list. Bold. Type an item name and I will do the rest.', 'Zero items. Zero profit. Fix one of those.'], ['The list is empty. Add one item to begin.', 'Start small: one item, one price.']],
  scanning: [['Reading the market… hold on, I am matching every name to the game data!', 'Squinting at the market, nearly there!', 'Numbers, numbers everywhere…'], ['Squinting at the market… no, do not touch anything.', 'Reading. Do not breathe on the screen.', 'Counting your kamas, hold on.'], ['Reading. One moment.', 'The market is being read, calmly.', 'Patience. The numbers come.']],
  pendingClean: [['{n} prices waiting, and all of them look clean!', 'Sparkling clean: {n} prices ready for you!'], ['{n} prices waiting. Clean, for once.', '{n} prices, all tidy. Suspicious.'], ['{n} prices wait for you. All clean.', 'All {n} readings look sound.']],
  pendingMixed: [['{n} prices waiting: {c} look clean, {m} need{s} a look.', '{n} to approve. {c} are shiny, {m} need{s} your eyes.'], ['{n} prices waiting. {c} are fine, {m} need{s} your human eyes.', '{c} good, {m} dubious, {n} in total. Your call.'], ['{n} prices wait. {c} clean, {m} to check.', 'Of {n} readings, {m} deserve a second look.']],
  acceptedN: [['{n} price{p} saved. Lovely!', 'Saved {n} price{p}! Ka-ching!'], ['{n} price{p} saved. You are welcome.', '{n} price{p} in the bank. Do not mention it.'], ['{n} price{p} saved.', '{n} price{p} recorded.']],
  best: [['Best craft right now: {name}, +{profit} kamas. Go go go!', '{name} is the one: +{profit} kamas!'], ['{name}. +{profit} kamas. Try not to overthink it.', 'Make {name}. +{profit}. Easy money, allegedly.'], ['Best craft: {name}, +{profit} kamas.', 'Today the numbers favour {name}: +{profit} kamas.']],
  stale: [['{n} prices are old or missing. A quick scan of the ingredient market fixes that!', '{n} prices are getting dusty. Scan time?'], ['{n} stale prices. Shall we pretend that is fine, or scan?', '{n} prices older than my jokes. Scan.'], ['{n} prices have aged. A scan would renew them.', '{n} entries are out of date.']],
  live: [['Live scan is on. I am watching for new prices!', 'Eyes open, live scan running!'], ['Live scan is on. I am watching. Always watching.', 'Live scan is on. Behave.'], ['Live scan is on.', 'I am watching the market for you.']],
  ok: [['All up to date. Press the hotkey in the game whenever you want a fresh scan!', 'Everything is fresh. Go play, I will keep watch!'], ['Everything is up to date. Suspiciously so.', 'Nothing to do. I hate it.'], ['All is current. Scan when the market moves.', 'The ledger is calm.']],
  suggestAuto: [['You accept the clean batches every single time. Want me to do that part automatically?'], ['You always accept the clean ones. Shall I just do it for you?'], ['You always accept clean batches. Automate it?']],
  suggestIgnore: [['You refused {name} {n} times. Want me to stop asking about it?'], ['{name} again? Refused {n} times. Ignore it for good?'], ['You refused {name} {n} times. Ignore it?']],
  scanDue: [['This is about when you usually scan. Ready when you are!', 'Scan o\'clock! It is your usual time.'], ['It is your usual scan hour. I did not forget. Did you?', 'Your usual hour. The market will not scan itself.'], ['Your usual scanning hour. The market has moved.', 'Around now you usually scan.']],
  hi: [['Hello, trader! Ask me about your prices, or watch me wander.', 'Hey you! Good {part}!', 'Look who is here! Ready to make some kamas?'], ['Oh, hello. Ask me something useful.', 'Good {part}. Do not waste my time. Please.', 'Back again? Fine, I missed you. A little.'], ['Welcome. Ask, or simply watch the market with me.', 'Good {part}, trader.', 'Greetings. The market is open.']],
  thanks: [['Any time! That is what a gold coin is for.', 'My pleasure!'], ['Do not mention it. Actually, do. Keep tipping.', 'Obviously.'], ['Gladly.', 'It is what I am here for.']],
  help: [['I can tell you your best crafts, price movers, bargains, old prices, recipes, your habits and a recap of today. Try: "what changed?"', 'Ask me: best crafts, what changed, bargains, price of an item, recipe of an item, my habits, recap. Or say "dance"!'], ['Ask me: "best crafts", "what changed", "bargains", "price of Bonnet Vicieux", "my habits", "recap". Or tell me to dance.', 'Crafts, movers, bargains, prices, recipes, habits, recap. And yes, I take requests.'], ['Ask about: best crafts, what changed, bargains, an item price or recipe, old prices, your habits, a recap.', 'Movers, bargains, prices, recipes, habits, recap. Quietly at your service.']],
  noCraft: [['No profitable craft yet. Give your ingredients a price and I will find one!'], ['Nothing worth crafting yet. Ingredients need prices first, genius.'], ['No craft pays yet. Price the ingredients first.']],
  bestList: [['Top crafts right now:', 'The winners, fresh from my abacus:'], ['Fine. Here are the winners:', 'Behold, profit:'], ['Best crafts:', 'The most rewarding crafts:']],
  oldList: [['{n} prices are old. The oldest:'], ['{n} are stale. Worst offenders:'], ['{n} old prices. Oldest:']],
  allFresh: [['Every price is fresh!'], ['Nothing is old. Impressive.'], ['No old prices.']],
  budget: [['Your budget is {v} kamas.'], ['You have {v} kamas. Spend wisely, or do not.'], ['Budget: {v} kamas.']],
  noBudget: [['I have not seen your budget yet. Scan the screen when it is visible.'], ['No budget scanned yet. I am not psychic.'], ['No budget scanned yet.']],
  curious: [['Ooh, that one is not in my notebook yet! {hint}', 'Hmm, I would love to help with that, but I am a market coin. {hint}', 'My talents are prices and crafts, not that. {hint}'], ['That is outside my coin purse. {hint}', 'Not my department, boss. {hint}', 'I only do money. {hint}'], ['That lies beyond what I study. {hint}', 'I am a trader, not an oracle. {hint}']],
  noItem: [['I cannot find "{q}" in your list. Add it first!'], ['"{q}" is not on your list. Add it.'], ['"{q}" is not tracked.']],
  voiceSet: [['Cheerful merchant mode: on!'], ['Sassy mode on. Do not say I did not warn you.'], ['Calm trader mode. Breathe.']],
  moverDown: [['{name} dropped {pct}% ({from} to {to}). Bargain hunters, assemble!', 'Whoa: {name} fell {pct}%, now {to}!'], ['{name} lost {pct}% ({from} to {to}). Somebody panicked.', 'Cheap {name}: -{pct}%. You are welcome.'], ['{name} eased {pct}%, from {from} to {to}.', 'A quiet drop: {name} is {pct}% lower.']],
  moverUp: [['{name} jumped {pct}% ({from} to {to})! If you have any, sell!', 'Look at {name}: +{pct}%, now {to}!'], ['{name} is up {pct}% ({from} to {to}). Greedy market.', 'Pricey {name}: +{pct}%. Do not buy now.'], ['{name} rose {pct}%, from {from} to {to}.', 'A firm rise: {name} is {pct}% higher.']],
  bargain: [['{name} is {pct}% under its usual price ({to} instead of about {avg}). Tempting!', 'Deal alert: {name} at {to}, usually about {avg}!'], ['{name} at {to}? It usually costs about {avg}. I would grab it.', '{pct}% below normal for {name}. Even I want one.'], ['{name} sits {pct}% below its average ({to} against about {avg}).', 'A calm opportunity: {name} at {to}.']],
  moverNone: [['Nothing moved much since your last scans. A calm market!', 'Quiet market: no big swings.'], ['Nothing moved. Boring. I love it.', 'The market sleeps. So can you.'], ['No notable change since your last scans.', 'Prices are steady.']],
  bargainNone: [['No bargains in your list right now. I will keep my eyes open!'], ['Nothing cheap. The market is stingy today.'], ['No item is far below its usual price.']],
  recap: [['Today so far: {scans} scan{sp}, {saved} price{pp} saved{best}. Nice work!', 'Recap time! {scans} scan{sp}, {saved} price{pp} saved{best}.'], ['Session recap: {scans} scan{sp}, {saved} price{pp} saved{best}. I did most of the work.', '{scans} scan{sp}, {saved} price{pp}{best}. You are welcome.'], ['This session: {scans} scan{sp}, {saved} price{pp} saved{best}.', 'So far: {scans} scan{sp} and {saved} price{pp} recorded{best}.']],
  recapNone: [['Nothing scanned yet this session. Let us fix that!'], ['No scans yet. The coin is bored.'], ['No scans this session yet.']],
  recapBest: [[', and your best craft is {name} (+{profit})'], ['. Best craft: {name}, +{profit}'], ['; the best craft is {name}, +{profit}']],
  habitHour: [['You usually scan around {h}h. A true {kind}!', 'Noticed something: you scan around {h}h, every time.'], ['You scan around {h}h like clockwork. Creature of habit.', '{h}h again? I could set my watch.'], ['Your scans cluster around {h}h.', 'You tend to scan near {h}h.']],
  habitTab: [['You love the {tab} tab: {n} visits so far!', 'The {tab} tab is your favourite ({n} visits).'], ['The {tab} tab again. {n} visits. Obsessed.', '{n} visits to {tab}. Get a room.'], ['The {tab} tab is where you spend most time ({n} visits).', 'Most visited: {tab}, {n} times.']],
  habitAccept: [['You accept about {pct}% of what I find. I am doing great!', 'You say yes {pct}% of the time. I like us.'], ['You accept {pct}% of my finds. The rest is your loss.', '{pct}% accepted. I will take the compliment.'], ['You accept about {pct}% of the prices I read.', 'Acceptance rate: {pct}%.']],
  habitStreak: [['{n} days in a row at the market! Keep the streak!', 'A {n}-day streak. Nice!'], ['{n} days straight. Do you ever sleep?', '{n} days in a row. Impressive. Concerning.'], ['{n} consecutive days of trading.', 'A steady {n}-day streak.']],
  habitNone: [['I am still learning your habits. Scan a few times and I will tell you what I notice!'], ['Not enough data yet. Give me a few scans.'], ['Too early to say. A few more scans.']],
  autoScan: [['Prices are getting old, so I am scanning for you!', 'Scanning now, you keep playing!'], ['Stale prices. Scanning. You are welcome.', 'I took the liberty of scanning.'], ['The prices were aging, so I am renewing them.', 'A quiet scan, to keep things current.']],
  tour: [['Psst, have you tried the {tab} tab? {tip}', 'Have you met the {tab} tab? {tip}'], ['You never open {tab}. {tip}', 'Look at {tab}. {tip}'], ['The {tab} tab waits for you. {tip}', 'You may like {tab}. {tip}']],
  chatter: [['I wonder what the Pépite price will do today…', 'Do you think Tofus dream of kamas?', 'I am practising my walk. How is it?'], ['Do not mind me, just guarding the profit.', 'I could stare at price charts all day. And I do.', 'Hmm. Hmm hmm. Hmm.'], ['The market breathes in, the market breathes out.', 'Calm hands, sharp eyes.', 'Patience is a kind of profit.']],
  nap: [['Time for a little nap… call me if prices move!', 'Nobody here? Nap time, then!', 'Zzz… I am only resting my coin.'], ['Wake me when someone does something.', 'Fine, I will nap. Do not touch my prices.', 'Naptime. Try not to lose kamas without me.'], ['Resting my eyes. Only for a moment.', 'Quiet hours. I will rest a while.', 'A short sleep, then back to the ledger.']],
  wake: [['I am awake! I am awake!', 'Back! What did I miss?'], ['Oh. You are back.', 'Mm? Oh. Hello.'], ['Awake again.', 'Ah, you are here.']],
  dance: [['Watch this!', 'Dance party!', 'Ta-daa!'], ['Fine, one dance.', 'Ready? Do not film this.', 'Only because you asked.'], ['A short dance, then.', 'For the market gods.', 'Observe.']],
  walkSay: [['Off I go!', 'Walking the market!'], ['Walking. Do not follow.', 'Stretching my legs.'], ['A short walk.', 'Let me look around.']],
  joke: [['Why did the Pépite cross the market? To get to the better price!', 'I asked the market for a raise. It said my price fell 12%.'], ['I would tell you a joke about inflation, but it would cost too much.', 'Why do crafters never lose? They always have a recipe.'], ['A merchant is a person who buys low and hopes.', 'Patience: the oldest trading strategy.']],
  sing: [['La la la, kamas kamas kamas!', 'Sell high, buy low, la la la!'], ['I will not sing. ...La la... fine.', 'Never ask me to sing. La la la.'], ['A quiet hum for the ledger.', 'Mm mm mm, mm mm mm mm.']],
  jumpSay: [['Boing!', 'Wheee!'], ['Boing. Happy?', 'Jump jump.'], ['Up and down.', 'A small leap.']],
  point: [['Look over here!', 'This one!', 'Check this out!'], ['That. Look at that.', 'Right there.', 'You are welcome.'], ['Here.', 'Consider this.', 'This is worth a look.']],
  pendingPoint: [['Your {n} waiting price{p} are right here!', 'Over here: {n} price{p} to approve!'], ['{n} price{p} waiting right here. I will not nag. Much.', 'Approve the {n} price{p}. Here. Click.'], ['{n} price{p} wait here for your approval.', 'Your approval window, with {n} price{p}.']],
  lieBack: [["Ahh, this is comfy!", "Look at me, relaxing on the market!", "Best spot in town."], ["Do not mind me. Resting.", "I am lying here on purpose."], ["Lying down. Do not judge.", "A quick rest."]],
  lieBelly: [["Belly down, nose in the market!", "Spying on the prices from up here!", "Wheee, flat as a pancake!"], ["Belly down. Do not look.", "Studying prices. Lying down."], ["Flat. Observing.", "Resting, face down."]],
  lieSleep: [["Zzz... five more minutes...", "Just a tiny nap, shh..."], ["Zzz... leave me alone...", "Shh. I am asleep."], ["Zzz...", "Asleep. Obviously."]],
  getUp: [["Back to work!", "Okay, up we go!", "Rested and ready!"], ["Fine. Up.", "Back to the grind."], ["Up again.", "Rest is over."]],
  dizzy: [["Whoa... everything is spinning!", "Too much shaking... I am dizzy!", "Hehe, so many pretty stars..."], ["Please stop shaking me.", "Ow. Everything is spinning."], ["That was rude. I am dizzy.", "Stars. I see stars."]],
};
const TIPS_BY_TAB = {
  craft: 'The craft calculator turns ingredient prices into profit.',
  rec: 'Recycling shows how many Pépites an item gives and what they sell for.',
  bri: 'Brisage tells you if breaking an item for runes pays off.',
  tax: 'Sell and tax tells you the price to list at so you keep what you want.',
  db: 'History keeps every scan and price I saved.',
  data: 'Game data is where recipes and pictures get updated.',
};
const TAB_NAMES = { items: 'Items', cap: 'Scan', log: 'Chat log', craft: 'Craft', rec: 'Recycling', bri: 'Brisage', tax: 'Sell & tax', db: 'History', data: 'Game data' };
export const tabName = (k) => TAB_NAMES[k] || k;

// Picks a line for (key, voice). A given line is not reused until the others of that key have been used (memory per key).
export function createVoice(opts) {
  const rng = (opts && opts.rng) || Math.random;
  let voice = opts && VOICES.includes(opts.voice) ? opts.voice : 'merchant';
  const used = {};
  const part = (d) => { const h = (d || new Date()).getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };
  return {
    get voice() { return voice; },
    setVoice(v) { if (VOICES.includes(v)) voice = v; },
    pool(key) { const p = LINES[key]; return p ? p[VOICES.indexOf(voice)] : []; },
    say(key, vars) {
      const pool = this.pool(key); if (!pool.length) return '';
      const id = key + '|' + voice, seen = used[id] || (used[id] = []);
      let fresh = pool.map((_, i) => i).filter((i) => !seen.includes(i));
      if (!fresh.length) { used[id] = seen.slice(-1); fresh = pool.map((_, i) => i).filter((i) => !used[id].includes(i)); if (!fresh.length) fresh = pool.map((_, i) => i); }
      const i = fresh[Math.floor(rng() * fresh.length) % fresh.length];
      (used[id] = used[id] || []).push(i);
      return fillTpl(pool[i], Object.assign({ part: part() }, vars));
    },
  };
}
export const tabTip = (k) => TIPS_BY_TAB[k] || '';

// ---------------------------------------------------------------- analysis of prices
// recs: [{ id, name, kind, price, priceAt, history: [[ts, value], ...] }]
export function analyzeMarket(recs, now, opts) {
  const watch = (opts && opts.watch) || null;
  const horizon = ((opts && opts.horizonDays) || 7) * DAY, moveMin = (opts && opts.moveMin) || 0.1, bargainMin = (opts && opts.bargainMin) || 0.12;
  const movers = [], bargains = [], volatile = [];
  (recs || []).forEach((r) => {
    const h = (r.history || []).filter((p) => Array.isArray(p) && p[1] > 0);
    if (h.length < 2) return;
    const last = h[h.length - 1], prev = h[h.length - 2];
    if (now - last[0] <= horizon) {
      const pct = (last[1] - prev[1]) / prev[1];
      const mm = watch && watch.has(r.id) ? Math.min(moveMin, 0.05) : moveMin;   // items you keep asking about: smaller moves count
      if (Math.abs(pct) >= mm) movers.push({ watched: !!(watch && watch.has(r.id)), id: r.id, name: r.name, dir: pct > 0 ? 'up' : 'down', pct: Math.round(Math.abs(pct) * 100), from: prev[1], to: last[1], at: last[0] });
    }
    if (h.length >= 3 && r.price && r.priceAt && now - r.priceAt <= horizon * 2) {
      const base = h.slice(0, -1).map((p) => p[1]), avg = base.reduce((t, v) => t + v, 0) / base.length;
      const gap = (avg - r.price) / avg;
      if (gap >= bargainMin) bargains.push({ id: r.id, name: r.name, pct: Math.round(gap * 100), price: r.price, avg: Math.round(avg), at: r.priceAt });
    }
    if (h.length >= 5) {
      const vals = h.map((p) => p[1]), avg = vals.reduce((t, v) => t + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((t, v) => t + (v - avg) * (v - avg), 0) / vals.length);
      if (avg > 0 && sd / avg >= 0.25) volatile.push({ id: r.id, name: r.name, swing: Math.round((sd / avg) * 100) });
    }
  });
  movers.sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0) || b.pct - a.pct); bargains.sort((a, b) => b.pct - a.pct); volatile.sort((a, b) => b.swing - a.swing);
  return { movers, bargains, volatile, tracked: (recs || []).length };
}

// ---------------------------------------------------------------- memory: small counters, kept on this computer
export function emptyMem() {
  return { scans: [], tabs: {}, hours: {}, days: {}, accepts: 0, refused: 0, manualAll: 0, refusals: {}, dismissed: {}, asks: {}, seen: {}, lastRecap: 0, lastAutoScan: 0, session: { start: 0, scans: 0, saved: 0 } };
}
export function normalizeMem(raw) {
  const m = Object.assign(emptyMem(), raw && typeof raw === 'object' ? raw : {});
  m.scans = (Array.isArray(m.scans) ? m.scans : []).filter(Number.isFinite).slice(-40);
  ['tabs', 'hours', 'days', 'refusals', 'dismissed', 'asks', 'seen'].forEach((k) => { if (!m[k] || typeof m[k] !== 'object') m[k] = {}; });
  const dk = Object.keys(m.days).sort(); dk.slice(0, Math.max(0, dk.length - 45)).forEach((k) => delete m.days[k]);
  const sk = Object.keys(m.seen); if (sk.length > 80) sk.sort((a, b) => m.seen[a] - m.seen[b]).slice(0, sk.length - 80).forEach((k) => delete m.seen[k]);
  m.session = Object.assign({ start: 0, scans: 0, saved: 0 }, m.session);
  return m;
}
export const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export function analyzeHabits(mem, now) {
  const out = { facts: [], scanCount: mem.scans.length, usualHour: null, favTab: null, acceptRate: null, streak: 0 };
  if (mem.scans.length >= 4) {
    const hrs = mem.scans.map((t) => new Date(t).getHours()).sort((a, b) => a - b);
    out.usualHour = hrs[Math.floor(hrs.length / 2)];
    const h = out.usualHour;
    out.facts.push({ key: 'habitHour', vars: { h, kind: h >= 22 || h < 5 ? 'night owl' : h < 9 ? 'early bird' : 'daytime trader' } });
  }
  const tabs = Object.entries(mem.tabs).filter(([k]) => k !== 'items').sort((a, b) => b[1] - a[1]);
  if (tabs.length && tabs[0][1] >= 5) { out.favTab = tabs[0][0]; out.facts.push({ key: 'habitTab', vars: { tab: tabName(tabs[0][0]), n: tabs[0][1] } }); }
  const total = mem.accepts + mem.refused;
  if (total >= 6) { out.acceptRate = Math.round((mem.accepts / total) * 100); out.facts.push({ key: 'habitAccept', vars: { pct: out.acceptRate } }); }
  let d = now, streak = 0;
  if (!mem.days[dayKey(d)]) d -= DAY;
  while (mem.days[dayKey(d)]) { streak++; d -= DAY; }
  out.streak = streak;
  if (streak >= 3) out.facts.push({ key: 'habitStreak', vars: { n: streak } });
  return out;
}

export function recapVars(mem, best) {
  const s = mem.session || {};
  return { scans: s.scans || 0, sp: (s.scans || 0) === 1 ? '' : 's', saved: s.saved || 0, pp: (s.saved || 0) === 1 ? '' : 's', best: '', bestRaw: best || null };
}

// ---------------------------------------------------------------- understanding what you type
const edit1 = (a, b) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
};
const KEYWORDS = [
  ['movers', ['trend', 'trends', 'mover', 'movers', 'changed', 'change', 'moved', 'jumped', 'dropped', 'drop', 'baisse', 'hausse', 'variation', 'news']],
  ['bargains', ['bargain', 'bargains', 'deal', 'deals', 'cheap', 'opportunity', 'opportunities', 'soldes', 'affaire', 'affaires']],
  ['habits', ['habit', 'habits', 'routine', 'learned', 'habitude', 'habitudes']],
  ['recap', ['recap', 'summary', 'bilan', 'resume', 'session']],
  ['dance', ['dance', 'danse', 'dancing', 'boogie']],
  ['jump', ['jump', 'saute', 'hop']],
  ['sing', ['sing', 'chante', 'song']],
  ['lie', ['lie', 'lay', 'laying', 'allonge', 'couche', 'relax', 'rest']],
  ['turn', ['turn', 'side', 'profile', 'tourne']],
  ['joke', ['joke', 'blague', 'funny', 'laugh']],
  ['walk', ['walk', 'marche', 'wander', 'roam', 'explore', 'patrol']],
];
const TABS = { items: 'items', scan: 'cap', 'chat log': 'log', chat: 'log', craft: 'craft', recycling: 'rec', recycle: 'rec', brisage: 'bri', 'sell and tax': 'tax', tax: 'tax', history: 'db', 'game data': 'data', data: 'data' };
export const TAB_WORDS = TABS;

export function understand(raw) {
  const q = nrm(raw).replace(/[?!]+$/g, '').trim();
  if (!q) return null;
  const go = q.match(/^(?:go to|open|show me|take me to|switch to)\s+(?:the\s+)?(?:tab\s+)?(.+?)(?:\s+tab)?$/);
  if (go && TABS[go[1].replace(/&/g, 'and')]) return { intent: 'go', tab: TABS[go[1].replace(/&/g, 'and')], label: go[1] };
  const add = q.match(/^(?:add|track)\s+(.{3,})$/);
  if (add && !/^(up|it)$/.test(add[1])) return { intent: 'add', name: String(raw).trim().replace(/^(add|track)\s+/i, '') };
  if (/^(accept|approve|save)\b/.test(q) && /(clean|all|price|them|selected)/.test(q)) return { intent: 'accept' };
  if (/^(scan|read the market|scan now)\b/.test(q)) return { intent: 'scan' };
  if (/^(share|start sharing)\b/.test(q)) return { intent: 'share' };
  const where = q.match(/^where (?:can i|do i|is the|are the)\s+(.+)$/);
  if (where && /add/.test(where[1])) return { intent: 'where-add' };
  if (/(^|\b)(hi|hello|hey|salut|bonjour|salam|yo)\b/.test(q)) return { intent: 'hi' };
  if (/(thank|merci|shukran)/.test(q)) return { intent: 'thanks' };
  if (/(^|\b)(help|aide|what can you|que sais)/.test(q)) return { intent: 'help' };
  const named = q.match(/(?:price|prix|cost|how much(?: is| for)?|worth|recipe|recette|ingredients?|combien)\s+(?:of|for|de|du|d'|la|le|les)?\s*(.+)$/);
  if (named && named[1] && !/^(craft|crafts|profit)$/.test(named[1].trim())) return { intent: 'item', name: named[1].replace(/[?!.]+$/, ''), recipe: /(recipe|recette|ingredient)/.test(q) };
  const toks = q.split(/[^a-z0-9']+/).filter(Boolean);
  for (const [intent, words] of KEYWORDS) {
    if (toks.some((t) => words.includes(t) || (t.length >= 5 && words.some((w) => w.length >= 5 && edit1(t, w))))) {
      // "what changed" style questions are about prices; a bare "summary"/"session" is the recap
      return { intent };
    }
  }
  if (/(best|craft|profit|rentable|should i|what to make|meilleur)/.test(q)) return { intent: 'best' };
  if (/(old|stale|refresh|outdated|missing|vieux|ancien)/.test(q)) return { intent: 'old' };
  if (/(budget|kamas|argent|how much do i have)/.test(q)) return { intent: 'budget' };
  if (/(waiting|pending|approve|attente)/.test(q)) return { intent: 'waiting' };
  if (/(what do you know|about me|know me|connais)/.test(q)) return { intent: 'habits' };
  return { intent: 'lookup', name: String(raw).trim() };
}

// A hint for the "curious" answer, based on what is going on, so that even a wrong question leads somewhere useful.
export function curiousHint(sum, market, rng) {
  const r = rng || Math.random, opts = [];
  if (market && market.movers && market.movers.length) opts.push('Try "what changed?" and I will tell you who moved.');
  if (market && market.bargains && market.bargains.length) opts.push('Try "bargains": I think I spotted a cheap one.');
  if (sum && sum.best) opts.push('Try "best crafts": ' + sum.best.name + ' looks good.');
  if (sum && sum.pending) opts.push('You have ' + sum.pending + ' price' + (sum.pending > 1 ? 's' : '') + ' waiting: say "accept the clean ones".');
  opts.push('Try "help" to see what I know.', 'Ask "my habits" and I will tell you what I noticed about you.', 'Say "dance" if you only want to have fun.');
  return opts[Math.floor(r() * opts.length) % opts.length];
}

// ---------------------------------------------------------------- what he does on his own
// ctx: { now, rng, gap, sinceAct, idleMs, auto, canScan, st:{stream,scanning,live}, sum:{pending,clean,stale,best,tracked},
//        market:{movers,bargains}, habits, mem, tabsSeen }
// Returns { kind, ... } or null. The caller records `seen` and `act`, runs the plan, and decides what is allowed.
const TOUR_TABS = ['craft', 'rec', 'bri', 'tax', 'db', 'data'];
const fresh = (mem, key, now, ttl) => !(mem.seen[key] && now - mem.seen[key] < ttl);
export function planNext(c) {
  const { now, mem, st, sum } = c, rng = c.rng || Math.random;
  if (!c.auto || st.scanning) return null;
  if (c.sinceAct < (c.gap === undefined ? 9000 : c.gap)) return null;
  if (c.idleMs < 3500) return null;   // you are doing something right now: he does not pester
  if (c.idleMs > 180000) return { kind: 'nap' };

  if (sum.pending > 0 && c.idleMs > 18000 && fresh(mem, 'pend:' + sum.pending, now, 15 * 60000)) return { kind: 'point-pending', seen: 'pend:' + sum.pending, n: sum.pending };
  if (c.canScan && st.stream && sum.stale >= 10 && c.idleMs > 60000 && now - (mem.lastAutoScan || 0) > 10 * 60000) return { kind: 'scan', seen: null };
  const mv = (c.market.movers || []).find((m) => fresh(mem, 'mv:' + m.id + ':' + m.at, now, 12 * 3600000));
  if (mv) return { kind: 'mover', item: mv, seen: 'mv:' + mv.id + ':' + mv.at };
  const bg = (c.market.bargains || []).find((b) => fresh(mem, 'bg:' + b.id + ':' + b.at, now, 12 * 3600000));
  if (bg) return { kind: 'bargain', item: bg, seen: 'bg:' + bg.id + ':' + bg.at };
  if ((mem.session.scans || 0) >= 2 && c.idleMs > 40000 && now - (mem.lastRecap || 0) > 30 * 60000) return { kind: 'recap', seen: null };
  const hb = (c.habits.facts || []).find((f) => fresh(mem, 'hb:' + f.key, now, 6 * 3600000));
  if (hb && rng() < 0.5) return { kind: 'habit', fact: hb, seen: 'hb:' + hb.key };
  const unseen = TOUR_TABS.filter((k) => !(mem.tabs[k] > 0) && fresh(mem, 'tour:' + k, now, 24 * 3600000));
  if (unseen.length && rng() < 0.3) { const tab = unseen[Math.floor(rng() * unseen.length) % unseen.length]; return { kind: 'tour', tab, seen: 'tour:' + tab }; }

  const r = rng();
  if (r < 0.42) return { kind: 'wander' };
  if (r < 0.62) return { kind: 'chatter' };
  if (r < 0.8 && sum.best) return { kind: 'point-best' };
  if (r < 0.9) { const mv = ['dance', 'jump', 'lie', 'lie', 'side']; return { kind: 'play', move: mv[Math.floor(rng() * mv.length) % mv.length] }; }
  return { kind: 'wander' };
}
