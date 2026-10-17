import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActionChains, describeEpisodeEvidence, indexEntryHandlerUnits, SCOPED_ABSENCE } from '../analysis/runtime-attribution.mjs';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const action = (id, extra = {}) => ({ kind: 'dom.action', action_id: id, event: 'click', continuation_id: `c:${id}`, sequence: 1, timestamp: 1, ...extra });
const enter = (id, fn, seq) => ({ kind: 'function.enter', action_id: id, function_id: fn, continuation_id: `f:${id}`, parent_continuation_id: `c:${id}`,
  invoked_by: 'event', spine: { action_id: id, function_ids: [fn] }, sequence: seq });
const request = (id, seq, extra = {}) => ({ kind: 'network.request', action_id: id, request_occurrence_id: `${id}:request:${seq}`, method: 'POST', url: '/api/save',
  parent_continuation_id: `f:${id}`, terminal_owner_continuation_id: `f:${id}`, trace_context: { trace_id: `t${seq}`, span_id: `s${seq}` }, sequence: seq, timestamp: 2, ...extra });
const server = (seq, extra = {}) => ({ schema: 'producttrace.backend-span.v1', kind: 'server', trace_id: `t${seq}`, span_id: `srv${seq}`, parent_span_id: `s${seq}`,
  attributes: { 'http.request.method': 'POST', 'http.route': '/api/save' }, ...extra });
const handlerSpan = seq => ({ schema: 'producttrace.backend-span.v1', kind: 'internal', trace_id: `t${seq}`, span_id: `h${seq}`, parent_span_id: `srv${seq}`, instrumentation: { name: 'producttrace-express-handlers' } });
const dbSpan = seq => ({ schema: 'producttrace.backend-span.v1', kind: 'client', trace_id: `t${seq}`, span_id: `d${seq}`, parent_span_id: `h${seq}`, attributes: { 'db.system': 'mongodb', 'db.operation': 'insert', 'db.mongodb.collection': 'things' } });

test('backend declaration is required; missing spans are never read as "backend off"', () => {
  assert.throws(() => buildActionChains([action('a1')], []), /backendInstrumented must be declared/u);
});

test('frontend-only: every request ends at an explicit network frontier, never a backend stop', () => {
  const rows = [action('a1'), enter('a1', 'fn:save', 2), request('a1', 3), request('a1', 4, { method: 'GET', url: '/api/list' }),
    action('a2', { sequence: 5 }), { kind: 'dom.mutation', action_id: 'a2', sequence: 6, count: 1 }];
  // Spans are present but must be ignored when the backend is declared off.
  const chains = buildActionChains(rows, [server(3), handlerSpan(3), dbSpan(3)], { backendInstrumented: false });
  assert.equal(chains.length, 2);
  const [first, second] = chains;
  assert.equal(first.stopped_at, 'network');
  assert.equal(first.because, 'backend not instrumented');
  assert.deepEqual(first.requests.map(row => [row.stopped_at, row.because]), [['network', 'backend not instrumented'], ['network', 'backend not instrumented']]);
  assert.equal(first.entry_handler.function_id, 'fn:save');
  assert.equal(first.reached.some(step => ['route', 'server_handler', 'db'].includes(step.stop)), false);
  assert.deepEqual([second.stopped_at, second.because], ['browser', 'no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)']);
  assert.equal(second.because, SCOPED_ABSENCE.no_request);
  assert.deepEqual(second.reached.map(step => step.stop), ['action', 'dom_mutation']);
});

test('backend on: exact joins reach db; an unjoined request keeps "no span on trace" and its diagnostic', () => {
  const rows = [action('a1'), enter('a1', 'fn:save', 2), request('a1', 3), request('a1', 4, { method: 'GET', url: '/api/list' })];
  const chains = buildActionChains(rows, [server(3), handlerSpan(3), dbSpan(3)], { backendInstrumented: true });
  const [chain] = chains;
  assert.equal(chain.stopped_at, null);
  assert.deepEqual(chain.reached.filter(step => step.stop === 'db').map(step => [step.operation, step.collection]), [['insert', 'things']]);
  const unjoined = chain.requests.find(row => row.method === 'GET');
  assert.deepEqual([unjoined.stopped_at, unjoined.because], ['network', 'no span on trace']);
  assert.equal(unjoined.diagnostic_reason, 'no_exact_parent_server');
  assert.ok(Number.isFinite(unjoined.diagnostic_sequence));
  // Same trace, wrong parent: not joined, no inferred backend stop.
  const wrongParent = buildActionChains([action('b1'), request('b1', 7)], [server(7, { parent_span_id: 'other' })], { backendInstrumented: true })[0];
  assert.deepEqual([wrongParent.stopped_at, wrongParent.because], ['network', 'no span on trace']);
  const handlerOnly = buildActionChains([action('c1'), request('c1', 8)], [server(8), handlerSpan(8)], { backendInstrumented: true })[0];
  assert.deepEqual([handlerOnly.stopped_at, handlerOnly.because], ['handler', 'no db span under handler']);
});

