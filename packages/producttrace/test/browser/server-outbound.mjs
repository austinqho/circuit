// Server-to-server hops (headless, neutral fixture test/browser/fixtures/server-outbound-app).
//
// Claim: a server-to-server request made while handling a traced request is a
// child of that trace, and its receiving side joins it, so a chain follows
// every hop or states where it lost one.
//
// A wouter page (route change by <Link>, then button handlers) calls a
// CommonJS Express + MongoDB backend started with the one default entrypoint
// `node --import producttrace/backend/register server.js`; its handlers call
// (a) their own server with the global fetch, (b) a second Express process
// (also under the entrypoint) with http.request, which calls back into the
// first (nested hop), (c) a host that answers but is not instrumented and a
// closed port (frontiers), (d) two routes in parallel (fetch + axios' Node
// http adapter), (e) themselves recursively five times (depth cap). Plus the
// plain case (one read, no outbound call).
//
// Every expectation is recomputed here from the raw rows (records.jsonl,
// spans.jsonl: trace ids and parent span ids); no package code computes one.
// The MCP server is driven over stdio as a black box. `--runs N` (default 3)
// repeats the session with a fresh store, fresh processes and a fresh
// database, and compares a normalized signature across runs. `--control`
// adds one run with the fetch adapter off (PRODUCTTRACE_BACKEND_ADAPTERS
// without undici): the defect this claim fixes.
//
//   node test/browser/server-outbound.mjs [dependencyRoot] [--runs 3] [--control] [--out <dir>]
//
// Mongo: 127.0.0.1:27017, database producttrace_test_outbound (dropped by the
// backend on SIGTERM and checked afterwards). Skips with a message when Mongo
// is down.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';

const argv = process.argv.slice(2);
const flag = name => { const index = argv.indexOf(name); if (index < 0) return null; const value = argv[index + 1]; argv.splice(index, 2); return value; };
const RUNS = Number(flag('--runs') || 3);
const OUT = flag('--out');
const CONTROL = argv.includes('--control'); if (CONTROL) argv.splice(argv.indexOf('--control'), 1);
const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(argv[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/server-outbound-app');
const MONGO = { host: '127.0.0.1', port: 27017 };
const DATABASE = 'producttrace_test_outbound';

const reachable = (port, host = '127.0.0.1') => new Promise(resolve => {
  const socket = net.connect(port, host); socket.setTimeout(1500);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});
if (!(await reachable(MONGO.port, MONGO.host))) {
  console.log(`SKIP server-outbound: Mongo unreachable at ${MONGO.host}:${MONGO.port} (start the producttrace-librechat-mongo container: docker start producttrace-librechat-mongo)`);
  process.exit(0);
}

// ---- frontend build (once), shipping to one collector port reused by every run
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
async function closedPort() { const server = net.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }
const collectorPort = await closedPort();
const tracerModules = fs.realpathSync(path.join(tracerRoot, 'node_modules'));
const wouterEntry = path.join(tracerModules, 'wouter', JSON.parse(fs.readFileSync(path.join(tracerModules, 'wouter/package.json'), 'utf8')).exports['.'].default);
const fixture = await buildReactFixture({ dependencyRoot, name: 'server-outbound', appSource: fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8'),
  resolve: { alias: [{ find: /^wouter$/u, replacement: wouterEntry }], dedupe: ['react', 'react-dom'] },
  pluginOptions: { collector: { url: `http://127.0.0.1:${collectorPort}`, force: true } } });
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');
let axiosModule = null;
try { axiosModule = createRequire(path.join(dependencyRoot, 'package.json')).resolve('axios'); } catch { axiosModule = null; }

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });

