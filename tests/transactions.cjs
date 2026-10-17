const assert = require('node:assert/strict');

async function main() {
  const { classifyTransactionLine, mergeLedgerHistory, parseTransactionLine, transactionLines } = await import('../src/transactions.js');
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
  const trades = transactionLines([sampleSale, samplePurchase, samplePurchase]);
  const saved = mergeLedgerHistory([], trades, [12, 13], 1000);
  const repeated = mergeLedgerHistory(saved, trades, [12, 13], 2000);
  assert.equal(saved.length, 3);
  assert.equal(repeated.length, 3);
  assert.equal(saved.filter((entry) => entry.type === 'sale')[0].amount, 1338);
  assert.equal(saved.filter((entry) => entry.type === 'purchase').length, 2);
  console.log('10 transaction and ledger-history checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});