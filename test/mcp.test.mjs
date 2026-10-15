import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStore, loadStore } from '../collector/store.mjs';
import { callTool, normalizeIdSegments, TOOL_SCHEMAS } from '../mcp/tools.mjs';
import { buildEpisodeChain } from '../analysis/causal-chain.mjs';
import { indexElementStamps, resolveElement as resolveStamp } from '../analysis/element-index.mjs';
import { indexWorkflowEpisodes } from '../analysis/runtime-attribution.mjs';
import { gradeRequestJoin, readFlowActions, readHandlerKey } from './g4-grader.mjs';
import { BUTTON, KEYED_ROW, PLAIN_ROW, runRootsAndIndexScenario, runStableKeysScenario } from './helpers/stable-keys-scenario.mjs';

const root = path.resolve(import.meta.dirname, '..');
const final7 = path.join(root, 'docs/evidence/m1-2026-09-22-final7');
const manifestPath = path.join(root, 'docs/evidence/g4-mcp-2026-09-23/manifest.json');
const fixture = '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1';
const SEND = 'action:mud8sc1x:9', AGENT_CHAT = 'action:mud8tqrr:34', RENAME = 'action:mud8sw9p:16';
const REGENERATE = 'action:mud8smva:4', OVERLAP_REGENERATE = 'action:mud8sys4:17';

let store, frontendOnly, manifest;
before(async () => {
  store = await loadStore({ dir: final7, manifest: manifestPath, sourceRoot: fs.existsSync(fixture) ? fixture : null });
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  frontendOnly = createStore({ records: store.records, spans: [], manifest });
});

test('action_chain for the send action reaches POST /api/agents/chat/openAI → route → handler → the graded Mongo ops', () => {
  const result = callTool(store, 'action_chain', { action_id: SEND });
  assert.equal(result.status, 'ok');
  const kinds = result.stops.map(stop => stop.stop);
  assert.deepEqual(kinds.slice(0, 5), ['dispatch', 'entry_handler', 'request', 'route', 'handler']);
  const request = result.stops.find(stop => stop.stop === 'request');
  assert.equal(`${request.method} ${request.url}`, 'POST /api/agents/chat/openAI');
  const route = result.stops.find(stop => stop.stop === 'route');
  assert.equal(route.route, '/api/agents/chat/:endpoint');
  assert.equal(route.status_code, 200);
  assert.deepEqual(result.stops.filter(stop => stop.stop === 'handler').map(stop => stop.name), ['controller']);
  // Independent recomputation from raw spans (trace id + exact parent + method).
  const requestRow = store.records.find(row => row.request_occurrence_id === request.request_occurrence_id && row.kind === 'network.request');
  const graded = gradeRequestJoin(requestRow, store.spans);
  assert.equal(route.span_id, graded.server.span_id);
  assert.deepEqual(result.stops.filter(stop => stop.stop === 'db').map(stop => stop.span_id).sort(), graded.dbs.map(db => db.span_id).sort());
  assert.deepEqual(result.outcome.writes, ['findAndModify conversations', 'findAndModify messages', 'insert transactions']);
  assert.equal(result.reached, 'db');
  assert.equal(result.stopped_at, null);
  assert.match(result.summary, /reached db \/ stopped at none .* \/ because database write/u);
  // Entry handler matches the HANDLERS.md answer key.
  const key = readHandlerKey(path.join(final7, 'HANDLERS.md'));
  assert.equal(result.stops.find(stop => stop.stop === 'entry_handler').function_id, key.send.function_id);
  assert.equal(result.chain.schema, 'producttrace.causal-chain.v1');
});

test('every flow in HANDLERS.md: action_chain credits the answer-key handler and element_history lists the action', () => {
  const key = readHandlerKey(path.join(final7, 'HANDLERS.md'));
  const flows = readFlowActions(path.join(final7, 'causal-chains.jsonl'));
  assert.equal(Object.keys(flows).length, 9);
  for (const [flow, actionIds] of Object.entries(flows)) {
    const chain = callTool(store, 'action_chain', { action_id: actionIds[0] });
    const entry = chain.stops.find(stop => stop.stop === 'entry_handler');
    assert.equal(entry.function_id, key[flow].function_id, flow);
    assert.equal(entry.source.file, key[flow].file, flow);
    const resolved = callTool(store, 'resolve_element', { element_key: `handler:${key[flow].function_id}|${key[flow].event}` });
    assert.equal(resolved.status, 'ok', flow);
    assert.equal(resolved.confidence, 'handler_placement', flow);
    const history = callTool(store, 'element_history', { element_key: resolved.element_key, n: 100 });
    for (const actionId of actionIds) assert.ok(history.actions.some(action => action.action_id === actionId), `${flow} ${actionId}`);
  }
});

