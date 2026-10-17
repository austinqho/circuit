import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareItems,
  compareRuns,
  normalizer,
  requestItem,
  storageRow,
  summarizeObserved,
  verifyReadOnly,
} from '../src/verify.mjs';

test('normalizer hides run tokens, generated ids and clock times', () => {
  const norm = normalizer('r1a2b3');
  assert.equal(norm('ada-r1a2b3@example.test'), 'ada-{{run}}@example.test');
  assert.equal(norm('/c/1b4e28ba-2fa1-11d2-883f-0016d3cca427'), '/c/<uuid>');
  assert.equal(norm('/app/discussions/V1StGXR8_Z5jdHi6B'), '/app/discussions/<id>');
  assert.equal(norm('/app/discussions/InaeLxHdhoIXXj-DVqsFh'), '/app/discussions/<id>');
  assert.equal(norm('useDiscussionQuery'), 'useDiscussionQuery');
  assert.equal(norm('currentItemBackgroundColor'), 'currentItemBackgroundColor');
  assert.equal(norm('Created 2026-10-17T08:15:00Z at 8:15 AM'), 'Created <timestamp> at <clock>');
  // Ordinary words and short numbers stay.
  assert.equal(norm('Notes on the engine, 3 comments'), 'Notes on the engine, 3 comments');
});

test('compareItems reports what both plain runs agree on and the traced run changes', () => {
  const a = ['GET /api/me', 'POST /api/discussions', 'GET /api/discussions'];
  const b = ['GET /api/me', 'POST /api/discussions', 'GET /api/discussions'];
  assert.deepEqual(compareItems(a, b, a), { extra: [], missing: [] });
  assert.deepEqual(compareItems(a, b, ['GET /api/me', 'GET /api/discussions', 'GET /api/x']), {
    extra: ['GET /api/x'],
    missing: ['POST /api/discussions'],
  });
  // A request sent twice instead of once is a difference.
  assert.deepEqual(compareItems(a, b, [...a, 'GET /api/me']).extra, ['GET /api/me']);
});

test('compareItems ignores what the plain runs already disagreed on', () => {
  // Server-assigned counters differ run to run; the traced run's own value is noise too.
  const a = ['GET /api/posts/41', 'GET /api/me'];
  const b = ['GET /api/posts/42', 'GET /api/me'];
  assert.deepEqual(compareItems(a, b, ['GET /api/posts/43', 'GET /api/me']), {
    extra: [],
    missing: [],
  });
  // An item only one plain run had is never "missing" from the traced run.
  assert.deepEqual(compareItems(['x', 'y'], ['x'], ['x']), { extra: [], missing: [] });
});

const run = ({
  steps,
  requests = [],
  console: errors = [],
  storage = [],
  script = 10,
  replaced = [],
  headers = [],
}) => ({
  steps: steps.map((step) => ({
    description: step.description ?? 'Clicked "Save"',
    ok: step.ok ?? true,
    error: step.error ?? null,
    url: step.url ?? '/',
    lines: step.lines ?? ['- button "Save"'],
    settle_ms: step.settle_ms ?? 0,
    script_ms: step.script_ms ?? script,
  })),
  requests: requests.map((item) => ({ step: 0, item })),
  console: errors.map((item) => ({ step: 0, item })),
  storage,
  headers,
  script_ms: script * steps.length,
  footprint: { attributes: {}, replaced },
});

test('compareRuns says same when the traced run matches the control', () => {
  const plain = run({ steps: [{}], requests: ['POST /api/save body:abc'] });
  const traced = run({
    steps: [{ script_ms: 15 }],
    requests: ['POST /api/save body:abc'],
    script: 15,
    replaced: ['fetch'],
    headers: ['POST /api/save: traceparent'],
  });
  traced.footprint.attributes = { 'data-tracer-el': 4 };
  const result = compareRuns(plain, plain, traced);
  assert.equal(result.verdict, 'same');
  assert.deepEqual(result.divergences, []);
  assert.equal(result.overhead.ratio, 1.5);
  assert.deepEqual(result.footprint, {
    dom_attributes: { 'data-tracer-el': 4 },
    request_headers: ['traceparent'],
    replaced_browser_apis: ['fetch'],
  });
});

test('compareRuns names each way the traced run behaved differently', () => {
  const plain = run({
    steps: [{}, { url: '/done', lines: ['- heading "Saved"'] }],
    requests: ['POST /api/save body:abc'],
    storage: ['localStorage draft = 1'],
  });
  const traced = run({
    steps: [
      { ok: false, error: 'Timeout 8000ms exceeded' },
      { url: '/', lines: ['- button "Save"'] },
    ],
    requests: [],
    console: ['uncaught: TypeError: x is not a function'],
    storage: ['localStorage draft = 1'],
  });
  const kinds = compareRuns(plain, plain, traced).divergences.map((d) => d.kind);
  assert.deepEqual(kinds, ['step_failed', 'url', 'page', 'requests', 'console_errors']);
});

