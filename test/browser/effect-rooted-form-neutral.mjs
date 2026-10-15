import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { indexEntryHandlerUnits } from '../../analysis/runtime-attribution.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const worktree = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-m1-final');
const runtime = fs.readFileSync(path.join(root, 'src/runtime-attribution-browser.js'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><form id="fixture"><input required value="ok"><button>Submit</button></form>
<script>${runtime}</script><script>
const runtime = globalThis.__productTraceRuntime;
runtime.registerManifest([{index:0,id:'fixture-validator'},{index:1,id:'fixture-submit'}]);
function validator() { const frame=runtime.enter(0); try { return true; } finally { runtime.exit(frame); } }
const submitHandler = runtime.tag(function submitHandler() { const nested = () => true; nested(); return fetch('/submitted', {method:'POST'}); },1,true);
runtime.tag(validator,0);
document.querySelector('#fixture').addEventListener('submit', event => {
  event.preventDefault();
  validator();
  Promise.resolve().then(submitHandler);
});
</script>`;
const server = http.createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
  if (request.url === '/submitted') { response.writeHead(204); response.end(); return; }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/submitted')),
    page.locator('button').click(),
  ]);
  const rows = await page.evaluate(() => globalThis.__productTraceRuntime.records.slice());
  const indexed = indexEntryHandlerUnits(rows, { registeredFunctionIds: ['fixture-validator', 'fixture-submit'] });
  const action = rows.find(row => row.kind === 'dom.action' && row.event === 'submit');
  assert.ok(action, 'trusted form submit action was recorded');
  assert.deepEqual(indexed.byAction.get(action.action_id), ['fixture-submit|submit']);
  assert.equal(indexed.units.has('fixture-validator|submit'), false);
  const enters = rows.filter(row => row.kind === 'function.enter' && row.action_id === action.action_id);
  assert.ok(enters.length >= 2);
  assert.ok(enters.every(row => ['event', 'render', 'effect', 'async'].includes(row.invoked_by)));
  console.log(JSON.stringify({ status: 'ok', headless: true, action_id: action.action_id, credited: indexed.byAction.get(action.action_id), spine_only: 'fixture-validator', invoked_by: enters.map(row => ({ function_id: row.function_id, invoked_by: row.invoked_by })) }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
