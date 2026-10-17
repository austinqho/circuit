/**
 * Observe mode: what the user did and what each action caused, read through
 * Chrome's DevTools Protocol. Nothing in the app is rewritten, wrapped or
 * replaced, and the page never pauses (Chrome drops input that arrives while a
 * page is paused, ADR 0006).
 *
 *   const observer = await observePage(cdpSession, { appOrigin });
 *   ... drive the page ...
 *   observer.records(); // observe.action / observe.request rows
 *   await observer.stop();
 *
 * `cdpSession` is a DevTools Protocol session for the page (Playwright's
 * `context.newCDPSession(page)` or any { send, on, off }).
 *
 * What it adds to the page: one listener per user event type on `window`, at
 * the start and at the end of each dispatch, in an isolated world the app's
 * scripts cannot see. Each reports the event's type and number through a
 * binding, in the same ordered stream as the network events. Requests are read
 * from Network.requestWillBeSent and its initiator stack (async parents
 * included). After an event, the observer reads the target's description and
 * the React handlers declared for it (`__reactProps$…`) from the page.
 * Joins follow attribution.mjs: identifiers only, unknown when the browser
 * gives none.
 */
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { createAttribution } from './attribution.mjs';
import { functionRanges } from './function-ranges.mjs';

const WORLD = 'producttrace-observe';
const BINDING = '__producttraceObserve';
// The user events whose dispatch is watched from start to end: a request sent
// inside one joins it. Only the types a person reads as an action are written
// as rows of their own (`shown`); the rest appear when a request joins one.
const WINDOWED = [
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'submit',
  'input',
  'change',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'paste',
  'cut',
  'copy',
  'drop',
  'dragstart',
  'dragend',
];
// The React props React calls for each native event (react-dom's event
// plugins), so every event that could run a handler is counted as a run of
// it: hover, focus, scroll, media events and events the app dispatches itself
// included. A handler credited by `only_run_of_handler` must have run for
// exactly one of them.
const REACT_PROPS = {};
const addProps = (types, prop) => {
  for (const type of types.split(' ')) (REACT_PROPS[type] ??= []).push(prop);
};
for (const name of 'abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll scrollEnd toggle touchMove waiting wheel'.split(
  ' ',
))
  addProps(name.toLowerCase(), `on${name[0].toUpperCase()}${name.slice(1)}`);
for (const [type, prop] of [
  ['animationend', 'onAnimationEnd'],
  ['animationiteration', 'onAnimationIteration'],
  ['animationstart', 'onAnimationStart'],
  ['dblclick', 'onDoubleClick'],
  ['focusin', 'onFocus'],
  ['focusout', 'onBlur'],
  ['transitionrun', 'onTransitionRun'],
  ['transitionstart', 'onTransitionStart'],
  ['transitioncancel', 'onTransitionCancel'],
  ['transitionend', 'onTransitionEnd'],
  ['mouseout mouseover', 'onMouseEnter'],
  ['mouseout mouseover', 'onMouseLeave'],
  ['pointerout pointerover', 'onPointerEnter'],
  ['pointerout pointerover', 'onPointerLeave'],
  ['change click focusin focusout input keydown keyup selectionchange', 'onChange'],
  [
    'focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange',
    'onSelect',
  ],
  ['compositionend keypress textInput paste', 'onBeforeInput'],
  ['compositionend focusout keydown keypress keyup mousedown', 'onCompositionEnd'],
  ['compositionstart focusout keydown keypress keyup mousedown', 'onCompositionStart'],
  ['compositionupdate focusout keydown keypress keyup mousedown', 'onCompositionUpdate'],
])
  addProps(type, prop);