// ---- processes --------------------------------------------------------------
function startNode(script, env, label) {
  const child = spawn(process.execPath, ['--import', 'producttrace/backend/register', script], {
    cwd: tracerRoot, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const port = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not start:\n${output}`)), 20_000);
    const poll = setInterval(() => { const match = /listening (\d+)/u.exec(output); if (match) { clearInterval(poll); clearTimeout(timer); resolve(Number(match[1])); } }, 20);
    child.once('exit', code => { clearInterval(poll); clearTimeout(timer); reject(new Error(`${label} exited ${code}:\n${output}`)); });
  });
  // Kill by PID only.
  return { child, port, output: () => output, stop: async () => { if (child.exitCode == null) process.kill(child.pid, 'SIGTERM'); return exited; } };
}
// ---- one session ------------------------------------------------------------
const STEPS = [
  { label: 'plain', button: 'Load project', status: /^loaded /u, url: '/api/projects/p1', method: 'GET' },
  { label: 'fetch_self', button: 'Archive project', status: /^archive 200$/u, url: '/api/projects/p1/archive', method: 'POST', after: 'Return to project' },
  { label: 'http_peer_nested', button: 'Sync with peer', status: /^sync 200$/u, url: '/api/projects/p1/sync', method: 'POST' },
  { label: 'frontiers', button: 'Send webhook', status: /^webhook 202$/u, url: '/api/projects/p1/webhook', method: 'POST' },
  { label: 'fan_out', button: 'Show overview', status: /^overview 2$/u, url: '/api/projects/p1/overview', method: 'GET' },
  { label: 'chain_depth', button: 'Run chain', status: /^chain 200$/u, url: '/api/chain/5', method: 'POST' },
  { label: 'app_traceparent', button: 'Forward traced', status: /^forward 200$/u, url: '/api/projects/p1/forward', method: 'POST' },
  { label: 'after_response', button: 'Touch project', status: /^touch 200$/u, url: '/api/projects/p1/touch', method: 'POST' },
  { label: 'proxy', button: 'Proxy project', status: /^proxy 200$/u, url: '/api/projects/p1/proxy', method: 'GET' },
];

async function session(runLabel, { adapters = null } = {}) {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), `tracer-server-outbound-${runLabel}-`));
  const collector = createCollector({ port: collectorPort, store: { dir: storeDir, manifest: null, label: `server-outbound-${runLabel}` } });
  await collector.ready;
  // The uninstrumented host records every trace header it received, as sent on the wire.
  const wire = [];
  const uninstrumented = http.createServer((request, response) => {
    wire.push({ path: request.url, traceparent: request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'traceparent').length
      ? request.rawHeaders.flatMap((value, index) => (index % 2 === 0 && value.toLowerCase() === 'traceparent' ? [request.rawHeaders[index + 1]] : [])) : [] });
    request.resume(); request.on('end', () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"received":true}'); }); });
  const uninstrumentedPort = await listen(uninstrumented);
  const unreachablePort = await closedPort();
  const common = { PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `${collector.url}/spans`, ...(adapters ? { PRODUCTTRACE_BACKEND_ADAPTERS: adapters } : {}) };
  const peer = startNode(path.join(fixtureDir, 'peer.js'), { ...common, PRODUCTTRACE_SERVICE_NAME: 'outbound-peer' }, 'peer');
  const peerPort = await peer.port;
  const main = startNode(path.join(fixtureDir, 'server.js'), { ...common, PRODUCTTRACE_SERVICE_NAME: 'outbound-main',
    MONGO_URL: `mongodb://${MONGO.host}:${MONGO.port}`, MONGO_DB: DATABASE, PEER_URL: `http://127.0.0.1:${peerPort}`, STATIC_DIR: fixture.distRoot,
    UNINSTRUMENTED_URL: `http://127.0.0.1:${uninstrumentedPort}/hooks/project-archived`, UNREACHABLE_URL: `http://127.0.0.1:${unreachablePort}/hooks/mirror`,
    ...(axiosModule ? { AXIOS_MODULE: axiosModule } : {}) }, 'main');
  const origin = `http://127.0.0.1:${await main.port}`;
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error)));
  let sessionId = null;
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.getByRole('link', { name: 'Open Harbor survey' }).click();
    await page.getByRole('button', { name: 'Load project' }).waitFor();
    await page.waitForTimeout(300);
    for (const step of STEPS) {
      await page.getByRole('button', { name: step.button, exact: true }).click();
      await page.waitForFunction(source => new RegExp(source, 'u').test(document.querySelector('[role=status]')?.textContent || '')
        || document.querySelector('h1')?.textContent?.startsWith('Archived'), step.status.source, { timeout: 15_000 });
      await page.waitForTimeout(600);
      if (step.after) { await page.getByRole('link', { name: step.after }).click(); await page.getByRole('button', { name: 'Load project' }).waitFor(); await page.waitForTimeout(400); }
    }
    await page.waitForTimeout(800);
    sessionId = await page.evaluate(() => globalThis.__productTraceRuntime?.session ?? null);
    await page.goto('about:blank'); await page.waitForTimeout(600);
  } finally {
    await page.close();
  }
  // Spans arrive fire-and-forget: wait until the count is stable for 1 s.
  let last = -1; let stableSince = Date.now();
  for (const deadline = Date.now() + 10_000; Date.now() < deadline;) {
    const count = collector.status().spans;
    if (count !== last) { last = count; stableSince = Date.now(); } else if (Date.now() - stableSince > 1000) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const mainCode = await main.stop(); await peer.stop();
  await new Promise(resolve => uninstrumented.close(resolve));
  await collector.close();
  return { storeDir, sessionId, pageErrors, wire, mainOutput: main.output(), peerOutput: peer.output(), mainCode, ports: { uninstrumented: uninstrumentedPort, unreachable: unreachablePort, peer: peerPort } };
}

// ---- raw expectations (no package code) --------------------------------------
const readRows = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const startMs = span => (Array.isArray(span.start_time) ? span.start_time[0] * 1000 + span.start_time[1] / 1e6 : Number(span.start_time));
const attr = (span, ...names) => { for (const name of names) if (span.attributes?.[name] !== undefined) return span.attributes[name]; return undefined; };
const methodOf = span => String(attr(span, 'http.request.method', 'http.method') || '').toUpperCase();

