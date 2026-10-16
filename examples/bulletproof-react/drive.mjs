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
// Key by key, like a person: one line per field however many events it takes.
await page
  .getByLabel('Email Address')
  .pressSequentially(`maya+${sessionStart}@example.com`, { delay: 10 });
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
  /^Clicked the “Get started” button → .*went to \/auth\/login/u,
  /^Submitted the form with the “Register” button → .*POST \/auth\/register \(200/u,
  /^Submitted the form with the “Submit” button → .*POST \/discussions \(200, created discussion \S+\)/u,
  /^Clicked the “View” link → .*went to \/app\/discussions\/\S+ \(discussion \S+\)/u,
  /^Typed in the “Email Address” field$/u,
  /^Submitted the form with the “Submit” button → .*POST \/comments \(200, created comment \S+\)/u,
];
const missing = expected.filter((pattern) => !lines.some((line) => pattern.test(line.text)));

// The same session grouped into goals, each with its sub-actions.
const ids = new Set(lines.map((line) => line.id));
const segments = story.segments.filter((segment) => segment.lines.some((id) => ids.has(id)));
console.log('');
for (const segment of segments) {
  console.log(
    `${segment.title}  (${segment.lines.length} steps, ${Math.round((segment.duration_ms ?? 0) / 1000)} s)`,
  );
  for (const step of segment.steps)
    console.log(`    · ${step.text}${step.facts?.length ? `  [${step.facts.join('; ')}]` : ''}`);
}
const goals = [
  /^Registered as maya\+\d+@example\.com for the team “Acme” and landed on the Dashboard page\.$/u,
  /^Opened the Discussions page and created the first discussion titled “Pricing page feedback”\.$/u,
  /^Opened “Pricing page feedback”, the discussion they just created, and posted its first comment\.$/u,
];
for (const pattern of goals)
  if (!segments.some((segment) => pattern.test(segment.title))) missing.push(pattern);
const emailLines = lines.filter((line) => line.text.includes('“Email Address”')).length;
if (emailLines !== 1) missing.push(`one line for the Email Address field (got ${emailLines})`);
if (missing.length) {
  console.error(`\nmissing ${missing.length} expected sentence(s):\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(
  `\nok: ${lines.length} sentences in ${segments.length} goals, every expected one present`,
);