test('source lines come from the checkout only when its content hash matches the function id', { skip: !fs.existsSync(fixture) && 'LibreChat fixture not present' }, () => {
  const send = callTool(store, 'action_chain', { action_id: SEND }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(send.source.line_status, 'ok');
  const content = fs.readFileSync(path.join(fixture, send.source.file), 'utf8');
  assert.equal(send.source.line, content.slice(0, send.source.start).split('\n').length);
  // A checkout whose file differs is reported stale, never given a line.
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-stale-'));
  fs.mkdirSync(path.dirname(path.join(stale, send.source.file)), { recursive: true });
  fs.writeFileSync(path.join(stale, send.source.file), `${content}\n// edited`);
  const staleStore = createStore({ records: store.records, spans: store.spans, manifest, sourceRoot: stale });
  const staleEntry = callTool(staleStore, 'action_chain', { action_id: SEND }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(staleEntry.source.line, null);
  assert.equal(staleEntry.source.line_status, 'stale_build');
});

test('resolve_element without an element_key returns candidates and confidence "ambiguous", never a silent pick', () => {
  const single = callTool(store, 'resolve_element', { selector: 'div > form > textarea#prompt-textarea', name: 'Message input', nearby_text: 'Message input' });
  assert.equal(single.status, 'ambiguous');
  assert.equal(single.confidence, 'ambiguous');
  assert.ok(single.candidates.length >= 1);
  assert.equal(single.candidates[0].target.attributes.id, 'prompt-textarea');
  assert.ok(single.candidates[0].matched_on.includes('#prompt-textarea'));
  assert.ok(single.ignored.some(entry => /ancestor/u.test(entry.reason)));
  const many = callTool(store, 'resolve_element', { selector: 'form', url: 'http://127.0.0.1:3081/c/new' });
  assert.equal(many.confidence, 'ambiguous');
  assert.ok(many.candidates.length > 1);
  assert.ok(many.ignored.some(entry => entry.input === 'url'));
  const none = callTool(store, 'resolve_element', { selector: '#does-not-exist' });
  assert.equal(none.status, 'not_found');
  // A stated #id that no recorded target carries is not_found, not a tag-only candidate.
  for (const selector of ['span#zzz-not-here', 'textarea#zzz-not-here']) assert.equal(callTool(store, 'resolve_element', { selector }).status, 'not_found', selector);
  assert.equal(none.confidence, 'ambiguous');
  const unknownKey = callTool(store, 'resolve_element', { element_key: 'p_4f2a91:18-44#2' });
  assert.equal(unknownKey.status, 'not_found');
  const unknownKeyWithHints = callTool(store, 'resolve_element', { element_key: 'p_4f2a91:18-44#2', selector: 'form' });
  assert.equal(unknownKeyWithHints.status, 'ambiguous');
  assert.equal(unknownKeyWithHints.element_key_status, 'not_found');
});

test('compare_chains: ChatForm send vs agent-chat changes at the request; regenerate twice is identical; send vs rename changes', () => {
  // openAI vs agents under /api/agents/chat/:endpoint is a literal segment, not an id: a real change.
  const sends = callTool(store, 'compare_chains', { before_action_id: SEND, after_action_id: AGENT_CHAT });
  assert.equal(sends.status, 'ok');
  assert.equal(sends.path_changed, true);
  // fix/middleware-reads: the full operation list is compared, so the agents
  // endpoint's two extra middleware reads are added stops; everything else is the same.
  const middlewareAdded = ['find agents (middleware: buildEndpointOption)', 'find systemgrants (middleware: <anonymous>)'];
  for (const stop of sends.stops) {
    if (stop.stop === 'request') { assert.equal(stop.status, 'changed'); assert.equal(stop.change_kind, 'different_value'); }
    else if (middlewareAdded.includes(stop.key)) assert.equal(stop.status, 'added', stop.key);
    else assert.equal(stop.status, 'same', `${stop.stop} ${stop.key}`);
  }
  assert.deepEqual(sends.outcome_delta.changed, []);
  assert.match(sends.summary, /^runtime path changed/u);
  // The two regenerates differ by one middleware read (validateConvoAccess on
  // `conversations` in the first only); every handler operation is the same.
  const regenerates = callTool(store, 'compare_chains', { before_action_id: REGENERATE, after_action_id: OVERLAP_REGENERATE });
  assert.deepEqual(regenerates.stops.filter(stop => stop.status !== 'same').map(stop => `${stop.status} ${stop.key}`), ['removed find conversations (middleware: validateConvoAccess)']);
  assert.equal(regenerates.path_changed, true);
  assert.deepEqual(regenerates.path_change_reasons, ['db']);
  const rename = callTool(store, 'compare_chains', { before_action_id: SEND, after_action_id: RENAME });
  assert.equal(rename.path_changed, true);
  assert.equal(rename.stops.find(stop => stop.stop === 'entry_handler').change_kind, 'different_handler');
  assert.equal(rename.stops.find(stop => stop.stop === 'route').status, 'changed');
  assert.equal(rename.stops.find(stop => stop.key === 'insert transactions (handler: controller)').status, 'removed');
  // The same write by different server code is a different operation.
  assert.equal(rename.stops.find(stop => stop.key === 'findAndModify conversations (handler: controller)').status, 'removed');
  assert.equal(rename.stops.find(stop => stop.key === 'findAndModify conversations (handler: <anonymous>)').status, 'added');
  assert.ok(rename.outcome_delta.changed.includes('writes'));
  assert.ok(rename.outcome_delta.changed.includes('http_status'));
});

test('compare_chains: a different credited handler is a path change even when every backend stop is the same', () => {
  // send (ChatForm submit) vs overlap regenerate (ContentRender click): same request, route, handler and DB ops.
  const result = callTool(store, 'compare_chains', { before_action_id: SEND, after_action_id: OVERLAP_REGENERATE });
  const entry = result.stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.change_kind, 'different_handler');
  assert.ok(result.stops.filter(stop => stop.stop !== 'entry_handler').every(stop => stop.status === 'same'));
  assert.equal(result.path_changed, true);
  assert.deepEqual(result.path_change_reasons, ['entry_handler']);
  // Two functions in one unchanged file (same content hash) are different handlers, not a source move.
  const sameFile = callTool(store, 'compare_chains', { before_action_id: 'action:mud8sbvl:6', after_action_id: SEND });
  assert.equal(sameFile.stops.find(stop => stop.stop === 'entry_handler').change_kind, 'different_handler');
});

test('request comparison normalizes only id-shaped segments', () => {
  assert.equal(normalizeIdSegments('/api/messages/f5671dfe-05e8-56bb-9f02-6aea011ec4a5/ec05db9b-e9e8-4b78-afa2-cba32a1903a1/feedback'), '/api/messages/:id/:id/feedback');
  assert.equal(normalizeIdSegments('/api/permissions/agent/6ab3006115c2b3a3b022f2e9/effective'), '/api/permissions/agent/:id/effective');
  assert.equal(normalizeIdSegments('/api/items/12345/deadbeef'), '/api/items/:id/:id');
  assert.equal(normalizeIdSegments('/api/agents/chat/openAI'), '/api/agents/chat/openAI');
  // Prefixed ids (real final7 agent id from GET /api/agents/agent_YAQ8Y1HJYBF3MirpqmkeZ) are id-shaped.
  assert.ok(store.records.some(row => row.kind === 'network.request' && row.url === '/api/agents/agent_YAQ8Y1HJYBF3MirpqmkeZ'));
  assert.equal(normalizeIdSegments('/api/agents/agent_YAQ8Y1HJYBF3MirpqmkeZ'), '/api/agents/:id');
  assert.equal(normalizeIdSegments('/api/agents/agent_YAQ8Y1HJYBF3MirpqmkeZ/expanded'), '/api/agents/:id/expanded');
  assert.equal(normalizeIdSegments('/v1/threads/thread_abc123DEF456/runs/run_9xYz12345'), '/v1/threads/:id/runs/:id');
  // Plain snake_case words and short suffixes stay literal.
  assert.equal(normalizeIdSegments('/api/effective_all_items'), '/api/effective_all_items');
  assert.equal(normalizeIdSegments('/api/web_search/auth'), '/api/web_search/auth');
  assert.equal(normalizeIdSegments('/api/abc1234'), '/api/abc1234');
});

test('frontend-only: with spans stripped, every request-bearing chain ends at an explicit network frontier', () => {
  const send = callTool(frontendOnly, 'action_chain', { action_id: SEND });
  assert.equal(send.stopped_at, 'network');
  assert.equal(send.because, 'backend not instrumented');
  assert.deepEqual(send.stops.map(stop => stop.stop), ['dispatch', 'entry_handler', 'request']);
  assert.equal(send.store.backend_instrumented, false);
  for (const actionId of new Set(frontendOnly.records.filter(row => row.kind === 'network.request' && row.action_id).map(row => row.action_id))) {
    const chain = callTool(frontendOnly, 'action_chain', { action_id: actionId });
    assert.equal(chain.stops.filter(stop => ['route', 'handler', 'db'].includes(stop.stop)).length, 0, actionId);
    if (chain.stops.some(stop => stop.stop === 'request')) assert.equal(chain.stopped_at, 'network', actionId);
  }
});

test('recent_actions is newest first by (timestamp, sequence) and honors session and n', () => {
  const result = callTool(store, 'recent_actions', { n: 5 });
  assert.equal(result.actions.length, 5);
  assert.equal(result.actions[0].action_id, 'action:mud8u8jo:38');
  for (let index = 1; index < result.actions.length; index += 1) assert.ok(result.actions[index - 1].timestamp >= result.actions[index].timestamp);
  const session = result.actions[0].session;
  const scoped = callTool(store, 'recent_actions', { session, n: 100 });
  assert.ok(scoped.actions.every(action => action.session === session));
  assert.equal(callTool(store, 'recent_actions', { session: 'no-such-page' }).status, 'not_found');
});

test('untrusted inputs are validated and never evaluated', () => {
  const cases = [
    ['action_chain', { action_id: 'action with spaces' }],
    ['action_chain', { action_id: 'a'.repeat(300) }],
    ['action_chain', {}],
    ['action_chain', JSON.parse('{"action_id":"x","__proto__":{"polluted":true}}')],
    ['recent_actions', { n: 0 }],
    ['recent_actions', { n: 2.5 }],
    ['element_history', { element_key: 'k', n: 101 }],
    ['resolve_element', {}],
    ['resolve_element', { selector: 'x'.repeat(600) }],
    ['compare_chains', { before_action_id: SEND }],
    ['no_such_tool', {}],
  ];
  for (const [name, args] of cases) {
    const result = callTool(store, name, args);
    assert.equal(result.status, 'invalid_input', `${name} ${JSON.stringify(args).slice(0, 80)}`);
  }
  assert.equal({}.polluted, undefined);
  const forbidden = callTool(store, 'action_chain', JSON.parse('{"action_id":"action:mud8sc1x:9","__proto__":{"x":1}}'));
  assert.deepEqual(forbidden.errors, ['forbidden property name "__proto__"']);
  assert.equal(callTool(store, 'action_chain', { action_id: SEND, constructor: 1 }).status, 'invalid_input');
  // A selector is tokenised, not run: script-like input is just an unmatched token.
  const hostile = callTool(store, 'resolve_element', { selector: 'img[src=x]:not(*) , body } <script>alert(1)</script>' });
  assert.ok(['ambiguous', 'not_found'].includes(hostile.status));
});

// --- G3 stamp path (synthetic rows: element.stamp does not exist in final7) ---

function stampRows({ conflict = false } = {}) {
  const fid = `function:${'a'.repeat(64)}:10:20`;
  const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: 'page-1' };
  const rows = [
    { ...base, sequence: 1, timestamp: 1000, kind: 'element.stamp', element_key: 'p_4f2a91:18-44#1', placement_id: 'p_4f2a91:18-44', file: 'src/settings/Form.tsx', line: 88, start: 18, end: 44, component: 'SaveButton', handlers: [{ event: 'click', function_id: fid }], build: 'b1', url: 'http://localhost:5173/settings?tab=1' },
    { ...base, sequence: 2, timestamp: 1001, kind: 'dom.action', action_id: 'action:s:1', event: 'click', target: { tag: 'button', attributes: {}, element_key: 'p_4f2a91:18-44#1' }, continuation_id: 'c1' },
    { ...base, sequence: 3, timestamp: 1002, kind: 'function.enter', function_id: fid, action_id: 'action:s:1', invoked_by: 'event', continuation_id: 'c2', parent_continuation_id: 'c1', spine: { function_ids: [fid] } },
    { ...base, sequence: 4, timestamp: 1003, kind: 'dom.mutation', action_id: 'action:s:1', count: 1 },
    { ...base, sequence: 5, timestamp: 1004, kind: 'dom.action', action_id: 'action:s:2', event: 'click', target: { tag: 'button', attributes: {}, element_key: 'p_4f2a91:18-44#1' }, continuation_id: 'c3' },
  ];
  if (conflict) rows.push({ ...base, capture_page_id: 'page-2', sequence: 1, timestamp: 2000, kind: 'element.stamp', element_key: 'p_4f2a91:18-44#1', placement_id: 'p_other:1-2', file: 'src/Other.tsx', line: 3, component: 'Other', handlers: [], build: 'b1' });
  return rows;
}

