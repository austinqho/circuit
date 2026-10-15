// node dump.mjs <codeRoot> <out.json> <storeSpec...>   storeSpec = name=records[,spans[,manifestsDir|manifest.json]]
import fs from 'node:fs';
import zlib from 'node:zlib';
const [codeRoot, out, ...specs] = process.argv.slice(2);
const { createStore } = await import(`${codeRoot}/collector/store.mjs`);
const { callTool } = await import(`${codeRoot}/mcp/tools.mjs`);
const { indexWorkflowEpisodes } = await import(`${codeRoot}/analysis/runtime-attribution.mjs`);
const readRows = file => { if (!file || !fs.existsSync(file)) return []; let text = fs.readFileSync(file); if (file.endsWith('.gz')) text = zlib.gunzipSync(text); return text.toString('utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); };
const readJson = file => { let text = fs.readFileSync(file); if (file.endsWith('.gz')) text = zlib.gunzipSync(text); return JSON.parse(text.toString('utf8')); };
const result = {};
for (const spec of specs) {
  const [name, rest] = spec.split('='); const [recordsFile, spansFile, manifestSpec] = rest.split(',');
  const records = readRows(recordsFile), spans = readRows(spansFile);
  let manifest = null; const manifests = new Map();
  if (manifestSpec && fs.statSync(manifestSpec).isDirectory()) for (const file of fs.readdirSync(manifestSpec)) { const m = readJson(`${manifestSpec}/${file}`); manifests.set(m.build || file.replace(/\.json(\.gz)?$/u, ''), m); }
  else if (manifestSpec) manifest = readJson(manifestSpec);
  const store = createStore({ records, spans, manifest, manifests, now: () => 1e13 });
  const eps = indexWorkflowEpisodes(records);
  const episodes = [...eps.episodes.values()].map(e => [e.episode_id, e.carrier_action_id, e.action_ids]);
  const actions = {};
  for (const row of store.actionRows) {
    if (actions[row.action_id]) continue;
    const c = callTool(store, 'action_chain', { action_id: row.action_id });
    actions[row.action_id] = { event: row.event, episode_id: c.episode_id, carrier: c.episode_carrier_action_id, summary: c.summary,
      requests: (c.requests || []).map(r => `${r.method} ${r.url}`), segments: (c.segments || []).length, reached: c.reached, stopped_at: c.stopped_at, member: c.episode_member || false };
  }
  const attempts = {};
  for (const key of store.elementIndex.entries.keys()) {
    const h = callTool(store, 'element_history', { element_key: key, n: 100 });
    attempts[key] = { summary: h.summary, attempts: (h.attempts || []).map(a => ({ episode_id: a.episode_id, carrier: a.carrier_action_id, action_ids: a.action_ids, summary: a.summary, reached: a.reached, stopped_at: a.stopped_at, outcome: a.outcome?.status })) };
  }
  result[name] = { episodes, actions, attempts, stats: store.stats() };
}
fs.writeFileSync(out, JSON.stringify(result));
