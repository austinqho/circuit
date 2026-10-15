import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeAttributionEngine, describeEpisodeEvidence, indexEntryHandlerUnits, indexWorkflowEpisodes, replayCausalChains, stableFunctionId } from '../analysis/runtime-attribution.mjs';
import { buildEpisodeChain, chainFrontier } from '../analysis/causal-chain.mjs';
import { instrumentFirstPartySource } from '../integrations/runtime-attribution.mjs';

test('function IDs are content-and-span stable and identities never include values', () => {
  const source = 'function save(input) { return input.id; }';
  assert.equal(stableFunctionId(source, 0, source.length), stableFunctionId(source, 0, source.length));
  const engine = createRuntimeAttributionEngine();
  const object = { secret: 'must-not-appear' };
  const encoded = engine.identity(object);
  assert.equal(encoded.kind, 'object');
  assert.equal(JSON.stringify(encoded).includes('secret'), false);
  assert.deepEqual(engine.identity('550e8400-e29b-41d4-a716-446655440000'), { kind: 'id', value: '550e8400-e29b-41d4-a716-446655440000' });
  assert.equal(engine.identity('printable input').type, 'string');
});

test('observed action produces one ordered chain and explicit stop', () => {
  const rows = [];
  const engine = createRuntimeAttributionEngine({ emit: row => rows.push(row), sessionId: 's1' });
  const action = engine.beginAction({ event: 'click', source_ref: { file: 'src/app.js', start: 1, end: 8 } });
  engine.runWithAction(action, () => {
    engine.enterFunction('f1', { file: 'src/app.js', start: 1, end: 8, args: [{ secret: true }] });
    engine.libraryCall('opaque-lib', 'submit', [{ secret: true }]);
    engine.request('req1', { method: 'POST' });
    engine.route('route1', { method: 'POST' });
    engine.handler('handler1');
    engine.database('db1', { operation: 'insert' });
    engine.commit('commit1', { surface: 'dom' });
  });
  const chain = engine.finishAction(action, { effect: { kind: 'database', id: 'db1' } });
  assert.deepEqual(chain.chain.map(step => step.kind), ['function.enter', 'library.call', 'network.request', 'route.dispatch', 'handler.enter', 'db.operation', 'surface.change']);
  assert.equal(chain.terminal.effect.id, 'db1');
  assert.equal(JSON.stringify(rows).includes('secret'), false);
  assert.equal(chain.abstained.length, 0);
});

test('negative replays stop at the removed evidence and never guess a replacement', () => {
  const engine = createRuntimeAttributionEngine({ sessionId: 's2' });
  const action = engine.beginAction({ event: 'click' });
  engine.runWithAction(action, () => {
    engine.request('req2'); engine.route('route2'); engine.handler('handler2'); engine.database('db2');
  });
  const raw = engine.records;
  assert.equal(replayCausalChains(raw, { removeKinds: ['dom.action'] })[0].terminal.stop_reason, 'dispatch_evidence_removed');
  assert.equal(replayCausalChains(raw, { removeKinds: ['network.request'] })[0].terminal.stop_reason, 'request_evidence_removed');
  assert.equal(replayCausalChains(raw, { removeKinds: ['route.dispatch', 'handler.enter'] })[0].terminal.stop_reason, 'span_evidence_removed');
});

test('neutral transform instruments JS and maps imported library boundaries', () => {
  const result = instrumentFirstPartySource("import { send } from 'opaque-lib'; export function save(x) { return send(x); }", 'src/save.js');
  assert.equal(result.manifest.length, 1);
  assert.equal(result.library_boundaries.length, 1);
  assert.match(result.code, /__productTraceRuntime\?\.enter/);
  assert.match(result.manifest[0].id, /^function:[0-9a-f]{64}:\d+:\d+$/);
});

