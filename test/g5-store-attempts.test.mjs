// G5 amendments to the G4 store/MCP (docs/gates/G5-demo.md §10):
// D-G5-2 a form submitted with a request more than once is split per submit;
// element_history groups an element's actions into attempts; D-G5-3 the
// no-key fallback accepts an ancestor tag of the annotated element.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../collector/store.mjs';
import { callTool } from '../mcp/tools.mjs';
import { indexWorkflowEpisodes } from '../analysis/runtime-attribution.mjs';

const KEY = 'p_aaaaaaaaaaaa:10-50#n1';
const page = 's_test';
let sequence = 0;
const row = extra => ({ schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, capture_page_id: page, parent_continuation_id: null, ...extra });
const target = { tag: 'button', attributes: {}, ref: 'object:9', element_key: KEY };
const form = { tag: 'form', attributes: {}, ref: 'object:5' };

function scenario(statuses) {
  sequence = 0;
  const records = [row({ kind: 'element.stamp', stamp_sequence: 1, session: page, element_key: KEY, placement_id: 'placement:x:10:50', file: 'src/Button.jsx', line: 3, start: 10, end: 50,
    component: 'Button', tag: 'button', host_tag: 'button', handlers: [], build: 'b1', url: 'http://127.0.0.1:4100/settings', timestamp: 1 })];
  const spans = [];
  statuses.forEach((status, index) => {
    const t = 1000 * (index + 1);
    const base = `action:t:${index}`;
    records.push(row({ kind: 'dom.action', action_id: `${base}:f`, event: 'focusin', target, target_ref: target.ref, form, form_ref: form.ref, timestamp: t }));
    records.push(row({ kind: 'dom.action', action_id: `${base}:c`, event: 'click', target, target_ref: target.ref, form, form_ref: form.ref, timestamp: t + 1 }));
    records.push(row({ kind: 'dom.action', action_id: `${base}:s`, event: 'submit', target, target_ref: target.ref, submitter: { tag: 'button', attributes: {} }, form, form_ref: form.ref, timestamp: t + 1 }));
    records.push(row({ kind: 'network.request', action_id: `${base}:s`, request_occurrence_id: `${base}:s:request:1`, method: 'POST', url: '/api/thing/update', internal: false,
      trace_context: { trace_id: `trace${index}`, span_id: `client${index}` }, timestamp: t + 2 }));
    spans.push({ schema: 'producttrace.backend-span.v1', kind: 'server', trace_id: `trace${index}`, span_id: `server${index}`, parent_span_id: `client${index}`,
      attributes: { 'http.request.method': 'POST', 'http.route': '/api/thing/update', 'http.response.status_code': status } });
    spans.push({ schema: 'producttrace.backend-span.v1', kind: 'internal', trace_id: `trace${index}`, span_id: `handler${index}`, parent_span_id: `server${index}`,
      instrumentation: { name: 'producttrace-express-handlers' }, attributes: { 'http.route': '/api/thing/update', 'producttrace.express.handler.name': 'update', 'producttrace.express.handler.index': 0 } });
  });
  records.push(row({ kind: 'dom.action', action_id: 'action:t:typing', event: 'input', target: { tag: 'input', attributes: {}, ref: 'object:7' }, target_ref: 'object:7', form, form_ref: form.ref, timestamp: 9000 }));
  return { records, spans };
}

test('D-G5-2 (shared indexer): a form episode closes at each submit that sent a request; later actions start the next', () => {
  const { records } = scenario([200, 422, 200]);
  const indexed = indexWorkflowEpisodes(records);
  const episodes = [...indexed.episodes.values()];
  const base = 'episode:form:s_test:object%3A5';
  assert.deepEqual(episodes.map(episode => [episode.episode_id, episode.carrier_action_id]), [
    [base, 'action:t:0:s'], [`${base}#2`, 'action:t:1:s'], [`${base}#3`, 'action:t:2:s']]);
  assert.equal(indexed.byAction.get('action:t:1:c'), `${base}#2`);
  assert.equal(indexed.byAction.get('action:t:1:f'), `${base}#2`);
  // The trailing keystroke has no effect and no submit: it joins the form's most recent episode.
  assert.equal(indexed.byAction.get('action:t:typing'), `${base}#3`);
  // Ids are stable as evidence grows: the first attempt alone keeps the form id.
  const early = records.filter(row => !String(row.action_id || '').startsWith('action:t:1') && !String(row.action_id || '').startsWith('action:t:2'));
  assert.equal(indexWorkflowEpisodes(early).byAction.get('action:t:0:s'), base);
  // A rejected submit (no request) stays in the episode of the next request-bearing submit.
  const rejected = scenario([200]).records.map(row => row);
  rejected.splice(1, 0, { kind: 'dom.action', action_id: 'action:r:s', event: 'submit', target, target_ref: target.ref, form, form_ref: form.ref, timestamp: 500, sequence: 0.5, capture_page_id: page });
  const withRejected = indexWorkflowEpisodes(rejected);
  assert.equal(withRejected.byAction.get('action:r:s'), withRejected.byAction.get('action:t:0:s'));
});

