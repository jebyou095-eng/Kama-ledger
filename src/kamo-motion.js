// Kamo's body: where he stands, walking there, which way he faces, and pointing an arm at a spot.
// Used by the app window and by the see-through overlay, so he moves the same way in both.
// (x, y) is the point under his feet, in pixels of the window. The element is anchored to the bottom-left corner and moved with
// CSS variables, so the speech bubble (which makes the element taller) never shifts his feet.

const SIZE_DEFAULT = 132;            // width of the character in px (see .kamo-btn)
const RATIO = 200 / 160;            // svg viewBox height / width
const SHOULDER = { fx: 0.825, fy: 0.56 };   // right shoulder inside the character box (svg 52,14 in a -80,-98,160,200 box)

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Pure: where he should stand to look at a rectangle: beside it on the roomier side, feet level with its middle.
export function standBeside(rect, view, size) {
  const s = size || SIZE_DEFAULT, h = s * RATIO, gap = 18;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const roomRight = view.w - rect.right, roomLeft = rect.left;
  let x, y = cy + h * 0.45;
  if (roomRight >= s + gap || roomRight >= roomLeft) x = rect.right + gap + s / 2; else x = rect.left - gap - s / 2;
  if (rect.width > view.w * 0.6) { x = cx; y = rect.bottom + h + gap; }      // a wide element: stand under it
  return { x: clamp(x, s / 2 + 6, view.w - s / 2 - 6), y: clamp(y, h + 8, view.h - 6) };
}

// Pure: arm angle (degrees, 0 = straight ahead, positive = down) and which way to face, to point from a shoulder at a target.
export function aimAngle(shoulder, target) {
  const dx = target.x - shoulder.x, dy = target.y - shoulder.y;
  const face = dx < 0 ? 'left' : 'right';
  const deg = Math.atan2(dy, Math.max(Math.abs(dx), 1)) * 180 / Math.PI;   // mirrored when facing left, so use |dx|
  return { face, deg: clamp(deg, -80, 80) };
}

// Pure: does this stream of pointer positions look like being shaken? Counts quick back-and-forth turns along one axis.
export function createShake(opt) {
  const o = Object.assign({ turns: 5, window: 1200, amp: 26 }, opt || {});
  let pts = [];
  return {
    reset() { pts = []; },
    push(x, y, t) {
      pts.push({ x, y, t }); pts = pts.filter((p) => t - p.t <= o.window);
      for (const k of ['x', 'y']) {
        let dir = 0, turns = 0, anchor = pts[0] && pts[0][k];
        for (const p of pts) {
          const d = p[k] - anchor;
          if (Math.abs(d) >= o.amp) { const nd = d > 0 ? 1 : -1; if (dir && nd !== dir) turns++; dir = nd; anchor = p[k]; }
        }
        if (turns >= o.turns) { pts = []; return true; }
      }
      return false;
    },
  };
}
export const POSES = ['lie-back', 'lie-belly', 'side'];
// What he can do lying on the window's top edge: [pose, look classes, mood]
export const LIES = [
  ['lie-back', '', 'happy'], ['lie-back', 'v-head', 'happy'], ['lie-back', 'v-wide', 'happy'], ['lie-back', 'v-sun', 'happy'],
  ['lie-back', 'v-wave', 'happy'], ['lie-back', '', 'sleep'], ['lie-back', 'v-head', 'sleep'],
  ['lie-belly', '', 'idle'], ['lie-belly', 'v-kick', 'happy'], ['lie-belly', 'v-wide', 'happy'], ['lie-belly', 'v-drum', 'happy'], ['lie-belly', '', 'sleep'], ['lie-belly', 'v-kick', 'scan'],
];

