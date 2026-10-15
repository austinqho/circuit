// Node-level tests of the browser runtime's action context: creation-time
// ownership, the strict frame stack, and state-receipt bookkeeping (per
// action+fiber, consumed by the first commit, attributed only on a rendered
// state change). The runtime runs in a V8 context with a fake React renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeElement, loadBrowserRuntime } from './helpers/browser-runtime-vm.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

// React 16-18 keep the dispatcher at `currentDispatcherRef.current`; React 19
// at `currentDispatcherRef.H` (ReactSharedInternals).
function setup({ reactVersion = '18.3.1' } = {}) {
  const warnings = [];
  const vm = loadBrowserRuntime({ extraGlobals: { event: undefined, console: { ...console, warn: message => warnings.push(String(message)) } } });
  const { context, runtime } = vm;
  // Fake renderer: null outside React's work loop, ContextOnly inside it
  // between components, a hooks dispatcher while a component renders.
  const throwing = () => { throw new Error('invalid hook call'); };
  const ContextOnly = { useState: throwing, useReducer: throwing, useEffect: throwing };
  const key = Number.parseInt(reactVersion, 10) >= 19 ? 'H' : 'current';
  const internals = { [key]: null };
  const ref = { get current() { return internals[key]; }, set current(value) { internals[key] = value; } };
  context.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({ currentDispatcherRef: internals, version: reactVersion, reconcilerVersion: reactVersion });
  // One component fiber with one useState hook and one passive effect.
  const makeComponent = (initial) => {
    const hook = { memoizedState: initial, queue: { dispatch: null }, next: null };
    const rawSetter = function (update) { hook.pending = typeof update === 'function' ? update(hook.memoizedState) : update; };
    hook.queue.dispatch = rawSetter;
    const effect = { tag: 1 | 8, create: null, destroy: undefined, next: null }; effect.next = effect;
    const fiber = { tag: 0, memoizedState: hook, updateQueue: { lastEffect: effect }, child: null, sibling: null, alternate: {} };
    let setter = null;
    // A render: install a hooks dispatcher, read state through it, restore.
    const render = () => {
      if ('pending' in hook) { hook.memoizedState = hook.pending; delete hook.pending; }
      ref.current = { useState: () => [hook.memoizedState, rawSetter], useReducer: throwing, useEffect: () => {} };
      try { setter = ref.current.useState()[1]; } finally { ref.current = null; }
      effect.tag = 1 | 8; // HasEffect | Passive for this commit
    };
    const commit = () => context.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: fiber });
    return { hook, fiber, effect, render, commit, set: value => setter(value) };
  };
  const requests = () => runtime.records.filter(row => row.kind === 'network.request');
  const lastRequest = () => requests().at(-1);
  return { ...vm, makeComponent, requests, lastRequest, ref, ContextOnly, warnings };
}

