// Entry-handler credit and abstention, base vs branch analysis, over banked stores (raw rows; both engines imported from their own checkouts).
import fs from 'node:fs'; import zlib from 'node:zlib';
const [baseRoot, branchRoot, ...files] = process.argv.slice(2);
const base = await import(`${baseRoot}/analysis/runtime-attribution.mjs`), branch = await import(`${branchRoot}/analysis/runtime-attribution.mjs`);
const read = f => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
for (const file of files) {
  const records = read(file);
  const a = base.indexEntryHandlerUnits(records), b = branch.indexEntryHandlerUnits(records);
  const actions = records.filter(r => r.kind === 'dom.action' && r.action_id);
  const changes = [];
  for (const act of actions) {
    const ca = a.byAction.get(act.action_id)?.[0] || null, cb = b.byAction.get(act.action_id)?.[0] || null;
    const xa = a.abstentions.get(act.action_id)?.because || null, xb = b.abstentions.get(act.action_id)?.because || null;
    const ra = ca ? a.units.get(ca).rooted_action_ids.includes(act.action_id) : null, rb = cb ? b.units.get(cb).rooted_action_ids.includes(act.action_id) : null;
    if (ca !== cb || xa !== xb || ra !== rb) changes.push({ action_id: act.action_id, event: act.event, base: { credit: ca, rooted: ra, abstain: xa }, branch: { credit: cb, rooted: rb, abstain: xb } });
  }
  console.log(JSON.stringify({ store: file.replace(/^.*evidence\//, ''), actions: actions.length, credited_base: a.byAction.size, credited_branch: b.byAction.size,
    abstentions_base: a.abstentions.size, abstentions_branch: b.abstentions.size, binding_rows: records.filter(r => r.kind === 'handler.binding').length, changed: changes.length, changes: changes.slice(0, 20) }));
}
