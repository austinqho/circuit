import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../collector/store.mjs';
import { storyOf } from '../collector/story.mjs';
import { valuesOf } from '../collector/narration.mjs';

const page = 's_n';
let sequence = 0;
const at = () => { sequence += 1; return { sequence, timestamp: 10_000 + sequence * 100, capture_page_id: page }; };
const open = url => ({ kind: 'capture.page', page_id: page, url, bodies: 'on', ...at() });
const action = (id, event, target, extra = {}) => ({ kind: 'dom.action', action_id: id, event, target, continuation_id: `c:${id}`, ...at(), ...extra });
const enter = id => ({ kind: 'function.enter', action_id: id, function_id: `fn:${id}`, continuation_id: `f:${id}`, parent_continuation_id: `c:${id}`,
  invoked_by: 'event', spine: { action_id: id, function_ids: [`fn:${id}`] }, ...at() });
const request = (id, method, url, n, action_id = id) => ({ kind: 'network.request', action_id, request_occurrence_id: `${id}:request:${n}`, method, url,
  parent_continuation_id: action_id ? `f:${id}` : null, terminal_owner_continuation_id: action_id ? `f:${id}` : null, trace_context: { trace_id: `t${id}${n}`, span_id: `s${id}${n}` }, ...at() });
const body = (id, n, direction, json, status = 200) => ({ kind: 'network.body', direction, request_occurrence_id: `${id}:request:${n}`, session: page, capture_page_id: page,
  ...(direction === 'response' ? { status } : {}), captured: true, format: 'json', json, timestamp: 20_000 + n });
const navigate = (id, from, to) => ({ kind: 'page.navigate', action_id: id, via: 'pushState', from, to, ...at() });
const field = (name, label, form, type = 'text') => ({ tag: 'input', attributes: { name, type }, element_key: `k_${name}_${form}`, label });
const button = (label, extra = {}) => ({ tag: 'button', attributes: extra, element_key: `k_${label}`, label });
const link = label => ({ tag: 'a', attributes: {}, element_key: `k_${label}`, label });
const typing = (id, target, form, page_) => [action(id, 'input', target, { page: page_, form_ref: form, form: { tag: 'form', ref: form }, input: { credential_field: target.attributes.type === 'password' } })];

