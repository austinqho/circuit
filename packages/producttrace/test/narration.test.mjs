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
    'Opened the home page.',
    'Registered as ada@example.test for the team “Analytical Engines” and landed on the App page.',
    'Opened the Discussions page and created the first discussion titled “Notes on the engine”.',
    'Opened the discussion they just created and created its first comment.',
  ]);
  assert.deepEqual(story.segments.map(segment => segment.verb), ['opened_app', 'registered', 'created', 'created']);
  // Every line is in exactly one segment, in order.
  assert.deepEqual(story.segments.flatMap(segment => segment.lines), story.lines.map(line => line.id));
  const [, signUp, start, reply] = story.segments;
  assert.deepEqual(signUp.steps.map(step => step.text), [
    'Clicked the “Get started” button on the home page to open the Login page.',
    'Clicked the “Register” link to open the Register page.',
    'Typed “Ada” into the “First Name” field.',
    'Typed “Lovelace” into the “Last Name” field.',
    'Typed “ada@example.test” into the “Email Address” field.',
    'Typed a password into the “Password” field.',
    'Typed “Analytical Engines” into the “Team Name” field.',
    'Clicked the “Register” button to create user U5kYWbCNE3f8v-xNcc62Y and team ruRH1N19jRfQTU87Zqy-Q, then landed on the App page.',
  ]);
  assert.ok(!JSON.stringify(story).includes('[redacted]'), 'secrets are never read');
  assert.ok(signUp.entities.some(entity => entity.type === 'team' && entity.id === 'ruRH1N19jRfQTU87Zqy-Q'));
  assert.ok(start.steps.some(step => step.text === 'Typed a 34-character body into the “Body” field.'));
  assert.ok(start.entities.some(entity => entity.type === 'discussion' && entity.created));
  // Joined with the segment that created what it opens.
  assert.deepEqual(reply.related, [start.id]);
  assert.ok(reply.duration_ms > 0 && reply.confidence >= 8);
  assert.equal(story.segments.at(-1).open, false);
  assert.deepEqual(story.narrative[0].observations.map(entry => entry.text), titles.slice(1));
});

test('personal values can be masked, and then the person is "the user"', () => {
  const story = storyOf(createStore({ records: signUpSession() }), { values: { personal: 'mask' } });
  assert.equal(story.segments[1].title, 'Registered as a•••@example.test for the team “Analytical Engines” and landed on the App page.');
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
    'Opened the Login page.',
    'Tried to log in as ada@example.test, but the server returned 401.',
    'Scrolled about 3 screens through the discussion list (24 discussions) without opening one.',
    'Filled in “Title” on the Discussions page.',
  ]);
  // Still being typed while the page is open; once it closes, the draft was left.
  assert.equal(story.segments.at(-1).open, true);
  const closed = storyOf(createStore({ records: [...rows, { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() }] }));
  assert.equal(closed.segments.at(-1).title, 'Filled in “Title” on the Discussions page but left without sending it.');
});

test('values: secrets never read, long text only as a length, ids and nested owners kept', () => {
  const values = valuesOf({ user: { id: 'u1', email: 'a@b.co', apiKey: 'k', firstName: 'Ada' }, body: 'x'.repeat(200), title: 'Short', token: 'abc' }, { from: 'response_body', type: 'session' });
  assert.deepEqual(values.map(entry => [entry.key, entry.class, entry.value ?? entry.length]), [
    ['user.id', 'id', 'u1'], ['user.email', 'personal', 'a@b.co'], ['user.firstName', 'personal', 'Ada'], ['body', 'long', 200], ['title', 'content', 'Short'],
  ]);
  const masked = valuesOf({ email: 'ada@example.test', firstName: 'Ada' }, { from: 'request_body', type: 'register', show: { personal: 'mask' } });
  assert.deepEqual(masked.map(entry => entry.value), ['a•••@example.test', 'A.']);
});

