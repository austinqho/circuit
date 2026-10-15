import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { attachBackendSpans, indexEntryHandlerUnits } from '../../analysis/runtime-attribution.mjs';

// The final drive deliberately keeps one authenticated page alive for the
// scripted flow, fiber checkpoints, trusted dispatch queue, and evidence.
const tracerRoot = path.resolve(import.meta.dirname, '../..');
const worktree = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-m1-final');
const evidenceDir = path.resolve(process.argv[3] || 'docs/evidence/m1-2026-09-22-final');
const manifestPath = path.resolve(process.env.PRODUCTTRACE_MANIFEST || '/tmp/producttrace-librechat-m1-final.json.attribution.json');
const identityBeforeManifestPath = path.resolve(process.env.PRODUCTTRACE_IDENTITY_BEFORE_MANIFEST || '/tmp/producttrace-librechat-m1-final2.json.attribution.json');
const configPath = path.resolve(process.env.PRODUCTTRACE_CONFIG || '/tmp/producttrace-librechat-m1-final.json');
const inventoryPath = path.resolve(process.env.PRODUCTTRACE_INVENTORY || path.join(tracerRoot, 'docs/evidence/m1-2026-09-22-final3/inventory.json'));
const beforeEvidenceDir = path.resolve(process.env.PRODUCTTRACE_BEFORE_EVIDENCE || path.join(tracerRoot, 'docs/evidence/m1-2026-09-22-final3'));
const scriptedOnly = process.env.PRODUCTTRACE_SCRIPTED_ONLY === '1';
const scriptedOnlyComplete = Symbol('scripted-only-complete');
const backend = process.env.PRODUCTTRACE_BACKEND_ORIGIN || 'http://localhost:3080';
const bridge = process.env.PRODUCTTRACE_BRIDGE_ORIGIN || 'http://127.0.0.1:8123';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const identityBeforeManifest = fs.existsSync(identityBeforeManifestPath) ? JSON.parse(fs.readFileSync(identityBeforeManifestPath, 'utf8')) : null;
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const staticUnits = new Map((inventory.units || []).map(unit => [unit.unit_id, unit]));
const manifestById = new Map((manifest.functions || []).map(row => [row.id, row]));
const manifestFiles = [...new Set((manifest.functions || []).map(row => row.source?.file).filter(Boolean))];
const commitEvery50 = process.env.PRODUCTTRACE_COMMIT_EVERY_50 === '1';
fs.mkdirSync(evidenceDir, { recursive: true });

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/LibreChat';
execFileSync('mongosh', ['--quiet', mongoUri, '--eval', `
  const user = db.users.findOne({ email: 'tracer-m1@example.test' });
  if (!user) throw new Error('drive fixture user unavailable');
  db.users.updateOne({ _id: user._id }, { $set: { role: 'ADMIN' } });
  db.files.updateOne(
    { user: user._id, file_id: 'producttrace-preview-fixture' },
    { $set: { bytes: 68, filename: 'producttrace-preview.png', filepath: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', object: 'file', type: 'image/png', source: 'local', context: 'unknown', usage: 0, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
`], { stdio: 'ignore' });

const rows = [];
const retainedBackendSpans = new Map();
const capturePages = new Map();
const observedRequests = [];
let authorizationHeader = null;
const timeline = [];
const stateStops = [];
const surfaces = [];
const seenUnits = new Map();
const dispatchResults = [];
const unitResults = new Map();
const drivenUnitIds = new Set();
const unregisteredOrigins = { first_party_but_unregistered: 0, library_internal: 0, unknown: 0 };
const detachedByState = new Map();
let enumerateSerial = 0;
let currentRevealDepth = 0;
let consistencyPreflight = true;
let liveEntryGate = null;
let createdAgentId = null;
let predriveConsistencyGate = null;
let predriveRows = [];

const capturedEventFor = event => ({
  clickcapture: 'click',
  keydowncapture: 'keydown',
  keypresscapture: 'keypress',
  keyupcapture: 'keyup',
}[event] || event);
const isWriteDbOperation = operation => /^(?:insert|update|delete|replace|bulkwrite|findandmodify)$/iu.test(String(operation || ''));
const requestPath = value => { try { return new URL(String(value || ''), origin).pathname; } catch { return String(value || '').split('?')[0]; } };
const indexActionEvidence = joinedRows => {
  const index = new Map();
  for (const row of joinedRows) {
    if (!row.action_id) continue;
    const prior = index.get(row.action_id) || { route: 0, handler: 0, db: 0, db_write: 0, write_operations: [] };
    if (row.kind === 'route.dispatch') prior.route += 1;
    if (row.kind === 'handler.enter') prior.handler += 1;
    if (row.kind === 'db.operation') { prior.db += 1; if (isWriteDbOperation(row.operation)) { prior.db_write += 1; prior.write_operations.push({ operation: row.operation, collection: row.collection, span_id: row.span_id }); } }
    index.set(row.action_id, prior);
  }
  return index;
};
const evaluateConsistency = (scriptedEntries, actionEvidence, evidenceRows, entryUnitsByAction = new Map()) => {
  const mutationUnits = ['send', 'feedback', 'regenerate', 'edit-resubmit', 'rename', 'agent-create', 'agent-chat', 'delete'];
  const requiredRequest = { 'agent-create': { method: 'POST', path: '/api/agents' }, 'agent-chat': { method: 'POST', path: '/api/agents/chat/agents' } };
  const requestsByAction = new Map();
  for (const row of evidenceRows) if (row.kind === 'network.request' && !row.internal && row.action_id) { const values = requestsByAction.get(row.action_id) || []; values.push(row); requestsByAction.set(row.action_id, values); }
  return Object.fromEntries(mutationUnits.map(name => {
    const entry = scriptedEntries.find(row => row.mutation === name); const ids = entry?.action_ids || []; const required = requiredRequest[name];
    const requestActionIds = required ? ids.filter(id => (requestsByAction.get(id) || []).some(row => String(row.method).toUpperCase() === required.method && requestPath(row.url) === required.path)) : ids;
    const writeActionIds = ids.filter(id => (actionEvidence.get(id)?.db_write || 0) > 0);
    const jointlyProvenActionIds = requestActionIds.filter(id => writeActionIds.includes(id));
    const proofActionIds = required ? jointlyProvenActionIds : writeActionIds;
    const entryHandlerUnits = [...new Set(proofActionIds.flatMap(id => entryUnitsByAction.get(id) || []))];
    const requestEvidence = ids.flatMap(id => (requestsByAction.get(id) || []).map(row => ({ action_id: id, method: row.method, url: requestPath(row.url) })));
    const dbEvidence = ids.map(id => ({ action_id: id, ...(actionEvidence.get(id) || { route: 0, handler: 0, db: 0, db_write: 0, write_operations: [] }) }));
    return [name, { action_ids: ids, reached_db: writeActionIds.length > 0, write_action_ids: writeActionIds, write_operations: writeActionIds.flatMap(id => actionEvidence.get(id)?.write_operations || []), required_request: required || null, request_action_ids: requestActionIds, jointly_proven_action_ids: proofActionIds, entry_handler_units: entryHandlerUnits, entry_handlers_proven: entryHandlerUnits.length > 0, request_evidence: requestEvidence, db_evidence: dbEvidence }];
  }));
};
const consistencyFailures = results => Object.entries(results).filter(([, value]) => !value.action_ids.length || !value.reached_db || !value.entry_handlers_proven || (value.required_request && !value.jointly_proven_action_ids.length));

