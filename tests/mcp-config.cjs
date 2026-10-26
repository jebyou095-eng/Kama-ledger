(async () => {
  const assert = require('node:assert/strict');
  const { merge } = await import('../mcp/install-config.mjs');
  const old = JSON.stringify({ preferences: { theme: 'dark', x: [1, 2] }, mcpServers: { other: { command: 'x', args: [] } } });
  const a = JSON.parse(merge(old, 'C:\\k\\kama-mcp.mjs'));
  assert.deepEqual(a.preferences, { theme: 'dark', x: [1, 2] }); assert.equal(a.mcpServers.other.command, 'x'); assert.equal(a.mcpServers['kama-ledger'].args[0], 'C:\\k\\kama-mcp.mjs');
  assert.deepEqual(Object.keys(JSON.parse(merge('{"a":1}', 's')).mcpServers), ['kama-ledger']);
  assert.deepEqual(Object.keys(JSON.parse(merge('', 's'))), ['mcpServers']);
  assert.throws(() => merge('{bad', 's'));
  console.log('mcp-config checks passed');
})();