test('element_history: each attempt carries its own request, route status and frontier, newest first', () => {
  const { records, spans } = scenario([200, 422, 200]);
  const store = createStore({ records, spans, now: () => 1e12 });
  const history = callTool(store, 'element_history', { element_key: KEY, n: 10 });
  assert.equal(history.status, 'ok');
  assert.equal(history.actions.length, 9);
  assert.deepEqual(history.attempts.map(attempt => [attempt.carrier_action_id, attempt.route.status_code, attempt.events.join(',')]), [
    ['action:t:2:s', 200, 'submit,click,focusin'], ['action:t:1:s', 422, 'submit,click,focusin'], ['action:t:0:s', 200, 'submit,click,focusin']]);
  assert.match(history.attempts[1].because, /^server responded 422; /u);
  assert.doesNotMatch(history.attempts[0].because, /server responded/u);
  // Episode-focus rule (2026-09-24): the click is a non-carrier member of the
  // 422 attempt. Its chain shows only its own evidence plus a pointer to that
  // attempt's carrier, never the carrier's request or route.
  const chain = callTool(store, 'action_chain', { action_id: 'action:t:1:c' });
  assert.equal(chain.episode_carrier_action_id, 'action:t:1:s', 'the click belongs to the 422 attempt, not to the last submit');
  assert.equal(chain.episode_member, true);
  assert.equal(chain.episode_pointer, `this action is part of episode ${history.attempts[1].episode_id}; its request is attributed to the carrier action action:t:1:s`);
  assert.equal(chain.stops.some(stop => ['request', 'route', 'handler', 'db'].includes(stop.stop)), false, 'no carrier stops on the member');
  assert.deepEqual(chain.segments, []);
  assert.ok(chain.summary.split('\n')[0].endsWith(chain.episode_pointer), chain.summary);
  const carrier = callTool(store, 'action_chain', { action_id: 'action:t:1:s' });
  assert.equal(carrier.stops.find(stop => stop.stop === 'route').status_code, 422);
  assert.equal(carrier.episode_member, undefined);
});

test('element_history: n counts attempts, so three attempts among many keystrokes all come back at n: 3', () => {
  const INPUT_KEY = 'p_bbbbbbbbbbbb:60-90#n1';
  const input = { tag: 'input', attributes: {}, ref: 'object:7', element_key: INPUT_KEY };
  const { records, spans } = scenario([200, 422, 200]);
  records.splice(1, 0, row({ kind: 'element.stamp', stamp_sequence: 2, session: page, element_key: INPUT_KEY, placement_id: 'placement:x:60:90', file: 'src/Name.jsx', line: 5, start: 60, end: 90,
    component: 'Name', tag: 'input', host_tag: 'input', handlers: [], build: 'b1', url: 'http://127.0.0.1:4100/settings', timestamp: 1 }));
  // Twelve keystrokes into the name input before each attempt's submit, in that attempt's form episode.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const submitIndex = records.findIndex(entry => entry.action_id === `action:t:${attempt}:f`);
    const keys = Array.from({ length: 12 }, (_, index) => row({ kind: 'dom.action', action_id: `action:t:${attempt}:k${index}`, event: 'input', target: input, target_ref: input.ref,
      form, form_ref: form.ref, timestamp: 1000 * (attempt + 1) - 50 + index }));
    records.splice(submitIndex, 0, ...keys);
  }
  records.forEach((entry, index) => { entry.sequence = index + 1; });
  const store = createStore({ records, spans, now: () => 1e12 });
  const history = callTool(store, 'element_history', { element_key: INPUT_KEY, n: 3 });
  assert.equal(history.status, 'ok');
  assert.equal(history.attempts.length, 3);
  assert.equal(history.actions.length, 36);
  assert.deepEqual(history.attempts.map(attempt => attempt.route.status_code), [200, 422, 200]);
  const one = callTool(store, 'element_history', { element_key: INPUT_KEY, n: 1 });
  assert.equal(one.attempts.length, 1); assert.equal(one.actions.length, 12); assert.equal(one.attempts[0].carrier_action_id, 'action:t:2:s');
  // The default (10) and the button's own history are unchanged.
  assert.equal(callTool(store, 'element_history', { element_key: KEY }).attempts.length, 3);
});

