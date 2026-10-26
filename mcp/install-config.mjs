// Adds the kama-ledger server to Claude Desktop's config file without touching anything else. Keeps a backup next to it.
// Usage: node install-config.mjs "<path to claude_desktop_config.json>"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function merge(text, server) {
  const cfg = text && text.trim() ? JSON.parse(text) : {};
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('The config file is not a JSON object.');
  cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  cfg.mcpServers['kama-ledger'] = { command: 'node', args: [server] };
  return JSON.stringify(cfg, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m) => m) || process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) { console.log('Drag claude_desktop_config.json onto "Add to Claude config.bat".'); process.exit(1); }
  try {
    const server = fileURLToPath(new URL('./kama-mcp.mjs', import.meta.url));
    const text = readFileSync(file, 'utf8'), out = merge(text, server);
    copyFileSync(file, file + '.kama-backup');
    writeFileSync(file, out);
    console.log('Done. kama-ledger was added to ' + file + '\nBackup of the old file: ' + file + '.kama-backup\nNow quit Claude Desktop completely and reopen it.');
  } catch (e) { console.log('Nothing was changed: ' + e.message); process.exit(1); }
}
