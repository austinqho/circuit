// D-G1-22 "the handler Tracer credits to a user event is the one React
// actually invoked during that event's dispatch, observed at dispatch time,
// never inferred from a prop name" (headless, neutral fixture
// test/browser/fixtures/handler-binding-app: native checkbox, radio, text,
// <select>, range, onDoubleClick, Enter in a form, Radix Select in a portal
// (pointer and keyboard), Radix Dialog dismissed by Escape and by the overlay,
// a zustand-writing onClick, a declared-but-never-run prop, onFocus fired by
// app code's .focus() (from a click and from a timer), a prop a component
// calls from a timer, contenteditable onInput, and a document capture-phase
// click listener that runs before every React click handler). The page ships
// rows through the real collector sink into a real store; a tiny backend
// answers /api/* and logs what it received; the MCP server is then driven over
// stdio as a black box. Every expectation is computed here from the raw
// records.jsonl rows and the fixture's source offsets; nothing from the
// package computes an expectation.
//
//   node test/browser/handler-binding.mjs [dependencyRoot]
//   TRACER_BINDING_RUNS=3 (page loads, default 3), TRACER_KEEP_STORE=1,
//   TRACER_FACTS_ONLY=1 (print the per-case facts table; used for the
//   negative control on a runtime without observed bindings)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture } from './fixture-build.mjs';
import { createCollector } from '../../collector/index.js';
import { buildActionChains } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const fixtureDir = path.join(tracerRoot, 'test/browser/fixtures/handler-binding-app');
const appSource = fs.readFileSync(path.join(fixtureDir, 'main.jsx'), 'utf8');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-handler-binding-store-'));
const keep = process.env.TRACER_KEEP_STORE === '1';
const factsOnly = process.env.TRACER_FACTS_ONLY === '1';
const RUNS = Number(process.env.TRACER_BINDING_RUNS || 3);

// zustand is not in the dependency root: resolve it from this checkout's
// node_modules and dedupe React so it shares the root's copy.
const zustandEsm = path.join(path.dirname(createRequire(path.join(tracerRoot, 'package.json')).resolve('zustand')), 'esm');
const collector = createCollector({ port: 0, store: { dir: storeDir, manifest: null, label: 'handler-binding' } });
await collector.ready;
// vendor/ is outside the first-party rule: the stand-in form library is not instrumented.
const fixture = await buildReactFixture({ dependencyRoot, name: 'handler-binding', appSource, pluginOptions: { collector: { url: collector.url, force: true } },
  extraFiles: Object.fromEntries(['form-lib.js', 'widget.js'].map(file => [`vendor/${file}`, fs.readFileSync(path.join(fixtureDir, 'vendor', file), 'utf8')])),
  resolve: { alias: [{ find: /^zustand$/u, replacement: path.join(zustandEsm, 'index.mjs') }, { find: /^zustand\/(.*)$/u, replacement: `${zustandEsm}/$1.mjs` }], dedupe: ['react', 'react-dom'] } });
const distRoot = fixture.distRoot;
// The tiny backend: every /api/* call answers {ok:true} and is logged.
const received = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) { received.push(`${req.method} ${url.pathname}${url.search}`); req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); return; }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(distRoot, relative);
  if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
