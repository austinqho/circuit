// `node --import producttrace/backend/register <entry>` is the one default
// backend entrypoint. It must give a "type": "module" Express + MongoDB app the
// same server -> route -> handler -> database chain a CommonJS app gets, with
// no loader flag added by hand.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
// PRODUCTTRACE_TEST_MONGO_HOST: e.g. host.docker.internal when this runs in a container on another Node.
const MONGO_HOST = process.env.PRODUCTTRACE_TEST_MONGO_HOST || '127.0.0.1';
const MONGO_PORT = 27017; // producttrace-librechat-mongo
const DATABASE = 'producttrace_test_esm';
const TRACE_ID = '12345678901234567890123456789012';
const CALLER_SPAN = '1234567890123456';

function mongoReachable() {
  return new Promise(resolve => {
    const socket = net.connect(MONGO_PORT, MONGO_HOST);
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function driverResolvable(app) {
  try { createRequire(new URL(`fixtures/backend/${app}/server.js`, import.meta.url)).resolve('mongodb'); return true; } catch { return false; }
}

async function skipReason(app) {
  if (!driverResolvable(app)) return 'mongodb driver not installed (devDependency `mongodb`; run npm install)';
  if (!(await mongoReachable())) return `Mongo unreachable at ${MONGO_HOST}:${MONGO_PORT} (start the producttrace-librechat-mongo container)`;
  return null;
}

function startCollector() {
  const spans = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/spans') spans.push(...[JSON.parse(body)].flat());
      response.end('ok');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    spans, endpoint: `http://127.0.0.1:${server.address().port}/spans`, close: () => new Promise(done => server.close(done)),
  })));
}

// Runs one fixture app under the default entrypoint, sends one request that
// carries a W3C traceparent, and returns the span records the collector got.
async function runApp(app, { preImports = [], entry = `test/fixtures/backend/${app}/server.js`, env = {}, requests = [{ path: '/api/items/item-1', traceId: TRACE_ID }], spanCount = 0 } = {}) {
  const collector = await startCollector();
  // cwd is the package root, so `producttrace/...` resolves through this
  // package's own "exports" exactly as it does from an installed node_modules.
  const child = spawn(process.execPath, [...preImports.flatMap(value => ['--import', value]),
    '--import', 'producttrace/backend/register', entry], {
    cwd: root,
    env: {
      ...env,
      PATH: process.env.PATH, HOME: process.env.HOME,
      MONGO_URL: `mongodb://${MONGO_HOST}:${MONGO_PORT}`, MONGO_DB: DATABASE,
      PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: collector.endpoint,
      PRODUCTTRACE_SERVICE_NAME: `fixture-${app}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${app} did not start:\n${output}`)), 20_000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = /listening (\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`${app} exited ${code}:\n${output}`)); });
    });
    for (const { path, traceId } of requests) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { traceparent: `00-${traceId}-${CALLER_SPAN}-01` },
      });
      assert.equal(response.status, 200, output);
      assert.deepEqual(await response.json(), { _id: 'item-1', title: 'first' });
    }
    const traceIds = new Set(requests.map(request => request.traceId));
    const deadline = Date.now() + 5_000;
    const arrived = () => collector.spans.filter(span => traceIds.has(span.trace_id));
    while ((!arrived().some(span => span.kind === 'server') || arrived().length < spanCount) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  } finally {
    child.kill('SIGTERM'); // the app drops producttrace_test_esm on SIGTERM
    await exited;
    await collector.close();
  }
  const traceIds = new Set(requests.map(request => request.traceId));
  return { spans: collector.spans.filter(span => traceIds.has(span.trace_id)), all: collector.spans, output };
}