function rawHops(spans, server, prefix = '') {
  const trace = spans.filter(span => span.trace_id === server.trace_id);
  const byId = new Map(trace.map(span => [span.span_id, span]));
  const nearestServer = span => { for (let parent = byId.get(span.parent_span_id); parent; parent = byId.get(parent.parent_span_id)) if (parent.kind === 'server') return parent; return null; };
  const outbound = trace.filter(span => span.kind === 'client' && !attr(span, 'db.system', 'db.system.name') && methodOf(span) && nearestServer(span)?.span_id === server.span_id)
    .sort((left, right) => startMs(left) - startMs(right));
  return outbound.flatMap((client, index) => {
    const hop = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    const receivers = trace.filter(span => span.kind === 'server' && span.parent_span_id === client.span_id && methodOf(span) === methodOf(client));
    const received = receivers.length === 1 ? receivers[0] : null;
    const owned = received ? trace.filter(span => nearestServer(span)?.span_id === received.span_id) : [];
    return [{ hop, client, received, handlers: owned.filter(span => span.instrumentation?.name === 'producttrace-express-handlers').map(span => span.attributes['producttrace.express.handler.name']),
      dbs: owned.filter(span => attr(span, 'db.system', 'db.system.name')).map(span => `${attr(span, 'db.operation.name', 'db.operation')} ${attr(span, 'db.collection.name', 'db.mongodb.collection')}`) },
    ...(received ? rawHops(spans, received, hop) : [])];
  });
}

// ---- MCP over stdio ------------------------------------------------------------
async function withMcp(storeDir, body) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath], stderr: 'ignore' });
  const client = new Client({ name: 'server-outbound', version: '1' });
  await client.connect(transport);
  const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };
  try { return await body(call); } finally { await client.close(); }
}

const normalize = text => String(text).replace(/127\.0\.0\.1:\d+/gu, '127.0.0.1:PORT').replace(/\b[0-9a-f]{16,32}\b/gu, 'ID').replace(/\baction[-_:][\w:.-]+/gu, 'ACTION')
  .replace(/\b\d+(?:\.\d+)? ms\b/gu, 'N ms').replace(/episode:[\w:.-]+/gu, 'EPISODE').replace(/sequence \d+/gu, 'sequence N');

