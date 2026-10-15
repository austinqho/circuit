// State receipts and creation-time ownership across React majors (headless).
// Builds the continuations fixture against each dependency root given (the
// LibreChat fixture's React 18.3.1 by default, plus any React 19 root), and
// asserts the same attribution for the form-library submit, the receipt cases
// and the P1f functional no-op. A renderer registered with no dispatcher where
// its version says it lives yields one `capture.limit` row and no guess.
//   node test/browser/react-versions-receipts.mjs <dependencyRoot> [<dependencyRoot> ...]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1'];
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/continuation-app/main.jsx'), 'utf8');
const ok = () => ({ ok: true });
const results = [];
for (const dependencyRoot of roots) {
  const reactVersion = JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'node_modules/react-dom/package.json'), 'utf8')).version;
  const fixture = await buildReactFixture({ dependencyRoot, appSource, name: `receipts-react-${reactVersion}` });
  const server = await serveFixture(fixture.distRoot, new Proxy({}, { get: (target, key) => (typeof key === 'string' && key.includes(' /api/')) ? ok : undefined }));
  const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    const warnings = []; page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    await page.goto(server.origin, { waitUntil: 'networkidle' }); await page.waitForTimeout(150);
    const loadedVersion = await page.evaluate(() => [...globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map(renderer => renderer.reconcilerVersion || renderer.version));
    await page.getByRole('button', { name: 'Delayed update' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Functional no-op/u }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Library submit' }).click(); await page.waitForTimeout(400);
    // A renderer whose version says the dispatcher lives somewhere it does not.
    await page.evaluate(() => { globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({ currentDispatcherRef: {}, version: '99.0.0', reconcilerVersion: '99.0.0' }); globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({ currentDispatcherRef: {}, version: '99.0.0' }); });
    const rows = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
    await page.close();
    assert.deepEqual(errors, []);
    const clicks = rows.filter(row => row.kind === 'dom.action' && row.event === 'click' && row.target?.tag === 'button');
    const submit = rows.find(row => row.kind === 'dom.action' && row.event === 'submit');
    const byUrl = url => rows.filter(row => row.kind === 'network.request' && row.url === url);
    const summary = Object.fromEntries(['/api/state-effect', '/api/mounted', '/api/form-submit', '/api/p1f-tick'].map(url => [url, byUrl(url).map(row => ({ action_id: row.action_id, linkage_kind: row.linkage_kind }))]));
    assert.equal(byUrl('/api/state-effect').length, 1);
    assert.equal(byUrl('/api/state-effect')[0].action_id, clicks[0].action_id, `${reactVersion}: state effect belongs to the Delayed click`);
    assert.equal(byUrl('/api/state-effect')[0].linkage_kind, 'state_effect');
    assert.equal(byUrl('/api/mounted')[0].linkage_kind, 'mount_effect');
    assert.equal(byUrl('/api/form-submit').length, 1);
    assert.equal(byUrl('/api/form-submit')[0].action_id, submit.action_id, `${reactVersion}: form-library fetch belongs to the submit`);
    assert.equal(byUrl('/api/form-submit')[0].linkage_kind, 'direct');
    assert.ok(byUrl('/api/p1f-tick').length >= 1 && byUrl('/api/p1f-tick').every(row => row.action_id == null), `${reactVersion}: P1f not attributed`);
    const limits = rows.filter(row => row.kind === 'capture.limit');
    assert.equal(limits.length, 1, 'one capture.limit row per page');
    assert.deepEqual([limits[0].feature, limits[0].reason, limits[0].react_version], ['state_receipts', 'dispatcher not found', '99.0.0']);
    assert.equal(warnings.filter(text => text.includes('state receipts unavailable')).length, 1);
    results.push({ dependency_root: dependencyRoot, react_dom: reactVersion, renderers: loadedVersion, summary, capture_limit: limits[0] });
  } finally { await browser.close(); await server.close(); fixture.cleanup(); }
}
// The same attribution under every React version.
const shape = result => Object.fromEntries(Object.entries(result.summary).map(([url, list]) => [url, [...new Set(list.map(row => row.linkage_kind ?? null))]]));
for (const result of results.slice(1)) assert.deepEqual(shape(result), shape(results[0]), `${result.react_dom} attributes like ${results[0].react_dom}`);
console.log(JSON.stringify({ status: 'ok', headless: true, results }, null, 2));
