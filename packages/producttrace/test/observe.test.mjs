// Debugger mode: the join rules (identifiers only, abstain otherwise), function
// ranges read from a served script, and the observer's promise never to pause
// the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttribution } from '../observe/attribution.mjs';
import { functionRanges } from '../observe/function-ranges.mjs';
import { observePage } from '../observe.mjs';

const handler = (start, end, name = 'onClick') => ({ name, file: '/src/app.jsx', line: 1, range: { script_id: '7', start, end } });
const action = (attribution, ...handlers) => {
  const started = attribution.startDispatch({ event: 'click' });
  started.handlers.push(...handlers);
  attribution.endDispatch(started.action_id);
  return started;
};
// A frame: script 7 is the app, script 3 is React.
const app = (offset, segment = 1, link = null) => ({ script_id: '7', offset, app: true, segment, link });
const react = (offset, segment = 1, link = null, name = 'executeDispatch') => ({
  script_id: '3',
  offset,
  name,
  app: false,
  segment,
  link,
});

test('a dispatch whose end was seen only on the next task does not claim what was sent in it', () => {
  const attribution = createAttribution();
  const stopped = attribution.startDispatch({ event: 'click' });
  attribution.endDispatch(stopped.action_id, { late: true });
  const cause = attribution.causeOf({ in_dispatch: stopped.action_id });
  assert.equal(cause.action_id, null);
  assert.deepEqual(cause.could_be, [stopped.action_id]);
  assert.match(cause.reason, /a timer could have sent it/u);
});

test('a request sent during a dispatch joins it; an id the attribution never issued does not', () => {
  const attribution = createAttribution();
  const save = attribution.startDispatch({ event: 'click' });
  assert.equal(attribution.running(), save.action_id);
  assert.deepEqual(attribution.causeOf({ in_dispatch: save.action_id }), { action_id: save.action_id, via: 'dispatch' });
  attribution.endDispatch(save.action_id);
  assert.equal(attribution.running(), null);
  assert.equal(attribution.causeOf({ in_dispatch: 'observe:action:99' }).via, 'unknown');
});

test('after an await, a handler that ran for exactly one dispatch, called by React, names it', () => {
  const attribution = createAttribution();
  const open = action(attribution, handler(300, 400, 'onOpen'));
  action(attribution, handler(100, 200, 'onSave'));
  const cause = attribution.causeOf({ stack: [app(20), app(350, 2, 'await'), react(9, 2, 'await')], started_in: { name: 'onOpen' } });
  assert.equal(cause.action_id, open.action_id);
  assert.equal(cause.via, 'only_run_of_handler');
});

test('an async handler resumed after await is followed to the stretch that called it', () => {
  const attribution = createAttribution();
  const open = action(attribution, handler(300, 400, 'onOpen'));
  // The handler is alone in its stretch; React called it one stretch out.
  const stack = [app(20), app(350, 2, 'await'), react(9, 3, 'await')];
  assert.equal(attribution.causeOf({ stack }).action_id, open.action_id);
});

test('two runs of the same handler abstain and list both, never the latest', () => {
  const attribution = createAttribution();
  const first = action(attribution, handler(100, 200));
  const second = action(attribution, handler(100, 200));
  // A timer the handler set: the handler is one stretch out, called by React.
  const stack = [app(20), app(150, 2, 'setTimeout'), react(9, 2, 'setTimeout')];
  const cause = attribution.causeOf({ stack, started_in: { name: 'onClick' } });
  assert.equal(cause.action_id, null);
  assert.equal(cause.via, 'unknown');
  assert.deepEqual(cause.could_be, [first.action_id, second.action_id]);
  assert.match(cause.reason, /2 actions ran this handler/u);
});

