// Episode focus (headless): a focus that happens as part of one action's work
// belongs to that action, and an episode member never prints the carrier's
// chain. Neutral fixture (fixtures/episode-focus-app), driven three times:
//   (a) "Remove auto" opens a portal confirm dialog whose button takes focus
//       on mount via React autoFocus; ~500 ms later Enter sends the DELETE;
//   (b) the same with useEffect(() => ref.current.focus());
//   (c) a click on "Jump to note" calls input.focus() in its handler; >500 ms
//       later Enter in that input sends POST /api/notes;
//   (d) control: the user Tabs into "Search" (trusted focus, no owner) and
//       presses Enter within 1000 ms: POST /api/search; the fold still holds;
//   (f) "Remove later" opens the autoFocus dialog only after a GET resolves,
//       so React commits it from its scheduler (a MessagePort loop that
//       multiplexes updates): the focus is marked not-a-gesture with its cause
//       abstained, and still never folds into the Enter that sends the DELETE;
//   (g) "Stream a" reads a streamed body with `for await` (a native
//       suspension); while it is open the user Tabs into an input and presses
//       Enter: the click's code is suspended, not running, so the Tab focus is
//       unmarked and folds into the Enter; (h) the same through a first-party
//       async generator (grader's stream probe);
//   (i) an idle-callback poll armed at mount calls a first-party helper that
//       focuses an input while a stream click's frame is left behind: not
//       credited to the click (cause abstained, stale_frame); (i-control) the
//       same poll with no stream open abstains (no_action_on_frame);
//   (j) the click's own code focuses through that helper after its for-await
//       loop ends: indistinguishable from (i) at run time, so also abstained;
//   (e) the whole sequence runs three times on fresh pages and must give the
//       same episode structure, marks and request owners each time.
// Asserted from the raw rows and through the MCP server as a black box over
// stdio (records + empty spans + the build manifest, as `producttrace-mcp`).
//   node test/browser/episode-focus.mjs [dependencyRoot] [--runs 3] [--out <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';
import { indexWorkflowEpisodes } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const flag = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const positional = argv.filter((arg, index) => !arg.startsWith('--') && !['--runs', '--out'].includes(argv[index - 1]));
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const runs = Number(flag('--runs') || 3);
const outDir = flag('--out') ? path.resolve(flag('--out')) : null;

const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/episode-focus-app/main.jsx'), 'utf8');
const fixture = await buildReactFixture({ dependencyRoot, appSource, name: 'episode-focus' });
const ok = () => ({ ok: true });
const server = await serveFixture(fixture.distRoot, { 'DELETE /api/items/auto': ok, 'DELETE /api/items/effect': ok, 'POST /api/notes': ok, 'POST /api/search': ok, 'GET /api/items/later/check': ok, 'DELETE /api/items/later': ok,
  'POST /api/stream/a/search': ok, 'POST /api/stream/b/search': ok, 'POST /api/poll/search': ok, 'POST /api/after/search': ok },
  { 'GET /api/stream/a': { chunks: 4, intervalMs: 800 }, 'GET /api/stream/b': { chunks: 4, intervalMs: 800 }, 'GET /api/stream/i': { chunks: 4, intervalMs: 800 }, 'GET /api/stream/j': { chunks: 3, intervalMs: 400 } });
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });

async function drive() {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(server.origin, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  // (a), (b): open the dialog, wait ~500 ms, press Enter in it.
  for (const name of ['auto', 'effect']) {
    await page.getByRole('button', { name: `Remove ${name}` }).click();
    await page.getByRole('dialog', { name }).waitFor();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  }
  // (c): the click moves focus to the note input; Enter there after 600 ms.
  await page.getByRole('button', { name: 'Jump to note' }).click(); await page.waitForTimeout(600);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  // (d): focus the button before the search input (Playwright's own
  // element.focus(), outside any action), Tab into Search, Enter at ~300 ms.
  await page.getByRole('button', { name: 'Before search' }).focus(); await page.waitForTimeout(200);
  await page.keyboard.press('Tab'); await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  // (f): the dialog opens after a request resolves; Enter ~500 ms later.
  await page.getByRole('button', { name: 'Remove later' }).click();
  await page.getByRole('dialog', { name: 'later' }).waitFor();
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  // (g), (h): start the stream, then (while it is open) focus the button
  // before the input from outside the app, Tab in, Enter at ~300 ms.
  for (const name of ['a', 'b']) {
    await page.getByRole('button', { name: `Stream ${name}`, exact: true }).click(); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: `Before stream ${name}` }).focus(); await page.waitForTimeout(100);
    await page.keyboard.press('Tab'); await page.waitForTimeout(300);
    await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
  }
  // (i-control): the poll focuses with no stream open; Enter 500 ms later.
  await page.evaluate(() => { window.__episodeFocusPoll = true; }); await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  // (i): open the stream, then set the flag from outside the app; Enter 500 ms later.
  await page.getByRole('button', { name: 'Stream i', exact: true }).click(); await page.waitForTimeout(600);
  await page.evaluate(() => { window.__episodeFocusPoll = true; }); await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
  // (j): the stream ends (~1.2 s), the click's code focuses; Enter ~400 ms later.
  await page.getByRole('button', { name: 'Stream j', exact: true }).click(); await page.waitForTimeout(1600);
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  const rows = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
  await page.close();
  assert.deepEqual(errors, []);
  return rows;
}