test('stamped element: exact resolution, history by key equality, stale_build and conflicting placements', () => {
  const stamped = createStore({ records: stampRows(), now: () => 10_000 });
  const resolved = callTool(stamped, 'resolve_element', { element_key: 'p_4f2a91:18-44#1', build: 'b1' });
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.confidence, 'exact');
  assert.equal(resolved.component, 'SaveButton');
  assert.deepEqual([resolved.source.file, resolved.source.line, resolved.source.start, resolved.source.end], ['src/settings/Form.tsx', 88, 18, 44]);
  // Page URL from stamp rows narrows the no-key lookup (origin + path, literal).
  const byUrl = callTool(stamped, 'resolve_element', { selector: 'button', url: 'http://localhost:5173/settings' });
  assert.equal(byUrl.status, 'ambiguous');
  assert.equal(byUrl.candidates[0].keys[0].element_key, 'p_4f2a91:18-44#1');
  const otherUrl = callTool(stamped, 'resolve_element', { selector: 'button', url: 'http://localhost:5173/other' });
  assert.ok(otherUrl.ignored.some(entry => entry.input === 'url'));
  assert.equal(resolved.handlers[0].event, 'click');
  const history = callTool(stamped, 'element_history', { element_key: 'p_4f2a91:18-44#1' });
  assert.deepEqual(history.actions.map(action => action.action_id), ['action:s:2', 'action:s:1']);
  const stale = callTool(stamped, 'resolve_element', { element_key: 'p_4f2a91:18-44#1', build: 'b2' });
  assert.equal(stale.status, 'stale_build');
  const staleUnknown = callTool(stamped, 'resolve_element', { element_key: 'p_zzz:1-2#1', build: 'b0' });
  assert.equal(staleUnknown.status, 'stale_build');
  const conflicted = createStore({ records: stampRows({ conflict: true }), now: () => 10_000 });
  const ambiguous = callTool(conflicted, 'resolve_element', { element_key: 'p_4f2a91:18-44#1' });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  // An action id seen on two pages is never silently picked.
  const duplicated = createStore({ records: [...stampRows(), { ...stampRows()[1], capture_page_id: 'page-9' }], now: () => 10_000 });
  assert.equal(callTool(duplicated, 'action_chain', { action_id: 'action:s:1' }).status, 'ambiguous');
});

test('D12: stamps are lookup keys only; injecting stamps leaves every chain unchanged', () => {
  const stamped = store.records.map(row => (row.kind === 'dom.action' ? { ...row, target: { ...row.target, element_key: `k:${row.action_id}` } } : row));
  stamped.push(...store.records.filter(row => row.kind === 'dom.action').map(row => ({ schema: 'producttrace.runtime-evidence.v1', kind: 'element.stamp', capture_page_id: row.capture_page_id, sequence: 0, timestamp: 0, element_key: `k:${row.action_id}`, file: 'x', line: 1, component: 'X', handlers: [], build: 'b' })));
  const strip = record => JSON.stringify({ ...record, control: { ...record.control, element_key: undefined } });
  const plain = indexWorkflowEpisodes(store.records); const withStamps = indexWorkflowEpisodes(stamped);
  assert.deepEqual([...withStamps.episodes.keys()], [...plain.episodes.keys()]);
  const options = { registeredFunctionIds: manifest.functions.map(row => row.id), idle: true };
  for (const [episodeId, episode] of plain.episodes) {
    assert.equal(strip(buildEpisodeChain(withStamps.episodes.get(episodeId), stamped, store.spans, options)), strip(buildEpisodeChain(episode, store.records, store.spans, options)), episodeId);
  }
});

test('stdio: the server lists exactly the published schemas and answers through the SDK client', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/server.mjs'), '--store', final7, '--manifest', manifestPath], stderr: 'ignore' });
  const client = new Client({ name: 'mcp-test', version: '1' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), Object.keys(TOOL_SCHEMAS));
    for (const tool of tools) assert.deepEqual(tool.inputSchema, TOOL_SCHEMAS[tool.name]);
    const reply = await client.callTool({ name: 'action_chain', arguments: { action_id: SEND } });
    assert.equal(reply.structuredContent.status, 'ok');
    assert.match(reply.content[0].text, /POST \/api\/agents\/chat\/openAI .* reached db/u);
    assert.equal(JSON.parse(reply.content[1].text).action_id, SEND);
    const invalid = await client.callTool({ name: 'recent_actions', arguments: { n: 1000 } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
  const missing = new Client({ name: 'mcp-test', version: '1' });
  await missing.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/server.mjs'), '--store', path.join(os.tmpdir(), 'tracer-no-such-store')], stderr: 'ignore' }));
  try {
    const reply = await missing.callTool({ name: 'recent_actions', arguments: {} });
    assert.equal(reply.structuredContent.status, 'not_found');
    assert.equal(reply.structuredContent.reason, 'store_unavailable');
  } finally { await missing.close(); }
});

test('plugin launcher resolves the store: --store, TRACER_STORE, TRACER_PROJECT_ROOT, then walk-up to the git root', async () => {
  const { resolveLaunch } = await import('../plugin/bin/tracer-mcp.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-launch-'));
  const app = path.join(base, 'app'); const nested = path.join(app, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(path.join(app, '.tracer')); fs.mkdirSync(path.join(app, '.git'));
  fs.mkdirSync(path.join(app, 'node_modules')); fs.symlinkSync(root, path.join(app, 'node_modules', 'producttrace'));
  const walked = resolveLaunch([], {}, nested);
  assert.equal(walked.store, path.join(app, '.tracer')); assert.equal(walked.source, 'walk-up from cwd'); assert.equal(walked.projectRoot, app);
  assert.equal(walked.server, path.join(app, 'node_modules', 'producttrace', 'mcp', 'server.mjs'));
  assert.equal(resolveLaunch([], { TRACER_PROJECT_ROOT: app }, base).source, 'TRACER_PROJECT_ROOT');
  assert.equal(resolveLaunch([], { TRACER_PROJECT_ROOT: app, TRACER_STORE: 'evidence' }, base).store, path.join(app, 'evidence'));
  assert.equal(resolveLaunch(['--store', path.join(app, '.tracer')], { TRACER_STORE: '/elsewhere' }, base).source, '--store');
  // The walk stops at a git root: a .tracer above the repo is not used.
  const outer = path.join(base, 'outer'); const repo = path.join(outer, 'repo');
  fs.mkdirSync(path.join(outer, '.tracer'), { recursive: true }); fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.match(resolveLaunch([], {}, repo).error, /no store found/u);
});

test('stdio: raw __proto__ argument keys are rejected explicitly and a tools/call without params is -32602', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(root, 'mcp/server.mjs'), '--store', final7, '--manifest', manifestPath], { stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = new Map(); let buffer = '';
  const waiters = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk; let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      if (message.id !== undefined) { replies.set(message.id, message); waiters.get(message.id)?.(message); }
    }
  });
  const send = line => child.stdin.write(`${line}\n`);
  const reply = id => new Promise(resolve => (replies.has(id) ? resolve(replies.get(id)) : waiters.set(id, resolve)));
  try {
    send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }));
    await reply(1);
    send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    send('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"action_chain","arguments":{"action_id":"action:mud8sc1x:9","__proto__":{"x":1}}}}');
    const proto = await reply(2);
    assert.equal(proto.result.structuredContent.status, 'invalid_input');
    assert.equal(proto.result.isError, true);
    assert.match(proto.result.content[0].text, /__proto__/u);
    send('{"jsonrpc":"2.0","id":3,"method":"tools/call"}');
    assert.equal((await reply(3)).error.code, -32602);
    send('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"action_chain","arguments":{"action_id":"action:mud8sc1x:9"}}}');
    assert.equal((await reply(4)).result.structuredContent.status, 'ok');
  } finally { child.kill(); }
});

// --- Rendering: the MCP says everything the records already know -------------

const AGENT_CREATE = 'action:mud8t56z:29', DELETE = 'action:mud8u8jo:38';
/** The episode's attributed requests straight from the raw rows, in dispatch order. */
const rawRequests = (source, actionIds) => source.records.filter(row => row.kind === 'network.request' && actionIds.includes(row.action_id) && row.internal !== true && row.transport_internal !== true)
  .sort((left, right) => left.timestamp - right.timestamp || left.sequence - right.sequence);

test('rendering: a multi-request action renders every request as its own segment with its own exact joins, in dispatch order', () => {
  for (const [actionId, expected] of [[AGENT_CREATE, 9], [DELETE, 6], [SEND, 1]]) {
    const result = callTool(store, 'action_chain', { action_id: actionId });
    const requests = rawRequests(store, result.episode_action_ids);
    assert.equal(requests.length, expected, actionId);
    assert.equal(result.segments.length, expected, actionId);
    assert.deepEqual(result.segments.map(segment => segment.request_occurrence_id), requests.map(row => row.request_occurrence_id), actionId);
    assert.match(result.summary, new RegExp(`→ ${expected} requests?\\b`, 'u'), actionId);
    for (const [index, segment] of result.segments.entries()) {
      // Independent recomputation per request (trace id + exact parent + method).
      const graded = gradeRequestJoin(requests[index], store.spans);
      assert.equal(segment.route?.span_id ?? null, graded.server?.span_id ?? null, `${actionId} #${index + 1}`);
      assert.deepEqual(segment.handler_spans.map(stop => stop.span_id).sort(), graded.handlers.map(span => span.span_id).sort(), `${actionId} #${index + 1}`);
      assert.deepEqual(segment.db_ops.map(stop => stop.span_id).sort(), graded.dbs.map(span => span.span_id).sort(), `${actionId} #${index + 1}`);
      assert.equal(segment.third_party, false);
      // At most five segments inline; the JSON keeps every one.
      // (The chain line is the summary's first line; the work listing below it names requests too.)
      assert.equal(result.summary.split('\n')[0].includes(`(${index + 1}) `), index < 5, `${actionId} #${index + 1}`);
    }
    if (expected > 5) assert.ok(result.summary.includes(`… ${expected - 5} more request${expected - 5 === 1 ? '' : 's'} (see segments)`), actionId);
  }
  // The delete action's fifth request answered 404: that segment is failed, the credited DELETE is completed.
  const deleted = callTool(store, 'action_chain', { action_id: DELETE });
  const notFound = deleted.segments.filter(segment => segment.http_status === 404);
  assert.equal(notFound.length, 1);
  assert.equal(notFound[0].outcome, 'failed');
  assert.match(notFound[0].because, /^server responded 404; /u);
  assert.equal(deleted.outcome.status, 'completed');
  assert.equal(deleted.outcome.failed_requests, 1);
  assert.match(deleted.summary, /6 requests \(1 failed\)/u);
  assert.ok(deleted.segments.filter(segment => segment.http_status < 400).every(segment => segment.outcome === 'completed'));
});

