// "Tracer never claims more coverage or completeness than its rows prove"
// (fix/honest-coverage; headless, neutral fixture test/browser/fixtures/honest-coverage-app).
//
// A one-file React app (a Radix Dialog in a portal, two iframes, a Web Worker,
// an uninstrumented script with a beacon on pagehide) is built with both
// Tracer plugins; its rows ship through the real collector sink into a real
// store. Its API runs in its own Node process under
// `node --import producttrace/backend/register` (Express; a Map wrapped in
// DB-like client spans); spans reach the same store. One route calls a second
// route with Node's global fetch (not instrumented: a new root trace, the
// escaped hop); another calls an external service over node:http (an outbound
// client span that no server span continues). A small front server serves the
// build and proxies /api/*; an "external" server on another port serves the
// cross-origin-looking frame and answers the outbound call, with no telemetry.
//
// The driver picks, at run time, an event kind the runtime does not listen to
// (from the page's own capture.page.observes and a hover probe), and arms the
// uninstrumented script's listener on it: that listener's request is the
// request "from an unrecorded cause". A runtime that listens for every kind
// the page exposes (D-G1-21, fix/trusted-events: observes.events.unobserved is
// empty) has no such kind: the driver then arms a listened hover kind, and
// the same checks assert the other side, from the same rows: the request is
// owned by the recorded hover row, nothing is claimed unobserved, and the
// Open panel window holds no unattributed request.
//
// Every coverage field and every sentence is checked against the raw
// records.jsonl / spans.jsonl rows read here, in process and through the MCP
// server over stdio (as an agent runs it), and against exported action chains.
//
//   node test/browser/honest-coverage.mjs [dependencyRoot] [--out <dir>]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';
import { createStore, loadStore } from '../../collector/store.mjs';
import { callTool } from '../../mcp/tools.mjs';
import { buildActionChains } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : null;
const positional = argv.filter((value, index) => !value.startsWith('--') && argv[index - 1] !== '--out');
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/honest-coverage-app');
const fixtureFile = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-honest-coverage-store-'));

const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'honest-coverage' } });
await collector.ready;

