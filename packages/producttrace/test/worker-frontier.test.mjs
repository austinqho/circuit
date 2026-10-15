// Worker frontier: a request issued inside a Web Worker is a stated frontier,
// never silence. The neutral fixture (test/browser/fixtures/worker-app) runs
// against the real browser runtime in a V8 context; its workers run in their
// own V8 contexts whose fetch goes to a fake backend the page's wrappers never
// see (as in a browser, where worker code is not instrumented).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { buildActionChains, indexWorkflowEpisodes, SCOPED_ABSENCE } from '../analysis/runtime-attribution.mjs';
import { buildEpisodeChain, chainFrontier, indexUnlinkedEvidence, UNLINKED_ATTRIBUTION } from '../analysis/causal-chain.mjs';
import { createStore } from '../collector/store.mjs';
import { callTool } from '../mcp/tools.mjs';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const fixtureDir = path.resolve(import.meta.dirname, 'browser/fixtures/worker-app');
const fixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');
const hostTimeout = setTimeout; // native scheduling, invisible to the page runtime
const wait = ms => new Promise(resolve => hostTimeout(resolve, ms));
const WORKER_BECAUSE = `message posted to Web Worker /worker.js; ${SCOPED_ABSENCE.worker}`;

/** A backend that records one OpenTelemetry-shaped server span per request. */
function fakeBackend() {
  const spans = [];
  return { spans, fetch(input, init = {}) {
    const headers = new Headers(init.headers || {});
    const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/u.exec(headers.get('traceparent') || '');
    const now = Date.now();
    spans.push({ schema: 'producttrace.backend-span.v1', source: 'opentelemetry', service_name: 'fixture-api', name: `GET ${input}`,
      trace_id: parent ? parent[1] : randomBytes(16).toString('hex'), span_id: randomBytes(8).toString('hex'), parent_span_id: parent ? parent[2] : null,
      kind: 'server', attributes: { 'http.request.method': String(init.method || 'GET'), 'http.route': String(input), 'http.response.status_code': 200 },
      start_time: [Math.floor(now / 1000), (now % 1000) * 1e6], end_time: [Math.floor(now / 1000), (now % 1000) * 1e6], instrumentation: null });
    return Promise.resolve({ status: 200, json: async () => ({ ok: true }) });
  } };
}

/** Dedicated workers: each script runs in its own context; messages are structured clones delivered on native timers. */
function workerHost(backend) {
  const scripts = { '/worker.js': fixture('worker.js'), '/idle-worker.js': fixture('idle-worker.js') };
  class FakeWorker {
    constructor(url) {
      this.listeners = []; this.onmessage = null;
      const inside = { listeners: [], addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); },
        postMessage: data => { const copy = structuredClone(data); hostTimeout(() => { for (const fn of this.listeners) fn({ data: copy }); this.onmessage?.({ data: copy }); }, 1); } };
      inside.self = inside;
      this.inside = inside;
      vm.runInContext(scripts[String(url)], vm.createContext({ self: inside, fetch: backend.fetch, Headers, console }));
    }
    postMessage(data) { const copy = structuredClone(data); hostTimeout(() => { for (const fn of this.inside.listeners) fn({ data: copy }); }, 1); }
    addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
  }
  return FakeWorker;
}

function button(id) {
  const element = fakeElement('button', { id, type: 'button' });
  const listeners = [];
  element.addEventListener = (type, fn) => { if (type === 'click') listeners.push(fn); };
  element.fire = event => { for (const fn of listeners) fn(event); };
  return element;
}

async function runFixture() {
  const backend = fakeBackend();
  const t = loadBrowserRuntime({ extraGlobals: { event: undefined, Worker: workerHost(backend) } });
  const elements = { load: button('load'), noop: button('noop'), output: { textContent: '' } };
  t.context.document.getElementById = id => elements[id] || null;
  vm.runInContext(fixture('main.js'), t.context, { filename: 'main.js' });
  await wait(10);
  t.dispatch('click', elements.load, {}, event => elements.load.fire(event));
  await wait(40);
  t.dispatch('click', elements.noop, {}, event => elements.noop.fire(event));
  await wait(20);
  const records = JSON.parse(JSON.stringify(t.runtime.records));
  return { t, records, spans: backend.spans, results: t.context.__workerFixtureResults, stats: t.runtime.stampStats() };
}

