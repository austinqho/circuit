// Independent G1 grader. Recomputes every action's terminal from raw
// records.jsonl + spans.jsonl WITHOUT the analysis package, compares it with
// causal-chains.jsonl, checks the final7 entry handlers per flow, and (with
// --mongo) confirms joined writes against MongoDB in the run window.
//   node test/browser/g1-grade.mjs <evidenceDir> --backend=on|off [--final7=<final7 coverage.json>] [--corrections=<flow->function json>] [--mongo=<uri>] [--email=<user>]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const evidenceDir = path.resolve(process.argv[2] || '');
const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const backend = flag('backend');
if (!['on', 'off'].includes(backend)) { console.error('--backend=on|off is required'); process.exit(2); }
// Evidence stores large raw files gzipped (lossless); read either form.
const readJsonl = async file => {
  const rows = []; const gz = `${file}.gz`; if (!fs.existsSync(file) && !fs.existsSync(gz)) return rows;
  const input = fs.existsSync(file) ? fs.createReadStream(file) : fs.createReadStream(gz).pipe(zlib.createGunzip());
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
};
const records = await readJsonl(path.join(evidenceDir, 'records.jsonl'));
const spans = await readJsonl(path.join(evidenceDir, 'spans.jsonl'));
const chains = await readJsonl(path.join(evidenceDir, 'causal-chains.jsonl'));
const timeline = await readJsonl(path.join(evidenceDir, 'timeline.jsonl'));