const EVENTS = [...new Set([...WINDOWED, ...Object.keys(REACT_PROPS)])];
// The handler a person reads for an action row: the event's own prop.
const ROW_PROPS = {
  click: ['onClick'],
  dblclick: ['onDoubleClick'],
  auxclick: ['onAuxClick'],
  contextmenu: ['onContextMenu'],
  submit: ['onSubmit'],
  input: ['onChange', 'onInput'],
  change: ['onChange'],
  keydown: ['onKeyDown'],
  keyup: ['onKeyUp'],
  paste: ['onPaste'],
  drop: ['onDrop'],
};
const shown = (info) =>
  ['click', 'dblclick', 'contextmenu', 'submit', 'input', 'paste', 'drop'].includes(info.type) ||
  (info.type === 'change' && /^(select|checkbox|radio|file)$/u.test(info.control || '')) ||
  // A key press that types a character is shown by its input event.
  (info.type === 'keydown' &&
    (info.key?.length > 1 || info.ctrl || info.meta || info.alt) &&
    !/^(Shift|Control|Alt|Meta|CapsLock)$/u.test(info.key || ''));
const ASYNC_DEPTH = 32;
const KEEP_TARGETS = 2000;
const KEEP_DESCRIBED = 2000;
const END_WAIT_MS = 2000;

// Runs in the isolated world, at document start, before the app's scripts.
// Every event of a type React handles is reported: a trusted user event of a
// WINDOWED type as the start and end of its dispatch, any other as one run.
const LISTENER = `(() => {
  if (globalThis.__producttraceTargets) return;
  const send = globalThis[${JSON.stringify(BINDING)}];
  const targets = (globalThis.__producttraceTargets = new Map());
  const windowed = new Set(${JSON.stringify(WINDOWED)});
  const ids = new WeakMap();
  let next = 0;
  let nextId = 0;
  // A node already detached when the event fired is outside React's tree:
  // React calls nothing there, so it is not kept.
  // The document itself is not part of React's tree either.
  const node = (value) => (value && value.nodeType === 1 && value.isConnected ? value : value && value.nodeType === 3 && value.isConnected ? value.parentNode : null);
  const idOf = (value) => {
    if (!value) return 0;
    if (!ids.has(value)) ids.set(value, ++nextId);
    return ids.get(value);
  };
  for (const type of ${JSON.stringify(EVENTS)}) {
    addEventListener(type, (event) => {
      const n = ++next;
      const nodes = [node(event.target), node(event.relatedTarget)];
      targets.set(n, nodes);
      if (targets.size > ${KEEP_TARGETS}) targets.delete(targets.keys().next().value);
      if (!event.isTrusted || !windowed.has(type)) {
        send(JSON.stringify({ phase: 'run', n, type, trusted: event.isTrusted, at: idOf(nodes[0]) + ':' + idOf(nodes[1]) }));
        return;
      }
      const control = event.target && event.target.closest ? event.target.closest('select') ? 'select' : event.target.type || null : null;
      send(JSON.stringify({ phase: 'start', n, type, key: event.key || null, ctrl: !!event.ctrlKey, meta: !!event.metaKey, alt: !!event.altKey, control }));
      // The end: a listener added now runs last in window's bubble phase,
      // after the app's own listeners there. Where the app stops propagation,
      // the dispatch ends after the rest of that node's listeners, so one
      // added now on every node ahead runs last there and sees the stop.
      // Only when neither runs (stopImmediatePropagation, or a stop in
      // window's capture phase) is the end the next task, reported late.
      let done = false;
      const stops = [];
      const end = (late) => (seen) => {
        if (done || (seen && seen !== event)) return;
        done = true;
        removeEventListener(type, last);
        for (const [at, capture] of stops) at.removeEventListener(type, stopped, capture);
        send(JSON.stringify({ phase: 'end', n, ...(late ? { late: true } : {}) }));
      };
      const last = end(false);
      const stopped = (seen) => { if (seen === event && event.cancelBubble) last(seen); };
      addEventListener(type, last);
      for (const at of event.composedPath()) {
        if (at === window) continue;
        for (const capture of [true, false]) { at.addEventListener(type, stopped, capture); stops.push([at, capture]); }
      }
      setTimeout(end(true));
    }, true);
  }
})();`;

