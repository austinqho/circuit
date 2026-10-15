// Client aborts (headless, neutral fixture): a request the page aborted is
// labelled as aborted on every surface, never as completed, and the server's
// answer is kept as a separate fact.
//
// test/browser/fixtures/client-aborts-app is built with both Tracer plugins
// (production build, bodies off). TanStack Query v5 is resolved from the
// Tracer checkout (its devDependency), React from the dependency root. Its API
// runs in a separate Node process under `node --import
// producttrace/backend/register` (fixture server.mjs: slow answers, DB-like
// spans, one `served {…}` log line per answer). A front server serves the
// build and proxies /api/* with every header; it never forwards the browser's
// abort, so the server always finishes and answers.
//
// Truth is taken outside Tracer: the browser's own network events (Playwright
// `requestfailed` net::ERR_ABORTED vs `requestfinished`), the server's log
// lines, and the page's own status text. Each case is then checked on the raw
// rows (network.request + network.abort / network.response_read), on every
// surface (action_chain, element_history action + attempt, recent_actions,
// compare_chains, page_requests, the live viewer's chain display, exported
// action chains) in-process, and again through the MCP server over stdio.
//
//   node test/browser/client-aborts.mjs [dependencyRoot] [--out <dir>]
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
import { OUTCOME_STATUSES, buildEpisodeChain } from '../../analysis/causal-chain.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : null;
const positional = argv.filter((value, index) => !value.startsWith('--') && argv[index - 1] !== '--out');
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/client-aborts-app');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-client-aborts-store-'));
const queryRoot = fs.realpathSync(path.join(tracerRoot, 'node_modules/@tanstack/react-query'));
const queryVersion = JSON.parse(fs.readFileSync(path.join(queryRoot, 'package.json'), 'utf8')).version;

const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'client-aborts' } });
await collector.ready;

const backend = spawn(process.execPath, ['--import', 'producttrace/backend/register', path.join(fixtureDir, 'server.mjs')], {
  cwd: tracerRoot,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `${collector.url}/spans`, PRODUCTTRACE_SERVICE_NAME: 'client-aborts-api' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let backendOutput = '';
backend.stderr.on('data', chunk => { backendOutput += chunk; });
backend.stdout.on('data', chunk => { backendOutput += chunk; });
const backendExited = new Promise(resolve => backend.once('exit', code => resolve(code)));
const backendPort = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`backend did not start:\n${backendOutput}`)), 20_000);
  const poll = setInterval(() => { const match = /listening (\d+)/u.exec(backendOutput); if (match) { clearInterval(poll); clearTimeout(timer); resolve(Number(match[1])); } }, 20);
  backend.once('exit', code => { clearInterval(poll); clearTimeout(timer); reject(new Error(`backend exited ${code}:\n${backendOutput}`)); });
});

const fixture = await buildReactFixture({ dependencyRoot, name: 'client-aborts', appSource: fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8'),
  pluginOptions: { collector: { url: collector.url, force: true } },
  resolve: { alias: [{ find: /^@tanstack\/react-query$/u, replacement: queryRoot }], dedupe: ['react', 'react-dom'] } });

