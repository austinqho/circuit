// G5 D-G5-1: the dev-only browser → collector sink behind
// `producttrace({ collector })`, plus a real round trip into a store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { collectorSinkSource, normalizeCollectorOption } from '../integrations/collector-sink.mjs';
import { createCollector } from '../collector/index.js';
import { loadStore } from '../collector/store.mjs';

function fakeWindow({ fetchImpl, beacon = () => true } = {}) {
  const timers = [];
  const listeners = {};
  const posts = [];
  const window = {
    JSON, Math, Array, Object, String, Number, Boolean, Error, Promise,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    navigator: { sendBeacon: (url, body) => { posts.push({ url, body, beacon: true }); return beacon(url, body); } },
    fetch: (url, init) => { posts.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ ok: true }); },
  };
  window.globalThis = window;
  return { window, timers, listeners, posts, async runTimers() { while (timers.length) { const { fn } = timers.shift(); fn(); await new Promise(resolve => setImmediate(resolve)); } } };
}

test('collector option: loopback http(s) URL or root-relative path; remote only with allowRemote', () => {
  assert.deepEqual(normalizeCollectorOption('http://127.0.0.1:4102/'), { url: 'http://127.0.0.1:4102', allowRemote: false, force: false });
  assert.deepEqual(normalizeCollectorOption('/__tracer'), { url: '/__tracer', allowRemote: false, force: false });
  for (const local of ['http://localhost:4102', 'http://[::1]:4102', 'http://127.1.2.3:9', 'https://app.localhost']) assert.ok(normalizeCollectorOption(local));
  assert.equal(normalizeCollectorOption(undefined), null);
  for (const bad of ['ftp://x', 'javascript:alert(1)', '//evil.example', 'http://localhost/?q=1', '', 42, { url: 'http://localhost', extra: 1 }, { url: 'http://localhost', force: 'yes' }]) assert.throws(() => normalizeCollectorOption(bad));
  assert.throws(() => normalizeCollectorOption('https://collector.example.com'), /loopback/u);
  assert.throws(() => normalizeCollectorOption('http://10.0.0.5:4102'), /loopback/u);
  assert.deepEqual(normalizeCollectorOption({ url: 'https://collector.example.com', allowRemote: true }), { url: 'https://collector.example.com', allowRemote: true, force: false });
  assert.equal(collectorSinkSource(undefined), '');
});

test('sink chains the host hook, batches rows with the page session, and posts with the pre-wrap fetch', async () => {
  const env = fakeWindow();
  const hostSeen = [];
  env.window.__producttraceHostCapture = text => hostSeen.push(text);
  vm.runInNewContext(collectorSinkSource('http://127.0.0.1:4102'), env.window);
  // The runtime installs after the sink and wraps fetch; the sink must keep the native one.
  const nativeFetch = env.window.fetch;
  env.window.fetch = () => { throw new Error('wrapped fetch must not be used by the sink'); };
  env.window.__productTraceRuntime = { session: 's_abcd1234' };
  for (let sequence = 1; sequence <= 3; sequence += 1) env.window.__producttraceHostCapture(JSON.stringify({ channel: 'runtime-attribution', row: { kind: 'dom.action', sequence } }));
  env.window.__producttraceHostCapture(JSON.stringify({ channel: 'element-stamp', row: { kind: 'element.stamp', stamp_sequence: 1, session: 's_abcd1234' } }));
  env.window.__producttraceHostCapture('not json');
  env.window.__producttraceHostCapture('42');
  assert.equal(hostSeen.length, 6, 'the existing hook still sees every row, including the malformed ones');
  await env.runTimers();
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].url, 'http://127.0.0.1:4102/ingest');
  assert.equal(env.posts[0].init.headers['content-type'], 'text/plain');
  const rows = JSON.parse(env.posts[0].init.body);
  // Malformed payloads are not silent: each becomes a capture.dropped row (length only, no content).
  assert.deepEqual(rows.map(row => [row.kind, row.sequence ?? row.stamp_sequence ?? row.reason, row.capture_page_id]), [
    ['dom.action', 1, 's_abcd1234'], ['dom.action', 2, 's_abcd1234'], ['dom.action', 3, 's_abcd1234'], ['element.stamp', 1, 's_abcd1234'],
    ['capture.dropped', 'malformed_host_payload', 's_abcd1234'], ['capture.dropped', 'malformed_host_payload', 's_abcd1234']]);
  assert.equal(rows[4].length, 8); assert.equal(JSON.stringify(rows[4]).includes('not json'), false);
  const stats = env.window.__productTraceCollectorStats();
  assert.equal(stats.received, 4); assert.equal(stats.malformed, 2);
  assert.equal(stats.sent, 6); assert.equal(stats.dropped, 0); assert.equal(stats.queued, 0);
  const { createStore } = await import('../collector/store.mjs');
  assert.equal(createStore({ records: rows, spans: [], now: () => 1 }).stats().malformed_records, 2);
  assert.equal(typeof nativeFetch, 'function');
});

