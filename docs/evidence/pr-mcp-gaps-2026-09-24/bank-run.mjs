// Black-box stdio runner: node bank-run.mjs <repoRoot> <out.jsonl> <pairs.json|-> -- <server args...>
// Calls every tool the way an agent would; records structuredContent and the text summary.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [repo, out, pairsFile, , ...serverArgs] = process.argv.slice(2);
const require = createRequire('/Users/austinho/dev/tracer/package.json');
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
let client;
const connect = async () => { client = new Client({ name: 'bank', version: '1' }); client.onerror = () => {};
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repo, 'mcp/server.mjs'), ...serverArgs], stderr: process.env.BANK_STDERR ? 'inherit' : 'ignore' })); };
await connect();
const lines = [];
// A reply over the SDK client's 10 MB read buffer closes the connection: record the error and reconnect.
const call = async (name, args) => { if (process.env.BANK_STDERR) console.error('call', name, JSON.stringify(args));
  try { const reply = await client.callTool({ name, arguments: args }); const row = { name, args, structured: reply.structuredContent, text: reply.content[0].text }; lines.push(row); return row.structured; }
  catch (error) { lines.push({ name, args, structured: { transport_error: String(error.message) }, text: '' }); try { await client.close(); } catch {} await connect(); return {}; } };
const tools = await client.listTools();
lines.push({ name: 'tools/list', args: {}, structured: tools.tools.map(tool => tool.name), text: '' });
const recent = await call('recent_actions', { n: 100 });
const ids = recent.actions.map(action => action.action_id);
const keys = [...new Set(recent.actions.map(action => action.element_key).filter(Boolean))];
for (const id of ids) await call('action_chain', { action_id: id });
for (const key of keys) await call('element_history', { element_key: key });
const probes = [{ selector: 'form' }, { selector: 'div > form > textarea#prompt-textarea', name: 'Message input' }, { element_path: 'div > div > button', nearby_text: 'Save' }, { role: 'menuitem' }, { role: 'button', name: 'Save' }, { name: 'Send message' }, { selector: 'button' }];
for (const probe of probes) await call('resolve_element', probe);
if (pairsFile !== '-') for (const pair of JSON.parse(fs.readFileSync(pairsFile, 'utf8'))) await call('compare_chains', { before_action_id: pair.before, after_action_id: pair.after });
if (tools.tools.some(tool => tool.name === 'page_requests')) { await call('page_requests', {}); await call('page_requests', { attribution: 'none', n: 500 }); }
await client.close();
fs.writeFileSync(out, lines.map(row => JSON.stringify(row)).join('\n') + '\n');
console.log(`${lines.length} calls → ${out}`);