// The worked example from the narration spec: sign up, start a discussion, open it and comment.
function signUpSession() {
  sequence = 0;
  const register = 'object:11', create = 'object:34', comment = 'object:55';
  const discussion = 'ZQNutJ2l4vkATgTad4wug';
  return [
    open('http://localhost:4173/'),
    request('boot', 'GET', 'https://api.example.com/auth/me', 1, null),
    body('boot', 1, 'response', { data: null }),
    action('a1', 'click', button('Get started'), { page: '/' }), enter('a1'), navigate('a1', '/', '/auth/login'),
    action('a2', 'click', link('Register'), { page: '/auth/login' }), enter('a2'), navigate('a2', '/auth/login', '/auth/register'),
    ...typing('t1', field('firstName', 'First Name', register), register, '/auth/register'),
    ...typing('t2', field('lastName', 'Last Name', register), register, '/auth/register'),
    ...typing('t3', field('email', 'Email Address', register, 'email'), register, '/auth/register'),
    ...typing('t4', field('password', 'Password', register, 'password'), register, '/auth/register'),
    ...typing('t5', field('teamName', 'Team Name', register), register, '/auth/register'),
    action('s1', 'submit', button('Register', { type: 'submit' }), { page: '/auth/register', form_ref: register }), enter('s1'),
    request('s1', 'POST', 'https://api.example.com/auth/register', 1),
    body('s1', 1, 'request', { email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace', password: '[redacted]', teamName: 'Analytical Engines' }),
    body('s1', 1, 'response', { user: { id: 'U5kYWbCNE3f8v-xNcc62Y', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', teamId: 'ruRH1N19jRfQTU87Zqy-Q' }, jwt: '[redacted]' }),
    navigate('s1', '/auth/register', '/app'),
    action('a3', 'click', link('Discussions'), { page: '/app' }), enter('a3'),
    request('a3', 'GET', 'https://api.example.com/discussions?page=1', 1), body('a3', 1, 'response', { data: [], meta: { page: 1, total: 0 } }),
    navigate('a3', '/app', '/app/discussions'),
    action('a4', 'click', button('Create Discussion'), { page: '/app/discussions' }), enter('a4'),
    ...typing('t6', field('title', 'Title', create), create, '/app/discussions'),
    ...typing('t7', { tag: 'textarea', attributes: { name: 'body' }, element_key: 'k_body_c', label: 'Body' }, create, '/app/discussions'),
    action('s2', 'submit', button('Submit', { type: 'submit' }), { page: '/app/discussions', form_ref: create }), enter('s2'),
    request('s2', 'POST', 'https://api.example.com/discussions', 1),
    body('s2', 1, 'request', { title: 'Notes on the engine', body: 'The analytical engine could weave.' }),
    body('s2', 1, 'response', { id: discussion, title: 'Notes on the engine', body: 'The analytical engine could weave.', teamId: 'ruRH1N19jRfQTU87Zqy-Q' }),
    action('a5', 'mouseover', link('View'), { page: '/app/discussions' }), enter('a5'),
    request('a5', 'GET', `https://api.example.com/discussions/${discussion}`, 1), body('a5', 1, 'response', { data: { id: discussion, title: 'Notes on the engine' } }),
    request('a5', 'GET', `https://api.example.com/comments?discussionId=${discussion}`, 2), body('a5', 2, 'response', { data: [], meta: { total: 0 } }),
    action('a6', 'click', link('View'), { page: '/app/discussions' }), enter('a6'), navigate('a6', '/app/discussions', `/app/discussions/${discussion}`),
    action('a7', 'click', button('Create Comment'), { page: `/app/discussions/${discussion}` }), enter('a7'),
    ...typing('t8', { tag: 'textarea', attributes: { name: 'body' }, element_key: 'k_body_m', label: 'Body' }, comment, `/app/discussions/${discussion}`),
    action('s3', 'submit', button('Submit', { type: 'submit' }), { page: `/app/discussions/${discussion}`, form_ref: comment }), enter('s3'),
    request('s3', 'POST', 'https://api.example.com/comments', 1),
    body('s3', 1, 'request', { discussionId: discussion, body: 'A first comment.' }),
    body('s3', 1, 'response', { id: 'DfBo9jhOIojhJSRsNmdL2', body: 'A first comment.', discussionId: discussion }),
    { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() },
  ];
}

test('a session groups into goals, titled in GUM\'s observation voice with grounded values', () => {
  const story = storyOf(createStore({ records: signUpSession() }));
  const titles = story.segments.map(segment => segment.title);
  assert.deepEqual(titles, [
    'On the home page, the user is opening the app.',
    'On the Register page, Ada Lovelace is signing up as ada@example.test for the team “Analytical Engines”, and lands on /app.',
    'In Discussions, Ada Lovelace is creating the first discussion, “Notes on the engine”.',
    'In “Notes on the engine”, Ada Lovelace is opening the discussion they just created and creating its first comment.',
  ]);
  assert.deepEqual(story.segments.map(segment => segment.verb), ['opened_app', 'registered', 'created', 'created']);
  // Every line is in exactly one segment, in order.
  assert.deepEqual(story.segments.flatMap(segment => segment.lines), story.lines.map(line => line.id));
  const [, signUp, start, reply] = story.segments;
  assert.deepEqual(signUp.steps.map(step => step.text), [
    'Opens “Get started”; the app moves to /auth/login',
    'Opens “Register”; the app moves to /auth/register',
    'Enters “Ada” as the first name',
    'Enters “Lovelace” as the last name',
    'Enters ada@example.test as the email address',
    'Sets a password',
    'Enters “Analytical Engines” as the team name',
    'Submits “Register”; the server returns user U5kYWbCNE3f8v-xNcc62Y and team ruRH1N19jRfQTU87Zqy-Q, the app moves to /app',
  ]);
  assert.ok(!JSON.stringify(story).includes('[redacted]'), 'secrets are never read');
  assert.ok(signUp.entities.some(entity => entity.type === 'team' && entity.id === 'ruRH1N19jRfQTU87Zqy-Q'));
  assert.ok(start.steps.some(step => step.text === 'Writes a body (34 characters)'));
  assert.ok(start.entities.some(entity => entity.type === 'discussion' && entity.created));
  // Joined with the segment that created what it opens.
  assert.deepEqual(reply.related, [start.id]);
  assert.ok(reply.duration_ms > 0 && reply.confidence >= 8);
  assert.equal(story.segments.at(-1).open, false);
  assert.deepEqual(story.narrative[0].observations.map(entry => entry.text), titles.slice(1));
});

test('personal values can be masked, and then the person is "the user"', () => {
  const story = storyOf(createStore({ records: signUpSession() }), { values: { personal: 'mask' } });
  assert.equal(story.segments[1].title, 'On the Register page, the user is signing up as a•••@example.test for the team “Analytical Engines”, and lands on /app.');
  assert.ok(!JSON.stringify(story).includes('ada@example.test'));
  assert.ok(!JSON.stringify(story).includes('Lovelace'));
});

test('titleOf can reword a segment, never regroup it; a throw keeps the template', () => {
  const plain = storyOf(createStore({ records: signUpSession() }));
  const custom = storyOf(createStore({ records: signUpSession() }), { titleOf: facts => (facts.verb === 'registered' ? 'Ada signs up.' : null) });
  assert.equal(custom.segments[1].title, 'Ada signs up.');
  assert.equal(custom.segments[1].title_source, 'custom');
  assert.deepEqual(custom.segments.map(segment => segment.lines), plain.segments.map(segment => segment.lines));
  const broken = storyOf(createStore({ records: signUpSession() }), { titleOf: () => { throw new Error('model down'); } });
  assert.deepEqual(broken.segments.map(segment => segment.title), plain.segments.map(segment => segment.title));
});

test('a failed write, an unsent draft, and a long scroll each read as what happened', () => {
  sequence = 0;
  const login = 'object:1', draft = 'object:2';
  const rows = [
    open('http://localhost:4173/auth/login'),
    ...typing('t1', field('email', 'Email', login, 'email'), login, '/auth/login'),
    action('s1', 'submit', button('Log in', { type: 'submit' }), { page: '/auth/login', form_ref: login }), enter('s1'),
    request('s1', 'POST', 'https://api.example.com/auth/login', 1), body('s1', 1, 'request', { email: 'ada@example.test', password: '[redacted]' }), body('s1', 1, 'response', { message: 'Invalid' }, 401),
    action('a1', 'click', link('Discussions'), { page: '/auth/login' }), enter('a1'),
    request('a1', 'GET', 'https://api.example.com/discussions', 1), body('a1', 1, 'response', { data: [{ id: 'd1' }, { id: 'd2' }], meta: { total: 24 } }),
    navigate('a1', '/auth/login', '/discussions'),
    { kind: 'dom.action.range', action_id: 'r1', event: 'scroll', target_ref: 'object:9', scroll: { first: [0, 0], last: [0, 1500], viewport: 700, page: true }, first_timestamp: 1, last_timestamp: 2, ...at() },
    { kind: 'dom.action.range', action_id: 'r2', event: 'scroll', target_ref: 'object:9', scroll: { first: [0, 1500], last: [0, 2100], viewport: 700, page: true }, first_timestamp: 3, last_timestamp: 4, ...at() },
    { kind: 'dom.action.range', action_id: 'r3', event: 'scroll', target_ref: 'object:9', scroll: { first: [0, 2100], last: [0, 2150], viewport: 700, page: true }, ...at() },
    action('a2', 'click', button('New'), { page: '/discussions' }), enter('a2'),
    ...typing('t2', field('title', 'Title', draft), draft, '/discussions'),
  ];
  const story = storyOf(createStore({ records: rows }));
  const scroll = story.lines.find(line => line.kind === 'scroll');
  assert.equal(scroll.text, 'Scrolled down the page (≈3 screens)');
  assert.equal(story.lines.filter(line => line.kind === 'scroll').length, 1, 'consecutive scrolls of one target are one line');
  assert.deepEqual(story.segments.map(segment => segment.title), [
    'On /auth/login, the user is opening the app.',
    'On /auth/login, the user is trying to log in as ada@example.test, but the server says 401.',
    'In Discussions, the user is scrolling through the list of 24 discussions, about 3 screens.',
    'In Discussions, the user is filling in “Title”.',
  ]);
  // Still being typed while the page is open; once it closes, the draft was left.
  assert.equal(story.segments.at(-1).open, true);
  const closed = storyOf(createStore({ records: [...rows, { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() }] }));
  assert.equal(closed.segments.at(-1).title, 'In Discussions, the user is filling in “Title” but leaves without sending it.');
});

test('values: secrets never read, long text only as a length, ids and nested owners kept', () => {
  const values = valuesOf({ user: { id: 'u1', email: 'a@b.co', apiKey: 'k', firstName: 'Ada' }, body: 'x'.repeat(200), title: 'Short', token: 'abc' }, { from: 'response_body', type: 'session' });
  assert.deepEqual(values.map(entry => [entry.key, entry.class, entry.value ?? entry.length]), [
    ['user.id', 'id', 'u1'], ['user.email', 'personal', 'a@b.co'], ['user.firstName', 'personal', 'Ada'], ['body', 'long', 200], ['title', 'content', 'Short'],
  ]);
  const masked = valuesOf({ email: 'ada@example.test', firstName: 'Ada' }, { from: 'request_body', type: 'register', show: { personal: 'mask' } });
  assert.deepEqual(masked.map(entry => entry.value), ['a•••@example.test', 'A.']);
});