test('runtime: worker.create and worker.postMessage rows carry creation-time ownership, never message content', async () => {
  const { t, records, results, stats, spans } = await runFixture();
  assert.deepEqual(JSON.parse(JSON.stringify(results)), [{ path: '/api/x', status: 200, body: { ok: true } }], 'the page received the worker result');
  assert.deepEqual(spans.map(span => span.attributes['http.route']), ['/api/x'], 'the backend saw the worker request');
  assert.equal(records.some(row => row.kind === 'network.request'), false, 'the page wrappers never see a worker fetch');
  const [load, noop] = records.filter(row => row.kind === 'dom.action');
  const creates = records.filter(row => row.kind === 'worker.create');
  assert.deepEqual(creates.map(row => [row.script_url, row.worker_kind, row.action_id, row.instrumented]),
    [['/worker.js', 'dedicated', null, false], ['/idle-worker.js', 'dedicated', null, false]], 'workers created at load are owned by no action');
  const limits = records.filter(row => row.kind === 'capture.limit');
  // One capture.limit per worker created (fix/honest-coverage): each is a realm the runtime does not observe.
  assert.deepEqual(limits.map(row => [row.feature, row.reason, row.script_url]), [['worker_fetch', 'worker code is not instrumented', '/worker.js'], ['worker_fetch', 'worker code is not instrumented', '/idle-worker.js']]);
  const page = records.find(row => row.kind === 'capture.page');
  assert.equal(page.wrappers.worker, true, 'capture.page reports the Worker wrapper installed');
  assert.deepEqual(JSON.parse(JSON.stringify(t.runtime.captureSummary('test').capture_limit_features)), ['worker_fetch']);
  const posts = records.filter(row => row.kind === 'worker.postMessage');
  assert.equal(posts.length, 1, 'only the post made by the click is a row');
  const [post] = posts;
  assert.equal(post.action_id, load.action_id);
  assert.equal(post.worker_id, creates[0].worker_id);
  assert.equal(post.script_url, '/worker.js');
  assert.equal(post.via, 'worker');
  assert.equal(post.message_size_class, 'small');
  assert.equal(post.transfer_count, 0);
  assert.ok(post.parent_continuation_id, 'owned through the calling continuation');
  assert.equal(JSON.stringify(post).includes('/api/x') || JSON.stringify(post).includes('"load"'), false, 'no message content');
  assert.equal(stats.worker_posts_unowned, 1, 'the idle worker warm-up at load is counted, not attributed');
  assert.equal(records.some(row => row.kind === 'worker.postMessage' && row.action_id === noop.action_id), false);
});

test('a post from a later continuation of the action is owned by it (timer created in the handler)', async () => {
  const backend = fakeBackend();
  const t = loadBrowserRuntime({ extraGlobals: { event: undefined, Worker: workerHost(backend) } });
  const worker = t.evaluate("new Worker('/worker.js')");
  const target = fakeElement('button');
  t.dispatch('click', target, {}, () => { t.context.setTimeout(() => worker.postMessage({ op: 'load', path: '/api/x' }), 1); });
  await wait(30);
  const action = t.runtime.records.find(row => row.kind === 'dom.action');
  const post = t.runtime.records.find(row => row.kind === 'worker.postMessage');
  assert.equal(post.action_id, action.action_id);
  assert.match(post.parent_continuation_id, /:timer:/u);
});

test('chains: the click stops at the worker; the backend span is unlinked evidence, not a join', async () => {
  const { records, spans } = await runFixture();
  const [load, noop] = records.filter(row => row.kind === 'dom.action');
  const chains = buildActionChains(records, spans, { backendInstrumented: true });
  const chain = chains.find(row => row.action_id === load.action_id);
  assert.deepEqual([chain.stopped_at, chain.because], ['worker', WORKER_BECAUSE]);
  assert.deepEqual(chain.reached.map(step => step.stop), ['action', 'worker']);
  assert.equal(chain.reached.find(step => step.stop === 'worker').script_url, '/worker.js');
  assert.equal(chain.reached.some(step => ['request', 'route', 'server_handler', 'db'].includes(step.stop)), false, 'nothing is joined');
  assert.deepEqual(chain.requests, []);
  // Negative: the no-op click touched no worker; the idle worker is named nowhere.
  const other = chains.find(row => row.action_id === noop.action_id);
  assert.deepEqual([other.stopped_at, other.because], ['browser', SCOPED_ABSENCE.no_request]);
  assert.equal(JSON.stringify(chains).includes('idle-worker'), false);
  // Backend declared off: still the worker frontier, and no spans are listed.
  const off = buildActionChains(records, spans, { backendInstrumented: false }).find(row => row.action_id === load.action_id);
  assert.deepEqual([off.stopped_at, off.because], ['worker', WORKER_BECAUSE]);
  // Episode chain (live viewer / MCP).
  const episodes = indexWorkflowEpisodes(records);
  const episode = episodes.episodes.get(episodes.byAction.get(load.action_id));
  const record = buildEpisodeChain(episode, records, spans, { idle: true, unlinked: indexUnlinkedEvidence(records, spans) });
  assert.deepEqual(chainFrontier(record), { reached: 'worker', stopped_at: 'worker', because: WORKER_BECAUSE, stop_reason: 'worker_not_instrumented' });
  assert.equal(record.display.label, 'Stopped at worker: /worker.js is not instrumented');
  // PR #4's unlinked evidence: the worker's request, seen by the backend, listed by window, never joined.
  assert.deepEqual(record.unlinked.server_spans.map(span => [span.route, span.attribution]), [['/api/x', UNLINKED_ATTRIBUTION]]);
  assert.equal(record.unlinked.window.until_action_id, noop.action_id);
  assert.equal(record.chain.some(step => step.kind === 'route.dispatch'), false);
});

