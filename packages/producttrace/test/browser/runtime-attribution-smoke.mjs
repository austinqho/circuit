import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const worktree = path.resolve(process.argv[2]);
const manifestPath = path.resolve(process.argv[3]);
const tracerRoot = path.resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const functionId = manifest.functions?.[0]?.id;
if (!functionId) throw new Error('runtime attribution smoke has no function marker');
// Optional third argument: the build output directory (default: LibreChat's client/dist).
const distDir = process.argv[4] ? path.resolve(process.argv[4]) : path.join(worktree, 'client/dist');
const runtime = fs.readFileSync(path.join(distDir, 'producttrace-runtime.js'), 'utf8');
const attribution = fs.readFileSync(path.join(tracerRoot, 'src/runtime-attribution-browser.js'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><button id="smoke" type="button">Smoke</button>
<script>${runtime}</script><script>${attribution}</script>
<script>
  // This timer is armed before the click and must remain unattributed.
  setTimeout(() => fetch('/poll'), 30);
  window.smokeHandler = function smokeHandler() {
    const frame = globalThis.__productTraceRuntime.enter(${JSON.stringify(functionId)});
    try {
      fetch('/smoke-request', { headers: { 'x-producttrace-smoke': '1' } });
      const stream = new EventSource('/smoke-stream');
      stream.addEventListener('message', () => {
        const streamFrame = globalThis.__productTraceRuntime.enter(${JSON.stringify(functionId)});
        globalThis.__productTraceRuntime.exit(streamFrame); stream.close();
      });
    }
    finally { globalThis.__productTraceRuntime.exit(frame); }
  };
  document.querySelector('#smoke').addEventListener('click', window.smokeHandler);
</script>`;
const server = http.createServer((request, response) => {
  if (request.url === '/smoke.html') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
  if (request.url === '/smoke-request') { response.writeHead(204); response.end(); return; }
  if (request.url === '/poll') { response.writeHead(204); response.end(); return; }
  if (request.url === '/smoke-stream') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: smoke\\n\\n'); return; }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const require = createRequire(path.join(process.env.PRODUCTTRACE_PLAYWRIGHT_FROM || worktree, 'package.json'));
  const { chromium } = require('playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/smoke.html`);
  await page.locator('#smoke').click();
  await page.waitForTimeout(150);
  const rows = await page.evaluate(() => globalThis.__productTraceRuntime.records.slice());
  const enters = rows.filter(row => row.kind === 'function.enter');
  const requests = rows.filter(row => row.kind === 'network.request');
  const sameAction = requests.some(request => enters.some(enter => enter.action_id && enter.action_id === request.action_id));
  const poll = requests.find(request => request.url.endsWith('/poll'));
  const caused = requests.find(request => request.url.endsWith('/smoke-request'));
  const stream = requests.find(request => request.transport === 'eventsource');
  const pollUnattributed = poll?.action_id == null;
  const causedAttributed = caused?.action_id && caused.action_id === enters.find(enter => enter.action_id)?.action_id;
  const streamAttributed = stream?.action_id && stream.action_id === caused?.action_id;
  if (!enters.length || requests.length < 3 || !sameAction || !pollUnattributed || !causedAttributed || !streamAttributed) {
    throw new Error(`runtime attribution smoke missing continuity: enters=${enters.length} requests=${requests.length} same_action=${sameAction} poll_unattributed=${pollUnattributed} caused_attributed=${causedAttributed} stream_attributed=${streamAttributed}`);
  }
  console.log(JSON.stringify({ status: 'ok', headless: true, function_id: functionId, enters: enters.length, network_requests: requests.length, same_action: sameAction, poll_unattributed: pollUnattributed, caused_attributed: causedAttributed, stream_attributed: streamAttributed }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