const sessions = []; const pageErrors = []; const receivedPerRun = []; const proxyLogs = [];
try {
  for (let run = 0; run < RUNS; run += 1) {
    const page = await browser.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    const before = received.length;
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForTimeout(700); // the mount timer focuses "Quick search"; the ticker fires
    const settle = () => page.waitForTimeout(250);
    // (1) Checkbox that only writes state: a mouse click, then Space.
    await page.getByLabel('Notify').click(); await settle();
    await page.getByLabel('Notify').focus(); await page.keyboard.press('Space'); await settle();
    // (2) Checkbox and radio that send a request.
    await page.getByLabel('Subscribe').click(); await settle();
    await page.getByLabel('Plan pro').click(); await settle();
    // (3) Text, <select> (type-ahead: a trusted change), range (ArrowRight: a trusted input).
    await page.getByLabel('Title').click(); await page.keyboard.type('ab'); await settle();
    await page.getByLabel('Color').focus(); await page.keyboard.press('b'); await settle();
    await page.getByLabel('Volume').focus(); await page.keyboard.press('ArrowRight'); await settle();
    // (4) Double-click to edit.
    await page.getByRole('button', { name: 'Project name' }).dblclick(); await settle();
    // (5) Enter in the search field submits the form.
    await page.getByLabel('Query').click(); await page.keyboard.type('x'); await page.keyboard.press('Enter'); await settle();
    // (6) Radix Select: pointer (open, choose banana), then keyboard (open with Enter, ArrowDown, Enter).
    await page.getByRole('combobox', { name: 'Fruit' }).click(); await settle();
    await page.getByRole('option', { name: 'banana' }).click(); await page.waitForTimeout(400);
    await page.getByRole('combobox', { name: 'Fruit' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    // (7) Radix Dialog: open, Escape; open, click the overlay outside the content.
    await page.getByRole('button', { name: 'Delete…' }).click(); await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Delete…' }).click(); await page.waitForTimeout(400);
    await page.mouse.click(700, 450); await page.waitForTimeout(400);
    // (8) zustand store write; (9) Archive (its onContextMenu never runs).
    await page.getByRole('button', { name: 'Add to cart' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Archive' }).click(); await settle();
    // (10) A click whose handler focuses another field.
    await page.getByRole('button', { name: 'Write a note' }).click(); await settle();
    // (12) contenteditable; (13) Ping.
    await page.getByLabel('Scratchpad').click(); await page.keyboard.type('hi'); await settle();
    await page.getByRole('button', { name: 'Ping' }).click(); await page.waitForTimeout(400);
    // (14) A form library that validates in a promise continuation, then calls the callback written inside onSubmit.
    await page.getByRole('button', { name: 'Save profile' }).click(); await page.waitForTimeout(400);
    // (15)-(19) one function held by two props / two holders.
    await page.getByRole('button', { name: /^Dual \d/u }).click(); await settle();
    await page.getByRole('button', { name: /^Dual event/u }).click(); await settle();
    await page.getByRole('button', { name: /^Dual event/u }).focus(); await page.keyboard.down('Enter'); await page.keyboard.up('Enter'); await settle();
    await page.getByRole('button', { name: 'Dual send' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Nested mixed/u }).click(); await settle();
    await page.getByRole('button', { name: /^Nested twice/u }).click(); await settle();
    // (20) analytics capture listener; (21) react-hook-form; (22) vendor callback; (23) el.click() from a timer a click armed.
    await page.getByRole('button', { name: 'Save real' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^State only/u }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Save then bubble' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Save RHF' }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Widget callback/u }).click(); await settle();
    await page.getByRole('button', { name: 'Schedule click' }).click(); await page.waitForTimeout(500);
    // (24)-(27) capture/bubble passes; a Proxy argument.
    await page.getByRole('button', { name: /^Capture and target/u }).click(); await settle();
    await page.getByRole('button', { name: /^Both phases/u }).click(); await settle();
    await page.getByRole('button', { name: /^Capture only/u }).click(); await settle();
    await page.getByRole('button', { name: 'Proxy pick' }).click(); await settle();
    proxyLogs.push(await page.evaluate(() => [...globalThis.__proxyLog]));
    sessions.push(await page.evaluate(() => globalThis.__productTraceRuntime.session));
    await page.goto('about:blank'); await page.waitForTimeout(800);
    await page.close();
    receivedPerRun.push(received.slice(before));
  }
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
await collector.close();
const manifestPath = path.join(fixture.repository, 'attribution-manifest.json');

// ---- raw rows (read here; nothing from the package computes an expectation)
const readRows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const records = readRows(path.join(storeDir, 'records.jsonl'));
const exportedChains = new Map(buildActionChains(records, [], { backendInstrumented: false }).map(chain => [chain.action_id, chain]));
// Function ids end in `:<start>:<end>` (original-source offsets): the functions
// under test are matched by their start offset in the fixture source.
const startOf = (text, offset = 0) => { const at = appSource.indexOf(text); if (at < 0) throw new Error(`fixture text ${text}`); return at + offset; };
const after = text => startOf(text, text.length);
const FN = {
  audit: startOf('function audit(event)'),
  notifyChange: startOf('event => setOn(event.target.checked)'),
  onSubscribe: after('const onSubscribe = '), onPlan: after('const onPlan = '),
  onTitle: after('const onTitle = '), onColor: after('const onColor = '), onVolume: after('const onVolume = '),
  onDoubleClick: startOf('() => setEditing(true)'),
  onKeyDown: after('const onKeyDown = '), onSubmit: after('const onSubmit = '),
  onValueChange: after('const onValueChange = '), onOpenChange: after('const onOpenChange = '),
  cartClick: startOf('() => add()'),
  contextMenu: startOf('event => { event.preventDefault(); setMenu(true); }'), archiveClick: startOf("() => send('/api/archive'"),
  noteClick: startOf('() => noteRef.current.focus()'), onNoteFocus: after('const onNoteFocus = '), onSearchFocus: after('const onSearchFocus = '),
  onTick: after('const onTick = '), scratchInput: after('const onInput = '), pingClick: startOf("() => send('/api/ping'"),
  profileSaved: startOf('values => setSaved(values.name)'),
  handleDual: after('const handleDual = '), handleDualEvent: after('const handleDualEvent = '), sendDual: after('const sendDual = '),
  handleNested: after('const handleNested = '), handleTwice: after('const handleTwice = '), track: startOf('function track(event)'),
  onSaveReal: after('const onSaveReal = '), onStateOnly: after('const onStateOnly = '), onValid: after('const onValid = '), viaCallback: after('const viaCallback = '),
  onTargetClick: after('const onTargetClick = '), schedule: after('const schedule = '),
  trackBody: startOf('function trackBody(event)'), bodyBubble: startOf('function bodyBubble(event)'), saveBubble: after('const saveBubble = '),
  handleTwoPhases: after('const handleTwoPhases = '), handleBothPhases: after('const handleBothPhases = '),
  handleCaptureOnly: after('const handleCaptureOnly = '), handleTargetOwn: after('const handleTargetOwn = '), choose: after('const choose = '),
  trapGet: startOf('get(target, key) {'), trapHas: startOf('has(target, key) {'), trapGopd: startOf('getOwnPropertyDescriptor(target, key) {'),
};
const NAME = Object.fromEntries(Object.entries(FN).map(([name, start]) => [start, name]));
const idStart = id => Number(String(id).split(':').at(-2));
const nameOf = id => (id ? NAME[idStart(id)] || `other@${idStart(id)}` : null);

let client = null;
const call = async (name, args) => { const reply = await client.callTool({ name, arguments: args }); return { ...reply.structuredContent, text: reply.content[0].text }; };
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const report = { sessions: [], facts: [] };
try {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(tracerRoot, 'mcp/server.mjs'), '--store', storeDir, '--manifest', manifestPath], stderr: 'ignore' });
  client = new Client({ name: 'handler-binding', version: '1' });
  await client.connect(transport);
  check('B0 the pages ran without errors', pageErrors.length === 0, pageErrors);
  for (const [run, session] of sessions.entries()) {
    const tag = `run ${run + 1}`;
    const rows = records.filter(row => row.capture_page_id === session);
    const actions = rows.filter(row => row.kind === 'dom.action');
    const byId = new Map(actions.map(row => [row.action_id, row]));
    const bindings = rows.filter(row => row.kind === 'handler.binding'), invocations = rows.filter(row => row.kind === 'handler.invocation');
    const enters = rows.filter(row => row.kind === 'function.enter');
    const requests = rows.filter(row => row.kind === 'network.request' && row.internal !== true && row.transport_internal !== true);
    const label = row => row?.target?.attributes?.['aria-label'] || null;
    const on = (event, name) => actions.filter(row => row.event === event && label(row) === name);
    const bindingsOf = action => bindings.filter(row => row.action_id === action?.action_id);
    const bound = (action, fn, prop, native) => bindingsOf(action).some(row => idStart(row.function_id) === FN[fn] && row.prop_name === prop && row.native_event_type === native);
    const owner = url => { const request = requests.find(row => row.url === url); return request ? byId.get(request.action_id) || null : null; };
    const page = rows.find(row => row.kind === 'capture.page');
    const chainOf = async action => (action ? call('action_chain', { action_id: action.action_id }) : null);
    const credit = chain => nameOf(chain?.stops?.find(stop => stop.stop === 'entry_handler')?.function_id);
    const fact = async (name, action, extra = {}) => {
      const chain = await chainOf(action);
      report.facts.push({ run: run + 1, case: name, event: action?.event ?? null, credited: credit(chain), stopped_at: chain?.stopped_at ?? null,
        because: chain?.stopped_at === 'entry_handler' ? chain.because : undefined, observed: bindingsOf(action).map(row => `${nameOf(row.function_id)} as ${row.prop_name} on ${row.native_event_type} (${row.invoked_by})`), ...extra });
      return chain;
    };

    // Received by the backend in this page load (the tiny backend's own log).
    const expectedRequests = ['/api/subscribe?checked=true', '/api/plan?value=pro', '/api/title?length=1', '/api/title?length=2', '/api/color?value=blue', '/api/volume?value=6',
      '/api/search?q=x', '/api/fruit?value=banana', '/api/fruit?value=cherry', '/api/dialog-closed?n=1', '/api/dialog-closed?n=2', '/api/archive',
      '/api/note-focused', '/api/autofocus-seen', '/api/scratch?length=1', '/api/scratch?length=2', '/api/ping', '/api/dual-send', '/api/real', '/api/programmatic?trusted=false', '/api/analytics-body?tag=BUTTON'];
    const got = receivedPerRun[run].map(entry => entry.split(' ')[1]);
    check(`${tag} B1 the backend received every request the session makes (the store's rows are compared below)`, expectedRequests.every(url => got.includes(url)), got);
    if (!factsOnly) check(`${tag} B2 capture.page states handler bindings are observed`, page?.handler_bindings === 'observed', page?.handler_bindings);

    // (1) The checkbox whose onChange only writes state.
    const [notifyMouse, notifySpace] = on('click', 'Notify');
    const notifyChanges = on('change', 'Notify');
    const notifyChain = await fact('checkbox onChange (state only), mouse click', notifyMouse);
    await fact('checkbox onChange (state only), Space key', notifySpace);
    if (!factsOnly) {
      check(`${tag} C1 checkbox (state only): both clicks (mouse, and the click Space causes) carry a binding of its onChange to "click", run by React, held by the <input> host fiber`,
        [notifyMouse, notifySpace].every(action => bindingsOf(action).some(row => idStart(row.function_id) === FN.notifyChange && row.prop_name === 'onChange' && row.native_event_type === 'click'
          && row.invoked_by === 'react_event_system' && row.fiber?.kind === 'host' && row.fiber?.name === 'input' && row.ran === 'during_dispatch')), [notifyMouse, notifySpace].map(bindingsOf));
      check(`${tag} C2 the native change events on that checkbox ran no handler (no binding), and the keydown/keyup of Space none either`,
        notifyChanges.length === 2 && notifyChanges.every(action => !bindingsOf(action).length)
          && actions.filter(row => (row.event === 'keydown' || row.event === 'keyup') && label(row) === 'Notify').every(action => !bindingsOf(action).length), notifyChanges.map(row => row.action_id));
      check(`${tag} C3 checkbox chain: credited handler = its onChange (not the audit listener that ran first); no abstention; bound phrase in the text`,
        credit(notifyChain) === 'notifyChange' && notifyChain.stopped_at !== 'entry_handler' && notifyChain.text.includes('[bound: onChange on click (React)]')
          && enters.some(row => row.action_id === notifyMouse.action_id && idStart(row.function_id) === FN.audit && row.spine.function_ids.length === 1), notifyChain?.text?.split('\n')[0]);
    }
    // (2) Checkbox and radio that send requests.
    const subscribe = owner('/api/subscribe?checked=true'), plan = owner('/api/plan?value=pro');
    await fact('checkbox onChange (request)', subscribe); await fact('radio onChange (request)', plan);
    if (!factsOnly) check(`${tag} C4 checkbox and radio with requests: owned by their click, whose binding is onChange on click`,
      subscribe?.event === 'click' && bound(subscribe, 'onSubscribe', 'onChange', 'click') && plan?.event === 'click' && bound(plan, 'onPlan', 'onChange', 'click'), [subscribe?.event, plan?.event]);
    // (3) Text, select, range.
    const titles = ['/api/title?length=1', '/api/title?length=2'].map(owner), color = owner('/api/color?value=blue'), volume = owner('/api/volume?value=6');
    await fact('text onChange', titles[0]); await fact('select onChange', color); await fact('range onChange', volume);
    if (!factsOnly) {
      check(`${tag} C5 text input: each keystroke's request is owned by its input event, bound onChange on input; its keydowns bind nothing`,
        titles.every(action => action?.event === 'input' && bound(action, 'onTitle', 'onChange', 'input'))
          && actions.filter(row => row.event === 'keydown' && label(row) === 'Title').every(action => !bindingsOf(action).length), titles.map(row => row?.event));
      check(`${tag} C6 <select>: onChange bound on change; range: onChange bound on input, and the range's later change event ran nothing`,
        color?.event === 'change' && bound(color, 'onColor', 'onChange', 'change') && volume?.event === 'input' && bound(volume, 'onVolume', 'onChange', 'input')
          && on('change', 'Volume').every(action => !bindingsOf(action).length), { color: color?.event, volume: volume?.event, volumeChanges: on('change', 'Volume').length });
    }
    // (4) Double-click (state only).
    const dbl = on('dblclick', 'Project name')[0];
    const dblClicks = on('click', 'Project name');
    const dblChain = await fact('onDoubleClick (state only)', dbl);
    const dblClickChain = await fact('click before the double-click (no element handler)', dblClicks[0]);
    if (!factsOnly) {
      check(`${tag} C7 onDoubleClick is bound on dblclick and credited (no abstention)`, bound(dbl, 'onDoubleClick', 'onDoubleClick', 'dblclick') && credit(dblChain) === 'onDoubleClick' && dblChain.stopped_at !== 'entry_handler', dblChain?.text?.split('\n')[0]);
      check(`${tag} C8 the two clicks of that double-click ran no element handler: each abstains "no element-bound handler ran" and names the audit listener`,
        dblClicks.length === 2 && !dblClicks.some(action => bindingsOf(action).length) && dblClickChain?.stopped_at === 'entry_handler'
          && dblClickChain.because.startsWith('no element-bound handler ran:') && !dblClickChain.because.includes('function:')
          && ['audit', 'track', 'trackBody', 'bodyBubble'].every(name => dblClickChain.because.includes(name))
          && (dblClickChain.chain?.handler_abstention?.global_listeners || []).map(nameOf).sort().join() === 'audit,bodyBubble,track,trackBody', dblClickChain?.because);
    }
    // (5) Enter in a form.
    const search = owner('/api/search?q=x');
    const enter = actions.find(row => row.event === 'keydown' && label(row) === 'Query' && row.key?.key === 'Enter');
    await fact('onKeyDown Enter in a form', enter); await fact('onSubmit', search);
    if (!factsOnly) check(`${tag} C9 Enter: onKeyDown bound on keydown; the implicit submit's onSubmit bound on submit and owns the request`,
      bound(enter, 'onKeyDown', 'onKeyDown', 'keydown') && search?.event === 'submit' && bound(search, 'onSubmit', 'onSubmit', 'submit'), { enter: bindingsOf(enter), search: search?.event });
    // (6) Radix Select.
    const banana = owner('/api/fruit?value=banana'), cherry = owner('/api/fruit?value=cherry');
    await fact('Radix Select onValueChange (pointer)', banana); await fact('Radix Select onValueChange (keyboard)', cherry);
    if (!factsOnly) check(`${tag} C10 Radix Select: onValueChange (a prop of the Select root component, reached through the portal) bound on pointerup for the mouse choice and on keydown for the keyboard choice, run by React`,
      banana?.event === 'pointerup' && cherry?.event === 'keydown' && [banana, cherry].every(action => bindingsOf(action).some(row => idStart(row.function_id) === FN.onValueChange
        && row.prop_name === 'onValueChange' && row.fiber?.kind === 'component' && row.invoked_by === 'react_event_system' && row.native_event_type === action.event)),
      { banana: bindingsOf(banana), cherry: bindingsOf(cherry) });
    // (7) Radix Dialog.
    const escape = owner('/api/dialog-closed?n=1'), overlay = owner('/api/dialog-closed?n=2');
    const openClicks = actions.filter(row => row.event === 'click' && bound(row, 'onOpenChange', 'onOpenChange', 'click'));
    await fact('Radix Dialog onOpenChange (Escape)', escape); await fact('Radix Dialog onOpenChange (overlay)', overlay);
    if (!factsOnly) check(`${tag} C11 Radix Dialog: onOpenChange bound on click for both opens (React), on keydown for Escape and on pointerdown for the overlay (Radix's document listeners)`,
      openClicks.length === 2 && escape?.event === 'keydown' && escape.key?.key === 'Escape' && overlay?.event === 'pointerdown'
        && [escape, overlay].every(action => bindingsOf(action).some(row => idStart(row.function_id) === FN.onOpenChange && row.invoked_by === 'native_listener' && row.listener_on === 'document'
          && row.native_event_type === action.event && row.fiber?.kind === 'component')), { escape: bindingsOf(escape), overlay: bindingsOf(overlay) });
    // (8) zustand.
    // The Add-to-cart click: by its binding, else (a runtime without bindings, for the facts table) by the click that owns the store sync.
    const cartSync = owner('/api/cart-sync?count=1');
    const cart = actions.find(row => row.event === 'click' && row.target?.tag === 'button' && bound(row, 'cartClick', 'onClick', 'click')) || (factsOnly && cartSync?.event === 'click' ? cartSync : null);
    const cartChain = await fact('zustand store write (onClick)', cart, { cart_sync_owner: owner('/api/cart-sync?count=1')?.event ?? null });
    if (!factsOnly) check(`${tag} C12 zustand: the store-writing onClick is bound on click and credited; the subscriber effect's request is ${owner('/api/cart-sync?count=1') ? 'owned' : 'listed, not owned'} (reported, not asserted)`,
      Boolean(cart) && credit(cartChain) === 'cartClick' && cartChain.stopped_at !== 'entry_handler', cartChain?.text?.split('\n')[0]);
    // (9) Declared, never run.
    const archive = owner('/api/archive');
    await fact('Archive onClick (onContextMenu declared, never run)', archive);
    if (!factsOnly) check(`${tag} C13 onContextMenu is declared (in the click's declared list) but never observed: no binding, invocation or function.enter for it`,
      archive?.event === 'click' && bound(archive, 'archiveClick', 'onClick', 'click') && (archive.bound_handlers?.ids || []).some(id => idStart(id) === FN.contextMenu)
        && ![...bindings, ...invocations, ...enters].some(row => idStart(row.function_id) === FN.contextMenu), archive?.bound_handlers);
    // (10) onFocus fired by app code.
    const noteClick = actions.find(row => row.event === 'click' && bound(row, 'noteClick', 'onClick', 'click'));
    const noteFocus = invocations.find(row => idStart(row.function_id) === FN.onNoteFocus);
    const autofocus = invocations.find(row => idStart(row.function_id) === FN.onSearchFocus);
    report.facts.push({ run: run + 1, case: 'onFocus from .focus() in a click handler', invocation: noteFocus ? { action_event: byId.get(noteFocus.action_id)?.event, invoked_by: noteFocus.invoked_by, caused_by_is_click: noteFocus.caused_by_action_id === noteClick?.action_id } : null,
      request_owner: owner('/api/note-focused')?.event ?? null });
    report.facts.push({ run: run + 1, case: 'onFocus from .focus() in a mount timer', invocation: autofocus ? { action_event: byId.get(autofocus.action_id)?.event, invoked_by: autofocus.invoked_by, cause_abstained: autofocus.cause_abstained ?? null } : null,
      request_owner: owner('/api/autofocus-seen')?.event ?? null });
    if (!factsOnly) {
      check(`${tag} C14 .focus() in a click handler: onFocus is an invocation by app code (dispatched by React on the caused focusin), caused by that click; never a binding`,
        Boolean(noteFocus) && noteFocus.invoked_by === 'app_code' && noteFocus.dispatched_by === 'react_event_system' && noteFocus.native_event_type === 'focusin' && noteFocus.caused_by_action_id === noteClick?.action_id
          && byId.get(noteFocus.action_id)?.gesture === false && byId.get(noteFocus.action_id)?.runs_on_action_id === noteClick?.action_id
          && !bindings.some(row => idStart(row.function_id) === FN.onNoteFocus) && owner('/api/note-focused')?.action_id === noteClick?.action_id, noteFocus);
      check(`${tag} C15 .focus() from a mount timer: onFocus is an invocation by app code with the cause abstained (no action on the timer); never a binding`,
        Boolean(autofocus) && autofocus.invoked_by === 'app_code' && autofocus.caused_by_action_id === null && Boolean(autofocus.cause_abstained)
          && !bindings.some(row => idStart(row.function_id) === FN.onSearchFocus), autofocus);
      check(`${tag} C16 a prop a component calls from a timer (onTick) is neither a binding nor an invocation`,
        ![...bindings, ...invocations].some(row => idStart(row.function_id) === FN.onTick), null);
    }
    // (12) contenteditable; (13) Ping behind the audit listener.
    const scratch = ['/api/scratch?length=1', '/api/scratch?length=2'].map(owner), ping = owner('/api/ping');
    await fact('contenteditable onInput', scratch[0]);
    const pingChain = await fact('Ping onClick (audit capture listener ran first)', ping);
    if (!factsOnly) {
      check(`${tag} C17 contenteditable: onInput bound on input for each typed character`, scratch.every(action => action?.event === 'input' && bound(action, 'scratchInput', 'onInput', 'input')), scratch.map(row => row?.event));
      check(`${tag} C18 Ping: the audit listener entered first at depth zero, yet the credit is Ping's onClick (the handler observed bound, which issued the request)`,
        credit(pingChain) === 'pingClick' && bound(ping, 'pingClick', 'onClick', 'click')
          && ['audit', 'track', 'trackBody'].includes(enters.filter(row => row.action_id === ping.action_id && row.spine.function_ids.length === 1).map(row => nameOf(row.function_id))[0]), pingChain?.text?.split('\n')[0]);
      // (14) The form library's continuation.
      // A submit's target is its submitter; the form is on `form`.
      const profileSubmit = actions.find(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'Profile');
      const profileChain = await fact('callback written inside onSubmit, called by a form library in a promise continuation', profileSubmit);
      check(`${tag} C19 form library: the callback written inside onSubmit, called from a promise continuation the submit created, is bound to the submit (ran: dispatch_continuation, via written_in_prop) and credited`,
        bindingsOf(profileSubmit).some(row => idStart(row.function_id) === FN.profileSaved && row.prop_name === 'onSubmit' && row.via === 'written_in_prop' && row.ran === 'dispatch_continuation'
          && row.invoked_by === 'dispatch_continuation') && credit(profileChain) === 'profileSaved' && profileChain.stopped_at !== 'entry_handler', { rows: bindingsOf(profileSubmit), line: profileChain?.text?.split('\n')[0] });
      // (15)-(19) One function, several holders: decided from React's SyntheticEvent, else ambiguous, never prop order.
      const heldBy = (fn, action) => bindingsOf(action).filter(row => idStart(row.function_id) === FN[fn]);
      const clickOf = fn => actions.find(row => row.event === 'click' && heldBy(fn, row).length);
      const dualClick = clickOf('handleDual');
      const dualRows = heldBy('handleDual', dualClick);
      const dualChain = await fact('one no-argument function on onKeyDown and onClick (click)', dualClick);
      check(`${tag} C20 onKeyDown={h} onClick={h}, h takes no event: the click's binding is ambiguous (prop_name null, holders onKeyDown and onClick), never "onKeyDown on click"`,
        dualRows.length === 1 && dualRows[0].ambiguous === true && dualRows[0].prop_name === null && dualRows[0].holders.map(row => row.prop).sort().join() === 'onClick,onKeyDown'
          && !bindings.some(row => idStart(row.function_id) === FN.handleDual && row.prop_name === 'onKeyDown' && row.native_event_type === 'click')
          && credit(dualChain) === 'handleDual' && /ambiguous/u.test(dualChain.text) && !dualChain.text.includes('[bound: onKeyDown on click'), { rows: dualRows, line: dualChain?.text?.split('\n')[0] });
      const dualEventClick = actions.find(row => row.event === 'click' && row.pointer?.pointerType === 'mouse' && heldBy('handleDualEvent', row).length);
      const dualEventKey = actions.find(row => row.event === 'keydown' && row.key?.key === 'Enter' && heldBy('handleDualEvent', row).length);
      await fact('one function with an event parameter on onKeyDown and onClick (mouse click)', dualEventClick);
      check(`${tag} C21 the same with an event parameter: the mouse click binds onClick, Enter's keydown binds onKeyDown (holder_resolution synthetic_event)`,
        heldBy('handleDualEvent', dualEventClick).map(row => `${row.prop_name}/${row.holder_resolution}`).join() === 'onClick/synthetic_event'
          && heldBy('handleDualEvent', dualEventKey).map(row => `${row.prop_name}/${row.holder_resolution}`).join() === 'onKeyDown/synthetic_event',
        { click: heldBy('handleDualEvent', dualEventClick), key: heldBy('handleDualEvent', dualEventKey) });
      const dualSend = requests.filter(row => row.url === '/api/dual-send').map(row => byId.get(row.action_id)).find(action => action?.event === 'click');
      const dualSendChain = await fact('onPointerDown={s} onClick={s}, s sends (click)', dualSend);
      check(`${tag} C22 onPointerDown={s} onClick={s} with a request: the click owns it and credits s; its binding is ambiguous, never "[bound: onPointerDown on click"`,
        dualSend?.event === 'click' && credit(dualSendChain) === 'sendDual' && heldBy('sendDual', dualSend).every(row => row.ambiguous === true && row.prop_name === null)
          && !dualSendChain.text.includes('[bound: onPointerDown on click'), dualSendChain?.text?.split('\n')[0]);
      const mixedClick = clickOf('handleNested'), mixedDown = actions.find(row => row.event === 'mousedown' && heldBy('handleNested', row).length);
      await fact('target onMouseDown={h}, ancestor onClick={h} (click)', mixedClick);
      check(`${tag} C23 target onMouseDown={h}, ancestor onClick={h}: the click binds the ancestor div's onClick; the mousedown binds the button's onMouseDown`,
        heldBy('handleNested', mixedClick).map(row => `${row.prop_name}/${row.fiber?.name}/${row.holder_resolution}`).join() === 'onClick/div/synthetic_event'
          && heldBy('handleNested', mixedDown).map(row => `${row.prop_name}/${row.fiber?.name}`).join() === 'onMouseDown/button', { click: heldBy('handleNested', mixedClick), down: heldBy('handleNested', mixedDown) });
      const twiceClick = clickOf('handleTwice');
      check(`${tag} C24 target and ancestor both onClick={h}: React ran h twice, two bindings (button, then div)`,
        heldBy('handleTwice', twiceClick).map(row => `${row.prop_name}/${row.fiber?.name}`).join() === 'onClick/button,onClick/div', heldBy('handleTwice', twiceClick));
      // (20) A sending capture listener never outranks the bound handler.
      const real = owner('/api/real');
      const stateOnly = clickOf('onStateOnly');
      const realChain = await fact('bound onClick beside a sending document capture listener', real);
      const stateChain = await fact('state-only onClick beside a sending document capture listener', stateOnly);
      const analyticsOwners = requests.filter(row => row.url.startsWith('/api/analytics')).map(row => row.action_id);
      const issuers = chain => chain?.stops?.find(stop => stop.stop === 'entry_handler')?.unbound_request_issuers || [];
      check(`${tag} C25 analytics listener: Save real credits onSaveReal and State only credits onStateOnly, never track; track's analytics requests (owned by the same clicks) are listed as issued by an unbound frame`,
        credit(realChain) === 'onSaveReal' && credit(stateChain) === 'onStateOnly' && analyticsOwners.includes(real?.action_id) && analyticsOwners.includes(stateOnly?.action_id)
          && [realChain, stateChain].every(chain => ['track', 'trackBody'].every(name => issuers(chain).some(issuer => nameOf(issuer.function_id) === name)) && chain.text.includes('Requests issued by a frame not bound to this element'))
          && !rows.some(row => row.kind?.startsWith('handler.') && idStart(row.function_id) === FN.trackBody),
        { real: realChain?.text?.split('\n').slice(0, 3), state: stateChain?.text?.split('\n').slice(0, 3) });
      const bubbleAction = owner('/api/save-bubble');
      const saveRequest = requests.find(row => row.url === '/api/save-bubble' && row.action_id === bubbleAction?.action_id);
      const bodyRequest = requests.find(row => row.url === '/api/body-bubble' && row.action_id === bubbleAction?.action_id);
      const bubbleChain = await fact('bound request before body bubble request', bubbleAction);
      const bubbleHistory = bubbleAction?.target?.element_key ? await call('element_history', { element_key: bubbleAction.target.element_key }) : null;
      const bubbleExport = exportedChains.get(bubbleAction?.action_id);
      const hasBodyIssuer = value => value?.unbound_request_issuers?.some(row => idStart(row.function_id) === FN.bodyBubble
        && row.request_occurrence_ids?.includes(bodyRequest?.request_occurrence_id));
      check(`${tag} C34 bound save request precedes an unbound body bubble request: action_chain, element_history and export label the body issuer while crediting saveBubble`,
        saveRequest && bodyRequest?.request_occurrence_id && saveRequest.sequence < bodyRequest.sequence && bubbleAction?.event === 'click'
          && credit(bubbleChain) === 'saveBubble' && bubbleChain?.stops?.find(stop => stop.stop === 'entry_handler')?.binding?.prop_name === 'onClick'
          && hasBodyIssuer(bubbleChain?.stops?.find(stop => stop.stop === 'entry_handler'))
          && bubbleChain.text.includes('Requests issued by a frame not bound to this element')
          && bubbleChain.requests.some(row => row.url === '/api/save-bubble') && bubbleChain.requests.some(row => row.url === '/api/body-bubble')
          && hasBodyIssuer(bubbleHistory?.actions?.find(row => row.action_id === bubbleAction.action_id)?.entry_handler)
          && bubbleExport?.entry_handler?.function_id === bubbleChain?.stops?.find(stop => stop.stop === 'entry_handler')?.function_id
          && hasBodyIssuer(bubbleExport?.entry_handler)
          && !bindingsOf(bubbleAction).some(row => idStart(row.function_id) === FN.bodyBubble),
        { requests: [saveRequest?.sequence, bodyRequest?.sequence], chain: bubbleChain?.stops?.find(stop => stop.stop === 'entry_handler'),
          history: bubbleHistory?.actions?.find(row => row.action_id === bubbleAction?.action_id)?.entry_handler, export: bubbleExport?.entry_handler });
      // (21)-(22) Library-mediated first-party code is named as such, never as a global listener.
      const rhfSubmit = actions.find(row => row.event === 'submit' && row.form?.attributes?.['aria-label'] === 'RHF named');
      const rhfChain = await fact('react-hook-form handleSubmit(onValid), onValid named, state only', rhfSubmit);
      const widgetClick = actions.find(row => row.event === 'click' && label(row) === 'Widget callback');
      const widgetChain = await fact('vendor component calling a non-on* callback prop', widgetClick);
      const libraryOk = (chain, fn) => chain?.stopped_at === 'entry_handler' && chain.because.startsWith('no element-bound handler of instrumented code ran; ran through library code on the element chain')
        && (chain.chain?.handler_abstention?.ran_via_library || []).some(id => nameOf(id) === fn) && !(chain.chain?.handler_abstention?.global_listeners || []).some(id => nameOf(id) === fn);
      check(`${tag} C26 react-hook-form with a named onValid (state only): "ran through library code … [onValid]", onValid never a global listener`, libraryOk(rhfChain, 'onValid'), rhfChain?.because);
      check(`${tag} C27 vendor component calling a callback prop: "ran through library code … [viaCallback]", never a global listener`, libraryOk(widgetChain, 'viaCallback'), widgetChain?.because);
      // (23) el.click() from app code.
      const scheduleClick = clickOf('schedule');
      const untrusted = invocations.filter(row => row.untrusted === true && idStart(row.function_id) === FN.onTargetClick);
      const scheduleChain = scheduleClick ? await call('action_chain', { action_id: scheduleClick.action_id }) : null;
      check(`${tag} C28 el.click() from a timer a click armed: handler.invocation (untrusted, app_code) caused by that click; from a mount timer: cause abstained; the click's chain lists it`,
        untrusted.some(row => row.caused_by_action_id === scheduleClick?.action_id && row.invoked_by === 'app_code' && row.native_event_type === 'click' && row.prop_name === 'onClick')
          && untrusted.some(row => row.caused_by_action_id === null && Boolean(row.cause_abstained)) && requests.some(row => row.url === '/api/programmatic?trusted=false' && row.action_id === scheduleClick?.action_id)
          && scheduleChain?.text?.includes('untrusted: el.click() or dispatchEvent'), { untrusted, text: scheduleChain?.text });
      // (24)-(26) Capture and bubble passes, decided from the dispatch phase; nearness decides the credit.
      const rowsFor = fn => bindings.filter(row => idStart(row.function_id) === FN[fn]);
      const phaseRows = fn => rowsFor(fn).map(row => `${row.prop_name}/${row.fiber?.name}/${row.holder_resolution}`).sort().join();
      check(`${tag} C29 ancestor onClickCapture={h}, target onClick={h}: two rows in one click, onClickCapture on the div and onClick on the button, both synthetic_event`,
        phaseRows('handleTwoPhases') === 'onClick/button/synthetic_event,onClickCapture/div/synthetic_event' && new Set(rowsFor('handleTwoPhases').map(row => row.action_id)).size === 1, rowsFor('handleTwoPhases'));
      check(`${tag} C30 one div with onClickCapture={h} onClick={h}, click on a child: two rows, onClickCapture and onClick, both on the div`,
        phaseRows('handleBothPhases') === 'onClick/div/synthetic_event,onClickCapture/div/synthetic_event', rowsFor('handleBothPhases'));
      const captureOnlyClick = actions.find(row => row.event === 'click' && rowsFor('handleCaptureOnly').some(binding => binding.action_id === row.action_id));
      const captureChain = await fact('ancestor onClickCapture={h} onKeyDown={h}, target onClick={g}', captureOnlyClick);
      check(`${tag} C31 ancestor onClickCapture={h} onKeyDown={h}, target onClick={g}: h binds onClickCapture (not ambiguous); the credit is g, the nearer holder`,
        phaseRows('handleCaptureOnly') === 'onClickCapture/div/synthetic_event' && credit(captureChain) === 'handleTargetOwn', { rows: rowsFor('handleCaptureOnly'), line: captureChain?.text?.split('\n')[0] });
      // (27) Tracer's read of a Proxy argument creates no evidence.
      const trapIds = [FN.trapGet, FN.trapHas, FN.trapGopd];
      const proxyLog = proxyLogs[run] || [];
      const chooseRows = rowsFor('choose');
      check(`${tag} C32 Proxy argument: Tracer's read calls no getter (no get of _reactName/nativeEvent in the app's log); the trap it does reach (getOwnPropertyDescriptor) leaves no function.enter or handler.* row; the library's call (argument not React's event) binds the component prop onSelect (library_call), React's own call binds the div's onClick (synthetic_event)`,
        !proxyLog.some(entry => /^get:(_reactName|nativeEvent|currentTarget)$/u.test(entry)) && proxyLog.some(entry => entry === 'gopd:_reactName')
          && !rows.some(row => (row.kind === 'function.enter' || row.kind?.startsWith('handler.')) && trapIds.includes(idStart(row.function_id)))
          && chooseRows.some(row => row.prop_name === 'onSelect' && row.fiber?.name === 'ProxyPicker' && row.holder_resolution === 'library_call')
          && chooseRows.some(row => row.prop_name === 'onClick' && row.fiber?.name === 'div' && row.holder_resolution === 'synthetic_event'),
        { proxyLog, chooseRows, trapRows: rows.filter(row => trapIds.includes(idStart(row.function_id))).map(row => row.kind) });
      const ambiguousTexts = [dualChain, dualSendChain].map(chain => chain?.text || '');
      check(`${tag} C33 ambiguity text states the observed reason, never "took no event argument"`,
        ambiguousTexts.every(text => /ambiguous: the handler received no argument/u.test(text) && !text.includes('took no event argument')), ambiguousTexts.map(text => text.split('\n')[0]));
      // Rules over every row.
      check(`${tag} R1 every binding is on a user's dispatch (not gesture:false) of the kind it names, for a function that entered at depth zero on that action; audit and onTick never bind`,
        bindings.length > 0 && bindings.every(row => { const action = byId.get(row.action_id); return action && action.gesture !== false && action.event === row.native_event_type && row.event_kind === action.event
          && enters.some(enterRow => enterRow.continuation_id === row.continuation_id && enterRow.function_id === row.function_id && enterRow.spine.function_ids.length === 1
            && (row.ran === 'during_dispatch' ? enterRow.invoked_by === 'event' : enterRow.invoked_by !== 'render' && enterRow.invoked_by !== 'effect')); })
          && !bindings.some(row => [FN.audit, FN.track, FN.trackBody, FN.onTick].includes(idStart(row.function_id))), bindings.filter(row => byId.get(row.action_id)?.gesture === false || byId.get(row.action_id)?.event !== row.native_event_type).slice(0, 3));
      check(`${tag} R2 every trusted invocation is on a caused dispatch (gesture:false); untrusted ones carry untrusted:true`, invocations.filter(row => !row.untrusted).length >= 2
        && invocations.every(row => row.untrusted === true || byId.get(row.action_id)?.gesture === false), invocations.length);
      const pairs = new Set(bindings.map(row => `${row.prop_name}@${row.native_event_type}`));
      const wanted = ['onChange@click', 'onChange@input', 'onChange@change', 'onDoubleClick@dblclick', 'onKeyDown@keydown', 'onSubmit@submit', 'onValueChange@pointerup', 'onValueChange@keydown',
        'onOpenChange@click', 'onOpenChange@keydown', 'onOpenChange@pointerdown', 'onInput@input', 'onClick@click'];
      check(`${tag} R3 prop/event pairs observed, none declared: ${wanted.join(', ')}`, wanted.every(pair => pairs.has(pair)), [...pairs].sort());
      check(`${tag} R6 an ambiguous binding lists at least two distinct (prop, holder) pairs; the inline single-prop handlers (onDoubleClick, Ping, Archive) are resolved, not ambiguous`,
        bindings.filter(row => row.ambiguous).every(row => new Set(row.holders.map(holder => `${holder.prop}@${holder.fiber?.depth}`)).size >= 2)
          && bindings.filter(row => [FN.onDoubleClick, FN.pingClick, FN.archiveClick, FN.cartClick].includes(idStart(row.function_id))).every(row => !row.ambiguous && row.fiber),
        bindings.filter(row => row.ambiguous).map(row => row.holders));
      check(`${tag} R4 one binding row per (action, function, prop, holder): no duplicates`,
        new Set(bindings.map(row => `${row.action_id}|${row.function_id}|${row.prop_name}|${row.via}|${row.fiber?.depth}`)).size === bindings.length, bindings.length);
      check(`${tag} R5 the store holds a row for every request the backend received (same paths)`, expectedRequests.every(url => requests.some(row => row.url === url)), requests.map(row => row.url));

      // MCP over stdio (black box), compared with the raw rows.
      const notifyKey = notifyMouse?.target?.element_key, archiveKey = archive?.target?.element_key;
      const resolved = notifyKey ? await call('resolve_element', { element_key: notifyKey }) : null;
      const notifyObserved = resolved?.observed_bindings?.find(row => row.kind === 'binding' && idStart(row.function_id) === FN.notifyChange);
      // resolve_element covers the whole store (every page load stamps the same key): count the raw rows store-wide.
      const keyActions = new Set(records.filter(row => row.kind === 'dom.action' && row.target?.element_key === notifyKey).map(row => row.action_id));
      const rawNotifyCount = new Set(records.filter(row => row.kind === 'handler.binding' && keyActions.has(row.action_id) && idStart(row.function_id) === FN.notifyChange).map(row => row.action_id)).size;
      check(`${tag} M1 resolve_element(Notify): observed bindings listed before the declared handlers; onChange on click ×${rawNotifyCount} (the raw store-wide count), handlers_basis declared; the summary says "observed:" first`,
        Boolean(notifyObserved) && notifyObserved.prop_name === 'onChange' && notifyObserved.native_event_type === 'click' && notifyObserved.count === rawNotifyCount && resolved.handlers_basis === 'declared'
          && Object.keys(resolved).indexOf('observed_bindings') < Object.keys(resolved).indexOf('handlers') && /observed: .* as onChange on click \(React\) ×\d+/u.test(resolved.summary)
          && resolved.summary.indexOf('observed:') < resolved.summary.indexOf('Last:'), resolved?.summary);
      const archived = archiveKey ? await call('resolve_element', { element_key: archiveKey }) : null;
      check(`${tag} M2 resolve_element(Archive): observed only onClick; onContextMenu named "declared, never observed running"`,
        archived?.observed_bindings?.every(row => idStart(row.function_id) === FN.archiveClick) && archived.handlers.some(row => idStart(row.function_id) === FN.contextMenu)
          && new RegExp(`declared, never observed running: [^;]*main\\.jsx@${FN.contextMenu}-`, 'u').test(archived.summary)
          && !new RegExp(`observed: [^.]*@${FN.contextMenu}-`, 'u').test(archived.summary), archived?.summary);
      const history = notifyKey ? await call('element_history', { element_key: notifyKey }) : null;
      check(`${tag} M3 element_history(Notify): the summary prints the observed binding before the newest chain`, /observed: .* as onChange on click \(React\)/u.test(history?.summary || '')
        && history.summary.indexOf('observed:') < history.summary.indexOf('newest:'), history?.summary);
      check(`${tag} M4 action_chain(Notify click): bound_handlers.observed lists onChange on click; declared list present; entry_handler stop carries the binding`,
        notifyChain?.bound_handlers?.observed?.some(row => idStart(row.function_id) === FN.notifyChange && row.native_event_type === 'click' && row.kind === 'binding')
          && Array.isArray(notifyChain.bound_handlers.declared?.ids) && notifyChain.stops.find(stop => stop.stop === 'entry_handler')?.binding?.prop_name === 'onChange'
          && notifyChain.text.includes('Observed bound to this dispatch:'), notifyChain?.bound_handlers);
      const focusAction = noteFocus ? byId.get(noteFocus.action_id) : null;
      const focusChain = focusAction ? await call('action_chain', { action_id: focusAction.action_id }) : null;
      check(`${tag} M5 action_chain(caused focusin): the handler is listed as run for a dispatch app code caused, not as a binding`,
        focusChain?.bound_handlers?.observed?.some(row => row.kind === 'invocation' && idStart(row.function_id) === FN.onNoteFocus) && focusChain.text.includes('Ran for a dispatch app code caused (not a user event):')
          && !focusChain.text.includes('Observed bound to this dispatch:'), focusChain?.text);
      const dblMcp = dblClicks[1] ? await call('action_chain', { action_id: dblClicks[1].action_id }) : null;
      check(`${tag} M6 action_chain(the second click of the double-click): stopped at entry_handler "no element-bound handler ran", no observed binding`,
        dblMcp?.stopped_at === 'entry_handler' && dblMcp.because.startsWith('no element-bound handler ran:') && (dblMcp.bound_handlers?.observed || []).length === 0, dblMcp?.because);
    }
    report.sessions.push({ session, actions: actions.length, bindings: bindings.length, invocations: invocations.length,
      pairs: [...new Set(bindings.map(row => `${row.prop_name}@${row.native_event_type}`))].sort() });
  }
} finally {
  await client?.close();
}

const failed = checks.filter(entry => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.pass ? '' : `\n  ${String(JSON.stringify(entry.detail)).slice(0, 2500)}`}`);
console.log('FACTS');
for (const row of report.facts) console.log(JSON.stringify(row));
console.log(JSON.stringify(report.sessions, null, 2));
console.log(`${checks.length - failed.length}/${checks.length} checks pass over ${sessions.length} page loads; store ${storeDir}`);
if (!keep && !failed.length) { fs.rmSync(storeDir, { recursive: true, force: true }); fixture.cleanup(); }
else console.log(`kept store ${storeDir} and fixture ${fixture.repository}`);
if (failed.length) process.exitCode = 1;