// Runs in the page through Runtime.callFunctionOn with \`this\` = the target.
// Reads only: the target's description and the React handlers declared for
// this event on the target and its ancestors.
const DESCRIBE_TARGET = `function (props) {
  const target = this.nodeType === 1 ? this : this.parentElement;
  const text = node => (node && (node.getAttribute('aria-label') || node.innerText || node.value || '') || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  const control = target && target.closest ? target.closest('button,a,input,select,textarea,[role],label,summary') || target : target;
  const handlers = [];
  const names = [];
  const collect = (values) => {
    for (const prop of props) {
      for (const name of [prop, prop + 'Capture']) {
        const fn = values && values[name];
        if (typeof fn === 'function' && !handlers.includes(fn)) { handlers.push(fn); names.push(prop); }
      }
    }
  };
  const propsOf = node => { const key = node && Object.keys(node).find(name => name.startsWith('__reactProps$')); return key ? node[key] : null; };
  // React bubbles along its own tree (a portal's events reach the component
  // that rendered it), so walk the fibers as React does; the DOM when there are none.
  let start = target;
  while (start && !Object.keys(start).some(name => name.startsWith('__reactFiber$'))) start = start.parentNode;
  const fiberKey = start && Object.keys(start).find(name => name.startsWith('__reactFiber$'));
  if (fiberKey) {
    for (let fiber = start[fiberKey]; fiber; fiber = fiber.return)
      if (fiber.stateNode && fiber.stateNode.nodeType === 1) collect(propsOf(fiber.stateNode));
  } else {
    for (let node = target; node; node = node.parentNode) collect(propsOf(node));
  }
  return { connected: this.isConnected, names, info: control && control.tagName ? { tag: control.tagName.toLowerCase(), role: control.getAttribute('role') || null, name: text(control) || null,
      label: control.labels && control.labels[0] ? text(control.labels[0]) : null, input_type: control.type || null } : null, handlers };
}`;

