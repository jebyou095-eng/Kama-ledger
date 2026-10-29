// The "Test library" card: add screenshots, put each in a category, see what is still needed, download everything as one zip.
import { CATS, progress, suggest, tagsOf, buildZip } from './testlib.js';

const DB = 'kama-testlib', ST = 'shots';
function open() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const run = (db, mode, fn) => new Promise((res, rej) => { const t = db.transaction(ST, mode), s = t.objectStore(ST), r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });

export async function initTestLib(env) {
  const $ = env.$, list = $('tl-list'), needs = $('tl-needs'), out = $('tl-status'), sel = $('tl-cat');
  if (!list || !needs || !window.indexedDB) return;
  let db; try { db = await open(); } catch (e) { out.textContent = 'This browser cannot store the library.'; return; }
  const all = () => run(db, 'readonly', (s) => s.getAll());
  const urls = [];
  CATS.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; sel.appendChild(o); });
  const note = (t) => { out.textContent = t; };

  async function render() {
    const items = await all(); urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    needs.textContent = '';
    progress(items).forEach((p) => {
      const row = document.createElement('div'); row.className = 'tl-need';
      const head = document.createElement('div'); head.innerHTML = '<b></b> <span class="mu"></span>';
      head.querySelector('b').textContent = p.label + ': ' + p.n + ' / ' + p.min + (p.done ? ' ✓' : '');
      head.querySelector('span').textContent = (p.done ? 'enough to start (best ' + p.best + ')' : p.need + ' more') + (p.needSizes ? ' · also needs a second window size' : '');
      const bar = document.createElement('div'); bar.className = 'tl-bar'; const fill = document.createElement('i'); fill.style.width = Math.min(100, Math.round((p.n / p.best) * 100)) + '%'; bar.appendChild(fill);
      const hint = document.createElement('div'); hint.className = 'mu'; hint.textContent = p.hint;
      row.append(head, bar, hint); needs.appendChild(row);
    });
    list.textContent = '';
    items.sort((a, b) => a.id - b.id).forEach((it) => {
      const card = document.createElement('div'); card.className = 'tl-item';
      const u = URL.createObjectURL(it.blob); urls.push(u);
      const img = document.createElement('img'); img.src = u; img.alt = it.name; img.loading = 'lazy';
      const meta = document.createElement('div'); meta.className = 'mu'; meta.textContent = it.w + '×' + it.h;
      const tags = document.createElement('div'); tags.className = 'tl-tags';
      const have = tagsOf(it);
      CATS.forEach((c) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tl-tag' + (have.includes(c.id) ? ' on' : ''); b.textContent = c.label; b.setAttribute('aria-pressed', have.includes(c.id) ? 'true' : 'false'); b.title = c.hint;
        b.addEventListener('click', async () => {
          let next = have.includes(c.id) ? have.filter((x) => x !== c.id) : have.concat([c.id]);
          if (c.id !== 'empty' && next.includes('empty') && next.length > 1) next = next.filter((x) => x !== 'empty');   // a real tag replaces "other"
          if (c.id === 'empty' && next.includes('empty')) next = ['empty'];                                            // "other" stands alone
          if (!next.length) next = ['empty'];
          it.tags = next; delete it.cat; await run(db, 'readwrite', (st) => st.put(it)); render();
        });
        tags.appendChild(b);
      });
      const n = document.createElement('input'); n.type = 'text'; n.placeholder = 'note (item name, what is special)'; n.value = it.note || ''; n.maxLength = 120;
      n.addEventListener('change', () => { it.note = n.value; run(db, 'readwrite', (st) => st.put(it)); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn'; del.textContent = 'Remove';
      del.addEventListener('click', async () => { await run(db, 'readwrite', (st) => st.delete(it.id)); render(); });
      card.append(img, meta, tags, n, del); list.appendChild(card);
    });
  }

  async function guess(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const scan = env.scan, frame = await scan.frameFromUrl(url);
      let keys = []; try { keys = Object.keys((await scan.autoDetect(frame)) || {}); } catch (e) { keys = []; } finally { scan.forgetProfile(); }
      let sure = false;
      if (!keys.some((k) => k === 'popup' || k === 'tooltip')) { try { const g = await (await import('./graph.js')).readGraph(frame); sure = !!(g && g.sure); } catch (e) { sure = false; } }
      return { tags: suggest(keys, sure), w: frame.width, h: frame.height };
    } finally { URL.revokeObjectURL(url); }
  }

  $('tl-file').addEventListener('change', async function () {
    const files = [].slice.call(this.files); this.value = ''; const chosen = sel.value;
    for (let i = 0; i < files.length; i++) {
      note('Adding ' + (i + 1) + ' of ' + files.length + '…');
      try {
        const g = await guess(files[i]);
        await run(db, 'readwrite', (st) => st.add({ tags: chosen === 'auto' ? g.tags : [chosen], suggested: g.tags, w: g.w, h: g.h, name: files[i].name, note: '', blob: files[i], at: Date.now() }));
      } catch (e) { note('Could not add ' + files[i].name + '.'); }
    }
    note('Added ' + files.length + '. Check the tags of each one: the guess can be wrong.'); render();
  });

  $('tl-zip').addEventListener('click', async () => {
    const items = (await all()).sort((a, b) => a.id - b.id); if (!items.length) { note('Nothing to download yet.'); return; }
    const files = [], counts = {}, manifest = [];
    for (const it of items) {
      const tg = tagsOf(it), first = tg[0]; counts[first] = (counts[first] || 0) + 1;
      const name = first + '/' + first + '-' + String(counts[first]).padStart(3, '0') + '.png', data = new Uint8Array(await it.blob.arrayBuffer());
      files.push({ name, data }); manifest.push({ file: name, tags: tg, w: it.w, h: it.h, note: it.note || '', original: it.name, guessed: it.suggested || null });
    }
    const enc = new TextEncoder(); files.push({ name: 'manifest.json', data: enc.encode(JSON.stringify({ app: env.build || '', files: manifest }, null, 1)) });
    const blob = new Blob([buildZip(files)], { type: 'application/zip' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kama-test-library.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note('Downloaded kama-test-library.zip (' + items.length + ' screenshots). Send it to Claude.');
  });

  $('tl-clear').addEventListener('click', async () => {
    if (!confirm('Remove every screenshot from the library on this computer?')) return;
    await run(db, 'readwrite', (st) => st.clear()); note('Library emptied.'); render();
  });
  render();
}
