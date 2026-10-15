// G1 continuation test (headless): state-update receipts and await
// resumptions attribute requests to their action. The negative controls are
// armed before each click and fire through it (a 1 ms unowned ticker gated by
// pointerdown): a first-party poll fetch, a sibling re-rendering, a late mount,
// a no-op setter followed by an unrelated re-render (P1), two setters in one
// handler followed by an unrelated re-render (P2). Rejected awaits resume on
// the frame current at the await. Every assertion is repeated over RUNS page
// loads (default 5).
//   node test/browser/continuations-neutral.mjs [dependencyRoot]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';
import { indexEntryHandlerUnits } from '../../analysis/runtime-attribution.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/continuation-app/main.jsx'), 'utf8');
// PRODUCTTRACE_CONTINUATION_BODIES=always builds with body capture on (network.body rows), to show it changes no attribution.
const fixture = await buildReactFixture({ dependencyRoot, appSource, name: 'continuations',
  ...(process.env.PRODUCTTRACE_CONTINUATION_BODIES === 'always' ? { pluginOptions: { bodies: 'always' } } : {}) });
const ok = () => ({ ok: true });
const URLS = ['/api/mounted', '/api/sibling', '/api/late-mount', '/api/poll', '/api/unrelated', '/api/state-effect', '/api/p1-tick', '/api/p2-a', '/api/p2-tick',
  '/api/submit', '/api/after-await', '/api/after-reject', '/api/after-throw', '/api/after-focus',
  '/api/p1f-tick', '/api/form-submit', '/api/pre-armed', '/api/cross-timer', '/api/cross-promise', '/api/nested-after-focus', '/api/nested-leak'];