async function checkRun(runLabel, result, { control = false } = {}) {
  const checks = [];
  const check = (name, pass, detail = null) => checks.push({ name: `${runLabel} ${name}`, pass: Boolean(pass), ...(pass ? {} : { detail }) });
  const records = readRows(path.join(result.storeDir, 'records.jsonl'));
  const spans = readRows(path.join(result.storeDir, 'spans.jsonl'));
  const hopBodyChecks = (chains, listing) => {
    const segments = Object.values(chains).flatMap(chain => chain?.segments || []);
    const withHops = segments.filter(segment => segment.hops?.length);
    const phrase = 'bodies: not recorded for server-to-server hops';
    const count = text => String(text || '').split(phrase).length - 1;
    check('H1 raw: the backend recorded no network.body row for a server-to-server hop', !records.some(row => row.kind === 'network.body' && row.hop != null));
    check('H2 MCP: every hop and escaped hop carries the explicit body-coverage field', withHops.length > 0 && withHops.every(segment => segment.bodies === 'not recorded for server-to-server hops'
      && [...segment.hops, ...segment.escaped_hops].every(hop => hop.bodies === 'not recorded for server-to-server hops')));
    check('H3 MCP: each request with hops says body coverage once in its segment text', withHops.length > 0 && withHops.every(segment => count(segment.summary) === 1 && count(segment.hops_text) === 1));
    const listed = (listing.requests || []).filter(request => request.hops?.length);
    check('H4 MCP: page_requests entries with hops carry the field and say body coverage once', listed.length > 0 && listed.every(request => request.bodies === 'not recorded for server-to-server hops'
      && count(request.summary) === 1));
  };
  check('R0 page ran without errors; backend exited cleanly', result.pageErrors.length === 0 && result.mainCode === 0, { pageErrors: result.pageErrors, mainCode: result.mainCode });
  const outboundLine = result.mainOutput.split('\n').find(line => line.includes('adapters active')) || '';
  check(`R1 backend log names the outbound capture (${control ? 'http only' : 'http+fetch'})`, control ? /outbound: http;/u.test(outboundLine) : /outbound: http\+fetch;/u.test(outboundLine), outboundLine);
  const clicks = records.filter(row => row.kind === 'dom.action' && row.event === 'click' && row.capture_page_id === result.sessionId);
  const requests = records.filter(row => row.kind === 'network.request' && row.capture_page_id === result.sessionId && row.internal !== true && row.transport_internal !== true);
  const perStep = {};
  for (const step of STEPS) {
    const action = clicks.find(row => row.target?.attributes?.['aria-label'] === step.button);
    const request = requests.find(row => row.action_id === action?.action_id && row.url === step.url && String(row.method || 'GET').toUpperCase() === step.method);
    const servers = request ? spans.filter(span => span.kind === 'server' && span.trace_id === request.trace_context?.trace_id && span.parent_span_id === request.trace_context?.span_id) : [];
    perStep[step.label] = { action, request, server: servers.length === 1 ? servers[0] : null, hops: servers.length === 1 ? rawHops(spans, servers[0]) : [] };
    if (control && step.label === 'proxy') {
      // Without the fetch adapter the forwarded traceparent leaves as the app sent it, so the proxy and the
      // downstream both claim the browser span (main's behaviour for fetch): the join abstains.
      check('C4 control: the fetch that forwards the incoming traceparent is not instrumented, so two server spans claim the browser request', action && request && servers.length === 2, { servers: servers.length });
      continue;
    }
    check(`R2 ${step.label}: the click owns ${step.method} ${step.url}; exactly one server span has the request's span id as parent`, action && request && servers.length === 1, { action: action?.action_id, request: request?.url, servers: servers.length });
  }
  // Raw hop shapes (trace ids and parent span ids only).
  const hopsOf = label => perStep[label].hops;
  const sameTrace = label => hopsOf(label).every(hop => hop.client.trace_id === perStep[label].request?.trace_context?.trace_id && (!hop.received || hop.received.trace_id === hop.client.trace_id));
  const shape = label => hopsOf(label).map(hop => `${hop.hop} ${methodOf(hop.client)} ${hop.received ? `${hop.received.service_name} ${hop.received.attributes['http.route']} ${hop.handlers.join(',')} [${hop.dbs.join(', ')}]` : 'ESCAPED'}`);
  check('R3 plain: no outbound span under the server span', hopsOf('plain').length === 0, shape('plain'));
  if (control) {
    const archive = perStep.fetch_self;
    // Other steps also call /internal/notify; in the control every fetch-issued one is a root in its own trace.
    const notifyRoots = spans.filter(span => span.kind === 'server' && span.attributes['http.route'] === '/internal/notify' && span.parent_span_id == null);
    check('C1 control (fetch adapter off): the archive request has no outbound span; no /internal/notify span is in its trace; fetch-issued /internal/notify spans are roots of other traces',
      hopsOf('fetch_self').length === 0 && notifyRoots.length >= 1 && !spans.some(span => span.kind === 'server' && span.attributes['http.route'] === '/internal/notify' && span.trace_id === archive.request?.trace_context?.trace_id),
      { hops: shape('fetch_self'), notify: notifyRoots.map(span => ({ parent: span.parent_span_id, trace: span.trace_id })) });
    check('C2 control: server spans carry producttrace.capture_limit.feature=outbound_fetch', archive.server?.attributes['producttrace.capture_limit.feature'] === 'outbound_fetch', archive.server?.attributes);
    const mcp = await withMcp(result.storeDir, async call => ({ archive: await call('action_chain', { action_id: archive.action.action_id }),
      http: await call('action_chain', { action_id: perStep.http_peer_nested.action.action_id }), requests: await call('page_requests', { session: result.sessionId }) }));
    hopBodyChecks({ archive: mcp.archive, http: mcp.http }, mcp.requests);
    const listed = [...(mcp.requests.server_spans_without_request?.spans || [])].map(span => span.span_id);
    check('C3 control (the defect): the archive chain shows no hop, and every root /internal/notify server span is listed only as a server span with no browser request',
      !mcp.archive.segments[0].hops.length && notifyRoots.every(span => listed.includes(span.span_id)) && !/outbound/u.test(mcp.archive.segments[0].summary),
      { summary: mcp.archive.segments[0].summary, listed });
    return { checks, signature: null, perStep, mcp: { archive_text: mcp.archive.text } };
  }
  check('R4 fetch_self: one hop, undici client span under archiveProject, /internal/notify server span is its child in the same trace',
    shape('fetch_self').join(' | ') === '1 POST outbound-main /internal/notify notify [insert notifications]' && sameTrace('fetch_self')
      && hopsOf('fetch_self')[0].client.instrumentation?.name === '@opentelemetry/instrumentation-undici', shape('fetch_self'));
  check('R5 http_peer_nested: hop 1 http.request to the peer (relay), hop 1.1 the peer\'s fetch back into /internal/ping (ping, find projects)',
    shape('http_peer_nested').join(' | ') === '1 POST outbound-peer /peer/relay relay [] | 1.1 GET outbound-main /internal/ping/:id ping [find projects]' && sameTrace('http_peer_nested')
      && hopsOf('http_peer_nested')[0].client.instrumentation?.name === '@opentelemetry/instrumentation-http', shape('http_peer_nested'));
  const frontier = hopsOf('frontiers');
  check('R6 frontiers: two outbound spans, neither claimed by any server span (the answered one has status 200, the closed port has an error status and no status code)',
    frontier.length === 2 && frontier.every(hop => !hop.received && !spans.some(span => span.parent_span_id === hop.client.span_id))
      && Number(attr(frontier[0].client, 'http.response.status_code', 'http.status_code')) === 200 && frontier[1].client.status?.code === 2
      && attr(frontier[1].client, 'http.response.status_code', 'http.status_code') == null, frontier.map(hop => ({ url: attr(hop.client, 'url.full', 'http.url'), status: hop.client.status })));
  const fan = hopsOf('fan_out');
  check('R7 fan_out: two sibling hops (fetch /internal/stats, axios GET /peer/stats) under the same server span, ordered by client start time',
    fan.length === 2 && fan.every(hop => !hop.hop.includes('.')) && new Set(fan.map(hop => hop.received?.attributes['http.route'])).size === 2
      && fan.some(hop => hop.received?.attributes['http.route'] === '/internal/stats/:id') && fan.some(hop => hop.received?.attributes['http.route'] === '/peer/stats/:id')
      && startMs(fan[0].client) <= startMs(fan[1].client), shape('fan_out'));
  const chain = hopsOf('chain_depth');
  check('R8 chain_depth: five nested hops 1 → 1.1.1.1.1, each a child of the previous hop\'s server span; insert chain_ends in the last',
    chain.map(hop => hop.hop).join(' ') === '1 1.1 1.1.1 1.1.1.1 1.1.1.1.1' && chain.at(-1)?.dbs.join() === 'insert chain_ends' && sameTrace('chain_depth'), shape('chain_depth'));
  check('R9 no span of the span delivery itself (tracing suppressed)', !spans.some(span => span.kind === 'client' && /\/spans$/u.test(String(attr(span, 'url.full', 'http.url') || ''))));

  // ---- MCP (black box) ----
  const mcp = await withMcp(result.storeDir, async call => {
    const chains = {};
    for (const step of STEPS) if (perStep[step.label].action) chains[step.label] = await call('action_chain', { action_id: perStep[step.label].action.action_id });
    return { chains, requests: await call('page_requests', { session: result.sessionId }) };
  });
  hopBodyChecks(mcp.chains, mcp.requests);
  const seg = label => mcp.chains[label]?.segments?.[0] || null;
  const hopJson = label => (seg(label)?.hops || []).map(hop => `${hop.hop} ${hop.method} ${hop.join === 'exact_parent' ? `${hop.server.service_name} ${hop.server.route} ${hop.server.handler_spans.map(value => value.name).join(',')} [${hop.server.db_ops.map(value => `${value.operation} ${value.collection}`).join(', ')}]` : 'ESCAPED'}`);
  for (const label of ['plain', 'fetch_self', 'http_peer_nested', 'frontiers', 'fan_out', 'chain_depth', 'after_response', 'proxy']) {
    check(`M1 ${label}: segment hops equal the raw hops (paths, services, routes, handlers, db ops, order)`, JSON.stringify(hopJson(label)) === JSON.stringify(shape(label)), { mcp: hopJson(label), raw: shape(label) });
    check(`M2 ${label}: every hop's span ids are the raw client/server span ids`, (seg(label)?.hops || []).every((hop, index) => hop.span_id === hopsOf(label)[index]?.client.span_id
      && (hop.server?.span_id ?? null) === (hopsOf(label)[index]?.received?.span_id ?? null)), null);
  }
  check('M3 plain: no hops, no escaped hops; summary has no outbound; outcome completed 200 find projects',
    seg('plain')?.hops.length === 0 && seg('plain')?.escaped_hops.length === 0 && !/outbound/u.test(seg('plain')?.summary) && mcp.chains.plain.outcome.status === 'completed', seg('plain')?.summary);
  const archiveText = 'outbound POST /internal/notify (from handler archiveProject) → server /internal/notify 201 → handler notify → db insert notifications';
  check('M4 fetch_self: the segment renders the hop as the rule words it', seg('fetch_self')?.summary.includes(archiveText) && mcp.chains.fetch_self.text.includes(archiveText), seg('fetch_self')?.summary);
  check('M5 fetch_self: the headline effect is the request\'s own write (update projects); the hop\'s insert is listed as a db stop with its hop', /^Completed 200: update projects/u.test(mcp.chains.fetch_self.outcome.label)
    && (mcp.chains.fetch_self.stops || []).some(stop => stop.stop === 'db' && stop.hop === '1' && stop.collection === 'notifications')
    && (mcp.chains.fetch_self.stops || []).some(stop => stop.stop === 'outbound' && stop.hop === '1' && stop.join === 'exact_parent'), { label: mcp.chains.fetch_self.outcome.label, stops: mcp.chains.fetch_self.stops });
  const syncText = 'hop 1: outbound POST /peer/relay (from handler syncProject) → server outbound-peer /peer/relay 200 → handler relay; hop 1.1: outbound GET /internal/ping/p1 (from handler relay) → server outbound-main /internal/ping/:id 200 → handler ping → db find projects';
  check('M6 http_peer_nested: nested hop rendered with its service and path; the chain reached db through the hops', seg('http_peer_nested')?.summary.includes(syncText)
    && mcp.chains.http_peer_nested.reached === 'db' && /hop 1\.1/u.test(mcp.chains.http_peer_nested.because), { summary: seg('http_peer_nested')?.summary, because: mcp.chains.http_peer_nested.because });
  const answered = `outbound POST http://127.0.0.1:${result.ports.uninstrumented}/hooks/project-archived 200 (from handler sendWebhook) → no incoming span for this traceparent (not instrumented, or not reached); also possible: the app replaced the traceparent after the request was created, or a second OpenTelemetry SDK sent another one`;
  const refused = `outbound POST http://127.0.0.1:${result.ports.unreachable}/hooks/mirror (from handler sendWebhook) → no response (`;
  const escaped = seg('frontiers')?.escaped_hops || [];
  check('M7 frontiers: two escaped_hops on the request, each a stated frontier (answered but not instrumented; no response)',
    escaped.length === 2 && escaped[0].summary === answered && escaped[1].summary.startsWith(refused) && escaped[1].summary.endsWith('); no incoming span for this traceparent (not instrumented, or not reached)'),
    escaped.map(hop => hop.summary));
  const lostClause = `a further server-side hop may have escaped: 2 hop(s) not followed: 2 with no receiving span (POST http://127.0.0.1:${result.ports.uninstrumented}/hooks/project-archived, POST http://127.0.0.1:${result.ports.unreachable}/hooks/mirror)`;
  check('M8 frontiers: with escaped hops the headline is stopped_at server_hop ("reached db (<its write>); a further server-side hop may have escaped: 2 hop(s) not followed: 2 with no receiving span"), never "terminal effect observed"; the write stays the stated effect; each hop is also a stop',
    mcp.chains.frontiers.stopped_at === 'server_hop' && mcp.chains.frontiers.reached === 'db'
      && mcp.chains.frontiers.because === `reached db (database write insert webhook_attempts (handler: sendWebhook) joined by exact span parentage); ${lostClause}`
      && !/terminal effect observed/u.test(mcp.chains.frontiers.text.split('\n')[0]) && mcp.chains.frontiers.text.includes('/ stopped at server_hop /')
      && (mcp.chains.frontiers.additional_stops || []).filter(stop => stop.reached === 'outbound' && stop.stopped_at === 'network').length === 2
      && mcp.chains.frontiers.outcome.label === 'Completed 202: insert webhook_attempts; a further server-side hop may have escaped'
      && mcp.chains.frontiers.text.includes('[outcome completed 202; a further server-side hop may have escaped]'),
    { text: mcp.chains.frontiers.text, because: mcp.chains.frontiers.because, label: mcp.chains.frontiers.outcome.label });
  check('M8b every request whose hops were all followed still reads "terminal effect observed" (stopped_at null)', ['plain', 'fetch_self', 'fan_out', 'chain_depth'].every(label => mcp.chains[label].stopped_at == null
    && mcp.chains[label].text.includes('stopped at none (terminal effect observed)')), Object.fromEntries(['plain', 'fetch_self', 'fan_out', 'chain_depth'].map(label => [label, mcp.chains[label].stopped_at])));
  const fanOrder = seg('fan_out')?.hops.map(hop => hop.server?.route);
  check('M9 fan_out: two child hops in start order, labelled hop 1 and hop 2', fanOrder?.length === 2 && seg('fan_out').hops.every((hop, index) => hop.hop === String(index + 1))
    && seg('fan_out').summary.includes(`hop 1: outbound GET`) && seg('fan_out').summary.includes(`hop 2: outbound GET`), seg('fan_out')?.summary);
  check('M10 chain_depth: all five hops in JSON; inline rendering capped at depth 3 with "+2 more hops (2 deeper than 3)"; effect names the deepest hop',
    seg('chain_depth')?.hops.length === 5 && seg('chain_depth').summary.includes('hop 1.1.1: outbound POST /api/chain/2') && !seg('chain_depth').summary.includes('hop 1.1.1.1:')
      && seg('chain_depth').summary.includes('+2 more hops (2 deeper than 3) (see hops)') && /insert chain_ends \(hop 1\.1\.1\.1\.1: POST \/api\/chain\/0\)/u.test(mcp.chains.chain_depth.outcome.label),
    { summary: seg('chain_depth')?.summary, label: mcp.chains.chain_depth.outcome.label });
  // (f) App-set traceparent, raw: values the app logged vs spans vs the wire.
  const appValues = Object.fromEntries([...result.mainOutput.matchAll(/^app-traceparent (\S+) (\S+)$/gmu)].map(match => [match[1], match[2]]));
  const parse = value => { const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/u.exec(value || ''); return match ? { trace: match[1], span: match[2] } : null; };
  const forward = perStep.app_traceparent;
  const forwardTrace = spans.filter(span => span.trace_id === forward.request?.trace_context?.trace_id);
  const forwardOut = forwardTrace.filter(span => span.kind === 'client' && !attr(span, 'db.system', 'db.system.name') && methodOf(span)).sort((left, right) => startMs(left) - startMs(right));
  const continued = value => spans.filter(span => span.kind === 'server' && parse(value) && span.trace_id === parse(value).trace && span.parent_span_id === parse(value).span);
  const handlerSpan = forwardTrace.find(span => span.attributes['producttrace.express.handler.name'] === 'forwardTraced');
  check('R11 app_traceparent raw: four outbound spans, each marked traceparent_set_by_app with the app\'s own value; no server span continues Tracer\'s client span ids',
    forwardOut.length === 4 && ['fetch-self', 'http-peer', 'fetch-uninstrumented', 'api-inject'].every((label, index) => forwardOut[index].attributes['producttrace.outbound.traceparent_set_by_app'] === true
      && forwardOut[index].attributes['producttrace.outbound.app_traceparent'] === appValues[label])
      && !spans.some(span => span.kind === 'server' && forwardOut.some(client => client.span_id === span.parent_span_id)),
    { appValues, out: forwardOut.map(span => [span.instrumentation?.name, span.attributes['producttrace.outbound.app_traceparent'] ?? null]) });
  check('R12 app_traceparent wire: the receivers continued exactly the app\'s values (fetch to self, http.request to the peer, the api-inject value = the handler span); the uninstrumented host got one traceparent, the app\'s',
    continued(appValues['fetch-self']).length === 1 && continued(appValues['http-peer']).length === 1 && continued(appValues['api-inject']).length === 1
      && parse(appValues['api-inject'])?.span === handlerSpan?.span_id
      && JSON.stringify(result.wire.filter(row => row.path.endsWith('/traced')).map(row => row.traceparent)) === JSON.stringify([[appValues['fetch-uninstrumented']]]),
    { wire: result.wire, appValues });
  const forwardSeg = seg('app_traceparent');
  check('M12 app_traceparent: hops followed by the app\'s identifiers (joins app_traceparent), the uninstrumented one stated as "traceparent set by the app; receiving span not linked by Tracer" and escaped; never "not instrumented"',
    JSON.stringify((forwardSeg?.hops || []).map(hop => hop.join)) === JSON.stringify(['app_traceparent', 'app_traceparent', 'app_traceparent_unlinked', 'app_traceparent'])
      && (forwardSeg?.hops || []).every(hop => hop.traceparent_set_by_app === true)
      && forwardSeg.hops[0].server?.span_id === continued(appValues['fetch-self'])[0]?.span_id && forwardSeg.hops[1].server?.span_id === continued(appValues['http-peer'])[0]?.span_id
      && forwardSeg.escaped_hops.length === 1 && forwardSeg.escaped_hops[0].summary.endsWith('→ traceparent set by the app; receiving span not linked by Tracer')
      && forwardSeg.summary.includes('outbound POST /internal/notify (from handler forwardTraced; followed by the traceparent the app set) → server /internal/notify 201 → handler notify → db insert notifications')
      && mcp.chains.app_traceparent.stopped_at === 'server_hop' && !/not instrumented\)/u.test(forwardSeg.summary.replace('(not instrumented, or not reached)', '')),
    { hops: (forwardSeg?.hops || []).map(hop => [hop.join, hop.summary]), stopped_at: mcp.chains.app_traceparent.stopped_at });
  const touch = seg('after_response');
  const touchRaw = hopsOf('after_response')[0];
  check('M13 after_response: the timer-issued hop joins by the traceparent and says "sent N ms after the response" (N from the raw client start minus the server span end)',
    touch?.hops.length === 1 && touch.hops[0].join === 'exact_parent' && touch.hops[0].after_response_ms > 0
      && Math.abs(touch.hops[0].after_response_ms - (startMs(touchRaw.client) - (perStep.after_response.server.end_time[0] * 1000 + perStep.after_response.server.end_time[1] / 1e6))) < 0.2
      && touch.summary.includes(`(from handler touchProject; sent ${touch.hops[0].after_response_ms} ms after the response) → server /internal/notify 201 → handler notify → db insert notifications`),
    { summary: touch?.summary, hops: touch?.hops });
  // (h) Proxy pattern: the forwarded incoming traceparent is a pass-through.
  const proxyHops = hopsOf('proxy');
  check('R13 proxy raw: exactly one server span claims the browser request; both forwarding calls (http.request with the incoming headers, fetch with the incoming traceparent) are marked traceparent_forwarded and each has exactly one receiving server span as its child',
    perStep.proxy.server && proxyHops.length === 2 && proxyHops.every(hop => hop.client.attributes['producttrace.outbound.traceparent_forwarded'] === true && hop.received
      && !('producttrace.outbound.traceparent_set_by_app' in hop.client.attributes))
      && new Set(proxyHops.map(hop => hop.client.instrumentation?.name)).size === 2
      && spans.filter(span => span.kind === 'server' && span.parent_span_id === perStep.proxy.request?.trace_context?.span_id).length === 1, shape('proxy'));
  check('M14 proxy: the browser request joins its server span; both forwarded calls are followed hops (exact_parent); terminal effect observed',
    seg('proxy')?.route && seg('proxy').join_diagnostic == null && JSON.stringify(seg('proxy').hops.map(hop => hop.join)) === '["exact_parent","exact_parent"]'
      && seg('proxy').escaped_hops.length === 0 && mcp.chains.proxy.stopped_at == null, { summary: seg('proxy')?.summary, stopped_at: mcp.chains.proxy.stopped_at });
  // Receiving server spans are joined, never listed as unlinked.
  const receivers = new Set([...Object.values(perStep).flatMap(step => step.hops.filter(hop => hop.received).map(hop => hop.received.span_id)),
    ...['fetch-self', 'http-peer', 'api-inject'].flatMap(label => continued(appValues[label]).map(span => span.span_id))]);
  const listedUnlinked = Object.values(mcp.chains).flatMap(chain => chain.unlinked?.server_spans || []).map(span => span.span_id);
  const listedOnPage = (mcp.requests.server_spans_without_request?.spans || []).map(span => span.span_id);
  check('M11 no hop\'s receiving server span is listed as unlinked or as a server span with no browser request', receivers.size >= 9 && ![...listedUnlinked, ...listedOnPage].some(id => receivers.has(id)),
    { receivers: receivers.size, listedUnlinked, listedOnPage });
  const signature = Object.fromEntries(STEPS.map(step => [step.label, {
    status: mcp.chains[step.label]?.outcome?.status, label: normalize(mcp.chains[step.label]?.outcome?.label), stopped_at: mcp.chains[step.label]?.stopped_at ?? null,
    // Fan-out order follows the client spans' start times, which the runtime decides; compared as a set across runs.
    hops: step.label === 'fan_out' ? [...hopJson(step.label).map(line => line.replace(/^\d+ /u, ''))].sort() : hopJson(step.label),
    escaped: (seg(step.label)?.escaped_hops || []).map(hop => normalize(hop.summary)),
    summary: step.label === 'fan_out' ? null : normalize(seg(step.label)?.summary) }]));
  return { checks, signature, perStep, fanOrder, mcp: Object.fromEntries(Object.entries(mcp.chains).map(([label, chain]) => [label, { text: chain.text, stops: chain.stops, segments: chain.segments, outcome: chain.outcome,
    reached: chain.reached, stopped_at: chain.stopped_at, because: chain.because, additional_stops: chain.additional_stops ?? null }])), page_requests: { text: mcp.requests.text, server_spans_without_request: mcp.requests.server_spans_without_request ?? null } };
}

