// Debugger mode: the join rules (identifiers only, abstain otherwise), function
// ranges read from a served script, and the observer's promise to pause only
// inside the dispatch of the user's own input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttribution } from '../observe/attribution.mjs';
import { functionRanges } from '../observe/function-ranges.mjs';
import { observePage } from '../observe.mjs';

const handler = (start, end, name = 'onClick') => ({ name, file: '/src/app.jsx', line: 1, range: { script_id: '7', start, end } });

test('a request joins the action whose Event, fiber or handler identifies it', () => {
  const attribution = createAttribution();
  const save = attribution.noteAction({ event: 'click', handlers: [handler(100, 200, 'onSave')] });
  const open = attribution.noteAction({ event: 'click', handlers: [handler(300, 400, 'onOpen')] });

  assert.deepEqual(attribution.causeOf({ dispatching: save.action_id }), { action_id: save.action_id, via: 'dispatch' });
  assert.deepEqual(attribution.causeOf({ in_scope: open.action_id }), { action_id: open.action_id, via: 'event_in_scope' });
  assert.deepEqual(attribution.causeOf({ effect_of: save.action_id }), { action_id: save.action_id, via: 'state_effect' });
  // After an await: only the async stack is left, and it passes through onOpen.
  const late = attribution.causeOf({ stack: [{ script_id: '9', offset: 5 }, { script_id: '7', offset: 350 }], started_in: { name: 'onOpen' } });
  assert.equal(late.action_id, open.action_id);
  assert.equal(late.via, 'only_run_of_handler');
});

test('two runs of the same handler abstain and list both, never the latest', () => {
  const attribution = createAttribution();
  const first = attribution.noteAction({ event: 'click', handlers: [handler(100, 200)] });
  const second = attribution.noteAction({ event: 'click', handlers: [handler(100, 200)] });
  const cause = attribution.causeOf({ stack: [{ script_id: '7', offset: 150 }], started_in: { name: 'onClick' } });
  assert.equal(cause.action_id, null);
  assert.equal(cause.via, 'unknown');
  assert.deepEqual(cause.could_be, [first.action_id, second.action_id]);
  assert.match(cause.reason, /2 actions ran this handler/u);
});

test('a frame in another script, or outside every handler, is not a match', () => {
  const attribution = createAttribution();
  attribution.noteAction({ event: 'click', handlers: [handler(100, 200)] });
  assert.equal(attribution.causeOf({ stack: [{ script_id: '8', offset: 150 }], started_in: { name: 'poll' } }).reason, 'started outside every recorded handler');
  assert.equal(attribution.causeOf({ stack: [{ script_id: '7', offset: 200 }] }).reason, 'no first-party code on the stack');
  // An id the attribution never issued is not trusted.
  assert.equal(attribution.causeOf({ dispatching: 'observe:action:99' }).via, 'unknown');
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
  let nextBreakpoint = 0;
  return {
    sent,
    on: (name, listener) => listeners.set(name, listener),
    off: (name) => listeners.delete(name),
    emit: (name, params) => listeners.get(name)?.(params),
    async send(method, params = {}) {
      sent.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { objectId: `fn:${params.expression}` } };
      if (method === 'Debugger.getScriptSource') return { scriptSource: 'function dispatchSetState(fiber, queue, action) {\n  return 1;\n}' };
      if (method.startsWith('Debugger.setBreakpoint')) return { breakpointId: `bp${++nextBreakpoint}` };
      return {};
    },
  };
};

test('the observer pauses only inside the dispatch of a trusted user event', async () => {
  const cdp = fakeCdp();
  const observer = await observePage(cdp, { appOrigin: 'http://localhost:5173' });
  cdp.emit('Runtime.executionContextCreated', { context: { id: 1, auxData: { isDefault: true } } });
  cdp.emit('Runtime.executionContextCreated', { context: { id: 2, auxData: { isDefault: false } } });
  cdp.emit('Debugger.scriptParsed', { scriptId: '3', url: 'http://localhost:5173/node_modules/.vite/deps/react-dom_client.js' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await observer.stop();

  const methods = cdp.sent.map((call) => call.method);
  assert.ok(!methods.includes('DOMDebugger.setXHRBreakpoint'), 'no unconditional pause on every request');
  assert.deepEqual(
    cdp.sent.filter((call) => call.method === 'DOMDebugger.setEventListenerBreakpoint').map((call) => call.params.eventName),
    ['click', 'dblclick', 'submit', 'input'],
  );
  const conditional = cdp.sent.filter((call) => ['Debugger.setBreakpoint', 'Debugger.setBreakpointOnFunctionCall'].includes(call.method));
  // fetch and XHR send in the page's own world (not the isolated one), and React's setState.
  assert.deepEqual(conditional.map((call) => call.params.objectId ?? 'setState').sort(), [
    'fn:globalThis.XMLHttpRequest && XMLHttpRequest.prototype.send',
    'fn:globalThis.fetch',
    'setState',
  ]);
  for (const call of conditional) assert.match(call.params.condition, /globalThis\.event\.isTrusted === true/u);
  assert.deepEqual(
    cdp.sent.filter((call) => call.method === 'Runtime.evaluate').map((call) => call.params.contextId),
    [1, 1],
  );
});

test('a request sent outside a dispatch is read from its network event, without a pause', async () => {
  const cdp = fakeCdp();
  const observer = await observePage(cdp, { appOrigin: 'http://localhost:5173' });
  cdp.emit('Debugger.scriptParsed', { scriptId: '4', url: 'http://localhost:5173/src/poll.js' });
  cdp.emit('Network.requestWillBeSent', {
    type: 'Fetch',
    request: { url: 'http://localhost:5173/api/poll', method: 'GET' },
    initiator: { type: 'script', stack: { callFrames: [{ functionName: 'poll', scriptId: '4', lineNumber: 0, columnNumber: 0 }] } },
  });
  await observer.stop();
  const [row] = observer.records();
  assert.equal(row.kind, 'observe.request');
  assert.equal(row.url, 'http://localhost:5173/api/poll');
  assert.equal(row.method, 'GET');
  assert.equal(row.action_id, null);
  assert.equal(row.reason, 'started outside every recorded handler');
  assert.equal(observer.stats().requests_read_without_pause, 1);
  assert.equal(observer.stats().pauses, 0);
});
