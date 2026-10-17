// The runtime's overhead budget: an action keeps the first calls of each
// function as rows, counts the rest, and still writes a muted call's rows when
// a request, a continuation or an error needs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const setup = (extraGlobals = {}) => loadBrowserRuntime({ extraGlobals: { event: undefined, ...extraGlobals } });
const call = (runtime, id, body = () => {}) => {
  const frame = runtime.enter(id);
  try {
    return body(frame);
  } finally {
    runtime.exit(frame);
  }
};
const rows = (runtime, kind) => runtime.records.filter((row) => row.kind === kind);
const entersOf = (runtime, id) => rows(runtime, 'function.enter').filter((row) => row.function_id === id);

test('a function called past the budget in one action writes ten calls and one muted count', () => {
  const t = setup();
  t.dispatch('click', fakeElement('canvas'), {}, () => {
    for (let index = 0; index < 50; index += 1) call(t.runtime, 'fn:hot');
    call(t.runtime, 'fn:cold');
  });
  assert.equal(entersOf(t.runtime, 'fn:hot').length, 10);
  assert.equal(rows(t.runtime, 'function.exit').filter((row) => row.function_id === 'fn:hot').length, 10);
  assert.equal(entersOf(t.runtime, 'fn:cold').length, 1);
  t.runtime.captureSummary('test');
  const [muted] = rows(t.runtime, 'function.muted');
  assert.equal(muted.budget, 10);
  assert.equal(muted.calls, 40);
  assert.deepEqual(JSON.parse(JSON.stringify(muted.functions)), [{ function_id: 'fn:hot', calls: 40 }]);
  assert.equal(muted.action_id, entersOf(t.runtime, 'fn:hot')[0].action_id);
});

test('a muted call that sends a request writes its enter row first, so the request walks back to it', () => {
  const t = setup();
  t.dispatch('click', fakeElement('button'), {}, () => {
    for (let index = 0; index < 20; index += 1) call(t.runtime, 'fn:hot', () => index === 15 && t.context.fetch('/api/save'));
  });
  const enters = entersOf(t.runtime, 'fn:hot');
  assert.equal(enters.length, 11);
  const request = rows(t.runtime, 'network.request').at(-1);
  const owner = enters.find((row) => row.continuation_id === request.parent_continuation_id);
  assert.ok(owner, 'the request names a frame with an enter row');
  assert.ok(owner.sequence < request.sequence);
  assert.ok(rows(t.runtime, 'function.exit').some((row) => row.continuation_id === owner.continuation_id));
  t.runtime.captureSummary('test');
  assert.equal(rows(t.runtime, 'function.muted')[0].calls, 9);
});

test('a continuation armed in a muted call keeps a recorded creator', async () => {
  const t = setup();
  let timerAction = null;
  t.dispatch('click', fakeElement('button'), {}, () => {
    for (let index = 0; index < 12; index += 1)
      call(t.runtime, 'fn:hot', () => {
        if (index === 11) t.context.setTimeout(() => call(t.runtime, 'fn:later', () => (timerAction = t.runtime.context().action_id)), 0);
      });
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(entersOf(t.runtime, 'fn:hot').length, 11, 'the call that armed the timer was written');
  assert.ok(timerAction, 'the timer still runs under the action');
});

test('a muted call wrapping a fresh function writes the outer call before the inner one', () => {
  const t = setup();
  t.dispatch('click', fakeElement('button'), {}, () => {
    for (let index = 0; index < 12; index += 1) call(t.runtime, 'fn:outer', () => index === 11 && call(t.runtime, 'fn:inner'));
  });
  const outer = entersOf(t.runtime, 'fn:outer').at(-1);
  const [inner] = entersOf(t.runtime, 'fn:inner');
  assert.equal(inner.parent_continuation_id, outer.continuation_id);
  assert.ok(outer.sequence < inner.sequence);
  assert.deepEqual([...inner.spine.function_ids], ['fn:outer', 'fn:inner']);
});

test('a muted call that throws is written with the error', () => {
  const t = setup();
  t.dispatch('click', fakeElement('button'), {}, () => {
    for (let index = 0; index < 12; index += 1) {
      const frame = t.runtime.enter('fn:hot');
      if (index === 11) t.runtime.threw(frame, new TypeError('x'));
      t.runtime.exit(frame);
    }
  });
  const exits = rows(t.runtime, 'function.exit').filter((row) => row.function_id === 'fn:hot');
  assert.equal(exits.length, 11);
  assert.equal(exits.at(-1).threw, true);
});

test('__PRODUCTTRACE_FUNCTION_BUDGET__ = 0 records every call', () => {
  const t = setup({ __PRODUCTTRACE_FUNCTION_BUDGET__: 0 });
  t.dispatch('click', fakeElement('button'), {}, () => {
    for (let index = 0; index < 30; index += 1) call(t.runtime, 'fn:hot');
  });
  assert.equal(entersOf(t.runtime, 'fn:hot').length, 30);
  t.runtime.captureSummary('test');
  assert.equal(rows(t.runtime, 'function.muted').length, 0);
});

test('each action gets its own budget', () => {
  const t = setup();
  for (let round = 0; round < 2; round += 1)
    t.dispatch('click', fakeElement('button'), {}, () => {
      for (let index = 0; index < 15; index += 1) call(t.runtime, 'fn:hot');
    });
  const actions = new Set(entersOf(t.runtime, 'fn:hot').map((row) => row.action_id));
  assert.equal(actions.size, 2);
  assert.equal(entersOf(t.runtime, 'fn:hot').length, 20);
});
