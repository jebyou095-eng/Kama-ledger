const assert = require('node:assert/strict');

async function main() {
  const { analyzePanel, classifyPanel, classifyTransactionLine, mergeLedgerHistory, parseTransactionLine, removeLedgerEntry, transactionLines, transactionToLine, updateLedgerEntry } = await import('../src/transactions.js');
  const sampleSale = '[18:35] Banque : + 1 338 Kamas (vente : 1 x [Rune Ré Per Terre])';
  const samplePurchase = '[18:35] 1 x [Rune Ré Per Terre] (1\u00a0338 kamas)';
  const { normLine } = await import('../src/transactions.js');

  assert.equal(classifyTransactionLine(sampleSale), 'sale');
  assert.equal(classifyTransactionLine(samplePurchase), 'purchase');
  assert.equal(normLine(sampleSale), '[18:35] Banque : + 1\u202f338 Kamas (vente : 1 x [Rune Ré Per Terre])');
  assert.equal(classifyTransactionLine('Bebemoth Mais mon kukulife est lvl 1 x'), null);
  assert.deepEqual(parseTransactionLine(sampleSale), {
    type: 'sale', amount: 1338, item: 'Rune Ré Per Terre', quantity: 1, time: '18:35', line: sampleSale,
  });
  assert.deepEqual(parseTransactionLine(samplePurchase), {
    type: 'purchase', quantity: 1, item: 'Rune Ré Per Terre', amount: 1338, time: '18:35', line: samplePurchase,
  });
  assert.equal(transactionLines([sampleSale, 'ignored chat', samplePurchase]).length, 2);
  assert.equal(transactionLines(['1 x [Rune Ré Per Terre] (1 338 kamas)']).length, 0);
  assert.equal(classifyPanel(['CHAT', samplePurchase]).panel, 'chat');
  assert.equal(classifyPanel(['Cours du marché', 'Prix médian']).panel, 'market-chart');
  assert.equal(classifyPanel(['Concassed']).panel, 'brisage');
  assert.equal(classifyPanel(['unknown title']).panel, 'unclassified');
  assert.equal(classifyPanel(['unknown title'], 'Inventory').panel, 'inventory');
  assert.equal(analyzePanel(['Recettes', '2 x [Rune Ré Per Terre]']).ingredients[0].quantity, 2);
  assert.equal(analyzePanel(['CHAT', samplePurchase]).transactions.length, 1);
  assert.equal(analyzePanel(['CHAT', '1 x [Rune Ré Per Terre] (1 338 kamas)']).transactions.length, 0);
  assert.equal(analyzePanel(['Hôtel de vente', 'Prix moyen 299 kamas']).panel, 'market-list');
  const trades = transactionLines([sampleSale, samplePurchase, samplePurchase]);
  const saved = mergeLedgerHistory([], trades, [12, 13], 1000);
  const repeated = mergeLedgerHistory(saved, trades, [12, 13], 2000);
  assert.equal(saved.length, 3);
  assert.equal(repeated.length, 3);
  assert.equal(saved.filter((entry) => entry.type === 'sale')[0].amount, 1338);
  assert.equal(saved.filter((entry) => entry.type === 'purchase').length, 2);
  // editing: lines rebuilt from edited rows must parse back to the same values
  const edited = { ...parseTransactionLine(sampleSale), item: 'Rune Ré Per Feu', amount: 1500, quantity: 3, type: 'purchase' };
  const rebuilt = parseTransactionLine(transactionToLine(edited));
  assert.equal(rebuilt.item, 'Rune Ré Per Feu');
  assert.equal(rebuilt.amount, 1500);
  assert.equal(rebuilt.quantity, 3);
  assert.equal(rebuilt.type, 'purchase');
  assert.equal(parseTransactionLine(transactionToLine(parseTransactionLine(sampleSale))).amount, 1338);
  const withoutItem = transactionToLine({ type: 'sale', amount: 2000, item: 'Vente (banque)', time: '18:35' });
  assert.equal(parseTransactionLine(withoutItem).amount, 2000);
  // editing a saved entry keeps its key, so re-reading the same capture does not duplicate it
  const entryKey = saved[0].key;
  const fixed = updateLedgerEntry(saved, entryKey, { item: '  Rune Fixed  ', amount: '2500', quantity: 4 });
  assert.equal(fixed.length, 3);
  assert.equal(fixed.find((entry) => entry.key === entryKey).item, 'Rune Fixed');
  assert.equal(fixed.find((entry) => entry.key === entryKey).amount, 2500);
  assert.equal(fixed.find((entry) => entry.key === entryKey).edited, true);
  assert.equal(mergeLedgerHistory(fixed, trades, [12, 13], 3000).length, 3);
  // bad edits are ignored
  const ignored = updateLedgerEntry(saved, entryKey, { item: '   ', amount: -5, quantity: 0, type: 'gift' });
  assert.equal(ignored.find((entry) => entry.key === entryKey).item, saved.find((entry) => entry.key === entryKey).item);
  assert.equal(ignored.find((entry) => entry.key === entryKey).amount, saved.find((entry) => entry.key === entryKey).amount);
  assert.equal(removeLedgerEntry(saved, entryKey).length, 2);
  console.log('35 transaction, panel, edit and ledger-history checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});