test('MCP: action_chain, recent_actions and element_history say "stopped at worker"', async () => {
  const { records, spans } = await runFixture();
  const [load] = records.filter(row => row.kind === 'dom.action');
  // A stamped button (G3 key on the dispatch target), so element_history can look it up.
  load.target = { ...load.target, element_key: 'p_fixture00load:0-10#n1' };
  const store = createStore({ records, spans, now: () => Date.now() + 60_000 });
  const chain = callTool(store, 'action_chain', { action_id: load.action_id });
  assert.equal(chain.stopped_at, 'worker');
  assert.equal(chain.because, WORKER_BECAUSE);
  assert.match(chain.summary, /post to worker \/worker\.js( \[outcome [^\]]*\])?: reached worker \/ stopped at worker \/ because message posted to Web Worker \/worker\.js/u);
  assert.deepEqual(chain.stops.map(stop => stop.stop), ['dispatch', 'worker']);
  assert.deepEqual(chain.unlinked.server_spans.map(span => [span.route, span.attribution]), [['/api/x', UNLINKED_ATTRIBUTION]]);
  assert.match(chain.summary, /Observed during this action's window, not linked to it[^]*server span GET \/api\/x/u);
  const recent = callTool(store, 'recent_actions', {});
  assert.match(recent.actions.find(row => row.action_id === load.action_id).summary, /stopped at worker/u);
  assert.equal(recent.actions.filter(row => row.stopped_at === 'worker').length, 1, 'only the click that posted');
  // compare_chains: the worker slot aligns, and `reached` is compared (PR #4).
  const noop = records.filter(row => row.kind === 'dom.action')[1];
  const compared = callTool(store, 'compare_chains', { before_action_id: load.action_id, after_action_id: noop.action_id });
  assert.deepEqual(compared.stops.filter(stop => stop.stop === 'worker').map(stop => [stop.key, stop.status]), [['/worker.js', 'removed']]);
  assert.ok(compared.outcome_delta.changed.includes('reached') && compared.outcome_delta.changed.includes('stopped_at'));
  assert.equal(compared.path_changed, true);
  const same = callTool(store, 'compare_chains', { before_action_id: load.action_id, after_action_id: load.action_id });
  assert.deepEqual(same.stops.filter(stop => stop.stop === 'worker').map(stop => stop.status), ['same']);
  assert.equal(same.path_changed, false);
  const history = callTool(store, 'element_history', { element_key: 'p_fixture00load:0-10#n1' });
  assert.equal(history.status, 'ok');
  const entry = history.actions.find(row => row.action_id === load.action_id);
  assert.deepEqual([entry.stopped_at, entry.because], ['worker', WORKER_BECAUSE]);
  assert.match(entry.summary, /stopped at worker/u);
  assert.match(history.summary, /stopped at worker/u);
  assert.equal(entry.unlinked_counts.server_spans, 1);
});

