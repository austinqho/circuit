// Tracer never produces a false negative: absence is scoped to what Tracer
// sees, unlinked evidence is listed (never joined), and coverage is provable
// from capture.page / capture.summary / capture.received rows alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCOPED_ABSENCE, indexWorkflowEpisodes } from '../analysis/runtime-attribution.mjs';
import { buildEpisodeChain, chainFrontier, indexUnlinkedEvidence, UNLINKED_ATTRIBUTION, UNLINKED_HEADING } from '../analysis/causal-chain.mjs';
import { createCollector } from '../collector/index.js';
import { createStore, loadStore } from '../collector/store.mjs';
import { createReceivedTally, pageCoverage } from '../collector/coverage.mjs';
import { callTool } from '../mcp/tools.mjs';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const PAGE = 's_0000000a';
const row = (sequence, extra) => ({ schema: 'producttrace.runtime-evidence.v1', sequence, timestamp: 1000 + sequence * 10, capture_page_id: PAGE, ...extra });
const click = (sequence, id) => row(sequence, { kind: 'dom.action', action_id: id, event: 'click', continuation_id: `c:${id}`, target: { tag: 'button', attributes: {}, ref: `object:${id}` }, spine: { action_id: id, function_ids: [] } });
const hr = ms => [Math.floor(ms / 1000), (ms % 1000) * 1e6];

function scenario() {
  const records = [
    click(2, 'a1'),
    row(3, { kind: 'dom.mutation', action_id: 'a1', count: 1 }),
    // Seen by the runtime's fetch wrapper outside every action frame (an uninstrumented script).
    row(4, { kind: 'network.request', action_id: null, request_occurrence_id: 'unattributed:request:1', method: 'GET', url: '/api/third-party', transport: 'fetch', internal: false,
      trace_context: { trace_id: 't-third', span_id: 's-third' }, reason: 'unattributed_transport' }),
    click(6, 'a2'),
    row(7, { kind: 'network.request', action_id: 'a2', request_occurrence_id: 'a2:request:2', method: 'POST', url: '/api/save', transport: 'fetch', internal: false,
      parent_continuation_id: 'c:a2', terminal_owner_continuation_id: 'c:a2', trace_context: { trace_id: 't-save', span_id: 's-save' } }),
    // After a2: inside a2's window, but a2 has an attributed request, so it is not listed anywhere.
    row(8, { kind: 'network.request', action_id: null, request_occurrence_id: 'unattributed:request:3', method: 'GET', url: '/api/poll', transport: 'fetch', internal: false,
      trace_context: { trace_id: 't-poll', span_id: 's-poll' } }),
  ];
  const spans = [
    // Joined to a1-window's unattributed request (it has a request row with its parent): not an unjoined span.
    { schema: 'producttrace.backend-span.v1', trace_id: 't-third', span_id: 'srv-third', parent_span_id: 's-third', kind: 'server', start_time: hr(1045), attributes: { 'http.method': 'GET', 'http.route': '/api/third-party', 'http.status_code': 200 } },
    // No request row has this parent span id: an unjoined server span inside a1's window.
    { schema: 'producttrace.backend-span.v1', trace_id: 't-orphan', span_id: 'srv-orphan', parent_span_id: 'nobody', kind: 'server', start_time: hr(1050), attributes: { 'http.method': 'POST', 'http.route': '/api/worker-sync', 'http.status_code': 204 } },
    // Unjoined but after a2's dispatch: outside a1's window.
    { schema: 'producttrace.backend-span.v1', trace_id: 't-late', span_id: 'srv-late', parent_span_id: 'nobody-2', kind: 'server', start_time: hr(1065), attributes: { 'http.method': 'GET', 'http.route': '/api/late' } },
    { schema: 'producttrace.backend-span.v1', trace_id: 't-save', span_id: 'srv-save', parent_span_id: 's-save', kind: 'server', start_time: hr(1071), attributes: { 'http.method': 'POST', 'http.route': '/api/save', 'http.status_code': 200 } },
  ];
  return { records, spans };
}

