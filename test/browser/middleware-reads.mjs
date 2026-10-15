// Middleware reads (headless, neutral fixture): every database operation in a
// request's server trace is attributed to that request and named by the
// server code that issued it.
//
// A one-file React app (fixtures/middleware-reads-app/main.jsx, TanStack Query
// mutations) is built with both Tracer plugins; its rows ship through the
// real collector sink into a real store. Its API is a CommonJS Express app
// (fixtures/middleware-reads-app/server.cjs) on the real `mongodb` driver and
// the local Mongo, run under `node --import producttrace/backend/register`:
// an auth middleware reads `users` on every request (and answers 401 itself),
// a Router mounted under /api/projects has a `router.param` read (and answers
// 404 itself), a path-scoped middleware writes, an error middleware reads and
// answers 500, a handler keeps working after its 202, and one route sits in
// front of the auth middleware (the plain case).
//
// Every answer is recomputed here from the raw rows and spans (this file
// imports nothing from analysis/ for that), then read back through the MCP
// over stdio as an agent would, plus the export and the live viewer's chain.
// The whole session runs N times (default 3); the per-action answers must be
// identical across runs.
//
//   node test/browser/middleware-reads.mjs [dependencyRoot] [--runs 3] [--out <dir>]
//
// Needs the local Mongo at 127.0.0.1:27017 (db producttrace_test_middleware,
// dropped before and after each run); skips with a message when it is down.
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
import { loadStore } from '../../collector/store.mjs';
import { buildActionChains } from '../../analysis/runtime-attribution.mjs';
import { buildEpisodeChain } from '../../analysis/causal-chain.mjs';
import { indexWorkflowEpisodes } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null; };
const outDir = option('--out') ? path.resolve(option('--out')) : null;
const runs = Number(option('--runs') || 3);
const positional = argv.filter((value, index) => !value.startsWith('--') && !['--out', '--runs'].includes(argv[index - 1]));
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/middleware-reads-app');
const MONGO_URL = 'mongodb://127.0.0.1:27017';
const DB_NAME = 'producttrace_test_middleware';

const { MongoClient } = createRequire(import.meta.url)('mongodb');
const mongo = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 2000 });
try { await mongo.connect(); await mongo.db('admin').command({ ping: 1 }); } catch (error) {
  console.log(`SKIP middleware-reads: no Mongo at ${MONGO_URL} (${error.message}); start it (e.g. docker start producttrace-librechat-mongo) and rerun`);
  process.exit(0);
}
const dropDb = () => mongo.db(DB_NAME).dropDatabase();

// The build bakes the collector URL in: one free loopback port, reused by every run's collector.
const collectorPort = await new Promise(resolve => { const probe = http.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const fixture = await buildReactFixture({ dependencyRoot, name: 'middleware-reads', appSource: fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8'),
  pluginOptions: { collector: { url: `http://127.0.0.1:${collectorPort}`, force: true } } });
const tanstackVersion = JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'node_modules/@tanstack/react-query/package.json'), 'utf8')).version;
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');

// The actions, in the order the session clicks them.
const ORDER = ['count', 'guest', 'tasks', 'rename', 'summary', 'ping', 'archive', 'explode', 'missing', 'stats', 'owner', 'whoami'];

