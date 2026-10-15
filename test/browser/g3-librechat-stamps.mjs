// G3 stamp checks on a built LibreChat worktree (headless only).
//   node test/browser/g3-librechat-stamps.mjs <worktree> <evidenceDir>
// Requires the LibreChat backend on localhost:3080. Two sessions:
//   oai-stub  — a stub document.oai.annotation is present: OAI attributes must
//               be written and every payload must pass an independent §4.3 check;
//   no-oai    — no stub: no OAI attribute may appear.
// Per surface it records which interactive hosts carry data-tracer-el and why
// any do not; afterwards a seeded random sample of stamp rows is resolved and
// graded against the source files on disk.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { indexElementStamps, resolveElement } from '../../analysis/element-index.mjs';

const worktree = path.resolve(process.argv[2]);
const evidenceDir = path.resolve(process.argv[3]);
fs.mkdirSync(evidenceDir, { recursive: true });
const backendOrigin = 'http://localhost:3080';
const staticRoot = path.join(worktree, 'client/dist');
const rows = [];
const proxy = (req, res, target) => {
  const url = new URL(target);
  const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
  upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream);
};
let currentVariant = null;
const server = http.createServer((req, res) => {
  if (req.url === '/__capture' && req.method === 'POST') {
    let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { const payload = JSON.parse(body); for (const row of payload.rows || []) rows.push({ ...row, capture_page_id: payload.page_id, g3_variant: currentVariant }); res.writeHead(204); res.end(); } catch { res.writeHead(400); res.end(); } });
    return;
  }
  if (req.url?.startsWith('/api/')) { proxy(req, res, `${backendOrigin}${req.url}`); return; }
  const pathname = decodeURIComponent(new URL(req.url, 'http://static').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  const file = path.resolve(staticRoot, relative);
  const target = file.startsWith(`${staticRoot}${path.sep}`) && fs.existsSync(file) && !fs.statSync(file).isDirectory() ? file : path.join(staticRoot, 'index.html');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' }); fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');

function independentMetadataCheck(text) {
  let value; try { value = JSON.parse(text); } catch { return 'invalid_json'; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not_object';
  const entries = Object.entries(value);
  if (entries.length > 6) return 'too_many_entries';
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 2048) return 'too_large';
  for (const [key, entry] of entries) {
    if (key.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return `bad_key:${key}`;
    if (entry === null || typeof entry === 'boolean') continue;
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) return `non_finite:${key}`; continue; }
    if (typeof entry !== 'string') return `bad_value:${key}`;
    if (entry.length > 256) return `long_string:${key}`;
    if (/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(entry)) return `bad_characters:${key}`;
  }
  return null;
}