test('credit abstains for a global listener; bound handlers and request owners keep credit', () => {
  const mutation = id => ({ kind: 'dom.mutation', action_id: id, parent_continuation_id: `f:${id}`, sequence: 9, count: 1 });
  const bound = ids => ({ bound_handlers: { ids, library: 0 } });
  // Global listener: its frame is not bound and only a DOM mutation followed.
  const globalRows = [action('g1', bound(['fn:button'])), enter('g1', 'fn:shortcut', 2), mutation('g1')];
  const globalIndex = indexEntryHandlerUnits(globalRows);
  assert.equal(globalIndex.byAction.has('g1'), false);
  assert.deepEqual(globalIndex.abstentions.get('g1').global_listeners, ['fn:shortcut']);
  const [chain] = buildActionChains(globalRows, [], { backendInstrumented: false });
  assert.deepEqual([chain.stopped_at, chain.because], ['entry_handler', 'no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [fn:shortcut]']);
  // A bound handler (e.g. the callback written inside onSubmit={handleSubmit(cb)}) keeps credit.
  const boundIndex = indexEntryHandlerUnits([action('b1', bound(['fn:cb'])), enter('b1', 'fn:cb', 2), mutation('b1')]);
  assert.deepEqual(boundIndex.byAction.get('b1'), ['fn:cb|click']);
  // A frame that owns a request is credited whatever bound it.
  const requestIndex = indexEntryHandlerUnits([action('r1', bound([])), enter('r1', 'fn:loader', 2), request('r1', 3)]);
  assert.deepEqual(requestIndex.byAction.get('r1'), ['fn:loader|click']);
  assert.deepEqual(requestIndex.units.get('fn:loader|click').rooted_action_ids, ['r1']);
  // Records without a binding (older runtimes) keep the previous behaviour.
  const legacy = indexEntryHandlerUnits([action('l1'), enter('l1', 'fn:shortcut', 2), mutation('l1')]);
  assert.deepEqual(legacy.byAction.get('l1'), ['fn:shortcut|click']);
});

test('viewer episode state carries the same frontier vocabulary', () => {
  const act = action('a1'); const req = request('a1', 3);
  const episode = { episode_id: 'e1', action_ids: ['a1'], actions: [act] };
  const off = describeEpisodeEvidence(episode, [act, req], [act, req], { idle: true, backendInstrumented: false });
  assert.deepEqual(off.frontier, { stopped_at: 'network', because: 'backend not instrumented' });
  const on = describeEpisodeEvidence(episode, [act, req], [act, req], { idle: true });
  assert.deepEqual(on.frontier, { stopped_at: 'network', because: 'no span on trace' });
  assert.equal(on.stop_reason, 'no_exact_parent_server_before_idle');
});

test('runtime emits network.request from its own fetch/XHR wrappers when no bridge is installed', async () => {
  const { runtime, dispatch, fetchCalls, xhrCalls, context, evaluate } = loadBrowserRuntime();
  assert.equal(context.__PRODUCTTRACE_BRIDGE_TRANSPORT__, undefined);
  evaluate(`globalThis.__handler = globalThis.__productTraceRuntime.tag(function save() {
    fetch('/api/save', { method: 'POST' });
    const xhr = new XMLHttpRequest(); xhr.open('PUT', '/api/item?x=1'); xhr.send();
  }, 0, true, true);`);
  runtime.registerManifest([{ index: 0, id: 'function:fixture:0:10' }]);
  const button = fakeElement('button', { type: 'button' });
  dispatch('click', button);
  context.__handler();
  const requests = JSON.parse(JSON.stringify(runtime.records.filter(row => row.kind === 'network.request')));
  assert.equal(requests.length, 2);
  const action = runtime.records.find(row => row.kind === 'dom.action');
  for (const row of requests) {
    assert.equal(row.action_id, action.action_id);
    assert.match(row.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
    assert.ok(row.terminal_owner_continuation_id);
    assert.equal(row.linkage_kind, 'direct');
  }
  // Path and query as sent (fix/mcp-gaps: the query is recorded as-is; never the fragment).
  assert.deepEqual(requests.map(row => [row.transport, row.method, row.url]), [['fetch', 'POST', '/api/save'], ['xhr', 'PUT', '/api/item?x=1']]);
  assert.equal(fetchCalls[0].headers.traceparent, requests[0].traceparent);
  assert.equal(xhrCalls[0].headers.traceparent, requests[1].traceparent);
});

test('traceparent goes only to the page origin and listed origins; a cross-origin request is sent as the app wrote it', () => {
  const { runtime, fetchCalls, xhrCalls, evaluate } = loadBrowserRuntime({ extraGlobals: { URL, location: { href: 'http://127.0.0.1:5173/app' },
    __PRODUCTTRACE_TRACE_ORIGINS__: ['https://api.example.test'] } });
  evaluate(`fetch('/api/own'); fetch('http://127.0.0.1:5173/api/absolute'); fetch('https://cdn.other.test/data'); fetch('https://api.example.test/listed');
    const xhr = new XMLHttpRequest(); xhr.open('GET', 'https://cdn.other.test/x'); xhr.send();`);
  assert.deepEqual(fetchCalls.map(call => [call.input, Boolean(call.headers.traceparent)]),
    [['/api/own', true], ['http://127.0.0.1:5173/api/absolute', true], ['https://cdn.other.test/data', false], ['https://api.example.test/listed', true]]);
  assert.equal(xhrCalls[0].headers.traceparent, undefined);
  const rows = JSON.parse(JSON.stringify(runtime.records.filter(row => row.kind === 'network.request')));
  assert.deepEqual([...rows.map(row => row.traceparent_sent ?? true)], [true, true, false, true, false]);
});

test('the bridge guard suppresses only the duplicate row of the bridge-owned call', () => {
  const { runtime, context, evaluate } = loadBrowserRuntime();
  evaluate(`globalThis.__PRODUCTTRACE_BRIDGE_TRANSPORT__ = true; fetch('/api/bridged'); globalThis.__PRODUCTTRACE_BRIDGE_TRANSPORT__ = undefined; fetch('/api/direct');`);
  assert.equal(context.__PRODUCTTRACE_BRIDGE_TRANSPORT__, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.records.filter(row => row.kind === 'network.request').map(row => row.url))), ['/api/direct']);
});