async function connect(args) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(tracerRoot, 'mcp', 'server.mjs'), ...args], stderr: 'ignore' });
  const client = new Client({ name: 'episode-focus', version: '1' });
  await client.connect(transport);
  return { call: async (name, input) => (await client.callTool({ name, arguments: input })).structuredContent, close: () => client.close() };
}

// Everything an agent reads for an action, minus the store stats block.
const printed = result => JSON.stringify({ ...result, store: undefined });
// Does a tool result mention this request anywhere: a rendered line, or any
// object in its JSON carrying this method and URL?
const mentions = (result, method, url) => {
  const text = `${method} ${url}`;
  const walk = value => {
    if (typeof value === 'string') return value.includes(text);
    if (!value || typeof value !== 'object') return false;
    if (!Array.isArray(value) && String(value.method || '').toUpperCase() === method && value.url === url) return true;
    return Object.values(value).some(walk);
  };
  return walk({ ...result, store: undefined });
};

async function checkRun(rows, run) {
  const actions = rows.filter(row => row.kind === 'dom.action').sort((a, b) => a.sequence - b.sequence);
  const requests = rows.filter(row => row.kind === 'network.request' && !row.internal);
  const requestTo = (method, url) => { const found = requests.filter(row => String(row.method).toUpperCase() === method && row.url === url); assert.equal(found.length, 1, `${method} ${url} once`); return found[0]; };
  const byId = new Map(actions.map(row => [row.action_id, row]));
  const clicks = actions.filter(row => row.event === 'click');
  const keydowns = actions.filter(row => row.event === 'keydown');
  const focuses = actions.filter(row => row.event === 'focusin');
  const indexed = indexWorkflowEpisodes(rows);
  const cases = {};

  // Resolve each case from the rows: the request's owner is the keypress; the
  // opener is the last click before it; the caused focus is the focusin that
  // names that click.
  for (const [name, method, url] of [['a_autofocus', 'DELETE', '/api/items/auto'], ['b_effect_focus', 'DELETE', '/api/items/effect'], ['c_handler_focus', 'POST', '/api/notes']]) {
    const request = requestTo(method, url);
    const press = byId.get(request.action_id);
    assert.equal(press?.event, 'keydown', `${name}: the ${method} is owned by the keypress`);
    assert.equal(press.key?.key, 'Enter');
    const opener = clicks.filter(row => row.sequence < press.sequence).at(-1);
    assert.ok(opener, `${name}: a click precedes the keypress`);
    const focus = focuses.find(row => row.sequence > opener.sequence && row.sequence < press.sequence && row.target_ref === press.target_ref);
    assert.ok(focus, `${name}: the focus on the pressed control is recorded (capture wide)`);
    // Rule 1, raw rows: the runtime names the causing action.
    assert.equal(focus.gesture, false, `${name}: the dialog/input focus is not a gesture`);
    assert.equal(focus.caused_by_action_id, opener.action_id, `${name}: focus caused_by_action_id names the click`);
    assert.ok(Number(press.timestamp) - Number(focus.timestamp) >= 450, `${name}: the keypress came >= 450 ms after the focus`);
    // Rule 1, indexer: the focus never folds into the later keypress and never starts an episode.
    const pressEpisode = indexed.episodes.get(indexed.byAction.get(press.action_id));
    assert.deepEqual(pressEpisode.action_ids, [press.action_id], `${name}: the keypress episode holds only the keypress`);
    assert.equal(indexed.byAction.has(focus.action_id), false, `${name}: the caused focus is in no episode`);
    const openerEpisode = indexed.episodes.get(indexed.byAction.get(opener.action_id));
    assert.ok(openerEpisode.caused_action_ids?.includes(focus.action_id), `${name}: the focus is listed under the click's episode as caused`);
    assert.equal(openerEpisode.action_ids.includes(focus.action_id), false, `${name}: listed as caused, not as a member`);
    cases[name] = { opener, focus, press, request, openerEpisode, pressEpisode };
  }
  // (d) Tab: trusted focus with no live owner; folds into the Enter.
  const search = requestTo('POST', '/api/search');
  const enter = byId.get(search.action_id);
  const tab = keydowns.filter(row => row.key?.key === 'Tab' && row.sequence < enter.sequence).at(-1);
  assert.ok(tab, '(d) a Tab keydown precedes the Enter');
  const tabFocus = focuses.find(row => row.sequence > tab.sequence && row.sequence < enter.sequence && row.target_ref === enter.target_ref);
  assert.ok(tabFocus, '(d) the Tab focus on the search input is recorded');
  assert.equal(tabFocus.gesture, undefined, '(d) a Tab focus carries no gesture:false mark');
  assert.equal(tabFocus.caused_by_action_id, undefined, '(d) and no causing action');
  assert.ok(Number(enter.timestamp) - Number(tabFocus.timestamp) <= 1000, '(d) Enter within 1000 ms');
  const searchEpisode = indexed.episodes.get(indexed.byAction.get(enter.action_id));
  assert.deepEqual(searchEpisode.action_ids, [tabFocus.action_id, enter.action_id], '(d) the Tab focus folds into the Enter (unchanged rule)');
  assert.equal(searchEpisode.carrier_action_id, enter.action_id);
  // (g), (h): a Tab during a suspended stream read is the user's focus.
  const streams = {};
  for (const name of ['a', 'b']) {
    const post = requestTo('POST', `/api/stream/${name}/search`);
    const streamEnter = byId.get(post.action_id);
    assert.equal(streamEnter?.event, 'keydown', `(stream ${name}) the POST is owned by the Enter`);
    const streamGet = requestTo('GET', `/api/stream/${name}`);
    const streamClick = byId.get(streamGet.action_id);
    assert.equal(streamClick?.event, 'click', `(stream ${name}) the stream GET is the click's`);
    const streamTab = keydowns.filter(row => row.key?.key === 'Tab' && row.sequence > streamClick.sequence && row.sequence < streamEnter.sequence).at(-1);
    const streamFocus = focuses.find(row => row.sequence > streamTab.sequence && row.sequence < streamEnter.sequence && row.target_ref === streamEnter.target_ref);
    assert.ok(streamFocus, `(stream ${name}) the Tab focus is recorded`);
    assert.equal(streamFocus.gesture, undefined, `(stream ${name}) the Tab focus during the suspended stream carries no gesture:false`);
    assert.equal(streamFocus.caused_by_action_id, undefined, `(stream ${name}) and no caused_by_action_id`);
    // Nothing on the page between the click and the Enter is credited to the suspended click.
    for (const row of actions.filter(row => row.sequence > streamClick.sequence && row.sequence < streamEnter.sequence)) assert.equal(row.caused_by_action_id ?? null, null, `(stream ${name}) ${row.event} is not credited to the suspended click`);
    const streamEpisode = indexed.episodes.get(indexed.byAction.get(streamEnter.action_id));
    assert.deepEqual(streamEpisode.action_ids, [streamFocus.action_id, streamEnter.action_id], `(stream ${name}) the Tab focus folds into the Enter`);
    const clickEpisode = indexed.episodes.get(indexed.byAction.get(streamClick.action_id));
    assert.equal((clickEpisode?.caused_action_ids || []).includes(streamFocus.action_id), false, `(stream ${name}) the Tab focus is not in the click's caused list`);
    streams[name] = { streamClick, streamFocus, streamEnter };
  }
  // (i-control), (i), (j): a focus whose action could only come from a
  // left-behind frame is never credited; none of them folds into the Enter.
  const polls = {};
  {
    const pollPosts = requests.filter(row => String(row.method).toUpperCase() === 'POST' && row.url === '/api/poll/search');
    assert.equal(pollPosts.length, 2, 'two poll Enters');
    const streamI = byId.get(requestTo('GET', '/api/stream/i').action_id);
    const afterPost = requestTo('POST', '/api/after/search');
    const streamJ = byId.get(requestTo('GET', '/api/stream/j').action_id);
    const cases3 = [['i_control', null, byId.get(pollPosts[0].action_id), ['no_action_on_frame']],
      ['i_stream_poll', streamI, byId.get(pollPosts[1].action_id), ['stale_frame']],
      ['j_after_stream', streamJ, byId.get(afterPost.action_id), ['stale_frame', 'no_action_on_frame']]];
    for (const [name, click, press, reasons] of cases3) {
      const focus = focuses.filter(row => row.sequence < press.sequence && row.target_ref === press.target_ref).at(-1);
      assert.ok(focus, `(${name}) the focus is recorded`);
      if (click) assert.ok(focus.sequence > click.sequence, `(${name}) focus after the stream click`);
      assert.equal(focus.gesture, false, `(${name}) app code moved the focus: not a gesture`);
      assert.equal(focus.caused_by_action_id, null, `(${name}) never credited (got ${focus.caused_by_action_id})`);
      assert.ok(reasons.includes(focus.cause_abstained), `(${name}) cause_abstained ${focus.cause_abstained}`);
      assert.deepEqual(indexed.episodes.get(indexed.byAction.get(press.action_id)).action_ids, [press.action_id], `(${name}) the Enter's episode holds only the Enter`);
      if (click) assert.equal((indexed.episodes.get(indexed.byAction.get(click.action_id))?.caused_action_ids || []).includes(focus.action_id), false, `(${name}) not in the click's caused list`);
      polls[name] = { focus, press, click };
    }
  }
  // (f) scheduler lineage: not a gesture, cause abstained, never folded.
  const later = requestTo('DELETE', '/api/items/later');
  const laterPress = byId.get(later.action_id);
  assert.equal(laterPress?.event, 'keydown', '(f) the DELETE is owned by the Enter');
  const laterOpener = clicks.filter(row => row.sequence < laterPress.sequence).at(-1);
  const laterCheck = requestTo('GET', '/api/items/later/check');
  assert.equal(laterCheck.action_id, laterOpener.action_id, '(f) the GET is the click\'s');
  const laterFocus = focuses.find(row => row.sequence > laterOpener.sequence && row.sequence < laterPress.sequence && row.target_ref === laterPress.target_ref);
  assert.ok(laterFocus, '(f) the autoFocus is recorded');
  assert.equal(laterFocus.gesture, false, '(f) not a gesture: app code was running');
  assert.equal(laterFocus.caused_by_action_id, null, '(f) the cause is abstained, not guessed');
  assert.equal(laterFocus.cause_abstained, 'scheduler_lineage');
  assert.equal(indexed.byAction.has(laterFocus.action_id), false, '(f) the focus is in no episode');
  assert.deepEqual(indexed.episodes.get(indexed.byAction.get(laterPress.action_id)).action_ids, [laterPress.action_id], '(f) the Enter episode holds only the Enter');
  assert.equal([...indexed.episodes.values()].some(episode => episode.caused_action_ids?.includes(laterFocus.action_id)), false, '(f) an abstained focus is listed nowhere');

  // --- MCP, black box over stdio ---------------------------------------
  // A stored session is idle once its newest row is older than the store's
  // idle window (1500 ms); wait so frontiers are final, not `pending`.
  await new Promise(resolve => setTimeout(resolve, 1700));
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-focus-store-'));
  fs.writeFileSync(path.join(storeDir, 'records.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(storeDir, 'spans.jsonl'), '');
  fs.writeFileSync(path.join(storeDir, 'manifest.json'), JSON.stringify(fixture.manifest));
  const mcp = await connect(['--records', path.join(storeDir, 'records.jsonl'), '--spans', path.join(storeDir, 'spans.jsonl'), '--manifest', path.join(storeDir, 'manifest.json')]);
  const report = { run, cases: {} };
  try {
    const recent = await mcp.call('recent_actions', { n: 100 });
    const recentById = new Map(recent.actions.map(action => [action.action_id, action]));
    for (const [name, { opener, focus, press, request, openerEpisode }] of Object.entries(cases)) {
      const target = `${String(request.method).toUpperCase()} ${request.url}`;
      // Every action in the click's window (from the click up to the keypress)
      // prints no chain containing the keypress's request, in action_chain or
      // recent_actions.
      const window = actions.filter(row => row.sequence >= opener.sequence && row.sequence < press.sequence);
      assert.ok(window.some(row => row.action_id === focus.action_id));
      for (const row of window) {
        const chain = await mcp.call('action_chain', { action_id: row.action_id });
        assert.equal(chain.status, 'ok');
        assert.equal(mentions(chain, String(request.method).toUpperCase(), request.url), false, `${name}: action_chain(${row.event} ${row.action_id}) in the click's window mentions ${target}: ${chain.summary}`);
        assert.equal(mentions(recentById.get(row.action_id), String(request.method).toUpperCase(), request.url), false, `${name}: recent_actions entry for ${row.action_id} mentions ${target}`);
      }
      // The keypress's chain carries the request.
      const pressed = await mcp.call('action_chain', { action_id: press.action_id });
      const requestStop = pressed.stops.find(stop => stop.stop === 'request');
      assert.equal(`${requestStop?.method} ${requestStop?.url}`, target, `${name}: the Enter's chain carries ${target}`);
      assert.equal(pressed.keyboard?.key, 'Enter');
      assert.deepEqual(pressed.episode_action_ids, [press.action_id]);
      // The caused focus: its own chain names the causing click and its episode.
      const focused = await mcp.call('action_chain', { action_id: focus.action_id });
      assert.equal(focused.gesture, false);
      assert.equal(focused.caused_by_action_id, opener.action_id, `${name}: action_chain names the causing click`);
      assert.equal(focused.caused_by_episode_id, openerEpisode.episode_id);
      assert.equal(focused.standalone, true, `${name}: the caused focus starts no episode`);
      assert.ok(focused.summary.includes(`caused by action ${opener.action_id}`), focused.summary);
      assert.equal(focused.stops.some(stop => stop.stop === 'request'), false);
      // The click's own chain lists the focus as caused.
      const opened = await mcp.call('action_chain', { action_id: opener.action_id });
      assert.ok(opened.caused?.some(entry => entry.action_id === focus.action_id && entry.caused_by_action_id === opener.action_id && entry.gesture === false), `${name}: the click lists its caused focus`);
      assert.equal(opened.stops.some(stop => stop.stop === 'request'), false, `${name}: the click's own chain has no request`);
      report.cases[name] = { caused_via: focus.caused_via, focus_to_press_ms: Number(press.timestamp) - Number(focus.timestamp), window_actions: window.map(row => row.event),
        click: opened.summary.split('\n')[0], focus: focused.summary.split('\n')[0], press: pressed.summary.split('\n')[0] };
    }
    // (f): no chain in the click's window mentions the DELETE; the abstained
    // focus says so and names no cause.
    for (const row of actions.filter(row => row.sequence >= laterOpener.sequence && row.sequence < laterPress.sequence)) {
      const chain = await mcp.call('action_chain', { action_id: row.action_id });
      assert.equal(mentions(chain, 'DELETE', '/api/items/later'), false, `(f) action_chain(${row.event}) mentions the DELETE: ${chain.summary}`);
    }
    const abstained = await mcp.call('action_chain', { action_id: laterFocus.action_id });
    assert.equal(abstained.gesture, false); assert.equal(abstained.caused_by_action_id, null); assert.equal(abstained.cause_abstained, 'scheduler_lineage');
    assert.ok(abstained.summary.includes("focus caused by app code committed from React's scheduler; causing action not attributable"), abstained.summary);
    const laterListed = recentById.get(laterFocus.action_id);
    assert.equal(laterListed?.gesture, false, '(f) recent_actions lists the abstained focus');
    assert.equal(laterListed.cause_abstained, 'scheduler_lineage');
    assert.equal(laterListed.caused_pointer, "focus caused by app code committed from React's scheduler; causing action not attributable");
    assert.equal(laterListed.standalone, true, '(f) in no episode');
    const laterPressed = await mcp.call('action_chain', { action_id: laterPress.action_id });
    assert.ok(mentions(laterPressed, 'DELETE', '/api/items/later'), '(f) the Enter carries the DELETE');
    report.cases.f_scheduler_autofocus = { cause_abstained: laterFocus.cause_abstained, focus_to_press_ms: Number(laterPress.timestamp) - Number(laterFocus.timestamp),
      focus: abstained.summary.split('\n')[0], press: laterPressed.summary.split('\n')[0] };
    // (b): the dialog's own key holds the caused focus and the Enter; the
    // caused focus is not a user attempt and does not count toward n.
    const effect = cases.b_effect_focus;
    const dialogKey = effect.press.target?.element_key;
    assert.ok(dialogKey && effect.focus.target?.element_key === dialogKey, '(b) the effect focus and the Enter share the dialog key');
    const dialogHistory = await mcp.call('element_history', { element_key: dialogKey, n: 1 });
    assert.deepEqual(dialogHistory.attempts.map(attempt => attempt.carrier_action_id), [effect.press.action_id], '(b) one attempt: the Enter');
    assert.equal(dialogHistory.actions.some(action => action.action_id === effect.focus.action_id), false, '(b) the caused focus is not listed: its click is not in a kept attempt');
    for (const [name, { streamClick, streamFocus, streamEnter }] of Object.entries(streams)) {
      const opened = await mcp.call('action_chain', { action_id: streamClick.action_id });
      assert.equal((opened.caused || []).some(entry => entry.action_id === streamFocus.action_id), false, `(stream ${name}) MCP: the click lists no caused Tab focus`);
      const member = await mcp.call('action_chain', { action_id: streamFocus.action_id });
      assert.equal(member.episode_carrier_action_id, streamEnter.action_id, `(stream ${name}) MCP: the Tab focus points to the Enter`);
      assert.equal(member.caused_by_action_id, undefined);
      report.cases[`stream_${name}`] = { focus_to_enter_ms: Number(streamEnter.timestamp) - Number(streamFocus.timestamp), focus: member.summary.split('\n')[0] };
    }
    // (b) truncated before the Enter: the dialog key's only row is the caused
    // focus. It is listed (not an attempt) and the key never reads "no actions".
    {
      const cutFile = path.join(storeDir, 'truncated.records.jsonl');
      fs.writeFileSync(cutFile, rows.filter(row => Number(row.sequence) < Number(effect.press.sequence)).map(row => JSON.stringify(row)).join('\n') + '\n');
      const truncated = await connect(['--records', cutFile, '--spans', path.join(storeDir, 'spans.jsonl'), '--manifest', path.join(storeDir, 'manifest.json')]);
      try {
        const only = await truncated.call('element_history', { element_key: dialogKey, n: 1 });
        assert.equal(only.status, 'ok');
        assert.deepEqual(only.attempts, [], '(b, truncated) no attempts');
        assert.deepEqual(only.actions.map(action => [action.action_id, action.gesture, action.caused_by_action_id]), [[effect.focus.action_id, false, effect.opener.action_id]], '(b, truncated) the caused focus is listed');
        assert.ok(only.actions[0].caused_pointer, '(b, truncated) with its pointer');
        assert.doesNotMatch(only.summary, /no actions/u);
      } finally { await truncated.close(); }
    }
    for (const [name, { focus, press, click }] of Object.entries(polls)) {
      const chain = await mcp.call('action_chain', { action_id: focus.action_id });
      assert.equal(chain.gesture, false); assert.equal(chain.caused_by_action_id, null, `(${name}) MCP: no causing action`);
      if (focus.cause_abstained === 'stale_frame') assert.equal(chain.caused_pointer, 'focus caused by app code running on a frame that suspended code left behind (cause abstained: stale_frame); the causing action could not be proven');
      if (click) {
        const opened = await mcp.call('action_chain', { action_id: click.action_id });
        assert.equal((opened.caused || []).some(entry => entry.action_id === focus.action_id), false, `(${name}) MCP: the stream click lists no caused focus`);
      }
      report.cases[name] = { cause_abstained: focus.cause_abstained, focus_to_press_ms: Number(press.timestamp) - Number(focus.timestamp), focus: chain.summary.split('\n')[0] };
    }
    // (d): the folded Tab focus is a non-carrier member: own evidence + pointer.
    const member = await mcp.call('action_chain', { action_id: tabFocus.action_id });
    const pointer = `this action is part of episode ${searchEpisode.episode_id}; its request is attributed to the carrier action ${enter.action_id}`;
    assert.equal(member.episode_member, true, '(d) the Tab focus is a member');
    assert.equal(member.episode_carrier_action_id, enter.action_id);
    assert.equal(member.episode_pointer, pointer);
    assert.ok(member.summary.split('\n')[0].endsWith(pointer), member.summary);
    assert.equal(printed(member).includes('/api/search'), false, '(d) the member chain never prints the carrier request');
    assert.deepEqual(member.segments, []); assert.deepEqual(member.requests, []);
    assert.equal(member.outcome.status, 'no_request', '(d) the member\'s own label');
    assert.ok(member.outcome.sentence.endsWith(`; ${pointer}`), '(d) the label sentence carries the pointer');
    assert.equal(member.stops.some(stop => ['request', 'route', 'handler', 'db'].includes(stop.stop)), false);
    assert.equal(recentById.get(tabFocus.action_id).episode_pointer, pointer, '(d) recent_actions carries the pointer');
    assert.equal(JSON.stringify(recentById.get(tabFocus.action_id)).includes('/api/search'), false);
    const carrier = await mcp.call('action_chain', { action_id: enter.action_id });
    assert.equal(carrier.stops.find(stop => stop.stop === 'request')?.url, '/api/search', '(d) the Enter carries the request');
    assert.equal(carrier.episode_member, undefined);
    // element_history: the member lists own evidence; the attempt groups by carrier as before.
    const searchKey = enter.target?.element_key;
    assert.ok(searchKey, '(d) the search input is stamped');
    const history = await mcp.call('element_history', { element_key: searchKey, n: 5 });
    assert.equal(history.attempts.length, 1);
    assert.equal(history.attempts[0].carrier_action_id, enter.action_id);
    assert.deepEqual(history.attempts[0].action_ids, [enter.action_id, tabFocus.action_id]);
    assert.equal(history.attempts[0].request?.url, '/api/search', '(d) the attempt shows the carrier request');
    const listedMember = history.actions.find(action => action.action_id === tabFocus.action_id);
    assert.equal(listedMember.episode_pointer, pointer);
    assert.equal(listedMember.request, null);
    report.cases.d_tab_control = { focus_to_enter_ms: Number(enter.timestamp) - Number(tabFocus.timestamp), member: member.summary.split('\n')[0], carrier: carrier.summary.split('\n')[0],
      attempt: { carrier: history.attempts[0].carrier_action_id === enter.action_id, events: history.attempts[0].events } };
    // Invariant over every episode: one control or one form; caused focuses are never members.
    for (const episode of indexed.episodes.values()) {
      if (!episode.form_ref) assert.equal(new Set(episode.actions.map(row => row.target_ref)).size, 1, `${episode.episode_id}: one control`);
      assert.equal(episode.actions.some(row => row.gesture === false), false, `${episode.episode_id}: no caused focus as a member`);
    }
  } finally { await mcp.close(); fs.rmSync(storeDir, { recursive: true, force: true }); }
  // A stable signature for comparing runs (no ids, no timestamps).
  report.signature = {
    episodes: [...indexed.episodes.values()].map(episode => ({ events: episode.actions.map(row => `${row.event}${row.key ? `:${row.key.key}` : ''}`), caused: (episode.caused || []).map(entry => `${entry.event}<-${byId.get(entry.caused_by_action_id)?.event}:${entry.caused_via}`) })),
    marked: actions.filter(row => row.gesture === false).map(row => `${row.event}<-${byId.get(row.caused_by_action_id)?.event ?? 'abstained'}:${row.caused_via ?? row.cause_abstained}`),
    requests: requests.map(row => `${String(row.method).toUpperCase()} ${row.url} <- ${byId.get(row.action_id)?.event}:${byId.get(row.action_id)?.key?.key || ''}`),
  };
  return report;
}

const reports = [];
try {
  for (let run = 1; run <= runs; run += 1) {
    const rows = await drive();
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `run-${run}.records.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }
    reports.push(await checkRun(rows, run));
  }
  // (e) stability: every run has the same episode structure, marks and owners.
  for (const report of reports.slice(1)) assert.deepEqual(report.signature, reports[0].signature, `run ${report.run} differs from run 1`);
  const summary = { status: 'ok', headless: true, runs: reports.length, stable: true, signature: reports[0].signature, reports: reports.map(({ signature, ...rest }) => rest) };
  if (outDir) fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close(); await server.close(); fixture.cleanup();
}
