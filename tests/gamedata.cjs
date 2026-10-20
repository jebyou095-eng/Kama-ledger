const assert = require('node:assert/strict');
(async () => {
  const g = await import('../src/gamedata.js');
  const idx = { v: 1, built: '2024-12-01', recipes: 1, types: { 6: 'Épée', 53: 'Ressource' }, effs: {}, items: [[44, 'Épée de Boisaille', 7, 6, [[16512, 3], [303, 3]], []], [16512, 'Plume Chimérique', 1, 53, 0, []]] };
  const api = [
    { ankama_id: 44, name: 'Épée de Boisaille', level: 7, type: { id: 80, name: 'Épée' }, recipe: [{ item_ankama_id: 16512, quantity: 5 }], image_urls: { icon: 'https://x/img/item/6007-64.png' } },
    { ankama_id: 9999, name: 'Nouvel objet', level: 200, type: { id: 7, name: 'Cape' }, recipe: [{ item_ankama_id: 16512, quantity: 2 }] },
  ];
  const r = g.mergeIndex(idx, api, '2026-10-20');
  assert.equal(r.stats.added, 1); assert.equal(r.stats.updated, 1); assert.equal(r.stats.recipeFixed, 1);
  assert.deepEqual(r.idx.items[0][4], [[16512, 5]]);
  assert.equal(r.idx.items[0][3], 6, 'same type name keeps the old type id');
  assert.equal(r.idx.types[r.idx.items[2][3]], 'Cape');
  assert.equal(r.idx.icons[44], 6007);
  assert.equal(idx.items[0][4][0][1], 3, 'input is not modified');
  assert.equal(g.lastPage({ _links: { last: 'https://a/b?page[number]=41&page[size]=100' } }), 41);
  assert.equal(g.lastPage({ _links: { last: 'https://a/b?page%5Bnumber%5D=7' } }), 7);
  assert.equal(g.pageItems({ items: [1, 2] }).length, 2);
  console.log('game data merge checks passed');
})();
