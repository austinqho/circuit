import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { attachBackendSpans } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const worktree = path.resolve(process.argv[2]);
const evidenceDir = path.resolve(process.argv[3] || '/tmp/m1-cycle2-evidence');
const backendOrigin = 'http://localhost:3080';
const bridgeOrigin = 'http://127.0.0.1:8123';
fs.mkdirSync(evidenceDir, { recursive: true });
const rows = [];
const capturePages = new Map();
const captureStats = { batches: 0, received: 0, dropped: 0, gaps: [], pages: {} };
const observedRequests = [];
const agentChatBodies = [];
const cdpRequests = [];
const streamRequests = [];
const timeline = [];
// G1: withhold the static-era request bridge so the attribution runtime's own
// transport wrappers are the only source of network.request rows.
const withholdBridge = process.env.PRODUCTTRACE_NO_BRIDGE === '1';
// Large sessions: write one row per line instead of pretty-printed arrays.
const jsonlEvidence = process.env.PRODUCTTRACE_EVIDENCE_FORMAT === 'jsonl';
const stampPages = new Map();
const request = (target, options = {}) => new Promise((resolve, reject) => {
  const url = new URL(target);
  const req = http.request(url, { ...options, method: options.method || 'GET', headers: options.headers || {} }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  });
  req.on('error', reject); if (options.body) req.write(options.body); req.end();
});
const proxy = (req, res, target) => {
  const url = new URL(target);
  const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream);
};
const staticRoot = path.join(worktree, 'client/dist');
const server = http.createServer((req, res) => {
  if (req.url === '/__capture' && req.method === 'POST') {
    let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const pageId = payload.page_id || 'default';
        const batch = Array.isArray(payload.rows) ? payload.rows : [payload.row || payload];
        const state = capturePages.get(pageId) || { expected: null, received: 0, dropped: 0, gaps: [] };
        for (const row of batch) {
          // element.stamp rows carry their own contiguous stamp_sequence and
          // never consume the attribution sequence (G3 D12 neutrality).
          if (row?.kind === 'element.stamp' && Number.isFinite(Number(row.stamp_sequence))) {
            const stampState = stampPages.get(pageId) || { expected: null, received: 0, gaps: [] };
            const stampSequence = Number(row.stamp_sequence);
            if (stampState.expected == null) stampState.expected = stampSequence;
            if (stampSequence > stampState.expected) stampState.gaps.push({ start: stampState.expected, end: stampSequence - 1 });
            stampState.expected = Math.max(stampState.expected, stampSequence + 1); stampState.received += 1;
            stampPages.set(pageId, stampState);
            rows.push(row.capture_page_id ? row : { ...row, capture_page_id: pageId }); continue;
          }
          const sequence = Number(row?.sequence);
          if (!Number.isFinite(sequence)) continue;
          if (state.expected == null) state.expected = sequence;
          if (sequence > state.expected) {
            state.gaps.push({ start: state.expected, end: sequence - 1 });
            captureStats.gaps.push({ page_id: pageId, start: state.expected, end: sequence - 1 });
          }
          state.expected = Math.max(state.expected || sequence, sequence + 1);
          state.received += 1; captureStats.received += 1;
          if (row.kind === 'capture.dropped') {
            const count = Math.max(0, Number(row.dropped_end) - Number(row.dropped_start) + 1) || 0;
            state.dropped += count; captureStats.dropped += count;
          }
          rows.push(row.capture_page_id ? row : { ...row, capture_page_id: pageId });
        }
        captureStats.batches += 1; capturePages.set(pageId, state);
        res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end('invalid capture payload'); }
    }); return;
  }
  if (req.url?.startsWith('/api/demo/')) { proxy(req, res, `${bridgeOrigin}${req.url}`); return; }
  if (req.url?.startsWith('/api/')) { proxy(req, res, `${backendOrigin}${req.url}`); return; }
  const pathname = decodeURIComponent(new URL(req.url, 'http://static').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  if (withholdBridge && relative === 'producttrace-request-bridge.js') { res.writeHead(404); res.end('request bridge withheld (frontend-only run)'); return; }
  const file = path.resolve(staticRoot, relative);
  if (!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');
let browser;
const screenshot = async (page, name) => page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
const note = (step, control, result, extra = {}) => { const entry = { step, at: new Date().toISOString(), control, result, ...extra }; timeline.push(entry); return entry; };
const waitForReply = async page => { await page.waitForTimeout(2500); await page.locator('body').waitFor({ state: 'visible' }); };
const clickText = async (page, text, options = {}) => page.getByText(text, { exact: true, ...options }).click();
// A persisted conversation has a server id in the URL (`/c/<id>`, not `/c/new`).
const waitForConversationId = async (page, timeout = 30000) => {
  try { await page.waitForURL(url => /^\/c\/(?!new(?:$|\/))[^/]+/u.test(new URL(url).pathname), { timeout }); return true; } catch { return false; }
};
// Harness-created agents get a unique name so the Agent Builder selection is unambiguous.
const agentLabel = `Barista ${Date.now()}`;
const requestKey = (method, url) => {
  try { return `${String(method || 'GET').toUpperCase()} ${new URL(url, origin).pathname}`; }
  catch { return `${String(method || 'GET').toUpperCase()} ${String(url || '').split('?')[0]}`; }
};
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
  // Disable the app service worker so every application transport remains on
  // the page's fetch/XHR/EventSource wrappers and can be counted against CDP.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', event => {
    const type = event.type?.toLowerCase(); const url = event.request?.url || '';
    if (!['fetch', 'xhr', 'eventsource', 'websocket'].includes(type)) return;
    if (/(?:\/api\/demo\/|\/react-observations|\/__capture(?:$|\?))/u.test(url)) return;
    cdpRequests.push({ request_id: event.requestId, method: event.request?.method, url: url.split('?')[0],
      type, initiator: event.initiator || null });
  });
  await page.addInitScript(() => {
    const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const queue = []; let flushing = false; let droppedGuard = false; let emitted = 0; let sent = 0; let dropped = 0; let inflight = 0;
    const nativeFetch = globalThis.fetch?.bind(globalThis);
    // Large batches without keepalive (keepalive bodies share a 64 KB
    // in-flight quota); keepalive is used only by the pagehide beacon.
    const maxBytes = 1024 * 1024; const maxRows = 4096;
    const encode = batch => JSON.stringify({ page_id: pageId, rows: batch });
    const emitDropped = (batch, reason) => {
      if (droppedGuard || !batch.length) return;
      droppedGuard = true;
      const start = Number(batch[0]?.sequence); const end = Number(batch[batch.length - 1]?.sequence);
      dropped += Math.max(0, end - start + 1);
      try { globalThis.__productTraceRuntime?.emit({ kind: 'capture.dropped', dropped_start: start, dropped_end: end, reason }); } catch {}
      droppedGuard = false;
    };
    const send = async batch => {
      const body = encode(batch);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          inflight += 1;
          let response = null;
          try { response = await nativeFetch('/__capture', { method: 'POST', body, headers: { 'content-type': 'application/json' } }); } finally { inflight -= 1; }
          if (response.ok) { sent += batch.length; return true; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt)));
      }
      emitDropped(batch, 'capture_chunk_failed'); return false;
    };
    const flush = async () => {
      if (flushing) return; flushing = true;
      try {
        while (queue.length) {
          const batch = []; let bytes = 0;
          while (queue.length && batch.length < maxRows) {
            const candidate = queue[0]; const size = JSON.stringify(candidate).length;
            if (batch.length && bytes + size > maxBytes) break;
            batch.push(queue.shift()); bytes += size;
          }
          await send(batch);
        }
      } finally { flushing = false; }
    };
    globalThis.__producttraceHostCapture = text => {
      try { const payload = JSON.parse(text); const row = payload.row || payload; queue.push(row); emitted += 1; void flush(); } catch {}
    };
    globalThis.__m1CaptureStats = () => ({ page_id: pageId, emitted, sent, dropped, queued: queue.length, inflight, flushing });
    globalThis.addEventListener('pagehide', () => {
      const tail = queue.splice(0, maxRows);
      if (!tail.length) return;
      const body = encode(tail);
      let ok = false; try { ok = navigator.sendBeacon('/__capture', body); } catch {}
      if (!ok) emitDropped(tail, 'pagehide_beacon_rejected');
    });
    globalThis.addEventListener('error', event => { globalThis.__m1Errors = globalThis.__m1Errors || []; globalThis.__m1Errors.push({ message: event.message, filename: event.filename, line: event.lineno, column: event.colno }); });
  });
  page.on('pageerror', error => timeline.push({ step: 'pageerror', at: new Date().toISOString(), error: String(error.stack || error.message) }));
  page.on('requestfailed', failed => timeline.push({ step: 'requestfailed', at: new Date().toISOString(), url: failed.url(), error: failed.failure()?.errorText || 'unknown' }));
  page.on('request', request => {
    const type = request.resourceType(); const url = request.url();
    if (!new Set(['fetch', 'xhr', 'eventsource', 'websocket']).has(type)) return;
    if (/(?:\/api\/demo\/|\/react-observations|\/__capture(?:$|\?))/u.test(url)) return;
    observedRequests.push({ method: request.method(), url: url.split('?')[0], resource_type: type });
    if (/\/api\/agents\/chat\/openAI$/u.test(url)) {
      try { const body = request.postDataJSON(); agentChatBodies.push({ keys: Object.keys(body || {}).sort(), agent_id: body?.agent_id || body?.agentId || null, endpoint: body?.endpoint || null, model: body?.model || null }); } catch { agentChatBodies.push({ keys: [], parse_error: true }); }
    }
    if (/\/api\/agents\/chat\/stream\//u.test(url)) streamRequests.push({ method: request.method(), url: url.split('?')[0], at: Date.now() });
  });
  page.on('console', message => timeline.push({ step: 'console', at: new Date().toISOString(), type: message.type(), text: message.text().slice(0, 300) }));
  page.on('response', response => {
    if (/\/api\/(?:endpoints|config|models)(?:\/|$)/u.test(response.url())) {
      const pathname = new URL(response.url()).pathname;
      timeline.push({ step: 'api-response', at: new Date().toISOString(), url: pathname,
        status: response.status(), resource_type: response.request().resourceType() });
      response.json().then(body => {
        const shape = { step: 'api-shape', at: new Date().toISOString(), url: pathname, status: response.status() };
        if (pathname === '/api/endpoints') {
          shape.endpoint_keys = Object.keys(body || {}).sort();
          shape.agents = body?.agents ? { allowedProviders: body.agents.allowedProviders ?? null, capabilities: body.agents.capabilities ?? null, disableBuilder: body.agents.disableBuilder ?? null, userProvide: body.agents.userProvide ?? null } : null;
        } else if (pathname === '/api/models') {
          shape.model_counts = Object.fromEntries(Object.entries(body || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : typeof value]));
          shape.model_samples = Object.fromEntries(Object.entries(body || {}).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 3) : null]));
        }
        else if (pathname === '/api/config') shape.config_keys = Object.keys(body || {}).sort();
        else if (pathname === '/api/endpoints/token-config') shape.token_config = Object.keys(body || {}).sort();
        timeline.push(shape);
      }).catch(() => {});
    }
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const email = page.locator('input[type="email"], input').first();
  if (await email.count()) {
    await email.click(); await email.pressSequentially('tracer-m1@example.test');
    const password = page.locator('input[type="password"]').first(); await password.click(); await password.pressSequentially('Tracer-M1-2026!');
    await page.getByRole('button', { name: /continue|log in|login/i }).click(); await page.waitForTimeout(1200);
  }
  note(1, 'focused email/password inputs; clicked Continue', 'login attempted'); await screenshot(page, 'step-01');
  if (!/\/c\//u.test(page.url())) { fs.writeFileSync(path.join(evidenceDir, 'timeline.json'), JSON.stringify([...timeline, { step: 'window-errors', errors: await page.evaluate(() => window.__m1Errors || []) }], null, 2)); throw new Error(`login did not reach chat route: ${page.url()} title=${await page.title()} body=${(await page.locator('body').innerText()).slice(0, 300)}`); }

  await page.getByRole('button', { name: /New chat/i }).first().click();
  const input = page.locator('textarea[data-testid="text-input"]').first(); await input.click(); await input.pressSequentially('Give me three names for a coffee shop in one line.'); await page.locator('button[data-testid="send-button"]').click(); await waitForReply(page);
  note(2, 'clicked New chat; entered coffee prompt; clicked send-button', 'reply waited'); await screenshot(page, 'step-02');
  await page.locator('[data-testid="copy-response-button"]').last().click(); note(3, 'clicked copy-response-button', 'copy clicked'); await screenshot(page, 'step-03');
  const feedbackConversation = await waitForConversationId(page);
  // The optimistic response message carries a placeholder id (`<uuid>_`) until
  // the server's final message replaces it; feedback must target the final one.
  let placeholderGone = true;
  try { await page.waitForFunction(() => ![...document.querySelectorAll('[id]')].some(node => /^[0-9a-f-]{36}_$/u.test(node.id)), null, { timeout: 5000 }); } catch { placeholderGone = false; }
  timeline.push({ step: 'feedback-precondition', at: new Date().toISOString(), conversation_id_in_url: feedbackConversation, placeholder_message_gone: placeholderGone, url: new URL(page.url()).pathname });
  await page.locator('button[title="Needs improvement"]').last().click(); await page.getByText(/Didn't match my request|Not helpful|Other/i).first().click(); note(4, 'clicked Needs improvement; selected a reason', 'feedback submitted'); await screenshot(page, 'step-04');
  await page.locator('[data-testid="regenerate-generation-button"]').last().click(); await waitForReply(page); note(5, 'clicked regenerate-generation-button', 'regeneration waited'); await screenshot(page, 'step-05');
  try {
    const userMessage = page.getByText('Give me three names for a coffee shop in one line.', { exact: true }).first();
    if (await userMessage.count()) await userMessage.hover();
    const editButtons = page.locator('button[title="Edit"], button[aria-label*="Edit" i]');
    const editIndex = await editButtons.evaluateAll(buttons => buttons.findIndex(button => {
      let node = button;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if ((node.innerText || '').includes('Give me three names for a coffee shop')) return true;
      }
      return false;
    }));
    if (editIndex < 0) throw new Error(`message edit button not found among ${await editButtons.count()} buttons`);
    await editButtons.nth(editIndex).click();
    const editCandidates = page.locator('[data-testid="message-text-editor"]:visible, textarea[aria-label*="edit" i], textarea[data-testid*="edit" i], textarea[placeholder*="edit" i]');
    const edit = editCandidates.last();
    if (!(await edit.count())) throw new Error('edit textarea not found');
    const editTarget = { tag: await edit.evaluate(node => node.tagName), aria_label: await edit.getAttribute('aria-label'), testid: await edit.getAttribute('data-testid'), placeholder: await edit.getAttribute('placeholder') };
    await edit.click(); await edit.press('ControlOrMeta+A'); await edit.fill('Give me three names for a tea shop in one line.'); await clickText(page, 'Save & Submit'); await waitForReply(page); note(6, `clicked Edit; typed into edit textarea ${JSON.stringify(editTarget)}; clicked Save & Submit`, 'edited reply waited', { edit_target: editTarget, expected_text: 'Give me three names for a tea shop in one line.' });
  } catch (error) { note(6, 'Edit and Save & Submit interaction', 'STOP: edit interaction failed', { error: String(error.message || error) }); }
  await screenshot(page, 'step-06');
  await page.waitForTimeout(1200);
  try {
    const menu = page.locator('button[aria-label="Conversation Menu Options"]:visible').last();
    if (await menu.count()) {
      await menu.click({ force: true }); await page.getByText('Rename', { exact: true }).last().click({ force: true }); const title = page.locator('input:visible').last(); await title.click({ force: true }); await title.press('ControlOrMeta+A'); await title.pressSequentially('Tracer M1'); await page.getByRole('button', { name: /^Save$/i }).last().click({ force: true }); await page.waitForTimeout(500); note(7, 'opened Conversation Menu Options; clicked Rename; clicked Save', 'renamed Tracer M1');
    } else note(7, 'Conversation Menu Options unavailable', 'STOP: rename control unavailable');
  } catch (error) { note(7, 'Conversation Menu Options interaction', 'STOP: rename interaction failed', { error: String(error.message || error) }); }
  await screenshot(page, 'step-07');
  try {
    const beforeStreams = streamRequests.length;
    const overlapRegenerate = page.locator('[data-testid="regenerate-generation-button"]:visible').last(); if (await overlapRegenerate.count()) await overlapRegenerate.click({ force: true });
    const streamDeadline = Date.now() + 5000; while (streamRequests.length <= beforeStreams && Date.now() < streamDeadline) await page.waitForTimeout(50);
    const streamOpen = streamRequests.length > beforeStreams;
    // Conversation menus are disabled while generation is active. Use an
    // allowed settings/pin action and keep the overlap as its own step.
    const overlapControl = page.locator('button[aria-label*="Pin" i]:visible, button[title*="Pin" i]:visible, [data-testid*="pin" i]:visible').last();
    const bookmarksNav = page.getByRole('button', { name: /bookmark/i }).first();
    if (await overlapControl.count()) { await overlapControl.click({ force: true }); note('overlap', 'started regenerate; confirmed stream request open; clicked pin/unpin on another conversation', streamOpen ? 'concurrent pin action completed' : 'STOP: stream did not open', { stream_open: streamOpen, stream_url: streamRequests.at(-1)?.url || null }); await screenshot(page, 'overlap'); }
    else if (await bookmarksNav.count()) { await bookmarksNav.click({ force: true }); note('overlap', 'started regenerate; confirmed stream request open; opened bookmarks surface concurrently', streamOpen ? 'concurrent bookmark surface opened' : 'STOP: stream did not open', { stream_open: streamOpen, stream_url: streamRequests.at(-1)?.url || null }); await screenshot(page, 'overlap'); }
    else { note('overlap', 'started regenerate; no allowed pin/bookmark control visible during stream', streamOpen ? 'STOP: allowed concurrent action unavailable' : 'STOP: stream did not open', { stream_open: streamOpen, stream_url: streamRequests.at(-1)?.url || null }); await screenshot(page, 'overlap-stop'); }
  } catch (error) { note('overlap', 'regenerate + rename cancellation', 'STOP: overlap interaction failed', { error: String(error.message || error) }); }
  let providerOptions = 0;
  let providerName = null;
  let selectedModel = null;
  try {
    await page.locator('[data-testid="nav-panel-agents"]').click(); await page.waitForTimeout(700); const agentName = page.getByLabel(/Agent name/i).first(); const instructions = page.getByLabel(/Instructions/i).first(); await agentName.fill(agentLabel); await instructions.fill('You only talk about coffee.');
    // ModelPanel is a two-stage control: open Select a model, then choose a
    // provider, then choose a model from that provider's query.
    const openModelPanel = page.getByText('Select a model', { exact: true }).last();
    if (await openModelPanel.count()) await openModelPanel.click({ force: true });
    await page.waitForTimeout(300);
    const providerControl = page.getByText('Select a provider', { exact: true }).first();
    if (await providerControl.count()) await providerControl.click(); else await page.getByRole('combobox').filter({ hasText: /Select a provider/i }).first().click();
    await page.waitForTimeout(300);
    providerOptions = await page.getByRole('option').count();
    const providerOption = page.getByRole('option', { name: /^openAI$/i }).first();
    if (await providerOption.count()) { providerName = await providerOption.innerText(); await providerOption.click(); }
    await page.waitForTimeout(700);
    const modelControl = page.getByText('Select a model', { exact: true }).last();
    if (await modelControl.count()) await modelControl.click();
    await page.waitForTimeout(300);
    const modelOption = page.getByRole('option', { name: /^gpt-3\.5-turbo(?:$|[- ])?/i }).first();
    if (await modelOption.count()) { selectedModel = await modelOption.innerText(); await modelOption.click(); }
    if (!selectedModel) {
      const selectedModelLabel = page.getByText(/^gpt-3\.5-turbo$/i).last();
      if (await selectedModelLabel.count()) selectedModel = await selectedModelLabel.innerText();
    }
  } catch (error) { note(8, 'Agent Builder navigation or form interaction', 'STOP: Agent Builder interaction failed', { error: String(error.message || error) }); }
  if (!providerOptions || !providerName || !selectedModel) { note(8, 'opened Agent Builder; selected provider/model', 'STOP: provider or model selection unavailable', { provider_options: providerOptions, provider: providerName, model: selectedModel }); await screenshot(page, 'step-08-stop'); }
  else { await clickText(page, 'Create'); await page.waitForTimeout(900); note(8, `selected openAI/gpt-3.5-turbo; created ${agentLabel} agent with coffee-only instructions`, 'create clicked', { provider_options: providerOptions, provider: providerName, model: selectedModel }); await screenshot(page, 'step-08'); }
  const agentCreated = providerOptions > 0 && providerName && selectedModel && await page.getByText(agentLabel, { exact: true }).count();
  if (agentCreated) {
    try {
      // The builder keeps the newly-created agent in its top selector. Commit
      // that selection with the real Select control before leaving the panel;
      // a text match in the chat sidebar is not an agent selection.
      const selectAgent = page.getByRole('button', { name: /Select Agent/i }).last();
      if (await selectAgent.count()) await selectAgent.click({ force: true });
      await page.waitForTimeout(400);
      const newChat = page.locator('[data-testid="new-chat-button"]');
      if (await newChat.count()) await newChat.first().click({ force: true }); else await page.getByText('New chat', { exact: true }).first().click({ force: true });
      await page.waitForTimeout(500);
      const agentInput = page.locator('textarea[data-testid="text-input"]').first(); await agentInput.click({ force: true }); await agentInput.pressSequentially('What is a flat white?'); await page.locator('button[data-testid="send-button"]').click({ force: true }); await waitForReply(page); note(9, 'opened New chat after committing Barista in the Agent Builder Select control; entered flat-white question; clicked send-button', 'reply waited', { selected_agent: agentLabel, selection_commit: 'Agent Builder Select', agent_chat_bodies: agentChatBodies.slice(-2) }); await screenshot(page, 'step-09');
      const deleteConversation = await waitForConversationId(page);
      const activeConversation = page.locator('[data-testid="convo-item"][aria-current="page"], a[aria-current="page"]').first();
      if (await activeConversation.count()) { try { await activeConversation.hover({ timeout: 2000 }); } catch {} }
      const secondMenu = page.locator('button[aria-label="Conversation Menu Options"]:visible').last();
      await secondMenu.waitFor({ state: 'visible', timeout: 15000 });
      timeline.push({ step: 'delete-precondition', at: new Date().toISOString(), conversation_id_in_url: deleteConversation, url: new URL(page.url()).pathname });
      await secondMenu.click({ force: true }); await page.getByText('Delete', { exact: true }).last().click({ force: true }); await page.waitForTimeout(300); const confirm = page.getByRole('button', { name: /Delete|Confirm/i }).last(); if (await confirm.count()) await confirm.click({ force: true }); note(10, 'opened second conversation menu; clicked Delete and confirmation', 'delete clicked'); await screenshot(page, 'step-10');
    } catch (error) { note(9, 'Barista agent chat', 'STOP: agent chat interaction failed', { error: String(error.message || error) }); await screenshot(page, 'step-09-stop'); note(10, 'delete Barista conversation', 'STOP: step 9 did not complete'); await screenshot(page, 'step-10-stop'); }
  } else {
    note(9, 'attempted Barista chat', 'STOP: step 8 did not create agent');
    // The overlap run is independent of Agent Builder: replay regeneration on
    // the first conversation while opening a second surface and cancelling a
    // rename with Escape.
    const firstConversation = page.getByText('Tracer M1', { exact: true }).first();
    if (await firstConversation.count()) {
      await firstConversation.click(); await page.waitForTimeout(300);
      const regenerate = page.locator('[data-testid="regenerate-generation-button"]:visible').last(); if (await regenerate.count()) await regenerate.click({ force: true });
      const newChat = page.getByRole('button', { name: /New chat/i }).first(); if (await newChat.count()) await newChat.click({ force: true });
      const overlapMenu = page.locator('button[aria-label="Conversation Menu Options"]:visible').last(); if (await overlapMenu.count()) { await overlapMenu.click({ force: true }); await page.getByText('Rename', { exact: true }).last().click({ force: true }); await page.keyboard.press('Escape'); }
      note('overlap', 'started regenerate; opened another conversation; opened Rename; pressed Escape', 'cancelled rename during overlap'); await screenshot(page, 'overlap');
    } else note('overlap', 'Tracer M1 conversation unavailable', 'STOP: no conversation surface');
  }
  // Cycle 12: enumerate real surfaces in this same authenticated page before
  // closing it. Each entry requires a DOM signature and records fiber counts;
  // route-only labels are retained as not_reached rather than treated as a hit.
  const c12Surfaces = [];
  const c12Enumerate = async (label, signature) => {
    const row = await page.evaluate(({ label: surface, signature: expected }) => {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__, runtime = globalThis.__productTraceRuntime;
      const roots = []; if (hook?.renderers && hook?.getFiberRoots) for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id) || []) roots.push(root.current || root);
      const seen = new Set(); let hostEventProps = 0, direct = 0, ancestor = 0, any = 0, unregistered = 0, stamped = 0;
      const category = event => /^on(?:Click|DoubleClick|Mouse|Pointer)/u.test(event) ? 'pointer' : /^onKey/u.test(event) ? 'keyboard' : /^on(?:Submit|Change|Input)/u.test(event) ? 'form' : 'other';
      const source = fiber => { let cursor = fiber; while (cursor) { if (cursor._debugSource?.fileName) return cursor._debugSource.fileName; cursor = cursor.return; } return null; };
      const visit = fiber => { if (!fiber || seen.has(fiber)) return; seen.add(fiber); if (fiber.tag === 5 && fiber.stateNode instanceof Element) { const props = fiber.memoizedProps || {}; const keys = Object.keys(props).filter(key => /^on[A-Z]/u.test(key) && typeof props[key] === 'function'); hostEventProps += keys.length; if ([...fiber.stateNode.attributes].some(attr => attr.name.startsWith('data-producttrace-control-'))) stamped += 1; for (const event of keys) { let id = runtime?.functionIdOf?.(props[event]); if (id) direct += 1; else { let cursor = fiber.return; while (cursor) { const same = runtime?.functionIdOf?.(cursor.memoizedProps?.[event]); if (same) { id = same; ancestor += 1; break; } cursor = cursor.return; } } if (!id) { let cursor = fiber.return; while (cursor) { const match = Object.keys(cursor.memoizedProps || {}).find(key => /^on[A-Z]/u.test(key) && category(key) === category(event) && category(event) !== 'other' && runtime?.functionIdOf?.(cursor.memoizedProps[key])); if (match) { id = runtime.functionIdOf(cursor.memoizedProps[match]); any += 1; break; } cursor = cursor.return; } } if (!id) unregistered += 1; } } visit(fiber.child); visit(fiber.sibling); };
      for (const root of roots) visit(root); return { surface, signature: expected, signature_found: Boolean(expected && document.querySelector(expected)), roots: roots.length, host_event_props: hostEventProps, direct, via_ancestor: ancestor, via_ancestor_any: any, unregistered, stamped, url: location.pathname };
    }, { label, signature });
    c12Surfaces.push(row); await page.screenshot({ path: path.join(evidenceDir, `surface-${String(c12Surfaces.length).padStart(2, '0')}.png`), fullPage: true }); return row;
  };
  await c12Enumerate('/c/new', 'textarea[data-testid="text-input"]');
  const messageNodes = page.locator('[data-testid*="message"], .message'); for (let i = 0, count = Math.min(await messageNodes.count(), 20); i < count; i += 1) { try { await messageNodes.nth(i).hover({ timeout: 500 }); } catch {} }
  await c12Enumerate('existing-conversation-with-messages', '[data-testid*="message"], .message');
  try { await page.locator('button[aria-label="Conversation Menu Options"]:visible').last().click({ force: true }); } catch {}
  await c12Enumerate('sidebar-conversation-menu', '[role="menu"], [data-radix-menu-content]');
  try { await page.keyboard.press('Escape'); } catch {}
  for (const target of [
    ['agent-builder', 'button'], ['agent-model-panel', '[role="combobox"], button'],
    ['prompts', '[data-testid*="prompt"], button'], ['bookmarks', '[data-testid*="bookmark"], button'],
    ['settings-dialog', '[role="dialog"]'], ['search', 'input[placeholder*="Search" i]'],
    ['file-attach', 'button[aria-label*="attach" i], input[type="file"]'],
  ]) {
    try { const control = page.locator(target[1]).first(); if (await control.count()) await control.click({ force: true, timeout: 1000 }); } catch {}
    await page.waitForTimeout(250); await c12Enumerate(target[0], target[1]); try { await page.keyboard.press('Escape'); } catch {}
  }
  fs.writeFileSync(path.join(evidenceDir, 'c12-surfaces.json'), JSON.stringify(c12Surfaces, null, 2));
  await page.waitForTimeout(1000);
  // Drain the capture before the snapshot: wait until the page queue is empty
  // and no batch is in flight, reading the last emitted sequence numbers in
  // the same evaluation. At that instant every row up to those sequences has
  // been acknowledged by this server. Rows the app emits afterwards (polling)
  // are kept but counted separately. If the queue cannot be drained within a
  // hard cap the run fails explicitly.
  const drainCapMs = Number(process.env.PRODUCTTRACE_DRAIN_CAP_MS || 600000);
  const drainStarted = Date.now();
  let drain = null;
  for (;;) {
    const state = await page.evaluate(() => {
      const stats = globalThis.__m1CaptureStats?.() || {};
      const records = globalThis.__productTraceRuntime?.records || [];
      let lastSequence = 0, lastStampSequence = 0;
      for (let index = records.length - 1; index >= 0 && (!lastSequence || !lastStampSequence); index -= 1) {
        const row = records[index];
        if (!lastSequence && Number.isInteger(row?.sequence)) lastSequence = row.sequence;
        if (!lastStampSequence && Number.isInteger(row?.stamp_sequence)) lastStampSequence = row.stamp_sequence;
      }
      return { ...stats, last_sequence: lastSequence, last_stamp_sequence: lastStampSequence };
    });
    if (state.queued === 0 && state.inflight === 0 && !state.flushing) { drain = { ok: true, waited_ms: Date.now() - drainStarted, ...state }; break; }
    if (Date.now() - drainStarted > drainCapMs) {
      drain = { ok: false, waited_ms: Date.now() - drainStarted, cap_ms: drainCapMs, ...state };
      console.error(`capture did not drain within ${drainCapMs} ms: ${state.queued} rows queued, ${state.inflight} batches in flight`);
      break;
    }
    await page.waitForTimeout(250);
  }
  // Counted from the server's rows at the drain instant, before any page
  // buffer merge below can fill a gap.
  drain.rows_at_drain = rows.length;
  drain.received_through_drain = new Set(rows.filter(row => row.kind !== 'element.stamp' && Number.isInteger(row.sequence) && row.sequence <= drain.last_sequence).map(row => row.sequence)).size;
  drain.stamps_through_drain = new Set(rows.filter(row => row.kind === 'element.stamp' && Number.isInteger(row.stamp_sequence) && row.stamp_sequence <= drain.last_stamp_sequence).map(row => row.stamp_sequence)).size;
  timeline.push({ step: 'capture-drain', at: new Date().toISOString(), ...drain });
  fs.writeFileSync(path.join(evidenceDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  const pageRuntimeRows = await page.evaluate(() => (globalThis.__productTraceRuntime?.records || []).filter(row => row.kind === 'network.request'));
  const pageCapture = await page.evaluate(() => ({
    runtime_records_count: (globalThis.__productTraceRuntime?.records || []).length,
    runtime_original_count: (globalThis.__productTraceRuntime?.records || []).filter(row => row.kind !== 'capture.dropped').length,
    capture: globalThis.__m1CaptureStats?.() || null,
  }));
  const beforeRuntimeMerge = rows.length;
  const existingSequences = new Set(rows.map(row => row.sequence));
  for (const row of pageRuntimeRows) if (!existingSequences.has(row.sequence)) { rows.push(row); existingSequences.add(row.sequence); }
  const scriptedNotes = timeline.filter(entry => Number.isInteger(entry.step));
  for (let index = 0; index < scriptedNotes.length; index += 1) {
    const noteTime = Date.parse(scriptedNotes[index].at); const previousTime = index ? Date.parse(scriptedNotes[index - 1].at) : 0;
    scriptedNotes[index].action_ids = rows.filter(row => row.kind === 'dom.action' && row.timestamp > previousTime && row.timestamp <= noteTime).map(row => row.action_id);
  }
  timeline.push({ step: 'runtime-buffer', at: new Date().toISOString(), records: pageRuntimeRows.length,
    added: rows.length - beforeRuntimeMerge });
  const bridge = await (await fetch(`${bridgeOrigin}/api/demo/bridge/latest`)).json();
  const spans = await (await fetch(`${bridgeOrigin}/api/demo/backend-spans/latest`)).json();
  // Reconcile Playwright observations against runtime rows without creating
  // evidence. The audit must be empty; CDP initiators explain any miss.
  const observedQueue = new Map();
  for (const observation of observedRequests) {
    const key = requestKey(observation.method, observation.url);
    const queue = observedQueue.get(key) || []; queue.push(observation); observedQueue.set(key, queue);
  }
  const runtimeQueue = new Map();
  for (const row of rows.filter(row => row.kind === 'network.request' && !row.internal
    && !/(?:\/api\/demo\/|\/react-observations|\/__capture(?:$|\?))/u.test(String(row.url || '')))) {
    const key = requestKey(row.method, row.url);
    const queue = runtimeQueue.get(key) || []; queue.push(row); runtimeQueue.set(key, queue);
  }
  const reconciliation = [];
  for (const [key, observed] of observedQueue) {
    const runtime = runtimeQueue.get(key) || [];
    while (runtime.length && observed.length) { runtime.shift(); observed.shift(); }
    while (observed.length) {
      reconciliation.push(observed.shift());
    }
  }
  const joinedRows = attachBackendSpans(rows, spans);
  fs.writeFileSync(path.join(evidenceDir, 'runtime-state.json'), JSON.stringify(await page.evaluate(() => ({
    fetch: String(window.fetch).slice(0, 180), xhrOpen: String(XMLHttpRequest.prototype.open).slice(0, 180),
    runtime_records: window.__productTraceRuntime?.records?.length || 0,
  })), null, 2));
  const tracerRequests = rows.filter(row => row.kind === 'network.request' && !row.internal
    && !/(?:\/api\/demo\/|\/react-observations|\/__capture(?:$|\?))/u.test(String(row.url || '')));
  const requestCoverage = { observed: observedRequests.length, tracer: tracerRequests.length,
    equal: observedRequests.length === tracerRequests.length && reconciliation.length === 0,
    reconciliation_count: reconciliation.length, reconciliation, observed_requests: observedRequests,
    cdp_initiators: cdpRequests.filter(item => reconciliation.some(miss => requestKey(miss.method, miss.url) === requestKey(item.method, item.url))) };
  timeline.push({ step: 'request-coverage', at: new Date().toISOString(), ...requestCoverage });
  const linkageCounts = Object.fromEntries(Object.entries(Object.groupBy(tracerRequests, row => row.linkage_kind || 'unattributed')).map(([key, value]) => [key, value.length]));
  const apiShapes = timeline.filter(entry => entry.step === 'api-shape');
  for (const [pageId, state] of capturePages) captureStats.pages[pageId] = state;
  const captureOriginalRows = pageCapture.runtime_original_count;
  const captureReceivedOriginal = rows.filter(row => row.kind !== 'capture.dropped').length;
  const captureCoverage = {
    emitted: captureOriginalRows,
    received: captureReceivedOriginal,
    dropped: captureStats.dropped,
    gaps: captureStats.gaps,
    capture_rows_received: captureStats.received,
    capture_dropped_rows: rows.filter(row => row.kind === 'capture.dropped').length,
    queued_at_snapshot: pageCapture.capture?.queued || 0,
    pages: captureStats.pages,
    // Drain-instant accounting: every attribution row with sequence <= the
    // last emitted sequence at the drain instant, and every stamp row up to
    // the last stamp sequence, must be present (lossless through the drain).
    drain,
  };
  drain.rows_after_drain = rows.filter(row => (row.kind === 'element.stamp' ? row.stamp_sequence > drain.last_stamp_sequence : row.sequence > drain.last_sequence)).length;
  drain.lossless = Boolean(drain.ok) && drain.received_through_drain === drain.last_sequence && drain.stamps_through_drain === drain.last_stamp_sequence;
  fs.writeFileSync(path.join(evidenceDir, 'coverage.json'), JSON.stringify({ schema: 'producttrace.m1-cycle5-coverage.v1', headless: true,
    request_coverage: requestCoverage, linkage_counts: linkageCounts,
    capture: captureCoverage,
    stamp_capture: Object.fromEntries(stampPages), request_bridge_withheld: withholdBridge,
    api_shapes: apiShapes.map(({ step, at, ...shape }) => shape), timeline_steps: timeline.filter(entry => Number.isInteger(entry.step)),
  }, null, 2));
  if (jsonlEvidence) {
    const writeJsonl = (name, values) => { const fd = fs.openSync(path.join(evidenceDir, name), 'w'); try { for (const value of values) fs.writeSync(fd, `${JSON.stringify(value)}\n`); } finally { fs.closeSync(fd); } };
    writeJsonl('records.jsonl', rows);
    writeJsonl('spans.jsonl', spans);
    writeJsonl('timeline.jsonl', timeline);
  } else {
    fs.writeFileSync(path.join(evidenceDir, 'bridge.json'), JSON.stringify(bridge, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'spans.json'), JSON.stringify(spans, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'joined.json'), JSON.stringify(joinedRows, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'records.json'), JSON.stringify(rows, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  }
  console.log(JSON.stringify({ origin, headless: true, timeline, rows: rows.length, bridge: bridge.length, spans: spans.length, request_coverage: requestCoverage, capture: captureCoverage, joined_rows: joinedRows.length }));
  if (!requestCoverage.equal || captureCoverage.gaps.length || !captureCoverage.drain?.lossless || captureCoverage.dropped) process.exitCode = 1;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