// ---- raw recomputation (independent of analysis/: attributes and ids only)
const WRITE = /^(?:insert|update|delete|remove|replace|findandmodify|bulk)/iu;
const isDb = span => Boolean(span.attributes?.['db.system'] ?? span.attributes?.['db.system.name']);
/** The code a span names (raw attributes), or null. */
function names(span) {
  const a = span.attributes || {};
  if (span.instrumentation?.name === 'producttrace-express-handlers') {
    const kind = a['producttrace.express.handler.kind'];
    return `${kind === 'param' ? 'param' : kind === 'error_middleware' ? 'error handler' : 'handler'}: ${a['producttrace.express.handler.name'] || '<anonymous>'}`;
  }
  if (a['express.type'] === 'middleware') return `middleware: ${a['express.name'] || '<anonymous>'}`;
  if (a['express.type'] === 'request_handler') return `route: ${a['http.route'] || '<anonymous>'}`;
  if (a['express.type'] === 'router') return `router: ${a['express.name'] || '<anonymous>'}`;
  return null;
}
/** Nearest naming ancestor; the app's own spans passed on the way are named too (raw recomputation). */
function issuerOf(ancestors) {
  const via = [];
  for (const span of ancestors) {
    const named = names(span);
    if (named) return via.length ? `${named} (in app span ${via.join(' < ')})` : named;
    if (span.kind !== 'server' && !isDb(span)) via.push(span.name);
  }
  return via.length ? `app span: ${via[0]}` : 'issuer: unknown';
}
const ms = value => (Array.isArray(value) ? value[0] * 1e3 + value[1] / 1e6 : Number(value));
function rawRequest(request, spans) {
  const trace = spans.filter(span => span.trace_id === request.trace_context?.trace_id);
  const byId = new Map(trace.map(span => [span.span_id, span]));
  const servers = trace.filter(span => span.kind === 'server' && span.parent_span_id === request.trace_context?.span_id);
  if (servers.length !== 1) return { server: null, servers: servers.length };
  const server = servers[0];
  const chainUp = span => { const out = []; let cursor = span.parent_span_id; while (cursor && cursor !== server.span_id) { const parent = byId.get(cursor); if (!parent) return null; out.push(parent); cursor = parent.parent_span_id; } return cursor === server.span_id ? out : null; };
  const under = trace.filter(span => span !== server && chainUp(span));
  const ops = under.filter(isDb).map(span => ({ span_id: span.span_id, trace_id: span.trace_id, operation: span.attributes['db.operation.name'] ?? span.attributes['db.operation'],
    collection: span.attributes['db.collection.name'] ?? span.attributes['db.mongodb.collection'], start: ms(span.start_time),
    issued_by: issuerOf(chainUp(span)) })).sort((left, right) => left.start - right.start);
  const writers = [server, ...under].filter(span => span.attributes?.['producttrace.response.status_code'] != null);
  const handlers = under.filter(span => span.instrumentation?.name === 'producttrace-express-handlers' && !['param', 'error_middleware'].includes(span.attributes['producttrace.express.handler.kind']));
  return { server, status: server.attributes['http.status_code'] ?? server.attributes['http.response.status_code'], end: ms(server.end_time), ops,
    writer: writers.length === 1 ? (names(writers[0]) || 'issuer: unknown') : null, writers: writers.length,
    handlers: handlers.map(span => span.attributes['producttrace.express.handler.name']) };
}
const opText = op => `${op.operation} ${op.collection} (${op.issued_by})`;