test("a handler called from the app's own code or by the browser directly is not an event", () => {
  const attribution = createAttribution();
  action(attribution, handler(100, 200));
  const later = (...callers) => [app(20), app(150, 2, 'await'), ...callers];
  // A shortcut, effect or poll in the app calls the same function.
  assert.match(attribution.causeOf({ stack: later(app(500, 2, 'await')) }).reason, /app's own code/u);
  // A timer calls it with nothing around it.
  assert.match(attribution.causeOf({ stack: [app(20), app(150, 2, 'setTimeout')] }).reason, /browser directly/u);
});

test('a handler React runs as an effect, or sends from outside every event, is not an event', () => {
  const attribution = createAttribution();
  action(attribution, handler(100, 200, 'reload'));
  // useEffect(reload): React's commit calls it, even when inside a click.
  const effect = [app(150), react(9, 1, null, 'commitHookEffectListMount'), react(5, 1, null, 'dispatchDiscreteEvent')];
  assert.match(attribution.causeOf({ stack: effect }).reason, /outside every recorded event/u);
  const awaited = [app(20), app(150, 2, 'await'), react(9, 2, 'await', 'commitHookEffectListMount')];
  assert.match(attribution.causeOf({ stack: awaited }).reason, /not from React's event dispatch/u);
  // An async handler resumed after await sits on the request's own stack;
  // who called it is one stretch out: React's commit there, its event dispatch here.
  const resumed = (name) => [app(150), react(9, 2, 'await', name)];
  assert.match(attribution.causeOf({ stack: resumed('commitHookEffectListMount') }).reason, /not from React's event dispatch/u);
  assert.equal(attribution.causeOf({ stack: resumed('executeDispatch') }).via, 'only_run_of_handler');
  // A minified build names nothing, so it abstains.
  assert.equal(attribution.causeOf({ stack: [app(20), app(150, 2, 'await'), react(9, 2, 'await', 'a')] }).via, 'unknown');
});

test('a frame in another script, outside every handler, or a cut-short stack is not a match', () => {
  const attribution = createAttribution();
  action(attribution, handler(100, 200));
  assert.equal(attribution.causeOf({ stack: [{ ...app(150), script_id: '8' }], started_in: { name: 'poll' } }).reason, 'started outside every recorded handler');
  assert.equal(attribution.causeOf({ stack: [app(200)] }).reason, 'no first-party code on the stack');
  assert.equal(attribution.causeOf({ stack: [app(20), app(150, 2, 'await'), react(9, 2)], truncated: true }).via, 'unknown');
});

test('function ranges: the innermost function around a position', () => {
  const source = ['function outer() {', '  const inner = () => {', '    fetch("/a");', '  };', '  return inner;', '}', 'outer();'].join('\n');
  const ranges = functionRanges(source);
  const inner = ranges.rangeAt(2, 4);
  assert.equal(source.slice(inner.start, inner.end), '() => {\n    fetch("/a");\n  }');
  const outer = ranges.rangeAt(4, 2);
  assert.ok(source.slice(outer.start, outer.end).startsWith('function outer()'));
  assert.equal(ranges.rangeAt(6, 0), null);
  assert.equal(ranges.offset(1, 2), source.indexOf('const inner'));
});

// A DevTools session that records what the observer asks for.
const fakeCdp = () => {
  const sent = [];
  const listeners = new Map();
  return {
    sent,
    on: (name, listener) => listeners.set(name, listener),
    off: (name) => listeners.delete(name),
    emit: (name, params) => listeners.get(name)?.(params),
    async send(method, params = {}) {
      sent.push({ method, params });
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: '1' };
      if (method === 'Debugger.getScriptSource') return { scriptSource: 'function poll() {\n  return fetch("/api/poll");\n}' };
      return {};
    },
  };
};
const request = (url) => ({
  type: 'Fetch',
  request: { url, method: 'GET' },
  initiator: { type: 'script', stack: { callFrames: [{ functionName: 'poll', scriptId: '4', lineNumber: 1, columnNumber: 9 }] } },
});

test('the observer never pauses the page and listens from a world the app cannot see', async () => {
  const cdp = fakeCdp();
  const observer = await observePage(cdp, { appOrigin: 'http://localhost:5173' });
  await observer.stop();
  const methods = cdp.sent.map((call) => call.method);
  assert.deepEqual(cdp.sent.find((call) => call.method === 'Debugger.setSkipAllPauses').params, { skip: true });
  for (const method of methods) assert.doesNotMatch(method, /setBreakpoint|setXHRBreakpoint|setEventListenerBreakpoint|Debugger\.pause$/u);
  const world = cdp.sent.find((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument').params.worldName;
  assert.ok(world);
  assert.equal(cdp.sent.find((call) => call.method === 'Runtime.addBinding').params.executionContextName, world);
  assert.equal(observer.stats().pauses, 0);
});

test('a request between a dispatch start and end joins it; one after the end is read from its stack', async () => {
  const cdp = fakeCdp();
  const observer = await observePage(cdp, { appOrigin: 'http://localhost:5173' });
  cdp.emit('Debugger.scriptParsed', { scriptId: '4', url: 'http://localhost:5173/src/poll.js' });
  const binding = (payload) => cdp.emit('Runtime.bindingCalled', { name: '__producttraceObserve', executionContextId: 2, payload: JSON.stringify(payload) });
  binding({ phase: 'start', n: 1, type: 'click' });
  cdp.emit('Network.requestWillBeSent', request('http://localhost:5173/api/save'));
  binding({ phase: 'end', n: 1 });
  cdp.emit('Network.requestWillBeSent', request('http://localhost:5173/api/poll'));
  await observer.stop();
  const [click, save, poll] = observer.records();
  assert.equal(click.kind, 'observe.action');
  assert.equal(click.event, 'click');
  assert.deepEqual([save.url, save.action_id, save.via], ['http://localhost:5173/api/save', click.action_id, 'dispatch']);
  assert.deepEqual([poll.action_id, poll.via], [null, 'unknown']);
  assert.equal(poll.reason, 'started outside every recorded handler');
  assert.deepEqual(observer.stats(), { pauses: 0, dispatches: 1, requests: 2, errors: 0, actions: 1 });
});

test('a request sent before a dispatch end that came only on the next task is not claimed', async () => {
  const cdp = fakeCdp();
  const observer = await observePage(cdp, { appOrigin: 'http://localhost:5173' });
  cdp.emit('Debugger.scriptParsed', { scriptId: '4', url: 'http://localhost:5173/src/poll.js' });
  const binding = (payload) =>
    cdp.emit('Runtime.bindingCalled', { name: '__producttraceObserve', executionContextId: 2, payload: JSON.stringify(payload) });
  binding({ phase: 'start', n: 1, type: 'click' });
  cdp.emit('Network.requestWillBeSent', request('http://localhost:5173/api/tick'));
  binding({ phase: 'end', n: 1, late: true });
  await observer.stop();
  const tick = observer.records().find((row) => row.kind === 'observe.request');
  assert.equal(tick.via, 'unknown');
  assert.deepEqual(tick.could_be, [observer.records()[0].action_id]);
});