test('a redirect the app makes on its own right after a write is where that goal lands; "first" cites the empty list it rests on', () => {
  const rows = signUpSession().map(row => (row.kind === 'page.navigate' && row.to === '/app' ? { ...row, action_id: null, via: 'replaceState' } : row));
  const story = storyOf(createStore({ records: rows }));
  const [, signUp, start] = story.segments;
  assert.equal(signUp.title, 'Registered as ada@example.test for the team “Analytical Engines” and landed on the App page.');
  assert.equal(signUp.steps.at(-1).text, 'Landed on the App page.');
  assert.equal(start.title, 'Opened the Discussions page and created the first discussion titled “Notes on the engine”.');
  assert.deepEqual(start.facts.first_evidence, ['a3']);
  assert.match(start.steps.find(step => step.line === 'a3').text, /to view the discussion list, which was empty\.$/u);
  // A navigation that does not leave the page the write was sent from is not its landing.
  const elsewhere = signUpSession().map(row => (row.kind === 'page.navigate' && row.to === '/app' ? { ...row, action_id: null, from: '/somewhere' } : row));
  assert.doesNotMatch(storyOf(createStore({ records: elsewhere })).segments[1].title, /lands on/u);
});

// Review cases: a reload, a rename, a left draft, a delete, back/forward.
function secondVisit() {
  sequence = 0;
  const draft = 'object:70', edit = 'object:71';
  const d1 = 'eXA7Ncb2ENlZ2_b27sGVS', d3 = '9H0CDBYAGgCuk5f9hUvzD';
  return [
    open('http://localhost:4173/app/discussions'),
    // The pointer resting on the page is an action row, but not a told one: the page's own requests still belong to the load.
    action('p0', 'pointerover', button('Open user menu'), { page: '/app/discussions' }),
    request('boot', 'GET', 'https://api.example.com/auth/me', 1, null),
    body('boot', 1, 'response', { data: { id: 'U5kYWbCNE3f8v-xNcc62Y', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' } }),
    request('boot', 'GET', 'https://api.example.com/discussions?page=1', 2, null),
    body('boot', 2, 'response', { data: [{ id: d1, title: 'Beta topic' }, { id: d3, title: 'Gamma topic' }], meta: { total: 6 } }),
    { kind: 'dom.action.range', action_id: 'r1', event: 'scroll', target_ref: 'object:7', scroll: { first: [0, 0], last: [0, 900], viewport: 420, page: true }, ...at() },
    // Hovering "View" prefetches; the hover's own element had no key, the click names the same discussion.
    action('h1', 'mouseout', button('Open user menu'), { page: '/app/discussions', related_target: { tag: 'a', attributes: {}, label: 'View' } }), enter('h1'),
    request('h1', 'GET', `https://api.example.com/discussions/${d1}`, 1), body('h1', 1, 'response', { data: { id: d1, title: 'Beta topic', body: 'Body of Beta topic' } }),
    action('v1', 'click', { tag: 'a', attributes: {}, element_key: 'k_view_d1', label: 'View' }, { page: '/app/discussions' }), enter('v1'), navigate('v1', '/app/discussions', `/app/discussions/${d1}`),
    action('u1', 'click', button('Update Discussion'), { page: `/app/discussions/${d1}` }), enter('u1'),
    ...typing('t1', field('title', 'Title', edit), edit, `/app/discussions/${d1}`),
    action('c1', 'change', field('title', 'Title', edit), { page: `/app/discussions/${d1}`, form_ref: edit }),
    action('s1', 'submit', button('Submit', { type: 'submit' }), { page: `/app/discussions/${d1}`, form_ref: edit }), enter('s1'),
    request('s1', 'PATCH', `https://api.example.com/discussions/${d1}`, 1),
    // The form sends every field; only the title differs from what the server returned.
    body('s1', 1, 'request', { title: 'Beta topic (renamed)', body: 'Body of Beta topic' }),
    body('s1', 1, 'response', { id: d1, title: 'Beta topic (renamed)', body: 'Body of Beta topic', authorId: 'U5kYWbCNE3f8v-xNcc62Y', teamId: 'ruRH1N19jRfQTU87Zqy-Q' }),
    { kind: 'page.navigate', action_id: null, via: 'popstate', from: `/app/discussions/${d1}`, to: '/app/discussions', ...at() },
    action('a1', 'click', button('Create Discussion'), { page: '/app/discussions' }), enter('a1'),
    ...typing('t2', field('title', 'Title', draft), draft, '/app/discussions'),
    ...typing('t3', { tag: 'textarea', attributes: { name: 'body' }, element_key: 'k_body_d', label: 'Body' }, draft, '/app/discussions'),
    action('x1', 'click', { tag: 'button', attributes: {}, element_key: `k_delete_${d3}`, label: 'Delete Discussion' }, { page: '/app/discussions' }), enter('x1'),
    action('x2', 'click', { tag: 'button', attributes: {}, element_key: 'k_confirm', label: 'Delete Discussion' }, { page: '/app/discussions' }), enter('x2'),
    request('x2', 'DELETE', `https://api.example.com/discussions/${d3}`, 1), body('x2', 1, 'response', { id: d3, authorId: 'U5kYWbCNE3f8v-xNcc62Y', teamId: 'ruRH1N19jRfQTU87Zqy-Q' }),
    { kind: 'page.navigate', action_id: null, via: 'popstate', from: '/app/discussions', to: '/app', ...at() },
    { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() },
  ];
}

test('a second visit: reload, rename, a left draft, a delete and Back each read as the goal they were', () => {
  const story = storyOf(createStore({ records: secondVisit() }));
  const open = story.lines[0];
  assert.equal(open.text, 'Opened /app/discussions → GET /auth/me (200), GET /discussions?page=1 (200)');
  assert.deepEqual(story.segments.map(segment => segment.title), [
    'Opened the Discussions page, signed in as Ada Lovelace.',
    'Opened the discussion “Beta topic” and renamed it to “Beta topic (renamed)”.',
    'Started a discussion on the Discussions page but left without sending it.',
    'Deleted the discussion “Gamma topic”.',
    'Went back or forward to the App page.',
  ]);
  const steps = story.segments.map(segment => segment.steps.map(step => step.text));
  assert.deepEqual(steps[0], ['Opened the Discussions page.']);
  // What was there goes in the step's facts: who was signed in, what loaded.
  assert.deepEqual(story.segments[0].steps[0].facts, ['Signed in as user U5kYWbCNE3f8v-xNcc62Y (Ada Lovelace)', '6 discussions: “Beta topic”, “Gamma topic”, …']);
  // Scrolling the list, then opening one from it: one goal, the scroll leading. The hover's prefetch is part of
  // the click; the change that ends typing is part of the typing.
  assert.deepEqual(steps[1], [
    'Scrolled down about 2 screens on the Discussions page.',
    'Clicked the “View” link to open the discussion “Beta topic”.',
    'Clicked the “Update Discussion” button.',
    'Typed “Beta topic (renamed)” into the “Title” field.',
    'Clicked the “Submit” button to save the discussion “Beta topic”.',
  ]);
  assert.equal(story.lines.find(line => line.id === 'v1').prefetched_on_hover, 'h1');
  // The click that opened the form leads the draft; the one that opened the confirm leads the delete.
  assert.deepEqual(story.segments[2].lines.slice(1), ['a1', 't2', 't3']);
  assert.equal(story.lines.find(line => line.id === story.segments[2].lines[0]).kind, 'navigate');
  assert.deepEqual(steps[3], ['Clicked the “Delete Discussion” button on the Discussions page.', 'Clicked the “Delete Discussion” button to delete the discussion “Gamma topic”.']);
  assert.ok(!JSON.stringify(steps).includes('returns author'));
  // Going somewhere on its own is not a sentence of the summary.
  assert.ok(!story.narrative[0].observations.some(entry => /going back/u.test(entry.text)));
});

test('a rename that only re-sends unchanged fields claims no field; a failed write names only its status', () => {
  const rows = secondVisit().filter(row => !(row.kind === 'network.body' && row.request_occurrence_id === 's1:request:1'));
  rows.push(body('s1', 1, 'request', { title: 'Beta topic', body: 'Body of Beta topic' }), body('s1', 1, 'response', { id: 'eXA7Ncb2ENlZ2_b27sGVS', title: 'Beta topic' }));
  assert.equal(storyOf(createStore({ records: rows })).segments.find(entry => entry.verb === 'edited').title, 'Opened the discussion “Beta topic” and edited it.');
  const failing = secondVisit().map(row => (row.kind === 'network.body' && row.request_occurrence_id === 's1:request:1' && row.direction === 'response' ? { ...row, status: 500, json: { message: 'boom' } } : row));
  const segment = storyOf(createStore({ records: failing })).segments.find(entry => entry.verb === 'edited');
  assert.equal(segment.steps.at(-1).text, 'Clicked the “Submit” button, but the server returned 500.');
  assert.match(segment.title, /^Opened the discussion “Beta topic” and tried to rename it, but the server returned 500\.$/u);
});

test('scrolling a list and then leaving by a menu link: the scroll stays on its page, the link is its own goal', () => {
  const rows = secondVisit();
  const cut = rows.findIndex(row => row.action_id === 'h1');
  const records = [
    ...rows.slice(0, cut),
    action('m1', 'click', link('Dashboard'), { page: '/app/discussions' }), enter('m1'), navigate('m1', '/app/discussions', '/app'),
    { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() },
  ];
  const story = storyOf(createStore({ records }));
  assert.deepEqual(story.segments.map(segment => segment.lines), [['open:s_n'], ['r1'], ['m1']]);
  assert.equal(story.segments[1].title, 'Scrolled about 2 screens through the Discussions page.');
  assert.equal(story.segments[2].title, 'Went to the Dashboard page.');
});

test('a rename that also rewrites the body says both; a later comment draft is named by its button, under the new title', () => {
  const rows = secondVisit();
  const d1 = 'eXA7Ncb2ENlZ2_b27sGVS';
  const back = rows.findIndex(row => row.kind === 'page.navigate' && row.via === 'popstate');
  const comment = 'object:72';
  const records = [
    ...rows.slice(0, back).map(row => (row.kind === 'network.body' && row.request_occurrence_id === 's1:request:1'
      ? { ...row, json: { ...row.json, body: 'A new body' } } : row)),
    action('k1', 'click', button('Create Comment'), { page: `/app/discussions/${d1}` }), enter('k1'),
    ...typing('k2', { tag: 'textarea', attributes: { name: 'body' }, element_key: 'k_body_k', label: 'Body' }, comment, `/app/discussions/${d1}`),
    { kind: 'page.navigate', action_id: null, via: 'popstate', from: `/app/discussions/${d1}`, to: '/app/discussions', ...at() },
    { kind: 'capture.summary', page_id: page, capture_page_id: page, ...at() },
  ];
  const story = storyOf(createStore({ records }));
  const titles = story.segments.map(segment => segment.title);
  assert.ok(titles.includes('Opened the discussion “Beta topic” and renamed it to “Beta topic (renamed)” and changed its body.'), titles.join('\n'));
  assert.ok(titles.includes('Started a comment on “Beta topic (renamed)” but left without sending it.'), titles.join('\n'));
  // The whole visit, joined with ", then".
  assert.match(story.narrative[0].text, /^Opened the discussion “Beta topic” and renamed it .*, then started a comment on “Beta topic \(renamed\)” but left without sending it\.$/u);
});