// ---- one session
async function session(run) {
  await dropDb();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), `tracer-middleware-reads-store-${run}-`));
  const collector = createCollector({ port: collectorPort, store: { dir: storeDir, manifest: null, label: `middleware-reads-${run}` } });
  await collector.ready;
  const backend = spawn(process.execPath, ['--import', 'producttrace/backend/register', path.join(fixtureDir, 'server.cjs')], {
    cwd: tracerRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `${collector.url}/spans`, PRODUCTTRACE_SERVICE_NAME: 'middleware-reads-api',
      FIXTURE_MONGO_URL: MONGO_URL, FIXTURE_MONGO_DB: DB_NAME },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendOutput = '';
  backend.stderr.on('data', chunk => { backendOutput += chunk; });
  const backendExited = new Promise(resolve => backend.once('exit', code => resolve(code)));
  const backendPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend did not start:\n${backendOutput}`)), 20_000);
    backend.stdout.on('data', chunk => { backendOutput += chunk; const match = /listening (\d+)/u.exec(backendOutput); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`backend exited ${code}:\n${backendOutput}`)); });
  });
  // Front server: the build, and /api/* proxied with every header (traceparent included).
  const front = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://front');
    if (url.pathname.startsWith('/api/')) {
      const upstream = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
      req.pipe(upstream); return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(fixture.distRoot, relative);
    if (!file.startsWith(`${fixture.distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${front.address().port}`;
  const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
  const observed = { page_errors: [], states: {}, responses: {} };
  let pageSession = null;
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => observed.page_errors.push(`${error.name}: ${error.message}`));
    page.on('response', response => { const pathname = new URL(response.url()).pathname; if (pathname.startsWith('/api/')) (observed.responses[pathname] ||= []).push(response.status()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    for (const testid of ORDER) {
      await page.getByTestId(testid).click();
      await page.waitForFunction(id => !['idle', 'working'].includes(document.querySelector(`[data-testid="${id}-state"]`)?.textContent), testid, { timeout: 10_000 });
      observed.states[testid] = await page.getByTestId(`${testid}-state`).textContent();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(400); // the archive's deferred writes land 40 ms after its 202
    pageSession = await page.evaluate(() => globalThis.__productTraceRuntime.session);
    await page.goto('about:blank'); await page.waitForTimeout(800);
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => front.close(resolve));
    backend.kill('SIGTERM'); await backendExited;
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  await collector.close();
  await dropDb();
  return { storeDir, observed, session: pageSession };
}

// ---- checks for one run
async function grade(run, { storeDir, observed, session: pageSession }) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name: `run ${run}: ${name}`, pass: Boolean(pass), detail });
  const { records, spans } = await loadStore({ dir: storeDir });
  const actions = records.filter(row => row.kind === 'dom.action' && row.capture_page_id === pageSession && row.event === 'click');
  const actionOf = testid => actions.filter(row => row.target?.attributes?.['data-testid'] === testid).at(-1) || null;
  check('page ran without errors; every click settled', observed.page_errors.length === 0 && ORDER.every(testid => observed.states[testid] && observed.states[testid] !== 'idle'), observed);

  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath, '--source-root', fixture.repository], stderr: 'ignore' });
  const client = new Client({ name: 'middleware-reads', version: '1' });
  await client.connect(transport);
  const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };
  const exported = new Map(buildActionChains(records.filter(row => row.kind !== 'element.stamp'), spans, { backendInstrumented: true }).map(row => [row.action_id, row]));
  const episodes = indexWorkflowEpisodes(records);
  const signature = {};
  const answers = {};
  try {
    for (const testid of ORDER) {
      const action = actionOf(testid);
      const requests = records.filter(row => row.kind === 'network.request' && row.action_id === action?.action_id && row.internal !== true && row.transport_internal !== true);
      if (!action || requests.length !== 1) { check(`${testid}: one click with one attributed request`, false, { action: action?.action_id, requests: requests.length }); continue; }
      const raw = rawRequest(requests[0], spans);
      const chain = await call('action_chain', { action_id: action.action_id });
      const segment = chain.segments?.[0];
      answers[testid] = { action_id: action.action_id, raw, chain, segment };
      // Rule 1: every db span under the server span, in the same trace, each with its issuer.
      check(`${testid}: MCP segment ops = every raw db span under the server span (span ids, start order)`, JSON.stringify(segment?.db_ops.map(op => op.span_id)) === JSON.stringify(raw.ops.map(op => op.span_id)),
        { mcp: segment?.db_ops.map(opText), raw: raw.ops.map(opText) });
      check(`${testid}: each op names the code that issued it (raw nearest naming ancestor)`, JSON.stringify(segment?.db_ops.map(op => op.issued_by)) === JSON.stringify(raw.ops.map(op => op.issued_by)),
        segment?.db_ops.map(opText));
      check(`${testid}: every op is in the request's own trace`, raw.ops.every(op => op.trace_id === requests[0].trace_context.trace_id), null);
      check(`${testid}: stops list the same ops`, JSON.stringify(chain.stops.filter(stop => stop.stop === 'db').map(stop => stop.span_id).sort()) === JSON.stringify(raw.ops.map(op => op.span_id).sort()), null);
      // Every surface through the one builder: export and the live viewer's chain carry the same ops and issuers.
      const exportOps = exported.get(action.action_id)?.requests?.[0]?.db_ops || [];
      check(`${testid}: export carries the same ops with issuers`, JSON.stringify(exportOps.map(op => `${op.span_id} ${op.issued_by}`).sort()) === JSON.stringify(raw.ops.map(op => `${op.span_id} ${op.issued_by}`).sort()), exportOps.map(op => op.issued_by));
      const episode = episodes.episodes.get(episodes.byAction.get(action.action_id));
      const live = episode ? buildEpisodeChain(episode, records, spans, { idle: true }) : null;
      const liveOps = (live?.chain || []).filter(step => step.kind === 'db.operation');
      check(`${testid}: live viewer chain carries the same ops with issuers and the same label`, JSON.stringify(liveOps.map(op => `${op.span_id} ${op.issued_by}`).sort()) === JSON.stringify(raw.ops.map(op => `${op.span_id} ${op.issued_by}`).sort())
        && live.display.label === chain.outcome.label && exported.get(action.action_id)?.outcome?.label === chain.outcome.label, [live?.display?.label, chain.outcome.label, exported.get(action.action_id)?.outcome?.label]);
      check(`${testid}: summary prints every op with its issuer`, raw.ops.every(op => segment.summary.includes(`${op.operation} ${op.collection}`) && segment.summary.includes(`(${op.issued_by})`)), segment?.summary);
      signature[testid] = { status: chain.outcome.status, label: chain.outcome.label, http: segment?.http_status, reached: chain.reached, stopped_at: chain.stopped_at, because: chain.because,
        ops: segment?.db_ops.map(opText), writer: raw.writer, deferred: segment?.deferred?.spans?.map(item => `${item.kind} ${item.issued_by || ''}`.trim()) || null, summary_tail: segment?.summary.slice(segment.summary.indexOf('[')).replace(/\d+(?:\.\d+)? ms/gu, 'N ms') }; // span clocks vary run to run; the words may not
    }
    const a = answers;
    const expectOps = (testid, list) => check(`${testid}: ops are ${list.join(', ')}`, JSON.stringify(a[testid]?.raw.ops.map(opText)) === JSON.stringify(list), a[testid]?.raw.ops.map(opText));
    // Plain case: in front of the auth middleware, only the handler reads.
    expectOps('count', ['aggregate $cmd (handler: countTasks)']);
    check('count: completed 200 on the handler read, stopped at none', a.count?.chain.outcome.label === 'Completed 200: aggregate $cmd' && a.count.chain.stopped_at === null, a.count?.chain.outcome.label);
    // Rule 3: middleware that ends the request is its terminal handler.
    expectOps('guest', ['find users (middleware: authenticate)']);
    check('guest: failed 401; stopped at middleware authenticate; no handler ran', a.guest?.chain.outcome.status === 'failed' && a.guest.chain.outcome.http_status === 401
      && a.guest.chain.stopped_at === 'middleware' && a.guest.chain.because === 'server responded 401 from middleware authenticate; no handler ran'
      && a.guest.segment.summary.includes('stopped at middleware authenticate (401); no handler ran') && a.guest.raw.writer === 'middleware: authenticate' && a.guest.raw.handlers.length === 0,
    [a.guest?.chain.outcome.label, a.guest?.chain.because, a.guest?.segment?.summary]);
    expectOps('missing', ['find users (middleware: authenticate)', 'find projects (param: loadProject)']);
    check('missing: failed 404; stopped at param loadProject; no handler ran', a.missing?.chain.outcome.status === 'failed' && a.missing.chain.stopped_at === 'middleware'
      && a.missing.chain.because === 'server responded 404 from param loadProject; no handler ran', [a.missing?.chain.outcome.label, a.missing?.chain.because]);
    expectOps('explode', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'aggregate $cmd (error handler: reportError)']);
    check('explode: failed 500; stopped at the error middleware after the handler', a.explode?.chain.outcome.status === 'failed' && a.explode.chain.outcome.http_status === 500
      && a.explode.chain.stopped_at === 'middleware' && a.explode.chain.because === 'server responded 500 from error handler reportError; after handler explodeProject', [a.explode?.chain.outcome.label, a.explode?.chain.because]);
    // Rules 1 and 2: reads in middleware and param callbacks belong to the request; a handler write completes it.
    expectOps('tasks', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'find tasks (handler: listTasks)']);
    check('tasks: completed 200', a.tasks?.chain.outcome.status === 'completed' && a.tasks.chain.stopped_at === null, a.tasks?.chain.outcome.label);
    expectOps('rename', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'update tasks (handler: renameTask)']);
    check('rename: read-only middleware + handler write = completed; the sentence names the writer', a.rename?.chain.outcome.label === 'Completed 200: update tasks'
      && a.rename.chain.outcome.sentence.includes('database write update tasks (handler: renameTask) joined under the request'), [a.rename?.chain.outcome.label, a.rename?.chain.outcome.sentence]);
    expectOps('summary', ['find users (middleware: authenticate)', 'insert activity (middleware: recordActivity)', 'find projects (param: loadProject)', 'aggregate $cmd (handler: summarizeProject)']);
    check('summary: middleware write + read-only handler = completed, and the label says which code wrote', a.summary?.chain.outcome.status === 'completed'
      && a.summary.chain.outcome.label === 'Completed 200: insert activity (middleware: recordActivity)', a.summary?.chain.outcome.label);
    expectOps('ping', ['find users (middleware: authenticate)', 'find projects (param: loadProject)']);
    check('ping: unsafe method with reads only = responded, no write observed', a.ping?.chain.outcome.status === 'responded' && a.ping.chain.outcome.note === 'no write observed', a.ping?.chain.outcome.label);
    // Never dropped: a database call inside the app's own span reaches its real issuer through the span's skeleton.
    expectOps('stats', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'aggregate $cmd (handler: projectStats (in app span loadStats))']);
    const loadStats = spans.filter(span => span.name === 'loadStats');
    check('stats: the app span shipped as a skeleton (ids, name, kind, times; no attributes but the marker)', loadStats.length === 1
      && JSON.stringify(Object.keys(loadStats[0].attributes)) === JSON.stringify(['producttrace.span.skeleton']) && loadStats[0].trace_id === a.stats?.raw.server?.trace_id, loadStats[0]);
    check('stats: completed 200 on the handler read', a.stats?.chain.outcome.status === 'completed' && a.stats.chain.stopped_at === null, a.stats?.chain.outcome.label);
    // Ruling 2026-09-24: route-level middleware is part of the handler; app-level middleware reads are preconditions.
    expectOps('owner', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'find users (handler: requireOwner)']);
    check('owner: the route-level middleware read completes the GET', a.owner?.chain.outcome.label === 'Completed 200: find users' && a.owner.chain.stopped_at === null, a.owner?.chain.outcome.label);
    expectOps('whoami', ['find users (middleware: authenticate)']);
    check('whoami: only preconditions: responded, named, no terminal effect claimed', a.whoami?.chain.outcome.status === 'responded'
      && a.whoami.chain.outcome.label === 'Responded 200: no database work after the preconditions (find users by middleware authenticate)'
      && a.whoami.chain.stopped_at === 'handler' && !/terminal effect observed/u.test(a.whoami.chain.summary), [a.whoami?.chain.outcome.label, a.whoami?.chain.stopped_at]);
    check('ping: only preconditions on an unsafe method: responded, no write observed, no terminal effect claimed',
      a.ping?.chain.stopped_at === 'handler' && a.ping.chain.because === 'no database work after the preconditions (find users by middleware authenticate, find projects by param loadProject)', [a.ping?.chain.stopped_at, a.ping?.chain.because]);
    // Rule 4: deferred work keeps its marking.
    expectOps('archive', ['find users (middleware: authenticate)', 'find projects (param: loadProject)', 'update projects (handler: archiveProject)', 'insert audit (handler: archiveProject)']);
    const lateRaw = a.archive ? a.archive.raw.ops.filter(op => op.start - a.archive.raw.end >= 1).map(op => op.span_id) : [];
    check('archive: the two writes after the 202 are deferred (and only they), named by their issuer', lateRaw.length === 2
      && JSON.stringify(a.archive.segment.deferred?.spans.filter(item => item.kind === 'db').map(item => item.span_id)) === JSON.stringify(lateRaw)
      && a.archive.segment.deferred.spans.every(item => item.kind !== 'db' || item.issued_by === 'handler: archiveProject') && /server work continued/u.test(a.archive.segment.summary), a.archive?.segment?.deferred);
    // Ops from another trace are never included: the background job's reads (its own traces, no server span) appear in no chain,
    // and no op is listed under two requests.
    const listedAll = Object.values(a).flatMap(entry => entry.segment?.db_ops.map(op => op.span_id) || []);
    const listed = new Set(listedAll);
    const jobOps = spans.filter(span => isDb(span) && !spans.some(other => other.kind === 'server' && other.trace_id === span.trace_id));
    check('ops outside every request trace (the background job) are in no chain; no op is listed twice', jobOps.length >= 3 && jobOps.every(span => !listed.has(span.span_id)) && listed.size === listedAll.length
      && !spans.some(span => span.name === 'job - count open projects'), // the job's own root span is in no server trace: not shipped
      { job_ops: jobOps.length, listed: listedAll.length, distinct: listed.size });
    // Rule 5: compare_chains compares the full op list.
    const compared = await call('compare_chains', { before_action_id: a.tasks.action_id, after_action_id: a.guest.action_id });
    const dbStatus = Object.fromEntries(compared.stops.filter(stop => stop.stop === 'db').map(stop => [stop.key, stop.status]));
    check('compare_chains(tasks → guest) compares the full op list by issuer', dbStatus['find users (middleware: authenticate)'] === 'same' && dbStatus['find projects (param: loadProject)'] === 'removed'
      && dbStatus['find tasks (handler: listTasks)'] === 'removed' && compared.path_changed === true && compared.outcome_delta.changed.includes('stopped_at'), dbStatus);
    const renameVsSummary = await call('compare_chains', { before_action_id: a.rename.action_id, after_action_id: a.summary.action_id });
    check('compare_chains(rename → summary): the middleware write is added, the handler write removed', renameVsSummary.stops.some(stop => stop.key === 'insert activity (middleware: recordActivity)' && stop.status === 'added')
      && renameVsSummary.stops.some(stop => stop.key === 'update tasks (handler: renameTask)' && stop.status === 'removed'), renameVsSummary.summary.split('. Before:')[0]);
  } finally { await client.close(); }
  return { checks, signature, storeDir, tanstack: tanstackVersion };
}

const report = { runs: [], checks: [], tanstack_react_query: tanstackVersion, store_dirs: [] };
for (let run = 1; run <= runs; run += 1) {
  const result = await grade(run, await session(run));
  report.runs.push({ run, signature: result.signature });
  report.checks.push(...result.checks);
  report.store_dirs.push(result.storeDir);
}
const signatures = report.runs.map(entry => JSON.stringify(entry.signature));
report.checks.push({ name: `stable: the per-action answers are identical across ${runs} runs`, pass: runs > 0 && signatures.every(value => value === signatures[0]), detail: runs > 1 ? null : 'single run' });
await mongo.close();
const failed = report.checks.filter(entry => !entry.pass);
for (const entry of report.checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${JSON.stringify(entry.detail).slice(0, 1500)}`}`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks pass (TanStack Query ${tanstackVersion}); stores ${report.store_dirs.join(', ')}`);
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'middleware-reads-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
if (!failed.length && !argv.includes('--keep')) { for (const dir of report.store_dirs) fs.rmSync(dir, { recursive: true, force: true }); fixture.cleanup(); }
process.exitCode = failed.length ? 1 : 0;
