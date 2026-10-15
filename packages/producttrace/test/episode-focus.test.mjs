// Episode-focus rule (docs/gates/G5-demo.md §16) on synthetic rows; the
// headless proof is test/browser/episode-focus.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActionChains, indexWorkflowEpisodes } from '../analysis/runtime-attribution.mjs';
import { createStore } from '../collector/store.mjs';
import { callTool } from '../mcp/tools.mjs';

let sequence = 0;
const row = extra => ({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, capture_page_id: 'p', ...extra });
const button = ref => ({ tag: 'button', attributes: { type: 'button' }, ref });
const input = ref => ({ tag: 'input', attributes: {}, ref });
const form = { tag: 'form', attributes: {}, ref: 'object:f' };
const KEY = 'p_eeeeeeeeeeee:1-9#n1';
const ONLY_CAUSED = 'p_dddddddddddd:1-9#n1';

function rows() {
  sequence = 0;
  return [
    // A click opens a dialog; the dialog focuses itself (caused); Enter 500 ms later deletes.
    row({ kind: 'dom.action', action_id: 'a:click', event: 'click', target: button('object:1'), target_ref: 'object:1', timestamp: 1000 }),
    row({ kind: 'dom.mutation', action_id: 'a:click', count: 3, timestamp: 1001 }),
    row({ kind: 'dom.action', action_id: 'a:focus', event: 'focusin', target: button('object:2'), target_ref: 'object:2', gesture: false, caused_by_action_id: 'a:click', caused_via: 'microtask', timestamp: 1002 }),
    row({ kind: 'dom.action', action_id: 'a:enter', event: 'keydown', key: { key: 'Enter' }, target: button('object:2'), target_ref: 'object:2', timestamp: 1502 }),
    row({ kind: 'network.request', action_id: 'a:enter', request_occurrence_id: 'r1', method: 'DELETE', url: '/api/items/1', timestamp: 1503 }),
    // A caused focus on a form field is not a form member.
    row({ kind: 'dom.action', action_id: 'b:click', event: 'click', target: button('object:3'), target_ref: 'object:3', timestamp: 3000 }),
    row({ kind: 'dom.action', action_id: 'b:focus', event: 'focusin', target: input('object:4'), target_ref: 'object:4', form, form_ref: form.ref, gesture: false, caused_by_action_id: 'b:click', caused_via: 'dispatch', timestamp: 3001 }),
    row({ kind: 'dom.action', action_id: 'b:submit', event: 'submit', target: form, target_ref: form.ref, form, form_ref: form.ref, timestamp: 3600 }),
    row({ kind: 'network.request', action_id: 'b:submit', request_occurrence_id: 'r2', method: 'POST', url: '/api/form', timestamp: 3601 }),
    // Control: a Tab focus (no mark) folds into the Enter on the same control.
    row({ kind: 'dom.action', action_id: 'c:focus', event: 'focusin', target: input('object:5'), target_ref: 'object:5', timestamp: 5000 }),
    row({ kind: 'dom.action', action_id: 'c:enter', event: 'keydown', key: { key: 'Enter' }, target: input('object:5'), target_ref: 'object:5', timestamp: 5300 }),
    row({ kind: 'network.request', action_id: 'c:enter', request_occurrence_id: 'r3', method: 'POST', url: '/api/search', timestamp: 5301 }),
    // A focus committed from React's scheduler: not a gesture, cause abstained.
    row({ kind: 'dom.action', action_id: 'd:focus', event: 'focusin', target: { ...button('object:6'), element_key: ONLY_CAUSED }, target_ref: 'object:6', gesture: false, caused_by_action_id: null, cause_abstained: 'scheduler_lineage', timestamp: 7000 }),
    // A click that focuses its own control, on a stamped element, then a second click.
    row({ kind: 'dom.action', action_id: 'e:click1', event: 'click', target: { ...button('object:7'), element_key: KEY }, target_ref: 'object:7', timestamp: 8000 }),
    row({ kind: 'dom.mutation', action_id: 'e:click1', count: 1, timestamp: 8001 }),
    row({ kind: 'dom.action', action_id: 'e:focus', event: 'focusin', target: { ...button('object:7'), element_key: KEY }, target_ref: 'object:7', gesture: false, caused_by_action_id: 'e:click1', caused_via: 'dispatch', timestamp: 8002 }),
    row({ kind: 'dom.action', action_id: 'e:click2', event: 'click', target: { ...button('object:7'), element_key: KEY }, target_ref: 'object:7', timestamp: 9000 }),
    row({ kind: 'dom.mutation', action_id: 'e:click2', count: 1, timestamp: 9001 }),
  ];
}

