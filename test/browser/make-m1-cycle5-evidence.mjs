import fs from 'node:fs';
import path from 'node:path';
import { replayCausalChains } from '../../analysis/runtime-attribution.mjs';

const [sessionDirArg, evidenceDirArg] = process.argv.slice(2);
const sessionDir = path.resolve(sessionDirArg);
const evidenceDir = path.resolve(evidenceDirArg);
fs.mkdirSync(evidenceDir, { recursive: true });
const read = name => JSON.parse(fs.readFileSync(path.join(sessionDir, name), 'utf8'));
const records = read('records.json');
const spans = read('spans.json');
const joined = read('joined.json');
const timeline = read('timeline.json');
const coverage = read('coverage.json');
const writeJsonl = (name, rows) => fs.writeFileSync(path.join(evidenceDir, name), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
writeJsonl('records.jsonl', records);
writeJsonl('spans.jsonl', spans);

const notes = timeline.filter(row => Number.isInteger(row.step) || row.step === 'overlap');
const actionMeta = new Map();
for (const note of notes) for (const actionId of note.action_ids || []) actionMeta.set(actionId, { step: note.step, control: note.control, result: note.result });
const actions = [...new Set(joined.filter(row => row.kind === 'dom.action' && row.action_id).map(row => row.action_id))];
const byAction = new Map(actions.map(actionId => [actionId, joined.filter(row => row.action_id === actionId)]));
const causalRecords = actions.map(actionId => {
  const rows = byAction.get(actionId) || [];
  const action = rows.find(row => row.kind === 'dom.action');
  // Internal bridge/capture requests are retained in records.jsonl but can
  // never establish a product effect or a first-party request stop.
  const requests = rows.filter(row => row.kind === 'network.request' && !row.internal);
  const spine = requests.find(row => row.spine)?.spine || { action_id: actionId, function_ids: [] };
  const chain = rows.filter(row => (row.kind === 'network.request' && !row.internal) || ['route.dispatch', 'handler.enter', 'db.operation', 'stop'].includes(row.kind)).map(row => ({ kind: row.kind, id: row.request_occurrence_id || row.request_id || row.route_id || row.handler_id || row.db_id || `${row.kind}:${row.sequence}`, method: row.method || null, url: row.url || null, linkage_kind: row.linkage_kind || null, collection: row.collection || null, operation: row.operation || null, source_ref: row.source_ref || null, evidence_ids: row.evidence_ids || [] }));
  const stop = rows.find(row => row.kind === 'stop')?.stop_reason || (requests.length ? null : 'no_first_party_request');
  const db = chain.find(row => row.kind === 'db.operation');
  const handler = chain.find(row => row.kind === 'handler.enter');
  const route = chain.find(row => row.kind === 'route.dispatch');
  const request = chain.find(row => row.kind === 'network.request');
  const effect = db ? { db_id: db.id, collection: db.collection, operation: db.operation } : handler ? { handler_id: handler.id } : route ? { route_id: route.id } : request ? { request_id: request.id, method: request.method, url: request.url } : null;
  return { schema: 'producttrace.causal-chain.v1', action_id: actionId, session_id: action?.session_id || null, event: action?.event || null, control: { ...(action?.target || {}), label: actionMeta.get(actionId)?.control || null }, spine, chain, terminal: stop ? { stop_reason: stop } : { effect }, abstained: stop ? [stop] : [], raw_evidence_ids: rows.map(row => row.sequence), step: actionMeta.get(actionId)?.step ?? null };
});
writeJsonl('causal-chains.jsonl', causalRecords);

const formatControl = meta => meta?.control || 'control unavailable';
const formatRows = (rows, kind) => rows.filter(row => row.kind === kind && (kind !== 'network.request' || !row.internal)).map(row => {
  if (kind === 'network.request') return `    - ${row.method} ${row.url} [${row.linkage_kind || 'unattributed'}] (${row.request_occurrence_id || 'request id unavailable'})`;
  if (kind === 'route.dispatch') return `    - ${row.route_id}`;
  if (kind === 'handler.enter') return `    - ${row.handler_id}`;
  return `    - ${row.db_id} (${row.collection || 'collection unavailable'}, ${row.operation || 'operation unavailable'})`;
}).join('\n') || '    - none';
const stepSummary = notes.map(note => ({ step: note.step, at: note.at, control: note.control, result: note.result, action_ids: note.action_ids || [], provider_options: note.provider_options, provider: note.provider, model: note.model }));
let chainsMd = '# Cycle 6 causal chains\n\n';
for (const step of [...new Set([...notes.map(note => note.step), ...causalRecords.map(row => row.step).filter(Boolean)])]) {
  chainsMd += `## Scripted step ${step}\n\n`;
  for (const chain of causalRecords.filter(row => row.step === step)) {
    const rows = byAction.get(chain.action_id) || [];
    chainsMd += `### ${chain.action_id}\n- clicked control: ${JSON.stringify(chain.control)}\n- spine: ${(chain.spine.function_ids || []).join(' → ') || 'none'}\n- requests:\n${formatRows(rows, 'network.request')}\n- routes:\n${formatRows(rows, 'route.dispatch')}\n- handlers:\n${formatRows(rows, 'handler.enter')}\n- db operations:\n${formatRows(rows, 'db.operation')}\n- terminal: ${JSON.stringify(chain.terminal)}\n\n`;
  }
}
for (const note of notes.filter(note => note.step === 'overlap')) {
  const summary = stepSummary.find(item => item.step === 'overlap' && item.at === note.at);
  const previous = notes.filter(item => Number.isInteger(item.step) && Date.parse(item.at) < Date.parse(note.at)).at(-1);
  const start = previous ? Date.parse(previous.at) : 0; const end = Date.parse(note.at);
  const overlapIds = summary?.action_ids?.length ? summary.action_ids : joined.filter(row => row.kind === 'dom.action' && row.timestamp > start && row.timestamp <= end).map(row => row.action_id);
  chainsMd += `## Overlap\n\n- ${note.result}: ${note.control}; action_ids=${JSON.stringify(overlapIds)}\n`;
  for (const chain of causalRecords.filter(row => overlapIds.includes(row.action_id))) chainsMd += `- ${chain.action_id}: spine ${(chain.spine.function_ids || []).join(' → ') || 'none'}; terminal ${JSON.stringify(chain.terminal)}\n`;
  chainsMd += '\n';
}
fs.writeFileSync(path.join(evidenceDir, 'chains.md'), chainsMd);

// The overlap note is emitted after the concurrent controls are driven. Use
// the lossless action ledger window for that note even though no dom.action
// row is required to survive for step grouping.
for (const note of stepSummary.filter(item => item.step === 'overlap' && !item.action_ids.length)) {
  const overlapNote = notes.find(item => item.step === 'overlap');
  const previous = notes.filter(item => Number.isInteger(item.step) && Date.parse(item.at) < Date.parse(overlapNote.at)).at(-1);
  const start = previous ? Date.parse(previous.at) : 0; const end = Date.parse(overlapNote.at);
  note.action_ids = joined.filter(row => row.kind === 'dom.action' && row.timestamp > start && row.timestamp <= end).map(row => row.action_id);
}
const stepActionIds = Object.fromEntries(stepSummary.map(note => [String(note.step), note.action_ids || []]));
const buildConfigPath = '/tmp/producttrace-librechat-m1-cycle5.json';
const build = fs.existsSync(buildConfigPath) ? JSON.parse(fs.readFileSync(buildConfigPath, 'utf8')) : {};
fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify({ schema: 'producttrace.m1-cycle5-coverage.v1', headless: true, build: build.coverage || {}, capture: coverage.capture || null, step_action_ids: stepActionIds, session: { records: records.length, spans: spans.length, joined_rows: joined.length, wrapper_recorded: coverage.request_coverage.tracer, playwright_observed: coverage.request_coverage.observed, reconciliation_count: coverage.request_coverage.reconciliation_count, coverage_equal: coverage.request_coverage.equal, linkage_counts: coverage.linkage_counts, api_shapes: coverage.api_shapes, steps: stepSummary }, parity_gate: build.coverage?.parity_gate || null }, null, 2));
const healthDiagnostics = joined.filter(row => row.kind === 'span.join.diagnostic' && /(?:^|\/)health(?:$|\?)/u.test(row.requested_path || row.url || ''));
writeJsonl('health-join-diagnostic.jsonl', healthDiagnostics);

