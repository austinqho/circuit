// G3 / D12: stamps are lookup keys, never inputs to attribution.
//
// Builds a neutral Vite + React fixture with both Tracer plugins and drives
// one scripted headless session three times:
//   A  stamps on, stub document.oai.annotation (OAI attributes + last-action rewrites)
//   B  stamps on, every stamp attribute stripped from the DOM as soon as it appears
//   C  stamps off (__PRODUCTTRACE_STAMPS__ = false)
//   D  as A, from a second build with bodies: 'always' (network.body rows on;
//      A-C come from the default production build, bodies "production_off")
// Pass: after deleting element.stamp and network.body rows, the dom.action
// target's stamp fields (element_key, key_kind, instances, stamp_sequence)
// and capture.page's declared `bodies` mode, records.jsonl and
// causal-chains.jsonl are byte-identical across A, B, C, D.
//
// Usage: node test/browser/d12-stamp-neutrality.mjs <dir containing node_modules with vite, react, react-dom,
//        @vitejs/plugin-react, playwright> <output dir>
// Headless only.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildActionChains } from '../../analysis/runtime-attribution.mjs';
import { indexElementStamps, resolveElement } from '../../analysis/element-index.mjs';
import { productTraceVitePlugin } from '../../integrations/vite.mjs';
import { runtimeAttributionPlugin } from '../../integrations/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const outputDir = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-d12-out-')));
fs.mkdirSync(outputDir, { recursive: true });
const nodeModules = path.join(dependencyRoot, 'node_modules');
const require = createRequire(path.join(dependencyRoot, 'package.json'));