test('rendering: regenerate lists every joined DB span in the JSON and collapses repeats only in the summary', () => {
  const result = callTool(store, 'action_chain', { action_id: REGENERATE });
  const [segment] = result.segments;
  const request = rawRequests(store, result.episode_action_ids)[0];
  const graded = gradeRequestJoin(request, store.spans);
  assert.ok(graded.dbs.length > 10);
  assert.equal(segment.db_ops.length, graded.dbs.length);
  // In span start order; each op keeps operation + collection.
  const starts = segment.db_ops.map(stop => { const span = store.spans.find(row => row.span_id === stop.span_id); return span.start_time[0] * 1e3 + span.start_time[1] / 1e6; });
  assert.deepEqual(starts, [...starts].sort((left, right) => left - right));
  assert.ok(segment.db_ops.every(stop => stop.operation && stop.collection));
  // Each operation names the server code that issued it (fix/middleware-reads).
  assert.ok(segment.db_ops.every(stop => typeof stop.issued_by === 'string' && stop.issuer?.kind), 'issuer on every op');
  const counts = new Map();
  for (const stop of segment.db_ops) { const key = `${stop.operation} ${stop.collection}\u0000${stop.issued_by}`; counts.set(key, (counts.get(key) || 0) + 1); }
  for (const [key, count] of counts) { const [base, issuer] = key.split('\u0000'); const text = `${base}${count > 1 ? ` ×${count}` : ''} (${issuer})`; assert.ok(segment.summary.includes(text), text); }
  // The legacy stops list stays complete too, and element_history carries the same segments.
  assert.equal(result.stops.filter(stop => stop.stop === 'db').length, graded.dbs.length);
  const key = readHandlerKey(path.join(final7, 'HANDLERS.md'));
  const history = callTool(store, 'element_history', { element_key: `handler:${key.regenerate.function_id}|${key.regenerate.event}`, n: 100 });
  const listed = history.actions.find(action => action.action_id === REGENERATE);
  assert.equal(listed.segments[0].db_ops.length, graded.dbs.length);
  // action_chain appends PR #4's unlinked heading and coverage line after the chain line.
  assert.equal(listed.summary, result.summary.split('\n')[0]);
});

test('rendering: a manifest without build-time names (final7) is named from the checkout by the text rule (inferred_from_source_text), a call-result binding is context only (inferred)', { skip: !fs.existsSync(fixture) && 'LibreChat fixture not present' }, () => {
  const key = readHandlerKey(path.join(final7, 'HANDLERS.md'));
  const flows = readFlowActions(path.join(final7, 'causal-chains.jsonl'));
  const expected = { 'edit-resubmit': ['resubmitMessage', 'checkout_text_rule'], regenerate: ['handleRegenerateMessage', 'checkout_text_rule_via_call'], delete: ['confirmDelete', 'checkout_text_rule_via_call'],
    feedback: ['handleDownOption', 'checkout_text_rule_via_call'], 'agent-create': ['onSubmit', 'checkout_text_rule_via_call'], send: [null, 'checkout_text_rule'], rename: [null, 'checkout_text_rule'], login: [null, 'checkout_text_rule'] };
  for (const [flow, [name, basis]] of Object.entries(expected)) {
    const entry = callTool(store, 'action_chain', { action_id: flows[flow][0] }).stops.find(stop => stop.stop === 'entry_handler');
    assert.equal(entry.function_id, key[flow].function_id, flow);
    const info = store.functionInfo(entry.function_id);
    assert.equal(info.name_basis, basis, flow);
    if (basis === 'checkout_text_rule_via_call') {
      // `NAME = useCallback(fn)`: NAME holds the call's result; context only, never the function's name.
      assert.equal(entry.name, null, flow); assert.equal(entry.name_status, 'inferred', flow); assert.equal(info.bound_to, name, flow);
      assert.ok(entry.label.startsWith(`${name} (via `), `${flow} ${entry.label}`);
    } else {
      assert.equal(entry.name, name, flow);
      assert.equal(entry.name_status, name ? 'inferred_from_source_text' : 'anonymous', flow);
    }
    assert.ok(entry.label.endsWith(`${key[flow].file}:${entry.source.line}`), `${flow} ${entry.label}`);
    if (!name) assert.ok(entry.label.startsWith('<anonymous> '), flow);
  }
  const deleted = callTool(store, 'action_chain', { action_id: DELETE });
  assert.match(deleted.summary, /handler confirmDelete \(via useCallback\) client\/src\/components\/Conversations\/ConvoOptions\/DeleteButton\.tsx:\d+ → /u);
  // Intermediate functions are named too: the delete lineage passes through the named onSuccess callbacks.
  const fifth = deleted.segments[4];
  assert.ok(fifth.lineage.some(hop => hop.name === 'createNewConvo'), fifth.lineage.map(hop => hop.label).join(' → '));
  // The summary keeps both ends of a lineage longer than six hops; the JSON keeps every hop.
  assert.equal(fifth.lineage.length, 8);
  assert.match(fifth.summary, /^<anonymous> client\/src\/data-provider\/mutations\.ts:\d+ → .* → … 3 more hops … → .* → GET \/api\/messages\/\S+ → route \/api\/messages\/:conversationId 404/u);
});

test('rendering: without a checkout or manifest names, a name is reported unknown, never guessed', () => {
  const bare = createStore({ records: store.records, spans: store.spans, manifest });
  const entry = callTool(bare, 'action_chain', { action_id: DELETE }).stops.find(stop => stop.stop === 'entry_handler');
  assert.equal(entry.name, null);
  assert.equal(entry.name_status, 'not_recorded');
  assert.match(entry.label, /^<unnamed> client\/src\/components\/Conversations\/ConvoOptions\/DeleteButton\.tsx@\d+-\d+$/u);
});

/** One page: a Ctrl+Enter keydown on a dialog, whose handler issues a first-party request (with deferred server work) and whose dispatch also saw a request from uninstrumented code. */
function renderingRows() {
  const fid = `function:${'b'.repeat(64)}:10:20`; const inner = `function:${'c'.repeat(64)}:5:50`; const library = `function:${'d'.repeat(64)}:1:9`;
  const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: 'page-r' };
  const records = [
    { ...base, sequence: 1, timestamp: 1000, kind: 'dom.action', action_id: 'action:k:1', event: 'keydown', key: { key: 'Enter', code: 'Enter', ctrl: true, alt: false, shift: false, meta: false },
      target: { tag: 'div', attributes: { role: 'dialog', 'aria-label': 'Settings' } }, continuation_id: 'k1' },
    { ...base, sequence: 2, timestamp: 1001, kind: 'function.enter', function_id: fid, action_id: 'action:k:1', invoked_by: 'event', continuation_id: 'k2', parent_continuation_id: 'k1', spine: { action_id: 'action:k:1', function_ids: [fid] } },
    { ...base, sequence: 3, timestamp: 1002, kind: 'function.enter', function_id: inner, action_id: 'action:k:1', invoked_by: 'event', continuation_id: 'k3', parent_continuation_id: 'k2', spine: { action_id: 'action:k:1', function_ids: [fid, inner] } },
    { ...base, sequence: 4, timestamp: 1003, kind: 'network.request', action_id: 'action:k:1', request_occurrence_id: 'action:k:1:request:1', method: 'POST', url: '/api/items',
      trace_context: { trace_id: 't1', span_id: 's1' }, terminal_owner_continuation_id: 'k3', spine: { action_id: 'action:k:1', function_ids: [] }, linkage_kind: 'direct' },
    { ...base, sequence: 5, timestamp: 1004, kind: 'network.request', action_id: 'action:k:1', request_occurrence_id: 'action:k:1:request:2', method: 'GET', url: 'https://cdn.example/beacon',
      trace_context: { trace_id: 't2', span_id: 's2' } },
    // A request whose lineage holds only an unregistered (library) frame is third-party too.
    { ...base, sequence: 6, timestamp: 1005, kind: 'network.request', action_id: 'action:k:1', request_occurrence_id: 'action:k:1:request:3', method: 'GET', url: '/api/flags',
      trace_context: { trace_id: 't3', span_id: 's3' }, spine: { action_id: 'action:k:1', function_ids: [library] } },
  ];
  const hr = ms => [Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)];
  const span = (id, parent, kind, start, end, extra = {}) => ({ schema: 'producttrace.backend-span.v1', trace_id: 't1', span_id: id, parent_span_id: parent, kind, start_time: hr(start), end_time: hr(end), attributes: {}, ...extra });
  const db = (id, start, operation) => span(id, 'h1', 'client', start, start + 1, { attributes: { 'db.system': 'mongodb', 'db.operation': operation, 'db.mongodb.collection': 'items' } });
  const spans = [
    span('srv', 's1', 'server', 5000, 5010, { attributes: { 'http.method': 'POST', 'http.route': '/api/items', 'http.status_code': 201 } }),
    span('h1', 'srv', 'internal', 5001, 5040, { instrumentation: { name: 'producttrace-express-handlers' }, attributes: { 'http.route': '/api/items', 'producttrace.express.handler.name': 'createItem', 'producttrace.express.handler.index': 0 } }),
    db('d1', 5002, 'find'), db('d2', 5003, 'find'), db('d3', 5004, 'find'), db('d4', 5030, 'insert'),
  ];
  const manifest = { functions: [
    { id: fid, kind: 'function', source: { file: 'src/Settings.tsx', start: 10, end: 20 }, name: 'saveSettings', text_sha256: 'x' },
    { id: inner, kind: 'function', source: { file: 'src/api.ts', start: 5, end: 50 }, name: null, text_sha256: 'y' },
  ] };
  return { records, spans, manifest, fid, inner };
}

