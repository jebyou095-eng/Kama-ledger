import { PLAN } from './diag-plan.js';
import * as scan from './scan.js';

const r1 = (v) => Math.round(v);
const boxOf = (b) => b ? [r1(b.x), r1(b.y), r1(b.w), r1(b.h)] : null;

// Reads everything exactly like a scan but WRITES NOTHING to the lists. Returns one small JSON object.
export async function runDiagnostics(ctx) {
  const { grab, P, snapItem, parsePopup, parseLots, parseBudget, includeChat, status, appVersion } = ctx;
  const t00 = performance.now();
  const out = { v: 1, plan: PLAN.id, app: appVersion, at: new Date().toISOString(), env: { cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory || null, dpr: window.devicePixelRatio, screen: [screen.width, screen.height], ua: navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 120) }, frames: [], notes: [] };
  const types = P ? Object.values(P.idx.types) : [];
  for (let n = 0; n < PLAN.frames; n++) {
    if (n) await new Promise((r) => setTimeout(r, PLAN.frameGapMs));
    const frame = await grab(n);
    if (!frame) { out.notes.push('frame ' + n + ': no picture available'); continue; }
    status('Frame ' + (n + 1) + '/' + PLAN.frames + ': finding panels...');
    const F = { i: n, size: [frame.width, frame.height], ms: {}, err: [] };
    let t = performance.now();
    let prof;
    try { prof = await scan.autoDetect(frame); } catch (e) { F.err.push('detect: ' + e.message); out.frames.push(F); continue; }
    F.ms.detect = r1(performance.now() - t); F.k = prof._k;
    F.panels = Object.fromEntries(Object.keys(prof).map((k) => [k, boxOf({ x: prof[k].x * frame.width, y: prof[k].y * frame.height, w: prof[k].w * frame.width, h: prof[k].h * frame.height })]));
    F.words = prof._words.map((w) => [w.text, r1(w.x0), r1(w.y0), r1(w.x1), r1(w.y1), w.conf]);
    const L = prof._layout || {};
    if (L.market) F.marketLayout = { cols: Object.fromEntries(Object.entries(L.market.cols).map(([k, v]) => [k, r1(v)])), rows: L.market.rows.map((r) => [r1(r.y0), r1(r.y1)]), pitch: r1(L.market.pitch) };
    F.crops = {};
    const crop = (key, box) => { try { F.crops[key] = scan.cropJpeg(frame, box, PLAN.cropWidth, PLAN.cropQuality); } catch (e) { F.err.push('crop ' + key); } };
    for (const key of Object.keys(prof)) {
      if (key === 'chat' && !includeChat) continue;
      const fb = prof[key]; crop(key, { x: fb.x * frame.width, y: fb.y * frame.height, w: fb.w * frame.width, h: fb.h * frame.height });
    }
    if (prof.market) {
      status('Frame ' + (n + 1) + ': reading the market list...'); t = performance.now();
      try {
        const m = await scan.readMarketList(frame, prof.market, types, L.market);
        F.ms.market = r1(performance.now() - t);
        F.market = m.rows.map((r) => { const s = P ? snapItem(P, r.rawName, r.level, r.type) : null; return { raw: r.rawName, conf: r.nameConf, type: r.type, lvl: r.level, price: r.price, sure: r.priceSure, reads: r.priceReads, glyphs: r.glyphs, match: s ? [s.item[0], s.item[1], +s.sim.toFixed(2), s.folded ? 'folded' : s.ambiguous ? 'ambiguous' : ''] : null }; });
      } catch (e) { F.err.push('market: ' + e.message); }
    }
    if (prof.popup) {
      t = performance.now();
      try {
        const lines = await scan.readText(frame, prof.popup, 'white');
        const pop = parsePopup(lines), s = P ? snapItem(P, pop.name, pop.level, pop.type) : null;
        F.ms.popup = r1(performance.now() - t);
        F.popup = { lines, pop, lots: parseLots(lines.join('\n')), match: s ? [s.item[0], s.item[1], +s.sim.toFixed(2)] : null };
      } catch (e) { F.err.push('popup: ' + e.message); }
    }
    if (prof.recipe) { try { F.recipe = { lines: await scan.readText(frame, prof.recipe, 'white') }; } catch (e) { F.err.push('recipe: ' + e.message); } }
    if (prof.budget) { try { const raw = await scan.readNumber(frame, prof.budget); F.budget = { raw, value: parseBudget(raw) }; } catch (e) { F.err.push('budget: ' + e.message); } }
    if (prof.chat) F.chat = { found: true, shared: !!includeChat };
    // Same screen read at several scales: how long it takes and which panels are still found.
    F.kSweep = [];
    for (const k of PLAN.kSweep || []) {
      status('Frame ' + (n + 1) + ': speed test at scale ' + k + '...'); t = performance.now();
      try { const p = await scan.autoDetect(frame, k); F.kSweep.push({ k, ms: r1(performance.now() - t), found: Object.keys(p), words: p._words.length, rows: p._layout.market ? p._layout.market.rows.length : 0 }); } catch (e) { F.kSweep.push({ k, err: e.message }); }
    }
    out.frames.push(F);
  }
  out.pool = scan.poolSize();
  out.totalMs = r1(performance.now() - t00);
  return out;
}
