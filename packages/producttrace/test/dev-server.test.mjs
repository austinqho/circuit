import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { producttrace } from '../vite.mjs';

// One small app run through `vite dev` with producttrace: what the browser is
// served must register its functions, carry awaits, frame inline handlers,
// keep component names, and the runtime asset must be served.
test('under vite dev, app modules carry everything the build adds at bundle time', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-dev-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/src/app.js"></script></body></html>');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), [
    'export const Card = () => { const label = "x"; return label; };',
    'export async function save(api) { const response = await api.post("/items"); return response; }',
    'export const onClick = () => save({ post: async () => 1 });',
    '',
  ].join('\n'));
  const cwd = process.cwd();
  process.chdir(root);
  const server = await createServer({ root, configFile: false, logLevel: 'silent', server: { middlewareMode: true }, plugins: [...producttrace({ requestBridge: false })] });
  t.after(async () => { await server.close(); process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });

  const { code } = await server.transformRequest('/src/app.js');
  assert.match(code, /registerManifest\(\[/u, 'functions are registered by the module itself');
  assert.match(code, /function __ptAwB\(/u, 'await helpers are defined where awaits are rewritten');
  assert.match(code, /__ptAwS\(__ptAw\)/u, 'the await in save() carries its continuation');
  assert.match(code, /tag\?\.\(\([\s\S]*?\),\d+,(?:true|false),(?:true|false),"Card"\)/u, 'Card keeps its name through tag()');
  // An inline handler: a leaf concise arrow is framed in place; one with functions inside is entered through a proxy.
  assert.match(code, /async \(\) => \(async \(\)=>\{const __ptFrame\d+=globalThis\.__productTraceRuntime\?\.enter\(/u, 'a leaf concise arrow is framed');
  assert.match(code, /onClick = [^\n]*,\d+,true,(?:true|false),"onClick"\)\s*;?\s*$/mu, 'onClick (functions inside) is entered through a proxy');

  const served = await new Promise(resolve => {
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { resolve({ headers: this.headers, body }); } };
    server.middlewares.handle({ url: '/producttrace-runtime.js', method: 'GET', headers: {} }, response, () => resolve(null));
  });
  assert.ok(served && served.body.length > 1000, 'the runtime asset is served');
  assert.equal(served.headers['content-type'], 'text/javascript');
});