// ---- runs ---------------------------------------------------------------------
const results = []; const allChecks = [];
async function dropped() {
  // The backend drops its database on SIGTERM; confirm from a fresh connection.
  const { MongoClient } = createRequire(path.join(tracerRoot, 'package.json'))('mongodb');
  const client = new MongoClient(`mongodb://${MONGO.host}:${MONGO.port}`, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try { return !(await client.db().admin().listDatabases({ nameOnly: true })).databases.some(row => row.name === DATABASE); } finally { await client.close(); }
}
try {
  const plan = [...Array.from({ length: RUNS }, (_, index) => ({ label: `run-${index + 1}`, control: false })), ...(CONTROL ? [{ label: 'control', control: true }] : [])];
  for (const item of plan) {
    const result = await session(item.label, item.control ? { adapters: 'http,express,mongodb' } : {});
    const checked = await checkRun(item.label, result, { control: item.control });
    checked.checks.push({ name: `${item.label} R10 database ${DATABASE} dropped after the run`, pass: await dropped() });
    allChecks.push(...checked.checks);
    results.push({ ...item, ...result, ...checked });
    if (OUT) {
      const dir = path.join(OUT, item.label); fs.mkdirSync(dir, { recursive: true });
      for (const file of ['records.jsonl', 'spans.jsonl', 'runs.jsonl']) if (fs.existsSync(path.join(result.storeDir, file))) fs.copyFileSync(path.join(result.storeDir, file), path.join(dir, file));
      fs.writeFileSync(path.join(dir, 'mcp.json'), `${JSON.stringify({ chains: checked.mcp, page_requests: checked.page_requests ?? null }, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'backend.log'), `--- main (outbound-main)\n${result.mainOutput}\n--- peer (outbound-peer)\n${result.peerOutput}\n`);
    }
    fs.rmSync(result.storeDir, { recursive: true, force: true });
  }
  const signatures = results.filter(row => row.signature).map(row => JSON.stringify(row.signature));
  allChecks.push({ name: `S1 ${signatures.length} runs give the same normalized MCP signature`, pass: signatures.length >= 1 && signatures.every(value => value === signatures[0]),
    ...(signatures.every(value => value === signatures[0]) ? {} : { detail: signatures }) });
} finally {
  await browser.close();
}
const failed = allChecks.filter(row => !row.pass);
for (const row of allChecks) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name}${row.pass ? '' : `\n  ${JSON.stringify(row.detail)}`}`);
const fanOrders = results.filter(row => row.fanOrder).map(row => `${row.label}: ${row.fanOrder.join(' then ')}`);
console.log(`fan-out order by client start time: ${fanOrders.join('; ')}`);
console.log(`axios: ${axiosModule || 'not resolvable from the dependency root (axios-style http.request used)'}`);
console.log(`${allChecks.length - failed.length}/${allChecks.length} checks pass`);
if (OUT) {
  fs.copyFileSync(manifestPath, path.join(OUT, 'attribution-manifest.json'));
  fs.writeFileSync(path.join(OUT, 'checks.json'), `${JSON.stringify({ node: process.version, runs: RUNS, control: CONTROL, axios: axiosModule, fan_out_order: fanOrders, checks: allChecks,
    signature: results.find(row => row.signature)?.signature ?? null }, null, 2)}\n`);
}
fixture.cleanup();
assert.equal(failed.length, 0, `${failed.length} check(s) failed`);
