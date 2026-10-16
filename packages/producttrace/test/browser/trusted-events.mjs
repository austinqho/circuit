// D-G1-21 "every trusted user event on the page is recorded as an action row
// with its full description, and the runtime can prove which event kinds it
// observes" (headless, neutral fixture test/browser/fixtures/trusted-events-app).
// The page ships rows through the real collector sink into a real store; the
// MCP server is then driven over stdio as a black box. Every expectation is
// computed here from the raw records.jsonl rows; nothing from the package
// computes an expectation. Every check is null-safe, so the driver runs
// against an older runtime as its own negative control.
//
// Sessions per invocation:
//   - RUNS page loads of the main script (Radix Select/Dialog, a pointer-
//     captured drag, a hidden file input, Ctrl+Shift+K, Alt/AltGr keys, scroll,
//     clipboard, <details>, native <select>, typing, an untrusted
//     dispatchEvent, a synthetic click then Tab, Shift+click, hover work,
//     HTML drag and drop, popstate, hashchange, invalid, onBeforeInput,
//     el.focus() and requestSubmit() inside clicks);
//   - one touch page (hasTouch) with a tap;
//   - one hover-heavy page (?grid=1, 240 cells, 10-row sweep);
//   - inputText: true, development and production builds (one load each).
//
//   node test/browser/trusted-events.mjs [dependencyRoot]
//   TRACER_TRUSTED_RUNS=3 (page loads, default 3), TRACER_KEEP_STORE=1
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/trusted-events-app');
const appSource = fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-trusted-events-store-'));
const keep = process.env.TRACER_KEEP_STORE === '1';
const RUNS = Number(process.env.TRACER_TRUSTED_RUNS || 3);
const uploadFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-trusted-upload-')), 'notes.txt');
fs.writeFileSync(uploadFile, 'hello from the fixture\n');

