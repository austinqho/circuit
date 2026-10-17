/**
 * Observe mode: what the user did and what each action caused, read from
 * Chrome's debugger. Nothing in the app is rewritten, wrapped or replaced.
 *
 * The page pauses only while it is handling the user's own input: at a user
 * event, and at a fetch / XHR send or a React setState that runs while one is
 * being dispatched (conditional breakpoints, checked in the page, decide). Chrome
 * drops input that arrives while a page is paused, so the observer never
 * pauses in background work, where the user's next press could land. A
 * request sent outside a dispatch is read from the network event's own stack,
 * without pausing.
 *
 *   const observer = await observePage(cdpSession, { appOrigin });
 *   ... drive the page ...
 *   observer.records(); // observe.action / observe.request rows
 *   await observer.stop();
 *
 * `cdpSession` is a Chrome DevTools Protocol session for the page (Playwright's
 * `context.newCDPSession(page)` or any { send, on, off }). Joins follow
 * attribution.mjs: identifiers only, unknown when the browser gives none.
 *
 * Reads it makes in the page (all through the debugger, none writing):
 * `window.event`, the event's target and its ancestors' React props
 * (`__reactProps$…`, for the declared handler), and the variables of the
 * functions on the stack when a request is sent.
 */
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { createAttribution } from './attribution.mjs';
import { functionRanges } from './function-ranges.mjs';

// Events that pause. Not `change`: it fires on blur, between the press and
// release of the click that moved focus, and a pause there lost that click in
// testing. Not `keydown`: `input` already marks each typed value.
const USER_EVENTS = ['click', 'dblclick', 'submit', 'input'];
// Checked by the page at each fetch / XHR send / setState: pause only inside
// the dispatch of a trusted user event. Hover, focus and timers never pause.
const IN_USER_DISPATCH = `globalThis.event != null && globalThis.event.isTrusted === true && ${JSON.stringify(USER_EVENTS)}.includes(globalThis.event.type)`;
const REACT_PROP = {
  click: 'onClick',
  dblclick: 'onDoubleClick',
  submit: 'onSubmit',
  input: 'onChange',
};
const ASYNC_DEPTH = 32;
const MAX_SCOPE_FRAMES = 6;
// Objects the observer keeps a handle on (each action's Event, each fiber an
// action set state on), so later pauses can ask the page whether a value is
// the same object. Bounded; an action past the bound can no longer be joined.
const OBJECT_GROUP = 'producttrace-observe';
// Everything else read during one pause, released when the page resumes.
const PAUSE_GROUP = 'producttrace-observe-pause';
const KEEP_ACTIONS = 500,
  KEEP_RECEIPTS = 200;
const INDEX_OF_THIS =
  'function () { for (let i = 0; i < arguments.length; i += 1) if (arguments[i] === this) return i; return -1; }';

// Runs in the page through Runtime.callFunctionOn with `this` = the Event.
// Reads only: the target's description and the React handlers declared for
// this event on the target and its ancestors.
const DESCRIBE_EVENT = `function (prop) {
  const target = this.target && this.target.nodeType === 1 ? this.target : this.target && this.target.parentElement;
  const text = node => (node && (node.getAttribute('aria-label') || node.innerText || node.value || '') || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  const control = target && target.closest ? target.closest('button,a,input,select,textarea,[role],label,summary') || target : target;
  const handlers = [];
  for (let node = target, depth = 0; node && depth < 12; node = node.parentElement, depth += 1) {
    const key = Object.keys(node).find(name => name.startsWith('__reactProps$'));
    const fn = key && node[key] && node[key][prop];
    if (typeof fn === 'function' && !handlers.includes(fn)) handlers.push(fn);
  }
  return { info: { type: this.type, trusted: this.isTrusted === true,
    target: control ? { tag: control.tagName.toLowerCase(), role: control.getAttribute('role') || null, name: text(control) || null,
      label: control.labels && control.labels[0] ? text(control.labels[0]) : null, input_type: control.type || null } : null }, handlers };
}`;