function assertFullChain(spans, app) {
  const dump = JSON.stringify(spans.map(({ name, span_id, parent_span_id, instrumentation }) =>
    ({ name, span_id, parent_span_id, by: instrumentation?.name })), null, 2);
  const server = spans.find(span => span.kind === 'server');
  assert.ok(server, `no server span\n${dump}`);
  assert.equal(server.parent_span_id, CALLER_SPAN);
  assert.equal(server.service_name, `fixture-${app}`);
  assert.equal(server.attributes['http.route'], '/api/items/:id');
  const route = spans.find(span => span.instrumentation?.name === '@opentelemetry/instrumentation-express'
    && span.attributes['http.route'] === '/api/items/:id');
  assert.ok(route, `no express route span\n${dump}`);
  assert.equal(route.parent_span_id, server.span_id, dump);
  const handler = spans.find(span => span.instrumentation?.name === 'producttrace-express-handlers');
  assert.ok(handler, `no express handler span\n${dump}`);
  assert.equal(handler.attributes['producttrace.express.handler.name'], 'getItem');
  assert.equal(handler.attributes['http.route'], '/api/items/:id');
  assert.equal(handler.parent_span_id, route.span_id, dump);
  const isMongo = span => span.attributes['db.system'] === 'mongodb' || span.attributes['db.system.name'] === 'mongodb';
  const database = spans.find(span => isMongo(span) && span.attributes['db.mongodb.collection'] === 'items');
  assert.ok(database, `no mongodb span\n${dump}`);
  assert.equal(database.parent_span_id, handler.span_id, dump);
  assert.equal(database.attributes['db.mongodb.collection'], 'items');
  assert.ok(!('db.statement' in database.attributes), 'statement text stays opt-in');
  assert.ok(!('producttrace.capture_limit.feature' in server.attributes));
  // Tripwire (fix/middleware-reads): the app-level middleware has its own
  // named span (official Express instrumentation) with its database read under
  // it. An instrumentation upgrade that loses middleware spans would degrade
  // every such read to `issuer: unknown`; this fails instead.
  const middleware = spans.find(span => span.attributes['express.type'] === 'middleware' && span.attributes['express.name'] === 'authenticate');
  assert.ok(middleware, `no middleware span for authenticate\n${dump}`);
  assert.equal(middleware.parent_span_id, server.span_id, dump);
  const read = spans.find(span => isMongo(span) && span.attributes['db.mongodb.collection'] === 'users');
  assert.ok(read, `no mongodb span for the middleware read\n${dump}`);
  assert.equal(read.parent_span_id, middleware.span_id, dump);
}

// Express 4 (devDependency alias `express4` = npm:express@4). The
// instrumentations recognise the module by its directory name, so the fixture
// runs from a scratch directory holding a copy of the package as
// `node_modules/express`; its own dependencies resolve through NODE_PATH.
// PRODUCTTRACE_TEST_EXPRESS4_DIR points at another Express 4 package dir.
function express4Dir() {
  if (process.env.PRODUCTTRACE_TEST_EXPRESS4_DIR) return process.env.PRODUCTTRACE_TEST_EXPRESS4_DIR;
  try { return path.dirname(createRequire(new URL('../package.json', import.meta.url)).resolve('express4/package.json')); } catch { return null; }
}
function express4Scratch(dir) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-express4-'));
  fs.cpSync(fs.realpathSync(dir), path.join(scratch, 'node_modules/express'), { recursive: true, dereference: true });
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'producttrace-fixture-express4', private: true, type: 'commonjs' }));
  fs.copyFileSync(new URL('fixtures/backend/cjs-app/server.js', import.meta.url), path.join(scratch, 'server.js'));
  return scratch;
}

for (const app of ['esm-app', 'cjs-app']) {
  test(`${app}: --import producttrace/backend/register yields server -> route -> handler -> mongodb`, async t => {
    const reason = await skipReason(app);
    if (reason) return t.skip(reason);
    const { spans, output } = await runApp(app);
    assert.match(output, /esm hook: module\.register/);
    assertFullChain(spans, app);
  });
}

