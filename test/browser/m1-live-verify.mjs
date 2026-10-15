#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const source = process.env.PRODUCTTRACE_M1_SOURCE || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1';
const require = createRequire(path.join(source, 'package.json'));
const { chromium } = require('playwright');
const output = path.resolve(process.argv[2] || 'docs/evidence/m1-live-2026-09-22');
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await fetch('http://127.0.0.1:8123/api/demo/events', { method: 'DELETE' });
  await page.goto('http://127.0.0.1:8123/fiber-demo?productPort=3081', { waitUntil: 'domcontentloaded' });
  const app = page.frameLocator('#productFrame');
  const email = app.locator('input[name="email"],input[type="email"]').first();
  if (await email.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
    await email.fill('tracer-m1@example.test');
    await app.locator('input[type="password"]').first().fill('Tracer-M1-2026!');
    await app.getByRole('button', { name: /continue|log in|login/i }).click();
  }
  const composer = app.locator('textarea[data-testid="text-input"],#prompt-textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  const newChat = app.locator('[data-testid="new-chat-button"]').first();
  if (await newChat.isVisible().catch(() => false)) await newChat.click({ force: true });
  await composer.fill(`Live viewer causal chain verification ${Date.now()}`);
  await app.locator('button[data-testid="send-button"]').click({ force: true });

  const sendCard = page.locator('.activity-group').filter({ hasText: /POST .*\/api\/agents\/chat\/openAI/i }).first();
  await sendCard.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => {
    const groups = [...document.querySelectorAll('.activity-group')];
    const group = groups.find(node => /POST .*\/api\/agents\/chat\/openAI/i.test(node.textContent || ''));
    const text = group?.textContent || '';
    return /route\.dispatch/i.test(text) && /handler\.enter/i.test(text) && /db\.operation/i.test(text);
  }, null, { timeout: 60_000 });

  await sendCard.locator('details.event-card').evaluate(node => { node.open = true; });
  await sendCard.locator('details.evidence-disclosure').evaluate(node => { node.open = true; });
  await sendCard.evaluate(node => node.scrollIntoView({ block: 'nearest' }));
  const text = await sendCard.innerText();
  for (const required of ['Clicked', 'Effect-rooted entry handler', 'POST /api/agents/chat/openAI', 'Route', 'Handler', 'MongoDB operation']) {
    if (!text.includes(required)) throw new Error(`Live send card is missing ${JSON.stringify(required)}:\n${text}`);
  }
  await page.screenshot({ path: path.join(output, 'viewer-send.png') });
  console.log(JSON.stringify({ headless: true, assertions: 'control, effect-rooted entry handler, request, route, handler, and MongoDB operation', card: text }, null, 2));
} finally {
  await browser.close();
}