test('effect-rooted entry handler makes a validator spine-only before a submitting handler', () => {
  const action = { kind: 'dom.action', action_id: 'a1', event: 'click', continuation_id: 'c1' };
  const rows = [
    action,
    { kind: 'function.enter', sequence: 2, action_id: 'a1', continuation_id: 'validator-frame', parent_continuation_id: 'c1', function_id: 'validator', invoked_by: 'event', spine: { action_id: 'a1', function_ids: ['validator'] } },
    { kind: 'function.exit', sequence: 3, action_id: 'a1', continuation_id: 'validator-frame', parent_continuation_id: 'c1', function_id: 'validator', invoked_by: 'event', spine: { action_id: 'a1', function_ids: ['validator'] } },
    { kind: 'function.enter', sequence: 4, action_id: 'a1', continuation_id: 'submit-frame', parent_continuation_id: 'c1', function_id: 'submit', invoked_by: 'event', spine: { action_id: 'a1', function_ids: ['submit'] } },
    { kind: 'function.enter', sequence: 5, action_id: 'a1', continuation_id: 'helper-frame', parent_continuation_id: 'submit-frame', function_id: 'helper', invoked_by: 'event', spine: { action_id: 'a1', function_ids: ['submit', 'helper'] } },
    { kind: 'network.request', sequence: 6, action_id: 'a1', continuation_id: 'request-frame', parent_continuation_id: 'helper-frame', terminal_owner_continuation_id: 'submit-frame', request_occurrence_id: 'r1', internal: false, spine: { action_id: 'a1', function_ids: ['submit', 'helper'] } },
    // Render/effect frames cannot become units even if their subtree mutates.
    { kind: 'dom.action', action_id: 'a2', event: 'submit', continuation_id: 'c3' },
    { kind: 'function.enter', sequence: 8, action_id: 'a2', continuation_id: 'render-frame', parent_continuation_id: 'c3', function_id: 'render', invoked_by: 'render', spine: { action_id: 'a2', function_ids: ['render'] } },
    { kind: 'dom.mutation', sequence: 9, action_id: 'a2', parent_continuation_id: 'render-frame' },
    { kind: 'dom.action', action_id: 'a3', event: 'keydown', continuation_id: 'c5' },
    { kind: 'function.enter', sequence: 11, action_id: 'a3', continuation_id: 'no-effect-frame', parent_continuation_id: 'c5', function_id: 'no-effect', invoked_by: 'event', spine: { action_id: 'a3', function_ids: ['no-effect'] } },
  ];
  const indexed = indexEntryHandlerUnits(rows, { registeredFunctionIds: ['validator', 'submit', 'helper', 'render', 'no-effect'] });
  assert.deepEqual([...indexed.units.keys()], ['submit|click', 'no-effect|keydown']);
  assert.deepEqual(indexed.byAction.get('a1'), ['submit|click']);
  assert.equal(indexed.byAction.has('a2'), false);
  assert.deepEqual(indexed.byAction.get('a3'), ['no-effect|keydown']);
  assert.deepEqual(indexed.units.get('submit|click').rooted_action_ids, ['a1']);
  assert.deepEqual(indexed.units.get('no-effect|keydown').unrooted_action_ids, ['a3']);
  assert.equal(indexed.units.has('helper|click'), false);
  assert.equal(indexed.units.has('validator|click'), false);
});

