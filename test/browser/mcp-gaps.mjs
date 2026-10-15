// "The MCP says everything the records already know" (headless, neutral fixture
// test/browser/fixtures/mcp-gaps-app). The page ships rows through the real
// collector sink into a real store; a tiny backend in this file answers /api/*
// and writes backend spans in the adapter's shape (server span → handler span
// → DB spans, parent ids from the request's traceparent). The MCP server is
// then driven as a black box over stdio (SDK client), and every rendering is
// checked against the raw records.jsonl / spans.jsonl rows read here.
//
//   1. owned work: the like's .catch rollback after its 409, hitTest ×5 on a
//      canvas miss, validateForm/showErrors on an empty submit;
//   2. unlinked evidence carries route / handler / DB (an unlinked request's
//      exact server join, and a server span no browser row joins);
//   3. page_requests: the page-load poll with its issuer and interval;
//   4. query strings recorded (never the fragment) and rendered;
//   5. resolve_element by raw evidence: top 5 with scores, `best` only when
//      unique by role+name, never `exact`.
//
//   node test/browser/mcp-gaps.mjs [dependencyRoot]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/mcp-gaps-app');
const appSource = fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-gaps-store-'));
const keep = process.env.TRACER_KEEP_STORE === '1';

// ---- tiny backend: routes, statuses and the spans an Express + Mongo adapter would write.
const spans = [];
const hr = ms => [Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)];
const ROUTES = [
  { method: 'POST', pattern: /^\/api\/items\/[^/]+\/like$/u, route: '/api/items/:id/like', status: 409, handler: 'likeItem', dbs: [['find', 'items'], ['find', 'likes']], body: { error: 'conflict' } },
  { method: 'GET', pattern: /^\/api\/items$/u, route: '/api/items', status: 200, handler: 'listItems', dbs: [['find', 'items']], body: { items: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] } },
  { method: 'POST', pattern: /^\/api\/submissions$/u, route: '/api/submissions', status: 201, handler: 'createSubmission', dbs: [['insert', 'submissions']], body: { id: 's1' } },
  { method: 'GET', pattern: /^\/api\/status$/u, route: '/api/status', status: 200, handler: 'getStatus', dbs: [['find', 'status']], body: { ok: true } },
  { method: 'GET', pattern: /^\/api\/body$/u, route: '/api/body', status: 200, handler: 'bodyHandler', dbs: [['find', 'bodies']], body: { ok: true } },
  { method: 'GET', pattern: /^\/api\/refresh$/u, route: '/api/refresh', status: 200, handler: 'refreshHandler', dbs: [['find', 'items']], body: { ok: true } },
  { method: 'GET', pattern: /^\/api\/audit$/u, route: '/api/audit', status: 200, handler: 'auditHandler', dbs: [['insert', 'audits']], body: { ok: true } },
  { method: 'POST', pattern: /^\/api\/sync$/u, route: '/api/sync', status: 204, handler: 'syncHandler', dbs: [['update', 'syncs']], body: null },
];
const span = fields => ({ schema: 'producttrace.backend-span.v1', source: 'opentelemetry', service_name: 'fixture-api', span_id: randomBytes(8).toString('hex'), ...fields });
function answerApi(req, res, url) {
  const route = ROUTES.find(value => value.method === req.method && value.pattern.test(url.pathname));
  const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/u.exec(String(req.headers.traceparent || ''));
  const traceId = parent ? parent[1] : randomBytes(16).toString('hex');
  const start = performance.timeOrigin + performance.now();
  const server = span({ trace_id: traceId, parent_span_id: parent ? parent[2] : null, kind: 'server', name: `${req.method} ${route?.route || url.pathname}`,
    attributes: { 'http.request.method': req.method, 'http.route': route?.route || url.pathname, 'http.target': `${url.pathname}${url.search}`, 'http.response.status_code': route?.status ?? 404 },
    start_time: hr(start), instrumentation: { name: '@opentelemetry/instrumentation-http' } });
  const rows = [server];
  if (route) {
    const handler = span({ trace_id: traceId, parent_span_id: server.span_id, kind: 'internal', name: `request handler - ${route.handler}`,
      attributes: { 'producttrace.express.handler.name': route.handler, 'producttrace.express.handler.index': 0, 'http.route': route.route },
      start_time: hr(start + 0.2), end_time: hr(start + 1.5), instrumentation: { name: 'producttrace-express-handlers' } });
    rows.push(handler);
    route.dbs.forEach(([operation, collection], index) => rows.push(span({ trace_id: traceId, parent_span_id: handler.span_id, kind: 'client', name: `mongodb.${operation}`,
      attributes: { 'db.system': 'mongodb', 'db.operation': operation, 'db.mongodb.collection': collection },
      start_time: hr(start + 0.3 + index * 0.3), end_time: hr(start + 0.5 + index * 0.3), instrumentation: { name: '@opentelemetry/instrumentation-mongodb' } })));
  }
  req.resume();
  req.on('end', () => {
    server.end_time = hr(performance.timeOrigin + performance.now());
    spans.push(...rows);
    if (!route) { res.writeHead(404); res.end(); return; }
    if (route.body === null) { res.writeHead(route.status); res.end(); return; }
    res.writeHead(route.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(route.body));
  });
}

