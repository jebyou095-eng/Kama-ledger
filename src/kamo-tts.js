// Kamo's live voice: the same bf_lily voice, made on this computer from any sentence (prices, item names, answers).
// Needs the optional voice engine (the model file); without it he keeps using his recorded lines and short reactions.
import VOCAB from './kokoro-vocab.js';
import VOICE_B64 from './voice-bf-lily.js';

const STYLE = 256, MAX_TOK = 500, RATE = 1.15;   // RATE: the "cute" version is a little higher and quicker

// Pure helpers (tested)
export function cleanPhonemes(p) {
  return String(p || '')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z').trim();
}
export function toTokens(ph) { const out = [0]; for (const ch of ph) { const id = VOCAB[ch]; if (id !== undefined) out.push(id); } out.push(0); return out; }
// Reads the sentence the way it should be said: no emojis, symbols turned into words, "%" as "percent".
export function speakable(text) {
  return String(text || '').replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ' ').replace(/(\d)\s?%/g, '$1 percent').replace(/\s*→\s*/g, ' to ').replace(/[×x](?=\d)/g, ' times ')
    .replace(/(\d)[\s\u202f\u00a0](?=\d{3}\b)/g, '$1').replace(/(^|\s)\+(?=\d)/g, '$1plus ').replace(/(^|\s)[-−](?=\d)/g, '$1minus ')
    .replace(/(\d)\s*k\b/gi, '$1 thousand').replace(/\s*[()]\s*/g, ', ').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
}
export function chunkText(text, max) {
  const m = max || 220, parts = String(text).split(/(?<=[.!?…])\s+/).filter(Boolean), out = [];
  parts.forEach((p) => { let s = p; while (s.length > m) { const i = s.lastIndexOf(',', m) > 40 ? s.lastIndexOf(',', m) : s.lastIndexOf(' ', m); const cut = i > 20 ? i : m; out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1); } if (s.trim()) out.push(s.trim()); });
  return out;
}
// Loudness every 50 ms (0-9 as digits), the same format as the recorded clips, so his mouth can follow it.
export function envFromAudio(a, sr, speedup) {
  const n = Math.max(1, Math.round(sr * 0.05 * (speedup || 1))), r = [];
  for (let i = 0; i + n <= a.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += a[j] * a[j]; r.push(Math.sqrt(s / n)); }
  if (!r.length) return '';
  const ref = [...r].sort((x, y) => x - y)[Math.floor(r.length * 0.95)] + 1e-6;
  return r.map((v) => Math.min(9, Math.round(v / ref * 9))).join('');
}

export function createTTS(opts) {
  const o = opts || {};
  let ort = null, session = null, voice = null, phonemize = null, state = 'idle', ctx = null, cur = null;   // idle | loading | ready | missing
  const cache = new Map();
  const base = () => new URL('./', document.baseURI).href;
  async function modelBytes() {
    const br = window.kamaDesktopCapture;
    if (br && br.voiceModel) { const b = await br.voiceModel(); if (b) return b; }
    try { const r = await fetch(base() + 'voice-engine/kokoro.int8.onnx'); if (r.ok) return await r.arrayBuffer(); } catch { /* not there */ }
    return null;
  }
  async function load() {
    if (state === 'ready' || state === 'missing') return state === 'ready';
    if (state === 'loading') return o.wait ? o.wait() : false;
    state = 'loading';
    try {
      const bytes = await modelBytes();
      if (!bytes) { state = 'missing'; return false; }
      if (o.onLoading) o.onLoading();
      ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1;
      // the app cannot fetch files from disk, so the desktop app hands over the engine's wasm itself; in a browser it is fetched
      const br = window.kamaDesktopCapture, wasm = br && br.voiceWasm ? await br.voiceWasm() : null;
      if (wasm) ort.env.wasm.wasmBinary = wasm; else ort.env.wasm.wasmPaths = base() + 'ort/';
      session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
      const raw = atob(VOICE_B64), u8 = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
      voice = new Float32Array(u8.buffer);
      phonemize = (await import('phonemizer')).phonemize;
      state = 'ready'; return true;
    } catch (e) { state = 'missing'; if (o.onError) o.onError(e); return false; }
  }
  async function synth(text) {
    const parts = [];
    for (const piece of chunkText(speakable(text))) {
      const ph = cleanPhonemes((await phonemize(piece, 'en'))[0] || '');
      let tok = toTokens(ph); if (tok.length > MAX_TOK) tok = tok.slice(0, MAX_TOK);
      const n = Math.min(Math.max(tok.length - 2, 0), 509), style = voice.slice(n * STYLE, n * STYLE + STYLE);
      const out = await session.run({ tokens: new ort.Tensor('int64', BigInt64Array.from(tok.map(BigInt)), [1, tok.length]), style: new ort.Tensor('float32', style, [1, STYLE]), speed: new ort.Tensor('float32', new Float32Array([1.1]), [1]) });
      parts.push(out.audio.data);
    }
    const gap = 6000, total = parts.reduce((s, p) => s + p.length, 0) + gap * Math.max(0, parts.length - 1), a = new Float32Array(total);
    let at = 0; parts.forEach((p) => { a.set(p, at); at += p.length + gap; });
    let peak = 0; for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]));
    if (peak > 0) for (let i = 0; i < a.length; i++) a[i] = a[i] / peak * 0.9;
    return a;
  }
  const audio = () => { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; } };
  function stop() { try { if (cur) { cur.src.onended = null; cur.src.stop(); } } catch { /* done */ } if (cur) { cancelAnimationFrame(cur.raf); if (o.onLevel) o.onLevel(-1); if (o.onTalk) o.onTalk(false); } cur = null; }
  function play(a, env) {
    const c = audio(); if (!c) return;
    stop();
    const buf = c.createBuffer(1, a.length, 24000); buf.copyToChannel(a, 0);
    const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = RATE;
    const g = c.createGain(); g.gain.value = 0.9; src.connect(g); g.connect(c.destination);
    const t0 = c.currentTime; cur = { src, raf: 0 };
    const loop = () => { if (!cur || cur.src !== src) return; const i = Math.floor((c.currentTime - t0) * 20); if (o.onLevel) o.onLevel(env ? (+env[i] || 0) / 9 : -1); cur.raf = requestAnimationFrame(loop); };
    src.onended = () => { stop(); };
    if (o.onTalk) o.onTalk(true, null, env);
    src.start(); loop();
  }
  return {
    get state() { return state; },
    load,
    // Says a sentence. Resolves true when the live voice handled it, false when it is not available (caller falls back).
    async say(text) {
      const key = String(text).trim(); if (!key) return false;
      if (state !== 'ready' && !(await load())) return false;
      let hit = cache.get(key);
      if (!hit) { const a = await synth(key); hit = { a, env: envFromAudio(a, 24000, RATE) }; cache.set(key, hit); if (cache.size > 60) cache.delete(cache.keys().next().value); }
      play(hit.a, hit.env); return true;
    },
    stop,
  };
}