const surveySurface = async (page, label) => page.evaluate(surface => {
  const selector = 'button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="link"],[tabindex]';
  const fiberOf = node => { for (const key of Object.keys(node)) if (key.startsWith('__reactFiber$')) return node[key]; return null; };
  const hosts = [...document.querySelectorAll(selector)];
  const unstamped = [];
  const elements = [];
  let stamped = 0;
  for (const node of hosts) {
    const describeNode = { tag: node.tagName.toLowerCase(), role: node.getAttribute('role'), testid: node.getAttribute('data-testid'), aria_label: node.getAttribute('aria-label'),
      key: node.getAttribute('data-tracer-el'), react: Boolean(fiberOf(node)) };
    elements.push(describeNode);
    if (node.hasAttribute('data-tracer-el')) { stamped += 1; continue; }
    const fiber = fiberOf(node);
    unstamped.push({ tag: node.tagName.toLowerCase(), role: node.getAttribute('role'), testid: node.getAttribute('data-testid'), label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40),
      reason: !fiber ? 'not_rendered_by_react' : 'react_host_without_first_party_placement' });
  }
  const annotations = [...document.querySelectorAll('[oai-annotation-metadata],[oai-annotatable]')].map(node => ({ key: node.getAttribute('data-tracer-el'), label: node.getAttribute('oai-annotatable'), metadata: node.getAttribute('oai-annotation-metadata') }));
  return { surface, url: location.pathname, interactive_hosts: hosts.length, stamped, unstamped_count: unstamped.length,
    unstamped_by_reason: unstamped.reduce((acc, row) => { acc[row.reason] = (acc[row.reason] || 0) + 1; return acc; }, {}), unstamped_examples: unstamped.slice(0, 25),
    stamped_elements_total: document.querySelectorAll('[data-tracer-el]').length, annotations, elements,
    // Per stamped element: is the component that renders it first-party? (a
    // host created inside a library component has no first-party JSX of its own).
    // Also: is the host the value of a first-party function child (a render
    // callback passed as children) of a library component between it and the
    // nearest first-party component? That host has first-party JSX even though
    // a library component renders it.
    stamped_details: [...document.querySelectorAll('[data-tracer-el]')].map(node => {
      const runtime = globalThis.__productTraceRuntime;
      const component = f => f && (f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 14 || f.tag === 15);
      const firstParty = f => { const type = f?.type; const fn = type?.render || type?.type || type; return Boolean(runtime?.functionIdOf?.(fn)); };
      let fiber = fiberOf(node)?.return || null;
      while (fiber && !component(fiber)) fiber = fiber.return;
      let functionChild = false;
      for (let cursor = fiber, depth = 0; cursor && depth < 30; cursor = cursor.return, depth += 1) {
        if (component(cursor) && firstParty(cursor)) break;
        const children = cursor.memoizedProps?.children;
        if (typeof children === 'function' && runtime?.functionIdOf?.(children)) { functionChild = true; break; }
      }
      return { key: node.getAttribute('data-tracer-el'), tag: node.tagName.toLowerCase(), renderer_first_party: Boolean(fiber && firstParty(fiber)), function_child_first_party: functionChild };
    }), stats: globalThis.__productTraceRuntime?.stampStats?.() || null };
}, label);