test('rendering (synthetic): key detail, named spine, third-party requests, all DB ops and deferred server work', () => {
  const { records, spans, manifest: synthetic, inner } = renderingRows();
  const synth = createStore({ records, spans, manifest: synthetic, now: () => 100_000 });
  const result = callTool(synth, 'action_chain', { action_id: 'action:k:1' });
  assert.deepEqual(result.keyboard, { key: 'Enter', code: 'Enter', modifiers: ['Ctrl'], repeat: false, target: '<div role="dialog" aria-label="Settings">', text: 'Ctrl+Enter in <div role="dialog" aria-label="Settings">' });
  assert.match(result.summary, /^keydown action:k:1 \(Ctrl\+Enter in <div role="dialog" aria-label="Settings">\) → handler saveSettings src\/Settings\.tsx@10-20 → 3 requests \(2 third-party\): /u);
  const [first, beacon, flags] = result.segments;
  // Named path entry → fn → request (anonymous hops say so).
  assert.deepEqual(first.lineage.map(hop => hop.label), ['saveSettings src/Settings.tsx@10-20', '<anonymous> src/api.ts@5-50']);
  assert.equal(first.lineage[1].function_id, inner);
  assert.match(first.summary, /^<anonymous> src\/api\.ts@5-50 → POST \/api\/items → route \/api\/items 201 → server createItem → db find items ×3 \(handler: createItem\), insert items \(handler: createItem\) \[completed 201; server work continued 20 ms after the response/u);
  assert.equal(first.third_party, false);
  assert.deepEqual(first.db_ops.map(stop => `${stop.operation} ${stop.collection}`), ['find items', 'find items', 'find items', 'insert items']);
  assert.deepEqual(first.deferred, { after_response_ms: 20, last_after_response_ms: 20, spans: [{ kind: 'db', span_id: 'd4', after_response_ms: 20, issued_by: 'handler: createItem' }] });
  assert.equal(result.outcome.deferred.after_response_ms, 20);
  for (const segment of [beacon, flags]) {
    assert.equal(segment.third_party, true);
    assert.equal(segment.first_party_frames, 0);
    assert.match(segment.summary, /^third-party: issued by uninstrumented code during this action → GET /u);
    // One label set (fix/outcome-labels): a request with no joined server span stopped at a frontier.
    assert.equal(segment.outcome, 'stopped');
    assert.equal(segment.stopped_at, 'network');
    assert.match(segment.summary, /\[stopped at network\]$/u);
  }
  assert.equal(beacon.path, '/beacon');
  // compare_chains and element_history render the same line.
  const compared = callTool(synth, 'compare_chains', { before_action_id: 'action:k:1', after_action_id: 'action:k:1' });
  const line = result.summary.split('\n')[0];
  assert.equal(compared.before.summary, line);
  assert.ok(compared.summary.includes(`Before: ${line}`));
  const history = callTool(synth, 'element_history', { element_key: `handler:${records[1].function_id}|keydown` });
  assert.equal(history.status, 'ok');
  assert.equal(history.actions[0].summary, line);
  assert.equal(history.attempts[0].segments.length, 3);
});

test('rendering (synthetic): error statuses are failed and a client-side reject is rejected_client_side, never completed', () => {
  const { records, spans, manifest: synthetic } = renderingRows();
  const failing = spans.map(span => (span.span_id === 'srv' ? { ...span, attributes: { ...span.attributes, 'http.status_code': 422 } } : span));
  const synth = createStore({ records, spans: failing, manifest: synthetic, now: () => 100_000 });
  const result = callTool(synth, 'action_chain', { action_id: 'action:k:1' });
  assert.equal(result.outcome.status, 'failed');
  assert.equal(result.outcome.http_status, 422);
  // fix/outcome-labels: one label everywhere; display_status is an alias and the
  // chain's own display (the live viewer's label) says failed too.
  assert.equal(result.outcome.display_status, 'failed');
  assert.equal(result.chain.display.status, 'failed');
  // Mixed statuses are stated: the credited request decides, the others are listed.
  assert.equal(result.chain.display.label, 'Failed 422: POST /api/items; also stopped at network GET /beacon, stopped at network GET /api/flags');
  assert.equal(result.chain.terminal.label, result.chain.display.label);
  assert.match(result.summary, /\[outcome failed 422; also stopped at network GET \/beacon, stopped at network GET \/api\/flags\]/u);
  assert.equal(result.chain.outcome.status, 'failed');
  assert.equal(result.segments[0].outcome, 'failed');
  assert.match(result.summary, /\[failed 422; .*\[outcome failed 422; also [^\]]*\]: reached db/u);
  const form = { tag: 'form', attributes: {}, ref: 'object:f' };
  const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: 'page-v' };
  const rejectedRows = [
    { ...base, sequence: 1, timestamp: 1000, kind: 'dom.action', action_id: 'action:v:1', event: 'submit', target: form, target_ref: form.ref, form, form_ref: form.ref, continuation_id: 'v1' },
    { ...base, sequence: 2, timestamp: 1001, kind: 'dom.mutation', action_id: 'action:v:1', form_ref: form.ref, validation: { same_form: true, feedback_mutations: 1 }, count: 1 },
  ];
  const rejected = callTool(createStore({ records: rejectedRows, now: () => 100_000 }), 'action_chain', { action_id: 'action:v:1' });
  assert.equal(rejected.outcome.status, 'rejected_client_side');
  assert.equal(rejected.segments.length, 0);
  assert.equal(rejected.stopped_at, 'validation');
  assert.equal(rejected.outcome.reason, 'form_validation');
  assert.equal(rejected.chain.display.status, 'rejected_client_side');
  assert.match(rejected.summary, /no request; the same form mutated \[outcome rejected_client_side; form_validation\]: reached validation/u);
});

test('client aborts (synthetic): an aborted request is aborted_by_client with server_status, never credited while another request exists, listed in "also"', () => {
  const { records, spans, manifest: synthetic } = renderingRows();
  const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: records[0].capture_page_id };
  // The page aborted the POST (the server still wrote and answered 201); the abort row carries no action_id.
  const abort = { ...base, sequence: 99, timestamp: 1100, kind: 'network.abort', request_occurrence_id: 'action:k:1:request:1', transport: 'fetch', parent_continuation_id: null,
    abort_state: 'aborted', aborted_by_client: true, abort_reason: { via: 'AbortSignal', name: 'AbortError', reason_type: 'DOMException' }, aborted_at: 'before_response_headers',
    response_received_before_abort: false, body_read_started: false, response_consumed_before_abort: false, abort_evidence: 'fetch_rejected_with_signal_reason' };
  const store = createStore({ records: [...records, abort], spans, manifest: synthetic, now: () => 100_000 });
  const result = callTool(store, 'action_chain', { action_id: 'action:k:1' });
  // The POST with the write is no longer credited: the last non-aborted request decides.
  assert.equal(result.stops.find(stop => stop.stop === 'request').request_occurrence_id, 'action:k:1:request:3');
  assert.equal(result.outcome.status, 'stopped');
  assert.match(result.outcome.label, /; also aborted_by_client POST \/api\/items \(server answered 201 and wrote insert items \(handler: createItem\)\)/u);
  // The aborted request's write stays in the action's outcome.
  assert.ok(result.outcome.writes.includes('insert items'));
  assert.deepEqual(result.outcome.aborted_request_effects.map(entry => entry.writes), [['insert items']]);
  // After-response abort: its own fact; the label stays the server's.
  const after = createStore({ records: [...records.filter(row => row.kind !== 'network.request' || row.request_occurrence_id === 'action:k:1:request:1'),
    { ...abort, abort_state: 'after_response', aborted_by_client: false, abort_after_response: true, aborted_at: undefined, response_received_before_abort: true, abort_evidence: 'signal_aborted_after_response' }], spans, manifest: synthetic, now: () => 100_000 });
  const afterChain = callTool(after, 'action_chain', { action_id: 'action:k:1' });
  assert.equal(afterChain.outcome.status, 'completed');
  assert.equal(afterChain.outcome.abort_after_response, true);
  assert.match(afterChain.outcome.sentence, /; the page aborted the request after the response reached it \(status and headers\); the app had not started reading the body, and the unread body was discarded \(whether the body had fully arrived is not recorded\)$/u);
  assert.match(afterChain.outcome.label, /; aborted by the page after the response$/u);
  assert.match(result.outcome.sentence, /which response the app rendered is not recorded \(no body read recorded for GET \/api\/flags\)$/u);
  assert.equal(result.outcome.app_read.read, false);
  const post = result.segments.find(segment => segment.request_occurrence_id === 'action:k:1:request:1');
  assert.equal(post.outcome, 'aborted_by_client');
  assert.equal(post.server_status, 201);
  assert.equal(post.http_status, null);
  assert.match(post.summary, /\[aborted_by_client; server answered 201[;\]]/u);
  assert.match(post.because, /^the page aborted the request; the server answered 201; /u);
  // Only the aborted request: it is the headline, and the server's 201 is a separate fact.
  const only = createStore({ records: [...records.filter(row => row.kind !== 'network.request' || row.request_occurrence_id === 'action:k:1:request:1'), abort], spans, manifest: synthetic, now: () => 100_000 });
  const alone = callTool(only, 'action_chain', { action_id: 'action:k:1' });
  assert.equal(alone.outcome.status, 'aborted_by_client');
  assert.equal(alone.outcome.http_status, null);
  assert.equal(alone.outcome.server_status, 201);
  assert.equal(alone.chain.display.status, 'aborted_by_client');
  assert.equal(alone.outcome.label, 'Aborted by the page: POST /api/items; the server answered 201');
  assert.match(alone.outcome.sentence, /^aborted by the page before the response was read: POST \/api\/items \(before the response headers arrived; AbortError\); the server answered 201 and wrote insert items \(handler: createItem\)$/u);
  assert.deepEqual(alone.outcome.app_read, { request_occurrence_id: null, read: false, text: 'every request of this action was aborted by the page' });
  assert.match(alone.summary, /\[outcome aborted_by_client; server answered 201\]/u);
  // A signal aborted after the body was read has no effect: not aborted.
  const late = createStore({ records: [...records, { ...abort, abort_state: 'no_effect', aborted_by_client: false, aborted_at: undefined, signal_aborted_after: 'body_read' }], spans, manifest: synthetic, now: () => 100_000 });
  assert.equal(callTool(late, 'action_chain', { action_id: 'action:k:1' }).segments[0].outcome, 'completed');
});

