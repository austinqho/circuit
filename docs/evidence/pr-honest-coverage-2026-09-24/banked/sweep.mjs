// node sweep.mjs <mainRoot> <branchRoot> <storeDir> [manifest]: every action's frontier, outcome label and coverage, main vs branch.
import path from 'node:path';
const [mainRoot, branchRoot, storeDir, manifestPath] = process.argv.slice(2);
const load = async root => {
  const { loadStore } = await import(path.join(root, 'collector/store.mjs'));
  const { callTool } = await import(path.join(root, 'mcp/tools.mjs'));
  const store = await loadStore({ dir: storeDir, ...(manifestPath ? { manifest: manifestPath } : {}) });
  return { store, callTool };
};
const sides = { main: await load(mainRoot), branch: await load(branchRoot) };
const ids = sides.branch.store.actionRows.map(row => row.action_id);
const counts = { actions: ids.length, stopped_at: 0, because: 0, label: 0, sentence: 0, status: 0, coverage_complete: 0, coverage_reasons: 0, first_line: 0 };
const examples = {};
for (const id of ids) {
  const [a, b] = ['main', 'branch'].map(side => sides[side].callTool(sides[side].store, 'action_chain', { action_id: id }));
  const diff = (key, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right)) { counts[key] += 1; (examples[key] ||= []).length < 3 && examples[key].push({ id, main: left, branch: right }); } };
  diff('stopped_at', a.stopped_at, b.stopped_at); diff('because', a.because, b.because); diff('label', a.outcome?.label, b.outcome?.label);
  diff('sentence', a.outcome?.sentence, b.outcome?.sentence); diff('status', a.outcome?.status, b.outcome?.status);
  diff('coverage_complete', a.coverage?.complete, b.coverage?.complete); diff('coverage_reasons', a.coverage?.reasons, b.coverage?.reasons);
  diff('first_line', a.summary.split('\n')[0], b.summary.split('\n')[0]);
}
console.log(JSON.stringify({ store: storeDir, counts, examples }, null, 1));