// --- independent terminal recomputation -----------------------------------
const actions = records.filter(row => row.kind === 'dom.action');
const requestsByAction = new Map();
for (const row of records) if (row.kind === 'network.request' && row.internal !== true && row.action_id) {
  const values = requestsByAction.get(row.action_id) || []; values.push(row); requestsByAction.set(row.action_id, values);
}
const spansByTrace = new Map();
for (const span of spans) if (span?.trace_id) { const values = spansByTrace.get(span.trace_id) || []; values.push(span); spansByTrace.set(span.trace_id, values); }
const method = span => String(span.attributes?.['http.request.method'] ?? span.attributes?.['http.method'] ?? '').toUpperCase();
const isDb = span => Boolean(span.attributes?.['db.system.name'] || span.attributes?.['db.system'] || /mongo/u.test(span.instrumentation?.name || ''));
const descends = (span, ancestorId, byId) => { const seen = new Set(); let parent = span.parent_span_id; while (parent && !seen.has(parent)) { if (parent === ancestorId) return true; seen.add(parent); parent = byId.get(parent)?.parent_span_id; } return false; };
const writeOp = operation => /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu.test(String(operation || ''));
const dbOperation = span => span.attributes?.['db.operation.name'] || span.attributes?.['db.operation'] || span.name || null;
const depthRank = { network: 1, server: 2, handler: 3, db: 4 };
const collectionOf = span => { const a = span?.attributes || {}; const raw = a['db.collection.name'] ?? a['db.mongodb.collection'] ?? null; return raw === '$cmd' ? (a['producttrace.mongo.command_collection'] ?? null) : raw; };
function requestTerminal(request) {
  if (backend === 'off') return { depth: 'network', stopped_at: 'network', because: 'backend not instrumented', writes: [] };
  const trace = request.trace_context?.trace_id; const parent = request.trace_context?.span_id;
  const candidates = spansByTrace.get(trace) || [];
  const servers = candidates.filter(span => span.schema === 'producttrace.backend-span.v1' && span.kind === 'server' && span.parent_span_id === parent && method(span) === String(request.method || 'GET').toUpperCase());
  if (servers.length !== 1) return { depth: 'network', stopped_at: 'network', because: 'no span on trace', writes: [] };
  const byId = new Map(candidates.map(span => [span.span_id, span]));
  const handlers = candidates.filter(span => span.instrumentation?.name === 'producttrace-express-handlers' && descends(span, servers[0].span_id, byId));
  if (!handlers.length) return { depth: 'server', stopped_at: 'server', because: 'no handler span under server span', writes: [] };
  const dbs = candidates.filter(span => isDb(span) && handlers.some(handler => descends(span, handler.span_id, byId)));
  if (!dbs.length) return { depth: 'handler', stopped_at: 'handler', because: 'no db span under handler', writes: [] };
  return { depth: 'db', stopped_at: null, because: null, writes: dbs.filter(span => writeOp(dbOperation(span))).map(span => ({ span_id: span.span_id, operation: dbOperation(span) })) };
}
// Handler abstention, recomputed independently: with no request, the credited
// frame is the depth-zero non-render/effect frame that owns the action's DOM
// mutation (by continuation ancestry), else the earliest event-invoked one; when
// dom.action.bound_handlers is recorded and that frame is not in it, the chain
// must stop at 'handler' naming the unbound event-invoked frames.
const parentOf = new Map();
for (const row of records) if (row.continuation_id && row.parent_continuation_id && row.continuation_id !== row.parent_continuation_id) parentOf.set(row.continuation_id, row.parent_continuation_id);
const ancestorOf = (id, ancestor) => { const seen = new Set(); for (let cursor = id; cursor && !seen.has(cursor); cursor = parentOf.get(cursor)) { if (cursor === ancestor) return true; seen.add(cursor); } return false; };
const depthZero = new Map(), mutationsByAction = new Map();
for (const row of records) {
  if (row.kind === 'dom.mutation' && row.action_id) { const values = mutationsByAction.get(row.action_id) || []; values.push(row); mutationsByAction.set(row.action_id, values); }
  if (row.kind !== 'function.enter' || !row.action_id || (row.spine?.function_ids || []).length !== 1 || row.invoked_by === 'render' || row.invoked_by === 'effect') continue;
  const values = depthZero.get(row.action_id) || []; values.push(row); depthZero.set(row.action_id, values);
}
const handlerAbstention = action => {
  const bound = action.bound_handlers?.ids;
  if (!Array.isArray(bound)) return null;
  const frames = (depthZero.get(action.action_id) || []).sort((a, b) => a.sequence - b.sequence);
  const mutations = mutationsByAction.get(action.action_id) || [];
  const selected = mutations.length
    ? frames.find(frame => mutations.some(mutation => ancestorOf(mutation.parent_continuation_id, frame.continuation_id)))
    : frames.find(frame => frame.invoked_by === 'event');
  if (!selected || bound.includes(selected.function_id)) return null;
  const listeners = [...new Set(frames.filter(frame => frame.invoked_by === 'event' && !bound.includes(frame.function_id)).map(frame => frame.function_id))];
  return { stopped_at: 'entry_handler', because: `no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [${listeners.join(', ')}]`, writes: [] };
};
const expected = new Map();
for (const action of actions) {
  const requests = requestsByAction.get(action.action_id) || [];
  if (!requests.length) { expected.set(action.action_id, handlerAbstention(action) || { stopped_at: 'browser', because: 'no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)', writes: [] }); continue; }
  const terminals = requests.map(requestTerminal).sort((a, b) => depthRank[b.depth] - depthRank[a.depth] || b.writes.length - a.writes.length);
  expected.set(action.action_id, { stopped_at: terminals[0].stopped_at, because: terminals[0].because, writes: terminals.flatMap(row => row.writes) });
}
const chainByAction = new Map(chains.map(chain => [chain.action_id, chain]));
const mismatches = [];
for (const [actionId, want] of expected) {
  const chain = chainByAction.get(actionId);
  if (!chain) { mismatches.push({ action_id: actionId, reason: 'missing_chain' }); continue; }
  if (chain.stopped_at !== want.stopped_at || chain.because !== want.because) mismatches.push({ action_id: actionId, want: [want.stopped_at, want.because], got: [chain.stopped_at, chain.because] });
}
const extraChains = chains.filter(chain => !expected.has(chain.action_id)).length;
const backendRowsInRecords = records.filter(row => ['route.dispatch', 'handler.enter', 'db.operation'].includes(row.kind)).length;
const chainsWithBackendSteps = chains.filter(chain => (chain.reached || []).some(step => ['route', 'server_handler', 'db'].includes(step.stop))).length;
const terminalCounts = {};
for (const want of expected.values()) { const key = `${want.stopped_at ?? 'reached_db'} | ${want.because ?? '-'}`; terminalCounts[key] = (terminalCounts[key] || 0) + 1; }