test('compareRuns counts a header added to another origin, and lists same-origin ones as footprint', () => {
  const plain = run({
    steps: [{}],
    headers: ['GET cross-origin /data: accept', 'POST /api/save: accept'],
  });
  const traced = run({
    steps: [{}],
    headers: [
      'GET cross-origin /data: accept',
      'GET cross-origin /data: traceparent',
      'POST /api/save: accept',
      'POST /api/save: traceparent',
    ],
  });
  const result = compareRuns(plain, plain, traced);
  assert.equal(result.verdict, 'different');
  assert.deepEqual(result.divergences, [
    {
      kind: 'request_headers',
      step: null,
      only_traced: ['GET cross-origin /data: traceparent'],
      only_plain: [],
    },
  ]);
  assert.deepEqual(result.footprint.request_headers, ['traceparent']);
});

test('compareRuns reports a page difference once, at the step where it appeared', () => {
  const lines = (...extra) => ['- button "Save"', ...extra];
  const plain = run({
    steps: [
      { lines: lines('- paragraph: a') },
      { lines: lines('- paragraph: a', '- paragraph: b') },
    ],
  });
  const traced = run({
    steps: [
      { lines: lines('- paragraph: x') },
      { lines: lines('- paragraph: x', '- paragraph: b') },
    ],
  });
  const pages = compareRuns(plain, plain, traced).divergences.filter((d) => d.kind === 'page');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].step.index, 0);
});

test('debugger mode: the summary counts actions and how each request was joined', () => {
  const records = [
    { kind: 'observe.action', action_id: 'observe:action:1' },
    { kind: 'observe.request', action_id: 'observe:action:1', via: 'dispatch' },
    { kind: 'observe.request', action_id: null, via: 'unknown' },
    { kind: 'observe.request', action_id: null, via: 'unknown' },
  ];
  assert.deepEqual(summarizeObserved({ stats: { pauses: 4, paused_ms: 12, errors: 0 }, records }), {
    actions: 1,
    requests: 3,
    joined: 1,
    via: { dispatch: 1, unknown: 2 },
    pauses: 4,
    paused_ms: 12,
    errors: 0,
  });
});

test('verify refuses a mode it does not know', async () => {
  await assert.rejects(
    verifyReadOnly({ serve: async () => {}, steps: [{ action: 'goto', value: '/' }], mode: 'x' }),
    /unknown verify mode "x"/u,
  );
});

test('a changed request body is a requests divergence', () => {
  const norm = normalizer('r1a2b3');
  const plain = requestItem(norm, 'POST', '/comments', '{"body":"A first comment."}');
  const changed = requestItem(norm, 'POST', '/comments', '{"body":"A first comment.","x":1}');
  assert.equal(plain, 'POST /comments body: {"body":"A first comment."}');
  assert.notEqual(plain, changed);
  // Run tokens and generated ids in a body are still normalized away.
  assert.equal(
    requestItem(norm, 'POST', '/users', '{"email":"ada-r1a2b3@example.test"}'),
    requestItem(normalizer('r9z8y7'), 'POST', '/users', '{"email":"ada-r9z8y7@example.test"}'),
  );
  assert.deepEqual(compareItems([plain], [plain], [changed]), {
    extra: [changed],
    missing: [plain],
  });
});

test('long saved values: random numbers stay noise, a real change shows, and the report prints them short', () => {
  const norm = normalizer('r1a2b3');
  const scene = (seed, extra = '') =>
    storageRow(
      norm,
      `localStorage excalidraw = [{"type":"arrow","seed":${seed}${extra},"points":"${'x'.repeat(400)}"}]`,
    );
  // Two plain runs and the traced run each draw their own random seed.
  assert.deepEqual(compareItems([scene(111)], [scene(222)], [scene(333)]), {
    extra: [],
    missing: [],
  });
  // The traced run saved something else as well.
  const changed = scene(333, ',"locked":true');
  assert.deepEqual(compareItems([scene(111)], [scene(111)], [changed]), {
    extra: [changed],
    missing: [scene(111)],
  });
  const { divergences } = compareRuns(
    ...[[scene(111)], [scene(111)], [changed]].map((storage) => run({ steps: [{}], storage })),
  );
  const [printed] = divergences.find((d) => d.kind === 'storage').only_traced;
  assert.ok(printed.length <= 300);
  assert.match(printed, /^localStorage excalidraw = .*… #[0-9a-f]{10}$/u);
  assert.equal(storageRow(norm, 'localStorage theme = dark'), 'localStorage theme = dark');
});
