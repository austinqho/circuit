#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const source = process.env.PRODUCTTRACE_M1_SOURCE || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1';
const require = createRequire(path.join(source, 'package.json'));
const { chromium } = require('playwright');
const output = path.resolve(process.argv[2] || 'docs/evidence/m1-live-2026-09-22');
fs.mkdirSync(output, { recursive: true });

const viewerUrl = 'http://127.0.0.1:8123/fiber-demo?productPort=3081';
const requestPath = value => new URL(value).pathname;
const browser = await chromium.launch({ headless: true });
const observedRequests = [];

try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  page.on('request', request => {
    const pathname = requestPath(request.url());
    if (pathname.startsWith('/api/')) observedRequests.push({ at: Date.now(), method: request.method(), path: pathname });
  });
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded' });
  const app = page.frameLocator('#productFrame');
  const email = app.locator('input[name="email"],input[type="email"]').first();
  if (await email.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
    await email.fill('tracer-m1@example.test');
    await app.locator('input[type="password"]').first().fill('Tracer-M1-2026!');
    await app.getByRole('button', { name: /continue|log in|login/i }).click();
  }
  const composer = app.locator('textarea[data-testid="text-input"],#prompt-textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  const appFrame = page.frames().find(frame => /^http:\/\/127\.0\.0\.1:3081\//u.test(frame.url()));
  if (!appFrame) throw new Error('Instrumented app frame was not found');
  await appFrame.waitForFunction(() => {
    const state = globalThis.__producttraceCaptureState?.();
    return state && state.critical === 0 && !state.critical_inflight;
  }, null, { timeout: 30_000 });

  // Login is verified separately by the live session. Clear it so the final
  // panel contains only the user's requested send, feedback, and builder flow.
  await fetch('http://127.0.0.1:8123/api/demo/events', { method: 'DELETE' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await app.locator('textarea[data-testid="text-input"],#prompt-textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(() => {
    window.__m1CardHistory = [];
    window.__m1CardLast = {};
    const sample = () => {
      for (const group of document.querySelectorAll('.activity-group[data-workflow-id]')) {
        const id = group.dataset.workflowId;
        const label = group.querySelector('.caption')?.textContent?.trim() || '';
        if (label && window.__m1CardLast[id] !== label) {
          window.__m1CardLast[id] = label;
          window.__m1CardHistory.push({ at: performance.now(), workflow_id: id, label });
        }
      }
    };
    new MutationObserver(sample).observe(document.querySelector('#eventStream'), { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener('producttrace:workflow-update', event => {
      const { workflow_id: id, label } = event.detail || {};
      if (id && label && window.__m1CardLast[id] !== label) {
        window.__m1CardLast[id] = label;
        window.__m1CardHistory.push({ at: performance.now(), workflow_id: id, label });
      }
    });
    sample();
  });

  const sendResponse = page.waitForResponse(response => response.request().method() === 'POST' && requestPath(response.url()) === '/api/agents/chat/openAI', { timeout: 30_000 });
  await composer.fill('test');
  await app.locator('button[data-testid="send-button"]').click({ force: true });
  await sendResponse;
  const loveThis = app.locator('button[title="Love this"]:visible').last();
  await loveThis.waitFor({ state: 'visible', timeout: 60_000 });

  const feedbackResponse = page.waitForResponse(response => response.request().method() === 'PUT' && /\/api\/messages\/.+\/feedback$/u.test(requestPath(response.url())), { timeout: 15_000 });
  await loveThis.click({ force: true });
  await app.getByRole('button', { name: 'Clear and Well-Written', exact: true }).click({ force: true });
  await feedbackResponse;

  await app.locator('[data-testid="nav-panel-agents"]').click({ force: true });
  const form = app.locator('form[aria-label="Agent configuration form"]');
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  const unique = Date.now();
  await form.getByLabel(/Agent name/i).pressSequentially(`Live evidence agent ${unique}`);
  await form.getByLabel(/Agent description/i).pressSequentially('Headless live episode verification');
  await form.getByLabel(/^Instructions$/i).pressSequentially('Answer briefly and clearly.');

  const postsBeforeRejectedSubmit = observedRequests.filter(row => row.method === 'POST' && row.path === '/api/agents').length;
  await form.getByRole('button', { name: /^Create$/i }).click({ force: true });
  const rejectedCard = page.locator('.activity-group').filter({ hasText: 'Submit rejected by the app' }).first();
  await rejectedCard.waitFor({ state: 'visible', timeout: 10_000 });
  const postsAfterRejectedSubmit = observedRequests.filter(row => row.method === 'POST' && row.path === '/api/agents').length;
  if (postsAfterRejectedSubmit !== postsBeforeRejectedSubmit) throw new Error('The no-model Create unexpectedly sent POST /api/agents');

  await form.getByText('Select a model', { exact: true }).last().click({ force: true });
  const provider = form.getByRole('combobox', { name: /^Provider$/i });
  await provider.click({ force: true });
  await app.getByRole('option', { name: /^openAI$/i }).click({ force: true });
  const model = form.getByRole('combobox', { name: /^Model$/i });
  await model.click({ force: true });
  const preferredModel = app.getByRole('option', { name: /^gpt-3\.5-turbo$/i }).first();
  if (await preferredModel.count()) await preferredModel.click({ force: true });
  else await app.getByRole('option').first().click({ force: true });
  await form.getByRole('button', { name: /Back to builder/i }).click({ force: true });

  const createResponse = page.waitForResponse(response => response.request().method() === 'POST' && requestPath(response.url()) === '/api/agents', { timeout: 20_000 });
  await form.getByRole('button', { name: /^Create$/i }).click({ force: true });
  const created = await createResponse;
  if (!created.ok()) throw new Error(`POST /api/agents failed with ${created.status()}`);

  const effectCards = {
    send: page.locator('.activity-group').filter({ hasText: /POST \/api\/agents\/chat\/openAI/i }).first(),
    feedback: page.locator('.activity-group').filter({ hasText: /PUT \/api\/messages\/.+\/feedback/i }).first(),
    agent: page.locator('.activity-group').filter({ hasText: /POST \/api\/agents(?:\s|$)/i }).first(),
  };
  for (const [name, card] of Object.entries(effectCards)) {
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.locator('details.event-card').evaluate(node => { node.open = true; });
    const disclosure = card.locator('details.evidence-disclosure');
    if (await disclosure.count()) await disclosure.evaluate(node => { node.open = true; });
    if (name === 'send') await card.getByText(/insert|findAndModify|update/i).first().waitFor({ state: 'visible', timeout: 30_000 });
    if (name === 'feedback') await card.getByText(/update|findAndModify/i).first().waitFor({ state: 'visible', timeout: 30_000 });
    if (name === 'agent') await card.getByText(/insert agents/i).first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  const groups = page.locator('.activity-group');
  const groupCount = await groups.count();
  const groupTexts = await groups.allInnerTexts();
  if (groupTexts.some(text => /Unresolved path/iu.test(text))) throw new Error(`Viewer retained an unresolved label:\n${groupTexts.join('\n---\n')}`);
  if (groupCount !== 3) throw new Error(`Expected exactly three workflow episodes, got ${groupCount}:\n${groupTexts.join('\n---\n')}`);
  if (!groupTexts.some(text => text.includes('Submit rejected by the app') && /POST \/api\/agents(?:\s|$)/u.test(text) && /insert agents/iu.test(text))) {
    throw new Error(`Agent Builder did not retain rejection plus successful insert in one card:\n${groupTexts.join('\n---\n')}`);
  }

  const history = await page.evaluate(() => window.__m1CardHistory);
  const sendId = await effectCards.send.getAttribute('data-workflow-id');
  const sendHistory = history.filter(row => row.workflow_id === sendId).map(row => row.label);
  for (const required of ['Waiting for effect', 'Request sent: POST /api/agents/chat/openAI']) {
    if (!sendHistory.includes(required)) throw new Error(`Send card did not update in place through ${JSON.stringify(required)}: ${JSON.stringify(sendHistory)}`);
  }
  if (!sendHistory.some(label => label.startsWith('Effect: '))) {
    throw new Error(`Send card did not update in place through its effect: ${JSON.stringify(sendHistory)}`);
  }

  await page.addStyleTag({ content: '.activity-widget{height:auto!important;max-height:none!important;overflow:visible!important}.event-stream{overflow:visible!important;max-height:none!important}.demo-canvas{height:auto!important;overflow:visible!important}' });
  await page.locator('.activity-widget').screenshot({ path: path.join(output, 'viewer-user-sequence.png') });
  const result = { headless: true, viewer_url: viewerUrl, workflow_count: groupCount, send_history: sendHistory,
    history, requests: observedRequests, posts_after_rejected_submit: postsAfterRejectedSubmit, cards: groupTexts };
  fs.writeFileSync(path.join(output, 'viewer-user-sequence.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