const proxy = (req, res, target) => {
  const url = new URL(target);
  const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream);
};
const staticRoot = path.join(worktree, 'client/dist');
const server = http.createServer((req, res) => {
  if (req.url === '/__capture' && req.method === 'POST') {
    let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body); const pageId = payload.page_id || 'default';
        const batch = Array.isArray(payload.rows) ? payload.rows : [payload.row || payload];
        const state = capturePages.get(pageId) || { emitted: 0, received: 0, dropped: 0, rows: new Map(), pagehide_flushes: 0 };
        state.emitted = Math.max(state.emitted, Number(payload.emitted) || 0);
        if (payload.pagehide) state.pagehide_flushes += 1;
        for (const row of batch) {
          const sequence = Number(row?.sequence); if (!Number.isFinite(sequence)) continue;
          if (state.rows.has(sequence)) continue;
          state.rows.set(sequence, { ...row, capture_page_id: pageId }); state.received += 1;
          if (row.kind === 'capture.dropped') state.dropped += Math.max(0, Number(row.dropped_end) - Number(row.dropped_start) + 1) || 0;
        }
        capturePages.set(pageId, state); res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end('invalid capture payload'); }
    }); return;
  }
  if (req.url?.startsWith('/api/demo/')) { proxy(req, res, `${bridge}${req.url}`); return; }
  if (req.url?.startsWith('/api/')) { proxy(req, res, `${backend}${req.url}`); return; }
  const pathname = decodeURIComponent(new URL(req.url, 'http://static').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  let file = path.resolve(staticRoot, relative);
  if ((!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) && req.method === 'GET' && !path.extname(pathname)) file = path.join(staticRoot, 'index.html');
  if (!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
page.on('pageerror', error => console.error(`[pageerror] ${String(error?.stack || error)}`));
page.on('console', message => { if (message.type() === 'error') console.error(`[console.error] ${message.text()}`); });
page.on('requestfailed', request => { if (!/\/__capture(?:$|\?)/u.test(request.url())) console.error(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`); });
await new Promise(resolve => { const req = http.request(`${bridge}/api/demo/events`, { method: 'DELETE' }, () => resolve()); req.on('error', () => resolve()); req.end(); });
await page.addInitScript(files => { globalThis.__m1ManifestFiles = files; }, manifestFiles);
await page.addInitScript(() => {
  const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const nativeFetch = globalThis.fetch?.bind(globalThis); const queue = [];
  const maxBytes = 48 * 1024; const maxRows = 512;
  const nativeQueueMicrotask = globalThis.queueMicrotask?.bind(globalThis);
  let emitted = 0; let sent = 0; let dropped = 0; let flushing = null; let flushScheduled = false; let droppedGuard = false;
  const bodyFor = (batch, pagehide = false) => JSON.stringify({ page_id: pageId, emitted, pagehide, rows: batch });
  const nextBatch = () => {
    const batch = []; let bytes = 0;
    for (const row of queue) {
      const size = JSON.stringify(row).length;
      if (batch.length && (batch.length >= maxRows || bytes + size > maxBytes)) break;
      batch.push(row); bytes += size;
    }
    return batch;
  };
  const emitDropped = (batch, reason) => {
    if (droppedGuard || !batch.length) return;
    droppedGuard = true;
    const start = Number(batch[0]?.sequence); const end = Number(batch[batch.length - 1]?.sequence);
    dropped += Math.max(0, end - start + 1);
    try { globalThis.__productTraceRuntime?.emit({ kind: 'capture.dropped', dropped_start: start, dropped_end: end, reason }); } catch {}
    droppedGuard = false;
  };
  const send = async batch => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await nativeFetch('/__capture', { method: 'POST', body: bodyFor(batch), keepalive: true, headers: { 'content-type': 'application/json' } });
        if (response.ok) return true;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt)));
    }
    return false;
  };
  const flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length) {
        const batch = nextBatch(); const ok = await send(batch);
        queue.splice(0, batch.length);
        if (ok) sent += batch.length; else emitDropped(batch, 'capture_chunk_failed');
      }
    })().finally(() => { flushing = null; if (queue.length) void flush(); });
    return flushing;
  };
  const scheduleFlush = () => {
    if (flushScheduled || flushing) return;
    flushScheduled = true;
    (nativeQueueMicrotask || (callback => Promise.resolve().then(callback)))(() => { flushScheduled = false; void flush(); });
  };
  globalThis.__producttraceHostCapture = text => {
    try { const payload = JSON.parse(text); queue.push(payload.row || payload); emitted += 1; scheduleFlush(); } catch {}
  };
  globalThis.__m1DrainCapture = async () => { while (queue.length || flushing) { await (flushing || flush()); } return { page_id: pageId, emitted, sent, dropped, queued: queue.length }; };
  globalThis.__m1CaptureStats = () => ({ page_id: pageId, emitted, sent, dropped, queued: queue.length });
  globalThis.addEventListener('pagehide', () => {
    let flushed = false;
    for (let offset = 0; offset < queue.length;) {
      const batch = []; let bytes = 0;
      while (offset < queue.length && batch.length < maxRows) {
        const row = queue[offset]; const size = JSON.stringify(row).length;
        if (batch.length && bytes + size > maxBytes) break;
        batch.push(row); bytes += size; offset += 1;
      }
      let ok = false; try { ok = navigator.sendBeacon('/__capture', bodyFor(batch, true)); } catch {}
      if (!ok) emitDropped(batch, 'pagehide_beacon_rejected');
      flushed = true;
    }
    if (!flushed) { try { navigator.sendBeacon('/__capture', bodyFor([], true)); } catch {} }
  });
});
page.on('request', request => { const type = request.resourceType(); const authorization = request.headers().authorization; if (authorization) authorizationHeader = authorization; if (['fetch', 'xhr', 'eventsource', 'websocket'].includes(type) && !/(?:producttrace|react-observations|\/api\/demo\/|\/__capture(?:$|\?))/u.test(request.url())) { const parsed = new URL(request.url()); observedRequests.push({ method: request.method(), url: `${parsed.pathname}${parsed.search ? `?${parsed.searchParams.toString()}` : ''}`.split('?')[0], type }); } });

const note = (step, control, result, extra = {}) => { const entry = { step, at: new Date().toISOString(), control, result, ...extra }; timeline.push(entry); return entry; };
const screenshot = async label => page.screenshot({ path: path.join(evidenceDir, `${label}.png`), fullPage: true });
const waitForReply = async () => { await page.waitForTimeout(2500); await page.locator('body').waitFor({ state: 'visible' }); };
const retainCurrentBackendSpans = async () => {
  const latest = await (await fetch(`${bridge}/api/demo/backend-spans/latest`)).json();
  for (const span of latest) if (span?.span_id) retainedBackendSpans.set(span.span_id, span);
  return [...retainedBackendSpans.values()];
};
const drainCaptureChannel = async () => {
  await page.evaluate(() => globalThis.__m1DrainCapture?.());
  await retainCurrentBackendSpans();
};
const materializeCapturedRows = () => {
  rows.splice(0, rows.length);
  for (const [pageId, state] of capturePages) {
    for (const [sequence, row] of [...state.rows].sort(([left], [right]) => left - right)) rows.push({ ...row, sequence, capture_page_id: pageId });
  }
  rows.sort((left, right) => Number(left.timestamp) - Number(right.timestamp) || String(left.capture_page_id).localeCompare(String(right.capture_page_id)) || Number(left.sequence) - Number(right.sequence));
  return rows;
};
const openLatestPersistedConversation = async () => {
  if (!authorizationHeader) throw new Error('authenticated request header unavailable');
  const conversationId = await page.evaluate(async authorization => {
    const response = await fetch('/api/convos?limit=1&sortBy=updatedAt&sortDirection=desc', { headers: { authorization } });
    if (!response.ok) throw new Error(`conversation list failed with ${response.status}`);
    const body = await response.json();
    return body?.conversations?.[0]?.conversationId || body?.[0]?.conversationId || null;
  }, authorizationHeader);
  if (!conversationId) throw new Error('persisted conversation list returned no id');
  await drainCaptureChannel();
  await page.goto(`${origin}/c/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\/c\/(?!new(?:\/|$))/.test(location.pathname), null, { timeout: 10000 });
  await page.locator('button[title="Needs improvement"]:visible').last().waitFor({ state: 'visible', timeout: 10000 });
};
const eventName = key => key.slice(2).toLowerCase();

const enumerate = async (label, trigger = null, options = {}) => {
  const drive = options.drive ?? !consistencyPreflight;
  if (trigger) { try { await trigger(); } catch (error) { timeline.push({ step: 'trigger-stop', label, error: String(error.message || error) }); } }
  const serial = ++enumerateSerial;
  const result = await page.evaluate(({ surface, serial }) => {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__, runtime = globalThis.__productTraceRuntime; const roots = [];
    if (hook?.renderers && hook?.getFiberRoots) for (const rendererId of hook.renderers.keys()) for (const root of hook.getFiberRoots(rendererId) || []) roots.push(root.current || root);
    const seen = new Set(); const units = new Map(); const handlers = []; let hostEventProps = 0, direct = 0, viaAncestor = 0, viaAncestorAny = 0, unregistered = 0, stamped = 0, elementId = 0;
    const eventName = key => key.slice(2).toLowerCase();
    const category = event => /^on(?:Click|DoubleClick|Mouse|Pointer)/u.test(event) ? 'pointer' : /^onKey/u.test(event) ? 'keyboard' : /^on(?:Submit|Change|Input)/u.test(event) ? 'form' : 'other';
    const compatible = (a, b) => category(a) === category(b) && category(a) !== 'other';
    const sourceOf = fiber => { let cursor = fiber; while (cursor) { const source = cursor._debugSource || cursor._debugOwner?._debugSource; if (source?.fileName) return String(source.fileName); cursor = cursor.return; } return null; };
    const ownerOf = fiber => { const file = sourceOf(fiber); return file ? file.split('/').slice(-3).join('/') : (fiber?.type?.displayName || fiber?.type?.name || 'unknown'); };
    const visit = fiber => { if (!fiber || seen.has(fiber)) return; seen.add(fiber); if (fiber.tag === 5 && fiber.stateNode instanceof Element) { const props = fiber.memoizedProps || {}; const keys = Object.keys(props).filter(key => /^on[A-Z]/u.test(key) && typeof props[key] === 'function'); hostEventProps += keys.length; const id = `m1-fiber-${serial}-${++elementId}`; fiber.stateNode.setAttribute('data-m1-fiber-id', id); if ([...fiber.stateNode.attributes].some(attr => attr.name.startsWith('data-producttrace-control-'))) stamped += 1; for (const event of keys) { const fn = props[event]; let functionId = runtime?.functionIdOf?.(fn); let kind = 'direct'; let owner = fiber; if (!functionId) { let cursor = fiber.return; while (cursor) { const candidate = cursor.memoizedProps?.[event]; const idValue = runtime?.functionIdOf?.(candidate); if (idValue) { functionId = idValue; kind = 'via_ancestor'; owner = cursor; break; } cursor = cursor.return; } } if (!functionId) { let cursor = fiber.return; while (cursor) { const candidateProps = cursor.memoizedProps || {}; const match = Object.keys(candidateProps).find(key => /^on[A-Z]/u.test(key) && compatible(event, key) && runtime?.functionIdOf?.(candidateProps[key])); if (match) { functionId = runtime.functionIdOf(candidateProps[match]); kind = 'via_ancestor_any'; owner = cursor; break; } cursor = cursor.return; } } const origin = /__productTraceRuntime\??\.(?:enter|exit)/u.test(String(fn)); handlers.push({ event, function_id: functionId, function_source: String(fn), kind, origin: functionId ? null : (origin ? 'first_party_but_unregistered' : 'library_internal'), owner: ownerOf(owner), element_id: id }); if (functionId) { if (kind === 'direct') direct += 1; else if (kind === 'via_ancestor') viaAncestor += 1; else viaAncestorAny += 1; const unitKey = `${functionId}|${eventName(event)}`; const current = units.get(unitKey); const row = { unit_id: unitKey, function_id: functionId, event: eventName(event), fiber_event: event, kind, element_id: id, tag: fiber.stateNode.tagName, element_ids: [id], text: (fiber.stateNode.innerText || '').slice(0, 160), testid: fiber.stateNode.getAttribute('data-testid'), aria: fiber.stateNode.getAttribute('aria-label'), title: fiber.stateNode.getAttribute('title'), owner: ownerOf(owner) }; if (current) current.element_ids.push(id); else units.set(unitKey, row); } else unregistered += 1; } } visit(fiber.child); visit(fiber.sibling); };
    for (const root of roots) visit(root);
    const signatureSelectors = ['[role="dialog"]', '[role="menu"]', 'main h1', 'main h2', 'form[aria-label]', '#agent-search', 'textarea[data-testid]', 'input[aria-label]', 'button[aria-label]', 'button'];
    const signatureElement = signatureSelectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
    const signature = signatureElement ? { tag: signatureElement.tagName, testid: signatureElement.getAttribute('data-testid'), aria: signatureElement.getAttribute('aria-label'), role: signatureElement.getAttribute('role'), text: (signatureElement.textContent || '').trim().slice(0, 80) } : null;
    return { surface, url: location.pathname, signature, roots: roots.length, host_event_props: hostEventProps, direct, via_ancestor: viaAncestor, via_ancestor_any: viaAncestorAny, unregistered, stamped, handlers, units: [...units.values()] };
  }, { surface: label, serial });
  const prior = surfaces.at(-1); result.not_reached = Boolean(prior && prior.host_event_props === result.host_event_props && prior.direct === result.direct && prior.via_ancestor === result.via_ancestor && prior.via_ancestor_any === result.via_ancestor_any && prior.unregistered === result.unregistered && prior.stamped === result.stamped);
  for (const handler of result.handlers) if (handler.origin) unregisteredOrigins[handler.origin] += 1;
  for (const unit of result.units) {
    if (!seenUnits.has(unit.unit_id)) seenUnits.set(unit.unit_id, { ...unit, first_surface: label, snapshots: [] });
    const stable = seenUnits.get(unit.unit_id);
    // Keep the current state's element ids only. Old DOM nodes must never be
    // queued for a later state; a unit is remembered only after a real dispatch.
    stable.element_ids = [...new Set(unit.element_ids)]; stable.last_surface = label;
    stable.snapshots.push({ surface: label, element_id: unit.element_id, tag: unit.tag, testid: unit.testid, aria: unit.aria, title: unit.title, text: unit.text });
  }
  surfaces.push({ ...result, units: result.units.length, screenshot: `surface-${String(surfaces.length + 1).padStart(2, '0')}.png` });
  await screenshot(`surface-${String(surfaces.length).padStart(2, '0')}`);
  if (drive && result.units.length) {
    const candidates = result.units.filter(unit => !drivenUnitIds.has(unit.unit_id));
    for (const unit of candidates) {
      const attempt = await dispatchUnit({ ...unit, first_surface: label, state: label, element_ids: unit.element_ids });
      const prior = unitResults.get(unit.unit_id);
      // Select one coherent action attempt. Requests, action id, outcome,
      // reason, and state always come from that same attempt.
      const selected = !prior || attempt.witnessed_dom || !prior.witnessed_dom ? attempt : prior;
      const merged = { ...selected, attempts: [...(prior?.attempts || []), ...(attempt.attempts || [])] };
      unitResults.set(unit.unit_id, merged);
      dispatchResults.splice(0, dispatchResults.length, ...unitResults.values());
      if (attempt.attempts?.some(item => item.dispatched)) {
        drivenUnitIds.add(unit.unit_id); commitCheckpoint(drivenUnitIds.size);
      }
      if (attempt.witnessed_dom) {
        if (currentRevealDepth < 2) {
          currentRevealDepth += 1;
          await enumerate(`reveal-depth-${currentRevealDepth}-${label}`, null, { drive: true });
        }
      }
    }
    // The dispatch may have changed menus, dialogs, or route content. Capture
    // the post-dispatch state before the next scripted operation.
    await enumerate(`${label}-post-drive`, null, { drive: false });
  }
  return result;
};

const scripted = [];
const runLiveEntryGate = async () => {
  const beforeSequence = await page.evaluate(() => Math.max(0, ...(globalThis.__productTraceRuntime?.records || []).map(row => Number(row.sequence) || 0)));
  const candidate = await page.evaluate(() => {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__, runtime = globalThis.__productTraceRuntime; const roots = [];
    if (hook?.renderers && hook?.getFiberRoots) for (const rendererId of hook.renderers.keys()) for (const root of hook.getFiberRoots(rendererId) || []) roots.push(root.current || root);
    const seen = new Set(); const candidates = [];
    const visit = fiber => {
      if (!fiber || seen.has(fiber)) return; seen.add(fiber);
      if (fiber.tag === 5 && fiber.stateNode instanceof HTMLButtonElement) {
        const element = fiber.stateNode; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
        const functionId = runtime?.functionIdOf?.(fiber.memoizedProps?.onClick) || null;
        if (functionId && element.isConnected && !element.disabled && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
          const label = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''} ${element.textContent || ''}`.trim();
          const safe = /sidebar|new chat/i.test(label); candidates.push({ element, functionId, label, safe });
        }
      }
      visit(fiber.child); visit(fiber.sibling);
    };
    for (const root of roots) visit(root);
    const chosen = candidates.find(row => row.safe) || candidates[0];
    if (!chosen) return null;
    const id = `m1-entry-gate-${Date.now().toString(36)}`; chosen.element.setAttribute('data-m1-entry-gate', id);
    return { id, function_id: chosen.functionId, label: chosen.label };
  });
  if (!candidate) throw new Error('live function-entry gate found no safe registered click target');
  await page.locator(`[data-m1-entry-gate="${candidate.id}"]`).click({ timeout: 2000 });
  await page.waitForTimeout(200);
  const evidence = await page.evaluate(sequence => {
    const fresh = (globalThis.__productTraceRuntime?.records || []).filter(row => (Number(row.sequence) || 0) > sequence);
    const action = fresh.find(row => row.kind === 'dom.action' && row.event === 'click');
    const enters = action ? fresh.filter(row => row.kind === 'function.enter' && row.action_id === action.action_id) : [];
    const exits = action ? fresh.filter(row => row.kind === 'function.exit' && row.action_id === action.action_id) : [];
    return { action_id: action?.action_id || null, enters: enters.length, exits: exits.length, function_ids: [...new Set(enters.map(row => row.function_id))] };
  }, beforeSequence);
  liveEntryGate = { ...candidate, ...evidence, passed: Boolean(evidence.action_id && evidence.enters > 0) };
  if (!liveEntryGate.passed) throw new Error(`live function-entry gate failed: action=${evidence.action_id || 'none'} enters=${evidence.enters} target=${candidate.label} function=${candidate.function_id}`);
  await drainCaptureChannel();
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
  const restore = page.locator('[data-testid="open-sidebar-button"]:visible,button[aria-label="Open sidebar"]:visible').first();
  if (await restore.count()) { await restore.click({ force: true }); await page.waitForTimeout(150); }
};

const scriptedStep = async (step, control, operation, extra = {}) => {
  await drainCaptureChannel();
  const before = new Set(materializeCapturedRows().filter(row => row.kind === 'dom.action').map(row => row.action_id));
  let result = 'completed'; try { await operation(); } catch (error) { result = `STOP: ${String(error.message || error)}`; }
  await page.waitForTimeout(120);
  await drainCaptureChannel();
  let after = materializeCapturedRows().filter(row => row.kind === 'dom.action').map(row => row.action_id);
  let action_ids = [...new Set(after.filter(id => !before.has(id)))];
  if (extra.mutation && !action_ids.length && extra.mutation !== 'send') {
    try {
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      if (['feedback', 'regenerate', 'edit-resubmit'].includes(extra.mutation)) {
        const message = page.locator('[data-testid*="message"],.message').last(); if (await message.count()) await message.hover({ force: true });
      }
      if (['rename', 'delete'].includes(extra.mutation)) {
        const sidebar = page.locator('button[aria-label*="sidebar" i],button[title*="sidebar" i]').first(); if (await sidebar.count()) { await sidebar.click({ force: true }); await page.waitForTimeout(150); }
      }
      await operation(); await page.waitForTimeout(120);
      await drainCaptureChannel();
      after = materializeCapturedRows().filter(row => row.kind === 'dom.action').map(row => row.action_id);
      action_ids = [...new Set(after.filter(id => !before.has(id)))];
      result = action_ids.length ? 'completed-after-retry' : result;
    } catch (error) { result = `${result}; RETRY STOP: ${String(error.message || error)}`; }
  }
  if (extra.mutation && !action_ids.length) {
    const failure = `${extra.mutation} scripted step produced no dom.action after retry: ${result}`;
    timeline.push({ step, control, result: 'FAIL', error: failure });
    throw new Error(failure);
  }
  if (extra.mutation && /^STOP:/u.test(result)) {
    const failure = `${extra.mutation} scripted step did not complete: ${result}`;
    timeline.push({ step, control, result: 'FAIL', error: failure });
    throw new Error(failure);
  }
  const entry = note(step, control, result, { ...extra, action_ids }); scripted.push(entry); await enumerate(`step-${String(step).padStart(2, '0')}`); return entry;
};

const resolveLiveElements = async unit => page.evaluate(({ functionId, event }) => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__, runtime = globalThis.__productTraceRuntime;
  const roots = [];
  if (hook?.renderers && hook?.getFiberRoots) for (const rendererId of hook.renderers.keys()) for (const root of hook.getFiberRoots(rendererId) || []) roots.push(root.current || root);
  const propByEvent = {
    blur: 'onBlur', change: 'onChange', click: 'onClick', clickcapture: 'onClickCapture', contextmenu: 'onContextMenu',
    doubleclick: 'onDoubleClick', focus: 'onFocus', input: 'onInput', keydown: 'onKeyDown', keydowncapture: 'onKeyDownCapture',
    keypress: 'onKeyPress', keypresscapture: 'onKeyPressCapture', keyup: 'onKeyUp', keyupcapture: 'onKeyUpCapture',
    mousedown: 'onMouseDown', mouseup: 'onMouseUp', pointerdown: 'onPointerDown', pointerup: 'onPointerUp', submit: 'onSubmit',
  };
  const prop = propByEvent[event] || `on${event.slice(0, 1).toUpperCase()}${event.slice(1)}`;
  const category = value => /^on(?:Click|DoubleClick|Mouse|Pointer)/u.test(value) ? 'pointer' : /^onKey/u.test(value) ? 'keyboard' : /^on(?:Submit|Change|Input)/u.test(value) ? 'form' : 'other';
  const compatible = (a, b) => category(a) === category(b) && category(a) !== 'other';
  const elements = []; const seen = new Set(); let serial = 0;
  const visit = fiber => {
    if (!fiber || seen.has(fiber)) return; seen.add(fiber);
    if (fiber.tag === 5 && fiber.stateNode instanceof Element) {
      const props = fiber.memoizedProps || {}; let match = runtime?.functionIdOf?.(props[prop]);
      if (!match) { let cursor = fiber.return; while (cursor && !match) { match = runtime?.functionIdOf?.(cursor.memoizedProps?.[prop]); cursor = cursor.return; } }
      if (!match) { let cursor = fiber.return; while (cursor && !match) { const candidateProps = cursor.memoizedProps || {}; const key = Object.keys(candidateProps).find(value => /^on[A-Z]/u.test(value) && compatible(prop, value) && runtime?.functionIdOf?.(candidateProps[value])); if (key) match = runtime.functionIdOf(candidateProps[key]); cursor = cursor.return; } }
      if (match === functionId) {
        const element = fiber.stateNode; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const covered = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(center.x, center.y) : null;
        const state = { hidden: style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0', disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), zero_size: rect.width === 0 || rect.height === 0, covered: Boolean(covered && covered !== element && !element.contains(covered)), detached: !element.isConnected };
        const reason = state.detached ? 'detached' : state.hidden ? 'hidden' : state.disabled ? 'disabled' : state.zero_size ? 'zero-size' : state.covered ? 'covered' : null;
        const id = `m1-live-fiber-${Date.now().toString(36)}-${++serial}`; element.setAttribute('data-m1-live-fiber-id', id);
        elements.push({ id, tag: element.tagName, reason });
      }
    }
    visit(fiber.child); visit(fiber.sibling);
  };
  for (const root of roots) visit(root);
  const mutationToken = `m1-mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  globalThis.__m1MutationObservers ||= new Map();
  const receipt = { count: 0, attributes: 0, child_list: 0, character_data: 0 };
  const observer = new MutationObserver(mutations => {
    receipt.count += mutations.length;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') receipt.attributes += 1;
      else if (mutation.type === 'childList') receipt.child_list += 1;
      else if (mutation.type === 'characterData') receipt.character_data += 1;
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  globalThis.__m1MutationObservers.set(mutationToken, { observer, receipt });
  return { elements, mutationToken };
}, { functionId: unit.function_id, event: unit.event });

const finishMutationReceipt = token => page.evaluate(value => {
  const entry = globalThis.__m1MutationObservers?.get(value);
  if (!entry) return { count: 0, attributes: 0, child_list: 0, character_data: 0 };
  entry.observer.takeRecords().forEach(mutation => {
    entry.receipt.count += 1;
    if (mutation.type === 'attributes') entry.receipt.attributes += 1;
    else if (mutation.type === 'childList') entry.receipt.child_list += 1;
    else if (mutation.type === 'characterData') entry.receipt.character_data += 1;
  });
  entry.observer.disconnect(); globalThis.__m1MutationObservers.delete(value); return entry.receipt;
}, token);

const dispatchUnit = async unit => {
  const stateLabel = unit.state || unit.first_surface || 'unknown-state';
  const result = { unit_id: unit.unit_id, function_id: unit.function_id, surface: stateLabel, state: stateLabel, event: unit.event, kind: unit.kind, requests: [], action_id: null, terminal: 'stop_with_reason', reason: null, witnessed_dom: false, witnessed_backend: false, attempts: [] };
  const markDetached = () => detachedByState.set(stateLabel, (detachedByState.get(stateLabel) || 0) + 1);
  for (let index = 0; index < 3 && !result.witnessed_dom; index += 1) {
    // Re-walk the current Fiber tree after every await boundary. The locator is
    // constructed only from the fresh id and is acted on immediately; no DOM
    // element or ElementHandle survives across an await.
    const beforeActions = new Set(await page.evaluate(() => (globalThis.__productTraceRuntime?.records || []).filter(row => row.kind === 'dom.action').map(row => row.action_id)));
    const resolution = await resolveLiveElements(unit);
    const elements = resolution.elements;
    const live = elements.find(element => !element.reason);
    if (!live) {
      // A function that is absent from the freshly walked current Fiber tree
      // was removed by an earlier state transition; it is not a detached DOM
      // reference because no prior element reference was retained.
      const reason = elements[0]?.reason || 'not-present-in-current-state';
      if (reason === 'detached') markDetached();
      await finishMutationReceipt(resolution.mutationToken);
      result.attempts.push({ index, reason, state: stateLabel });
      break;
    }
    const locator = page.locator(`[data-m1-live-fiber-id="${live.id}"]`).first();
    try {
      if (unit.event === 'click') await locator.click({ timeout: 1500 }); else if (unit.event === 'doubleclick') await locator.dblclick({ timeout: 1500 }); else if (unit.event === 'mousedown' || unit.event === 'mouseup') await locator.dispatchEvent(unit.event); else if (unit.event === 'focus') await locator.focus(); else if (unit.event === 'change') { if (/^(INPUT|TEXTAREA|SELECT)$/u.test(live.tag)) await locator.fill('m1-final'); else await locator.dispatchEvent('change'); } else if (unit.event === 'submit') { const form = locator.locator('xpath=ancestor::form').first(); const submit = form.locator('button[type="submit"],input[type="submit"]').first(); if (await submit.count()) await submit.click(); else await locator.press('Enter'); } else if (unit.event.startsWith('key')) await locator.press(unit.event === 'keydown' ? 'Enter' : 'Escape'); else await locator.dispatchEvent(unit.event);
      await page.waitForTimeout(220);
      const receipt = await finishMutationReceipt(resolution.mutationToken);
      const actionRows = await page.evaluate(() => (globalThis.__productTraceRuntime?.records || []).slice());
      const expectedEvent = capturedEventFor(unit.event);
      const action = [...actionRows].reverse().find(row => row.kind === 'dom.action' && row.event === expectedEvent && !beforeActions.has(row.action_id));
      result.action_id = action?.action_id || null;
      result.witnessed_dom = Boolean(action);
      result.effect_receipt = action && receipt.count > 0 ? { kind: 'dom.mutation', ...receipt } : null;
      if (result.effect_receipt) await page.evaluate(({ actionId, effect }) => globalThis.__productTraceRuntime?.emit?.({ kind: 'dom.mutation', action_id: actionId, ...effect }), { actionId: result.action_id, effect: result.effect_receipt });
      result.requests = result.action_id ? actionRows.filter(row => row.kind === 'network.request' && !row.internal && row.action_id === result.action_id).map(row => ({ action_id: row.action_id, method: row.method, url: row.url, request_occurrence_id: row.request_occurrence_id })) : [];
      if (!action) { result.terminal = 'unreachable'; result.reason = `no matching ${expectedEvent} dom.action at ${stateLabel}`; }
      else if (result.requests.length) result.terminal = 'reached_request';
      else if (result.effect_receipt) { result.terminal = 'correct_stop'; result.reason = 'DOM action and mutation effect witnessed; no first-party request by design'; }
      else { result.terminal = 'stop_with_reason'; result.reason = 'no_effect_witnessed'; }
      result.attempts.push({ index, dispatched: true, action_id: result.action_id, effect_receipt: result.effect_receipt, state: stateLabel }); break;
    } catch (error) {
      await finishMutationReceipt(resolution.mutationToken).catch(() => {});
      const reason = /detached|not attached|not connected|resolved to 0 elements/u.test(String(error.message || error)) ? 'detached' : String(error.message || error);
      if (reason === 'detached') markDetached();
      result.attempts.push({ index, reason, state: stateLabel });
    }
  }
  if (!result.witnessed_dom) { result.terminal = 'unreachable'; const last = result.attempts.at(-1); result.reason = last ? `${String(last.reason || 'no reachable instance').replace(/ at .+$/u, '')} at ${last.state || stateLabel}` : `no reachable instance at ${stateLabel}`; result.requests = []; result.action_id = null; }
  return result;
};

const commitCheckpoint = index => {
  if (!commitEvery50 || !index || index % 50) return;
  fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.partial.md'), dispatchResults.map(row => `- ${row.unit_id} | ${row.terminal} | ${row.event} | ${row.reason || ''}`).join('\n') + '\n');
  try { execFileSync('git', ['add', path.relative(tracerRoot, path.join(evidenceDir, 'PATTERN-RESULTS.partial.md'))], { cwd: tracerRoot, stdio: 'ignore' }); execFileSync('git', ['commit', '-m', `record M1 final drive checkpoint ${index}`], { cwd: tracerRoot, stdio: 'ignore' }); } catch {}
};

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const loginOrApp = page.locator('form input[name="email"],form input[autocomplete="username"],form input,textarea[data-testid="text-input"],[data-testid="new-chat-button"],[data-testid="nav-panel-agents"]').first();
  try { await loginOrApp.waitFor({ state: 'visible', timeout: 30000 }); }
  catch (error) {
    const diagnostic = await page.evaluate(() => ({ href: location.href, title: document.title, ready_state: document.readyState, body_text: (document.body?.innerText || '').slice(0, 500), body_html: (document.body?.innerHTML || '').slice(0, 1000), runtime_rows: globalThis.__productTraceRuntime?.records?.length || 0 }));
    console.error(`[startup-diagnostic] ${JSON.stringify(diagnostic)}`); throw error;
  }
  await scriptedStep(1, 'login', async () => {
    const email = page.locator('form input[name="email"],form input[autocomplete="username"],form input').first();
    if (await email.count()) {
      await email.fill('tracer-m1@example.test'); await page.locator('input[type="password"]').first().fill('Tracer-M1-2026!');
      await page.getByRole('button', { name: /continue|log in|login/i }).click();
    }
    await page.locator('textarea[data-testid="text-input"],[data-testid="new-chat-button"],[data-testid="nav-panel-agents"]').first().waitFor({ state: 'visible', timeout: 30000 });
  });
  await runLiveEntryGate();
  await scriptedStep(2, 'send message', async () => {
    let newChat = page.locator('[data-testid="new-chat-button"]:visible').first();
    if (!(await newChat.count())) newChat = page.getByRole('button', { name: /New chat/i }).first();
    if (!(await newChat.count())) {
      const sidebar = page.locator('button[aria-label*="sidebar" i],button[title*="sidebar" i]').first();
      if (await sidebar.count()) { await sidebar.click({ force: true }); await page.waitForTimeout(150); }
      newChat = page.locator('[data-testid="new-chat-button"]:visible').first();
      if (!(await newChat.count())) newChat = page.getByRole('button', { name: /New chat/i }).first();
    }
    if (!(await newChat.count())) throw new Error('new chat unavailable after restoring sidebar');
    await newChat.click({ force: true }); await enumerate('step-02-new-chat');
    await page.locator('[data-testid="model-selector-button"]').click();
    const modelSearch = page.locator('#model-search'); await modelSearch.fill('gpt-3.5-turbo');
    await page.getByText('gpt-3.5-turbo', { exact: true }).last().click(); await page.waitForTimeout(250);
    const input = page.locator('textarea[data-testid="text-input"]').first(); await input.fill('Give me three names for a coffee shop in one line.'); await page.locator('button[data-testid="send-button"]').click({ force: true }); await waitForReply(); await openLatestPersistedConversation();
  }, { mutation: 'send' });
  await scriptedStep(3, 'copy response', async () => { const message = page.getByText(/coffee shop/i).last(); if (await message.count()) { await message.hover(); await enumerate('step-03-message-hover'); } await page.locator('[data-testid="copy-response-button"]').last().click(); }, { mutation: 'copy' });
  await scriptedStep(4, 'thumbs-down feedback', async () => { await page.locator('button[title="Needs improvement"]').last().click(); await enumerate('step-04-feedback-menu'); await page.getByText(/Didn\'t match my request|Not helpful|Other/i).first().click(); const submit = page.locator('button:visible').filter({ hasText: /submit|send|confirm/i }).last(); if (await submit.count()) await submit.click({ force: true }); }, { mutation: 'feedback' });
  await scriptedStep(5, 'regenerate', async () => { await page.locator('[data-testid="regenerate-generation-button"]').last().click(); await enumerate('step-05-regenerate'); await waitForReply(); }, { mutation: 'regenerate' });
  await scriptedStep(6, 'edit-and-resubmit', async () => {
    const message = page.getByText('Give me three names for a coffee shop in one line.', { exact: true }).first();
    if (await message.count()) { await message.hover({ force: true }); await enumerate('step-06-edit-hover'); }
    const buttons = page.locator('button[title="Edit"],button[aria-label*="Edit" i]');
    const index = await buttons.evaluateAll(items => items.findIndex(button => {
      let node = button;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if ((node.innerText || '').includes('Give me three names for a coffee shop')) return true;
      }
      return false;
    }));
    if (index < 0) throw new Error(`message edit button unavailable among ${await buttons.count()} buttons`);
    await buttons.nth(index).click({ force: true }); await enumerate('step-06-edit-dialog');
    const edit = page.locator('[data-testid="message-text-editor"]:visible,textarea[aria-label*="edit" i]:visible,textarea[data-testid*="edit" i]:visible,textarea[placeholder*="edit" i]:visible').last();
    if (!(await edit.count())) throw new Error('edit textarea unavailable');
    await edit.click({ force: true }); await edit.press('ControlOrMeta+A'); await edit.fill('Give me three names for a tea shop in one line.');
    await page.getByText('Save & Submit', { exact: true }).last().click({ force: true }); await waitForReply();
  }, { mutation: 'edit-resubmit' });
  await scriptedStep(7, 'rename', async () => { const menu = page.locator('button[aria-label="Conversation Menu Options"]:visible').last(); if (!(await menu.count())) throw new Error('conversation menu unavailable'); await menu.click(); await enumerate('step-07-conversation-menu'); await page.getByText('Rename', { exact: true }).last().click(); await enumerate('step-07-rename-dialog'); const title = page.locator('input:visible').last(); await title.fill('Tracer M1'); await page.getByRole('button', { name: /^Save$/i }).last().click(); await page.waitForTimeout(500); }, { mutation: 'rename' });
  await scriptedStep('overlap', 'bookmark surface during regeneration', async () => { const regenerate = page.locator('[data-testid="regenerate-generation-button"]:visible').last(); if (await regenerate.count()) await regenerate.click({ force: true }); await page.waitForTimeout(250); const bookmarks = page.getByRole('button', { name: /bookmark/i }).first(); if (await bookmarks.count()) { await bookmarks.click({ force: true }); await enumerate('overlap-bookmarks'); } }, { mutation: 'overlap' });
  await scriptedStep(8, 'agent create', async () => {
    await page.locator('[data-testid="nav-panel-agents"]').click(); await enumerate('step-08-agent-builder'); await page.waitForTimeout(700);
    const form = page.locator('form[aria-label="Agent configuration form"]'); await form.waitFor({ state: 'visible' });
    await form.getByText('Select a model', { exact: true }).last().click(); await enumerate('step-08-model-panel');
    await page.getByText('Select a provider', { exact: true }).click(); await enumerate('step-08-provider-panel');
    await page.getByRole('option', { name: /^openAI$/i }).click(); await page.waitForTimeout(300);
    await form.getByRole('combobox', { name: /^Model$/i }).filter({ hasText: 'gpt-3.5-turbo' }).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /Back to builder/i }).click();
    await form.getByLabel(/Agent name/i).fill(`Barista ${Date.now()}`);
    await form.getByLabel(/Instructions/i).fill('You only talk about coffee.');
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && requestPath(response.url()) === '/api/agents', { timeout: 10000 });
    await form.getByRole('button', { name: /^Create$/i }).click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`POST /api/agents failed with ${response.status()}`);
    const created = await response.json(); createdAgentId = created?.id || null;
    if (!createdAgentId) throw new Error('POST /api/agents returned no agent id');
    await form.getByRole('button', { name: /Select Agent/i }).waitFor({ state: 'visible', timeout: 10000 });
  }, { mutation: 'agent-create' });
  await scriptedStep(9, 'agent chat', async () => {
    if (!createdAgentId) throw new Error('agent chat has no created agent id');
    const form = page.locator('form[aria-label="Agent configuration form"]');
    await form.getByRole('button', { name: /Select Agent/i }).click(); await page.waitForTimeout(700); await enumerate('step-09-agent-selected');
    const input = page.locator('textarea[data-testid="text-input"]').first(); await input.fill('What is a flat white?');
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && requestPath(response.url()) === '/api/agents/chat/agents', { timeout: 15000 });
    await page.locator('button[data-testid="send-button"]').click({ force: true });
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`POST /api/agents/chat/agents failed with ${response.status()}`);
    await waitForReply();
  }, { mutation: 'agent-chat' });
  await scriptedStep(10, 'delete conversation', async () => {
    if (await page.locator('form[aria-label="Agent configuration form"]:visible').count()) { await page.locator('[data-testid="nav-panel-conversations"]').click({ force: true }); await page.waitForTimeout(500); }
    let conversation = page.locator('[data-testid="convo-item"]:visible').first();
    if (!(await conversation.count())) {
      const openSidebar = page.locator('[data-testid="open-sidebar-button"]:visible,button[aria-label="Open sidebar"]:visible').first();
      if (await openSidebar.count()) { await openSidebar.click({ force: true }); await page.waitForTimeout(500); }
      conversation = page.locator('[data-testid="convo-item"]:visible').first();
    }
    await conversation.waitFor({ state: 'visible', timeout: 5000 }); await conversation.hover({ force: true });
    const deleteItem = page.getByText('Delete', { exact: true }).last();
    for (let attempt = 0; attempt < 3 && !(await deleteItem.isVisible().catch(() => false)); attempt += 1) {
      await conversation.hover({ force: true });
      const menu = conversation.getByRole('button', { name: 'Conversation Menu Options' });
      if (!(await menu.count())) throw new Error('conversation menu unavailable after closing agent builder');
      if (attempt % 2 === 0) await menu.click(); else await menu.press('Enter');
      await deleteItem.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    if (!(await deleteItem.isVisible().catch(() => false))) throw new Error('delete menu item unavailable after three same-conversation retries');
    await enumerate('step-10-delete-menu'); await deleteItem.click({ force: true }); await page.waitForTimeout(300); const confirm = page.getByRole('button', { name: /Delete|Confirm/i }).last(); if (await confirm.count()) { await confirm.click({ force: true }); await enumerate('step-10-delete-confirm'); }
  }, { mutation: 'delete' });

  // The consistency flow is a fail-closed preflight. The coverage phase starts
  // only after all mutation actions have emitted IDs, exact request routes, and
  // joined write spans. Every enumeration below then dispatches newly visible
  // units immediately in that same state.
  const preflightDeadline = Date.now() + 20000;
  let preflightFailures = [];
  while (Date.now() < preflightDeadline) {
    await drainCaptureChannel();
    predriveRows = [...materializeCapturedRows()];
    const backendSpans = await retainCurrentBackendSpans();
    const actionEvidence = indexActionEvidence(attachBackendSpans(predriveRows, backendSpans));
    const predriveEntryUnits = indexEntryHandlerUnits(predriveRows, { registeredFunctionIds: manifestById.keys() });
    predriveConsistencyGate = evaluateConsistency(scripted, actionEvidence, predriveRows, predriveEntryUnits.byAction);
    preflightFailures = consistencyFailures(predriveConsistencyGate);
    if (!preflightFailures.length) break;
    await page.waitForTimeout(400);
  }
  if (preflightFailures.length) {
    if (scriptedOnly) {
      fs.writeFileSync(path.join(evidenceDir, 'debug-records.jsonl'), predriveRows.map(row => JSON.stringify(row)).join('\n') + '\n');
      fs.writeFileSync(path.join(evidenceDir, 'debug-preflight.json'), JSON.stringify(Object.fromEntries(preflightFailures), null, 2));
    }
    console.error(`[predrive-failure-evidence] ${JSON.stringify(Object.fromEntries(preflightFailures))}`);
    throw new Error(`predrive consistency gate failed: ${preflightFailures.map(([name, value]) => `${name}(actions=${value.action_ids.length},writes=${value.write_action_ids.length},required_request=${value.required_request ? value.request_action_ids.length : 'n/a'},joint=${value.jointly_proven_action_ids.length})`).join(', ')}`);
  }
  if (scriptedOnly) {
    await drainCaptureChannel();
    await page.goto('about:blank', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    materializeCapturedRows();
    const spans = await retainCurrentBackendSpans();
    const joined = attachBackendSpans(rows, spans);
    const actionEvidence = indexActionEvidence(joined);
    const entryIndex = indexEntryHandlerUnits(rows, { registeredFunctionIds: manifestById.keys() });
    const requestsByAction = new Map();
    for (const row of rows) if (row.kind === 'network.request' && !row.internal && row.action_id) { const values = requestsByAction.get(row.action_id) || []; values.push(row); requestsByAction.set(row.action_id, values); }
    const loginStep = scripted.find(entry => entry.step === 1);
    const loginProofIds = (loginStep?.action_ids || []).filter(actionId => (requestsByAction.get(actionId) || []).some(row => String(row.method).toUpperCase() === 'POST' && requestPath(row.url) === '/api/auth/login') && (actionEvidence.get(actionId)?.db_write || 0) > 0);
    if (!loginProofIds.length) throw new Error('login flow has no action jointly proving POST /api/auth/login and a database write');
    const expected = {
      login: { name: 'LoginForm submit handler', file: 'client/src/components/Auth/LoginForm.tsx', pattern: /onSubmit/u },
      send: { name: 'ChatForm submit handler', file: 'client/src/components/Chat/Input/ChatForm.tsx', pattern: /handleSubmit|submitMessage|ask/u },
      feedback: { name: 'handleDownOption', file: 'client/src/components/Chat/Messages/Feedback.tsx', pattern: /handleDownOption/u },
      regenerate: { name: 'handleRegenerateMessage', file: 'client/src/components/Messages/ContentRender.tsx', pattern: /handleRegenerateMessage/u },
      'edit-resubmit': { name: 'EditMessage resubmitMessage', file: 'client/src/components/Chat/Messages/Content/EditMessage.tsx', pattern: /resubmitMessage/u },
      rename: { name: 'RenameForm save', file: 'client/src/components/Conversations/RenameForm.tsx', pattern: /onSubmit|onRename|rename|submit/u },
      'agent-create': { name: 'AgentPanel onSubmit', file: 'client/src/components/SidePanel/Agents/AgentPanel.tsx', pattern: /onSubmit/u },
      'agent-chat': { name: 'ChatForm submit handler', file: 'client/src/components/Chat/Input/ChatForm.tsx', pattern: /handleSubmit|submitMessage|ask/u },
      delete: { name: 'confirmDelete', file: 'client/src/components/Conversations/ConvoOptions/DeleteButton.tsx', pattern: /confirmDelete/u },
    };
    const beforeIds = {
      login: 'function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:4451:4518',
      send: 'function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011',
      feedback: 'function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3347:3559',
      regenerate: 'function:c057074eb90d959be20f9e8d7801624cfaa20e2e8d36fad2558178c65501d329:3465:3490',
      'edit-resubmit': 'function:331fd4345137cbf1b7c01850c3999c382577bbec382335994fe42dd9a8b4616b:308:413',
      rename: 'function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1876:1902',
      'agent-create': 'function:03e1cb3bc038e969913a678f7dba70299865e9d83f2601d7e4a8a558aec974db:8299:8402',
      'agent-chat': 'function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011',
      delete: 'function:3dace8c0d4accdb10fae5d6fa1c4ebfae91dc12defb5c15125de63e5c908766f:2331:2656',
    };
    const proofIdsByFlow = { login: loginProofIds, ...Object.fromEntries(Object.entries(predriveConsistencyGate).map(([flow, value]) => [flow, value.jointly_proven_action_ids])) };
    const sourceFor = functionId => {
      const source = manifestById.get(functionId)?.source;
      if (!source) return { file: null, start: null, end: null, text: '', context: '' };
      const absolute = path.join(worktree, source.file); const content = fs.readFileSync(absolute, 'utf8');
      return { ...source,
        text: content.slice(source.start, source.end).replaceAll(/\s+/gu, ' ').trim().slice(0, 320),
        context: content.slice(Math.max(0, source.start - 180), Math.min(content.length, source.end + 180)).replaceAll(/\s+/gu, ' ').trim().slice(0, 680) };
    };
    const flowResults = {};
    const handlerFailures = [];
    for (const [flow, proofIds] of Object.entries(proofIdsByFlow)) {
      const unitIds = [...new Set(proofIds.flatMap(actionId => entryIndex.byAction.get(actionId) || []))];
      if (unitIds.length !== 1) { handlerFailures.push(`${flow} expected one effect-rooted entry unit, found ${unitIds.length}: ${unitIds.join(', ')}`); continue; }
      const functionId = unitIds[0].slice(0, unitIds[0].lastIndexOf('|'));
      const source = sourceFor(functionId); const wanted = expected[flow];
      const confirmed = source.file === wanted.file && wanted.pattern.test(source.context);
      if (!confirmed) handlerFailures.push(`${flow} credited ${source.file}:${source.start}:${source.end}, expected ${wanted.name} in ${wanted.file}; source=${source.text}`);
      const entries = proofIds.flatMap(actionId => (entryIndex.candidatesByAction.get(actionId) || []).filter(row => row.function_id === functionId));
      flowResults[flow] = { before_function_id: beforeIds[flow], after_unit_id: unitIds[0], function_id: functionId, expected_handler: wanted.name, source, source_confirmed: confirmed, action_ids: proofIds, rooted: proofIds.every(actionId => entryIndex.units.get(unitIds[0])?.rooted_action_ids?.includes(actionId)), invoked_by: [...new Set(entries.map(row => row.invoked_by))], outcome: flow === 'login' ? 'reached_db' : 'reached_db', writes: proofIds.flatMap(actionId => actionEvidence.get(actionId)?.write_operations || []), requests: proofIds.flatMap(actionId => (requestsByAction.get(actionId) || []).map(row => ({ method: row.method, url: requestPath(row.url), request_occurrence_id: row.request_occurrence_id }))) };
    }
    if (handlerFailures.length) {
      fs.writeFileSync(path.join(evidenceDir, 'debug-handlers.json'), JSON.stringify({ failures: handlerFailures, flows: flowResults }, null, 2));
      throw new Error(`effect-rooted handler gate failed: ${handlerFailures.join(' | ')}`);
    }
    const editExpectedId = flowResults['edit-resubmit'].function_id;
    const editEnterCount = rows.filter(row => row.kind === 'function.enter' && row.function_id === editExpectedId).length;
    if (!editEnterCount) throw new Error('EditMessage resubmitMessage remains registered without a function.enter row');
    const invalidInvocationRows = rows.filter(row => row.kind === 'function.enter' && !['event', 'render', 'effect', 'async'].includes(row.invoked_by));
    if (invalidInvocationRows.length) throw new Error(`function.enter rows without invoked_by: ${invalidInvocationRows.length}`);
    const capturePageResults = []; const captureGaps = [];
    for (const [pageId, state] of capturePages) {
      for (let sequence = 1; sequence <= state.emitted; sequence += 1) if (!state.rows.has(sequence)) captureGaps.push({ page_id: pageId, sequence });
      capturePageResults.push({ page_id: pageId, emitted: state.emitted, received: state.rows.size, dropped: state.dropped, pagehide_flushes: state.pagehide_flushes });
    }
    const capture = { emitted: capturePageResults.reduce((sum, row) => sum + row.emitted, 0), raw_records: rows.length, pages: capturePageResults.length, pagehide_pages: capturePageResults.filter(row => row.pagehide_flushes > 0).length, dropped: capturePageResults.reduce((sum, row) => sum + row.dropped, 0), gaps: captureGaps, page_results: capturePageResults };
    capture.complete = capture.emitted === capture.raw_records && capture.dropped === 0 && capture.gaps.length === 0 && capture.pagehide_pages === capture.pages;
    const keyFor = row => `${String(row.method).toUpperCase()} ${requestPath(row.url)}`;
    const counts = values => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
    const observedCounts = counts(observedRequests.map(keyFor)); const runtimeRequests = rows.filter(row => row.kind === 'network.request' && !row.internal); const runtimeCounts = counts(runtimeRequests.map(keyFor));
    const transportKeys = new Set([...observedCounts.keys(), ...runtimeCounts.keys()]);
    const reconciliation = [...transportKeys].filter(key => (observedCounts.get(key) || 0) !== (runtimeCounts.get(key) || 0)).map(key => ({ key, observed: observedCounts.get(key) || 0, runtime: runtimeCounts.get(key) || 0 }));
    const transportExact = observedRequests.length === runtimeRequests.length && reconciliation.length === 0;
    if (!capture.complete || !transportExact) throw new Error(`scripted capture gate failed: complete=${capture.complete} wrapper=${runtimeRequests.length} playwright=${observedRequests.length} reconciliation=${reconciliation.length}`);
    const coverage = { schema: 'producttrace.m1-final7-scripted.v1', headless: true, pattern_crawler_run: false, unit_definition: 'earliest depth-zero non-render/effect first-party frame whose continuation subtree contains terminal request evidence, or DOM mutation evidence when no request exists; no-effect fallback is earliest event frame marked unrooted', build: { worktree, config: configPath, manifest: manifestPath, functions: manifest.functions.length, gates: config.coverage }, gates: { live_entry: liveEntryGate, eight_flow_consistency: predriveConsistencyGate, login: { passed: loginProofIds.length > 0, action_ids: loginProofIds }, invoked_by_complete: { passed: true, function_enters: rows.filter(row => row.kind === 'function.enter').length }, edit_resubmit_enters: { passed: editEnterCount > 0, function_id: editExpectedId, count: editEnterCount }, capture_complete: { passed: capture.complete }, wrapper_equals_playwright: { passed: transportExact, wrapper: runtimeRequests.length, playwright: observedRequests.length, reconciliation } }, flows: flowResults, capture, execution: { function_enters: rows.filter(row => row.kind === 'function.enter').length, function_exits: rows.filter(row => row.kind === 'function.exit').length, invoked_by: Object.fromEntries(['event', 'render', 'effect', 'async'].map(kind => [kind, rows.filter(row => row.kind === 'function.enter' && row.invoked_by === kind).length])) }, linkage: { raw_rows: rows.length, spans: spans.length, joined_rows: joined.length } };
    const handlerLines = ['# Effect-rooted handler verification', '', 'The pattern crawler was not run. Each row is the sole unit selected by terminal evidence in the login plus eight-flow scripted session.', '', '| flow | before | after | developer-named handler | source confirmation | rooted |', '|---|---|---|---|---|---|', ...Object.entries(flowResults).map(([flow, result]) => `| ${flow} | ${result.before_function_id} | ${result.after_unit_id} | ${result.expected_handler} | ${result.source.file}:${result.source.start}:${result.source.end} — \`${result.source.text.replaceAll('|', '/')}\` | ${result.rooted} |`)];
    fs.writeFileSync(path.join(evidenceDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'spans.jsonl'), spans.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'timeline.jsonl'), timeline.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), Object.entries(flowResults).map(([flow, result]) => JSON.stringify({ schema: 'producttrace.effect-rooted-entry.v1', flow, ...result })).join('\n') + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'HANDLERS.md'), handlerLines.join('\n') + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'RUN.md'), `# M1 final7 scripted verification\n\nHeadless verification of login plus the eight requested flows. The pattern crawler was not run.\n\n- autonomous build gates: runtime markers ${config.coverage.runtime_attribution_marker_count}/${config.coverage.runtime_attribution_functions}; smoke=${config.coverage.runtime_smoke?.status}; parity=${config.coverage.parity_gate?.parity}\n- capture: ${capture.raw_records}/${capture.emitted}, dropped=${capture.dropped}, gaps=${capture.gaps.length}\n- transports: wrapper=${runtimeRequests.length}, Playwright=${observedRequests.length}, reconciliation=${reconciliation.length}\n- function.enter invoked_by completeness: ${invalidInvocationRows.length === 0}; enters=${coverage.execution.function_enters}\n- edit-resubmit handler enters: ${editEnterCount}\n- eight-flow write gate: 8/8\n- login write gate: PASS\n- chat generation: deterministic local OpenAI-compatible fixture; no external model call in this verification run\n\nSee HANDLERS.md for before/after source confirmation.\n`);
    fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
    fs.writeFileSync(path.join(evidenceDir, 'LIMITS.md'), '# Limits\n\n- Headless Chromium was used only for the requested login plus eight-flow scripted verification.\n- The pattern crawler was not run. No coverage percentage is claimed.\n- Terminal rooting uses captured continuation ancestry; render- and effect-invoked frames are ineligible, while non-selected frames remain spine evidence.\n- Database success requires an exactly joined write operation; reads do not satisfy the gate.\n- This verification used the deterministic local OpenAI-compatible fixture, so it made no model call. The separate live build is configured to use the real key from the fixture `.env`.\n');
    console.log(JSON.stringify({ headless: true, scripted_only: true, flows: Object.fromEntries(Object.entries(flowResults).map(([flow, result]) => [flow, { handler: result.expected_handler, source: result.source, rooted: result.rooted }])), capture, transports: { wrapper: runtimeRequests.length, playwright: observedRequests.length, reconciliation: reconciliation.length } }));
    throw scriptedOnlyComplete;
  }
  consistencyPreflight = false;
  const restoreBase = async () => {
    await drainCaptureChannel();
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
    const cancel = page.getByRole('button', { name: /^Cancel$/i }).last(); if (await cancel.count()) await cancel.click({ force: true });
    const openSidebar = page.locator('[data-testid="open-sidebar-button"]:visible,button[aria-label="Open sidebar"]:visible').first();
    if (await openSidebar.count()) { await openSidebar.click({ force: true }); await page.waitForTimeout(150); }
  };
  const seed = async (label, open) => {
    try { await restoreBase(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await open(); await page.waitForTimeout(300); }
    catch (error) { const stop = { step: 'seed-stop', label, error: String(error.message || error) }; timeline.push(stop); stateStops.push(stop); }
    await enumerate(label);
  };
  const openAccount = async () => { const account = page.locator('[data-testid="nav-user"]:visible').first(); if (!(await account.count())) throw new Error('account menu trigger unavailable'); await account.click({ force: true }); };
  const createSeedConversation = async label => {
    const newChat = page.locator('[data-testid="new-chat-button"]:visible').first(); if (!(await newChat.count())) throw new Error(`${label}: new chat unavailable`);
    await newChat.click({ force: true }); const input = page.locator('textarea[data-testid="text-input"]:visible').first(); await input.fill(`Tracer coverage surface ${label}`); await page.locator('button[data-testid="send-button"]:visible').click({ force: true }); await waitForReply();
    await openLatestPersistedConversation();
  };
  await seed('seed-export-dialog', async () => { await createSeedConversation('export'); await page.locator('#export-menu-button:visible,button[aria-label="Export options"]:visible').first().click({ force: true }); await page.getByText('Export', { exact: true }).last().click({ force: true }); });
  await seed('seed-share-dialog', async () => { await createSeedConversation('share'); await page.locator('#export-menu-button:visible,button[aria-label="Export options"]:visible').first().click({ force: true }); await page.locator('[data-testid="share-conversation-menu-item"]:visible').click({ force: true }); });
  for (const tab of ['General', 'Chat', 'Speech', 'Data & Privacy', 'Account', 'About']) {
    await seed(`seed-settings-${tab.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`, async () => { await openAccount(); await page.locator('[data-testid="nav-settings"]:visible').click({ force: true }); const target = page.getByRole('tab', { name: new RegExp(`^${tab.replace('&', '&?')}$`, 'i') }).first(); await target.waitFor({ state: 'visible', timeout: 5000 }); await target.click({ force: true }); });
  }
  await seed('seed-keyboard-shortcuts', async () => { await openAccount(); await page.getByText('Help', { exact: true }).hover(); const shortcuts = page.getByText('Keyboard Shortcuts', { exact: true }); await shortcuts.waitFor({ state: 'visible', timeout: 5000 }); await shortcuts.click({ force: true }); await page.getByRole('heading', { name: 'Keyboard Shortcuts' }).waitFor({ state: 'visible', timeout: 5000 }); });
  await seed('seed-files-panel', async () => { await openAccount(); await page.getByText('My Files', { exact: true }).click({ force: true }); });
  await seed('seed-file-preview', async () => { await openAccount(); await page.getByText('My Files', { exact: true }).click({ force: true }); await page.getByText('producttrace-preview.png', { exact: true }).waitFor({ state: 'visible', timeout: 5000 }); const preview = page.getByRole('button', { name: /View Preview image in full size/i }); await preview.click({ force: true }); await page.getByRole('button', { name: 'Close' }).waitFor({ state: 'visible', timeout: 5000 }); });
  await seed('seed-prompts-panel', async () => { const nav = page.locator('[data-testid="nav-panel-prompts"]:visible').first(); if (!(await nav.count())) throw new Error('prompts panel trigger unavailable'); await nav.click({ force: true }); });
  await seed('seed-prompts-editor', async () => { const nav = page.locator('[data-testid="nav-panel-prompts"]:visible').first(); if (!(await nav.count())) throw new Error('prompts panel trigger unavailable'); await nav.click({ force: true }); const create = page.locator('a[aria-label="Create Prompt"]:visible').first(); await create.waitFor({ state: 'visible', timeout: 5000 }); const href = await create.getAttribute('href'); if (href !== '/prompts/new') throw new Error(`unexpected create prompt href: ${href}`); await create.evaluate(element => element.click()); await page.waitForFunction(() => location.pathname === '/prompts/new'); await page.locator('#prompt-name:visible').waitFor({ state: 'visible', timeout: 10000 }); });
  await seed('seed-bookmarks-panel', async () => { const nav = page.locator('[data-testid="nav-panel-bookmarks"]:visible,button[aria-label*="bookmark" i]:visible').first(); if (!(await nav.count())) throw new Error('bookmarks panel trigger unavailable'); await nav.click({ force: true }); });
  const openMarketplace = async () => { await drainCaptureChannel(); await page.goto(`${origin}/agents/all`, { waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: /Agent Marketplace/i }).waitFor({ state: 'visible', timeout: 10000 }); };
  await seed('seed-marketplace', openMarketplace);
  await seed('seed-marketplace-search', async () => { await openMarketplace(); const search = page.locator('#agent-search'); await search.waitFor({ state: 'visible', timeout: 5000 }); await search.fill('Barista'); await page.waitForTimeout(500); });
  await seed('seed-marketplace-details', async () => { await openMarketplace(); const card = page.locator('main [role="button"][aria-label]:visible').filter({ hasText: /Barista/i }).first(); await card.waitFor({ state: 'visible', timeout: 10000 }); await card.click({ force: true }); await page.locator('[role="dialog"]:visible').waitFor({ state: 'visible', timeout: 5000 }); });
  await enumerate('post-flow-message-hover', async () => { const messages = page.locator('[data-testid*="message"],.message'); for (let i = 0, n = Math.min(await messages.count(), 20); i < n; i += 1) { try { await messages.nth(i).hover({ timeout: 500 }); } catch {} } });
  await enumerate('post-flow-menu', async () => { const menu = page.locator('button[aria-label="Conversation Menu Options"]:visible').last(); if (await menu.count()) await menu.click({ force: true }); });
  try { await page.keyboard.press('Escape'); } catch {}

  await drainCaptureChannel();
  await page.goto('about:blank', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  materializeCapturedRows();
  const spans = await retainCurrentBackendSpans(); const joined = attachBackendSpans(rows, spans);
  const actionDb = indexActionEvidence(joined);
  const rank = { reached_db: 7, reached_backend: 6, reached_request: 5, correct_stop: 4, stop_with_reason: 3, unreachable: 2, not_encountered: 1 };
  const entryIndex = indexEntryHandlerUnits(rows, { registeredFunctionIds: manifestById.keys() });
  const staticKeysByEntryUnit = new Map();
  for (const [key, unit] of staticUnits) {
    const entryKey = `${unit.handler_id}|${capturedEventFor(unit.event)}`;
    const keys = staticKeysByEntryUnit.get(entryKey) || []; keys.push(key); staticKeysByEntryUnit.set(entryKey, keys);
  }
  const scriptedStateByAction = new Map(scripted.flatMap(entry => (entry.action_ids || []).map(actionId => [actionId, `step-${String(entry.step).padStart(2, '0')}`])));
  const dispatchedStateByAction = new Map(dispatchResults.filter(row => row.action_id).map(row => [row.action_id, row.state || row.surface || 'dispatched-state']));
  const actionRows = new Map();
  const outcomeForAction = actionId => {
    if (actionRows.has(actionId)) return actionRows.get(actionId);
    const evidence = actionDb.get(actionId) || { route: 0, handler: 0, db: 0, db_write: 0, write_operations: [] };
    const requests = rows.filter(row => row.kind === 'network.request' && !row.internal && row.action_id === actionId);
    const effectReceipt = rows.find(row => row.kind === 'dom.mutation' && row.action_id === actionId) || null;
    const action = rows.find(row => row.kind === 'dom.action' && row.action_id === actionId);
    const terminal = evidence.db_write ? 'reached_db'
      : evidence.handler || evidence.route || evidence.db ? 'reached_backend'
        : requests.length ? 'reached_request'
          : effectReceipt ? 'correct_stop' : 'stop_with_reason';
    const actionRow = { action_id: actionId, event: action?.event || 'unknown', terminal, reason: terminal === 'stop_with_reason' ? 'no_effect_witnessed' : null, requests, joined: evidence, effect_receipt: effectReceipt, witnessed_dom: Boolean(action), witnessed_backend: Boolean(evidence.handler || evidence.route || evidence.db), state: dispatchedStateByAction.get(actionId) || scriptedStateByAction.get(actionId) || 'unlabeled-dispatched-state', entry_handler_units: entryIndex.byAction.get(actionId) || [] };
    actionRows.set(actionId, actionRow); return actionRow;
  };
  const staticDrivenActions = new Map();
  const inventoryGaps = new Map();
  for (const [entryUnitId, entryUnit] of entryIndex.units) {
    const actions = entryUnit.action_ids.map(outcomeForAction);
    const staticKeys = staticKeysByEntryUnit.get(entryUnitId) || [];
    if (staticKeys.length) {
      for (const key of staticKeys) {
        const values = staticDrivenActions.get(key) || [];
        for (const action of actions) if (!values.some(value => value.action_id === action.action_id)) values.push(action);
        staticDrivenActions.set(key, values);
      }
    } else {
      const source = manifestById.get(entryUnit.function_id)?.source || null;
      inventoryGaps.set(entryUnitId, { ...entryUnit, source, actions });
    }
  }
  const dispatchByPropUnit = new Map(dispatchResults.map(row => [row.unit_id, row]));
  const staticResults = new Map();
  for (const [key, unit] of staticUnits) {
    const actions = staticDrivenActions.get(key) || [];
    const rendered = seenUnits.get(key);
    if (actions.length) {
      const best = [...actions].sort((left, right) => rank[right.terminal] - rank[left.terminal])[0];
      staticResults.set(key, { ...unit, unit_id: key, classification: 'driven', encountered_by: 'entry_execution', action_ids: actions.map(row => row.action_id), actions, ...best, requests: actions.flatMap(row => row.requests), rendered_states: rendered?.snapshots?.map(row => row.surface) || [] });
      continue;
    }
    if (rendered) {
      const attempt = dispatchByPropUnit.get(key); const state = attempt?.state || rendered.first_surface;
      const entryUnits = attempt?.action_id ? entryIndex.byAction.get(attempt.action_id) || [] : [];
      const reason = attempt?.action_id
        ? `dispatch executed entry handler unit ${entryUnits.join(', ') || 'none'}, not this static unit at ${state}`
        : `${attempt?.reason || 'rendered but no dispatch executed its handler'} at ${state}`;
      staticResults.set(key, { ...unit, unit_id: key, classification: 'rendered_not_driven', encountered_by: 'fiber', terminal: 'unreachable', reason, state, action_ids: [], actions: [], requests: [], witnessed_dom: false, witnessed_backend: false, attempts: attempt?.attempts || [], rendered_states: rendered.snapshots.map(row => row.surface) });
      continue;
    }
    staticResults.set(key, { ...unit, unit_id: key, classification: 'not_encountered', encountered_by: 'none', terminal: 'not_encountered', reason: 'no fiber walk rendered this static unit and no dispatched action executed it as an entry handler', action_ids: [], actions: [], requests: [], witnessed_dom: false, witnessed_backend: false, attempts: [], rendered_states: [] });
  }
  const allResults = [...staticResults.values()];
  const counts = Object.fromEntries(['reached_db', 'reached_backend', 'reached_request', 'correct_stop', 'stop_with_reason', 'not_encountered', 'unreachable'].map(key => [key, allResults.filter(row => row.terminal === key).length]));
  const gapResults = [...inventoryGaps.values()].map(row => { const best = [...row.actions].sort((left, right) => rank[right.terminal] - rank[left.terminal])[0]; return { ...row, classification: 'inventory_gap', encountered_by: 'entry_execution', action_ids: row.actions.map(action => action.action_id), ...best, requests: row.actions.flatMap(action => action.requests) }; });
  const gapCounts = Object.fromEntries(['reached_db', 'reached_backend', 'reached_request', 'correct_stop', 'stop_with_reason', 'not_encountered', 'unreachable'].map(key => [key, gapResults.filter(row => row.terminal === key).length]));
  const ledgerRows = [...allResults, ...gapResults];
  const silentUnits = ledgerRows.filter(row => !row.terminal);
  const foreignRequests = ledgerRows.flatMap(row => (row.actions || []).filter(action => (action.requests || []).some(request => request.action_id !== action.action_id)).map(action => ({ unit_id: row.unit_id, action_id: action.action_id })));
  const invalidActionless = ledgerRows.filter(row => !row.action_ids?.length && !['not_encountered', 'unreachable'].includes(row.terminal));
  const invalidCorrectStops = ledgerRows.flatMap(row => (row.actions || []).filter(action => action.terminal === 'correct_stop' && action.effect_receipt?.kind !== 'dom.mutation').map(action => ({ unit_id: row.unit_id, action_id: action.action_id })));
  const mismatchedUnreachableStates = ledgerRows.filter(row => row.terminal === 'unreachable' && row.state && !String(row.reason || '').includes(`at ${row.state}`));
  if (silentUnits.length || foreignRequests.length || invalidActionless.length || invalidCorrectStops.length || mismatchedUnreachableStates.length) {
    throw new Error(`ledger invariant failed: silent=${silentUnits.length} foreign_requests=${foreignRequests.length} actionless_outcomes=${invalidActionless.length} unwitnessed_correct_stops=${invalidCorrectStops.length} unreachable_state_mismatch=${mismatchedUnreachableStates.length}`);
  }
  const staticFunctionIds = new Set([...staticUnits.values()].map(unit => unit.handler_id).filter(Boolean));
  const runtimeRegistryIds = new Set((manifest.functions || []).map(row => row.id).filter(Boolean));
  const identityIntersection = [...staticFunctionIds].filter(id => runtimeRegistryIds.has(id));
  const beforeRuntimeIds = new Set((identityBeforeManifest?.functions || []).map(row => row.id).filter(Boolean));
  const beforeIntersection = [...staticFunctionIds].filter(id => beforeRuntimeIds.has(id)).length;
  const identity = { static_handler_ids: staticFunctionIds.size, runtime_registry_ids: runtimeRegistryIds.size, intersection: identityIntersection.length, static_only: staticFunctionIds.size - identityIntersection.length, runtime_only: runtimeRegistryIds.size - identityIntersection.length, before: identityBeforeManifest ? { manifest: identityBeforeManifestPath, runtime_registry_ids: beforeRuntimeIds.size, intersection: beforeIntersection, static_only: staticFunctionIds.size - beforeIntersection, runtime_only: beforeRuntimeIds.size - beforeIntersection } : null };
  const scriptedDb = evaluateConsistency(scripted, actionDb, rows, entryIndex.byAction);
  const failedConsistency = consistencyFailures(scriptedDb);
  if (failedConsistency.length) throw new Error(`consistency gate failed before coverage publication: ${failedConsistency.map(([name, value]) => `${name}(actions=${value.action_ids.length},writes=${value.write_action_ids.length},required_request=${value.required_request ? value.request_action_ids.length : 'n/a'},joint=${value.jointly_proven_action_ids.length})`).join(', ')}`);
  if (!liveEntryGate?.passed || liveEntryGate.enters < 1) throw new Error('live function-entry gate was not proven at publication');
  const detached = { total: [...detachedByState.values()].reduce((sum, value) => sum + value, 0), by_state: Object.fromEntries([...detachedByState.entries()].sort(([left], [right]) => left.localeCompare(right))) };
  const rawGaps = [];
  const capturePageResults = [];
  for (const [pageId, state] of capturePages) {
    const sequences = [...state.rows.keys()].sort((left, right) => left - right);
    for (let expected = 1; expected <= state.emitted; expected += 1) if (!state.rows.has(expected)) rawGaps.push({ page_id: pageId, sequence: expected });
    capturePageResults.push({ page_id: pageId, emitted: state.emitted, received: sequences.length, dropped: state.dropped, pagehide_flushes: state.pagehide_flushes });
  }
  const capture = { mode: 'runtime host channel with acknowledged batches and pagehide beacon flush', emitted: capturePageResults.reduce((sum, state) => sum + state.emitted, 0), raw_records: rows.length, pages: capturePageResults.length, dropped: capturePageResults.reduce((sum, state) => sum + state.dropped, 0), pagehide_pages: capturePageResults.filter(state => state.pagehide_flushes > 0).length, gaps: rawGaps, page_results: capturePageResults };
  capture.complete = capture.emitted === capture.raw_records && capture.dropped === 0 && capture.gaps.length === 0 && capture.pagehide_pages === capture.pages;
  const countBy = values => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const normalizeTransportUrl = value => { try { return new URL(String(value || ''), origin).pathname; } catch { return String(value || '').split('?')[0]; } };
  const observedKeys = observedRequests.map(request => `${request.method} ${normalizeTransportUrl(request.url)}`);
  const runtimeKeys = rows.filter(row => row.kind === 'network.request' && !row.internal).map(row => `${row.method} ${normalizeTransportUrl(row.url)}`);
  const observedCounts = countBy(observedKeys); const runtimeCounts = countBy(runtimeKeys);
  const transportKeys = new Set([...observedCounts.keys(), ...runtimeCounts.keys()]);
  const reconciliation = [...transportKeys].filter(key => (observedCounts.get(key) || 0) !== (runtimeCounts.get(key) || 0)).map(key => ({ key, observed: observedCounts.get(key) || 0, runtime: runtimeCounts.get(key) || 0 }));
  const transportExact = reconciliation.length === 0 && observedRequests.length === runtimeKeys.length;
  if (!capture.complete || !transportExact) throw new Error(`capture gate failed: complete=${capture.complete} emitted=${capture.emitted} raw=${capture.raw_records} pages=${capture.pages} pagehide_pages=${capture.pagehide_pages} dropped=${capture.dropped} gaps=${capture.gaps.length} observed=${observedRequests.length} runtime=${runtimeKeys.length} reconciliation=${JSON.stringify(reconciliation.slice(0, 20))}`);
  const drivenCount = allResults.filter(row => row.classification === 'driven').length;
  const renderedNotDrivenCount = allResults.filter(row => row.classification === 'rendered_not_driven').length;
  const renderedCount = drivenCount + renderedNotDrivenCount;
  const coverage = { driven: drivenCount, rendered: renderedCount, total: allResults.length, driven_over_rendered: renderedCount ? drivenCount / renderedCount : 0, driven_over_total: allResults.length ? drivenCount / allResults.length : 0, inventory_gap_count: gapResults.length };
  const groupRows = (values, keyFor) => values.reduce((groups, value) => { const key = keyFor(value); const rows = groups.get(key) || []; rows.push(value); groups.set(key, rows); return groups; }, new Map());
  const notEncounteredGroups = groupRows(allResults.filter(row => row.terminal === 'not_encountered'), row => row.source?.file || 'unknown source');
  const beforeChainsPath = path.join(beforeEvidenceDir, 'causal-chains.jsonl');
  const beforeTerminals = new Map();
  if (fs.existsSync(beforeChainsPath)) for (const line of fs.readFileSync(beforeChainsPath, 'utf8').split('\n').filter(Boolean)) { const row = JSON.parse(line); if (staticUnits.has(row.unit_id)) beforeTerminals.set(row.unit_id, row.terminal); }
  const surfaceGroups = groupRows([...staticUnits.values()], row => row.surface || 'other authenticated surface');
  const surfaceComparison = [...surfaceGroups].map(([surface, units]) => ({ surface, total: units.length, before: units.filter(unit => beforeTerminals.get(unit.unit_id) === 'not_encountered').length, after: units.filter(unit => staticResults.get(unit.unit_id)?.terminal === 'not_encountered').length })).sort((left, right) => left.surface.localeCompare(right.surface));
  const notEncounteredLines = ['# Static units not encountered', '', `Before: ${[...beforeTerminals.values()].filter(value => value === 'not_encountered').length}.`, `After: ${counts.not_encountered}.`, '', 'A static unit is `not_encountered` only when no fiber walk rendered it and no dispatched action crossed its first-party entry boundary at that handler.', '', '## Before/after by inventory surface', '', '| surface | static units | before not_encountered | after not_encountered |', '|---|---:|---:|---:|', ...surfaceComparison.map(row => `| ${row.surface.replaceAll('|', '/')} | ${row.total} | ${row.before} | ${row.after} |`), ''];
  for (const [file, fileRows] of [...notEncounteredGroups].sort(([left], [right]) => left.localeCompare(right))) {
    notEncounteredLines.push(`## ${file} (${fileRows.length})`, '');
    const componentGroups = groupRows(fileRows, row => `${row.component || 'unknown component'}\u0000${row.surface || 'other authenticated surface'}`);
    for (const [key, componentRows] of componentGroups) {
      const [component, surface] = key.split('\u0000');
      const routes = [...new Set(componentRows.flatMap(row => row.placements || []).map(item => item.route).filter(Boolean))];
      notEncounteredLines.push(`### ${component} — ${surface} (${componentRows.length})`, '', `- route: ${routes.length ? routes.join(', ') : 'unavailable'}`);
      for (const row of componentRows) {
        const conditions = (row.placements || []).flatMap(item => item.conditions || []).map(item => `${item.text}:${item.branch}`).filter(Boolean);
        notEncounteredLines.push(`- \`${row.unit_id}\`; placement=${row.placement_id || 'unknown'}; conditions=${conditions.length ? conditions.join('; ') : 'none'}`);
      }
      notEncounteredLines.push('');
    }
  }
  const uniqueStaticHandlers = new Map([...staticUnits.values()].filter(unit => unit.handler_id).map(unit => [unit.handler_id, unit]));
  const classifyStaticOnly = sourceManifest => {
    const ids = new Set((sourceManifest?.functions || []).map(row => row.id));
    const files = new Set((sourceManifest?.functions || []).map(row => row.source?.file).filter(Boolean));
    return [...uniqueStaticHandlers.values()].filter(unit => !ids.has(unit.handler_id)).map(unit => {
      const file = unit.source?.file || 'unknown source';
      const packageRoot = file.includes('/src/') ? file.slice(0, file.indexOf('/src/')) : null;
      const compiledPackagePath = packageRoot && [...files].some(candidate => candidate.startsWith(`${packageRoot}/dist/`));
      const reason = files.has(file) ? 'syntactic_form_or_source_map_span' : compiledPackagePath ? 'compiled_package_path' : 'skipped_file_not_emitted_to_served_chunks';
      const fix_applied = reason === 'syntactic_form_or_source_map_span' ? 'post_bundle_entry_probe_plus_exact_original_boundary'
        : reason === 'compiled_package_path' ? 'recursive_compiled_package_source_map'
          : 'none_not_present_in_served_chunks';
      return { id: unit.handler_id, file, start: unit.source?.start, end: unit.source?.end, reason, fix_applied };
    });
  };
  const staticOnlyBefore = classifyStaticOnly(identityBeforeManifest);
  const staticOnlyAfter = classifyStaticOnly(manifest);
  const staticOnlyLines = ['# Static-only function identities', '', `Before: intersection=${beforeIntersection}; static-only=${staticOnlyBefore.length}.`, `After: intersection=${identity.intersection}; static-only=${staticOnlyAfter.length}.`, '', 'Reasons describe why the served transform manifest did not contain the analyzer identity.', ''];
  const appendStaticOnly = (title, values) => {
    staticOnlyLines.push(`## ${title} (${values.length})`, '');
    for (const [file, fileRows] of [...groupRows(values, row => row.file).entries()].sort(([left], [right]) => left.localeCompare(right))) {
      staticOnlyLines.push(`### ${file} (${fileRows.length})`, '');
      const reasons = [...new Set(fileRows.map(row => row.reason))].join(', '); const fixes = [...new Set(fileRows.map(row => row.fix_applied))].join(', ');
      staticOnlyLines.push(`- reason: ${reasons}`, `- registration fix applied: ${fixes}`, '');
      for (const row of fileRows) staticOnlyLines.push(`- \`${row.id}\` ${row.start ?? '?'}:${row.end ?? '?'} — reason=${row.reason}; fix_applied=${row.fix_applied}`);
      staticOnlyLines.push('');
    }
  };
  appendStaticOnly('Before registration fixes', staticOnlyBefore);
  appendStaticOnly('Remaining after registration fixes', staticOnlyAfter);
  const inventoryGapLines = ['# Runtime entry handlers missing from the static inventory', '', `Gap count: ${gapResults.length}.`, '', 'Each row is the first depth-zero registered first-party handler reached by a dispatched event. Deeper frames and later depth-zero React work are excluded.', ''];
  const gapGroups = groupRows(gapResults, row => `${row.source?.file || 'unknown source'}\u0000${row.event}`);
  for (const [group, values] of [...gapGroups].sort(([left], [right]) => left.localeCompare(right))) {
    const [file, event] = group.split('\u0000'); inventoryGapLines.push(`## ${file} — ${event} (${values.length})`, '');
    for (const row of values) inventoryGapLines.push(`- \`${row.unit_id}\`; actions=${row.action_ids.join(', ')}; outcomes=${row.actions.map(action => `${action.action_id}:${action.terminal}`).join(', ')}`);
    inventoryGapLines.push('');
  }
  fs.writeFileSync(path.join(evidenceDir, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'spans.jsonl'), spans.map(row => JSON.stringify(row)).join('\n') + (spans.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'timeline.jsonl'), timeline.map(row => JSON.stringify(row)).join('\n') + (timeline.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), ledgerRows.map(row => JSON.stringify({ schema: 'producttrace.entry-handler-unit.v1', unit_id: row.unit_id, function_id: row.function_id || row.handler_id, event: row.event, classification: row.classification, encountered_by: row.encountered_by, action_ids: row.action_ids, actions: (row.actions || []).map(action => ({ action_id: action.action_id, state: action.state, terminal: action.terminal, reason: action.reason, effect_receipt: action.effect_receipt, joined: action.joined, requests: action.requests })), terminal: row.terminal, reason: row.reason || null, state: row.state || row.surface || null })).join('\n') + '\n');
  const lines = ['# M1 final runtime-attribution drive', '', `static_units=${allResults.length}; entry_handler_inventory_gaps=${gapResults.length}; states=${surfaces.length}; reveal_depth=${currentRevealDepth}`, `coverage_driven_over_rendered=${coverage.driven}/${coverage.rendered} (${(coverage.driven_over_rendered * 100).toFixed(2)}%)`, `coverage_driven_over_total=${coverage.driven}/${coverage.total} (${(coverage.driven_over_total * 100).toFixed(2)}%)`, `identity_intersection=${identity.intersection}; static_only=${identity.static_only}; runtime_registry_only=${identity.runtime_only}`, '', '| static unit | event | classification | encountered_by | action ids and outcomes | best outcome | reason |', '|---|---|---|---|---|---|---|', ...allResults.map(row => `| ${row.unit_id.replaceAll('|', '/')} | ${row.event} | ${row.classification} | ${row.encountered_by} | ${(row.actions || []).map(action => `${action.action_id}:${action.terminal}`).join(', ') || 'none'} | ${row.terminal} | ${(row.reason || '').replaceAll('|', '/').replaceAll('\n', ' ')} |`), '', '## Inventory gaps', '', `count=${gapResults.length}`, ...gapResults.map(row => `- ${row.unit_id.replaceAll('|', '/')} | file=${row.source?.file || 'unknown'} | actions=${row.actions.map(action => `${action.action_id}:${action.terminal}`).join(', ')}`), '', '## Static outcome summary', '', ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`), '', '## Inventory-gap outcome summary', '', ...Object.entries(gapCounts).map(([key, value]) => `- ${key}: ${value}`), `- states visited: ${surfaces.length}`, `- units with no outcome: ${silentUnits.length}`];
  fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'NOT-ENCOUNTERED.md'), notEncounteredLines.join('\n') + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'STATIC-ONLY.md'), staticOnlyLines.join('\n') + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'INVENTORY-GAPS.md'), inventoryGapLines.join('\n') + '\n');
  const gateLines = ['# Gates', '', `- live instrumented smoke click: ${liveEntryGate.passed ? 'PASS' : 'FAIL'}; action_id=${liveEntryGate.action_id}; enters=${liveEntryGate.enters}; exits=${liveEntryGate.exits}`, `- exact request ownership: ${foreignRequests.length === 0 ? 'PASS' : 'FAIL'}; violations=${foreignRequests.length}`, '- write-only DB predicate: PASS; reads excluded from reached_db', `- effect-witnessed correct stops: ${invalidCorrectStops.length === 0 ? 'PASS' : 'FAIL'}; violations=${invalidCorrectStops.length}`, `- state-local unreachable reasons: ${mismatchedUnreachableStates.length === 0 ? 'PASS' : 'FAIL'}; violations=${mismatchedUnreachableStates.length}`, `- seven-outcome ledger: ${silentUnits.length === 0 ? 'PASS' : 'FAIL'}; silent=${silentUnits.length}`, `- lossless runtime capture: ${capture.complete ? 'PASS' : 'FAIL'}; emitted=${capture.emitted}; raw=${capture.raw_records}; pages=${capture.pages}; pagehide_pages=${capture.pagehide_pages}; dropped=${capture.dropped}; gaps=${capture.gaps.length}`, `- wrapper-recorded == Playwright-observed, zero reconciliation: ${transportExact ? 'PASS' : 'FAIL'}; wrapper=${runtimeKeys.length}; playwright=${observedRequests.length}; reconciliation=${reconciliation.length}`, `- required state setup: ${stateStops.length === 0 ? 'PASS' : 'STOPS'}; stops=${stateStops.length}`, '', '## Eight-flow consistency gate', '', '| flow | actions | write actions | required request actions | jointly proven | entry-handler units | result |', '|---|---:|---:|---:|---:|---:|---|', ...Object.entries(scriptedDb).map(([name, value]) => `| ${name} | ${value.action_ids.length} | ${value.write_action_ids.length} | ${value.required_request ? value.request_action_ids.length : 'n/a'} | ${value.jointly_proven_action_ids.length} | ${value.entry_handler_units.length} | ${value.reached_db && value.entry_handlers_proven && (!value.required_request || value.jointly_proven_action_ids.length) ? 'PASS' : 'FAIL'} |`), '', ...Object.entries(scriptedDb).flatMap(([name, value]) => [`- ${name} entry units: ${value.entry_handler_units.join(', ')}`]), '', ...(stateStops.length ? ['## State setup stops', '', ...stateStops.map(stop => `- ${stop.label}: ${stop.error}`), ''] : [])];
  fs.writeFileSync(path.join(evidenceDir, 'GATES.md'), gateLines.join('\n'));
  fs.writeFileSync(path.join(evidenceDir, 'FIBER-BREAKDOWN.md'), `# Fiber breakdown\n\n${surfaces.map(surface => `## ${surface.surface}\n\n- url: ${surface.url}\n- signature: ${JSON.stringify(surface.signature)}\n- screenshot: ${surface.screenshot}\n- not_reached: ${surface.not_reached}\n- stop: ${stateStops.find(stop => stop.label === surface.surface)?.error || 'none'}\n- host event props: ${surface.host_event_props}\n- direct: ${surface.direct}\n- via_ancestor: ${surface.via_ancestor}\n- via_ancestor_any: ${surface.via_ancestor_any}\n- unregistered: ${surface.unregistered}\n- stamped: ${surface.stamped}\n`).join('\n')}\n## Detached dispatches\n\n- total: ${detached.total}\n${Object.entries(detached.by_state).map(([state, count]) => `- ${state}: ${count}`).join('\n') || '- states: none'}\n\n## Unregistered origin split\n\n- first-party-but-unregistered: ${unregisteredOrigins.first_party_but_unregistered}\n- library-internal: ${unregisteredOrigins.library_internal}\n- unknown: ${unregisteredOrigins.unknown}\n`);
  fs.writeFileSync(path.join(evidenceDir, 'RUN.md'), `# M1 final runtime attribution drive\n\nHeadless Playwright only. One authenticated page performed the scripted flow, fiber checkpoints, hover/menu/panel checkpoints, and state-local trusted dispatch.\n\n- unit definition: depth-zero registered first-party entry handler plus dispatched DOM event type\n- static units: ${allResults.length}\n- driven static units: ${coverage.driven}\n- rendered static units: ${coverage.rendered}\n- driven/rendered: ${coverage.driven}/${coverage.rendered} (${(coverage.driven_over_rendered * 100).toFixed(2)}%)\n- driven/total: ${coverage.driven}/${coverage.total} (${(coverage.driven_over_total * 100).toFixed(2)}%)\n- entry-handler inventory gaps: ${gapResults.length}\n- states visited: ${surfaces.length}\n- state setup stops: ${stateStops.length}${stateStops.length ? `; ${stateStops.map(stop => `${stop.label}=${stop.error}`).join('; ')}` : ''}\n- reveal depth: ${currentRevealDepth}\n- detached dispatches: ${detached.total}; states=${JSON.stringify(detached.by_state)}\n- capture: mode=${capture.mode}; emitted=${capture.emitted}; raw_records=${capture.raw_records}; pages=${capture.pages}; pagehide_pages=${capture.pagehide_pages}; dropped=${capture.dropped}; gaps=${capture.gaps.length}; complete=${capture.complete}\n- wrapper requests: ${runtimeKeys.length}; Playwright requests: ${observedRequests.length}; reconciliation rows: ${reconciliation.length}\n- live entry gate: action=${liveEntryGate.action_id}; enters=${liveEntryGate.enters}; exits=${liveEntryGate.exits}\n- identity intersection: ${identity.intersection}; static-only=${identity.static_only}; runtime-registry-only=${identity.runtime_only}\n- fixtures: the dedicated test user is promoted to the existing ADMIN role and receives one inline image metadata record so marketplace and file-preview states exist.\n- generation: deterministic local OpenAI-compatible fixture; no external service or model call.\n- DB classification: only insert/update/delete/replace/bulkWrite/findAndModify count as writes; reads never satisfy reached_db.\n- consistency gate: ${JSON.stringify(scriptedDb)}\n`);
  fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify({ schema: 'producttrace.m1-final6-coverage.v1', headless: true, unit_definition: 'depth-zero registered first-party entry handler function id plus dispatched event type', build: { manifest_functions: manifest.functions?.length || 0, config: config.coverage || {} }, identity, coverage, gates: { live_entry: liveEntryGate, exact_request_ownership: { passed: foreignRequests.length === 0, violations: foreignRequests.length }, write_only_db: { passed: true, predicate: 'insert|update|delete|replace|bulkWrite|findAndModify' }, effect_witness: { passed: invalidCorrectStops.length === 0, violations: invalidCorrectStops.length }, unreachable_state: { passed: mismatchedUnreachableStates.length === 0, violations: mismatchedUnreachableStates.length }, zero_silent: { passed: silentUnits.length === 0, count: silentUnits.length }, capture_complete: { passed: capture.complete, emitted: capture.emitted, raw_records: capture.raw_records, pages: capture.pages, pagehide_pages: capture.pagehide_pages, dropped: capture.dropped, gaps: capture.gaps.length }, wrapper_equals_playwright: { passed: transportExact, wrapper: runtimeKeys.length, playwright: observedRequests.length, reconciliation: reconciliation.length }, required_states: { passed: stateStops.length === 0, stops: stateStops } }, execution: { function_enters: rows.filter(row => row.kind === 'function.enter').length, entry_handler_units: entryIndex.units.size, entry_handler_entries: [...entryIndex.units.values()].reduce((sum, unit) => sum + unit.entries.length, 0), inventory_gaps: gapResults.length }, capture, transports: { observed: observedRequests.length, runtime: runtimeKeys.length, reconciliation }, linkage: { joined_rows: joined.length }, inventory: { controls: inventory.controls, units: inventory.drive_units, static_classified: allResults.length, inventory_gaps: gapResults.length }, outcomes: counts, inventory_gap_outcomes: gapCounts, classifications: { driven: coverage.driven, rendered_not_driven: renderedNotDrivenCount, not_encountered: counts.not_encountered }, surface_before_after: surfaceComparison, states: surfaces.map(surface => ({ surface: surface.surface, url: surface.url, signature: surface.signature, not_reached: surface.not_reached, stop: stateStops.find(stop => stop.label === surface.surface)?.error || null, counts: { host_event_props: surface.host_event_props, direct: surface.direct, via_ancestor: surface.via_ancestor, via_ancestor_any: surface.via_ancestor_any, unregistered: surface.unregistered, stamped: surface.stamped }, screenshot: surface.screenshot })), consistency_gate: scriptedDb, detached, origin_split: unregisteredOrigins }, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'LIMITS.md'), '# Limits\n\n- Headless Chromium only; no visible browser or GUI application.\n- A drive unit is a depth-zero registered first-party entry handler plus dispatched event type. Deeper first-party calls remain spine evidence and receive no action outcome.\n- A static unit is `rendered_not_driven` when a fiber walk saw it but no dispatch executed it as an entry handler; `not_encountered` means neither render nor entry execution occurred.\n- Backend/database outcomes require exact trace-parent joins in the retained span evidence; database reads can reach the backend but never satisfy `reached_db`.\n- `correct_stop` requires a DOM mutation receipt in the same action; an action without one is `stop_with_reason: no_effect_witnessed`.\n- Chat completions came from a deterministic local HTTP fixture; the runtime path made no model call.\n');
  const preciseUnitDefinition = 'first depth-zero registered first-party entry handler per dispatched action plus DOM event type; deeper frames and later depth-zero React work are spine-only';
  const runReportPath = path.join(evidenceDir, 'RUN.md');
  fs.writeFileSync(runReportPath, fs.readFileSync(runReportPath, 'utf8').replace('depth-zero registered first-party entry handler plus dispatched DOM event type', preciseUnitDefinition));
  const coverageReportPath = path.join(evidenceDir, 'coverage.json');
  const coverageReport = JSON.parse(fs.readFileSync(coverageReportPath, 'utf8'));
  coverageReport.unit_definition = preciseUnitDefinition;
  fs.writeFileSync(coverageReportPath, JSON.stringify(coverageReport, null, 2));
  const limitsReportPath = path.join(evidenceDir, 'LIMITS.md');
  fs.writeFileSync(limitsReportPath, fs.readFileSync(limitsReportPath, 'utf8').replace('A drive unit is a depth-zero registered first-party entry handler plus dispatched event type. Deeper first-party calls remain spine evidence and receive no action outcome.', 'A drive unit is the first depth-zero registered first-party entry handler per dispatched action plus event type. Deeper frames and later depth-zero React work remain spine evidence and receive no action outcome.'));
  console.log(JSON.stringify({ headless: true, origin, static_units: allResults.length, inventory_gaps: gapResults.length, surfaces: surfaces.length, identity, coverage, outcomes: counts, gap_outcomes: gapCounts, capture, transports: { observed: observedRequests.length, runtime: runtimeKeys.length, reconciliation }, consistency: scriptedDb }));
} catch (error) { if (error !== scriptedOnlyComplete) throw error; }
finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
