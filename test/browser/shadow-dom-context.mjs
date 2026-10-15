// Dispatch context crosses shadow roots (headless). Fixture:
// test/browser/fixtures/shadow-dom-app/main.jsx.
//
// Asserted on every run (RUNS page loads, default 3):
//   - a click on the button inside <share-chip>'s OPEN shadow root: the
//     dom.action target is the inner button (composedPath()[0]), with
//     target.composed and target.shadow_host; the inner button carries its own
//     data-tracer-el and no OAI attributes, while light-DOM hosts do;
//   - the first-party listener registered in connectedCallback is element-bound
//     and its frames (and the method it calls) enter under the click;
//   - the composed `share` CustomEvent it dispatches synchronously is handled
//     by native listeners added in a React effect (host and ancestor); both
//     fetches are attributed `direct` to the click, and the chain credits the
//     inner listener and lists both requests;
//   - a click on <lock-chip> (CLOSED shadow root) is recorded on the host with
//     target.closed_shadow, and its chain states the closed-root frontier;
// Negatives:
//   - a click on "Refresh" outside the element (before and after the share
//     click) is not attributed to /api/share, and its chain lists only its own
//     request;
//   - a programmatic (untrusted) click on the inner button and a programmatic
//     `share` event, both after the actions, are never attributed.
// Re-registered listeners (dispatch wins over registration owner):
//   - "Bump" (click A) re-renders <ReshareCard>, whose effects re-add native
//     listeners with a per-render dependency inside A's commit (owned by A);
//   - a trusted click B on the second chip's shadow button: /api/reshare is
//     `direct` to B, never A; a trusted click on "Ping" (light DOM listener
//     re-added the same way): /api/ping is `direct` to Ping, never A;
//   - a `pointerdown` listener on Ping re-added the same way (no Tracer action
//     for pointerdown): unattributed, never Bump (D-G1-20);
//   - programmatic `share` on that chip: from page.evaluate and from a timer
//     armed at load, unattributed; from a timer armed by the "Later" click,
//     credited to Later (the dispatcher), never Bump (D-G1-20);
//   - a `focus` fired by el.focus() inside the "Focus it" click, on a listener
//     re-added under Bump: credited to that click, never Bump (D-G1-20).
//   node test/browser/shadow-dom-context.mjs [dependencyRoot]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';
import { buildActionChains, SCOPED_ABSENCE } from '../../analysis/runtime-attribution.mjs';
import { indexElementStamps, resolveElement } from '../../analysis/element-index.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const dependencyRoot = path.resolve(process.argv[2] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/shadow-dom-app/main.jsx'), 'utf8');
const fixture = await buildReactFixture({ dependencyRoot, appSource, name: 'shadow-dom' });
const ok = () => ({ ok: true });
const server = await serveFixture(fixture.distRoot, { 'POST /api/share': ok, 'GET /api/share-count': ok, 'GET /api/refresh': ok, 'POST /api/reshare': ok, 'POST /api/reshare-evaluate': ok, 'POST /api/reshare-later': ok, 'POST /api/reshare-load': ok, 'GET /api/ping': ok, 'GET /api/ping-down': ok, 'GET /api/focused': ok });
const RUNS = Number(process.env.PRODUCTTRACE_SHADOW_RUNS || 3);
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });

// Function ids end in `:<start>:<end>` (original-source offsets). Match the
// functions under test by their start offset in the fixture source.
const startOf = (text, offset = 0) => { const at = appSource.indexOf(text); assert.ok(at >= 0, `fixture text ${text}`); return at + offset; };
const idStart = id => Number(String(id).split(':').at(-2));
const FN = {
  innerListener: startOf('event => this.onShareClick(event)'),
  onShareClick: startOf('onShareClick() {'),
  sendShare: startOf('const sendShare = ', 'const sendShare = '.length),
  countShare: startOf('const countShare = ', 'const countShare = '.length),
  lockListener: startOf('() => this.toggleLock()'),
  refresh: startOf('const refresh = ', 'const refresh = '.length),
  onReshare: startOf('const onReshare = ', 'const onReshare = '.length),
  onPing: startOf('const onPing = ', 'const onPing = '.length),
};

