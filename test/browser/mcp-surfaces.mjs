// "Every MCP surface says what the rows already hold about a request, wherever
// the request came from" (headless, neutral fixture
// test/browser/fixtures/mcp-surfaces-app: wouter + TanStack Query v5).
//
// The page ships rows through the real collector sink into a real store (body
// capture on: a development build). A tiny backend in this file answers /api/*
// and writes backend spans in the adapter's shape (server span → handler span
// → DB spans, parent ids from the request's traceparent). Every expectation is
// recomputed here from the raw records.jsonl / spans.jsonl rows (nothing from
// analysis/, collector/ or mcp/ is imported for that); the MCP server is then
// driven as a black box over stdio (SDK client), as an agent would run it.
//
//   B  bodies of unattributed requests (page-load GETs, the poll, the inline
//      script's PUT) through page_requests, action_chain.unlinked and
//      recent_actions;
//   I  an unattributed request's issuer lists every first-party frame, innermost first;
//   D  a request sent by a timer the click armed carries deferred.ms_after_dispatch and via;
//   T  summary text states request fields and status-bearing response fields,
//      so two same-URL POSTs read differently in text;
//   S  a 304 server status beside a 200 browser status is explained;
//   E  an img, a canvas and a list row are found by description (never exact).
//
//   node test/browser/mcp-surfaces.mjs [dependencyRoot] [--runs 3] [--keep]
//
// The dependency root must hold vite, @vitejs/plugin-react, react and
// playwright (default: the LibreChat fixture). wouter, regexparam and
// TanStack Query v5 are copied from this checkout's node_modules into a
// merged dependency root, so they resolve the same single React.
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
const argv = process.argv.slice(2);
const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null; };
const runs = Number(option('--runs') || 3);
const keep = argv.includes('--keep') || process.env.TRACER_KEEP_STORE === '1';
const positional = argv.filter((value, index) => !value.startsWith('--') && !['--runs'].includes(argv[index - 1]));
const baseRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/mcp-surfaces-app');
const appSource = fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8');

// ---- merged dependency root: the base's packages (symlinks) plus copies of the fixture's libraries.
const dependencyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-surfaces-deps-'));
fs.mkdirSync(path.join(dependencyRoot, 'node_modules'));
const localModules = path.join(tracerRoot, 'node_modules');
const COPIED = ['wouter', 'regexparam', '@tanstack/react-query', '@tanstack/query-core'];
for (const entry of fs.readdirSync(path.join(baseRoot, 'node_modules'))) {
  if (entry.startsWith('@')) {
    fs.mkdirSync(path.join(dependencyRoot, 'node_modules', entry), { recursive: true });
    for (const child of fs.readdirSync(path.join(baseRoot, 'node_modules', entry))) {
      if (COPIED.includes(`${entry}/${child}`)) continue;
      fs.symlinkSync(path.join(baseRoot, 'node_modules', entry, child), path.join(dependencyRoot, 'node_modules', entry, child));
    }
  } else if (!COPIED.includes(entry)) fs.symlinkSync(path.join(baseRoot, 'node_modules', entry), path.join(dependencyRoot, 'node_modules', entry));
}
for (const name of COPIED) fs.cpSync(fs.realpathSync(path.join(localModules, name)), path.join(dependencyRoot, 'node_modules', name), { recursive: true });
const versions = Object.fromEntries(['wouter', '@tanstack/react-query', 'react'].map(name => [name, JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'node_modules', name, 'package.json'), 'utf8')).version]));

// ---- tiny backend: routes, statuses, bodies and the spans an Express + Mongo adapter would write.
const hr = ms => [Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)];
const CONFIG_ETAG = '"cfg-7"';
function routesFor(state) {
  return [
    { method: 'GET', pattern: /^\/api\/projects\/[^/]+$/u, route: '/api/projects/:id', handler: 'getProject', dbs: [['find', 'projects']],
      answer: () => ({ status: 200, body: { id: 'p1', name: 'Apollo', owner: 'Dana Reyes', state: 'active' } }) },
    { method: 'GET', pattern: /^\/api\/projects\/[^/]+\/tasks$/u, route: '/api/projects/:id/tasks', handler: 'listTasks', dbs: [['find', 'tasks']],
      answer: () => ({ status: 200, body: { projectId: 'p1', total: 3, items: [{ id: 't1', title: 'Alpha', done: false }, { id: 't2', title: 'Beta', done: false }, { id: 't3', title: 'Gamma', done: true }] } }) },
    { method: 'GET', pattern: /^\/api\/pulse$/u, route: '/api/pulse', handler: 'getPulse', dbs: [['find', 'pulses']],
      answer: () => { state.pulse += 1; return { status: 200, body: { count: state.pulse, healthy: true } }; } },
    { method: 'POST', pattern: /^\/api\/events$/u, route: '/api/events', handler: 'createEvent', dbs: [['insert', 'events']],
      answer: request => { state.events += 1; return { status: 201, body: { id: `ev_${state.events}`, kind: request?.type ?? null, queued: true } }; } },
    { method: 'PATCH', pattern: /^\/api\/tasks\/t1$/u, route: '/api/tasks/:id', handler: 'updateTask', dbs: [['find', 'tasks']],
      answer: () => ({ status: 409, body: { error: 'locked', taskId: 't1', lockedBy: 'another session' } }) },
    { method: 'PATCH', pattern: /^\/api\/tasks\/t2$/u, route: '/api/tasks/:id', handler: 'updateTask', dbs: [['find', 'tasks'], ['update', 'tasks']],
      answer: () => ({ status: 200, body: { id: 't2', revision: 4, status: 'done', title: 'Beta' } }) },
    { method: 'DELETE', pattern: /^\/api\/tasks\/[^/]+$/u, route: '/api/tasks/:id', handler: 'archiveTask', dbs: [['delete', 'tasks']],
      answer: () => ({ status: 200, body: { id: 't3', archived: true } }) },
    { method: 'GET', pattern: /^\/api\/config$/u, route: '/api/config', handler: 'getConfig', dbs: [['find', 'settings']],
      answer: (_body, req) => (req.headers['if-none-match'] === CONFIG_ETAG ? { status: 304, headers: { etag: CONFIG_ETAG, 'cache-control': 'no-cache' }, body: null }
        : { status: 200, headers: { etag: CONFIG_ETAG, 'cache-control': 'no-cache' }, body: { theme: 'dark', density: 'compact' } }) },
    { method: 'PUT', pattern: /^\/api\/prefs$/u, route: '/api/prefs', handler: 'savePrefs', dbs: [['update', 'prefs']],
      answer: () => ({ status: 200, body: { saved: 3 } }) },
    { method: 'PUT', pattern: /^\/api\/prefs\/log$/u, route: '/api/prefs/log', handler: 'logPrefs', dbs: [['insert', 'prefs_log']],
      answer: request => ({ status: 200, body: { logged: request?.index ?? null } }) },
    { method: 'GET', pattern: /^\/api\/redirect$/u, route: '/api/redirect', handler: 'redirectToConfig', dbs: [],
      answer: () => ({ status: 302, headers: { location: '/api/config' }, body: null }) },
    { method: 'POST', pattern: /^\/api\/search$/u, route: '/api/search', handler: 'search', dbs: [['find', 'items']],
      answer: () => ({ status: 200, body: { matched: true } }) },
    { method: 'POST', pattern: /^\/api\/upload$/u, route: '/api/upload', handler: 'upload', dbs: [['insert', 'notes']],
      answer: () => ({ status: 201, body: { stored: true } }) },
    { method: 'POST', pattern: /^\/api\/audit$/u, route: '/api/audit', handler: 'audit', dbs: [['insert', 'audits']],
      answer: () => ({ status: 201, body: { id: 'au_1' } }) },
    { method: 'POST', pattern: /^\/api\/bulk$/u, route: '/api/bulk', handler: 'bulk', dbs: [['insert', 'bulk']],
      answer: () => ({ status: 200, body: { status: 'partial', state: 'queued', code: 'B7', phase: 'ingest', result: 'accepted-with-a-long-result-word-beyond-the-cap', error: { code: 'E2', message: 'two rows skipped' } } }) },
    { method: 'POST', pattern: /^\/api\/lanes\/move$/u, route: '/api/lanes/move', handler: 'moveLane', dbs: [['update', 'lanes']],
      answer: () => ({ status: 200, body: { moved: true } }) },
    { method: 'GET', pattern: /^\/api\/blob$/u, route: '/api/blob', handler: 'blob', dbs: [['find', 'blobs']],
      answer: (_body, req) => ({ status: 200, body: { index: Number(new URL(req.url, 'http://x').searchParams.get('i')), data: 'd'.repeat(6000) } }) },
  ];
}


