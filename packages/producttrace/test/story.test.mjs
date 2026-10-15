import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../collector/store.mjs';
import { idsInUrl, PENDING_MS, storyOf } from '../collector/story.mjs';

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
  // No line says what was typed; the title the server returned is a value of the write, not of the typing.
  assert.ok(!lines.some(line => line.text.includes('Pricing page feedback')));
  assert.ok(!JSON.stringify(lines[0]).includes('Pricing page feedback'));
  assert.deepEqual(lines[1].values.find(entry => entry.key === 'title'), { key: 'title', owner: 'discussion', class: 'content', from: 'response_body', value: 'Pricing page feedback' });
});

test('two fields without any key stay two lines; Enter is named; a request with no status yet is pending', () => {
  sequence = 0;
  const field = label => ({ tag: 'input', attributes: {}, label });
  const capturePage = { kind: 'capture.page', page_id: page, capture_page_id: page, bodies: 'on', ...at() };
  const rows = [
    capturePage,
    action('c1', 'input', field('First Name'), { input: { inputType: 'insertText', data_length: 1, credential_field: false } }),
    action('c2', 'input', field('Last Name'), { input: { inputType: 'insertText', data_length: 1, credential_field: false } }),
    action('c3', 'keydown', field('Search'), { key: { key: 'Enter', code: 'Enter' } }),
    enter('c3', 'fn:search'),
    request('c3', 'GET', 'https://api.example.com/search?q=1', 7),
  ];
  const { lines } = storyOf(createStore({ records: rows }), { now: 2_000 });
  assert.deepEqual(lines.map(line => line.text), [
    'Opened the page',
    'Typed in the “First Name” field',
    'Typed in the “Last Name” field',
    'Pressed Enter on the “Search” field → GET /search?q=1 (pending)',
  ]);
  // Once the page has closed, a request that never got a status says so.
  const closed = storyOf(createStore({ records: [...rows, { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() }] }), { now: 2_000 });
  assert.match(closed.lines.at(-1).text, /GET \/search\?q=1 \(no response recorded\)$/u);
  // A tab that dies never closes: after PENDING_MS the request stops reading as pending.
  const later = storyOf(createStore({ records: rows }), { now: 2_000 + PENDING_MS });
  assert.match(later.lines.at(-1).text, /GET \/search\?q=1 \(no response recorded\)$/u);
});

test('a navigation the router made inside an action is told on that action; key-by-key typing is one line', () => {
  sequence = 0;
  const email = { tag: 'input', attributes: { name: 'email', type: 'email' }, element_key: 'k_email', label: 'Email Address' };
  const start = { tag: 'button', attributes: {}, element_key: 'k_start', label: 'Get started' };
  const key = (id, event) => action(id, event, email, { page: '/auth/login' });
  const rows = [
    action('b1', 'click', start, { page: '/' }),
    enter('b1', 'fn:handleStart'),
    { kind: 'page.navigate', action_id: 'b1', via: 'pushState', from: '/', to: '/auth/login', parent_continuation_id: 'f:b1', ...at() },
    // pressSequentially: keydown, keypress, textInput, input, keyup per character.
    ...['k1', 'k2'].flatMap(id => ['keydown', 'keypress', 'textInput', 'input', 'keyup'].map((event, index) => key(`${id}${index}`, event))),
    action('b9', 'change', email, { page: '/auth/login' }),
    { kind: 'page.navigate', action_id: null, via: 'popstate', from: '/auth/login', to: '/', ...at() },
  ];
  const { lines } = storyOf(createStore({ records: rows }));
  assert.deepEqual(lines.map(line => line.text), [
    'Clicked the “Get started” button → went to /auth/login',
    'Typed in the “Email Address” field',
    'Went back/forward to /',
  ]);
  assert.equal(lines[1].count, 2);
});

test('focus moves are lines only when they caused something; a click that sent nothing is just the click', () => {
  sequence = 0;
  const close = { tag: 'button', attributes: {}, element_key: 'k_close', label: 'Close' };
  const email = { tag: 'input', attributes: { name: 'email' }, element_key: 'k_email', label: 'Email' };
  const rows = [
    action('d1', 'blur', email),
    enter('d1', 'fn:save'),
    request('d1', 'PUT', 'https://api.example.com/users/u_81Kx92aa', 1),
    action('d2', 'focusout', close),
    action('d3', 'click', close),
    enter('d3', 'fn:onClose'),
    // A focusout whose handler navigated: the navigation is told on it.
    action('d4', 'focusout', email),
    enter('d4', 'fn:leave'),
    { kind: 'page.navigate', action_id: 'd4', via: 'pushState', from: '/', to: '/done', ...at() },
  ];
  const { lines } = storyOf(createStore({ records: rows }), { now: 2_000 });
  assert.deepEqual(lines.map(line => line.text), [
    'Left the “Email” field → PUT /users/u_81Kx92aa (status not recorded)',
    'Clicked the “Close” button',
    'Left the “Email” field → went to /done',
  ]);
  assert.doesNotMatch(lines[1].detail || '', /instrumented|attributed|DOM mutation|third-party/u);
  // fn:onClose was never bound to the button as a handler, so it is not named as one.
  assert.equal(lines[1].handler, null);
});

test('a choice is a line; URL-synced typing stays one line; effects read in the order they happened', () => {
  sequence = 0;
  const role = { tag: 'select', attributes: { name: 'role' }, element_key: 'k_role', label: 'Role' };
  const search = { tag: 'input', attributes: { name: 'q', type: 'search' }, element_key: 'k_q', label: 'Search' };
  const link = { tag: 'a', attributes: { href: '/app/discussions' }, element_key: 'k_link', label: 'Discussions' };
  const typed = (id, to, from) => [
    action(id, 'input', search), enter(id, `fn:${id}`),
    { kind: 'page.navigate', action_id: id, via: 'replaceState', from, to, ...at() },
  ];
  const rows = [
    action('e1', 'change', role),
    ...typed('e2', '/?q=a', '/'), ...typed('e3', '/?q=ab', '/?q=a'), ...typed('e4', '/?q=abc', '/?q=ab'),
    action('e5', 'change', search),
    action('e6', 'click', link), enter('e6', 'fn:navigate'),
    { kind: 'page.navigate', action_id: 'e6', via: 'pushState', from: '/?q=abc', to: '/app/discussions', ...at() },
    request('e6', 'GET', 'https://api.example.com/discussions?page=1', 1),
  ];
  const { lines } = storyOf(createStore({ records: rows }), { now: 2_000 });
  assert.deepEqual(lines.map(line => line.text), [
    'Changed the “Role” field',
    'Typed in the “Search” field',
    'Clicked the “Discussions” link → went to /app/discussions → GET /discussions?page=1 (status not recorded)',
  ]);
  assert.equal(lines[1].count, 3);
  assert.equal(lines[1].navigations.at(-1).to, '/?q=abc');
});

test('navigations of two page loads have distinct ids', () => {
  const load = (pageId, to) => ({ kind: 'page.navigate', action_id: null, via: 'popstate', from: '/', to, sequence: 1, timestamp: 1_000, capture_page_id: pageId });
  const { lines } = storyOf(createStore({ records: [load('s_a', '/one'), load('s_b', '/two')] }), { now: 2_000 });
  assert.equal(new Set(lines.map(line => line.id)).size, 2);
});