// ---- 1. build the fixture ------------------------------------------------
const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-d12-app-')));
const clientRoot = path.join(repository, 'client');
fs.mkdirSync(path.join(clientRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: 'd12-fixture', private: true, type: 'module' }));
fs.symlinkSync(nodeModules, path.join(repository, 'node_modules'));
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/stamp-neutral-app/main.jsx'), 'utf8');
fs.writeFileSync(path.join(clientRoot, 'src/main.jsx'), appSource);
fs.writeFileSync(path.join(clientRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>d12</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
const { build } = await import(pathToFileURL(path.join(nodeModules, 'vite/dist/node/index.js')).href);
const react = (await import(pathToFileURL(path.join(nodeModules, '@vitejs/plugin-react/dist/index.js')).href)).default;
const manifestPath = path.join(repository, 'attribution-manifest.json');
// Two builds of the same source: the default (production mode, bodies off)
// and bodies: 'always'. Only the injected settings differ.
const buildVariant = async (outName, extra) => build({
  root: clientRoot, logLevel: 'error', configFile: false,
  plugins: [
    productTraceVitePlugin({ repository, service: 'd12-fixture', requestBridge: false, ...extra }),
    runtimeAttributionPlugin({ repository, manifestPath }),
    react(),
  ],
  build: { outDir: path.join(clientRoot, outName), emptyOutDir: true, sourcemap: true, minify: false,
    rollupOptions: { output: { manualChunks: id => (id.includes('node_modules') ? 'vendor' : undefined) } } },
});
// Both are built into client/dist (the build path is an input to the
// transform); the bodies build is moved out of the repository first.
const bodiesDist = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-d12-bodies-'));
await buildVariant('dist', { bodies: 'always' });
const bodiesManifest = fs.readFileSync(manifestPath, 'utf8');
fs.cpSync(path.join(clientRoot, 'dist'), bodiesDist, { recursive: true });
await buildVariant('dist', {});
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const distRoots = { off: path.join(clientRoot, 'dist'), on: fs.realpathSync(bodiesDist) };
let distRoot = distRoots.off;
// The app chunks must be identical; only index.html's settings script differs.
const chunkDigest = dir => fs.readdirSync(path.join(dir, 'assets')).filter(name => name.endsWith('.js')).sort().map(name => `${name}:${fs.readFileSync(path.join(dir, 'assets', name), 'utf8').length}`).join(',');
const buildsDifferOnlyInSettings = chunkDigest(distRoots.off) === chunkDigest(distRoots.on) && bodiesManifest === fs.readFileSync(manifestPath, 'utf8')
  && fs.readFileSync(path.join(distRoots.off, 'index.html'), 'utf8').replace('__PRODUCTTRACE_BODIES__="production_off"', '__PRODUCTTRACE_BODIES__="on"') === fs.readFileSync(path.join(distRoots.on, 'index.html'), 'utf8');

// ---- 2. deterministic local server --------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const json = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/save' && req.method === 'POST') { req.resume(); req.on('end', () => json({ id: 'saved-1' })); return; }
  if (url.pathname === '/api/items' && req.method === 'GET') return json({ count: 2 });
  if (url.pathname.startsWith('/api/items/') && req.method === 'DELETE') return json({ ok: true });
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(distRoot, relative);
  if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- 3. independent §4.3 validator (not the runtime's implementation) ----
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

// ---- 4. one scripted session per variant ---------------------------------
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const variants = {
  A: { stamps: true, oai: true, strip: false },
  B: { stamps: true, oai: false, strip: true },
  C: { stamps: false, oai: false, strip: false },
  D: { stamps: true, oai: true, strip: false, bodies: true },
};
const results = {};
try {
  for (const [name, variant] of Object.entries(variants)) {
    distRoot = variant.bodies ? distRoots.on : distRoots.off;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(({ variant: options }) => {
      // Fixed wall clock (timers stay native): action ids and timestamps are reproducible.
      const fixedNow = Date.parse('2026-09-23T00:00:00Z'); Date.now = () => fixedNow;
      // Seeded randomness: trace ids and the page session are reproducible.
      let seed = 0x2f6b1d; const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
      const nativeGetRandomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = array => { if (!(array instanceof Uint8Array)) return nativeGetRandomValues(array); for (let i = 0; i < array.length; i += 1) array[i] = next() & 0xff; return array; };
      Math.random = () => next() / 0x100000000;
      if (!options.stamps) globalThis.__PRODUCTTRACE_STAMPS__ = false;
      if (options.oai) {
        globalThis.__oaiRequests = [];
        document.oai = { annotation: { request(target, init) { globalThis.__oaiRequests.push(init || null); return { accepted: false }; }, toggle() { return { accepted: false }; }, isActive() { return false; } } };
      }
      if (options.strip) {
        const names = ['data-tracer-el', 'oai-annotatable', 'oai-annotation-metadata'];
        const strip = node => { if (node?.nodeType !== 1) return; for (const attribute of names) if (node.hasAttribute(attribute)) node.removeAttribute(attribute); for (const child of node.querySelectorAll?.('[data-tracer-el],[oai-annotatable],[oai-annotation-metadata]') || []) for (const attribute of names) child.removeAttribute(attribute); };
        new MutationObserver(mutations => { for (const mutation of mutations) { strip(mutation.target); for (const added of mutation.addedNodes || []) strip(added); } })
          .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: names });
      }
    }, { variant });
    let inflight = 0;
    page.on('request', () => { inflight += 1; });
    page.on('requestfinished', () => { inflight -= 1; });
    page.on('requestfailed', () => { inflight -= 1; });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    // Every input event gets its own settled window so the runtime's receipt
    // timers never race the next keystroke/click (a harness race, not a stamp
    // effect). Clicks split mousedown (focus) and mouseup (click) for the same reason.
    const settle = async (ms = 1000) => { for (let i = 0; i < 100 && inflight > 0; i += 1) await page.waitForTimeout(20); await page.waitForTimeout(ms); };
    const click = async locator => {
      const box = await locator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await settle(300);
      await page.mouse.up();
    };
    // Keys split keydown and keyup too: the browser's queued selectionchange
    // (recorded since D-G1-21) otherwise races the keyup.
    const type = async text => { for (const character of text) { await page.keyboard.down(character); await settle(300); await page.keyboard.up(character); await settle(300); } };
    await page.goto(origin, { waitUntil: 'networkidle' });
    await settle();
    const steps = [
      async () => { await click(page.getByLabel('Name')); await settle(300); await type('Ada'); },
      async () => { await click(page.getByRole('button', { name: 'Submit' })); },
      async () => { await click(page.getByRole('button', { name: 'Remove Beta' })); },
      async () => { await click(page.getByRole('button', { name: 'Open panel' })); },
      async () => { await click(page.getByRole('button', { name: 'Close panel' })); },
      async () => { await click(page.getByRole('button', { name: 'Refresh' })); },
      async () => { await click(page.getByRole('link', { name: 'red' })); },
    ];
    for (const step of steps) { await step(); await settle(); }
    const snapshot = await page.evaluate(() => {
      const runtime = globalThis.__productTraceRuntime;
      const interactive = [...document.querySelectorAll('button,input,textarea,select,a[href],[role="button"],[tabindex]')];
      return {
        records: JSON.stringify(runtime.records),
        stats: runtime.stampStats(), body_stats: runtime.bodyStats(),
        stamped_in_dom: document.querySelectorAll('[data-tracer-el]').length,
        oai_in_dom: document.querySelectorAll('[oai-annotatable],[oai-annotation-metadata]').length,
        interactive: interactive.map(node => ({ tag: node.tagName.toLowerCase(), text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40), key: node.getAttribute('data-tracer-el') })),
        annotations: [...document.querySelectorAll('[oai-annotation-metadata]')].map(node => ({ label: node.getAttribute('oai-annotatable'), metadata: node.getAttribute('oai-annotation-metadata'), key: node.getAttribute('data-tracer-el') })),
      };
    });
    results[name] = { ...snapshot, records: JSON.parse(snapshot.records), errors };
    fs.writeFileSync(path.join(outputDir, `records-${name}.jsonl`), results[name].records.map(row => JSON.stringify(row)).join('\n') + '\n');
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

// ---- 5. compare ------------------------------------------------------------
// dom.event rows (page lifecycle, D-G1-21) have their own counter and arrive in
// network order; they are compared as a multiset below, never by position.
const lifecycle = records => records.filter(row => row.kind === 'dom.event').map(row => { const { event_sequence, timestamp, ...rest } = row; return JSON.stringify(rest); }).sort();
const normalize = records => records.filter(row => row.kind !== 'element.stamp' && row.kind !== 'network.body' && row.kind !== 'dom.event').map(row => {
  const copy = JSON.parse(JSON.stringify(row));
  // The page's declared body mode is the one field that must differ between A and D.
  if (copy.kind === 'capture.page' || copy.kind === 'capture.summary') delete copy.bodies;
  // Stamp-lookup fields on the target (element_key, and since fix/stable-element-keys its key_kind, instances, stamp_sequence).
  if (copy.kind === 'dom.action' && copy.target) for (const field of ['element_key', 'key_kind', 'instances', 'stamp_sequence']) delete copy.target[field];
  if (copy.kind === 'dom.action' && copy.target?.shadow_host && 'element_key' in copy.target.shadow_host) delete copy.target.shadow_host.element_key;
  // The same lookup key on a range's first/last control (D-G1-21 segments).
  if (copy.kind === 'dom.action.range') for (const control of [copy.first_control, copy.last_control]) if (control) for (const field of ['element_key', 'key_kind', 'instances', 'stamp_sequence']) delete control[field];
  return copy;
});
const normalized = {}, chains = {};
for (const [name, result] of Object.entries(results)) {
  const rows = normalize(result.records);
  normalized[name] = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  chains[name] = buildActionChains(rows, [], { backendInstrumented: false }).map(row => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(path.join(outputDir, `normalized-${name}.jsonl`), normalized[name]);
  fs.writeFileSync(path.join(outputDir, `causal-chains-${name}.jsonl`), chains[name]);
}
const firstDifference = (left, right) => { const a = left.split('\n'), b = right.split('\n'); for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) return { line: i + 1, left: a[i]?.slice(0, 400), right: b[i]?.slice(0, 400) }; return null; };
const stampRows = name => results[name].records.filter(row => row.kind === 'element.stamp');
const keyed = name => results[name].records.filter(row => row.kind === 'dom.action' && row.target?.element_key);
const annotationFailures = results.A.annotations.map(entry => ({ ...entry, failure: independentMetadataCheck(entry.metadata) || (entry.label && entry.label.trim() && entry.label.length <= 128 ? null : 'bad_label') })).filter(entry => entry.failure);
// Resolve every stamped key against the original source (independent of the runtime's own rows).
const index = indexElementStamps(results.A.records);
const lines = appSource.split('\n');
const resolveChecks = [...index.byKey.keys()].map(element_key => {
  const resolved = resolveElement(index, { element_key });
  const [, , start] = resolved.placement_id.split(':');
  const offset = Number(start);
  const line = appSource.slice(0, offset).split('\n').length;
  const ok = resolved.status === 'exact' && resolved.source.file === 'client/src/main.jsx' && resolved.source.line === line
    && appSource.startsWith(`<${resolved.tag}`, offset);
  return { element_key, status: resolved.status, file: resolved.source?.file, line: resolved.source?.line, expected_line: line, source_line: lines[line - 1]?.trim().slice(0, 100), ok };
});
// Last-action freshness: the clicked element's metadata names its last dom.action.
const lastActionByKey = new Map();
for (const row of results.A.records) if (row.kind === 'dom.action' && row.target?.element_key) lastActionByKey.set(row.target.element_key, row.action_id);
// Keys are positional (placement + DOM-order ordinal or React key), so a key
// can move to another node when an earlier instance unmounts, and tracer_last_action
// is per DOM node. Check consistency: every named action targeted this key.
const actionKey = new Map(results.A.records.filter(row => row.kind === 'dom.action').map(row => [row.action_id, row.target?.element_key || null]));
const lastActionChecks = results.A.annotations.map(entry => ({ key: entry.key, actual: JSON.parse(entry.metadata).tracer_last_action }))
  .filter(entry => entry.actual).map(entry => ({ ...entry, action_target_key: actionKey.get(entry.actual) ?? null, latest_for_key: lastActionByKey.get(entry.key) ?? null }));
const checks = {
  lifecycle_rows_A_equal_B_C_D_as_multisets: ['B', 'C', 'D'].every(name => JSON.stringify(lifecycle(results.A.records)) === JSON.stringify(lifecycle(results[name].records))),
  records_A_equals_B: normalized.A === normalized.B,
  records_A_equals_C: normalized.A === normalized.C,
  chains_A_equals_B: chains.A === chains.B,
  chains_A_equals_C: chains.A === chains.C,
  records_A_equals_D_bodies_on: normalized.A === normalized.D,
  chains_A_equals_D_bodies_on: chains.A === chains.D,
  builds_differ_only_in_body_setting: buildsDifferOnlyInSettings,
  D_has_body_rows_A_B_C_none: results.D.records.some(row => row.kind === 'network.body') && ['A', 'B', 'C'].every(name => !results[name].records.some(row => row.kind === 'network.body')),
  D_declares_bodies_on_A_declares_production_off: results.D.records.find(row => row.kind === 'capture.page')?.bodies === 'on' && results.A.records.find(row => row.kind === 'capture.page')?.bodies === 'production_off',
  D_stamp_rows_equal_A: JSON.stringify(stampRows('A').map(row => ({ ...row, timestamp: 0 }))) === JSON.stringify(stampRows('D').map(row => ({ ...row, timestamp: 0 }))),
  A_has_stamp_rows: stampRows('A').length > 0,
  A_has_target_element_keys: keyed('A').length > 0,
  A_every_interactive_host_stamped: results.A.interactive.every(entry => entry.key),
  A_oai_payloads_all_valid: results.A.annotations.length > 0 && annotationFailures.length === 0,
  A_last_action_fresh: lastActionChecks.length >= 3 && lastActionChecks.every(entry => entry.action_target_key === entry.key),
  A_resolve_all_exact_against_source: resolveChecks.length > 0 && resolveChecks.every(entry => entry.ok),
  // Positional keys: two independent page loads of the same session stamp the same keys.
  stamp_keys_identical_across_loads: JSON.stringify(stampRows('A').map(row => row.element_key)) === JSON.stringify(stampRows('B').map(row => row.element_key)),
  A_stamp_sequence_contiguous: stampRows('A').every((row, i) => row.stamp_sequence === i + 1),
  B_stamper_ran_but_dom_clean: stampRows('B').length > 0 && results.B.stamped_in_dom === 0 && results.B.oai_in_dom === 0 && keyed('B').length === 0,
  C_no_stamps: stampRows('C').length === 0 && results.C.stamped_in_dom === 0 && keyed('C').length === 0,
  B_C_no_oai_attributes: results.B.oai_in_dom === 0 && results.C.oai_in_dom === 0,
  no_page_errors: Object.values(results).every(result => result.errors.length === 0),
  attribution_rows_present: normalize(results.A.records).some(row => row.kind === 'function.enter') && normalize(results.A.records).some(row => row.kind === 'network.request'),
};
const report = {
  schema: 'producttrace.d12-stamp-neutrality.v1', headless: true, origin, build: manifest.build,
  placements: manifest.placements.length, functions: manifest.functions.length,
  pass: Object.values(checks).every(Boolean), checks,
  counts: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {
    records: result.records.length, stamp_rows: stampRows(name).length, body_rows: result.records.filter(row => row.kind === 'network.body').length, attribution_rows: normalize(result.records).length,
    dom_actions: result.records.filter(row => row.kind === 'dom.action').length, dom_actions_with_element_key: keyed(name).length,
    network_requests: result.records.filter(row => row.kind === 'network.request').length,
    stamped_in_dom: result.stamped_in_dom, oai_in_dom: result.oai_in_dom, stats: result.stats, errors: result.errors }])),
  byte_sizes: Object.fromEntries(Object.entries(normalized).map(([name, text]) => [name, { records: Buffer.byteLength(text), chains: Buffer.byteLength(chains[name]) }])),
  first_difference: { records_A_B: firstDifference(normalized.A, normalized.B), records_A_C: firstDifference(normalized.A, normalized.C), chains_A_B: firstDifference(chains.A, chains.B), chains_A_C: firstDifference(chains.A, chains.C),
    records_A_D: firstDifference(normalized.A, normalized.D), chains_A_D: firstDifference(chains.A, chains.D) },
  interactive_hosts_A: results.A.interactive, annotation_failures: annotationFailures, last_action_checks: lastActionChecks, resolve_checks: resolveChecks,
};
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
fs.rmSync(repository, { recursive: true, force: true });
fs.rmSync(bodiesDist, { recursive: true, force: true });
console.log(JSON.stringify({ pass: report.pass, checks, counts: Object.fromEntries(Object.entries(report.counts).map(([name, value]) => [name, { records: value.records, stamp_rows: value.stamp_rows, body_rows: value.body_rows, keyed: value.dom_actions_with_element_key }])), first_difference: report.first_difference, output: outputDir }, null, 2));
if (!report.pass) process.exitCode = 1;