test('Vite plugin can install without the static-era request bridge (fresh frontend-only repo)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { productTraceVitePlugin } = await import('../integrations/vite.mjs');
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-frontend-only-'));
  try {
    fs.mkdirSync(path.join(repository, 'src'));
    fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"fixture","private":true}');
    fs.writeFileSync(path.join(repository, 'src/App.jsx'), 'export function App() { return <button onClick={() => fetch("/api/x", { method: "POST" })}>Go</button>; }\n');
    assert.throws(() => productTraceVitePlugin({ repository, service: 'web' }), /bridgeEndpoint/u);
    const plugin = productTraceVitePlugin({ repository, service: 'web', requestBridge: false });
    const tags = plugin.transformIndexHtml().tags;
    assert.equal(tags.some(tag => String(tag.attrs?.src || '').includes('producttrace-request-bridge')), false);
    assert.ok(tags.some(tag => String(tag.children || '').includes('installProductTraceRuntimeAttribution')));
    const emitted = [];
    plugin.generateBundle.call({ emitFile: file => emitted.push(file.fileName) });
    assert.deepEqual(emitted, ['producttrace-runtime.js']);
    assert.equal(plugin.api.snapshot().request_bridge_enabled, false);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

test('closed shadow root: a request-less action states the closed-root frontier; a request owner keeps credit', () => {
  const closed = { target: { tag: 'lock-chip', attributes: {}, composed: true, closed_shadow: true }, bound_handlers: { ids: [], library: 0 } };
  const records = [action('a1', closed), enter('a1', 'function:inner', 2),
    action('a2', { ...closed, sequence: 3 }), enter('a2', 'function:inner-fetch', 4), request('a2', 5)];
  const chains = new Map(buildActionChains(records, [], { backendInstrumented: false }).map(chain => [chain.action_id, chain]));
  const quiet = chains.get('a1');
  assert.equal(quiet.stopped_at, 'entry_handler');
  assert.equal(quiet.because, SCOPED_ABSENCE.closed_shadow);
  assert.ok(quiet.because.startsWith('target inside a closed shadow root') && quiet.because.endsWith(SCOPED_ABSENCE.no_request));
  assert.equal(quiet.entry_handler, null);
  assert.deepEqual(quiet.handler_abstention.handlers_ran, ['function:inner']);
  assert.deepEqual(quiet.target_frontier, { closed_shadow: true, host: 'lock-chip', because: 'target inside a closed shadow root' });
  const busy = chains.get('a2');
  assert.equal(busy.entry_handler.function_id, 'function:inner-fetch');
  assert.equal(busy.stopped_at, 'network');
  assert.equal(busy.target_frontier.closed_shadow, true);
  const open = buildActionChains([action('a3', { target: { tag: 'button', attributes: {}, composed: true, shadow_host: { tag: 'share-chip' } } })], [], { backendInstrumented: false })[0];
  assert.equal(open.because, SCOPED_ABSENCE.no_request);
  assert.deepEqual(open.target_frontier, { closed_shadow: false, host: 'share-chip', target: 'button' });
});
