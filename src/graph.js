// Reads the game's "Cours du marché" chart from a screenshot: item, median, average, sold, and the price curve itself.
// The y-axis labels calibrate the picture (a line fitted through them), the curve is the top edge of the lighter fill, and the solid
// yellow average line is used as a built-in check that the calibration is right.
import { recognize, whiteText } from './scan.js';
import { fitAxis, sampleSeries, parseStats, classifySpan } from './graph-math.js';

// the smallest gap is one step; missing labels only make whole multiples of it, so total distance / total steps is precise
function spacing(ys) {
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((x) => x > 15); if (!gaps.length) return 31.8;
  const s0 = Math.min(...gaps), steps = gaps.reduce((s, x) => s + Math.max(1, Math.round(x / s0)), 0);
  return gaps.reduce((s, x) => s + x, 0) / steps;
}
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

export async function readGraph(frame) {
  const W = frame.width, H = frame.height, ctx = frame.getContext('2d'), img = ctx.getImageData(0, 0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [img[i], img[i + 1], img[i + 2]]; };
  // 1. y-axis labels: digits only, grouped by row
  const lx0 = Math.round(W * 0.03), lw = Math.round(W * 0.14), ly0 = Math.round(H * 0.28), lh = Math.round(H * 0.64), K = 3;
  const d = await recognize(whiteText(frame, { x: lx0, y: ly0, w: lw, h: lh }, K), { psm: 6, whitelist: '0123456789 ' });
  const raw = (d.words || []).filter((w) => /\d/.test(w.text)).map((w) => ({ t: w.text.replace(/\D/g, ''), cy: ly0 + (w.bbox.y0 + w.bbox.y1) / 2 / K, x1: lx0 + w.bbox.x1 / K })).sort((a, b) => a.cy - b.cy);
  // the little coin icon after each label is read as a stray 1 to 2 digit word: drop it
  const words = raw.filter((w, i) => !(w.t.length <= 2 && raw.some((o, j) => j !== i && Math.abs(o.cy - w.cy) < 9 && o.x1 < w.x1 - 6 && w.x1 - o.x1 > 6 && w.x1 === Math.max(...raw.filter((q) => Math.abs(q.cy - w.cy) < 9).map((q) => q.x1)))));
  const rows = [];
  words.forEach((w) => { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - w.cy) < 9) { r.w.push(w); r.y = (r.y + w.cy) / 2; r.x1 = Math.max(r.x1, w.x1); } else rows.push({ y: w.cy, w: [w], x1: w.x1 }); });
  rows.forEach((r) => { r.t = r.w.sort((a, b) => a.x1 - b.x1).map((w) => w.t).join(''); });   // the words of one label, left to right
  let ticks = rows.map((r) => ({ y: r.y, v: Number(r.t) })).filter((t) => t.v > 0);
  const sv = ticks.map((t) => t.v).sort((a, b) => a - b), mid = sv[sv.length >> 1] || 0; ticks = ticks.filter((t) => t.v >= mid * 0.2 && t.v <= mid * 5);   // clock digits and mangled labels are far from the typical label
  const fit = fitAxis(ticks); if (!fit) return null;
  const ys = fit.ticks.map((t) => t.y).sort((a, b) => a - b), u = spacing(ys) / 31.8;   // one label step in pixels, measured over every agreeing label
  // The lowest label can be misread or missing, so the baseline of the plot (where the lighter fill ends) anchors everything else.
  const midX = Math.round(W * 0.55); let base = Math.round(ys[ys.length - 1]);
  for (let y = base; y < H - 1; y++) { const c = px(midX, y), mx = Math.max(...c), mn = Math.min(...c); if (!(lum(c[0], c[1], c[2]) > 42 && (mx - mn) / (mx || 1) < 0.4)) { base = y; break; } }
  const bot = base - 31 * u, top = bot - 8 * 31.8 * u;
  // 2. the header, the footer and the x-axis labels sit at fixed distances (in chart units) from the axis
  const strip = (x, y0, y1, k, w) => whiteText(frame, { x: Math.max(0, x), y: Math.max(0, y0), w: Math.min(W - Math.max(0, x), w), h: Math.max(8, y1 - y0) }, k);
  const txt = async (c, opt) => String((await recognize(c, opt || { psm: 7 })).text || '').trim();
  const [statsT, nameT, lvlT, xT, updT] = await Promise.all([
    txt(strip(W * 0.3, bot - 342 * u, bot - 318 * u, 3, W * 0.7)),
    txt(strip(W * 0.12, bot - 440 * u, bot - 414 * u, 4, W * 0.6)),
    txt(strip(W * 0.12, bot - 420 * u, bot - 396 * u, 4, W * 0.5)),
    txt(strip(W * 0.1, bot + 38 * u, bot + 66 * u, 3, W * 0.85)),
    txt(strip(W * 0.2, bot + 92 * u, bot + 116 * u, 3, W * 0.6)),
  ]);
  const stats = parseStats(statsT);
  // 3. the curve: top edge of the lighter fill in every pixel column
  const x0 = Math.round(Math.max(...rows.map((r) => r.x1)) + 8 * u), y0 = Math.round(top - 14 * u), y1 = Math.round(bot + 30 * u), cols = [];
  let miss = 0, started = false;
  for (let x = x0; x < W - 2; x++) {
    let found = null;
    for (let y = y0; y < y1 - 2 && found === null; y++) {
      let run = 0;
      for (let k = 0; k < 3; k++) { const c = px(x, y + k), mx = Math.max(...c), mn = Math.min(...c); if (lum(c[0], c[1], c[2]) > 42 && (mx - mn) / (mx || 1) < 0.4) run++; }
      if (run === 3) found = y;
    }
    if (found !== null) { cols.push({ x, y: found }); started = true; miss = 0; } else if (started && ++miss > 6) break;
  }
  const trimmed = cols.slice(2, Math.max(2, cols.length - 2));
  const points = sampleSeries(trimmed, fit.at, 72);
  // 4. check: the solid yellow line is the average; it must sit where the calibration says
  let avgY = null, best = 0;
  for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x0 + (trimmed.length || 1); x += 2) { const c = px(x, y); if (c[0] > 115 && c[1] > 120 && c[0] - c[2] > 45 && c[2] < 0.7 * c[1]) n++; } if (n > best) { best = n; avgY = y; } }
  const avgLine = avgY !== null && best > trimmed.length * 0.3 ? fit.at(avgY) : null;
  // an average that disagrees with its own line probably lost its first digit ("4 974 903" read as "974 903"): the line decides which repair fits
  if (avgLine && stats.avg && Math.abs(avgLine - stats.avg) / avgLine > 0.01) {
    for (let dgt = 1; dgt <= 9; dgt++) { const c = Number(String(dgt) + String(stats.avg)); if (Math.abs(avgLine - c) / avgLine < 0.01) { stats.avg = c; stats.avgRepaired = true; break; } }
  }
  const avgErr = avgLine && stats.avg ? Math.abs(avgLine - stats.avg) / stats.avg : null;
  const lm = lvlT.match(/niv\w*\.?\s*([\dOolI]{1,3})/i);
  const um = updT.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2}).*?(\d{1,2})\s*[:.]\s*(\d\d)\s*([AP]M)?/i);
  return {
    name: nameT.replace(/[^\p{L}\p{N}' \-]/gu, '').trim(), level: lm ? Number(lm[1].replace(/[Oo]/g, '0').replace(/[lI]/g, '1')) : null,
    span: classifySpan(xT.split(/\s+/)), median: stats.median, avg: stats.avg, sold: stats.sold,
    updated: um ? { month: Number(um[1]), day: Number(um[2]), hour: Number(um[3]), min: Number(um[4]), ap: um[5] ? um[5].toUpperCase() : null } : null,
    avgRepaired: !!stats.avgRepaired, points, axis: { fitted: fit.n, labels: fit.of }, avgCheck: avgErr === null ? null : Math.round(avgErr * 1000) / 10,
    sure: !!(fit.n >= 5 && avgErr !== null && avgErr < 0.01 && stats.median && stats.avg && points.length >= 8),
    raw: { stats: statsT, x: xT, upd: updT, dbg: { u, base, bot, top, x0, y0, y1, cols: cols.length }, ticks: ticks.map((t) => [Math.round(t.y), t.v]), used: fit.ticks.map((t) => [Math.round(t.y), t.v]) },
  };
}