const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'mcp-gaps' } });
await collector.ready;
const fixture = await buildReactFixture({ dependencyRoot, name: 'mcp-gaps', appSource,
  bodyHtml: fs.readFileSync(path.join(fixtureDir, 'inline-script.html'), 'utf8'),
  pluginOptions: { collector: { url: collector.url, force: true } } });
const distRoot = fixture.distRoot;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) { answerApi(req, res, url); return; }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(distRoot, relative);
  if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
let session = null; const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Like' }).click(); await page.waitForTimeout(700);
  await page.locator('canvas').click({ position: { x: 150, y: 35 } }); await page.waitForTimeout(400);
  // A valid submit (its episode closes at the request), then an emptied form submitted: rejected client side.
  await page.locator('input[name="title"]').fill('Entry'); await page.locator('input[name="email"]').fill('a@b.test');
  await page.getByRole('button', { name: 'Save entry' }).click(); await page.waitForTimeout(1200);
  await page.locator('input[name="title"]').fill(''); await page.locator('input[name="email"]').fill('');
  await page.getByRole('button', { name: 'Save entry' }).click(); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Load items' }).click(); await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Sync' }).click(); await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Factorial' }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Load body' }).click(); await page.waitForTimeout(600);
  await page.waitForTimeout(800);
  session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
  await page.goto('about:blank'); await page.waitForTimeout(800);
  await page.close();
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
await collector.close();
fs.appendFileSync(path.join(storeDir, 'spans.jsonl'), spans.map(row => `${JSON.stringify(row)}\n`).join(''));
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');
// The build's function ids hash the source text the attribution pass saw, which
// carries the React control-stamp attributes the Vite plugin inserts (no
// newlines, so lines are unchanged; offsets after the first one shift). The
// checkout never hashes equal to that text, so names and lines would render
// `<unnamed> file@start-end` (RUN.md residual). The MCP is therefore given the
// build's own source text, from its source map, as the checkout.
const sourceMap = JSON.parse(fs.readFileSync(path.join(distRoot, 'assets', fs.readdirSync(path.join(distRoot, 'assets')).find(file => /^index-.*\.js\.map$/u.test(file))), 'utf8'));
const builtSource = sourceMap.sourcesContent[sourceMap.sources.findIndex(file => file.endsWith('src/main.jsx'))];
const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-gaps-source-'));
fs.mkdirSync(path.join(sourceRoot, 'client/src'), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, 'client/src/main.jsx'), builtSource);