try {
  const reports = [];
  for (let attempt = 0; attempt < RUNS; attempt += 1) {
    const page = await browser.newPage();
    // OAI attributes forced on: light-DOM hosts get them, shadow-tree nodes never.
    await page.addInitScript(() => { globalThis.__PRODUCTTRACE_OAI_ATTRIBUTES__ = 'always'; });
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(250);
    await page.locator('share-chip[item="alpha"] button').click(); await page.waitForTimeout(250);
    await page.locator('lock-chip').click(); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(250);
    // Re-registered listeners: A = Bump (re-adds them in its commit), then B.
    await page.getByRole('button', { name: 'Bump' }).click(); await page.waitForTimeout(250);
    await page.locator('share-chip[item="beta"] button').click(); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Bump' }).click(); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Ping' }).click(); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Bump' }).click(); await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('share-chip[item="beta"]').dispatchEvent(new CustomEvent('share', { composed: true, bubbles: true, detail: { src: 'evaluate' } }))); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Later' }).click(); await page.waitForTimeout(300);
    await page.evaluate(() => globalThis.__fireLoadTimer()); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Focus it' }).click(); await page.waitForTimeout(250);
    // Negatives after every action: untrusted inner click, untrusted share event.
    await page.evaluate(() => document.querySelector('share-chip').shadowRoot.querySelector('button').click()); await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('share-chip').dispatchEvent(new CustomEvent('share', { composed: true, bubbles: true, detail: { programmatic: true } }))); await page.waitForTimeout(250);
    const rows = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
    const stats = await page.evaluate(() => globalThis.__productTraceRuntime.stampStats());
    const dom = await page.evaluate(() => {
      const chip = document.querySelector('share-chip'), inner = chip.shadowRoot.querySelector('button');
      return { chipKey: chip.getAttribute('data-tracer-el'), chipOai: chip.hasAttribute('oai-annotatable'),
        innerKey: inner.getAttribute('data-tracer-el'), innerOai: inner.hasAttribute('oai-annotatable') || inner.hasAttribute('oai-annotation-metadata'),
        refreshOai: [...document.querySelectorAll('button')].find(node => node.textContent === 'Refresh').hasAttribute('oai-annotatable') };
    });
    await page.close();
    assert.deepEqual(errors, []);

    const clicks = rows.filter(row => row.kind === 'dom.action' && row.event === 'click');
    assert.equal(clicks.length, 11, `eleven trusted clicks: ${JSON.stringify(clicks.map(row => row.target))}`);
    const [refreshBefore, shareClick, lockClick, refreshAfter, bumpA, reshareClick, bumpA2, pingClick, bumpA3, laterClick, focusClick] = clicks;
    const requests = rows.filter(row => row.kind === 'network.request' && !row.internal);
    const byUrl = url => requests.filter(row => row.url === url);

    // (1) Target resolution across the open shadow root.
    assert.equal(shareClick.target.tag, 'button', 'real target is the inner button, not the retargeted host');
    assert.equal(shareClick.target.composed, true);
    assert.equal(shareClick.target.shadow_host?.tag, 'share-chip');
    assert.ok(dom.chipKey && dom.innerKey, 'host and inner button are stamped');
    assert.equal(shareClick.target.shadow_host.element_key, dom.chipKey);
    assert.equal(shareClick.target.element_key, dom.innerKey, 'target.element_key is the inner button stamp');
    assert.equal(dom.innerKey, `${dom.chipKey}>button#n1`);
    assert.equal(dom.innerOai, false, 'no OAI attributes inside a shadow root');
    assert.equal(dom.chipOai, true, 'the light-DOM host carries OAI attributes');
    assert.equal(dom.refreshOai, true);
    const index = indexElementStamps(rows);
    const innerStamp = resolveElement(index, { element_key: dom.innerKey });
    assert.equal(innerStamp.status, 'exact');
    assert.equal(innerStamp.shadow_host, dom.chipKey);
    const innerRow = rows.find(row => row.kind === 'element.stamp' && row.element_key === dom.innerKey);
    assert.equal(innerRow.placement_via, 'shadow_root');
    assert.equal(innerRow.annotation, 'skipped:shadow_root');
    // Stable-key row contract (fix/stable-element-keys) holds for shadow stamps.
    const innerRows = rows.filter(row => row.kind === 'element.stamp' && row.element_key === dom.innerKey);
    assert.equal(innerRow.key_kind, 'ordinal');
    assert.equal(innerRow.instances, 1, 'one button in the root, host key names one element');
    assert.match(String(innerRow.content_sig), /^[0-9a-f]{16}$/u);
    assert.equal(innerStamp.element_confidence, 'exact');
    assert.equal(shareClick.target.key_kind, 'ordinal');
    assert.equal(shareClick.target.instances, 1);
    assert.equal(shareClick.target.stamp_sequence, innerRows.at(-1).stamp_sequence, 'the action names the stamp row that held for its key');
    assert.ok(stats.shadow_stamped_nodes >= 1 && stats.shadow_listeners_bound >= 1);

    // (2) Bound handler inside the custom element; its frames enter under the click.
    assert.ok(shareClick.bound_handlers?.element_listeners >= 1, 'shadow-tree listener recorded as element-bound');
    const boundInner = shareClick.bound_handlers.ids.filter(id => idStart(id) === FN.innerListener);
    assert.equal(boundInner.length, 1, `inner listener bound: ${JSON.stringify(shareClick.bound_handlers)}`);
    const enters = rows.filter(row => row.kind === 'function.enter' && row.action_id === shareClick.action_id);
    for (const name of ['innerListener', 'onShareClick', 'sendShare', 'countShare']) {
      assert.ok(enters.some(row => idStart(row.function_id) === FN[name] && row.invoked_by === 'event'), `${name} entered under the share click`);
    }

    // (3) Composed CustomEvent -> React effect listeners -> fetch, direct.
    const share = byUrl('/api/share'), shareCount = byUrl('/api/share-count');
    assert.equal(share.length, 3, 'trusted share, untrusted inner click, programmatic share');
    assert.equal(shareCount.length, 3, 'trusted share, untrusted inner click, programmatic share');
    assert.equal(share[0].action_id, shareClick.action_id, '/api/share attributed to the shadow click');
    assert.equal(share[0].linkage_kind, 'direct');
    assert.deepEqual(share[0].spine.function_ids.map(idStart).filter(start => [FN.innerListener, FN.onShareClick, FN.sendShare].includes(start)).filter((v, i, a) => a.indexOf(v) === i),
      [FN.innerListener, FN.onShareClick, FN.sendShare]);
    assert.equal(shareCount[0].action_id, shareClick.action_id, 'ancestor listener fetch attributed to the shadow click');
    assert.equal(shareCount[0].linkage_kind, 'direct');
    const chains = new Map(buildActionChains(rows, [], { backendInstrumented: false }).map(chain => [chain.action_id, chain]));
    const shareChain = chains.get(shareClick.action_id);
    assert.equal(idStart(shareChain.entry_handler?.function_id), FN.innerListener, 'chain credits the inner listener');
    assert.equal(shareChain.entry_handler.rooted, true);
    assert.deepEqual(shareChain.requests.map(row => row.url).sort(), ['/api/share', '/api/share-count']);
    assert.equal(shareChain.stopped_at, 'network');
    assert.equal(shareChain.because, 'backend not instrumented');
    assert.deepEqual(shareChain.target_frontier, { closed_shadow: false, host: 'share-chip', target: 'button' });

    // (4) Closed shadow root: host + stated frontier.
    assert.equal(lockClick.target.tag, 'lock-chip');
    assert.equal(lockClick.target.composed, true);
    assert.equal(lockClick.target.closed_shadow, true);
    const lockChain = chains.get(lockClick.action_id);
    assert.equal(lockChain.requests.length, 0);
    assert.equal(lockChain.stopped_at, 'entry_handler');
    assert.equal(lockChain.because, SCOPED_ABSENCE.closed_shadow, 'closed-root frontier, scoped like every request-less sentence');
    assert.notEqual(lockChain.because, SCOPED_ABSENCE.no_request);
    assert.equal(lockChain.handler_abstention.closed_shadow, true);
    assert.ok(lockChain.handler_abstention.handlers_ran.some(id => idStart(id) === FN.lockListener), 'the closed-root listener ran under the click, unresolved');
    assert.equal(lockChain.target_frontier.closed_shadow, true);

    // Negatives: outside clicks and later programmatic events.
    for (const click of [refreshBefore, refreshAfter]) {
      assert.equal(click.target.composed, undefined, 'light-DOM click is not composed');
      assert.ok(share.every(row => row.action_id !== click.action_id) && shareCount.every(row => row.action_id !== click.action_id), 'Refresh is not attributed to share requests');
      assert.deepEqual(chains.get(click.action_id).requests.map(row => row.url), ['/api/refresh']);
      assert.equal(byUrl('/api/refresh').filter(row => row.action_id === click.action_id && row.linkage_kind === 'direct').length, 1);
    }
    for (const row of [share[1], shareCount[1]]) assert.equal(row.action_id, null, 'untrusted inner click after the actions is unattributed');
    for (const row of [share[2], shareCount[2]]) assert.equal(row.action_id, null, 'programmatic share event after the actions is unattributed');
    assert.ok(share[1].sequence > refreshAfter.sequence && shareCount[1].sequence > refreshAfter.sequence);

    // Re-registered listeners: the dispatching click wins over the owner.
    assert.equal(reshareClick.target.shadow_host?.tag, 'share-chip');
    assert.equal(pingClick.target.composed, undefined);
    assert.ok(stats.owned_listeners >= 2, `listeners re-added under Bump are owned (${stats.owned_listeners})`);
    assert.ok(stats.owned_listeners_dispatch_won >= 1 && stats.owned_listeners_dispatcher >= 4, `dispatch won over registration owner (${stats.owned_listeners_dispatch_won}, dispatcher ${stats.owned_listeners_dispatcher})`);
    const reshare = byUrl('/api/reshare'), ping = byUrl('/api/ping');
    assert.equal(reshare.length, 1, 'one trusted reshare');
    assert.equal(reshare[0].action_id, reshareClick.action_id, '/api/reshare belongs to click B, not to Bump');
    assert.equal(reshare[0].linkage_kind, 'direct');
    assert.ok(reshare[0].spine.function_ids.some(id => idStart(id) === FN.innerListener) && reshare[0].spine.function_ids.some(id => idStart(id) === FN.onReshare));
    assert.equal(ping.length, 1);
    assert.equal(ping[0].action_id, pingClick.action_id, '/api/ping belongs to the Ping click, not to Bump');
    assert.equal(ping[0].linkage_kind, 'direct');
    assert.ok(ping[0].spine.function_ids.some(id => idStart(id) === FN.onPing));
    // D-G1-20: trusted UI event with no action (pointerdown), and programmatic
    // events: never the registration owner.
    const pingDown = byUrl('/api/ping-down'), evaluated = byUrl('/api/reshare-evaluate'), laterShare = byUrl('/api/reshare-later'), loadShare = byUrl('/api/reshare-load');
    assert.equal(pingDown.length, 1);
    // D-G1-21: the pointerdown is now a recorded action; the listener runs on
    // its live dispatch (same gesture as the Ping click), never on Bump.
    const pingDownAction = rows.find(row => row.kind === 'dom.action' && row.event === 'pointerdown' && row.gesture_id && row.gesture_id === pingClick.gesture_id);
    assert.ok(pingDownAction, 'the pointerdown on Ping is recorded, in the click\'s gesture');
    assert.equal(pingDown[0].action_id, pingDownAction.action_id, 'pointerdown on Ping belongs to the recorded pointerdown, never Bump');
    assert.ok(pingDown[0].sequence < pingClick.sequence);
    assert.equal(evaluated.length, 1);
    assert.equal(evaluated[0].action_id, null, 'programmatic share outside any dispatch is unattributed, never Bump');
    assert.equal(loadShare.length, 1);
    assert.equal(loadShare[0].action_id, null, 'programmatic share from a load-time timer is unattributed, never Bump');
    assert.equal(laterShare.length, 1);
    assert.equal(laterShare[0].action_id, laterClick.action_id, 'programmatic share from a timer armed by Later belongs to Later');
    const focused = byUrl('/api/focused');
    assert.equal(focused.length, 1);
    assert.equal(focused[0].action_id, focusClick.action_id, 'focus from el.focus() inside a click belongs to that click, never Bump');
    // D-G1-21: the focus is also recorded, caused by the click and running on it.
    assert.ok(rows.some(row => row.kind === 'dom.action' && row.event === 'focus' && row.gesture === false && row.caused_by_action_id === focusClick.action_id && row.runs_on_action_id === focusClick.action_id), 'the caused focus row runs on the click');
    // D-G1-21: every trusted user event starts an action, so an owned UI
    // listener always finds a live dispatch (owned_listeners_ui_unowned is
    // reached only by a UI kind the runtime does not observe).
    assert.ok(stats.owned_listeners_dispatch_won >= 2 && stats.owned_listeners_dispatcher >= 3, JSON.stringify(stats));
    for (const bump of [bumpA, bumpA2, bumpA3]) {
      assert.ok([...reshare, ...ping, ...pingDown, ...evaluated, ...laterShare, ...loadShare, ...focused].every(row => row.action_id !== bump.action_id), 'no request is credited to Bump');
      assert.deepEqual(chains.get(bump.action_id).requests, []);
    }
    assert.deepEqual(chains.get(reshareClick.action_id).requests.map(row => row.url), ['/api/reshare']);
    assert.equal(idStart(chains.get(pingClick.action_id).entry_handler?.function_id), FN.onPing);
    assert.deepEqual(chains.get(pingClick.action_id).requests.map(row => row.url), ['/api/ping']);
    reports.push({ attempt, share_click: { target: shareClick.target, bound: shareClick.bound_handlers }, lock_click: lockClick.target,
      share_chain: { entry_handler: shareChain.entry_handler.function_id, stopped_at: shareChain.stopped_at, because: shareChain.because, requests: shareChain.requests.map(row => row.url), target_frontier: shareChain.target_frontier },
      reregistered: { reshare: reshare[0].action_id === reshareClick.action_id ? 'reshare-click' : reshare[0].action_id, ping: ping[0].action_id === pingClick.action_id ? 'ping-click' : ping[0].action_id,
        ping_down: pingDown[0].action_id, evaluate_share: evaluated[0].action_id, later_share: laterShare[0].action_id === laterClick.action_id ? 'later-click' : laterShare[0].action_id, load_timer_share: loadShare[0].action_id, focused: focused[0].action_id === focusClick.action_id ? 'focus-it-click' : focused[0].action_id,
        owned_listeners: stats.owned_listeners, dispatch_won: stats.owned_listeners_dispatch_won, dispatcher: stats.owned_listeners_dispatcher, ui_unowned: stats.owned_listeners_ui_unowned },
      lock_chain: { stopped_at: lockChain.stopped_at, because: lockChain.because, target_frontier: lockChain.target_frontier },
      requests: requests.map(row => ({ url: row.url, action: row.action_id === shareClick.action_id ? 'share-click' : row.action_id === refreshBefore.action_id || row.action_id === refreshAfter.action_id ? 'refresh-click' : row.action_id, linkage_kind: row.linkage_kind })) });
  }
  console.log(JSON.stringify({ status: 'ok', headless: true, runs: RUNS, reports }, null, 2));
} finally {
  await browser.close(); await server.close(); fixture.cleanup();
}