test('receipt recorded under a bare dispatch frame attributes the rendered change (state_effect)', () => {
  const t = setup();
  const component = t.makeComponent(0); component.render(); component.commit();
  const button = fakeElement('button');
  let action = null;
  t.dispatch('click', button, {}, () => { action = t.runtime.context().action_id; component.set(1); });
  assert.ok(action, 'dispatch frame is current during the dispatch');
  assert.equal(t.runtime.stampStats().state_receipts_recorded, 1, 'bare frame receipts are valid');
  component.render(); component.effect.create = () => { t.context.fetch('/api/effect'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, action);
  assert.equal(t.lastRequest().linkage_kind, 'state_effect');
});

test('no-op setter: the receipt is refused and the effect runs unowned', () => {
  const t = setup();
  const component = t.makeComponent(0); component.render(); component.commit();
  t.dispatch('click', fakeElement('button'), {}, () => component.set(0));
  component.render(); component.effect.create = () => { t.context.fetch('/api/p1'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, null);
  assert.equal(t.runtime.stampStats().state_receipts_refused, 1);
});

test('the first commit consumes every receipt; a later render of the fiber gets nothing (P2)', () => {
  const t = setup();
  const component = t.makeComponent(0); component.render(); component.commit();
  t.dispatch('click', fakeElement('button'), {}, () => component.set(1));
  component.commit(); // a commit in which this fiber did not render
  assert.equal(t.runtime.stampStats().state_receipts_consumed, 1);
  component.render(); component.effect.create = () => { t.context.fetch('/api/p2-tick'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, null, 'no receipt carried to a later commit');
});

test('an unreceipted passive effect keeps a direct action continuation but not a bare frame', () => {
  const t = setup();
  const component = t.makeComponent(0); component.render(); component.commit();
  let action = null;
  t.dispatch('click', fakeElement('button'), {}, () => {
    action = t.runtime.context().action_id;
    // flushed on the bare dispatch frame: unowned
    component.render(); component.effect.create = () => { t.context.fetch('/api/on-bare'); }; component.commit(); component.effect.create();
    const frame = t.runtime.enter(1); // a first-party handler flushing synchronously
    try { component.render(); component.effect.create = () => { t.context.fetch('/api/on-handler'); }; component.commit(); component.effect.create(); }
    finally { t.runtime.exit(frame); }
  });
  const byUrl = url => t.requests().find(row => row.url === url);
  assert.equal(byUrl('/api/on-bare').action_id, null);
  assert.equal(byUrl('/api/on-handler').action_id, action);
});

test('nothing created while a component renders is owned by the action it runs on', async () => {
  const t = setup();
  let action = null;
  t.dispatch('click', fakeElement('button'), {}, () => {
    action = t.runtime.context().action_id;
    const frame = t.runtime.enter(1);
    try {
      t.ref.current = { useState: () => [0, () => {}], useReducer: () => {}, useEffect: () => {} };
      try { t.evaluate('Promise').resolve().then(() => t.context.fetch('/api/in-render-promise')); } finally { t.ref.current = null; }
    } finally { t.runtime.exit(frame); }
  });
  await tick();
  assert.ok(action);
  assert.equal(t.requests().find(row => row.url === '/api/in-render-promise').action_id, null);
});

test('creation-time ownership: created during the action is owned; created before is not; no ambient at run time', async () => {
  const t = setup();
  const VmPromise = t.evaluate('Promise'); // the context's patched Promise
  const before = VmPromise.resolve();
  let action = null;
  let releaseBefore; const gate = new VmPromise(resolve => { releaseBefore = resolve; });
  gate.then(() => t.context.fetch('/api/created-before'));
  t.dispatch('click', fakeElement('button'), {}, () => {
    action = t.runtime.context().action_id; // bare: no first-party frame open
    t.context.setTimeout(() => t.context.fetch('/api/timer-in-action'), 1);
    before.then(() => t.context.fetch('/api/then-in-action'));
    releaseBefore(); // the reaction registered before the action runs now
  });
  await tick(); await tick();
  const byUrl = url => t.requests().find(row => row.url === url);
  assert.equal(byUrl('/api/timer-in-action').action_id, action);
  assert.equal(byUrl('/api/then-in-action').action_id, action);
  assert.equal(byUrl('/api/created-before').action_id, null, 'a reaction created before the action is not owned by it');
});

test('a callback created in action A that runs after action B started belongs to A', async () => {
  const t = setup();
  let a = null, b = null;
  t.dispatch('click', fakeElement('button'), {}, () => { a = t.runtime.context().action_id; t.context.setTimeout(() => t.context.fetch('/api/cross'), 15); });
  t.dispatch('click', fakeElement('button'), {}, () => { b = t.runtime.context().action_id; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.notEqual(a, b);
  assert.equal(t.requests().find(row => row.url === '/api/cross').action_id, a);
});

test('renders never inherit the action they are flushed on', () => {
  const t = setup();
  t.dispatch('click', fakeElement('button'), {}, () => {
    t.ref.current = { useState: () => [0, () => {}], useReducer: () => {}, useEffect: () => {} };
    try { const frame = t.runtime.enter(2); t.context.fetch('/api/in-render'); t.runtime.exit(frame); } finally { t.ref.current = null; }
  });
  assert.equal(t.lastRequest().action_id, null);
});

test('functional no-op updater: setOpen(o => false) while false, then an unrelated re-render, is not attributed', () => {
  const t = setup();
  const component = t.makeComponent(false); component.render(); component.commit();
  t.dispatch('click', fakeElement('button'), {}, () => component.set(() => false));
  // React bails out; a later unrelated commit re-renders the fiber.
  component.render(); component.effect.create = () => { t.context.fetch('/api/p1f-tick'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, null);
  assert.equal(t.runtime.stampStats().state_receipts_refused, 1);
});

test('a functional updater that changes state is attributed (state_effect)', () => {
  const t = setup();
  const component = t.makeComponent(0); component.render(); component.commit();
  let action = null;
  t.dispatch('click', fakeElement('button'), {}, () => { action = t.runtime.context().action_id; component.set(value => value + 1); });
  component.render(); component.effect.create = () => { t.context.fetch('/api/functional'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, action);
  assert.equal(t.lastRequest().linkage_kind, 'state_effect');
});

test('React 19: the dispatcher at ReactSharedInternals.H records receipts', () => {
  const t = setup({ reactVersion: '19.2.3' });
  const component = t.makeComponent(0); component.render(); component.commit();
  let action = null;
  t.dispatch('click', fakeElement('button'), {}, () => { action = t.runtime.context().action_id; component.set(1); });
  component.render(); component.effect.create = () => { t.context.fetch('/api/r19'); }; component.commit();
  component.effect.create();
  assert.equal(t.lastRequest().action_id, action);
  assert.equal(t.lastRequest().linkage_kind, 'state_effect');
  assert.equal(t.runtime.records.filter(row => row.kind === 'capture.limit').length, 0);
});

test('no dispatcher found: one capture.limit row, one warning, no state_effect', () => {
  const warnings = [];
  const vm = loadBrowserRuntime({ extraGlobals: { event: undefined, console: { ...console, warn: message => warnings.push(String(message)) } } });
  const hook = vm.context.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  hook.inject({ currentDispatcherRef: {}, version: '20.0.0' });
  hook.inject({ currentDispatcherRef: {}, version: '20.0.0' });
  const limits = vm.runtime.records.filter(row => row.kind === 'capture.limit');
  assert.equal(limits.length, 1);
  assert.deepEqual({ feature: limits[0].feature, reason: limits[0].reason, react_version: limits[0].react_version }, { feature: 'state_receipts', reason: 'dispatcher not found', react_version: '20.0.0' });
  assert.equal(warnings.length, 1);
});
