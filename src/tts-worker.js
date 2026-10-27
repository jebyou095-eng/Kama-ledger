// Kamo's live voice runs here, off the page, so the app never freezes while he thinks of a sentence.
import { cleanPhonemes, toTokens, chunkText, speakable, STYLE, MAX_TOK } from './kamo-tts-core.js';
import VOICE_B64 from './voice-bf-lily.js';

let ort = null, session = null, voice = null, phonemize = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1;
      if (m.wasm) ort.env.wasm.wasmBinary = m.wasm; else ort.env.wasm.wasmPaths = m.wasmPaths;
      session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'] });
      const raw = atob(VOICE_B64), u8 = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
      voice = new Float32Array(u8.buffer);
      phonemize = (await import('phonemizer')).phonemize;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'synth') {
      const parts = [];
      for (const piece of chunkText(speakable(m.text))) {
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
      self.postMessage({ type: 'audio', id: m.id, audio: a }, [a.buffer]);
    }
  } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};