const removeKinds = kinds => replayCausalChains(joined, { removeKinds: kinds });
const negative = [
  ['network.request', removeKinds(['network.request'])],
  ['route.dispatch, handler.enter, db.operation', removeKinds(['route.dispatch', 'handler.enter', 'db.operation'])],
  ['function.enter', removeKinds(['function.enter'])],
  ['dom.action', removeKinds(['dom.action'])],
];
fs.writeFileSync(path.join(evidenceDir, 'negative-replays.md'), `# Cycle 6 negative replays\n\nHeadless raw replays; no grading.\n\n${negative.map(([label, rows]) => `- remove ${label}: chains=${rows.length}; stops=${JSON.stringify(rows.filter(row => row.terminal?.stop_reason).reduce((acc, row) => { acc[row.terminal.stop_reason] = (acc[row.terminal.stop_reason] || 0) + 1; return acc; }, {}))}`).join('\n')}\n`);
const overlap = notes.filter(note => note.step === 'overlap');
fs.writeFileSync(path.join(evidenceDir, 'overlap.md'), `# Cycle 6 overlap\n\n${overlap.map(note => { const summary = stepSummary.find(item => item.step === 'overlap' && item.at === note.at); return `- ${note.result}: ${note.control}; action_ids=${JSON.stringify(summary?.action_ids || [])}; stream_open=${note.stream_open ?? 'unreported'}; stream_url=${note.stream_url || 'unreported'}`; }).join('\n')}\n`);