export async function observePage(cdp, { appOrigin = null } = {}) {
  const scripts = new Map(); // scriptId -> { url, sourceMapURL, map }
  const attribution = createAttribution();
  const rows = [];
  const pendingPauses = []; // causes read at a send's pause, waiting for its Network.requestWillBeSent
  const stats = { pauses: 0, paused_ms: 0, requests_read_without_pause: 0, errors: 0 };
  let setStateBreakpoint = null;
  const sendBreakpoints = new Set();
  // Handlers run one at a time, in the order the page reported, so a send's
  // pause is read before its network event.
  let queue = Promise.resolve();
  const failed = (error) => {
    stats.errors += 1;
    stats.last_error = String(error?.message || error).slice(0, 200);
  };
  const serial = (handler) => (event) => {
    queue = queue.then(() => handler(event)).catch(failed);
  };
  let sequence = 0;

  const emit = (row) => {
    const record = { schema: 'producttrace.observe.v1', sequence: ++sequence, ...row };
    rows.push(record);
    return record;
  };

  const isApp = (scriptId) => {
    const url = scripts.get(scriptId)?.url || '';
    if (!url || /\/node_modules\/|\/\.vite\/deps\/|\/@vite\/|\/@react-refresh|\/@id\//u.test(url))
      return false;
    if (!appOrigin) return /^https?:/u.test(url);
    try {
      return new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };
  // Original file and line for a position in a served script, through its source map.
  const source = (scriptId, lineNumber, columnNumber) => {
    const script = scripts.get(scriptId);
    if (!script) return null;
    let file = script.url;
    try {
      file = new URL(script.url).pathname;
    } catch {}
    let line = lineNumber + 1;
    if (script.map === undefined) {
      script.map = null;
      const raw = script.sourceMapURL || '';
      const match = raw.match(/^data:application\/json[^,]*?(;base64)?,(.*)$/u);
      if (match) {
        try {
          script.map = new TraceMap(
            JSON.parse(
              match[1]
                ? Buffer.from(match[2], 'base64').toString('utf8')
                : decodeURIComponent(match[2]),
            ),
          );
        } catch {
          script.map = null;
        }
      }
    }
    if (script.map) {
      const original = originalPositionFor(script.map, {
        line: lineNumber + 1,
        column: columnNumber || 0,
      });
      if (original?.line) line = original.line;
    }
    return { file, line };
  };
  const frameOf = (frame) => {
    const scriptId = frame.location?.scriptId ?? frame.scriptId;
    const lineNumber = frame.location?.lineNumber ?? frame.lineNumber;
    const columnNumber = frame.location?.columnNumber ?? frame.columnNumber;
    const where = source(scriptId, lineNumber, columnNumber);
    return {
      name: frame.functionName || null,
      file: where?.file ?? null,
      line: where?.line ?? null,
      app: isApp(scriptId),
    };
  };

  const actionEvents = []; // { action_id, objectId } of each action's Event
  const receipts = []; // { action_id, objectId } of each fiber an action set state on
  // Which entry of `list` holds the same object as `objectId` (identity, asked of the page).
  const sameAs = async (objectId, list) => {
    if (!objectId || !list.length) return null;
    try {
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: INDEX_OF_THIS,
        arguments: list.map((entry) => ({ objectId: entry.objectId })),
        returnByValue: true,
        silent: true,
      });
      return result.value >= 0 ? list[result.value] : null;
    } catch {
      return null;
    }
  };
  const keep = (list, entry, limit) => {
    list.push(entry);
    if (list.length > limit)
      cdp.send('Runtime.releaseObject', { objectId: list.shift().objectId }).catch(() => {});
  };
  const evaluate = async (callFrameId, expression, objectGroup = PAUSE_GROUP) => {
    try {
      const { result, exceptionDetails } = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        silent: true,
        throwOnSideEffect: true,
        objectGroup,
      });
      return exceptionDetails ? null : result;
    } catch {
      return null;
    }
  };
  const currentEvent = async (callFrame, objectGroup = PAUSE_GROUP) => {
    const result = await evaluate(callFrame.callFrameId, 'globalThis.event', objectGroup);
    return result?.objectId && /Event$/u.test(result.className || '') ? result : null;
  };

  // Each script's function ranges, parsed once, when a handler or frame needs them.
  const rangesOf = async (scriptId) => {
    const script = scripts.get(scriptId);
    if (!script) return null;
    if (script.ranges === undefined) {
      script.ranges = null;
      try {
        script.ranges = functionRanges(
          (await cdp.send('Debugger.getScriptSource', { scriptId })).scriptSource,
        );
      } catch {}
    }
    return script.ranges;
  };
  // Every frame on the stack, the paused ones first, then each async parent.
  const stackOf = async (paused) => {
    const raw = paused.callFrames.map((frame) => ({
      functionName: frame.functionName,
      scriptId: frame.location.scriptId,
      lineNumber: frame.location.lineNumber,
      columnNumber: frame.location.columnNumber,
    }));
    return withParents(raw, paused.asyncStackTrace);
  };
  const withParents = async (raw, trace) => {
    let guard = 0;
    while (trace && guard++ < ASYNC_DEPTH) {
      raw.push(...trace.callFrames);
      trace =
        trace.parent ||
        (trace.parentId
          ? (
              await cdp
                .send('Debugger.getStackTrace', { stackTraceId: trace.parentId })
                .catch(() => ({}))
            ).stackTrace
          : null);
    }
    return raw;
  };
  // First-party functions on the stack, outermost first, for the report.
  const appFunctions = (raw) =>
    raw
      .map(frameOf)
      .filter((frame) => frame.app)
      .reverse();
  const positions = async (raw) => {
    const out = [];
    for (const frame of raw) {
      const ranges =
        isApp(frame.scriptId) || scripts.get(frame.scriptId)
          ? await rangesOf(frame.scriptId)
          : null;
      if (ranges)
        out.push({
          script_id: frame.scriptId,
          offset: ranges.offset(frame.lineNumber, frame.columnNumber),
        });
    }
    return out;
  };

  // Events held by the functions on the stack (locals and closures): a
  // native Event, or a React SyntheticEvent through its `nativeEvent`.
  const scopeEvents = async (callFrames) => {
    const found = [];
    for (const frame of callFrames.slice(0, MAX_SCOPE_FRAMES)) {
      if (!isApp(frame.location.scriptId)) continue;
      for (const scope of frame.scopeChain) {
        if (!['local', 'closure', 'block'].includes(scope.type) || !scope.object?.objectId)
          continue;
        let properties = [];
        try {
          ({ result: properties } = await cdp.send('Runtime.getProperties', {
            objectId: scope.object.objectId,
            ownProperties: true,
          }));
        } catch {
          continue;
        }
        for (const property of properties) {
          const value = property.value;
          if (!value?.objectId) continue;
          if (
            /(?:^|[a-z])Event$/u.test(value.className || '') &&
            value.className !== 'SyntheticBaseEvent'
          )
            found.push(value.objectId);
          else if (
            value.className === 'SyntheticBaseEvent' ||
            /Synthetic/u.test(value.className || '')
          ) {
            try {
              const { result } = await cdp.send('Runtime.getProperties', {
                objectId: value.objectId,
                ownProperties: true,
              });
              const native = result.find((entry) => entry.name === 'nativeEvent')?.value;
              if (native?.objectId) found.push(native.objectId);
            } catch {}
          }
        }
      }
    }
    return found;
  };

  const effectFibers = async (callFrames) => {
    const mount = callFrames.find(
      (frame) =>
        /^commitHook(?:Effect|Passive)\w*Mount/u.test(frame.functionName) ||
        frame.functionName === 'commitHookEffectListMount',
    );
    if (!mount) return [];
    const ids = [];
    for (const expression of ['finishedWork', 'finishedWork.alternate']) {
      const value = await evaluate(mount.callFrameId, expression);
      if (value?.objectId) ids.push(value.objectId);
    }
    return ids;
  };

  const causeNow = async (paused) => {
    const event = await currentEvent(paused.callFrames[0]);
    const dispatching = event ? (await sameAs(event.objectId, actionEvents))?.action_id : null;
    if (dispatching) return attribution.causeOf({ dispatching });
    let effect_of = null;
    for (const fiber of await effectFibers(paused.callFrames)) {
      effect_of = (await sameAs(fiber, receipts))?.action_id;
      if (effect_of) break;
    }
    if (effect_of) return attribution.causeOf({ effect_of });
    let in_scope = null;
    for (const held of await scopeEvents(paused.callFrames)) {
      in_scope = (await sameAs(held, actionEvents))?.action_id;
      if (in_scope) break;
    }
    if (in_scope) return attribution.causeOf({ in_scope });
    const raw = await stackOf(paused);
    return attribution.causeOf({
      stack: await positions(raw),
      started_in: appFunctions(raw)[0] || null,
    });
  };

  const functionSource = async (objectId) => {
    try {
      const { internalProperties = [], result = [] } = await cdp.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
      });
      const location = internalProperties.find((entry) => entry.name === '[[FunctionLocation]]')
        ?.value?.value;
      const name = result.find((entry) => entry.name === 'name')?.value?.value || null;
      const where = location
        ? source(location.scriptId, location.lineNumber, location.columnNumber)
        : null;
      const ranges = location ? await rangesOf(location.scriptId) : null;
      const range = ranges?.rangeAt(location.lineNumber, location.columnNumber);
      return {
        name,
        file: where?.file ?? null,
        line: where?.line ?? null,
        ...(range ? { range: { script_id: location.scriptId, ...range } } : {}),
      };
    } catch {
      return null;
    }
  };

  const onEvent = async (paused) => {
    const event = await currentEvent(paused.callFrames[0], OBJECT_GROUP);
    if (!event) return;
    // One pause per listener the event reaches: the first one records it.
    if (await sameAs(event.objectId, actionEvents)) return;
    const type = paused.data?.eventName?.replace(/^listener:/u, '') || null;
    const described = await cdp
      .send('Runtime.callFunctionOn', {
        objectId: event.objectId,
        functionDeclaration: DESCRIBE_EVENT,
        arguments: [{ value: REACT_PROP[type] || 'onClick' }],
        silent: true,
        objectGroup: PAUSE_GROUP,
      })
      .catch(() => null);
    const objectId = described?.result?.objectId;
    if (!objectId) return;
    const { result: fields = [] } = await cdp.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
    });
    const info = fields.find((entry) => entry.name === 'info')?.value;
    const infoValue = info?.objectId
      ? (
          await cdp.send('Runtime.callFunctionOn', {
            objectId: info.objectId,
            functionDeclaration: 'function () { return this; }',
            returnByValue: true,
          })
        ).result.value
      : null;
    if (!infoValue?.trusted) {
      cdp.send('Runtime.releaseObject', { objectId: event.objectId }).catch(() => {});
      return;
    }
    const handlers = [];
    const list = fields.find((entry) => entry.name === 'handlers')?.value;
    if (list?.objectId) {
      const { result: items = [] } = await cdp.send('Runtime.getProperties', {
        objectId: list.objectId,
        ownProperties: true,
      });
      for (const item of items)
        if (/^\d+$/u.test(item.name) && item.value?.objectId) {
          const where = await functionSource(item.value.objectId);
          if (where) handlers.push(where);
        }
    }
    const action = attribution.noteAction({
      event: infoValue.type,
      target: infoValue.target,
      handlers,
    });
    keep(actionEvents, { action_id: action.action_id, objectId: event.objectId }, KEEP_ACTIONS);
    emit({
      kind: 'observe.action',
      action_id: action.action_id,
      event: action.event,
      target: action.target,
      handlers: handlers.map(({ range, ...handler }) => handler),
    });
  };

  // Paused just before fetch() / xhr.send() runs, inside a user dispatch. The
  // row is written when the network event names the URL.
  const onSendPause = async (paused) => {
    const top = paused.callFrames[0].location;
    // A send that never reached the network (it threw first) leaves its entry behind; keep the list short.
    if (pendingPauses.length >= 50) pendingPauses.shift();
    pendingPauses.push({
      cause: await causeNow(paused),
      raw: await stackOf(paused),
      at: `${top.scriptId}:${top.lineNumber}:${top.columnNumber}`,
    });
  };
  const onRequestSent = async (event) => {
    if (!['Fetch', 'XHR'].includes(event.type) || event.initiator?.type !== 'script') return;
    const stack = event.initiator.stack;
    const top = stack?.callFrames?.[0];
    const at = top ? `${top.scriptId}:${top.lineNumber}:${top.columnNumber}` : null;
    const index = at ? pendingPauses.findIndex((entry) => entry.at === at) : -1;
    let cause, raw;
    if (index >= 0) ({ cause, raw } = pendingPauses.splice(index, 1)[0]);
    else {
      // Sent outside a user dispatch: the network event's stack is all there is.
      stats.requests_read_without_pause += 1;
      raw = await withParents(
        stack?.callFrames || [],
        stack?.parent || (stack?.parentId ? { parentId: stack.parentId, callFrames: [] } : null),
      );
      cause = attribution.causeOf({
        stack: await positions(raw),
        started_in: appFunctions(raw)[0] || null,
      });
    }
    const functions = appFunctions(raw);
    emit({
      kind: 'observe.request',
      url: event.request.url,
      method: event.request.method,
      ...cause,
      handler: functions[0] || null,
      api_function: functions.at(-1) || null,
      call_site: raw[0] ? frameOf(raw[0]) : null,
    });
  };

  const onSetState = async (paused) => {
    const cause = await causeNow(paused);
    if (!cause.action_id) return;
    for (const expression of ['fiber', 'fiber.alternate']) {
      const fiber = await evaluate(paused.callFrames[0].callFrameId, expression, OBJECT_GROUP);
      if (fiber?.objectId)
        keep(receipts, { action_id: cause.action_id, objectId: fiber.objectId }, KEEP_RECEIPTS);
    }
  };

  // React's setState entry, found by name in the development build of react-dom.
  const watchSetState = async (scriptId, url) => {
    if (setStateBreakpoint || !/react-dom/u.test(url)) return;
    try {
      const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId });
      const line = scriptSource
        .split('\n')
        .findIndex((text) =>
          /function dispatchSetState(?:Internal)?\(fiber, queue, action/u.test(text),
        );
      if (line < 0) return;
      setStateBreakpoint = (
        await cdp.send('Debugger.setBreakpoint', {
          location: { scriptId, lineNumber: line + 1 },
          condition: IN_USER_DISPATCH,
        })
      ).breakpointId;
    } catch (error) {
      failed(error);
    }
  };

  const onScript = (event) => {
    // Scripts of isolated worlds (extensions, a test driver's own helpers) are not the page's.
    const isolated =
      event.executionContextAuxData?.isDefault === false ||
      event.executionContextAuxData?.type === 'isolated';
    scripts.set(event.scriptId, { url: event.url, sourceMapURL: event.sourceMapURL, isolated });
    if (/react-dom/u.test(event.url)) watchSetState(event.scriptId, event.url);
  };
  // fetch and XMLHttpRequest#send are new objects in each document, so their
  // breakpoints are set again in each page context.
  const onContext = async ({ context }) => {
    if (context.auxData?.isDefault === false || context.auxData?.type === 'isolated') return;
    for (const expression of [
      'globalThis.fetch',
      'globalThis.XMLHttpRequest && XMLHttpRequest.prototype.send',
    ]) {
      try {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression,
          contextId: context.id,
          silent: true,
        });
        if (result.objectId)
          sendBreakpoints.add(
            (
              await cdp.send('Debugger.setBreakpointOnFunctionCall', {
                objectId: result.objectId,
                condition: IN_USER_DISPATCH,
              })
            ).breakpointId,
          );
      } catch (error) {
        // A context can be reported twice (Runtime.enable lists the ones already open).
        if (!/already exists/u.test(error?.message || '')) failed(error);
      }
    }
  };
  const onPaused = async (paused) => {
    const started = Date.now();
    stats.pauses += 1;
    try {
      if (scripts.get(paused.callFrames[0]?.location.scriptId)?.isolated) return;
      if (paused.reason === 'EventListener') await onEvent(paused);
      else if (paused.hitBreakpoints?.some((id) => sendBreakpoints.has(id)))
        await onSendPause(paused);
      else if (setStateBreakpoint && paused.hitBreakpoints?.includes(setStateBreakpoint))
        await onSetState(paused);
    } catch (error) {
      failed(error);
    } finally {
      stats.paused_ms += Date.now() - started;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: PAUSE_GROUP }).catch(() => {});
      await cdp.send('Debugger.resume').catch(() => {});
    }
  };
  const handlers = {
    'Debugger.scriptParsed': onScript,
    'Debugger.paused': serial(onPaused),
    'Network.requestWillBeSent': serial(onRequestSent),
    'Runtime.executionContextCreated': onContext,
  };
  for (const [name, handler] of Object.entries(handlers)) cdp.on(name, handler);
  await cdp.send('Network.enable');
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: ASYNC_DEPTH });
  await cdp.send('Runtime.enable');
  for (const eventName of USER_EVENTS)
    await cdp.send('DOMDebugger.setEventListenerBreakpoint', { eventName });

  return {
    records: () => rows.slice(),
    stats: () => ({ ...stats, actions: attribution.actions.length }),
    async stop() {
      for (const [name, handler] of Object.entries(handlers)) cdp.off?.(name, handler);
      await queue;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => {});
      await cdp.send('Debugger.disable').catch(() => {});
    },
  };
}