test('typing after the last save (no request, DOM change or submit) stays in the form\'s most recent episode', () => {
  // The independent regrade's synthetic case: two saves, then keystrokes with no effect.
  sequence = 0;
  const FIELD = 'p_ffffffffffff:1-9#n1';
  const field = { tag: 'input', attributes: {}, ref: 'object:7', element_key: FIELD };
  const records = [row({ kind: 'element.stamp', stamp_sequence: 1, session: page, element_key: FIELD, placement_id: 'placement:f:1:9', file: 'src/Name.jsx', line: 2, start: 1, end: 9,
    component: 'Name', tag: 'input', host_tag: 'input', handlers: [], build: 'b1', url: 'http://127.0.0.1:4100/settings', timestamp: 1 })];
  const spans = [];
  for (const [index, status] of [[0, 200], [1, 422]]) {
    const t = 1000 * (index + 1);
    records.push(row({ kind: 'dom.action', action_id: `action:v:${index}:k`, event: 'input', target: field, target_ref: field.ref, form, form_ref: form.ref, timestamp: t }));
    records.push(row({ kind: 'dom.action', action_id: `action:v:${index}:s`, event: 'submit', target: field, target_ref: field.ref, form, form_ref: form.ref, timestamp: t + 1 }));
    records.push(row({ kind: 'network.request', action_id: `action:v:${index}:s`, request_occurrence_id: `action:v:${index}:s:request:1`, method: 'POST', url: '/api/thing/update', internal: false,
      trace_context: { trace_id: `tv${index}`, span_id: `cv${index}` }, timestamp: t + 2 }));
    spans.push({ schema: 'producttrace.backend-span.v1', kind: 'server', trace_id: `tv${index}`, span_id: `sv${index}`, parent_span_id: `cv${index}`,
      attributes: { 'http.request.method': 'POST', 'http.route': '/api/thing/update', 'http.response.status_code': status } });
  }
  for (let index = 0; index < 3; index += 1) records.push(row({ kind: 'dom.action', action_id: `action:v:tail:${index}`, event: 'input', target: field, target_ref: field.ref, form, form_ref: form.ref, timestamp: 5000 + index }));
  const indexed = indexWorkflowEpisodes(records);
  const base = 'episode:form:s_test:object%3A5';
  assert.deepEqual([...indexed.episodes.keys()], [base, `${base}#2`]);
  for (let index = 0; index < 3; index += 1) assert.equal(indexed.byAction.get(`action:v:tail:${index}`), `${base}#2`);
  assert.equal(indexed.episodes.get(`${base}#2`).carrier_action_id, 'action:v:1:s', 'the carrier stays the request-sending submit');
  const store = createStore({ records, spans, now: () => 1e12 });
  const history = callTool(store, 'element_history', { element_key: FIELD, n: 2 });
  assert.deepEqual(history.attempts.map(attempt => [attempt.episode_id, attempt.route.status_code, attempt.action_ids.length]), [[`${base}#2`, 422, 5], [base, 200, 2]]);
  // A form with no effect at all still has no episode (unchanged from before the split).
  assert.equal(indexWorkflowEpisodes(records.filter(entry => String(entry.action_id || '').startsWith('action:v:tail'))).episodes.size, 0);
});

test('D-G5-3: the no-key fallback matches a recorded target named by an ancestor step, and never picks', () => {
  const { records, spans } = scenario([200, 422, 200]);
  const store = createStore({ records, spans, now: () => 1e12 });
  const result = callTool(store, 'resolve_element', { url: 'http://127.0.0.1:4100/settings', selector: 'form.x:nth-of-type(1) > div.y:nth-of-type(1) > button.z:nth-of-type(1) > div.label:nth-of-type(1)',
    element_path: 'form > div > button > div', name: 'Save', nearby_text: 'Save' });
  assert.equal(result.status, 'ambiguous'); assert.equal(result.confidence, 'ambiguous');
  assert.ok(result.candidates.some(candidate => candidate.keys.some(entry => entry.element_key === KEY)));
  assert.match(result.candidates[0].matched_on.join(' '), /ancestor tag=button/u);
  // Another stamped <button> with the same recorded tag and attributes elsewhere
  // (anything-llm: SearchBox vs CTAButton) is its own candidate, never merged.
  const OTHER = 'p_eeeeeeeeeeee:1-9#n1';
  const other = { tag: 'button', attributes: {}, ref: 'object:99', element_key: OTHER };
  const merged = scenario([200, 422, 200]);
  merged.records.splice(1, 0, row({ kind: 'element.stamp', stamp_sequence: 3, session: page, element_key: OTHER, placement_id: 'placement:y:1:9', file: 'src/Search.jsx', line: 7, start: 1, end: 9,
    component: 'SearchBox', tag: 'button', host_tag: 'button', handlers: [], build: 'b1', url: 'http://127.0.0.1:4100/settings', timestamp: 1 }));
  merged.records.push(row({ kind: 'dom.action', action_id: 'action:o:1', event: 'click', target: other, target_ref: other.ref, timestamp: 9500 }));
  merged.records.push(row({ kind: 'dom.action', action_id: 'action:o:2', event: 'click', target: other, target_ref: other.ref, timestamp: 9600 }));
  const split = callTool(createStore({ ...merged, now: () => 1e12 }), 'resolve_element', { selector: 'form > div > button > div', element_path: 'form > div > button > div', name: 'Save' });
  assert.equal(split.status, 'ambiguous');
  const buttons = split.candidates.filter(candidate => candidate.target.tag === 'button');
  assert.ok(buttons.every(candidate => candidate.keys.length <= 1), 'one element key per candidate');
  assert.deepEqual(buttons.map(candidate => [candidate.keys[0]?.element_key, candidate.actions_observed]).sort(), [[KEY, 9], [OTHER, 2]]);
  const noAncestor = callTool(store, 'resolve_element', { selector: 'section > div.label' });
  assert.equal(noAncestor.status, 'not_found');
});
