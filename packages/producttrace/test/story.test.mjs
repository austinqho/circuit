import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../collector/store.mjs';
import { idsInUrl, storyOf } from '../collector/story.mjs';

const page = 's_1';
let sequence = 0;
const at = () => { sequence += 1; return { sequence, timestamp: 1_000 + sequence, capture_page_id: page }; };
const action = (id, event, target, extra = {}) => ({ kind: 'dom.action', action_id: id, event, target, continuation_id: `c:${id}`, ...at(), ...extra });
const enter = (id, fn) => ({ kind: 'function.enter', action_id: id, function_id: fn, continuation_id: `f:${id}`, parent_continuation_id: `c:${id}`,
  invoked_by: 'event', spine: { action_id: id, function_ids: [fn] }, ...at() });
const request = (id, method, url, n) => ({ kind: 'network.request', action_id: id, request_occurrence_id: `${id}:request:${n}`, method, url,
  parent_continuation_id: `f:${id}`, terminal_owner_continuation_id: `f:${id}`, trace_context: { trace_id: `t${n}`, span_id: `s${n}` }, ...at() });
const response = (id, n, status, json) => ({ kind: 'network.body', direction: 'response', request_occurrence_id: `${id}:request:${n}`, session: page, capture_page_id: page,
  status, captured: true, format: 'json', json, timestamp: 2_000 + n });

test('ids come only from URL segments after a collection name and from *Id query keys', () => {
  assert.deepEqual(idsInUrl('https://api.example.com/discussions/hDcSjggyAKQPCYadkDSP8', 'request_url'),
    [{ type: 'discussion', id: 'hDcSjggyAKQPCYadkDSP8', from: 'request_url' }]);
  assert.deepEqual(idsInUrl('/comments?discussionId=hDcSjggyAKQPCYadkDSP8&page=1', 'request_url'),
    [{ type: 'discussion', id: 'hDcSjggyAKQPCYadkDSP8', from: 'request_url' }]);
  assert.deepEqual(idsInUrl('/settings/profile', 'page_url'), []);
});

test('a session reads as sentences: noise dropped, typing coalesced, writes name what they created', () => {
  sequence = 0;
  const title = { tag: 'input', attributes: { name: 'title' }, element_key: 'k_title', label: 'Title' };
  const submit = { tag: 'button', attributes: { type: 'submit' }, element_key: 'k_submit', label: 'Submit' };
  const rows = [
    action('a1', 'focusin', title, { page: '/app/discussions' }),
    action('a2', 'input', title, { page: '/app/discussions', input: { inputType: 'insertText', data_length: 1, credential_field: false } }),
    action('a3', 'input', title, { page: '/app/discussions', input: { inputType: 'insertText', data_length: 1, credential_field: false } }),
    action('a4', 'click', submit, { page: '/app/discussions' }),
    action('a5', 'submit', submit, { page: '/app/discussions' }),
    enter('a5', 'fn:createDiscussion'),
    request('a5', 'POST', 'https://api.example.com/discussions', 1),
    response('a5', 1, 200, { id: 'hDcSjggyAKQPCYadkDSP8', title: 'Pricing page feedback' }),
    action('a6', 'click', { tag: 'a', attributes: {}, element_key: 'k_view', label: 'View' }, { page: '/app/discussions/hDcSjggyAKQPCYadkDSP8' }),
  ];
  const store = createStore({ records: rows });
  const { sessions, lines } = storyOf(store);
  assert.equal(sessions.length, 1);
  const texts = lines.map(line => line.text);
  assert.equal(texts[0], 'Typed in the “Title” field');
  assert.equal(lines[0].count, 2);
  assert.ok(texts[1].startsWith('Submitted the form with the “Submit” button'), texts[1]);
  assert.match(texts[1], /POST \/discussions \(200, created discussion hDcSjggyAKQPCYadkDSP8\)/u);
  assert.deepEqual(lines[1].entities, [{ type: 'discussion', id: 'hDcSjggyAKQPCYadkDSP8', from: 'response_body', created: true }]);
  assert.equal(texts[2], 'Went to /app/discussions/hDcSjggyAKQPCYadkDSP8 (discussion hDcSjggyAKQPCYadkDSP8)');
  assert.equal(texts[3], 'Clicked the “View” link');
  // Nothing in the story is typed text.
  assert.ok(!JSON.stringify(lines).includes('Pricing page feedback'));
});
