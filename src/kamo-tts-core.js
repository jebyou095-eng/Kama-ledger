// Pure helpers for Kamo's live voice (shared by the page and the voice worker; tested).
import VOCAB from './kokoro-vocab.js';

export const STYLE = 256, MAX_TOK = 500, RATE = 1.15;   // RATE: the "cute" version is a little higher and quicker

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