test('rendering (G6 store): every 422 is failed with its status; deferred server work is measured from the server span end', async () => {
  const dir = path.join(root, 'docs/evidence/g6-anything-llm-2026-09-23/store');
  const { readJsonl } = await import('../collector/store.mjs');
  const zlib = await import('node:zlib');
  const manifests = new Map(fs.readdirSync(path.join(dir, 'manifests')).map(name => {
    const text = name.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(path.join(dir, 'manifests', name))).toString('utf8') : fs.readFileSync(path.join(dir, 'manifests', name), 'utf8');
    const value = JSON.parse(text); return [value.build, value];
  }));
  const g6 = createStore({ records: (await readJsonl(path.join(dir, 'records.jsonl'))).rows, spans: (await readJsonl(path.join(dir, 'spans.jsonl'))).rows, manifests });
  const statusOf = span => span.attributes?.['http.status_code'] ?? span.attributes?.['http.response.status_code'];
  // Independently: requests whose unique exact-parent server span answered 422.
  const failed = g6.records.filter(row => row.kind === 'network.request' && row.action_id && row.internal !== true && row.trace_context?.trace_id).filter(row => {
    const servers = g6.spans.filter(span => span.trace_id === row.trace_context.trace_id && span.kind === 'server' && span.parent_span_id === row.trace_context.span_id);
    return servers.length === 1 && Number(statusOf(servers[0])) === 422;
  });
  assert.ok(failed.length > 0);
  let deferredSeen = 0;
  for (const actionId of new Set(failed.map(row => row.action_id))) {
    const result = callTool(g6, 'action_chain', { action_id: actionId });
    const segments = result.segments.filter(segment => failed.some(row => row.request_occurrence_id === segment.request_occurrence_id));
    assert.ok(segments.length > 0, actionId);
    for (const segment of segments) {
      assert.equal(segment.outcome, 'failed', actionId);
      assert.equal(segment.http_status, 422, actionId);
      assert.match(segment.summary, /\[failed 422/u);
    }
    if (result.outcome.http_status === 422) { assert.equal(result.outcome.status, 'failed'); assert.doesNotMatch(result.summary, /outcome completed/u); }
  }
  // Deferred work: marked iff a joined handler/DB span starts at least 1 ms after its server span ended.
  const ms = value => value[0] * 1e3 + value[1] / 1e6;
  for (const actionId of new Set(g6.actionRows.map(row => row.action_id))) {
    for (const segment of callTool(g6, 'action_chain', { action_id: actionId }).segments.filter(value => value.route)) {
      const end = ms(g6.spanById.get(segment.route.span_id).end_time);
      const gaps = [...segment.handler_spans, ...segment.db_ops].map(stop => ms(g6.spanById.get(stop.span_id).start_time) - end).filter(gap => gap >= 1);
      assert.equal(Boolean(segment.deferred), gaps.length > 0, segment.request_occurrence_id);
      if (segment.deferred) deferredSeen += 1;
    }
  }
  // The G6 store's post-response handler spans all start < 1 ms after the response (clock resolution): none is marked.
  assert.equal(deferredSeen, 0);
});

test('rendering: deferred server work on final7 regenerate is measured from the server span end with a 1 ms floor', () => {
  const [segment] = callTool(store, 'action_chain', { action_id: REGENERATE }).segments;
  const ms = value => value[0] * 1e3 + value[1] / 1e6;
  const end = ms(store.spanById.get(segment.route.span_id).end_time);
  const expected = [...segment.handler_spans, ...segment.db_ops].map(stop => ({ span_id: stop.span_id, gap: ms(store.spanById.get(stop.span_id).start_time) - end }))
    .filter(item => item.gap >= 1).sort((left, right) => left.gap - right.gap);
  assert.ok(expected.length > 0);
  assert.deepEqual(segment.deferred.spans.map(item => item.span_id), expected.map(item => item.span_id));
  for (const [index, item] of segment.deferred.spans.entries()) assert.equal(item.after_response_ms, Math.round(expected[index].gap * 10) / 10);
  assert.ok(segment.deferred.after_response_ms >= 1);
  assert.match(segment.summary, new RegExp(`server work continued ${segment.deferred.after_response_ms} ms after the response`, 'u'));
});

test('functionNameAt names only the binding that directly holds the function (object literal, ternary, annotation)', async () => {
  const { functionNameAt } = await import('../collector/store-writer.mjs');
  const fn = '(e) => go(e)';
  const name = source => { const at = source.indexOf(fn); return functionNameAt(source, at, at + fn.length); };
  // An earlier property must never name a later property's function.
  assert.equal(name(`register('text', { required: true, onChange: ${fn} })`), 'onChange');
  assert.equal(name(`useQuery({ enabled: false, onSuccess: ${fn} })`), 'onSuccess');
  assert.equal(name(`useQuery({ queryKey: [QueryKeys.x, id], queryFn: ${fn} })`), 'queryFn');
  assert.equal(name(`<List itemSize={1} overscan={5}>{{ store: s,\n  children: ${fn} }}</List>`), 'children');
  assert.equal(name(`atom({ key: 'k', // comment\n  get: ${fn} })`), 'get');
  // Variable, annotated variable (generic commas allowed), parameter default, member and class field.
  assert.equal(name(`const handleUpdate = ${fn};`), 'handleUpdate');
  assert.equal(name(`const Comp: React.FC<Props, State> = ${fn};`), 'Comp');
  assert.equal(name(`function g(cb = ${fn}) {}`), 'cb');
  assert.equal(name(`this.onClick = async ${fn};`), 'onClick');
  assert.equal(name(`class C { handle = ${fn} }`), 'handle');
  // Not a binding: anonymous.
  for (const source of [`const x = cond ? other : ${fn};`, `x += ${fn}`, `a == ${fn}`, `<button onClick={${fn}} />`, `foo(${fn})`, `[${fn}]`, `const h = useCallback(${fn})`]) assert.equal(name(source), null, source);
});

test('rendering: a 2xx without effect evidence is "responded" with a note, never "completed"', () => {
  const { records, spans, manifest: synthetic } = renderingRows();
  const synth = createStore({ records: records.filter(row => row.sequence <= 4), spans: spans.filter(span => !['d1', 'd2', 'd3', 'd4'].includes(span.span_id)), manifest: synthetic, now: () => 100_000 });
  const result = callTool(synth, 'action_chain', { action_id: 'action:k:1' });
  assert.equal(result.stopped_at, 'handler');
  assert.equal(result.outcome.status, 'responded');
  assert.equal(result.outcome.note, 'no effect evidence');
  assert.equal(result.outcome.reached, 'handler'); // PR #4's outcome.reached is kept
  assert.equal(result.segments[0].outcome, 'responded');
  assert.equal(result.segments[0].note, 'no effect evidence');
  assert.match(result.summary, /\[responded 201; no effect evidence\].*\[outcome responded 201; no effect evidence\]: reached handler/u);
  assert.doesNotMatch(result.summary, /completed/u);
  // final7: `completed` only where the engine reached its terminal join.
  for (const actionId of new Set(store.actionRows.map(row => row.action_id))) {
    const chain = callTool(store, 'action_chain', { action_id: actionId });
    if (chain.outcome.status === 'completed') assert.equal(chain.outcome.display_status, 'completed', actionId);
    for (const segment of chain.segments) if (segment.outcome === 'completed') assert.equal(segment.stopped_at, null, `${actionId} ${segment.request_occurrence_id}`);
  }
  // fix/middleware-reads (ruling 2026-09-24): its GET's only reads are app-level
  // middleware reads, i.e. preconditions: `responded`, named, no terminal effect claimed.
  const middlewareOnly = callTool(store, 'action_chain', { action_id: 'action:mud8u6q1:35' });
  assert.equal(middlewareOnly.outcome.status, 'responded');
  assert.equal(middlewareOnly.outcome.note, 'no database work after the preconditions');
  assert.match(middlewareOnly.outcome.label, /^Responded 304: no database work after the preconditions \(find logs ×4 by middleware checkBan, find users by middleware requireJwtAuth\); also completed 304 GET \/api\/projects$/u);
  assert.notEqual(middlewareOnly.stopped_at, null);
});

