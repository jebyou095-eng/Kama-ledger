// Prints the block to paste into Claude Desktop's config (Settings > Developer > Edit config), with the right path for this folder.
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(new URL('./kama-mcp.mjs', import.meta.url));
console.log(JSON.stringify({ mcpServers: { 'kama-ledger': { command: 'node', args: [server] } } }, null, 2));
console.log('\nPaste the "kama-ledger" entry inside "mcpServers" of claude_desktop_config.json, save, then fully quit and reopen Claude Desktop.');
console.log('Open the Kama Ledger desktop app once (and scan or add an item) so it saves your price list.');