// ---- raw rows (read here; nothing from the package computes an expectation)
const readRows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const records = readRows(path.join(storeDir, 'records.jsonl'));
const rawSpans = readRows(path.join(storeDir, 'spans.jsonl'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const lineAt = offset => builtSource.slice(0, offset).split('\n').length;
const functionAt = needle => {
  const offset = builtSource.indexOf(needle);
  if (appSource.split('\n')[lineAt(offset) - 1]?.includes(needle.split('\n')[0]) !== true) throw new Error(`line of ${needle} differs between the checkout and the build text`);
  if (offset < 0) throw new Error(`fixture source has no ${needle}`);
  const row = manifest.functions.find(value => value.source?.file?.endsWith('src/main.jsx') && value.source.start === offset);
  if (!row) throw new Error(`no manifest function starts at ${needle}`);
  return { id: row.id, line: lineAt(offset) };
};
const FILE = 'client/src/main.jsx';
const fn = {
  hitTest: functionAt('function hitTest('), pollStatus: functionAt('function pollStatus('), validateForm: functionAt('function validateForm('),
  rollbackLike: functionAt('function rollbackLike('), showErrors: functionAt('function showErrors('), catchArrow: functionAt('error => rollbackLike(error)'),
  thenArrow: functionAt("response => { if (!response.ok)"), effect: functionAt('() => {\n    const timer'),
  bodyLoaded: functionAt('function bodyLoaded('), loadBody: functionAt('async function loadBody('),
  noteDelay: functionAt('function noteDelay('), factorial: functionAt('function factorial('), refreshAfterTick: functionAt('async function refreshAfterTick('),
};
const actions = records.filter(row => row.kind === 'dom.action' && row.capture_page_id === session);
const requests = records.filter(row => row.kind === 'network.request' && row.capture_page_id === session && row.internal !== true && row.transport_internal !== true);
const enters = records.filter(row => row.kind === 'function.enter' && row.capture_page_id === session);
const byContinuation = new Map(records.filter(row => row.kind === 'function.enter').map(row => [row.continuation_id, row]));
// One call = one enter row, except an enter nested directly under an
// earlier-ranked enter of the same function (proxy "call" → "chunk" → "body").
const RANK = { call: 0, chunk: 1, body: 2 };
const calls = rows => rows.filter(row => { const parent = byContinuation.get(row.parent_continuation_id);
  return !(parent?.function_id === row.function_id && RANK[parent.entry] < RANK[row.entry]); });
const clickOn = predicate => actions.filter(row => row.event === 'click' && predicate(row.target || {}));
const serverOf = request => rawSpans.filter(value => value.kind === 'server' && value.trace_id === request.trace_context?.trace_id && value.parent_span_id === request.trace_context?.span_id);
const descendants = (root, predicate) => {
  const out = []; const stack = [root.span_id];
  while (stack.length) { const id = stack.pop(); for (const child of rawSpans.filter(value => value.parent_span_id === id && value.trace_id === root.trace_id)) { if (predicate(child)) out.push(child); stack.push(child.span_id); } }
  return out;
};
const handlersOf = root => descendants(root, value => value.instrumentation?.name === 'producttrace-express-handlers').map(value => value.attributes['producttrace.express.handler.name']);
const dbsOf = root => descendants(root, value => value.attributes?.['db.system']).map(value => `${value.attributes['db.operation']} ${value.attributes['db.mongodb.collection']}`);
const endMs = value => value.end_time[0] * 1000 + value.end_time[1] / 1e6;

// ---- the MCP over stdio, as an agent would run it
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath, '--source-root', sourceRoot], stderr: 'ignore' });
const client = new Client({ name: 'mcp-gaps', version: '1' });
await client.connect(transport);
const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
try {
  check('R0 the page ran without errors and the tools list page_requests', pageErrors.length === 0 && (await client.listTools()).tools.some(tool => tool.name === 'page_requests'), pageErrors);

  // 1a. like → 409 → .catch rollback, rendered as work after the response.
  const [like] = clickOn(target => target.attributes?.['aria-label'] === 'Like');
  const likeRequest = requests.find(row => row.action_id === like?.action_id && row.url === '/api/items/7/like');
  const likeServer = likeRequest ? serverOf(likeRequest) : [];
  const rollbackRows = calls(enters.filter(row => row.action_id === like?.action_id && row.function_id === fn.rollbackLike.id));
  const catchRows = calls(enters.filter(row => row.action_id === like?.action_id && row.function_id === fn.catchArrow.id));
  check('W1 raw: the like POST got a 409 by exact parent; the .catch arrow and rollbackLike carry response_of = that request (an identifier)',
    likeServer.length === 1 && likeServer[0].attributes['http.response.status_code'] === 409 && rollbackRows.length === 1 && catchRows.length === 1
      && /:promise:\d+$/u.test(catchRows[0].parent_continuation_id) && catchRows[0].response_of === likeRequest.request_occurrence_id && rollbackRows[0].response_of === likeRequest.request_occurrence_id,
    { like: like?.action_id, rollbackRows: rollbackRows.length, catch: catchRows[0]?.parent_continuation_id });
  const likeChain = like ? await call('action_chain', { action_id: like.action_id }) : null;
  const catchEntry = likeChain?.work?.entries.find(entry => entry.function_id === fn.catchArrow.id);
  const rollbackEntry = likeChain?.work?.entries.find(entry => entry.function_id === fn.rollbackLike.id);
  check('W2 MCP work: the .catch continuation is marked after response 409 and rollbackLike sits under it',
    catchEntry?.after_response?.http_status?.[0] === 409 && rollbackEntry && rollbackEntry.depth === catchEntry.depth + 1 && likeChain.outcome.status === 'failed',
    likeChain?.work?.entries);
  // Build-time names (fix/function-names): the anonymous .catch arrow is shown by its position.
  const workLine = new RegExp(`after response 409: <callback of fetch\\(\\)\\.then\\(\\)\\.catch> ${escape(FILE)}:${fn.catchArrow.line} \\(promise continuation\\)\\n\\s+- rollbackLike ${escape(FILE)}:${fn.rollbackLike.line}`, 'u');
  check('W3 MCP summary renders "after response 409: … → rollbackLike file:line"', workLine.test(likeChain?.text || ''), likeChain?.text);
  const delayRows = calls(enters.filter(row => row.action_id === like?.action_id && row.function_id === fn.noteDelay.id));
  const delayEntry = likeChain?.work?.entries.find(entry => entry.function_id === fn.noteDelay.id);
  check('W1b raw: the sibling noteDelay (wait(250).then) ran after the response, on a promise continuation of onLike, with no response_of',
    delayRows.length === 1 && /:promise:\d+$/u.test(delayRows[0].parent_continuation_id) && delayRows[0].response_of === undefined && delayRows[0].timestamp >= endMs(likeServer[0]),
    delayRows.map(row => [row.parent_continuation_id, row.response_of]));
  check('W2b MCP: the sibling continuation is not marked after response (no identifier ties it to the request)', delayEntry && !delayEntry.after_response && !delayEntry.ordered_after_response
    && new RegExp(`\\n\\s+- noteDelay ${escape(FILE)}:${fn.noteDelay.line} \\(promise continuation\\)`, 'u').test(likeChain.text), { delayEntry, text: likeChain?.text });
  check('W4 the 409 request hangs off onLike in the work listing', new RegExp(`- onLike ${escape(FILE)}:\\d+\\n\\s+- request \\(1\\) POST /api/items/7/like \\[failed 409\\]`, 'u').test(likeChain?.text || ''), likeChain?.text);

  // 1b. canvas: hitTest ×5, no request.
  const [canvas] = clickOn(target => target.tag === 'canvas');
  const hitRows = calls(enters.filter(row => row.action_id === canvas?.action_id && row.function_id === fn.hitTest.id));
  const canvasChain = canvas ? await call('action_chain', { action_id: canvas.action_id }) : null;
  check('W5 raw: the canvas click entered hitTest 5 times and sent no request', hitRows.length === 5 && !requests.some(row => row.action_id === canvas.action_id), hitRows.length);
  check('W6 MCP: work lists hitTest ×5 (calls = raw enter rows) under a request-less chain',
    canvasChain?.work?.entries.find(entry => entry.function_id === fn.hitTest.id)?.calls === hitRows.length && canvasChain.stopped_at === 'browser'
      && canvasChain.text.includes(`- hitTest ${FILE}:${fn.hitTest.line} ×5`), canvasChain?.text);

  // 1b'. recursion: factorial(5) is 5 calls (10 enter rows: call + body each).
  const [facClick] = clickOn(target => target.tag === 'button').filter(row => enters.some(enter => enter.action_id === row.action_id && enter.function_id === fn.factorial.id));
  const facRows = enters.filter(row => row.action_id === facClick?.action_id && row.function_id === fn.factorial.id);
  const facChain = facClick ? await call('action_chain', { action_id: facClick.action_id }) : null;
  check('W10 raw: factorial wrote 10 enter rows (a chunk-pass and a module-pass frame per call), 5 calls', facRows.length === 10 && facRows.filter(row => row.entry === 'chunk').length === 5 && calls(facRows).length === 5, facRows.map(row => row.entry));
  check('W11 MCP: factorial ×5 (recursive), not a single call', facChain?.work?.entries.find(entry => entry.function_id === fn.factorial.id)?.calls === 5
    && facChain.text.includes(`factorial ${FILE}:${fn.factorial.line} ×5 (recursive)`), facChain?.text);

  // 1b''. nested await: `await (await fetch(u)).json(); bodyLoaded()` runs after the response.
  const bodyRequest = requests.find(row => row.url === '/api/body');
  const bodyRows = calls(enters.filter(row => row.action_id === bodyRequest?.action_id && row.function_id === fn.bodyLoaded.id));
  const bodyChain = bodyRequest ? await call('action_chain', { action_id: bodyRequest.action_id }) : null;
  check('W12 raw: after `await (await fetch(u)).json()`, bodyLoaded carries response_of = that request', bodyRows.length === 1 && bodyRows[0].response_of === bodyRequest.request_occurrence_id,
    bodyRows.map(row => [row.parent_continuation_id, row.response_of]));
  check('W13 MCP: bodyLoaded is marked "after response 200"', new RegExp(`after response 200: bodyLoaded ${escape(FILE)}:${fn.bodyLoaded.line} \\(await continuation\\)`, 'u').test(bodyChain?.text || ''), bodyChain?.text);

  // 1c. empty submit: validation and error display listed, rejected client side.
  const submits = actions.filter(row => row.event === 'submit');
  const empty = submits.at(-1);
  const emptyEnters = enters.filter(row => row.action_id === empty?.action_id).map(row => row.function_id);
  const emptyChain = empty ? await call('action_chain', { action_id: empty.action_id }) : null;
  check('W7 raw: the empty submit entered validateForm and showErrors and sent no request',
    emptyEnters.includes(fn.validateForm.id) && emptyEnters.includes(fn.showErrors.id) && !requests.some(row => row.action_id === empty.action_id), emptyEnters.length);
  check('W8 MCP: rejected_client_side at validation, and the work names validateForm and showErrors (not "the handler did nothing")',
    emptyChain?.outcome?.status === 'rejected_client_side' && emptyChain.stopped_at === 'validation'
      && emptyChain.text.includes(`validateForm ${FILE}:${fn.validateForm.line}`) && emptyChain.text.includes(`showErrors ${FILE}:${fn.showErrors.line}`), emptyChain?.text);
  // Episode members (field events of the form) answer with their own evidence only: their work is their own frames.
  const memberChains = [];
  for (const row of actions.filter(value => value.event === 'input')) memberChains.push(await call('action_chain', { action_id: row.action_id }));
  const members = memberChains.filter(chain => chain.episode_member);
  const ownFrames = chain => (chain.work?.entries || []).filter(entry => entry.type === 'frame');
  const rawOwn = id => enters.filter(row => row.action_id === id).length;
  check('W14 member chains: the work lists only the member\'s own frames (raw enter rows of that action)', members.length >= 2
    && members.every(chain => ownFrames(chain).every(entry => entry.action_id === chain.action_id) && ownFrames(chain).length > 0 === rawOwn(chain.action_id) > 0)
    && members.some(chain => ownFrames(chain).length > 0), members.map(chain => [chain.action_id, chain.episode_carrier_action_id, ownFrames(chain).map(entry => entry.action_id)]));
  const likeKey = like?.target?.element_key;
  const history = likeKey ? await call('element_history', { element_key: likeKey }) : null;
  check('W9 element_history carries the same work listing per action and attempt', history?.actions?.[0]?.work_summary?.includes('after response 409:') && history.attempts[0].work_summary === history.actions[0].work_summary,
    history?.actions?.[0]?.work_summary);

  // 2. unlinked entries carry route / handler / DB.
  const audit = requests.find(row => row.url === '/api/audit?flag=on');
  // The Sync click: the last click before the inline script's fetch (it only flips the flag the script watches).
  const sync = audit ? actions.filter(row => row.event === 'click' && row.sequence < audit.sequence).at(-1) : null;
  const auditServer = audit ? serverOf(audit) : [];
  const syncSpans = rawSpans.filter(value => value.kind === 'server' && value.attributes['http.route'] === '/api/sync');
  check('U1 raw: the inline script\'s fetch is unattributed (issuer: no first-party frame, a setInterval armed at load) and joins its server span exactly; its beacon left only a server span',
    audit && audit.action_id === null && audit.issuer?.function_ids?.length === 0 && audit.issuer?.task?.api === 'setInterval' && auditServer.length === 1
      && syncSpans.length === 1 && syncSpans[0].parent_span_id === null, { audit: audit?.issuer, sync: syncSpans.length });
  const syncChain = sync ? await call('action_chain', { action_id: sync.action_id }) : null;
  const listedAudit = syncChain?.unlinked?.requests?.find(row => row.url === '/api/audit?flag=on');
  const listedSync = syncChain?.unlinked?.server_spans?.find(row => row.route === '/api/sync');
  check('U2 MCP: the unlinked request carries its exact server span with handler and DB spans (equal to the raw descendants)',
    listedAudit?.server?.span_id === auditServer[0]?.span_id && JSON.stringify(listedAudit.server.handler_spans.map(row => row.name)) === JSON.stringify(handlersOf(auditServer[0]))
      && JSON.stringify(listedAudit.server.db_ops.map(row => `${row.operation} ${row.collection}`)) === JSON.stringify(dbsOf(auditServer[0])) && listedAudit.attribution.startsWith('none'),
    listedAudit);
  check('U3 MCP: the unlinked server span carries its handler and DB spans (equal to the raw descendants)',
    listedSync && JSON.stringify(listedSync.handler_spans.map(row => row.name)) === JSON.stringify(handlersOf(syncSpans[0]))
      && JSON.stringify(listedSync.db_ops.map(row => `${row.operation} ${row.collection}`)) === JSON.stringify(dbsOf(syncSpans[0])), listedSync);
  check('U4 MCP summary renders both, marked unlinked',
    listedAudit?.browser_status_not_recorded === true && /- request GET \/api\/audit\?flag=on \(fetch, sequence \d+, no action_id\) → route \/api\/audit 200 → server auditHandler → db insert audits \(handler: auditHandler\) \[unlinked\]; browser-side status not recorded \(body capture off\); cannot check the browser\/server status view; no first-party frame recorded for this request \(none was on the stack when it was sent\) from a setInterval timer armed at page load/u.test(syncChain?.text || '')
      && /- server span POST \/api\/sync 204 → server syncHandler → db update syncs \(handler: syncHandler\) \(span [0-9a-f]+, no request with its parent span id\) \[unlinked\]/u.test(syncChain?.text || ''), syncChain?.text);

  // 3. page_requests: the page-load poll.
  const polls = requests.filter(row => row.url === '/api/status?client=fixture');
  const firstAction = Math.min(...actions.map(row => row.sequence));
  check('P1 raw: every poll row is unattributed, issued by pollStatus inside a setInterval armed before the first action',
    polls.length >= 10 && polls.every(row => row.action_id === null && JSON.stringify(row.issuer?.function_ids) === JSON.stringify([fn.pollStatus.id])
      && row.issuer.task?.api === 'setInterval' && row.issuer.task.armed_sequence < firstAction), { polls: polls.length, issuer: polls[0]?.issuer, firstAction });
  const pollAnswer = await call('page_requests', { session, path: '/api/status', attribution: 'none', n: 500 });
  const pollText = new RegExp(`^not attributed to any user action; issued by pollStatus ${escape(FILE)}:${fn.pollStatus.line} from a setInterval timer armed at page load \\(before the first user action on this page\\), armed by <callback of useEffect> ${escape(FILE)}:${fn.effect.line}$`, 'u');
  check('P2 MCP page_requests: count equals the raw poll rows and each says who issued it', pollAnswer.counts?.total === polls.length && pollAnswer.requests.every(row => pollText.test(row.attribution.text)),
    { counts: pollAnswer.counts, first: pollAnswer.requests?.[0]?.attribution });
  const gaps = polls.slice(1).map((row, index) => row.timestamp - polls[index].timestamp).sort((a, b) => a - b);
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  check('P3 MCP page_requests: the poll interval equals the raw timestamps\' median gap (~300 ms)', pollAnswer.endpoints?.[0]?.interval_ms?.median === median && median > 200 && median < 450, pollAnswer.endpoints?.[0]);
  check('P4 MCP page_requests: each poll carries its server span, handler and DB ops from the raw spans',
    pollAnswer.requests.every(row => { const raw = polls.find(poll => poll.request_occurrence_id === row.request_occurrence_id); const serverSpan = raw && serverOf(raw)[0];
      return serverSpan && row.route?.span_id === serverSpan.span_id && JSON.stringify(row.handler_spans.map(value => value.name)) === JSON.stringify(handlersOf(serverSpan))
        && JSON.stringify(row.db_ops.map(value => `${value.operation} ${value.collection}`)) === JSON.stringify(dbsOf(serverSpan)); }), pollAnswer.requests?.[0]);
  const refreshes = requests.filter(row => row.url === '/api/refresh');
  check('P7 raw: the page-load poll that awaits before fetching keeps its frame and task across the await', refreshes.length >= 3
    && refreshes.every(row => row.action_id === null && row.issuer?.function_ids?.includes(fn.refreshAfterTick.id) && row.issuer.task?.api === 'setInterval'), refreshes.map(row => row.issuer));
  const refreshAnswer = await call('page_requests', { session, path: '/api/refresh' });
  check('P8 MCP: it is named (never "uninstrumented"), and a doubled frame never reads "called from" itself',
    refreshAnswer.requests.every(row => row.attribution.text.startsWith(`not attributed to any user action; issued by refreshAfterTick ${FILE}:${fn.refreshAfterTick.line} from a setInterval timer armed at page load`) && !/uninstrumented/u.test(row.attribution.text))
      && pollAnswer.requests.every(row => !row.attribution.text.includes('called from pollStatus')), refreshAnswer.requests?.[0]?.attribution?.text);
  const all = await call('page_requests', { session, n: 500 });
  const attributed = await call('page_requests', { session, attribution: 'action' });
  check('P5 MCP page_requests: page totals equal the raw rows; attributed ones name their action', all.counts?.total === requests.length
    && attributed.counts.total === requests.filter(row => row.action_id).length && attributed.requests.every(row => row.attribution.kind === 'action' && requests.find(raw => raw.request_occurrence_id === row.request_occurrence_id)?.action_id === row.attribution.action_id),
    { all: all.counts, raw: requests.length, attributed: attributed.counts });
  check('P6 MCP page_requests summary reads "GET /api/status ×N … interval median"', new RegExp(`- GET /api/status ×${polls.length} \\(0 action, ${polls.length} not attributed; statuses 200×${polls.length}\\); interval median ${median} ms`, 'u').test(pollAnswer.text), pollAnswer.text.split('\n').slice(0, 3));

  // 4. query strings.
  const [load] = clickOn(target => target.tag === 'button').filter(row => requests.some(request => request.action_id === row.action_id && request.url.startsWith('/api/items?')));
  const itemsRow = requests.find(row => row.action_id === load?.action_id);
  const loadChain = load ? await call('action_chain', { action_id: load.action_id }) : null;
  check('Q1 raw: the runtime recorded path + query and dropped the fragment', itemsRow?.url === '/api/items?ids=1,2,3&view=compact', itemsRow?.url);
  check('Q2 MCP: the segment keeps the query and the summary prints it', loadChain?.segments?.[0]?.query === '?ids=1,2,3&view=compact'
    && loadChain?.segments?.[0]?.browser_status_not_recorded === true
    && loadChain.text.includes('GET /api/items?ids=1,2,3&view=compact → route /api/items 200 → server listItems → db find items (handler: listItems) [completed 200; browser-side status not recorded (body capture off); cannot check the browser/server status view]'), loadChain?.text?.split('\n')[0]);

  // 5. resolve_element by raw evidence.
  const likeByRole = await call('resolve_element', { role: 'button', name: 'Like' });
  check('E1 role+name: top 5 with scores; best is the like button\'s key; still ambiguous, never exact', likeByRole.confidence === 'ambiguous' && likeByRole.status === 'ambiguous'
    && likeByRole.candidates.length <= 5 && likeByRole.candidates.every(candidate => Number.isFinite(candidate.score)) && likeByRole.best?.element_key === likeKey, { best: likeByRole.best, n: likeByRole.candidates.length });
  const loadKey = load?.target?.element_key;
  const byText = await call('resolve_element', { name: 'Load items' });
  check('E2 name = visible text: the stamp content_sig singles out the button; best is its key', byText.best?.element_key === loadKey && byText.candidates[0].matched_on.some(value => value.startsWith('content_sig = name')), { best: byText.best, top: byText.candidates[0] });
  const more = await call('resolve_element', { role: 'button', name: 'More' });
  const stampedButtons = new Set(records.filter(row => row.kind === 'element.stamp' && row.capture_page_id === session && row.host_tag === 'button').map(row => row.element_key)).size;
  check('E3 two buttons share role+name: no best, both listed', more.best === null && more.candidates.filter(candidate => candidate.matched_on.some(value => value.startsWith('content_sig = name'))).length === 2, { best: more.best, candidates: more.candidates.map(candidate => [candidate.keys[0]?.element_key, candidate.score]) });
  const buttons = await call('resolve_element', { role: 'button' });
  check('E4 role only: at most 5 candidates of more, no best', buttons.best === null && buttons.candidates.length === 5 && buttons.candidates_total >= stampedButtons && stampedButtons >= 6, { total: buttons.candidates_total, stampedButtons });
} finally {
  await client.close();
}

const failed = checks.filter(entry => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${String(JSON.stringify(entry.detail)).slice(0, 2500)}`}`);
console.log(`${checks.length - failed.length}/${checks.length} checks pass; store ${storeDir}`);
if (!keep && !failed.length) { fs.rmSync(storeDir, { recursive: true, force: true }); fs.rmSync(sourceRoot, { recursive: true, force: true }); fixture.cleanup(); }
else console.log(`kept store ${storeDir} and fixture ${fixture.repository}`);
if (failed.length) process.exitCode = 1;