// "External" service on another port: no telemetry. It serves the other-port frame and answers the export's outbound call.
const externalHits = [];
const external = http.createServer((req, res) => {
  externalHits.push(`${req.method} ${req.url} traceparent=${req.headers.traceparent ? 'yes' : 'no'}`);
  req.resume();
  req.on('end', () => {
    if (req.url === '/frame.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixtureFile('frame.html')); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
});
await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
const externalOrigin = `http://127.0.0.1:${external.address().port}`;

// Backends: two processes, telemetry only through the default entrypoint. B (ROLE=b) is a second
// instrumented service A calls; the external service above has no telemetry.
const procs = [];
const startBackend = async (role, env) => {
  const child = spawn(process.execPath, ['--import', 'producttrace/backend/register', path.join(fixtureDir, 'server.mjs')], {
    cwd: tracerRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `${collector.url}/spans`, PRODUCTTRACE_SERVICE_NAME: `honest-coverage-${role}`,
      EXTERNAL_URL: `${externalOrigin}/hook`, ROLE: role, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  procs.push({ child, exited });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend ${role} did not start:\n${output}`)), 20_000);
    child.stdout.on('data', chunk => { output += chunk; const match = /listening (\d+)/u.exec(output); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`backend ${role} exited ${code}:\n${output}`)); });
  });
};
const secondPort = await startBackend('b', {});
const backendPort = await startBackend('a', { B_URL: `http://127.0.0.1:${secondPort}` });

const fixture = await buildReactFixture({ dependencyRoot, name: 'honest-coverage', appSource: fixtureFile('main.jsx'),
  publicFiles: { 'vendor.js': fixtureFile('vendor.js'), 'worker.js': fixtureFile('worker.js'), 'frame.html': fixtureFile('frame.html') },
  bodyHtml: `<script>window.__externalOrigin = ${JSON.stringify(externalOrigin)};</script><script src="/vendor.js"></script><iframe title="Same-origin frame" src="/frame.html" width="80" height="40"></iframe><iframe title="Other-port frame" src="${externalOrigin}/frame.html" width="80" height="40"></iframe>`,
  pluginOptions: { collector: { url: collector.url, force: true } } });

// Front server: the build, /api/* proxied with every header (traceparent included).
const front = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://front');
  if (url.pathname.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
    req.pipe(upstream); return;
  }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(fixture.distRoot, relative);
  if (!file.startsWith(`${fixture.distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
// The page's WebSocket: a "go" message makes the socket server write through the API with no trace context
// (a message carries none), as a realtime backend would.
const { WebSocketServer } = createRequire(path.join(dependencyRoot, 'package.json'))('ws');
const sockets = new WebSocketServer({ server: front, path: '/ws' });
const socketWrites = [];
sockets.on('connection', socket => socket.on('message', message => {
  if (String(message) !== 'go') return;
  const write = http.request({ host: '127.0.0.1', port: backendPort, method: 'POST', path: '/api/ws-write', headers: { 'content-type': 'application/json' } }, reply => { reply.resume(); socketWrites.push(reply.statusCode); });
  write.end('{"via":"socket"}');
}));
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${front.address().port}`;

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const observed = { page_errors: [], responses: {}, probe: null, chosen_kind: null, in_page_on_kinds: null };
let session = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => observed.page_errors.push(`${error.name}: ${error.message}`));
  page.on('response', response => { const pathname = new URL(response.url()).pathname; if (pathname.startsWith('/api/')) (observed.responses[pathname] ||= []).push(response.status()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const settle = (ms = 700) => page.waitForTimeout(ms);
  // The event kinds the runtime does not listen to, from the page's own capture.page row (never named here).
  const pageObserves = await page.evaluate(() => globalThis.__productTraceRuntime.records.find(row => row.kind === 'capture.page').observes);
  // An independent enumeration of the on* handler properties, for the raw check below.
  observed.in_page_on_kinds = await page.evaluate(() => {
    const names = new Set();
    for (const start of [HTMLElement.prototype, Document.prototype, window]) for (let proto = start; proto; proto = Object.getPrototypeOf(proto)) for (const key of Object.getOwnPropertyNames(proto)) if (/^on[a-z]/u.test(key)) names.add(key.slice(2));
    return [...names].sort();
  });
  // Probe: which of those kinds does a trusted pointer hover over the panel fire? Choose the first one (run-time choice).
  const panel = page.getByRole('region', { name: 'Notes panel' });
  const box = await panel.boundingBox();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
  await page.evaluate(kinds => globalThis.__vendorProbe(kinds), pageObserves.events.unobserved);
  await page.mouse.move(box.x + 20, box.y + 20, { steps: 4 });
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  observed.probe = await page.evaluate(() => globalThis.__vendorProbeResult());
  observed.all_observed = pageObserves.events.unobserved.length === 0;
  if (observed.all_observed) {
    // Every exposed kind is listened: probe the listened hover kinds instead.
    await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
    await page.evaluate(kinds => globalThis.__vendorProbe(kinds), pageObserves.events.recorded);
    await page.mouse.move(box.x + 20, box.y + 20, { steps: 4 });
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
    observed.probe = await page.evaluate(() => globalThis.__vendorProbeResult());
    observed.chosen_kind = ['pointerover', 'mouseover', 'pointerenter', 'mouseenter'].find(kind => observed.probe.includes(kind)) || null;
  } else observed.chosen_kind = pageObserves.events.unobserved.find(kind => observed.probe.includes(kind)) || null;
  if (!observed.chosen_kind) throw new Error(`no ${observed.all_observed ? 'listened hover' : 'unobserved'} event kind fired on hover: ${JSON.stringify(observed.probe)}`);
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);

  // 1. Plain: one write, nothing further.
  await page.getByRole('button', { name: 'Save note' }).click(); await settle();
  // 2. Radix Dialog (portal): open, then confirm (the escaped hop).
  await page.getByRole('button', { name: 'Sync' }).click(); await settle(500);
  await page.getByRole('button', { name: 'Confirm sync' }).click(); await settle(1200);
  // 3. Export: an outbound call no server span continues.
  await page.getByRole('button', { name: 'Export' }).click(); await settle(1000);
  // 3a. Grader probe g: two calls inside one SDK client span (B, then external), and a call to external from B's response callback.
  await page.getByRole('button', { name: 'Batch', exact: true }).click(); await settle(1000);
  await page.getByRole('button', { name: 'Seq', exact: true }).click(); await settle(1000);
  // 3b. A frame of another origin inserted 50 ms after the click and removed 400 ms later (between check points).
  await page.getByRole('button', { name: 'Show frame' }).click(); await settle(1000);
  observed.frames_after_brief = await page.evaluate(() => window.length);
  // 3c. A WebSocket message; the socket server writes through the API (no trace context).
  await page.getByRole('button', { name: 'Ping socket' }).click(); await settle(1000);
  // 4. Open panel (no request), then the hover the uninstrumented script listens to (an unrecorded cause).
  // Armed only now, with the pointer parked off the panel: a layout change under a still pointer also fires hover events.
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
  await page.evaluate(kind => globalThis.__vendorArm(kind), observed.chosen_kind);
  await settle(300);
  await page.getByRole('button', { name: 'Open panel' }).click(); await settle(300);
  await page.mouse.move(box.x + 30, box.y + 30, { steps: 4 }); await page.mouse.move(box.x + 70, box.y + 50, { steps: 4 });
  await settle(1000);
  session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
  // An SDK-style late fetch replacement (it still calls the previous fetch): the summary must say so.
  await page.evaluate(() => globalThis.__vendorWrapFetch());
  // pagehide: the beacon (uninstrumented), then the sink's summary and tail.
  await page.goto('about:blank'); await page.waitForTimeout(1200);
  await page.close();
  // A long-lived collector: a root server span 3 s after the page ended (past the 2 s grace) is in no window of it.
  await new Promise(resolve => setTimeout(resolve, 3000));
  observed.late_root = await new Promise(resolve => { const late = http.request({ host: '127.0.0.1', port: backendPort, method: 'POST', path: '/api/notes', headers: { 'content-type': 'application/json' } },
    reply => { reply.resume(); reply.on('end', () => resolve(reply.statusCode)); }); late.end('{"text":"after the page"}'); });
  await new Promise(resolve => setTimeout(resolve, 500));
} finally {
  await browser.close();
  await new Promise(resolve => front.close(resolve));
  for (const { child, exited } of procs) { child.kill('SIGTERM'); await exited; }
  await new Promise(resolve => external.close(resolve));
}
await new Promise(resolve => setTimeout(resolve, 300));
await collector.close();
await new Promise(resolve => setTimeout(resolve, 1700)); // the MCP server views the store idle

// ---- raw rows (read here; nothing from the package computes an expectation)
const readRows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const records = readRows(path.join(storeDir, 'records.jsonl'));
const rawSpans = fs.existsSync(path.join(storeDir, 'spans.jsonl')) ? readRows(path.join(storeDir, 'spans.jsonl')) : [];
const own = records.filter(row => row.capture_page_id === session);
const actions = own.filter(row => row.kind === 'dom.action');
const requests = own.filter(row => row.kind === 'network.request' && row.internal !== true && row.transport_internal !== true);
// dom.action rows carry no text: the driver clicked Save note, Sync, Confirm sync, Export, Open panel in this order.
const CLICK_ORDER = ['Save note', 'Sync', 'Confirm sync', 'Export', 'Batch', 'Seq', 'Show frame', 'Ping socket', 'Open panel'];
const clicks = actions.filter(row => row.event === 'click');
const clickNamed = name => (clicks.length === CLICK_ORDER.length ? clicks[CLICK_ORDER.indexOf(name)] : null);
const startMs = span => (Array.isArray(span.start_time) ? span.start_time[0] * 1000 + span.start_time[1] / 1e6 : Number(span.start_time));
const endMs = span => (Array.isArray(span.end_time) ? span.end_time[0] * 1000 + span.end_time[1] / 1e6 : Number(span.end_time));
const serverOf = request => rawSpans.filter(span => span.kind === 'server' && span.trace_id === request.trace_context?.trace_id && span.parent_span_id === request.trace_context?.span_id);
const route = span => span.attributes?.['http.route'] ?? span.attributes?.['http.target'] ?? span.name;
const underTrace = (server, predicate) => { const out = []; const stack = [server.span_id];
  while (stack.length) { const id = stack.pop(); for (const child of rawSpans.filter(span => span.trace_id === server.trace_id && span.parent_span_id === id)) { if (predicate(child)) out.push(child); stack.push(child.span_id); } }
  return out; };
const browserContexts = new Set(records.filter(row => row.kind === 'network.request' && row.trace_context?.trace_id).map(row => `${row.trace_context.trace_id}:${row.trace_context.span_id}`));
const spanKeys = new Set(rawSpans.map(span => `${span.trace_id}:${span.span_id}`));
const rootServers = rawSpans.filter(span => span.kind === 'server' && !browserContexts.has(`${span.trace_id}:${span.parent_span_id}`) && !spanKeys.has(`${span.trace_id}:${span.parent_span_id}`));

// ---- tools: in process (idle view) and over stdio
const loaded = await loadStore({ dir: storeDir });
const store = createStore({ records: loaded.records, spans: loaded.spans, manifest: fixture.manifest, sourceRoot: fixture.repository, now: () => Date.now() + 1e6 });
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath], stderr: 'ignore' });
const client = new Client({ name: 'honest-coverage', version: '1' });
await client.connect(transport);
const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };
const exported = new Map(buildActionChains(loaded.records.filter(row => row.kind !== 'element.stamp'), loaded.spans, { backendInstrumented: true }).map(row => [row.action_id, row]));

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const report = { store: storeDir, session, observed, external_hits: externalHits, checks, answers: {} };
try {
  check('R0 the page ran without errors; every /api response arrived', observed.page_errors.length === 0
    && ['/api/notes', '/api/sync', '/api/export', '/api/hover-note'].every(pathname => observed.responses[pathname]?.length === 1), observed);

  // ---- Rule 1: observes and coverage.unobserved, measured, never a constant
  const pageRow = own.find(row => row.kind === 'capture.page');
  const events = pageRow?.observes?.events;
  // In-page on* enumeration plus the kinds the platform dispatches with no on* property (test data).
  const expectedKinds = [...new Set([...observed.in_page_on_kinds, 'compositionend', 'compositionstart', 'compositionupdate', 'focusin', 'focusout', 'touchcancel', 'touchend', 'touchmove', 'touchstart',
    ...(observed.all_observed ? ['DOMActivate', 'DOMFocusIn', 'DOMFocusOut', 'textInput'] : [])])].sort();
  const allObserved = observed.all_observed === true;
  check('O1 raw: capture.page.observes lists the recorded event kinds and every other on* kind the page exposes (independent in-page enumeration)',
    events && events.unobserved.every(name => !events.recorded.includes(name)) && events.exposed_total === expectedKinds.length
    && JSON.stringify(events.unobserved) === JSON.stringify(expectedKinds.filter(name => !events.recorded.includes(name))),
    { recorded: events?.recorded, unobserved_total: events?.unobserved?.length, exposed_total: events?.exposed_total, in_page: observed.in_page_on_kinds.length });
  const chosen = observed.chosen_kind;
  const hoverRequest = requests.find(row => String(row.url) === '/api/hover-note');
  const hoverOwner = hoverRequest?.action_id ? actions.find(row => row.action_id === hoverRequest.action_id) : null;
  check(allObserved ? 'O2 raw: every exposed kind is listened; the chosen hover kind is one of them and the row it dispatched owns the armed listener\'s request'
    : 'O2 raw: the kind chosen at run time is one the runtime does not listen to, and it started no action',
    allObserved ? events?.unobserved.length === 0 && events.recorded.includes(chosen) && hoverOwner?.event === chosen && hoverOwner.coalesced === true
      : events?.unobserved.includes(chosen) && !actions.some(row => row.event === chosen), { chosen, probe: observed.probe, owner: hoverOwner && [hoverOwner.event, hoverOwner.phase] });
  check('O3 raw: transports as installed: fetch/xhr/eventsource/websocket/worker/shared_worker wrapped; beacon and service_worker present and not wrapped',
    JSON.stringify(pageRow?.observes?.transports) === JSON.stringify({ fetch: 'wrapped', xhr: 'wrapped', eventsource: 'wrapped', websocket: 'wrapped', worker: 'wrapped', shared_worker: 'wrapped', beacon: 'not_wrapped', service_worker: 'not_wrapped' }),
    pageRow?.observes?.transports);
  const realmLimits = own.filter(row => row.kind === 'capture.limit' && row.feature === 'realm');
  const realmStatus = new Map(realmLimits.map(row => [row.realm_id, row.same_origin]));
  for (const row of own.filter(value => value.kind === 'capture.realm')) realmStatus.set(row.realm_id, row.same_origin);
  const briefLimit = realmLimits.find(row => row.via === 'inserted' && row.same_origin === false && Number(row.sequence) > Number(clickNamed('Show frame')?.sequence));
  check('O4 raw: one capture.limit per child frame (3: the static same-origin and other-port frames, and the brief other-origin frame recorded when inserted), content never read (url only when same-origin)',
    realmLimits.length === 3 && [...realmStatus.values()].filter(Boolean).length === 1 && [...realmStatus.values()].filter(value => value === false).length === 2 && briefLimit && observed.frames_after_brief === 2
    && realmLimits.every(row => row.realm_kind === 'frame') && own.filter(row => row.kind === 'capture.realm').every(row => row.same_origin === false ? row.url === null : true),
    { limits: realmLimits.map(row => [row.realm_id, row.same_origin, row.url]), updates: own.filter(row => row.kind === 'capture.realm').map(row => [row.realm_id, row.same_origin]) });
  const workerLimits = own.filter(row => row.kind === 'capture.limit' && row.feature === 'worker_fetch');
  check('O5 raw: one worker_fetch capture.limit per worker created (1: /worker.js)', workerLimits.length === 1 && workerLimits[0].script_url === '/worker.js'
    && own.filter(row => row.kind === 'worker.create').length === 1, workerLimits);
  const byeSpans = rawSpans.filter(span => span.kind === 'server' && route(span) === '/api/bye');
  check('O6 raw: the pagehide beacon reached the server with no browser request row (not wrapped) and no parent', byeSpans.length === 1 && !byeSpans[0].parent_span_id
    && !requests.some(row => String(row.url).includes('/api/bye')), byeSpans.map(span => [span.span_id, span.parent_span_id]));

  const coverage = store.coverageFor(session);
  const unobserved = coverage.unobserved || [];
  const eventsEntry = unobserved.find(entry => entry.kind === 'events');
  check(allObserved ? 'C1 coverage.unobserved: no event kinds entry (the page listened for every kind it exposes)'
    : 'C1 coverage.unobserved: the event kinds entry names exactly the page\'s unobserved kinds (the chosen one included), with a reason',
    allObserved ? !eventsEntry && events.unobserved.length === 0
      : eventsEntry && JSON.stringify(eventsEntry.names) === JSON.stringify(events.unobserved) && eventsEntry.names.includes(chosen) && /starts an action only for click, focusin, change, input, keydown, submit|starts an action only for/u.test(eventsEntry.reason),
    eventsEntry && { count: eventsEntry.count, reason: eventsEntry.reason });
  check('C2 coverage.unobserved: transports beacon and service_worker (present, not wrapped), nothing wrapped listed',
    JSON.stringify(unobserved.filter(entry => entry.kind === 'transport' && entry.status === 'not_wrapped').map(entry => entry.name).sort()) === JSON.stringify(['beacon', 'service_worker']),
    unobserved.filter(entry => entry.kind === 'transport'));
  const frameEntry = unobserved.find(entry => entry.kind === 'realm' && entry.name === 'frame');
  const workerEntry = unobserved.find(entry => entry.kind === 'realm' && entry.name === 'worker');
  check('C3 coverage.unobserved: realms: 3 frames (1 same-origin, 2 cross-origin, the brief one included) and 1 worker (/worker.js), each with a reason',
    frameEntry?.count === 3 && frameEntry.same_origin === 1 && frameEntry.cross_origin === 2 && workerEntry?.count === 1 && workerEntry.workers[0].script_url === '/worker.js'
    && [frameEntry, workerEntry].every(entry => typeof entry.reason === 'string' && entry.reason.length > 20), { frameEntry, workerEntry });
  check('C4 page coverage: complete false; reasons name the capture limits and each unobserved realm; delivery itself is contiguous',
    coverage.complete === false && coverage.reasons.some(reason => reason.startsWith('capture.limit: 4 (')) && coverage.reasons.filter(reason => reason.startsWith('unobserved realm present: ')).length === 2
    && !coverage.reasons.some(reason => /gap|tail missing|dropped|malformed/u.test(reason)), coverage.reasons);

  // ---- The four actions, from raw rows first
  const save = clickNamed('Save note'); const syncOpen = clickNamed('Sync'); const confirm = clickNamed('Confirm sync'); const exporter = clickNamed('Export'); const openPanel = clickNamed('Open panel');
  check('A0 raw: one click row per control, in the driver\'s order (the Radix confirm button is in a portal; the opener carries aria-haspopup)', [save, syncOpen, confirm, exporter, openPanel].every(Boolean)
    && syncOpen.target?.attributes?.['aria-haspopup'] === 'dialog' && !confirm.target?.attributes?.['aria-haspopup'], actions.map(row => [row.event, row.target?.attributes, row.gesture]));
  if (![save, syncOpen, confirm, exporter, openPanel].every(Boolean)) throw new Error(`clicks: ${JSON.stringify(actions.map(row => [row.sequence, row.event]))}`);
  const reqOf = action => requests.filter(row => row.action_id === action?.action_id);
  const [saveReq] = reqOf(save); const [syncReq] = reqOf(confirm); const [exportReq] = reqOf(exporter);
  const saveServer = saveReq ? serverOf(saveReq)[0] : null; const syncServer = syncReq ? serverOf(syncReq)[0] : null; const exportServer = exportReq ? serverOf(exportReq)[0] : null;
  const outboundOf = server => (server ? underTrace(server, span => span.kind === 'client' && !span.attributes?.['db.system']) : []);
  check('A1 raw: Save note → POST /api/notes joined exactly; its trace has no outbound client span; no root server span starts in its window',
    saveReq?.url === '/api/notes' && saveServer && outboundOf(saveServer).length === 0 && underTrace(saveServer, span => span.attributes?.['db.system']).length === 1
    && !rootServers.some(span => startMs(span) >= Number(save.timestamp) && startMs(span) < Number(syncOpen.timestamp)), { saveReq: saveReq?.url, outbound: outboundOf(saveServer).length });
  const notify = rootServers.find(span => route(span) === '/api/notify');
  check('A2 raw: the sync handler\'s raw-socket call started a new root trace (/api/notify: no parent) during the sync server span; no client span (hop) recorded it',
    syncReq?.url === '/api/sync' && syncServer && notify && !notify.parent_span_id && notify.trace_id !== syncServer.trace_id
    && startMs(notify) >= startMs(syncServer) && startMs(notify) <= endMs(syncServer) && outboundOf(syncServer).length === 0,
    { notify: notify && [notify.trace_id, notify.parent_span_id], sync: syncServer && [syncServer.trace_id, startMs(syncServer), endMs(syncServer)] });
  const exportOutbound = outboundOf(exportServer);
  check('A3 raw: the export handler\'s node:http call is one client span under the joined server span, and no server span continues it',
    exportReq?.url === '/api/export' && exportOutbound.length === 1 && !rawSpans.some(span => span.kind === 'server' && span.parent_span_id === exportOutbound[0].span_id)
    && externalHits.some(hit => hit.startsWith('POST /hook traceparent=yes')), { exportOutbound: exportOutbound.map(span => [span.name, span.attributes?.['http.url'] ?? span.attributes?.['url.full']]), externalHits });
  const hover = requests.find(row => String(row.url) === '/api/hover-note');
  check(allObserved ? 'A4 raw: the armed listener\'s request left the page owned by the hover row it ran under, after Open panel, with no discrete dispatch in between'
    : 'A4 raw: the armed listener\'s request left the page with no action_id and no first-party frame (issuer unknown), after Open panel and before the next dispatch',
    allObserved ? hover && hoverOwner && hoverOwner.coalesced === true && hover.sequence > openPanel.sequence && !actions.some(row => row.sequence > openPanel.sequence && row.sequence < hover.sequence && !row.coalesced && row.gesture !== false && row.gesture_id !== openPanel.gesture_id)
      : hover && !hover.action_id && Array.isArray(hover.issuer?.function_ids) && hover.issuer.function_ids.length === 0 && !hover.issuer.task
        && hover.sequence > openPanel.sequence && !actions.some(row => row.sequence > openPanel.sequence && row.sequence < hover.sequence), hover && { sequence: hover.sequence, issuer: hover.issuer, action_id: hover.action_id });
  check('A5 raw: Open panel itself sent nothing', reqOf(openPanel).length === 0, reqOf(openPanel));

  // ---- Rule 3: the plain case keeps "terminal effect observed"; escaped hops never do
  const saveChain = callTool(store, 'action_chain', { action_id: save.action_id });
  check('F1 plain: Save note stops at none (terminal effect observed); no escape; its window adds no coverage reason',
    saveChain.stopped_at === null && saveChain.reached === 'db' && /stopped at none \(terminal effect observed\)/u.test(saveChain.summary.split('\n')[0])
    && saveChain.escape === undefined && !saveChain.coverage.window_reasons && saveChain.outcome.status === 'completed' && !/escaped/u.test(saveChain.outcome.label),
    [saveChain.stopped_at, saveChain.because, saveChain.coverage.window_reasons]);
  const syncChain = callTool(store, 'action_chain', { action_id: confirm.action_id });
  const ESCAPE = 'a further server-side hop may have escaped';
  const syncBecause = new RegExp(`^reached db \\(database write update syncs .*joined by exact span parentage\\); ${ESCAPE}: 1 server-side request in this window has no browser parent \\(listed as unlinked\\)$`, 'u');
  check('F2 root continuation: Confirm sync reads reached db / stopped at server_hop with the root-span clause, never "terminal effect observed"',
    syncChain.reached === 'db' && syncChain.stopped_at === 'server_hop' && syncBecause.test(syncChain.because) && !/terminal effect observed/u.test(syncChain.text)
    && syncChain.root_escape?.continuation_candidates === 1 && syncChain.root_escape.span_ids.includes(notify?.span_id), [syncChain.reached, syncChain.stopped_at, syncChain.because]);
  check('F3 root continuation: the root span is listed as unlinked under the sync action (the same span id as the raw /api/notify), with its DB op',
    syncChain.unlinked?.server_spans?.some(entry => entry.span_id === notify?.span_id && entry.db_ops.some(op => op.operation === 'insert' && op.collection === 'notifications')),
    syncChain.unlinked?.server_spans?.map(entry => [entry.span_id, entry.route]));
  check('F4 root continuation: the outcome keeps "completed 200" and says a hop may have escaped; coverage is not complete, with the window reason',
    syncChain.outcome.status === 'completed' && /^Completed 200: update syncs.*; a further server-side hop may have escaped$/u.test(syncChain.outcome.label)
    && syncChain.outcome.sentence.endsWith(`; ${ESCAPE}: 1 server-side request in this window has no browser parent (listed as unlinked)`)
    && syncChain.coverage.complete === false && syncChain.coverage.window_reasons?.some(reason => reason.startsWith('1 server span(s) in this action\'s window have no browser parent')),
    { label: syncChain.outcome.label, window_reasons: syncChain.coverage.window_reasons });
  const syncSegment = syncChain.segments.find(segment => segment.path === '/api/sync');
  check('F5 root continuation: the request segment says the same (stopped_at server_hop, the escape in its summary bracket)',
    syncSegment?.stopped_at === 'server_hop' && /\[completed 200; a further server-side hop may have escaped/u.test(syncSegment.summary), syncSegment && [syncSegment.stopped_at, syncSegment.summary]);
  const exportChain = callTool(store, 'action_chain', { action_id: exporter.action_id });
  const outboundUrl = `${externalOrigin}/hook`;
  // One source (fix/server-outbound): the hop the frontier names, the additional stop and the coverage reason are the same span.
  const hopReason = chain => (chain.coverage.window_reasons || []).find(reason => /server-side hop\(s\) not followed/u.test(reason)) || '';
  check('F6 unfollowed outbound call: Export stops at server_hop naming the hop once (frontier, additional stop and coverage reason cite the same span)',
    exportChain.stopped_at === 'server_hop' && exportChain.because.endsWith(`; ${ESCAPE}: 1 hop(s) not followed: 1 with no receiving span (POST ${outboundUrl})`)
    && (exportChain.additional_stops || []).filter(stop => stop.reached === 'outbound').length === 1 && exportChain.additional_stops.find(stop => stop.reached === 'outbound').span_id === exportOutbound[0]?.span_id
    && hopReason(exportChain).includes(`span ${exportOutbound[0]?.span_id}`) && hopReason(exportChain).startsWith('1 server-side hop(s) not followed') && !exportChain.root_escape
    && (exportChain.because.match(new RegExp(ESCAPE, 'gu')) || []).length === 1,
    [exportChain.stopped_at, exportChain.because, exportChain.coverage.window_reasons, exportChain.additional_stops]);
  check('F7 the root span does not surface under a later unrelated action: Export\'s window does not list it',
    !(exportChain.unlinked?.server_spans || []).some(entry => entry.span_id === notify?.span_id), exportChain.unlinked?.server_spans?.map(entry => entry.span_id));
  // Grader probe g (both must read server_hop with complete: false).
  for (const [name, path2, hook] of [['Batch', '/api/batch', 'hook-batch'], ['Seq', '/api/seq', 'hook-seq']]) {
    const action = clickNamed(name);
    const chain = callTool(store, 'action_chain', { action_id: action.action_id });
    const [request] = reqOf(action); const serverSpan = request ? serverOf(request)[0] : null;
    const clients = outboundOf(serverSpan).filter(span => /^https?:/u.test(String(span.attributes?.['url.full'] ?? span.attributes?.['http.url'] ?? '')));
    const toSecond = clients.find(span => String(span.attributes?.['url.full'] ?? span.attributes?.['http.url']).includes(`:${secondPort}/b/work`));
    const toExternal = clients.find(span => String(span.attributes?.['url.full'] ?? span.attributes?.['http.url']).endsWith(`/${hook}`));
    check(`G ${name} (probe g): the call to the second process is followed, the call to the external service is its own hop and escaped: server_hop, complete: false`,
      request?.url === path2 && toSecond && rawSpans.some(span => span.kind === 'server' && span.parent_span_id === toSecond.span_id) && toExternal
      && chain.stopped_at === 'server_hop' && chain.because.endsWith(`; ${ESCAPE}: 1 hop(s) not followed: 1 with no receiving span (POST ${externalOrigin}/${hook})`)
      && chain.coverage.complete === false && hopReason(chain).includes(`span ${toExternal.span_id}`) && externalHits.some(hit => hit.startsWith(`POST /${hook} traceparent=yes`))
      && !/terminal effect observed/u.test(chain.text),
      [chain.stopped_at, chain.because, chain.coverage.window_reasons, clients.map(span => span.attributes?.['url.full'] ?? span.attributes?.['http.url'])]);
  }

  // ---- Rule 4: a no_request action states the unattributed request in its headline
  const panelChain = callTool(store, 'action_chain', { action_id: openPanel.action_id });
  const panelBase = "no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; transports and realms Tracer does not record are listed in coverage.unobserved)";
  // With every kind observed, the window holds no unattributed request: the plain scoped absence.
  const panelHead = allObserved ? 'no request could be attributed to this action from instrumented code (requests from uninstrumented scripts, workers and third-party code cannot be linked; any seen in this window are listed below as unlinked)'
    : `${panelBase}; 1 recorded request left this page during this action's window that Tracer could not attribute (POST /api/hover-note, issuer unknown), listed below as unlinked`;
  check('H1 Open panel: stopped at browser; the headline names the request that left the page (method, path, issuer unknown)',
    panelChain.stopped_at === 'browser' && panelChain.because === panelHead && panelChain.summary.split('\n')[0].endsWith(`because ${panelHead}`), [panelChain.stopped_at, panelChain.because]);
  check(allObserved ? 'H2 Open panel: outcome no_request names no unattributed request (the hover request has an owner)' : 'H2 Open panel: outcome no_request says so in its label, sentence and bracket',
    allObserved ? panelChain.outcome.status === 'no_request' && !/recorded request left this page/u.test(`${panelChain.outcome.label} ${panelChain.outcome.sentence} ${panelChain.summary}`)
      : panelChain.outcome.status === 'no_request' && panelChain.outcome.label.endsWith("; 1 recorded request left this page during this action's window that Tracer could not attribute (POST /api/hover-note, issuer unknown)")
        && panelChain.outcome.sentence.includes("listed in coverage.unobserved); 1 recorded request left this page") && /\[outcome no_request; .*1 recorded request left this page/u.test(panelChain.summary),
    panelChain.outcome);
  check(allObserved ? 'H3 Open panel: coverage not complete: the beacon\'s root span in its window (page end); no unknown-issuer request'
    : 'H3 Open panel: coverage not complete: the unknown-issuer request and the beacon\'s root span in its window (page end)',
    panelChain.coverage.complete === false && (allObserved ? !panelChain.coverage.window_reasons.some(reason => reason.includes('no known issuer'))
      : panelChain.coverage.window_reasons?.[0] === "1 request(s) left this page in this action's window not attributed to any user action and with no known issuer (listed as unlinked)")
    && panelChain.coverage.window_reasons.some(reason => reason.startsWith('1 server span(s) in this action\'s window have no browser parent')) && panelChain.unlinked.server_spans.some(entry => entry.route === '/api/bye'),
    panelChain.coverage.window_reasons);
  // ---- Regrade items 2-5 (RUN-2)
  const events2 = pageRow?.observes?.events;
  check('E1 event kinds with no on* property are included (focusout, composition*, touch*) and the list says it is a lower bound',
    events2?.lower_bound === true && (allObserved ? ['focusout', 'compositionstart', 'touchstart'].every(name => events2.recorded.includes(name))
      : ['focusout', 'compositionstart', 'touchstart'].every(name => events2.unobserved.includes(name)) && eventsEntry?.lower_bound === true && /at least \d+ event kind/u.test(eventsEntry.reason)),
    { lower_bound: events2?.lower_bound, has_focusout: events2?.unobserved.includes('focusout') });
  const frameClick = clickNamed('Show frame');
  const frameChain = callTool(store, 'action_chain', { action_id: frameClick.action_id });
  check('T1 the brief frame (inserted 50 ms after the click, removed 400 ms later) is a realm row in the click\'s window and a window reason',
    frameChain.coverage.complete === false && frameChain.coverage.window_reasons?.some(reason => reason === "1 child frame(s) appeared in this action's window (0 same-origin, 1 cross-origin): code in a frame is not recorded"),
    frameChain.coverage.window_reasons);
  const ping = clickNamed('Ping socket');
  const sends = own.filter(row => row.kind === 'network.send');
  const socketRoot = rootServers.find(span => route(span) === '/api/ws-write');
  check('W1 raw: the socket message is a network.send row (2 bytes, owned by the Ping click, never its content); the socket server\'s write is a root trace in its window',
    sends.length === 1 && sends[0].action_id === ping.action_id && sends[0].bytes === 2 && !('data' in sends[0]) && socketRoot && !socketRoot.parent_span_id
    && startMs(socketRoot) >= Number(ping.timestamp) && socketWrites.length === 1, { sends, socketRoot: socketRoot && route(socketRoot) });
  const pingChain = callTool(store, 'action_chain', { action_id: ping.action_id });
  check('W2 the Ping action stops at the socket (never "issued no request" alone) and is not complete: the send and the root span are reasons',
    pingChain.stopped_at === 'websocket' && /^sent 1 WebSocket message on ws:\/\/127\.0\.0\.1:\d+\/ws \(2 bytes\); a message carries no trace context/u.test(pingChain.because)
    && pingChain.outcome.status === 'stopped' && pingChain.outcome.label.startsWith('Stopped at websocket: sent 1 WebSocket message') && !/issued no request/u.test(pingChain.outcome.label)
    && pingChain.coverage.complete === false && pingChain.coverage.window_reasons.some(reason => reason.startsWith('1 WebSocket message(s) sent in this action\'s window'))
    && pingChain.coverage.window_reasons.some(reason => reason.startsWith('1 server span(s) in this action\'s window have no browser parent')) && pingChain.stops.some(stop => stop.stop === 'websocket_send' && stop.bytes === 2),
    [pingChain.stopped_at, pingChain.because, pingChain.outcome.label, pingChain.coverage.window_reasons]);
  const lastSummary = own.filter(row => row.kind === 'capture.summary').at(-1);
  check('X1 a transport wrapper replaced after install is reported at the summary and in coverage',
    JSON.stringify(lastSummary?.wrapper_replaced) === JSON.stringify(['fetch']) && coverage.reasons.includes('transport wrapper replaced after install: fetch (its requests may not be recorded)')
    && unobserved.some(entry => entry.kind === 'transport' && entry.name === 'fetch' && entry.status === 'replaced'), lastSummary?.wrapper_replaced);
  const lastRuntime = Math.max(...own.filter(row => row.kind !== 'capture.received').map(row => Number(row.timestamp)).filter(Number.isFinite));
  const lateRoot = rootServers.find(span => route(span) === '/api/notes' && startMs(span) > lastRuntime + 2000);
  const allUnlinked = [...actions].flatMap(action => callTool(store, 'action_chain', { action_id: action.action_id }).unlinked?.server_spans || []);
  check('P2 page end: the last window ends at the last runtime row + 2 s (never collector close); a root span after that is in no window of the page',
    Boolean(lateRoot) && panelChain.unlinked.window.until === 'page_end' && panelChain.unlinked.window.page_end_grace_ms === 2000 && panelChain.unlinked.window.until_timestamp === lastRuntime + 2000
    && !allUnlinked.some(entry => entry.span_id === lateRoot.span_id) && observed.late_root === 201,
    { lateRoot: lateRoot && startMs(lateRoot), lastRuntime, window: panelChain.unlinked.window });
  const syncOpenChain = callTool(store, 'action_chain', { action_id: syncOpen.action_id });
  check('H4 the dialog opener (no request, nothing left the page in its window) keeps the plain scoped sentence',
    syncOpenChain.stopped_at === 'browser' && syncOpenChain.because.startsWith('no request could be attributed to this action from instrumented code (') && !syncOpenChain.coverage.window_reasons,
    [syncOpenChain.because, syncOpenChain.coverage.window_reasons]);

  // ---- Rule 5: page_requests wording
  const pageRequests = callTool(store, 'page_requests', { session });
  const hoverEntry = pageRequests.requests.find(row => row.path === '/api/hover-note');
  check(allObserved ? 'P1 page_requests: the hover request is attributed to its hover row; no entry reads "no user action"' : 'P1 page_requests: the unattributed request reads "not attributed to any user action" plus what the stack showed, never "no user action"',
    (allObserved ? hoverEntry?.attribution.kind === 'action' && hoverEntry.attribution.action_id === hoverOwner?.action_id
      : hoverEntry?.attribution.text.startsWith('not attributed to any user action; no first-party frame recorded for this request')) && !/no user action/u.test(JSON.stringify(pageRequests))
    && /\d+ not attributed to any user action/u.test(pageRequests.summary), hoverEntry?.attribution.text);

  // ---- Rule 6: one source: export, chain display and every MCP surface agree
  for (const [name, action, chain] of [['save', save, saveChain], ['sync', confirm, syncChain], ['export', exporter, exportChain], ['panel', openPanel, panelChain], ['ping', clickNamed('Ping socket'), callTool(store, 'action_chain', { action_id: clickNamed('Ping socket').action_id })]]) {
    const row = exported.get(action.action_id);
    const recent = callTool(store, 'recent_actions', { session, n: 50 }).actions.find(value => value.action_id === action.action_id);
    // The export writes `because: null` for a joined DB stop (its own format, unchanged); the escape clause and the headline must match.
    const tail = text => { const at = (text || '').indexOf('a further server-side hop may have escaped'); return at >= 0 ? text.slice(at) : (text || ''); };
    check(`S1 ${name}: exported chain, chain display and recent_actions carry the same stopped_at, because (escape clause / headline) and outcome label as action_chain`,
      row && row.stopped_at === chain.stopped_at && (chain.stopped_at === null ? row.because === null : tail(row.because) === tail(chain.because)) && row.outcome.label === chain.outcome.label && chain.chain.display.label === chain.outcome.label
      && recent?.stopped_at === chain.stopped_at && recent.because === chain.because && recent.outcome.label === chain.outcome.label && recent.coverage.complete === chain.coverage.complete,
      { exported: row && [row.stopped_at, row.because, row.outcome.label], mcp: [chain.stopped_at, chain.because, chain.outcome.label] });
  }

  // ---- The same answers over stdio (as an agent runs the MCP server)
  const stdioSync = await call('action_chain', { action_id: confirm.action_id });
  const stdioPanel = await call('action_chain', { action_id: openPanel.action_id });
  const stdioSave = await call('action_chain', { action_id: save.action_id });
  const stdioExport = await call('action_chain', { action_id: exporter.action_id });
  const stdioRequests = await call('page_requests', { session });
  check('M1 stdio: action_chain answers equal the in-process ones (frontier, outcome, coverage, unobserved)',
    [[stdioSync, syncChain], [stdioPanel, panelChain], [stdioSave, saveChain], [stdioExport, exportChain]].every(([left, right]) => left.stopped_at === right.stopped_at && left.because === right.because
      && JSON.stringify(left.outcome) === JSON.stringify(right.outcome) && JSON.stringify(left.coverage) === JSON.stringify(right.coverage)),
    [stdioSync.stopped_at, stdioPanel.because]);
  check('M2 stdio: the summary text carries the escape sentence, the headline and the "Not observed" line',
    syncBecause.test(stdioSync.because) && stdioSync.text.includes(stdioSync.because) && stdioPanel.text.includes(panelHead)
    && new RegExp(`\\nNot observed on page s_[0-9a-f]+ \\(from its rows; not exhaustive: [^)]*\\): ${allObserved ? '' : 'at least \\d+ event kind\\(s\\) that start no action; '}transport beacon not wrapped; transport service_worker not wrapped; transport fetch wrapper replaced; 3 frame realm\\(s\\) \\(1 same-origin, 2 cross-origin\\); 1 worker realm\\(s\\)`, 'u').test(stdioSave.text)
    && stdioSave.text.includes('Coverage incomplete for page'),
    stdioSave.text.split('\n').slice(-2));
  check('M3 stdio: page_requests wording', (allObserved ? stdioRequests.requests.find(row => row.path === '/api/hover-note')?.attribution.kind === 'action'
    : stdioRequests.requests.find(row => row.path === '/api/hover-note')?.attribution.text.startsWith('not attributed to any user action;')) && !/no user action/u.test(stdioRequests.text), stdioRequests.text.split('\n')[0]);
  report.answers = { sync: stdioSync.text, panel: stdioPanel.text, save: stdioSave.text, export: stdioExport.text, page_requests: stdioRequests.text.split('\n').slice(0, 8).join('\n'), coverage };
} finally {
  await client.close();
}

const failed = checks.filter(entry => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${JSON.stringify(entry.detail).slice(0, 1500)}`}`);
console.log(`${checks.length - failed.length}/${checks.length} checks pass; store ${storeDir}`);
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'honest-coverage-report.json'), `${JSON.stringify(report, null, 2)}\n`); }
fixture.cleanup();
if (failed.length) process.exitCode = 1; else if (!outDir && process.env.TRACER_KEEP_STORE !== '1') fs.rmSync(storeDir, { recursive: true, force: true });