test('request-less frontiers are scoped to what Tracer sees; no chain says the dispatch made no request', () => {
  const dispatchOnly = chainFrontier({ chain: [], terminal: { stop_reason: 'no_effect_after_dispatch' } });
  assert.deepEqual([dispatchOnly.reached, dispatchOnly.stopped_at, dispatchOnly.because], ['dispatch', 'browser', SCOPED_ABSENCE.no_request]);
  assert.equal(SCOPED_ABSENCE.no_request, 'no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)');
  const mutation = chainFrontier({ chain: [{ kind: 'dom.mutation' }], terminal: { stop_reason: 'no_effect_after_dispatch' } });
  assert.deepEqual([mutation.reached, mutation.stopped_at, mutation.because], ['dom_mutation', 'browser', SCOPED_ABSENCE.no_request]);
  const submit = chainFrontier({ chain: [], terminal: { stop_reason: 'no_request_or_validation_effect_after_submit' } });
  assert.deepEqual([submit.stopped_at, submit.because], ['browser', SCOPED_ABSENCE.no_request]);
  const rejected = chainFrontier({ chain: [{ kind: 'submit.rejected' }], terminal: { stop_reason: 'submit_rejected_by_app' } });
  assert.equal(rejected.stopped_at, 'validation');
  assert.equal(rejected.because, `the same form mutated after the submit (validation); ${SCOPED_ABSENCE.no_request}`);
  for (const frontier of [dispatchOnly, mutation, submit, rejected]) assert.doesNotMatch(frontier.because, /made no request|produced no request/u);
});

