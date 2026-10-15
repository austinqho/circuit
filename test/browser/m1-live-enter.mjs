#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const source = process.env.PRODUCTTRACE_M1_SOURCE || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1';
const require = createRequire(path.join(source, 'package.json'));
const { chromium } = require('playwright');
const output = path.resolve(process.argv[2] || 'docs/evidence/m1-live-2026-09-22');
const suffix = process.argv[3] || 'before-fix';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  console.error('[m1-live-enter] opening viewer');
  await page.goto('http://127.0.0.1:8123/fiber-demo?productPort=3081', { waitUntil: 'domcontentloaded' });
  const app = page.frameLocator('#productFrame');
  const email = app.locator('input[name="email"],input[type="email"]').first();
  const loginVisible = await email.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (loginVisible) {
    console.error('[m1-live-enter] logging in');
    await email.fill('tracer-m1@example.test');
    await app.locator('input[type="password"]').first().fill('Tracer-M1-2026!');
    await app.getByRole('button', { name: /continue|log in|login/i }).click();
  }
  const composer = app.locator('textarea[data-testid="text-input"],#prompt-textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 15_000 }).catch(async (error) => {
    const text = await app.locator('body').innerText().catch(() => 'embedded body unavailable');
    throw new Error(`Composer did not appear. Embedded body: ${text.slice(0, 800)}`, { cause: error });
  });
  console.error('[m1-live-enter] composer ready');
  await composer.fill(`M1 Enter glitch probe ${Date.now()}`);
  const appFrame = page.frames().find(frame => /^http:\/\/127\.0\.0\.1:3081\//u.test(frame.url()));
  const metrics = async () => ({
    outer: await page.evaluate(() => {
      const frameRect = document.querySelector('#productFrame').getBoundingClientRect();
      const canvas = document.querySelector('#demoCanvas');
      return {
        scroll_y: scrollY,
        canvas_scroll_y: canvas.scrollTop,
        frame: { top: frameRect.top, left: frameRect.left, width: frameRect.width, height: frameRect.height },
      };
    }),
    inner: await appFrame.evaluate(() => ({ url: location.href, scroll_y: scrollY, body_height: document.body.scrollHeight, viewport_height: innerHeight,
      active: { tag: document.activeElement?.tagName || null, id: document.activeElement?.id || null, testid: document.activeElement?.getAttribute?.('data-testid') || null } })),
  });
  const before = await metrics();
  await page.screenshot({ path: path.join(output, 'enter-before.png') });
  console.error('[m1-live-enter] pressing Enter');
  await composer.press('Enter');
  await page.waitForTimeout(1500);
  const after = await metrics();
  await page.screenshot({ path: path.join(output, `enter-after-${suffix}.png`) });
  console.log(JSON.stringify({ headless: true, before, after }, null, 2));
} finally {
  await browser.close();
}
