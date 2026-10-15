import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createBrowserRequestBridgeSource } from '../analysis/browser-request-bridge.mjs';

function harness() {
  const reports = [];
  let record;
  let click;
  const timers = [];
  const sandbox = {
    document: { addEventListener(_type, listener) { click = listener; } },
    setTimeout(callback) { timers.push(callback); },
    crypto: webcrypto, Headers, Uint8Array, console: { info() {}, error() {} },
    fetch: async (url, init) => {
      if (url === '/evidence') reports.push(JSON.parse(init.body));
      return { json: async () => ({}) };
    },
    XMLHttpRequest: class { open() {} setRequestHeader() {} send() {} },
    ProductTrace: { start(_bindings, options) { record = options.onRecord; } },
  };
  sandbox.window = sandbox;
  const request = { action: 'click', contract_application_id: 'contract', method: 'GET' };
  vm.runInNewContext(createBrowserRequestBridgeSource({ bindings: [], request_bridge: {
    schema: 'producttrace.browser-request-bridge-manifest.v1', map_fingerprint: 'map',
    actions: [{ action: 'click', requests: [request] }],
  } }, { bridgeEndpoint: '/evidence', service: 'test' }), sandbox);
  record({ kind: 'action', action: 'click', seq: 1, session: 'session' });
  sandbox.__PRODUCTTRACE_ACTION_STAMP__ = 1;
  return { sandbox, reports, timers, click: () => click({ isTrusted: true, target: { closest: () => ({ getAttribute: () => 'Untaught control' }) } }), bridge: sandbox.__productTraceRequestBridge,
    metadata: { requests: [request] } };
}

test('pending callbacks and transports cannot lend provenance to background requests', async () => {
  const { sandbox, reports, bridge, metadata } = harness();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  bridge.begin({ action: 'click' }, () => bridge.request(metadata, () => pending));
  await sandbox.fetch('/background');
  bridge.request(metadata, () => sandbox.fetch('/deferred'));
  assert.equal(reports.length, 0);
  finish();
});

test('two synchronous source requests retain distinct occurrence and trace identities', () => {
  const { sandbox, reports, bridge, metadata } = harness();
  bridge.begin({ action: 'click' }, () => {
    bridge.request(metadata, () => sandbox.fetch('/first'));
    bridge.request(metadata, () => sandbox.fetch('/second'));
  });
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map(report => report.request.url), ['/first', '/second']);
  assert.notEqual(reports[0].request.request_occurrence_id, reports[1].request.request_occurrence_id);
  assert.notEqual(reports[0].request.trace_context.trace_id, reports[1].request.trace_context.trace_id);
});

test('an asynchronous interceptor keeps only its configured request occurrence', async () => {
  const { sandbox, reports, bridge, metadata } = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const result = bridge.begin({ action: 'click' }, () => bridge.request(metadata, async () => {
    const config = bridge.configureRequest({ headers: { authorization: 'test' } });
    await gate;
    return sandbox.fetch('/owned', config);
  }));
  await sandbox.fetch('/unrelated');
  assert.equal(reports.length, 0);
  release();
  await result;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].request.url, '/owned');
});


test('unsupported trusted clicks produce frontiers while an entered path does not', () => {
  const first = harness();
  first.click();
  first.timers.shift()();
  assert.equal(first.reports[0].frontier.reason, 'no_verified_control_to_request_path');
  const mapped = harness();
  mapped.click();
  mapped.bridge.begin({ action: 'click' }, () => {});
  mapped.timers.shift()();
  assert.equal(mapped.reports.length, 0);
});
