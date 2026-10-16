// fix/stable-element-keys: an element key never resolves to the wrong element.
//
// Builds test/browser/fixtures/stable-keys-app (the same Row in a keyed and an
// unkeyed list, each row with a Save button) with both Tracer plugins, drives
// one headless session: Save on row 4 (Delta) in each list, remove row 2, Save
// on row 4 in each list again. Then loads the records into an MCP store and
// checks: the keyed list resolves `exact` to the right row both times; the
// unkeyed list resolves `ambiguous` with `instances`; the element index's
// per-action binding (joined by stamp_sequence) is the one that held.
//
// Usage: node test/browser/stable-element-keys.mjs <dir containing node_modules with vite, react, react-dom,
//        @vitejs/plugin-react, playwright> <output dir>
// Headless only.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createStore } from '../../collector/store.mjs';
import { callTool } from '../../mcp/tools.mjs';
import { productTraceVitePlugin } from '../../integrations/vite.mjs';
import { runtimeAttributionPlugin } from '../../integrations/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const outputDir = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-stable-keys-out-')));
fs.mkdirSync(outputDir, { recursive: true });
const nodeModules = path.join(dependencyRoot, 'node_modules');
const require = createRequire(path.join(dependencyRoot, 'package.json'));

// ---- 1. build the fixture ------------------------------------------------
const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-stable-keys-app-')));
const clientRoot = path.join(repository, 'client');
fs.mkdirSync(path.join(clientRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: 'stable-keys-fixture', private: true, type: 'module' }));
fs.symlinkSync(nodeModules, path.join(repository, 'node_modules'));
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/stable-keys-app/main.jsx'), 'utf8');
fs.writeFileSync(path.join(clientRoot, 'src/main.jsx'), appSource);
fs.writeFileSync(path.join(clientRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>stable keys</title></head><body><div id="root"></div><div id="root2"></div><script type="module" src="/src/main.jsx"></script></body></html>');
const { build } = await import(pathToFileURL(path.join(nodeModules, 'vite/dist/node/index.js')).href);
const react = (await import(pathToFileURL(path.join(nodeModules, '@vitejs/plugin-react/dist/index.js')).href)).default;
const manifestPath = path.join(repository, 'attribution-manifest.json');
await build({
  root: clientRoot, logLevel: 'warn', configFile: false,
  plugins: [
    productTraceVitePlugin({ repository, service: 'stable-keys-fixture', requestBridge: false }),
    runtimeAttributionPlugin({ repository, manifestPath }),
    react(),
  ],
  build: { outDir: path.join(clientRoot, 'dist'), emptyOutDir: true, sourcemap: true, minify: false,
    rollupOptions: { output: { manualChunks: id => (id.includes('node_modules') ? 'vendor' : undefined) } } },
});
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const distRoot = path.join(clientRoot, 'dist');

// ---- 2. local server -------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const saved = /^\/api\/save\/(keyed|plain)\/(r\d)$/u.exec(url.pathname);
  if (saved && req.method === 'POST') { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ saved: `${saved[1]}:${saved[2]}` })); }); return; }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(distRoot, relative);
  if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- 3. one scripted session -----------------------------------------------
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
let records, domBefore, domAfter, indexBefore, indexAfter, allKeys; const errors = [];
try {
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  page.on('pageerror', error => errors.push(String(error.message || error)));
  let inflight = 0;
  page.on('request', () => { inflight += 1; }); page.on('requestfinished', () => { inflight -= 1; }); page.on('requestfailed', () => { inflight -= 1; });
  const settle = async (ms = 500) => { for (let i = 0; i < 100 && inflight > 0; i += 1) await page.waitForTimeout(20); await page.waitForTimeout(ms); };
  const keys = () => page.evaluate(() => Object.fromEntries(['Keyed list', 'Unkeyed list', 'Index list', 'Widget root 1', 'Widget root 2'].map(name => [name,
    [...document.querySelector(`section[aria-label="${name}"]`).querySelectorAll('button')].map(node => [node.getAttribute('aria-label'), node.getAttribute('data-tracer-el')])])));
  const save = (list, title) => page.getByRole('region', { name: list, exact: true }).getByRole('button', { name: `Save ${title}`, exact: true }).click();
  await page.goto(origin, { waitUntil: 'networkidle' }); await settle();
  domBefore = await keys();
  await save('Keyed list', 'Delta'); await settle();
  await save('Unkeyed list', 'Delta'); await settle();
  await page.getByRole('button', { name: 'Remove row 2' }).click(); await settle();
  domAfter = await keys();
  await save('Keyed list', 'Delta'); await settle();
  await save('Unkeyed list', 'Delta'); await settle();
  // Index keys: Save Beta at index 1, Save Delta at index 3, reverse, Save Delta (now at index 1).
  await save('Index list', 'Beta'); await settle();
  await save('Index list', 'Delta'); await settle(); // at @3; after the reverse @3 shows Beta and is not clicked again
  indexBefore = await keys();
  await page.getByRole('region', { name: 'Index list', exact: true }).getByRole('button', { name: 'Reverse', exact: true }).click(); await settle();
  indexAfter = await keys();
  await save('Index list', 'Delta'); await settle();
  // Two roots: the same Widget in #root and #root2.
  await page.getByRole('region', { name: 'Widget root 2', exact: true }).getByRole('button', { name: 'Widget w2', exact: true }).click(); await settle();
  allKeys = await page.evaluate(() => [...document.querySelectorAll('[data-tracer-el]')].map(node => node.getAttribute('data-tracer-el')));
  records = JSON.parse(await page.evaluate(() => JSON.stringify(globalThis.__productTraceRuntime.records)));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

// ---- 4. MCP answers ----------------------------------------------------------
records = records.map(row => ({ ...row, capture_page_id: 'page-1' }));
fs.writeFileSync(path.join(outputDir, 'records.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n');
const store = createStore({ records, spans: [], manifest });
const saves = records.filter(row => row.kind === 'dom.action' && row.event === 'click' && /^Save /u.test(row.target?.attributes?.['aria-label'] || ''));
const [keyedFirst, plainFirst, keyedSecond, plainSecond, indexBeta, indexDeltaBefore, indexDelta] = saves;
const widgetClick = records.find(row => row.kind === 'dom.action' && row.event === 'click' && row.target?.attributes?.['aria-label'] === 'Widget w2');
const resolve = key => callTool(store, 'resolve_element', { element_key: key });
const history = key => callTool(store, 'element_history', { element_key: key });
const keyedResolved = [keyedFirst, keyedSecond].map(action => resolve(action.target.element_key));
const plainResolved = [plainFirst, plainSecond].map(action => resolve(action.target.element_key));
const keyedHistory = history(keyedFirst.target.element_key);
const plainHistories = [plainFirst, plainSecond].map(action => history(action.target.element_key));
const bindingOf = (result, actionId) => result.actions.find(action => action.action_id === actionId);
const placementOfKey = key => key.replace(/[#@].*$/u, '');
const deltaKeyed = domBefore['Keyed list'].find(([label]) => label === 'Save Delta')[1];
const checks = {
  seven_saves_recorded: saves.length === 7 && indexDeltaBefore.target.attributes['aria-label'] === 'Save Delta' && /@3$/u.test(indexDeltaBefore.target.element_key) && saves.slice(0, 4).every(action => action.target.attributes['aria-label'] === 'Save Delta')
    && indexBeta.target.attributes['aria-label'] === 'Save Beta' && indexDelta.target.attributes['aria-label'] === 'Save Delta',
  keyed_same_key_before_and_after_removal: keyedFirst.target.element_key === keyedSecond.target.element_key && keyedFirst.target.element_key === deltaKeyed && /@r4$/u.test(deltaKeyed),
  keyed_keys_survive_removal: domAfter['Keyed list'].every(([label, key]) => domBefore['Keyed list'].some(([other, otherKey]) => other === label && otherKey === key)),
  keyed_resolves_exact_both_times: keyedResolved.every(result => result.status === 'ok' && result.confidence === 'exact' && result.stamp_key_kind === 'react_key' && result.source?.file === 'client/src/main.jsx'),
  // Each Save is focusin + click on the same element; every one of them is joined to the observation that held.
  keyed_history_binding_right: keyedHistory.actions.filter(action => action.event === 'click').length === 2
    && keyedHistory.actions.every(action => action.binding?.basis === 'stamp_sequence') && [keyedFirst, keyedSecond].every(action => {
    const entry = bindingOf(keyedHistory, action.action_id);
    return entry?.binding?.basis === 'stamp_sequence' && JSON.stringify(entry.binding.react_key_path) === '["r4"]' && entry.element.label === 'Save Delta';
  }),
  plain_keys_are_ordinal: /#n4$/u.test(plainFirst.target.element_key) && /#n3$/u.test(plainSecond.target.element_key)
    && plainFirst.target.key_kind === 'ordinal' && plainFirst.target.instances === 5 && plainSecond.target.key_kind === 'ordinal' && plainSecond.target.instances === 4,
  plain_key_moved_to_another_row: domAfter['Unkeyed list'].find(([label]) => label === 'Save Epsilon')[1] === plainFirst.target.element_key,
  plain_resolves_ambiguous_with_instances: plainResolved.every(result => result.status === 'ambiguous' && result.confidence === 'ambiguous' && result.instances === 5
    && result.reason === 'ordinal key; 5 instances of this placement' && result.candidates.length === 5 && /distinguishing child/u.test(result.advice)),
  plain_history_binding_right: [[plainHistories[0], plainFirst, 5], [plainHistories[1], plainSecond, 4]].every(([result, action, instances]) => {
    const entry = bindingOf(result, action.action_id);
    return entry?.binding?.basis === 'stamp_sequence' && entry.binding.stamp_sequence === action.target.stamp_sequence && entry.binding.instances === instances && entry.element.label === 'Save Delta';
  }),
  same_placement_both_lists: placementOfKey(keyedFirst.target.element_key) === placementOfKey(plainFirst.target.element_key),
  // Index keys: the same `@1` named Beta, then Delta after the reverse; a new stamp row recorded the content change.
  index_key_is_positional: /@1$/u.test(indexBeta.target.element_key) && indexBeta.target.element_key === indexDelta.target.element_key
    && indexBefore['Index list'].find(([label]) => label === 'Save Beta')[1] === indexAfter['Index list'].find(([label]) => label === 'Save Delta')[1],
  index_key_new_row_on_content_change: indexBeta.target.stamp_sequence !== indexDelta.target.stamp_sequence,
  index_key_resolves_ambiguous_with_labels: (() => { const result = resolve(indexBeta.target.element_key); const labels = (result.labels || []).filter(entry => entry.event === 'click').map(entry => entry.label);
    return result.status === 'ambiguous' && result.reason === 'key content changed between actions (index-like key)' && labels.includes('Save Beta') && labels.includes('Save Delta'); })(),
  // @3's only action was on Delta; it now shows Beta. No new click: still not exact.
  index_key_moved_since_action_ambiguous: (() => { const result = resolve(indexDeltaBefore.target.element_key);
    return indexAfter['Index list'].find(([label]) => label === 'Save Beta')[1] === indexDeltaBefore.target.element_key
      && result.status === 'ambiguous' && result.reason === 'key content changed since the action (index-like key)' && result.labels.some(entry => entry.label === 'Save Delta'); })(),
  index_history_ambiguous: (() => { const result = history(indexBeta.target.element_key); return result.element_confidence === 'ambiguous' && result.actions.some(action => action.element.label === 'Save Beta') && result.actions.some(action => action.element.label === 'Save Delta'); })(),
  // Two roots: no key is on two elements; the widget's keys fall back to ordinals counted across roots.
  page_keys_unique: allKeys.length === new Set(allKeys).size,
  two_roots_widget_ordinal: ['Widget root 1', 'Widget root 2'].every(name => domAfter[name].length === 2 && domAfter[name].every(([, key]) => /#n[1-4]$/u.test(key)))
    && widgetClick?.target.key_kind === 'ordinal' && widgetClick.target.instances === 4,
  two_roots_resolve_ambiguous: (() => { const result = resolve(widgetClick.target.element_key); return result.confidence === 'ambiguous' && result.instances === 4 && result.candidates.length === 4; })(),
  no_page_errors: errors.length === 0,
};
const report = { schema: 'producttrace.stable-element-keys.v1', headless: true, origin, build: manifest.build, pass: Object.values(checks).every(Boolean), checks,
  dom_before: domBefore, dom_after: domAfter,
  actions: saves.map(action => ({ action_id: action.action_id, label: action.target.attributes['aria-label'], element_key: action.target.element_key, key_kind: action.target.key_kind, instances: action.target.instances ?? null, stamp_sequence: action.target.stamp_sequence })),
  resolve: { keyed: keyedResolved.map(result => ({ status: result.status, confidence: result.confidence, element_key: result.element_key, source: result.source })),
    plain: plainResolved.map(result => ({ status: result.status, confidence: result.confidence, element_key: result.element_key, reason: result.reason, instances: result.instances, candidates: result.candidates.map(candidate => candidate.element_key), summary: result.summary })) },
  stamp_rows: records.filter(row => row.kind === 'element.stamp').length, errors };
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
fs.rmSync(repository, { recursive: true, force: true });
console.log(JSON.stringify({ pass: report.pass, checks, actions: report.actions, output: outputDir }, null, 2));
if (!report.pass) process.exitCode = 1;
