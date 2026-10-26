// Kamo's voice: cute little chirps for every word he says ("babble"), or a real spoken voice from the system (high and quick).
// planBlips is pure (tested); playing needs the browser.
import VOICE from './voice-index.js';
import { createTTS } from './kamo-tts.js';

const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];   // a happy pentatonic run, high like a small coin
const MOOD_SHIFT = { happy: 1.12, scan: 1.06, think: 0.97, idle: 1, sad: 0.82, sleep: 0.75 };

const hash = (w) => { let h = 7; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0; return h; };

// One chirp per word (at most 12): the same word always gets the same note, a question ends upward, an exclamation is brighter.
export function planBlips(text, mood) {
  const words = String(text || '').replace(/[^\p{L}\p{N}'?! ]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 12);
  const shift = MOOD_SHIFT[mood] || 1, out = [];
  words.forEach((w, i) => {
    const base = SCALE[hash(w.toLowerCase()) % SCALE.length] * shift;
    const last = i === words.length - 1, q = /\?$/.test(w), ex = /!$/.test(w);
    out.push({ at: i * 0.105, freq: Math.round(base * (q && last ? 1.26 : 1)), glide: q && last ? 1.2 : ex ? 1.1 : 0.94, dur: Math.min(0.09, 0.04 + w.length * 0.006), gain: ex ? 1 : 0.8 });
  });
  return out;
}

export const MODES = ['voice', 'babble', 'speak', 'off'];

// The same normal form the voice pack was made with: no accents, no punctuation, lower case.
export const voiceKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const voiceFile = (text) => VOICE.lines[voiceKey(text)] || null;
export const envOf = (file) => (VOICE.env && VOICE.env[file]) || '';
export const reactFiles = (mood) => VOICE.react[mood] || VOICE.react.idle;

export function createSound(opts) {
  let mode = MODES.includes(opts && opts.mode) ? opts.mode : 'voice', ctx = null, lastAt = 0, lastText = '', clip = null, reactAt = 0;
  const vol = (opts && opts.volume) || 0.1;
  const audio = () => { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; } };
  function babble(text, mood) {
    const c = audio(); if (!c) return;
    try { opts && opts.onTalk && opts.onTalk(true); setTimeout(() => { try { opts.onTalk(false); } catch { /* ok */ } }, Math.min(3500, 500 + String(text).length * 45)); } catch { /* ok */ }
    const t0 = c.currentTime + 0.02;
    planBlips(text, mood).forEach((b) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(b.freq, t0 + b.at);
      o.frequency.exponentialRampToValueAtTime(b.freq * b.glide, t0 + b.at + b.dur);
      g.gain.setValueAtTime(0.0001, t0 + b.at);
      g.gain.exponentialRampToValueAtTime(vol * b.gain, t0 + b.at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + b.at + b.dur + 0.03);
      o.connect(g); g.connect(c.destination); o.start(t0 + b.at); o.stop(t0 + b.at + b.dur + 0.05);
    });
  }
  // His recorded voice: the exact sentence when it is one of his fixed lines, otherwise a short reaction ("Ooh!", "Hmm...") that fits his mood.
  function play(file) {
    try { tts.stop(); } catch { /* idle */ }
    try { if (clip) { clip.pause(); clip = null; } } catch { /* nothing playing */ }
    const a = new Audio(new URL('./voice/' + file, document.baseURI).href); a.volume = 0.9; clip = a;
    const on = (v) => { try { opts && opts.onTalk && opts.onTalk(v, v ? file : null); } catch { /* the body is optional */ } };
    // his mouth and body follow how loud the clip is at each moment (the loudness was measured when the clip was made)
    const env = envOf(file); let raf = 0;
    const loop = () => { try { opts && opts.onLevel && opts.onLevel(env ? (+env[Math.floor(a.currentTime * 20)] || 0) / 9 : -1); } catch { /* ok */ } raf = requestAnimationFrame(loop); };
    a.addEventListener('playing', () => { cancelAnimationFrame(raf); if (env) loop(); });
    const stop = () => { cancelAnimationFrame(raf); try { opts && opts.onLevel && opts.onLevel(-1); } catch { /* ok */ } };
    a.addEventListener('ended', stop); a.addEventListener('pause', stop); a.addEventListener('error', stop);
    a.addEventListener('playing', () => on(true)); a.addEventListener('ended', () => on(false)); a.addEventListener('pause', () => on(false)); a.addEventListener('error', () => on(false));
    a.play().catch(() => on(false));
  }
  // Live voice for the sentences that are not recorded (prices, item names, answers): made on this computer when the voice engine is installed.
  const tts = createTTS({ onTalk: (v, f, env) => { try { opts && opts.onTalk && opts.onTalk(v, null, env); } catch { /* ok */ } }, onLevel: (l) => { try { opts && opts.onLevel && opts.onLevel(l); } catch { /* ok */ } } });
  let want = 0;
  const shorten = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); if (s.length <= 260) return s; const cut = s.slice(0, 260), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return i > 60 ? cut.slice(0, i + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '.'; };
  function voice(text, mood) {
    const f = voiceFile(text), ticket = ++want;
    if (f) { play(f); return; }
    // "Zzz" is a snore, never spelled out
    const m = String(text).match(/^\s*z{2,}[.… ]*(.*)$/i);
    const rest = m ? m[1] : text;
    if (m) { play('snore.ogg'); if (!/[a-z]/i.test(rest)) return; setTimeout(() => { if (ticket === want) live(rest, mood); }, 2300); return; }
    live(rest, mood, ticket);
  }
  if (mode === 'voice') setTimeout(() => { tts.load().catch(() => {}); }, 5000);   // warm up the live voice while he is idle
  function live(text, mood, ticket) {
    const t = ticket || ++want;
    tts.say(shorten(text.replace(/z{2,}/gi, ' '))).then((ok) => { if (!ok && t === want) react(mood); }).catch(() => { if (t === want) react(mood); });
  }
  function react(mood) {
    const list = reactFiles(mood || 'idle'); if (!list.length) return;
    reactAt = (reactAt + 1 + Math.floor(Math.random() * 3)) % 97;
    play(list[reactAt % list.length]);
  }
  function speak(text, mood) {
    const s = window.speechSynthesis; if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ' ').slice(0, 220));
    const voices = s.getVoices(), fr = /[éèàçùêâîôû]|\b(le|la|les|des|une|prix)\b/i.test(text);
    const want = fr ? /hortense|denise|julie|french|fran/i : /zira|aria|jenny|samantha|susan|hazel|female|english/i;
    const v = voices.find((x) => want.test(x.name) || want.test(x.lang)); if (v) { u.voice = v; u.lang = v.lang; }
    u.pitch = mood === 'sad' ? 1.35 : 1.9; u.rate = mood === 'happy' ? 1.12 : 1.05; u.volume = 0.8;
    u.onstart = () => { try { opts && opts.onTalk && opts.onTalk(true); } catch { /* ok */ } }; u.onend = () => { try { opts && opts.onTalk && opts.onTalk(false); } catch { /* ok */ } };
    s.speak(u);
  }
  return {
    get mode() { return mode; },
    setMode(m) { mode = MODES.includes(m) ? m : 'voice'; if (mode !== 'speak') try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* none */ } },
    say(text, mood) {
      if (mode === 'off' || !text) return;
      const t = Date.now();
      if (t - lastAt < 1200 || text === lastText && t - lastAt < 9000) return;   // never a flood of chirps, never the same line twice in a row
      lastAt = t; lastText = text;
      try { if (mode === 'speak') speak(text, mood); else if (mode === 'voice') voice(text, mood); else babble(text, mood); } catch { /* sound is optional */ }
    },
  };
}
