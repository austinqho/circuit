import fs from 'node:fs';
const [root, rowsFile] = process.argv.slice(2);
const { createStore } = await import(`${root}/collector/store.mjs`);
const { callTool } = await import(`${root}/mcp/tools.mjs`);
const rows = fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const store = createStore({ records: rows, spans: [], now: () => 1e13 });
const acts = rows.filter(r => r.kind === 'dom.action');
for (const a of acts.filter(a => a.event === 'focusin')) {
  const c = callTool(store, 'action_chain', { action_id: a.action_id });
  const s = JSON.stringify(c) + ' ' + JSON.stringify((c.requests || []).map(r => r.method + ' ' + r.url)) + ' ' + c.summary;
  console.log(a.action_id, a.gesture === false ? 'caused' : 'gesture', 'mentions:', ['/api/items/auto', '/api/items/effect', '/api/notes', '/api/search', 'DELETE /api/items/later'].filter(u => s.includes(u)).join(',') || '-');
}
