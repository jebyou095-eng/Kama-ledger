import './style.css';
import { SVG } from './kamo.js';

// The see-through Kamo that floats over the screen. It only draws what the main window tells it to draw.
const api = window.kamaOverlay;
const root = document.createElement('div');
root.className = 'kamo ov'; root.dataset.mood = 'idle';
root.innerHTML = '<div class="kamo-bubble"><button class="kb-x" type="button" aria-label="Hide Kamo" title="Hide Kamo">\u00d7</button><div class="kb-text"></div><div class="kb-actions"></div></div>'
  + '<div class="kamo-btn" aria-hidden="true">' + SVG + '</div>';
document.body.appendChild(root);
const text = root.querySelector('.kb-text'), actions = root.querySelector('.kb-actions'), bubble = root.querySelector('.kamo-bubble');
const ring = document.createElement('div'); ring.className = 'ov-ring'; ring.hidden = true; document.body.appendChild(ring);
let ringTimer = 0, hideTimer = 0;

function show(state) {
  if (!state) return;
  root.dataset.mood = state.mood || 'idle';
  text.textContent = state.msg || '';
  actions.innerHTML = '';
  (state.acts || []).forEach((label, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-act'; b.textContent = label; b.addEventListener('click', () => api.act(i)); actions.appendChild(b); });
  root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop');
  bubble.hidden = false; clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { bubble.hidden = true; }, 16000);   // the bubble fades away by itself so it never sits over the game
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
root.querySelector('.kb-x').addEventListener('click', () => { if (api) api.hide(); });
