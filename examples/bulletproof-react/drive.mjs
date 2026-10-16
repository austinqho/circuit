#!/usr/bin/env node
// A scripted user session against the running demo (npm run demo), then the
// story the collector tells about it. Exits 1 if an expected sentence is missing,
// so it doubles as the example's end-to-end check.
//
//   npm run drive -w examples/bulletproof-react
//
// Browser: CHROMIUM_PATH, else Playwright's installed Chromium, else local Chrome.
import { chromium } from 'playwright-core';

const APP = `http://127.0.0.1:${process.env.APP_PORT || 4173}`;
const COLLECTOR = `http://127.0.0.1:${process.env.COLLECTOR_PORT || 8787}`;

async function launch() {
  if (process.env.CHROMIUM_PATH)
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: 'chrome' });
  }
}

const browser = await launch();
const page = await browser.newPage();
// Only the app and the collector: third-party fonts and analytics are not part of the test.
await page.route(
  (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
  (route) => route.abort(),
);
const sessionStart = Date.now();
await page.goto(`${APP}/`);
await page.getByRole('button', { name: 'Get started' }).click();
await page.getByRole('link', { name: 'Register' }).click();
await page.getByLabel('First Name').fill('Maya');
await page.getByLabel('Last Name').fill('Chen');
await page.getByLabel('Email Address').fill(`maya+${sessionStart}@example.com`);
await page.getByLabel('Password').fill('password123');
await page.getByLabel('Team Name').fill('Acme');
await page.getByRole('button', { name: 'Register' }).click();
await page.waitForURL('**/app');
await page.getByRole('link', { name: 'Discussions' }).click();
await page.getByRole('button', { name: 'Create Discussion' }).click();
await page.getByLabel('Title').fill('Pricing page feedback');
await page.getByLabel('Body').fill('The annual toggle is confusing');
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByLabel('Discussion Created').getByRole('button', { name: 'Close' }).click();
await page.getByRole('link', { name: 'View' }).first().click();
await page.getByRole('button', { name: 'Create Comment' }).click();
await page.getByLabel('Body').fill('Agreed, lets fix it');
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByText('Agreed, lets fix it').waitFor();
await browser.close();

// The runtime ships rows in batches; give the last batch a moment.
await new Promise((resolve) => setTimeout(resolve, 1500));
const story = await (await fetch(`${COLLECTOR}/story`)).json();
const lines = story.lines.filter((line) => line.at >= sessionStart);
for (const line of lines) console.log(new Date(line.at).toLocaleTimeString(), line.text);

const expected = [
  /^Clicked the “Get started” button/u,
  /^Submitted the form with the “Register” button → .*POST \/auth\/register \(200/u,
  /^Submitted the form with the “Submit” button → .*POST \/discussions \(200, created discussion \S+\)/u,
  /^Went to \/app\/discussions\/\S+ \(discussion \S+\)/u,
  /^Submitted the form with the “Submit” button → .*POST \/comments \(200, created comment \S+\)/u,
];
const missing = expected.filter((pattern) => !lines.some((line) => pattern.test(line.text)));
if (missing.length) {
  console.error(`\nmissing ${missing.length} expected sentence(s):\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`\nok: ${lines.length} sentences, every expected one present`);