export function createMover(root, opts) {
  const o = opts || {};
  const size = o.size || SIZE_DEFAULT, height = size * RATIO;
  const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const view = () => ({ w: o.viewW ? o.viewW() : window.innerWidth, h: o.viewH ? o.viewH() : window.innerHeight });
  let x = o.x !== undefined ? o.x : size / 2 + 20, y = o.y !== undefined ? o.y : view().h - 10, face = 'right', timer = 0, pointTimer = 0, poseTimer = 0, walking = false;

  function place(ms) {
    const v = view();
    root.style.setProperty('--kdur', ms + 'ms');
    root.style.setProperty('--kx', Math.round(x - size / 2) + 'px');
    root.style.setProperty('--ky', Math.round(y - v.h) + 'px');
    // the bubble goes on the side with more room
    root.classList.toggle('flip', x > v.w * 0.55);
    root.classList.toggle('low', y < 330);   // near the top of the window the bubble sits beside his head, not above it
  }
  function setFace(f) { if (f !== face) { face = f; root.dataset.face = f; } }
  const bound = (px, py) => { const v = view(); return { x: clamp(px, size / 2 + 6, v.w - size / 2 - 6), y: clamp(py, height + 8, v.h - 4) }; };

  // Walks to a spot and resolves when he gets there. A new walk cancels the one in progress.
  function walkTo(px, py, wopts) {
    const t = bound(px, py), speed = (wopts && wopts.speed) || 0.26;   // px per ms
    clearTimeout(timer);
    const dist = Math.hypot(t.x - x, t.y - y);
    if (dist < 4) return Promise.resolve();
    setFace(t.x < x ? 'left' : t.x > x ? 'right' : face);
    const ms = reduce() ? 0 : clamp(dist / speed, 250, 6000);
    x = t.x; y = t.y; walking = ms > 0;
    root.classList.toggle('walking', walking);
    place(ms);
    return new Promise((res) => { timer = setTimeout(() => { walking = false; root.classList.remove('walking'); res(); }, ms + 20); });
  }
  function teleport(px, py, raw) { const t = raw ? { x: px, y: py } : bound(px, py); clearTimeout(timer); x = t.x; y = t.y; walking = false; root.classList.remove('walking'); place(0); }   // raw: may start off-screen

  // Shoulder position on screen for the current facing.
  function shoulder() { const dir = face === 'left' ? -1 : 1; return { x: x + dir * (SHOULDER.fx - 0.5) * size, y: y - height + SHOULDER.fy * height }; }
  function aimAt(tx, ty, ms) {
    const a = aimAngle(shoulder(), { x: tx, y: ty });
    setFace(a.face);
    const s = shoulder(), b = aimAngle(s, { x: tx, y: ty });   // facing may have just changed: recompute from the right shoulder
    root.style.setProperty('--aim', b.deg.toFixed(1) + 'deg');
    root.classList.add('pointing');
    clearTimeout(pointTimer);
    if (ms) pointTimer = setTimeout(clearAim, ms);
  }
  function clearAim() { clearTimeout(pointTimer); root.classList.remove('pointing'); }
  const LOOKS = ['v-head', 'v-wide', 'v-sun', 'v-wave', 'v-kick', 'v-drum', 'mir'];
  let moodBefore = null;
  function stand() {
    const was = POSES.some((k) => root.classList.contains('pose-' + k)) || root.classList.contains('dizzy');
    POSES.concat(['dizzy']).forEach((k) => root.classList.remove('pose-' + k)); root.classList.remove('dizzy', ...LOOKS); clearTimeout(poseTimer);
    if (moodBefore !== null) { root.dataset.mood = moodBefore; moodBefore = null; }
    if (was) { root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop'); }   // a little hop when he gets up
  }
  // A pose stays until the time is up or he is clicked. Lying poses take a look (arms, legs...), a mood (awake, asleep, scanning) and a side.
  function pose(name, ms, fit, look, mood) {
    clearAim(); stand();
    if (fit) root.style.setProperty('--ps', clamp(fit / height, 0.22, 1).toFixed(2));
    else root.style.removeProperty('--ps');
    root.classList.add(name === 'dizzy' ? 'dizzy' : 'pose-' + name);
    (look || '').split(' ').filter(Boolean).forEach((c) => root.classList.add(c));
    if (name.startsWith('lie-') && Math.random() < 0.5) root.classList.add('mir');
    if (mood) { moodBefore = root.dataset.mood || 'idle'; root.dataset.mood = mood; }
    root.classList.remove('hop'); void root.offsetWidth; root.classList.add('hop');
    return new Promise((res) => { poseTimer = setTimeout(() => { stand(); res(); }, reduce() ? 0 : (ms || 7000)); });
  }
  function play(name, ms, fit, look, mood, which) {   // dance | jump | a pose | 'lie' (he picks how)
    if (name === 'lie') { const l = which ? [which, look || '', mood || 'happy'] : LIES[Math.floor(Math.random() * LIES.length)]; return pose(l[0], ms || 9000, fit, l[1], l[2]); }
    if (POSES.includes(name) || name === 'dizzy') return pose(name, ms || (name === 'dizzy' ? 3200 : 7500), fit);
    stand(); clearAim();   // an arm still pointing from before would fight the dance
    root.classList.remove('dancing', 'jumping'); void root.offsetWidth;
    root.classList.add(name === 'jump' ? 'jumping' : 'dancing');
    return new Promise((res) => setTimeout(() => { root.classList.remove('dancing', 'jumping'); res(); }, reduce() ? 0 : (ms || 2400)));
  }
  root.dataset.face = face;
  place(0);
  window.addEventListener('resize', () => { const t = bound(x, y); x = t.x; y = t.y; place(0); });
  return { walkTo, teleport, aimAt, clearAim, play, stand, pose, standBeside: (rect) => standBeside(rect, view(), size), pos: () => ({ x, y }), isWalking: () => walking, size, height, face: () => face };
}
