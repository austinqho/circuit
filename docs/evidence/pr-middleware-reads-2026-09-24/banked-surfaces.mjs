// Collect what the MCP tools print for every action of a store, from a given
// source tree (main or the branch), so the two can be diffed.
//   node banked-surfaces.mjs --tree <repo root> --store <dir> [--manifest <file>] --out <json>
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values: args } = parseArgs({ options: { tree: { type: 'string' }, store: { type: 'string' }, manifest: { type: 'string' }, out: { type: 'string' } } });
const tree = path.resolve(args.tree);
const { loadStore } = await import(pathToFileURL(path.join(tree, 'collector/store.mjs')).href);
const { callTool } = await import(pathToFileURL(path.join(tree, 'mcp/tools.mjs')).href);
const store = await loadStore({ dir: path.resolve(args.store), ...(args.manifest ? { manifest: path.resolve(args.manifest) } : {}) });
const out = {};
for (const actionId of [...new Set(store.actionRows.map(row => row.action_id))]) {
  const chain = callTool(store, 'action_chain', { action_id: actionId });
  if (chain.status !== 'ok') { out[actionId] = { status: chain.status }; continue; }
  out[actionId] = {
    status: chain.outcome.status, label: chain.outcome.label, reached: chain.reached, stopped_at: chain.stopped_at, because: chain.because,
    segments: (chain.segments || []).map(segment => ({ request_occurrence_id: segment.request_occurrence_id, method: segment.method, path: segment.path, http_status: segment.http_status,
      outcome: segment.outcome, label: segment.outcome_label, stopped_at: segment.stopped_at,
      ops: segment.db_ops.map(op => ({ span_id: op.span_id, operation: op.operation, collection: op.collection, issued_by: op.issued_by ?? null })) })),
    unlinked_server_ops: (chain.unlinked?.server_spans || []).flatMap(row => (row.db_ops || []).map(op => ({ server_span_id: row.span_id, span_id: op.span_id, operation: op.operation, collection: op.collection, issued_by: op.issued_by ?? null }))),
  };
}
fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} actions -> ${args.out}`);