test('a request attributed after the post keeps its frontier; the worker is an additional stop (and vice versa)', () => {
  const action = { kind: 'dom.action', action_id: 'a1', event: 'click', continuation_id: 'c:a1', sequence: 1, timestamp: 1 };
  const post = { kind: 'worker.postMessage', action_id: 'a1', worker_id: 'worker:s:1', worker_kind: 'dedicated', script_url: '/w.js', parent_continuation_id: 'c:a1', sequence: 3, timestamp: 3 };
  const request = (seq, ts) => ({ kind: 'network.request', action_id: 'a1', request_occurrence_id: `a1:request:${seq}`, method: 'POST', url: '/api/save',
    parent_continuation_id: 'c:a1', trace_context: { trace_id: `t${seq}`, span_id: `s${seq}` }, sequence: seq, timestamp: ts });
  const after = buildActionChains([action, post, request(4, 4)], [], { backendInstrumented: false })[0];
  assert.deepEqual([after.stopped_at, after.because], ['network', 'backend not instrumented']);
  assert.deepEqual(after.additional_stops.map(stop => [stop.stopped_at, stop.script_url]), [['worker', '/w.js']]);
  const before = buildActionChains([action, request(2, 2), post], [], { backendInstrumented: false })[0];
  assert.deepEqual([before.stopped_at, before.because], ['worker', `message posted to Web Worker /w.js; ${SCOPED_ABSENCE.worker}`]);
  assert.deepEqual(before.additional_stops.map(stop => [stop.stopped_at, stop.because]), [['network', 'backend not instrumented']]);
  // Same rule on the stored-chain frontier (G4).
  const record = rows => ({ chain: rows.map(row => ({ ...row })), terminal: { stop_reason: 'no_exact_parent_server_before_idle' } });
  const requestFirst = chainFrontier(record([request(4, 4), post]));
  assert.equal(requestFirst.stopped_at, 'network');
  assert.deepEqual(requestFirst.additional_stops.map(stop => stop.stopped_at), ['worker']);
  const workerLast = chainFrontier(record([request(2, 2), post]));
  assert.equal(workerLast.stopped_at, 'worker');
  assert.deepEqual(workerLast.additional_stops.map(stop => stop.stopped_at), ['network']);
});

test('SharedWorker ports and a MessageChannel port handed to a worker are posts to that worker', async () => {
  class FakeWorker { postMessage() {} }
  const t = loadBrowserRuntime({ extraGlobals: { event: undefined, Worker: FakeWorker, MessagePort, MessageChannel,
    SharedWorker: class { constructor() { this.port = new MessageChannel().port1; } } } });
  const { worker, shared, channel } = t.evaluate("({ worker: new Worker('/w.js?v=1'), shared: new SharedWorker('/shared.js'), channel: new MessageChannel() })");
  t.dispatch('click', fakeElement('button'), {}, () => {
    worker.postMessage({ hello: 'x'.repeat(4096) }, [channel.port2]);
    channel.port1.postMessage('ping');
    shared.port.postMessage(new Uint8Array(200000));
  });
  const posts = JSON.parse(JSON.stringify(t.runtime.records.filter(row => row.kind === 'worker.postMessage')));
  assert.deepEqual(posts.map(row => [row.script_url, row.via, row.message_size_class, row.transfer_count]),
    [['/w.js', 'worker', 'medium', 1], ['/w.js', 'message_port', 'small', 0], ['/shared.js', 'message_port', 'large', 0]]);
  assert.equal(new Set(posts.map(row => row.action_id)).size, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.runtime.records.filter(row => row.kind === 'worker.create').map(row => row.worker_kind))), ['dedicated', 'shared']);
  channel.port1.close(); shared.port.close();
});

test('live viewer label agrees with stopped_at when a request precedes the post (and not when it follows)', () => {
  const action = { kind: 'dom.action', action_id: 'a1', event: 'click', continuation_id: 'c:a1', sequence: 1, timestamp: 1, target: { tag: 'button' } };
  const post = { kind: 'worker.postMessage', action_id: 'a1', worker_id: 'worker:s:1', worker_kind: 'dedicated', script_url: '/w.js', parent_continuation_id: 'c:a1', sequence: 3, timestamp: 3 };
  const request = (seq, ts) => ({ kind: 'network.request', action_id: 'a1', request_occurrence_id: `a1:request:${seq}`, method: 'POST', url: '/api/save',
    parent_continuation_id: 'c:a1', trace_context: { trace_id: `t${seq}`, span_id: `s${seq}` }, sequence: seq, timestamp: ts });
  const episode = { episode_id: 'e1', action_ids: ['a1'], actions: [action], carrier_action_id: 'a1' };
  const requestThenPost = buildEpisodeChain(episode, [action, request(2, 2), post], [], { idle: true, unlinked: indexUnlinkedEvidence([action, request(2, 2), post], []) });
  assert.ok(requestThenPost.unlinked, 'a worker chain carries unlinked evidence even with an attributed request');
  assert.equal(chainFrontier(requestThenPost).stopped_at, 'worker');
  assert.equal(requestThenPost.display.label, 'Stopped at worker: /w.js is not instrumented');
  assert.equal(requestThenPost.terminal.stop_reason, 'worker_not_instrumented');
  const postThenRequest = buildEpisodeChain(episode, [action, post, request(4, 4)], [], { idle: true });
  assert.equal(chainFrontier(postThenRequest).stopped_at, 'network');
  assert.match(postThenRequest.display.label, /^Stopped at network: /u);
  // Not yet idle: still pending, whatever was posted.
  assert.equal(buildEpisodeChain(episode, [action, request(2, 2), post], [], { idle: false }).display.status, 'pending');
});
