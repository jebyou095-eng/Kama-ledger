// Kamo's live voice: the same bf_lily voice, made on this computer from any sentence (prices, item names, answers).
// Needs the optional voice engine (the model file); without it he keeps using his recorded lines and short reactions.
// The heavy work runs in a worker (tts-worker.js) so the app never freezes.
import { RATE, cleanPhonemes, toTokens, speakable, chunkText, envFromAudio } from './kamo-tts-core.js';
export { cleanPhonemes, toTokens, speakable, chunkText, envFromAudio };

export function createTTS(opts) {
  const o = opts || {};
  let state = 'idle', ctx = null, cur = null, busy = false;   // idle | loading | ready | missing
  const cache = new Map();
  const base = () => new URL('./', document.baseURI).href;
  async function modelBytes() {
    const br = window.kamaDesktopCapture;
    if (br && br.voiceModel) { const b = await br.voiceModel(); if (b) return b; }
    try { const r = await fetch(base() + 'voice-engine/kokoro.int8.onnx'); if (r.ok) return await r.arrayBuffer(); } catch { /* not there */ }
    return null;
  }
  let worker = null, jobs = new Map(), nextId = 1, loading = null;
  async function load() {
    if (state === 'ready') return true;
    if (state === 'missing') return false;
    if (loading) return loading;
    state = 'loading';
    loading = (async () => {
      try {
        const bytes = await modelBytes();
        if (!bytes) { state = 'missing'; return false; }
        const br = window.kamaDesktopCapture, wasm = br && br.voiceWasm ? await br.voiceWasm() : null;
        worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => { const m = e.data, j = jobs.get(m.id); if (m.type === 'audio' && j) { jobs.delete(m.id); j.res(m.audio); } else if (m.type === 'error') { if (j) { jobs.delete(m.id); j.rej(new Error(m.message)); } else if (o.onError) o.onError(new Error(m.message)); } };
        await new Promise((res, rej) => {
          const prev = worker.onmessage;
          worker.onmessage = (e) => { if (e.data.type === 'ready') { worker.onmessage = prev; res(); } else if (e.data.type === 'error') rej(new Error(e.data.message)); };
          worker.onerror = (ev) => rej(new Error(ev.message || 'voice worker failed'));
          const tr = [bytes]; if (wasm) tr.push(wasm);
          worker.postMessage({ type: 'init', model: bytes, wasm: wasm || null, wasmPaths: base() + 'ort/' }, tr);
        });
        state = 'ready'; return true;
      } catch (e) { state = 'missing'; try { worker && worker.terminate(); } catch { /* gone */ } worker = null; if (o.onError) o.onError(e); return false; }
    })();
    return loading;
  }
  function synth(text) { return new Promise((res, rej) => { const id = nextId++; jobs.set(id, { res, rej }); worker.postMessage({ type: 'synth', id, text }); }); }
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
      if (state !== 'ready') { if (state === 'idle') load().catch(() => {}); return false; }   // the first sentence only wakes the engine up; he uses a reaction sound meanwhile
      let hit = cache.get(key);
      if (!hit) {
        if (busy) return false;   // one sentence at a time: never pile work up
        busy = true;
        try { const a = await synth(key); hit = { a, env: envFromAudio(a, 24000, RATE) }; cache.set(key, hit); if (cache.size > 60) cache.delete(cache.keys().next().value); } finally { busy = false; }
      }
      play(hit.a, hit.env); return true;
    },
    stop,
  };
}