const server = await serveFixture(fixture.distRoot, Object.fromEntries(URLS.map(url => [`${url === '/api/submit' || url === '/api/form-submit' ? 'POST' : 'GET'} ${url}`, ok])));
const RUNS = Number(process.env.PRODUCTTRACE_CONTINUATION_RUNS || 5);
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
try {
  const run = async ({ receipts = true, awaits = true } = {}) => {
    const page = await browser.newPage();
    if (!receipts) await page.addInitScript(() => { globalThis.__PRODUCTTRACE_STATE_RECEIPTS__ = false; });
    if (!awaits) await page.addInitScript(() => { globalThis.__PRODUCTTRACE_AWAIT_CONTINUATIONS__ = false; });
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Delayed update' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^P1/u }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Functional no-op/u }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'P2', exact: true }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Submit via reducer' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Await then fetch' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Reject then fetch' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Show autofocus' }).click(); await page.waitForTimeout(400);
    await page.keyboard.press('Control+m'); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Toggle panel' }).click(); await page.waitForTimeout(300);
    await page.getByLabel('Native field').focus(); await page.keyboard.press('x'); await page.waitForTimeout(300);
    // (1) form library: submit -> library await -> app onSubmit -> fetch.
    await page.getByRole('button', { name: 'Library submit' }).click(); await page.waitForTimeout(400);
    // (2) a timer armed before the click (at its pointerdown), firing after it.
    await page.evaluate(() => globalThis.__armPreClickTimer());
    await page.getByRole('button', { name: 'Action B' }).click(); await page.waitForTimeout(300);
    // (5) created in A, run after B started.
    await page.getByRole('button', { name: 'Arm A' }).click(); await page.waitForTimeout(60);
    await page.getByRole('button', { name: 'Action B' }).click(); await page.waitForTimeout(500);
    // (6) nested dispatch inside a click, then an unowned reaction afterwards.
    await page.getByRole('button', { name: 'Nested focus' }).click(); await page.waitForTimeout(300);
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
    const stats = await page.evaluate(() => globalThis.__productTraceRuntime.stampStats());
    const ticks = await page.evaluate(() => globalThis.__fixtureTicks());
    await page.close();
    return { rows, stats, errors, ticks };
  };
  const results = [];
  for (let attempt = 0; attempt < RUNS; attempt += 1) results.push(await run());
  const reports = [];
  let abstention = null;
  for (const [attempt, { rows, stats, errors, ticks }] of results.entries()) {
  assert.deepEqual(errors, []);
  const actions = rows.filter(row => row.kind === 'dom.action' && row.event === 'click');
  const clicks = actions.filter(row => row.target?.tag === 'button');
  assert.equal(clicks.length, 14, `fourteen trusted button clicks: ${JSON.stringify(actions.map(row => [row.event, row.target?.tag, row.key?.key]))}`);
  const [delayedClick, p1Click, p1fClick, p2Click, submitClick, awaitClick, rejectClick, focusClick, toggle, libraryClick, preArmedClick, armAClick, actionBClick, nestedClick] = clicks;
  // Credit rule: a global document listener is not credited; a bound handler is.
  const index = indexEntryHandlerUnits(rows);
  // Control+m: the key is recorded (a command, not text) with its modifiers (D-G1-21).
  const shortcut = rows.find(row => row.kind === 'dom.action' && row.event === 'keydown' && row.key?.key === 'm' && row.key?.ctrlKey === true);
  assert.ok(shortcut?.bound_handlers, 'binding recorded on the keydown action');
  abstention = index.abstentions.get(shortcut.action_id);
  assert.ok(abstention, 'global listener is not credited');
  assert.equal(abstention.stopped_at, 'entry_handler');
  // D-G1-22: judged from observed bindings (no bound handler ran on the keydown), not from a declared list.
  assert.equal(abstention.basis, 'observed');
  assert.match(abstention.because, /^no element-bound handler ran: no instrumented function held by the target's element chain \(an on\* prop, or a listener on the element\) was invoked for this dispatch \(uninstrumented and third-party handlers are not seen\); global listeners: \[function:/u);
  assert.equal(index.byAction.has(shortcut.action_id), false);
  assert.ok(index.byAction.get(toggle.action_id), 'bound onClick is credited');
  assert.ok(toggle.bound_handlers.ids.includes(index.byAction.get(toggle.action_id)[0].split('|')[0]));
  // A native addEventListener on the target element is element-bound.
  const nativeKey = rows.filter(row => row.kind === 'dom.action' && row.event === 'keydown' && row.target?.tag === 'input').at(-1);
  assert.ok(nativeKey?.bound_handlers?.element_listeners >= 1, 'native element listener recorded');
  assert.equal(index.abstentions.has(nativeKey.action_id), false, 'element listener is not a global listener');
  assert.ok(index.byAction.get(nativeKey.action_id), 'element listener credited');
  const requests = rows.filter(row => row.kind === 'network.request' && !row.internal);
  const byUrl = url => requests.filter(row => row.url === url);
  const summary = Object.fromEntries(URLS.map(url => [url, byUrl(url).map(row => ({ action_id: row.action_id, linkage_kind: row.linkage_kind, parent: row.parent_continuation_id }))]));
  // Overlap: negative-control work ran after each click (between the click's
  // dom.action row and the next action), not only before the first click.
  const actionSequences = rows.filter(row => row.kind === 'dom.action').map(row => row.sequence);
  const overlapping = url => byUrl(url).filter(row => actionSequences.some(sequence => sequence < row.sequence)).length;
  const overlap = Object.fromEntries(['/api/poll', '/api/sibling', '/api/late-mount', '/api/p1-tick', '/api/p1f-tick', '/api/p2-tick'].map(url => [url, overlapping(url)]));
  // Positive: receipts and await continuations.
  assert.equal(byUrl('/api/state-effect').length, 1);
  assert.equal(byUrl('/api/state-effect')[0].action_id, delayedClick.action_id, 'state effect belongs to the Delayed click');
  assert.equal(byUrl('/api/state-effect')[0].linkage_kind, 'state_effect');
  assert.equal(byUrl('/api/submit').length, 1);
  assert.equal(byUrl('/api/submit')[0].action_id, submitClick.action_id, 'reducer effect + awaits belong to the Submit click');
  assert.equal(byUrl('/api/submit')[0].linkage_kind, 'state_effect');
  assert.equal(byUrl('/api/after-await').length, 1);
  assert.equal(byUrl('/api/after-await')[0].action_id, awaitClick.action_id, 'fetch after an rAF await belongs to its click');
  // Rejected awaits: the catch block runs on the frame current at the await.
  assert.equal(byUrl('/api/after-reject').length, 1);
  assert.equal(byUrl('/api/after-reject')[0].action_id, rejectClick.action_id, 'catch after a rejected await belongs to its click');
  assert.equal(byUrl('/api/after-throw').length, 1);
  assert.equal(byUrl('/api/after-throw')[0].action_id, rejectClick.action_id, 'catch after an awaited callee throws belongs to its click');
  // A nested trusted focusin dispatched from a mount effect ends; the
  // effect's frame resumes (the fetch after focus() belongs to the click).
  assert.equal(byUrl('/api/after-focus').length, 1);
  assert.equal(byUrl('/api/after-focus')[0].action_id, focusClick.action_id, 'effect frame resumes after a nested programmatic focus');
  assert.equal(byUrl('/api/after-focus')[0].linkage_kind, 'mount_effect');
  // P2: two setters in one handler; the action's own effect is attributed.
  assert.equal(byUrl('/api/p2-a').length, 1);
  assert.equal(byUrl('/api/p2-a')[0].action_id, p2Click.action_id, 'P2 own effect belongs to its click');
  assert.equal(byUrl('/api/p2-a')[0].linkage_kind, 'state_effect');
  // Mount effect of a fiber mounted by the receipted commit inside the receipted subtree.
  assert.equal(byUrl('/api/mounted').length, 1);
  assert.equal(byUrl('/api/mounted')[0].action_id, delayedClick.action_id);
  assert.equal(byUrl('/api/mounted')[0].linkage_kind, 'mount_effect');
  // Negatives, each overlapping the actions.
  for (const [url, count] of Object.entries(overlap)) assert.ok(count >= 1, `${url} fired after an action (${count})`);
  assert.ok(byUrl('/api/p1-tick').length >= 3, 'P1 re-rendered by the ticker after its no-op click');
  assert.ok(byUrl('/api/p1-tick').every(row => row.action_id == null), 'P1: no-op setState then unrelated re-render is not attributed');
  assert.ok(byUrl('/api/p1f-tick').length >= 3, 'P1f re-rendered by the ticker after its functional no-op click');
  assert.ok(byUrl('/api/p1f-tick').every(row => row.action_id == null), 'P1f: functional no-op updater then unrelated re-render is not attributed');
  assert.ok(p1fClick.sequence > p1Click.sequence);
  assert.ok(byUrl('/api/p2-tick').length >= 3, 'P2 re-rendered by the ticker after its click');
  assert.ok(byUrl('/api/p2-tick').every(row => row.action_id == null), 'P2: a leftover receipt never attributes a later commit');
  assert.ok(byUrl('/api/sibling').length >= 10, 'sibling re-rendered repeatedly');
  assert.ok(byUrl('/api/sibling').every(row => row.action_id == null), 'sibling outside the receipted subtree is not attributed');
  assert.equal(byUrl('/api/late-mount').length, 1);
  assert.equal(byUrl('/api/late-mount')[0].action_id, null, 'mount in a later commit with no receipt is not attributed');
  // Negative controls.
  assert.ok(byUrl('/api/poll').length >= 3, 'poll ran');
  assert.ok(byUrl('/api/poll').every(row => row.action_id == null), 'unowned poll timer firing through the actions is never attributed');
  assert.ok(byUrl('/api/unrelated').length >= 2, 'unrelated effect re-ran with its parent');
  assert.ok(byUrl('/api/unrelated').every(row => row.action_id == null), 'effect without a receipt is not attributed to the action');
  // (1) Form-library submit: react-hook-form awaits async validation in
  // library code before calling onSubmit; the fetch belongs to the submit.
  const submitAction = rows.find(row => row.kind === 'dom.action' && row.event === 'submit' && row.sequence > libraryClick.sequence);
  assert.ok(submitAction, 'library form dispatched a submit action');
  assert.equal(byUrl('/api/form-submit').length, 1);
  assert.equal(byUrl('/api/form-submit')[0].action_id, submitAction.action_id, 'form-library onSubmit fetch belongs to the submit');
  assert.equal(byUrl('/api/form-submit')[0].linkage_kind, 'direct');
  // (2) A timer armed before the click and firing after it is not attributed.
  assert.equal(byUrl('/api/pre-armed').length, 1);
  assert.ok(byUrl('/api/pre-armed')[0].sequence > preArmedClick.sequence, 'pre-armed timer fired after the click');
  // D-G1-21: the timer is armed by a pointerdown listener. The pointerdown is
  // now recorded, so the timer belongs to that pointerdown (created under its
  // live dispatch frame), never to the click that follows in the same gesture.
  const preArmedDown = rows.find(row => row.kind === 'dom.action' && row.event === 'pointerdown' && row.gesture_id && row.gesture_id === preArmedClick.gesture_id);
  assert.notEqual(byUrl('/api/pre-armed')[0].action_id, preArmedClick.action_id, 'timer armed before the click is not attributed to it');
  assert.equal(byUrl('/api/pre-armed')[0].action_id, preArmedDown?.action_id, 'timer armed by the pointerdown listener belongs to the recorded pointerdown');
  // (3) setInterval armed at mount, ticking during actions: /api/poll above.
  // (5) Created in A, run after B started: attributed to A, not B.
  for (const url of ['/api/cross-timer', '/api/cross-promise']) {
    assert.equal(byUrl(url).length, 1);
    assert.ok(byUrl(url)[0].sequence > actionBClick.sequence, `${url} ran after action B started`);
    assert.equal(byUrl(url)[0].action_id, armAClick.action_id, `${url} belongs to action A`);
  }
  // (6) Nested dispatch: the click's frame is restored after the focusin, and
  // nothing of the click survives its dispatch.
  const nestedFocusin = rows.find(row => row.kind === 'dom.action' && row.event === 'focusin' && row.sequence > nestedClick.sequence);
  assert.ok(nestedFocusin, 'programmatic focus dispatched a nested focusin action');
  assert.equal(byUrl('/api/nested-after-focus').length, 1);
  assert.equal(byUrl('/api/nested-after-focus')[0].action_id, nestedClick.action_id, 'fetch after the nested focus belongs to the click');
  assert.equal(byUrl('/api/nested-after-focus')[0].linkage_kind, 'direct');
  const nestedHandlerIds = new Set(rows.filter(row => row.kind === 'function.enter' && row.sequence > nestedClick.sequence && row.sequence < nestedFocusin.sequence).map(row => row.function_id));
  assert.ok(nestedHandlerIds.size >= 1, 'the button handler entered before the nested focusin');
  assert.ok(byUrl('/api/nested-after-focus')[0].spine.function_ids.every(id => !nestedHandlerIds.has(id)),
    'the parent handler runs on the click frame, not on the returned button handler (strict stack)');
  assert.equal(byUrl('/api/nested-leak').length, 1);
  assert.equal(byUrl('/api/nested-leak')[0].action_id, null, 'an unowned reaction after the click is not attributed to it (no leaked frame)');
  reports.push({ attempt, summary, overlap, stats, ticks });
  }
  // With receipts disabled the state effects are no longer attributed: the
  // positive result above comes from the receipt, not from ambient state.
  const off = await run({ receipts: false });
  const offState = off.rows.filter(row => row.kind === 'network.request' && row.url === '/api/state-effect');
  assert.ok(offState.every(row => row.action_id == null), 'without receipts the delayed state effect is unattributed');
  // With await continuations disabled the fetch after an rAF await is lost.
  const noAwait = await run({ awaits: false });
  const noAwaitRows = noAwait.rows.filter(row => row.kind === 'network.request' && row.url === '/api/after-await');
  assert.ok(noAwaitRows.every(row => row.action_id == null), 'without await continuations the post-await fetch is unattributed');
  console.log(JSON.stringify({ status: 'ok', headless: true, runs: RUNS, reports, global_listener_abstention: abstention, receipts_off_state_effect: offState.map(row => row.action_id), await_off_after_await: noAwaitRows.map(row => row.action_id) }, null, 2));
} finally {
  await browser.close(); await server.close(); fixture.cleanup();
}
