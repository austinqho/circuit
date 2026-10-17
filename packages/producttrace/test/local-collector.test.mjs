import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build, createServer } from 'vite';
import { producttrace } from '../vite.mjs';

// The one-line install: `producttrace()` with no options, served by `vite`.
// The dev server runs the collector itself, on the app's own origin.
test('producttrace() under vite dev collects on /__producttrace and shows the live story there', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-local-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/src/app.js"></script></body></html>');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const onClick = () => fetch("/api/items");\n');
  const cwd = process.cwd();
  process.chdir(root);
  const server = await createServer({ root, configFile: false, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' }, plugins: [producttrace()] });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  let closed = false;
  t.after(async () => { if (!closed) await server.close(); process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });

  // The page's sink posts to the dev server itself; no request bridge is installed.
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /"\/__producttrace"/u, 'the page ships rows to /__producttrace');
  assert.doesNotMatch(html, /producttrace-request-bridge/u, 'no static-era request bridge without a backend');

  const row = { schema: 'producttrace.runtime.v1', event: 'capture.summary', capture_page_id: 's_test', timestamp: Date.now() };
  const ingest = await fetch(`${base}/__producttrace/ingest`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify([row]) });
  assert.equal(ingest.status, 200);
  const status = await (await fetch(`${base}/__producttrace/status`)).json();
  assert.equal(status.received, 1);
  const storeDir = path.join(root, 'node_modules', '.producttrace', 'store');
  assert.equal(status.store, storeDir, 'the store sits beside Vite\'s cache, outside the source tree');

  const story = await (await fetch(`${base}/__producttrace/story`)).json();
  assert.equal(story.schema, 'producttrace.story.v1');
  const viewer = await fetch(`${base}/__producttrace/`);
  assert.match(viewer.headers.get('content-type'), /text\/html/u);
  assert.match(await viewer.text(), /What the user is doing/u);
  // DNS rebinding (a site's name now pointing at 127.0.0.1) and other sites' pages are refused.
  const { port } = new URL(base);
  const rebound = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/__producttrace/story', headers: { host: `evil.example:${port}` } }, (response) => { response.resume(); resolve(response.statusCode); });
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(`${base}/__producttrace/story`, { headers: { origin: 'https://evil.example' } })).status, 403);
  // Paths under the prefix that are not the collector's stay the app's.
  assert.equal((await fetch(`${base}/__producttrace/bridge`, { method: 'POST', body: '{}' })).status, 404);

  // Closing the dev server closes the run.
  await server.close();
  closed = true;
  const runs = fs.readFileSync(path.join(storeDir, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].run_id, status.run_id);
});

test('producttrace() with a collector URL or false runs no collector of its own', () => {
  for (const collector of ['http://127.0.0.1:8787', false]) {
    const names = producttrace({ collector, requestBridge: false }).map((plugin) => plugin.name);
    assert.ok(!names.includes('producttrace-local-collector'), `collector: ${collector}`);
  }
  assert.ok(producttrace().some((plugin) => plugin.name === 'producttrace-local-collector'));
});

function tinyApp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-inert-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/src/app.js"></script></body></html>');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const onClick = () => fetch("/api/items");\n');
  const cwd = process.cwd();
  process.chdir(root);
  t.after(() => { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

// A test run (Vitest sets mode 'test') and a production build are left exactly as the app has them.
test('producttrace() does nothing in a test run or a production build', async (t) => {
  const root = tinyApp(t);
  const server = await createServer({ root, configFile: false, logLevel: 'silent', mode: 'test', server: { middlewareMode: true }, plugins: [producttrace()] });
  const html = await server.transformIndexHtml('/index.html', fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const { code } = await server.transformRequest('/src/app.js');
  await server.close();
  assert.doesNotMatch(html, /producttrace/u, 'no runtime in a test run');
  assert.doesNotMatch(code, /__productTraceRuntime|registerManifest/u, 'no instrumented modules in a test run');

  await build({ root, configFile: false, logLevel: 'silent', build: { outDir: path.join(root, 'dist') }, plugins: [producttrace()] });
  const built = fs.readdirSync(path.join(root, 'dist'), { recursive: true }).map(String);
  assert.ok(!built.some((file) => file.includes('producttrace')), `production build untouched: ${built.join(', ')}`);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8'), /producttrace/u);
  assert.ok(!fs.existsSync(path.join(root, 'node_modules', '.producttrace', 'installation.json')), 'nothing was analysed');
});

test('the recording script follows the app\'s base path', async (t) => {
  const root = tinyApp(t);
  const server = await createServer({ root, configFile: false, logLevel: 'silent', base: '/free/', server: { port: 0, host: '127.0.0.1' }, plugins: [producttrace()] });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const html = await (await fetch(`${base}/free/`)).text();
  const src = html.match(/src="([^"]*producttrace-runtime\.js[^"]*)"/u)?.[1];
  assert.match(src, /^\/free\/producttrace-runtime\.js/u);
  const script = await fetch(`${base}${src}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/u);
  await server.close();
});
