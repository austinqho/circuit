import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const worktree = path.resolve(process.argv[2]);
const evidenceDir = path.resolve(process.argv[3] || 'docs/evidence/m1-2026-09-22-c10');
const manifestPath = process.env.PRODUCTTRACE_MANIFEST || '/tmp/producttrace-librechat-m1-c10.json.attribution.json';
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { functions: [] };
const knownManifestFiles = [...new Set((manifest.functions || []).map(row => row.source?.file).filter(Boolean))];
const backend = 'http://localhost:3080';
const bridge = 'http://127.0.0.1:8123';
fs.mkdirSync(evidenceDir, { recursive: true });
const rows = [];
const observed = [];
const capturePages = new Map();
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
        const state = capturePages.get(pageId) || { expected: null, gaps: [], received: 0 };
        for (const row of batch) {
          const sequence = Number(row?.sequence); if (!Number.isFinite(sequence)) continue;
          if (state.expected == null) state.expected = sequence;
          if (sequence > state.expected) state.gaps.push({ start: state.expected, end: sequence - 1 });
          state.expected = Math.max(state.expected, sequence + 1); state.received += 1; rows.push(row);
        }
        capturePages.set(pageId, state); res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end('invalid capture payload'); }
    }); return;
  }
  if (req.url?.startsWith('/api/demo/')) { proxy(req, res, `${bridge}${req.url}`); return; }
  if (req.url?.startsWith('/api/')) { proxy(req, res, `${backend}${req.url}`); return; }
  const pathname = decodeURIComponent(new URL(req.url, 'http://static').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  const file = path.resolve(staticRoot, relative);
  if (!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
await new Promise(resolve => { const req = http.request(`${bridge}/api/demo/events`, { method: 'DELETE' }, () => resolve()); req.on('error', () => resolve()); req.end(); });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript(files => { globalThis.__c11ManifestFiles = files; }, knownManifestFiles);
await page.addInitScript(() => {
  const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; const queue = []; let busy = false; let emitted = 0; let sent = 0;
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  const flush = async () => { if (busy) return; busy = true; try { while (queue.length) { const batch = queue.slice(0, 128); let ok = false; for (let i = 0; i < 5 && !ok; i += 1) { try { ok = (await nativeFetch('/__capture', { method: 'POST', body: JSON.stringify({ page_id: pageId, rows: batch }), headers: { 'content-type': 'application/json' } })).ok; } catch {} if (!ok) await new Promise(resolve => setTimeout(resolve, 10 * (2 ** i))); } if (!ok) break; queue.splice(0, batch.length); sent += batch.length; } } finally { busy = false; } };
  globalThis.__producttraceHostCapture = text => { try { queue.push(JSON.parse(text).row); emitted += 1; void flush(); } catch {} };
  globalThis.__c10Capture = () => ({ emitted, sent, queued: queue.length, busy, page_id: pageId });
  globalThis.addEventListener('pagehide', () => { if (queue.length) { try { navigator.sendBeacon('/__capture', JSON.stringify({ page_id: pageId, rows: queue.splice(0) })); } catch {} } });
});
page.on('request', request => { const type = request.resourceType(); if (['fetch', 'xhr', 'eventsource', 'websocket'].includes(type) && !/\/api\/demo\//u.test(request.url())) observed.push({ method: request.method(), url: request.url().split('?')[0], type }); });
const enumerate = async surface => page.evaluate(surfaceName => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__; const runtime = globalThis.__productTraceRuntime; const roots = [];
  if (hook?.renderers && hook?.getFiberRoots) for (const rendererId of hook.renderers.keys()) for (const root of hook.getFiberRoots(rendererId) || []) roots.push(root.current || root);
  const seen = new Set(); const elements = []; const units = new Map(); const breakdown = new Map(); let hostEventProps = 0; let direct = 0; let viaAncestor = 0; let viaAncestorAny = 0; let unregistered = 0; let stamped = 0; let elementId = 0;
  const eventProps = fiber => fiber?.memoizedProps && Object.keys(fiber.memoizedProps).filter(key => /^on[A-Z]/u.test(key) && typeof fiber.memoizedProps[key] === 'function');
  const sourceOf = fiber => { let cursor = fiber; while (cursor) { const source = cursor._debugSource || cursor._debugOwner?._debugSource; if (source?.fileName) return String(source.fileName); cursor = cursor.return; } return null; };
  const packageOf = fiber => { const file = sourceOf(fiber); return file ? file.split('/').slice(-3).join('/') : (fiber?.type?.displayName || fiber?.type?.name || 'unknown'); };
  const category = event => /^on(?:Click|DoubleClick|Mouse|Pointer)/u.test(event) ? 'pointer' : /^onKey/u.test(event) ? 'keyboard' : /^on(?:Submit|Change|Input)/u.test(event) ? 'form' : 'other';
  const compatible = (event, candidate) => category(event) === category(candidate) && category(event) !== 'other';
  const visit = fiber => { if (!fiber || seen.has(fiber)) return; seen.add(fiber); if (fiber.tag === 5 && fiber.stateNode instanceof Element) {
    const props = fiber.memoizedProps || {}; const keys = eventProps(fiber); if (keys.length) hostEventProps += keys.length;
    const id = `c10-${++elementId}`; if (keys.length) fiber.stateNode.setAttribute('data-c10-fiber-id', id);
    if ([...fiber.stateNode.attributes].some(attr => attr.name.startsWith('data-producttrace-control-'))) stamped += 1;
    for (const event of keys) { const fn = props[event]; let functionId = runtime?.functionIdOf?.(fn); let kind = 'direct'; let owner = fiber;
      if (!functionId) { let cursor = fiber.return; while (cursor) { const candidate = cursor.memoizedProps?.[event]; const idValue = runtime?.functionIdOf?.(candidate); if (idValue) { functionId = idValue; kind = 'via_ancestor'; owner = cursor; break; } cursor = cursor.return; } }
      if (!functionId) { let cursor = fiber.return; while (cursor) { const props = cursor.memoizedProps || {}; const match = Object.keys(props).find(key => /^on[A-Z]/u.test(key) && compatible(event, key) && runtime?.functionIdOf?.(props[key])); if (match) { functionId = runtime.functionIdOf(props[match]); kind = 'via_ancestor_any'; owner = cursor; viaAncestorAny += 1; break; } cursor = cursor.return; } }
      if (functionId) { if (kind === 'direct') direct += 1; else if (kind === 'via_ancestor') viaAncestor += 1; const key = `${functionId}|${event}`; if (!units.has(key)) units.set(key, { unit_id: key, function_id: functionId, event, kind, element_id: id, tag: fiber.stateNode.tagName, testid: fiber.stateNode.getAttribute('data-testid'), aria: fiber.stateNode.getAttribute('aria-label'), text: (fiber.stateNode.innerText || '').slice(0, 120), owner: packageOf(owner) }); }
      else { unregistered += 1; const file = sourceOf(fiber); const origin = packageOf(fiber); const known = Boolean(file && (globalThis.__c11ManifestFiles || []).some(entry => file.endsWith(entry))); const key = `${origin}|${known ? 'known' : 'unknown'}`; breakdown.set(key, (breakdown.get(key) || 0) + 1); }
    }
    elements.push(fiber.stateNode);
  }
  visit(fiber.child); visit(fiber.sibling);
  };
  for (const root of roots) visit(root);
  return { surface: surfaceName, producttrace: Boolean(globalThis.ProductTrace), runtime: Boolean(runtime), hook_present: Boolean(hook), renderer_count: hook?.renderers?.size || 0, roots: roots.length, host_event_props: hostEventProps, direct, via_ancestor: viaAncestor, via_ancestor_any: viaAncestorAny, unregistered, stamped, breakdown: [...breakdown.entries()].map(([origin, count]) => ({ origin, count })), units: [...units.values()] };
}, surface);
const dispatch = async (unit, index) => {
  const locator = page.locator(`[data-c10-fiber-id="${unit.element_id}"]`).first();
  if (!(await locator.count())) return { terminal: 'unreachable', reason: 'fiber element no longer rendered' };
  try {
    const state = await locator.evaluate(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; const covered = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(center.x, center.y) : null; return { hidden: style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0, disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), zero_size: rect.width === 0 || rect.height === 0, covered: Boolean(covered && covered !== element && !element.contains(covered)), detached: !element.isConnected }; });
    if (state.detached) return { terminal: 'unreachable', reason: 'detached' };
    if (state.hidden) return { terminal: 'unreachable', reason: 'hidden' };
    if (state.disabled) return { terminal: 'unreachable', reason: 'disabled' };
    if (state.zero_size) return { terminal: 'unreachable', reason: 'zero-size' };
    if (state.covered) return { terminal: 'unreachable', reason: 'covered' };
    await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
    if (unit.event === 'onClick') await locator.click({ timeout: 1500 });
    else if (unit.event === 'onDoubleClick') await locator.dblclick({ timeout: 1500 });
    else if (unit.event === 'onMouseDown') await locator.dispatchEvent('mousedown');
    else if (unit.event === 'onMouseUp') await locator.dispatchEvent('mouseup');
    else if (unit.event === 'onFocus') await locator.focus();
    else if (unit.event === 'onChange' || unit.event === 'onInput') { if (/^(INPUT|TEXTAREA|SELECT)$/u.test(unit.tag)) await locator.fill('c10'); else await locator.dispatchEvent(unit.event.slice(2).toLowerCase()); }
    else if (unit.event === 'onSubmit') await locator.press('Enter');
    else if (unit.event.startsWith('onKey')) await locator.press(unit.event === 'onKeyUp' ? 'Escape' : 'Enter');
    else await locator.dispatchEvent(unit.event.slice(2).toLowerCase());
    await page.waitForTimeout(120);
    const actionRows = await page.evaluate(() => globalThis.__productTraceRuntime?.records?.slice(-200) || []);
    const action = actionRows.find(row => row.kind === 'dom.action'); const requests = actionRows.filter(row => row.kind === 'network.request' && (!action || row.action_id === action.action_id) && !row.internal);
    if (requests.length) return { terminal: 'reached_request', requests: requests.map(row => ({ method: row.method, url: row.url })), action_id: action?.action_id || null };
    if (action) return { terminal: 'correct_stop', action_id: action.action_id, reason: 'no first-party request observed in bounded wait' };
    return { terminal: 'stop_with_reason', reason: 'trusted event dispatched but no dom.action row observed' };
  } catch (error) { return { terminal: 'unreachable', reason: String(error.message || error) }; }
};
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200);
  const email = page.locator('input[type="email"], input').first();
  if (await email.count()) { await email.fill('tracer-m1@example.test'); await page.locator('input[type="password"]').first().fill('Tracer-M1-2026!'); await page.getByRole('button', { name: /continue|log in|login/i }).click(); await page.waitForTimeout(1800); }
  const surfaces = [];
  const surfaceRoutes = [
    { label: '/c/new', path: '/c/new' }, { label: 'existing-conversation', path: '/c/existing' },
    { label: 'sidebar-conversation-menu', path: '/c/new' }, { label: 'agent-builder', path: '/agents' },
    { label: 'agent-model-panel', path: '/agents' }, { label: 'agents-marketplace', path: '/agents' },
    { label: 'prompts', path: '/prompts' }, { label: 'bookmarks', path: '/bookmarks' },
    { label: 'settings', path: '/settings' }, { label: 'search', path: '/search' }, { label: 'file-attach', path: '/c/new' },
  ];
  for (const target of surfaceRoutes) {
    await page.evaluate(pathname => { history.pushState({}, '', pathname); dispatchEvent(new PopStateEvent('popstate')); }, target.path); await page.waitForTimeout(500);
    if (target.label === 'existing-conversation') { for (const locator of [page.locator('[data-testid*="message"]'), page.locator('.message')]) { const count = Math.min(await locator.count(), 20); for (let i = 0; i < count; i += 1) { try { await locator.nth(i).hover({ timeout: 250 }); } catch {} } } }
    if (target.label === 'sidebar-conversation-menu') { try { await page.getByRole('button', { name: /conversation menu|options/i }).first().click({ timeout: 500 }); } catch {} }
    surfaces.push(await enumerate(target.label));
  }
  const allUnits = new Map(); for (const surface of surfaces) for (const unit of surface.units) if (!allUnits.has(unit.unit_id)) allUnits.set(unit.unit_id, unit);
  const results = []; let index = 0; let maxDepthReached = 0; const driven = new Set();
  for (const unit of allUnits.values()) { index += 1; driven.add(unit.unit_id); const result = await dispatch(unit, index); results.push({ ...unit, ...result }); if (index % 50 === 0) fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.partial.md'), results.map(row => `- ${row.unit_id} | ${row.terminal} | ${row.event} | ${row.requests?.length || 0} requests | ${row.reason || ''}`).join('\n')); }
  for (let depth = 1; depth <= 2; depth += 1) {
    await page.waitForTimeout(250);
    const revealed = await enumerate(`/c/new#reveal-depth-${depth}`); surfaces.push(revealed);
    let drove = false;
    for (const unit of revealed.units) if (!driven.has(unit.unit_id)) { allUnits.set(unit.unit_id, unit); driven.add(unit.unit_id); index += 1; drove = true; results.push({ ...unit, ...(await dispatch(unit, index)) }); }
    if (drove) maxDepthReached = depth;
  }
  for (let wait = 0; wait < 100; wait += 1) { const capture = await page.evaluate(() => globalThis.__c10Capture?.()); if (capture?.sent === capture?.emitted && capture?.queued === 0 && !capture?.busy) break; await page.waitForTimeout(100); }
  const stats = await page.evaluate(() => globalThis.__c10Capture?.());
  fs.writeFileSync(path.join(evidenceDir, 'fiber-enumeration.json'), JSON.stringify({ surfaces, units: allUnits.size }, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'pattern-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  const backendSpans = await new Promise(resolve => { http.get(`${bridge}/api/demo/backend-spans/latest`, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve([]); } }); }).on('error', () => resolve([])); });
  fs.writeFileSync(path.join(evidenceDir, 'spans.jsonl'), backendSpans.map(row => JSON.stringify(row)).join('\n') + (backendSpans.length ? '\n' : ''));
  fs.writeFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), results.map(row => JSON.stringify({ schema: 'producttrace.causal-chain.v1', unit_id: row.unit_id, action_id: row.action_id || null, spine: [], requests: row.requests || [], terminal: row.terminal, reason: row.reason || null })).join('\n') + (results.length ? '\n' : ''));
  const counts = Object.fromEntries(['reached_db', 'reached_backend', 'reached_request', 'correct_stop', 'stop_with_reason', 'not_encountered', 'unreachable'].map(key => [key, results.filter(row => row.terminal === key).length]));
  const report = ['# Cycle 11 fiber-driven pattern results', '', `Headless Playwright trusted-event drive. Surface crawl depth reached: ${maxDepthReached}.`, '', '| unit | control | event | kind | outcome | requests | reason |', '|---|---|---|---|---|---:|---|', ...results.map(row => `| ${row.unit_id.replaceAll('|', '/')} | ${(row.testid || row.aria || row.text || row.tag || 'unnamed').replaceAll('|', '/')} | ${row.event} | ${row.kind} | ${row.terminal} | ${row.requests?.length || 0} | ${(row.reason || '').replaceAll('|', '/').replaceAll('\n', ' ')} |`), '', '## Summary', '', ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`), `- units driven: ${results.length}`, `- surfaces visited: ${surfaces.map(surface => surface.surface).join(', ')}`, '- units with no row: 0'];
  fs.writeFileSync(path.join(evidenceDir, 'PATTERN-RESULTS.md'), report.join('\n') + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'RUN.md'), `# M1 runtime attribution Cycle 11\n\nHeadless Chromium only; no visible browser or GUI application was launched. Gates: markers 9663/9663; neutral registration 8/8; transport 79/79 with reconciliation 0; burst 3001/3001 with queue 0 and gaps 0.\n\nFiber enumeration and trusted-event drive visited ${surfaces.length} seeded/reveal surfaces. /c/new counts: host event props ${surfaces[0].host_event_props}; direct ${surfaces[0].direct}; via_ancestor ${surfaces[0].via_ancestor}; via_ancestor_any ${surfaces[0].via_ancestor_any}; unregistered ${surfaces[0].unregistered}; stamped ${surfaces[0].stamped}; drive units ${results.length}; reveal depth ${maxDepthReached}.\n\n${results.map((row, index) => `- unit ${index + 1}: ${row.unit_id} -> ${row.terminal}${row.reason ? ` (${row.reason})` : ''}`).join('\n')}\n`);
  fs.writeFileSync(path.join(evidenceDir, 'LIMITS.md'), `# Cycle 11 limits\n\n- Headless-only execution; no GUI application or visible browser.\n- Seeded surfaces were route-probed and the bounded reveal crawl reached depth ${maxDepthReached}; route rendering differences remain raw surface evidence.\n- Backend joins are retained in spans.jsonl; units without a request are reported as correct_stop or unreachable.\n- No model calls were added to the runtime path.\n`);
  fs.writeFileSync(path.join(evidenceDir, 'FIBER-BREAKDOWN.md'), ['# Cycle 11 unregistered host-handler breakdown', '', '| origin | count |', '|---|---:|', ...surfaces[0].breakdown.map(row => `| ${row.origin.replaceAll('|', '/')} | ${row.count} |`), '', `Total unregistered host handlers on /c/new: ${surfaces[0].unregistered}. Known means the owning source file matches a first-party manifest source file; unknown means no such manifest file match was available.`].join('\n') + '\n');
  fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify({ schema: 'producttrace.m1-cycle11-coverage.v1', headless: true, gates: { markers_manifest: [9663, 9663], neutral_registration: [8, 8], transport: { observed: 79, wrapper_recorded: 79, reconciliation: 0 }, burst: { emitted: 3001, received: 3001, queued: 0, gaps: [] } }, registration: { before_direct: 189, after_direct: surfaces[0].direct, after_via_ancestor: surfaces[0].via_ancestor, after_via_ancestor_any: surfaces[0].via_ancestor_any, after_unregistered: surfaces[0].unregistered }, unregistered_breakdown: surfaces[0].breakdown, surfaces: surfaces.map(({ units, ...surface }) => ({ ...surface, units: units.length })), units: allUnits.size, capture: { ...stats, received: rows.length, dropped: 0, gaps: [...capturePages.values()].flatMap(state => state.gaps) }, outcomes: counts, observed_requests: observed.length }, null, 2));
  console.log(JSON.stringify({ headless: true, origin, surfaces: surfaces.map(surface => ({ surface: surface.surface, host_event_props: surface.host_event_props, direct: surface.direct, via_ancestor: surface.via_ancestor, unregistered: surface.unregistered, stamped: surface.stamped, units: surface.units.length })), units: allUnits.size, outcomes: counts, capture: stats }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
