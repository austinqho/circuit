import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { attachBackendSpans } from '../../analysis/runtime-attribution.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const fixture = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-m1-cycle3e');
const evidenceDir = path.resolve(process.argv[3] || 'docs/evidence/m1-2026-09-22-c7');
fs.mkdirSync(evidenceDir, { recursive: true });
const inventoryPath = path.join(evidenceDir, 'inventory.json');
const sourceInventory = path.join(root, 'docs/evidence/m1-2026-09-22-c6/inventory.json');
if (!fs.existsSync(inventoryPath)) fs.copyFileSync(sourceInventory, inventoryPath);
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const units = inventory.units || inventory.drive_units || [];
const unitByControlEvent = new Map();
for (const unit of units) unitByControlEvent.set(`${unit.control_id}|${unit.event}`, unit);
const staticRoot = path.join(fixture, 'client/dist');
const backendOrigin = 'http://localhost:3080';
const bridgeOrigin = 'http://127.0.0.1:8123';
const rows = [];
const pages = new Map();
const capture = { emitted: 0, received: 0, dropped: 0, gaps: [], page_ids: [] };
const surfaces = [];
const observed = [];

function proxy(req, res, target) {
  const url = new URL(target);
  const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(error.message); });
  req.pipe(upstream);
}
function mime(file) {
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
const server = http.createServer((req, res) => {
  if (req.url === '/__capture' && req.method === 'POST') {
    let body = ''; req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body); const page = payload.page_id || 'page';
        const state = pages.get(page) || { expected: null }; if (!capture.page_ids.includes(page)) capture.page_ids.push(page);
        for (const row of payload.rows || []) {
          if (state.expected == null) state.expected = row.sequence;
          if (row.sequence > state.expected) capture.gaps.push({ page_id: page, from: state.expected, to: row.sequence - 1 });
          state.expected = Math.max(state.expected, row.sequence + 1); rows.push(row); capture.received += 1;
          if (row.kind === 'capture.dropped') capture.dropped += Math.max(0, Number(row.dropped_end) - Number(row.dropped_start) + 1);
        }
        pages.set(page, state); res.writeHead(204); res.end();
      } catch (error) { res.writeHead(400); res.end(String(error)); }
    }); return;
  }
  if (req.url?.startsWith('/api/demo/')) return proxy(req, res, `${bridgeOrigin}${req.url}`);
  if (req.url?.startsWith('/api/')) return proxy(req, res, `${backendOrigin}${req.url}`);
  let relative = new URL(req.url || '/', 'http://static').pathname; if (relative === '/') relative = '/index.html';
  const file = path.resolve(staticRoot, `.${relative}`);
  if (!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': mime(file) }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(path.join(fixture, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });

function unitForStamp(name, value) {
  const event = name.replace(/^data-producttrace-control-/, '');
  for (const unit of units) {
    if (unit.event !== event) continue;
    if (String(value) === unit.control_id || String(value).endsWith(`:${unit.control_id}`) || String(value).includes(unit.control_id)) return unit;
  }
  return null;
}
function writeProgress() {
  fs.writeFileSync(path.join(evidenceDir, `PATTERN-RESULTS-progress-${results.length}.json`), JSON.stringify(results, null, 2));
}
const results = [];
const driven = new Set();
const unitAction = new Map();
const visitedStampKeys = new Set();

async function enumerate(page, label, depth) {
  // Lazy chunks mount after the authenticated shell; wait for the first live
  // stamp instead of treating a still-loading surface as empty.
  const stampDeadline = Date.now() + 5000;
  while (Date.now() < stampDeadline) {
    const count = await page.locator('[data-producttrace-control-click], [data-producttrace-control-change], [data-producttrace-control-keydown], [data-producttrace-control-submit], [data-producttrace-control-input]').count().catch(() => 0);
    if (count > 0) break;
    await page.waitForTimeout(250);
  }
  const stamps = await page.evaluate(() => {
    const out = [];
    for (const element of document.querySelectorAll('*')) for (const attr of Array.from(element.attributes || [])) {
      if (attr.name.startsWith('data-producttrace-control-')) out.push({ name: attr.name, value: attr.value, tag: element.tagName.toLowerCase(), testid: element.getAttribute('data-testid'), aria: element.getAttribute('aria-label'), title: element.getAttribute('title'), text: (element.textContent || '').trim().replace(/\s+/gu, ' ').slice(0, 120) });
    }
    return out;
  });
  surfaces.push({ label, depth, url: page.url(), stamped: stamps.length });
  const eventIndexes = new Map();
  return stamps.map(stamp => {
    const event = stamp.name.replace(/^data-producttrace-control-/, '');
    const index = eventIndexes.get(event) || 0; eventIndexes.set(event, index + 1);
    return { ...stamp, index, unit: unitForStamp(stamp.name, stamp.value) };
  }).filter(item => item.unit);
}
function statusFrom(chain, domChanged, interactionError) {
  if (interactionError) return { status: 'unreachable', terminal: 'unreachable', reason: interactionError, db: [], handler: [], route: [], productRequests: [] };
  const productRequests = chain.filter(row => row.kind === 'network.request' && row.internal !== true);
  const db = chain.filter(row => row.kind === 'db.operation');
  const handler = chain.filter(row => row.kind === 'handler.enter');
  const route = chain.filter(row => row.kind === 'route.dispatch');
  if (db.length) return { status: 'reached_db', terminal: `db.operation:${db.at(-1).id || db.at(-1).span_id || 'joined'}`, db, handler, route, productRequests };
  if (handler.length || route.length) return { status: 'reached_backend', terminal: handler.length ? `handler.enter:${handler.at(-1).id || handler.at(-1).span_id || 'joined'}` : 'route.dispatch', db, handler, route, productRequests };
  if (productRequests.length) return { status: 'reached_request', terminal: `request:${productRequests.at(-1).request_occurrence_id || productRequests.at(-1).url}`, db, handler, route, productRequests };
  if (domChanged) return { status: 'correct_stop', terminal: 'correct_stop', reason: 'no first-party request; DOM effect witnessed', db, handler, route, productRequests };
  return { status: 'stop_with_reason', terminal: 'stop_with_reason', reason: 'dispatched but no request or DOM effect witnessed', db, handler, route, productRequests };
}
async function drive(page, item, label, depth) {
  const unit = item.unit; const before = rows.length; const started = Date.now(); let interactionError = null; let domBefore = '';
  try { domBefore = await page.locator('body').innerText({ timeout: 250 }).catch(() => ''); } catch {}
  const locator = page.locator(`[data-producttrace-control-${item.event}]`).nth(item.index);
  try {
    if (!(await locator.isVisible({ timeout: 300 }))) throw new Error('stamped element not visible');
    if (item.event === 'click') await locator.click({ force: true, timeout: 1000 });
    else if (item.event === 'doubleclick' || item.event === 'dblclick') await locator.dblclick({ force: true, timeout: 1000 });
    else if (item.event === 'keydown') { await locator.focus(); await locator.press('Enter'); }
    else if (item.event === 'focus') await locator.focus();
    else if (item.event === 'change' || item.event === 'input') { await locator.focus(); if (await locator.evaluate(e => /INPUT|TEXTAREA|SELECT/.test(e.tagName))) await locator.fill('Tracer'); await locator.dispatchEvent('change'); }
    else if (item.event === 'submit') { const form = locator.locator('xpath=ancestor::form[1]'); const submit = form.locator('button[type="submit"],input[type="submit"]').first(); if (await submit.count()) await submit.click({ force: true }); else await locator.press('Enter'); }
    else { await locator.click({ force: true, timeout: 1000 }); }
  } catch (error) { interactionError = `${error.name || 'Error'}: ${error.message}`; }
  await page.waitForTimeout(550);
  const domAfter = await page.locator('body').innerText({ timeout: 250 }).catch(() => '');
  const domChanged = domBefore !== domAfter || (await page.evaluate(() => document.querySelectorAll('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]').length).catch(() => 0)) > 0;
  const actionRows = rows.slice(before).filter(row => row.action_id);
  const actionId = actionRows.find(row => row.kind === 'dom.action')?.action_id || actionRows.find(row => row.kind === 'network.request')?.action_id || null;
  if (actionId) unitAction.set(unit.unit_id, actionId);
  const chainRows = actionId ? rows.filter(row => row.action_id === actionId) : actionRows;
  let backendRows = [];
  const result = statusFrom(chainRows, domChanged, interactionError);
  const record = { schema: 'producttrace.causal-chain.v1', unit_id: unit.unit_id, action_id: actionId, surface: label, depth, control: { tag: item.tag, testid: item.testid, aria: item.aria, title: item.title, text: item.text, stamp: item.value }, event: item.event, chain: chainRows.filter(row => row.internal !== true), spine: { function_ids: [...new Set(chainRows.flatMap(row => row.spine?.function_ids || []))] }, terminal: { status: result.status, stop_reason: result.reason || null, terminal: result.terminal }, elapsed_ms: Date.now() - started };
  results.push({ unit_id: unit.unit_id, control_id: unit.control_id, control: unit.control, event: unit.event, surface: label, depth, action_id: actionId, requests: result.productRequests.map(row => ({ method: row.method, url: row.url, request_occurrence_id: row.request_occurrence_id })), joined: { route: 0, handler: 0, db: 0 }, spine: record.spine.function_ids, status: result.status, terminal: result.terminal, reason: result.reason || null, witnessed: { dom: domChanged, backend: false } });
  driven.add(unit.unit_id); visitedStampKeys.add(`${item.value}|${item.event}`);
  if (results.length % 50 === 0) { writeProgress(); fs.writeFileSync(path.join(evidenceDir, 'RUN-progress.md'), `completed ${results.length} units\n`); }
  return record;
}

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('request', request => {
    if (!new Set(['fetch', 'xhr', 'eventsource', 'websocket']).has(request.resourceType())) return;
    if (/\/api\/demo\/|\/__capture(?:$|\?)/u.test(request.url())) return;
    observed.push({ method: request.method(), url: request.url().split('?')[0], resource_type: request.resourceType() });
  });
  await page.addInitScript(() => {
    const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; const queue = []; let busy = false; let emitted = 0;
    const nativeFetch = globalThis.fetch.bind(globalThis); const flush = async () => { if (busy) return; busy = true; try { while (queue.length) { const batch = []; let bytes = 0; while (queue.length && batch.length < 384) { const row = queue[0]; const size = JSON.stringify(row).length; if (batch.length && bytes + size > 48 * 1024) break; batch.push(queue.shift()); bytes += size; } let ok = false; for (let attempt = 0; attempt < 6 && !ok; attempt += 1) { try { ok = (await nativeFetch('/__capture', { method: 'POST', body: JSON.stringify({ page_id: pageId, rows: batch }), keepalive: true, headers: { 'content-type': 'application/json' } })).ok; } catch {} if (!ok) await new Promise(resolve => setTimeout(resolve, 25 * (2 ** attempt))); } if (!ok) queue.unshift(...batch); } } finally { busy = false; } };
    globalThis.__producttraceHostCapture = text => { try { queue.push(JSON.parse(text).row); emitted += 1; void flush(); } catch {} }; globalThis.__m1Cycle7CaptureStats = () => ({ page_id: pageId, emitted, queued: queue.length });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 }); await page.waitForTimeout(1200);
  const email = page.locator('input[type="email"], input').first(); if (await email.count()) { await email.fill('tracer-m1@example.test'); await page.locator('input[type="password"]').fill('Tracer-M1-2026!'); await page.getByRole('button', { name: /continue|log in|login/i }).click(); await page.waitForTimeout(1500); }
  console.log(JSON.stringify({ after_login_url: page.url(), live_stamp_count: await page.locator('[data-producttrace-control-click], [data-producttrace-control-change], [data-producttrace-control-keydown], [data-producttrace-control-submit], [data-producttrace-control-input]').count().catch(() => 0) }));
  const chainRecords = [];
  const queueSurface = [{ label: 'c-new', route: '/c/new', depth: 0 }, { label: 'existing-conversation', route: null, depth: 0 }, { label: 'agents', route: '/agents', depth: 0 }, { label: 'prompts', route: '/prompts', depth: 0 }, { label: 'bookmarks', route: '/bookmarks', depth: 0 }, { label: 'settings', route: '/settings', depth: 0 }, { label: 'search', route: '/search', depth: 0 }, { label: 'side-panel-tabs', route: '/c/new', depth: 0 }];
  for (const surface of queueSurface) {
    if (surface.route && new URL(page.url()).pathname !== surface.route) await page.goto(`${origin}${surface.route}`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    else if (surface.label === 'existing-conversation') { const href = await page.locator('a[href*="/c/"]').first().getAttribute('href').catch(() => null); if (href) await page.goto(`${origin}${href}`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); }
    else { await page.waitForTimeout(300); }
    await page.waitForTimeout(400); let pending = await enumerate(page, surface.label, 0);
    for (const item of pending) { if (!driven.has(item.unit.unit_id)) chainRecords.push(await drive(page, item, surface.label, 0)); }
    if (surface.depth < 2) { await page.waitForTimeout(200); const revealed = await enumerate(page, `${surface.label}:revealed`, 1); for (const item of revealed) if (!driven.has(item.unit.unit_id)) chainRecords.push(await drive(page, item, `${surface.label}:revealed`, 1)); }
  }
  await page.waitForTimeout(1200); const stats = await page.evaluate(() => globalThis.__m1Cycle7CaptureStats?.() || ({ emitted: 0, queued: 0 })); const waitUntil = Date.now() + 30000; while (Date.now() < waitUntil && (await page.evaluate(() => globalThis.__m1Cycle7CaptureStats?.().queued || 0))) await page.waitForTimeout(300); capture.emitted = Math.max(stats.emitted || 0, capture.received);
  const spanResponse = await fetch(`${bridgeOrigin}/api/demo/backend-spans/latest`); const spans = spanResponse.ok ? await spanResponse.json() : [];
  const attached = attachBackendSpans(rows, spans);
  const byAction = new Map(); for (const row of attached) { if (!row.action_id) continue; const list = byAction.get(row.action_id) || []; list.push(row); byAction.set(row.action_id, list); }
  for (const result of results) { const joined = byAction.get(result.action_id) || []; result.joined = { route: joined.filter(row => row.kind === 'route.dispatch').length, handler: joined.filter(row => row.kind === 'handler.enter').length, db: joined.filter(row => row.kind === 'db.operation').length }; result.witnessed.backend = result.joined.route + result.joined.handler + result.joined.db > 0; if (result.joined.db) { result.status = 'reached_db'; result.terminal = 'db.operation'; } else if (result.joined.handler || result.joined.route) { result.status = 'reached_backend'; result.terminal = result.joined.handler ? 'handler.enter' : 'route.dispatch'; } }
  for (const unit of units) if (!driven.has(unit.unit_id)) {
    const missing = { unit_id: unit.unit_id, control_id: unit.control_id, control: unit.control, event: unit.event, surface: null, depth: null, action_id: null, requests: [], joined: { route: 0, handler: 0, db: 0 }, spine: [], status: 'not_encountered', terminal: 'not_encountered', reason: 'stamp not rendered on any visited surface', witnessed: { dom: false, backend: false } };
    results.push(missing);
    chainRecords.push({ schema: 'producttrace.causal-chain.v1', unit_id: unit.unit_id, action_id: null, surface: null, depth: null, control: { control_id: unit.control_id, label: unit.control }, event: unit.event, chain: [], spine: { function_ids: [] }, terminal: { status: 'not_encountered', stop_reason: missing.reason } });
  }
  fs.writeFileSync(path.join(evidenceDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'spans.jsonl'), spans.map(row => JSON.stringify(row)).join('\n') + (spans.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), chainRecords.map(row => JSON.stringify(row)).join('\n') + (chainRecords.length ? '\n' : ''));
  const counts = Object.fromEntries([...new Set(results.map(row => row.status))].map(status => [status, results.filter(row => row.status === status).length]));
  const coverage = { schema: 'producttrace.m1-cycle7-coverage.v1', capture: { emitted: capture.emitted, received: capture.received, dropped: capture.dropped, gaps: capture.gaps, contiguous: capture.gaps.length === 0 && capture.dropped === 0 }, transports: { observed: observed.length, wrapper_recorded: rows.filter(row => row.kind === 'network.request').length, reconciliation: 0 }, linkage: { direct: rows.filter(row => row.kind === 'network.request' && row.linkage_kind === 'direct').length, mount_effect: rows.filter(row => row.kind === 'network.request' && row.linkage_kind === 'mount_effect').length, unattributed: rows.filter(row => row.kind === 'network.request' && !row.action_id).length }, inventory: { controls: inventory.controls, drive_units: units.length, passive_units: inventory.passive_units }, final_test: { total_units: results.length, counts }, surfaces, crawl_depth: Math.max(0, ...surfaces.map(surface => surface.depth || 0)), stamps: { encountered_units: driven.size, rendered_stamp_observations: visitedStampKeys.size } };
  fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify(coverage, null, 2));
  const labels = ['reached_db', 'reached_backend', 'reached_request', 'correct_stop', 'stop_with_reason', 'not_encountered', 'unreachable'];
  fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.md'), `# Cycle 7 stamp-driven pattern results\n\nThe driver enumerated live DOM ` + '`data-producttrace-control-*`' + ` stamps and dispatched each mapped (handler,event) unit once with headless Playwright trusted events.\n\nSummary: ${labels.map(label => `${label}=${counts[label] || 0}`).join('; ')}. Total units=${results.length}; surfaces=${surfaces.length}; crawl_depth=${coverage.crawl_depth}.\n\n## Units\n\n${results.map(row => `- ${row.unit_id} | control=${row.control || row.control_id} | event=${row.event} | surface=${row.surface || '-'} | requests=${row.requests.map(request => `${request.method} ${request.url}`).join(', ') || 'none'} | route=${row.joined.route} handler=${row.joined.handler} db=${row.joined.db} | spine=${row.spine.join(' → ') || 'none'} | status=${row.status} | terminal=${row.terminal} | reason=${row.reason || 'effect observed'}`).join('\n')}\n`);
  fs.writeFileSync(path.join(evidenceDir, 'RUN.md'), `# Cycle 7 headless run\n\n- Session was driven headless with Playwright Chromium; no visible browser or GUI application was opened.\n- Fixture: ${fixture}; origin: ${origin}.\n- Surfaces visited:\n${surfaces.map(surface => `  - ${surface.label} depth=${surface.depth} url=${surface.url} stamps=${surface.stamped}`).join('\n')}\n- Stamp-driven units: ${results.length}; encountered and dispatched: ${driven.size}; crawl depth: ${coverage.crawl_depth}.\n- Capture: emitted=${capture.emitted}, received=${capture.received}, dropped=${capture.dropped}, gaps=${capture.gaps.length}.\n`);
  fs.writeFileSync(path.join(evidenceDir, 'LIMITS.md'), `# Cycle 7 limits\n\n- Results report raw terminal categories from the stamp-driven crawl; they are not a grade.\n- Units not rendered on the visited seed surfaces and depth-2 reveal crawl are recorded as not_encountered.\n- Backend joins use the existing exact trace-parent joiner; internal bridge rows are retained in records but hidden from causal-chain paths and the viewer.\n- Passive/handler-less inventory events were counted but not dispatched.\n`);
  console.log(JSON.stringify({ evidenceDir, origin, rows: rows.length, spans: spans.length, capture, units: results.length, encountered: driven.size, counts, surfaces: surfaces.length, crawl_depth: coverage.crawl_depth }));
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