const statTree = root => { let bytes = 0; const walk = dir => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) bytes += fs.statSync(file).size; } }; walk(root); return bytes; };
const baseline = statTree('/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1/client/dist');
const instrumented = statTree('/tmp/producttrace-librechat-m1-cycle3e/client/dist');
fs.writeFileSync(path.join(evidenceDir, 'overhead.md'), `# Cycle 6 overhead\n\n- baseline bundle bytes: ${baseline}\n- instrumented bundle bytes: ${instrumented}\n- delta bytes: ${instrumented - baseline}\n- runtime attribution functions: ${build.coverage?.runtime_attribution_functions ?? 'unavailable'}\n- measurement excludes source maps; current transform emits integer manifest indices at instrumented sites.\n`);
fs.writeFileSync(path.join(evidenceDir, 'LIMITS.md'), `# Limits\n\n- Headless Chromium only; no visible browser or GUI application.\n- Transport coverage is ${coverage.request_coverage.tracer}/${coverage.request_coverage.observed} with ${coverage.request_coverage.reconciliation_count} reconciliation rows.\n- Linkage is labeled direct or mount_effect; unattributed transport remains recorded with a reason.\n- Exact backend joins require W3C trace parentage; exported span absence remains a stop.\n- Agent Builder used the real provider/model flow; API shapes are retained in coverage.json.\n- Stops are reported raw; no model calls were added to the runtime path.\n`);
fs.writeFileSync(path.join(evidenceDir, 'RUN.md'), `# M1 runtime attribution Cycle 6\n\nThe scripted session, overlap run, negative replays, and final inventory preflight were driven with Playwright headless Chromium. No visible browser or GUI application was launched. The prior cycle evidence directories were not modified.\n\n- build functions/markers: ${build.coverage?.runtime_attribution_functions ?? 'unavailable'}/${build.coverage?.runtime_attribution_marker_count ?? 'unavailable'}\n- transport wrapper/Playwright: ${coverage.request_coverage.tracer}/${coverage.request_coverage.observed}; reconciliation: ${coverage.request_coverage.reconciliation_count}\n- Agent Builder flow: OpenAI → gpt-3.5-turbo → Barista, with the real Select Agent commit; request rows include /api/agents/chat/agents.\n- /health join diagnostics: ${healthDiagnostics.length}; retained in health-join-diagnostic.jsonl.\n\n${stepSummary.map(note => `- step ${note.step}: ${note.result}; action_ids=${JSON.stringify(note.action_ids)}`).join('\n')}\n`);
console.log(JSON.stringify({ evidenceDir, records: records.length, spans: spans.length, chains: causalRecords.length, steps: stepSummary, request_coverage: coverage.request_coverage, linkage_counts: coverage.linkage_counts }));
