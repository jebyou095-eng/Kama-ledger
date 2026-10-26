import './style.css';
import { SVG } from './kamo.js';
import { createMover, createShake } from './kamo-motion.js';

// The see-through Kamo that floats over the screen. It only draws what the main window tells it to draw.
const api = window.kamaOverlay;
const root = document.createElement('div');
root.className = 'kamo ov'; root.dataset.mood = 'idle';
root.innerHTML = '<div class="kamo-bubble"><button class="kb-x" type="button" aria-label="Close the bubble" title="Close this bubble">\u00d7</button><div class="kb-text"></div><div class="kb-actions"></div></div>'
  + '<div class="kamo-btn" aria-hidden="true">' + SVG + '</div>';
document.body.appendChild(root);
const text = root.querySelector('.kb-text'), actions = root.querySelector('.kb-actions'), bubble = root.querySelector('.kamo-bubble');
const ring = document.createElement('div'); ring.className = 'ov-ring'; ring.hidden = true; document.body.appendChild(ring);
let ringTimer = 0, hideTimer = 0;
const mover = createMover(root, { x: 90, y: innerHeight - 18 });   // he walks over the whole screen

// Boxes over what was just read: yellow = read, orange = look at it, green = saved. They fade by themselves.
const marksBox = document.createElement('div'); marksBox.className = 'ov-marks'; document.body.appendChild(marksBox);
let marksTimer = 0;
function drawMarks(list, ttl) {
  marksBox.innerHTML = ''; marksBox.classList.remove('fade'); clearTimeout(marksTimer);
  (list || []).filter((m) => m.kind !== 'win').slice(0, 40).forEach((m) => {
    const d = document.createElement('div'); d.className = 'ov-mark ' + (m.kind || 'read');
    d.style.left = (m.x * 100) + '%'; d.style.top = (m.y * 100) + '%'; d.style.width = (m.w * 100) + '%'; d.style.height = (m.h * 100) + '%';
    if (m.label) { const t = document.createElement('span'); t.textContent = m.label; d.appendChild(t); }
    marksBox.appendChild(d);
  });
  if ((list || []).length) marksTimer = setTimeout(() => { marksBox.classList.add('fade'); setTimeout(() => { marksBox.innerHTML = ''; }, 900); }, ttl || 7000);
}

function show(state) {
  if (!state) return;
  if (state.marks) drawMarks(state.marks, state.marksTtl);
  // body commands (they can come without any text): walk somewhere, point an arm at a spot, dance or jump
  if (state.walk) mover.walkTo(state.walk.fx * innerWidth, state.walk.fy * innerHeight);
  if (state.aim) { const go = () => mover.aimAt(state.aim.fx * innerWidth, state.aim.fy * innerHeight, 9000); if (state.walk) setTimeout(go, 1400); else go(); }
  if (state.talk !== undefined) {
    root.classList.toggle('talking', !!state.talk); clearInterval(lipTimer);
    root.classList.toggle('lip', !!(state.talk && state.env));
    if (state.talk && state.env) { const t0 = performance.now(), env = state.env; lipTimer = setInterval(() => { const i = Math.floor((performance.now() - t0) / 50); if (i >= env.length) { clearInterval(lipTimer); root.classList.remove('lip'); return; } root.style.setProperty('--mouth', ((+env[i] || 0) / 9).toFixed(2)); }, 50); }
  }
  if (state.play) { const go = () => mover.play(state.play, 0, state.fit ? state.fit * innerHeight : 0, state.look, state.lmood, state.lpose); if (state.walk) setTimeout(go, 1500); else go(); }
  if (state.msg === undefined) return;
  root.dataset.mood = state.mood || 'idle';
  text.textContent = state.msg || '';
  actions.innerHTML = '';
  (state.acts || []).forEach((label, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-act'; b.textContent = label; b.addEventListener('click', () => api.act(i)); actions.appendChild(b); });
  root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop');
  bubble.hidden = false; clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { bubble.hidden = true; }, Math.min(14000, 4000 + (state.msg || '').length * 70));   // the bubble fades away by itself so it never sits over the game
  if (state.point) {
    ring.hidden = false; ring.textContent = state.point.label || '';
    ring.style.left = (state.point.fx * innerWidth) + 'px'; ring.style.top = (state.point.fy * innerHeight) + 'px';
    clearTimeout(ringTimer); ringTimer = setTimeout(() => { ring.hidden = true; }, 9000);
  }
}
if (api) api.onState(show);

// Clicks pass straight through to the game, except right on Kamo and his bubble.
let inside = false;
const setInside = (v) => { if (v !== inside) { inside = v; if (api) api.interactive(v); } };
document.addEventListener('mousemove', (e) => {
  const t = e.target;
  setInside(!!(t && t.closest && (t.closest('.kamo-bubble') && !bubble.hidden || t.closest('.kamo-btn'))));
});
// The little x closes only the speech bubble. Click Kamo to close it too; drag him to move him out of the way; right-click him to send him back into the app.
root.querySelector('.kb-x').addEventListener('click', () => { bubble.hidden = true; });
const kbtn = root.querySelector('.kamo-btn');
let drag = null, lipTimer = 0;
const shake = createShake();
kbtn.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; const p = mover.pos(); drag = { sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, moved: false }; try { kbtn.setPointerCapture(e.pointerId); } catch { /* ok */ } setInside(true); });
kbtn.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; if (!drag.moved && Math.hypot(dx, dy) < 5) return; drag.moved = true; mover.teleport(drag.x + dx, drag.y + dy); if (shake.push(e.clientX, e.clientY, performance.now())) { mover.play('dizzy'); if (api && api.body) api.body('dizzy'); } });
kbtn.addEventListener('pointerup', (e) => { if (!drag) return; const moved = drag.moved; drag = null; try { kbtn.releasePointerCapture(e.pointerId); } catch { /* ok */ } if (!moved) { bubble.hidden = true; mover.stand(); } });
kbtn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (api) api.hide(); });

// Ctrl+Alt+K: a small box over the game to talk to Kamo. Enter sends, Esc closes.
const askBox = document.createElement('form'); askBox.className = 'ov-ask'; askBox.hidden = true;
askBox.innerHTML = '<input type="text" maxlength="300" placeholder="Ask Kamo… (Enter to send, Esc to close)" autocomplete="off" aria-label="Ask Kamo">';
document.body.appendChild(askBox);
const askIn = askBox.querySelector('input');
function closeAsk() { askBox.hidden = true; askIn.value = ''; if (api && api.askClose) api.askClose(); }
if (api && api.onAsk) api.onAsk(() => { askBox.hidden = false; askIn.value = ''; setTimeout(() => askIn.focus(), 30); });
askBox.addEventListener('submit', (e) => { e.preventDefault(); const v = askIn.value.trim(); if (v && api && api.ask) api.ask(v); closeAsk(); });
askIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAsk(); });