// --- flows: final7 entry handlers and joined writes -------------------------
const flowSteps = { 1: 'login', 2: 'send', 4: 'feedback', 5: 'regenerate', 6: 'edit-resubmit', 7: 'rename', 8: 'agent-create', 9: 'agent-chat', 10: 'delete' };
const final7Path = flag('final7');
const final7 = final7Path && fs.existsSync(final7Path) ? JSON.parse(fs.readFileSync(final7Path, 'utf8')).flows : null;
// Documented corrections to final7's HANDLERS table (flow -> { function_id, reason }).
const correctionsPath = flag('corrections');
const corrections = correctionsPath ? JSON.parse(fs.readFileSync(correctionsPath, 'utf8')) : {};
const flows = {};
for (const note of timeline.filter(entry => Number.isInteger(entry.step) && flowSteps[entry.step])) {
  const flow = flowSteps[note.step];
  const actionIds = note.action_ids || [];
  const credited = [...new Set(actionIds.map(id => chainByAction.get(id)?.entry_handler?.function_id).filter(Boolean))];
  const want = corrections[flow]?.function_id || final7?.[flow]?.function_id || null;
  const writes = actionIds.flatMap(id => (expected.get(id)?.writes || []).map(write => ({ action_id: id, ...write, collection: collectionOf(spans.find(span => span.span_id === write.span_id)) })));
  flows[flow] = { step: note.step, result: note.result, actions: actionIds.length, expected_function_id: want,
    handler_reproduced: want ? credited.includes(want) : null, credited_function_ids: credited,
    frontiers: [...new Set(actionIds.map(id => { const w = expected.get(id); return w ? `${w.stopped_at ?? 'reached_db'} | ${w.because ?? '-'}` : 'no_chain'; }))],
    joined_writes: writes };
}

// --- Mongo confirmation (backend on) ---------------------------------------
let mongo = null;
const mongoUri = flag('mongo');
if (mongoUri && backend === 'on') {
  const email = flag('email') || 'tracer-m1@example.test';
  const times = records.map(row => Number(row.timestamp)).filter(Number.isFinite);
  const window = { start: new Date(times.reduce((a, b) => Math.min(a, b), Infinity) - 1000).toISOString(), end: new Date(times.reduce((a, b) => Math.max(a, b), -Infinity) + 60000).toISOString() };
  const collections = [...new Set(Object.values(flows).flatMap(flow => flow.joined_writes.filter(write => !/delete|remove/iu.test(write.operation)).map(write => write.collection)).filter(name => name && !name.startsWith('$')))];
  const script = `const u = db.users.findOne({ email: ${JSON.stringify(email)} }); const out = { user: u ? String(u._id) : null, collections: {} };
    if (u) for (const name of ${JSON.stringify(collections)}) { const c = db.getCollection(name); const q = { $and: [ { $or: [ { user: u._id }, { user: String(u._id) }, { author: u._id }, { author: String(u._id) } ] },
      { $or: [ { updatedAt: { $gte: new Date(${JSON.stringify(window.start)}), $lte: new Date(${JSON.stringify(window.end)}) } }, { createdAt: { $gte: new Date(${JSON.stringify(window.start)}), $lte: new Date(${JSON.stringify(window.end)}) } } ] } ] };
      out.collections[name] = c.countDocuments(q); }
    print(JSON.stringify(out));`;
  try { mongo = { window, ...JSON.parse(execFileSync('mongosh', ['--quiet', mongoUri, '--eval', script], { encoding: 'utf8' }).trim().split('\n').at(-1)) }; }
  catch (error) { mongo = { window, error: String(error.message || error).slice(0, 300) }; }
}

const grade = {
  schema: 'producttrace.g1-grade.v1', backend_instrumented: backend === 'on', grader: 'independent recomputation from raw records.jsonl + spans.jsonl (no analysis package import)',
  actions: actions.length, chains: chains.length, extra_chains: extraChains, mismatches: mismatches.length, mismatch_examples: mismatches.slice(0, 20),
  terminal_counts: terminalCounts, backend_rows_in_records: backendRowsInRecords, chains_with_backend_steps: chainsWithBackendSteps,
  spans: spans.length, flows, mongo,
};
if (backend === 'off') grade.pass = mismatches.length === 0 && extraChains === 0 && chainsWithBackendSteps === 0 && backendRowsInRecords === 0
  && Object.keys(terminalCounts).every(key => key === 'network | backend not instrumented' || key === 'browser | no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)' || key.startsWith('entry_handler | no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen)'));
else grade.pass = mismatches.length === 0 && extraChains === 0 && Object.values(flows).every(flow => flow.handler_reproduced !== false)
  && Object.entries(flows).filter(([name]) => name !== 'login').every(([, flow]) => flow.joined_writes.length > 0);
fs.writeFileSync(path.join(evidenceDir, 'GRADE-g1.json'), JSON.stringify(grade, null, 2));
console.log(JSON.stringify({ pass: grade.pass, actions: grade.actions, mismatches: grade.mismatches, terminal_counts: terminalCounts, chains_with_backend_steps: chainsWithBackendSteps,
  flows: Object.fromEntries(Object.entries(flows).map(([name, flow]) => [name, { handler_reproduced: flow.handler_reproduced, writes: flow.joined_writes.length, frontiers: flow.frontiers }])), mongo }, null, 2));
if (!grade.pass) process.exitCode = 1;
