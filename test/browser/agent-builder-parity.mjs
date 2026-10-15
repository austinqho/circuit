import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [disabledRoot, enabledRoot, outputPath] = process.argv.slice(2).map(value => path.resolve(value));
const backendOrigin = 'http://localhost:3080';
const serve = root => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      const target = new URL(backendOrigin + req.url);
      const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
      upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream); return;
    }
    const pathname = new URL(req.url, 'http://static').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
};
const require = createRequire(path.join(enabledRoot, 'package.json'));
const { chromium } = require('playwright');
const inspect = async (browser, origin, label) => {
  const context = await browser.newContext({ serviceWorkers: 'block' }); const page = await context.newPage();
  const result = { label, origin, status: 'stop', errors: [] };
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input', { timeout: 15000 });
    await page.locator('input').first().fill('tracer-m1@example.test'); await page.locator('input[type="password"]').fill('Tracer-M1-2026!');
    await page.getByRole('button', { name: /continue|log in|login/i }).click(); await page.waitForTimeout(1800);
    await page.locator('[data-testid="nav-panel-agents"]').click(); await page.waitForTimeout(1200);
    const panel = page.getByText('Create New Agent', { exact: true }).locator('..').locator('..');
    result.status = 'ok'; result.dom_text = (await page.locator('body').innerText()).split('\n').filter(Boolean).slice(0, 160);
    result.builder_html = (await page.locator('body').innerHTML()).replace(/\s+/gu, ' ').replace(/[0-9a-f]{8,}/giu, '<id>').slice(0, 120000);
    result.comboboxes = await page.getByRole('combobox').allTextContents(); result.options = await page.getByRole('option').allTextContents();
    result.model_option_count = result.options.length;
    result.dom_projection = { text: result.dom_text, comboboxes: result.comboboxes, options: result.options,
      labels: await page.locator('label').allTextContents() };
    void panel;
  } catch (error) { result.errors.push(String(error?.message || error)); }
  await context.close(); return result;
};
const disabled = await serve(path.join(disabledRoot, 'client', 'dist')); const enabled = await serve(path.join(enabledRoot, 'client', 'dist')); const browser = await chromium.launch({ headless: true });
try {
  const results = [await inspect(browser, disabled.origin, 'plugin-disabled'), await inspect(browser, enabled.origin, 'plugin-enabled')];
  const [a, b] = results; const parity = a.status === 'ok' && b.status === 'ok'
    && JSON.stringify(a.dom_projection) === JSON.stringify(b.dom_projection);
  const output = { schema: 'producttrace.agent-builder-parity.v1', headless: true, parity, results };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2)); console.log(JSON.stringify({ parity, statuses: results.map(x => x.status), model_option_counts: results.map(x => x.model_option_count) }));
  if (!parity) process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolve => disabled.server.close(resolve)); await new Promise(resolve => enabled.server.close(resolve)); }
