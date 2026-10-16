import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../..');
const worktree = path.resolve(process.argv[2]);
const runtime = fs.readFileSync(path.join(root, 'src/runtime-attribution-browser.js'), 'utf8');
const html = `<!doctype html><script>${runtime}</script><script>
function declaration(){};
const expression = function expression(){};
const concise = () => 1;
const block = () => { return 2; };
const object = { method() {}, arrow: () => 3 };
class Fixture { method() {} property = () => 4; }
const instance = new Fixture();
const ids = [declaration, expression, concise, block, object.method, object.arrow, instance.method, instance.property]
  .map((fn, index) => globalThis.__productTraceRuntime.tag(fn, index) && globalThis.__productTraceRuntime.functionIdOf(fn));
globalThis.__registrationResult = { count: ids.filter(Boolean).length, ids };
</script>`;
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, {'content-type':'text/html'}); res.end(html); return; } res.writeHead(404); res.end(); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(() => globalThis.__registrationResult);
  const output = { schema: 'producttrace.registration-neutral.v1', headless: true, forms: ['declaration','function_expression','concise_arrow','block_arrow','object_method','object_arrow','class_method','class_property'], ...result, pass: result.count === 8 };
  console.log(JSON.stringify(output));
  if (!output.pass) process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
