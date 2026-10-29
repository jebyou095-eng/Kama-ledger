// Runs the real readers on every screenshot in tests/screens/<kind>/ and compares with the matching .json (the truth).
// Needs the dev server (npx vite --port 5199) and playwright-core. Usage: node tests/screens/run.mjs [kind]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const pw = await import(process.env.PW || 'playwright-core'), chromium = (pw.default || pw).chromium;   // PW: path to playwright-core if it is not installed here
const root = path.dirname(fileURLToPath(import.meta.url)), only = process.argv[2];
const files = []; for (const k of fs.readdirSync(root)) { const d = path.join(root, k); if (!fs.statSync(d).isDirectory() || (only && k !== only)) continue; for (const f of fs.readdirSync(d)) if (f.endsWith('.png')) files.push([k, path.join(d, f)]); }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.goto('http://localhost:5199/'); await p.waitForSelector('#kamo', { timeout: 60000 }); await p.waitForTimeout(1500);
const tally = {}; const miss = [];
const bump = (kind, field, ok) => { const t = (tally[kind + '.' + field] ||= { ok: 0, n: 0 }); t.n++; if (ok) t.ok++; };
for (const [kind, png] of files) {
  const truth = JSON.parse(fs.readFileSync(png.replace(/\.png$/, '.json'), 'utf8')), url = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
  const got = await p.evaluate(async ([url, kind]) => {
    const scan = await import('/src/scan.js'), frame = await scan.frameFromUrl(url);
    if (kind === 'chart') { const g = await (await import('/src/graph.js')).readGraph(frame); return g && { name: g.name, level: g.level, span: g.span, median: g.median, avg: g.avg, sold: g.sold, sure: g.sure }; }
    if (kind === 'popup') {
      const prof = await scan.autoDetect(frame); scan.forgetProfile(); if (!prof.popup) return null; const W = frame.width, H = frame.height;
      const pl = await scan.readText(frame, prof.popup, 'white'), pop = (await import('/src/market.js')).parsePopup(pl), lots = (await import('/src/items.js')).parseLots(pl.join('\n'), pop.avg);
      const rr = await (await import('/src/lotrows.js')).readLotRows(frame, { x: prof.popup.x * W, y: prof.popup.y * H, w: prof.popup.w * W, h: prof.popup.h * H });
      Object.keys(rr).forEach((q) => { lots[q] = rr[q]; }); return { name: pop.name, avg: pop.avg, lots };
    }
    return null;
  }, [url, kind]);
  const name = path.basename(png);
  if (!got) { Object.keys(truth).filter((k) => !['kind', 'note'].includes(k)).forEach((k) => bump(kind, k, false)); miss.push(name + ': nothing read'); continue; }
  for (const k of Object.keys(truth)) {
    if (['kind', 'note'].includes(k)) continue;
    if (k === 'lots') for (const q of Object.keys(truth.lots)) { const ok = got.lots && got.lots[q] === truth.lots[q]; bump(kind, 'lot' + q, ok); if (!ok) miss.push(name + ': lot ' + q + ' read ' + (got.lots && got.lots[q]) + ', truth ' + truth.lots[q]); }
    else { const ok = got[k] === truth[k]; bump(kind, k, ok); if (!ok) miss.push(name + ': ' + k + ' read ' + got[k] + ', truth ' + truth[k]); }
  }
}
await b.close();
let ok = 0, n = 0; Object.entries(tally).forEach(([k, t]) => { ok += t.ok; n += t.n; console.log(k.padEnd(18), t.ok + '/' + t.n); });
console.log('TOTAL', ok + '/' + n, n ? (ok / n * 100).toFixed(1) + '%' : ''); miss.forEach((m) => console.log('MISS', m));
