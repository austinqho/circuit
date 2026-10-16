// No cross-control merge (headless): an action's chain is never printed under
// another action on a different control. Neutral fixture
// (fixtures/confirm-dialog-app): three "Remove" buttons that only open a
// confirmation dialog rendered in a portal, and a keyboard action inside each
// dialog (Enter) that sends the DELETE:
//   (A) opener outside any form, the dialog handles Enter;
//   (B) opener inside a form (aria-haspopup="dialog"), the dialog is a portal,
//       then the form's own submit sends a request the opener must not print;
//   (C) opener outside any form, the dialog holds its own form, Enter submits.
// Negative control: typing then submitting one form is one episode.
//   node test/browser/no-cross-control-neutral.mjs [dependencyRoot] [--rows <out.json>]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildReactFixture, serveFixture } from './fixture-build.mjs';
import { indexWorkflowEpisodes } from '../../analysis/runtime-attribution.mjs';
import { buildEpisodeChain, chainFrontier } from '../../analysis/causal-chain.mjs';

const tracerRoot = path.resolve(import.meta.dirname, '../..');
const positional = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith('--') && all[index - 1] !== '--rows');
const rowsOut = process.argv.includes('--rows') ? process.argv[process.argv.indexOf('--rows') + 1] : null;
const dependencyRoot = path.resolve(positional[0] || '/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1');
const appSource = fs.readFileSync(path.join(tracerRoot, 'test/browser/fixtures/confirm-dialog-app/main.jsx'), 'utf8');
const fixture = await buildReactFixture({ dependencyRoot, appSource, name: 'confirm-dialog' });
const ok = () => ({ ok: true });
const server = await serveFixture(fixture.distRoot, { 'POST /api/beta': ok, 'DELETE /api/items/alpha': ok, 'DELETE /api/items/beta': ok, 'DELETE /api/items/gamma': ok, 'POST /api/items': ok });
const { chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.PRODUCTTRACE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(server.origin, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  for (const name of ['alpha', 'beta']) {
    await page.getByRole('button', { name: `Remove ${name}` }).click(); await page.waitForTimeout(300);
    await page.getByRole('dialog', { name: `Confirm ${name}` }).waitFor();
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  }
  // The beta form's own submit, after its opener was used.
  await page.getByLabel('Beta title').click(); await page.keyboard.type('b');
  await page.getByRole('button', { name: 'Save beta' }).click(); await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Remove gamma' }).click(); await page.waitForTimeout(300);
  await page.getByLabel('Type gamma to confirm').waitFor();
  await page.keyboard.type('gamma'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  await page.getByLabel('Item name').click(); await page.keyboard.type('abc'); await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Add' }).click(); await page.waitForTimeout(900);
  const rows = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__productTraceRuntime.records)));
  await page.close();
  if (rowsOut) fs.writeFileSync(rowsOut, JSON.stringify(rows));
  assert.deepEqual(errors, []);

  const registeredFunctionIds = (fixture.manifest.functions || []).map(row => row.id);
  const indexed = indexWorkflowEpisodes(rows);
  const actions = rows.filter(row => row.kind === 'dom.action').sort((a, b) => a.sequence - b.sequence);
  const actionById = new Map(actions.map(row => [row.action_id, row]));
  const requests = rows.filter(row => row.kind === 'network.request' && !row.internal);
  const chainOf = actionId => {
    const episode = indexed.episodes.get(indexed.byAction.get(actionId));
    assert.ok(episode, `action ${actionId} (${actionById.get(actionId)?.event}) has an episode`);
    const record = buildEpisodeChain(episode, rows, [], { registeredFunctionIds, idle: true, backendInstrumented: false });
    return { episode, record, frontier: chainFrontier(record, { backendInstrumented: false }) };
  };
  // Enter in the gamma dialog's field is an implicit submission: the browser
  // also dispatches a click on that form's submit button. The three openers
  // are the type="button" clicks; the add button is the last submit button.
  const buttonClicks = actions.filter(row => row.event === 'click' && row.target?.tag === 'button');
  const openers = buttonClicks.filter(row => row.target?.attributes?.type === 'button');
  assert.equal(openers.length, 3, `three opener clicks: ${JSON.stringify(buttonClicks.map(row => row.target))}`);
  const [alphaRemove, betaRemove, gammaRemove] = openers;
  const addClick = buttonClicks.filter(row => row.target?.attributes?.type === 'submit').at(-1);
  assert.ok(betaRemove.form_ref, 'the beta opener is inside a form');

  // The rule, over every episode: one control (target identity) or one form
  // the targets are inside. No action rides into another control's episode.
  for (const episode of indexed.episodes.values()) {
    if (episode.form_ref) {
      for (const row of episode.actions) assert.equal(row.form_ref, episode.form_ref, `${episode.episode_id}: ${row.event} is inside the episode's form`);
    } else {
      const refs = new Set(episode.actions.map(row => row.target_ref || row.target?.ref || null));
      assert.equal(refs.size, 1, `${episode.episode_id}: one control, got ${[...refs].join(', ')}`);
    }
  }

  const report = {};
  for (const [name, opener] of [['alpha', alphaRemove], ['beta', betaRemove], ['gamma', gammaRemove]]) {
    const deletes = requests.filter(row => row.url === `/api/items/${name}`);
    assert.equal(deletes.length, 1, `one DELETE for ${name}`);
    assert.equal(String(deletes[0].method).toUpperCase(), 'DELETE');
    const opened = chainOf(opener.action_id);
    const confirmed = chainOf(deletes[0].action_id);
    // Two episodes.
    assert.notEqual(opened.episode.episode_id, confirmed.episode.episode_id, `${name}: opener and confirm are two episodes`);
    // The opener's chain has no request and stops at the DOM (or browser).
    assert.equal(opened.record.chain.some(step => step.kind === 'network.request'), false, `${name}: opener chain has no request`);
    assert.equal(opened.frontier.reached, 'dom_mutation', `${name}: opener reached ${opened.frontier.reached}`);
    assert.equal(opened.frontier.stopped_at, 'browser', `${name}: opener stopped at ${opened.frontier.stopped_at}`);
    assert.ok(opened.episode.actions.every(row => (row.target_ref || row.target?.ref) === opener.target_ref),
      `${name}: opener episode holds only the opener's control, even inside a form`);
    assert.equal(opened.episode.action_ids.includes(deletes[0].action_id), false);
    // The confirm chain carries the DELETE and the Enter key; none of its
    // actions is on the opener's control.
    const request = confirmed.record.chain.find(step => step.kind === 'network.request');
    assert.equal(request?.url, `/api/items/${name}`, `${name}: confirm chain carries the DELETE`);
    assert.ok(confirmed.episode.actions.some(row => row.event === 'keydown' && row.key?.key === 'Enter'), `${name}: confirm episode holds key Enter`);
    assert.ok(confirmed.episode.actions.every(row => (row.target_ref || row.target?.ref) !== opener.target_ref), `${name}: confirm episode has no action on the opener`);
    assert.ok(confirmed.episode.actions.every(row => !row.form_ref || row.form_ref !== opener.form_ref), `${name}: the portal dialog is not in the opener's form`);
    report[name] = {
      opener: { episode_id: opened.episode.episode_id, actions: opened.episode.actions.map(row => row.event), reached: opened.frontier.reached, stopped_at: opened.frontier.stopped_at, request: null },
      confirm: { episode_id: confirmed.episode.episode_id, actions: confirmed.episode.actions.map(row => `${row.event}${row.key ? `:${row.key.key}` : ''}`),
        carrier_event: confirmed.record.event, request: `${request.method} ${request.url}`, stopped_at: confirmed.frontier.stopped_at },
    };
  }

  // (B) continued: the beta form's own submit sends POST /api/beta. Its
  // episode holds the field and the submit, not the opener, and the opener's
  // chain (checked above) still has no request.
  const betaPost = requests.filter(row => row.url === '/api/beta');
  assert.equal(betaPost.length, 1);
  const saved = chainOf(betaPost[0].action_id);
  assert.equal(saved.episode.form_ref, betaRemove.form_ref);
  assert.equal(saved.episode.action_ids.includes(betaRemove.action_id), false, 'the beta opener is not in its form\'s submit episode');
  assert.notEqual(indexed.byAction.get(betaRemove.action_id), saved.episode.episode_id);
  report.beta.form_submit = { episode_id: saved.episode.episode_id, actions: saved.episode.actions.map(row => row.event), request: 'POST /api/beta' };

  // Negative control: typing then submit in one form stays one episode.
  const post = requests.filter(row => row.url === '/api/items' && String(row.method).toUpperCase() === 'POST');
  assert.equal(post.length, 1);
  const added = chainOf(post[0].action_id);
  const formActions = actions.filter(row => row.form_ref && row.form_ref === addClick.form_ref);
  assert.ok(formActions.filter(row => row.event === 'keydown').length >= 3, 'typed keystrokes are inside the form');
  // D-G1-21: the episode kinds on the form are its members (unchanged);
  // every other row on the form (pointer phases, keyup, hover ranges ...) is
  // a member or gesture context of that episode, or held by no episode, and
  // never by another episode.
  const episodeKinds = new Set(['click', 'input', 'change', 'submit', 'keydown', 'focusin']);
  const contextIds = new Set(added.episode.gesture_action_ids || []);
  assert.deepEqual(added.episode.action_ids.filter(id => episodeKinds.has(formActions.find(row => row.action_id === id)?.event)),
    formActions.filter(row => episodeKinds.has(row.event)).map(row => row.action_id), 'every episode-kind action on the add form is one episode');
  assert.ok(formActions.filter(row => !episodeKinds.has(row.event)).every(row => added.episode.action_ids.includes(row.action_id) || contextIds.has(row.action_id) || !indexed.byAction.has(row.action_id)),
    'no other row on the add form is in another episode');
  assert.equal(added.record.chain.find(step => step.kind === 'network.request')?.url, '/api/items');
  report.add_item = { episode_id: added.episode.episode_id, actions: added.episode.actions.map(row => `${row.event}${row.key ? `:${row.key.key}` : ''}`), carrier_event: added.record.event };
  console.log(JSON.stringify({ status: 'ok', headless: true, episodes: indexed.episodes.size, report }, null, 2));
} finally {
  await browser.close(); await server.close(); fixture.cleanup();
}