test('workflow episodes coalesce field edits and a submit-button click into the effect carrier', () => {
  const form = { tag: 'form', attributes: { 'aria-label': 'Configuration form' }, ref: 'object:1' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page-1', action_id: 'focus', event: 'click', form, form_ref: form.ref, target: { tag: 'textarea', attributes: { id: 'message' } } },
    { kind: 'dom.action', sequence: 2, timestamp: 2, capture_page_id: 'page-1', action_id: 'input', event: 'input', form, form_ref: form.ref, target: { tag: 'textarea', attributes: { id: 'message' } } },
    { kind: 'dom.action', sequence: 3, timestamp: 3, capture_page_id: 'page-1', action_id: 'enter', event: 'keydown', form, form_ref: form.ref, key: { key: 'Enter' }, target: { tag: 'textarea', attributes: { id: 'message' } } },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page-1', action_id: 'submit', event: 'submit', form, form_ref: form.ref, target: { tag: 'form', attributes: {} } },
    { kind: 'network.request', sequence: 5, timestamp: 5, capture_page_id: 'page-1', action_id: 'submit', method: 'POST', url: '/messages' },
    { kind: 'dom.action', sequence: 6, timestamp: 10, capture_page_id: 'page-1', action_id: 'orphan-key', event: 'keydown', target: { tag: 'input', attributes: {} } },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  const episodeId = 'episode:form:page-1:object%3A1';
  assert.deepEqual([...indexed.episodes.keys()], [episodeId]);
  assert.deepEqual(indexed.episodes.get(episodeId).action_ids, ['focus', 'input', 'enter', 'submit']);
  assert.equal(indexed.byAction.get('enter'), episodeId);
  assert.equal(indexed.byAction.has('orphan-key'), false);
});

test('live episode labels are recomputed as request, backend, and database evidence arrives', () => {
  const action = { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page-1', action_id: 'click', event: 'click', target: { tag: 'button', attributes: {} } };
  const episode = indexWorkflowEpisodes([action]).episodes.get('episode:click');
  assert.equal(describeEpisodeEvidence(episode, [action], [action]).label, 'Waiting for effect');
  const mutation = { kind: 'dom.mutation', action_id: action.action_id, timestamp: 1.5, sequence: 1.5, count: 1 };
  assert.equal(describeEpisodeEvidence(episode, [action, mutation], [action, mutation]).label, 'Waiting for effect');
  assert.equal(describeEpisodeEvidence(episode, [action, mutation], [action, mutation], { idle: true }).stop_reason, 'no_effect_after_dispatch');
  const request = { kind: 'network.request', sequence: 2, timestamp: 2, action_id: 'click', method: 'PUT', url: '/feedback' };
  assert.equal(describeEpisodeEvidence(episode, [action, request], [action, request]).label, 'Request sent: PUT /feedback');
  const route = { kind: 'route.dispatch', action_id: 'click', route_id: 'route:1' };
  const handler = { kind: 'handler.enter', action_id: 'click', handler_id: 'handler:1' };
  assert.equal(describeEpisodeEvidence(episode, [action, request], [action, request, route, handler]).label, 'Backend: route:1 / handler:1');
  const database = { kind: 'db.operation', action_id: 'click', operation: 'update', collection: 'messages' };
  assert.equal(describeEpisodeEvidence(episode, [action, request], [action, request, route, handler, database]).label, 'Effect: update messages');
  assert.equal(describeEpisodeEvidence(episode, [action], [action], { idle: true }).stop_reason, 'no_effect_after_dispatch');
});

test('one form episode keeps typing, a rejected submit, and a later successful submit; the button that rendered the form is its own episode', () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:7' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'open', event: 'click', target: { tag: 'button', attributes: {} } },
    { kind: 'dom.mutation', sequence: 2, timestamp: 2, action_id: 'open', count: 1, added_forms: [form] },
    { kind: 'dom.action', sequence: 3, timestamp: 3, capture_page_id: 'page', action_id: 'name', event: 'input', form, form_ref: form.ref, target: { tag: 'input', attributes: { name: 'name' } } },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page', action_id: 'reject', event: 'submit', form, form_ref: form.ref, target: form },
    { kind: 'dom.mutation', sequence: 5, timestamp: 5, action_id: 'reject', count: 1, form_ref: form.ref, form_mutation: { count: 1 }, validation: { same_form: true, feedback_mutations: 1 } },
  ];
  const first = indexWorkflowEpisodes(rows);
  const episodeId = 'episode:form:page:object%3A7';
  assert.deepEqual(first.episodes.get(episodeId).action_ids, ['name', 'reject']);
  // The opener is another control outside the form: its own episode.
  assert.deepEqual(first.episodes.get('episode:open').action_ids, ['open']);
  assert.equal(describeEpisodeEvidence(first.episodes.get(episodeId), rows, rows).label, 'Submit rejected by the app');
  const success = { kind: 'dom.action', sequence: 6, timestamp: 6, capture_page_id: 'page', action_id: 'success', event: 'submit', form, form_ref: form.ref, target: form };
  const request = { kind: 'network.request', sequence: 7, timestamp: 7, action_id: 'success', method: 'POST', url: '/agents' };
  const completeRows = [...rows, success, request];
  const second = indexWorkflowEpisodes(completeRows);
  assert.equal(second.byAction.get('success'), episodeId);
  const database = { kind: 'db.operation', action_id: 'success', operation: 'insert', collection: 'agents' };
  const state = describeEpisodeEvidence(second.episodes.get(episodeId), completeRows, [...completeRows, database]);
  assert.equal(state.label, 'Effect: insert agents');
  assert.equal(state.rejected_submits.length, 1);
});

