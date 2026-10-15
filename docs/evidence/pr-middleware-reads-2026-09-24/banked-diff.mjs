// Diff two banked-surfaces.mjs outputs (main vs branch): every database
// operation that appears now and did not before (per request, by span id),
// with its issuer, and every action whose status, label or frontier changed.
//   node banked-diff.mjs <main.json> <branch.json> [--out <json>]
import fs from 'node:fs';
const [mainFile, branchFile] = process.argv.slice(2).filter(value => !value.startsWith('--'));
const outIndex = process.argv.indexOf('--out');
const before = JSON.parse(fs.readFileSync(mainFile, 'utf8')); const after = JSON.parse(fs.readFileSync(branchFile, 'utf8'));
const newOps = new Map(); const removedOps = []; const changed = [];
for (const [actionId, right] of Object.entries(after)) {
  const left = before[actionId];
  if (!left || right.status === undefined) continue;
  for (const [index, segment] of (right.segments || []).entries()) {
    const match = (segment.request_occurrence_id && left.segments?.find(row => row.request_occurrence_id === segment.request_occurrence_id)) || left.segments?.[index];
    const old = new Set((match?.ops || []).map(op => op.span_id));
    for (const op of segment.ops) if (!old.has(op.span_id)) {
      const key = `${segment.request_occurrence_id}|${op.span_id}`;
      if (!newOps.has(key)) newOps.set(key, { action_id: actionId, request: `${segment.method} ${segment.path}`, request_occurrence_id: segment.request_occurrence_id, span_id: op.span_id, op: `${op.operation} ${op.collection}`, issued_by: op.issued_by });
    }
    const now = new Set(segment.ops.map(op => op.span_id));
    for (const op of match?.ops || []) if (!now.has(op.span_id)) removedOps.push({ action_id: actionId, span_id: op.span_id });
  }
  const fields = ['status', 'label', 'reached', 'stopped_at', 'because'].filter(field => JSON.stringify(left[field]) !== JSON.stringify(right[field]));
  if (fields.length) changed.push({ action_id: actionId, fields, before: Object.fromEntries(fields.map(field => [field, left[field]])), after: Object.fromEntries(fields.map(field => [field, right[field]])) });
}
const ops = [...newOps.values()];
const byIssuer = {}; for (const op of ops) { const key = `${op.op} (${op.issued_by})`; byIssuer[key] = (byIssuer[key] || 0) + 1; }
const statusMoves = {}; for (const row of changed) if (row.fields.includes('status')) { const key = `${row.before.status} -> ${row.after.status}`; statusMoves[key] = (statusMoves[key] || 0) + 1; }
const result = { actions: Object.keys(after).length, new_ops: ops.length, new_ops_by_issuer: Object.fromEntries(Object.entries(byIssuer).sort((a, b) => b[1] - a[1])), removed_ops: removedOps.length,
  actions_changed: changed.length, status_moves: statusMoves, changed_fields: changed.reduce((acc, row) => { for (const field of row.fields) acc[field] = (acc[field] || 0) + 1; return acc; }, {}), ops, changed };
if (outIndex >= 0) fs.writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, ops: undefined, changed: undefined }, null, 2));