test('express 4 (cjs): server -> route -> handler -> mongodb, and the app-level middleware span with its read under it', async t => {
  const reason = await skipReason('cjs-app');
  if (reason) return t.skip(reason);
  const dir = express4Dir();
  if (!dir) return t.skip('devDependency `express4` (npm:express@4) not installed; run npm install');
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  assert.match(version, /^4\./u, `${dir} is express ${version}`);
  const scratch = express4Scratch(dir);
  try {
    const nodePath = [path.dirname(fs.realpathSync(dir)), path.join(root, 'node_modules')].join(path.delimiter);
    const { spans, output } = await runApp('cjs-app', { entry: path.join(scratch, 'server.js'), env: { NODE_PATH: nodePath } });
    assertFullChain(spans, 'cjs-app');
    assert.ok(spans.some(span => span.attributes['express.type'] === 'middleware' && span.attributes['express.name'] === 'expressInit'), output);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('without module.register: one warning naming --experimental-loader, and server spans carry the capture limit', async t => {
  const reason = await skipReason('esm-app');
  if (reason) return t.skip(reason);
  const removeRegister = 'data:text/javascript,import m from "node:module"; m.register = undefined; m.syncBuiltinESMExports();';
  const { spans, output } = await runApp('esm-app', { preImports: [removeRegister] });
  const warnings = output.split('\n').filter(line => line.includes('--experimental-loader'));
  assert.equal(warnings.length, 1, output);
  assert.match(warnings[0], /module\.register is unavailable/);
  const server = spans.find(span => span.kind === 'server');
  assert.ok(server, output);
  assert.equal(server.attributes['producttrace.capture_limit.feature'], 'esm_instrumentation');
  assert.match(server.attributes['producttrace.capture_limit.reason'], /module\.register is unavailable/);
  // The defect this entrypoint exists to prevent: an ESM app without the hook
  // has no route or handler spans.
  assert.ok(!spans.some(span => span.instrumentation?.name === 'producttrace-express-handlers'));
});

// Server-to-server: a handler that calls its own server with the global fetch
// (undici) or http.get. The outbound call is a client span under the handler,
// it carries the traceparent, and the receiving server span is its child in
// the same trace, with its own route -> handler -> mongodb chain.
const RELAY_TRACES = { fetch: 'abcdefabcdefabcdefabcdefabcdef01', http: 'abcdefabcdefabcdefabcdefabcdef02' };
function assertRelayChain(spans, client, app) {
  const traceId = RELAY_TRACES[client];
  const trace = spans.filter(span => span.trace_id === traceId);
  const dump = JSON.stringify(trace.map(({ name, kind, span_id, parent_span_id, instrumentation }) =>
    ({ name, kind, span_id, parent_span_id, by: instrumentation?.name })), null, 2);
  const byId = new Map(trace.map(span => [span.span_id, span]));
  const servers = trace.filter(span => span.kind === 'server');
  assert.equal(servers.length, 2, `${client}: two server spans in one trace\n${dump}`);
  const outer = servers.find(span => span.parent_span_id === CALLER_SPAN);
  assert.ok(outer, dump);
  assert.equal(outer.attributes['http.route'], '/api/items/:id/relay/:client');
  const relay = trace.find(span => span.attributes['producttrace.express.handler.name'] === 'relayItem');
  assert.ok(relay, dump);
  const scope = client === 'fetch' ? '@opentelemetry/instrumentation-undici' : '@opentelemetry/instrumentation-http';
  const outbound = trace.filter(span => span.kind === 'client' && span.instrumentation?.name === scope);
  assert.equal(outbound.length, 1, `${client}: one outbound client span from ${scope}\n${dump}`);
  // The outbound span descends from the handler that issued it.
  let parent = outbound[0].parent_span_id; const seen = [];
  while (parent && parent !== relay.span_id) { seen.push(parent); parent = byId.get(parent)?.parent_span_id; }
  assert.equal(parent, relay.span_id, `${client}: outbound span is under relayItem\n${dump}`);
  const inner = servers.find(span => span !== outer);
  assert.equal(inner.parent_span_id, outbound[0].span_id, `${client}: receiving server span is the outbound span's child\n${dump}`);
  assert.equal(inner.attributes['http.route'], '/api/items/:id');
  const getItem = trace.find(span => span.attributes['producttrace.express.handler.name'] === 'getItem');
  assert.ok(getItem, dump);
  const database = trace.find(span => span.attributes['db.mongodb.collection'] === 'items' && span.parent_span_id === getItem.span_id);
  assert.ok(database, `${client}: mongodb find under the receiving handler\n${dump}`);
  // No span of Tracer's own delivery requests (they run with tracing suppressed).
  assert.ok(!trace.some(span => span.kind === 'client' && /\/spans$/u.test(String(span.attributes['url.full'] ?? span.attributes['http.url'] ?? ''))), dump);
  assert.ok(!('producttrace.capture_limit.feature' in outer.attributes), app);
}

for (const app of ['esm-app', 'cjs-app']) {
  test(`${app}: an outbound fetch and http.get from a handler join the trace; the receiving server span is their child`, async t => {
    const reason = await skipReason(app);
    if (reason) return t.skip(reason);
    const { spans, all, output } = await runApp(app, { spanCount: 16, requests: [
      { path: '/api/items/item-1/relay/fetch', traceId: RELAY_TRACES.fetch },
      { path: '/api/items/item-1/relay/http', traceId: RELAY_TRACES.http },
    ] });
    assert.match(output, /outbound: http\+fetch/);
    assertRelayChain(spans, 'fetch', app);
    assertRelayChain(spans, 'http', app);
    // Nothing shipped is a client span of the span delivery itself, in any trace.
    assert.ok(!all.some(span => span.kind === 'client' && /\/spans$/u.test(String(span.attributes['url.full'] ?? span.attributes['http.url'] ?? ''))));
  });
}

test('on a Node without reliable undici diagnostics channels: one warning, capture limit outbound_fetch, and a fetch hop starts a new trace', async t => {
  const reason = await skipReason('cjs-app');
  if (reason) return t.skip(reason);
  const oldNode = 'data:text/javascript,Object.defineProperty(process, "versions", { value: { ...process.versions, node: "20.5.1" } });';
  const { spans, all, output } = await runApp('cjs-app', { preImports: [oldNode], spanCount: 4, requests: [
    { path: '/api/items/item-1/relay/fetch', traceId: RELAY_TRACES.fetch },
  ] });
  const warnings = output.split('\n').filter(line => line.includes('global fetch are not instrumented'));
  assert.equal(warnings.length, 1, output);
  assert.match(warnings[0], /needs Node >= 20\.6 or 18\.19; this is Node v20\.5\.1/);
  const outer = spans.find(span => span.kind === 'server' && span.parent_span_id === CALLER_SPAN);
  assert.ok(outer, output);
  assert.equal(outer.attributes['producttrace.capture_limit.feature'], 'outbound_fetch');
  assert.match(outer.attributes['producttrace.capture_limit.reason'], /undici/);
  // The defect the adapter prevents: no outbound span, and the receiving
  // server span is a new root in another trace.
  assert.ok(!spans.some(span => span.kind === 'client' && span.instrumentation?.name === '@opentelemetry/instrumentation-undici'));
  assert.equal(spans.filter(span => span.kind === 'server').length, 1);
  assert.ok(all.some(span => span.kind === 'server' && span.trace_id !== RELAY_TRACES.fetch && span.parent_span_id == null
    && span.attributes['http.route'] === '/api/items/:id'));
});

// App-set trace header: Tracer leaves the app's `traceparent` untouched (one
// value on the wire, the app's), marks the outbound span, and the receiving
// server continues the app's trace (so it parsed exactly the app's value).
const APP_TRACE = 'feedfacefeedfacefeedfacefeedface';
const APP_SPAN = 'beadbeadbeadbead';
const APP_TRACES = { fetch: 'abcdefabcdefabcdefabcdefabcdef03', http: 'abcdefabcdefabcdefabcdefabcdef04' };
for (const app of ['esm-app', 'cjs-app']) {
  test(`${app}: an app-set traceparent is left as the app set it (fetch and http.get); the outbound span says so`, async t => {
    const reason = await skipReason(app);
    if (reason) return t.skip(reason);
    const value = `00-${APP_TRACE}-${APP_SPAN}-01`;
    const { all } = await runApp(app, { spanCount: 8, requests: ['fetch', 'http'].map(client => ({ path: `/api/items/item-1/relay/${client}?traceparent=${value}`, traceId: APP_TRACES[client] })) });
    for (const client of ['fetch', 'http']) {
      const scope = client === 'fetch' ? '@opentelemetry/instrumentation-undici' : '@opentelemetry/instrumentation-http';
      const outbound = all.filter(span => span.trace_id === APP_TRACES[client] && span.kind === 'client' && span.instrumentation?.name === scope);
      assert.equal(outbound.length, 1, client);
      assert.equal(outbound[0].attributes['producttrace.outbound.traceparent_set_by_app'], true, client);
      assert.equal(outbound[0].attributes['producttrace.outbound.app_traceparent'], value, client);
      assert.ok(!all.some(span => span.kind === 'server' && span.parent_span_id === outbound[0].span_id), `${client}: nothing continues Tracer's span id`);
    }
    // Both receiving server spans continue the app's trace: each parsed exactly one, the app's, traceparent.
    const received = all.filter(span => span.kind === 'server' && span.trace_id === APP_TRACE && span.parent_span_id === APP_SPAN);
    assert.equal(received.length, 2, JSON.stringify(all.filter(span => span.kind === 'server').map(span => [span.trace_id, span.parent_span_id])));
  });
}

// Proxy pattern: a handler forwards the traceparent its server span received.
// That value is a pass-through, not the app's context: Tracer injects its own
// client span's value (one header), marks the span, and exactly one server
// span (the proxy) claims the caller's span; the downstream is a normal hop.
const FORWARD_TRACES = { fetch: 'abcdefabcdefabcdefabcdefabcdef05', http: 'abcdefabcdefabcdefabcdefabcdef06' };
for (const app of ['esm-app', 'cjs-app']) {
  test(`${app}: a forwarded incoming traceparent is a pass-through (fetch and http.get): Tracer's value, one claimant of the caller`, async t => {
    const reason = await skipReason(app);
    if (reason) return t.skip(reason);
    const { spans } = await runApp(app, { spanCount: 16, requests: ['fetch', 'http'].map(client => ({ path: `/api/items/item-1/relay/${client}?forward=1`, traceId: FORWARD_TRACES[client] })) });
    for (const client of ['fetch', 'http']) {
      const trace = spans.filter(span => span.trace_id === FORWARD_TRACES[client]);
      const scope = client === 'fetch' ? '@opentelemetry/instrumentation-undici' : '@opentelemetry/instrumentation-http';
      const outbound = trace.filter(span => span.kind === 'client' && span.instrumentation?.name === scope);
      assert.equal(outbound.length, 1, client);
      assert.equal(outbound[0].attributes['producttrace.outbound.traceparent_forwarded'], true, client);
      assert.ok(!('producttrace.outbound.traceparent_set_by_app' in outbound[0].attributes), client);
      assert.equal(trace.filter(span => span.kind === 'server' && span.parent_span_id === CALLER_SPAN).length, 1, `${client}: one server span claims the caller`);
      const inner = trace.filter(span => span.kind === 'server' && span.parent_span_id === outbound[0].span_id);
      assert.equal(inner.length, 1, `${client}: the downstream continues Tracer's client span`);
      assert.equal(inner[0].attributes['http.route'], '/api/items/:id');
    }
  });
}