test('a write-bearing request remains the episode effect when later reads arrive', () => {
  const action = { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'submit', event: 'submit', target: { tag: 'form' } };
  const write = { kind: 'network.request', sequence: 2, timestamp: 2, action_id: 'submit', request_occurrence_id: 'write', method: 'POST', url: '/agents' };
  const read = { kind: 'network.request', sequence: 3, timestamp: 3, action_id: 'submit', request_occurrence_id: 'read', method: 'GET', url: '/agents/created' };
  const database = { kind: 'db.operation', action_id: 'submit', request_occurrence_id: 'write', operation: 'insert', collection: 'agents' };
  const episode = indexWorkflowEpisodes([action, write, read]).episodes.get('episode:submit');
  const state = describeEpisodeEvidence(episode, [action, write, read], [action, write, read, database]);
  assert.equal(state.latest_request, write);
  assert.equal(state.label, 'Effect: insert agents');
});

test('a portaled control is its own episode, not the episode of the form control that opened it', () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:10' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'form-open', event: 'click', form, form_ref: form.ref, target: { tag: 'button', ref: 'object:11' }, target_ref: 'object:11' },
    { kind: 'dom.mutation', sequence: 2, timestamp: 2, action_id: 'form-open', added_controls: [{ tag: 'button', ref: 'object:12' }] },
    { kind: 'dom.action', sequence: 3, timestamp: 3, capture_page_id: 'page', action_id: 'portal-choice', event: 'click', target: { tag: 'button', ref: 'object:12' }, target_ref: 'object:12' },
    { kind: 'dom.mutation', sequence: 4, timestamp: 4, action_id: 'portal-choice', count: 1 },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A10').action_ids, ['form-open']);
  assert.deepEqual(indexed.episodes.get('episode:portal-choice').action_ids, ['portal-choice']);
});

test('an unmarked control shortly after a form combobox is not folded into the form by time', () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:30' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'picker', event: 'click', form, form_ref: form.ref, target: { tag: 'button', ref: 'object:31', attributes: { role: 'combobox' } }, target_ref: 'object:31' },
    { kind: 'dom.mutation', sequence: 2, timestamp: 2, action_id: 'picker', count: 1 },
    { kind: 'dom.action', sequence: 3, timestamp: 500, capture_page_id: 'page', action_id: 'unmarked-option', event: 'click', target: { tag: 'div', ref: 'object:32', attributes: {} }, target_ref: 'object:32' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A30').action_ids, ['picker']);
  assert.equal(indexed.byAction.get('unmarked-option'), 'episode:unmarked-option');
});

test('a menu opener and the request-bearing option it rendered are two episodes; focus folds into the click on the same control', () => {
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'menu-focus', event: 'focusin', target: { tag: 'button', ref: 'object:20' }, target_ref: 'object:20' },
    { kind: 'dom.action', sequence: 2, timestamp: 2, capture_page_id: 'page', action_id: 'menu', event: 'click', target: { tag: 'button', ref: 'object:20' }, target_ref: 'object:20' },
    { kind: 'dom.mutation', sequence: 3, timestamp: 3, action_id: 'menu', count: 1, added_controls: [{ tag: 'button', ref: 'object:21' }] },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page', action_id: 'option-focus', event: 'focusin', target: { tag: 'button', ref: 'object:21' }, target_ref: 'object:21' },
    { kind: 'dom.action', sequence: 5, timestamp: 5, capture_page_id: 'page', action_id: 'option', event: 'click', target: { tag: 'button', ref: 'object:21' }, target_ref: 'object:21' },
    { kind: 'network.request', sequence: 6, timestamp: 6, action_id: 'option', method: 'PUT', url: '/feedback' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.deepEqual([...indexed.episodes.keys()].sort(), ['episode:menu', 'episode:option']);
  assert.deepEqual(indexed.episodes.get('episode:menu').action_ids, ['menu-focus', 'menu']);
  assert.deepEqual(indexed.episodes.get('episode:option').action_ids, ['option-focus', 'option']);
});