// ---- one build (the collector URL is baked in: one loopback port reused by every run's collector)
const collectorPort = await new Promise(resolve => { const probe = http.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const fixture = await buildReactFixture({ dependencyRoot, name: 'mcp-surfaces', appSource, mode: 'development',
  bodyHtml: fs.readFileSync(path.join(fixtureDir, 'inline-script.html'), 'utf8'),
  pluginOptions: { collector: { url: `http://127.0.0.1:${collectorPort}`, force: true } } });
const distRoot = fixture.distRoot;
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');
// The build's function ids hash the text the attribution pass saw (with the
// stamp attributes the Vite plugin inserts); the MCP is given that text, from
// the source map, as the checkout, so names and lines render (as in mcp-gaps).
const assetsDir = path.join(distRoot, 'assets');
const sourceMap = JSON.parse(fs.readFileSync(path.join(assetsDir, fs.readdirSync(assetsDir).find(file => /^index-.*\.js\.map$/u.test(file))), 'utf8'));
const builtSource = sourceMap.sourcesContent[sourceMap.sources.findIndex(file => file.endsWith('src/main.jsx'))];
const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-surfaces-source-'));
fs.mkdirSync(path.join(sourceRoot, 'client/src'), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, 'client/src/main.jsx'), builtSource);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const FILE = 'client/src/main.jsx';
const lineAt = offset => builtSource.slice(0, offset).split('\n').length;
const functionAt = needle => {
  const offset = builtSource.indexOf(needle);
  if (offset < 0) throw new Error(`fixture source has no ${needle}`);
  const row = manifest.functions.find(value => value.source?.file?.endsWith('src/main.jsx') && value.source.start === offset);
  if (!row) throw new Error(`no manifest function starts at ${needle}`);
  return { id: row.id, line: lineAt(offset) };
};
const fn = {
  getJson: functionAt('function getJson('), loadProject: functionAt('function loadProject('), loadTasks: functionAt('function loadTasks('),
  projectQueryFn: functionAt('() => loadProject(params.id)'), tasksQueryFn: functionAt('() => loadTasks(params.id)'), archiveTimer: functionAt('() => { archiveTask('),
};

async function record(run) {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), `tracer-mcp-surfaces-store-${run}-`));
  const spans = [];
  const state = { pulse: 0, events: 0 };
  const routes = routesFor(state);
  const span = fields => ({ schema: 'producttrace.backend-span.v1', source: 'opentelemetry', service_name: 'fixture-api', span_id: randomBytes(8).toString('hex'), ...fields });
  const answerApi = (req, res, url) => {
    const route = routes.find(value => value.method === req.method && value.pattern.test(url.pathname));
    const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/u.exec(String(req.headers.traceparent || ''));
    const traceId = parent ? parent[1] : randomBytes(16).toString('hex');
    const start = performance.timeOrigin + performance.now();
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let requestBody = null; try { requestBody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch {}
      const answer = route ? route.answer(requestBody, req) : { status: 404, body: null };
      const server = span({ trace_id: traceId, parent_span_id: parent ? parent[2] : null, kind: 'server', name: `${req.method} ${route?.route || url.pathname}`,
        attributes: { 'http.request.method': req.method, 'http.route': route?.route || url.pathname, 'http.target': `${url.pathname}${url.search}`, 'http.response.status_code': answer.status },
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
      server.end_time = hr(performance.timeOrigin + performance.now() + 2);
      spans.push(...rows);
      res.writeHead(answer.status, { ...(answer.headers || {}), ...(answer.body !== null ? { 'content-type': 'application/json' } : {}) });
      res.end(answer.body === null ? undefined : JSON.stringify(answer.body));
    });
  };
  const collector = createCollector({ port: collectorPort, store: { dir: storeDir, manifest: null, label: 'mcp-surfaces' } });
  await collector.ready;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/')) { answerApi(req, res, url); return; }
    // SPA fallback: a path that names no built file serves index.html (wouter reads the location).
    const candidate = path.resolve(distRoot, url.pathname.slice(1));
    const file = candidate.startsWith(`${distRoot}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(distRoot, 'index.html');
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
    await page.goto(`${origin}/projects/p1`, { waitUntil: 'load' });
    await page.getByRole('listitem', { name: 'Task Alpha' }).waitFor();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Notify' }).click(); await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Lock Alpha' }).click(); await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Finish Beta' }).click(); await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Check config' }).click(); await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Check config' }).click(); await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Archive later' }).click(); await page.waitForTimeout(3700);
    await page.getByRole('img', { name: 'Team logo' }).click(); await page.waitForTimeout(400);
    await page.locator('canvas').click(); await page.waitForTimeout(400);
    await page.getByRole('listitem', { name: 'Task Beta' }).click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(400);
    await page.getByRole('listitem', { name: 'Task Gamma' }).getByRole('button', { name: 'Open', exact: true }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Star' }).click(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Follow link' }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Search twice' }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Delay then save' }).click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Bulk' }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Load many' }).click(); await page.waitForTimeout(2500);
    await page.getByRole('listitem', { name: 'Item Alpha' }).getByRole('button', { name: 'Open item' }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Remove first' }).click(); await page.waitForTimeout(400);
    await page.getByRole('listitem', { name: 'Item Beta' }).getByRole('button', { name: 'Open item' }).click(); await page.waitForTimeout(300);
    await page.getByRole('listitem', { name: 'Lane Two' }).getByRole('button', { name: 'Move' }).click(); await page.waitForTimeout(500);
    session = await page.evaluate(() => globalThis.__productTraceRuntime.session);
    await page.goto('about:blank'); await page.waitForTimeout(800);
    await page.close();
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
  await collector.close();
  fs.appendFileSync(path.join(storeDir, 'spans.jsonl'), spans.map(row => `${JSON.stringify(row)}\n`).join(''));
  return { storeDir, session, pageErrors };
}

// ---- raw helpers (this file only; nothing from analysis/, collector/ or mcp/)
const readRows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const isIdKey = key => /^(?:_id|id)$|Id$|_id$/u.test(key);
const fmt = value => (Array.isArray(value) ? `[${value.map(fmt).join(', ')}]` : typeof value === 'string' ? value : JSON.stringify(value));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Reproduce the grader's tied-millisecond burst from recorded 4 KB body rows.
// The copied store is private to this check; the real browser rows stay intact.
async function tiedBodyPaging(storeDir) {
  const copied = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-tied-'));
  try {
    fs.cpSync(storeDir, copied, { recursive: true });
    const file = path.join(copied, 'records.jsonl');
    const rows = readRows(file);
    const template = rows.find(row => row.kind === 'network.request' && row.url === '/api/blob?i=1');
    const body = rows.find(row => row.kind === 'network.body' && row.direction === 'response' && row.request_occurrence_id === template?.request_occurrence_id);
    if (!template || !body) throw new Error('missing recorded 4 KB response template');
    const stamp = Math.max(...rows.map(row => Number(row.timestamp || 0))) + 1000;
    const sequence = Math.max(...rows.map(row => Number(row.sequence || 0))) + 100;
    const added = [];
    for (let i = 0; i < 320; i += 1) {
      const id = `tied:request:${i}`;
      added.push({ ...template, sequence: sequence + i, timestamp: stamp, request_occurrence_id: id, action_id: null,
        action_occurrence_id: null, parent_continuation_id: null, terminal_owner_continuation_id: null, url: `/api/paginate?i=${i}`,
        traceparent: null, trace_context: null, spine: null, evidence_ids: [id] });
      added.push({ ...body, body_sequence: sequence + i, timestamp: stamp, request_occurrence_id: id });
    }
    const write = () => fs.writeFileSync(file, [...rows, ...added].map(row => JSON.stringify(row)).join('\n') + '\n');
    const walk = async () => {
      const client = new Client({ name: 'mcp-tied-paging', version: '1' });
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', copied, '--manifest', manifestPath], stderr: 'ignore' }));
      try {
        const seen = new Set(); const cursors = new Set(); const pageSizes = []; let duplicate = 0; let cursor = null;
        const truncated = []; const notices = [];
        for (let page = 0; page < 8; page += 1) {
          const response = await client.callTool({ name: 'page_requests', arguments: { path: '/api/paginate', n: 500, include_bodies: true, ...(cursor || {}) } });
          const reply = response.structuredContent;
          const full = reply.requests.filter(row => row.response_body?.text !== undefined || row.response_body?.json !== undefined);
          pageSizes.push(full.length);
          for (const row of full) { if (seen.has(row.request_occurrence_id)) duplicate += 1; seen.add(row.request_occurrence_id); }
          truncated.push(...full.filter(row => row.response_body?.truncated_to_budget === true).map(row => ({ id: row.request_occurrence_id, size: row.response_body.full_size_bytes })));
          notices.push(response.content[0].text);
          cursor = reply.bodies_full?.next_cursor || null;
          if (!cursor) break;
          const encoded = JSON.stringify(cursor);
          if (cursors.has(encoded)) throw new Error(`cursor repeated: ${encoded}`);
          cursors.add(encoded);
        }
        return { pageSizes, unique: seen.size, duplicate, missing: 320 - seen.size, cursors: cursors.size, tied_timestamp: stamp,
          truncated, truncation_stated: notices.some(note => note.includes('request tied:request:180 had 600000 full-body bytes') && note.includes('cannot be recovered')),
          all_pages_advance: pageSizes.every(count => count > 0) };
      } finally { await client.close(); }
    };
    write();
    const tied = await walk();
    const oversize = added.find(row => row.kind === 'network.body' && row.request_occurrence_id === 'tied:request:180');
    delete oversize.json; oversize.format = 'text'; oversize.text = 'z'.repeat(600000); oversize.bytes = 600000;
    write();
    return { tied, oversize: await walk() };
  } finally { fs.rmSync(copied, { recursive: true, force: true }); }
}

async function recentScopePaging() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-mcp-recent-scope-'));
  try {
    const rows = []; let sequence = 0; let timestamp = 1000000;
    for (let action = 1; action <= 30; action += 1) {
      rows.push({ kind: 'dom.action', action_id: `scope-action-${action}`, event: 'click', target: { tag: 'button', attributes: {} },
        capture_page_id: 'scope-page', sequence: ++sequence, timestamp: timestamp += 10 });
      for (let index = 0; index < 10; index += 1) {
        const id = `scope-request-${action}-${index}`;
        rows.push({ kind: 'network.request', action_id: null, request_occurrence_id: id, method: 'GET', url: '/api/scope',
          capture_page_id: 'scope-page', sequence: ++sequence, timestamp: timestamp += 1, transport: 'fetch', reason: 'unattributed_transport' });
        rows.push({ kind: 'network.body', request_occurrence_id: id, direction: 'response', capture_page_id: 'scope-page',
          captured: true, format: 'text', text: 'body', bytes: 4, status: 200 });
      }
    }
    fs.writeFileSync(path.join(store, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const client = new Client({ name: 'mcp-recent-scope', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', store], stderr: 'ignore' }));
    try {
      const reply = await client.callTool({ name: 'recent_actions', arguments: { n: 5, include_bodies: true } });
      const answer = reply.structuredContent;
      return { selected: answer.actions.length, bodies: answer.actions.flatMap(action => action.unlinked?.requests || [])
        .filter(request => request.response_body?.text !== undefined).length,
      outside: answer.bodies_full?.outside_selected_windows, note: reply.content[0].text };
    } finally { await client.close(); }
  } finally { fs.rmSync(store, { recursive: true, force: true }); }
}

async function checkRun(run, { storeDir, session, pageErrors }) {
  const records = readRows(path.join(storeDir, 'records.jsonl'));
  const rawSpans = readRows(path.join(storeDir, 'spans.jsonl'));
  const onPage = row => row.capture_page_id === session;
  const actions = records.filter(row => row.kind === 'dom.action' && onPage(row));
  const requests = records.filter(row => row.kind === 'network.request' && onPage(row) && row.internal !== true && row.transport_internal !== true);
  const bodies = records.filter(row => row.kind === 'network.body' && onPage(row));
  const bodyOf = (request, direction) => bodies.find(row => row.request_occurrence_id === request?.request_occurrence_id && row.direction === direction) || null;
  const enters = new Map(records.filter(row => row.kind === 'function.enter').map(row => [row.continuation_id, row]));
  const serverOf = request => rawSpans.find(value => value.kind === 'server' && value.trace_id === request.trace_context?.trace_id && value.parent_span_id === request.trace_context?.span_id) || null;
  const clickOn = predicate => actions.filter(row => row.event === 'click' && predicate(row.target || {}));
  const byText = text => clickOn(target => target.tag === 'button').find(row => requests.some(request => request.action_id === row.action_id && text(request)));
  const dedupe = ids => ids.filter((id, index) => id !== ids[index - 1]);
  // Continuation walk, recomputed: from the request row through the function.enter rows to the first non-function continuation.
  const norm2 = text => String(text).replace(/sent \d+ ms after/gu, 'sent N ms after').replace(/p_[0-9a-f]+/gu, 'P');
  const walk = request => { let id = request.parent_continuation_id; while (id) { const kind = /:([a-z_]+):\d+$/u.exec(id)?.[1]; if (kind === 'action') return null; if (kind !== 'function') return { kind, id }; id = enters.get(id)?.parent_continuation_id; } return null; };
  const label = (name, entry) => `${name} ${FILE}:${entry.line}`;

  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath, '--source-root', sourceRoot], stderr: 'ignore' });
  const client = new Client({ name: 'mcp-surfaces', version: '1' });
  await client.connect(transport);
  const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };
  const checks = []; const signature = {};
  const check = (name, pass, detail) => checks.push({ name: `run ${run}: ${name}`, pass: Boolean(pass), detail });
  try {
    const tools = (await client.listTools()).tools;
    check('R0 the page ran without errors; page_requests and recent_actions take include_bodies', pageErrors.length === 0
      && tools.find(tool => tool.name === 'page_requests')?.inputSchema.properties.include_bodies && tools.find(tool => tool.name === 'recent_actions')?.inputSchema.properties.include_bodies, pageErrors);

    // ---- B: bodies of unattributed requests
    const projectGet = requests.find(row => row.url === '/api/projects/p1');
    const tasksGet = requests.find(row => row.url === '/api/projects/p1/tasks');
    const projectBody = bodyOf(projectGet, 'response'); const tasksBody = bodyOf(tasksGet, 'response');
    check('B1 raw: the route\'s two mount GETs are unattributed and their response body rows hold the entity labels',
      projectGet?.action_id === null && tasksGet?.action_id === null && projectBody?.json?.name === 'Apollo' && tasksBody?.json?.items?.map(item => item.title).join() === 'Alpha,Beta,Gamma',
      { projectGet: projectGet?.action_id, projectBody: projectBody?.json });
    const loads = await call('page_requests', { session, path: '/api/projects', include_bodies: true });
    const listedProject = loads.requests?.find(row => row.request_occurrence_id === projectGet?.request_occurrence_id);
    const listedTasks = loads.requests?.find(row => row.request_occurrence_id === tasksGet?.request_occurrence_id);
    const fieldsOf = json => { const keys = Object.keys(json); const ids = keys.filter(isIdKey); return Object.fromEntries([...ids, ...keys.filter(key => !isIdKey(key)).slice(0, Math.max(0, 12 - ids.length))]
      .map(key => [key, Array.isArray(json[key]) ? `[${json[key].length} items]` : json[key] && typeof json[key] === 'object' ? `{${Object.keys(json[key]).length} keys}` : json[key]])); };
    check('B2 MCP page_requests: each mount GET carries its response body summary (fields = the raw body\'s top-level keys, ids first) and, with include_bodies, the stored body',
      listedProject?.attribution?.kind === 'none' && same(listedProject.response_body?.fields, fieldsOf(projectBody.json)) && same(listedProject.response_body?.json, projectBody.json)
        && same(listedTasks?.response_body?.fields, fieldsOf(tasksBody.json)) && same(listedTasks.response_body?.json, tasksBody.json) && listedTasks.response_body.fields.items === '[3 items]',
      { listedProject: listedProject?.response_body, listedTasks: listedTasks?.response_body });
    const polls = requests.filter(row => row.url === '/api/pulse');
    const pollAnswer = await call('page_requests', { session, path: '/api/pulse', n: 500 });
    check('B3 MCP page_requests: every poll row (TanStack refetchInterval) is listed with its own response body, and its text states the field that differs between polls (count)',
      polls.length >= 10 && polls.every(row => row.action_id === null) && pollAnswer.counts?.total === polls.length
        && pollAnswer.requests.every(listed => { const raw = bodyOf(polls.find(row => row.request_occurrence_id === listed.request_occurrence_id), 'response');
          return raw && listed.response_body?.fields?.count === raw.json.count && same(listed.response_fields, { count: raw.json.count }) && listed.summary.includes(`answered count: ${raw.json.count}`); }),
      { polls: polls.length, counts: pollAnswer.counts, first: pollAnswer.requests?.[0]?.summary });
    const prefs = requests.find(row => row.url === '/api/prefs');
    const prefsBody = bodyOf(prefs, 'request');
    const star = clickOn(target => target.tag === 'button').filter(row => row.sequence < (prefs?.sequence ?? -1)).at(-1);
    check('B4 raw: the inline script\'s PUT is unattributed (no first-party frame) and its request body row holds a checkbox value, an order and a count',
      prefs?.action_id === null && prefs.issuer?.function_ids?.length === 0 && same(prefsBody?.json, { done: true, order: ['t2', 't1', 't3'], stars: 42 }), { prefs: prefs?.issuer, body: prefsBody?.json });
    const starChain = star ? await call('action_chain', { action_id: star.action_id, include_bodies: true }) : null;
    const listedPrefs = starChain?.unlinked?.requests?.find(row => row.request_occurrence_id === prefs?.request_occurrence_id);
    check('B5 MCP action_chain: the Star click\'s unlinked PUT carries the body summary, the stored body (include_bodies) and its request fields in text',
      same(listedPrefs?.body?.json, prefsBody.json) && same(listedPrefs.request_fields, prefsBody.json) && listedPrefs.body.fields.order === '[3 items]'
        && new RegExp(`- request PUT /api/prefs \\(fetch, sequence ${prefs.sequence}, no action_id\\) → route /api/prefs 200 → server savePrefs → db update prefs \\(handler: savePrefs\\) \\[unlinked\\]; sent done: true, order: \\[t2, t1, t3\\], stars: 42; no first-party frame recorded for this request`, 'u').test(starChain.text),
      { listedPrefs, text: starChain?.text });
    const sinceStar = actions.filter(row => row.sequence >= star.sequence).length;
    const recent = await call('recent_actions', { session, n: sinceStar, include_bodies: true });
    const recentStar = recent.actions?.find(action => action.action_id === star?.action_id);
    const recentPrefs = recentStar?.unlinked?.requests?.find(row => row.request_occurrence_id === prefs?.request_occurrence_id);
    const recentPlain = await call('recent_actions', { session, n: sinceStar });
    check('B6 MCP recent_actions include_bodies: the Star action lists the unattributed PUT with its stored body (and without the option, counts only)',
      same(recentPrefs?.body?.json, prefsBody.json) && recent.text.includes('sent done: true, order: [t2, t1, t3], stars: 42') && recent.bodies_full?.budget_bytes === 512 * 1024
        && recentPlain.actions.find(action => action.action_id === star.action_id).unlinked === undefined && recentPlain.actions.find(action => action.action_id === star.action_id).unlinked_counts?.requests >= 1
        && !recentPlain.text.includes('sent done'), { recentPrefs, text: recent.text.split('\n').slice(0, 3) });
    const pagePrefs = (await call('page_requests', { session, path: '/api/prefs', n: 500 })).requests?.find(row => row.request_occurrence_id === prefs?.request_occurrence_id);
    check('B7 MCP page_requests: the PUT from an unrecorded cause carries its body summary and fields; no body text without include_bodies',
      pagePrefs?.body?.fields?.stars === 42 && pagePrefs.body.json === undefined && pagePrefs.summary.endsWith('[completed 200; sent done: true, order: [t2, t1, t3], stars: 42]')
        // `saved` is neither status-like nor different from a peer: it stays in the JSON summary only (rule 4).
        && pagePrefs.response_fields === null && pagePrefs.response_body.fields.saved === 3, pagePrefs);

    // ---- I: issuer frames, innermost first
    const issuerIds = projectGet?.issuer?.function_ids || [];
    check('I1 raw: the mount GET\'s issuer holds three first-party frames, outermost first (queryFn → loadProject → getJson, proxy + body repeats)',
      same(dedupe(issuerIds), [fn.projectQueryFn.id, fn.loadProject.id, fn.getJson.id]) && projectGet.issuer.task === null, issuerIds);
    const issuerText = `issued by ${label('getJson', fn.getJson)} (called from ${label('loadProject', fn.loadProject)} ← ${label('useQuery({ queryFn })', fn.projectQueryFn)})`;
    check('I2 MCP: the issuer lists every frame innermost first (never the outermost alone); issuer_frames agrees',
      listedProject?.attribution?.text === `not attributed to any user action; ${issuerText}; not inside a timer or frame callback armed outside an action (task origin not recorded)`
        && same(listedProject.attribution.issuer_frames.map(frame => frame.function_id), [fn.getJson.id, fn.loadProject.id, fn.projectQueryFn.id])
        && same(listedProject.attribution.issuer_frames.map(frame => frame.display_name), ['getJson', 'loadProject', 'useQuery({ queryFn })']),
      listedProject?.attribution);

    // ---- D: deferral from continuation ids
    const archive = byText(request => request.method === 'DELETE');
    const deleteRow = requests.find(row => row.method === 'DELETE');
    const rawWalk = deleteRow ? walk(deleteRow) : null;
    const rawMs = deleteRow ? deleteRow.timestamp - archive.timestamp : null;
    check('D1 raw: the DELETE belongs to the Archive click and its code ran on a timer continuation of that click (continuation ids), ~3 s after the dispatch',
      deleteRow?.action_id === archive?.action_id && rawWalk?.kind === 'timer' && rawMs >= 3000 && rawMs < 3600, { rawWalk, rawMs });
    const archiveChain = archive ? await call('action_chain', { action_id: archive.action_id }) : null;
    const deleteSegment = archiveChain?.segments?.[0];
    const seconds = `${(rawMs / 1000).toFixed(1)} s`;
    check('D2 MCP action_chain: deferred = { ms_after_dispatch, via: timer } from the rows, never null; the text says "sent N s after the click via a timer"',
      deleteSegment?.deferred?.via === 'timer' && deleteSegment.deferred.ms_after_dispatch === rawMs && deleteSegment.deferred.continuation_id === rawWalk.id
        && same(archiveChain.outcome.deferred, deleteSegment.deferred) && deleteSegment.summary.includes(`sent ${seconds} after the click via a timer`) && archiveChain.text.includes(`sent ${seconds} after the click via a timer`),
      { deferred: deleteSegment?.deferred, summary: deleteSegment?.summary });
    const pageDelete = (await call('page_requests', { session, path: '/api/tasks/t3' })).requests?.[0];
    check('D3 MCP page_requests: the attributed DELETE carries the same deferred and text', same(pageDelete?.deferred, deleteSegment?.deferred) && pageDelete.summary.includes(`sent ${seconds} after the click via a timer`), pageDelete);
    const notify = byText(request => request.url === '/api/events');
    const eventRows = requests.filter(row => row.url === '/api/events');
    const notifyChain = notify ? await call('action_chain', { action_id: notify.action_id }) : null;
    check('D4 raw and MCP: the two POSTs sent synchronously in the click handler walk to the dispatch; deferred is null and no "sent … after" clause',
      eventRows.length === 2 && eventRows.every(row => walk(row) === null) && notifyChain?.segments?.every(segment => segment.deferred === null && !segment.summary.includes(' after the click via ')),
      notifyChain?.segments?.map(segment => segment.deferred));

    // ---- T: summary text carries what the rows hold
    const eventBodies = eventRows.map(row => ({ request: bodyOf(row, 'request')?.json, response: bodyOf(row, 'response')?.json }));
    const eventSegments = eventRows.map(row => notifyChain?.segments?.find(segment => segment.request_occurrence_id === row.request_occurrence_id));
    check('T1 raw: one click, two POSTs to one URL whose request bodies differ only in type (and whose responses differ in kind)',
      eventBodies.length === 2 && eventBodies[0].request.type !== eventBodies[1].request.type && eventBodies[0].request.source === eventBodies[1].request.source && eventRows[0].action_id === eventRows[1].action_id,
      eventBodies);
    check('T2 MCP: each POST\'s line states its own type (the differing field first) and its answer; the two lines differ in text',
      eventSegments.every((segment, index) => segment && segment.summary.includes(`sent type: ${eventBodies[index].request.type}, source: toolbar; request ids projectId=p1; answered kind: ${eventBodies[index].response.kind}; response ids id=${eventBodies[index].response.id}`)
        && same(segment.request_fields, { type: eventBodies[index].request.type, source: 'toolbar' }) && same(segment.response_fields, { kind: eventBodies[index].response.kind }))
        && eventSegments[0].summary !== eventSegments[1].summary && notifyChain.text.includes(eventSegments[0].summary) && notifyChain.text.includes(eventSegments[1].summary),
      eventSegments.map(segment => segment?.summary));
    const lock = byText(request => request.url === '/api/tasks/t1');
    const lockRow = requests.find(row => row.url === '/api/tasks/t1');
    const lockChain = lock ? await call('action_chain', { action_id: lock.action_id }) : null;
    check('T3 raw+MCP: the 409 answer\'s error field is in the text ("answered error: locked"), with the status',
      serverOf(lockRow)?.attributes['http.response.status_code'] === 409 && bodyOf(lockRow, 'response')?.json?.error === 'locked'
        && lockChain?.segments?.[0]?.summary.includes('[failed 409;') && lockChain.segments[0].summary.includes(`answered error: ${bodyOf(lockRow, 'response').json.error}`)
        && same(lockChain.segments[0].response_fields, { error: 'locked' }), lockChain?.segments?.[0]?.summary);
    const finish = byText(request => request.url === '/api/tasks/t2');
    const finishRow = requests.find(row => row.url === '/api/tasks/t2');
    const finishChain = finish ? await call('action_chain', { action_id: finish.action_id }) : null;
    const finishJson = bodyOf(finishRow, 'response')?.json;
    check('T4 raw+MCP: the revision answer reads "answered revision: 4, status: done" (status-like keys, the body\'s order)',
      finishChain?.segments?.[0]?.summary.includes(`answered revision: ${finishJson.revision}, status: ${finishJson.status}`) && finishChain.segments[0].summary.includes('sent title: Beta, done: true'), finishChain?.segments?.[0]?.summary);
    const notifyKey = notify?.target?.element_key;
    const notifyHistory = notifyKey ? await call('element_history', { element_key: notifyKey }) : null;
    const historySegments = notifyHistory?.actions?.find(action => action.action_id === notify.action_id)?.segments || [];
    check('T5 MCP element_history: the same fields in its JSON (request_fields / response_fields) as in its text',
      historySegments.length === 2 && historySegments.every((segment, index) => same(segment.request_fields, eventSegments[index].request_fields) && notifyHistory.text.includes(`sent type: ${segment.request_fields.type}`)),
      historySegments.map(segment => segment.request_fields));

    // ---- S: 304 on the server, 200 in the browser
    const configRows = requests.filter(row => row.url === '/api/config');
    const configRaw = configRows.map(row => ({ server: serverOf(row)?.attributes['http.response.status_code'], browser: bodyOf(row, 'response')?.status, action: row.action_id }));
    check('S1 raw: the second config GET was answered 304 by the server (ETag) while the page\'s response reported 200', configRaw.length === 2 && configRaw[0].server === 200 && configRaw[0].browser === 200
      && configRaw[1].server === 304 && configRaw[1].browser === 200, configRaw);
    const configChains = [];
    for (const row of configRaw) configChains.push(await call('action_chain', { action_id: row.action }));
    check('S2 MCP: the 304/200 request states both with the reason; the 200/200 request states nothing',
      !configChains[0].segments[0].status_mismatch && !configChains[0].text.includes('the browser reported')
        && same(configChains[1].segments[0].status_mismatch, { browser: 200, server: 304, reason: 'server answered 304; the browser reported 200 from its cache' })
        && configChains[1].segments[0].summary.includes('[completed 304; server answered 304; the browser reported 200 from its cache]') && configChains[1].segments[0].browser_status === 200,
      configChains.map(chain => chain.segments?.[0]?.summary));

    // ---- E: description lookups (never exact)
    const img = clickOn(target => target.tag === 'img')[0]; const canvas = clickOn(target => target.tag === 'canvas')[0];
    const row = clickOn(target => target.tag === 'li')[0];
    const openButton = actions.filter(value => value.event === 'click' && value.target?.tag === 'button' && /@t3$/u.test(value.target?.element_key || ''))[0];
    const stampOf = key => records.find(value => value.kind === 'element.stamp' && value.element_key === key);
    check('E0 raw: the img, canvas, row and the row\'s Open button were clicked and stamped (row keys carry the React key path)',
      img && canvas && row && openButton && stampOf(img.target.element_key)?.host_tag === 'img' && same(stampOf(openButton.target.element_key)?.react_key_path, ['t3']),
      { img: img?.target, canvas: canvas?.target, row: row?.target, open: openButton?.target });
    const lookups = [
      ['E1 an img by its alt text', { name: 'Team logo' }, img?.target?.element_key],
      ['E2 an img by role img and alt', { role: 'img', name: 'Team logo' }, img?.target?.element_key],
      ['E3 a canvas by its aria-label', { name: 'Burn-down chart' }, canvas?.target?.element_key],
      ['E4 a list row by role listitem and its label', { role: 'listitem', name: 'Task Beta' }, row?.target?.element_key],
      ['E5 a button inside a row, by its text and the row\'s label as nearby text', { role: 'button', name: 'Open', nearby_text: 'Task Gamma' }, openButton?.target?.element_key],
    ];
    for (const [name, args, expected] of lookups) {
      const answer = await call('resolve_element', args);
      check(`${name}: best is the clicked element's key; status and confidence stay ambiguous`, expected && answer.best?.element_key === expected && answer.status === 'ambiguous' && answer.confidence === 'ambiguous'
        && answer.candidates[0].keys.some(key => key.element_key === expected), { best: answer.best, top: answer.candidates?.[0]?.matched_on, text: answer.text });
      signature[name] = answer.best?.element_key ?? null;
    }

    // ---- after the grade: G-series (the grader's required changes, rebuilt as neutral probes)
    const fnv = (text, seed = 0x811c9dc5) => { let hash = seed; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16).padStart(8, '0'); };
    const sig = summary => `${fnv(summary)}${fnv(summary, 0x01000193)}`;
    const stampRows = key => records.filter(value => value.kind === 'element.stamp' && value.element_key === key && onPage(value)).sort((a, b) => a.stamp_sequence - b.stamp_sequence);
    // G1 (R1): an index-keyed row whose content changed.
    const openItem = actions.filter(value => value.event === 'click' && /@0$/u.test(value.target?.element_key || '') && value.target?.tag === 'button');
    const rowKey = openItem[0] ? stampRows(openItem[0].target.element_key)[0]?.react_key_site?.replace(/^placement:[0-9a-f]+:(\d+):(\d+)$/u, (m, a, b) => `${openItem[0].target.element_key.split(':')[0]}:${a}-${b}@0`) : null;
    const rowSigs = rowKey ? stampRows(rowKey).map(value => value.content_sig) : [];
    check('G1a raw: key @0 of the index-keyed list was stamped "Item Alpha" first and "Item Beta" last (the first row was removed)',
      openItem.length === 2 && rowSigs[0] === sig('aria-label=Item Alpha') && rowSigs.at(-1) === sig('aria-label=Item Beta'), { rowKey, rowSigs, alpha: sig('aria-label=Item Alpha') });
    const staleNearby = await call('resolve_element', { role: 'button', name: 'Open item', nearby_text: 'Item Alpha' });
    const staleRow = await call('resolve_element', { role: 'listitem', name: 'Item Alpha' });
    const currentNearby = await call('resolve_element', { role: 'button', name: 'Open item', nearby_text: 'Item Beta' });
    check('G1b MCP: text equal only to the key\'s earlier label gives no best and says "label out of date for that key (content changed since)"; the current label still singles the button out',
      staleNearby.best === null && staleNearby.labels_out_of_date?.includes(rowKey) && staleNearby.text.includes(`Label out of date for ${rowKey}`) && staleNearby.text.includes('(content changed since)')
        && staleRow.best === null && staleRow.labels_out_of_date?.includes(rowKey) && currentNearby.best?.element_key === openItem[0].target.element_key && currentNearby.confidence === 'ambiguous',
      { stale: staleNearby.text, row: staleRow.text, current: currentNearby.best });
    // G2 (R2): an opaque redirect.
    const redirectRow = requests.find(value => value.url === '/api/redirect');
    const redirectBody = bodyOf(redirectRow, 'response');
    const redirectChain = await call('action_chain', { action_id: redirectRow?.action_id });
    const redirectSegment = redirectChain.segments?.[0];
    check('G2 raw+MCP: redirect: "manual" answered 302 is recorded as an opaque response (status 0); the MCP states the browser hid the status and claims no mismatch',
      serverOf(redirectRow)?.attributes['http.response.status_code'] === 302 && redirectBody?.reason === 'opaque_response' && redirectBody.status === 0
        && !redirectSegment.status_mismatch && redirectSegment.browser_status === null && redirectSegment.browser_status_hidden === 'opaque_response'
        && redirectSegment.summary.includes('the browser hid the status (opaque response); server answered 302') && !redirectChain.text.includes('not the same response'), redirectSegment?.summary);
    // G3 (R3): same-URL bodies that differ only below the top level.
    const searchRows = requests.filter(value => value.url === '/api/search'); const uploadRows = requests.filter(value => value.url === '/api/upload');
    const twiceChain = await call('action_chain', { action_id: searchRows[0]?.action_id });
    const searchBodies = searchRows.map(value => bodyOf(value, 'request').json);
    const segmentOf = row => twiceChain.segments.find(segment => segment.request_occurrence_id === row.request_occurrence_id);
    check('G3a raw+MCP: two searches differ only in opts.sort: each names the nested path with both values (JSON and text)',
      searchBodies.length === 2 && searchBodies[0].kind === searchBodies[1].kind && searchBodies[0].opts.sort !== searchBodies[1].opts.sort
        && searchRows.every((row, index) => { const segment = segmentOf(row); const other = searchBodies[1 - index].opts.sort;
          return same(segment?.request_nested, [{ path: 'opts.sort', value: searchBodies[index].opts.sort, peer_values: [other] }]) && segment.summary.includes(`sent opts.sort: ${searchBodies[index].opts.sort} (vs ${other})`); }),
      searchRows.map(row => segmentOf(row)?.summary));
    const uploadBodies = uploadRows.map(value => bodyOf(value, 'request').json);
    check('G3b raw+MCP: two uploads differ only in a long nested string: "request body differs from another request to this URL only in fields not shown"',
      uploadBodies.length === 2 && uploadBodies[0].payload.text !== uploadBodies[1].payload.text && uploadBodies[0].payload.text.length > 64
        && uploadRows.every(row => segmentOf(row)?.request_differs_unshown === true && segmentOf(row).summary.includes('request body differs from another request to this URL only in fields not shown')),
      uploadRows.map(row => segmentOf(row)?.summary));
    // G4 (R4): a timer whose callback schedules a promise that sends.
    const auditRow = requests.find(value => value.url === '/api/audit');
    const auditDispatch = actions.find(value => value.action_id === auditRow?.action_id);
    const entersOf = records.filter(value => value.kind === 'function.enter' && value.action_id === auditRow?.action_id);
    const firstOn = kind => { let id = auditRow.parent_continuation_id; let entered = null; while (id && /:function:\d+$/u.test(id)) { entered = enters.get(id); id = entered?.parent_continuation_id; } return { id, entered }; };
    const nearestHop = auditRow ? firstOn() : {};
    const creator = nearestHop.entered ? entersOf.filter(value => value.sequence < nearestHop.entered.sequence && same(value.spine.function_ids, nearestHop.entered.spine.function_ids.slice(0, -1))) : [];
    // The first frame entered on the timer continuation (a call-site proxy may sit between it and the creating frame).
    let outerId = creator[0]?.continuation_id; let onTimer = null;
    while (outerId && /:function:\d+$/u.test(outerId)) { onTimer = enters.get(outerId); outerId = onTimer?.parent_continuation_id; }
    const timerMs = onTimer ? onTimer.timestamp - auditDispatch.timestamp : null;
    const auditMs = auditRow ? auditRow.timestamp - auditDispatch.timestamp : null;
    check('G4a raw: the request ran on a promise continuation whose one creating frame ran on a timer continuation of the click',
      /:promise:\d+$/u.test(nearestHop.id || '') && creator.length === 1 && /:timer:\d+$/u.test(outerId || '') && timerMs >= 480 && auditMs >= timerMs, { nearest: nearestHop.id, outerId, timerMs, auditMs });
    const auditChain = await call('action_chain', { action_id: auditRow?.action_id });
    const auditDeferred = auditChain.segments?.[0]?.deferred;
    const whenMs = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
    check('G4b MCP: deferred names the nearest continuation as such and lists every one found (basis nearest_continuation); the text does not credit the delay to the promise',
      auditDeferred?.basis === 'nearest_continuation' && auditDeferred.via === 'promise' && same(auditDeferred.continuations.map(entry => entry.kind), ['timer', 'promise'])
        && auditDeferred.reached_dispatch === true && auditDeferred.continuations[0].ms_after_dispatch === timerMs
        && auditChain.segments[0].summary.includes(`sent ${whenMs(auditMs)} after the click (nearest continuation: a promise continuation; earlier: a timer at ${whenMs(timerMs)})`),
      { auditDeferred, summary: auditChain.segments?.[0]?.summary, timerMs, auditMs, creator: creator.map(value => [value.sequence, value.timestamp, value.continuation_id]), nearest: nearestHop.entered?.sequence });
    // G5 (R5): more fields than a line shows, long values, an object under a status-like key.
    const bulkRow = requests.find(value => value.url === '/api/bulk');
    const bulkChain = await call('action_chain', { action_id: bulkRow?.action_id });
    const bulkSegment = bulkChain.segments?.[0];
    const bulkRequest = bodyOf(bulkRow, 'request').json; const bulkResponse = bodyOf(bulkRow, 'response').json;
    check('G5 raw+MCP: 6 request fields → 4 shown + "+2 more fields"; 5 status-like short fields → 4 + "+1 more field"; the error object reads "error: {2 keys}"; values over 32 characters end in … in text (JSON keeps them); the line stays bounded',
      Object.keys(bulkRequest).length === 6 && Object.keys(bulkSegment?.request_fields || {}).length === 4 && bulkSegment.request_fields_more === 2 && bulkSegment.request_fields.alpha === bulkRequest.alpha
        && bulkSegment.summary.includes(`sent alpha: ${bulkRequest.alpha.slice(0, 31)}…, beta: b1, gamma: g1, delta: d1, +2 more fields`)
        && bulkSegment.response_fields_more === 1 && same(bulkSegment.response_shapes, { error: '{2 keys}' }) && bulkSegment.summary.includes(`error: {${Object.keys(bulkResponse.error).length} keys}, +1 more field`)
        && bulkSegment.summary.length < 420, { summary: bulkSegment?.summary, length: bulkSegment?.summary?.length });
    // G6 (R6): the include_bodies budget.
    const blobRows = requests.filter(value => value.url.startsWith('/api/blob?'));
    const blobPage = await client.callTool({ name: 'page_requests', arguments: { session, path: '/api/blob', n: 500, include_bodies: true } });
    const blob = blobPage.structuredContent; const replyBytes = Buffer.byteLength(JSON.stringify(blob));
    const full = blob.requests.filter(row => row.response_body?.text !== undefined || row.response_body?.json !== undefined);
    const cutRows = blob.requests.filter(row => row.response_body?.full_omitted === 'budget');
    const newestCut = [...blob.requests].reverse().find(row => row.response_body?.full_omitted === 'budget');
    const nextPage = newestCut ? (await call('page_requests', { session, path: '/api/blob', n: 500, include_bodies: true, ...blob.bodies_full.next_cursor })) : null;
    check('G6 raw+MCP: 150 stored ~4 KB bodies: the newest keep their full body up to 512 KB, the older ones are summaries, stated with an exclusive cursor',
      blobRows.length === 150 && blobRows.every(row => bodyOf(row, 'response')) && blob.bodies_full.bytes <= 512 * 1024 && full.length + cutRows.length === 150 && cutRows.length > 0
        && blob.bodies_full.with_full_bodies === full.length && blob.bodies_full.cut === cutRows.length && blob.bodies_full.next_cursor.until_timestamp >= newestCut.timestamp
        && cutRows.every(row => row.timestamp <= blob.bodies_full.next_cursor.until_timestamp) && blobPage.content[0].text.includes('call again with until_timestamp=') && replyBytes < 1024 * 1024
        && nextPage.requests.some(row => row.request_occurrence_id === newestCut.request_occurrence_id && (row.response_body.text !== undefined || row.response_body.json !== undefined))
        && !nextPage.requests.some(row => full.some(first => first.request_occurrence_id === row.request_occurrence_id)),
      { full: full.length, cut: cutRows.length, replyBytes, bodies_full: blob.bodies_full });
    const { tied, oversize } = await tiedBodyPaging(storeDir);
    check('G6b grader tied-millisecond probe: 320 distinct 4 KB bodies return exactly once over exclusive cursor pages',
      tied.unique === 320 && tied.duplicate === 0 && tied.missing === 0 && tied.cursors === tied.pageSizes.length - 1
        && tied.pageSizes.length === 3 && tied.pageSizes.every(count => count > 0), tied);
    check('G6d synthetic oversize mid-sequence: every page advances, 320 bodies occur exactly once, and the 600 KB truncation is stated',
      oversize.unique === 320 && oversize.duplicate === 0 && oversize.missing === 0 && oversize.all_pages_advance
        && oversize.cursors === oversize.pageSizes.length - 1 && same(oversize.truncated, [{ id: 'tied:request:180', size: 600000 }])
        && oversize.truncation_stated, oversize);
    const scope = await recentScopePaging();
    check('G6e recent_actions n=5 over 30 actions states 250 recorded bodies beyond the selected windows and the all-requests route',
      scope.selected === 5 && scope.bodies === 50 && scope.outside === 250
        && scope.note.includes('Bodies outside the selected 5 action(s)\' windows are not included (250 recorded beyond them)')
        && scope.note.includes('page_requests {attribution: "none", include_bodies: true} for everything'), scope);
    const blobAction = blobRows[0]?.action_id;
    const bodyChains = []; let chainCursor = null;
    for (let page = 0; page < 4 && blobAction; page += 1) {
      const answer = await call('action_chain', { action_id: blobAction, include_bodies: true, ...(chainCursor || {}) });
      bodyChains.push(answer);
      chainCursor = answer.bodies_full?.next_cursor || null;
      if (!chainCursor) break;
    }
    const chainFull = bodyChains.flatMap(answer => answer.segments.filter(segment => segment.response_body?.text !== undefined || segment.response_body?.json !== undefined).map(segment => segment.request_occurrence_id));
    check('G6c action_chain include_bodies uses the same 512 KB budget and exclusive cursor', bodyChains.length >= 2
      && bodyChains.every(answer => answer.bodies_full?.bytes <= 512 * 1024) && new Set(chainFull).size === chainFull.length
      && chainFull.length === blobRows.length && !chainCursor,
    { pages: bodyChains.length, full: chainFull.length, unique: new Set(chainFull).size, last_cursor: chainCursor });
    // G7 (R7): nearby_text that matched nothing.
    const laneClick = actions.filter(value => value.event === 'click' && /@two\/two$/u.test(value.target?.element_key || ''))[0];
    const laneStamped = records.some(value => value.kind === 'element.stamp' && value.content_sig === sig('aria-label=Lane Two'));
    const lane = await call('resolve_element', { role: 'button', name: 'Move', nearby_text: 'Lane Two' });
    check('G7 raw+MCP: the lane row has no handler and no stamp row; the lookup gives no best and says nearby_text was ignored (no stamped ancestor)',
      laneClick && !laneStamped && lane.best === null && lane.ignored.some(entry => entry.input === 'nearby_text' && /no stamped enclosing element/u.test(entry.reason)) && lane.text.includes('nearby_text ignored: no candidate\'s own label and no stamped ancestor\'s label matches it'),
      { text: lane.text, ignored: lane.ignored });
    Object.assign(signature, { redirect: norm2(redirectSegment?.summary), search: searchRows.map(row => norm2(segmentOf(row)?.summary)), bulk: norm2(bulkSegment?.summary), stale: staleNearby.text?.replace(/p_[0-9a-f]+/gu, 'P') });

    // ---- J: JSON and text agree, every segment of every chain read above
    const chains = [starChain, archiveChain, notifyChain, lockChain, finishChain, ...configChains].filter(Boolean);
    const agree = segment => (!segment.request_fields || segment.summary.includes(`sent ${Object.entries(segment.request_fields).map(([key, value]) => `${key}: ${fmt(value)}`).join(', ')}`))
      && (!segment.response_fields || segment.summary.includes(`answered ${Object.entries(segment.response_fields).map(([key, value]) => `${key}: ${fmt(value)}`).join(', ')}`))
      && (!segment.status_mismatch || segment.summary.includes(segment.status_mismatch.reason)) && (!segment.deferred?.via || segment.summary.includes(`after the click via `));
    check('J1 every segment\'s text states its request_fields, response_fields, status_mismatch and deferral (JSON and text agree)', chains.every(chain => chain.segments.every(agree)),
      chains.flatMap(chain => chain.segments.filter(segment => !agree(segment)).map(segment => segment.summary)));

    // Stable across runs: the texts of the fixed requests (times, sequences and ms-level delays normalised).
    const norm = text => String(text).replace(/sequence \d+/gu, 'sequence N').replace(/sent \d+ ms after/gu, 'sent N ms after').replace(/\d\d:\d\d:\d\d\.\d{3}/gu, 'T').replace(/action:[a-z0-9]+:\d+/gu, 'action');
    Object.assign(signature, { notify: eventSegments.map(segment => norm(segment?.summary)), lock: norm(lockChain?.segments?.[0]?.summary), finish: norm(finishChain?.segments?.[0]?.summary),
      config: configChains.map(chain => norm(chain.segments?.[0]?.summary)), archive: norm(deleteSegment?.summary).replace(/sent \d\.\d s/u, 'sent N s'), issuer: listedProject?.attribution?.text, prefs: norm(listedPrefs ? pagePrefs.summary : null) });
  } finally {
    await client.close();
  }
  return { checks, signature };
}