test('sink retries, then counts drops; pagehide flushes the tail by beacon', async () => {
  let calls = 0;
  const env = fakeWindow({ fetchImpl: () => { calls += 1; return Promise.resolve({ ok: false }); } });
  vm.runInNewContext(collectorSinkSource('/__tracer'), env.window);
  env.window.__producttraceHostCapture(JSON.stringify({ row: { kind: 'dom.action', sequence: 1 } }));
  await env.runTimers();
  assert.equal(calls, 5, 'one attempt plus four retries');
  assert.equal(env.window.__productTraceCollectorStats().dropped, 1);
  env.window.__producttraceHostCapture(JSON.stringify({ row: { kind: 'dom.action', sequence: 2 } }));
  env.listeners.pagehide[0]();
  const beacon = env.posts.find(post => post.beacon);
  assert.equal(beacon.url, '/__tracer/ingest');
  assert.equal(JSON.parse(beacon.body)[0].sequence, 2);
  assert.equal(env.window.__productTraceCollectorStats().beacon, 1);
});

test('round trip: sink → producttrace-collector --store → loadStore', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-sink-'));
  const collector = createCollector({ port: 0, store: { dir, manifest: { functions: [] }, label: 'sink-test' } });
  await collector.ready;
  const env = fakeWindow({ fetchImpl: (url, init) => fetch(url, init) });
  vm.runInNewContext(collectorSinkSource(collector.url), env.window);
  env.window.__productTraceRuntime = { session: 's_feedbeef' };
  env.window.__producttraceHostCapture(JSON.stringify({ row: { schema: 'producttrace.runtime-evidence.v1', kind: 'dom.action', sequence: 1, timestamp: 1, action_id: 'action:x:1', event: 'click', target: { tag: 'button', attributes: {}, element_key: 'p_aaaaaaaaaaaa:1-2#n1' } } }));
  await env.runTimers();
  for (let wait = 0; wait < 50 && env.window.__productTraceCollectorStats().sent < 1; wait += 1) await new Promise(resolve => setTimeout(resolve, 20));
  const info = await fetch(`${collector.url}/run-info`, { method: 'POST', body: JSON.stringify({ source: { commit: 'abc123', status_clean: true }, steps: [{ step: 1, name: 'rename', started: 1, ended: 2, status: 'done' }] }) });
  assert.equal(info.status, 200);
  assert.equal((await fetch(`${collector.url}/run-info`, { method: 'POST', body: JSON.stringify({ bogus: 1 }) })).status, 400);
  await collector.close();
  const store = await loadStore({ dir });
  assert.equal(store.actionRows.length, 1);
  assert.equal(store.actionRows[0].capture_page_id, 's_feedbeef');
  assert.equal(store.actionRows[0].tracer_run, store.runs[0].run_id);
  assert.deepEqual(store.runs[0].source, { commit: 'abc123', status_clean: true });
  assert.equal(store.runs[0].steps[0].name, 'rename');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Vite plugin: `collector` installs the sink before the runtime; its posts are never network.request rows', async () => {
  const { productTraceVitePlugin } = await import('../integrations/vite.mjs');
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-collector-option-'));
  try {
    fs.mkdirSync(path.join(repository, 'src'));
    fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"fixture","private":true}');
    fs.writeFileSync(path.join(repository, 'src/App.jsx'), 'export function App() { return <button onClick={() => fetch("/api/x", { method: "POST" })}>Go</button>; }\n');
    assert.throws(() => productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: 'ftp://x' }), /collector/u);
    const without = productTraceVitePlugin({ repository, service: 'web', requestBridge: false }).transformIndexHtml().tags[0].children;
    assert.equal(without.includes('installProductTraceCollectorSink'), false, 'no option, no sink');
    const inline = productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: 'http://127.0.0.1:4102' }).transformIndexHtml().tags[0].children;
    assert.ok(inline.indexOf('installProductTraceCollectorSink') < inline.indexOf('installProductTraceRuntimeAttribution'));
    const fetchCalls = [];
    const timers = [];
    const context = vm.createContext({ Headers, crypto: globalThis.crypto, console, queueMicrotask, clearTimeout,
      setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
      fetch: async (input, init) => { fetchCalls.push({ url: String(input), body: init?.body }); return { ok: true, status: 204 }; },
      document: { addEventListener() {}, documentElement: null, activeElement: null } });
    vm.runInContext(inline, context);
    vm.runInContext('fetch("/api/app", { method: "POST" })', context);
    while (timers.length) { timers.shift()(); await new Promise(resolve => setImmediate(resolve)); }
    const runtime = context.__productTraceRuntime;
    const requests = runtime.records.filter(row => row.kind === 'network.request').map(row => row.url);
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), ['/api/app']);
    const ingest = fetchCalls.filter(call => call.url === 'http://127.0.0.1:4102/ingest');
    assert.equal(ingest.length, 1);
    const shipped = JSON.parse(ingest[0].body);
    assert.equal(shipped.length, runtime.records.length);
    assert.ok(shipped.every(row => row.capture_page_id === runtime.session));
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

