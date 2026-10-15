// node banked-names.mjs <codeRoot> <storeDir> <out.json> [manifest] [sourceRoot]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [codeRoot, storeDir, out, manifestPath, sourceRoot] = process.argv.slice(2);
const { loadStore } = await import(pathToFileURL(path.join(codeRoot, 'collector/store.mjs')).href);
const { callTool } = await import(pathToFileURL(path.join(codeRoot, 'mcp/tools.mjs')).href);
const store = await loadStore({ dir: storeDir, ...(manifestPath && manifestPath !== '-' ? { manifest: manifestPath } : {}), ...(sourceRoot ? { sourceRoot } : {}) });
const ids = new Set();
for (const m of [store.manifest, ...(store.manifestsByBuild?.values?.() || [])].filter(Boolean)) for (const row of m.functions || []) ids.add(row.id);
const functions = {};
for (const id of ids) { const info = store.functionInfo(id); functions[id] = { name: info.name, name_status: info.name_status, label: info.label, display_name: info.display_name ?? null }; }
const texts = {};
for (const action of store.actionRows) { const r = callTool(store, 'action_chain', { action_id: action.action_id }); texts[action.action_id] = r.summary; }
fs.writeFileSync(out, JSON.stringify({ functions, texts }));
console.log(storeDir, 'functions', ids.size, 'actions', Object.keys(texts).length);