test('unlinked evidence: an unattributed request and an unjoined server span in the window are listed, never joined', () => {
  const { records, spans } = scenario();
  const store = createStore({ records, spans, now: () => 1e12 });
  const result = callTool(store, 'action_chain', { action_id: 'a1' });
  assert.equal(result.status, 'ok');
  assert.equal(result.stopped_at, 'browser');
  // fix/honest-coverage rule 4: the request that left the page in the window is in the headline, with its issuer.
  // Regrade (RUN-2): "recorded request(s)", the scope caveat kept, and a row with no issuer field reads "issuer not recorded".
  assert.equal(result.because, "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; transports and realms Tracer does not record are listed in coverage.unobserved); 1 recorded request left this page during this action's window that Tracer could not attribute (GET /api/third-party, issuer not recorded by this runtime), listed below as unlinked");
  assert.equal(result.stops.some(stop => stop.stop === 'request'), false, 'nothing is attributed');
  assert.deepEqual(result.unlinked.requests.map(entry => [entry.sequence, entry.url, entry.attribution]), [[4, '/api/third-party', UNLINKED_ATTRIBUTION]]);
  assert.deepEqual(result.unlinked.server_spans.map(entry => [entry.span_id, entry.route, entry.attribution]), [['srv-orphan', '/api/worker-sync', UNLINKED_ATTRIBUTION]]);
  assert.equal(UNLINKED_ATTRIBUTION, "none (observed during this action's window; timestamps only order, not a join)");
  assert.deepEqual([result.unlinked.window.from_sequence, result.unlinked.window.until, result.unlinked.window.until_action_id], [2, 'next_dispatch', 'a2']);
  // The MCP adds, per unlinked request, what its body rows hold (fix/mcp-surfaces); everything else is the chain record's listing.
  const BODY_FIELDS = ['body', 'response_body', 'request_fields', 'response_fields', 'browser_status', 'status_mismatch', 'fields_compared_with'];
  const withoutBodies = listing => ({ ...listing, requests: listing.requests.map(entry => Object.fromEntries(Object.entries(entry).filter(([key]) => !BODY_FIELDS.includes(key)))) });
  assert.deepEqual(result.chain.unlinked, withoutBodies(result.unlinked), 'the chain record carries the same listing');
  assert.deepEqual(result.unlinked.requests.map(entry => [entry.body, entry.response_body, entry.request_fields, entry.response_fields, entry.browser_status]), [[null, null, null, null, null]], 'no body rows: the added fields are null');
  const [line, heading, ...listed] = result.summary.split('\n');
  assert.match(line, /reached dom_mutation \/ stopped at browser \/ because no request could be attributed to this action from instrumented code/u);
  assert.equal(heading, `${UNLINKED_HEADING}:`);
  assert.match(listed[0], /^- request GET \/api\/third-party .*attribution: none \(observed during this action's window; timestamps only order, not a join\)$/u);
  assert.match(listed[1], /^- server span POST \/api\/worker-sync 204 /u);
  // The action with an attributed request carries no unlinked listing, and the poll after it is never pulled in.
  const saved = callTool(store, 'action_chain', { action_id: 'a2' });
  assert.equal(saved.unlinked, undefined);
  assert.equal(saved.stops.find(stop => stop.stop === 'request').url, '/api/save');
  // recent_actions carries counts only.
  const recent = callTool(store, 'recent_actions', {});
  assert.deepEqual(recent.actions.find(action => action.action_id === 'a1').unlinked_counts, { requests: 1, server_spans: 1, attribution: UNLINKED_ATTRIBUTION });
});

test('unlinked evidence never changes the chain or its joins; the window only withholds a claim or states what left the page', () => {
  const { records, spans } = scenario();
  const episodes = indexWorkflowEpisodes(records);
  const unlinked = indexUnlinkedEvidence(records, spans);
  for (const episode of episodes.episodes.values()) {
    // Without an index the window is computed from the rows given (here every row): the same answer, minus the listing.
    const plain = buildEpisodeChain(episode, records, spans, { idle: true });
    const listed = buildEpisodeChain(episode, records, spans, { idle: true, unlinked });
    const { unlinked: listing, ...rest } = listed;
    assert.deepEqual(rest, plain);
    assert.deepEqual(chainFrontier(listed), chainFrontier(plain));
    assert.equal(Boolean(listing), !plain.chain.some(step => step.kind === 'network.request'));
    // The window never adds a step: the chain equals the chain built with every unattributed row and span removed.
    const bare = buildEpisodeChain(episode, records.filter(entry => entry.kind !== 'network.request' || entry.action_id), spans.filter(span => span.span_id === 'srv-save'), { idle: true });
    assert.deepEqual(listed.chain, bare.chain);
    const frontier = chainFrontier(listed); const bareFrontier = chainFrontier(bare);
    assert.deepEqual([frontier.reached, frontier.stopped_at], [bareFrontier.reached, bareFrontier.stopped_at]);
  }
});

test('the last action of a page: the window runs to the page end', () => {
  const records = [click(1, 'b1'), row(5, { kind: 'network.request', action_id: null, request_occurrence_id: 'u:1', method: 'GET', url: '/api/late-script', transport: 'xhr', internal: false, trace_context: { trace_id: 't', span_id: 's' } })];
  const result = callTool(createStore({ records, spans: [], now: () => 1e12 }), 'action_chain', { action_id: 'b1' });
  assert.equal(result.unlinked.window.until, 'page_end');
  assert.deepEqual(result.unlinked.requests.map(entry => entry.url), ['/api/late-script']);
  assert.equal(result.stopped_at, 'browser');
});

// ---------------------------------------------------------------------------
// Coverage: runtime (VM) → collector (store mode) → loadStore → MCP.

function capturePage() {
  const shipped = [];
  const loaded = loadBrowserRuntime({ extraGlobals: { event: undefined, __producttraceHostCapture: text => { shipped.push(JSON.parse(text).row); } } });
  const { runtime, dispatch, evaluate } = loaded;
  const button = fakeElement('button');
  runtime.registerManifest([{ index: 0, id: 'function:aa:1:2' }]);
  evaluate('globalThis.__onSave = globalThis.__productTraceRuntime.tag(function onSave() { fetch("/api/save", { method: "POST" }); }, 0);');
  dispatch('click', button, {}, () => evaluate('globalThis.__onSave()'));
  // A script outside every action frame (third-party / uninstrumented): unattributed.
  evaluate('fetch("/api/third-party")');
  dispatch('click', fakeElement('button'));
  runtime.captureSummary('flush');
  // The sink tags rows with the runtime's page session.
  return { runtime, rows: shipped.map(entry => ({ ...entry, capture_page_id: runtime.session })) };
}

async function deliver(rows, { skipBatch = null, size = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-coverage-'));
  const collector = createCollector({ port: 0, store: { dir, manifest: { functions: [{ id: 'function:aa:1:2', source: { file: 'src/a.js', start: 1, end: 2 } }] }, label: 'coverage' } });
  await collector.ready;
  for (let start = 0, batch = 0; start < rows.length; start += size, batch += 1) {
    if (batch === skipBatch) continue;
    const response = await fetch(`${collector.url}/ingest`, { method: 'POST', body: JSON.stringify(rows.slice(start, start + size)) });
    assert.equal(response.status, 200);
  }
  await collector.close();
  const store = await loadStore({ dir });
  return { store, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('runtime emits capture.page (wrappers) and capture.summary (totals including itself)', () => {
  const { runtime, rows } = capturePage();
  const page = rows.find(entry => entry.kind === 'capture.page');
  assert.equal(page.page_id, runtime.session);
  assert.equal(page.runtime_version, runtime.runtimeVersion);
  assert.deepEqual(page.wrappers, { fetch: true, xhr: true, eventsource: false, websocket: false, worker: false, beacon: false });
  const summary = rows.at(-1);
  assert.equal(summary.kind, 'capture.summary');
  assert.equal(summary.last_sequence, summary.sequence);
  assert.equal(summary.rows_emitted, rows.filter(entry => Number.isInteger(entry.sequence)).length);
  const byKind = {}; for (const entry of rows) if (Number.isInteger(entry.sequence)) byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
  assert.deepEqual(summary.emitted_by_kind, byKind);
  assert.deepEqual([summary.capture_limits, summary.host_errors, summary.dropped, summary.malformed], [0, 0, null, null]);
  const requests = rows.filter(entry => entry.kind === 'network.request');
  assert.deepEqual(requests.map(entry => [entry.url, Boolean(entry.action_id)]), [['/api/save', true], ['/api/third-party', false]]);
});

test('coverage: every row delivered → complete: true, reported on action_chain and recent_actions', async () => {
  const { runtime, rows } = capturePage();
  const { store, cleanup } = await deliver(rows);
  try {
    const coverage = store.coverageFor(runtime.session);
    assert.deepEqual([coverage.complete, coverage.reasons], [true, []]);
    // Measured from what the runtime installed (capture.page.observes), never a constant: this VM page has no
    // EventSource, WebSocket, Worker or navigator, so nothing present went unwrapped; and since D-G1-21 the runtime
    // listens for every kind the enumeration finds (its on* properties and the handler-less kinds), so no event
    // kind is unobserved (the enumeration itself stays a lower bound: capture.page.observes.events.lower_bound).
    assert.deepEqual(coverage.unobserved.map(entry => [entry.kind, entry.names, entry.lower_bound]), []);
    assert.equal(coverage.observes.events.lower_bound, true);
    assert.ok(['click', 'focusout', 'touchstart', 'textInput'].every(kind => coverage.observes.events.recorded.includes(kind)));
    assert.deepEqual(coverage.observes.transports, { fetch: 'wrapped', xhr: 'wrapped', eventsource: 'absent', websocket: 'absent', worker: 'absent', shared_worker: 'absent', beacon: 'absent', service_worker: 'absent' });
    const received = store.records.find(entry => entry.kind === 'capture.received');
    assert.deepEqual([received.page_id, received.last_sequence, received.gap_rows, received.gaps], [runtime.session, rows.at(-1).sequence, 0, []]);
    const clickId = rows.find(entry => entry.kind === 'dom.action').action_id;
    // fix/honest-coverage rule 2: the page delivered every row, but the first click's window holds a request with no
    // action and no known issuer (the script's fetch), so that action's coverage is not complete.
    const chain = callTool(store, 'action_chain', { action_id: clickId });
    assert.equal(chain.coverage.complete, false);
    assert.deepEqual(chain.coverage.reasons, ["1 request(s) left this page in this action's window not attributed to any user action and with no known issuer (listed as unlinked)"]);
    const recent = callTool(store, 'recent_actions', {});
    assert.deepEqual(recent.actions.map(action => [action.action_id, action.coverage.complete]), [[rows.filter(entry => entry.kind === 'dom.action')[1].action_id, true], [clickId, false]]);
    // Idle view of the same rows (the collector wrote them a moment ago, so
    // loadStore still reports the episodes as pending).
    const idle = createStore({ records: store.records, spans: [], now: () => Date.now() + 1e6 });
    const first = callTool(idle, 'action_chain', { action_id: clickId });
    assert.equal(first.stops.find(stop => stop.stop === 'request')?.url, '/api/save');
    const second = callTool(idle, 'action_chain', { action_id: rows.filter(entry => entry.kind === 'dom.action')[1].action_id });
    assert.deepEqual([second.stopped_at, second.because], ['browser', SCOPED_ABSENCE.no_request]);
    // The third-party request came after the first click's attributed request, before the second click: the first
    // chain has a request so lists nothing; the second click's window starts at its own dispatch.
    assert.equal(first.unlinked, undefined);
    assert.deepEqual(second.unlinked.requests, []);
  } finally { cleanup(); }
});

test('coverage: a dropped batch → complete: false with the gap as the reason', async () => {
  const { runtime, rows } = capturePage();
  const size = 2;
  assert.ok(rows.length > 2 * size && rows.slice(size, 2 * size).every(entry => entry.kind !== 'capture.summary'));
  const { store, cleanup } = await deliver(rows, { skipBatch: 1, size });
  try {
    const coverage = store.coverageFor(runtime.session);
    assert.equal(coverage.complete, false);
    const lost = rows.slice(size, 2 * size).map(entry => entry.sequence);
    assert.ok(coverage.reasons.some(reason => reason === `sequence gaps: ${lost[0]}-${lost.at(-1)} (${lost.length} row(s) emitted but not received)`), coverage.reasons.join(' | '));
    const clickId = rows.find(entry => entry.kind === 'dom.action' && store.actionsById.has(entry.action_id))?.action_id;
    assert.ok(clickId, 'a click survived the dropped batch');
    const chain = callTool(store, 'action_chain', { action_id: clickId });
    assert.equal(chain.coverage.complete, false);
    assert.match(chain.summary, /\nCoverage incomplete for page s_[0-9a-f]+: .*sequence gaps/u);
  } finally { cleanup(); }
});

test('coverage: missing rows are reasons, never silence', () => {
  const none = pageCoverage('p', [{ kind: 'dom.action', action_id: 'x', capture_page_id: 'p', sequence: 1 }]);
  assert.equal(none.complete, false);
  assert.deepEqual(none.reasons, ['no coverage rows for this page (capture.page, capture.summary, capture.received): recorded before coverage existed, or none were delivered; delivery cannot be proven']);
  const pageOnly = pageCoverage('p', [{ kind: 'capture.page', capture_page_id: 'p', sequence: 1, wrappers: {} }]);
  assert.deepEqual(pageOnly.reasons.map(reason => reason.split(':')[0]), ['no capture.summary row', 'no capture.received row']);
  // The summary reports a sink drop and a capture limit; the tail after the summary is not covered.
  const tally = createReceivedTally();
  const base = { capture_page_id: 'p' };
  const page = { ...base, kind: 'capture.page', sequence: 1, wrappers: { fetch: true, xhr: true, eventsource: true, websocket: true, worker: false, beacon: false } };
  const limit = { ...base, kind: 'capture.limit', sequence: 2, feature: 'state_receipts' };
  const summary = { ...base, kind: 'capture.summary', sequence: 3, last_sequence: 3, emitted_by_kind: { 'capture.page': 1, 'capture.limit': 1, 'capture.summary': 1 }, stamps_emitted: 0,
    capture_limits: 1, capture_limit_features: ['state_receipts'], dropped: 2, malformed: 0, host_errors: 0 };
  const after = { ...base, kind: 'dom.action', sequence: 4 };
  tally.add([page, limit, summary, after]);
  const [received] = tally.rows({ runId: 'run-x', now: () => 1 });
  const coverage = pageCoverage('p', [page, limit, summary, after, received]);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.reasons, [
    '1 row(s) emitted after the last capture.summary (sequence > 3) are not covered by it',
    'capture.limit: 1 (state_receipts): part of the capture is off on this page',
    'the page sink dropped 2 row(s) after retries',
  ]);
  // A collector body that was not JSON: its rows are unaccounted for.
  tally.unparsed();
  assert.ok(pageCoverage('p', [page, limit, summary, after, tally.rows()[0]]).reasons.includes('collector could not parse 1 ingest body(ies); the rows in them are unaccounted for'));
});

test('compare_chains: two request-less actions that both stop at browser differ by reached (dom_mutation vs dispatch)', () => {
  const records = [click(1, 'm1'), row(2, { kind: 'dom.mutation', action_id: 'm1', count: 1 }), click(5, 'd1')];
  const store = createStore({ records, spans: [], now: () => 1e12 });
  const [left, right] = ['m1', 'd1'].map(id => callTool(store, 'action_chain', { action_id: id }));
  assert.deepEqual([left.reached, left.stopped_at, right.reached, right.stopped_at], ['dom_mutation', 'browser', 'dispatch', 'browser']);
  const result = callTool(store, 'compare_chains', { before_action_id: 'm1', after_action_id: 'd1' });
  assert.equal(result.path_changed, true);
  assert.deepEqual(result.outcome_delta.changed, ['reached']);
  assert.deepEqual(result.path_change_reasons, ['outcome']);
  assert.match(result.summary, /outcome reached "dom_mutation" → "dispatch"/u);
  const same = callTool(store, 'compare_chains', { before_action_id: 'd1', after_action_id: 'd1' });
  assert.equal(same.path_changed, false);
});

test('coverage: rows the collector counted but the store no longer holds → complete: false (truncated or malformed records.jsonl)', async () => {
  const { runtime, rows } = capturePage();
  for (const damage of ['remove', 'garble']) {
    const { store: before, dir, cleanup } = await deliver(rows);
    try {
      assert.equal(before.coverageFor(runtime.session).complete, true);
      const file = path.join(dir, 'records.jsonl');
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const index = lines.findIndex(line => JSON.parse(line).kind === 'network.request');
      if (damage === 'remove') lines.splice(index, 1); else lines[index] = lines[index].slice(0, 40);
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      const after = await loadStore({ dir });
      const coverage = after.coverageFor(runtime.session);
      assert.equal(coverage.complete, false, damage);
      assert.ok(coverage.reasons.includes('the store holds 1 network.request row(s) for this page; the collector received 2'), coverage.reasons.join(' | '));
      assert.ok(coverage.reasons.some(reason => /^the store holds \d+ distinct sequence\(s\) for this page; the collector received \d+$/u.test(reason)));
      const malformed = coverage.reasons.includes("the store's records.jsonl has 1 malformed line(s) that were not loaded; their page is unknown, so no page's delivery can be proven");
      assert.equal(malformed, damage === 'garble');
    } finally { cleanup(); }
  }
});