// No cross-control merge (G5 §15). Rows shaped as the runtime records them in
// test/browser/fixtures/confirm-dialog-app: a Remove button that only opens a
// confirmation dialog in a portal, then Enter in the dialog sends the DELETE.
function confirmDialogRows({ openerInForm }) {
  const form = { tag: 'form', attributes: { 'aria-label': 'Settings' }, ref: 'object:3' };
  const inForm = openerInForm ? { form, form_ref: form.ref } : {};
  const remove = { tag: 'button', attributes: { type: 'button', 'aria-haspopup': 'dialog' }, ref: 'object:4' };
  const dialog = { tag: 'div', attributes: { role: 'dialog', 'aria-label': 'Confirm' }, ref: 'object:5' };
  return [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'remove-focus', event: 'focusin', ...inForm, target: remove, target_ref: remove.ref },
    { kind: 'dom.action', sequence: 2, timestamp: 2, capture_page_id: 'page', action_id: 'remove', event: 'click', ...inForm, target: remove, target_ref: remove.ref },
    { kind: 'function.enter', sequence: 3, timestamp: 2, action_id: 'remove', function_id: 'open-dialog', invoked_by: 'event', continuation_id: 'c-remove', spine: { function_ids: ['open-dialog'] } },
    { kind: 'dom.mutation', sequence: 4, timestamp: 3, action_id: 'remove', terminal_owner_continuation_id: 'c-remove', count: 2, child_list: 2, added_controls: [dialog], ...inForm },
    { kind: 'dom.action', sequence: 5, timestamp: 4, capture_page_id: 'page', action_id: 'dialog-focus', event: 'focusin', target: dialog, target_ref: dialog.ref },
    { kind: 'dom.action', sequence: 6, timestamp: 900, capture_page_id: 'page', action_id: 'enter', event: 'keydown', key: { key: 'Enter' }, target: dialog, target_ref: dialog.ref,
      ...(openerInForm ? { portal_opener_form_ref: form.ref } : {}) },
    { kind: 'function.enter', sequence: 7, timestamp: 900, action_id: 'enter', function_id: 'confirm-delete', invoked_by: 'event', continuation_id: 'c-enter', spine: { function_ids: ['confirm-delete'] } },
    { kind: 'network.request', sequence: 8, timestamp: 901, action_id: 'enter', continuation_id: 'c-enter', request_occurrence_id: 'req-delete', method: 'DELETE', url: '/api/items/alpha', spine: { function_ids: ['confirm-delete'] } },
  ];
}

for (const openerInForm of [false, true]) test(`a click that opens a portal dialog and the Enter that confirms it are two episodes (opener ${openerInForm ? 'inside' : 'outside'} a form)`, () => {
  const rows = confirmDialogRows({ openerInForm });
  const indexed = indexWorkflowEpisodes(rows);
  assert.equal(indexed.episodes.size, 2);
  const openerEpisode = indexed.episodes.get(indexed.byAction.get('remove'));
  const confirmEpisode = indexed.episodes.get(indexed.byAction.get('enter'));
  assert.notEqual(openerEpisode.episode_id, confirmEpisode.episode_id);
  assert.deepEqual(openerEpisode.action_ids, ['remove-focus', 'remove']);
  assert.deepEqual(confirmEpisode.action_ids, ['dialog-focus', 'enter']);
  assert.equal(openerEpisode.episode_id, 'episode:remove', 'an opener is its own episode, inside a form or not');
  assert.equal(openerEpisode.form_ref, null);
  assert.equal(confirmEpisode.form_ref, null, 'the portal dialog is not in the opener\'s form');
  const opened = buildEpisodeChain(openerEpisode, rows, [], { idle: true, backendInstrumented: false });
  assert.equal(opened.chain.some(step => step.kind === 'network.request'), false, 'the opener chain has no request');
  assert.equal(opened.entry_handler?.function_id, 'open-dialog');
  const openedFrontier = chainFrontier(opened, { backendInstrumented: false });
  assert.equal(openedFrontier.reached, 'dom_mutation');
  assert.equal(openedFrontier.stopped_at, 'browser');
  const confirmed = buildEpisodeChain(confirmEpisode, rows, [], { idle: true, backendInstrumented: false });
  assert.equal(confirmed.action_id, 'enter');
  assert.equal(confirmed.event, 'keydown');
  assert.deepEqual(confirmEpisode.actions.find(row => row.action_id === confirmed.action_id).key, { key: 'Enter' });
  assert.equal(confirmed.chain.find(step => step.kind === 'network.request')?.method, 'DELETE');
  assert.equal(confirmed.entry_handler?.function_id, 'confirm-delete');
  assert.equal(confirmed.chain.some(step => step.id === 'open-dialog'), false, 'the confirm chain has no step of the opener');
});