// --- fix/stable-element-keys: an element key never resolves to the wrong element ---

test('resolve_element: a React-keyed row is exact before and after a removal; an unkeyed row is ambiguous with every instance', () => {
  const { records } = runStableKeysScenario();
  const stable = createStore({ records, spans: [], manifest: null });
  const keyed = callTool(stable, 'resolve_element', { element_key: `${BUTTON.key}@r4` });
  assert.deepEqual([keyed.status, keyed.confidence, keyed.stamp_key_kind, keyed.instances, keyed.actions_observed], ['ok', 'exact', 'react_key', 1, 2]);
  assert.deepEqual(keyed.source, { file: 'src/Row.jsx', start: 120, end: 210, line: 4, line_status: 'ok' });
  for (const key of [`${BUTTON.key}#n4`, `${BUTTON.key}#n3`]) {
    const ordinal = callTool(stable, 'resolve_element', { element_key: key });
    assert.equal(ordinal.status, 'ambiguous', key);
    assert.equal(ordinal.confidence, 'ambiguous', key);
    assert.equal(ordinal.reason, 'ordinal key; 5 instances of this placement', key);
    assert.equal(ordinal.instances, 5, key);
    assert.deepEqual(ordinal.candidates.map(candidate => candidate.element_key), [1, 2, 3, 4, 5].map(i => `${BUTTON.key}#n${i}`), key);
    assert.ok(ordinal.candidates.every(candidate => candidate.latest.binding_placement.placement_id === PLAIN_ROW.id));
    assert.match(ordinal.advice, /distinguishing child/u);
    assert.match(ordinal.advice, /element_history/u);
    assert.match(ordinal.summary, /^ambiguous: ordinal key; 5 instances of this placement/u);
  }
  // The latest binding of each instance: n1..n4 re-stamped at commit 3 with 4 instances, n5 last seen at commit 1.
  const candidates = callTool(stable, 'resolve_element', { element_key: `${BUTTON.key}#n4` }).candidates;
  assert.deepEqual(candidates.map(candidate => [candidate.latest.commit, candidate.latest.instances]), [[3, 4], [3, 4], [3, 4], [3, 4], [1, 5]]);
  assert.deepEqual(candidates.map(candidate => candidate.latest_action?.label ?? null), [null, null, 'Save Row 4', 'Save Row 4', null]);
});

test('element_history: each action carries the binding that held when it fired (joined by stamp_sequence)', () => {
  const { records } = runStableKeysScenario();
  const stable = createStore({ records, spans: [], manifest: null });
  const keyed = callTool(stable, 'element_history', { element_key: `${BUTTON.key}@r4` });
  assert.equal(keyed.element_confidence, 'exact');
  assert.equal(keyed.actions.length, 2);
  for (const action of keyed.actions) {
    assert.deepEqual([action.element.key_kind, action.element.label, action.binding.basis, action.binding.stamp_sequence, action.binding.react_key_path],
      ['react_key', 'Save Row 4', 'stamp_sequence', 4, ['r4']]);
    assert.equal(action.binding.binding_placement.placement_id, KEYED_ROW.id);
  }
  // Unkeyed: row 4 was #n4 of 5, then (after row 2 was removed) #n3 of 4.
  const before = callTool(stable, 'element_history', { element_key: `${BUTTON.key}#n4` });
  const after = callTool(stable, 'element_history', { element_key: `${BUTTON.key}#n3` });
  for (const [history, sequence, commit, instances] of [[before, 9, 1, 5], [after, 13, 3, 4]]) {
    assert.equal(history.element_confidence, 'ambiguous');
    assert.equal(history.reason, 'ordinal key; 5 instances of this placement');
    assert.equal(history.actions.length, 1);
    const [action] = history.actions;
    assert.deepEqual([action.element.key_kind, action.element.instances, action.element.label], ['ordinal', instances, 'Save Row 4']);
    assert.deepEqual([action.binding.basis, action.binding.stamp_sequence, action.binding.commit, action.binding.instances], ['stamp_sequence', sequence, commit, instances]);
    assert.equal(action.binding.binding_placement.placement_id, PLAIN_ROW.id);
  }
  assert.equal(stable.elementIndex.entries.get(`${BUTTON.key}#n4`).observations.length, 2, 'one observation per (key, commit) where it changed');
});

test('ordinal keys: exact only with one instance; rows without key_kind use the highest ordinal on the page as a lower bound', () => {
  const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: 'page-1', timestamp: 1000, file: 'src/A.jsx', line: 3, start: 10, end: 40, component: 'A', handlers: [], build: 'b1' };
  const rows = [
    { ...base, kind: 'element.stamp', stamp_sequence: 1, element_key: 'p_111111111111:10-40#n1', key_kind: 'ordinal', instances: 1, placement_id: 'placement:1' },
    { ...base, kind: 'element.stamp', stamp_sequence: 2, element_key: 'p_222222222222:10-40#n1', placement_id: 'placement:2' },
    { ...base, kind: 'element.stamp', stamp_sequence: 3, element_key: 'p_222222222222:10-40#n2', placement_id: 'placement:2' },
    { ...base, kind: 'element.stamp', stamp_sequence: 4, element_key: 'p_333333333333:10-40#n1', placement_id: 'placement:3' },
    { ...base, kind: 'dom.action', sequence: 1, action_id: 'action:o:1', event: 'click', target: { tag: 'button', attributes: {}, element_key: 'p_111111111111:10-40#n1', key_kind: 'ordinal', instances: 2 }, continuation_id: 'c1' },
  ];
  const legacy = createStore({ records: rows, spans: [], manifest: null });
  const resolve = key => callTool(legacy, 'resolve_element', { element_key: key });
  assert.deepEqual([resolve('p_333333333333:10-40#n1').confidence, resolve('p_333333333333:10-40#n1').instances], ['exact', 1], 'a legacy ordinal with no sibling on its page');
  assert.deepEqual([resolve('p_222222222222:10-40#n1').confidence, resolve('p_222222222222:10-40#n1').reason], ['ambiguous', 'ordinal key; 2 instances of this placement']);
  assert.deepEqual(resolve('p_222222222222:10-40#n1').candidates.map(candidate => candidate.element_key), ['p_222222222222:10-40#n1', 'p_222222222222:10-40#n2']);
  // One instance at the stamp, two at the action: never exact.
  assert.deepEqual([resolve('p_111111111111:10-40#n1').confidence, resolve('p_111111111111:10-40#n1').instances], ['ambiguous', 2]);
  const single = createStore({ records: rows.slice(0, 1), spans: [], manifest: null });
  assert.equal(callTool(single, 'resolve_element', { element_key: 'p_111111111111:10-40#n1' }).confidence, 'exact');
});

test('resolve_element / element_history: an index key whose content changed between actions is ambiguous with per-action labels', () => {
  const { records } = runRootsAndIndexScenario();
  const store = createStore({ records, spans: [], manifest: null });
  const key = `${BUTTON.key}@1`;
  const resolved = callTool(store, 'resolve_element', { element_key: key });
  assert.deepEqual([resolved.status, resolved.confidence, resolved.reason], ['ambiguous', 'ambiguous', 'key content changed between actions (index-like key)']);
  assert.deepEqual(resolved.labels.map(entry => entry.label), ['Save Beta', 'Save Gamma']);
  assert.match(resolved.advice, /element\.label/u);
  const history = callTool(store, 'element_history', { element_key: key });
  assert.equal(history.element_confidence, 'ambiguous');
  assert.equal(history.reason, 'key content changed between actions (index-like key)');
  assert.deepEqual(history.actions.map(action => action.element.label), ['Save Gamma', 'Save Beta'], 'newest first');
  assert.notEqual(history.actions[0].binding.content_sig, history.actions[1].binding.content_sig);
  // @3: its only action was on Delta; after the reverse it shows Beta. Not exact.
  const moved = callTool(store, 'resolve_element', { element_key: `${BUTTON.key}@3` });
  assert.deepEqual([moved.confidence, moved.reason], ['ambiguous', 'key content changed since the action (index-like key)']);
  assert.deepEqual(moved.labels.map(entry => entry.label), ['Save Delta']);
  assert.notEqual(moved.labels[0].content_sig, moved.labels[0].current_content_sig);
  assert.equal(callTool(store, 'element_history', { element_key: `${BUTTON.key}@3` }).element_confidence, 'ambiguous');
  assert.equal(resolveStamp(indexElementStamps(records), { element_key: `${BUTTON.key}@3` }).element_confidence, 'ambiguous', 'the G3 resolver agrees');
  // One action on @0 (Delta after the reverse): one content, and still what @0 shows: exact.
  assert.equal(callTool(store, 'resolve_element', { element_key: `${BUTTON.key}@0` }).confidence, 'exact');
  // Two roots: the clicked key is an ordinal counted across roots.
  const shared = callTool(store, 'resolve_element', { element_key: `${BUTTON.key}#n4` });
  assert.deepEqual([shared.confidence, shared.instances, shared.reason], ['ambiguous', 4, 'ordinal key; 4 instances of this placement']);
});