async function serveStatic(root) {
  const staticServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/')) { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); return; }
    const file = path.resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${staticServer.address().port}`, close: () => new Promise(resolve => staticServer.close(resolve)) };
}
const readRows = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);

const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'trusted-events' } });
await collector.ready;
const fixture = await buildReactFixture({ dependencyRoot, name: 'trusted-events', appSource, pluginOptions: { collector: { url: collector.url, force: true } } });
const server = await serveStatic(fixture.distRoot);
const bareFixture = await buildReactFixture({ dependencyRoot, name: 'trusted-events-bare', appSource, instrument: false });
const bareServer = await serveStatic(bareFixture.distRoot);
const origin = server.origin;

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const launch = () => chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const browser = await launch();
const sessions = [], pageErrors = [];
let touchSession = null, gridSession = null;
const hoverCost = { instrumented: [], bare: [], pointer_moves_per_sweep: 10 * (5 + 120) };
const median = values => [...values].sort((a, b) => a - b)[1];
async function measuredHoverSweep(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    globalThis.__trustedHoverLongTasks = [];
    globalThis.__trustedHoverObserver = new PerformanceObserver(list => {
      globalThis.__trustedHoverLongTasks.push(...list.getEntries().filter(entry => entry.duration >= 50).map(entry => entry.duration));
    });
    globalThis.__trustedHoverObserver.observe({ entryTypes: ['longtask'] });
  });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value]));
  const before = await metrics();
  for (let row = 0; row < 10; row += 1) { await page.mouse.move(row % 2 ? 950 : 5, 12 + row * 22, { steps: 5 }); await page.mouse.move(row % 2 ? 5 : 950, 12 + row * 22, { steps: 120 }); }
  await page.waitForTimeout(300);
  const after = await metrics();
  const longTasks = await page.evaluate(() => {
    const observer = globalThis.__trustedHoverObserver;
    globalThis.__trustedHoverLongTasks.push(...observer.takeRecords().filter(entry => entry.duration >= 50).map(entry => entry.duration));
    observer.disconnect();
    return globalThis.__trustedHoverLongTasks;
  });
  await cdp.detach();
  return { script_ms: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(3), long_tasks_ms: longTasks.map(value => +value.toFixed(3)) };
}
const sessionOf = page => page.evaluate(() => globalThis.__productTraceRuntime?.session ?? null);
const leave = async page => { await page.goto('about:blank'); await page.waitForTimeout(1200); await page.close(); };
try {
  for (let run = 0; run < RUNS; run += 1) {
    const page = await browser.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    const cdp = await page.context().newCDPSession(page);
    const wait = ms => page.waitForTimeout(ms);
    await page.goto(origin, { waitUntil: 'load' }); await wait(600);
    // (1) Radix Select: open on the trigger, choose "banana" in the portal listbox.
    await page.getByRole('combobox', { name: 'Fruit' }).click(); await wait(300);
    await page.getByRole('option', { name: 'banana' }).click(); await wait(400);
    // (2) Radix Dialog: open, confirm, dismiss with Escape.
    await page.getByRole('button', { name: 'Archive…' }).click(); await wait(300);
    await page.getByRole('button', { name: 'Confirm archive' }).click(); await wait(300);
    await page.keyboard.press('Escape'); await wait(400);
    // (3) Canvas drag with pointer capture: the request is sent on pointerup.
    const box = await page.locator('canvas[aria-label="Board"]').boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 70, { steps: 8 }); await page.mouse.up(); await wait(400);
    // (4) Visible button -> hidden file input -> file chooser -> change -> upload.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload file' }).click()]);
    await chooser.setFiles(uploadFile); await wait(500);
    // (5) Document shortcut with modifiers.
    await page.keyboard.press('Control+Shift+K'); await wait(300);
    // (6) Wheel over the list until it loads more.
    await page.getByRole('list', { name: 'Feed' }).hover();
    for (let tick = 0; tick < 4; tick += 1) await page.mouse.wheel(0, 80);
    await wait(400);
    // (7) Copy from Source, paste into Target.
    await page.getByLabel('Source', { exact: true }).click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+c'); await wait(200);
    await page.getByLabel('Target', { exact: true }).click(); await page.keyboard.press('ControlOrMeta+v'); await wait(300);
    // (8) <details> toggle.
    await page.getByText('More options').click(); await wait(400);
    // (9) Plain cases: native <select> (type-ahead is trusted; selectOption is not), typing, a plain button.
    await page.getByLabel('Size', { exact: true }).focus(); await page.keyboard.press('l'); await wait(300);
    await page.getByLabel('Note', { exact: true }).click(); await page.keyboard.type('ab'); await wait(300);
    // Alt (Option) and AltGr (Ctrl+Alt) type characters: trusted CDP key events.
    for (const [modifiers, key, code, keyCode] of [[1, 'å', 'KeyA', 65], [3, '@', 'KeyQ', 81]]) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key, code, text: key, unmodifiedText: key, windowsVirtualKeyCode: keyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: keyCode });
    }
    await wait(200);
    await page.getByLabel('Secret', { exact: true }).click(); await page.keyboard.type('pw'); await wait(300);
    await page.getByRole('button', { name: 'Ping' }).click(); await wait(300);
    // (10) An untrusted click (dispatchEvent) on the same button: its request is issued, no action row is recorded.
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Ping').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await wait(400);
    // (11) Synthetic click on Target B by Open B's code; 2 s later the user tabs to Target B.
    await page.getByRole('button', { name: 'Open B' }).click(); await wait(2000);
    await page.keyboard.press('Tab'); await wait(300);
    // (12) Shift+click.
    await page.keyboard.down('Shift'); await page.getByRole('button', { name: 'Shift target' }).click(); await page.keyboard.up('Shift'); await wait(300);
    const selection = await page.locator('[aria-label="Selection probe"]').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.move(selection.x + 15, selection.y + selection.height / 2); await page.mouse.down();
    await page.mouse.move(selection.x + 215, selection.y + selection.height / 2, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Shift'); await wait(300);
    await page.keyboard.down('Meta'); await page.getByRole('button', { name: 'Shift target' }).click(); await page.keyboard.up('Meta'); await wait(200);
    // Leave Alt's keyup undelivered until after a later pointer activation.
    // This is the tracker state produced when keyup is lost by the page.
    await page.keyboard.down('Alt'); await wait(200);
    await page.getByRole('button', { name: 'Shift target' }).click();
    await page.keyboard.up('Alt'); await wait(200);
    // (13) Hover work.
    await page.getByRole('note', { name: 'Hover card' }).hover(); await wait(1500);
    // (14) HTML drag and drop.
    await page.dragAndDrop('[aria-label="Drag card"]', '[aria-label="Drop zone"]'); await wait(400);
    // (15) History, hash, validity, onBeforeInput.
    await page.getByRole('button', { name: 'Next step' }).click(); await wait(200);
    await page.goBack(); await wait(400);
    await page.getByRole('link', { name: 'Section' }).click(); await wait(400);
    await page.getByRole('button', { name: 'Check' }).click(); await wait(400);
    await page.getByLabel('Tagged', { exact: true }).click(); await page.keyboard.type('x'); await wait(300);
    // (16) el.focus() and requestSubmit() inside clicks.
    await page.getByRole('button', { name: 'Focus field' }).click(); await wait(300);
    await page.getByRole('button', { name: 'Submit by code' }).click(); await wait(400);
    sessions.push(await sessionOf(page));
    await leave(page);
  }
  // Touch: one tap.
  {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(origin, { waitUntil: 'load' }); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Tap me' }).tap(); await page.waitForTimeout(500);
    touchSession = await sessionOf(page); await leave(page); await context.close();
  }
  // Hover-heavy: 240 cells, a 10-row sweep (about 1,250 pointer moves).
  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(`${origin}/?grid=1`, { waitUntil: 'load' }); await page.waitForTimeout(600);
    hoverCost.instrumented.push(await measuredHoverSweep(page));
    gridSession = await sessionOf(page); await leave(page); await context.close();
  }
  // CDP ScriptDuration and PerformanceObserver long tasks, with three fresh
  // sweeps of each build. The bare build runs the identical page and moves.
  for (const [label, url, repetitions] of [['instrumented', `${origin}/?grid=1`, 2], ['bare', `${bareServer.origin}/?grid=1`, 3]]) {
    for (let rep = 0; rep < repetitions; rep += 1) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
      const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(String(error)));
      await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(600);
      hoverCost[label].push(await measuredHoverSweep(page));
      await page.close(); await context.close();
    }
  }
} finally {
  await browser.close(); await server.close(); await bareServer.close();
}
await collector.close();
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');
const records = readRows(path.join(storeDir, 'records.jsonl'));

// ---- helpers over raw rows (no package code)
const ok = fn => { try { return Boolean(fn()); } catch { return false; } };
const safe = fn => { try { return fn(); } catch (error) { return `threw: ${error.message}`; } };
const checks = [];
const check = (name, predicate, detail) => checks.push({ name, pass: ok(predicate), detail: safe(typeof detail === 'function' ? detail : () => detail) });
const label = row => row?.target?.attributes?.['aria-label'] || null;
const role = row => row?.target?.attributes?.role || null;
function typedTextAbsent(rows, field, text) {
  const onField = rows.filter(row => row.kind === 'dom.action' && label(row) === field);
  const keyRows = onField.filter(row => ['keydown', 'keyup', 'keypress'].includes(row.event));
  return keyRows.length >= text.length * 2 && keyRows.every(row => row.key?.key === 'Printable' && row.key.code === 'Printable')
    && onField.every(row => !(row.input && 'data' in row.input) && !(row.composition && 'data' in row.composition));
}
function pageView(session) {
  const rows = records.filter(row => row.capture_page_id === session);
  const actions = rows.filter(row => row.kind === 'dom.action');
  const byId = new Map(actions.map(row => [row.action_id, row]));
  const requests = rows.filter(row => row.kind === 'network.request' && row.internal !== true && row.transport_internal !== true);
  const owner = url => { const request = requests.find(row => row.url === url); return { request: request || null, action: request ? byId.get(request.action_id) || null : null }; };
  return { rows, actions, byId, requests, owner, ranges: rows.filter(row => row.kind === 'dom.action.range'), page: rows.find(row => row.kind === 'capture.page') || null,
    summary: rows.filter(row => row.kind === 'capture.summary').at(-1) || null };
}
const rangeCount = (ranges, kind) => ranges.reduce((sum, range) => sum + (range.segment ? (range.by_kind?.[kind] || 0) : (range.event === kind ? range.count : 0)), 0);

const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath], stderr: 'ignore' });
const client = new Client({ name: 'trusted-events', version: '1' });
await client.connect(transport);
const call = async (name, args) => { try { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; } catch (error) { return { error: String(error), text: '' }; } };
const report = { sessions: [] };
report.hover_cost = {
  ...hoverCost,
  instrumented_median_script_ms: median(hoverCost.instrumented.map(sample => sample.script_ms)),
  bare_median_script_ms: median(hoverCost.bare.map(sample => sample.script_ms)),
  instrumented_median_long_tasks: median(hoverCost.instrumented.map(sample => sample.long_tasks_ms.length)),
  bare_median_long_tasks: median(hoverCost.bare.map(sample => sample.long_tasks_ms.length)),
};
report.hover_cost.extra_script_ms_per_move = +((report.hover_cost.instrumented_median_script_ms - report.hover_cost.bare_median_script_ms) / hoverCost.pointer_moves_per_sweep).toFixed(4);
check('V3 hover cost: median of three sweeps has no runtime-attributable long task and adds at most 0.25 ms of CDP ScriptDuration per pointer move',
  () => hoverCost.instrumented.length === 3 && hoverCost.bare.length === 3
    && report.hover_cost.instrumented_median_long_tasks <= report.hover_cost.bare_median_long_tasks
    && report.hover_cost.extra_script_ms_per_move <= 0.25, report.hover_cost);
try {
  check('R0 the pages ran without errors', () => pageErrors.length === 0, pageErrors);
  for (const [run, session] of sessions.entries()) {
    const tag = `run ${run + 1}`;
    const { rows, actions, byId, requests, owner, ranges, page, summary } = pageView(session);
    const listened = new Set(page?.user_events?.listened || []);
    const discrete = actions.filter(row => !row.coalesced);

    // Observation: discovered kinds, stated on capture.page and counted in the summary.
    check(`${tag} K1 capture.page lists the discovered kinds (on* handlers + the handler-less kinds, textInput and DOMActivate included), model version 2`,
      () => page.user_events.model_version === 2 && page.user_events.on_handler_kinds > 100
        && ['pointerdown', 'pointerup', 'pointermove', 'gotpointercapture', 'keyup', 'wheel', 'scroll', 'copy', 'paste', 'toggle', 'change', 'focusin', 'focusout', 'dblclick', 'drop',
          'popstate', 'hashchange', 'invalid', 'textInput', 'DOMActivate', 'DOMFocusIn', 'DOMFocusOut'].every(kind => listened.has(kind)),
      () => ({ on_handler_kinds: page?.user_events?.on_handler_kinds, listened: listened.size, supplemented: page?.user_events?.supplemented }));
    check(`${tag} K2 every recorded kind is listened; summary recorded_by_kind equals the discrete rows per kind; every range close row belongs to a coalesced row`,
      () => [...new Set(actions.map(row => row.event))].every(kind => listened.has(kind))
        && Object.entries(summary.user_events.recorded_by_kind).every(([kind, count]) => discrete.filter(row => row.event === kind).length === count)
        && ranges.every(range => byId.get(range.action_id)?.coalesced === true),
      () => ({ recorded: summary?.user_events?.recorded_by_kind, ranges: ranges.length }));
    check(`${tag} K3 kinds classified not user-caused leave dom.event rows (user: false), never actions; untrusted events leave dom.untrusted rows, never actions`,
      () => rows.some(row => row.kind === 'dom.event' && row.user === false) && rows.filter(row => row.kind === 'dom.event').every(row => !row.action_id)
        && rows.filter(row => row.kind === 'dom.untrusted').length === summary.user_events.untrusted_skipped,
      () => ({ dom_event: rows.filter(row => row.kind === 'dom.event').map(row => row.event), untrusted: rows.filter(row => row.kind === 'dom.untrusted').map(row => `${row.event}:${label(row) || row.target?.tag}`), skipped: summary?.user_events?.untrusted_skipped }));

    // (3) Drag.
    const drag = owner('/api/drag');
    const gesture = drag.action?.gesture_id;
    const onCanvas = actions.filter(row => row.target?.tag === 'canvas' && row.gesture_id === gesture);
    const down = onCanvas.find(row => row.event === 'pointerdown'), move = onCanvas.find(row => row.event === 'pointermove' && row.coalesced);
    const moveRange = ranges.find(row => row.action_id === move?.action_id);
    check(`${tag} D1 the drag's request is owned by the recorded pointerup (release) on the canvas`,
      () => drag.action.event === 'pointerup' && drag.action.target.tag === 'canvas' && drag.action.pointer.pointerType === 'mouse' && drag.action.pointer.buttons === 0 && drag.action.phase === 'release', () => drag.action);
    check(`${tag} D2 the same gesture holds the pointerdown (press, buttons 1) and one move range (count >= 8, x span >= 80), closed at the release`,
      () => down.pointer.buttons === 1 && down.phase === 'press' && moveRange.count >= 8 && moveRange.bounds.max_x - moveRange.bounds.min_x >= 80 && moveRange.gesture_id === gesture
        && moveRange.sequence < drag.action.sequence, () => ({ down: down?.phase, moveRange }));
    check(`${tag} D3 pointer capture is recorded in the drag's gesture (boundary notification, never a release)`,
      () => onCanvas.some(row => row.event === 'gotpointercapture' && row.phase !== 'release'), () => onCanvas.map(row => `${row.event}:${row.phase}`));

    // (4) Upload.
    const upload = owner('/api/upload');
    const opener = actions.filter(row => row.event === 'click' && label(row) === null && row.target?.tag === 'button' && row.sequence < (upload.action?.sequence ?? 0)).at(-1);
    check(`${tag} U1 the upload is owned by the trusted change on the hidden file input (1 file, text/plain), opened by the Upload click`,
      () => upload.action.event === 'change' && upload.action.target.attributes.type === 'file' && upload.action.files.count === 1 && upload.action.files.types[0] === 'text/plain'
        && upload.action.opened_by_action_id === opener.action_id && upload.action.gesture !== false, () => ({ upload: upload.action?.opened_by_action_id, opener: opener?.action_id }));
    check(`${tag} U2 the synthetic click on the file input is a dom.untrusted row (synthetic_activation, under the Upload click), never an action`,
      () => !actions.some(row => row.event === 'click' && row.target?.attributes?.type === 'file')
        && rows.some(row => row.kind === 'dom.untrusted' && row.event === 'click' && row.target?.attributes?.type === 'file' && row.synthetic_activation === true && row.dispatched_under_action_id === opener.action_id));

    // (5) Shortcut; Alt/AltGr; typed text.
    const shortcut = owner('/api/shortcut');
    check(`${tag} S1 the shortcut's request is owned by keydown K with ctrlKey and shiftKey`, () => shortcut.action.event === 'keydown' && shortcut.action.key.key === 'K' && shortcut.action.key.code === 'KeyK'
      && shortcut.action.key.ctrlKey === true && shortcut.action.key.shiftKey === true && shortcut.action.key.metaKey === false, () => shortcut.action?.key);
    const altKeys = actions.filter(row => row.event === 'keydown' && label(row) === 'Note' && row.key?.altKey === true && !['Alt', 'Control'].includes(row.key.key));
    check(`${tag} S2 Alt and AltGr (Ctrl+Alt) keys type characters: folded to "Printable" (key and code); "å" and "@" appear in no key`,
      () => altKeys.length === 2 && altKeys.every(row => row.key.key === 'Printable' && row.key.code === 'Printable') && !rows.some(row => /"(?:å|@)"/u.test(JSON.stringify(row.key || {}))),
      () => altKeys.map(row => row.key));
    const note = actions.filter(row => row.event === 'input' && label(row) === 'Note');
    check(`${tag} S3 typing records inputType and data_length, never the text or the value (input_text "off"); the password field is flagged`,
      () => page.input_text === 'off' && note.length >= 2 && note.every(row => row.input.data_length >= 1 && !('data' in row.input))
        && typedTextAbsent(rows, 'Secret', 'pw') && actions.filter(row => row.event === 'input' && label(row) === 'Secret').every(row => row.input.credential_field === true),
      () => note.map(row => row.input));

    // (6) Scroll range; coalescing accounting; hover segments.
    const more = owner('/api/more');
    const moreRange = ranges.find(row => row.action_id === more.action?.action_id);
    check(`${tag} W1 the load-more request is owned by a coalesced scroll range on the feed; its close row shows the scroll passing 150`,
      () => more.action.event === 'scroll' && more.action.coalesced === true && role(more.action) === 'list' && moreRange.scroll.last[1] > 150, () => ({ action: more.action?.event, moreRange }));
    const hoverRanges = ranges.filter(range => range.segment === 'hover');
    check(`${tag} W2 coalescing: per kind, range close rows count exactly the summary's coalesced events; the four wheel ticks are one range`,
      () => Object.entries(summary.user_events.coalesced_by_kind).every(([kind, count]) => rangeCount(ranges, kind) === count)
        && ranges.filter(range => range.segment === 'wheel').length === 1 && ranges.find(range => range.segment === 'wheel').by_kind.wheel === 4,
      () => ({ coalesced: summary?.user_events?.coalesced_by_kind, counted: Object.fromEntries(Object.keys(summary?.user_events?.coalesced_by_kind || {}).map(kind => [kind, rangeCount(ranges, kind)])), wheel: ranges.filter(range => range.segment === 'wheel').map(range => range.by_kind) }));
    check(`${tag} W3 hover is one range per movement segment across controls; a per-control hover row exists only where work ran under it`,
      () => hoverRanges.length >= 1 && hoverRanges.reduce((sum, range) => sum + range.controls, 0) > hoverRanges.length
        && actions.filter(row => row.hover_segment_action_id).every(row => rows.some(other => other.action_id === row.action_id && other.kind !== 'dom.action')),
      () => ({ segments: hoverRanges.length, controls: hoverRanges.map(range => range.controls), per_control_rows: actions.filter(row => row.hover_segment_action_id).length }));
    const prefetch = owner('/api/prefetch');
    const prefetchSegment = ranges.find(range => range.action_id === prefetch.action?.hover_segment_action_id);
    // React dispatches onMouseEnter from the mouseout of the element the pointer left (relatedTarget = the card) or the card's mouseover.
    check(`${tag} W4 hover work: the card's mouseenter prefetch is owned by the per-control hover row it ran under (entering the card), listed in its segment's with_work`,
      () => prefetch.action.coalesced === true && (label(prefetch.action) === 'Hover card' || prefetch.action.related_target?.attributes?.['aria-label'] === 'Hover card')
        && prefetchSegment.with_work.some(entry => entry.action_id === prefetch.action.action_id),
      () => ({ owner: prefetch.action && { event: prefetch.action.event, label: label(prefetch.action), segment: prefetch.action.hover_segment_action_id }, with_work: prefetchSegment?.with_work }));

    // (7)-(9) Clipboard, toggle, Radix, select.
    const pasted = owner('/api/pasted');
    check(`${tag} C1 copy and paste are ClipboardEvent rows; paste owns its request`, () => pasted.action.event === 'paste' && pasted.action.interface === 'ClipboardEvent'
      && Array.isArray(pasted.action.clipboard.types) && actions.some(row => row.event === 'copy' && row.interface === 'ClipboardEvent' && label(row) === 'Source'), () => pasted.action);
    const details = owner('/api/details?open=true');
    check(`${tag} T1 the details request is owned by the toggle row (ToggleEvent, closed -> open)`, () => details.action.event === 'toggle' && details.action.interface === 'ToggleEvent' && details.action.toggle.newState === 'open', () => details.action);
    const choice = owner('/api/choice?value=banana');
    check(`${tag} X1 Radix Select: the trigger's pointerdown is recorded; the choice is owned by the pointerup on the portal option`,
      () => actions.some(row => row.event === 'pointerdown' && role(row) === 'combobox') && role(choice.action) === 'option' && choice.action.event === 'pointerup', () => choice.action?.event);
    const archive = owner('/api/archive'), dismissed = owner('/api/dialog-dismissed');
    check(`${tag} X2 Radix Dialog: confirm owned by its click, Escape dismissal owned by keydown Escape`,
      () => archive.action.event === 'click' && dismissed.action.event === 'keydown' && dismissed.action.key.key === 'Escape', () => ({ archive: archive.action?.event, dismissed: dismissed.action?.key }));
    const size = owner('/api/size?value=l');
    check(`${tag} P1 native select change owns its request`, () => size.action.event === 'change' && size.action.target.tag === 'select', () => size.action?.event);

    // (10) Untrusted Ping.
    const pings = requests.filter(row => row.url === '/api/ping');
    const pingClick = pings[0] ? byId.get(pings[0].action_id) : null;
    check(`${tag} P2 the trusted Ping owns its request; the untrusted dispatchEvent's request is unattributed and left only a dom.untrusted row`,
      () => pings.length === 2 && pingClick.event === 'click' && pings[1].action_id === null
        && rows.some(row => row.kind === 'dom.untrusted' && row.event === 'click' && row.sequence > pings[0].sequence && row.sequence < pings[1].sequence), () => pings.map(row => row.action_id));

    // (11) Synthetic click on Target B, then Tab.
    const openB = actions.find(row => row.event === 'click' && row.target?.tag === 'button' && requests.some(request => request.url === '/api/b' && request.action_id === row.action_id));
    const tabRows = actions.filter(row => row.sequence > (openB?.sequence ?? Infinity) && ['focus', 'focusin', 'keyup', 'DOMFocusIn'].includes(row.event) && row.target?.tag === 'button');
    check(`${tag} L1 Target B's handler, run by Open B's synthetic click, is Open B's; the user's Tab 2 s later onto Target B carries no opened_by`,
      () => Boolean(openB) && tabRows.some(row => row.event === 'focusin') && rows.filter(row => row.kind === 'dom.action' && row.opened_by_action_id === openB.action_id).length === 0,
      () => ({ openB: openB?.action_id, tab: tabRows.map(row => `${row.event}:${row.opened_by_action_id || '-'}`), linked: rows.filter(row => row.opened_by_action_id === openB?.action_id).map(row => row.event) }));

    // (12) Shift+click: the click is in its pointer's gesture, never the Shift key's.
    const shiftClick = owner('/api/shift?shift=true').action;
    const before = kind => actions.filter(row => row.event === kind && row.sequence < (shiftClick?.sequence ?? 0)).at(-1);
    const shiftDown = actions.filter(row => row.event === 'keydown' && row.key?.key === 'Shift' && row.sequence < (shiftClick?.sequence ?? 0)).at(-1);
    check(`${tag} G1 Shift+click: click and mouseup share the pointerdown's gesture, not the held Shift key's`,
      () => shiftClick.event === 'click' && shiftClick.gesture_id === before('pointerdown').gesture_id && before('mouseup').gesture_id === before('pointerdown').gesture_id && shiftClick.gesture_id !== shiftDown.gesture_id,
      () => ({ click: shiftClick?.gesture_id, pointerdown: before('pointerdown')?.gesture_id, mouseup: before('mouseup')?.gesture_id, shift: shiftDown?.gesture_id }));
    const shiftActivate = actions.find(row => row.event === 'DOMActivate' && row.target_ref === shiftClick?.target_ref && row.sequence > (before('pointerdown')?.sequence ?? Infinity));
    const selectionDown = actions.find(row => row.event === 'pointerdown' && label(row) === 'Selection probe');
    const selectionUp = actions.find(row => row.event === 'pointerup' && row.sequence > (selectionDown?.sequence ?? Infinity));
    const selectionStart = actions.find(row => row.event === 'selectstart' && row.sequence > (selectionDown?.sequence ?? Infinity) && row.sequence < (selectionUp?.sequence ?? -Infinity));
    check(`${tag} G3 pointer-caused DOMActivate and selectstart take their pointer gesture while Shift is held`,
      () => shiftActivate.gesture_id === shiftClick.gesture_id && shiftActivate.gesture_id !== shiftDown.gesture_id
        && selectionStart.gesture_id === selectionDown.gesture_id && selectionStart.gesture_id !== shiftDown.gesture_id,
      () => ({ activate: shiftActivate?.gesture_id, click: shiftClick?.gesture_id, selection: selectionStart?.gesture_id, pointerdown: selectionDown?.gesture_id, shift: shiftDown?.gesture_id }));
    const targetClicks = actions.filter(row => row.event === 'click' && row.target_ref === shiftClick?.target_ref);
    const activationAfter = click => actions.find(row => row.event === 'DOMActivate' && row.target_ref === click?.target_ref && row.sequence > (click?.sequence ?? Infinity));
    const keyBefore = (key, click) => actions.filter(row => row.event === 'keydown' && row.key?.key === key && row.sequence < (click?.sequence ?? 0)).at(-1);
    const pointerBefore = click => actions.filter(row => row.event === 'pointerdown' && row.sequence < (click?.sequence ?? 0)).at(-1);
    check(`${tag} G4 Meta-click and a click before a missing keyup keep DOMActivate on the pointer gesture`,
      () => targetClicks.length === 3 && targetClicks.slice(1).every((click, index) => {
        const key = keyBefore(index === 0 ? 'Meta' : 'Alt', click);
        return activationAfter(click)?.gesture_id === click.gesture_id && click.gesture_id === pointerBefore(click)?.gesture_id && click.gesture_id !== key?.gesture_id;
      }),
      () => targetClicks.slice(1).map((click, index) => ({ key: index === 0 ? 'Meta' : 'Alt', click: click.gesture_id, activate: activationAfter(click)?.gesture_id, pointer: pointerBefore(click)?.gesture_id })));

    // (14) HTML drag and drop.
    const drop = owner('/api/drop');
    const dragStart = actions.find(row => row.event === 'dragstart');
    const dragRows = actions.filter(row => row.interface === 'DragEvent');
    check(`${tag} G2 HTML drag and drop: drop owns its request; every drag event carries the dragstart's gesture id (not null)`,
      () => drop.action.event === 'drop' && Boolean(dragStart.gesture_id) && dragRows.length >= 3 && dragRows.every(row => row.gesture_id === dragStart.gesture_id),
      () => dragRows.map(row => `${row.event}:${row.gesture_id}`));

    // (15) Kinds with no UIEvent interface, and React onBeforeInput (textInput).
    const pop = owner('/api/popstate'), hash = owner('/api/hash'), invalid = owner('/api/invalid'), beforeInput = owner('/api/beforeinput');
    check(`${tag} N1 popstate (Back), hashchange and invalid are recorded and own their requests`,
      () => pop.action.event === 'popstate' && hash.action.event === 'hashchange' && invalid.action.event === 'invalid', () => ({ pop: pop.action?.event, hash: hash.action?.event, invalid: invalid.action?.event }));
    check(`${tag} N2 React onBeforeInput work is owned (by the textInput it listens to)`, () => beforeInput.action.event === 'textInput', () => beforeInput.action?.event);

    // (16) Work run by code a click calls.
    const focused = owner('/api/native-focused'), submitted = owner('/api/submitted');
    check(`${tag} F1 el.focus() inside a click: the focus listener's request is the click's; the focus row is caused by it and runs on it`,
      () => focused.action.event === 'click' && actions.some(row => row.event === 'focus' && row.gesture === false && row.caused_by_action_id === focused.action.action_id && row.runs_on_action_id === focused.action.action_id),
      () => focused.action?.event);
    check(`${tag} F2 requestSubmit() inside a click: the submit handler's POST is the click's; the submit row is caused by it`,
      () => submitted.action.event === 'click' && actions.some(row => row.event === 'submit' && row.caused_by_action_id === submitted.action.action_id), () => submitted.action?.event);

    // Every request but the untrusted Ping has an owner.
    const unowned = requests.filter(row => !row.action_id).map(row => row.url);
    check(`${tag} P3 every request but the untrusted Ping's has an owner`, () => JSON.stringify(unowned) === JSON.stringify(['/api/ping']), unowned);

    // MCP over stdio, compared with the raw rows.
    const dragChain = drag.action ? await call('action_chain', { action_id: drag.action.action_id }) : null;
    check(`${tag} M1 action_chain(pointerup): POST /api/drag; the dispatch line names the mouse pointer`,
      () => dragChain.segments.some(segment => segment.method === 'POST' && segment.url === '/api/drag') && /^pointerup action:\S+ \(mouse pointer \d+, button 0, buttons 0; phase release on <canvas aria-label="Board">\)/u.test(dragChain.text),
      () => dragChain?.text?.split('\n')[0]);
    const uploadChain = upload.action ? await call('action_chain', { action_id: upload.action.action_id }) : null;
    check(`${tag} M2 action_chain(change): the upload, 1 file (text/plain), and the opened-by pointer to the Upload click`,
      () => uploadChain.segments.some(segment => segment.url === '/api/upload') && uploadChain.opened_by_action_id === opener.action_id && uploadChain.text.includes('1 file(s) (text/plain)'),
      () => uploadChain?.text?.split('\n')[0]);
    const openerChain = opener ? await call('action_chain', { action_id: opener.action_id }) : null;
    check(`${tag} M3 the Upload click never reads no_request: outcome "opened", and its line names the change and its POST /api/upload`,
      () => openerChain.outcome.status === 'opened' && openerChain.text.includes('opened <input') && openerChain.text.includes('its change issued POST /api/upload')
        && !openerChain.text.includes('no request could be attributed') && openerChain.text.includes(`this action opened change ${upload.action.action_id} → POST /api/upload`)
        && openerChain.opened.some(entry => entry.action_id === upload.action.action_id), () => openerChain?.text?.split('\n')[0]);
    const shortcutChain = shortcut.action ? await call('action_chain', { action_id: shortcut.action.action_id }) : null;
    check(`${tag} M4 action_chain(keydown): "Ctrl+Shift+K", modifiers [Ctrl, Shift]`, () => shortcutChain.keyboard.text.startsWith('Ctrl+Shift+K in ')
      && JSON.stringify(shortcutChain.keyboard.modifiers) === JSON.stringify(['Ctrl', 'Shift']), () => shortcutChain?.keyboard);
    const focusChain = focused.action ? await call('action_chain', { action_id: focused.action.action_id }) : null;
    const submitChain = submitted.action ? await call('action_chain', { action_id: submitted.action.action_id }) : null;
    check(`${tag} M5 the Focus field and Submit by code clicks' chains show the work their code caused (GET /api/native-focused, POST /api/submitted)`,
      () => focusChain.text.includes('/api/native-focused') && submitChain.text.includes('POST /api/submitted') && submitChain.outcome.status !== 'no_request',
      () => [focusChain?.text?.split('\n')[0], submitChain?.text?.split('\n')[0]]);
    const pingChain = pingClick ? await call('action_chain', { action_id: pingClick.action_id }) : null;
    check(`${tag} M6 action_chain coverage carries user_events (listened kinds, counts) and, for the Ping click, the untrusted event skipped in its window`,
      () => pingChain.coverage.user_events.listened_kinds === listened.size && pingChain.coverage.user_events.untrusted_skipped === summary.user_events.untrusted_skipped
        && pingChain.coverage.reasons.some(reason => reason.startsWith('an untrusted (synthetic) event was skipped in this window')), () => pingChain?.coverage);
    const pageAnswer = await call('page_requests', { session, n: 500 });
    const untrustedPing = pageAnswer.requests?.find(row => row.url === '/api/ping' && row.attribution.kind === 'none');
    check(`${tag} M7 page_requests: totals equal the raw rows; the unowned Ping names the skipped untrusted click; user_events for the page`,
      () => pageAnswer.counts.total === requests.length && pageAnswer.requests.filter(row => row.attribution.kind !== 'action').length === 1
        && untrustedPing.attribution.text.includes('an untrusted (synthetic) click event was skipped before it') && pageAnswer.user_events[session].listened_kinds === listened.size,
      () => ({ counts: pageAnswer.counts, ping: untrustedPing?.attribution?.text }));
    const recent = await call('recent_actions', { session, n: 100 }), recentAll = await call('recent_actions', { session, n: 100, include_context: true });
    const listedIds = new Set((recent.actions || []).map(row => row.action_id));
    const owners = new Set(requests.map(row => row.action_id).filter(Boolean));
    check(`${tag} M8 recent_actions: context is counted, not listed; include_context lists it; no omitted row owns a request`,
      () => recent.context_omitted > 0 && recentAll.context_omitted === 0 && recentAll.actions.filter(row => !listedIds.has(row.action_id)).every(row => !owners.has(row.action_id)),
      () => ({ omitted: recent.context_omitted, listed: recent.actions?.length }));
    report.sessions.push({ session, rows: rows.length, actions: actions.length, discrete: discrete.length, coalesced_rows: actions.length - discrete.length, ranges: ranges.length, hover_segments: hoverRanges.length,
      kinds: summary?.user_events?.recorded_by_kind, coalesced: summary?.user_events?.coalesced_by_kind,
      owners: Object.fromEntries(requests.map(row => [row.url, row.action_id ? `${byId.get(row.action_id)?.event}${byId.get(row.action_id)?.coalesced ? ' (range)' : ''}` : null])) });
  }

  // Touch: one tap is one gesture.
  {
    const { actions, owner } = pageView(touchSession);
    const tap = owner('/api/touchend');
    const onButton = actions.filter(row => row.target?.tag === 'button' && ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click', 'mousedown', 'mouseup'].includes(row.event));
    const ids = new Set(onButton.map(row => row.gesture_id));
    const phase = kind => onButton.find(row => row.event === kind)?.phase;
    check('H1 touch tap: touchend owns its request; pointerdown/touchstart are press, pointerup/touchend release; every row of the tap shares one gesture id',
      () => tap.action.event === 'touchend' && ids.size === 1 && [...ids][0] != null && phase('pointerdown') === 'press' && phase('touchstart') === 'press'
        && phase('pointerup') === 'release' && phase('touchend') === 'release', () => onButton.map(row => `${row.event}:${row.phase}:${row.gesture_id}`));
    const touchActivate = actions.find(row => row.event === 'DOMActivate' && row.target_ref === tap.action?.target_ref);
    check('H2 pointer-caused DOMActivate after a touch tap shares the touch gesture',
      () => touchActivate.gesture_id === tap.action.gesture_id,
      () => ({ activate: touchActivate?.gesture_id, touchend: tap.action?.gesture_id }));
  }

  // Hover-heavy page: delivered, closed as it goes, counted exactly.
  {
    const { rows, actions, ranges, summary } = pageView(gridSession);
    const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length + 1, 0);
    report.grid = { rows: rows.length, bytes, actions: actions.length, ranges: ranges.length, hover_segments: ranges.filter(range => range.segment === 'hover').length,
      coalesced_events: Object.values(summary?.user_events?.coalesced_by_kind || {}).reduce((sum, count) => sum + count, 0), summary: Boolean(summary),
      max_sequence: rows.reduce((max, row) => Math.max(max, row.sequence || 0), 0) };
    check('V1 hover-heavy page: capture.summary delivered; per kind the close rows count the summary\'s coalesced events exactly; every sequence up to the summary arrived',
      () => Boolean(summary) && Object.entries(summary.user_events.coalesced_by_kind).every(([kind, count]) => rangeCount(ranges, kind) === count)
        && new Set(rows.filter(row => Number.isInteger(row.sequence) && row.sequence <= summary.sequence).map(row => row.sequence)).size === summary.sequence, report.grid);
    check('V2 hover-heavy page: at most 30 dom.action rows and 60 range rows for more than 1,000 coalesced pointer events over 240 cells',
      () => actions.length <= 30 && ranges.length <= 60 && report.grid.coalesced_events > 1000, report.grid);
  }
} finally {
  await client.close();
}

