// Worker frontier, headless Chromium: the neutral fixture
// (test/browser/fixtures/worker-app) with the real browser runtime and real
// Web Workers. A click posts to a worker that fetches /api/x; the fixture
// server records a server span for every /api request (the fake backend).
//   node test/browser/worker-frontier.mjs [dependencyRoot]   (needs playwright)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildActionChains, SCOPED_ABSENCE } from '../../analysis/runtime-attribution.mjs';
import { UNLINKED_ATTRIBUTION } from '../../analysis/causal-chain.mjs';
import { createStore } from '../../collector/store.mjs';
import { callTool } from '../../mcp/tools.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/worker-app');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const files = { '/': 'index.html', '/main.js': 'main.js', '/worker.js': 'worker.js', '/idle-worker.js': 'idle-worker.js' };
const spans = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) {
    const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/u.exec(String(req.headers.traceparent || ''));
    const now = Date.now();
    spans.push({ schema: 'producttrace.backend-span.v1', source: 'opentelemetry', service_name: 'fixture-api', name: `${req.method} ${url.pathname}`,
      trace_id: parent ? parent[1] : randomBytes(16).toString('hex'), span_id: randomBytes(8).toString('hex'), parent_span_id: parent ? parent[2] : null,
      kind: 'server', attributes: { 'http.request.method': req.method, 'http.route': url.pathname, 'http.response.status_code': 200 },
      start_time: [Math.floor(now / 1000), (now % 1000) * 1e6], end_time: [Math.floor(now / 1000), (now % 1000) * 1e6], instrumentation: null });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return;
  }
  const file = url.pathname === '/runtime.js' ? path.join(tracerRoot, 'dist/runtime-attribution-browser.js') : files[url.pathname] ? path.join(fixtureDir, files[url.pathname]) : null;
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/javascript' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Load via worker' }).click();
  await page.waitForFunction(() => globalThis.__workerFixtureResults?.length === 1);
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'No-op' }).click();
  await page.waitForTimeout(100);
  const records = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
  const stats = await page.evaluate(() => globalThis.__productTraceRuntime.stampStats());
  assert.deepEqual(errors, []);
  const [load, noop] = records.filter(row => row.kind === 'dom.action' && row.event === 'click');
  const creates = records.filter(row => row.kind === 'worker.create');
  const posts = records.filter(row => row.kind === 'worker.postMessage');
  assert.deepEqual(creates.map(row => [row.script_url, row.action_id]), [['/worker.js', null], ['/idle-worker.js', null]]);
  assert.deepEqual(posts.map(row => [row.script_url, row.action_id, row.message_size_class]), [['/worker.js', load.action_id, 'small']]);
  assert.equal(records.some(row => row.kind === 'network.request' && row.url.includes('/api/x')), false, 'the page wrappers never see the worker fetch');
  assert.deepEqual(spans.map(span => span.attributes['http.route']), ['/api/x']);
  const chains = buildActionChains(records, spans, { backendInstrumented: true });
  const chain = chains.find(row => row.action_id === load.action_id);
  const other = chains.find(row => row.action_id === noop.action_id);
  assert.equal(chain.stopped_at, 'worker');
  assert.equal(chain.because, `message posted to Web Worker /worker.js; ${SCOPED_ABSENCE.worker}`);
  assert.deepEqual([other.stopped_at, other.because], ['browser', SCOPED_ABSENCE.no_request]);
  assert.equal(records.find(row => row.kind === 'capture.page').wrappers.worker, true);
  // Stored path (MCP): PR #4's unlinked evidence lists the worker's request, never joined.
  const stored = callTool(createStore({ records, spans, now: () => Date.now() + 60_000 }), 'action_chain', { action_id: load.action_id });
  assert.equal(stored.stopped_at, 'worker');
  assert.deepEqual(stored.unlinked.server_spans.map(span => [span.route, span.attribution]), [['/api/x', UNLINKED_ATTRIBUTION]]);
  console.log(JSON.stringify({ ok: true, rows: { worker_create: creates.length, worker_postMessage: posts.length, capture_limit: records.filter(row => row.kind === 'capture.limit').map(row => row.feature) },
    worker_posts_unowned: stats.worker_posts_unowned, click: { stopped_at: chain.stopped_at, because: chain.because, unlinked_server_spans: stored.unlinked.server_spans_total },
    noop: { stopped_at: other.stopped_at, because: other.because } }, null, 2));
} finally { await browser.close(); server.close(); }
