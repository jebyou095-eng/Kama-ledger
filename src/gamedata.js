// Merges the current game data (dofusdude API items) into the compact index used everywhere else.
// Pure functions, tested in tests/gamedata.cjs. Network access lives in main.js / electron.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const SUBTYPES = ['equipment', 'resources', 'consumables', 'quest', 'cosmetics'];

export function pageItems(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  return json.items || json.data || [];
}
export function lastPage(json) {
  const l = json && json._links && json._links.last;
  const m = typeof l === 'string' && l.match(/page(?:\[|%5B)number(?:\]|%5D)=(\d+)/i);
  return m ? Number(m[1]) : 1;
}
export const gfxOf = (it) => {
  const u = it && it.image_urls && (it.image_urls.icon || it.image_urls.sd);
  const m = typeof u === 'string' && u.match(/item\/(\d+)-\d+\.png/);
  return m ? Number(m[1]) : null;
};

// idx: {v, built, recipes, types, effs, items:[[id,name,level,typeId,recipe|0,effects]], icons?}. Returns a NEW index and stats.
export function mergeIndex(idx, apiItems, built) {
  const types = { ...idx.types }, byName = {};
  Object.entries(types).forEach(([id, n]) => { byName[norm(n)] = Number(id); });
  const pos = new Map(idx.items.map((r, i) => [r[0], i]));
  const items = idx.items.map((r) => r.slice());
  const icons = { ...(idx.icons || {}) };
  const st = { added: 0, updated: 0, recipeFixed: 0, total: 0 };
  apiItems.forEach((a) => {
    if (!a || !Number.isFinite(a.ankama_id) || !a.name) return;
    st.total++;
    let typeId = 0;
    if (a.type && a.type.name) {
      const k = norm(a.type.name);
      if (byName[k] === undefined) { const nid = 100000 + (a.type.id || Object.keys(byName).length); types[nid] = a.type.name; byName[k] = nid; }
      typeId = byName[k];
    }
    const recipe = Array.isArray(a.recipe) && a.recipe.length ? a.recipe.filter((g) => g && Number.isFinite(g.item_ankama_id)).map((g) => [g.item_ankama_id, g.quantity || 1]) : 0;
    const g = gfxOf(a); if (g) icons[a.ankama_id] = g;
    const i = pos.get(a.ankama_id);
    if (i === undefined) { items.push([a.ankama_id, a.name, a.level || 0, typeId, recipe, []]); pos.set(a.ankama_id, items.length - 1); st.added++; return; }
    const r = items[i];
    if (JSON.stringify(r[4] || 0) !== JSON.stringify(recipe)) st.recipeFixed++;
    r[1] = a.name; r[2] = a.level || r[2]; if (typeId) r[3] = typeId; r[4] = recipe;
    st.updated++;
  });
  const recipes = items.filter((r) => r[4]).length;
  return { idx: { ...idx, v: 1, built, recipes, types, items, icons }, stats: st };
}