// Front server: the build, and /api/* proxied with every header (traceparent
// included). Headers are flushed as soon as the backend sends them; the
// browser's abort is not forwarded (the backend finishes its work).
const front = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://front');
  if (url.pathname.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); res.flushHeaders(); response.pipe(res);
      // The backend dropped the connection mid-body: drop the browser's too.
      response.on('close', () => { if (!response.complete) res.destroy(); });
    });
    upstream.on('error', error => { if (!res.headersSent) res.writeHead(502); res.end(String(error)); });
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
// The browser's own view of every /api request: aborted (requestfailed) or finished.
const observed = { page_errors: [], network: [], dom: {} };
let session = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => observed.page_errors.push(`${error.name}: ${error.message}`));
  const note = (request, outcome, detail) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) observed.network.push({ method: request.method(), path: `${url.pathname}${url.search}`, outcome, detail }); };
  page.on('requestfailed', request => note(request, 'failed', request.failure()?.errorText ?? null));
  page.on('requestfinished', async request => { const response = await request.response().catch(() => null); note(request, 'finished', response ? response.status() : null); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const text = testid => page.getByTestId(testid).textContent();
  // TanStack Query search: one query key per keystroke, 90 ms apart; the server takes 400 ms.
  await page.getByTestId('search').pressSequentially('apr', { delay: 90 });
  await page.waitForTimeout(1200); observed.dom.search = await text('search-results');
  await page.getByTestId('report-load').click(); await page.waitForTimeout(200);
  await page.getByTestId('report-cancel').click(); await page.waitForTimeout(900); observed.dom.report = await text('report-status');
  await page.getByTestId('plain-start').click(); await page.waitForTimeout(150);
  await page.getByTestId('plain-cancel').click(); await page.waitForTimeout(700); observed.dom.plain = await text('status');
  await page.getByTestId('drip').click(); await page.waitForTimeout(1200); observed.dom.drip = await text('status');
  await page.getByTestId('drip-reading').click(); await page.waitForTimeout(1200); observed.dom.reading = await text('status');
  await page.getByTestId('consumed').click(); await page.waitForTimeout(500); observed.dom.consumed = await text('status');
  await page.getByTestId('fail-slow').click(); await page.waitForTimeout(700); observed.dom.fail = await text('status');
  await page.getByTestId('save-reload').click(); await page.waitForTimeout(1200); observed.dom.save = await text('status');
  await page.getByTestId('xhr').click(); await page.waitForTimeout(700); observed.dom.xhr = await text('status');
  await page.getByTestId('save-cleanup').click(); await page.waitForTimeout(700); observed.dom.saveCleanup = await text('status');
  await page.getByTestId('pre-aborted').click(); await page.waitForTimeout(400); observed.dom.pre = await text('status');
  await page.getByTestId('xhr-stop').click(); await page.waitForTimeout(700); observed.dom.xhrStop = await text('status');
  await page.getByTestId('stream-stop').click(); await page.waitForTimeout(1200); observed.dom.streamStop = await text('status');
  await page.getByTestId('stream-consumed').click(); await page.waitForTimeout(500); observed.dom.streamConsumed = await text('status');
  await page.getByTestId('broken').click(); await page.waitForTimeout(700); observed.dom.broken = await text('status');
  session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
  await page.goto('about:blank'); await page.waitForTimeout(800);
  await page.close();
} finally {
  await browser.close();
  await new Promise(resolve => front.close(resolve));
  // Let the slow answers finish before the backend stops (its spans are the server's answer).
  await new Promise(resolve => setTimeout(resolve, 900));
  backend.kill('SIGTERM'); await backendExited;
}
await new Promise(resolve => setTimeout(resolve, 300));
await collector.close();
const servedLines = backendOutput.split('\n').filter(line => line.startsWith('served ')).map(line => JSON.parse(line.slice(7)));

const loaded = await loadStore({ dir: storeDir });
const storeOptions = { manifest: fixture.manifest, sourceRoot: fixture.repository, now: () => Date.now() + 1e6 };
const store = createStore({ records: loaded.records, spans: loaded.spans, ...storeOptions });
const exports = new Map(buildActionChains(loaded.records.filter(row => row.kind !== 'element.stamp'), loaded.spans, { backendInstrumented: true }).map(row => [row.action_id, row]));
const report = { store: storeDir, session, tanstack_query: queryVersion, observed, served: servedLines, checks: [], cases: {} };
const check = (name, pass, detail) => { report.checks.push({ name, pass: Boolean(pass), detail }); };

// ---- raw rows (the loaded store, before any merge) --------------------------
const raw = loaded.records.filter(row => row.capture_page_id === session);
const rawRequests = raw.filter(row => row.kind === 'network.request' && row.internal !== true);
const rawAborts = raw.filter(row => row.kind === 'network.abort');
const rawReads = raw.filter(row => row.kind === 'network.response_read');
const requestFor = (method, pathWithQuery) => rawRequests.filter(row => row.method === method && row.url === pathWithQuery);
const factFor = (rows, request) => rows.filter(row => row.request_occurrence_id === request?.request_occurrence_id);
const browserSaw = (method, pathWithQuery) => observed.network.filter(entry => entry.method === method && entry.path === pathWithQuery);
const serverSaid = (method, pathWithQuery) => servedLines.filter(entry => entry.method === method && entry.url === pathWithQuery);

/** Every place Tracer prints this action's status. */
function surfaces(actionId) {
  const chain = callTool(store, 'action_chain', { action_id: actionId });
  const recent = callTool(store, 'recent_actions', { session, n: 100 }).actions.find(row => row.action_id === actionId) || null;
  const key = chain.stops[0]?.element_key || null;
  const history = key ? callTool(store, 'element_history', { element_key: key, session, n: 100 }) : null;
  const historyAction = history?.actions?.find(row => row.action_id === actionId) || null;
  const attempt = history?.attempts?.find(row => row.action_ids.includes(actionId)) || null;
  const compared = callTool(store, 'compare_chains', { before_action_id: actionId, after_action_id: actionId });
  const exported = exports.get(actionId) || null;
  const episode = store.episodes.episodes.get(store.episodes.byAction.get(actionId)) || null;
  // The live viewer's record: the same assembler over the raw rows (it merges the facts itself).
  const live = episode ? buildEpisodeChain(episode, loaded.records, loaded.spans, { idle: true }) : null;
  return { chain, recent, history, historyAction, attempt, compared, exported, live };
}
const printed = s => ({ action_chain: s.chain.outcome.status, display_status: s.chain.outcome.display_status, chain_display: s.chain.chain.display.status,
  chain_outcome: s.chain.chain.outcome.status, recent_actions: s.recent?.outcome?.status ?? null, element_history: s.historyAction?.outcome?.status ?? null,
  attempt: s.attempt?.outcome?.status ?? null, compare_before: s.compared.before.outcome, compare_after: s.compared.after.outcome,
  live_viewer: s.live?.display?.status ?? null, export: s.exported?.outcome?.status ?? null });

/**
 * One aborted request, owned by one action: raw facts first (the browser and
 * the server are the truth), then every surface.
 */
function expectAborted(name, method, url, { abortedAt, bodyReadStarted = false, reason = { via: 'AbortSignal', name: 'AbortError', reason_type: 'DOMException' }, serverStatus, serverEffect, readyState, evidence }) {
  const requests = requestFor(method, url);
  const request = requests[0] || null;
  check(`${name}: one network.request row for ${method} ${url}`, requests.length === 1, requests.length);
  const saw = browserSaw(method, url);
  check(`${name}: the browser itself reports the request aborted (net::ERR_ABORTED)`, saw.length === 1 && saw[0].outcome === 'failed' && /ERR_ABORTED/u.test(String(saw[0].detail)), saw);
  const said = serverSaid(method, url);
  check(`${name}: the server answered ${serverStatus} (its own log)`, said.length === 1 && said[0].status === serverStatus, said);
  const aborts = factFor(rawAborts, request);
  const fact = aborts[0] || null;
  check(`${name}: raw network.abort row: aborted_by_client, aborted_at ${abortedAt}`, aborts.length === 1 && fact.abort_state === 'aborted' && fact.aborted_by_client === true && fact.aborted_at === abortedAt
    && fact.body_read_started === bodyReadStarted && fact.response_consumed_before_abort === false && fact.response_received_before_abort === (abortedAt === 'while_reading_body'), fact);
  check(`${name}: abort_reason is the recorded name/type, never a message`, JSON.stringify(fact?.abort_reason) === JSON.stringify(reason) && !/message|aborted a request|signal is aborted/iu.test(JSON.stringify(fact)), fact?.abort_reason);
  const expectedEvidence = evidence || (reason.via === 'XMLHttpRequest.abort' ? 'xhr_abort_event' : abortedAt === 'before_response_headers' ? 'fetch_rejected_with_signal_reason' : bodyReadStarted ? null : 'signal_aborted_body_unread');
  check(`${name}: abort_evidence ${expectedEvidence} (the signal and the rejection, never timing)`, fact?.abort_evidence === expectedEvidence, fact?.abort_evidence);
  if (readyState !== undefined) check(`${name}: ready_state_at_abort ${readyState}`, fact?.ready_state_at_abort === readyState, fact?.ready_state_at_abort);
  check(`${name}: the abort row carries no action_id and no continuation (a fact about the request, not an action)`, fact && fact.action_id === undefined && fact.parent_continuation_id === null, fact);
  check(`${name}: no body-read row (the app never read this response)`, factFor(rawReads, request).length === 0, factFor(rawReads, request));
  if (!request?.action_id) { check(`${name}: the request is attributed to an action`, false, request); return null; }
  const s = surfaces(request.action_id);
  const statuses = printed(s);
  report.cases[name] = { action_id: request.action_id, request_occurrence_id: request.request_occurrence_id, statuses, outcome: s.chain.outcome, export_outcome: s.exported?.outcome ?? null,
    summary: s.chain.summary.split('\n')[0], live_label: s.live?.display?.label ?? null, reached: s.chain.reached, stopped_at: s.chain.stopped_at, because: s.chain.because };
  check(`${name}: every surface prints aborted_by_client`, Object.values(statuses).every(value => value === 'aborted_by_client'), statuses);
  check(`${name}: status is in the documented label set`, OUTCOME_STATUSES.includes(s.chain.outcome.status), s.chain.outcome.status);
  check(`${name}: server_status ${serverStatus} kept on the outcome and the export; http_status null`, s.chain.outcome.server_status === serverStatus && s.chain.outcome.http_status === null
    && s.exported?.outcome?.server_status === serverStatus && s.exported?.outcome?.http_status === null, [s.chain.outcome.server_status, s.chain.outcome.http_status, s.exported?.outcome?.server_status]);
  const sentence = s.chain.outcome.sentence;
  check(`${name}: sentence says aborted by the page before the response was read, and what the server answered`, sentence.startsWith('aborted by the page before the response was read')
    && sentence.includes(`the server answered ${serverStatus}${serverEffect ? ` and ${serverEffect}` : ''}`), sentence);
  const label = `Aborted by the page: ${method} ${url.split('?')[0]}; the server answered ${serverStatus}`;
  check(`${name}: one label on the MCP, the chain display, the terminal, the live viewer and the export`, [s.chain.outcome.label, s.chain.chain.display.label, s.chain.chain.terminal.label, s.live?.display?.label, s.exported?.outcome?.label].every(value => value === label),
    [s.chain.outcome.label, s.live?.display?.label, s.exported?.outcome?.label]);
  const bracket = `[outcome aborted_by_client; server answered ${serverStatus}`;
  check(`${name}: summary lines (action_chain, recent_actions, element_history, compare_chains) carry ${bracket}]`, [s.chain.summary, s.recent?.summary, s.historyAction?.summary, s.compared.before.summary].every(line => line?.includes(bracket)), s.chain.summary.split('\n')[0]);
  const segment = s.chain.segments.find(value => value.request_occurrence_id === request.request_occurrence_id);
  check(`${name}: its request segment is aborted_by_client with server_status ${serverStatus}`, segment?.outcome === 'aborted_by_client' && segment.server_status === serverStatus && segment.http_status === null
    && segment.aborted_at === abortedAt && segment.summary.includes(`[aborted_by_client; server answered ${serverStatus}`), segment && { outcome: segment.outcome, server_status: segment.server_status, summary: segment.summary });
  const printedText = JSON.stringify([s.chain.outcome, s.chain.chain.display, s.chain.chain.terminal.label, s.recent?.outcome, s.historyAction?.outcome, s.attempt?.outcome, s.compared.before, s.compared.after, s.exported?.outcome, s.live?.display, s.chain.summary, segment?.outcome_text, segment?.outcome_label]);
  check(`${name}: the frontier sentence starts with the abort and states the server's answer as the server's`, s.chain.because.startsWith(`the page aborted the request; the server answered ${serverStatus}; `), s.chain.because);
  check(`${name}: never "completed", "responded" or "failed" in any printed outcome, label or summary`, !/\bcompleted\b|\bresponded\b|\bfailed\b|Completed|Responded|Failed/u.test(printedText), (printedText.match(/.{60}(?:completed|responded|failed|Completed|Responded|Failed).{40}/u) || [])[0]);
  const listed = callTool(store, 'page_requests', { session }).requests.find(row => row.request_occurrence_id === request.request_occurrence_id);
  check(`${name}: page_requests labels it aborted_by_client with server_status ${serverStatus}`, listed?.outcome === 'aborted_by_client' && listed.aborted_by_client === true && listed.server_status === serverStatus && listed.http_status === null, listed && { outcome: listed.outcome, server_status: listed.server_status });
  return s;
}

/**
 * The page aborted AFTER the response reached it (the body unread): its own
 * fact (`abort_after_response`); the request keeps the server's label.
 */
const UNREAD_CLAUSE = 'the page aborted the request after the response reached it (status and headers); the app had not started reading the body, and the unread body was discarded (whether the body had fully arrived is not recorded)';
function expectAfterResponse(name, method, url, { status, label, browser, afterClause = UNREAD_CLAUSE, rowFields = { body_read_started: false } }) {
  const [request] = requestFor(method, url);
  const saw = browserSaw(method, url);
  check(`${name}: the browser's own result is ${browser}`, saw.length === 1 && (browser === 'finished' ? saw[0].outcome === 'finished' : browser === 'failed' ? saw[0].outcome === 'failed' : /ERR_ABORTED/u.test(String(saw[0].detail))), saw);
  const aborts = factFor(rawAborts, request);
  check(`${name}: raw network.abort row: after_response, aborted_by_client false, abort_after_response true (decided at the abort)`, aborts.length === 1 && aborts[0].abort_state === 'after_response'
    && aborts[0].aborted_by_client === false && aborts[0].abort_after_response === true && aborts[0].abort_evidence === 'signal_aborted_after_response' && aborts[0].response_received_before_abort === true
    && Object.entries(rowFields).every(([field, value]) => aborts[0][field] === value), aborts);
  const listed = callTool(store, 'page_requests', { session }).requests.find(row => row.request_occurrence_id === request?.request_occurrence_id);
  check(`${name}: page_requests carries the after-response flag and the server's label`, listed?.abort_after_response === true && listed.outcome === status && /aborted by the page after the response/u.test(listed.outcome_text), listed && { outcome_text: listed.outcome_text, flag: listed.abort_after_response });
  const s = request?.action_id ? surfaces(request.action_id) : null;
  const statuses = s ? printed(s) : null;
  report.cases[name] = { action_id: request?.action_id ?? null, statuses, outcome: s?.chain.outcome ?? null, summary: s?.chain.summary.split('\n')[0] ?? null };
  const flagged = `${label}; aborted by the page after the response`;
  check(`${name}: every surface keeps the server's status (${status}); the short label carries the after-response flag`, statuses && Object.values(statuses).every(value => value === status) && s.chain.outcome.label === flagged && s.exported?.outcome?.label === flagged && s.live?.display?.label === flagged
    && s.chain.summary.includes(`[outcome ${status} 200; ${status === 'responded' ? 'no effect evidence; ' : ''}aborted by the page after the response]`), [statuses, s?.chain.outcome.label]);
  check(`${name}: the sentence states the abort as its own fact and that whether the body had fully arrived is not recorded, never "before the response was read"`,
    s?.chain.outcome.sentence.endsWith(afterClause) && s.chain.outcome.abort_after_response === true
    && !JSON.stringify([s.chain.outcome, s.chain.summary, s.exported?.outcome]).includes('before the response was read'), s?.chain.outcome.sentence);
  const segment = s?.chain.segments.find(value => value.request_occurrence_id === request?.request_occurrence_id);
  check(`${name}: its segment keeps ${status} with the http_status`, segment?.outcome === status && segment.http_status === 200, segment && { outcome: segment.outcome, http_status: segment.http_status });
  return s;
}

// ---- A. TanStack Query search: the key changes per keystroke -----------------
const searches = ['a', 'ap', 'apr'].map(term => ({ term, url: `/api/search?q=${term}` }));
check('search: the page rendered the last term\'s results only', observed.dom.search === 'apr: apricot', observed.dom.search);
for (const { term, url } of searches.slice(0, 2)) expectAborted(`TanStack query key change (q=${term})`, 'GET', url, { abortedAt: 'before_response_headers', serverStatus: 200, serverEffect: 'read find items' });
{
  const [request] = requestFor('GET', searches[2].url);
  const saw = browserSaw('GET', searches[2].url);
  check('search (q=apr): the browser finished it; no abort row; a body-read row (json) proves the app read it', saw.length === 1 && saw[0].outcome === 'finished' && factFor(rawAborts, request).length === 0
    && factFor(rawReads, request).length === 1 && factFor(rawReads, request)[0].via === 'json', { saw, reads: factFor(rawReads, request) });
  const s = request?.action_id ? surfaces(request.action_id) : null;
  const statuses = s ? printed(s) : null;
  report.cases['TanStack query last key (q=apr)'] = { action_id: request?.action_id ?? null, statuses, outcome: s?.chain.outcome ?? null, summary: s?.chain.summary.split('\n')[0] ?? null };
  check('search (q=apr): every surface prints completed 200 (a GET with a joined read)', statuses && Object.values(statuses).every(value => value === 'completed') && s.chain.outcome.http_status === 200 && s.chain.outcome.label === 'Completed 200: find items', statuses);
}

// ---- B. queryClient.cancelQueries ----------------------------------------------
check('report: cancelQueries reverted the query (page shows pending/idle)', observed.dom.report === 'pending/idle', observed.dom.report);
expectAborted('TanStack cancelQueries', 'GET', '/api/report', { abortedAt: 'before_response_headers', serverStatus: 200, serverEffect: 'read find reports' });

// ---- C. plain AbortController --------------------------------------------------
check('plain: the app saw AbortError', observed.dom.plain === 'plain AbortError', observed.dom.plain);
const plain = expectAborted('plain AbortController', 'GET', '/api/slow?case=plain', { abortedAt: 'before_response_headers', serverStatus: 200, serverEffect: 'read find items' });
check('plain: the request belongs to the Start click; the Cancel click that aborted it is no_request (the abort is a fact about the request, not an attribution)',
  plain?.chain.stops[0]?.event === 'click' && (() => { const cancel = store.actionRows.filter(row => row.target?.attributes?.['data-testid'] === 'plain-cancel').at(-1);
    return cancel && callTool(store, 'action_chain', { action_id: cancel.action_id }).outcome.status === 'no_request'; })(), null);

// ---- D. abort after the response headers, before the app read the body --------
// The response (status, headers) reached the app; the abort discarded the unread body. Not an
// aborted request (the browser happens to report ERR_ABORTED because the transfer was still running;
// Tracer cannot tell a running transfer from a finished one, and does not need to).
check('drip: the app got the headers, then its body read failed with AbortError', observed.dom.drip === 'drip body AbortError', observed.dom.drip);
expectAfterResponse('abort after headers, before the body was read', 'GET', '/api/drip', { status: 'completed', label: 'Completed 200: find items', browser: 'aborted (transfer still running)' });

// ---- D2. abort while the app is reading the body, with the app's own Error as the reason
// Chromium errors a body mid-read with a fresh AbortError DOMException, not the signal's reason object.
check('drip-reading: the app\'s body read rejected (Chromium: AbortError, not the reason object)', observed.dom.reading === 'reading AbortError', observed.dom.reading);
const reading = expectAborted('abort while the app reads the body (reason: an app Error)', 'GET', '/api/drip?case=reading', { abortedAt: 'while_reading_body', bodyReadStarted: true,
  reason: { via: 'AbortSignal', name: null, reason_type: 'ReadDeadline' }, serverStatus: 200, serverEffect: 'read find items', evidence: 'body_read_rejected_with_abort_error' });
check('drip-reading: the sentence names the phase and the reason type (never its message)', reading?.chain.outcome.sentence.includes('while the app was reading the body (text); reason ReadDeadline')
  && !JSON.stringify(loaded.records).includes('read took too long'), reading?.chain.outcome.sentence);

// ---- E. abort after the app consumed the body: must not be labelled aborted ----
{
  const [request] = requestFor('GET', '/api/fast?case=consumed');
  const saw = browserSaw('GET', '/api/fast?case=consumed');
  const aborts = factFor(rawAborts, request);
  check('consumed: the browser finished the request; the app read the body', saw.length === 1 && saw[0].outcome === 'finished' && observed.dom.consumed === 'consumed consumed', { saw, dom: observed.dom.consumed });
  check('consumed: the abort row says no_effect (signal aborted after the body was read), aborted_by_client false', aborts.length === 1 && aborts[0].abort_state === 'no_effect' && aborts[0].aborted_by_client === false
    && aborts[0].signal_aborted_after === 'body_read' && aborts[0].response_consumed_before_abort === true, aborts);
  check('consumed: a body-read row (json) exists', factFor(rawReads, request).length === 1 && factFor(rawReads, request)[0].via === 'json', factFor(rawReads, request));
  const s = request?.action_id ? surfaces(request.action_id) : null;
  const statuses = s ? printed(s) : null;
  report.cases['abort after the body was read'] = { action_id: request?.action_id ?? null, statuses, outcome: s?.chain.outcome ?? null };
  check('consumed: every surface prints completed 200, never aborted', statuses && Object.values(statuses).every(value => value === 'completed')
    && !/aborted/u.test(JSON.stringify([s.chain.outcome, s.chain.summary, s.exported?.outcome, s.live?.display])), statuses);
}

// ---- F. the server answers 500 to a request the page aborted ------------------
check('fail-slow: the app saw its own abort reason (not the 500)', observed.dom.fail === 'fail deadline', observed.dom.fail);
const fail = expectAborted('aborted request the server answered 500', 'GET', '/api/fail-slow', { abortedAt: 'before_response_headers', serverStatus: 500, serverEffect: 'read find reports',
  reason: { via: 'AbortSignal', name: null, reason_type: 'ReadDeadline' }, evidence: 'fetch_rejected_with_signal_reason' });
check('fail-slow: failed_requests is 0 (the page never received the 500)', fail?.chain.outcome.failed_requests === 0, fail?.chain.outcome.failed_requests);

// ---- G. one click: an aborted write, then a read the page did not abort --------
{
  check('save-reload: the app saw its POST aborted and read the notes count', observed.dom.save === 'save AbortError; notes 1', observed.dom.save);
  const [post] = requestFor('POST', '/api/notes'); const [get] = requestFor('GET', '/api/notes');
  const postSaw = browserSaw('POST', '/api/notes'); const getSaw = browserSaw('GET', '/api/notes');
  check('save-reload: the browser aborted the POST and finished the GET; the server answered both (201 with an insert, 200)',
    postSaw[0]?.outcome === 'failed' && getSaw[0]?.outcome === 'finished' && serverSaid('POST', '/api/notes')[0]?.status === 201 && serverSaid('GET', '/api/notes')[0]?.status === 200, { postSaw, getSaw });
  check('save-reload: raw rows: the POST aborted before headers; the GET read by the app (json); both owned by the one click', factFor(rawAborts, post)[0]?.aborted_by_client === true && factFor(rawAborts, post)[0]?.aborted_at === 'before_response_headers'
    && factFor(rawAborts, get).length === 0 && factFor(rawReads, get)[0]?.via === 'json' && post?.action_id && post.action_id === get?.action_id, { post: post?.action_id, get: get?.action_id });
  const s = post?.action_id ? surfaces(post.action_id) : null;
  const statuses = s ? printed(s) : null;
  report.cases['aborted write then a read'] = { action_id: post?.action_id ?? null, statuses, outcome: s?.chain.outcome ?? null, export_outcome: s?.exported?.outcome ?? null, summary: s?.chain.summary.split('\n')[0] ?? null };
  const postInsert = s?.chain.segments.find(segment => segment.request_occurrence_id === post?.request_occurrence_id)?.db_ops?.some(op => op.operation === 'insert' && op.collection === 'notes');
  check('save-reload: the aborted POST did join an insert (the old credit rule, "latest request with a write", would have credited it)', postInsert, null);
  const label = 'Completed 200: find notes; also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes (handler: createNote))';
  check('save-reload: every surface prints completed (the non-aborted GET is credited)', statuses && Object.values(statuses).every(value => value === 'completed'), statuses);
  check('save-reload: the label lists the aborted POST in "also" on the MCP, display, terminal, viewer and export', [s?.chain.outcome.label, s?.chain.chain.display.label, s?.chain.chain.terminal.label, s?.live?.display?.label, s?.exported?.outcome?.label].every(value => value === label),
    [s?.chain.outcome.label, s?.exported?.outcome?.label]);
  check('save-reload: other_requests holds the aborted POST with server_status 201', s?.chain.outcome.other_requests?.length === 1 && s.chain.outcome.other_requests[0].status === 'aborted_by_client' && s.chain.outcome.other_requests[0].server_status === 201, s?.chain.outcome.other_requests);
  check('save-reload: the credited request (the chain\'s request stop) is the GET, and the summary bracket names the abort', s?.chain.stops.find(stop => stop.stop === 'request')?.request_occurrence_id === get?.request_occurrence_id
    && s.chain.summary.includes('[outcome completed 200; also aborted_by_client POST /api/notes (server answered 201 and wrote insert notes (handler: createNote))]'), s?.chain.summary.split('\n')[0]);
  check('save-reload: the aborted POST\'s insert stays in the action outcome (writes, aborted_request_effects) and the frontier never says a bare "no write"', JSON.stringify(s?.chain.outcome.writes) === '["insert notes"]'
    && s.chain.outcome.aborted_request_effects?.[0]?.writes?.[0] === 'insert notes' && s.chain.outcome.aborted_request_effects[0].ops?.some(op => op.write && op.issued_by === 'handler: createNote') && s.chain.because.includes('no write under this request; an aborted request of this action wrote (insert notes (handler: createNote) by POST /api/notes)')
    && !/; no write$/u.test(s.chain.because) && s.exported?.outcome?.aborted_request_effects?.[0]?.writes?.[0] === 'insert notes', [s?.chain.outcome.writes, s?.chain.because]);
  check('save-reload: the sentence says the last non-aborted request\'s response was read by the app (from its body-read row)', s?.chain.outcome.sentence.endsWith("the last non-aborted request's response (GET /api/notes) was read by the app (json read recorded)")
    && s.chain.outcome.app_read?.read === true && s.exported?.outcome?.app_read?.read === true, s?.chain.outcome.sentence);
}

// ---- H. XMLHttpRequest.abort() -------------------------------------------------
check('xhr: the app saw its abort event', observed.dom.xhr === 'xhr aborted', observed.dom.xhr);
expectAborted('XMLHttpRequest.abort()', 'GET', '/api/slow?case=xhr', { abortedAt: 'before_response_headers', bodyReadStarted: null, readyState: 1,
  reason: { via: 'XMLHttpRequest.abort', name: null, reason_type: null }, serverStatus: 200, serverEffect: 'read find items' });

// ---- I. a save whose status the app used; a cleanup aborts 300 ms later --------------
check('save-cleanup: the page shows the save succeeded (the app used the status; it never read the body)', observed.dom.saveCleanup === 'saved 200', observed.dom.saveCleanup);
check('save-cleanup: the server inserted and answered 200 (its own log)', serverSaid('POST', '/api/save')[0]?.status === 200, serverSaid('POST', '/api/save'));
expectAfterResponse('save whose status the app used, aborted later by a cleanup', 'POST', '/api/save', { status: 'completed', label: 'Completed 200: insert notes', browser: 'finished' });

// ---- J. a signal already aborted before fetch: the request was never sent ---------------
{
  const [request] = requestFor('GET', '/api/slow?case=pre');
  check('pre-aborted: the app saw AbortError; the browser never saw the request; the server never answered', observed.dom.pre === 'pre AbortError' && browserSaw('GET', '/api/slow?case=pre').length === 0 && serverSaid('GET', '/api/slow?case=pre').length === 0, observed.dom.pre);
  const fact = factFor(rawAborts, request)[0];
  check('pre-aborted: raw row aborted with signal_aborted_at_call', fact?.aborted_by_client === true && fact.signal_aborted_at_call === true, fact);
  const s = request?.action_id ? surfaces(request.action_id) : null;
  report.cases['signal already aborted (never sent)'] = { action_id: request?.action_id ?? null, request_occurrence_id: request?.request_occurrence_id ?? null, statuses: s ? printed(s) : null, outcome: s?.chain.outcome ?? null, summary: s?.chain.summary.split('\n')[0] ?? null };
  check('pre-aborted: the frontier says the request never left the page (never "no server span arrived")', s?.chain.because === 'the page aborted the request; the request never left the page (its signal was already aborted when fetch was called)', s?.chain.because);
check('pre-aborted: every surface says aborted_by_client; the sentence says the request was never sent; no server status', s && Object.values(printed(s)).every(value => value === 'aborted_by_client')
    && s.chain.outcome.sentence.includes('the signal was already aborted: the request was never sent') && s.chain.outcome.server_status === null && s.chain.outcome.label === 'Aborted by the page: GET /api/slow', s?.chain.outcome);
}

// ---- K. an XHR stopped by window.stop(): an abort event without an abort() call ----------
{
  const [request] = requestFor('GET', '/api/slow?case=stop');
  const saw = browserSaw('GET', '/api/slow?case=stop');
  check('xhr-stop: the app saw the abort event; the browser reports it aborted', observed.dom.xhrStop === 'stop abort event' && /ERR_ABORTED/u.test(String(saw[0]?.detail)), [observed.dom.xhrStop, saw]);
  const fact = factFor(rawAborts, request)[0];
  check('xhr-stop: raw row says no abort() call was seen (never "XMLHttpRequest.abort")', fact?.aborted_by_client === true && fact.abort_call_seen === false && fact.abort_reason?.via === 'xhr_abort_event_without_abort_call' && fact.aborted_at === null, fact);
  const s = request?.action_id ? surfaces(request.action_id) : null;
  report.cases['XHR stopped by window.stop()'] = { action_id: request?.action_id ?? null, request_occurrence_id: request?.request_occurrence_id ?? null, statuses: s ? printed(s) : null, outcome: s?.chain.outcome ?? null, summary: s?.chain.summary.split('\n')[0] ?? null };
  check('xhr-stop: the sentence names the real reason, never XMLHttpRequest.abort()', s?.chain.outcome.status === 'aborted_by_client' && s.chain.outcome.sentence.includes('the XHR fired abort without an abort() call (e.g. window.stop())')
    && !s.chain.outcome.sentence.includes('XMLHttpRequest.abort()'), s?.chain.outcome.sentence);
}

// ---- L. a body read through a stream reader, cut off by a Stop (abort) mid-stream -------
check('stream-stop: the app\'s reader.read() rejected with AbortError', observed.dom.streamStop === 'stream AbortError', observed.dom.streamStop);
{
  const stream = expectAborted('stream reader cut off by an abort (a Stop button)', 'GET', '/api/drip?case=stream', { abortedAt: 'while_reading_body', bodyReadStarted: true, serverStatus: 200, serverEffect: 'read find items',
    evidence: 'signal_aborted_during_stream_read' });
  const [request] = requestFor('GET', '/api/drip?case=stream');
  check('stream-stop: the row names the reader (body_read_via getReader); the sentence says the app was reading, never "unread"', factFor(rawAborts, request)[0]?.body_read_via === 'getReader'
    && stream?.chain.outcome.sentence.includes('while the app was reading the body (getReader)') && !/unread/u.test(JSON.stringify(stream?.chain.outcome)), stream?.chain.outcome.sentence);
}

// ---- M. a stream read to its end, then aborted: no effect ------------------------------
{
  const [request] = requestFor('GET', '/api/fast?case=stream-consumed');
  const saw = browserSaw('GET', '/api/fast?case=stream-consumed');
  const aborts = factFor(rawAborts, request); const reads = factFor(rawReads, request);
  check('stream-consumed: the browser finished; the app read to done; row no_effect after body_read; read row via getReader', observed.dom.streamConsumed === 'streamed bytes' && saw[0]?.outcome === 'finished'
    && aborts.length === 1 && aborts[0].abort_state === 'no_effect' && aborts[0].signal_aborted_after === 'body_read' && reads.length === 1 && reads[0].via === 'getReader', { aborts, reads, saw });
  const s = request?.action_id ? surfaces(request.action_id) : null;
  check('stream-consumed: every surface prints completed 200 with no abort flag', s && Object.values(printed(s)).every(value => value === 'completed') && s.chain.outcome.label === 'Completed 200: find items'
    && !/abort/u.test(JSON.stringify([s.chain.outcome, s.chain.summary])), s && printed(s));
}

// ---- N. the body read failed first (the server dropped the connection), then a cleanup abort
check('broken: the app\'s text() rejected with TypeError (the server dropped the connection); the server logged the drop', observed.dom.broken === 'broken TypeError' && serverSaid('GET', '/api/broken')[0]?.dropped === true, observed.dom.broken);
// The server's own label for a dropped connection is whatever its spans say (its read joins under
// the server span: completed 200); the abort facts are what this case checks.
expectAfterResponse('body read failed before a cleanup abort', 'GET', '/api/broken', { status: 'completed', label: 'Completed 200: find items', browser: 'failed',
  afterClause: "the page aborted the request after the response reached it (status and headers); the app's body read (text) had already failed (TypeError), not because of the abort",
  rowFields: { body_read_started: true, body_read_via: 'text', body_read_error_type: 'TypeError' } });

// ---- the whole page ---------------------------------------------------------------
{
  const key = row => `${row?.method} ${row?.url}`;
  const byState = state => rawAborts.filter(row => row.abort_state === state).map(row => key(rawRequests.find(request => request.request_occurrence_id === row.request_occurrence_id))).sort();
  const failedByBrowser = new Set(observed.network.filter(entry => entry.outcome === 'failed').map(entry => `${entry.method} ${entry.path}`));
  const finishedByBrowser = new Set(observed.network.filter(entry => entry.outcome === 'finished').map(entry => `${entry.method} ${entry.path}`));
  // aborted_by_client only where the browser itself aborted the transfer (or never sent it); every
  // browser-aborted transfer has an abort row; no request the browser finished is labelled aborted.
  check('aborted_by_client rows ⊆ requests the browser aborted or never sent; every browser-aborted request has an abort row (aborted or after_response); no finished request is aborted_by_client',
    byState('aborted').every(entry => failedByBrowser.has(entry) || entry === 'GET /api/slow?case=pre')
    && [...failedByBrowser].every(entry => byState('aborted').includes(entry) || byState('after_response').includes(entry) || entry === 'GET /api/broken')
    && byState('aborted').every(entry => !finishedByBrowser.has(entry)), { aborted: byState('aborted'), after_response: byState('after_response'), failed: [...failedByBrowser], finished: [...finishedByBrowser] });
  check('no undetermined abort rows (every abort is decided when it happens)', rawAborts.every(row => row.abort_state !== 'undetermined'), rawAborts.map(row => row.abort_state));
  const all = store.actionRows.filter(row => row.capture_page_id === session).map(row => callTool(store, 'action_chain', { action_id: row.action_id }));
  const abortedRequestIds = new Set(rawAborts.filter(row => row.aborted_by_client === true).map(row => row.request_occurrence_id));
  check('no action whose credited request was aborted prints completed/responded/failed; every aborted segment says aborted_by_client', all.every(chain => {
    const credited = chain.stops.find(stop => stop.stop === 'request');
    return (!credited || !abortedRequestIds.has(credited.request_occurrence_id) || chain.outcome.status === 'aborted_by_client')
      && chain.segments.every(segment => !abortedRequestIds.has(segment.request_occurrence_id) || segment.outcome === 'aborted_by_client');
  }), null);
  const coverage = store.coverageFor(session);
  check('coverage.complete is true: an abort is not a capture limit (the abort rows are counted like any row)', coverage?.complete === true && !(coverage.reasons || []).length, coverage?.reasons);
  check('no page errors (every abort was handled by the app or by TanStack Query)', observed.page_errors.length === 0, observed.page_errors);
  check(`TanStack Query resolved from the Tracer checkout (v${queryVersion})`, /^5\./u.test(queryVersion), queryVersion);
}

// ---- the same answers through the MCP server over stdio --------------------------
{
  const client = new Client({ name: 'client-aborts', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir], stderr: 'ignore' }));
  try {
    const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
    const recent = await call('recent_actions', { session, n: 100 });
    const pageRequests = await call('page_requests', { session });
    for (const [name, entry] of Object.entries(report.cases)) {
      if (!entry.action_id) continue;
      const chain = await call('action_chain', { action_id: entry.action_id });
      const key = chain.stops[0]?.element_key || null;
      const history = key ? await call('element_history', { element_key: key, session, n: 100 }) : null;
      const expected = entry.statuses?.action_chain;
      const values = [chain.outcome.status, recent.actions.find(row => row.action_id === entry.action_id)?.outcome?.status,
        history?.actions?.find(row => row.action_id === entry.action_id)?.outcome?.status, history?.attempts?.find(row => row.action_ids.includes(entry.action_id))?.outcome?.status];
      check(`MCP stdio: ${name}: action_chain, recent_actions, element_history action and attempt all say ${expected}`, expected && values.every(value => value === expected), values);
      if (expected === 'aborted_by_client') {
        // The stdio server has no manifest or checkout (function labels differ); the outcome and its bracket may not.
        const bracket = line => (line.match(/\[outcome [^\]]*\]/u) || [null])[0];
        check(`MCP stdio: ${name}: the same label, sentence, server_status and summary bracket as in-process`, chain.outcome.label === entry.outcome.label && chain.outcome.sentence === entry.outcome.sentence
          && chain.outcome.server_status === entry.outcome.server_status && bracket(chain.summary) && bracket(chain.summary) === bracket(entry.summary), [chain.outcome.label, bracket(chain.summary), bracket(entry.summary)]);
        const listed = pageRequests.requests.find(row => row.request_occurrence_id === entry.request_occurrence_id);
        check(`MCP stdio: ${name}: page_requests says aborted_by_client`, listed?.outcome === 'aborted_by_client' && /aborted_by_client; (?:server answered|no server status)/u.test(listed.summary), listed?.summary);
      }
    }
  } finally { await client.close(); }
}

const failed = report.checks.filter(entry => !entry.pass);
for (const entry of report.checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${String(JSON.stringify(entry.detail)).slice(0, 1500)}`}`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks pass; store ${storeDir}`);
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'client-aborts-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.cpSync(storeDir, path.join(outDir, 'store'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'attribution-manifest.json'), `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}
fixture.cleanup();
if (failed.length) process.exitCode = 1; else fs.rmSync(storeDir, { recursive: true, force: true });