export async function observePage(cdp, { appOrigin = null } = {}) {
  const scripts = new Map(); // scriptId -> { url, sourceMapURL, map, ranges }
  const contexts = new Map(); // executionContextId -> { world: 'main' | 'observe', frameId }
  const attribution = createAttribution();
  const rows = [];
  const dispatches = new Map(); // n (per document) -> action
  let groups = 0;
  const described = new Map(); // context:type:nodes -> the run that read their handlers
  const stats = { pauses: 0, dispatches: 0, runs: 0, requests: 0, errors: 0, unread: {} };
  let sequence = 0;
  let queue = Promise.resolve();
  const failed = (error) => {
    stats.errors += 1;
    stats.last_error = String(error?.message || error).slice(0, 200);
  };
  // Handlers run one at a time, in the order the page reported them.
  const serial = (handler) => (event) => {
    queue = queue.then(() => handler(event)).catch(failed);
  };

  const isApp = (scriptId) => {
    const url = scripts.get(scriptId)?.url || '';
    if (
      !url ||
      /\/node_modules\/|\/\.vite\/deps\/|\/@vite\/|\/@react-refresh|\/@id\/|\/_next\/static\/chunks\/(?:framework|main|webpack|polyfills)/u.test(
        url,
      )
    )
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
      const match = (script.sourceMapURL || '').match(
        /^data:application\/json[^,]*?(;base64)?,(.*)$/u,
      );
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
    const where = source(frame.scriptId, frame.lineNumber, frame.columnNumber);
    return {
      name: frame.functionName || null,
      file: where?.file ?? null,
      line: where?.line ?? null,
      app: isApp(frame.scriptId),
    };
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
  // Every frame of a stack trace, innermost first, then each async parent;
  // `segment` numbers the synchronous stretch each frame belongs to.
  const framesOf = async (trace) => {
    const raw = [];
    let guard = 0;
    while (trace && guard++ < ASYNC_DEPTH) {
      // `link` is how this stretch leads to the one before it ('await', 'setTimeout', ...).
      raw.push(
        ...(trace.callFrames || []).map((frame) => ({
          ...frame,
          segment: guard,
          link: guard > 1 ? trace.description || null : null,
        })),
      );
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
    return { raw, truncated: Boolean(trace) };
  };
  const positions = async (raw) => {
    const out = [];
    for (const frame of raw) {
      const ranges = await rangesOf(frame.scriptId);
      if (ranges)
        out.push({
          script_id: frame.scriptId,
          offset: ranges.offset(frame.lineNumber, frame.columnNumber),
          name: frame.functionName || null,
          app: isApp(frame.scriptId),
          segment: frame.segment,
          link: frame.link,
        });
      else
        out.push({
          script_id: frame.scriptId,
          offset: -1,
          name: frame.functionName || null,
          app: isApp(frame.scriptId),
          segment: frame.segment,
          link: frame.link,
        });
    }
    return out;
  };
  const appFunctions = (raw) =>
    raw
      .map(frameOf)
      .filter((frame) => frame.app)
      .reverse();

  const emit = (row) => {
    rows.push({ schema: 'producttrace.observe.v1', ...row });
  };
  const emitAction = (action) => {
    if (action.emitted) return;
    action.emitted = true;
    emit({
      sequence: action.row_sequence,
      kind: 'observe.action',
      action_id: action.action_id,
      event: action.event,
      ...(action.key ? { key: action.key } : {}),
      target: action.target,
      handlers: action.handlers
        .filter(
          (handler) => !ROW_PROPS[action.event] || ROW_PROPS[action.event].includes(handler.prop),
        )
        .map(({ range, prop, ...handler }) => handler),
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
  // The event's target and declared handlers, read after the dispatch from the
  // node the isolated listener kept: found there, then resolved in the page's world.
  // The event's target and the React handlers React would call for it, read
  // after the dispatch from the node the isolated listener kept, resolved in
  // the page's world. `described` is false when they could not be read (the
  // node was gone or detached): that event may have run any handler.
  const describe = async (action, n, observeContext, { info = true, related = false } = {}) => {
    const group = `producttrace-observe-${++groups}`;
    action.described = false;
    const unread = (why) => {
      stats.unread[`${action.event}: ${why}`] = (stats.unread[`${action.event}: ${why}`] ?? 0) + 1;
    };
    for (let attempt = 0; ; attempt += 1)
      try {
        await readOnce();
        return;
      } catch (error) {
        // The page moved on between two calls (a new document, a re-render): once more.
        if (attempt < 1) continue;
        unread('error');
        failed(error);
        return;
      } finally {
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => {});
      }
    async function readOnce() {
      // The page's own world in the same frame, created last (the current document).
      const mainContext = [...contexts]
        .filter(
          ([, c]) => c.world === 'main' && c.frameId === contexts.get(observeContext)?.frameId,
        )
        .at(-1)?.[0];
      if (!mainContext) return unread('no page context');
      for (const index of related ? [0, 1] : [0]) {
        const { result: node } = await cdp.send('Runtime.evaluate', {
          expression: `(globalThis.__producttraceTargets.get(${n}) || [])[${index}]`,
          contextId: observeContext,
          objectGroup: group,
          silent: true,
        });
        // Kept no longer: unknown. Not a node (window): React declares nothing there.
        if (node?.type === 'undefined') return unread('node no longer kept');
        if (!node?.objectId) continue;
        const { node: found } = await cdp.send('DOM.describeNode', { objectId: node.objectId });
        await cdp.send('DOM.getDocument', { depth: 0 }).catch(() => {});
        const { object } = await cdp.send('DOM.resolveNode', {
          backendNodeId: found.backendNodeId,
          executionContextId: mainContext,
          objectGroup: group,
        });
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: DESCRIBE_TARGET,
          arguments: [{ value: REACT_PROPS[action.event] || [] }],
          silent: true,
          objectGroup: group,
        });
        const { result: fields = [] } = await cdp.send('Runtime.getProperties', {
          objectId: result.objectId,
          ownProperties: true,
        });
        const value = async (name) => {
          const field = fields.find((entry) => entry.name === name)?.value;
          if (!field?.objectId) return field?.value;
          return (
            await cdp.send('Runtime.callFunctionOn', {
              objectId: field.objectId,
              functionDeclaration: 'function () { return this; }',
              returnByValue: true,
            })
          ).result.value;
        };
        // A node React removed has lost its props: what ran there is unknown.
        if (!(await value('connected'))) return unread(`removed ${index ? 'related ' : ''}node`);
        if (info && index === 0) action.target = (await value('info')) ?? null;
        const names = (await value('names')) || [];
        const list = fields.find((entry) => entry.name === 'handlers')?.value;
        if (list?.objectId) {
          const { result: items = [] } = await cdp.send('Runtime.getProperties', {
            objectId: list.objectId,
            ownProperties: true,
          });
          for (const item of items)
            if (/^\d+$/u.test(item.name) && item.value?.objectId) {
              const where = await functionSource(item.value.objectId);
              if (where) action.handlers.push({ ...where, prop: names[Number(item.name)] ?? null });
            }
        }
      }
      action.described = true;
    }
  };

  // Each event's handlers are read at once, side by side, while its nodes
  // still hold them; a request waits for the ones read before it was sent.
  const reading = new Set();
  const read = (promise) => {
    const done = promise.catch(failed).finally(() => reading.delete(done));
    reading.add(done);
  };

  // Dispatch starts and ends, in order. The start opens the action at once;
  // its target and handlers are read afterwards, in the queue, before any
  // later request is joined.
  const onBinding = (event) => {
    if (event.name !== BINDING) return;
    let message;
    try {
      message = JSON.parse(event.payload);
    } catch {
      return;
    }
    const key = `${event.executionContextId}:${message.n}`;
    if (message.phase === 'run') {
      // Not a user action of its own, but it may have run a handler. The same
      // event on the same nodes runs the same handlers: read them once, count each run.
      stats.runs += 1;
      const same = `${event.executionContextId}:${message.type}:${message.at}`;
      const seen = described.get(same);
      if (seen) {
        seen.times += 1;
        return;
      }
      const run = attribution.noteRun({ event: message.type, trusted: message.trusted });
      run.row_sequence = ++sequence;
      read(
        describe(run, message.n, event.executionContextId, {
          info: message.trusted,
          related: /^(mouse|pointer)(over|out)$/u.test(message.type),
        }).then(() => {
          if (!run.described) return;
          described.set(same, run);
          if (described.size > KEEP_DESCRIBED) described.delete(described.keys().next().value);
        }),
      );
      return;
    }
    if (message.phase === 'start') {
      stats.dispatches += 1;
      const action = attribution.startDispatch({ event: message.type });
      action.row_sequence = ++sequence;
      if (message.type === 'keydown' || message.type === 'keyup')
        action.key = [
          message.ctrl && 'Control',
          message.meta && 'Meta',
          message.alt && 'Alt',
          message.key,
        ]
          .filter(Boolean)
          .join('+');
      dispatches.set(key, action);
      let ended;
      action.ended = new Promise((resolve) => (ended = resolve));
      action.end = ended;
      read(
        describe(action, message.n, event.executionContextId).then(() => {
          if (shown({ ...message })) emitAction(action);
        }),
      );
    } else if (message.phase === 'end') {
      const action = dispatches.get(key);
      if (action) {
        attribution.endDispatch(action.action_id, { late: Boolean(message.late) });
        dispatches.delete(key);
        action.end();
      }
    }
  };

  // A dispatch whose end never arrives (the page left mid-event) counts as late.
  const dispatchEnd = (action) =>
    Promise.race([
      action.ended,
      new Promise((resolve) => setTimeout(resolve, END_WAIT_MS).unref?.()),
    ]).then(() => {
      if (!action.done) attribution.endDispatch(action.action_id, { late: true });
    });

  const onRequestSent = (event) => {
    if (!['Fetch', 'XHR'].includes(event.type) || event.initiator?.type !== 'script') return;
    // Joined to the dispatch running now; read at once, before anything else arrives.
    const inDispatch = attribution.running();
    const sentAfter = attribution.actions.length;
    const rowSequence = ++sequence;
    // Only the events before it could have caused it: wait for their handlers.
    const before = [...reading];
    queue = queue
      .then(async () => {
        stats.requests += 1;
        await Promise.all(before);
        // Whether the dispatch ended where it should is known only once it has.
        if (inDispatch) await dispatchEnd(attribution.get(inDispatch));
        const { raw, truncated } = await framesOf(event.initiator.stack);
        const functions = appFunctions(raw);
        const cause = attribution.causeOf({
          in_dispatch: inDispatch,
          before: sentAfter,
          stack: await positions(raw),
          truncated,
          started_in: functions[0] || null,
        });
        if (cause.action_id) emitAction(attribution.get(cause.action_id));
        for (const id of cause.could_be || []) emitAction(attribution.get(id));
        emit({
          sequence: rowSequence,
          kind: 'observe.request',
          url: event.request.url,
          method: event.request.method,
          ...cause,
          handler: functions[0] || null,
          api_function: functions.at(-1) || null,
          call_site: raw[0] ? frameOf(raw[0]) : null,
        });
      })
      .catch(failed);
  };

  const onScript = (event) =>
    scripts.set(event.scriptId, { url: event.url, sourceMapURL: event.sourceMapURL });
  const onContext = ({ context }) =>
    contexts.set(context.id, {
      world: context.name === WORLD ? 'observe' : context.auxData?.isDefault ? 'main' : 'other',
      frameId: context.auxData?.frameId,
    });
  const onContextGone = ({ executionContextId }) => contexts.delete(executionContextId);
  const onContextsCleared = () => contexts.clear();
  // Never expected: every pause is skipped. Counted so a report can prove it.
  const onPaused = () => {
    stats.pauses += 1;
    cdp.send('Debugger.resume').catch(() => {});
  };

  const handlers = {
    'Runtime.bindingCalled': onBinding,
    'Network.requestWillBeSent': onRequestSent,
    'Debugger.scriptParsed': onScript,
    'Runtime.executionContextCreated': onContext,
    'Runtime.executionContextDestroyed': onContextGone,
    'Runtime.executionContextsCleared': onContextsCleared,
    'Debugger.paused': onPaused,
  };
  for (const [name, handler] of Object.entries(handlers)) cdp.on(name, handler);
  await cdp.send('Debugger.enable');
  // No breakpoint, `debugger` statement or exception ever stops the page.
  await cdp.send('Debugger.setSkipAllPauses', { skip: true });
  await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: ASYNC_DEPTH });
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  // DOM.resolveNode works on nodes of a document the DOM agent has seen.
  await cdp.send('DOM.getDocument', { depth: 0 }).catch(() => {});
  await cdp.send('Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: LISTENER,
    worldName: WORLD,
    runImmediately: true,
  });

  return {
    records: () => rows.slice().sort((a, b) => a.sequence - b.sequence),
    stats: () => ({
      ...stats,
      actions: rows.filter((row) => row.kind === 'observe.action').length,
    }),
    async stop() {
      for (const [name, handler] of Object.entries(handlers)) cdp.off?.(name, handler);
      await queue;
      await Promise.all([...reading]);
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
      await cdp.send('Runtime.removeBinding', { name: BINDING }).catch(() => {});
      await cdp.send('Debugger.disable').catch(() => {});
    },
  };
}