// ---- inputText: true (dev-only typed text), both build modes, one page load each.
for (const mode of ['development', 'production']) {
  try {
    const variantStore = fs.mkdtempSync(path.join(os.tmpdir(), `tracer-trusted-events-text-${mode}-`));
    const variantCollector = createCollector({ port: 0, store: { dir: variantStore, manifest: null, label: `input-text-${mode}` } });
    await variantCollector.ready;
    const warnings = []; const originalWarn = console.warn; console.warn = (...args) => { warnings.push(args.join(' ')); originalWarn(...args); };
    let variant;
    try { variant = await buildReactFixture({ dependencyRoot, name: `trusted-events-text-${mode}`, appSource, mode, pluginOptions: { inputText: true, collector: { url: variantCollector.url, force: true } } }); }
    finally { console.warn = originalWarn; }
    const variantServer = await serveStatic(variant.distRoot);
    const variantBrowser = await launch();
    try {
      const page = await variantBrowser.newPage();
      await page.goto(variantServer.origin, { waitUntil: 'load' }); await page.waitForTimeout(600);
      await page.getByLabel('Note', { exact: true }).click(); await page.keyboard.type('ab'); await page.waitForTimeout(300);
      await page.getByLabel('Secret', { exact: true }).click(); await page.keyboard.type('pw'); await page.waitForTimeout(300);
      await leave(page);
    } finally { await variantBrowser.close(); await variantServer.close(); }
    await variantCollector.close();
    const rows = readRows(path.join(variantStore, 'records.jsonl'));
    const page = rows.find(row => row.kind === 'capture.page');
    const inputs = field => rows.filter(row => row.kind === 'dom.action' && row.event === 'input' && label(row) === field);
    const keys = field => rows.filter(row => row.kind === 'dom.action' && row.event === 'keydown' && label(row) === field);
    const secretRedacted = () => inputs('Secret').length === 2 && inputs('Secret').every(row => !('data' in row.input) && row.input.data_redacted === 'credential_field' && row.input.data_length === 1)
      && keys('Secret').every(row => row.key.key === 'Printable' && row.key.code === 'Printable') && !JSON.stringify(rows).includes('"pw"');
    if (mode === 'development') {
      check('I1 inputText: true, development build: input_text "on", a build warning, InputEvent data and printable keys recorded in Note ("a","b"; KeyA, KeyB)',
        () => page.input_text === 'on' && warnings.some(text => text.includes('input text capture ON')) && inputs('Note').map(row => row.input.data).join('') === 'ab'
          && keys('Note').map(row => `${row.key.key}:${row.key.code}`).join(',') === 'a:KeyA,b:KeyB', () => ({ input_text: page?.input_text, note: inputs('Note').map(row => row.input) }));
      check('I2 inputText: true, development build: the password field is still redacted', secretRedacted, () => inputs('Secret').map(row => row.input));
    } else {
      check('I3 inputText: true, production build: input_text "production_off", a build warning, no typed text in any row',
        () => page.input_text === 'production_off' && warnings.some(text => text.includes('input text capture disabled')) && typedTextAbsent(rows, 'Note', 'ab') && secretRedacted(),
        () => ({ input_text: page?.input_text, note: inputs('Note').map(row => row.input) }));
    }
    if (!keep) { fs.rmSync(variantStore, { recursive: true, force: true }); variant.cleanup(); }
  } catch (error) { check(`I (${mode}) inputText variant ran`, () => false, String(error)); }
}

const failed = checks.filter(entry => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${String(JSON.stringify(entry.detail)).slice(0, 2500)}`}`);
console.log(JSON.stringify(report, null, 2));
console.log(`${checks.length - failed.length}/${checks.length} checks pass over ${sessions.length} page loads (+ touch, hover-heavy, 2 inputText builds); store ${storeDir}`);
if (!keep && !failed.length) { fs.rmSync(storeDir, { recursive: true, force: true }); fixture.cleanup(); bareFixture.cleanup(); }
else console.log(`kept store ${storeDir} and fixture ${fixture.repository}`);
if (failed.length) process.exitCode = 1;