const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const surfaces = [];
try {
  for (const variant of ['oai-stub', 'no-oai']) {
    currentVariant = variant;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(({ stub }) => {
      const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; const queue = []; let busy = false;
      const nativeFetch = globalThis.fetch.bind(globalThis);
      const flush = async () => { if (busy) return; busy = true; try { while (queue.length) { const batch = queue.splice(0, 256); for (let i = 0; i < 5; i += 1) { try { if ((await nativeFetch('/__capture', { method: 'POST', body: JSON.stringify({ page_id: pageId, rows: batch }), keepalive: true })).ok) break; } catch {} } } } finally { busy = false; } };
      globalThis.__producttraceHostCapture = text => { try { const payload = JSON.parse(text); if (payload.row?.kind === 'element.stamp' || payload.row?.kind === 'dom.action') { queue.push(payload.row); void flush(); } } catch {} };
      globalThis.__g3Queued = () => queue.length + (busy ? 1 : 0);
      if (stub) document.oai = { annotation: { request() { return { accepted: false }; }, toggle() { return { accepted: false }; }, isActive() { return false; } } };
    }, { stub: variant === 'oai-stub' });
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    const email = page.locator('input[type="email"], input').first();
    if (await email.count()) { await email.fill('tracer-m1@example.test'); await page.locator('input[type="password"]').first().fill('Tracer-M1-2026!'); await page.getByRole('button', { name: /continue|log in|login/i }).click(); await page.waitForTimeout(2000); }
    surfaces.push({ variant, ...(await surveySurface(page, '/c/new')) });
    const convo = page.locator('[data-testid="convo-item"], a[href^="/c/"]:not([href="/c/new"])').first();
    if (await convo.count()) { try { await convo.click({ timeout: 2000 }); await page.waitForTimeout(1500); surfaces.push({ variant, ...(await surveySurface(page, 'existing-conversation')) }); } catch {} }
    const menu = page.locator('button[aria-label="Conversation Menu Options"]').first();
    if (await menu.count()) { try { await menu.click({ force: true, timeout: 2000 }); await page.waitForTimeout(500); surfaces.push({ variant, ...(await surveySurface(page, 'conversation-menu')) }); await page.keyboard.press('Escape'); } catch {} }
    const agents = page.locator('[data-testid="nav-panel-agents"]').first();
    if (await agents.count()) { try { await agents.click({ timeout: 2000 }); await page.waitForTimeout(1200); surfaces.push({ variant, ...(await surveySurface(page, 'agent-builder')) }); } catch {} }
    for (let i = 0; i < 60 && await page.evaluate(() => globalThis.__g3Queued?.() || 0); i += 1) await page.waitForTimeout(250);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

// ---- resolve a seeded random sample against source on disk -----------------
const stamps = rows.filter(row => row.kind === 'element.stamp');
const index = indexElementStamps(stamps);
const keys = [...index.byKey.keys()].sort();
let seed = 20260923; const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 0x100000000; };
const sample = [];
const pool = [...keys];
while (sample.length < Math.min(30, pool.length)) sample.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
const resolveChecks = sample.map(element_key => {
  const resolved = resolveElement(index, { element_key });
  let source = null; try { source = fs.readFileSync(path.join(worktree, resolved.source.file), 'utf8'); } catch {}
  const start = Number(resolved.placement_id?.split(':')[2]);
  const lineAtStart = source ? source.slice(0, start).split('\n').length : null;
  const textAtStart = source ? source.slice(start, start + 1 + String(resolved.tag || '').length) : null;
  const ok = resolved.status === 'exact' && source !== null && lineAtStart === resolved.source.line && textAtStart === `<${resolved.tag}`;
  return { element_key, status: resolved.status, file: resolved.source?.file, line: resolved.source?.line, tag: resolved.tag, component: resolved.component,
    line_at_start_on_disk: lineAtStart, text_at_start_on_disk: textAtStart, source_line: source ? source.split('\n')[resolved.source.line - 1]?.trim().slice(0, 120) : null, ok };
});
const annotationChecks = surfaces.flatMap(surface => surface.annotations.map(entry => ({ variant: surface.variant, surface: surface.surface, key: entry.key,
  failure: entry.metadata ? independentMetadataCheck(entry.metadata) : 'missing_metadata' })));
const stubAnnotations = annotationChecks.filter(entry => entry.variant === 'oai-stub');
const noOaiAnnotations = annotationChecks.filter(entry => entry.variant === 'no-oai');
// Share of stamped elements whose placement is the element's own JSX site
// ('self'), with the remainder by cause.
const stampByKey = new Map(stamps.map(row => [row.element_key, row]));
const ownSite = { self: 0, not_self: 0, via: {}, causes: {} };
for (const surface of surfaces) for (const detail of surface.stamped_details || []) {
  const row = stampByKey.get(detail.key); if (!row) continue;
  if (row.placement_via === 'self' || row.placement_via === 'render_prop') { ownSite.self += 1; ownSite.via[row.placement_via] = (ownSite.via[row.placement_via] || 0) + 1; continue; }
  ownSite.not_self += 1;
  const cause = `${row.placement_via}: ${detail.function_child_first_party ? 'first-party JSX returned by a function child of a library component (not placed: first-party JSX missed)'
    : detail.renderer_first_party ? 'rendered by a first-party component whose JSX for this element was not placed (first-party JSX missed)' : 'rendered inside a library component (no first-party JSX for the element)'}`;
  ownSite.causes[cause] = (ownSite.causes[cause] || 0) + 1;
  ownSite.examples = ownSite.examples || {};
  const list = ownSite.examples[cause] = ownSite.examples[cause] || [];
  if (list.length < 12) list.push({ host: detail.tag, stamp_tag: row.tag, file: row.file, line: row.line, component: row.component });
}
ownSite.own_share = ownSite.self / Math.max(1, ownSite.self + ownSite.not_self);
// Elements rendered inside a library component have no first-party JSX of
// their own; their stamp names the first-party usage that renders them.
const libraryRendered = Object.entries(ownSite.causes).filter(([cause]) => cause.includes('no first-party JSX for the element')).reduce((sum, [, count]) => sum + count, 0);
ownSite.library_rendered = libraryRendered;
ownSite.own_share_of_first_party_jsx = ownSite.self / Math.max(1, ownSite.self + ownSite.not_self - libraryRendered);
ownSite.first_party_jsx_missed = ownSite.not_self - libraryRendered;
// Per stamp row (each distinct key once per session), as the grader counts.
const rowVia = { own: 0, library: 0, missed: 0, not_in_final_dom: 0 };
const detailByKey = new Map(surfaces.flatMap(surface => (surface.stamped_details || []).map(detail => [detail.key, detail])));
for (const row of stamps) {
  if (row.placement_via === 'self' || row.placement_via === 'render_prop') { rowVia.own += 1; continue; }
  const detail = detailByKey.get(row.element_key);
  if (!detail) rowVia.not_in_final_dom += 1;
  else if (!detail.function_child_first_party && !detail.renderer_first_party) rowVia.library += 1; else rowVia.missed += 1;
}
ownSite.per_stamp_row = { ...rowVia, own_share_of_first_party_jsx: rowVia.own / Math.max(1, rowVia.own + rowVia.missed), own_share_all_rows: rowVia.own / Math.max(1, stamps.length) };
const summary = {
  schema: 'producttrace.g3-librechat-stamps.v1', headless: true, worktree, origin, own_site: ownSite,
  stamp_rows: stamps.length, distinct_element_keys: keys.length,
  builds: [...index.builds],
  surfaces: surfaces.map(({ annotations, unstamped_examples, stamped_details, elements, ...rest }) => ({ ...rest, annotations: annotations.length })),
  interactive_coverage: surfaces.map(surface => ({ variant: surface.variant, surface: surface.surface, interactive_hosts: surface.interactive_hosts, stamped: surface.stamped, unstamped: surface.unstamped_count, unstamped_by_reason: surface.unstamped_by_reason })),
  unstamped_examples: surfaces.map(surface => ({ variant: surface.variant, surface: surface.surface, examples: surface.unstamped_examples })),
  oai: { stub_payloads: stubAnnotations.length, stub_invalid: stubAnnotations.filter(entry => entry.failure).length, no_oai_payloads: noOaiAnnotations.length,
    rejected_rows: stamps.filter(row => String(row.annotation || '').startsWith('rejected')).length },
  resolve_sample: { size: resolveChecks.length, ok: resolveChecks.filter(entry => entry.ok).length, checks: resolveChecks },
};
summary.checks = {
  stamps_emitted: stamps.length > 0,
  every_interactive_host_stamped: surfaces.every(surface => surface.unstamped_count === 0),
  own_jsx_site_share_over_90: ownSite.own_share_of_first_party_jsx > 0.9,
  resolve_sample_exact: resolveChecks.length > 0 && resolveChecks.every(entry => entry.ok),
  oai_written_with_stub: stubAnnotations.length > 0,
  oai_payloads_valid: stubAnnotations.every(entry => !entry.failure),
  no_oai_without_stub: noOaiAnnotations.length === 0,
};
fs.writeFileSync(path.join(evidenceDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
// Per-element evidence (recomputable): every interactive host per surface with
// its stamp key or unstamped reason, the own-site detail per stamped element,
// and every OAI payload exactly as read from the DOM, with the independent
// validator's verdict.
fs.writeFileSync(path.join(evidenceDir, 'survey-elements.jsonl'), surfaces.flatMap(surface => surface.elements.map(element => JSON.stringify({ variant: surface.variant, surface: surface.surface, ...element }))).join('\n') + '\n');
fs.writeFileSync(path.join(evidenceDir, 'survey-own-site.jsonl'), surfaces.flatMap(surface => (surface.stamped_details || []).map(detail => JSON.stringify({ variant: surface.variant, surface: surface.surface, ...detail,
  placement_via: stampByKey.get(detail.key)?.placement_via ?? null, file: stampByKey.get(detail.key)?.file ?? null, line: stampByKey.get(detail.key)?.line ?? null }))).join('\n') + '\n');
fs.writeFileSync(path.join(evidenceDir, 'oai-payloads.jsonl'), surfaces.flatMap(surface => surface.annotations.map(entry => JSON.stringify({ variant: surface.variant, surface: surface.surface, key: entry.key,
  label: entry.label, metadata: entry.metadata, failure: entry.metadata ? independentMetadataCheck(entry.metadata) : 'missing_metadata' }))).join('\n') + '\n');
fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ own_site: ownSite, checks: summary.checks, stamp_rows: summary.stamp_rows, interactive_coverage: summary.interactive_coverage, oai: summary.oai, resolve: { size: resolveChecks.length, ok: summary.resolve_sample.ok } }, null, 2));
