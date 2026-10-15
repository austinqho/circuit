import fs from 'node:fs'; import zlib from 'node:zlib';
const [root, ...specs] = process.argv.slice(2);
const { createStore } = await import(`${root}/collector/store.mjs`); const { callTool } = await import(`${root}/mcp/tools.mjs`);
const rd = f => { if (!f || !fs.existsSync(f)) return []; let t = fs.readFileSync(f); if (f.endsWith('.gz')) t = zlib.gunzipSync(t); return t.toString().split('\n').filter(Boolean).map(JSON.parse); };
const rj = f => { let t = fs.readFileSync(f); if (f.endsWith('.gz')) t = zlib.gunzipSync(t); return JSON.parse(t); };
for (const spec of specs) { const [name, rest] = spec.split('='); const [r, sp, m] = rest.split(','); let manifest = null; const manifests = new Map();
  if (m && fs.statSync(m).isDirectory()) for (const f of fs.readdirSync(m)) { const x = rj(`${m}/${f}`); manifests.set(x.build, x); } else if (m) manifest = rj(m);
  const store = createStore({ records: rd(r), spans: rd(sp), manifest, manifests, now: () => 1e13 }); const counts = {}; let withPointer = 0, total = 0;
  for (const row of store.actionRows) { const c = callTool(store, 'action_chain', { action_id: row.action_id }); if (!c.episode_member) continue; total++; counts[c.outcome.status] = (counts[c.outcome.status] || 0) + 1; if (c.outcome.sentence.endsWith(c.episode_pointer)) withPointer++; }
  console.log(name, 'members', total, JSON.stringify(counts), 'sentence ends with pointer', withPointer); }
