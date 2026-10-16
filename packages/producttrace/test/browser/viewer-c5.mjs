import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const evidenceDir = path.resolve(process.argv[2] || 'docs/evidence/m1-2026-09-22-c5');
const require = createRequire('/tmp/producttrace-librechat-m1-cycle3e/package.json');
const { chromium } = require('playwright');
const chains = fs.readFileSync(path.join(evidenceDir, 'causal-chains.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const base = 'http://127.0.0.1:8123';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const step of [...new Set(chains.map(chain => chain.step).filter(Number.isInteger))].sort((a, b) => a - b)) {
    await page.request.delete(`${base}/api/demo/events`);
    const payload = chains.filter(chain => chain.step === step);
    await page.request.post(`${base}/api/demo/events`, { data: payload });
    await page.goto(`${base}/fiber-demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidenceDir, `viewer-step-${String(step).padStart(2, '0')}.png`), fullPage: true });
  }
  console.log(JSON.stringify({ steps: [...new Set(chains.map(chain => chain.step).filter(Number.isInteger))].length, evidenceDir }));
} finally { await browser.close(); }
