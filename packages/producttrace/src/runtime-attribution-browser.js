/* Identity-only browser runtime for build-time runtime-attribution transforms. */
(function installProductTraceRuntimeAttribution(global) {
  if (global.__productTraceRuntime) return;
  const records = [], objectIds = new WeakMap(), registeredFunctions = new WeakMap(), tracedFunctionProxies = new WeakMap(), functionManifest = new Map(); let nextObject = 0, sequence = 0, actionSequence = 0, requestSequence = 0, continuationSequence = 0, gestureSequence = 0;
  const hostSetTimeout = global.setTimeout?.bind(global);
  // Native references for body capture (network.body rows), taken before this
  // runtime wraps Promise.prototype.then and EventTarget.prototype.addEventListener:
  // reading a body must never create a continuation or an owned listener.
  const bodyThen = Promise.prototype.then, bodyListen = global.EventTarget?.prototype?.addEventListener, nativeUnlisten = global.EventTarget?.prototype?.removeEventListener;
  // Coverage (capture.page / capture.summary): what this page's runtime
  // emitted, so a store can prove from its rows alone that nothing was lost.
  const RUNTIME_VERSION = '0.1.0+coverage.2';
  const emittedByKind = Object.create(null), reactVersions = new Set(), captureLimitFeatures = []; let hostErrors = 0, lastSummarySequence = null;
  const functionWindowCounts = new Map(); let lastActionWindow = null;
  // Origin of the task running now when it was armed outside every action (see wrapOwnedCallback).
  let unownedTask = null;
  // Realms this runtime cannot observe (child frames, a controlling service
  // worker): checked at install, load, every action and request and every
  // capture.summary; assigned with the coverage rows below.
  let checkRealms = () => {};
  // Frames inserted anywhere (the document and every shadow root) are recorded when inserted (see realmObserver).
  let observeRealmRoot = () => {};
  // Response origin (additive, never an owner): the fetch promise the runtime
  // handed back, and every promise derived from it by then/catch/finally, map
  // to that request's request_occurrence_id; a reaction on one of them, an
  // await on one, or a load-type listener on the XHR, runs on a continuation
  // whose `response_of` names the request (creation-time, like ownership).
  const responsePromises = new WeakMap(), xhrOccurrences = new WeakMap(); let responseContext = null;
  const stampStats = { commits: 0, hosts_checked: 0, stamped_nodes: 0, stamp_rows: 0, unplaced_nodes: 0, invalid_keys: 0, annotation_written: 0, annotation_rejected: 0, errors: 0, state_receipts_recorded: 0, state_receipts_applied: 0, state_receipts_refused: 0, state_receipts_consumed: 0, mount_effects_applied: 0, await_resumptions: 0, unreceipted_effects: 0, owned_listeners: 0, owned_messages: 0, task_ambient_cleared: 0, worker_posts_unowned: 0, shadow_listeners_bound: 0, shadow_stamped_nodes: 0, owned_listeners_dispatch_won: 0, owned_listeners_dispatcher: 0, owned_listeners_ui_unowned: 0 };
  const resolveFunctionId = value => typeof value === 'number' ? (functionManifest.get(value) || `function-index:${value}`) : value;
  const registerFunction = (fn, index) => { if (typeof fn === 'function' && Number.isInteger(index)) registeredFunctions.set(fn, resolveFunctionId(index)); return fn; };
  const tag = (fn, index, proxyEntry = false, entryHint = proxyEntry, name = null) => {
    if (name && typeof fn === 'function' && !fn.name) try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch {}
    registerFunction(fn, index);
    if (!proxyEntry || typeof fn !== 'function' || typeof Proxy !== 'function') return fn;
    let proxy = tracedFunctionProxies.get(fn);
    if (!proxy) {
      proxy = new Proxy(fn, {
        apply(target, receiver, args) { const frame = enter(index, args.length ? { entry_hint: entryHint, via_proxy: true, a0: args[0] } : { entry_hint: entryHint, via_proxy: true }); try { return Reflect.apply(target, receiver, args); } finally { exit(frame); } },
        construct(target, args, newTarget) { const frame = enter(index, { entry_hint: entryHint, via_proxy: true }); try { return Reflect.construct(target, args, newTarget); } finally { exit(frame); } },
      });
      tracedFunctionProxies.set(fn, proxy); registerFunction(proxy, index);
    }
    return proxy;
  };
  const functionIdOf = fn => typeof fn === 'function' ? (registeredFunctions.get(fn) || null) : null;
  const renderFunctionIds = new Set(), effectFunctionIds = new Set(), reactRenderers = new Map();
  const rememberFunction = (ids, value) => { if (typeof value !== 'function') return; const id = functionIdOf(value); if (id) ids.add(id); };
  // Element stamps (G3) share this committed-tree walk. They are lookup keys
  // for external agents and are never read by attribution.
  let stampFiber = null, finishStampCommit = null;
  // ---- G1 action context: creation-time ownership, strict frame stack -------
  // An action frame is any frame carrying an action_id: the dom.action dispatch
  // frame itself (bare: no first-party function open yet), a first-party
  // function frame, or a continuation created from either. Ownership is
  // decided when a continuation is CREATED: a promise reaction, a rewritten
  // await, queueMicrotask, setTimeout/setInterval, requestAnimationFrame, a
  // MessagePort message or an event listener captures the frame current at
  // that moment (bare or not). At run time there is no ambient fallback: the
  // callback runs under its captured owner, or under no action at all.
  // `current` is a strict stack: every frame restores exactly the frame that
  // was current before it was entered (function exit, continuation end,
  // dispatch end, await suspension).
  //
  // ---- G1 state-update receipts -------------------------------------------
  // A useState/useReducer setter called while an action frame is current
  // (including the bare dispatch frame and its continuations) records a
  // receipt for that setter's hook, with the hook's last rendered state
  // captured at that moment. Receipts are
  // resolved per (action, fiber): the latest setter call on a fiber refreshes
  // the owner. The FIRST commit after a receipt is recorded consumes it,
  // whether or not the fiber rendered, and nothing is carried to a later
  // commit. The commit's passive effects of that fiber run on a `state_effect`
  // continuation of the owner only if (a) the fiber rendered in that commit and
  // (b) a receipted hook's rendered state differs from the captured value, or
  // the setter was given a function updater. Fibers newly mounted by that
  // commit inside the fiber's subtree run their mount effects on a
  // `mount_effect` continuation. A no-op setter therefore never attributes
  // later work. Render and layout effects run before React reports the commit
  // and are not covered (explicit frontier).
  const NO_VALUE = Symbol('productTrace.noValue');
  const pendingReceipts = new Map(); // raw dispatch -> { owner, captured, functional, seq }
  const renderedDispatches = new Set(); // dispatches whose hook rendered since the last commit
  const lastRenderedState = new WeakMap(); // raw dispatch -> state its hook returned at its last render
  const seenFibers = new WeakSet(); // every fiber object seen by an earlier commit walk
  let receiptSequence = 0;
  const HOOK_HAS_EFFECT = 1, HOOK_PASSIVE = 8;
  const isComponentFiber = fiber => fiber && (fiber.tag === 0 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15);
  let applyReceiptFrame = null;
  // A frame an effect may run on without a receipt: not bare, not inside a
  // scheduler (MessagePort) lineage.
  const effectFlushFrame = frame => (frame && frame.action_id && !frame.bare && !frame.scheduler ? frame : null);
  // Any action frame (bare dispatch frame included) owns what is created
  // while it is current.
  const ownable = frame => Boolean(frame && frame.action_id);
  const applyReceipts = fiber => {
    if (!isComponentFiber(fiber)) return;
    let owner = null, ownerSequence = -1, receipted = false;
    for (let hook = fiber.memoizedState; hook && typeof hook === 'object'; hook = hook.next) {
      const dispatch = hook.queue?.dispatch;
      const receipt = typeof dispatch === 'function' ? pendingReceipts.get(dispatch) : null;
      if (!receipt) continue;
      receipted = true;
      // "Changed" is decided by the rendered state against the state captured
      // at the setter call, for value setters and function updaters alike (a
      // functional no-op such as `setOpen(o => false)` while false changes
      // nothing). Only when no state was captured does a function updater
      // count as a change.
      const changed = receipt.captured !== NO_VALUE ? !Object.is(hook.memoizedState, receipt.captured) : receipt.functional;
      if (renderedDispatches.has(dispatch) && changed && receipt.seq > ownerSequence) { owner = receipt.owner; ownerSequence = receipt.seq; }
    }
    if (!receipted) return;
    if (!owner) { stampStats.state_receipts_refused += 1; return; }
    if (wrapPassiveEffects(fiber, owner, 'state_effect')) stampStats.state_receipts_applied += 1;
    // Fibers mounted by this commit (no alternate, never seen by an earlier
    // commit walk) inside the receipted fiber's subtree are caused by the
    // receipted update. Fibers that already existed get nothing.
    const stack = fiber.child ? [fiber.child] : [];
    while (stack.length) {
      const child = stack.pop();
      if (child.alternate === null && !seenFibers.has(child) && isComponentFiber(child)
        && wrapPassiveEffects(child, owner, 'mount_effect')) stampStats.mount_effects_applied += 1;
      if (child.sibling) stack.push(child.sibling); if (child.child) stack.push(child.child);
    }
  };
  // Wrap the passive effects that run in this commit (HasEffect|Passive) so
  // they execute on a continuation of the receipt's owner frame. The wrapper
  // restores the original create on its first call, so a stored effect object
  // that React reruns later (for example on reconnect) runs unowned.
  const wrapPassiveEffects = (fiber, owner, kind) => {
    let effect = fiber.updateQueue?.lastEffect?.next || null; const first = effect; let wrapped = 0;
    if (effect) do {
      if ((effect.tag & HOOK_HAS_EFFECT) && (effect.tag & HOOK_PASSIVE) && typeof effect.create === 'function' && !effect.create.__productTraceReceipt) {
        const target = effect, create = effect.create;
        const receiptCreate = function () {
          if (target.create === receiptCreate) target.create = create;
          // Without a receipt the effect keeps the continuation React flushes
          // it on only when that continuation is a direct one of an action (a
          // discrete update's microtask flush); on a bare dispatch frame or a
          // React scheduler message (which multiplexes unrelated updates) it
          // runs under no action.
          const previous = current; current = owner ? applyReceiptFrame(owner, kind) : effectFlushFrame(settleAmbient());
          try { return create.apply(this, arguments); } finally { current = previous; }
        };
        receiptCreate.__productTraceReceipt = true;
        target.create = receiptCreate; wrapped += 1;
      }
      effect = effect.next;
    } while (effect && effect !== first);
    return wrapped;
  };
  // Hosts to stamp in this commit, in pre-order; keys are assigned once the
  // whole tree has been seen (an ordinal key needs the instance count).
  const stampCommit = { hosts: [] };
  const rememberFiberFunctions = root => {
    const stack = root?.current ? [root.current] : [];
    const stamping = typeof stampFiber === 'function' && global.__PRODUCTTRACE_STAMPS__ !== false;
    stampCommit.hosts.length = 0;
    try {
      while (stack.length) {
        const fiber = stack.pop(); if (!fiber) continue;
        rememberFunction(renderFunctionIds, fiber.type); rememberFunction(renderFunctionIds, fiber.elementType);
        rememberFunction(renderFunctionIds, fiber.type?.render); rememberFunction(renderFunctionIds, fiber.elementType?.render);
        let effect = fiber.updateQueue?.lastEffect?.next || null; const first = effect;
        if (effect) do { rememberFunction(effectFunctionIds, effect.create); rememberFunction(effectFunctionIds, effect.destroy); effect = effect.next; } while (effect && effect !== first);
        if (pendingReceipts.size) { try { applyReceipts(fiber); } catch { stampStats.errors += 1; } }
        // Every other passive effect of this commit is wrapped: it runs on the
        // continuation React flushes it on only when that is a direct
        // (non-bare, non-scheduler) continuation of an action, else unowned.
        if (isComponentFiber(fiber)) { try { stampStats.unreceipted_effects += wrapPassiveEffects(fiber, null, 'unowned_effect'); } catch { stampStats.errors += 1; } }
        if (stamping && fiber.tag === 5) { try { stampFiber(fiber); } catch { stampStats.errors += 1; } }
        seenFibers.add(fiber);
        // Pre-order (document order): sibling below child on the stack.
        if (fiber.sibling) stack.push(fiber.sibling); if (fiber.child) stack.push(fiber.child);
      }
      if (stamping && typeof finishStampCommit === 'function') { try { finishStampCommit(stampCommit.hosts, root); } catch { stampStats.errors += 1; } }
    } finally {
      // Every receipt is consumed by the first commit after it was recorded.
      stampStats.state_receipts_consumed += Math.max(0, pendingReceipts.size);
      pendingReceipts.clear(); renderedDispatches.clear();
    }
  };
  // Wrap the hook dispatcher so every useState/useReducer setter records a
  // receipt when it is invoked on an action frame. Wrappers are cached per
  // raw dispatch, so setter identity stays stable across renders.
  const setterWrappers = new WeakMap(), wrappedDispatchers = new WeakMap(), hookedDispatcherRefs = new WeakSet();
  const receiptSetter = raw => {
    if (typeof raw !== 'function') return raw;
    let wrapper = setterWrappers.get(raw);
    if (!wrapper) {
      wrapper = function productTraceSetState(update) {
        const owner = settleAmbient();
        if (ownable(owner)) {
          const prior = pendingReceipts.get(raw);
          const captured = prior ? prior.captured : (lastRenderedState.has(raw) ? lastRenderedState.get(raw) : NO_VALUE);
          pendingReceipts.set(raw, { owner, captured, functional: Boolean(prior?.functional) || typeof update === 'function', seq: ++receiptSequence });
          stampStats.state_receipts_recorded += 1;
        }
        return raw.apply(this, arguments);
      };
      setterWrappers.set(raw, wrapper);
    }
    return wrapper;
  };
  const dispatcherWrappers = new WeakSet();
  const wrapDispatcher = dispatcher => {
    // React saves and restores the current dispatcher; a restored value may
    // already be one of our wrappers and must not be wrapped again.
    if (!dispatcher || typeof dispatcher !== 'object' || dispatcherWrappers.has(dispatcher)) return dispatcher;
    let wrapped = wrappedDispatchers.get(dispatcher);
    if (!wrapped) {
      wrapped = Object.create(dispatcher);
      for (const name of ['useState', 'useReducer']) {
        if (typeof dispatcher[name] !== 'function') continue;
        const original = dispatcher[name];
        wrapped[name] = function () {
          const result = original.apply(dispatcher, arguments);
          if (!Array.isArray(result) || typeof result[1] !== 'function') return result;
          // The hook rendered: remember its state (captured by the next setter
          // call) and that it rendered before the coming commit.
          lastRenderedState.set(result[1], result[0]); renderedDispatches.add(result[1]);
          return [result[0], receiptSetter(result[1])];
        };
      }
      // Layout effects run in the commit, before React reports it, on
      // whatever continuation the commit is flushed on; they follow the same
      // rule as unreceipted passive effects.
      if (hooksDispatcher(dispatcher)) for (const name of ['useLayoutEffect', 'useInsertionEffect']) {
        if (typeof dispatcher[name] !== 'function') continue;
        const original = dispatcher[name];
        wrapped[name] = function (create, deps) {
          if (typeof create !== 'function') return original.apply(dispatcher, arguments);
          const layoutCreate = function () { const previous = current; current = effectFlushFrame(settleAmbient()); try { return create.apply(this, arguments); } finally { current = previous; } };
          const id = functionIdOf(create); if (id) registeredFunctions.set(layoutCreate, id);
          return original.call(dispatcher, layoutCreate, deps);
        };
      }
      wrappedDispatchers.set(dispatcher, wrapped); dispatcherWrappers.add(wrapped);
    }
    return wrapped;
  };
  // A hooks dispatcher is installed only while a function component renders
  // (outside render React installs ContextOnlyDispatcher, whose hooks are all
  // the same throwing function).
  const renderingRefs = [];
  const hooksDispatcher = value => Boolean(value && typeof value === 'object' && typeof value.useState === 'function' && value.useState !== value.useEffect);
  const reactRendering = () => { for (const read of renderingRefs) { try { if (hooksDispatcher(read())) return true; } catch {} } return false; };
  // Where the renderer keeps the current hooks dispatcher, from the version it
  // registered on the DevTools hook: React 16-18 `currentDispatcherRef.current`
  // (ReactCurrentDispatcher), React 19 `currentDispatcherRef.H`
  // (ReactSharedInternals). Anything else is not guessed: receipts and render
  // detection are reported unavailable (one `capture.limit` row per page and
  // one console warning) and attribution abstains from `state_effect`.
  const dispatcherKeyFor = renderer => {
    const version = String(renderer?.reconcilerVersion || renderer?.version || '');
    const major = Number.parseInt(version, 10);
    const ref = renderer?.currentDispatcherRef;
    if (!ref || typeof ref !== 'object' || !Number.isInteger(major)) return null;
    const key = major >= 19 ? 'H' : major >= 16 ? 'current' : null;
    return key && key in ref ? key : null;
  };
  const pendingLimits = []; let reportLimit = row => pendingLimits.push(row); let dispatcherLimitReported = false;
  const installDispatcherHook = renderer => {
    try { const version = String(renderer?.reconcilerVersion || renderer?.version || ''); if (version) reactVersions.add(version); } catch {}
    const ref = renderer?.currentDispatcherRef;
    if (ref && typeof ref === 'object' && hookedDispatcherRefs.has(ref)) return;
    const key = dispatcherKeyFor(renderer);
    if (!key) {
      if (!dispatcherLimitReported) {
        dispatcherLimitReported = true;
        const react_version = String(renderer?.reconcilerVersion || renderer?.version || '') || null;
        reportLimit({ kind: 'capture.limit', feature: 'state_receipts', reason: 'dispatcher not found', react_version });
        try { global.console?.warn?.(`[producttrace] state receipts unavailable: React dispatcher not found (React ${react_version || 'unknown'}); state_effect/mount_effect linkage and render detection are off`); } catch {}
      }
      return;
    }
    hookedDispatcherRefs.add(ref);
    if (global.__PRODUCTTRACE_STATE_RECEIPTS__ === false) { renderingRefs.push(() => ref[key]); return; }
    try {
      let raw = ref[key], value = wrapDispatcher(raw);
      Object.defineProperty(ref, key, { configurable: true, enumerable: true, get() { return value; }, set(next) { raw = dispatcherWrappers.has(next) ? Object.getPrototypeOf(next) : next; value = wrapDispatcher(next); } });
      renderingRefs.push(() => raw);
    } catch {}
  };
  const installReactInvocationHook = () => {
    const existing = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const observeCommit = (id, root) => { stampStats.commits += 1; rememberFiberFunctions(root); const renderer = global.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.get?.(id); if (renderer) reactRenderers.set(id, renderer); };
    if (existing) {
      const priorInject = existing.inject;
      existing.inject = function (renderer) { const id = typeof priorInject === 'function' ? priorInject.apply(this, arguments) : reactRenderers.size + 1; reactRenderers.set(id, renderer); installDispatcherHook(renderer); return id; };
      const priorCommit = existing.onCommitFiberRoot;
      existing.onCommitFiberRoot = function (id, root) { observeCommit(id, root); if (typeof priorCommit === 'function') return priorCommit.apply(this, arguments); };
      if (existing.renderers?.forEach) existing.renderers.forEach((renderer, id) => { reactRenderers.set(id, renderer); installDispatcherHook(renderer); });
      return;
    }
    const renderers = new Map(), roots = new Map(); let nextRenderer = 0;
    global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers,
      inject(renderer) { const id = ++nextRenderer; renderers.set(id, renderer); reactRenderers.set(id, renderer); installDispatcherHook(renderer); return id; },
      getFiberRoots(id) { return roots.get(id) || new Set(); }, checkDCE() {}, sub() { return () => {}; }, on() {}, off() {}, emit() {}, setStrictMode() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      onCommitFiberRoot(id, root) { if (!roots.has(id)) roots.set(id, new Set()); roots.get(id).add(root); observeCommit(id, root); } };
  };
  installReactInvocationHook();
  let current = null;
  // Liveness of a non-dispatch frame (episode-focus rule): every frame the
  // runtime makes current (a continuation when its callback runs, a function
  // frame at entry) carries the token of the synchronous run it was created
  // in. The token dies at the next microtask checkpoint, i.e. when the JS
  // stack has emptied. A frame still current after that was left behind by a
  // native suspension the await rewrite does not cover (`for await`, async
  // generators) or by an unwrapped callback: it proves nothing about what code
  // is running now. Only the focus cause reads it; ownership is unchanged.
  const rawQueueMicrotask = typeof global.queueMicrotask === 'function' ? global.queueMicrotask.bind(global) : (fn => Promise.prototype.then.call(Promise.resolve(), fn));
  let liveToken = null;
  const runToken = () => {
    if (!liveToken) {
      const token = { live: true }; liveToken = token;
      rawQueueMicrotask(() => { token.live = false; if (liveToken === token) liveToken = null; });
    }
    return liveToken;
  };
  const identity = value => {
    if (value == null) return null;
    if (typeof value === 'string') return /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{24})$/i.test(value) ? { kind: 'id', value } : { kind: 'primitive', type: 'string' };
    if (typeof value === 'object' || typeof value === 'function') { if (!objectIds.has(value)) objectIds.set(value, `object:${++nextObject}`); return { kind: 'object', handle: objectIds.get(value) }; }
    return { kind: 'primitive', type: typeof value };
  };
  const flushFunctionWindow = action_id => { const count = functionWindowCounts.get(action_id) || 0; if (!count) return null; functionWindowCounts.delete(action_id); return emit({ kind: 'function.window_count', action_id, count, debug_omitted: true }); };
  const actionTerminalOwner = new Map();
  let materializeFor = null;
  const emit = row => {
    if (row?.kind === 'dom.action' && row.page === undefined) row = { ...row, page: pagePath() };
    if (row?.kind === 'dom.action' && row.page_title === undefined) { const title = pageTitle(); if (title) row = { ...row, page_title: title }; }
    if (materializeFor && row?.action_id && row.kind !== 'dom.action') materializeFor(row.action_id);
    if (row?.kind === 'dom.mutation' && row.action_id && !row.parent_continuation_id) row = { ...row, parent_continuation_id: actionTerminalOwner.get(row.action_id)?.continuation_id || null };
    // Transports may be observed by the separately installed request bridge.
    // Preserve the effect owner selected while the DOM action was executing so
    // those neutral bridge rows remain rooted in the same continuation tree.
    if (row?.kind === 'network.request' && row.action_id && !row.terminal_owner_continuation_id) row = { ...row, terminal_owner_continuation_id: actionTerminalOwner.get(row.action_id)?.continuation_id || null };
    const functionRow = row?.kind === 'function.enter' || row?.kind === 'function.exit';
    if (functionRow && !row.action_id && !global.__PRODUCTTRACE_DEBUG_ALL_FUNCTIONS__) {
      const owner = row.action_id || current?.action_id || lastActionWindow;
      if (owner) functionWindowCounts.set(owner, (functionWindowCounts.get(owner) || 0) + 1);
      return null;
    }
    const record = { schema: 'producttrace.runtime-evidence.v1', sequence: ++sequence, timestamp: Date.now(),
    parent_continuation_id: row.parent_continuation_id ?? current?.continuation_id ?? null, ...row }; records.push(record);
    emittedByKind[record.kind] = (emittedByKind[record.kind] || 0) + 1;
    if (record.kind === 'capture.limit') captureLimitFeatures.push(String(record.feature || 'unnamed'));
    // A throwing host hook is counted (capture.summary host_errors), never silent.
    try { global.__producttraceHostCapture?.(JSON.stringify({ channel: 'runtime-attribution', row: record })); } catch { hostErrors += 1; } return record; };
  // Capture limits found before `emit` existed (a renderer injected before the
  // runtime finished installing) are emitted now; later ones directly.
  reportLimit = row => emit(row); for (const row of pendingLimits.splice(0)) emit(row);
  const portalFormRefs = new WeakMap();
  const STAMP_ATTRIBUTE = 'data-tracer-el', OAI_LABEL_ATTRIBUTE = 'oai-annotatable', OAI_METADATA_ATTRIBUTE = 'oai-annotation-metadata';
  const tracerAttributes = new Set([STAMP_ATTRIBUTE, OAI_LABEL_ATTRIBUTE, OAI_METADATA_ATTRIBUTE]);
  let noteStampedAction = null, stampFieldsFor = null;
  // DECLARED handlers of a dispatched event's target (dom.action
  // `bound_handlers`, basis "declared"): every first-party function held by an
  // on* prop of any fiber on the target's fiber chain, the first-party
  // functions written inside those props at each placement (build-time), and
  // first-party listeners added with addEventListener for this event type on
  // the target or a DOM ancestor. Declared, not observed: no prop name is
  // mapped to an event type (a checkbox's onChange runs on `click`, React
  // decides), so this list says what COULD run. What DID run for this
  // dispatch is observed at function entry (`handler.binding`, see
  // observeBinding); the credit and the abstention read only that.
  let boundHandlersFor = null, reactFiberKeyOf = null;
  // element -> event type -> listener functions, for addEventListener on DOM
  // elements only; the ids are resolved at dispatch (registration may follow).
  const elementListeners = new WeakMap();
  // Listener ownership (creation time): a listener added while an action
  // frame is current runs under that frame whenever it fires; one added
  // outside any action is registered unchanged and runs inside whatever
  // dispatch invokes it. Registrations are remembered per (target, type,
  // capture, listener) so the browser's de-duplication and removal keep
  // working on the registered function. MessagePort `message` listeners take
  // the owner of each posted message instead (see MessageChannel below).
  let listenerOwnerWrap = null, portListener = null;
  // ---- Trusted user events (D-G1-21) -----------------------------------------
  // The model (discovery, recorded-or-not, phase and gesture) is one function
  // shared with Node: analysis/user-event-model.mjs, inlined by scripts/build.mjs.
  // BEGIN GENERATED USER EVENT MODEL
  function createUserEventModel(global) {
    const KINDS = {
      version: 2,
      // Classification only (D-G1-21 amended, RUN-3): a trusted event of a
      // listened kind dispatched in the document is recorded as a user event
      // unless its interface or kind is classified here as not user-caused;
      // unknown kinds and interfaces are user events (recorded per event).
      not_user_interfaces: ['AnimationEvent', 'BeforeUnloadEvent', 'CloseEvent', 'ContentVisibilityAutoStateChangeEvent', 'DeviceMotionEvent', 'DeviceOrientationEvent',
        'ErrorEvent', 'FormDataEvent', 'GamepadEvent', 'MediaEncryptedEvent', 'MessageEvent', 'PageRevealEvent', 'PageSwapEvent', 'PageTransitionEvent', 'ProgressEvent',
        'PromiseRejectionEvent', 'SecurityPolicyViolationEvent', 'StorageEvent', 'TrackEvent', 'TransitionEvent', 'WebGLContextEvent'],
      not_user_kinds: ['DOMContentLoaded', 'abort', 'appinstalled', 'beforeinstallprompt', 'canplay', 'canplaythrough', 'contextlost', 'contextrestored', 'cuechange',
        'durationchange', 'emptied', 'encrypted', 'ended', 'error', 'freeze', 'languagechange', 'load', 'loadeddata', 'loadedmetadata', 'loadend', 'loadstart', 'message',
        'messageerror', 'offline', 'online', 'open', 'pagehide', 'pagereveal', 'pageshow', 'pageswap', 'playing', 'prerenderingchange', 'progress', 'readystatechange',
        'rejectionhandled', 'resume', 'slotchange', 'stalled', 'suspend', 'timeout', 'timeupdate', 'unhandledrejection', 'unload', 'waiting', 'waitingforkey'],
      // Listening only: kinds the platform dispatches with no on* property.
      handlerless_kinds: ['DOMActivate', 'DOMFocusIn', 'DOMFocusOut', 'compositionend', 'compositionstart', 'compositionupdate', 'focusin', 'focusout', 'textInput',
        'touchcancel', 'touchend', 'touchmove', 'touchstart'],
      // Phase classification where no property decides.
      continuous_kinds: ['drag', 'dragenter', 'dragleave', 'dragover', 'resize', 'scroll', 'selectionchange'],
      // Boundary notifications never press or release a pointer.
      boundary_kinds: ['gotpointercapture', 'lostpointercapture', 'mouseenter', 'mouseleave', 'mouseout', 'mouseover', 'pointerenter', 'pointerleave', 'pointerout', 'pointerover'],
      episode_kinds: ['change', 'click', 'focusin', 'input', 'keydown', 'submit'],
    };
    const notUserKinds = new Set(KINDS.not_user_kinds), continuousNames = new Set(KINDS.continuous_kinds), boundary = new Set(KINDS.boundary_kinds);
    const ctors = new Map();
    const ctor = name => { if (ctors.has(name)) return ctors.get(name); let value = null; try { const found = global && global[name]; value = typeof found === 'function' ? found : null; } catch {} ctors.set(name, value); return value; };
    const instance = (event, name) => { const C = ctor(name); try { return Boolean(C && event instanceof C); } catch { return false; } };
    // Interface verdicts are per constructor (every event of one interface shares it): computed once.
    const verdicts = new Map();
    const FAMILIES = ['WheelEvent', 'DragEvent', 'PointerEvent', 'MouseEvent', 'TouchEvent', 'KeyboardEvent'];
    const verdictOf = event => {
      const key = event.constructor;
      let verdict = key ? verdicts.get(key) : undefined;
      if (!verdict) {
        verdict = { notUser: KINDS.not_user_interfaces.some(name => instance(event, name)), family: FAMILIES.find(name => instance(event, name)) || null, ui: instance(event, 'UIEvent') };
        if (key) verdicts.set(key, verdict);
      }
      return verdict;
    };
    // Rule 1: discovery. The prototype chains of HTMLElement (Element, Node,
    // EventTarget), Document and the window (Window.prototype and above), and
    // the window object itself.
    const discover = () => {
      const names = new Set(); const sources = []; const visited = new Set();
      for (const [label, start] of [['HTMLElement', ctor('HTMLElement')?.prototype], ['Document', ctor('Document')?.prototype], ['window', global]]) {
        let found = 0;
        for (let source = start, depth = 0; source && depth < 16; source = Object.getPrototypeOf(source), depth += 1) {
          if (visited.has(source)) continue; visited.add(source);
          let own = []; try { own = Object.getOwnPropertyNames(source); } catch {}
          for (const name of own) {
            if (name.length < 3 || !name.startsWith('on') || name !== name.toLowerCase()) continue;
            let descriptor = null; try { descriptor = Object.getOwnPropertyDescriptor(source, name); } catch {}
            if (!descriptor || typeof descriptor.set !== 'function') continue;
            if (!names.has(name.slice(2))) found += 1;
            names.add(name.slice(2));
          }
        }
        sources.push({ source: label, handlers: found });
      }
      const fromHandlers = names.size, supplemented = KINDS.handlerless_kinds.filter(name => !names.has(name));
      for (const name of supplemented) names.add(name);
      return { listened: [...names].sort(), on_handler_kinds: fromHandlers, supplemented, sources };
    };
    // Rule 2: a dispatch in the document (a node, the document or the window)
    // is a user event unless classified not user-caused. Events on other
    // targets (XMLHttpRequest, WebSocket, workers) are never user events.
    const inDocument = event => { try { const target = event.target; return target === global || Boolean(target && typeof target.nodeType === 'number'); } catch { return false; } };
    const notUser = event => notUserKinds.has(event.type) || verdictOf(event).notUser;
    const isUserEvent = event => Boolean(event && typeof event.type === 'string' && inDocument(event) && !notUser(event));
    const interfaceOf = event => { try { const name = event?.constructor?.name; return typeof name === 'string' && name ? name : null; } catch { return null; } };
    // Rules 3 and 4: phase and gesture. Pointer (mouse, pen, touch) and
    // keyboard are separate tracks.
    const createTracker = ({ nextId, defer }) => {
      const pointers = new Map(), keys = new Map(), held = [], trackOf = new Map(), recent = { pointer: null, key: null };
      let mouseButtons = 0, touchCount = 0, touchGesture = null, lastTouch = null, hover = null, cancelled = null, drag = null, lastReleased = null;
      const open = track => { const id = nextId(); held.push(id); trackOf.set(id, track); if (track === 'pointer') hover = null; return id; };
      const release = id => {
        const at = held.lastIndexOf(id); if (at >= 0) held.splice(at, 1);
        const track = trackOf.get(id) || 'pointer'; recent[track] = id; lastReleased = id;
        defer(() => { if (recent[track] === id) recent[track] = null; if (lastReleased === id) lastReleased = null; });
      };
      const heldOf = track => { for (let at = held.length - 1; at >= 0; at -= 1) if (trackOf.get(held[at]) === track) return held[at]; return null; };
      const latest = () => held[held.length - 1] || lastReleased || null;
      const pointerGesture = () => heldOf('pointer') || recent.pointer;
      // Pointer evidence is independent of event names. A generic activation
      // may be a UIEvent (rather than a MouseEvent); a selection event can fire
      // while the pointer is down. A keyboard activation has no pointer evidence.
      const pointerCause = event => {
        let fromTouch = false; try { fromTouch = event.sourceCapabilities?.firesTouchEvents === true; } catch {}
        if (fromTouch) return lastTouch || pointerGesture();
        if (heldOf('pointer')) return heldOf('pointer');
        if (verdictOf(event).ui && Number(event.detail) > 0) return pointerGesture();
        return null;
      };
      const hoverId = () => hover || (hover = nextId());
      const added = (now, before) => (now & ~before) !== 0, removed = (now, before) => (before & ~now) !== 0;
      const reset = () => { pointers.clear(); keys.clear(); held.length = 0; mouseButtons = 0; touchCount = 0; touchGesture = null; hover = null; drag = null; };
      return event => {
        const type = event.type, family = verdictOf(event).family;
        // The window losing focus or the page hiding ends every held gesture.
        if ((type === 'blur' && event.target === global) || (type === 'visibilitychange' && global.document?.visibilityState === 'hidden')) {
          const gesture = latest(); reset(); return { phase: 'discrete', gesture_id: gesture };
        }
        // Wheel: one segment per pointer segment, across the controls it passes over.
        if (family === 'WheelEvent') return { phase: 'continuous', gesture_id: heldOf('pointer') || hoverId(), segment: 'wheel' };
        if (family === 'DragEvent') {
          // HTML drag and drop: the gesture the drag started in (the browser
          // cancels the pointer when a native drag starts) until dragend.
          if (!drag) drag = heldOf('pointer') || cancelled || latest() || nextId();
          const gesture = drag; if (type === 'dragend') drag = null;
          return { phase: continuousNames.has(type) ? 'continuous' : 'discrete', gesture_id: gesture };
        }
        if (family === 'PointerEvent') {
          const id = event.pointerId; const state = pointers.get(id) || { buttons: 0, gesture: null };
          if (boundary.has(type)) {
            if (type === 'gotpointercapture' || type === 'lostpointercapture') return { phase: 'discrete', gesture_id: state.gesture || recent.pointer || null };
            return state.gesture ? { phase: 'continuous', gesture_id: state.gesture } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
          }
          const buttons = Number(event.buttons) | 0;
          if (type === 'pointercancel') {
            const gesture = state.gesture; state.buttons = 0; state.gesture = null; pointers.set(id, state);
            if (gesture) { release(gesture); cancelled = gesture; }
            return { phase: 'release', gesture_id: gesture || recent.pointer };
          }
          if (added(buttons, state.buttons)) {
            if (!state.gesture) { cancelled = null; state.gesture = event.pointerType === 'touch' && touchGesture ? touchGesture : open('pointer'); }
            if (event.pointerType === 'touch') { if (!touchGesture) touchGesture = state.gesture; lastTouch = state.gesture; }
            state.buttons = buttons; pointers.set(id, state); return { phase: 'press', gesture_id: state.gesture };
          }
          if (removed(buttons, state.buttons)) {
            const gesture = state.gesture; state.buttons = buttons;
            if (!state.buttons && gesture) { release(gesture); state.gesture = null; }
            pointers.set(id, state); return { phase: 'release', gesture_id: gesture || recent.pointer };
          }
          if (event.button === -1) return state.gesture ? { phase: 'continuous', gesture_id: state.gesture } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
          // click, auxclick, contextmenu: a real pointer's own gesture (held,
          // or released in this task); a keyboard-initiated activation (no
          // pointer type) is the key's.
          if (!event.pointerType) return { phase: 'activation', gesture_id: heldOf('key') || recent.key || latest() };
          return { phase: 'activation', gesture_id: state.gesture || pointerGesture() || (event.pointerType === 'touch' ? lastTouch : null) };
        }
        if (family === 'MouseEvent') {
          // Compatibility mouse events belong to the pointer track; those a touch
          // produced (sourceCapabilities.firesTouchEvents) to that touch's gesture.
          let fromTouch = false; try { fromTouch = event.sourceCapabilities?.firesTouchEvents === true; } catch {}
          const buttons = Number(event.buttons) | 0;
          if (fromTouch && lastTouch) {
            const phase = added(buttons, mouseButtons) ? 'press' : removed(buttons, mouseButtons) ? 'release' : Number(event.detail) > 0 ? 'activation' : 'continuous';
            mouseButtons = buttons; return { phase, gesture_id: lastTouch };
          }
          if (boundary.has(type)) return heldOf('pointer') ? { phase: 'continuous', gesture_id: heldOf('pointer') } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
          if (added(buttons, mouseButtons)) { mouseButtons = buttons; return { phase: 'press', gesture_id: heldOf('pointer') || open('pointer') }; }
          if (removed(buttons, mouseButtons)) { mouseButtons = buttons; return { phase: 'release', gesture_id: pointerGesture() }; }
          if (Number(event.detail) > 0) return { phase: 'activation', gesture_id: pointerGesture() };
          return heldOf('pointer') ? { phase: 'continuous', gesture_id: heldOf('pointer') } : { phase: 'continuous', gesture_id: hoverId(), hover: true };
        }
        if (family === 'TouchEvent') {
          // One contact: its touch events share the gesture of its touch pointer.
          const count = Number(event.touches?.length) | 0;
          if (count > touchCount) { if (!touchGesture) touchGesture = heldOf('pointer') || open('pointer'); lastTouch = touchGesture; touchCount = count; return { phase: 'press', gesture_id: touchGesture }; }
          if (count < touchCount || type === 'touchcancel') {
            const gesture = touchGesture || recent.pointer; touchCount = count;
            if (!count) { if (gesture && held.includes(gesture)) release(gesture); touchGesture = null; }
            return { phase: 'release', gesture_id: gesture };
          }
          return { phase: 'continuous', gesture_id: touchGesture || heldOf('pointer') };
        }
        if (family === 'KeyboardEvent') {
          const code = String(event.code || event.key || '');
          if (type === 'keydown') {
            if (event.repeat && keys.has(code)) return { phase: 'continuous', gesture_id: keys.get(code) };
            const gesture = open('key'); keys.set(code, gesture); return { phase: 'press', gesture_id: gesture };
          }
          if (type === 'keyup') {
            const gesture = keys.get(code) || null; keys.delete(code);
            if (gesture) release(gesture);
            return { phase: 'release', gesture_id: gesture || recent.key };
          }
          return { phase: 'discrete', gesture_id: heldOf('key') || recent.key || latest() };
        }
          // A pointer-caused event outside the pointer/mouse interfaces still
          // belongs to that pointer, even while a modifier key is held.
          const pointer = pointerCause(event);
          return { phase: continuousNames.has(type) ? 'continuous' : 'discrete', gesture_id: pointer || latest() || hover || null };
      };
    };
    const isUI = event => verdictOf(event).ui;
    const familyOf = event => verdictOf(event).family;
    return { kinds: KINDS, discover, isUserEvent, notUser, isUI, familyOf, interfaceOf, createTracker };
  }
  // END GENERATED USER EVENT MODEL
  const userEventModel = createUserEventModel(global);
  // Set once the dispatch listeners exist; attachShadow adds them to each new root.
  let listenInRoot = null;
  // ---- Shadow DOM: dispatch context crosses shadow roots -------------------
  // Shadow roots are recorded when attached, so a closed root (invisible from
  // outside) is still known to exist. The browser does not set window.event
  // while a listener whose currentTarget is in a shadow tree runs, so the
  // dispatch frame of that event could not be seen as live there. Unowned
  // listeners registered on a node outside the document's light tree (inside a
  // shadow root, or not yet attached) are therefore bound to the event they
  // are invoked with: `listenerEvent` names it for exactly the duration of the
  // call, and bareFrameLive accepts it only while that event is still being
  // dispatched. Nothing is inherited from ambient state.
  const shadowRoots = new WeakMap(); // host -> ShadowRoot (open and closed)
  const ElementProto = global.Element?.prototype;
  if (ElementProto && typeof ElementProto.attachShadow === 'function') {
    const nativeAttachShadow = ElementProto.attachShadow;
    ElementProto.attachShadow = function () { const root = nativeAttachShadow.apply(this, arguments); try { shadowRoots.set(this, root); observeRealmRoot(root); if (listenInRoot) listenInRoot(root); } catch {} return root; };
  }
  const shadowRootContaining = node => { try { const root = node?.getRootNode?.(); return root && root.nodeType === 11 && root.host ? root : null; } catch { return null; } };
  const closedShadowHost = node => { try { const root = node ? shadowRoots.get(node) : null; return Boolean(root && root.mode === 'closed'); } catch { return false; } };
  const openShadowRootOf = node => { try { const root = shadowRoots.get(node) || node?.shadowRoot || null; return root && root.mode === 'open' ? root : null; } catch { return null; } };
  const listenerTarget = node => Boolean(node && (node.nodeType === 1 || (node.nodeType === 11 && node.host)));
  const outsideLightTree = node => { try { return listenerTarget(node) && node.getRootNode?.() !== node.ownerDocument; } catch { return false; } };
  let listenerEvent = null;
  const bindListenerEvent = listener => function (event) {
    const previous = listenerEvent; listenerEvent = event;
    try { return listener.apply(this, arguments); } finally { listenerEvent = previous; }
  };
  const EventTargetProto = global.EventTarget?.prototype;
  const XHR_RESPONSE_EVENTS = new Set(['load', 'loadend', 'readystatechange', 'error', 'abort', 'timeout']);
  if (EventTargetProto?.addEventListener && EventTargetProto.removeEventListener) {
    const nativeAdd = EventTargetProto.addEventListener, nativeRemove = EventTargetProto.removeEventListener;
    const registrations = new WeakMap(); // target -> Map(type|capture -> Map(listener -> registered))
    const captureFlag = options => typeof options === 'boolean' ? options : Boolean(options && options.capture);
    const registrationsFor = (target, type, options, create) => {
      let byKey = registrations.get(target); if (!byKey) { if (!create) return null; byKey = new Map(); registrations.set(target, byKey); }
      const key = `${type}|${captureFlag(options)}`; let byListener = byKey.get(key); if (!byListener && create) { byListener = new Map(); byKey.set(key, byListener); }
      return byListener || null;
    };
    EventTargetProto.addEventListener = function (type, listener, options) {
      let registered = listener;
      try {
        if (typeof listener === 'function' && listenerTarget(this)) {
          let byType = elementListeners.get(this); if (!byType) { byType = new Map(); elementListeners.set(this, byType); }
          let set = byType.get(type); if (!set) { set = new Set(); byType.set(type, set); } set.add(listener);
        }
        if (typeof listener === 'function' && this && typeof this === 'object') {
          const once = Boolean(options && typeof options === 'object' && options.once);
          const known = once ? null : registrationsFor(this, type, options, false)?.get(listener);
          if (known) registered = known;
          else {
            if (type === 'message' && typeof portListener === 'function') registered = portListener(this, listener);
            if (registered === listener && typeof listenerOwnerWrap === 'function') registered = listenerOwnerWrap(listener, this);
            if (registered === listener && outsideLightTree(this)) { registered = bindListenerEvent(listener); stampStats.shadow_listeners_bound += 1; }
            if (XHR_RESPONSE_EVENTS.has(type) && global.XMLHttpRequest && this instanceof global.XMLHttpRequest) {
              const inner = registered;
              registered = function (...args) { const previous = responseContext; responseContext = xhrOccurrences.get(this) || null; try { return inner.apply(this, args); } finally { responseContext = previous; } };
            }
            if (!once) registrationsFor(this, type, options, true).set(listener, registered);
          }
        }
      } catch { registered = listener; }
      return nativeAdd.call(this, type, registered, options);
    };
    EventTargetProto.removeEventListener = function (type, listener, options) {
      let registered = listener;
      try {
        if (typeof listener === 'function' && listenerTarget(this)) elementListeners.get(this)?.get(type)?.delete(listener);
        const byListener = typeof listener === 'function' ? registrationsFor(this, type, options, false) : null;
        if (byListener?.has(listener)) { registered = byListener.get(listener); byListener.delete(listener); }
      } catch {}
      return nativeRemove.call(this, type, registered, options);
    };
  }
  const describe = node => { if (!node || typeof node !== 'object') return null; const attrs = {}; try { for (const attr of Array.from(node.attributes || [])) if (/^(?:id|role|name|type|data-testid|aria-)/u.test(attr.name)) attrs[attr.name] = attr.value; } catch {} return { tag: String(node.tagName || '').toLowerCase() || null, attributes: attrs }; };
  // Control labels (dev builds, `labels` plugin option): the visible name of
  // the control the user acted on, never what they typed. aria-label, else the
  // text of a button/link/menu item, else the <label> or placeholder of a field.
  const LABELS_ON = global.__PRODUCTTRACE_LABELS__ === 'on';
  const LABEL_MAX = 80;
  const squash = text => { const value = String(text || '').replace(/\s+/gu, ' ').trim(); return value ? (value.length > LABEL_MAX ? `${value.slice(0, LABEL_MAX - 1)}…` : value) : null; };
  const controlLabel = node => {
    if (!LABELS_ON || !node || node.nodeType !== 1) return null;
    try {
      const aria = node.getAttribute('aria-label'); if (aria) return squash(aria);
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) { const text = labelledBy.split(/\s+/u).map(id => global.document.getElementById(id)?.textContent || '').join(' '); if (squash(text)) return squash(text); }
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (tag === 'input' && ['button', 'submit', 'reset'].includes(String(node.type))) return squash(node.value);
        const labelNode = node.labels && node.labels[0] ? node.labels[0] : null;
        const own = labelNode ? Array.from(labelNode.childNodes || []).filter(child => child.nodeType === 3).map(child => child.textContent).join(' ') || labelNode.textContent : null;
        return squash(own) || squash(node.getAttribute('placeholder')) || null;
      }
      // Only controls get a text label: a container's text is page content, and reading it is not free.
      const role = node.getAttribute('role');
      if (!['button', 'a', 'summary', 'label'].includes(tag) && !['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'radio', 'switch', 'treeitem'].includes(role)) return null;
      if (node.isContentEditable) return null;
      return squash(node.textContent) || squash(node.getAttribute('title')) || squash(node.querySelector?.('img[alt]')?.getAttribute('alt'));
    } catch { return null; }
  };
  const pagePath = () => { try { return `${global.location.pathname}${global.location.search}`; } catch { return null; } };
  // The document's title where the action happened (labels on only): a page's own name ("Dashboard | Acme").
  // An email in a title (an inbox, an account page) is never recorded: it becomes [email].
  const pageTitle = () => { if (!LABELS_ON) return null; try { const title = squash(global.document?.title); return title ? title.replace(/[^\s@|·–—()<>,;:"']+@[^\s@|·–—()<>,;:"']+/gu, '[email]') : null; } catch { return null; } };
  const describeControl = node => { const description = describe(node); const ref = identity(node)?.handle || null; return description && ref ? { ...description, ref } : description; };
  // The control a user acted on (an action's target, a hover's related target): with its label.
  const describeActed = node => { const description = describeControl(node); const label = description ? controlLabel(node) : null; return label ? { ...description, label } : description; };
  const interactiveFor = node => { try { return node?.closest?.('button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[tabindex]') || node; } catch { return node; } };
  // A hover is about the control under the pointer, not the heading or icon
  // inside it the event landed on: the nearest link/button-like ancestor.
  const HOVER_CONTROL = 'a[href],button,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="option"]';
  const hoverControl = node => composedClosest(node, HOVER_CONTROL) || node;
  // closest() that continues from a shadow root to its host.
  const composedClosest = (node, selector) => {
    for (let cursor = node, depth = 0; cursor && depth < 32; depth += 1) {
      try { const found = cursor.closest?.(selector); if (found) return found; } catch { return null; }
      cursor = shadowRootContaining(cursor)?.host || null;
    }
    return null;
  };
  const formFor = node => { try { if (String(node?.tagName || '').toLowerCase() === 'form') return node; return node?.form || node?.closest?.('form') || null; } catch { return null; } };
  const describeForm = form => { if (!form) return null; const ref = identity(form)?.handle || null; return { ...describe(form), ref }; };
  const EVENT_OBSERVABLE = 'event' in global;
  // A bare dispatch frame outside its own dispatch is stale: an unowned task
  // (a timer, a scheduler message) runs after the dispatch ended.
  // A nested untrusted event (a composed CustomEvent dispatched by a handler)
  // keeps the frame live only while the frame's own event is still being
  // dispatched (eventPhase is NONE once a dispatch ends), so a stale frame is
  // never revived by a later programmatic event. Inside a listener bound to
  // its event (a shadow-tree listener, where window.event is not set), the
  // event it was invoked with stands in for window.event.
  const bareFrameLive = frame => {
    if (!EVENT_OBSERVABLE || !frame?.event) return true;
    const dispatching = frame.event.eventPhase !== 0;
    const live = observed => observed === frame.event || Boolean(dispatching && observed && observed.isTrusted === false);
    return live(global.event) || (dispatching && listenerEvent !== null && live(listenerEvent));
  };
  // Stack pop for dispatch frames: the browser gives no callback when a
  // dispatch ends, so a dispatch frame whose event is no longer being
  // dispatched is popped lazily, restoring exactly the frame that was current
  // when the dispatch began (`parent`). Function frames pop eagerly on exit
  // (see exit), so a nested dispatch that is still on top when its caller
  // returns is discarded with the caller.
  const settleAmbient = () => { while (current?.dispatch && !bareFrameLive(current)) current = current.parent || null; return current; };
  const continuationId = (action_id, kind) => `continuation:${action_id}:${kind}:${++continuationSequence}`;
  // `target` (the dispatch target, composedPath()[0] when retargeted) and
  // `cause` (dispatchCause: set when live code caused this dispatch) are read
  // only by observeBinding: which handlers ran for this dispatch, and whether
  // the dispatch was a user's.
  const actionFrame = (action_id, event, parent, target = null, cause = null, continuation_id = null, dispatch_action_id = action_id) => ({ action_id, dispatch_action_id, parent, action: true, dispatch: true, bare: true, event, target, cause,
    continuation_id: continuation_id || continuationId(action_id, 'action'), continuation_kind: 'action', parent_continuation_id: null, spine: [] });
  // A continuation of an owner frame. It keeps the owner's action, spine,
  // receipt linkage and bareness (a continuation of the bare dispatch frame
  // still has no first-party function open), and is never a dispatch frame.
  // A frame that got its action from a left-behind frame (dead run token)
  // is live code with an owner that is not provably live: `stale_owner`.
  // Only the focus cause reads it; the action it carries is unchanged.
  const staleOwner = frame => Boolean(frame && frame.action_id && !frame.dispatch && (frame.stale_owner || !frame.run?.live));
  let keepPending = null;
  const continuationOf = (owner, kind, invoked_by = 'async') => (keepPending?.(owner.action_id), { action_id: owner.action_id, parent: null, action: false, dispatch: false, bare: Boolean(owner.bare), scheduler: Boolean(owner.scheduler), event: null, run: runToken(), stale_owner: Boolean(owner.stale_owner),
    origin_dispatch: owner.bare ? (owner.dispatch ? owner : owner.origin_dispatch || null) : null,
    continuation_id: continuationId(owner.action_id || 'unattributed', kind), continuation_kind: kind, invoked_by,
    parent_continuation_id: owner.continuation_id || null, spine: [...(owner.spine || [])], response_of: owner.response_of || null,
    state_receipt: Boolean(owner.state_receipt), react_commit_receipt: Boolean(owner.react_commit_receipt) });
  const spineFor = frame => {
    return { action_id: frame?.action_id || null, function_ids: [...(frame?.spine || [])] };
  };
  // A trusted event dispatched while code runs on a live frame (a handler on
  // the synchronous stack, or a continuation an action created: its commit, a
  // mount effect, a timer, a promise) is that code's work, not a user
  // gesture: el.focus() fires focus/focusin (and blur/focusout on the element
  // that had focus), form.requestSubmit() fires submit. Creation-time
  // ownership already names the action: the frame's own. A frame in a React
  // scheduler lineage (a MessagePort loop that multiplexes unrelated updates)
  // or with no action proves only that it is not a gesture; the cause is
  // abstained. With no live frame (Tab, a pointer, an unowned timer, a file
  // chooser's result) the event is not marked. PR #11 wrote this for focusin;
  // D-G1-21 applies it to every recorded discrete event.
  const rootKind = frame => { let cursor = frame; for (let depth = 0; cursor && cursor.continuation_kind === 'function' && cursor.parent && depth < 256; depth += 1) cursor = cursor.parent; return cursor?.dispatch ? 'dispatch' : (cursor?.continuation_kind || null); };
  // Provably live: a dispatch frame (settleAmbient already dropped ended
  // ones) or a frame made current in this synchronous run. A left-behind
  // frame gives no mark at all, so a real Tab or pointer focus keeps its fold.
  // A dispatch frame is provably live only where window.event is observable
  // (settleAmbient drops ended ones by it); elsewhere it is popped by a host
  // timer and proves nothing.
  const frameLive = frame => Boolean(frame && ((frame.dispatch && EVENT_OBSERVABLE) || frame.run?.live));
  const dispatchCause = (event, frame) => {
    if (!frameLive(frame)) return null;
    // Live code whose action came from a left-behind frame: not a gesture,
    // but the causing action is not provable.
    if (frame.action_id && frame.stale_owner) return { gesture: false, caused_by_action_id: null, caused_by_continuation_id: frame.continuation_id || null, cause_abstained: 'stale_frame' };
    if (frame.action_id && !frame.scheduler) return { gesture: false, caused_by_action_id: frame.action_id, caused_by_continuation_id: frame.continuation_id || null, caused_via: rootKind(frame) };
    return { gesture: false, caused_by_action_id: null, caused_by_continuation_id: frame.continuation_id || null, cause_abstained: frame.scheduler ? 'scheduler_lineage' : 'no_action_on_frame' };
  };
  // ---- What each recorded event carries (D-G1-21) ---------------------------
  // Everything the event's interface describes about the user's act, never a
  // field's value. Text a user types is content and is recorded only when the
  // build turned it on (`inputText: true`, non-production builds:
  // INPUT_TEXT_MODE 'on'). By default a printable key without Ctrl/Alt/Meta
  // is folded to "Printable" (key and code, as before) and InputEvent /
  // CompositionEvent rows carry inputType, data_length and credential_field,
  // never `data`. In password and credential fields (autocomplete
  // current-password, new-password, one-time-code, cc-*) text is redacted in
  // every mode. A key pressed with Ctrl, Alt or Meta is a command, not text,
  // and is recorded as pressed (outside credential fields).
  const INPUT_TEXT_MODE = ['on', 'off', 'production_off'].includes(global.__PRODUCTTRACE_INPUT_TEXT__) ? global.__PRODUCTTRACE_INPUT_TEXT__ : 'off';
  const CREDENTIAL_AUTOCOMPLETE = /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z-]+)(?:\s|$)/u;
  const credentialField = node => { try { if (String(node?.tagName || '').toLowerCase() === 'input' && String(node.type || '').toLowerCase() === 'password') return true; return CREDENTIAL_AUTOCOMPLETE.test(String(node?.getAttribute?.('autocomplete') || '')); } catch { return true; } };
  const MODIFIER_KEYS = ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'];
  const modifiersOf = event => { const out = {}; for (const name of MODIFIER_KEYS) if (typeof event[name] === 'boolean') out[name] = event[name]; return out; };
  const is = (event, name) => { try { return typeof global[name] === 'function' && event instanceof global[name]; } catch { return false; } };
  const round = value => Number.isFinite(value) ? Math.round(value) : null;
  const keyDetail = (event, contentHidden) => {
    const modifiers = modifiersOf(event);
    // A command is Ctrl or Meta WITHOUT Alt or AltGraph: Alt/Option and
    // AltGr (Ctrl+Alt) combinations type characters (å, @) on many layouts.
    let altGraph = false; try { altGraph = event.getModifierState?.('AltGraph') === true; } catch {}
    const command = Boolean((modifiers.ctrlKey || modifiers.metaKey) && !modifiers.altKey && !altGraph);
    const text = typeof event.key === 'string' && event.key.length === 1;
    const fold = text && (contentHidden || (!command && INPUT_TEXT_MODE !== 'on'));
    return { key: fold ? 'Printable' : (typeof event.key === 'string' ? event.key : null), code: fold ? 'Printable' : (typeof event.code === 'string' ? event.code : null),
      ...modifiers, repeat: event.repeat === true, location: Number.isFinite(event.location) ? event.location : null, isComposing: event.isComposing === true };
  };
  const textData = (value, contentHidden) => {
    if (typeof value !== 'string') return { data_length: null, credential_field: contentHidden };
    if (contentHidden) return { data_redacted: 'credential_field', data_length: value.length, credential_field: true };
    return INPUT_TEXT_MODE === 'on' ? { data: value, data_length: value.length, credential_field: false } : { data_length: value.length, credential_field: false };
  };
  const listOf = value => { try { return Array.from(value || [], String); } catch { return []; } };
  const describeEvent = (event, target) => {
    const out = {};
    const contentHidden = credentialField(target);
    try {
      if (is(event, 'KeyboardEvent')) out.key = keyDetail(event, contentHidden);
      else if (is(event, 'PointerEvent')) out.pointer = { pointerType: event.pointerType ?? null, pointerId: event.pointerId ?? null, button: event.button ?? null, buttons: event.buttons ?? null,
        pressure: Number.isFinite(event.pressure) ? event.pressure : null, isPrimary: event.isPrimary === true, detail: event.detail ?? null, clientX: round(event.clientX), clientY: round(event.clientY), ...modifiersOf(event) };
      else if (is(event, 'DragEvent')) out.drag = { types: listOf(event.dataTransfer?.types), files: event.dataTransfer?.files?.length ?? 0, dropEffect: event.dataTransfer?.dropEffect ?? null,
        effectAllowed: event.dataTransfer?.effectAllowed ?? null, clientX: round(event.clientX), clientY: round(event.clientY), ...modifiersOf(event) };
      else if (is(event, 'MouseEvent')) out.mouse = { button: event.button ?? null, buttons: event.buttons ?? null, detail: event.detail ?? null, clientX: round(event.clientX), clientY: round(event.clientY), ...modifiersOf(event) };
      else if (is(event, 'TouchEvent')) out.touch = { touches: event.touches?.length ?? 0, changedTouches: event.changedTouches?.length ?? 0, targetTouches: event.targetTouches?.length ?? 0, ...modifiersOf(event) };
      else if (is(event, 'InputEvent')) out.input = { inputType: event.inputType ?? null, isComposing: event.isComposing === true, ...textData(event.data, contentHidden) };
      else if (is(event, 'CompositionEvent')) out.composition = textData(event.data, contentHidden);
      else if (is(event, 'ClipboardEvent')) out.clipboard = { types: listOf(event.clipboardData?.types) };
      else if (is(event, 'ToggleEvent')) out.toggle = { oldState: event.oldState ?? null, newState: event.newState ?? null };
      // The element focus or the pointer came from or went to.
      if (is(event, 'FocusEvent') || (is(event, 'MouseEvent') && 'relatedTarget' in event && /(?:over|out|enter|leave)$/u.test(event.type))) out.related_target = event.relatedTarget ? describeActed(is(event, 'MouseEvent') ? hoverControl(event.relatedTarget) : event.relatedTarget) : null;
      // A file input: how many files and their types, never names or contents.
      if (String(target?.tagName || '').toLowerCase() === 'input' && String(target.type || '').toLowerCase() === 'file' && target.files) out.files = { count: target.files.length, types: listOf(Array.from(target.files, file => file.type || '')) };
    } catch {}
    return out;
  };
  // Mutation receipts still collecting (see beginDomAction). A receipt's
  // window ends at the host's next task or at the next top-level user
  // dispatch, whichever comes first, so a receipt holds only the work of its
  // own dispatch window. A submit's validation window (750 ms, for feedback
  // rendered after async validation) ends at its timer or the next
  // top-level discrete dispatch; a pointer move does not end it.
  // A validation window (a submit's 750 ms, or a dispatch the browser is
  // about to validate, whose invalid events and focus move follow in the same
  // task) is not ended by a pointer move or by a dispatch of its own gesture.
  const openReceipts = new Map(); // finish -> { validation, gesture_id }
  const closeReceipts = (meta = null, { continuous = false } = {}) => {
    for (const [finish, window] of [...openReceipts]) {
      if (window.validation && (continuous || (meta?.gesture_id && window.gesture_id === meta.gesture_id))) continue;
      finish();
    }
  };
  // Continuous kinds (D-G1-21 rule 3) are coalesced: one dom.action row per
  // (kind, control, gesture) opens a range, every event of the range runs
  // under that action's dispatch frame, and one dom.action.range row closes
  // it with first/last timestamps, count and bounding movement.
  //
  // Ranges close as they go, never all at pagehide: a range closes at the
  // release of its gesture, at the next top-level discrete dispatch of
  // another gesture (or any, for a range with no gesture), when it reaches
  // RANGE_MAX_EVENTS, or after RANGE_IDLE_MS with no event (a host timer:
  // these bounds only split emission; the rows after a split belong to a new
  // range of the same gesture). A summary or pagehide closes what is left.
  //
  // Hover (pointer/mouse movement and boundary events with nothing held) is
  // one range per movement segment ACROSS controls: one dom.action opens it
  // and one dom.action.range closes it with the count per kind, the number of
  // controls crossed and the first and last control. Each (kind, control)
  // crossed still gets its own action id and dispatch frame, but its
  // dom.action row is written only if work runs under it (a row carrying
  // that action id is about to be emitted: a first-party function, a
  // request, a continuation's work), listed in the close row's `with_work`.
  const RANGE_MAX_EVENTS = 1000, RANGE_IDLE_MS = 1000;
  const openRanges = new Map();
  const pendingActions = new Map(); // action_id -> unwritten hover control action
  let rangeIdleTimer = null;
  const describeLight = node => { const description = describeControl(node); if (!description) return null; try { const key = composedClosest(node, `[${STAMP_ATTRIBUTE}]`)?.getAttribute?.(STAMP_ATTRIBUTE); if (key) description.element_key = key; } catch {} return description; };
  const closeRange = (range, reason) => {
    if (range.closed) return; range.closed = true; openRanges.delete(range.key);
    let withWork;
    if (range.segment) {
      withWork = [];
      for (const pending of range.pending.values()) {
        if (pending.materialized) withWork.push({ action_id: pending.action_id, event: pending.event, target_ref: pending.target_ref, count: pending.count });
        else if (!pending.keep) pendingActions.delete(pending.action_id);
      }
    }
    emit({ kind: 'dom.action.range', action_id: range.action_id, event: range.event, gesture_id: range.gesture_id, target_ref: range.target_ref,
      count: range.count, first_timestamp: range.first_timestamp, last_timestamp: range.last_timestamp,
      ...(range.segment ? { segment: range.segment, by_kind: range.by_kind, controls: range.controls.size, first_control: range.first_control, last_control: describeLight(range.last_node), with_work: withWork } : {}),
      ...(range.bounds ? { bounds: range.bounds } : {}), ...(range.wheel ? { wheel: range.wheel } : {}), ...(range.scroll ? { scroll: range.scroll } : {}),
      close_reason: reason, parent_continuation_id: null });
  };
  // With a dispatch's { gesture_id, phase }: close ranges of other gestures
  // (and every range with no gesture); its own gesture's ranges only at its
  // release. Without one: close everything.
  const closeRanges = (reason, meta = null) => {
    for (const range of [...openRanges.values()]) {
      if (meta && meta.gesture_id && range.gesture_id === meta.gesture_id && meta.phase !== 'release') continue;
      closeRange(range, reason);
    }
  };
  const checkIdleRanges = () => {
    rangeIdleTimer = null; const now = Date.now();
    for (const range of [...openRanges.values()]) if (now - range.last_timestamp >= RANGE_IDLE_MS) closeRange(range, 'idle');
    if (openRanges.size) armRangeIdle();
  };
  const armRangeIdle = () => { if (!rangeIdleTimer && hostSetTimeout) rangeIdleTimer = hostSetTimeout(checkIdleRanges, RANGE_IDLE_MS / 2); };
  const materialize = pending => {
    if (pending.materialized) return; pending.materialized = true; pendingActions.delete(pending.action_id);
    const subject = hoverControl(pending.node);
    const target = describeLight(subject);
    if (target) { const label = controlLabel(subject); if (label) target.label = label; }
    // The event object keeps its fields after dispatch: described only now.
    const detail = describeEvent(pending.source, pending.node);
    emit({ kind: 'dom.action', action_id: pending.action_id, timestamp: pending.timestamp, ...(pending.page !== undefined ? { page: pending.page } : {}), ...(pending.page_title ? { page_title: pending.page_title } : {}), event: pending.event, target, ...(target?.ref ? { target_ref: target.ref } : {}),
      interface: pending.interface, phase: 'continuous', gesture_id: pending.gesture_id, coalesced: true, hover_segment_action_id: pending.segment.action_id, ...detail,
      source_ref: null, parent_continuation_id: null, continuation_id: null, spine: { action_id: pending.action_id, function_ids: [] }, evidence_ids: [] });
  };
  const scrollElement = node => (node === global.document || node === global ? global.document?.scrollingElement : node);
  const scrollPosition = node => { try { const element = scrollElement(node); return element ? [round(element.scrollLeft), round(element.scrollTop)] : null; } catch { return null; } };
  // How far one screen is, so a reader can say "about 3 screens"; and whether the page itself scrolled.
  const scrollFrame = node => { try { const element = scrollElement(node); return element ? { viewport: round(element.clientHeight), page: element === global.document?.scrollingElement } : {}; } catch { return {}; } };
  const extendRange = (range, event, dispatchTarget) => {
    range.count += 1; range.last_timestamp = Date.now(); armRangeIdle();
    const x = round(event.clientX), y = round(event.clientY);
    if (x !== null && y !== null) {
      if (!range.bounds) range.bounds = { min_x: x, max_x: x, min_y: y, max_y: y, first: [x, y], last: [x, y] };
      else Object.assign(range.bounds, { min_x: Math.min(range.bounds.min_x, x), max_x: Math.max(range.bounds.max_x, x), min_y: Math.min(range.bounds.min_y, y), max_y: Math.max(range.bounds.max_y, y), last: [x, y] });
    }
    if (event.type === 'wheel' || userEventModel.familyOf(event) === 'WheelEvent') { range.wheel ||= { delta_x: 0, delta_y: 0, delta_mode: event.deltaMode ?? null }; range.wheel.delta_x += Number(event.deltaX) || 0; range.wheel.delta_y += Number(event.deltaY) || 0; }
    if (event.type === 'scroll' || event.type === 'scrollend') { const position = scrollPosition(dispatchTarget); if (position) { range.scroll ||= { first: position, last: position, ...scrollFrame(dispatchTarget) }; range.scroll.last = position; } }
  };
  // Synthetic activation (an untrusted click dispatched while an action's code
  // is live, e.g. a visible button calling hiddenFileInput.click()): the
  // element's later trusted events that are not UIEvents (a picker's input,
  // change, cancel) carry `opened_by_action_id`. Any trusted UIEvent on the
  // element (focus, key, pointer, hover) is the user acting on it and clears
  // the link.
  // The file chooser's input/change arrive in a later task, so the liveness
  // mark cannot claim them; this identifier (element identity + the live
  // frame at the synthetic dispatch) can.
  const syntheticActivations = new WeakMap();
  // A listener on the window sees a shadow-tree target retargeted to its
  // host; composedPath()[0] is the real target when the root is open. A
  // closed root hides it: the action stays on the host and says so. A
  // listener inside a closed root (non-composed events) sees the inner
  // target: the action still stays on the host, as for composed events.
  const dispatchTargets = event => {
    let path = []; try { path = Array.from(event.composedPath?.() || []); } catch {}
    const retargeted = path[0] && path[0] !== event.target && path[0].nodeType === 1 ? path[0] : null;
    const dispatchTarget = retargeted || event.target;
    const containingRoot = shadowRootContaining(dispatchTarget);
    const closedHost = !retargeted && closedShadowHost(event.target) ? event.target : (containingRoot?.mode === 'closed' ? containingRoot.host : null);
    const actionTarget = closedHost || interactiveFor(event.submitter || dispatchTarget);
    return { dispatchTarget, closedHost, actionTarget };
  };
  const newActionId = () => `action:${Date.now().toString(36)}:${++actionSequence}`;
  const beginDomAction = (event, meta = {}) => {
    checkRealms();
    const action_id = newActionId();
    // Push: a dispatch nested in running code (a programmatic focus inside a
    // handler or an effect) restores exactly that code's frame when it ends.
    const ambient = settleAmbient();
    const range = meta.phase === 'continuous';
    const cause = range ? null : dispatchCause(event, ambient);
    // A dispatch caused by live action code (el.focus(), requestSubmit())
    // runs on a dispatch frame of the CAUSING action: its listeners' work is
    // that action's work, as it was before the event was recorded. The row
    // is still written (gesture: false, caused_by_action_id, runs_on_action_id).
    const onCauser = Boolean(cause?.caused_by_action_id);
    if (!onCauser) {
      if (lastActionWindow && lastActionWindow !== action_id) flushFunctionWindow(lastActionWindow);
      lastActionWindow = action_id;
    }
    // A discrete dispatch that is not nested in live code is the next user
    // act: it ends the ranges of other gestures (its own at its release) and
    // stops every mutation receipt still collecting.
    if (!range && !frameLive(ambient)) { closeRanges('next_discrete_event', meta); closeReceipts(meta); }
    const { dispatchTarget, closedHost, actionTarget } = dispatchTargets(event);
    current = actionFrame(onCauser ? cause.caused_by_action_id : action_id, event, ambient, closedHost || dispatchTarget, cause, null, action_id);
    const innerRoot = shadowRootContaining(actionTarget);
    const form = formFor(actionTarget) || formFor(event.target);
    // A control in a portal opened by a form action is not inside that form:
    // it is a different control. The opener's form is kept as evidence only
    // (`portal_opener_form_ref`) and is never written as `form_ref`, so no
    // episode folds the portal's actions into the opener's form.
    const portalFormRef = !form ? Array.from(event.composedPath?.() || [actionTarget]).map(node => portalFormRefs.get(node)).find(Boolean) : null;
    const formDescription = describeForm(form);
    // Reject signal (outcome labels): a dispatch the browser is about to
    // validate (a click on a submit button, or Enter in a text field of a form
    // with a default button), whose form is invalid at dispatch. Never on a
    // `submit` event (it fires only after validation passed or was bypassed),
    // never with `novalidate` on the form or `formnovalidate` on the submitter.
    // A CSS match only: no `invalid` event is fired.
    let formInvalid = false;
    if (form && event.type !== 'submit') {
      try {
        const tag = String(actionTarget?.tagName || '').toLowerCase(); const type = String(actionTarget?.getAttribute?.('type') || '').toLowerCase();
        const isSubmitter = node => { const nodeTag = String(node?.tagName || '').toLowerCase(); const nodeType = String(node?.getAttribute?.('type') || '').toLowerCase();
          return (nodeTag === 'button' && (!nodeType || nodeType === 'submit')) || (nodeTag === 'input' && (nodeType === 'submit' || nodeType === 'image')); };
        let submitter = null;
        if (event.type === 'click' && isSubmitter(actionTarget)) submitter = actionTarget;
        else if (event.type === 'keydown' && event.key === 'Enter' && tag === 'input'
          && ['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(type)) {
          submitter = Array.from(form.elements || []).find(isSubmitter) || null;
        }
        formInvalid = Boolean(submitter) && form.noValidate !== true && submitter.formNoValidate !== true
          && !submitter.hasAttribute?.('formnovalidate') && form.matches?.(':invalid') === true;
      } catch {}
    }
    const target = describeActed(actionTarget);
    let boundHandlers = null;
    try { boundHandlers = typeof boundHandlersFor === 'function' ? boundHandlersFor(dispatchTarget, event.type) : null; } catch {}
    // Lookup key only: read from the DOM for external agents, never used to
    // attribute. Absent when nothing at or above the target is stamped.
    const stampedTarget = composedClosest(actionTarget, `[${STAMP_ATTRIBUTE}]`);
    const elementKey = stampedTarget?.getAttribute?.(STAMP_ATTRIBUTE) || null;
    if (target && elementKey) {
      target.element_key = elementKey;
      // How far the key can be trusted (lookup only): key_kind, the instance
      // count of an ordinal key at the latest commit, and the element.stamp
      // row (stamp_sequence) that held for this key when the action fired.
      let fields = null;
      try { fields = typeof stampFieldsFor === 'function' ? stampFieldsFor(stampedTarget, elementKey) : null; } catch { stampStats.errors += 1; }
      if (fields) Object.assign(target, fields);
    }
    if (target && innerRoot) {
      const hostKey = composedClosest(innerRoot.host, `[${STAMP_ATTRIBUTE}]`)?.getAttribute?.(STAMP_ATTRIBUTE) || null;
      target.composed = true;
      target.shadow_host = { tag: String(innerRoot.host.tagName || '').toLowerCase() || null, ...(hostKey ? { element_key: hostKey } : {}) };
    }
    if (target && closedHost) { target.composed = true; target.closed_shadow = true; }
    const detail = describeEvent(event, closedHost ? null : dispatchTarget);
    const key = detail.key || null; delete detail.key;
    const opened = meta.opened ? { opened_by_action_id: meta.opened.action_id, opened_by_continuation_id: meta.opened.continuation_id, opened_via: 'synthetic_click' } : null;
    if (range) {
      const rangeKey = meta.range_key;
      const record = { key: rangeKey, action_id, event: event.type, gesture_id: meta.gesture_id ?? null, target_ref: target?.ref || null, count: 0,
        first_timestamp: Date.now(), last_timestamp: Date.now(), bounds: null, wheel: null, scroll: null, closed: false };
      openRanges.set(rangeKey, record); extendRange(record, event, dispatchTarget);
    }
    emit({ kind: 'dom.action', action_id, event: event.type, target, ...(target?.ref ? { target_ref: target.ref } : {}),
      interface: userEventModel.interfaceOf(event), phase: meta.phase || 'discrete', gesture_id: meta.gesture_id ?? null, ...(range ? { coalesced: true } : {}),
      ...detail, ...(opened || {}),
      ...(event.type === 'submit' && event.submitter ? { submitter: describe(event.submitter) } : {}),
      ...(formDescription ? { form: formDescription, form_ref: formDescription.ref } : {}), ...(formInvalid ? { form_invalid: true } : {}),
      ...(portalFormRef ? { portal_opener_form_ref: portalFormRef } : {}),
      ...(key ? { key } : {}), ...(boundHandlers ? { bound_handlers: boundHandlers } : {}), ...(cause || {}), source_ref: null,
      ...(onCauser ? { runs_on_action_id: cause.caused_by_action_id } : {}),
      parent_continuation_id: null, continuation_id: onCauser ? null : current.continuation_id, spine: { action_id, function_ids: [] }, evidence_ids: [] });
    if (elementKey && typeof noteStampedAction === 'function') { try { noteStampedAction(stampedTarget, elementKey, action_id); } catch { stampStats.errors += 1; } }
    // Retain one identity-only surface receipt for synchronous work caused by
    // this dispatch. Values and DOM content are deliberately not captured.
    // A continuous range has no receipt (its dispatches are not discrete
    // acts), nor does a dispatch that runs on its causer's frame (the
    // causer's receipt, still open, holds that work).
    if (!range && !onCauser && global.MutationObserver && global.document?.documentElement) {
      const receipt = { count: 0, attributes: 0, child_list: 0, character_data: 0 };
      const formReceipt = { count: 0, attributes: 0, child_list: 0, character_data: 0 };
      const addedForms = new Map(), addedControls = new Map();
      let ariaInvalidChanged = false, validationFeedbackMutations = 0;
      const rememberAddedForm = candidate => {
        if (!candidate || String(candidate.tagName || '').toLowerCase() !== 'form') return;
        const description = describeForm(candidate); if (description?.ref) addedForms.set(description.ref, description);
      };
      const rememberAddedControl = candidate => {
        if (!candidate || candidate.nodeType !== 1 || addedControls.size >= 100) return;
        let interactive = false;
        try { interactive = candidate.matches?.('button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[tabindex]') === true; } catch {}
        if (!interactive) return;
        const description = describeControl(candidate); if (description?.ref) addedControls.set(description.ref, description);
      };
      const onMutations = observed => {
        // Tracer's own stamp attributes are not application effects.
        const mutations = observed.filter(mutation => !(mutation.type === 'attributes' && tracerAttributes.has(mutation.attributeName)));
        if (!mutations.length) return;
        receipt.count += mutations.length;
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') receipt.attributes += 1;
          else if (mutation.type === 'childList') receipt.child_list += 1;
          else if (mutation.type === 'characterData') receipt.character_data += 1;
          const inForm = Boolean(form && (mutation.target === form || form.contains?.(mutation.target)));
          if (inForm) {
            formReceipt.count += 1;
            if (mutation.type === 'attributes') formReceipt.attributes += 1;
            else if (mutation.type === 'childList') formReceipt.child_list += 1;
            else if (mutation.type === 'characterData') formReceipt.character_data += 1;
            if (mutation.type === 'attributes' && mutation.attributeName === 'aria-invalid') ariaInvalidChanged = true;
          }
          // Accessible validation feedback is frequently portaled outside the
          // form. Associate it with the submitting form through the action,
          // never through application text or a product-specific selector.
          const feedbackSelector = '[role="alert"],[role="status"],[aria-live]:not([aria-live="off"])';
          const feedbackNode = candidate => {
            if (!candidate || candidate.nodeType !== 1) return false;
            try { return candidate.matches?.(feedbackSelector) || candidate.closest?.(feedbackSelector) || candidate.querySelector?.(feedbackSelector); } catch { return false; }
          };
          if (feedbackNode(mutation.target)) validationFeedbackMutations += 1;
          if (mutation.type === 'childList') for (const node of Array.from(mutation.addedNodes || [])) {
            let portalSurface = null;
            const inheritedPortalFormRef = portalFormRefs.get(mutation.target) || null;
            if (inheritedPortalFormRef && node?.nodeType === 1) {
              portalFormRefs.set(node, inheritedPortalFormRef);
              try { for (const nested of Array.from(node.querySelectorAll?.('*') || [])) portalFormRefs.set(nested, inheritedPortalFormRef); } catch {}
            } else if (formDescription?.ref && node?.nodeType === 1) {
              try { portalSurface = node.matches?.('[role="dialog"],[role="listbox"],[role="menu"]') ? node : node.querySelector?.('[role="dialog"],[role="listbox"],[role="menu"]'); } catch {}
            }
            if (portalSurface) {
              portalFormRefs.set(portalSurface, formDescription.ref);
              try { for (const nested of Array.from(portalSurface.querySelectorAll?.('*') || [])) portalFormRefs.set(nested, formDescription.ref); } catch {}
            }
            rememberAddedForm(node);
            rememberAddedControl(node);
            if (feedbackNode(node)) validationFeedbackMutations += 1;
            try { for (const nested of Array.from(node.querySelectorAll?.('form') || [])) rememberAddedForm(nested); } catch {}
            try { for (const nested of Array.from(node.querySelectorAll?.('button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[tabindex]') || [])) rememberAddedControl(nested); } catch {}
          }
        }
      };
      const observer = new global.MutationObserver(onMutations);
      try { observer.observe(global.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {}
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true; openReceipts.delete(finish);
        try { const pending = observer.takeRecords(); if (pending.length) onMutations(pending); } catch {}
        observer.disconnect();
        const active = global.document.activeElement;
        const focusInForm = Boolean(form && active && form.contains?.(active));
        let focusMovedToInvalidField = false;
        if (focusInForm) {
          try { focusMovedToInvalidField = active.getAttribute?.('aria-invalid') === 'true' || active.matches?.(':invalid') === true; } catch {}
        }
        if (receipt.count || focusMovedToInvalidField) emit({ kind: 'dom.mutation', action_id, ...receipt,
          ...(formDescription ? { form: formDescription, form_ref: formDescription.ref, form_mutation: formReceipt } : {}),
          ...(addedForms.size ? { added_forms: [...addedForms.values()] } : {}),
          ...(addedControls.size ? { added_controls: [...addedControls.values()] } : {}),
          validation: { same_form: formReceipt.count > 0 || Boolean(form && validationFeedbackMutations), aria_invalid_changed: ariaInvalidChanged, focus_moved_to_invalid_field: focusMovedToInvalidField,
            feedback_mutations: validationFeedbackMutations,
            ...(focusMovedToInvalidField ? { invalid_target: describe(active) } : {}) },
        });
      };
      const validationWindow = event.type === 'submit' && Boolean(form);
      openReceipts.set(finish, { validation: validationWindow || formInvalid, gesture_id: meta.gesture_id ?? null });
      (hostSetTimeout || (fn => Promise.resolve().then(fn)))(finish, validationWindow ? 750 : 0);
    }
    // The dispatch frame is live while the browser reports this event as the
    // one being dispatched (window.event). Continuations created while it is
    // current (a form library's await before the app's onSubmit, a timer, a
    // promise) capture it; nothing picks it up at run time. Where
    // window.event is not observable, the host timer pops it instead.
    if (!EVENT_OBSERVABLE) { const frame = current; (hostSetTimeout || (fn => Promise.resolve().then(fn)))(() => { if (current === frame) current = frame.parent || null; }, 0); }
    return action_id;
  };
  // ---- The dispatch listeners (D-G1-21) ---------------------------------------
  // One capture-phase listener per discovered kind at the window, and the same
  // inside every shadow root (a non-composed event there never reaches the
  // window). Each event is handled once (the first listener to see it).
  // Untrusted events are not recorded (their listeners run on the
  // dispatcher's frame); an untrusted click dispatched by live action code is
  // remembered as a synthetic activation of its target.
  const userEventDiscovery = userEventModel.discover();
  const gestureOf = userEventModel.createTracker({ nextId: () => `gesture:${++gestureSequence}`, defer: fn => (hostSetTimeout || (task => Promise.resolve().then(task)))(fn, 0) });
  const seenEvents = new WeakSet();
  const userEventCounts = { recorded: Object.create(null), coalesced: Object.create(null), ranges: 0, hover_segments: 0, untrusted_skipped: 0, untrusted_by_kind: Object.create(null), not_user: Object.create(null) };
  materializeFor = actionId => { const pending = pendingActions.get(actionId); if (pending) materialize(pending); };
  keepPending = actionId => { if (actionId && pendingActions.size) { const pending = pendingActions.get(actionId); if (pending) pending.keep = true; } };
  const notUserSeen = new WeakMap(); // target -> Set of kinds already written
  let lifecycleSequence = 0;
  const realTarget = event => { try { const first = event.composedPath?.()[0]; return first && typeof first === 'object' ? first : event.target; } catch { return event.target; } };
  const hoverDispatch = (event, meta) => {
    const kind = meta.segment || 'hover';
    const key = `${kind}\u0000${meta.gesture_id}`;
    let segment = openRanges.get(key);
    if (segment && segment.count >= RANGE_MAX_EVENTS) { closeRange(segment, 'size_bound'); segment = null; }
    const target = event.target;
    if (!segment) {
      const { actionTarget } = dispatchTargets(event);
      const action_id = newActionId();
      const first = describeLight(actionTarget);
      segment = { key, action_id, event: event.type, gesture_id: meta.gesture_id, target_ref: first?.ref || null, segment: kind, count: 0, by_kind: Object.create(null),
        controls: new Set(), pending: new Map(), lastByType: Object.create(null), first_control: first, last_node: actionTarget, first_timestamp: Date.now(), last_timestamp: Date.now(), bounds: null, closed: false };
      openRanges.set(key, segment); userEventCounts.hover_segments += 1;
      emit({ kind: 'dom.action', action_id, event: event.type, target: first, ...(first?.ref ? { target_ref: first.ref } : {}), interface: userEventModel.interfaceOf(event),
        phase: 'continuous', gesture_id: meta.gesture_id, coalesced: true, segment: kind, ...describeEvent(event, actionTarget),
        source_ref: null, parent_continuation_id: null, continuation_id: null, spine: { action_id, function_ids: [] }, evidence_ids: [] });
    }
    // Last (target, pending) per kind: pointer moves over one control hit it.
    const last = segment.lastByType[event.type];
    let pending;
    if (last && last.target === target) pending = last.pending;
    else {
      const { actionTarget } = dispatchTargets(event);
      const handle = identity(actionTarget)?.handle || '';
      const pendingKey = `${event.type}\u0000${handle}`;
      pending = segment.pending.get(pendingKey);
      if (!pending) {
        pending = { action_id: newActionId(), event: event.type, node: actionTarget, target_ref: handle, interface: userEventModel.interfaceOf(event), gesture_id: meta.gesture_id,
          source: event, timestamp: Date.now(), page: pagePath(), page_title: pageTitle(), count: 0, materialized: false, keep: false, segment, continuation_id: null };
        segment.pending.set(pendingKey, pending); pendingActions.set(pending.action_id, pending);
      }
      segment.controls.add(handle); segment.last_node = actionTarget;
      segment.lastByType[event.type] = { target, pending };
    }
    pending.count += 1; segment.by_kind[event.type] = (segment.by_kind[event.type] || 0) + 1;
    // Until work runs under it, the latest event is the one to describe: the
    // element it entered is the one whose handler is about to run.
    if (!pending.materialized) { pending.source = event; pending.page = pagePath(); pending.page_title = pageTitle(); }
    extendRange(segment, event, target);
    // One dispatch frame per event (its liveness is the event's), sharing the
    // (kind, control)'s continuation id.
    const { dispatchTarget, closedHost } = dispatchTargets(event);
    const frame = actionFrame(pending.action_id, event, settleAmbient(), closedHost || dispatchTarget, null, pending.continuation_id);
    pending.continuation_id = frame.continuation_id; current = frame;
  };
  let rootsListened = 0, syntheticLinks = 0;
  const onDispatch = event => {
    try {
      if (!event || typeof event !== 'object') return;
      // Seen twice only when a shadow root listens as well as the window.
      if (rootsListened) { if (seenEvents.has(event)) return; seenEvents.add(event); }
      if (!event.isTrusted) {
        // Never a user action (its listeners run on the dispatcher's frame);
        // written as a dom.untrusted row so the window it fell in can say so.
        userEventCounts.untrusted_skipped += 1; userEventCounts.untrusted_by_kind[event.type] = (userEventCounts.untrusted_by_kind[event.type] || 0) + 1;
        const frame = settleAmbient();
        const target = realTarget(event);
        let activation = null;
        if (event.type === 'click' && frameLive(frame) && frame.action_id && !frame.scheduler && !frame.stale_owner && target && typeof target === 'object') {
          activation = { action_id: frame.action_id, continuation_id: frame.continuation_id || null };
          syntheticActivations.set(target, activation); syntheticLinks += 1;
        }
        const described = target && target.nodeType === 1 ? describeControl(interactiveFor(target)) : null;
        emit({ kind: 'dom.untrusted', event: event.type, interface: userEventModel.interfaceOf(event), target: described, ...(described?.ref ? { target_ref: described.ref } : {}),
          ...(frame?.action_id ? { dispatched_under_action_id: frame.action_id } : {}), ...(activation ? { synthetic_activation: true } : {}) });
        return;
      }
      if (!userEventModel.isUserEvent(event)) {
        // Classified not user-caused: never an action; the first of each kind
        // per target is written as a dom.event row (user: false), every one is counted.
        userEventCounts.not_user[event.type] = (userEventCounts.not_user[event.type] || 0) + 1;
        const target = event.target;
        if (target && typeof target === 'object') {
          let kinds = notUserSeen.get(target); if (!kinds) { kinds = new Set(); notUserSeen.set(target, kinds); }
          if (!kinds.has(event.type)) {
            kinds.add(event.type);
            // Its own counter (like stamps): page-lifecycle events arrive in
            // network order, so they never consume the attribution sequence.
            const described = target === global ? { tag: '#window', attributes: {} } : (target.nodeType === 1 ? describeControl(target) : { ...describe(target), node: target.nodeName ? String(target.nodeName).toLowerCase() : null });
            const record = { schema: 'producttrace.runtime-evidence.v1', kind: 'dom.event', event_sequence: ++lifecycleSequence, timestamp: Date.now(), session: pageSession,
              event: event.type, user: false, interface: userEventModel.interfaceOf(event), target: described, ...(described?.ref ? { target_ref: described.ref } : {}) };
            records.push(record);
            try { global.__producttraceHostCapture?.(JSON.stringify({ channel: 'dom-event', row: record })); } catch { hostErrors += 1; }
          }
        }
        return;
      }
      const meta = gestureOf(event);
      // The user acting on an element (a UIEvent not dispatched by live
      // action code) clears a synthetic activation link; a picker's result
      // events (not UIEvents) carry it.
      if (syntheticLinks) try {
        const target = realTarget(event), link = target && syntheticActivations.get(target);
        if (link) { if (!userEventModel.isUI(event)) meta.opened = link; else if (!frameLive(settleAmbient())) syntheticActivations.delete(target); }
      } catch {}
      if (meta.phase === 'continuous') {
        userEventCounts.coalesced[event.type] = (userEventCounts.coalesced[event.type] || 0) + 1;
        // A top-level continuous dispatch starts a later task: receipts whose
        // window is "until the next task" stop here (see openReceipts).
        if (openReceipts.size && !frameLive(settleAmbient())) closeReceipts(null, { continuous: true });
        if (meta.hover || meta.segment) { hoverDispatch(event, meta); return; }
        const { dispatchTarget, actionTarget } = dispatchTargets(event);
        const rangeKey = `${event.type}\u0000${identity(actionTarget)?.handle || ''}\u0000${meta.gesture_id || ''}`;
        let open = openRanges.get(rangeKey);
        if (open && open.count >= RANGE_MAX_EVENTS) { closeRange(open, 'size_bound'); open = null; }
        if (open) {
          // The range's action runs this dispatch: listeners it invokes see a
          // live dispatch frame of the range's action, as for a discrete event.
          extendRange(open, event, dispatchTarget);
          current = actionFrame(open.action_id, event, settleAmbient(), dispatchTarget, open.cause || null);
          return;
        }
        userEventCounts.ranges += 1;
        beginDomAction(event, { ...meta, range_key: rangeKey });
        return;
      }
      userEventCounts.recorded[event.type] = (userEventCounts.recorded[event.type] || 0) + 1;
      beginDomAction(event, meta);
    } catch { hostErrors += 1; }
  };
  const listenOn = target => {
    const add = bodyListen || target?.addEventListener; if (!target || typeof add !== 'function') return;
    for (const name of userEventDiscovery.listened) { try { add.call(target, name, onDispatch, { capture: true, passive: true }); } catch {} }
  };
  // The window (first in every capture path); a host with no window object
  // that still has a document listens there.
  listenOn(typeof global.addEventListener === 'function' ? global : global.document);
  listenInRoot = root => { rootsListened += 1; listenOn(root); };
  // Every listened kind can start an action (recorded per dispatch by interface); capture.page.observes reads this list.
  const actionListeners = [...userEventDiscovery.listened];
  if (global.addEventListener) global.addEventListener('pagehide', () => { closeRanges('pagehide'); if (lastActionWindow) flushFunctionWindow(lastActionWindow); });
  const currentReactFiber = () => { for (const renderer of reactRenderers.values()) { try { const fiber = renderer?.getCurrentFiber?.(); if (fiber) return fiber; } catch {} } return null; };
  // ---- Observed handler bindings (D-G1-22) ----------------------------------
  // Binding is observed, not declared. When a first-party function is entered
  // at depth zero under a live trusted dispatch frame (nothing first-party
  // between it and the dispatch: React's root listener, a library's
  // listener, or a native listener called it while the browser was
  // dispatching that event), or in a bare continuation that dispatch created
  // (a library that awaits before calling the app's handler), and the
  // function is held by an on* prop of a fiber on the dispatch target's fiber
  // chain (its value, or a first-party function written inside it at that
  // placement), or is a first-party listener added with addEventListener on
  // the event's currentTarget element, it is bound to THAT dispatch: one
  // `handler.binding` row per (action, function, prop, holder). No prop name
  // is mapped to an event type: a checkbox's onChange run by React on `click`
  // is recorded as bound to the click because it ran during the click.
  // A dispatch caused by live code (el.focus() firing onFocus; dispatchCause)
  // is not a user's: the same fact is a `handler.invocation` with
  // invoked_by "app_code" and the cause, never a binding to a user event.
  // Identifiers only (action, continuation, function, fiber, placement).
  const bindingsSeen = new Set();
  const chainPropsByEvent = new WeakMap(); // dispatched event -> Map(function_id -> holders)
  const reactPropsOf = node => { try { for (const key of Object.keys(node)) if (key.startsWith('__reactProps$')) return node[key]; } catch {} return null; };
  const fiberName = fiber => { try { const type = fiber?.type; if (typeof type === 'string') return type; const inner = type?.render || type?.type || null;
    const name = type?.displayName || type?.name || inner?.displayName || inner?.name || null; return typeof name === 'string' && name ? name : null; } catch { return null; } };
  const chainPropsFor = (event, target) => {
    let holders = chainPropsByEvent.get(event); if (holders) return holders;
    holders = new Map(); chainPropsByEvent.set(event, holders);
    if (typeof reactFiberKeyOf !== 'function') return holders;
    let fiberNode = null, key = null;
    for (let element = target, hops = 0; listenerTarget(element) && hops < 512; element = element.nodeType === 11 ? element.host : element.parentNode, hops += 1) {
      const own = reactFiberKeyOf(element); if (own) { key = own; fiberNode = element; break; }
    }
    if (!key) return holders;
    let depth = 0;
    for (let fiber = fiberNode[key]; fiber && depth < 1024; fiber = fiber.return, depth += 1) {
      const host = fiber.tag === 5, seen = new Set();
      const propSets = [host ? reactPropsOf(fiber.stateNode) : null, fiber.memoizedProps, fiber.alternate?.memoizedProps];
      let placementIndex = null;
      for (const props of propSets) { if (props && typeof props === 'object' && placementIndex === null) { const index = placementsByProps.get(props); if (index !== undefined) placementIndex = index; } }
      const placement = placementIndex === null ? null : placementTable.get(placementIndex) || null;
      const add = (function_id, prop, via) => {
        const mark = `${function_id}\u0000${prop}\u0000${via}`; if (seen.has(mark)) return; seen.add(mark);
        const list = holders.get(function_id) || []; if (list.length >= 8) return;
        list.push({ prop, via, fiber: { kind: host ? 'host' : 'component', name: fiberName(fiber), depth }, placement_id: placement?.id || null, node: host ? fiber.stateNode : null }); holders.set(function_id, list);
      };
      for (const props of propSets) {
        if (!props || typeof props !== 'object') continue;
        for (const prop of Object.keys(props)) { if (!/^on[A-Z]/u.test(prop)) continue; const id = functionIdOf(props[prop]); if (id) add(id, prop, 'prop_value'); }
      }
      if (placement?.bound) for (const [prop, indexes] of Object.entries(placement.bound)) for (const index of indexes) add(resolveFunctionId(index), prop, 'written_in_prop');
    }
    return holders;
  };
  // Who was invoking listeners when the handler entered: the event's
  // currentTarget. React delegates to its root and portal containers (an
  // element marked `_reactListening…`) and listens directly on some elements
  // (`__reactEvents$…`); the document's marker is only for React's
  // selectionchange, so a document or window listener is never React's.
  // A label, not an input to the binding (which is the prop-chain match).
  const invokerOf = event => {
    const node = event.currentTarget;
    if (!node) return { invoked_by: 'unknown', listener_on: null };
    if (node === global) return { invoked_by: 'native_listener', listener_on: 'window' };
    if (node.nodeType === 9) return { invoked_by: 'native_listener', listener_on: 'document' };
    if (node.nodeType === 1 && typeof reactEventTarget === 'function' && reactEventTarget(node)) return { invoked_by: 'react_event_system', listener_on: 'react_container' };
    return { invoked_by: 'native_listener', listener_on: node.nodeType === 11 ? 'shadow_root' : 'element' };
  };
  // Which holder React invoked (grade 2026-09-24, change 1). A function can
  // be held by several (prop, holder) pairs on the chain (onKeyDown={h}
  // onClick={h}; onMouseDown={h} on a button inside onClick={h}). The holder
  // is decided from what the dispatch shows at entry, never from prop order:
  //  - the handler's first argument (`a0`, passed by the build when the
  //    function's first parameter is a plain identifier) is React's
  //    SyntheticEvent for this native event (`nativeEvent === event`): its
  //    `_reactName` is the prop React is invoking and its `currentTarget` the
  //    host element holding it (React's own runtime state, no map);
  //  - else React's event system only invokes host props, so when React is
  //    the invoker only host holders are candidates; a single (prop, holder),
  //    or one prop passed down unchanged through component props, is decided;
  //  - else the prop is `ambiguous`: prop_name null (or the one shared prop
  //    name when only the host differs) and every holder listed.
  // Tracer's own read of a handler's argument must never become evidence: a
  // getter or Proxy trap it triggers runs app code, whose entries are not
  // recorded while `inspectingArgument` is set (see enter).
  let inspectingArgument = false;
  // Own data properties only (no getters are called). A Proxy's
  // getOwnPropertyDescriptor trap still runs (no operation on a Proxy is
  // unobservable), under the guard above.
  const ownValue = (object, key) => { const descriptor = Object.getOwnPropertyDescriptor(object, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; };
  const readSynthetic = (arg, event) => {
    if (!arg.has) return { reason: 'no_argument' };
    const value = arg.value;
    if (!value || typeof value !== 'object') return { reason: 'argument_not_a_react_synthetic_event' };
    const previous = inspectingArgument; inspectingArgument = true;
    try {
      const reactName = ownValue(value, '_reactName');
      if (typeof reactName !== 'string') return { reason: 'argument_not_a_react_synthetic_event' };
      if (ownValue(value, 'nativeEvent') !== event) return { reason: 'event_for_a_different_native_event' };
      return { reactName, currentNode: ownValue(value, 'currentTarget') || null };
    } catch { return { reason: 'argument_not_readable' }; } finally { inspectingArgument = previous; }
  };
  // Which holder React invoked (grade changes 1; regrade changes 1, 2, 4).
  // A function can be held by several (prop, holder) pairs on the chain. The
  // holder is decided from observed dispatch state, never from prop order:
  //  - phase: React runs capture-phase props (`on<X>Capture`) from its
  //    root's capture listener and bubble props from its bubble listener, so
  //    the native event's `eventPhase` while React's container is the
  //    currentTarget says which pass is running (1 capture, 3 bubble; 2, at
  //    target, is undecided). This uses React's `Capture` suffix, the only
  //    name convention read, and only to split the two passes;
  //  - the handler's first argument, when it is React's SyntheticEvent for
  //    this native event: `_reactName` (the bubble name in React 17-19) plus
  //    the phase gives the prop, `currentTarget` the host. It is read only
  //    when a host prop holds the function (React invokes host props itself);
  //  - else, with React invoking, only host holders of the running pass are
  //    candidates; one is `unique`, one prop passed down unchanged through
  //    component props is `passed_down`;
  //  - else `ambiguous`, with every candidate holder and the reason observed.
  const resolveHolder = (matches, arg, event, invoker) => {
    // One holder is one (prop, fiber): a function that is both the prop's value and written inside it is one holder (the value wins).
    const holderKey = entry => entry.via === 'element_listener' ? `listener\u0000${entry.listener_on}\u0000${entry.depth}` : `${entry.prop}\u0000${entry.fiber?.depth ?? ''}`;
    const distinct = list => { const seen = new Set(); return [...list].sort((left, right) => (left.via === 'written_in_prop') - (right.via === 'written_in_prop'))
      .filter(entry => { const key = holderKey(entry); if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((left, right) => (left.fiber?.depth ?? left.depth ?? -1) - (right.fiber?.depth ?? right.depth ?? -1)); };
    const all = distinct(matches);
    const listener = all.find(entry => entry.via === 'element_listener');
    if (listener) return { chosen: listener, resolution: 'element_listener', others: all.filter(entry => entry !== listener) };
    const react = invoker.invoked_by === 'react_event_system';
    const phase = react ? event.eventPhase : 0;
    const capture = entry => /Capture$/u.test(String(entry.prop));
    const inPass = entry => phase === 1 ? capture(entry) : phase === 3 ? !capture(entry) : true;
    const hosts = all.filter(entry => entry.fiber?.kind === 'host');
    let reason = null;
    if (react && hosts.length) {
      const seen = readSynthetic(arg, event);
      if (seen.reactName) {
        const names = phase === 1 ? [`${seen.reactName}Capture`] : phase === 3 ? [seen.reactName] : [seen.reactName, `${seen.reactName}Capture`];
        const atTarget = all.filter(entry => names.includes(entry.prop) && entry.node && entry.node === seen.currentNode);
        if (atTarget.length === 1) return { chosen: atTarget[0], resolution: 'synthetic_event', others: all.filter(entry => entry !== atTarget[0]) };
        reason = atTarget.length > 1 ? 'capture_bubble_undecided' : 'react_name_matched_no_single_holder';
      } else reason = seen.reason;
    } else if (react) reason = 'argument_not_read_component_prop';
    else reason = 'not_invoked_by_react';
    // An argument that was seen and is not React's event for this dispatch
    // means React did not invoke this call through a host prop (React always
    // passes its SyntheticEvent): a library called the function. Host
    // holders are then not candidates.
    const libraryCall = react && hosts.length && reason && !['no_argument', 'argument_not_readable'].includes(reason);
    const components = all.filter(entry => entry.fiber?.kind !== 'host');
    const passHosts = hosts.filter(inPass);
    const pool = libraryCall ? (components.length ? components : hosts) : react && passHosts.length ? passHosts : react && hosts.length ? hosts : all;
    if (libraryCall && !components.length) return { chosen: null, resolution: 'ambiguous', reason, prop: null, holders: pool, others: [] };
    const props = [...new Set(pool.map(entry => entry.prop))];
    if (pool.length === 1) return { chosen: pool[0], resolution: libraryCall ? 'library_call' : react && phase && hosts.length > 1 ? 'dispatch_phase' : 'unique', others: all.filter(entry => entry !== pool[0]) };
    if (props.length === 1 && pool.every(entry => entry.fiber?.kind === 'component')) return { chosen: pool[0], resolution: 'passed_down', others: all.filter(entry => entry !== pool[0]) };
    if (react && phase === 2 && pool.some(capture) && pool.some(entry => !capture(entry)) && reason !== 'capture_bubble_undecided') reason = reason || 'capture_bubble_undecided';
    return { chosen: null, resolution: 'ambiguous', reason, prop: props.length === 1 ? props[0] : null, holders: pool, others: all.filter(entry => !pool.includes(entry)) };
  };
  const publicHolder = entry => ({ prop: entry.prop, via: entry.via, fiber: entry.fiber, placement_id: entry.placement_id, ...(entry.listener_on ? { listener_on: entry.listener_on } : {}) });
  // Untrusted dispatches (el.click(), dispatchEvent from app code) open no
  // action frame; their handlers run nested in the caller. One invocation row
  // per (event, function) says that the element's handler ran for a dispatch
  // app code made (grade change 4).
  const untrustedSeen = new WeakMap();
  const observeUntrusted = (frame, parent, arg) => {
    let event = null; try { event = global.event; } catch {}
    if (!event || event.isTrusted !== false || event.eventPhase === 0 || typeof event.type !== 'string') return;
    const invoker = invokerOf(event);
    if (invoker.invoked_by !== 'react_event_system' && invoker.listener_on !== 'element' && invoker.listener_on !== 'shadow_root') return;
    let seen = untrustedSeen.get(event); if (!seen) { seen = new Set(); untrustedSeen.set(event, seen); }
    if (seen.has(frame.function_id)) return;
    let target = event.target; try { const path = event.composedPath?.(); if (path && path[0]) target = path[0]; } catch {}
    const matches = [...(chainPropsFor(event, target).get(frame.function_id) || [])];
    const node = event.currentTarget;
    if (node && (node.nodeType === 1 || node.nodeType === 11) && !pageLevelNode(node)) for (const listener of elementListeners.get(node)?.get(event.type) || []) if (functionIdOf(listener) === frame.function_id) {
      matches.push({ prop: null, via: 'element_listener', fiber: null, placement_id: null, node: null, depth: listenerDistance(event, target, node), listener_on: describe(node.nodeType === 11 ? node.host : node)?.tag || null }); break;
    }
    if (!matches.length) return;
    seen.add(frame.function_id);
    const resolved = resolveHolder(matches, arg, event, invoker);
    const cause = parent?.action_id && !parent.scheduler && !parent.stale_owner ? { caused_by_action_id: parent.action_id, caused_by_continuation_id: parent.continuation_id || null }
      : { caused_by_action_id: null, caused_by_continuation_id: parent?.continuation_id || null, cause_abstained: !parent ? 'no_live_frame' : parent.stale_owner ? 'stale_frame' : parent.scheduler ? 'scheduler_lineage' : 'no_action_on_frame' };
    emit({ kind: 'handler.invocation', action_id: frame.action_id || null, untrusted: true, event_kind: event.type, native_event_type: event.type,
      prop_name: resolved.chosen ? resolved.chosen.prop : resolved.prop ?? null, function_id: frame.function_id, continuation_id: frame.continuation_id, parent_continuation_id: parent?.continuation_id || null,
      ran: 'during_untrusted_dispatch', via: resolved.chosen?.via ?? null, fiber: resolved.chosen?.fiber ?? null, placement_id: resolved.chosen?.placement_id ?? null, holder_resolution: resolved.resolution,
      ...(resolved.chosen ? {} : { ambiguous: true, ambiguity_reason: resolved.reason ?? null, holders: resolved.holders.slice(0, 8).map(publicHolder) }),
      invoked_by: 'app_code', dispatched_by: invoker.invoked_by, listener_on: resolved.chosen?.listener_on || invoker.listener_on, ...cause });
  };
  const pageLevelNode = node => { try { const doc = global.document; return node === doc?.body || node === doc?.documentElement || (node.nodeType === 1 && typeof reactEventTarget === 'function' && reactEventTarget(node) && !reactFiberKeyOf?.(node)); } catch { return false; } };
  // Hops from the dispatch target up to a listener's element, counted on the
  // fiber chain when React rendered it (so it compares with prop holders),
  // else on the composed DOM path.
  const listenerDistance = (event, target, node) => {
    const holders = chainPropsFor(event, target);
    for (const list of holders.values()) for (const entry of list) if (entry.node === node) return entry.fiber.depth;
    let hops = 0; for (let cursor = target; cursor && cursor !== node && hops < 1024; cursor = cursor.nodeType === 11 ? cursor.host : cursor.parentNode) hops += 1;
    return hops;
  };
  const observeBinding = (frame, parent, arg = { has: false }) => {
    if (!parent || frame.invoked_by === 'render' || frame.invoked_by === 'effect') return;
    let dispatch = null, ran = null;
    if (parent.dispatch) { dispatch = parent; ran = 'during_dispatch'; }
    else if (parent.bare && parent.origin_dispatch && parent.action_id === parent.origin_dispatch.action_id) { dispatch = parent.origin_dispatch; ran = 'dispatch_continuation'; }
    if (!dispatch || frame.spine.length !== 1) { if (!parent.dispatch && parent.function_id !== frame.function_id) observeUntrusted(frame, parent, arg); return; }
    const event = dispatch?.event;
    if (!event || event.isTrusted !== true || !dispatch.dispatch_action_id || !frame.action_id) return;
    const bindingActionId = dispatch.dispatch_action_id;
    const matches = [...(chainPropsFor(event, dispatch.target || event.target).get(frame.function_id) || [])];
    let invoker = ran === 'during_dispatch' ? invokerOf(event) : { invoked_by: 'dispatch_continuation', listener_on: null };
    const node = ran === 'during_dispatch' ? event.currentTarget : null;
    if (node && (node.nodeType === 1 || node.nodeType === 11)) {
      // A first-party listener added on the element the browser is invoking
      // listeners on (on the event's path by definition). React may also
      // listen on that element (its non-delegated `__reactEvents$` set, e.g.
      // `invalid` on every input), so a listener match decides the invoker.
      // A listener on <body>, <html> or a React root/portal container is
      // page-level (regrade change 3): it hears every event of the page and
      // is never bound to the element; it stays a global listener.
      for (const listener of elementListeners.get(node)?.get(event.type) || []) if (functionIdOf(listener) === frame.function_id) {
        if (pageLevelNode(node)) return;
        matches.push({ prop: null, via: 'element_listener', fiber: null, placement_id: null, node: null, depth: listenerDistance(event, dispatch.target || event.target, node),
          listener_on: describe(node.nodeType === 11 ? node.host : node)?.tag || null });
        invoker = { invoked_by: 'native_listener', listener_on: node.nodeType === 11 ? 'shadow_root' : 'element' };
        break;
      }
    }
    if (!matches.length) {
      // Grade change 3: a first-party function that ran at depth zero for
      // this dispatch, held by no prop, but called by code that is not a
      // document/window listener (a library's prop handler that React
      // invoked, a library's listener on an element, or a continuation the
      // dispatch created with nothing first-party in between) ran through
      // library code on the element chain: never a global listener.
      if (invoker.listener_on === 'document' || invoker.listener_on === 'window') return;
      if (node && pageLevelNode(node) && [...(elementListeners.get(node)?.get(event.type) || [])].some(listener => functionIdOf(listener) === frame.function_id)) return;
      const mark = `${bindingActionId}\u0000${frame.function_id}\u0000via_library`;
      if (bindingsSeen.has(mark)) return; bindingsSeen.add(mark);
      emit({ kind: 'handler.via_library', action_id: bindingActionId, native_event_type: event.type, function_id: frame.function_id, continuation_id: frame.continuation_id,
        parent_continuation_id: parent.continuation_id || null, ran, invoked_by: invoker.invoked_by, listener_on: invoker.listener_on, ...(dispatch.cause ? { caused: true } : {}) });
      return;
    }
    frame.bound = true;
    const resolved = resolveHolder(matches, arg, event, invoker);
    const holder = resolved.chosen;
    // Nearness to the target (fiber hops; a listener's element measured on the same chain): the credit's tie-break among bound frames.
    frame.bound_distance = holder ? (holder.fiber?.depth ?? holder.depth ?? Infinity) : Math.min(...resolved.holders.map(entry => entry.fiber?.depth ?? entry.depth ?? Infinity));
    const mark = `${bindingActionId}\u0000${frame.function_id}\u0000${holder ? `${holder.prop}\u0000${holder.via}\u0000${holder.fiber?.depth ?? holder.depth ?? ''}` : `ambiguous\u0000${resolved.holders.map(entry => `${entry.prop}@${entry.fiber?.depth}`).join(',')}`}`;
    if (bindingsSeen.has(mark)) return;
    if (bindingsSeen.size > 50000) bindingsSeen.clear();
    bindingsSeen.add(mark);
    const fact = { action_id: bindingActionId, event_kind: event.type, native_event_type: event.type, prop_name: holder ? holder.prop : resolved.prop ?? null, function_id: frame.function_id,
      continuation_id: frame.continuation_id, parent_continuation_id: parent.continuation_id || null, ran, via: holder?.via ?? null,
      fiber: holder?.fiber ?? null, placement_id: holder?.placement_id ?? null, holder_resolution: resolved.resolution, ...(holder?.listener_on ? { listener_on: holder.listener_on } : {}),
      ...(holder ? {} : { ambiguous: true, ambiguity_reason: resolved.reason ?? null, holders: resolved.holders.slice(0, 8).map(publicHolder) }),
      ...(resolved.others.length ? { also_held_by: resolved.others.slice(0, 4).map(publicHolder) } : {}),
      ...(Number.isFinite(frame.bound_distance) ? { holder_distance: frame.bound_distance } : {}) };
    if (dispatch.cause) emit({ kind: 'handler.invocation', ...fact, invoked_by: 'app_code', dispatched_by: invoker.invoked_by, listener_on: fact.listener_on || invoker.listener_on,
      caused_by_action_id: dispatch.cause.caused_by_action_id ?? null, caused_by_continuation_id: dispatch.cause.caused_by_continuation_id ?? null,
      ...(dispatch.cause.cause_abstained ? { cause_abstained: dispatch.cause.cause_abstained } : {}) });
    else emit({ kind: 'handler.binding', ...fact, invoked_by: invoker.invoked_by, listener_on: fact.listener_on || invoker.listener_on });
  };
  const invokedBy = function_id => {
    if (current?.invoked_by === 'render' || current?.invoked_by === 'effect') return current.invoked_by;
    if (reactRendering()) return 'render';
    const fiber = currentReactFiber();
    if (fiber || renderFunctionIds.has(function_id)) return 'render';
    if (effectFunctionIds.has(function_id)) return 'effect';
    if (current?.continuation_kind && current.continuation_kind !== 'action' && current.continuation_kind !== 'function') return 'async';
    return current?.action_id ? 'event' : 'async';
  };
  // Per action, and page-wide per window: a burst of actions (a held-down
  // undo key, each press its own action) must not flood the page either.
  // Each action's first rows (its handler, entered first, and the calls right
  // under it) are outside the page window, so every action keeps its handler name.
  const SPINE_MAX = 64, FUNCTION_ROWS_PER_ACTION = 5000, FUNCTION_ROWS_PER_WINDOW = 5000, FUNCTION_WINDOW_MS = 10000, FUNCTION_ROWS_RESERVED = 32;
  let pageWindowStart = 0, pageWindowRows = 0;
  const spineWith = (spine, function_id) => !spine?.length ? [function_id]
    : spine.length < SPINE_MAX ? [...spine, function_id] : [spine[0], ...spine.slice(spine.length - SPINE_MAX + 2), function_id];
  const functionRowsByAction = new Map();
  const functionRowBudget = action_id => {
    const used = functionRowsByAction.get(action_id) || 0;
    if (used === FUNCTION_ROWS_PER_ACTION) reportLimit({ kind: 'capture.limit', feature: 'function_rows', reason: 'per_action_budget', action_id, limit: FUNCTION_ROWS_PER_ACTION });
    functionRowsByAction.set(action_id, used + 1);
    const now = Date.now();
    if (now - pageWindowStart >= FUNCTION_WINDOW_MS) { pageWindowStart = now; pageWindowRows = 0; }
    if (used < FUNCTION_ROWS_RESERVED) return true;
    if (used < FUNCTION_ROWS_PER_ACTION && pageWindowRows < FUNCTION_ROWS_PER_WINDOW) { pageWindowRows += 1; return true; }
    if (used < FUNCTION_ROWS_PER_ACTION && pageWindowRows === FUNCTION_ROWS_PER_WINDOW) {
      pageWindowRows += 1;
      reportLimit({ kind: 'capture.limit', feature: 'function_rows', reason: 'page_budget', action_id, limit: FUNCTION_ROWS_PER_WINDOW, window_ms: FUNCTION_WINDOW_MS });
    }
    functionWindowCounts.set(action_id, (functionWindowCounts.get(action_id) || 0) + 1);
    return false;
  };
  const enter = function (function_id, metadata = null) { const function_index = typeof function_id === 'number' ? function_id : null; function_id = resolveFunctionId(function_id);
    // App code run by Tracer's own read of a handler argument (a getter or
    // Proxy trap, see readSynthetic) is not recorded: no frame, no rows, no
    // ownership. exit() restores exactly the frame current here.
    if (inspectingArgument) return { function_id, function_index, parent: current, action_id: null, emit_spine: false, suppressed: true, spine: [] };
    settleAmbient();
    const origin = invokedBy(function_id);
    // React work is not called by the action: a render runs on whatever
    // continuation React flushed it on (a microtask or scheduler message
    // created during some action, possibly carrying unrelated updates), and an
    // effect is owned only through a receipt (its wrapper sets the receipt
    // frame, which is not bare). Neither inherits the ambient action.
    const base = origin === 'render' || (origin === 'effect' && (!current || current.bare)) ? null : current;
    const parentContinuationId = current?.continuation_id || null; const frame = { function_id, function_index, parent: current, action_id: base?.action_id || null,
    continuation_id: continuationId(base?.action_id || 'unattributed', 'function'), parent_continuation_id: parentContinuationId,
    continuation_kind: 'function', invoked_by: origin, bare: false, dispatch: false, run: runToken(), stale_owner: staleOwner(base), scheduler: Boolean(base?.scheduler), entry_hint: Boolean(metadata?.entry_hint), state_receipt: Boolean(base?.state_receipt), react_commit_receipt: Boolean(base?.react_commit_receipt),
    // Which instrumentation entered: `call` the call-site proxy, `body` the
    // module pass's frame, `chunk` the chunk pass's frame of a leaf body. One
    // call can write several, nested in that order (the reader counts one).
    entry: metadata?.via_proxy ? 'call' : metadata?.pass === 'chunk' ? 'chunk' : 'body', response_of: base?.response_of || responseContext || null,
    // A spine keeps its root (the handler) and its newest frames: async
    // recursion (a render loop awaiting its next frame) would otherwise grow
    // it, and every row's copy of it, without bound.
    spine: spineWith(base?.spine, function_id) };
    // Retain every first-party entry on an action-owned continuation, up to
    // FUNCTION_ROWS_PER_ACTION; past that (a long export or render loop owned
    // by one click) calls are counted only, in function.window_count, and one
    // capture.limit row says so. Calls outside an action remain aggregate-only
    // unless explicit debug mode is enabled, keeping normal capture
    // proportional to dispatched actions.
    frame.emit_spine = Boolean(global.__PRODUCTTRACE_DEBUG_ALL_FUNCTIONS__) || (Boolean(frame.action_id) && functionRowBudget(frame.action_id));
    try { observeBinding(frame, current, { has: Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, 'a0')), value: metadata?.a0 }); } catch { hostErrors += 1; }
    current = frame;
    if (frame.action_id && frame.spine.length === 1 && origin !== 'render' && origin !== 'effect') {
      const prior = actionTerminalOwner.get(frame.action_id); const priority = frame.bound ? 3 : frame.entry_hint ? 2 : 1; const distance = frame.bound ? (frame.bound_distance ?? Infinity) : Infinity;
      // Keep the earliest frame at the strongest confidence: a handler
      // observed bound to this dispatch (D-G1-22) over a transform's
      // entry_hint (call-argument or onX-prop function, which a global
      // listener also carries) over any other depth-zero frame. A validator
      // may precede an event-handler hint, but a later lifecycle callback
      // with the same hint must not steal the handler's terminal evidence.
      // Among frames observed bound, the one nearest the target wins (its own
      // host prop before an ancestor's capture handler), whatever entered first.
      if (!prior || priority > prior.priority || (priority === 3 && prior.priority === 3 && distance < prior.distance)) actionTerminalOwner.set(frame.action_id, { continuation_id: frame.continuation_id, priority, distance });
    }
    if (frame.emit_spine) emit({ kind: 'function.enter', function_id, function_index, action_id: frame.action_id, parent_continuation_id: frame.parent_continuation_id,
      continuation_kind: frame.continuation_kind, invoked_by: frame.invoked_by, entry_hint: frame.entry_hint, entry: frame.entry,
      ...(frame.response_of ? { response_of: frame.response_of } : {}),
      continuation_id: frame.continuation_id, spine: { action_id: frame.action_id, function_ids: frame.spine } }); return frame; };
  const exit = function (frame) { if (frame?.emit_spine) emit({ kind: 'function.exit', function_id: frame?.function_id || null, function_index: frame?.function_index ?? null, action_id: frame?.action_id || null,
    parent_continuation_id: frame?.parent_continuation_id || null, continuation_id: frame?.continuation_id || null,
    continuation_kind: frame?.continuation_kind || null, invoked_by: frame?.invoked_by || 'async',
    spine: { action_id: frame?.action_id || null, function_ids: frame?.spine || [] },
    ...(frame.threw ? { threw: true, error_type: frame.error_type || 'unknown', ...(frame.error_class || {}) } : {}) });
    // Strict stack: restore exactly the frame that was current when this frame
    // was entered, even if a nested dispatch frame is still on top (a
    // programmatic focus() inside the handler) — it ends with its caller.
    if (frame && typeof frame === 'object') current = frame.parent || null; };
  // ---- Reject signals (outcome labels) ------------------------------------
  // The build's catch clause calls threw(frame, error) and rethrows, so the
  // app's control flow is unchanged. Only the error's constructor name is
  // kept, never its message. An error object thrown by an action-owned frame
  // is remembered by identity; if the page's own `error` / `unhandledrejection`
  // event later carries that same object, the error escaped the app uncaught
  // and one `action.uncaught_error` row is emitted for the owning action. An
  // error the app catches never reaches those events and yields no row.
  const errorOwners = new WeakMap();
  const errorTypeOf = error => {
    if (error === null) return 'null';
    if (typeof error !== 'object' && typeof error !== 'function') return typeof error;
    try { const name = error.constructor?.name; return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/u.test(name) ? name : 'unknown'; } catch { return 'unknown'; }
  };
  // Error class identity (never a name): the build registers each first-party
  // class by its source span's id (registerClass). `error_class_id` is that id
  // when the thrown object's own constructor is such a class; readers take the
  // source name from the manifest. `error_builtin` marks a constructor that is
  // the platform's global of that name (TypeError, DOMException), whose runtime
  // name is its real name. Anything else keeps only the runtime name, which a
  // minifier may have renamed.
  const registeredClasses = new WeakMap();
  const registerClass = (cls, id) => { try { if (typeof cls === 'function' && typeof id === 'string') registeredClasses.set(cls, id); } catch {} return cls; };
  const errorClassOf = error => {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return {};
    try {
      const ctor = error.constructor;
      if (typeof ctor !== 'function') return {};
      const id = registeredClasses.get(ctor);
      if (id) return { error_class_id: id };
      const name = ctor.name;
      return typeof name === 'string' && name && global[name] === ctor ? { error_builtin: true } : {};
    } catch { return {}; }
  };
  const threw = function (frame, error) {
    try {
      if (!frame || typeof frame !== 'object') return;
      frame.threw = true; frame.error_type = errorTypeOf(error); frame.error_class = errorClassOf(error);
      if (frame.action_id && error && (typeof error === 'object' || typeof error === 'function')) {
        const prior = errorOwners.get(error);
        // The first owning action stays; the frame is the outermost one the error left.
        errorOwners.set(error, { action_id: prior?.action_id || frame.action_id, function_id: frame.function_id || null,
          continuation_id: frame.continuation_id || null, error_type: frame.error_type, error_class: frame.error_class, reported: Boolean(prior?.reported) });
      }
    } catch {}
  };
  const reportUncaught = (error, via) => {
    try {
      if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
      const owner = errorOwners.get(error); if (!owner || owner.reported) return;
      owner.reported = true;
      emit({ kind: 'action.uncaught_error', action_id: owner.action_id, via, error_type: owner.error_type, ...(owner.error_class || {}),
        function_id: owner.function_id, continuation_id: owner.continuation_id });
    } catch {}
  };
  if (global.addEventListener) {
    global.addEventListener('error', event => reportUncaught(event?.error, 'uncaught_exception'), true);
    global.addEventListener('unhandledrejection', event => reportUncaught(event?.reason, 'unhandled_rejection'), true);
  }
  const wrapContinuation = fn => typeof fn === 'function' ? function (...args) { const previous = current; try { const context = this?.__productTraceActionContext; current = ownable(context) ? context : null; return fn.apply(this, args); } finally { current = previous; } } : fn;
  const nativeFetch = global.fetch?.bind(global);
  const traceHex = bytes => { const value = new Uint8Array(bytes); try { global.crypto?.getRandomValues?.(value); } catch {} return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''); };
  const traceContext = () => { const trace_id = traceHex(16); const span_id = traceHex(8); return { trace_id, span_id, trace_flags: '01', traceparent: `00-${trace_id}-${span_id}-01` }; };

  // ---- G3 element stamps -------------------------------------------------
  // `data-tracer-el` (and, when enabled, the declarative OAI annotation
  // attributes) are lookup keys for external agents. Attribution never reads
  // them; stamp rows use their own stamp_sequence so they cannot renumber
  // attribution rows. The page session id is drawn unconditionally so that
  // switching stamps off leaves every other random draw unchanged.
  const pageSession = `s_${traceHex(4)}`;
  const placementsByProps = new WeakMap(), placementTable = new Map(); let buildId = null;
  // Build-time wrapper target: `(globalThis.__productTracePlace||Object)(element, index)`.
  // Returns the element unchanged; only remembers which JSX site produced its props.
  global.__productTracePlace = function productTracePlace(element, index) {
    try { if (element && typeof element === 'object' && element.props && typeof element.props === 'object' && Number.isInteger(index)) placementsByProps.set(element.props, index); } catch {}
    return element;
  };
  const registerPlacements = rows => { for (const row of rows || []) if (Number.isInteger(row?.index) && typeof row.id === 'string' && typeof row.key === 'string') placementTable.set(row.index, row); };
  const registerBuild = id => { if (typeof id === 'string' && id) buildId = id; };
  const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$/u;
  const METADATA_STRING = /^[^\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]*$/u;
  const utf8Length = text => { let bytes = 0; for (let i = 0; i < text.length; i += 1) { const code = text.charCodeAt(i); if (code < 0x80) bytes += 1; else if (code < 0x800) bytes += 2; else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i += 1; } else bytes += 3; } return bytes; };
  // Implements HANDOFF-2026-09-23 §4.3 exactly; invalid metadata is never written.
  const validateAnnotationMetadata = payload => {
    const errors = [];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, errors: ['not_a_plain_object'] };
    const proto = Object.getPrototypeOf(payload);
    if (proto !== Object.prototype && proto !== null) errors.push('not_a_plain_object');
    if (Object.getOwnPropertySymbols(payload).length) errors.push('symbol_key');
    const keys = Object.getOwnPropertyNames(payload);
    if (keys.length > 6) errors.push('too_many_entries');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(payload, key);
      if (!descriptor || 'get' in descriptor || 'set' in descriptor) { errors.push(`accessor:${key}`); continue; }
      if (!descriptor.enumerable) errors.push(`non_enumerable:${key}`);
      if (key.length > 64) errors.push('key_too_long');
      if (!METADATA_KEY.test(key)) errors.push('key_syntax');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') errors.push('reserved_key');
      const value = descriptor.value;
      if (value === null || typeof value === 'boolean') continue;
      if (typeof value === 'number') { if (!Number.isFinite(value)) errors.push(`non_finite:${key}`); continue; }
      if (typeof value === 'string') { if (value.length > 256) errors.push(`string_too_long:${key}`); if (!METADATA_STRING.test(value)) errors.push(`string_characters:${key}`); continue; }
      errors.push(`value_type:${key}`);
    }
    if (!errors.length) { let serialized = ''; try { serialized = JSON.stringify(payload); } catch { errors.push('not_serializable'); } if (utf8Length(serialized) > 2048) errors.push('too_large'); }
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
  };
  const validateAnnotationLabel = label => typeof label === 'string' && label.trim().length > 0 && label.length <= 128 && METADATA_STRING.test(label);
  const annotationMode = () => {
    const mode = global.__PRODUCTTRACE_OAI_ATTRIBUTES__;
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    try { return typeof global.document?.oai?.annotation?.request === 'function'; } catch { return false; }
  };
  const INTERACTIVE_HOST = 'button,input,textarea,select,a[href],[role="button"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="link"],[tabindex]';
  const componentFiber = fiber => Boolean(fiber) && (fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 2 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15);
  const boundaryFiber = fiber => !fiber || fiber.tag === 3 || fiber.tag === 4 || fiber.tag === 5;
  const firstChildOf = (parent, child) => parent.child === child || parent.child === child.alternate
    || Boolean(parent.alternate && (parent.alternate.child === child || parent.alternate.child === child.alternate));
  const placementOf = fiber => { const props = fiber?.memoizedProps; if (!props || typeof props !== 'object') return null; const index = placementsByProps.get(props); return index === undefined ? null : index; };
  const handlersOf = fiber => {
    const props = fiber?.memoizedProps, out = [];
    if (!props || typeof props !== 'object') return out;
    for (const prop of Object.keys(props)) {
      if (!/^on[A-Z]/u.test(prop)) continue;
      const function_id = functionIdOf(props[prop]);
      if (function_id) out.push({ event: prop.slice(2).toLowerCase(), prop, function_id });
    }
    return out;
  };
  const reactFiberKey = node => { try { for (const key of Object.keys(node)) if (key.startsWith('__reactFiber$')) return key; } catch {} return null; };
  reactFiberKeyOf = reactFiberKey;
  boundHandlersFor = (node, eventType) => {
    if (!node) return null;
    const ids = new Set(); let library = 0, listeners = 0, fiberNode = null, key = null;
    // Native listeners registered on the target or a DOM ancestor (never
    // document/window, which stay global) are element-bound as well. The walk
    // is composed: from a shadow-tree target it continues through the shadow
    // root (a listener on the root counts) to its host. React fibers start at
    // the nearest node of that walk that React rendered.
    for (let element = node; listenerTarget(element); element = element.nodeType === 11 ? element.host : element.parentNode) {
      if (!key) { const own = reactFiberKey(element); if (own) { key = own; fiberNode = element; } }
      const byType = elementListeners.get(element); if (!byType) continue;
      for (const listener of byType.get(eventType) || []) { const id = functionIdOf(listener); if (id) { ids.add(id); listeners += 1; } }
    }
    if (!key && !listeners) return null;
    for (let fiber = key ? fiberNode[key] : null; fiber; fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        for (const name of Object.keys(props)) {
          if (!/^on[A-Z]/u.test(name)) continue;
          const value = props[name]; if (typeof value !== 'function') continue;
          const id = functionIdOf(value); if (id) ids.add(id); else library += 1;
        }
      }
      const index = placementOf(fiber); const row = index === null ? null : placementTable.get(index);
      if (row?.bound) for (const indexes of Object.values(row.bound)) for (const functionIndex of indexes) ids.add(resolveFunctionId(functionIndex));
    }
    return { basis: 'declared', ids: [...ids].sort(), library, ...(listeners ? { element_listeners: listeners } : {}) };
  };
  const fnv1a = (text, seed = 0x811c9dc5) => { let hash = seed; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16).padStart(8, '0'); };
  const basename = file => String(file || '').split('/').pop();
  // lastRowByKey: element_key -> the latest element.stamp row emitted for it
  // (its signature and stamp_sequence). A row is emitted whenever what a key
  // names changes (placement, key kind, instance count, key path, binding).
  const stampByNode = new WeakMap(), hostDescriptors = new WeakMap(), unplacedNodes = new WeakSet(), lastRowByKey = new Map();
  let stampSequence = 0;
  const emitStamp = row => {
    const record = { schema: 'producttrace.runtime-evidence.v1', kind: 'element.stamp', stamp_sequence: ++stampSequence, timestamp: Date.now(), session: pageSession, ...row };
    records.push(record); stampStats.stamp_rows += 1;
    try { global.__producttraceHostCapture?.(JSON.stringify({ channel: 'element-stamp', row: record })); } catch { hostErrors += 1; }
    return record;
  };
  const writeAnnotation = (node, stamp) => {
    // Metadata is dropped inside shadow roots: OAI attributes are never
    // written there (the host carries its own).
    if (stamp.shadow) return 'skipped:shadow_root';
    if (!annotationMode()) return 'absent';
    const label = `${stamp.component || stamp.tag || stamp.host_tag} (${basename(stamp.file)}:${stamp.line})`;
    const payload = { tracer_el: stamp.element_key, tracer_build: buildId, tracer_session: pageSession, component: stamp.component || stamp.tag || null,
      source: `${stamp.file}:${stamp.line}`, tracer_last_action: stamp.last_action || null };
    const verdict = validateAnnotationMetadata(payload);
    if (!verdict.ok || !validateAnnotationLabel(label)) { stampStats.annotation_rejected += 1; return `rejected:${verdict.ok ? 'label' : verdict.errors.join(',')}`; }
    const json = JSON.stringify(payload);
    if (node.getAttribute(OAI_LABEL_ATTRIBUTE) !== label) node.setAttribute(OAI_LABEL_ATTRIBUTE, label);
    if (node.getAttribute(OAI_METADATA_ATTRIBUTE) !== json) node.setAttribute(OAI_METADATA_ATTRIBUTE, json);
    stampStats.annotation_written += 1;
    return 'written';
  };
  const addHandlers = (target, seen, fiber) => { for (const handler of handlersOf(fiber)) { const key = `${handler.prop}\0${handler.function_id}`; if (!seen.has(key)) { seen.add(key); target.push(handler); } } };
  // Per-host placement decision, cached on the host's props object: when the
  // props are unchanged the host was not re-rendered, so neither its placement
  // nor its qualification changed.
  const describeHost = host => {
    const node = host.stateNode;
    const cached = hostDescriptors.get(node);
    if (cached && cached.props === host.memoizedProps) return cached.descriptor;
    // C(H): the host plus every ancestor whose first host is this host.
    const chain = [host]; let cursor = host;
    while (cursor.return && !boundaryFiber(cursor.return) && firstChildOf(cursor.return, cursor)) { cursor = cursor.return; chain.push(cursor); }
    const handlers = [], seenHandlers = new Set();
    for (const fiber of chain) addHandlers(handlers, seenHandlers, fiber);
    let nearestComponent = host.return; while (nearestComponent && !componentFiber(nearestComponent)) nearestComponent = nearestComponent.return;
    let interactive = false; try { interactive = node.matches?.(INTERACTIVE_HOST) === true; } catch {}
    const placed = chain.map(fiber => ({ fiber, index: placementOf(fiber) })).filter(entry => entry.index !== null);
    let shadowControls = false; try { shadowControls = Boolean(openShadowRootOf(node)?.querySelector?.(INTERACTIVE_HOST)); } catch {}
    const qualifies = handlersOf(host).length > 0 || handlersOf(nearestComponent).length > 0
      || placed.some(entry => componentFiber(entry.fiber)) || interactive || shadowControls;
    let descriptor = null;
    if (qualifies) {
      // The element's own JSX site (innermost placement: the host itself, else
      // the component placement it is the first host of). The outermost
      // placement that binds a registered handler, when different, is kept as
      // the binding site.
      let primary = placed[0] || null;
      const bindingEntry = [...placed].reverse().find(entry => handlersOf(entry.fiber).length > 0) || null;
      const binding = bindingEntry && bindingEntry !== primary ? placementTable.get(bindingEntry.index) : null;
      let via = primary ? (primary.fiber === host ? 'self' : 'first_host') : null;
      // A host element passed as a `render` prop (`render={<button …/>}`) is
      // cloned by the component that renders it, so the host's props are not
      // the placed props. When a fiber of this host's chain holds a `render`
      // element of the same host type whose props were placed, that JSX is the
      // host's own site.
      if (primary?.fiber !== host) {
        for (const fiber of chain) {
          const element = fiber.memoizedProps?.render;
          const index = element && typeof element === 'object' && element.type === host.type && element.props ? placementsByProps.get(element.props) : undefined;
          if (index !== undefined) { primary = { fiber, index, element }; via = 'render_prop'; break; }
        }
      }
      if (!primary) {
        let ancestor = chain[chain.length - 1].return;
        while (ancestor && placementOf(ancestor) === null) ancestor = ancestor.return;
        if (ancestor) { primary = { fiber: ancestor, index: placementOf(ancestor) }; via = 'ancestor'; addHandlers(handlers, seenHandlers, ancestor); }
      }
      const placement = primary ? placementTable.get(primary.index) : null;
      if (!placement) { if (!unplacedNodes.has(node)) { unplacedNodes.add(node); stampStats.unplaced_nodes += 1; } }
      else {
        // React keys of the host and every keyed ancestor up to the root,
        // outermost first. A key is fixed for a fiber's lifetime (a new key
        // is a remount, with new props), so the path is cached with the rest.
        const key_path = []; let key_site = null;
        for (let fiber = host; fiber && fiber.tag !== 3; fiber = fiber.return) {
          if (fiber.key == null) continue;
          if (!key_path.length) { const index = placementOf(fiber); key_site = index === null ? null : placementTable.get(index)?.id || null; }
          key_path.push(String(fiber.key));
        }
        // A cloned `render` element keeps its key; recorded when the host fiber lost it.
        if (via === 'render_prop' && host.key == null && primary.element.key != null) { key_path.unshift(String(primary.element.key)); key_site = placement.id; }
        key_path.reverse();
        descriptor = { placement, placement_index: primary.index, via, handlers,
          ...(binding ? { binding: { placement_id: binding.id, file: binding.file, line: binding.line, component: binding.component || null } } : {}),
          key_path, key_site, raw_key: key_path.length ? key_path[key_path.length - 1] : null };
      }
    }
    hostDescriptors.set(node, { props: host.memoizedProps, descriptor });
    return descriptor;
  };
  // Element key (D-G3-2 as amended by fix/stable-element-keys):
  //   <placement key>@<key path>  when the host or an ancestor has a React key
  //                               and no other host of the same placement has
  //                               the same key path in this commit
  //                               (key_kind "react_key"; stable across
  //                               re-renders, reorders and removals);
  //   <placement key>#n<ordinal>  otherwise: the DOM-order ordinal among this
  //                               commit's other such hosts of the placement
  //                               (key_kind "ordinal", with `instances`, the
  //                               number of them; the same key can name a
  //                               different item after a reorder or removal).
  // The key path is every React key from the root down, each escaped with
  // encodeURIComponent (plus !'()*~), `%` for an empty key, joined by `/`;
  // a path over 200 characters becomes `%h` + 16 hex of two seeded FNV-1a
  // over the JSON-encoded path.
  // Uniqueness is page-wide: the latest committed hosts of every React root
  // are keyed together, so a key held in two roots falls back to ordinals
  // numbered across roots (in root first-commit order), with `instances`
  // counted across roots.
  const escapeKey = key => key === '' ? '%' : encodeURIComponent(key).replace(/[!'()*~]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const keyToken = path => {
    let token = null; try { token = path.map(escapeKey).join('/'); } catch {}
    if (token !== null && token.length <= 200) return token;
    let text = ''; try { text = JSON.stringify(path); } catch { text = String(path.length); }
    return `%h${fnv1a(text)}${fnv1a(text, 0x01000193)}`;
  };
  stampFiber = host => {
    const node = host.stateNode;
    if (!node || node.nodeType !== 1 || typeof node.setAttribute !== 'function') return;
    stampStats.hosts_checked += 1;
    const descriptor = describeHost(host);
    if (descriptor) stampCommit.hosts.push({ node, descriptor });
  };
  // Content signature: what the element shows, hashed (the text is never
  // recorded). The first of aria-label, title, name, data-testid, alt (the
  // attributes that name an element; alt names an image, which has no text),
  // else tag + the first 64 characters of trimmed text. A new stamp row is
  // emitted when it changes, so an index-like key (`key={i}`) that now names
  // another item is visible.
  const CONTENT_ATTRIBUTES = ['aria-label', 'title', 'name', 'data-testid', 'alt'];
  const textSummary = node => {
    let text = '', visited = 0; const stack = [node];
    while (stack.length && text.length < 96 && visited < 256) {
      const current = stack.pop(); visited += 1;
      if (current.nodeType === 3) { text += current.nodeValue || ''; continue; }
      const children = current.childNodes; if (!children) continue;
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
    return text.replace(/\s+/gu, ' ').trim().slice(0, 64);
  };
  const contentSignature = node => {
    let summary = null;
    try {
      for (const name of CONTENT_ATTRIBUTES) { const value = node.getAttribute?.(name); if (typeof value === 'string' && value) { summary = `${name}=${value}`; break; } }
      if (summary === null) summary = `${String(node.tagName || '').toLowerCase()}:${textSummary(node)}`;
    } catch { return null; }
    return `${fnv1a(summary)}${fnv1a(summary, 0x01000193)}`;
  };
  const applyStamp = (node, descriptor, element_key, key_kind, instances) => {
    const { placement } = descriptor;
    // Contract with external resolvers: printable ASCII, no spaces, <= 256.
    if (!/^[\x21-\x7e]{1,256}$/u.test(element_key)) { stampStats.invalid_keys += 1; return; }
    const prior = stampByNode.get(node);
    let stamp, annotation;
    if (prior && prior.element_key === element_key && prior.placement_index === descriptor.placement_index) {
      stamp = prior;
      if (node.getAttribute(STAMP_ATTRIBUTE) !== element_key) node.setAttribute(STAMP_ATTRIBUTE, element_key);
      stamp.handlers = descriptor.handlers; stamp.key_kind = key_kind; stamp.instances = instances;
      annotation = writeAnnotation(node, stamp);
    } else {
      stamp = { element_key, placement_index: descriptor.placement_index, placement_id: placement.id, file: placement.file, line: placement.line,
        component: placement.component || null, tag: placement.tag || null, host_tag: String(node.tagName || '').toLowerCase() || null,
        placement_via: descriptor.via, react_key: descriptor.raw_key, handlers: descriptor.handlers, key_kind, instances,
        // A DOM node keeps its last attributed action while it renders the same
        // placement (an ordinal shift); a different placement starts fresh.
        last_action: prior && prior.placement_index === descriptor.placement_index ? prior.last_action : null };
      stampByNode.set(node, stamp);
      if (!prior) stampStats.stamped_nodes += 1;
      node.setAttribute(STAMP_ATTRIBUTE, element_key);
      annotation = writeAnnotation(node, stamp);
    }
    // Interactive elements inside the host's open shadow root (D-G1-18).
    try { stampShadow(node, stamp, placement); } catch { stampStats.errors += 1; }
    // One row per observation: a new row whenever what this key names changes.
    if (descriptor.row_signature === undefined) descriptor.row_signature = JSON.stringify([placement.id, descriptor.key_path, descriptor.key_site, descriptor.binding?.placement_id ?? null,
      descriptor.handlers.map(handler => `${handler.prop}\u0000${handler.function_id}`)]);
    const content_sig = contentSignature(node);
    const signature = `${descriptor.row_signature}|${key_kind}|${instances}|${content_sig}`;
    if (lastRowByKey.get(element_key)?.signature === signature) return;
    let url = null; try { url = String(global.location?.href || '').split('#')[0] || null; } catch {}
    const row = emitStamp({ element_key, key_kind, ...(key_kind === 'ordinal' ? { instances } : { react_key_path: descriptor.key_path, react_key_site: descriptor.key_site }),
      commit: stampStats.commits, placement_id: placement.id, file: placement.file, line: placement.line,
      start: Number.isInteger(placement.start) ? placement.start : null, end: Number.isInteger(placement.end) ? placement.end : null, url, component: stamp.component,
      tag: stamp.tag, host_tag: stamp.host_tag, placement_via: descriptor.via, react_key: descriptor.raw_key, handlers: descriptor.handlers,
      // `handlers` are declared (on* props at this commit; `event` is the prop
      // name without "on", lower-cased, never an observation): what ran on a
      // dispatch is the handler.binding rows (D-G1-22).
      handlers_basis: 'declared',
      ...(descriptor.binding ? { binding_placement: descriptor.binding } : {}), content_sig, build: buildId, annotation });
    lastRowByKey.set(element_key, { signature, stamp_sequence: row.stamp_sequence });
  };
  // Keys are assigned after the whole committed tree was walked (pre-order,
  // document order within a root), so an ordinal key knows its instance count.
  const rootHosts = new Map();
  finishStampCommit = (committed, root) => {
    rootHosts.set(root, committed.slice());
    const hosts = []; for (const list of rootHosts.values()) for (const entry of list) hosts.push(entry);
    const shared = new Map(), ordinalTotals = new Map(), ordinals = new Map();
    for (const entry of hosts) {
      entry.token = entry.descriptor.key_path.length ? keyToken(entry.descriptor.key_path) : null;
      if (entry.token !== null) { const id = `${entry.descriptor.placement_index}@${entry.token}`; shared.set(id, (shared.get(id) || 0) + 1); }
    }
    for (const entry of hosts) {
      entry.keyed = entry.token !== null && shared.get(`${entry.descriptor.placement_index}@${entry.token}`) === 1;
      if (!entry.keyed) ordinalTotals.set(entry.descriptor.placement_index, (ordinalTotals.get(entry.descriptor.placement_index) || 0) + 1);
    }
    for (const { node, descriptor, token, keyed } of hosts) {
      try {
        if (keyed) { applyStamp(node, descriptor, `${descriptor.placement.key}@${token}`, 'react_key', null); continue; }
        const ordinal = (ordinals.get(descriptor.placement_index) || 0) + 1; ordinals.set(descriptor.placement_index, ordinal);
        applyStamp(node, descriptor, `${descriptor.placement.key}#n${ordinal}`, 'ordinal', ordinalTotals.get(descriptor.placement_index));
      } catch { stampStats.errors += 1; }
    }
  };
  stampFieldsFor = (node, elementKey) => {
    const stamp = stampByNode.get(node);
    if (!stamp || stamp.element_key !== elementKey) return null;
    const row = lastRowByKey.get(elementKey);
    return { key_kind: stamp.key_kind, ...(stamp.key_kind === 'ordinal' ? { instances: stamp.instances } : {}), ...(row ? { stamp_sequence: row.stamp_sequence } : {}) };
  };
  // Interactive elements inside a stamped host's OPEN shadow root get
  // `data-tracer-el` = `<host key>><tag>#n<ordinal>` (ordinal among the root's
  // interactive elements of that tag, in tree order). Closed roots are not
  // reachable and are not stamped. Nested shadow roots are not descended.
  // Same row contract as applyStamp (fix/stable-element-keys): the key is
  // an ordinal whose `instances` counts what the family could name (same-tag
  // controls in this root, times the host's instances when the host key is
  // itself an ordinal), `content_sig` is recorded, one row per observation,
  // and the key registers in lastRowByKey so a dom.action on it carries
  // key_kind / instances / stamp_sequence.
  const stampShadow = (hostNode, hostStamp, placement) => {
    const root = openShadowRootOf(hostNode); if (!root) return;
    let controls = []; try { controls = Array.from(root.querySelectorAll(INTERACTIVE_HOST)); } catch { return; }
    const totals = new Map(), ordinals = new Map();
    for (const node of controls) { const tagName = String(node.tagName || '').toLowerCase() || null; totals.set(tagName, (totals.get(tagName) || 0) + 1); }
    const hostInstances = hostStamp.key_kind === 'ordinal' && Number.isInteger(hostStamp.instances) ? hostStamp.instances : 1;
    for (const node of controls) {
      const host_tag = String(node.tagName || '').toLowerCase() || null;
      const ordinal = (ordinals.get(host_tag) || 0) + 1; ordinals.set(host_tag, ordinal);
      const element_key = `${hostStamp.element_key}>${host_tag}#n${ordinal}`;
      if (!/^[\x21-\x7e]{1,256}$/u.test(element_key)) { stampStats.invalid_keys += 1; continue; }
      const key_kind = 'ordinal', instances = totals.get(host_tag) * hostInstances;
      const prior = stampByNode.get(node);
      let stamp;
      if (prior && prior.element_key === element_key) {
        stamp = prior; stamp.key_kind = key_kind; stamp.instances = instances;
        if (node.getAttribute(STAMP_ATTRIBUTE) !== element_key) node.setAttribute(STAMP_ATTRIBUTE, element_key);
      } else {
        stamp = { element_key, placement_index: hostStamp.placement_index, placement_id: placement.id, file: placement.file, line: placement.line,
          component: hostStamp.component, tag: null, host_tag, placement_via: 'shadow_root', shadow_host: hostStamp.element_key, react_key: null, handlers: [],
          key_kind, instances, last_action: prior ? prior.last_action : null, shadow: true };
        stampByNode.set(node, stamp);
        if (!prior) { stampStats.stamped_nodes += 1; stampStats.shadow_stamped_nodes += 1; }
        node.setAttribute(STAMP_ATTRIBUTE, element_key);
      }
      const content_sig = contentSignature(node);
      const signature = `${placement.id}|shadow|${hostStamp.element_key}|${key_kind}|${instances}|${content_sig}`;
      if (lastRowByKey.get(element_key)?.signature === signature) continue;
      let url = null; try { url = String(global.location?.href || '').split('#')[0] || null; } catch {}
      const row = emitStamp({ element_key, key_kind, instances, commit: stampStats.commits, placement_id: placement.id, file: placement.file, line: placement.line,
        start: Number.isInteger(placement.start) ? placement.start : null, end: Number.isInteger(placement.end) ? placement.end : null, url, component: stamp.component,
        tag: null, host_tag, placement_via: 'shadow_root', shadow_host: hostStamp.element_key, react_key: null, handlers: [], content_sig, build: buildId, annotation: writeAnnotation(node, stamp) });
      lastRowByKey.set(element_key, { signature, stamp_sequence: row.stamp_sequence });
    }
  };
  // The OAI attribute is read live when the annotation editor opens, so the
  // most recent attributed action on a stamped element is kept current.
  noteStampedAction = (node, elementKey, actionId) => {
    const stamp = stampByNode.get(node);
    if (!stamp || stamp.element_key !== elementKey) return;
    stamp.last_action = actionId;
    writeAnnotation(node, stamp);
  };
  // A request outside every action is never attributed; `issuer` only says
  // what was on the stack when it was sent: the first-party frames (function
  // ids, outermost first; none = uninstrumented code) and, when it ran in a
  // task armed outside every action, that task's API and the page sequence at
  // arming (orders it against the page's actions; never a join).
  const issuerFor = frame => ({ function_ids: [...(frame?.spine || [])], task: unownedTask ? { ...unownedTask } : null });
  // ---- Request/response bodies (network.body rows) -----------------------
  // Dev builds only (the Vite plugin sets __PRODUCTTRACE_BODIES__ to "on" when
  // mode !== "production", "production_off" in a production build unless
  // `bodies: 'always'`, "off" for `bodies: false`; unset means "off").
  // Bounded and redacted before the row leaves the page. Attribution never
  // reads these rows: they carry no action_id and no `sequence` (their own
  // body_sequence), draw no randomness, and are read through the native
  // Promise.then / addEventListener so no continuation or owned listener is
  // created. The app's body is never consumed and its observable behaviour is
  // unchanged: a Response is cloned before any app reaction runs, and the
  // app's cancel of its own branch cancels Tracer's; an XHR's responseText is
  // read on its own `load`. A body whose declared type does not qualify is
  // never read.
  const BODY_MODE = ['on', 'off', 'production_off'].includes(global.__PRODUCTTRACE_BODIES__) ? global.__PRODUCTTRACE_BODIES__ : 'off';
  const BODY_CAP = 4096, BODY_PARSE_LIMIT = 1048576, REDACTED = '[redacted]';
  const bodyStats = { rows: 0, truncated: 0, not_captured: 0, redactions: 0, bytes_recorded: 0, errors: 0, pending: 0 };
  let bodySequence = 0;
  const emitBody = row => {
    const record = { schema: 'producttrace.runtime-evidence.v1', kind: 'network.body', body_sequence: ++bodySequence, timestamp: Date.now(), session: pageSession, ...row };
    records.push(record); bodyStats.rows += 1;
    if (record.truncated) bodyStats.truncated += 1;
    if (record.captured === false) bodyStats.not_captured += 1;
    bodyStats.redactions += record.redactions || 0;
    let text = null; try { text = JSON.stringify({ channel: 'network-body', row: record }); } catch { bodyStats.errors += 1; }
    if (text) { bodyStats.bytes_recorded += text.length; try { global.__producttraceHostCapture?.(text); } catch { hostErrors += 1; } }
    return record;
  };
  // Content-type classes. `none`: no declared type (never read).
  const bodyClass = contentType => {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (!type) return 'none';
    if (/^(?:text\/event-stream|application\/(?:x-)?ndjson|application\/(?:x-)?jsonl(?:ines)?|application\/json-seq|application\/stream\+json)$/u.test(type)) return 'stream';
    if (/^application\/(?:[\w.-]+\+)?json$/u.test(type)) return 'json';
    if (type.startsWith('text/')) return 'text';
    if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') return 'form';
    return 'binary';
  };
  const reasonFor = kind => ({ none: 'unknown_type', stream: 'streaming', form: 'form' }[kind] || 'binary');
  // Cut a string to at most `max` UTF-8 bytes on a character boundary.
  const cutUtf8 = (text, max) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
      if (bytes + size > max) return text.slice(0, i);
      bytes += size; if (pair) i += 1;
    }
    return text;
  };
  // Redaction by key segments (camelCase, snake_case, kebab-case split and
  // lowercased), never by substring. A key whose last segment is `id`/`ids`
  // is an identifier and is never redacted; booleans and null are never
  // redacted, numbers only under a strong segment (below). Secret: a segment in SECRET_SEGMENTS; `session` alone;
  // `key` after api/private/secret/access (apiKey, private_key, x-api-key); a
  // lowercase run ending in a secret word (accesstoken, xapikey).
  const SECRET_SEGMENTS = new Set(['password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'authorization', 'bearer', 'jwt', 'cookie', 'credential', 'credentials', 'ssn', 'otp', 'pin', 'card', 'cvv']);
  const SECRET_ENDINGS = ['password', 'passwd', 'secret', 'token', 'apikey', 'privatekey', 'secretkey', 'accesskey', 'credential', 'credentials', 'cookie', 'jwt'];
  const KEY_QUALIFIERS = new Set(['api', 'private', 'secret', 'access']);
  const keySegments = key => String(key).split(/[^A-Za-z0-9]+/u).flatMap(part => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/gu) || []).map(part => part.toLowerCase());
  const isSecretKey = key => {
    const segments = keySegments(key);
    if (!segments.length) return false;
    const last = segments[segments.length - 1];
    if (last === 'id' || last === 'ids') return false;
    if (segments.length === 1 && segments[0] === 'session') return true;
    return segments.some((segment, index) => SECRET_SEGMENTS.has(segment)
      || (segment === 'key' && segments.slice(0, index).some(part => KEY_QUALIFIERS.has(part)))
      || SECRET_ENDINGS.some(ending => segment.endsWith(ending)));
  };
  // Numbers are redacted only under a strong segment (a numeric PIN, OTP,
  // CVV, card number, secret), and not when the key's last segment is a
  // quantity or metadata suffix (`maxTokenLimit`, `passwordLength`,
  // `tokenCount`, `tokenBudget`). Booleans and null never.
  const STRONG_SEGMENTS = new Set(['password', 'passwd', 'pwd', 'pin', 'otp', 'cvv', 'card', 'ssn', 'secret', 'credential', 'credentials', 'token']);
  const QUANTITY_SEGMENTS = new Set(['limit', 'limits', 'count', 'counts', 'max', 'min', 'length', 'len', 'size', 'ttl', 'expiry', 'expires', 'expiration', 'at', 'ms', 'seconds', 'version', 'type', 'index', 'budget', 'usage', 'total']);
  const isNumericSecretKey = key => {
    const segments = keySegments(key);
    return segments.length > 0 && !QUANTITY_SEGMENTS.has(segments[segments.length - 1]) && segments.some(segment => STRONG_SEGMENTS.has(segment)) && isSecretKey(key);
  };
  const redactJson = (value, counter) => {
    if (Array.isArray(value)) return value.map(item => redactJson(item, counter));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value)) {
      const child = value[key];
      const kept = child === null || typeof child === 'boolean' || (typeof child === 'number' && !isNumericSecretKey(key));
      const next = isSecretKey(key) && !kept ? (counter.n += 1, REDACTED) : redactJson(child, counter);
      Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  // A complete text or JSON body, parsed, redacted, then cut. Text that parses
  // as a JSON object/array is treated as JSON whatever its declared type.
  const bodyFromText = (text, contentType, bytes = utf8Length(text)) => {
    const kind = bodyClass(contentType);
    if (bytes > BODY_PARSE_LIMIT) return { captured: false, reason: 'over_parse_limit', bytes, truncated: false };
    let value, parsed = false;
    if (kind === 'json' || /^\s*[[{]/u.test(text)) { try { value = JSON.parse(text); parsed = true; } catch {} }
    if (kind === 'json' && !parsed) return { captured: false, reason: 'unparseable_json', bytes, truncated: false };
    if (parsed) {
      const counter = { n: 0 };
      let redacted; try { redacted = redactJson(value, counter); } catch { return { captured: false, reason: 'redaction_failed', bytes, truncated: false }; }
      const serialized = JSON.stringify(redacted);
      if (utf8Length(serialized) > BODY_CAP) return { captured: true, format: 'json', bytes, truncated: true, text: cutUtf8(serialized, BODY_CAP), redactions: counter.n };
      return { captured: true, format: 'json', bytes, truncated: false, json: redacted, redactions: counter.n };
    }
    const cut = cutUtf8(text, BODY_CAP);
    return { captured: true, format: 'text', bytes, truncated: cut.length < text.length, text: cut, redactions: 0 };
  };
  // A body whose type allows only its type and size (`bytes` null when unknown).
  const sizeOnly = (reason, bytes = null) => ({ captured: false, reason, bytes, truncated: false });
  const stringBody = (text, contentType) => {
    const kind = bodyClass(contentType);
    if (kind === 'json' || kind === 'text') return bodyFromText(text, contentType);
    return sizeOnly(reasonFor(kind), utf8Length(text));
  };
  const isType = (value, name) => { try { return typeof global[name] === 'function' && value instanceof global[name]; } catch { return false; } };
  // Request body at send time: the row carries the request's occurrence id,
  // whose action was fixed when the request was created.
  const requestBodyFields = (body, contentType) => {
    // fetch and XHR both send a string body as text/plain;charset=UTF-8 when no type is set.
    if (typeof body === 'string') return { content_type: contentType || 'text/plain;charset=UTF-8', ...stringBody(body, contentType || 'text/plain;charset=UTF-8') };
    if (isType(body, 'URLSearchParams')) return { content_type: contentType || 'application/x-www-form-urlencoded;charset=UTF-8', ...sizeOnly('form', utf8Length(body.toString())) };
    if (isType(body, 'FormData')) {
      let bytes = 0; try { for (const [, value] of body.entries()) bytes += typeof value === 'string' ? utf8Length(value) : Number(value?.size) || 0; } catch { bytes = null; }
      return { content_type: 'multipart/form-data', ...sizeOnly('form_data', bytes), bytes_basis: 'parts' };
    }
    if (isType(body, 'Blob')) return { content_type: contentType || body.type || null, ...sizeOnly('blob', body.size) };
    if (isType(body, 'ArrayBuffer') || (typeof ArrayBuffer === 'function' && ArrayBuffer.isView?.(body))) return { content_type: contentType || null, ...sizeOnly('binary', body.byteLength) };
    if (isType(body, 'ReadableStream')) return { content_type: contentType || null, ...sizeOnly('streaming') };
    if (isType(body, 'Document')) return { content_type: contentType || 'application/xml', ...sizeOnly('document') };
    return { content_type: contentType || null, ...sizeOnly('unsupported_body_type') };
  };
  const bodyMeta = (occurrence, transport, direction) => ({ request_occurrence_id: occurrence, transport, direction });
  const captureRequestBody = (occurrence, transport, body, contentType) => {
    if (body == null) return;
    try { emitBody({ ...bodyMeta(occurrence, transport, 'request'), ...requestBodyFields(body, contentType) }); } catch { bodyStats.errors += 1; }
  };
  // Read a cloned stream through its own reader, keeping at most `limit`
  // bytes. Past `limit` the reader is cancelled (complete: false). Every read
  // is counted in bodyStats.pending until it ends (capture.summary).
  const readCapped = (stream, limit, done) => {
    const reader = stream.getReader(); const chunks = []; let total = 0, kept = 0, finished = false;
    bodyStats.pending += 1;
    const data = () => { const joined = new Uint8Array(kept); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; } return joined; };
    const finish = result => { if (finished) return; finished = true; bodyStats.pending -= 1; try { done({ total, ...result }); } catch { bodyStats.errors += 1; } };
    const stop = outcome => { if (finished) return; try { bodyThen.call(reader.cancel(), null, () => {}); } catch {} finish(outcome === 'limit' ? { complete: false, data: data() } : { cancelled: outcome }); };
    const pump = () => bodyThen.call(reader.read(), step => {
      if (finished) return;
      try {
        if (step.done) { finish({ complete: true, data: data() }); return; }
        const value = step.value instanceof Uint8Array ? step.value : new Uint8Array(0);
        total += value.byteLength;
        if (kept < limit) { const take = value.subarray(0, limit - kept); chunks.push(take); kept += take.byteLength; }
        if (total > limit) { stop('limit'); return; }
        pump();
      } catch { bodyStats.errors += 1; stop('error'); }
    }, () => finish({ error: true }));
    try { pump(); } catch { finish({ error: true }); }
    return { cancel: stop };
  };
  const decodeUtf8 = (bytes, partial = false) => new TextDecoder('utf-8').decode(bytes, { stream: partial });
  // fetch() with a Request object carrying the body: read only a JSON or
  // text/* body (cloned before the native fetch reads it, capped at 1 MiB).
  const captureRequestObjectBody = (occurrence, request, contentType) => {
    try {
      const meta = { ...bodyMeta(occurrence, 'fetch', 'request'), content_type: contentType || null };
      const kind = bodyClass(contentType);
      if (kind !== 'json' && kind !== 'text') { emitBody({ ...meta, ...sizeOnly(reasonFor(kind)) }); return; }
      readCapped(request.clone().body, BODY_PARSE_LIMIT, result => {
        if (result.complete) emitBody({ ...meta, ...bodyFromText(decodeUtf8(result.data), contentType, result.total) });
        else emitBody({ ...meta, ...sizeOnly(result.error ? 'read_failed' : 'over_parse_limit'), bytes_read: result.total });
      });
    } catch { bodyStats.errors += 1; }
  };
  const exactLength = headers => {
    try {
      const value = headers?.get?.('content-length'); if (value == null || value === '') return null;
      const number = Number(value); if (!Number.isFinite(number) || number < 0) return null;
      // A content-length under a content-encoding is the encoded size, not the body's.
      const encoding = String(headers.get('content-encoding') || '').trim().toLowerCase();
      return !encoding || encoding === 'identity' ? number : null;
    } catch { return null; }
  };
  // The app's branch of a cloned response -> cancel Tracer's branch. The
  // clone's tee cancels the source only when both branches are cancelled, so
  // an app that cancels its reader must take Tracer's read down with it.
  const watchedBodies = new WeakMap();
  const noteBodyCancel = target => { const cancel = target && watchedBodies.get(target); if (cancel) { watchedBodies.delete(target); try { cancel(); } catch { bodyStats.errors += 1; } } };
  if (BODY_MODE === 'on' && global.ReadableStream?.prototype) {
    // Each wrapper keeps its native name and length; values and
    // [Symbol.asyncIterator] stay one function when they were one natively.
    const mirror = (wrapper, native) => { try { Object.defineProperty(wrapper, 'name', { value: native.name, configurable: true }); Object.defineProperty(wrapper, 'length', { value: native.length, configurable: true }); } catch {} return wrapper; };
    const StreamProto = global.ReadableStream.prototype;
    const nativeCancel = StreamProto.cancel, nativeGetReader = StreamProto.getReader, nativePipeThrough = StreamProto.pipeThrough, nativePipeTo = StreamProto.pipeTo;
    const nativeIterator = StreamProto[Symbol.asyncIterator], nativeValues = StreamProto.values;
    if (nativeCancel) StreamProto.cancel = mirror(function (...args) { noteBodyCancel(this); return nativeCancel.apply(this, args); }, nativeCancel);
    if (nativeGetReader) StreamProto.getReader = mirror(function (...args) { const reader = nativeGetReader.apply(this, args); const cancel = watchedBodies.get(this); if (cancel && reader) watchedBodies.set(reader, cancel); return reader; }, nativeGetReader);
    if (nativePipeThrough) StreamProto.pipeThrough = mirror(function (...args) { const out = nativePipeThrough.apply(this, args); const cancel = watchedBodies.get(this); if (cancel && out) watchedBodies.set(out, cancel); return out; }, nativePipeThrough);
    // pipeTo cancels its source when the destination aborts or errors (unless
    // preventCancel). For a watched body the app receives the promise derived
    // from a rejection-only reaction that cancels Tracer's read first and
    // rethrows, so an unhandled pipeTo rejection stays unhandled.
    if (nativePipeTo) StreamProto.pipeTo = mirror(function (...args) {
      const pending = nativePipeTo.apply(this, args);
      const cancel = watchedBodies.get(this);
      let preventCancel = false; try { preventCancel = Boolean(args[1] && args[1].preventCancel); } catch {}
      if (!cancel || preventCancel) return pending;
      return bodyThen.call(pending, undefined, reason => { cancel(); throw reason; });
    }, nativePipeTo);
    const watchIterator = native => native && mirror(function (...args) {
      const iterator = native.apply(this, args); const cancel = watchedBodies.get(this);
      if (cancel && iterator && typeof iterator.return === 'function') { const nativeReturn = iterator.return; iterator.return = mirror(function (...rest) { cancel(); return nativeReturn.apply(this, rest); }, nativeReturn); }
      return iterator;
    }, native);
    const wrappedValues = watchIterator(nativeValues);
    if (nativeValues) StreamProto.values = wrappedValues;
    if (nativeIterator) StreamProto[Symbol.asyncIterator] = nativeIterator === nativeValues ? wrappedValues : watchIterator(nativeIterator);
    for (const Reader of [global.ReadableStreamDefaultReader, global.ReadableStreamBYOBReader]) {
      const nativeReaderCancel = Reader?.prototype?.cancel;
      if (nativeReaderCancel) Reader.prototype.cancel = mirror(function (...args) { noteBodyCancel(this); return nativeReaderCancel.apply(this, args); }, nativeReaderCancel);
    }
  }
  const NO_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
  // Response: tapped by the reaction whose derived promise the app receives,
  // so it runs (and clones) before any app reaction can read the body, and a
  // rejection reaches the app's promise unhandled exactly as without Tracer.
  const captureFetchResponse = (occurrence, method, response) => {
    try {
      if (!response || typeof response.clone !== 'function') return;
      let contentType = null; try { contentType = response.headers?.get?.('content-type') || null; } catch {}
      const status = Number.isFinite(response.status) ? response.status : null;
      const base = { ...bodyMeta(occurrence, 'fetch', 'response'), content_type: contentType, status };
      if (response.type === 'opaque' || response.type === 'opaqueredirect') { emitBody({ ...base, ...sizeOnly('opaque_response') }); return; }
      if (String(method || 'GET').toUpperCase() === 'HEAD' || NO_BODY_STATUS.has(status) || !response.body) return; // no content
      const exact = exactLength(response.headers);
      const kind = bodyClass(contentType);
      if (kind !== 'json' && kind !== 'text') { emitBody({ ...base, ...sizeOnly(reasonFor(kind), exact) }); return; }
      if (exact != null && exact > BODY_PARSE_LIMIT) { emitBody({ ...base, ...sizeOnly('over_parse_limit', exact) }); return; }
      // text/* of unknown length may be an endless stream: keep 4 KB, then let go.
      const prefixOnly = kind === 'text' && exact == null;
      const copy = response.clone();
      const appBody = response.body;
      const read = readCapped(copy.body, prefixOnly ? BODY_CAP : BODY_PARSE_LIMIT, result => {
        if (appBody) watchedBodies.delete(appBody);
        if (result.cancelled === 'app') emitBody({ ...base, ...sizeOnly('cancelled_by_app'), bytes_read: result.total });
        else if (result.error || result.cancelled) emitBody({ ...base, ...sizeOnly('read_failed'), bytes_read: result.total });
        else if (result.complete) emitBody({ ...base, ...bodyFromText(decodeUtf8(result.data), contentType, result.total) });
        else if (prefixOnly) {
          const prefix = decodeUtf8(result.data, true);
          // A JSON-looking prefix cannot be parsed, so it cannot be redacted: not recorded.
          if (/^\s*[[{]/u.test(prefix)) emitBody({ ...base, ...sizeOnly('unredactable_prefix'), bytes_read: result.total });
          else emitBody({ ...base, captured: true, format: 'text', bytes: null, bytes_read: result.total, truncated: true, text: prefix, redactions: 0 });
        } else emitBody({ ...base, ...sizeOnly('over_parse_limit'), bytes_read: result.total });
      });
      if (appBody) watchedBodies.set(appBody, () => read.cancel('app'));
    } catch { bodyStats.errors += 1; }
  };
  // XHR response, read on the request's own `load` (native listener).
  // `responseText` is already in memory; bytes is its UTF-8 length.
  const captureXhrResponse = (occurrence, xhr) => {
    try {
      let contentType = null; try { contentType = xhr.getResponseHeader('content-type') || null; } catch {}
      const status = Number.isFinite(xhr.status) ? xhr.status : null;
      if (NO_BODY_STATUS.has(status)) return;
      const base = { ...bodyMeta(occurrence, 'xhr', 'response'), content_type: contentType, status };
      const type = xhr.responseType || '';
      const kind = bodyClass(contentType);
      if (type === '' || type === 'text') {
        const text = xhr.responseText;
        if (typeof text !== 'string' || !text.length) return;
        if (kind === 'json' || kind === 'text') emitBody({ ...base, ...bodyFromText(text, contentType), bytes_basis: 'utf8_of_text' });
        else emitBody({ ...base, ...sizeOnly(reasonFor(kind), utf8Length(text)), bytes_basis: 'utf8_of_text' });
      } else if (type === 'json') {
        const value = xhr.response; if (value == null) return;
        emitBody({ ...base, ...bodyFromText(JSON.stringify(value), 'application/json'), bytes_basis: 'reserialized' });
      } else if (type === 'arraybuffer') emitBody({ ...base, ...sizeOnly('binary', xhr.response?.byteLength ?? null) });
      else if (type === 'blob') emitBody({ ...base, ...sizeOnly('blob', xhr.response?.size ?? null) });
      else emitBody({ ...base, ...sizeOnly(type === 'document' ? 'document' : 'unsupported_body_type') });
    } catch { bodyStats.errors += 1; }
  };
  const emitTransport = ({ method, url, traceparent, context, active, transport, internal = false }) => {
    if (!internal) checkRealms();
    const action_id = active?.action_id || null;
    const request_occurrence_id = `${action_id || 'unattributed'}:request:${++requestSequence}`;
    emit({ kind: 'network.request', action_id, action_occurrence_id: action_id,
      // Path and query as the page sent them (a dev tool: recorded as-is); never the fragment.
      request_occurrence_id, method: String(method || 'GET').toUpperCase(), url: String(url || '').split('#')[0],
      traceparent, trace_context: { ...context, traceparent }, transport, internal,
      parent_continuation_id: active?.continuation_id || null,
      terminal_owner_continuation_id: actionTerminalOwner.get(action_id)?.continuation_id || null,
      // Async continuations remain part of the action handler lineage. A
      // mount effect is only admitted when the React commit receipt is carried
      // explicitly by the continuation frame; continuation kind alone is not
      // evidence of a mounted effect.
      linkage_kind: action_id ? (active?.react_commit_receipt ? 'mount_effect' : active?.state_receipt ? 'state_effect' : 'direct') : null,
      ...(action_id ? { spine: spineFor(active) } : { spine: { action_id: null, function_ids: [] }, reason: 'unattributed_transport', issuer: issuerFor(current) }), evidence_ids: [request_occurrence_id] });
    return request_occurrence_id;
  };
  // ---- Client aborts (network.abort / network.response_read rows) --------
  // Whether the page aborted a request is recorded from the AbortSignal (or
  // the XHR's own abort event) and the rejection identity, never from timing,
  // and decided when the abort happens (never from a live reference that
  // garbage collection could clear). Each fact is a row of its own keyed by
  // request_occurrence_id (the request row has already left the page);
  // analysis merges it onto the request (`mergeRequestFacts`). Only fetches
  // given an AbortSignal are tracked (every Request object carries one): they
  // are the only fetches a page can abort. Nothing here reads a body, creates
  // a continuation or registers an owned listener. Rows, `abort_state`:
  //  - aborted (`aborted_by_client: true`): the abort kept the response from
  //    reaching the app. The signal aborted and the fetch rejected with the
  //    signal's own reason object or an AbortError DOMException (before
  //    response headers; `signal_aborted_at_call` when the request was never
  //    sent); or a body read the app had started was pending when the signal
  //    aborted and then rejected with the reason or an AbortError (Chromium
  //    errors a body mid-read with a fresh AbortError, not the reason); or an
  //    XHR fired `abort` (`abort_call_seen` says whether xhr.abort() ran).
  //  - after_response (`aborted_by_client: false`, `abort_after_response`):
  //    the signal aborted after the response (status, headers) had reached the
  //    app and no body read was in progress: any unread body is discarded; the
  //    request's label stays the server's.
  //  - no_effect: the signal aborted after the app finished reading the body
  //    (or the response had none).
  // Finished body reads of tracked responses (json/text/…) emit
  // network.response_read: the proof that the app read that response.
  const mirrorNative = (wrapper, native) => { try { Object.defineProperty(wrapper, 'name', { value: native.name, configurable: true }); Object.defineProperty(wrapper, 'length', { value: native.length, configurable: true }); } catch {} return wrapper; };
  const domExceptionName = value => { try { return isType(value, 'DOMException') ? String(value.name) : null; } catch { return null; } };
  const reasonErrorType = value => { try { return value instanceof Error || isType(value, 'DOMException') ? errorTypeOf(value) : null; } catch { return null; } };
  // The DOMException name and, for an Error reason, its constructor name; never a message.
  const signalReason = signal => { let reason; try { reason = signal.reason; } catch {} return { via: 'AbortSignal', name: domExceptionName(reason), reason_type: reasonErrorType(reason) }; };
  const abortTracks = new WeakMap(); // Response (and its clones) -> track
  // How the rejection shows the abort: the signal's own reason object, else
  // an AbortError DOMException while the signal is aborted; null otherwise.
  const abortRejection = (signal, error) => { try { if (!signal.aborted) return null; if (error === signal.reason) return 'signal_reason'; return domExceptionName(error) === 'AbortError' ? 'abort_error' : null; } catch { return null; } };
  const emitAbort = (track, fields) => {
    if (track.reported) return; track.reported = true;
    try { if (track.signal && track.onAbort && nativeUnlisten) nativeUnlisten.call(track.signal, 'abort', track.onAbort); } catch {}
    try { emit({ kind: 'network.abort', request_occurrence_id: track.occurrence, transport: track.transport, parent_continuation_id: null, ...fields }); } catch {}
  };
  const abortedRow = (track, aborted_at, fields) => ({ abort_state: 'aborted', aborted_by_client: true, abort_reason: track.reason ? track.reason() : signalReason(track.signal), aborted_at, ...fields });
  const noEffectRow = (track, after) => ({ abort_state: 'no_effect', aborted_by_client: false, abort_reason: signalReason(track.signal), signal_aborted_after: after,
    response_received_before_abort: true, response_consumed_before_abort: true });
  const afterResponseRow = (track, fields = {}) => ({ abort_state: 'after_response', aborted_by_client: false, abort_after_response: true, abort_reason: signalReason(track.signal),
    response_received_before_abort: true, response_consumed_before_abort: false, abort_evidence: 'signal_aborted_after_response', ...fields });
  // The signal aborted after the response reached the page: decided now, from
  // what was recorded when the response arrived and from the app's reads.
  const undeterminedRow = (track, fields) => ({ abort_state: 'undetermined', abort_reason: signalReason(track.signal), response_received_before_abort: true, body_read_started: true,
    abort_evidence: 'signal_aborted_during_untracked_consumption', ...fields });
  const decideAfterResponse = track => {
    if (track.reported) return;
    if (track.bodyDone) { emitAbort(track, noEffectRow(track, 'body_read')); return; }
    if (!track.hasBody) { emitAbort(track, noEffectRow(track, 'response_complete')); return; }
    // A read the app started had already failed, or the app cancelled it: a started read, not stopped by the abort.
    if (track.readFailed) { emitAbort(track, afterResponseRow(track, { body_read_started: true, body_read_via: track.readVia, body_read_error_type: track.readFailed })); return; }
    if (track.readCancelled) { emitAbort(track, afterResponseRow(track, { body_read_started: true, body_read_via: track.readVia, body_read_cancelled_by_app: true })); return; }
    // A body method in progress decides when it settles (below).
    if (track.reading) { track.abortPending = true; return; }
    // A stream read (reader, pipeTo, async iteration) open and not finished: the abort cut it off.
    if (track.streamRead && !track.streamImprecise) {
      emitAbort(track, abortedRow(track, 'while_reading_body', { response_received_before_abort: true, body_read_started: true, response_consumed_before_abort: false,
        body_read_via: track.streamRead, abort_evidence: 'signal_aborted_during_stream_read' }));
      return;
    }
    // Consumed through tee()/pipeThrough(): whether that finished is not recorded.
    if (track.streamRead) { emitAbort(track, undeterminedRow(track, { body_read_via: track.streamRead,
      undetermined_because: `the app consumed the body through ${track.streamRead}(); whether that finished before the abort is not recorded` })); return; }
    emitAbort(track, afterResponseRow(track, { body_read_started: false }));
  };
  // A body read the app finished (a body method, a reader that saw done, a pipeTo that resolved).
  const readFinished = (track, via) => {
    track.reading = null; track.streamRead = null; if (track.bodyDone) return; track.bodyDone = true;
    try { emit({ kind: 'network.response_read', request_occurrence_id: track.occurrence, transport: 'fetch', via, parent_continuation_id: null }); } catch {}
    if (track.abortPending) emitAbort(track, noEffectRow(track, 'body_read'));
  };
  // A body read the app started rejected: the abort's own evidence, else a failed read (recorded whatever the order).
  const readRejected = (track, error, via, kind) => {
    track.reading = null;
    try {
      const evidence = abortRejection(track.signal, error);
      if (evidence) { emitAbort(track, abortedRow(track, 'while_reading_body', { response_received_before_abort: true, body_read_started: true, response_consumed_before_abort: false,
        body_read_via: via, abort_evidence: `${kind}_rejected_with_${evidence}` })); return; }
      if (!track.readFailed) { track.readFailed = errorTypeOf(error); track.readVia = via; }
      if (track.abortPending) emitAbort(track, afterResponseRow(track, { body_read_started: true, body_read_via: via, body_read_error_type: track.readFailed }));
    } catch {}
  };
  const trackAbort = (occurrence, input, init) => {
    let signal = null;
    try { signal = init && init.signal !== undefined ? init.signal : (input && typeof input === 'object' ? input.signal : null); } catch {}
    if (!signal || !isType(signal, 'AbortSignal') || !bodyListen) return null;
    const track = { occurrence, transport: 'fetch', signal, settled: null, hasBody: false, bodyDone: false, reading: null, abortPending: false, reported: false, abortedAtCall: false,
      streamRead: null, streamImprecise: false, readFailed: null, readVia: null, readCancelled: false };
    try { track.abortedAtCall = Boolean(signal.aborted); } catch {}
    track.onAbort = () => { try { if (track.settled === 'fulfilled') decideAfterResponse(track); } catch {} };
    if (!track.abortedAtCall) { try { bodyListen.call(signal, 'abort', track.onAbort, { once: true }); } catch {} }
    return track;
  };
  // Tracked body streams (and their readers and iterators) -> track: any
  // consumption of the body through the stream counts as a started read.
  const streamTracks = new WeakMap();
  const trackBodyStream = (track, response) => { try { const body = response.body; if (body && typeof body === 'object') streamTracks.set(body, track); } catch {} };
  const openStreamRead = (track, via, precise) => { if (track.bodyDone) return; track.readVia = track.readVia || via; if (!track.streamRead) track.streamRead = via; if (!precise) track.streamImprecise = true; };
  const abortFulfilled = (track, response) => {
    try {
      track.settled = 'fulfilled';
      if (response && typeof response === 'object') { try { track.hasBody = Boolean(response.body); } catch { track.hasBody = true; } abortTracks.set(response, track); trackBodyStream(track, response); }
      // Aborted after the promise was fulfilled but before this reaction ran: the body is errored.
      if (track.signal.aborted) decideAfterResponse(track);
    } catch {}
  };
  const abortRejected = (track, error) => {
    try {
      track.settled = 'rejected';
      // Rejection identity: the fetch rejects with the signal's own reason object (or an AbortError).
      const evidence = abortRejection(track.signal, error);
      if (evidence) {
        emitAbort(track, abortedRow(track, 'before_response_headers', { response_received_before_abort: false, body_read_started: false, response_consumed_before_abort: false,
          abort_evidence: `fetch_rejected_with_${evidence}`, ...(track.abortedAtCall ? { signal_aborted_at_call: true } : {}) }));
      } else if (track.onAbort && nativeUnlisten) { track.reported = true; nativeUnlisten.call(track.signal, 'abort', track.onAbort); }
    } catch {}
  };
  const ResponseProto = global.Response?.prototype;
  if (ResponseProto) {
    for (const name of ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']) {
      const native = ResponseProto[name];
      if (typeof native !== 'function') continue;
      ResponseProto[name] = mirrorNative(function (...args) {
        const result = native.apply(this, args);
        const track = abortTracks.get(this);
        if (!track || track.bodyDone || track.reading || !result || typeof result !== 'object') return result;
        track.reading = name; track.readVia = name;
        // The app receives the promise derived from Tracer's reactions (one
        // tick later, like body capture); a rejection passes through unhandled.
        return bodyThen.call(result, value => { readFinished(track, name); return value; }, error => { readRejected(track, error, name, 'body_read'); throw error; });
      }, native);
    }
    const nativeClone = ResponseProto.clone;
    if (typeof nativeClone === 'function') ResponseProto.clone = mirrorNative(function (...args) {
      const copy = nativeClone.apply(this, args);
      const track = abortTracks.get(this);
      // clone() tees the body: both responses now hold new streams.
      if (track && copy && typeof copy === 'object') { abortTracks.set(copy, track); trackBodyStream(track, copy); trackBodyStream(track, this); }
      return copy;
    }, nativeClone);
  }
  // Stream consumption of a tracked body (every build): getReader + read,
  // pipeTo and async iteration are followed to their end (done / resolved);
  // tee and pipeThrough only mark a started read whose end is not recorded.
  // Untracked streams pass straight through. Reads of a tracked body return
  // the promise derived from Tracer's reactions (one tick later).
  const StreamProto = global.ReadableStream?.prototype;
  if (StreamProto) {
    const followed = (track, promise, via, onValue) => bodyThen.call(promise, value => { try { onValue(value); } catch {} return value; }, error => { readRejected(track, error, via, 'stream_read'); throw error; });
    const nativeGetReader = StreamProto.getReader;
    if (typeof nativeGetReader === 'function') StreamProto.getReader = mirrorNative(function (...args) {
      const reader = nativeGetReader.apply(this, args); const track = streamTracks.get(this);
      if (track && reader && typeof reader === 'object') { streamTracks.set(reader, track); openStreamRead(track, 'getReader', true); }
      return reader;
    }, nativeGetReader);
    for (const Reader of [global.ReadableStreamDefaultReader, global.ReadableStreamBYOBReader]) {
      const nativeRead = Reader?.prototype?.read; const nativeReaderCancel = Reader?.prototype?.cancel;
      if (typeof nativeRead === 'function') Reader.prototype.read = mirrorNative(function (...args) {
        const result = nativeRead.apply(this, args); const track = streamTracks.get(this);
        if (!track || track.bodyDone || !result || typeof result !== 'object') return result;
        return followed(track, result, 'getReader', value => { if (value && value.done) readFinished(track, 'getReader'); });
      }, nativeRead);
      if (typeof nativeReaderCancel === 'function') Reader.prototype.cancel = mirrorNative(function (...args) {
        const track = streamTracks.get(this); if (track && !track.bodyDone) track.readCancelled = true;
        return nativeReaderCancel.apply(this, args);
      }, nativeReaderCancel);
    }
    const nativeStreamCancel = StreamProto.cancel;
    if (typeof nativeStreamCancel === 'function') StreamProto.cancel = mirrorNative(function (...args) {
      const track = streamTracks.get(this); if (track && !track.bodyDone) track.readCancelled = true;
      return nativeStreamCancel.apply(this, args);
    }, nativeStreamCancel);
    const nativePipeTo = StreamProto.pipeTo;
    if (typeof nativePipeTo === 'function') StreamProto.pipeTo = mirrorNative(function (...args) {
      const result = nativePipeTo.apply(this, args); const track = streamTracks.get(this);
      if (!track || !result || typeof result !== 'object') return result;
      openStreamRead(track, 'pipeTo', true);
      return followed(track, result, 'pipeTo', () => readFinished(track, 'pipeTo'));
    }, nativePipeTo);
    for (const name of ['pipeThrough', 'tee']) {
      const native = StreamProto[name];
      if (typeof native === 'function') StreamProto[name] = mirrorNative(function (...args) {
        const track = streamTracks.get(this); if (track) openStreamRead(track, name, false);
        return native.apply(this, args);
      }, native);
    }
    const followIterator = native => typeof native === 'function' && mirrorNative(function (...args) {
      const iterator = native.apply(this, args); const track = streamTracks.get(this);
      if (!track || !iterator || typeof iterator.next !== 'function') return iterator;
      openStreamRead(track, 'async_iteration', true);
      const nativeNext = iterator.next, nativeReturn = iterator.return;
      iterator.next = mirrorNative(function (...rest) {
        const result = nativeNext.apply(this, rest);
        if (track.bodyDone || !result || typeof result !== 'object') return result;
        return followed(track, result, 'async_iteration', value => { if (value && value.done) readFinished(track, 'async_iteration'); });
      }, nativeNext);
      if (typeof nativeReturn === 'function') iterator.return = mirrorNative(function (...rest) { if (!track.bodyDone) track.readCancelled = true; return nativeReturn.apply(this, rest); }, nativeReturn);
      return iterator;
    }, native);
    const nativeValues = StreamProto.values, nativeIterator = StreamProto[Symbol.asyncIterator];
    const wrappedValues = followIterator(nativeValues);
    if (wrappedValues) StreamProto.values = wrappedValues;
    if (typeof nativeIterator === 'function') StreamProto[Symbol.asyncIterator] = nativeIterator === nativeValues && wrappedValues ? wrappedValues : followIterator(nativeIterator);
  }
  if (nativeFetch) global.fetch = function productTraceRuntimeFetch(input, init) {
    const active = ownable(settleAmbient()) ? current : null;
    const url = String(input?.url || input || '');
    const internal = Boolean(global.__PRODUCTTRACE_INTERNAL_FETCH__) || /(?:producttrace|react-observations|\/__capture(?:$|[?]))/u.test(url);
    const context = traceContext();
    const headers = new Headers(init?.headers || input?.headers || {});
    const existing = headers.get('traceparent');
    const traceparent = existing || context.traceparent;
    if (!existing && !internal && !/\/__capture(?:$|[?])/u.test(url)) headers.set('traceparent', traceparent);
    const occurrence = global.__PRODUCTTRACE_BRIDGE_TRANSPORT__ ? null : emitTransport({ method: init?.method || input?.method || 'GET', url, traceparent, context, active,
      transport: 'fetch', internal });
    const nextInit = { ...(init || {}), headers };
    // A fetch that carries an AbortSignal: the page can abort it (network.abort).
    const abortTrack = occurrence && !internal ? trackAbort(occurrence, input, init) : null;
    if (BODY_MODE !== 'on' || !occurrence || internal) {
      const pending = nativeFetch(input, nextInit);
      if (occurrence && !internal && pending && typeof pending === 'object') responsePromises.set(pending, occurrence);
      if (!abortTrack || !pending || typeof pending !== 'object') return pending;
      // The app receives the promise derived from Tracer's reactions (as with
      // body capture): the rejection passes through unhandled, one tick later.
      const tracked = bodyThen.call(pending, response => { abortFulfilled(abortTrack, response); return response; }, error => { abortRejected(abortTrack, error); throw error; });
      responsePromises.set(tracked, occurrence);
      return tracked;
    }
    // Bodies: the request body now (a Request object's body is cloned before
    // the native fetch reads it). The app receives the promise derived from
    // Tracer's fulfilment-only reaction: the response is cloned before any
    // app reaction runs, and a rejection passes through unhandled, so
    // `unhandledrejection` fires exactly as without Tracer (one extra tick).
    let contentType = null; try { contentType = headers.get('content-type'); } catch {}
    if (init && init.body != null) captureRequestBody(occurrence, 'fetch', init.body, contentType);
    else if (init?.body === undefined && typeof input === 'object' && input && typeof input.clone === 'function' && input.body) captureRequestObjectBody(occurrence, input, contentType);
    const method = init?.method || input?.method || 'GET';
    const pending = nativeFetch(input, nextInit);
    responsePromises.set(pending, occurrence);
    const derived = bodyThen.call(pending, response => { captureFetchResponse(occurrence, method, response); if (abortTrack) abortFulfilled(abortTrack, response); return response; },
      abortTrack ? error => { abortRejected(abortTrack, error); throw error; } : undefined);
    // `after response` marking (response_of): reactions on the promise the app receives carry the occurrence.
    responsePromises.set(derived, occurrence);
    return derived;
  };
  if (global.XMLHttpRequest?.prototype) {
    const xhrOpen = global.XMLHttpRequest.prototype.open;
    const xhrSend = global.XMLHttpRequest.prototype.send;
    const xhrHeader = global.XMLHttpRequest.prototype.setRequestHeader;
    const xhrAbort = global.XMLHttpRequest.prototype.abort;
    const xhrAbortReadyState = new WeakMap();
    // The XHR's abort event: fired by xhr.abort() (seen by the wrapper below,
    // with the readyState it saw) or by the browser without a call (window.stop()).
    const emitXhrAbort = (occurrence, xhr) => {
      const called = xhrAbortReadyState.has(xhr);
      const state = called ? xhrAbortReadyState.get(xhr) : null;
      const received = state == null ? null : state >= 2;
      const reason = () => ({ via: called ? 'XMLHttpRequest.abort' : 'xhr_abort_event_without_abort_call', name: null, reason_type: null });
      emitAbort({ occurrence, transport: 'xhr', reason }, abortedRow({ reason }, state == null ? null : received ? 'while_reading_body' : 'before_response_headers',
        { response_received_before_abort: received, body_read_started: null, response_consumed_before_abort: false, ready_state_at_abort: state, abort_call_seen: called, abort_evidence: 'xhr_abort_event' }));
    };
    if (typeof xhrAbort === 'function') global.XMLHttpRequest.prototype.abort = mirrorNative(function () {
      try { if (xhrOccurrences.has(this) && !xhrAbortReadyState.has(this)) xhrAbortReadyState.set(this, this.readyState); } catch {}
      return xhrAbort.apply(this, arguments);
    }, xhrAbort);
    global.XMLHttpRequest.prototype.open = function productTraceRuntimeOpen(method, url, ...rest) { this.__productTraceRuntimeRequest = { method, url, headers: {} }; return xhrOpen.call(this, method, url, ...rest); };
    global.XMLHttpRequest.prototype.setRequestHeader = function productTraceRuntimeHeader(name, value) { if (this.__productTraceRuntimeRequest) this.__productTraceRuntimeRequest.headers[String(name).toLowerCase()] = String(value); return xhrHeader.call(this, name, value); };
    global.XMLHttpRequest.prototype.send = function productTraceRuntimeSend(...args) {
      const request = this.__productTraceRuntimeRequest; const active = ownable(settleAmbient()) ? current : null;
      if (request) { const context = traceContext(); const traceparent = request.headers.traceparent || context.traceparent;
        if (!request.headers.traceparent) { try { this.setRequestHeader('traceparent', traceparent); } catch {} }
      const internal = Boolean(global.__PRODUCTTRACE_INTERNAL_FETCH__) || /(?:producttrace|react-observations|\/__capture(?:$|[?]))/u.test(String(request.url || ''));
      const occurrence = global.__PRODUCTTRACE_BRIDGE_TRANSPORT__ ? null : emitTransport({ method: request.method, url: request.url, traceparent, context, active, transport: 'xhr', internal });
      if (occurrence && !internal) {
        xhrOccurrences.set(this, occurrence);
        // Client abort: the XHR's own `abort` event (fired only by abort()),
        // with the readyState abort() saw (native listener, no ownership).
        const xhr = this;
        try { if (bodyListen) bodyListen.call(xhr, 'abort', () => emitXhrAbort(occurrence, xhr), { once: true }); } catch {}
      }
      if (BODY_MODE === 'on' && occurrence && !internal) {
        captureRequestBody(occurrence, 'xhr', args[0], request.headers['content-type'] || null);
        const xhr = this;
        try { if (bodyListen) bodyListen.call(xhr, 'load', () => captureXhrResponse(occurrence, xhr)); } catch { bodyStats.errors += 1; }
      }
      }
      return xhrSend.apply(this, args);
    };
  }
  // Owner of a continuation being created now: the frame current at creation
  // (after popping ended dispatch frames), when it carries an action.
  // Nothing created while a component renders is owned: the render runs on
  // whatever continuation React flushed it on.
  // A continuation captured from a left-behind frame keeps its action (as on
  // main) but is marked stale_owner on a copy, never on the shared frame.
  const captureOwner = () => { const frame = settleAmbient(); if (!(ownable(frame) && !reactRendering())) return null; return !frame.stale_owner && staleOwner(frame) ? { ...frame, stale_owner: true } : frame; };
  // Run a callback under the owner captured at its creation, or under no
  // action; never under whatever frame is ambient when it runs. `task`
  // callbacks (timers, animation frames, messages) always start a task, so the
  // frame before them is restored as null: an ended dispatch frame or any
  // frame left behind by code that suspended natively is not carried on.
  // `origin` describes a callback armed outside every action (no owner): the
  // arming API and the page sequence then. Promise/microtask callbacks created
  // inside such a task inherit its origin at creation time. It only feeds the
  // `issuer` of unattributed requests; it never gives a callback an owner.
  const wrapOwnedCallback = (owner, callback, kind = 'callback', task = false, origin = null, response = null) => typeof callback === 'function' ? function (...args) {
    const previous = current; const previousTask = unownedTask;
    current = owner ? continuationOf(owner, kind) : null;
    if (current && response) current.response_of = response;
    unownedTask = owner ? null : origin;
    try { return callback.apply(this, args); } finally {
      if (task && previous) { if (!previous.dispatch) stampStats.task_ambient_cleared += 1; current = null; } else current = previous;
      unownedTask = previousTask;
    }
  } : callback;
  const taskOrigin = (owner, api) => (owner ? null : { api, armed_sequence: sequence, armed_by: [...(current?.spine || [])] });
  applyReceiptFrame = (owner, kind = 'state_effect') => ({ ...continuationOf(owner, kind, 'effect'), bare: false, scheduler: false,
    state_receipt: kind === 'state_effect', react_commit_receipt: kind === 'mount_effect' });
  // ---- G1 await continuations ---------------------------------------------
  // Native `await` resumptions bypass Promise.prototype.then. The build rewrites
  // each await in a first-party async function as
  // __ptAwR(w=__ptAwS(w), await __ptAwL(w, E)) plus a finally __ptAwE(w):
  // suspend captures the frame current at the await; resume runs the rest of
  // the function on an `await` continuation of that frame; leave/end restore
  // the resumption's ambient frame before the function suspends again or
  // settles, so nothing leaks into unrelated microtasks.
  // awaitBegin runs before the function's own frame is entered and records
  // the caller's frame; at the first suspension control returns to the
  // caller, so the caller's frame is restored instead of leaving this
  // function's frame as ambient state for unrelated later work.
  // Rejections: the awaited operand is settled into a tagged outcome, so the
  // await itself never throws; resume restores the frame and then rethrows,
  // and the function's catch/finally blocks run under the frame current at
  // the await. Primitives are passed through unchanged; an awaited object or
  // function takes one extra microtask tick (Promise.resolve + then).
  const AWAIT_OUTCOME = Symbol('productTrace.awaitOutcome');
  const nativePromiseThen = Promise.prototype.then, NativePromise = Promise;
  const awaitsEnabled = () => global.__PRODUCTTRACE_AWAIT_CONTINUATIONS__ !== false;
  const awaitBegin = () => ({ entry: settleAmbient(), suspended: false, resumed: false });
  // Outside an action the resumption carries no owner, but it keeps the
  // action-less first-party frame (for an unattributed request's issuer) and
  // the unowned task's origin; neither is ever ownable.
  const awaitSuspend = slot => { const w = slot && typeof slot === 'object' ? slot : {}; w.frame = captureOwner();
    w.loose = w.frame || !current || current.action_id ? null : current; w.task = w.frame ? null : unownedTask; return w; };
  const awaitLeave = (w, value) => {
    if (!w) return value;
    // An inner await of this slot resumed while this operand was evaluated
    // (`await (await fetch(u)).json()`, which bundlers emit from two
    // statements): the frame captured at this await's suspend predates it,
    // so carry the resumed frame's response origin to this resumption.
    w.carry = w.resumed ? current?.response_of || null : null;
    if (w.resumed) { current = w.restoreTo; unownedTask = w.restoreTask ?? null; w.resumed = false; }
    else if ('entry' in w && !w.suspended) { current = w.entry; }
    w.suspended = true;
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || !awaitsEnabled()) return value;
    w.response = responsePromises.get(value) || null;
    w.settled = true;
    return nativePromiseThen.call(NativePromise.resolve(value), result => ({ [AWAIT_OUTCOME]: true, ok: true, value: result }),
      error => ({ [AWAIT_OUTCOME]: true, ok: false, value: error }));
  };
  const awaitResume = (w, value) => {
    const outcome = value && typeof value === 'object' && value[AWAIT_OUTCOME] === true && w?.settled ? value : null;
    if (w && typeof w === 'object') w.settled = false;
    if (w && typeof w === 'object' && awaitsEnabled()) {
      w.restoreTo = current; w.restoreTask = unownedTask; w.resumed = true; stampStats.await_resumptions += 1;
      const owner = w.frame;
      // The action-less resumption gets no run token: it must never make a
      // focus read as caused (episode-focus rule); only issuers read it.
      current = owner ? continuationOf(owner, 'await') : (w.loose ? { ...continuationOf(w.loose, 'await'), run: null } : null);
      unownedTask = owner ? null : (w.task || null);
      const response = w.response || w.carry || null;
      if (current && response) current.response_of = response;
      w.response = null; w.carry = null;
    }
    if (!outcome) return value;
    if (!outcome.ok) throw outcome.value;
    return outcome.value;
  };
  const awaitEnd = w => { if (w && w.resumed) { current = w.restoreTo; unownedTask = w.restoreTask ?? null; w.resumed = false; } };
  if (global.EventSource) { const NativeEventSource = global.EventSource;
    global.EventSource = function ProductTraceEventSource(url, ...args) { const context = traceContext(); const active = captureOwner();
      emitTransport({ method: 'GET', url, traceparent: context.traceparent, context, active, transport: 'eventsource', internal: false });
      const instance = new NativeEventSource(url, ...args); const nativeAdd = instance.addEventListener;
      instance.addEventListener = function (type, listener, options) { return nativeAdd.call(this, type, wrapOwnedCallback(active, listener, 'stream'), options); };
      return instance; };
    global.EventSource.prototype = NativeEventSource.prototype;
  }
  // Client-side navigation (history.pushState / replaceState, back and
  // forward) as page.navigate rows. A router calls pushState inside the
  // continuation of the action that caused it, so the row carries that
  // action's id; a navigation outside every action carries none.
  try {
    const history = global.history;
    if (history && !history.__productTraceNavigation) {
      let lastPath = pagePath();
      // `from` is read just before the call: the URL can also change through
      // paths not hooked here (location.search=, the Navigation API).
      const navigated = (via, active, before = lastPath) => {
        const to = pagePath(); const from = before ?? lastPath; lastPath = to; if (to === from) return;
        emit({ kind: 'page.navigate', action_id: active?.action_id || null, via, from, to, ...(active?.continuation_id ? { parent_continuation_id: active.continuation_id } : {}) });
      };
      for (const method of ['pushState', 'replaceState']) {
        const native = history[method];
        if (typeof native !== 'function') continue;
        history[method] = function productTraceHistory(...args) { const before = pagePath(); const result = native.apply(this, args); try { const owner = captureOwner(); navigated(method, owner && !owner.stale_owner ? owner : null, before); } catch {} return result; };
      }
      global.addEventListener?.('popstate', () => { try { navigated('popstate', null); } catch {} }, true);
      Object.defineProperty(history, '__productTraceNavigation', { value: true });
    }
  } catch {}
  // The document title as the app sets it (labels on only): a page.title row
  // each time it changes, with the path it was set on. Apps set it a moment
  // after the route changes, so this is the page's own name, not a guess from
  // whichever click came next.
  try {
    if (LABELS_ON && global.document && typeof global.MutationObserver === 'function') {
      let lastTitle = null;
      const titleChanged = () => { const title = pageTitle(); if (!title || title === lastTitle) return; lastTitle = title; emit({ kind: 'page.title', page: pagePath(), title }); };
      const watch = () => { const head = global.document.head || global.document.documentElement; if (!head) return; new global.MutationObserver(titleChanged).observe(head, { subtree: true, childList: true, characterData: true }); titleChanged(); };
      if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', watch, { once: true }); else watch();
    }
  } catch {}
  // WebSocket: the connection (CONNECT row) and every message the page sends
  // (`network.send`: byte size only, never the content; owned by the frame
  // current when send() is called, like a worker post; outside every action
  // it carries `issuer`). A message carries no trace context, so what it
  // causes on a server can never be joined: chains state that as a frontier.
  const socketInfo = new WeakMap(); let socketSendWrapper = null;
  if (global.WebSocket) { const NativeWebSocket = global.WebSocket;
    global.WebSocket = function ProductTraceWebSocket(url, ...args) { const context = traceContext(); const active = captureOwner();
      const connection = emitTransport({ method: 'CONNECT', url, traceparent: context.traceparent, context, active, transport: 'websocket', internal: false });
      const instance = new NativeWebSocket(url, ...args); const nativeAdd = instance.addEventListener;
      try { socketInfo.set(instance, { connection_occurrence_id: connection, url: String(url || '').split('#')[0] }); } catch {}
      instance.addEventListener = function (type, listener, options) { return nativeAdd.call(this, type, wrapOwnedCallback(active, listener), options); };
      return instance; };
    global.WebSocket.prototype = NativeWebSocket.prototype;
    const nativeSocketSend = NativeWebSocket.prototype?.send;
    if (typeof nativeSocketSend === 'function') {
      const byteSize = data => {
        try {
          if (typeof data === 'string') { let bytes = 0; for (let index = 0; index < data.length; index += 1) { const code = data.charCodeAt(index); bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : (code >= 0xd800 && code < 0xdc00) ? (index += 1, 4) : 3; } return bytes; }
          if (data && typeof data.byteLength === 'number') return data.byteLength;
          if (data && typeof data.size === 'number') return data.size;
        } catch {}
        return null;
      };
      NativeWebSocket.prototype.send = socketSendWrapper = function productTraceWebSocketSend(data) {
        try {
          const info = socketInfo.get(this) || null; const owner = captureOwner();
          let url = info?.url ?? null; if (!url) { try { url = String(this.url || '').split('#')[0] || null; } catch {} }
          emit({ kind: 'network.send', transport: 'websocket', url, connection_occurrence_id: info?.connection_occurrence_id ?? null, bytes: byteSize(data),
            action_id: owner?.action_id || null, parent_continuation_id: owner?.continuation_id || null,
            ...(owner?.action_id ? { spine: spineFor(owner) } : { spine: { action_id: null, function_ids: [] }, issuer: issuerFor(current) }) });
        } catch {}
        return nativeSocketSend.apply(this, arguments);
      };
    }
  }
  // Creation-time capture for every continuation source. Microtask sources
  // (promise reactions, queueMicrotask) restore the previous frame: between
  // two listeners of one dispatch the checkpoint runs while that dispatch's
  // frame is still on the stack.
  const nativeThen = Promise.prototype.then; Promise.prototype.then = function (onFulfilled, onRejected) {
    const owner = captureOwner(); const origin = owner ? null : unownedTask; const response = responsePromises.get(this) || null;
    const wrap = fn => wrapOwnedCallback(owner, fn, 'promise', false, origin, response);
    const derived = nativeThen.call(this, wrap(onFulfilled), wrap(onRejected));
    if (response && derived && typeof derived === 'object') responsePromises.set(derived, response);
    return derived;
  };
  const nativeTimeout = global.setTimeout; global.setTimeout = function (fn, delay, ...args) { const owner = captureOwner(); const wrapped = wrapOwnedCallback(owner, fn, 'timer', true, taskOrigin(owner, 'setTimeout')); return nativeTimeout(wrapped, delay, ...args); };
  const nativeInterval = global.setInterval; if (nativeInterval) global.setInterval = function (fn, delay, ...args) { const owner = captureOwner(); const wrapped = wrapOwnedCallback(owner, fn, 'timer', true, taskOrigin(owner, 'setInterval')); return nativeInterval(wrapped, delay, ...args); };
  const nativeQueueMicrotask = global.queueMicrotask; if (nativeQueueMicrotask) global.queueMicrotask = fn => { const owner = captureOwner(); return nativeQueueMicrotask(wrapOwnedCallback(owner, fn, 'microtask', false, owner ? null : unownedTask)); };
  const nativeRequestAnimationFrame = global.requestAnimationFrame; if (typeof nativeRequestAnimationFrame === 'function') global.requestAnimationFrame = function (fn) { const owner = captureOwner(); return nativeRequestAnimationFrame.call(global, wrapOwnedCallback(owner, fn, 'animation_frame', true, taskOrigin(owner, 'requestAnimationFrame'))); };
  // MessageChannel: a message posted now is owned by the frame current at
  // postMessage. Ports are paired at construction; each port keeps the FIFO
  // of owners of messages posted to it, and each delivered message event
  // takes the next owner once (every handler of that event shares it).
  const MessagePortProto = global.MessagePort?.prototype, NativeMessageChannel = global.MessageChannel;
  let channelPorts = null; // { partners, inbound } once MessageChannel is wrapped; read by the Worker section
  if (MessagePortProto && typeof NativeMessageChannel === 'function' && typeof MessagePortProto.postMessage === 'function') {
    const partners = new WeakMap(), inbound = new WeakMap(), messageOwners = new WeakMap(), portHandlers = new WeakMap();
    channelPorts = { partners, inbound };
    const MAX_PENDING = 10000;
    const ownerForMessage = (port, event) => {
      if (!event || typeof event !== 'object') return null;
      if (messageOwners.has(event)) return messageOwners.get(event);
      const queue = inbound.get(port); const owner = queue && queue.length ? queue.shift() : null;
      messageOwners.set(event, owner); if (owner) stampStats.owned_messages += 1; return owner;
    };
    const portHandler = (port, handler) => {
      if (typeof handler !== 'function' || !partners.has(port)) return handler;
      let wrapped = portHandlers.get(handler);
      if (!wrapped) {
        wrapped = function (event) {
          const previous = current; const owner = ownerForMessage(port, event);
          // A message continuation marks its lineage `scheduler`: a MessagePort
          // loop (React's scheduler) runs later, unrelated work in the same
          // message, so effects flushed there need a receipt.
          current = owner ? { ...continuationOf(owner, 'message'), scheduler: true } : null;
          try { return handler.apply(this, arguments); } finally { if (previous && !previous.dispatch) stampStats.task_ambient_cleared += 1; current = null; }
        };
        portHandlers.set(handler, wrapped);
      }
      return wrapped;
    };
    global.MessageChannel = function MessageChannel() {
      const channel = new NativeMessageChannel();
      try { partners.set(channel.port1, channel.port2); partners.set(channel.port2, channel.port1); inbound.set(channel.port1, []); inbound.set(channel.port2, []); } catch {}
      return channel;
    };
    global.MessageChannel.prototype = NativeMessageChannel.prototype;
    const nativePost = MessagePortProto.postMessage;
    MessagePortProto.postMessage = function () {
      try { const partner = partners.get(this); const queue = partner && inbound.get(partner); if (queue && queue.length < MAX_PENDING) queue.push(captureOwner()); } catch {}
      return nativePost.apply(this, arguments);
    };
    const onmessage = Object.getOwnPropertyDescriptor(MessagePortProto, 'onmessage');
    if (onmessage?.set && onmessage?.get && onmessage.configurable) {
      const originals = new WeakMap();
      Object.defineProperty(MessagePortProto, 'onmessage', { configurable: true, enumerable: onmessage.enumerable,
        get() { return originals.has(this) ? originals.get(this) : onmessage.get.call(this); },
        set(handler) { originals.set(this, handler); onmessage.set.call(this, portHandler(this, handler)); } });
    }
    portListener = portHandler;
  }
  // ---- Web Workers: an explicit frontier, never silence ------------------
  // Worker code is not instrumented, so a request a worker makes never passes
  // the fetch/XHR wrappers above. What is recorded is where an action's work
  // crossed into a worker: `worker.create` for every Worker/SharedWorker
  // constructed (with the creating action, if any) and `worker.postMessage`
  // for every post to a worker (Worker#postMessage, a SharedWorker port, or a
  // MessageChannel port whose partner was transferred to a worker) made from
  // an action frame. The owner is captured at the call (creation-time
  // ownership through the calling continuation). Only a size class of the
  // message is recorded, never its content. A post made outside any action
  // is counted (`worker_posts_unowned`), not recorded as a row. Every
  // worker constructed on a page also records one `capture.limit` row
  // {feature: "worker_fetch", reason: "worker code is not instrumented"}
  // naming it: each is a realm this runtime does not observe.
  // Messages a worker posts back run under no action (not guessed).
  const workerInfo = new WeakMap(); // Worker/SharedWorker, its port, or a worker-bound MessagePort -> { worker_id, worker_kind, script_url }
  let workerSequence = 0, workerWrapped = false; // workerWrapped -> capture.page wrappers.worker
  const workerScriptUrl = value => {
    try { const text = String(value?.href ?? value ?? ''); return text.startsWith('data:') ? 'data:(inline)' : (text.split('#')[0].split('?')[0] || null); } catch { return null; }
  };
  // Bounded walk over own data properties (accessors are not invoked); the
  // byte count is approximate (UTF-16 code units for strings).
  const messageSizeClass = message => {
    if (message === undefined || message === null) return { message_size_class: 'none' };
    let bytes = 0, nodes = 0, bounded = false; const seen = new Set(); const stack = [message];
    try {
      while (stack.length) {
        const value = stack.pop();
        if (++nodes > 2000 || bytes >= 1048576) { bounded = true; break; }
        if (value === null || value === undefined) continue;
        const type = typeof value;
        if (type === 'string') { bytes += value.length * 2; continue; }
        if (type !== 'object') { bytes += 8; continue; }
        if (seen.has(value)) continue; seen.add(value);
        if (typeof ArrayBuffer === 'function' && (value instanceof ArrayBuffer || ArrayBuffer.isView?.(value))) { bytes += Number(value.byteLength) || 0; continue; }
        if (typeof Blob === 'function' && value instanceof Blob) { bytes += Number(value.size) || 0; continue; }
        if (value instanceof Map) { for (const [key, item] of value) stack.push(key, item); continue; }
        if (value instanceof Set) { for (const item of value) stack.push(item); continue; }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key of Object.keys(descriptors)) { bytes += key.length * 2; if ('value' in descriptors[key]) stack.push(descriptors[key].value); }
      }
    } catch { return { message_size_class: 'unmeasured' }; }
    const size = bytes < 1024 ? 'small' : bytes < 65536 ? 'medium' : bytes < 1048576 ? 'large' : 'huge';
    return bounded ? { message_size_class: size, size_bounded: true } : { message_size_class: size };
  };
  const transferListOf = transfer => { try { const list = Array.isArray(transfer) ? transfer : Array.isArray(transfer?.transfer) ? transfer.transfer : []; return list; } catch { return []; } };
  const recordWorkerPost = (info, via, message, transfer) => {
    const owner = captureOwner();
    const transferList = transferListOf(transfer);
    // A MessageChannel port handed to the worker: its partner now posts into
    // the worker, and nothing on this thread will ever read the transferred
    // port's owner queue.
    for (const port of transferList) {
      if (!MessagePortProto || !port || Object.getPrototypeOf(port) !== MessagePortProto) continue;
      const partner = channelPorts?.partners.get(port);
      if (partner) { workerInfo.set(partner, info); channelPorts.inbound.delete(port); }
    }
    if (!owner) { stampStats.worker_posts_unowned += 1; return; }
    emit({ kind: 'worker.postMessage', worker_id: info.worker_id, worker_kind: info.worker_kind, script_url: info.script_url, via,
      action_id: owner.action_id, action_occurrence_id: owner.action_id, parent_continuation_id: owner.continuation_id || null,
      terminal_owner_continuation_id: actionTerminalOwner.get(owner.action_id)?.continuation_id || null,
      ...messageSizeClass(message), transfer_count: transferList.length, instrumented: false, spine: spineFor(owner) });
  };
  const workerConstructors = { worker: 'absent', shared_worker: 'absent' }; // capture.page observes.transports
  const wrapWorkerConstructor = (name, worker_kind) => {
    const NativeWorker = global[name];
    const slot = worker_kind === 'shared' ? 'shared_worker' : 'worker';
    if (typeof NativeWorker !== 'function') return;
    if (typeof Proxy !== 'function') { workerConstructors[slot] = 'not_wrapped'; return; }
    workerWrapped = true; workerConstructors[slot] = 'wrapped';
    global[name] = new Proxy(NativeWorker, { construct(target, args, newTarget) {
      const owner = captureOwner();
      const instance = Reflect.construct(target, args, newTarget);
      try {
        const info = { worker_id: `worker:${pageSession}:${++workerSequence}`, worker_kind, script_url: workerScriptUrl(args[0]) };
        workerInfo.set(instance, info);
        if (worker_kind === 'shared' && instance.port) workerInfo.set(instance.port, info);
        reportLimit({ kind: 'capture.limit', feature: 'worker_fetch', reason: 'worker code is not instrumented', worker_id: info.worker_id, worker_kind, script_url: info.script_url });
        emit({ kind: 'worker.create', ...info, action_id: owner?.action_id || null, parent_continuation_id: owner?.continuation_id || null,
          instrumented: false, spine: spineFor(owner) });
      } catch {}
      return instance;
    } });
  };
  wrapWorkerConstructor('Worker', 'dedicated');
  wrapWorkerConstructor('SharedWorker', 'shared');
  const workerPost = global.Worker?.prototype?.postMessage;
  if (typeof workerPost === 'function') global.Worker.prototype.postMessage = function productTraceWorkerPostMessage(message, transfer) {
    const info = workerInfo.get(this); if (info) { try { recordWorkerPost(info, 'worker', message, transfer); } catch {} }
    return workerPost.apply(this, arguments);
  };
  const portPost = MessagePortProto?.postMessage;
  if (typeof portPost === 'function') MessagePortProto.postMessage = function productTraceWorkerPortPostMessage(message, transfer) {
    const info = workerInfo.get(this); if (info) { try { recordWorkerPost(info, 'message_port', message, transfer); } catch {} }
    return portPost.apply(this, arguments);
  };
  // Listeners are wrapped only when added under an action; unowned listeners
  // keep their identity and run inside the dispatch that invokes them. They
  // are not task-starting: dispatchEvent can call them synchronously.
  // React's own delegated listeners (a root or portal container marked
  // `_reactListening…`, a non-delegated element listener set `__reactEvents$…`)
  // are dispatch machinery registered while React commits whatever work is
  // pending; they are never owned (they would run every later React event in
  // that container under the action that happened to mount it).
  const reactEventTarget = target => { try { return Object.keys(target).some(key => key.startsWith('_reactListening') || key.startsWith('__reactEvents$')); } catch { return false; } };
  // Dispatch wins over registration (D-G1-19, D-G1-20). An owned listener is
  // one added while an action frame was current (D-G1-14). When it is invoked:
  // - by a trusted UI event (any UIEvent or ClipboardEvent, plus change,
  //   submit, select, scroll, ...): it never falls back to the
  //   registration owner. It runs on the current frame if the synchronous
  //   stack (function frames' `parent`) reaches a dispatch frame whose trusted
  //   event is still dispatching (eventPhase !== NONE), e.g. a `focus` fired by
  //   el.focus() inside a click handler; otherwise under no action (a
  //   `pointerdown`, which starts no Tracer action);
  // - by an untrusted event (dispatchEvent, which runs its listeners
  //   synchronously): it runs on the dispatcher's own frame, whatever that is
  //   (a handler under a live action, a timer continuation created under some
  //   action, or nothing);
  // - by any other trusted event (XHR/WebSocket/`load`/`message` ...): as in
  //   D-G1-19, a live trusted action dispatch on the stack wins, otherwise the
  //   registration owner applies.
  // A user-caused event follows the shared model: a trusted, listened event
  // dispatched in the document is recorded unless its interface or kind is
  // classified as not user-caused. Unknown kinds are recorded.
  const userEvent = event => userEventModel.isUserEvent(event);
  const enclosingDispatch = frame => {
    for (let cursor = frame, depth = 0; cursor && depth < 256; cursor = cursor.parent, depth += 1) {
      if (cursor.dispatch) return cursor;
      if (cursor.continuation_kind !== 'function') return null;
    }
    return null;
  };
  const liveTrustedDispatch = frame => { const dispatch = enclosingDispatch(frame); return Boolean(dispatch?.event?.isTrusted) && bareFrameLive(dispatch); };
  const wrapOwnedListener = (owner, listener) => function (event) {
    const previous = current, previousEvent = listenerEvent;
    // The event this listener was invoked with also stands in for window.event
    // here (a shadow-tree listener does not see window.event).
    listenerEvent = event;
    try {
      const ambient = settleAmbient();
      const isEvent = Boolean(event && typeof event === 'object' && typeof event.type === 'string' && 'isTrusted' in event);
      if (isEvent && event.isTrusted === false) {
        stampStats.owned_listeners_dispatcher += 1;
      } else if (isEvent && userEvent(event)) {
        const dispatch = enclosingDispatch(ambient);
        if (dispatch?.event?.isTrusted && dispatch.event.eventPhase !== 0) stampStats.owned_listeners_dispatch_won += 1;
        // Dispatched by live code (a continuation's el.focus()): its frame.
        else if (frameLive(ambient) && ambient.action_id) stampStats.owned_listeners_dispatch_won += 1;
        else { current = null; stampStats.owned_listeners_ui_unowned += 1; }
      } else if (liveTrustedDispatch(ambient)) stampStats.owned_listeners_dispatch_won += 1;
      else current = continuationOf(owner, 'listener');
      return listener.apply(this, arguments);
    } finally { current = previous; listenerEvent = previousEvent; }
  };
  listenerOwnerWrap = (listener, target) => { if (reactEventTarget(target)) return listener; const owner = captureOwner(); if (!owner) return listener; stampStats.owned_listeners += 1; return wrapOwnedListener(owner, listener); };
  // ---- Coverage rows ---------------------------------------------------------
  // capture.page once at install: which transports this runtime wraps. A
  // request made outside them (a Web Worker, navigator.sendBeacon, a resource
  // load) is never seen, so `beacon` is always false. `worker` is true when
  // the Worker/SharedWorker constructors are wrapped: the crossing into a
  // worker is recorded (worker.create / worker.postMessage), the requests the
  // worker makes are not (the `worker_fetch` capture.limit says so).
  const wrappers = { fetch: Boolean(nativeFetch), xhr: Boolean(global.XMLHttpRequest?.prototype), eventsource: Boolean(global.EventSource),
    websocket: Boolean(global.WebSocket), worker: workerWrapped, beacon: false };
  // observes: what this runtime actually installed on this page, measured
  // here, never a constant. `events`: the event kinds the browser exposes
  // (every `on*` handler property on the HTMLElement, Document and Window
  // prototype chains, enumerated now) against the kinds that start an action
  // (the listeners installed above). `transports`: wrapped / not_wrapped /
  // absent for each transport a request can leave through. `realms_at_install`:
  // child browsing contexts present now (later ones: capture.limit rows).
  // One list with the dispatch listeners (analysis/user-event-model.mjs handlerless_kinds).
  const HANDLERLESS_EVENT_KINDS = userEventModel.kinds.handlerless_kinds;
  const exposedEventKinds = (() => {
    const names = new Set();
    const collect = start => {
      for (let proto = start, depth = 0; proto && depth < 16; proto = Object.getPrototypeOf(proto), depth += 1) {
        let keys = []; try { keys = Object.getOwnPropertyNames(proto); } catch {}
        for (const key of keys) if (/^on[a-z]/u.test(key)) names.add(key.slice(2));
      }
    };
    try { collect(global.HTMLElement?.prototype); collect(global.Document?.prototype); collect(global); } catch {}
    // Kinds the platform dispatches with no on* property (data, the same list
    // fix/trusted-events uses, plus touch kinds where ontouch* is absent). The
    // enumeration is therefore a lower bound on what the browser can dispatch.
    for (const name of HANDLERLESS_EVENT_KINDS) names.add(name);
    return [...names].sort();
  })();
  const recordedEvents = [...actionListeners].sort();
  const transportStatus = (present, wrapped) => (!present ? 'absent' : wrapped ? 'wrapped' : 'not_wrapped');
  let serviceWorkerApi = false; try { serviceWorkerApi = Boolean(global.navigator && 'serviceWorker' in global.navigator && global.navigator.serviceWorker); } catch {}
  let frameCount = 0; try { frameCount = Number(global.length) || 0; } catch {}
  const observes = {
    // recorded: every kind the dispatch listeners listen for (D-G1-21: a
    // trusted event of any of them is recorded; not-user kinds as dom.event
    // rows); unobserved: what this independent enumeration finds exposed and
    // no listener covers. The same kinds as capture.page.user_events.listened.
    events: { recorded: recordedEvents, exposed_total: exposedEventKinds.length,
      unobserved: exposedEventKinds.filter(name => !recordedEvents.includes(name)), lower_bound: true,
      basis: 'on* handler properties of HTMLElement, Document and Window prototype chains at install, plus kinds dispatched with no on* property (user-event-model handlerless_kinds); a lower bound' },
    transports: { fetch: transportStatus(Boolean(nativeFetch), Boolean(nativeFetch)), xhr: transportStatus(Boolean(global.XMLHttpRequest?.prototype), Boolean(global.XMLHttpRequest?.prototype)),
      eventsource: transportStatus(Boolean(global.EventSource), Boolean(global.EventSource)), websocket: transportStatus(Boolean(global.WebSocket), Boolean(global.WebSocket)),
      worker: workerConstructors.worker, shared_worker: workerConstructors.shared_worker,
      beacon: transportStatus(typeof global.navigator?.sendBeacon === 'function', false), service_worker: transportStatus(serviceWorkerApi, false) },
    realms_at_install: { frames: frameCount },
  };
  let pageUrl = null; try { pageUrl = global.location ? `${global.location.origin}${global.location.pathname}` : null; } catch {}
  emit({ kind: 'capture.page', page_id: pageSession, runtime_version: RUNTIME_VERSION, build: buildId, react_versions: [...reactVersions],
    wrappers, observes, transport_rows: global.__PRODUCTTRACE_BRIDGE_TRANSPORT__ ? 'bridge' : 'runtime', url: pageUrl,
    // Body capture for this page: on | off | production_off (network.body rows only when on).
    bodies: BODY_MODE,
    // Typed text on dom.action rows: on | off | production_off (plugin option inputText).
    input_text: INPUT_TEXT_MODE,
    // Handler bindings on this page are observed at dispatch (D-G1-22:
    // `handler.binding` / `handler.invocation` rows); `dom.action.bound_handlers`
    // and element.stamp `handlers` are declared lists only.
    handler_bindings: 'observed',
    // The event kinds this page listens for (D-G1-21): discovered from the
    // browser's on* handler properties plus the handler-less kinds; which
    // dispatches are recorded is decided per event by interface (the model's
    // user_interfaces / user_plain_kinds; USER_EVENT_KINDS in
    // analysis/user-event-model.mjs). A kind not listed here is not observed.
    user_events: { model_version: userEventModel.kinds.version, listened: userEventDiscovery.listened, on_handler_kinds: userEventDiscovery.on_handler_kinds,
      supplemented: userEventDiscovery.supplemented, sources: userEventDiscovery.sources, not_user_interfaces: userEventModel.kinds.not_user_interfaces,
      not_user_kinds: userEventModel.kinds.not_user_kinds, continuous_kinds: userEventModel.kinds.continuous_kinds, boundary_kinds: userEventModel.kinds.boundary_kinds,
      untrusted: 'dom.untrusted rows, never actions', not_user: 'dom.event rows (user: false), first per kind and target; all counted',
      realms: 'this document and its shadow roots only (iframes and workers are separate realms)' },
    parent_continuation_id: null });
  // Realms present in the document that this runtime cannot observe: every
  // child browsing context (window.length / window[i]: iframes, frames,
  // objects holding a document), whether it is same-origin (its location is
  // readable) or not, never its content; and a service worker controlling the
  // page. One capture.limit row per realm when first seen; a `capture.realm`
  // row when a frame's origin status changes later (a frame first seen on its
  // initial about:blank document, then navigated cross-origin).
  const realmInfo = new WeakMap(); let realmSequence = 0, serviceWorkerReported = false; const realmTally = { frames_seen: 0 };
  checkRealms = () => {
    let count = 0; try { count = Number(global.length) || 0; } catch { return; }
    for (let index = 0; index < count; index += 1) {
      let frame = null; try { frame = global[index]; } catch {}
      if (!frame || (typeof frame !== 'object' && typeof frame !== 'function')) continue;
      let sameOrigin = false, url = null, initial = false;
      try { const location = frame.location; initial = /^about:/u.test(String(location.href)); url = initial ? String(location.href) : `${location.origin}${location.pathname}`; sameOrigin = true; } catch { sameOrigin = false; url = null; }
      const known = realmInfo.get(frame);
      if (!known) {
        const info = { realm_id: `realm:${pageSession}:${++realmSequence}`, same_origin: sameOrigin };
        realmInfo.set(frame, info); realmTally.frames_seen += 1;
        reportLimit({ kind: 'capture.limit', feature: 'realm', realm_kind: 'frame', realm_id: info.realm_id, same_origin: sameOrigin, url,
          reason: 'a child browsing context: its code runs outside this page\'s runtime; its events and requests are not recorded', parent_continuation_id: null });
      } else if (known.same_origin !== sameOrigin && !(known.from_element && sameOrigin && initial)) {
        known.same_origin = sameOrigin;
        emit({ kind: 'capture.realm', realm_kind: 'frame', realm_id: known.realm_id, same_origin: sameOrigin, url, update: true, parent_continuation_id: null });
      }
    }
    if (!serviceWorkerReported) {
      let controller = null; try { controller = global.navigator?.serviceWorker?.controller || null; } catch {}
      if (controller) {
        serviceWorkerReported = true;
        let scriptUrl = null; try { scriptUrl = String(controller.scriptURL || '').split('#')[0].split('?')[0] || null; } catch {}
        reportLimit({ kind: 'capture.limit', feature: 'realm', realm_kind: 'service_worker', realm_id: `realm:${pageSession}:service_worker`, same_origin: true, url: scriptUrl,
          reason: 'a service worker controls this page: requests it makes, and responses it answers itself, are not recorded', parent_continuation_id: null });
      }
    }
  };
  // Frames recorded when inserted, not only at the check points: a native
  // MutationObserver on the document and on every shadow root (attachShadow)
  // looks at added nodes for navigable containers (the HTML elements that
  // create a child browsing context: iframe, frame, object, embed). The
  // origin is decided from the element's own src/data/srcdoc/sandbox
  // attributes (never its content), since at insertion its window still
  // holds the initial about:blank document.
  const NAVIGABLE_CONTAINERS = 'iframe,frame,object,embed';
  const seenContainers = new WeakSet();
  const containerOrigin = element => {
    try {
      const sandbox = element.getAttribute('sandbox');
      if (sandbox !== null && !/(?:^|\s)allow-same-origin(?:\s|$)/u.test(sandbox)) return { same_origin: false, url: null };
      if (element.hasAttribute('srcdoc')) return { same_origin: true, url: 'about:srcdoc' };
      const source = element.getAttribute('src') ?? element.getAttribute('data') ?? '';
      if (!source || /^\s*about:/iu.test(source) || /^\s*javascript:/iu.test(source)) return { same_origin: true, url: 'about:blank' };
      const target = new URL(source, global.document.baseURI);
      const same = target.origin === global.location.origin;
      return { same_origin: same, url: same ? `${target.origin}${target.pathname}` : null };
    } catch { return { same_origin: false, url: null }; }
  };
  const recordContainer = element => {
    if (!element || seenContainers.has(element)) return;
    seenContainers.add(element);
    let win = null; try { win = element.contentWindow || null; } catch {}
    if (win && realmInfo.has(win)) return;
    const origin = containerOrigin(element);
    const info = { realm_id: `realm:${pageSession}:${++realmSequence}`, same_origin: origin.same_origin, from_element: true };
    if (win) realmInfo.set(win, info);
    realmTally.frames_seen += 1;
    let tag = null; try { tag = String(element.tagName || '').toLowerCase() || null; } catch {}
    reportLimit({ kind: 'capture.limit', feature: 'realm', realm_kind: 'frame', realm_id: info.realm_id, same_origin: origin.same_origin, url: origin.url, element: tag, via: 'inserted',
      reason: 'a child browsing context: its code runs outside this page\'s runtime; its events and requests are not recorded', parent_continuation_id: null });
  };
  const scanForContainers = node => {
    if (!node || node.nodeType !== 1 && node.nodeType !== 11) return;
    try { if (node.nodeType === 1 && node.matches(NAVIGABLE_CONTAINERS)) recordContainer(node); } catch {}
    try { for (const element of node.querySelectorAll(NAVIGABLE_CONTAINERS)) recordContainer(element); } catch {}
  };
  let realmObserver = null;
  try {
    if (typeof global.MutationObserver === 'function') realmObserver = new global.MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes || []) scanForContainers(node);
    });
  } catch {}
  observeRealmRoot = root => {
    if (!realmObserver || !root) return;
    try { realmObserver.observe(root, { childList: true, subtree: true }); } catch {}
    scanForContainers(root);
  };
  if (global.document) observeRealmRoot(global.document);
  checkRealms();
  if (global.addEventListener) global.addEventListener('load', () => checkRealms());
  // capture.summary at pagehide (and on demand): totals emitted so far,
  // including this row, so `emitted_by_kind` / `last_sequence` can be checked
  // against what the collector received.
  // The wrappers installed above, by identity: at every summary each live
  // global is compared with them; one replaced after install is reported
  // (`wrapper_replaced`), since requests through the replacement are recorded
  // only if it still calls the runtime's wrapper.
  const installedWrappers = [];
  const noteWrapper = (name, read) => { let value = null; try { value = read(); } catch {} if (typeof value === 'function') installedWrappers.push({ name, read, value }); };
  if (wrappers.fetch) noteWrapper('fetch', () => global.fetch);
  if (wrappers.xhr) { noteWrapper('xhr.open', () => global.XMLHttpRequest.prototype.open); noteWrapper('xhr.send', () => global.XMLHttpRequest.prototype.send); }
  if (wrappers.eventsource) noteWrapper('eventsource', () => global.EventSource);
  if (wrappers.websocket) { noteWrapper('websocket', () => global.WebSocket); if (socketSendWrapper) noteWrapper('websocket.send', () => global.WebSocket.prototype.send); }
  if (workerConstructors.worker === 'wrapped') noteWrapper('worker', () => global.Worker);
  if (workerConstructors.shared_worker === 'wrapped') noteWrapper('shared_worker', () => global.SharedWorker);
  const replacedWrappers = () => installedWrappers.filter(entry => { try { return entry.read() !== entry.value; } catch { return true; } }).map(entry => entry.name);
  const captureSummary = (trigger = 'flush') => {
    checkRealms();
    // An open continuous range is closed first, so its row is counted here.
    closeRanges(`summary_${String(trigger)}`);
    if (lastActionWindow) flushFunctionWindow(lastActionWindow);
    let sink = null;
    try { const stats = global.__productTraceCollectorStats?.(); if (stats && typeof stats === 'object') sink = { received: stats.received ?? null, sent: stats.sent ?? null, queued: stats.queued ?? null, retries: stats.retries ?? null, dropped: stats.dropped ?? null, malformed: stats.malformed ?? null, beacon: stats.beacon ?? null }; } catch {}
    const next = sequence + 1;
    const row = emit({ kind: 'capture.summary', page_id: pageSession, trigger: String(trigger), runtime_version: RUNTIME_VERSION, build: buildId, react_versions: [...reactVersions],
      emitted_by_kind: { ...emittedByKind, 'capture.summary': (emittedByKind['capture.summary'] || 0) + 1 }, rows_emitted: next, last_sequence: next,
      stamps_emitted: stampSequence, last_stamp_sequence: stampSequence, capture_limits: captureLimitFeatures.length, capture_limit_features: [...new Set(captureLimitFeatures)],
      host_errors: hostErrors, dropped: sink ? sink.dropped : null, malformed: sink ? sink.malformed : null, sink,
      bodies: BODY_MODE, bodies_emitted: bodySequence, last_body_sequence: bodySequence, body_truncations: bodyStats.truncated, bodies_not_captured: bodyStats.not_captured,
      bodies_pending: bodyStats.pending,
      body_redactions: bodyStats.redactions, body_errors: bodyStats.errors,
      // Child browsing contexts seen on this page so far, and present now.
      wrapper_replaced: replacedWrappers(),
      realms: { frames_seen: realmTally.frames_seen, frames_now: (() => { try { return Number(global.length) || 0; } catch { return null; } })(), workers_created: workerSequence },
      // Trusted user events handled so far (D-G1-21): recorded per kind (one
      // dom.action each), coalesced per kind (events folded into ranges),
      // untrusted events skipped, trusted non-user events seen per kind.
      user_events: { recorded_by_kind: { ...userEventCounts.recorded }, coalesced_by_kind: { ...userEventCounts.coalesced }, ranges: userEventCounts.ranges,
        hover_segments: userEventCounts.hover_segments, not_user_rows_emitted: lifecycleSequence, untrusted_skipped: userEventCounts.untrusted_skipped, untrusted_by_kind: { ...userEventCounts.untrusted_by_kind },
        not_user_by_kind: { ...userEventCounts.not_user } },
      parent_continuation_id: null });
    lastSummarySequence = row?.sequence ?? null; return row;
  };
  // A collector sink installed before the runtime asks for the summary first
  // in its own pagehide listener (so the row ships in the same beacon); this
  // one covers every other host, and skips when the summary is already last.
  if (global.addEventListener) global.addEventListener('pagehide', () => { if (lastSummarySequence !== sequence) captureSummary('pagehide'); });
  global.__productTraceRuntime = { enter, exit, threw, emit, identity, records, tag, registerFunction, registerClass, functionIdOf, captureSummary, runtimeVersion: RUNTIME_VERSION,
    registerPlacements, registerBuild, validateAnnotationMetadata, validateAnnotationLabel, session: pageSession,
    awaitBegin, awaitSuspend, awaitLeave, awaitResume, awaitEnd,
    stampStats: () => ({ ...stampStats, build: buildId, placements: placementTable.size }), bodyStats: () => ({ mode: BODY_MODE, ...bodyStats, last_body_sequence: bodySequence }), flushFunctionWindow: () => lastActionWindow ? flushFunctionWindow(lastActionWindow) : null, registerManifest: rows => { for (const row of rows || []) if (Number.isInteger(row?.index) && row.id) functionManifest.set(row.index, row.id); }, wrapContinuation, context: () => current, libraryCall: (library, exportName, args) => emit({ kind: 'library.call', library, export: exportName, arguments: Array.from(args || [], identity), opaque: true }) };
})(typeof globalThis !== 'undefined' ? globalThis : window);
