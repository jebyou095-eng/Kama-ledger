// Theme switch: the choice is stored per computer (localStorage may be unavailable, so it is optional).
const THEMES = ['navy', 'game', 'light'];
export function initTheme() {
  let t = 'navy';
  try { const v = localStorage.getItem('kl-theme'); if (THEMES.includes(v)) t = v; } catch { /* storage unavailable */ }
  const sel = document.getElementById('theme-sel');
  const apply = (v) => { document.documentElement.dataset.theme = v; if (sel) sel.value = v; };
  apply(t);
  if (sel) sel.addEventListener('change', () => { const v = THEMES.includes(sel.value) ? sel.value : 'navy'; apply(v); try { localStorage.setItem('kl-theme', v); } catch { /* ignore */ } });
}
