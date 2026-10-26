// "Wait a minute, I will ask a friend": when Kamo cannot answer, the question goes to a shared file (kama-questions.json). Claude, reading it
// through the connector, writes the answer back (kama-answers.json). Kamo shows the answer, and keeps it as knowledge for next time.
import { nrm } from './kamo-brain.js';

const STOP = new Set('the a an of for to is it me my i you what whats how do does did can should and or ou et le la les un une de du des est que qui quel quelle combien pour moi mon ma mes this that in on at with about now today please tell'.split(' '));
export const tokens = (s) => nrm(s).replace(/['’]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));

// Is it worth asking a friend? A real question, not a greeting or a single word.
export function shouldAsk(raw) {
  const t = tokens(raw);
  return String(raw || '').trim().length >= 10 && t.length >= 2;
}

// kb: [{ q, answer, at }]. The best taught answer for this question, when the words overlap enough.
export function kbMatch(kb, raw) {
  const want = new Set(tokens(raw)); if (want.size < 2) return null;
  let best = null;
  (kb || []).forEach((e) => {
    const have = new Set(tokens(e.q)); if (have.size < 2) return;
    let inter = 0; want.forEach((t) => { if (have.has(t)) inter++; });
    const score = inter / (want.size + have.size - inter);
    if (score >= 0.6 && (!best || score > best.score)) best = { score, entry: e };
  });
  return best ? best.entry : null;
}

export const newQuestion = (raw, now) => ({ id: 'q' + now.toString(36) + Math.floor(Math.random() * 1e4).toString(36), q: String(raw).trim().slice(0, 300), at: now });

// questions: what the app sent; open: { id: { q, at } } still waiting; answersFile: parsed kama-answers.json.
// Returns { say: [{ id, text }], open (updated), kb (updated list of taught answers) }.
export function applyAnswers(open, answersFile, seen) {
  const out = { say: [], open: { ...open }, kb: [] };
  const list = answersFile && Array.isArray(answersFile.answers) ? answersFile.answers : [];
  const done = new Set(seen || []);
  list.forEach((a) => {
    if (!a || !a.id || !a.answer || done.has(a.id)) return;
    if (a.id.startsWith('say:') || out.open[a.id]) { out.say.push({ id: a.id, text: String(a.answer).slice(0, 600) }); delete out.open[a.id]; }
  });
  out.kb = list.filter((a) => a && a.remember !== false && a.q && a.answer).map((a) => ({ q: a.q, answer: String(a.answer).slice(0, 600), at: a.at || 0 })).slice(-200);
  return out;
}