test('G3 resolver and MCP agree on a legacy ordinal key with no sibling (the G5 demo key shape): exact, N = 1', () => {
  const rows = [{ schema: 'producttrace.runtime-evidence.v1', kind: 'element.stamp', capture_page_id: 'p1', session: 's1', stamp_sequence: 1, timestamp: 1, element_key: 'p_f067e70e6029:117-485#n1',
    placement_id: 'placement:x:117:485', file: 'a.jsx', line: 8, start: 117, end: 485, component: 'CTAButton', tag: 'button', handlers: [], build: 'b1' },
  { schema: 'producttrace.runtime-evidence.v1', kind: 'dom.action', capture_page_id: 'p1', sequence: 1, timestamp: 2, action_id: 'action:l:1', event: 'click', target: { tag: 'button', attributes: {}, element_key: 'p_f067e70e6029:117-485#n1' }, continuation_id: 'c1' }];
  const store = createStore({ records: rows, spans: [], manifest: null });
  const mcp = callTool(store, 'resolve_element', { element_key: 'p_f067e70e6029:117-485#n1' });
  const g3 = resolveStamp(indexElementStamps(rows), { element_key: 'p_f067e70e6029:117-485#n1' });
  assert.deepEqual([mcp.confidence, mcp.instances], ['exact', 1]);
  assert.deepEqual([g3.element_confidence, g3.instances], ['exact', 1]);
  assert.equal(callTool(store, 'element_history', { element_key: 'p_f067e70e6029:117-485#n1' }).actions[0].element.instances, 1);
});

test('outcome labels: HTTP semantics for completed (safe method read joins; unsafe needs a write; 304 only on a safe method)', async () => {
  const { actionOutcome } = await import('../analysis/causal-chain.mjs');
  const label = (method, status, ops) => actionOutcome({ chain: [
    { kind: 'network.request', method, url: '/api/x', request_occurrence_id: 'r1' },
    { kind: 'route.dispatch', status_code: status, request_occurrence_id: 'r1' },
    { kind: 'handler.enter', request_occurrence_id: 'r1' },
    ...ops.map(operation => ({ kind: 'db.operation', operation, collection: 'items', request_occurrence_id: 'r1' })),
  ], terminal: {} });
  const brief = outcome => [outcome.status, outcome.http_status, outcome.note ?? null];
  assert.deepEqual(brief(label('GET', 200, ['find'])), ['completed', 200, null]);
  assert.deepEqual(brief(label('HEAD', 200, [])), ['responded', 200, 'no effect evidence']);
  assert.deepEqual(brief(label('POST', 200, ['find'])), ['responded', 200, 'no write observed']);
  assert.deepEqual(brief(label('POST', 201, ['find', 'insert'])), ['completed', 201, null]);
  assert.deepEqual(brief(label('DELETE', 204, [])), ['responded', 204, 'no effect evidence']);
  assert.deepEqual(brief(label('GET', 304, ['find'])), ['completed', 304, null]);
  assert.equal(label('GET', 304, ['find']).label, 'Completed 304: find items');
  assert.equal(label('POST', 304, ['insert']).status, 'responded');
  assert.equal(label('POST', 303, ['insert']).status, 'responded');
  assert.equal(label('GET', 302, ['find']).status, 'responded');
  assert.equal(label('PUT', 409, ['find']).status, 'failed');
});

test('fix/mcp-surfaces: include_bodies has a reply budget, newest first, stated; an issuer over 6 frames keeps its outermost frame', () => {
  const page = 's_budget'; const rows = []; let sequence = 0; let time = 1_000_000;
  const text = 'x'.repeat(4096);
  for (let action = 1; action <= 30; action += 1) {
    rows.push({ kind: 'dom.action', action_id: `a${action}`, event: 'click', target: { tag: 'button', attributes: {} }, capture_page_id: page, sequence: ++sequence, timestamp: time += 10 });
    for (let index = 0; index < 20; index += 1) {
      const occurrence = `unattributed:request:${action}-${index}`;
      rows.push({ kind: 'network.request', action_id: null, request_occurrence_id: occurrence, method: 'GET', url: `/api/log/${action}`, capture_page_id: page, sequence: ++sequence, timestamp: time += 1,
        transport: 'fetch', reason: 'unattributed_transport', issuer: { function_ids: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'], task: null } });
      rows.push({ kind: 'network.body', request_occurrence_id: occurrence, direction: 'response', capture_page_id: page, captured: true, format: 'text', text, content_type: 'text/plain', bytes: text.length, truncated: false, status: 200 });
    }
  }
  const store = createStore({ records: rows, now: () => 10_000_000 });
  const recent = callTool(store, 'recent_actions', { n: 30, include_bodies: true });
  const entries = recent.actions.flatMap(action => action.unlinked?.requests || []);
  const full = entries.filter(entry => entry.response_body?.text !== undefined);
  const cut = entries.filter(entry => entry.response_body?.full_omitted === 'budget');
  assert.equal(entries.length, 600);
  assert.equal(full.length + cut.length, 600);
  assert.ok(recent.bodies_full.bytes <= 512 * 1024 && recent.bodies_full.cut === cut.length && cut.length > 0, JSON.stringify(recent.bodies_full));
  // Newest actions first: every full body belongs to a newer action than every cut one.
  const actionOf = entry => Number(/request:(\d+)-/u.exec(entry.request_occurrence_id)[1]);
  assert.ok(Math.min(...full.map(actionOf)) >= Math.max(...cut.map(actionOf)));
  assert.match(recent.summary, /Full bodies: \d+ unlinked request\(s\), \d+ KB of the 512 KB budget; bodies of \d+ older request\(s\) are summaries/u);
  const seen = new Set(full.map(entry => entry.request_occurrence_id));
  let cursor = recent.bodies_full.next_cursor;
  const cursors = new Set();
  while (cursor) {
    const encoded = JSON.stringify(cursor);
    assert.ok(!cursors.has(encoded), 'recent_actions cursor must advance'); cursors.add(encoded);
    const next = callTool(store, 'recent_actions', { n: 30, include_bodies: true, ...cursor });
    for (const entry of next.actions.flatMap(action => action.unlinked?.requests || []).filter(entry => entry.response_body?.text !== undefined)) {
      assert.ok(!seen.has(entry.request_occurrence_id), `repeated full body ${entry.request_occurrence_id}`);
      seen.add(entry.request_occurrence_id);
    }
    cursor = next.bodies_full.next_cursor;
  }
  assert.equal(seen.size, 600);
  const listing = callTool(store, 'page_requests', { session: page, n: 1 });
  // Innermost first; over 6 frames: the innermost 5, "… +N more", and the outermost.
  assert.match(listing.requests[0].attribution.text.replaceAll('<not in manifest> ', ''), /issued by f9 \(called from f8 ← f7 ← f6 ← f5 ← … \+3 more ← f1\)/u);
});

test('fix/mcp-surfaces: an oversized newest body advances and discloses truncation on every body surface', () => {
  const page = 's_oversize';
  const rows = [{ kind: 'dom.action', action_id: 'a_oversize', event: 'click', target: { tag: 'button', attributes: {} },
    capture_page_id: page, sequence: 1, timestamp: 1000 }];
  for (const index of [2, 3]) {
    const id = `oversize:request:${index}`;
    rows.push({ kind: 'network.request', action_id: 'a_oversize', request_occurrence_id: id, method: 'GET', url: '/api/oversize',
      capture_page_id: page, sequence: index, timestamp: 1000 + index, transport: 'fetch' });
    rows.push({ kind: 'network.body', request_occurrence_id: id, direction: 'response', capture_page_id: page,
      captured: true, format: 'text', text: 'x'.repeat(600000), bytes: 600000, status: 200 });
  }
  const store = createStore({ records: rows, now: () => 2000 });
  const checkTruncated = (reply, id) => {
    const row = reply.segments?.find(request => request.request_occurrence_id === id)
      || reply.unlinked?.requests?.find(request => request.request_occurrence_id === id)
      || reply.actions?.flatMap(action => action.unlinked?.requests || []).find(request => request.request_occurrence_id === id)
      || reply.requests?.find(request => request.request_occurrence_id === id);
    assert.equal(row?.response_body?.truncated_to_budget, true);
    assert.equal(row.response_body.full_size_bytes, 600000);
    assert.ok(Buffer.byteLength(row.response_body.text) <= 512 * 1024);
    assert.equal(reply.bodies_full.with_full_bodies, 0);
    assert.match(reply.summary, new RegExp(`request ${id} had 600000 full-body bytes.*cannot be recovered`, 'u'));
  };
  const chain = callTool(store, 'action_chain', { action_id: 'a_oversize', include_bodies: true });
  checkTruncated(chain, 'oversize:request:3');
  assert.equal(chain.bodies_full.cut, 1);
  assert.ok(chain.bodies_full.next_cursor);
  const older = callTool(store, 'action_chain', { action_id: 'a_oversize', include_bodies: true, ...chain.bodies_full.next_cursor });
  checkTruncated(older, 'oversize:request:2');
  assert.equal(older.bodies_full.cut, 0);
  assert.equal(older.bodies_full.next_cursor, undefined);
  const unlinkedRows = [rows[0], { ...rows[1], action_id: null }, rows[2]];
  const unlinkedStore = createStore({ records: unlinkedRows, now: () => 2000 });
  const recent = callTool(unlinkedStore, 'recent_actions', { n: 1, include_bodies: true });
  checkTruncated(recent, 'oversize:request:2');
  const listed = callTool(unlinkedStore, 'page_requests', { attribution: 'none', include_bodies: true });
  checkTruncated(listed, 'oversize:request:2');
});