test('Vite plugin: no sink in a production-mode build unless collector.force', async () => {
  const { productTraceVitePlugin } = await import('../integrations/vite.mjs');
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-collector-mode-'));
  try {
    fs.mkdirSync(path.join(repository, 'src'));
    fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"fixture","private":true}');
    fs.writeFileSync(path.join(repository, 'src/App.jsx'), 'export function App() { return <button>Go</button>; }\n');
    const warnings = [];
    const logger = { warn: message => warnings.push(message) };
    const inline = plugin => plugin.transformIndexHtml().tags[0].children;
    const dev = productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: 'http://127.0.0.1:4102' });
    dev.configResolved({ mode: 'development', logger });
    assert.ok(inline(dev).includes('installProductTraceCollectorSink'));
    const prod = productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: 'http://127.0.0.1:4102' });
    prod.configResolved({ mode: 'production', logger });
    assert.equal(inline(prod).includes('installProductTraceCollectorSink'), false);
    assert.match(warnings.join('\n'), /collector sink disabled/u);
    assert.equal(prod.api.collector().active, false);
    const forced = productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: { url: 'http://127.0.0.1:4102', force: true } });
    forced.configResolved({ mode: 'production', logger });
    assert.ok(inline(forced).includes('installProductTraceCollectorSink'));
    assert.throws(() => productTraceVitePlugin({ repository, service: 'web', requestBridge: false, collector: 'https://collector.example.com' }), /loopback/u);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

test('bodies option: only true, false or "always"; a lost network.body row makes page coverage incomplete', async () => {
  const { productTraceVitePlugin } = await import('../integrations/vite.mjs');
  const { createReceivedTally, pageCoverage } = await import('../collector/coverage.mjs');
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-bodies-option-'));
  try {
    fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"fixture","private":true}');
    for (const bad of ['on', 'dev', 1]) assert.throws(() => productTraceVitePlugin({ repository, service: 'web', requestBridge: false, bodies: bad }), /bodies must be/u);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
  const page = 's_1'; const base = { schema: 'producttrace.runtime-evidence.v1', capture_page_id: page };
  const rows = [{ ...base, kind: 'capture.page', sequence: 1, bodies: 'on', wrappers: {} },
    { ...base, kind: 'network.body', body_sequence: 1, request_occurrence_id: 'a:request:1', direction: 'request' },
    { ...base, kind: 'network.body', body_sequence: 3, request_occurrence_id: 'a:request:1', direction: 'response' },
    { ...base, kind: 'capture.summary', sequence: 2, emitted_by_kind: { 'capture.page': 1, 'capture.summary': 1 }, last_sequence: 2, stamps_emitted: 0, bodies_emitted: 3, body_truncations: 0, capture_limits: 0, host_errors: 0, dropped: 0, malformed: 0 }];
  const tally = createReceivedTally(); tally.add(rows);
  const coverage = pageCoverage(page, [...rows, ...tally.rows()]);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.bodies, 'on');
  assert.ok(coverage.reasons.includes('network.body gaps: 2 (1 body row(s) missing)'), coverage.reasons.join('; '));
  assert.ok(coverage.reasons.includes('emitted 3 network.body row(s), received 2'), coverage.reasons.join('; '));
  // A body read still in flight at the summary keeps the page incomplete.
  const pending = rows.filter(row => row.body_sequence !== 3).map(row => (row.kind === 'capture.summary' ? { ...row, bodies_emitted: 1, bodies_pending: 1 } : row));
  const pendingTally = createReceivedTally(); pendingTally.add(pending);
  const pendingCoverage = pageCoverage(page, [...pending, ...pendingTally.rows()]);
  assert.deepEqual(pendingCoverage.reasons, ['1 body read(s) still in flight at the last capture.summary: their network.body rows were not recorded']);
});