test('a dialog that renders its own form: the opener is not folded in by added_forms', () => {
  const dialogForm = { tag: 'form', attributes: {}, ref: 'object:7' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'remove', event: 'click', target: { tag: 'button', ref: 'object:6' }, target_ref: 'object:6' },
    { kind: 'dom.mutation', sequence: 2, timestamp: 2, action_id: 'remove', count: 1, added_forms: [dialogForm], added_controls: [{ tag: 'input', ref: 'object:8' }] },
    { kind: 'dom.action', sequence: 3, timestamp: 3, capture_page_id: 'page', action_id: 'field', event: 'keydown', key: { key: 'Enter' }, form: dialogForm, form_ref: dialogForm.ref, target: { tag: 'input', ref: 'object:8' }, target_ref: 'object:8' },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page', action_id: 'confirm', event: 'submit', form: dialogForm, form_ref: dialogForm.ref, target: { tag: 'button', ref: 'object:9' }, target_ref: 'object:9' },
    { kind: 'network.request', sequence: 5, timestamp: 5, action_id: 'confirm', method: 'DELETE', url: '/api/items/gamma' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.deepEqual(indexed.episodes.get('episode:remove').action_ids, ['remove']);
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A7').action_ids, ['field', 'confirm']);
});

// Grade 2026-09-24 gap: an opener inside a form, followed by that form's own
// submit, must not print the submit's request.
for (const opener of [
  { name: 'aria-haspopup button', target: { tag: 'button', attributes: { type: 'button', 'aria-haspopup': 'dialog' } } },
  { name: 'type="button"', target: { tag: 'button', attributes: { type: 'button' } } },
  { name: 'aria-expanded with no type', target: { tag: 'button', attributes: { 'aria-expanded': 'false' } } },
  { name: 'div role=button', target: { tag: 'div', attributes: { role: 'button' } } },
  { name: 'link', target: { tag: 'a', attributes: {} } },
]) test(`an opener inside a form (${opener.name}) followed by that form's submit: two episodes, the opener has no request`, () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:40' };
  const inForm = { form, form_ref: form.ref };
  const target = { ...opener.target, ref: 'object:41' }, field = { tag: 'input', attributes: {}, ref: 'object:42' };
  const save = { tag: 'button', attributes: {}, ref: 'object:43' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'opener-focus', event: 'focusin', ...inForm, target, target_ref: target.ref },
    { kind: 'dom.action', sequence: 2, timestamp: 2, capture_page_id: 'page', action_id: 'opener', event: 'click', ...inForm, target, target_ref: target.ref },
    { kind: 'dom.mutation', sequence: 3, timestamp: 3, action_id: 'opener', count: 1, ...inForm },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page', action_id: 'field-focus', event: 'focusin', ...inForm, target: field, target_ref: field.ref },
    { kind: 'dom.action', sequence: 5, timestamp: 5, capture_page_id: 'page', action_id: 'type', event: 'input', ...inForm, target: field, target_ref: field.ref },
    { kind: 'dom.action', sequence: 6, timestamp: 6, capture_page_id: 'page', action_id: 'save-focus', event: 'focusin', ...inForm, target: save, target_ref: save.ref },
    { kind: 'dom.action', sequence: 7, timestamp: 7, capture_page_id: 'page', action_id: 'save', event: 'click', ...inForm, target: save, target_ref: save.ref },
    { kind: 'dom.action', sequence: 8, timestamp: 8, capture_page_id: 'page', action_id: 'submit', event: 'submit', ...inForm, target: save, target_ref: save.ref },
    { kind: 'network.request', sequence: 9, timestamp: 9, action_id: 'submit', request_occurrence_id: 'req-save', method: 'POST', url: '/api/settings' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.equal(indexed.episodes.size, 2);
  const openerEpisode = indexed.episodes.get(indexed.byAction.get('opener'));
  assert.deepEqual(openerEpisode.action_ids, ['opener-focus', 'opener']);
  assert.equal(openerEpisode.form_ref, null);
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A40').action_ids, ['field-focus', 'type', 'save-focus', 'save', 'submit']);
  const chain = buildEpisodeChain(openerEpisode, rows, [], { idle: true, backendInstrumented: false });
  assert.equal(chain.chain.some(step => step.kind === 'network.request'), false, 'the opener prints no request');
  const frontier = chainFrontier(chain, { backendInstrumented: false });
  assert.equal(frontier.reached, 'dom_mutation');
  assert.equal(frontier.stopped_at, 'browser');
});

test('a non-submit control inside a form that sends its own request keeps its own episode and request', () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:50' };
  const inForm = { form, form_ref: form.ref };
  const check = { tag: 'button', attributes: { type: 'button' }, ref: 'object:51' }, save = { tag: 'button', attributes: { type: 'submit' }, ref: 'object:52' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'check', event: 'click', ...inForm, target: check, target_ref: check.ref },
    { kind: 'network.request', sequence: 2, timestamp: 2, action_id: 'check', method: 'GET', url: '/api/name-available' },
    { kind: 'dom.action', sequence: 3, timestamp: 3, capture_page_id: 'page', action_id: 'save', event: 'click', ...inForm, target: save, target_ref: save.ref },
    { kind: 'dom.action', sequence: 4, timestamp: 4, capture_page_id: 'page', action_id: 'submit', event: 'submit', ...inForm, target: save, target_ref: save.ref },
    { kind: 'network.request', sequence: 5, timestamp: 5, action_id: 'submit', method: 'POST', url: '/api/settings' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.deepEqual(indexed.episodes.get('episode:check').action_ids, ['check']);
  assert.equal(buildEpisodeChain(indexed.episodes.get('episode:check'), rows, [], { idle: true, backendInstrumented: false }).chain.find(step => step.kind === 'network.request')?.url, '/api/name-available');
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A50').action_ids, ['save', 'submit']);
});

test('negative control: typing then submit in one form still fold into one episode', () => {
  const form = { tag: 'form', attributes: {}, ref: 'object:10' };
  const inForm = { form, form_ref: form.ref };
  const field = { tag: 'input', ref: 'object:11' }, button = { tag: 'button', attributes: { type: 'submit' }, ref: 'object:12' };
  const rows = [
    { kind: 'dom.action', sequence: 1, timestamp: 1, capture_page_id: 'page', action_id: 'f', event: 'focusin', ...inForm, target: field, target_ref: field.ref },
    ...['a', 'b', 'c'].flatMap((letter, index) => [
      { kind: 'dom.action', sequence: 2 + index * 2, timestamp: 2 + index * 2, capture_page_id: 'page', action_id: `k${letter}`, event: 'keydown', key: { key: 'Printable' }, ...inForm, target: field, target_ref: field.ref },
      { kind: 'dom.action', sequence: 3 + index * 2, timestamp: 3 + index * 2, capture_page_id: 'page', action_id: `i${letter}`, event: 'input', ...inForm, target: field, target_ref: field.ref },
    ]),
    { kind: 'dom.action', sequence: 10, timestamp: 10, capture_page_id: 'page', action_id: 'click', event: 'click', ...inForm, target: button, target_ref: button.ref },
    { kind: 'dom.action', sequence: 11, timestamp: 11, capture_page_id: 'page', action_id: 'submit', event: 'submit', ...inForm, target: button, target_ref: button.ref },
    { kind: 'network.request', sequence: 12, timestamp: 12, action_id: 'submit', method: 'POST', url: '/api/items' },
  ];
  const indexed = indexWorkflowEpisodes(rows);
  assert.equal(indexed.episodes.size, 1);
  assert.deepEqual(indexed.episodes.get('episode:form:page:object%3A10').action_ids, ['f', 'ka', 'ia', 'kb', 'ib', 'kc', 'ic', 'click', 'submit']);
});

test('a bare same-form mutation after a request-less submit is not a rejection (no validation feedback: abstain)', async () => {
  const { rejectedSubmitMutation } = await import('../analysis/runtime-attribution.mjs');
  const submit = { action_id: 's', timestamp: 1, form_ref: 'f' };
  const bare = { action_id: 's', timestamp: 2, form_ref: 'f', form_mutation: { count: 1 }, validation: { same_form: true, feedback_mutations: 0, aria_invalid_changed: false, focus_moved_to_invalid_field: false } };
  assert.equal(rejectedSubmitMutation(submit, [bare]), null);
  for (const validation of [{ feedback_mutations: 2 }, { aria_invalid_changed: true }, { focus_moved_to_invalid_field: true }]) {
    assert.ok(rejectedSubmitMutation(submit, [{ ...bare, validation: { ...bare.validation, ...validation } }]), JSON.stringify(validation));
  }
  // Another action's feedback (a later focus onto the invalid field) is not the submit's answer.
  assert.equal(rejectedSubmitMutation(submit, [{ ...bare, action_id: 'later', validation: { focus_moved_to_invalid_field: true } }]), null);
});