test('a caused focus never folds into a later action and is listed under its cause; a Tab focus still folds', () => {
  const { episodes, byAction } = indexWorkflowEpisodes(rows());
  assert.equal(byAction.has('a:focus'), false);
  assert.deepEqual(episodes.get(byAction.get('a:enter')).action_ids, ['a:enter']);
  assert.deepEqual(episodes.get(byAction.get('a:click')).caused_action_ids, ['a:focus']);
  assert.equal(byAction.has('b:focus'), false, 'not a member of the form it focused');
  assert.deepEqual(episodes.get(byAction.get('b:submit')).action_ids, ['b:submit']);
  assert.deepEqual(episodes.get(byAction.get('b:click')).caused_action_ids, ['b:focus']);
  assert.deepEqual(episodes.get(byAction.get('c:enter')).action_ids, ['c:focus', 'c:enter']);
});

test('MCP: the caused focus prints no DELETE; a member prints only its own evidence and a pointer', () => {
  const store = createStore({ records: rows(), spans: [], now: () => 1e12 });
  const focus = callTool(store, 'action_chain', { action_id: 'a:focus' });
  assert.equal(JSON.stringify(focus).includes('/api/items/1'), false);
  assert.equal(focus.caused_by_action_id, 'a:click');
  assert.equal(focus.caused_by_episode_id, 'episode:a:click');
  const click = callTool(store, 'action_chain', { action_id: 'a:click' });
  assert.deepEqual(click.caused.map(entry => entry.action_id), ['a:focus']);
  const member = callTool(store, 'action_chain', { action_id: 'c:focus' });
  assert.equal(member.episode_pointer, 'this action is part of episode episode:c:enter; its request is attributed to the carrier action c:enter');
  assert.equal(JSON.stringify({ ...member, store: null }).includes('/api/search'), false);
  // Outcome labels (fix/outcome-labels): the member's own label is no_request, with the pointer sentence.
  assert.equal(member.outcome.status, 'no_request');
  assert.ok(member.outcome.sentence.endsWith(`; ${member.episode_pointer}`), member.outcome.sentence);
  assert.equal(JSON.stringify(member.outcome).includes('/api/search'), false);
  // The export builds the same member view.
  const exported = buildActionChains(rows(), [], { backendInstrumented: false }).find(chain => chain.action_id === 'c:focus');
  assert.equal(exported.outcome.status, 'no_request');
  assert.equal(exported.episode_pointer, member.episode_pointer);
  assert.equal(exported.episode_carrier_action_id, 'c:enter');
  const carrier = callTool(store, 'action_chain', { action_id: 'c:enter' });
  assert.equal(carrier.stops.find(stop => stop.stop === 'request').url, '/api/search');
});

test('an abstained focus is listed in recent_actions with its sentence and in no episode', () => {
  const store = createStore({ records: rows(), spans: [], now: () => 1e12 });
  assert.equal(indexWorkflowEpisodes(rows()).byAction.has('d:focus'), false);
  const listed = callTool(store, 'recent_actions', { n: 100 }).actions.find(action => action.action_id === 'd:focus');
  assert.equal(listed.gesture, false);
  assert.equal(listed.cause_abstained, 'scheduler_lineage');
  assert.equal(listed.caused_pointer, "focus caused by app code committed from React's scheduler; causing action not attributable");
  assert.equal(listed.standalone, true);
  assert.ok(listed.summary.endsWith("focus caused by app code committed from React's scheduler; causing action not attributable"));
});

test('element_history: caused focuses are not attempts and do not count toward n', () => {
  const store = createStore({ records: rows(), spans: [], now: () => 1e12 });
  const one = callTool(store, 'element_history', { element_key: KEY, n: 1 });
  assert.deepEqual(one.attempts.map(attempt => attempt.carrier_action_id), ['e:click2'], 'n: 1 is the newest user attempt, not the caused focus');
  assert.deepEqual(one.actions.map(action => action.action_id), ['e:click2'], 'the focus is not listed: its causing click is not in a kept attempt');
  const two = callTool(store, 'element_history', { element_key: KEY, n: 2 });
  assert.deepEqual(two.attempts.map(attempt => attempt.carrier_action_id), ['e:click2', 'e:click1']);
  assert.deepEqual(two.actions.map(action => action.action_id), ['e:click2', 'e:focus', 'e:click1']);
  assert.deepEqual(two.attempts[1].caused, [{ action_id: 'e:focus', event: 'focusin', caused_by_action_id: 'e:click1', gesture: false }]);
  assert.equal(two.attempts.some(attempt => attempt.action_ids.includes('e:focus')), false);
});

test('element_history on a key whose only rows are caused focuses lists them, with no attempts and never "no actions"', () => {
  const store = createStore({ records: rows(), spans: [], now: () => 1e12 });
  for (const n of [1, 10]) {
    const history = callTool(store, 'element_history', { element_key: ONLY_CAUSED, n });
    assert.equal(history.status, 'ok');
    assert.deepEqual(history.attempts, []);
    assert.deepEqual(history.actions.map(action => [action.action_id, action.gesture, action.cause_abstained]), [['d:focus', false, 'scheduler_lineage']]);
    assert.equal(history.actions[0].caused_pointer, "focus caused by app code committed from React's scheduler; causing action not attributable");
    assert.doesNotMatch(history.summary, /no actions/u);
    assert.match(history.summary, /^0 attempts on element .*; 1 caused focus\(es\) \(not user gestures\); newest: /u);
  }
});