const report = { versions, runs: [], checks: [] };
let previous = null;
for (let run = 1; run <= runs; run += 1) {
  const recorded = await record(run);
  const { checks, signature } = await checkRun(run, recorded);
  report.checks.push(...checks);
  report.runs.push({ run, store: recorded.storeDir, session: recorded.session });
  if (previous) report.checks.push({ name: `run ${run}: S0 the per-request texts equal run 1's (stable)`, pass: same(signature, previous), detail: { run1: previous, now: signature } });
  else previous = signature;
  if (!keep && checks.every(entry => entry.pass)) fs.rmSync(recorded.storeDir, { recursive: true, force: true });
}
const failed = report.checks.filter(entry => !entry.pass);
for (const entry of report.checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${JSON.stringify(entry.detail).slice(0, 3000)}`}`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks pass over ${runs} run(s) (wouter ${versions.wouter}, TanStack Query ${versions['@tanstack/react-query']}, React ${versions.react})`);
if (!keep && !failed.length) { fixture.cleanup(); fs.rmSync(sourceRoot, { recursive: true, force: true }); fs.rmSync(dependencyRoot, { recursive: true, force: true }); }
else console.log(`kept stores ${report.runs.map(entry => entry.store).join(', ')}; fixture ${fixture.repository}; dependency root ${dependencyRoot}`);
if (failed.length) process.exitCode = 1;
