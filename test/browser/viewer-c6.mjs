import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const evidenceDir = path.resolve(process.argv[2] || 'docs/evidence/m1-2026-09-22-c6');
const appShots = path.resolve(process.argv[3] || '/tmp/m1-cycle5-lossless-final');
const require = createRequire('/tmp/producttrace-librechat-m1-cycle3e/package.json');
const { chromium } = require('playwright');
const chains = fs.readFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const base = 'http://127.0.0.1:8123';
const score = chain => (chain.chain || []).filter(row => ['network.request', 'route.dispatch', 'handler.enter', 'db.operation'].includes(row.kind)).length;
const carriers = new Map();
for (const chain of chains) if (Number.isInteger(chain.step) && (!carriers.has(chain.step) || score(chain) > score(carriers.get(chain.step)))) carriers.set(chain.step, chain);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const step of [...carriers.keys()].sort((a, b) => a - b)) {
    await page.request.delete(`${base}/api/demo/events`);
    await page.request.post(`${base}/api/demo/events`, { data: [carriers.get(step)] });
    await page.goto(`${base}/fiber-demo`, { waitUntil: 'domcontentloaded' });
    const shot = path.join(appShots, `step-${String(step).padStart(2, '0')}.png`);
    if (fs.existsSync(shot)) {
      const encoded = fs.readFileSync(shot).toString('base64');
      await page.evaluate(({ encoded }) => {
        const frame = document.querySelector('#productFrame');
        if (frame) frame.srcdoc = `<style>html,body{margin:0;background:#111;height:100%;display:grid;place-items:center}img{max-width:100%;max-height:100%;object-fit:contain}</style><img src="data:image/png;base64,${encoded}" alt="Captured LibreChat app state">`;
      }, { encoded });
      await page.locator('#productFrame').evaluate(frame => new Promise(resolve => {
        if (frame.contentDocument?.readyState === 'complete') return resolve();
        frame.addEventListener('load', () => resolve(), { once: true });
        setTimeout(resolve, 2000);
      }));
      await page.locator('#productFrame').contentFrame().locator('img').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    await page.locator('details.event-card').evaluateAll(cards => cards.forEach(card => { card.open = true; }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidenceDir, `viewer-step-${String(step).padStart(2, '0')}.png`), fullPage: true });
  }
  console.log(JSON.stringify({ carrier_steps: carriers.size, screenshots: carriers.size }));
} finally { await browser.close(); }
