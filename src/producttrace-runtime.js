/* producttrace-runtime — map-driven runtime capture for React products.
 *
 * Load BEFORE React (script tag above the bundle, or first import in the entry).
 * Three evidence providers, one workflow timeline:
 *   identity/render — React DevTools global hook (fiber tree)
 *   actions         — capturing DOM listeners bridged to the owning component
 *   visibility      — route changes, focus/blur, page visibility
 *
 * Principles (see Producttrace PLAN.md):
 *   - identifiers attach, timestamps only order;
 *   - capture wide internally, emit meaningful workflow checkpoints by default;
 *   - abstain over guess: missing identity is emitted as null, never invented.
 */
(function () {
  'use strict';
  if (window.ProductTrace) return;

  // ------------------------------------------------------------------ state
  var seq = 0;
  var records = [];
  var options = {
    endpoint: null,
    onRecord: null,
    sink: null,
    console: false,
    maxBuffer: 20000,
    outputMode: 'operations',
    operationSettleMs: 250,
    workflowIdleMs: 30000,
  };
  var bindings = { name: 'unbound', identity: {}, actions: [], surfaces: [] };
  var sessionId = 'pt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  var MAX_PENDING = 5000;
  var pending = [];
  var flushTimer = null;
  var pendingDropDiagnostic = null;
  var pendingDropCount = 0;
  var kindCounts = {};
  var observeTimes = [];
  var errorCount = 0;
  var consecutiveErrors = 0;
  var dropCount = 0;
  var deliveredCount = 0;
  var inFlightCount = 0;
  var sinkErrorCount = 0;
  var sinkMode = 'none';
  var sinkWarned = false;
  var sinkFailureWarned = false;
  var started = false;
  var stopped = false;
  var disabled = false;
  var disabledReason = null;
  var recorder = null;
  var MAX_DISCOVERY = 500;
  var discoverEnabled = false;
  var discoveryEntries = [];
  var discoveryByKey = {};
  var discoveryTruncated = false;
  var lifecycleStateActions=new WeakMap();
  var ACTION_STAMP_GLOBAL = '__PRODUCTTRACE_ACTION_STAMP__';
  var actionEventStamps = new WeakMap();
  var actionRecordsByStamp = {};
  var activeRefAction = null;
  var activeNativeActionEvent = null;
  var pendingReactActionStamp = null;
  var pendingReactActionToken = 0;
  var evidenceSeq = 0;
  var operationCounter = 0;
  var pendingOperationByForm = new WeakMap();
  var pendingOperations = [];
  var operationByStamp = {};
  var workflowCounter = 0;
  var activeWorkflow = null;
  var workflowSurfaceCounter = 0;
  var workflowSurfaceIds = new WeakMap();

  function nowMs() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function storeRecord(rec, enqueue) {
    rec.v = 1;
    rec.seq = ++seq;
    rec.ts = Date.now();
    if (rec.kind !== 'workflow_event') {
      rec.session = sessionId;
      rec.target_id = globalThis.__productTraceTargetId || null;
      rec.scenario_id = globalThis.__productTraceScenarioId || null;
    }
    records.push(rec);
    kindCounts[rec.kind] = (kindCounts[rec.kind] || 0) + 1;
    if (records.length > options.maxBuffer) records.shift();
    if (options.console) console.debug('[pt]', rec.kind, rec);
    if (enqueue !== false) deliverRecord(rec);
    return rec;
  }

  function exposeActionStamp(stamp) {
    try { window[ACTION_STAMP_GLOBAL] = stamp; } catch (_) {}
    var clear = function () {
      if(activeNativeActionEvent && activeNativeActionEvent.eventPhase===0)activeNativeActionEvent=null;
      try {
        if (window[ACTION_STAMP_GLOBAL] === stamp) delete window[ACTION_STAMP_GLOBAL];
      } catch (_) {
        try { if (window[ACTION_STAMP_GLOBAL] === stamp) window[ACTION_STAMP_GLOBAL] = null; } catch (_) {}
      }
    };
    // React may run its delegated handler after a microtask checkpoint even
    // though it still belongs to this native browser event. Keep the stamp for
    // the rest of the event task, then remove it before the next task can begin.
    setTimeout(clear, 0);
  }

  function armNextReactCommit(stamp) {
    pendingReactActionStamp = stamp;
    var token = ++pendingReactActionToken;
    setTimeout(function () {
      if (pendingReactActionToken === token) pendingReactActionStamp = null;
    }, 0);
  }

  function resolveSink() {
    if (typeof options.endpoint === 'string' && options.endpoint.length > 0) {
      sinkMode = 'endpoint';
    } else if (typeof options.onRecord === 'function') {
      sinkMode = 'onRecord';
    } else if (options.sink === 'buffer') {
      sinkMode = 'buffer';
    } else {
      sinkMode = 'none';
    }
  }

  function warnNoSink() {
    if (sinkWarned) return;
    sinkWarned = true;
    console.warn("[ProductTrace] No sink configured; records are buffered locally only. " +
      "Pass endpoint, onRecord, or sink:'buffer' to start().");
  }

  function warnSinkFailure() {
    if (sinkFailureWarned) return;
    sinkFailureWarned = true;
    console.warn('[ProductTrace] onRecord failed; inspect status().sink_errors and records_dropped.');
  }

  function deliverRecord(rec) {
    if (sinkMode === 'endpoint') {
      queueRecord(rec);
      return;
    }
    if (sinkMode === 'onRecord') {
      try {
        var result = options.onRecord(rec);
        if (result && typeof result.then === 'function') {
          inFlightCount++;
          result.then(function () {
            inFlightCount--;
            deliveredCount++;
          }, function () {
            inFlightCount--;
            sinkErrorCount++;
            dropCount++;
            warnSinkFailure();
          });
        } else {
          deliveredCount++;
        }
      } catch (e) {
        sinkErrorCount++;
        dropCount++;
        warnSinkFailure();
      }
      return;
    }
    if (sinkMode === 'none') warnNoSink();
  }

  function refreshDropDiagnostic() {
    if (!pendingDropDiagnostic) {
      if (pending.length >= MAX_PENDING) {
        pending.shift();
        dropCount++;
        pendingDropCount++;
      }
      pendingDropDiagnostic = storeRecord({
        kind: 'diagnostic',
        event: 'records_dropped',
        count: pendingDropCount,
        reason: 'pending_upload_queue_cap',
      }, false);
      pending.push(pendingDropDiagnostic);
    } else {
      pendingDropDiagnostic.count = pendingDropCount;
      pendingDropDiagnostic.ts = Date.now();
    }
  }

  function enforcePendingCap() {
    if (pending.length <= MAX_PENDING) return;
    var removeCount = pending.length - MAX_PENDING;
    if (!pendingDropDiagnostic) removeCount++;
    var removed = pending.splice(0, removeCount);
    if (removed.indexOf(pendingDropDiagnostic) !== -1) pendingDropDiagnostic = null;
    dropCount += removed.length;
    pendingDropCount += removed.length;
    refreshDropDiagnostic();
  }

  function queueRecord(rec) {
    pending.push(rec);
    enforcePendingCap();
    if (!flushTimer && !disabled) flushTimer = setTimeout(flush, 1000);
  }

  function emit(rec) {
    return storeRecord(rec, true);
  }

  function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!pending.length) return;
    var batch = pending.splice(0, pending.length);
    inFlightCount += batch.length;
    var batchDropDiagnostic = pendingDropDiagnostic;
    pendingDropDiagnostic = null;
    pendingDropCount = 0;
    function restoreBatch() {
      inFlightCount -= batch.length;
      pending = batch.concat(pending);
      if (batchDropDiagnostic && pending.indexOf(batchDropDiagnostic) !== -1) {
        pendingDropDiagnostic = batchDropDiagnostic;
        pendingDropCount = batchDropDiagnostic.count || 0;
      }
      enforcePendingCap();
      if (!flushTimer && !disabled) flushTimer = setTimeout(flush, 1000);
    }
    function markDelivered(response) {
      if (response && response.ok === false) {
        restoreBatch();
        return;
      }
      inFlightCount -= batch.length;
      deliveredCount += batch.length;
    }
    try {
      var request = fetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
      });
      if (request && typeof request.then === 'function') request.then(markDelivered, restoreBatch);
      else markDelivered(request);
    } catch (e) { restoreBatch(); }
  }

  function recordObservation(duration) {
    observeTimes.push(duration);
    if (observeTimes.length > 10000) observeTimes.shift();
  }

  function observe(kind, fn) {
    if (!started || disabled) return;
    var before = nowMs();
    var failed = false;
    try {
      var result = fn();
      consecutiveErrors = 0;
      return result;
    } catch (e) {
      failed = true;
      errorCount++;
      consecutiveErrors++;
    } finally {
      recordObservation(Math.max(0, nowMs() - before));
      if (failed && consecutiveErrors >= 10) disable('observer_error_budget', true);
    }
  }

  // ------------------------------------------------- react hook (identity)
  var hookMode = 'none';
  var commitCount = 0;
  var rootIdentityCount = 0;
  var fiberIdentityCount = 0;
  var rootIdentities = typeof WeakMap === 'function' ? new WeakMap() : null;
  var classFiberInstances = typeof WeakMap === 'function' ? new WeakMap() : null;
  var fiberIdentities = typeof WeakMap === 'function' ? new WeakMap() : null;
  var mountCursor = 0;
  var mountEvents = [];
  var mountedControls = {};
  var hookTarget = null;
  var hookPrevious = null;
  var hookWrapper = null;
  var hookStrictPrevious=null,hookStrictWrapper=null,hookStrictHadOwn=false;
  var hookUnmountPrevious = null;
  var hookUnmountWrapper = null;
  var hookCreated = null;
  var hookOriginalGlobal = null;
  var lifecycleEntries = {};
  var lifecycleReducerKeys = {};
  var lifecycleDispatcherOwners = {};
  var lifecycleDispatcherMarkers = new WeakMap();
  var lifecycleSelectedDispatcherRef = null;
  var lifecycleObservationCount = 0;
  var lifecycleRenderCount = 0;
  var lifecycleInvocationCount = 0;
  var lifecycleActiveCallbackInvocation = null;
  var lifecycleActiveStoreNotification = null;
  var lifecycleFiberOwners = {};
  var lifecycleSelectedFiberRenderer = null;
  var lifecycleCommittedRenders = typeof WeakMap === 'function' ? new WeakMap() : null;
  var lifecycleValueObjects = typeof WeakMap === 'function' ? new WeakMap() : null;
  var lifecycleFiberRenders = typeof WeakMap === 'function' ? new WeakMap() : null;
  // A new attempt at the same stable source position is positive evidence that
  // the older attempt was superseded. We never infer abandonment from time or
  // from the absence of a commit.
  var lifecycleRenderPositions = {};
  var lifecycleRenderPositionIds = {};
  var lifecycleCallbackStates = typeof WeakMap === 'function' ? new WeakMap() : null;
  var lifecycleContextEntries = typeof WeakMap === 'function' ? new WeakMap() : null;
  var lifecycleContextInputs = typeof WeakMap === 'function' ? new WeakMap() : null;
  var lifecycleFallbackCurrentRender = null;
  var lifecycleFallbackInstanceCount = 0;

  function indexLifecycleManifest() {
    lifecycleEntries = {};
    var manifest = bindings && bindings.react_lifecycle;
    if (!manifest || manifest.schema !== 'producttrace.react-lifecycle-manifest.v1'
        || typeof manifest.map_fingerprint !== 'string' || !Array.isArray(manifest.entries)) return;
    for (var i = 0; i < manifest.entries.length; i++) {
      var entry = manifest.entries[i];
      if (entry && typeof entry.key === 'string' && entry.key) {
        lifecycleEntries[entry.key] = entry;
        if(entry.observes_state_reducer)lifecycleReducerKeys[entry.key]=true;
      }
    }
  }

  function currentReactFiber() {
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    var renderers = hook && hook.renderers;
    if (!renderers || typeof renderers.forEach !== 'function') return null;
    var selected = null;
    renderers.forEach(function (renderer) {
      if (selected || !renderer || typeof renderer.getCurrentFiber !== 'function') return;
      try { selected = renderer.getCurrentFiber() || null; if(selected)lifecycleSelectedFiberRenderer=renderer; } catch (_) {}
    });
    return selected;
  }

  function currentReactDispatcher() {
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    var renderers = hook && hook.renderers;
    if (!renderers || typeof renderers.forEach !== 'function') return null;
    var selected = null;
    renderers.forEach(function (renderer) {
      var ref = renderer && renderer.currentDispatcherRef;
      if (!selected && ref && ref.current) {selected = ref.current;lifecycleSelectedDispatcherRef=ref;}
    });
    return selected;
  }

  function rootForFiber(fiber) {
    var current = fiber;
    var hops = 0;
    while (current && current.return && hops++ < 200) current = current.return;
    return current && current.tag === 3 ? current.stateNode : null;
  }

  function ensureRootIdentity(root) {
    if (!root) return null;
    var rootId = rootIdentities && rootIdentities.get(root);
    if (!rootId) {
      rootId = 'react-root:' + (++rootIdentityCount);
      if (rootIdentities) rootIdentities.set(root, rootId);
    }
    return rootId;
  }

  function ensureFiberIdentity(fiber) {
    if (!fiber || !fiberIdentities) return null;
    var identity = fiberIdentities.get(fiber)
      || (fiber.alternate && fiberIdentities.get(fiber.alternate));
    // A commit traversal already established this Fiber's root. Reuse that
    // private identity when a later render exceeds the bounded ancestor walk.
    var rootId = identity && identity.root_id || ensureRootIdentity(rootForFiber(fiber));
    if (!rootId) return null;
    if (!identity) identity = {
      root_id: rootId,
      instance_id: 'react-instance:' + (++fiberIdentityCount),
      mount_id: 'react-mount:' + fiberIdentityCount,
      commit_id: null,
      render_id: null,
      render_observed: false,
      runtime_observed: true,
      basis: 'react-devtools-renderer.v1',
    };
    fiberIdentities.set(fiber, identity);
    if (fiber.alternate) fiberIdentities.set(fiber.alternate, identity);
    return identity;
  }

  function setFiberRender(fiber, render) {
    if (!fiber || !lifecycleFiberRenders) return;
    lifecycleFiberRenders.set(fiber, render);
    if (fiber.alternate) lifecycleFiberRenders.set(fiber.alternate, render);
  }

  function getFiberRender(fiber) {
    if (!fiber || !lifecycleFiberRenders) return null;
    return lifecycleFiberRenders.get(fiber)
      || (fiber.alternate && lifecycleFiberRenders.get(fiber.alternate)) || null;
  }

  function fiberRenderPosition(fiber, entry) {
    if (!fiber || !entry) return null;
    var rootId = ensureRootIdentity(rootForFiber(fiber));
    if (!rootId) return null;
    var path = [];
    var current = fiber;
    var hops = 0;
    while (current && current.return && hops++ < 200) {
      path.push(String(Number.isInteger(current.index) ? current.index : 0)
        + ':' + (current.key == null ? '' : String(current.key)));
      current = current.return;
    }
    return rootId + '\u0000' + entry.owner_source_id + '\u0000' + path.reverse().join('/');
  }

  function lifecycleContextKey(){return sessionId+':'+(bindings.react_lifecycle&&bindings.react_lifecycle.map_fingerprint||'unmapped');}

  function lifecycleId(label) {
    return sessionId + ':react:' + label + ':' + (++lifecycleObservationCount);
  }

  function lifecycleRendererBuild() {
    var hook=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    var profiles=[];
    if(hook && hook.renderers && typeof hook.renderers.forEach==='function') {
      hook.renderers.forEach(function(renderer) {
        if(!renderer || renderer.rendererPackageName!=='react-dom')return;
        var profile=renderer.bundleType===0?'production':renderer.bundleType===1?'development':null;
        if(profile && profiles.indexOf(profile)===-1)profiles.push(profile);
      });
    }
    return profiles.length===1?profiles[0]:null;
  }

  // BEGIN GENERATED REACT BOUNDARY OBSERVER
  function readReactBoundaryValue(rule,value,usage) {
    if(usage==='read')return {usage,value_type:typeof value,marker:typeof value==='symbol'?Symbol.keyFor(value)||null:null};
    let marker,type;
    try {
      if(value===null || typeof value!=='object')return {usage,reason:'boundary_element_required'};
      marker=Object.getOwnPropertyDescriptor(value,'$$typeof');
      type=Object.getOwnPropertyDescriptor(value,rule.type_property);
    } catch (_) {return {usage,reason:'boundary_element_descriptor_unobserved'};}
    if(!marker || !type || !Object.prototype.hasOwnProperty.call(marker,'value') || !Object.prototype.hasOwnProperty.call(type,'value'))
      return {usage,reason:'boundary_element_data_properties_required'};
    return {usage,value_type:typeof type.value,marker:typeof type.value==='symbol'?Symbol.keyFor(type.value)||null:null,
      element_marker:typeof marker.value==='symbol'?Symbol.keyFor(marker.value)||null:null};
  }
  // END GENERATED REACT BOUNDARY OBSERVER

  function lifecycleApiObservation(key, value, expectedKind, operation, scope) {
    var entry = lifecycleEntry(key, expectedKind);
    if (!entry || !started || disabled) return value;
    var observationId = lifecycleId('api_' + operation);
    if(entry.boundary_rule && operation==='element_created')profilerObserver.created(entry,value,observationId);
    var resultKind = scope ? scope.result.kind : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    var activeFiber = currentReactFiber();
    var activeRender = getFiberRender(activeFiber);
    emit({
      schema: 'producttrace.react-api-observation.v1',
      kind: 'react_api',
      map_fingerprint: bindings.react_lifecycle.map_fingerprint,
      manifest_key: key,
      observation_id: observationId,
      occurrence_id: observationId + ':occurrence',
      evidence_ids: [observationId],
      source_call_id: entry.source_call_id,
      semantic_id: entry.semantic_id,
      surface: entry.surface,
      export: entry.export,
      operation: operation,
      result_kind: scope?scope.result.kind:resultKind,
      scope:scope||undefined,
      boundary_value:entry.boundary_rule?readReactBoundaryValue(entry.boundary_rule,value,operation):undefined,
      boundary_input:entry.boundary_rule && operation==='element_created'?boundaryCommitObserver.created(entry,value,observationId):undefined,
      export_value:entry.literal_export_rule ? encodedLifecycleValue(value) : undefined,
      export_build:entry.literal_export_rule ? lifecycleRendererBuild() : undefined,
      predicate_result:entry.predicate_rule && operation!=='threw' && typeof value==='boolean' ? {encoding:'primitive',value:value} : undefined,
      runtime_observed: true,
      // Hook calls run while the next render is still only attempted. Do not
      // attach the prior commit's identity to that new occurrence.
      react_lifecycle_identity: activeRender && activeRender.status === 'committed'
        ? nearestCommittedLifecycleIdentity(activeFiber)
        : null,
    });
    return value;
  }

  // BEGIN GENERATED REACT HOST OBSERVER
  function createReactHostObserver(config) {
   let active=null;
   const prepare=frame=>{
    frame.record.input=frame.snapshot(frame.args[frame.entry.host_rule.argument]);
    try{frame.inspection=config.inspect?.(frame.args[frame.entry.host_rule.argument],frame.snapshot,frame.entry.host_rule,frame.args);
     if(frame.inspection?.evidence)frame.record.lookup=frame.inspection.evidence;
     else frame.record.frontier='host_input_context_unobserved';
    }catch(_){frame.record.frontier='host_input_context_unobserved';}
   };
   const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled()||!entry?.host_rule)return run();
    const previous=active,values=[];
    const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));if(!row){row={value,id:config.id('host_value')};values.push(row);}
     return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
    const action=config.action?.();
    const record={manifest_key:key,observation_id:config.id('host_lookup'),operation:'returned',inputs:{},
     action:action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null};
    const frame={key,entry,record,args:[],snapshot,context:config.context?.()||'default'};active=frame;
    if(entry.host_argument_count===0)prepare(frame);
    try{const result=run();record.result=snapshot(result);return result;}
    catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
    finally{active=previous;try{
      if(frame.inspection?.complete){try{frame.record.lookup.after=frame.inspection.complete();}catch(_){frame.record.frontier='host_completion_unobserved';}}
      if(frame.inspection?.unchanged&&!frame.inspection.unchanged())record.frontier='host_commit_changed_during_lookup';
      if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);
     }catch(_){};}
   };
   const argument=(key,index,value)=>{const frame=active;if(frame?.key===key){frame.args[index]=value;frame.record.inputs[index]=frame.snapshot(value);
     if(index===frame.entry.host_argument_count-1)prepare(frame);}return value;};
   return {hostCall:call,hostArgument:argument};
  }
  // END GENERATED REACT HOST OBSERVER
  // Only roots received from the renderer's commit hook qualify as legacy roots.
  // A similarly named property on an arbitrary object is not React provenance.
  var committedContainerRoots=new WeakMap();
  function inspectLegacyRender(value,snapshot,rule,args) {
    var type;try{type=Object.getOwnPropertyDescriptor(window.Node.prototype,'nodeType').get.call(value);}catch(_){return null;}
    if([1,9,11].indexOf(type)===-1)return null;
    var descriptor=Object.getOwnPropertyDescriptor(value,'_reactRootContainer');
    if(descriptor && !Object.prototype.hasOwnProperty.call(descriptor,'value'))return null;
    var floor=commitCount,parent=null;
    if(rule.parent_argument!==null){
      var parentValue=args[rule.parent_argument],owner=classFiberInstances && classFiberInstances.get(parentValue);
      if(!owner || !owner.mounted || owner.session!==sessionId)return null;
      parent={identity:snapshot(parentValue).identity,root_id:ensureRootIdentity(owner.root)};
    }
    var evidence={kind:'legacy_render',container_identity:snapshot(value).identity,nodeType:type,basis:'react-devtools-commit.v1',
      element:snapshot(args[rule.element_argument]),parent:parent,commit_floor:floor};
    return {evidence:evidence,complete:function(){
      var next=committedContainerRoots.get(value),after=Object.getOwnPropertyDescriptor(value,'_reactRootContainer');
      if(!next || next.session!==sessionId || next.root.tag!==0 || Number(next.commitId.split(':')[1])<=floor
        || !after || !Object.prototype.hasOwnProperty.call(after,'value') || after.value!==next.root)return {state:'unconfirmed'};
      var current=next.root.current,child=current.child;
      if(!current.memoizedState || current.memoizedState.element!==args[rule.element_argument])return {state:'unconfirmed'};
      return {state:'committed',root:snapshot(next.root),renderer_root_id:next.rootId,commit_id:next.commitId,
        element:snapshot(current.memoizedState.element),first_child_tag:child?child.tag:null,public_instance:snapshot(child?child.stateNode:null)};
    }};
  }
  function inspectLegacyUnmount(value,snapshot) {
    var type;try{type=Object.getOwnPropertyDescriptor(window.Node.prototype,'nodeType').get.call(value);}catch(_){return null;}
    if([1,9,11].indexOf(type)===-1)return null;
    var descriptor=Object.getOwnPropertyDescriptor(value,'_reactRootContainer');
    // Missing or accessor properties may be inherited or execute user code. Do
    // not walk application prototypes or replay getters to guess their value.
    if(!descriptor || !Object.prototype.hasOwnProperty.call(descriptor,'value'))return null;
    var evidence={kind:'legacy_unmount',container_identity:snapshot(value).identity,nodeType:type,basis:'react-devtools-commit.v1'};
    if(descriptor.value===null){evidence.before={state:'absent'};return {evidence:evidence,complete:function(){
      var after=Object.getOwnPropertyDescriptor(value,'_reactRootContainer');return {state:after && Object.prototype.hasOwnProperty.call(after,'value') && after.value===null?'absent':'unobserved'};}};}
    var known=committedContainerRoots.get(value);
    if(!known || known.session!==sessionId || known.root.tag!==0)return null;
    if(descriptor.value!==known.root)return null;
    evidence.before={state:'legacy',root:snapshot(known.root),renderer_root_id:known.rootId,commit_id:known.commitId};
    return {evidence:evidence,complete:function(){
      var next=committedContainerRoots.get(value),after=Object.getOwnPropertyDescriptor(value,'_reactRootContainer');
      if(!next || next.session!==sessionId || next.root!==known.root || next.commitId===known.commitId
        || !after || !Object.prototype.hasOwnProperty.call(after,'value') || after.value!==null || next.root.current.child!==null)return {state:'unconfirmed'};
      return {state:'unmounted',root:snapshot(next.root),renderer_root_id:next.rootId,commit_id:next.commitId,empty_root:true};
    }};
  }
  function inspectHostLookup(value,snapshot,rule,args) {
    if(rule && rule.kind==='legacy_render')return inspectLegacyRender(value,snapshot,rule,args);
    if(rule && rule.kind==='legacy_unmount')return inspectLegacyUnmount(value,snapshot);
    if(value==null)return {evidence:{kind:'nullish'}};
    // Native brand checks bypass application overrides without invoking a proxy
    // trap. Unknown objects are never inspected for private React properties.
    try{var nodeType=Object.getOwnPropertyDescriptor(window.Node.prototype,'nodeType').get.call(value);
      return {evidence:{kind:'native_node',nodeType:nodeType}};}catch(_){}
    var owner=classFiberInstances && classFiberInstances.get(value);
    if(!owner || owner.session!==sessionId)return null;
    var evidence={kind:owner.mounted?'current_class':'unmounted_class',input_identity:snapshot(value).identity,basis:'react-devtools-commit.v1'};
    if(!owner.mounted)return {evidence:evidence};
    var root=owner.root,current=root && root.current;if(!current)return null;
    var count=0,seen=new Set();
    function collect(fiber,depth){
      if(!fiber || seen.has(fiber) || ++count>2000 || depth>100)throw Error('bounded host tree exhausted');seen.add(fiber);
      var tree={tag:fiber.tag,children:[],complete:false};
      if(fiber.tag===5 || fiber.tag===6){tree.value=snapshot(fiber.stateNode);tree.complete=true;return {tree:tree,found:true};}
      var child=fiber.child;while(child){var selected=collect(child,depth+1);tree.children.push(selected.tree);if(selected.found)return {tree:tree,found:true};child=child.sibling;}
      tree.complete=true;return {tree:tree,found:false};
    }
    evidence.tree=collect(owner.fiber,0).tree;
    return {evidence:evidence,unchanged:function(){return owner.mounted && root.current===current && classFiberInstances.get(value)===owner;}};
  }
  // BEGIN GENERATED REACT SERVER OBSERVER
  function createReactServerObserver(config) {
   let active=null;
   const objectIds=new WeakMap(),resources=new WeakMap(),destinations=new WeakMap();
   const objectIdentity=value=>{let id=objectIds.get(value);if(!id){id=config.id('server_value');objectIds.set(value,id);}return id;};
   const snapshot=(value,local=[])=>{
    if((typeof value==='object'&&value!==null)||typeof value==='function')return {identity:objectIdentity(value),kind:typeof value,...config.encode(value)};
    let row=local.find(row=>Object.is(row.value,value));if(!row){row={value,id:config.id('server_value')};local.push(row);}
    return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};
   };
   const consumer=(key,kind)=>{const entry=config.entry(key);return config.enabled()&&entry?.kind==='server_consumer'&&entry.server_consumer_kind===kind?entry:null;};
   const retainOwnership=(index,value,owned)=>{
    if(!value||!((typeof value==='object')||typeof value==='function'))return;
    if(!index.has(value))index.set(value,owned);
    else if(index.get(value)!==owned)index.set(value,null);
   };
   const origin=value=>value&&((typeof value==='object'&&value!==null)||typeof value==='function')?(resources.get(value)||destinations.get(value)):null;
   const observeConsumer=(entry,owned,operation,extra={})=>{
    if(!entry||!owned)return;
    const observationId=config.id('server_consumer');
    try{config.observe({manifest_key:owned.key,observation_id:observationId,operation,
      creation_observation_id:owned.creation_observation_id,consumer_manifest_key:entry.key,
      consumer_source_id:entry.server_consumer_source_id,consumer_kind:entry.server_consumer_kind,
      evidence_ids:[observationId,owned.creation_observation_id],...extra});}catch(_){}
   };
   const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled()||!entry?.server_rule)return run();
    const previous=active,values=[],describe=value=>snapshot(value,values);
    const record={manifest_key:key,observation_id:config.id('server_render'),operation:'returned',inputs:{},invocations:[]};
    const frame={key,entry,record,snapshot:describe,context:config.context?.()||'default',phase:'arguments'};active=frame;
    if(entry.server_rule.kind==='pipeable_server_stream')record.async_context_basis=config.asyncContextBasis||null;
    try{
     const result=entry.server_rule.kind==='pipeable_server_stream'&&config.runInContext?config.runInContext(frame,run):run();
     record.result={...describe(result),encoding:'redacted',value:null};
     if(result&&((typeof result==='object')||typeof result==='function'))retainOwnership(resources,result,{key,kind:entry.server_rule.kind,
      creation_observation_id:record.observation_id,result:record.result});
     return result;
    }
    catch(error){record.operation='threw';record.result=describe(error);throw error;}
    finally{frame.phase='returned';active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);}catch(_){}}
   };
   const argument=(key,index,value)=>{
    const frame=active;if(frame?.key!==key)return value;
    frame.record.inputs[index]=frame.snapshot(value);
    if(index===frame.entry.server_rule.element_argument){
     const data=name=>{const property=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,name):null;
      if(!property||!Object.hasOwn(property,'value'))throw Error('server element data unavailable');return property.value;};
     try{if(data('$$typeof')!==Symbol.for('react.element'))throw Error('server input is not an element');
      frame.record.element={identity:frame.record.inputs[index].identity,type:frame.snapshot(data('type')),props:frame.snapshot(data('props'))};
     }catch(_){frame.record.frontier='server_root_element_unobserved';}
    }
    // Arguments may themselves call the component. Only enter the renderer phase
    // after the final argument finishes, so such calls cannot borrow this cause.
    if(index===frame.entry.server_argument_count-1)frame.phase='renderer';
    return value;
   };
   const component=(sourceId,self,args)=>{
    const frame=active||config.currentContext?.();if(!config.enabled()||!frame||(config.context?.()||'default')!==frame.context)return;
    const asynchronous=frame.entry.server_rule.kind==='pipeable_server_stream'&&frame.phase==='returned'&&frame.record.operation==='returned'&&config.currentContext?.()===frame;
    if(frame.phase!=='renderer'&&!asynchronous)return;
    if(!frame.entry.server_component||sourceId!==frame.entry.server_component.source_id)return;
    const invocation={observation_id:config.id('server_component'),source_id:sourceId,callee:frame.snapshot(self),props:frame.snapshot(args[0]),
     timing:asynchronous?'asynchronous':'synchronous',root_input_match:frame.record.element?.type.identity===frame.snapshot(self).identity
      &&frame.record.element?.props.identity===frame.snapshot(args[0]).identity};
    if(asynchronous){
     try{config.observe({...frame.record,observation_id:config.id('server_async_body'),creation_observation_id:frame.record.observation_id,
      operation:'component_entered',invocations:[invocation]});}catch(_){}
    }else frame.record.invocations.push(invocation);
   };
   const serverPromiseFulfilled=(key,promise,value)=>{
    const entry=consumer(key,'await_binding'),owned=origin(promise);
    if(entry&&owned?.kind==='readable_server_stream'&&value&&((typeof value==='object')||typeof value==='function')){
     retainOwnership(resources,value,owned);observeConsumer(entry,owned,'promise_fulfilled',{promise:snapshot(promise),resource:snapshot(value)});
    }
    return value;
   };
   const serverPipe=(key,resource,destination,invoke)=>{
    const entry=consumer(key,'pipe'),owned=origin(resource);
    if(!entry||owned?.kind!=='pipeable_server_stream')return invoke(resource,destination);
    retainOwnership(destinations,destination,owned);
    try{const result=invoke(resource,destination);observeConsumer(entry,owned,'pipe_started',{resource:snapshot(resource),destination:snapshot(destination)});return result;}
    catch(error){if(destination&&destinations.get(destination)===owned)destinations.delete(destination);
     observeConsumer(entry,owned,'pipe_failed',{resource:snapshot(resource),destination:snapshot(destination),error:snapshot(error)});throw error;}
   };
   const serverEvent=(key,resource,event)=>{
    const entry=consumer(key,'event'),owned=origin(resource);if(!entry||entry.server_consumer_event!==event||!owned)return;
    const operation=event==='end'||event==='finish'?'stream_completed':event==='error'?'stream_errored':'stream_closed';
    observeConsumer(entry,owned,operation,{resource:snapshot(resource),event});
   };
   const serverIteration=(key,resource,outcome)=>{
    const entry=consumer(key,'async_iteration'),owned=origin(resource);if(!entry||!owned)return;
    observeConsumer(entry,owned,outcome==='completed'?'stream_completed':'consumer_failed',{resource:snapshot(resource),consumer_outcome:outcome});
   };
   return {serverCall:call,serverArgument:argument,serverComponent:component,
    serverPromiseFulfilled,serverPipe,serverEvent,serverIteration};
  }
  // END GENERATED REACT SERVER OBSERVER
  // BEGIN GENERATED REACT ROOT OBSERVER
  function createReactRootObserver(config) {
   let active=null,context=null,identities=new WeakMap(),roots=new WeakMap(),pending=new WeakMap(),recoverySources=new WeakMap();
   const snapshot=value=>{
    const reference=value!==null&&['object','function'].includes(typeof value);let id=reference?identities.get(value):null;
    if(!id){id=config.id('root_value');if(reference)identities.set(value,id);}
    return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};
   };
   const data=(object,name)=>{const property=Object.getOwnPropertyDescriptor(object,name);if(!property||!Object.hasOwn(property,'value'))throw Error('root data property unavailable');return property.value;};
   const inspect=object=>{
    try{const internal=data(object,'_internalRoot');
     if(internal===null)return {state:'unmounted'};
     const container=data(internal,'containerInfo');
     return {state:'active',internal:snapshot(internal),container:snapshot(container),renderer_root_id:config.rootId?.(internal)||null};
    }catch(_){return {state:'unobserved'};}
   };
   const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled()||!entry?.root_rule)return run();
    const nextContext=config.context?.()||'default';if(nextContext!==context){context=nextContext;identities=new WeakMap();roots=new WeakMap();pending=new WeakMap();recoverySources=new WeakMap();}
    const previous=active,record={manifest_key:key,observation_id:config.id('root_operation'),method:entry.root_method||'create',inputs:{},operation:'returned'};
    const frame={key,entry,record,context,executing:false,args:[]};active=frame;
    try{const result=run();record.result=snapshot(result);
     if(record.method==='create'){
      record.after=inspect(result);record.methods={};
      try{const prototype=Object.getPrototypeOf(result);
       for(const name of ['render','unmount'])record.methods[name]=snapshot(data(prototype,name));
       roots.set(result,true);
       const options=frame.args[entry.root_rule.options_argument];
       try{const descriptor=options&&Object.getOwnPropertyDescriptor(options,entry.root_rule.recoverable_error_option),callback=descriptor?.value,source=recoverySources.get(callback);
        if(source&&source.key===key&&source.sourceId===entry.root_recovery_source_id){
         const registration={context,entry,record,root:result,internal:data(result,'_internalRoot')};source.registrations.push(registration);
         record.recovery_callback={source_id:source.sourceId,value:snapshot(callback)};
        }
       }catch(_){record.recovery_frontier='root_recovery_option_unobserved';}
       if(entry.root_rule.mode==='hydrate'&&entry.root_rule.children_argument!==null){
        const internal=data(result,'_internalRoot');pending.set(internal,[{entry,record,element:frame.args[entry.root_rule.children_argument],
         input:record.inputs[entry.root_rule.children_argument],context}]);
       }
      }catch(_){record.frontier='root_method_descriptors_unobserved';}
     }
     return result;
    }catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
    finally{
     if(frame.receiver&&roots.has(frame.receiver)){
      record.after=inspect(frame.receiver);
      if(record.method==='render'&&record.operation==='returned'&&frame.internal){
       const rows=pending.get(frame.internal)||[];
       if(rows.length<64)rows.push({entry,record,element:frame.args[entry.root_rule.render_argument],input:record.inputs[entry.root_rule.render_argument],context});
       else rows.overflow=true;
       pending.set(frame.internal,rows);
      }
     }
     active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);}catch(_){}
    }
   };
   const argument=(key,index,value)=>{if(active?.key===key){active.args[index]=value;active.record.inputs[index]=snapshot(value);}return value;};
   const method=(key,receiver,name)=>{
    const frame=active;
    // Read the original method exactly once, before evaluating its arguments.
    const original=receiver[name];
    if(frame?.key===key){frame.receiver=receiver;frame.record.receiver=snapshot(receiver);frame.record.method_value=snapshot(original);
     frame.record.before=roots.has(receiver)?inspect(receiver):{state:'unobserved'};
     if(roots.has(receiver))try{frame.internal=data(receiver,'_internalRoot');}catch(_){}}
   return function(){
     if(frame?.key!==key)return Reflect.apply(original,receiver,arguments);
     frame.executing=true;try{return Reflect.apply(original,receiver,arguments);}finally{frame.executing=false;}
    };
   };
   const recovery=(key,sourceId,callback)=>{
    if(typeof callback!=='function')return callback;
    const source={key,sourceId,original:callback,registrations:[]};
    const wrapped=new Proxy(callback,{apply(target,thisArg,args){
     if(!config.enabled())return Reflect.apply(target,thisArg,args);
     const current=config.context?.()||'default',matches=source.registrations.filter(row=>row.context===current&&inspect(row.root).state==='active');
     const registration=matches.length===1?matches[0]:null,record={schema:'producttrace.react-root-recovery.v1',kind:'react_root_recovery',runtime_observed:true,
      observation_id:config.id('root_recovery'),manifest_key:registration?.entry.key||key,source_call_id:registration?.entry.source_call_id||null,
      semantic_id:registration?.entry.semantic_id||null,origin_observation_id:registration?.record.observation_id||null,
      callback_source_id:sourceId,callback_identity:snapshot(wrapped),arguments:Array.from(args,snapshot),receiver:snapshot(thisArg),operation:'returned',
      renderer_root_id:registration?config.rootId?.(registration.internal)||null:null,frontier:registration?null:matches.length>1?'root_recovery_origin_ambiguous':'root_recovery_origin_unobserved'};
     try{const result=Reflect.apply(target,thisArg,args);record.result=snapshot(result);return result;}
     catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
     finally{try{config.observeRecovery?.(record);}catch(_){}}
    }});
    recoverySources.set(wrapped,source);return wrapped;
   };
   const committed=(root,commitId)=>{
    // This observes a commit inside the original method. A root.render return,
    // a later commit, or work done while evaluating arguments supplies no link.
    if(!config.enabled())return;
    const current=data(root,'current'),currentElement=data(data(current,'memoizedState'),'element'),rootId=config.rootId?.(root)||null;
    if(active?.executing&&active.internal===root&&(config.context?.()||'default')===active.context)
     (active.record.commits||(active.record.commits=[])).push({commit_id:commitId,renderer_root_id:rootId,empty_tree:data(current,'child')===null});
    const rows=pending.get(root);if(!rows)return;
    const matches=rows.filter(row=>row.context===(config.context?.()||'default')&&row.element===currentElement);
    for(const row of matches)config.observeCommit?.({schema:'producttrace.react-root-commit.v1',kind:'react_root_commit',runtime_observed:true,
     operation:'committed',observation_id:config.id('root_commit'),origin_observation_id:row.record.observation_id,
     manifest_key:row.entry.key,source_call_id:row.entry.source_call_id,semantic_id:row.entry.semantic_id,
     input_identity:row.input?.identity||null,renderer_root_id:rootId,commit_id:commitId,empty_tree:data(current,'child')===null,
     frontier:rows.overflow||matches.length!==1?'root_commit_origin_ambiguous':null});
    pending.delete(root);
   };
   const cleanup=(observationId,owner,sourceCallId)=>{
    // The lifecycle reader independently checks this cleanup against its setup.
    // Here we only retain its nesting inside this exact root operation.
    if(!config.enabled()||!active?.executing||!active.internal||(config.context?.()||'default')!==active.context
      ||config.rootId?.(active.internal)!==owner.root_id)return null;
    (active.record.cleanups||(active.record.cleanups=[])).push({observation_id:observationId,root_id:owner.root_id,instance_id:owner.instance_id,mount_id:owner.mount_id,source_call_id:sourceCallId});
    return active.record.observation_id;
   };
   return {rootCall:call,rootArgument:argument,rootMethod:method,rootRecovery:recovery,rootCommitted:committed,rootCleanup:cleanup};
  }
  // END GENERATED REACT ROOT OBSERVER

  // BEGIN GENERATED REACT SCOPE OBSERVER
  function createReactScopeObserver(config) {
    let active=null;
    const tagged=new WeakMap();
    const identity=value=>{
      const entry=tagged.get(value);if(!entry)return null;
      const context=config.context?.()||'default';
      if(entry.context!==context){entry.context=context;entry.identity=config.id('callback_identity');entry.observations=new Map();}
      return entry;
    };
    const tagSource=(sourceId,value,readers,inferredName)=>{
      if(typeof value!=='function')return value;
      if(inferredName && !value.name)Object.defineProperty(value,'name',{value:inferredName,configurable:true});
      let entry=tagged.get(value);if(!entry){entry={sources:new Map()};tagged.set(value,entry);}
      entry.sources.set(sourceId,readers);return value;
    };
    // Other observers can resolve the same original function object. Tags name
    // source, never imply that a function was invoked or that its render committed.
    const describeSource=(value,candidates)=>{
      if(typeof value!=='function')return null;
      const tag=identity(value),matches=(candidates||[]).filter(row=>tag?.sources.has(row.source_id));
      if(matches.length!==1)return null;
      const sourceId=matches[0].source_id;let observation=tag.observations.get(sourceId);
      if(!observation) {
        observation=config.id('callback_source');
        try {config.observeOrigin?.({source_id:sourceId,callback_identity_id:tag.identity,observation_id:observation});
          tag.observations.set(sourceId,observation);}catch(_){return null;}
      }
      return {source_id:sourceId,callback_identity_id:tag.identity,source_observation_id:observation};
    };
    const call=(key,run,onCompletion,sourceFrameId)=>{
      const entry=config.entry(key);
      if(!config.enabled() || !(entry?.scope_rule || entry?.predicate_rule || entry?.children_rule))return run();
      const parent=active,values=[];
      const snapshot=value=>{
        let row=values.find(row=>Object.is(row.value,value));
        if(!row){row={value,id:(typeof value==='function'?identity(value)?.identity:null)||config.id('scope_value')};values.push(row);}
        return {identity:row.id,truthy:Boolean(value),kind:value===null?'null':typeof value,...config.encode(value)};
      };
      const scope={scope_id:config.id('scope'),parent_scope_id:parent?.data.scope_id||null,
        ...(sourceFrameId?{source_frame_id:sourceFrameId}:{}),
        action_occurrence_id:config.action?.()||null,inputs:{},callbacks:[],outcome:'pending'};
      const frame={key,entry,data:scope,snapshot,closed:false,parent,active_callback_id:null};active=frame;
      let result;
      try {result=run();scope.outcome='returned';scope.result=snapshot(result);return result;}
      catch(error){result=error;scope.outcome='threw';scope.result=snapshot(error);throw error;}
      finally {
        frame.closed=true;active=parent;
        // Recorder failure must not replace an application result or exception.
        try{if(config.enabled()){
          config.observe(key,result,scope.outcome==='threw'?'threw':'invoked',scope);
          onCompletion?.(scope);
        }}catch(_){}
      }
    };
    const argument=(key,index,value,readers)=>{
      const frame=active;
      if(!frame || frame.key!==key || frame.closed)return value;
      frame.data.inputs[index]=frame.snapshot(value);
      const callbackRule=frame.entry.scope_rule || (['map','forEach'].includes(frame.entry.children_member)?frame.entry.children_rule:null);
      if(!callbackRule || index!==callbackRule.callback_argument || typeof value!=='function')return value;
      let sourceId=frame.entry.scope_callback_source_id||null,sourceObservation=null,captureReaders=readers;
      if(!sourceId) {
        const tag=identity(value),candidates=(frame.entry.scope_callback_candidates||[]).filter(row=>tag?.sources.has(row.source_id));
        if(candidates.length===1) {
          sourceId=candidates[0].source_id;captureReaders=tag.sources.get(sourceId);
          sourceObservation=tag.observations.get(sourceId);
          if(!sourceObservation) {
            sourceObservation=config.id('callback_source');
            try {
              config.observeOrigin?.({source_id:sourceId,callback_identity_id:tag.identity,observation_id:sourceObservation});
              tag.observations.set(sourceId,sourceObservation);
            } catch(_) {sourceObservation=null;}
          }
        }
      }
      return function(){
        if(frame.closed)return value.apply(this,arguments);
        const invocation={invocation_id:config.id('scope_callback'),source_id:sourceId,
          source_observation_id:sourceObservation,callback_identity_id:frame.data.inputs[index].identity,
          ...(frame.entry.children_rule?{receiver:frame.snapshot(this)}:{}),arguments:Array.from(arguments,frame.snapshot),captured_values:config.captures?.(captureReaders)||[],outcome:'pending'};
        frame.data.callbacks.push(invocation);
        const previousCallback=frame.active_callback_id;frame.active_callback_id=invocation.invocation_id;
        try {const result=value.apply(this,arguments);invocation.outcome='returned';invocation.result=frame.snapshot(result);return result;}
        catch(error){invocation.outcome='threw';invocation.result=frame.snapshot(error);throw error;}
        finally {frame.active_callback_id=previousCallback;}
      };
    };
    // Read the original callee once, before its arguments. This records identity
    // without replacing the stable function returned by the renderer.
    const target=(key,value)=>{
      const frame=active;
      if(frame && frame.key===key && !frame.closed && frame.entry.transition_hook_call_id)
        frame.data.transition_target=config.describeTarget?.(value,frame.entry)||null;
      return value;
    };
    // State and other renderer observers use this only while application code is
    // dynamically inside the exact callback. Nested scopes retain every callback
    // occurrence, innermost first, so a later checker can distinguish containment
    // from the scheduling policy that ultimately won.
    const currentScopes=()=>{
      const scopes=[];
      for(let frame=active;frame;frame=frame.parent)if(!frame.closed&&frame.active_callback_id&&frame.entry.scope_rule)scopes.push({
        scope_id:frame.data.scope_id,callback_invocation_id:frame.active_callback_id,
        scheduling:frame.entry.scope_rule.kind==='test_scope'?'test_queue':frame.entry.scope_rule.scheduling,
      });
      return scopes;
    };
    return {scopeCall:call,scopeArgument:argument,scopeTarget:target,tagSource,describeSource,currentScopes};
  }
  // END GENERATED REACT SCOPE OBSERVER
  // BEGIN GENERATED REACT REF OBSERVER
  function createReactRefObserver(config) {
    const cells=new WeakMap(),objects=new WeakMap();let active=null;
    const context=()=>config.context?.()||'default';
    const snapshotter=()=>{
      const values=[];
      return value=>{
        const object=value!==null && (typeof value==='object' || typeof value==='function');
        let identity;
        if(object && config.objectIdentity) identity=config.objectIdentity(value);
        else if(object) {
          let found=objects.get(value);
          if(!found || found.context!==context()){found={context:context(),id:config.id('ref_value')};objects.set(value,found);}
          identity=found.id;
        } else {
          let found=values.find(row=>Object.is(row.value,value));
          if(!found){found={value,id:config.id('ref_value')};values.push(found);}identity=found.id;
        }
        return {identity,kind:value===null?'null':typeof value,...config.encode(value)};
      };
    };
    const emit=(record,handle)=>{try{if(config.enabled())config.observe(record,handle);}catch(_){};};
    const cellFor=value=>{
      const cell=value!==null && (typeof value==='object' || typeof value==='function')?cells.get(value):null;
      return cell?.context===context()?cell:null;
    };
    const owner=handle=>{try{return config.describeOwner?.(handle)||null;}catch(_){return null;}};
    const call=(key,run)=>{
      const entry=config.entry(key);if(!config.enabled() || !entry?.ref_rule)return run();
      const parent=active,snapshot=snapshotter(),observationId=config.id('ref_return');
      const frame={key,entry,snapshot,inputs:{}};active=frame;
      const record={manifest_key:key,observation_id:observationId,operation:'returned',inputs:frame.inputs};
      let ownerHandle=null;
      try {
        const value=run();record.value=snapshot(value);
        if(value!==null && typeof value==='object') {
          let cell=cellFor(value);record.previously_returned=Boolean(cell);
          if(!cell) {
            let handle=null;try{handle=config.captureOwner?.(entry)||null;}catch(_){}
            cell={context:context(),ref_id:config.id('ref'),source_call_id:entry.source_call_id,
              origin_observation_id:observationId,owner:handle};cells.set(value,cell);
          }
          Object.assign(record,{ref_id:cell.ref_id,origin_observation_id:cell.origin_observation_id,
            origin_source_call_id:cell.source_call_id,owner:owner(cell.owner)});
          ownerHandle=cell.owner;
          // Canonical React returns a data property. An altered API result may
          // not; do not execute a getter merely to construct a ref observation.
          try {
            const descriptor=Object.getOwnPropertyDescriptor(value,entry.ref_rule.property);
            if(descriptor && Object.hasOwn(descriptor,'value')) {
              record.current=snapshot(descriptor.value);
              record.descriptor={writable:descriptor.writable,enumerable:descriptor.enumerable,configurable:descriptor.configurable};
              record.sealed=Object.isSealed(value);
            } else record.frontier='ref_data_property_unobserved';
          } catch(_){record.frontier='ref_descriptor_unobserved';}
          // Retain the exact returned object for renderer-time ref attachment.
          // Registration is observational: an unavailable commit reader must
          // never change the application call or its returned ref object.
          try { config.registerRef?.(entry,value,record); }
          catch(_){record.frontier=record.frontier||'ref_commit_registration_unobserved';}
        } else record.frontier='ref_object_unobserved';
        return value;
      } catch(error){record.operation='threw';record.value=snapshot(error);throw error;}
      finally {active=parent;emit(record,ownerHandle);}
    };
    const argument=(key,index,value)=>{
      if(active?.key===key)active.inputs[index]=active.snapshot(value);
      return value;
    };
    const access=(key,target,value,write)=>{
      const entry=config.entry(key),property=entry?.ref_property||'current';
      if(!config.enabled() || !entry?.ref_access)return write?(target[property]=value):target[property];
      const cell=cellFor(target),snapshot=snapshotter();
      const record={manifest_key:key,observation_id:config.id('ref_access'),operation:write?'write':'read',
        ref_id:cell?.ref_id||null,origin_observation_id:cell?.origin_observation_id||null,
        origin_source_call_id:cell?.source_call_id||null,owner:owner(cell?.owner),action:config.action?.()||null,outcome:'returned'};
      try {const result=write?(target[property]=value):target[property];record.value=snapshot(result);return result;}
      catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
      finally {emit(record,cell?.owner);}
    };
    const method=(key,target)=>{
      const entry=config.entry(key),property=entry?.ref_property||'current';
      // Getting the property must precede argument evaluation. Calling the
      // resulting closure preserves the original reference's receiver even if an
      // argument changes current. It never reads current for a second time.
      if(!config.enabled() || !entry?.ref_access) {
        const value=target[property];return function(){return Reflect.apply(value,target,arguments);};
      }
      const cell=cellFor(target),snapshot=snapshotter(),base={manifest_key:key,
        ref_id:cell?.ref_id||null,origin_observation_id:cell?.origin_observation_id||null,
        origin_source_call_id:cell?.source_call_id||null,owner:owner(cell?.owner)};
      const read={...base,observation_id:config.id('ref_access'),operation:'read',
        action:config.action?.()||null,outcome:'returned'};
      let value;
      try {value=target[property];read.value=snapshot(value);
        try{read.callback=config.describeSource?.(value,entry.ref_callback_candidates)||null;}catch(_){read.callback=null;}}
      catch(error){read.outcome='threw';read.value=snapshot(error);throw error;}
      finally {emit(read,cell?.owner);}
      return function(){
        if(!config.enabled())return Reflect.apply(value,target,arguments);
        const record={...base,observation_id:config.id('ref_invoke'),operation:'invoke',
          read_observation_id:read.observation_id,callee:read.value,callback:read.callback,
          arguments:Array.from(arguments,snapshot),action:config.action?.()||null,outcome:'returned'};
        try {const result=Reflect.apply(value,target,arguments);record.value=snapshot(result);return result;}
        catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
        finally {emit(record,cell?.owner);}
      };
    };
    return {refCall:call,refArgument:argument,refRead:(key,target)=>access(key,target,undefined,false),
      refWrite:(key,target,value)=>access(key,target,value,true),refMethod:method};
  }
  // END GENERATED REACT REF OBSERVER
  // BEGIN GENERATED REACT CONTEXT OBSERVER
  function createReactContextObserver(config) {
    const definitions=new WeakMap(),objects=new WeakMap();let active=null;
    const context=()=>config.context?.()||'default';
    const snapshots=(seed=[])=>{
      const primitives=seed.slice();
      return value=>{
        const object=value!==null && (typeof value==='object' || typeof value==='function');let id;
        if(object) {
          let known=objects.get(value);
          if(!known || known.context!==context()){known={context:context(),id:config.id('context_value')};objects.set(value,known);}
          id=known.id;
        } else {
          let known=primitives.find(row=>Object.is(row.value,value));
          if(!known){known={value,id:config.id('context_value')};primitives.push(known);}id=known.id;
        }
        return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};
      };
    };
    const emit=record=>{try{if(config.enabled())config.observe(record);}catch(_){}};
    const call=(key,run)=>{
      const entry=config.entry(key);if(!config.enabled() || !entry?.context_rule)return run();
      const parent=active,snapshot=snapshots(),frame={key,inputs:{},values:[],snapshot};active=frame;
      const record={manifest_key:key,observation_id:config.id('context_origin'),outcome:'returned',inputs:frame.inputs};
      try {
        const result=run();record.value=snapshot(result);
        if(result!==null && typeof result==='object') {
          const previous=definitions.get(result);record.previously_returned=previous?.context===context();
          const defaultValue=frame.values[entry.context_rule.default_argument];
          const definition={context:context(),identity:config.id('context_object'),origin:record.observation_id,
            source_context_id:entry.context_id,source_call_id:entry.source_call_id,defaultValue,defaultSnapshot:snapshot(defaultValue)};
          record.context_object_id=definition.identity;record.default_value=definition.defaultSnapshot;
          // A changed or noncanonical factory must not replace a known identity.
          if(!record.previously_returned)definitions.set(result,definition);
        }
        return result;
      } catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
      finally {active=parent;emit(record);}
    };
    const argument=(key,index,value)=>{
      if(active?.key===key){active.inputs[index]=active.snapshot(value);active.values[index]=value;}return value;
    };
    const read=(object,value,provider)=>{
      if(!config.enabled() || object===null || (typeof object!=='object' && typeof object!=='function'))return null;
      const definition=definitions.get(object);if(!definition || definition.context!==context())return null;
      const snapshot=snapshots([{value:definition.defaultValue,id:definition.defaultSnapshot.identity}]);
      const result={context_object_id:definition.identity,origin_observation_id:definition.origin,
        source_context_id:definition.source_context_id,source_call_id:definition.source_call_id,observed_value:snapshot(value)};
      if(provider===null)Object.assign(result,{selected_from:'default',selected_value:definition.defaultSnapshot});
      else if(provider && provider.status!=='unresolved')Object.assign(result,{selected_from:'provider',selected_value:snapshot(provider.raw_value)});
      else result.selected_from='unresolved';
      return result;
    };
    return {contextCall:call,contextArgument:argument,contextReadEvidence:read};
  }
  // END GENERATED REACT CONTEXT OBSERVER
  var contextObserver=createReactContextObserver({entry:function(key){return lifecycleEntry(key);},
    enabled:function(){return started && !disabled;},context:lifecycleContextKey,
    id:lifecycleId,encode:encodedLifecycleValue,observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-context-origin.v1',kind:'react_context_origin',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,
        source_context_id:entry.context_id,semantic_id:entry.semantic_id,occurrence_id:record.observation_id+':occurrence',
        evidence_ids:[record.observation_id]},record));}});
  function refOwnerSnapshot(handle) {
    if(!handle)return null;var render=handle.render;return {
      root_id:render.identity.root_id,instance_id:render.identity.instance_id,mount_id:render.identity.mount_id,
      render_id:render.render_id,hook_slot_id:handle.slot,status:render.status};
  }
  // BEGIN GENERATED REACT PORTAL OBSERVER
  function createReactPortalObserver(config) {
    let active=null;
    const call=(key,run)=>{
      const entry=config.entry(key);if(!config.enabled() || !entry?.portal_rule)return run();
      const previous=active,values=[];
      const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));
        if(!row){row={value,id:config.id('portal_value')};values.push(row);}
        return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
      const frame={key,inputs:{},args:[],snapshot};active=frame;
      const record={manifest_key:key,observation_id:config.id('portal_return'),operation:'returned',inputs:frame.inputs};
      try {
        const result=run();record.result=snapshot(result);record.fields={};
        try {for(const field of ['$$typeof',entry.portal_rule.children_field,entry.portal_rule.container_field,'key','implementation']) {
          const descriptor=result && typeof result==='object'?Object.getOwnPropertyDescriptor(result,field):null;
          if(!descriptor || !Object.hasOwn(descriptor,'value')){record.frontier='portal_data_property_unobserved';continue;}
          record.fields[field]=snapshot(descriptor.value);
          if(field==='$$typeof')record.marker=typeof descriptor.value==='symbol'?Symbol.keyFor(descriptor.value)||null:null;
        }
        }catch(_){record.frontier='portal_descriptor_unobserved';}
        if(!record.frontier)config.registerCommit?.(entry,result,record,frame.args);
        return result;
      }catch(error){record.operation='threw';record.error=snapshot(error);throw error;}
      finally {active=previous;try{if(config.enabled())config.observe(record);}catch(_){};}
    };
    const argument=(key,index,value)=>{if(active?.key===key){active.args[index]=value;active.inputs[index]=active.snapshot(value);}return value;};
    return {portalCall:call,portalArgument:argument};
  }
  // END GENERATED REACT PORTAL OBSERVER
  // BEGIN GENERATED REACT ELEMENT OBSERVER
  function createReactElementObserver(config) {
    let active=null,context=null,identities=new WeakMap(),symbols=new Map();
    // Subscribe only to an unmodified Promise from this realm. Calling an
    // arbitrary thenable would execute application code and change its behavior.
    const nativePromiseThen=value=>{
      if(typeof Promise!=='function'||!value||typeof value!=='object')return null;
      let prototype,then;
      try{prototype=Object.getPrototypeOf(value);then=Object.getOwnPropertyDescriptor(Promise.prototype,'then');}catch(_){return null;}
      return prototype===Promise.prototype&&then&&Object.hasOwn(then,'value')&&typeof then.value==='function'
        &&/^function\s+then\(\)\s+\{\s+\[native code\]\s+\}$/u.test(Function.prototype.toString.call(then.value))?then.value:null;
    };
    // React installs its Promise listener inside the loader call. Deferring ours
    // preserves that registration order while retaining the same Promise object.
    const defer=typeof config.deferSettlement==='function'?config.deferSettlement:run=>queueMicrotask(run);
    const emit=record=>{try{if(config.enabled()&&(config.context?.()||'default')===record.context){const {context:_,...publicRecord}=record;config.observe(publicRecord);}}catch(_){}};
    const call=(key,run)=>{
      const entry=config.entry(key);if(!config.enabled() || !entry?.element_rule)return run();
      const nextContext=config.context?.()||'default';if(nextContext!==context){context=nextContext;identities=new WeakMap();symbols=new Map();}
      const previous=active,values=[];
      const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));
        if(!row){const reference=value!==null&&['object','function'].includes(typeof value);let id=reference&&config.objectIdentity?config.objectIdentity(value):reference?identities.get(value):typeof value==='symbol'?symbols.get(value):null;
          if(!id){id=config.id('element_value');if(reference)identities.set(value,id);else if(typeof value==='symbol'&&symbols.size<128)symbols.set(value,id);}row={value,id};values.push(row);}
        return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
      const frame={key,entry,context:nextContext,inputs:{},propertyInputs:[],snapshot};active=frame;
      const record={manifest_key:key,observation_id:config.id('element_return'),operation:'returned',
        inputs:frame.inputs,property_inputs:frame.propertyInputs};
      frame.record=record;
      try {
        const result=run();record.result=snapshot(result);record.fields={};
        if(entry.element_rule.kind==='lazy_component'){
          try {
            const data=(object,name)=>{const property=Object.getOwnPropertyDescriptor(object,name);return property&&Object.hasOwn(property,'value')?property.value:undefined;};
            const payload=data(result,'_payload');
            if(data(result,'$$typeof')!==Symbol.for('react.lazy')||data(payload,'_status')!==-1||data(payload,'_result')!==frame.loader){record.frontier='lazy_initial_payload_unobserved';return result;}
            record.marker='react.lazy';frame.lazyIdentity=record.result.identity;frame.lazyObject=result;
            try{config.registerLazy?.(entry,result,record);}catch(_){record.frontier='lazy_registration_unobserved';}
          }catch(_){record.frontier='lazy_initial_payload_unobserved';}
          return result;
        }
        // React's development factory has an observable deprecated `.type`
        // getter. Record the original function identity without reading it.
        if(entry.element_rule.kind==='element_factory'&&!entry.factory_producer_call_id)return result;
        try {for(const field of ['$$typeof','type','props','key','ref','_owner']) {
          const descriptor=result && typeof result==='object'?Object.getOwnPropertyDescriptor(result,field):null;
          if(!descriptor || !Object.hasOwn(descriptor,'value')){record.frontier='element_data_property_unobserved';continue;}
          record.fields[field]=snapshot(descriptor.value);
          if(field==='$$typeof')record.marker=typeof descriptor.value==='symbol'?Symbol.keyFor(descriptor.value)||null:null;
        }
        }catch(_){record.frontier='element_descriptor_unobserved';}
        try {
          const props=Object.getOwnPropertyDescriptor(result,'props');
          record.property_outputs={};
          for(const input of entry.element_property_inputs||[]){
            if(input.target!=='props'||Object.hasOwn(record.property_outputs,input.name))continue;
            const descriptor=props&&Object.hasOwn(props,'value')&&props.value&&typeof props.value==='object'
              ?Object.getOwnPropertyDescriptor(props.value,input.name):null;
            record.property_outputs[input.name]=descriptor&&Object.hasOwn(descriptor,'value')?snapshot(descriptor.value):null;
          }
        }catch(_){record.frontier='element_property_output_unobserved';}
        try{config.registerDescriptor?.(entry,result,record);}catch(_){record.frontier='descriptor_registration_unobserved';}
        return result;
      }catch(error){record.operation='threw';record.error=snapshot(error);throw error;}
      finally {active=previous;try{if(config.enabled())config.observe(record);}catch(_){};}
    };
    const argument=(key,index,value)=>{
      if(active?.key!==key)return value;
      const frame=active;frame.inputs[index]=frame.snapshot(value);
      for(const input of frame.entry.element_property_inputs||[]){
        if(input.input_index!==index)continue;
        if(input.argument_value)frame.propertyInputs.push({...input,value:frame.inputs[index]});
        else {
          const descriptor=value&&['object','function'].includes(typeof value)?Object.getOwnPropertyDescriptor(value,input.name):null;
          frame.propertyInputs.push({...input,value:descriptor&&Object.hasOwn(descriptor,'value')?frame.snapshot(descriptor.value):null});
        }
      }
      if(frame.entry.element_rule.kind!=='lazy_component'||index!==frame.entry.element_rule.loader_argument)return value;
      frame.loader=value;
      if(typeof value!=='function')return value;
      frame.loader=function(){
        if(!config.enabled()||(config.context?.()||'default')!==frame.context)return value.apply(this,arguments);
        const observation={manifest_key:key,observation_id:config.id('lazy_loader'),operation:'loader_returned',
          context:frame.context,
          creation_observation_id:frame.record.observation_id,lazy_identity:frame.lazyIdentity,
          loader_identity:frame.inputs[index].identity,source_id:frame.entry.lazy_loader_source_id,
          arguments:Array.from(arguments,frame.snapshot)};
        let result,then;
        try{result=value.apply(this,arguments);observation.result=frame.snapshot(result);then=nativePromiseThen(result);
          if(then)observation.thenable_protocol='native_promise.v1';
          else observation.settlement_frontier='lazy_thenable_not_exact_native_promise';
          return result;}
        catch(error){observation.operation='loader_threw';observation.result=frame.snapshot(error);throw error;}
        finally{
          emit(observation);
          if(observation.operation==='loader_returned')try{config.loadLazy?.(frame.entry,frame.lazyObject,result,observation,config.currentFiber?.());}catch(_){}
          if(then)try{defer(()=>{
            try{then.call(result,value=>{const settlement={manifest_key:key,context:frame.context,
                observation_id:config.id('lazy_settlement'),operation:'loader_fulfilled',
                creation_observation_id:frame.record.observation_id,loader_observation_id:observation.observation_id,
                lazy_identity:frame.lazyIdentity,loader_identity:frame.inputs[index].identity,
                thenable_identity:observation.result.identity,source_id:frame.entry.lazy_loader_source_id,result:frame.snapshot(value)};
              emit(settlement);try{config.settleLazy?.(frame.entry,frame.lazyObject,value,settlement);}catch(_){};},
              error=>{const settlement={manifest_key:key,context:frame.context,
                observation_id:config.id('lazy_settlement'),operation:'loader_rejected',
                creation_observation_id:frame.record.observation_id,loader_observation_id:observation.observation_id,
                lazy_identity:frame.lazyIdentity,loader_identity:frame.inputs[index].identity,
                thenable_identity:observation.result.identity,source_id:frame.entry.lazy_loader_source_id,result:frame.snapshot(error)};
                emit(settlement);try{config.settleLazy?.(frame.entry,frame.lazyObject,error,settlement);}catch(_){};});
            }catch(_){}}
          );}catch(_){}
        }
      };
      return frame.loader;
    };
    const target=(key,value)=>{if(active?.key===key)active.record.target=active.snapshot(value);return value;};
    return {elementCall:call,elementArgument:argument,elementTarget:target};
  }
  // END GENERATED REACT ELEMENT OBSERVER
  // BEGIN GENERATED REACT CLASS OBSERVER
  function createReactClassObserver(config) {
   let context=null,classes=new Map(),identities=new WeakMap(),instances=new WeakMap(),active=null,updating=null;
   const reset=()=>{const next=config.context?.()||'default';if(next!==context){context=next;classes=new Map();identities=new WeakMap();instances=new WeakMap();}return next;};
   const snapshot=value=>{let id=value!==null&&['object','function'].includes(typeof value)?identities.get(value):null;if(!id){id=config.id('class_value');if(value!==null&&['object','function'].includes(typeof value))identities.set(value,id);}
    return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};};
   // The compiler passes ReactCurrentOwner from the attested namespace import.
   // No global React singleton or application-supplied instance name is assumed.
   const register=(key,value,ownerRef)=>{
    if(!config.enabled())return value;reset();const entry=config.entry(key);if(!entry?.class_rule)return value;
    try{const base=Object.getPrototypeOf(value),prototype=Object.getOwnPropertyDescriptor(base,'prototype')?.value;
     const marker=prototype&&Object.getOwnPropertyDescriptor(prototype,'isPureReactComponent'),pure=marker?.value===true;
     if(typeof value!=='function'||!prototype||pure!==entry.class_rule.pure)return value;
     const observation_id=config.id('class_registration'),record={manifest_key:key,observation_id,operation:'registered',class_type:snapshot(value),base_type:snapshot(base),pure};
     const methods={};for(const name of ['setState','forceUpdate']){const method=Object.getOwnPropertyDescriptor(prototype,name)?.value;if(typeof method==='function')methods[name]=method;}
     record.methods=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,snapshot(method)]));
     classes.set(key,{value,ownerRef,record,context,methods});config.observe(record);
    }catch(_){}return value;
   };
   // Observe inside the original method, using its lexical receiver and arguments.
   // The active frame ends with this body, including nested renders and exceptions.
   const render=(key,receiver,run)=>{
    if(!config.enabled())return run();reset();const entry=config.entry(key),registered=classes.get(key);
    if(!entry?.class_rule||!registered)return run();const previous=active,frameContext=context;
    const record={manifest_key:key,observation_id:config.id('class_render'),operation:'returned',registration_id:registered.record.observation_id,
     class_type:registered.record.class_type,receiver:snapshot(receiver),reads:[]};
    try{const fiber=registered.ownerRef?.current;
     if(!fiber||fiber.tag!==1||fiber.type!==registered.value||fiber.stateNode!==receiver)record.frontier='class_renderer_owner_unobserved';
     else{record.owner=config.owner?.(fiber)||null;record.inputs={props:snapshot(fiber.pendingProps),state:snapshot(fiber.memoizedState)};instances.set(receiver,{registration_id:registered.record.observation_id,render_id:record.observation_id,owner:record.owner});}
    }catch(_){record.frontier='class_renderer_owner_unobserved';}
    const action=config.action?.();record.action=action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null;
    active={key,record,context:frameContext,props:registered.ownerRef?.current?.pendingProps,state:registered.ownerRef?.current?.memoizedState};
    try{const result=run();record.result=snapshot(result);return result;}
    catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
    finally{active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frameContext)config.observe(record);}catch(_){}}
   };
   const read=(key,sourceId,field,value)=>{if(config.enabled()&&active?.key===key&&(config.context?.()||'default')===active.context)active.record.reads.push({source_id:sourceId,field,input_match:Object.is(value,active[field]),value:Object.is(value,active[field])&&active.record.inputs?.[field]?active.record.inputs[field]:snapshot(value)});return value;};
   // Keep each update's callback closure attached to that exact call, even when
   // React runs it after the method returned. These are source-body observations;
   // they do not infer queue processing, state merging or a commit from a return.
   const emitUpdate=record=>{try{config.observeUpdate?.(record);}catch(_){}};
   const updateCall=(key,receiver,run)=>{
    if(!config.enabled())return run();reset();const entry=config.entry(key),registered=classes.get(entry?.class_key),origin=instances.get(receiver);
    if(!entry?.class_update_rule||!registered)return run();
    const previous=updating,frame={key,entry,registered,receiver,context,done:false,queued:[]};
    frame.record={manifest_key:key,observation_id:config.id('class_update'),operation:'returned',registration_id:registered.record.observation_id,
     instance_origin_id:origin?.render_id||null,receiver:snapshot(receiver),inputs:{},callbacks:[]};
    const action=config.action?.();frame.record.action=action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null;
    if(!origin||origin.registration_id!==registered.record.observation_id)frame.record.frontier='class_update_instance_unobserved';
    updating=frame;
    try{const result=run();frame.record.result=snapshot(result);return result;}
    catch(error){frame.record.operation='threw';frame.record.result=snapshot(error);throw error;}
    finally{updating=previous;frame.done=true;if(config.enabled()&&(config.context?.()||'default')===frame.context){emitUpdate(frame.record);for(const row of frame.queued)emitUpdate(row);}frame.queued=[];}
   };
   const updateMethod=(key,receiver,callee)=>{
    const frame=updating;
    if(config.enabled()&&frame?.key===key){frame.record.callee=snapshot(callee);if(callee!==frame.registered.methods[frame.entry.class_update_rule.member])frame.record.frontier='class_update_method_unconfirmed';}
    // The original method is read once, before its arguments, and receives the
    // original receiver. Application getters, exceptions and return values survive.
    return function(){return Reflect.apply(callee,receiver,arguments);};
   };
   const updateArgument=(key,index,value)=>{if(config.enabled()&&updating?.key===key)updating.record.inputs[index]=snapshot(value);return value;};
   const updateCallback=(key,index,factory)=>{
    const frame=updating,callback=frame?.entry.class_update_callbacks.find(row=>row.index===index);
    if(!config.enabled()||frame?.key!==key||!callback)return factory((_receiver,_args,run)=>run());
    let value;
    const observeBody=(receiver,args,run)=>{
     if(!config.enabled()||(config.context?.()||'default')!==frame.context)return run();
     const row={manifest_key:key,observation_id:config.id('class_update_callback'),operation:'callback_returned',request_id:frame.record.observation_id,
      index,source_id:callback.source_id,callback:snapshot(value),receiver:snapshot(receiver),arguments:Array.from(args,snapshot),arguments_complete:callback.body.kind==='function',
      receiver_basis:callback.body.kind==='function'?'call':'lexical',timing:frame.done?'after_method_return':'during_method_call'};
     try{const result=run();row.result=snapshot(result);return result;}
     catch(error){row.operation='callback_threw';row.result=snapshot(error);throw error;}
     finally{if(config.enabled()&&(config.context?.()||'default')===frame.context){if(frame.done)emitUpdate(row);else frame.queued.push(row);}}
    };
    value=factory(observeBody);frame.record.callbacks.push({index,source_id:callback.source_id,value:snapshot(value)});return value;
   };
   return {classRegister:register,classRender:render,classRead:read,classUpdateCall:updateCall,classUpdateMethod:updateMethod,classUpdateArgument:updateArgument,classUpdateCallback:updateCallback};
  }
  // END GENERATED REACT CLASS OBSERVER
  var classObserver=createReactClassObserver({entry:function(key){return lifecycleEntry(key);},context:lifecycleContextKey,
    action:function(){return activeRefAction;},enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observeUpdate:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;emit(Object.assign({schema:'producttrace.react-class-update-observation.v1',kind:'react_class_update',runtime_observed:true,
      map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));},
    owner:function(fiber){var identity=ensureFiberIdentity(fiber);return identity?{root_id:identity.root_id,instance_id:identity.instance_id,mount_id:identity.mount_id,basis:'react-current-class-render.v1'}:null;},
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-class-observation.v1',kind:'react_class',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var hostObserver=createReactHostObserver({entry:function(key){return lifecycleEntry(key,'api_call');},context:lifecycleContextKey,
    action:function(){return activeRefAction;},inspect:inspectHostLookup,enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-host-observation.v1',kind:'react_host',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var serverObserver=createReactServerObserver({entry:function(key){return lifecycleEntry(key);},context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-server-observation.v1',kind:'react_server',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var rootObserver=createReactRootObserver({entry:function(key){return lifecycleEntry(key,'api_call');},context:lifecycleContextKey,
    rootId:ensureRootIdentity,enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-root-observation.v1',kind:'react_root',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));},
    observeCommit:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-root-commit.v1',kind:'react_root_commit',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));},
    observeRecovery:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-root-recovery.v1',kind:'react_root_recovery',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  // BEGIN GENERATED REACT DESCRIPTOR OBSERVER
  function createReactDescriptorCommitObserver(config) {
    let context=null,byProps=new WeakMap();
    const data=(object,key)=>{
      if(!object||!['object','function'].includes(typeof object))return undefined;
      const descriptor=Object.getOwnPropertyDescriptor(object,key);
      return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
    };
    const refresh=()=>{const current=config.context();if(current!==context){context=current;byProps=new WeakMap();}return current;};
    return {
      register(entry,element,description){
        if(!config.enabled())return;refresh();
        if(description.operation!=='returned'||description.frontier||!description.result?.identity||!description.fields?.props?.identity)return;
        const props=data(element,'props'),type=data(element,'type'),owner=data(element,'_owner');
        if(!props||typeof props!=='object'||data(element,'$$typeof')!==Symbol.for('react.element'))return;
        let definitions=byProps.get(props);if(!definitions){definitions=[];byProps.set(props,definitions);}
        // A full list is ambiguous rather than a reason to pick the newest item.
        if(definitions.length>=64){definitions.overflow=true;return;}
        definitions.push({entry,description,type,owner,context,commits:new Set()});
      },
      commit(fiber,identity){
        if(!config.enabled())return;refresh();
        if(!identity||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof identity[key]==='string'&&identity[key]))return;
        const props=data(fiber,'memoizedProps'),type=data(fiber,'elementType');
        const definitions=props&&typeof props==='object'?byProps.get(props):null;if(!definitions)return;
        const candidates=definitions.filter(item=>item.context===context&&item.type===type);
        if(!candidates.length)return;
        for(const definition of candidates){
          const stamp=identity.root_id+'\0'+identity.instance_id+'\0'+identity.mount_id+'\0'+identity.commit_id;
          if(definition.commits.has(stamp))continue;
          // Only remember the last commit per definition; this is deduplication,
          // not a retained history of every render in a long-lived application.
          definition.commits.clear();definition.commits.add(stamp);
          const {entry,description}=definition;
          let parent=data(fiber,'return'),ownerParentDistance=null,ownerRelation=null;
          const ownerReference=definition.owner!==null&&['object','function'].includes(typeof definition.owner);
          for(let distance=1;ownerReference&&parent&&distance<=64;distance++,parent=data(parent,'return')){
            if(parent===definition.owner){ownerParentDistance=distance;ownerRelation='direct';break;}
            if(data(parent,'alternate')===definition.owner||data(definition.owner,'alternate')===parent){ownerParentDistance=distance;ownerRelation='alternate';break;}
          }
          config.observe({schema:'producttrace.react-descriptor-commit.v1',kind:'react_descriptor_commit',runtime_observed:true,
            manifest_key:entry.key,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
            observation_id:config.id('descriptor_commit'),description_observation_id:description.observation_id,
            element_identity:description.result.identity,props_identity:description.fields.props.identity,
            type_identity:description.fields.type.identity,owner_identity:description.fields._owner?.identity||null,
            owner_parent_distance:ownerParentDistance,owner_relation:ownerRelation,renderer:{...identity},
            frontier:definitions.overflow||candidates.length!==1?'committed_descriptor_ambiguous':null,
            reason:'The committed React fiber retained this exact observed props object and element type; no component invocation or child effect is inferred.'});
        }
      },
    };
  }
  // END GENERATED REACT DESCRIPTOR OBSERVER
  // BEGIN GENERATED REACT BOUNDARY_COMMIT OBSERVER
  function createReactBoundaryCommitObserver(config){
   let context=null,byInput=new WeakMap(),byChildProps=new WeakMap(),identities=new WeakMap(),byFiber=new WeakMap(),rootCommits=new Map(),byOrigin=new Map();
   const own=(value,key)=>{
    if(value===null||!['object','function'].includes(typeof value))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
   };
   const refresh=()=>{const next=config.context();if(next!==context){context=next;byInput=new WeakMap();byChildProps=new WeakMap();identities=new WeakMap();byFiber=new WeakMap();rootCommits=new Map();byOrigin=new Map();}};
   const currentFiberCommit=fiber=>{const rows=byFiber.get(fiber)||(fiber&&fiber.alternate&&byFiber.get(fiber.alternate))||[];
    return rows.length===1&&rootCommits.get(rows[0].root_id)===rows[0].commit_id?rows[0]:null;};
   return {
    begin(rootId,commitId){if(!config.enabled())return;refresh();rootCommits.set(rootId,commitId);},
    created(entry,value,observationId){
     if(!config.enabled())return null;refresh();
     const rule=entry.boundary_rule,props=own(value,'props');
     if(own(value,'$$typeof')!==Symbol.for(rule.element_marker)||own(value,'type')!==Symbol.for(rule.marker))return null;
     const input=rule.renderer.input==='children'?own(props,'children'):props;
     if(input===null||!['object','function'].includes(typeof input))return {frontier:'boundary_reference_input_required'};
     let id=identities.get(input);if(!id){id=config.id('boundary_input');identities.set(input,id);}
     const items=byInput.get(input)||[];
     if(items.length>=64){items.overflow=true;return {frontier:'boundary_input_origin_limit'};}
     const item={entry,origin:observationId,inputId:id,key:own(value,'key'),context,lastCommit:null};
     items.push(item);byInput.set(input,items);
     if(entry.semantic_id==='react/Suspense/18.3.1'){
      const children=own(props,'children'),values=Array.isArray(children)?children.slice(0,64):[children];
      for(const child of values){
       if(own(child,'$$typeof')!==Symbol.for('react.element'))continue;
       const childProps=own(child,'props');if(!childProps||typeof childProps!=='object')continue;
       const owners=byChildProps.get(childProps)||[];owners.push(item);if(values.length>=64)owners.overflow=true;byChildProps.set(childProps,owners);
      }
     }
     return {identity:id,field:rule.renderer.input,key:own(value,'key')};
    },
    commit(fiber,identity){
     if(!config.enabled()||!identity)return;refresh();
     if((byFiber.get(fiber)||[]).some(row=>row.root_id===identity.root_id&&row.commit_id===identity.commit_id))return;
     const previousRows=byFiber.get(fiber)||(fiber.alternate&&byFiber.get(fiber.alternate))||[];
     const previous=previousRows.length===1?previousRows[0]:null;
     byFiber.delete(fiber);if(fiber.alternate)byFiber.delete(fiber.alternate);
     const input=own(fiber,'memoizedProps'),items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
     if(!items)return;
     const parent=config.parentIdentity?.(own(fiber,'return'));
     const state=own(fiber,'memoizedState'),snapshot={...identity,key:own(fiber,'key'),index:own(fiber,'index'),
       parent_instance_id:parent?.instance_id||null,parent_mount_id:parent?.mount_id||null,tag:own(fiber,'tag'),mode:own(fiber,'mode'),
       has_state:state!==null&&state!==undefined,dehydrated:state!=null&&own(state,'dehydrated')!=null};
     for(const item of items){
      const selected=config.select(item.entry.boundary_rule,snapshot);if(item.context!==context||item.key!==own(fiber,'key')||!selected)continue;
      const stamp=[identity.root_id,identity.instance_id,identity.mount_id,identity.commit_id].join('\0');
      if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
      const peers=items.filter(other=>other.context===context&&other.key===item.key&&other.entry.boundary_rule.renderer.tag===snapshot.tag);
      const record={schema:'producttrace.react-boundary-commit.v1',kind:'react_boundary_commit',runtime_observed:true,
        observation_id:config.id('boundary_commit'),origin_observation_id:item.origin,manifest_key:item.entry.key,
        source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,
        renderer:snapshot,selection:selected,frontier:items.overflow||peers.length!==1?'boundary_input_origin_ambiguous':null};
      if(item.entry.boundary_rule.fragment&&previous?.renderer&&previous.semantic_id===item.entry.semantic_id){
        const prediction=config.predictIdentity?.(item.entry.boundary_rule,previous.renderer,snapshot);
        if(prediction){record.previous_observation_id=previous.observation_id;record.identity_prediction=prediction;
          if(!prediction.retains)record.frontier='fragment_identity_rule_disagrees';}
      }
      config.observe(record);
      // Keep the immediately preceding commit only when React retained the exact
      // boundary mount. Lazy retry evidence uses this to connect fallback to reveal.
      if(!record.frontier){const retainedPrevious=previous&&['root_id','instance_id','mount_id'].every(key=>previous.renderer?.[key]===snapshot[key])
         &&previous.commit_id!==identity.commit_id?{observation_id:previous.observation_id,root_id:previous.root_id,commit_id:previous.commit_id,
           renderer:{...previous.renderer},semantic_id:previous.semantic_id,selection:{...previous.selection}}:null;
        const ids=byFiber.get(fiber)||[];ids.push({observation_id:record.observation_id,root_id:identity.root_id,commit_id:identity.commit_id,renderer:snapshot,
          semantic_id:item.entry.semantic_id,origin_observation_id:item.origin,selection:selected,previous_commit:retainedPrevious});
        byFiber.set(fiber,ids);if(fiber.alternate)byFiber.set(fiber.alternate,ids);
        byOrigin.set(item.origin,{observation_id:record.observation_id,root_id:identity.root_id,
          commit_id:identity.commit_id,renderer:snapshot,semantic_id:item.entry.semantic_id,
          origin_observation_id:item.origin,selection:selected,previous_commit:retainedPrevious});}
     }
    },
    currentCommit(fiber){
     if(!config.enabled())return null;refresh();return currentFiberCommit(fiber);
    },
    currentOriginCommit(origin){
     if(!config.enabled())return null;refresh();const row=byOrigin.get(origin);
     return row&&rootCommits.get(row.root_id)===row.commit_id?row:null;
    },
    renderBoundary(fiber){
     if(!config.enabled())return null;refresh();
     let cursor=fiber&&own(fiber,'return'),seen=new Set();
     while(cursor&&seen.size<128&&!seen.has(cursor)){
      seen.add(cursor);
      if(own(cursor,'tag')===13){
       const input=own(cursor,'pendingProps')||own(cursor,'memoizedProps');
       const items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
       const matches=(items||[]).filter(item=>item.context===context&&item.key===own(cursor,'key')
         &&item.entry.semantic_id==='react/Suspense/18.3.1');
       if(items?.overflow||matches.length!==1)return {frontier:items?.overflow
         ?'boundary_input_origin_limit':'suspense_render_origin_unresolved'};
       const item=matches[0];
       const identity=config.identify?.(cursor);
       if(!identity)return {frontier:'suspense_render_identity_unresolved'};
       return {fiber:cursor,origin_observation_id:item.origin,manifest_key:item.entry.key,
         source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,
         renderer:{root_id:identity.root_id,instance_id:identity.instance_id,mount_id:identity.mount_id},
         previous_commit:currentFiberCommit(cursor)};
      }
      cursor=own(cursor,'return');
     }
     return cursor?{frontier:'suspense_render_ancestry_incomplete'}:null;
    },
    renderBoundaryFromProps(props){
     if(!config.enabled()||!props||typeof props!=='object')return null;refresh();
     const items=byChildProps.get(props),matches=(items||[]).filter(item=>item.context===context
       &&item.entry.semantic_id==='react/Suspense/18.3.1');
     if(!items)return null;
     if(items.overflow||matches.length!==1)return {frontier:items.overflow
       ?'boundary_input_origin_limit':'suspense_render_origin_unresolved'};
     const item=matches[0];return {fiber:null,origin_observation_id:item.origin,manifest_key:item.entry.key,
       source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,renderer:null};
    },
    currentStrict(fiber){
     if(!config.enabled())return null;refresh();
     let cursor=own(fiber,'return'),seen=new Set();
     while(cursor&&seen.size<128&&!seen.has(cursor)){
      seen.add(cursor);
      if(own(cursor,'tag')===8){
        const input=own(cursor,'pendingProps')||own(cursor,'memoizedProps');
        const items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
        const matches=(items||[]).filter(item=>item.context===context&&item.key===own(cursor,'key')
          &&item.entry.semantic_id==='react/StrictMode/18.3.1');
        if(items?.overflow||matches.length!==1)return null;
        const identity=config.identify?.(cursor);if(!identity)return null;
        return {entry:matches[0].entry,origin:matches[0].origin,input_identity:matches[0].inputId,
          identity:{...identity,tag:own(cursor,'tag'),mode:own(cursor,'mode')}};
      }
      cursor=own(cursor,'return');
     }
     return null;
    },
    ancestry(fiber){
     if(!config.enabled())return [];refresh();
     const result=[],seen=new Set();let cursor=fiber;
     while(cursor&&seen.size<128&&!seen.has(cursor)){
      seen.add(cursor);
      for(const item of byFiber.get(cursor)||[])if(rootCommits.get(item.root_id)===item.commit_id)result.push({observation_id:item.observation_id,root_id:item.root_id,commit_id:item.commit_id});
      cursor=own(cursor,'return');
     }
     return cursor?[{frontier:'boundary_ancestry_incomplete'}]:result;
    },
   };
  }
  // END GENERATED REACT BOUNDARY_COMMIT OBSERVER
  // BEGIN GENERATED REACT BOUNDARY_SELECT OBSERVER
  function selectReactBoundaryCommit(rule,snapshot){
   const renderer=rule?.renderer;
   if(!renderer||!snapshot||snapshot.tag!==renderer.tag||!Number.isSafeInteger(snapshot.mode)
     ||typeof snapshot.has_state!=='boolean'||typeof snapshot.dehydrated!=='boolean')return null;
   return {input:renderer.input,selection:renderer.selection==='suspense_state'
     ?!snapshot.has_state?'children':snapshot.dehydrated?'dehydrated':'fallback':'children',
     strict_render_mode:renderer.strict_render_mask!==0&&(snapshot.mode&renderer.strict_render_mask)!==0,
     strict_effect_mode:renderer.strict_effect_mask!==0&&(snapshot.mode&renderer.strict_effect_mask)!==0};
  }
  // END GENERATED REACT BOUNDARY_SELECT OBSERVER
  // BEGIN GENERATED REACT FRAGMENT_IDENTITY OBSERVER
  function predictReactFragmentIdentity(rule,previous,current){
   const policy=rule?.fragment;
   const valid=row=>row&&['root_id','parent_instance_id','parent_mount_id'].every(key=>typeof row[key]==='string'&&row[key])
     &&Number.isSafeInteger(row.index)&&row.index>=0&&(row.key===null||typeof row.key==='string');
   if(!policy||!valid(previous)||!valid(current))return null;
   const sameParent=['root_id','parent_instance_id','parent_mount_id'].every(key=>previous[key]===current[key]);
   const keyMatches=policy.key_match==='index_only'?previous.index===current.index
     :previous.key===current.key&&(current.key!==null||previous.index===current.index);
   return {retains:sameParent&&keyMatches&&previous.tag===policy.type_tag&&current.tag===policy.type_tag,
     ref:policy.ref,extra_props:policy.extra_props};
  }
  // END GENERATED REACT FRAGMENT_IDENTITY OBSERVER
  // BEGIN GENERATED REACT LAZY_COMMIT OBSERVER
  function createReactLazyCommitObserver(config){
   let context=null,byLazy=new WeakMap(),items=[];
   const own=(value,key)=>{
    if(value===null||!['object','function'].includes(typeof value))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
   };
   const refresh=()=>{const next=config.context();if(next!==context){context=next;byLazy=new WeakMap();items=[];}return next;};
   const boundaryOf=fiber=>{let current=fiber&&own(fiber,'return'),seen=new Set();
    while(current&&seen.size<128&&!seen.has(current)){seen.add(current);if(own(current,'tag')===13)return current;current=own(current,'return');}
    return null;};
   const sameFiber=(left,right)=>left===right||left&&right&&(own(left,'alternate')===right||own(right,'alternate')===left);
   return {
    register(entry,lazy,record){
     if(!config.enabled()||!lazy||typeof lazy!=='object'||record.operation!=='returned')return;refresh();
     let rows=byLazy.get(lazy);if(!rows){rows=[];byLazy.set(lazy,rows);}
     if(rows.length>=32||items.length>=512){rows.overflow=true;return;}
     const item={entry,lazy,context,allocation_observation_id:record.observation_id,lazy_identity:record.result.identity,
      loader:null,settlement:null,boundary:null,boundaryProps:null,boundaryKey:null,boundaryMatch:null,boundaryAmbiguous:false,
      fallback:null,lastCommit:null,completed:false};
     rows.push(item);items.push(item);
    },
    loader(entry,lazy,thenable,record,fiber){
     if(!config.enabled()||!lazy||typeof lazy!=='object')return;refresh();
     const rows=(byLazy.get(lazy)||[]).filter(item=>item.context===context&&item.entry.key===entry.key
      &&item.allocation_observation_id===record.creation_observation_id&&item.lazy_identity===record.lazy_identity);
     if(rows.length!==1)return;
     const item=rows[0];item.loader={observation_id:record.observation_id,thenable,
      thenable_identity:record.result?.identity||null,protocol:record.thenable_protocol||null};
     item.boundary=boundaryOf(fiber);item.boundaryProps=own(item.boundary,'pendingProps')||own(item.boundary,'memoizedProps');
     item.boundaryKey=own(item.boundary,'key');
    },
    settle(entry,lazy,value,record){
     if(!config.enabled()||!lazy||typeof lazy!=='object')return;refresh();
     const rows=(byLazy.get(lazy)||[]).filter(item=>item.context===context&&item.entry.key===entry.key
      &&item.allocation_observation_id===record.creation_observation_id&&item.lazy_identity===record.lazy_identity
      &&item.loader?.observation_id===record.loader_observation_id&&item.loader.thenable_identity===record.thenable_identity);
     if(rows.length===1)rows[0].settlement={observation_id:record.observation_id,
      outcome:record.operation==='loader_fulfilled'?'fulfilled':'rejected',value,result_identity:record.result?.identity||null};
    },
    boundaryCommit(fiber,commit){
     if(!config.enabled()||!fiber||!commit)return;refresh();
     for(const item of items){if(item.context!==context)continue;
      const exact=sameFiber(item.boundary,fiber)||item.boundaryProps&&own(fiber,'memoizedProps')===item.boundaryProps&&own(fiber,'key')===item.boundaryKey;
      if(!exact)continue;
      if(item.boundaryMatch&&!sameFiber(item.boundaryMatch,fiber))item.boundaryAmbiguous=true;else item.boundaryMatch=fiber;
      if(commit.selection?.selection==='fallback')item.fallback={...commit};
     }
    },
    commit(fiber,renderer){
     if(!config.enabled()||!fiber||!renderer)return;refresh();
     const lazy=own(fiber,'elementType'),rows=lazy&&typeof lazy==='object'?byLazy.get(lazy):null;if(!rows)return;
     const boundary=boundaryOf(fiber),reveal=boundary&&config.boundary(boundary),component=own(fiber,'type');
     for(const item of rows){if(item.context!==context||item.completed)continue;
      if(!item.fallback&&reveal?.previous_commit?.selection?.selection==='fallback')item.fallback={...reveal.previous_commit};
      const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.commit_id].join('\0');if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
      let frontier=null;
      if(rows.overflow||rows.length!==1)frontier='lazy_allocation_origin_ambiguous';
      else if(item.boundaryAmbiguous)frontier='lazy_suspense_boundary_origin_ambiguous';
      else if(!item.loader)frontier='lazy_loader_occurrence_unobserved';
      else if(item.loader.protocol!=='native_promise.v1')frontier='lazy_thenable_settlement_unobserved';
      else if(!item.settlement)frontier='lazy_native_promise_settlement_unobserved';
      else if(item.settlement.outcome!=='fulfilled')frontier='lazy_rejected_value_cannot_commit';
      else if(!item.fallback)frontier='lazy_fallback_commit_unobserved';
      else if(!reveal||reveal.selection?.selection!=='children')frontier='lazy_reveal_boundary_commit_unobserved';
      else if(!component||typeof component!=='function')frontier='lazy_resolved_component_unobserved';
      const observation_id=config.id('lazy_commit');
      config.observe({schema:'producttrace.react-lazy-commit.v1',kind:'react_lazy_commit',runtime_observed:true,
       observation_id,manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
       allocation_observation_id:item.allocation_observation_id,loader_observation_id:item.loader?.observation_id||null,
       settlement_observation_id:item.settlement?.observation_id||null,lazy_identity:item.lazy_identity,
       thenable_identity:item.loader?.thenable_identity||null,module_identity:item.settlement?.result_identity||null,
       component_identity:component&&typeof component==='function'?config.identity(component):null,
       fallback_boundary_commit_observation_id:item.fallback?.observation_id||null,
       reveal_boundary_commit_observation_id:reveal?.observation_id||null,renderer:{...renderer},frontier});
      if(!frontier)item.completed=true;
     }
    },
   };
  }
  // END GENERATED REACT LAZY_COMMIT OBSERVER
  var boundaryCommitObserver=createReactBoundaryCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,select:selectReactBoundaryCommit,predictIdentity:predictReactFragmentIdentity,parentIdentity:fiberRuntimeIdentity,identify:ensureFiberIdentity,observe:function(record){
      emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var lazyCommitObserver=createReactLazyCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started&&!disabled;},id:lifecycleId,identity:lifecycleValueIdentity,
    boundary:function(fiber){return boundaryCommitObserver.currentCommit(fiber);},
    observe:function(record){emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
      occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  // BEGIN GENERATED REACT STRICT_REPLAY OBSERVER
  function createReactStrictReplayObserver(config) {
    let context = null, stacks = new Map();
    const refresh = () => {
      const next = config.context();
      if (next !== context) { context = next; stacks = new Map(); }
    };
    return {
      signal(rendererId, replaying) {
        if (!config.enabled()) return;
        refresh();
        if (typeof replaying !== 'boolean') return;
        const stack = stacks.get(rendererId) || [];
        if (!replaying) {
          if(stack.overflow){stack.overflow--;return;}
          const frame = stack.pop();
          if (frame?.record) config.observe({...frame.record, operation:'finished',
            observation_id:config.id('strict_replay_end'), replay_id:frame.record.observation_id});
          return;
        }
        stacks.set(rendererId,stack);
        if(stack.length>=64){stack.overflow=(stack.overflow||0)+1;return;}
        const frame={fiber:null,record:null};stack.push(frame);
        const renderer = config.renderer(rendererId);
        if (renderer?.rendererPackageName !== 'react-dom' || renderer.bundleType !== 1
            || renderer.version !== '18.3.1' || typeof renderer.getCurrentFiber !== 'function') return;
        const fiber = renderer.getCurrentFiber();
        if (!fiber) return;
        const boundary = config.boundary(fiber), owner = config.identity(fiber);
        if (!boundary || !owner) return;
        const record = {schema:'producttrace.react-strict-replay.v1', kind:'react_strict_replay',
          runtime_observed:true, operation:'started', observation_id:config.id('strict_replay'),
          manifest_key:boundary.entry.key, source_call_id:boundary.entry.source_call_id,
          semantic_id:boundary.entry.semantic_id, origin_observation_id:boundary.origin,
          input_identity:boundary.input_identity, boundary:boundary.identity, owner,
          renderer:{id:rendererId, version:renderer.version, package:renderer.rendererPackageName, bundle_type:renderer.bundleType}};
        frame.fiber=fiber;frame.record=record;config.observe(record);
      },
      current(fiber) {
        if (!config.enabled() || !fiber) return null;
        refresh();
        const matches = [];
        for (const stack of stacks.values()) {
          const frame = stack.at(-1);
          if (!stack.overflow && frame?.record && (frame.fiber === fiber || frame.fiber === fiber.alternate)) matches.push(frame);
        }
        return matches.length === 1 ? matches[0].record.observation_id : null;
      },
    };
  }
  // END GENERATED REACT STRICT_REPLAY OBSERVER
  // BEGIN GENERATED REACT PROFILER OBSERVER
  function createReactProfilerObserver(config){
    let context=null,functions=new WeakMap(),inputs=new WeakMap();
    // A failed recorder sink cannot replace the application's result or error.
    // Missing receipts will make the downstream join abstain.
    const emit=record=>{try{config.observe(record);}catch{}};
    const own=(object,key)=>{const d=object&&Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
    const refresh=()=>{const next=config.context();if(next!==context){context=next;functions=new WeakMap();inputs=new WeakMap();}};
    return {
      define(entry,factory,name){
        let fn;
        fn=factory((args,body)=>{
          if(!config.enabled())return body();refresh();
          let state=functions.get(fn);if(!state){state={entry,calls:[],tainted:false};functions.set(fn,state);}
          const call={id:config.id('profiler_callback'),args:Array.from(args),outcome:'running'};
          if(state.calls.length>=2)state.tainted=true;else state.calls.push(call);
          emit({operation:'callback_started',observation_id:call.id,manifest_key:entry.key,
            callback_identity:config.identity(fn),callback_source_id:entry.callback_source_id,
            arguments:call.args.map(config.value)});
          try {const result=body();call.outcome='returned';return result;}
          catch(error){call.outcome='threw';throw error;}
          finally {emit({operation:'callback_finished',observation_id:config.id('profiler_callback_end'),
            invocation_id:call.id,manifest_key:entry.key,callback_identity:config.identity(fn),
            callback_source_id:entry.callback_source_id,outcome:call.outcome});}
        });
        if(name&&!fn.name)Object.defineProperty(fn,'name',{value:name,configurable:true});
        return fn;
      },
      created(entry,element,origin){
        if(!config.enabled()||!entry.boundary_rule?.profiler)return;refresh();
        const props=own(element,'props'),fn=own(props,entry.boundary_rule.profiler.callback);
        if(!props||typeof fn!=='function')return;
        const rows=inputs.get(props)||[];if(rows.length<64)rows.push({entry,fn,origin});else rows.overflow=true;inputs.set(props,rows);
      },
      commit(root,renderer){
        if(!config.enabled())return;refresh();
        if(renderer?.rendererPackageName!=='react-dom'||![0,1].includes(renderer.bundleType)
          ||!['18.3.1','18.3.1-next-f1338f8080-20240426'].includes(renderer.version))return;
        // An old fiber can retain Update flags. Require its absence from the
        // preceding tree; flags on a reused bailout are not a fresh invocation.
        const collect=start=>{const seen=new Set(),todo=start?[start]:[];while(todo.length&&seen.size<20000){const f=todo.pop();if(seen.has(f))continue;seen.add(f);if(f.child)todo.push(f.child);if(f.sibling)todo.push(f.sibling);}return todo.length?null:seen;};
        const current=root?.current,previous=collect(current?.alternate),tree=collect(current);
        if(!current?.alternate||!previous||!tree)return;
        for(const fiber of tree){
          const rows=inputs.get(own(fiber,'memoizedProps'));if(!rows?.length)continue;
          const item=rows[0],state=functions.get(item.fn),calls=state?.calls||[];
          if(!state)continue;
          if(rows.length!==1||calls.length>1)state.tainted=true;
          const call=calls.length===1?calls[0]:null,props=own(fiber,'memoizedProps');
          const snapshot={tag:fiber.tag,mode:fiber.mode,flags:fiber.flags,fresh:!previous.has(fiber),
            profile_state:typeof own(fiber.stateNode,'effectDuration')==='number',mounted:fiber.alternate!==null,
            nested:call?.args[1]==='nested-update',id:config.value(own(props,'id')),
            actualDuration:config.value(fiber.actualDuration),treeBaseDuration:config.value(fiber.treeBaseDuration),
            actualStartTime:config.value(fiber.actualStartTime),commitTime:call?config.value(call.args[5]):null};
          const program=config.interpret(item.entry.boundary_rule,snapshot);
          if(!program)continue;
          const identity=config.fiberIdentity(fiber),boundary=config.boundary(fiber);
          const matches=call&&call.outcome==='returned'&&state.entry.source_call_id===item.entry.source_call_id
            &&JSON.stringify(call.args.map(config.value))===JSON.stringify(program.arguments);
          const frontier=state.tainted?'profiler_callback_ambiguous':!call?'profiler_callback_body_unobserved'
            :!matches?'profiler_callback_program_disagrees':!identity||!boundary?'profiler_committed_boundary_required':null;
          emit({operation:'committed_callback',observation_id:config.id('profiler_commit'),
            manifest_key:item.entry.key,callback_manifest_key:state.entry.key,callback_source_id:state.entry.callback_source_id,
            callback_identity:config.identity(item.fn),invocation_id:call?.id||null,
            origin_observation_id:item.origin,boundary_observation_id:boundary?.observation_id||null,
            renderer:identity,renderer_build:{package:renderer.rendererPackageName,version:renderer.version,bundle_type:renderer.bundleType},snapshot,program,frontier});
          // A reused function must produce a new body receipt at its next commit.
          state.calls=[];
        }
      },
    };
  }
  // END GENERATED REACT PROFILER OBSERVER
  // BEGIN GENERATED REACT PROFILER_PROGRAM OBSERVER
  function interpretReactProfilerCommit(rule,snapshot){
    const p=rule?.profiler;
    if(!p||!snapshot||snapshot.tag!==rule.renderer.tag||snapshot.fresh!==true
      ||snapshot.profile_state!==true||typeof snapshot.mounted!=='boolean'||typeof snapshot.nested!=='boolean'
      ||!Number.isSafeInteger(snapshot.mode)||!Number.isSafeInteger(snapshot.flags)
      ||!(snapshot.mode&p.profile_mask)||!(snapshot.flags&p.update_mask))return null;
    const phase=snapshot.nested?p.nested_phase:snapshot.mounted?p.update_phase:p.mount_phase;
    const values={...snapshot,phase:{encoding:'primitive',value:phase}};
    return {callback:p.callback,phase:p.phase,arguments:p.arguments.map(key=>values[key]),result:p.result};
  }
  // END GENERATED REACT PROFILER_PROGRAM OBSERVER
  var profilerObserver=createReactProfilerObserver({context:lifecycleContextKey,
    enabled:function(){return started&&!disabled&&!!bindings.react_lifecycle;},id:lifecycleId,identity:lifecycleValueIdentity,
    value:function(value){var encoded=encodedLifecycleValue(value);return encoded.encoding==='primitive'?encoded:{encoding:'identity',value:lifecycleValueIdentity(value)};},
    interpret:interpretReactProfilerCommit,fiberIdentity:fiberRuntimeIdentity,
    boundary:function(fiber){return boundaryCommitObserver.currentCommit(fiber);},
    observe:function(record){emit(Object.assign({schema:'producttrace.react-profiler.v1',kind:'react_profiler',runtime_observed:true,
      map_fingerprint:bindings.react_lifecycle.map_fingerprint,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var strictReplayObserver=createReactStrictReplayObserver({context:lifecycleContextKey,
    enabled:function(){return started&&!disabled;},id:lifecycleId,
    renderer:function(id){var hook=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;return hook&&hook.renderers&&hook.renderers.get(id);},
    identity:ensureFiberIdentity,boundary:function(fiber){return boundaryCommitObserver.currentStrict(fiber);},
    observe:function(record){emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
      occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  // BEGIN GENERATED REACT ID_COMMIT OBSERVER
  function createReactIdCommitObserver(config) {
    let context=null,byProps=new WeakMap();
    const own=(value,key)=>{
      if(value===null||!['object','function'].includes(typeof value))return undefined;
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
    };
    const refresh=()=>{const next=config.context();if(next!==context){context=next;byProps=new WeakMap();}};
    return {
      element(entry,element,use,render){
        if(!config.enabled())return element;refresh();
        const props=own(element,'props'),type=own(element,'type');
        if(!use||!render||typeof type!=='string'||!props||typeof props!=='object'
          ||own(element,'$$typeof')!==Symbol.for('react.element')||own(props,entry.id_property)!==use.value)return element;
        let items=byProps.get(props);if(!items){items=[];byProps.set(props,items);}
        if(items.length>=64){items.overflow=true;return element;}
        items.push({entry,use,render,type,context,lastCommit:null});
        return element;
      },
      commit(fiber,host,owner){
        if(!config.enabled()||!host||!owner)return;refresh();
        const props=own(fiber,'memoizedProps'),items=props&&typeof props==='object'?byProps.get(props):null;
        if(!items)return;
        const type=own(fiber,'elementType');
        for(const item of items){
          if(item.context!==context||item.type!==type||item.render.status!=='committed'
            ||own(props,item.entry.id_property)!==item.use.value
            ||item.render.render_id!==owner.render_id
            ||['root_id','instance_id','mount_id'].some(key=>item.render.identity[key]!==owner[key]))continue;
          const stamp=[host.root_id,host.instance_id,host.mount_id,host.commit_id].join('\0');
          if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
          const peers=items.filter(other=>other.context===context&&other.type===type&&other.entry.id_property===item.entry.id_property);
          config.observe({schema:'producttrace.react-id-commit.v1',kind:'react_id_commit',runtime_observed:true,
            manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
            observation_id:config.id('id_commit'),use_observation_id:item.use.observation_id,
            id_read_source_id:item.entry.id_read_source_id,id_property:item.entry.id_property,value:item.use.value,
            host:{...host,type},owner:{...owner},
            frontier:items.overflow||peers.length!==1?'id_property_origin_ambiguous':null});
        }
      },
    };
  }
  // END GENERATED REACT ID_COMMIT OBSERVER
  var idCommitObserver=createReactIdCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,observe:function(record){
      emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var descriptorObserver=createReactDescriptorCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,observe:function(record){
      emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  // BEGIN GENERATED REACT PORTAL_COMMIT OBSERVER
  function createReactPortalCommitObserver(config){
   let context=null,byContainer=new WeakMap(),byFiber=new WeakMap(),rootCommits=new Map();
   const own=(value,key)=>{
    if(value===null||!['object','function'].includes(typeof value))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
   };
   const refresh=()=>{const next=config.context();if(next!==context){context=next;byContainer=new WeakMap();byFiber=new WeakMap();rootCommits=new Map();}return next;};
   return {
    begin(rootId,commitId){if(!config.enabled())return;refresh();rootCommits.set(rootId,commitId);},
    register(entry,portal,description,args){
     if(!config.enabled())return;refresh();
     const rule=entry.portal_rule,children=args[rule.children_argument],container=args[rule.container_argument];
     if(description.operation!=='returned'||description.frontier||!portal||typeof portal!=='object'
       ||!container||!['object','function'].includes(typeof container)
       ||own(portal,'$$typeof')!==Symbol.for(rule.marker)||own(portal,rule.children_field)!==children
       ||own(portal,rule.container_field)!==container)return;
     let items=byContainer.get(container);if(!items){items=[];byContainer.set(container,items);}
     if(items.length>=64){items.overflow=true;return;}
     items.push({entry,description,children,container,key:own(portal,'key'),context,lastCommit:null});
    },
    commit(fiber,identity){
     if(!config.enabled()||!identity||own(fiber,'tag')!==4)return;refresh();
     const state=own(fiber,'stateNode'),container=own(state,'containerInfo'),children=own(fiber,'memoizedProps'),key=own(fiber,'key');
     const items=container&&['object','function'].includes(typeof container)?byContainer.get(container):null;if(!items)return;
     const matches=items.filter(item=>item.context===context&&item.children===children&&item.key===key);
     for(const item of matches){
      const stamp=[identity.root_id,identity.instance_id,identity.mount_id,identity.commit_id].join('\0');
      if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
      const record={schema:'producttrace.react-portal-commit.v1',kind:'react_portal_commit',runtime_observed:true,operation:'committed',
       observation_id:config.id('portal_commit'),origin_observation_id:item.description.observation_id,
       manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
       children_identity:item.description.inputs[item.entry.portal_rule.children_argument].identity,
       container_identity:item.description.inputs[item.entry.portal_rule.container_argument].identity,
       renderer:{...identity,tag:4,key},frontier:items.overflow||matches.length!==1?'portal_commit_origin_ambiguous':null};
      config.observe(record);
      if(!record.frontier){const retained={observation_id:record.observation_id,origin_observation_id:record.origin_observation_id,
        root_id:identity.root_id,commit_id:identity.commit_id,renderer:record.renderer,entry:item.entry};
       byFiber.set(fiber,retained);if(fiber.alternate)byFiber.set(fiber.alternate,retained);}
     }
    },
    unmount(fiber){
     if(!config.enabled()||!fiber)return;refresh();
     const retained=byFiber.get(fiber)||(fiber.alternate&&byFiber.get(fiber.alternate));if(!retained)return;
     config.observe({schema:'producttrace.react-portal-commit.v1',kind:'react_portal_commit',runtime_observed:true,operation:'unmounted',
      observation_id:config.id('portal_unmount'),origin_observation_id:retained.origin_observation_id,
      commit_observation_id:retained.observation_id,manifest_key:retained.entry.key,source_call_id:retained.entry.source_call_id,
      semantic_id:retained.entry.semantic_id,renderer:{...retained.renderer}});
     byFiber.delete(fiber);if(fiber.alternate)byFiber.delete(fiber.alternate);
    },
    ancestry(fiber){
     if(!config.enabled())return [];refresh();
     const rows=[],seen=new Set();let cursor=fiber;
     while(cursor&&seen.size<128&&!seen.has(cursor)){
      seen.add(cursor);const item=byFiber.get(cursor);
      if(item&&rootCommits.get(item.root_id)===item.commit_id)rows.push({observation_id:item.observation_id,root_id:item.root_id,commit_id:item.commit_id});
      cursor=own(cursor,'return');
     }
     return cursor?[{frontier:'portal_ancestry_incomplete'}]:rows;
    },
   };
  }
  // END GENERATED REACT PORTAL_COMMIT OBSERVER
  var portalCommitObserver=createReactPortalCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,observe:function(record){
      emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var elementObserver=createReactElementObserver({registerDescriptor:function(entry,result,record){descriptorObserver.register(entry,result,record);},
    registerLazy:function(entry,result,record){lazyCommitObserver.register(entry,result,record);},
    loadLazy:function(entry,lazy,thenable,record,fiber){lazyCommitObserver.loader(entry,lazy,thenable,record,fiber);},
    settleLazy:function(entry,lazy,value,record){lazyCommitObserver.settle(entry,lazy,value,record);},
    currentFiber:currentReactFiber,entry:function(key){return lifecycleEntry(key,'api_call');},context:lifecycleContextKey,objectIdentity:lifecycleValueIdentity,
    enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-element-observation.v1',kind:'react_element',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        build:lifecycleRendererBuild(),
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var portalObserver=createReactPortalObserver({registerCommit:function(entry,result,record,args){portalCommitObserver.register(entry,result,record,args);},entry:function(key){return lifecycleEntry(key,'api_call');},
    enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    observe:function(record){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      emit(Object.assign({schema:'producttrace.react-portal-observation.v1',kind:'react_portal',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  // BEGIN GENERATED REACT REF_COMMIT OBSERVER
  function createReactRefCommitObserver(config){
    let context=null,refs=new WeakMap(),items=[];
    const own=(value,key)=>{
      if(value===null||!['object','function'].includes(typeof value))return undefined;
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
    };
    const refresh=()=>{const next=config.context();if(next!==context){context=next;refs=new WeakMap();items=[];}return next;};
    return {
      register(entry,value,record){
        if(!config.enabled()||!value||typeof value!=='object'||record.operation!=='returned'
          ||typeof record.ref_id!=='string'||typeof record.observation_id!=='string')return;
        refresh();let item=refs.get(value);
        if(!item){item={entry,record,ref:value,context,lastCommit:null,lastOwnerCommit:null};refs.set(value,item);if(items.length<512)items.push(item);}
        else {item.entry=entry;item.record=record;}
      },
      commitOwner(renderer){
        if(!config.enabled()||!renderer||!['root_id','instance_id','mount_id','render_id','commit_id'].every(key=>typeof renderer[key]==='string'&&renderer[key]))return;
        refresh();
        for(const item of items){const owner=item.record.owner;
          if(item.context!==context||!item.entry.hook_owned||!owner
            ||['root_id','instance_id','mount_id','render_id'].some(key=>owner[key]!==renderer[key]))continue;
          const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.render_id,renderer.commit_id].join('\0');
          if(item.lastOwnerCommit===stamp)continue;item.lastOwnerCommit=stamp;
          config.observe({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
            manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
            surface:item.entry.surface,export:item.entry.export,source_access_id:null,
            observation_id:config.id('ref_hook_commit'),operation:'hook_committed',ref_id:item.record.ref_id,
            origin_observation_id:item.record.origin_observation_id,origin_source_call_id:item.entry.source_call_id,
            value:config.snapshot(item.ref),renderer:{...renderer},
            reason:'The exact observed hook ref object belonged to this exact component render when React committed it.'});
        }
      },
      commit(fiber,renderer){
        if(!config.enabled()||!renderer||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof renderer[key]==='string'&&renderer[key]))return;
        refresh();const ref=own(fiber,'ref'),item=ref&&typeof ref==='object'?refs.get(ref):null;
        if(!item||item.context!==context)return;
        const host=own(fiber,'stateNode'),current=own(ref,item.entry.ref_rule.property);
        if(!host||current!==host)return;
        const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.commit_id].join('\0');
        if(item.lastCommit===stamp)return;item.lastCommit=stamp;
        config.observe({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
          manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
          surface:item.entry.surface,export:item.entry.export,source_access_id:null,
          observation_id:config.id('ref_commit'),operation:'host_attached',ref_id:item.record.ref_id,
          origin_observation_id:item.record.origin_observation_id,origin_source_call_id:item.entry.source_call_id,
          value:config.snapshot(host),renderer:{...renderer},
          reason:'The committed host fiber retained this exact observed ref object and React had written the exact host node to its current data property.'});
      },
    };
  }
  // END GENERATED REACT REF_COMMIT OBSERVER
  var refCommitObserver=createReactRefCommitObserver({context:lifecycleContextKey,
    enabled:function(){return started && !disabled;},id:lifecycleId,
    snapshot:function(value){return Object.assign({identity:lifecycleValueIdentity(value),kind:value===null?'null':typeof value},encodedLifecycleValue(value));},
    observe:function(record){emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
      value_identity_scope:'react-value.v1',session:lifecycleContextKey(),build:lifecycleRendererBuild(),
      occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});
  var refObserver=createReactRefObserver({
    entry:function(key){return lifecycleEntry(key);},enabled:function(){return started && !disabled;},
    context:lifecycleContextKey,id:lifecycleId,encode:encodedLifecycleValue,
    objectIdentity:lifecycleValueIdentity,
    registerRef:function(entry,value,record){refCommitObserver.register(entry,value,record);},
    action:function(){return activeRefAction;},
    describeSource:function(value,candidates){return scopeObserver.describeSource(value,candidates);},
    captureOwner:function(entry){
      var render=entry.hook_owned?activeLifecycleRender(entry):null;if(!render)return null;
      var slot=lifecycleHookSlot(render,entry);ensureLifecycleAttempt(render,entry,slot);return {render:render,slot:slot};
    },
    describeOwner:refOwnerSnapshot,
    observe:function(record,handle){var entry=lifecycleEntry(record.manifest_key);if(!entry)return;
      var deliver=function(){if(!started || disabled)return;if(handle)record.owner=refOwnerSnapshot(handle);
        emit(Object.assign({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
        map_fingerprint:bindings.react_lifecycle.map_fingerprint,value_identity_scope:'react-value.v1',source_call_id:entry.source_call_id,
        source_access_id:entry.ref_access?entry.ref_access.source_id:null,semantic_id:entry.semantic_id,
        surface:entry.surface,export:entry.export,build:lifecycleRendererBuild(),
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));};
      // Production learns the real Fiber identity at adoption. Delay delivery,
      // not value capture, so early placeholder IDs do not masquerade as owners.
      if(handle && handle.render.dispatcher_marker && ['preparing','attempted'].indexOf(handle.render.status)!==-1)
        handle.render.pending_records.push(deliver);
      else deliver();
    }
  });
  var transitionStarts=new WeakMap();
  var scopeObserver=createReactScopeObserver({
    entry:function(key){return lifecycleEntry(key,'api_call');},
    enabled:function(){return started && !disabled;},id:lifecycleId,encode:encodedLifecycleValue,
    context:lifecycleContextKey,
    observeOrigin:function(record){if(!started || disabled)return;emit(Object.assign({
      schema:'producttrace.react-callback-source.v1',kind:'react_callback_source',runtime_observed:true,
      map_fingerprint:bindings.react_lifecycle.map_fingerprint,occurrence_id:record.observation_id+':occurrence',
      evidence_ids:[record.observation_id]},record));},
    captures:readLifecycleCaptures,
    describeTarget:function(value,entry){var origin=typeof value==='function' && transitionStarts.get(value);
      return origin && origin.source_call_id===entry.transition_hook_call_id?origin:null;},
    action:function(){var stamp=window[ACTION_STAMP_GLOBAL];var record=Number.isInteger(stamp) && actionRecordsByStamp[stamp];
      return record?record.session+':action:'+record.seq:null;},
    observe:function(key,value,operation,scope){lifecycleApiObservation(key,value,'api_call',operation,scope);}
  });

  // BEGIN GENERATED REACT PREDICATE_USE OBSERVER
  function createReactPredicateUseObserver(config){
    const frames=new WeakMap();
    const frame=()=>{const token={};frames.set(token,{id:config.id('predicate_frame'),context:config.context(),calls:new Map()});return token;};
    const call=(key,token,run)=>{
      frames.get(token)?.calls.delete(key);
      return config.scopeCall(key,run,scope=>{
      const current=frames.get(token);
      if(!config.enabled()||!current||current.context!==config.context())return;
      current.calls.delete(key);
      if(scope.outcome==='returned'&&scope.result?.kind==='boolean')current.calls.set(key,{
        scope_id:scope.scope_id,value:scope.result.value,action_occurrence_id:scope.action_occurrence_id});
      },frames.get(token)?.id);
    };
    const use=(key,token,value)=>{
      const entry=config.entry(key),current=frames.get(token);
      if(!config.enabled()||!entry||entry.kind!=='predicate_use'||!current||current.context!==config.context())return value;
      const origin=current.calls.get(entry.predicate_origin_key);
      const observation_id=config.id('predicate_use');
      try{config.observe({schema:'producttrace.react-predicate-use.v1',kind:'react_predicate_use',runtime_observed:true,
        observation_id,manifest_key:key,source_call_id:entry.source_call_id,condition_source_id:entry.condition_source_id,
        source_scope_id:origin?.scope_id||null,source_frame_id:current.id,value:typeof value==='boolean'?value:null,
        action_occurrence_id:config.action?.()||null,frontier:!origin?'predicate_call_occurrence_unobserved':null});}catch(_){}
      return value;
    };
    return {predicateFrame:frame,predicateCall:call,predicateUse:use};
  }
  // END GENERATED REACT PREDICATE_USE OBSERVER
  var predicateUseObserver=createReactPredicateUseObserver({context:lifecycleContextKey,
    enabled:function(){return started&&!disabled;},entry:function(key){return lifecycleEntry(key,'predicate_use');},
    scopeCall:scopeObserver.scopeCall,id:lifecycleId,
    action:function(){var stamp=window[ACTION_STAMP_GLOBAL];var record=Number.isInteger(stamp)&&actionRecordsByStamp[stamp];
      return record?record.session+':action:'+record.seq:null;},
    observe:function(record){emit(Object.assign({map_fingerprint:bindings.react_lifecycle.map_fingerprint,
      occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]},record));}});

  var wrapperOrigins=new WeakMap();
  function wrapperObservation(entry,operation,extra) {
    var id=lifecycleId('wrapper_'+operation);
    return emit(Object.assign({schema:'producttrace.react-wrapper-observation.v1',kind:'react_wrapper',
      map_fingerprint:bindings.react_lifecycle.map_fingerprint,manifest_key:entry.key,
      source_call_id:entry.source_call_id,callback_source_id:entry.callback_source_id,operation:operation,
      observation_id:id,occurrence_id:id+':occurrence',evidence_ids:[id],runtime_observed:true},extra));
  }
  function lifecycleWrapperReturn(key,value) {
    var entry=lifecycleEntry(key,'wrapper_return');if(!entry || !started || disabled)return value;
    var field,marker;
    try {field=Object.getOwnPropertyDescriptor(value,entry.execution_rule.component_field);marker=Object.getOwnPropertyDescriptor(value,'$$typeof');}catch(_){}
    if(!field || typeof field.value!=='function' || !marker || marker.value!==Symbol.for(entry.execution_rule.marker)) {
      wrapperObservation(entry,'frontier',{reason:'wrapper_result_shape_unobserved'});return value;
    }
    var origin={wrapper:value,component:field.value,wrapper_id:lifecycleValueIdentity(value),component_identity_id:lifecycleValueIdentity(field.value),entry:entry};
    var record=wrapperObservation(entry,'created',{wrapper_id:origin.wrapper_id,component_identity_id:origin.component_identity_id});
    if(record){origin.observation_id=record.observation_id;var origins=wrapperOrigins.get(field.value)||[];origins.push(origin);wrapperOrigins.set(field.value,origins);}
    return value;
  }
  function lifecycleWrapperCallback(key,callback,args,run) {
    var execute=function(){return typeof run==='function'?run():undefined;};
    var entry=lifecycleEntry(key,'wrapper_callback');if(!entry || !started || disabled)return execute();
    var render=activeLifecycleRender(entry),origins=wrapperOrigins.get(callback)||[];
    if(!render){wrapperObservation(entry,'frontier',{reason:'wrapper_render_owner_unobserved'});return execute();}
    ensureLifecycleAttempt(render,entry,null);
    var values=[];
    for(var index=0;index<args.length;index++)values.push({value_id:lifecycleValueIdentity(args[index]),value:encodedLifecycleValue(args[index])});
    // Capture an entry-time Fiber when exposed. Production may supply only the
    // committed render later; label that snapshot instead of inventing dispatch.
    var entryFiber=render.fiber,entryRef=entry.execution_rule.render_ref;
    var refAtEntry=entryRef && entryFiber && entryFiber.tag===entryRef.fiber_tag
      ?{fiber:entryFiber,value:entryFiber[entryRef.field]}:null;
    var actualRef=entryRef?args[entryRef.argument]:undefined,argumentCount=args.length;
    var actualRefId=entryRef && values[entryRef.argument] && values[entryRef.argument].value_id;
    var invocationId=lifecycleId('wrapper_callback'),observedOrigin=null;
    var deliver=function(){
      var fiber=render.fiber,matches=[];
      for(var current=fiber,hops=0;current && hops++<200;current=current.return) {
        matches=origins.filter(function(origin){return origin.entry.source_call_id===entry.source_call_id && current.elementType===origin.wrapper;});
        if(matches.length)break;
      }
      if(matches.length!==1){wrapperObservation(entry,'frontier',{reason:'wrapper_render_origin_unobserved'});return;}
      var origin=matches[0],forwardedRef=null;
      if(entryRef) {
        var refFiber=refAtEntry?refAtEntry.fiber:current;
        var refValue=refAtEntry?refAtEntry.value:refFiber && refFiber[entryRef.field];
        var matched=!!refFiber && refFiber.tag===entryRef.fiber_tag && refFiber.elementType===origin.wrapper
          && argumentCount>entryRef.argument && Object.is(refValue,actualRef);
        forwardedRef={status:matched?'resolved':'unresolved',reason:matched?null:'forwarded_ref_renderer_input_unconfirmed',
          argument:entryRef.argument,field:entryRef.field,fiber_tag:refFiber && refFiber.tag,
          snapshot:refAtEntry?'body_entry':'committed_render',value_id:actualRefId || null,
          renderer_value_id:matched?actualRefId:lifecycleValueIdentity(refValue),identity_matched:matched};
      }
      observedOrigin=origin;
      lifecycleRecord('wrapper_callback_invoked',render,entry,{manifest_key:key,runtime_observed:true,
        wrapper_origin_observation_id:origin.observation_id,wrapper_id:origin.wrapper_id,component_identity_id:lifecycleValueIdentity(callback),
        callback_source_id:entry.callback_source_id,invocation_id:invocationId,arguments:values,
        renderer_wrapper_matched:true,forwarded_ref:forwardedRef});
    };
    var deferred=render.dispatcher_marker && render.status!=='committed';
    if(deferred)render.pending_records.push(deliver);else deliver();
    var completed=function(outcome,value){
      if(typeof run!=='function')return;
      var encoded=encodedLifecycleValue(value),valueId=lifecycleValueIdentity(value);
      var send=function(){if(!observedOrigin)return;
        lifecycleRecord('wrapper_callback_completed',render,entry,{manifest_key:key,runtime_observed:true,
          wrapper_origin_observation_id:observedOrigin.observation_id,wrapper_id:observedOrigin.wrapper_id,
          component_identity_id:observedOrigin.component_identity_id,callback_source_id:entry.callback_source_id,
          caused_by_invocation_id:invocationId,outcome:outcome,value_id:valueId,value:encoded});};
      if(deferred)render.pending_records.push(send);else send();
    };
    try{var result=execute();completed('returned',result);return result;}
    catch(error){completed('threw',error);throw error;}
  }

  function lifecycleDeferredInput(key,value) {
    var entry=lifecycleEntry(key,'deferred_result'),render=entry && started && !disabled?activeLifecycleRender(entry):null;
    if(render)(render.deferred_inputs || (render.deferred_inputs={}))[entry.source_call_id]={value:value,id:lifecycleValueIdentity(value)};
    return value;
  }

  function lifecycleDeferredResult(key,value) {
    var entry=lifecycleEntry(key,'deferred_result'),render=entry && started && !disabled?activeLifecycleRender(entry):null;
    var input=render && render.deferred_inputs && render.deferred_inputs[entry.source_call_id];if(!input)return value;
    var slot=lifecycleHookSlot(render,entry);ensureLifecycleAttempt(render,entry,slot);
    var previous=render.previous_committed && render.previous_committed.deferred_results && render.previous_committed.deferred_results[entry.source_call_id];
    var fromInput=Object.is(input.value,value),fromPrevious=!!previous && Object.is(previous.value,value);
    var result={observation_id:lifecycleId('deferred_selected'),value:value,id:fromPrevious?previous.id:fromInput?input.id:lifecycleValueIdentity(value)};
    (render.deferred_results || (render.deferred_results={}))[entry.source_call_id]=result;
    var deliver=function(){lifecycleRecord('deferred_selected',render,entry,{hook_slot_id:slot,observation_id:result.observation_id,
      occurrence_id:result.observation_id+':occurrence',evidence_ids:[result.observation_id],value_id:result.id,value:encodedLifecycleValue(value),
      input_value_id:fromInput?result.id:input.id,input_value:encodedLifecycleValue(input.value),matches_input:fromInput,matches_previous:fromPrevious,
      previous_observation_id:previous && previous.observation_id});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();return value;
  }

  function lifecycleDeferredUse(key,value) {
    var entry=lifecycleEntry(key,'deferred_use'),render=entry && started && !disabled?activeLifecycleRender(entry):null;
    var origin=render && render.deferred_results && render.deferred_results[entry.source_call_id];if(!origin)return value;
    var deliver=function(){lifecycleRecord('deferred_used',render,entry,{hook_slot_id:lifecycleHookSlot(render,entry),
      read_source_id:entry.read_source_id,origin_observation_id:origin.observation_id,value_id:origin.id,
      value:encodedLifecycleValue(value),matches_selected:Object.is(value,origin.value)});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();return value;
  }

  function lifecycleTransitionResult(key,value) {
    var entry=lifecycleEntry(key,'transition_result');if(!entry || !started || disabled || !Array.isArray(value))return value;
    var rule=entry.execution_rule;
    var pending=Object.getOwnPropertyDescriptor(value,String(rule.pending_index)),start=Object.getOwnPropertyDescriptor(value,String(rule.start_index));
    if(!pending || typeof pending.value!=='boolean' || !start || typeof start.value!=='function')return value;
    var render=activeLifecycleRender(entry);if(!render)return value;
    var slot=lifecycleHookSlot(render,entry);ensureLifecycleAttempt(render,entry,slot);
    var origin={observation_id:lifecycleId('transition_result'),source_call_id:entry.source_call_id,
      start_identity_id:lifecycleValueIdentity(start.value),session:sessionId};
    transitionStarts.set(start.value,origin);
    (render.transition_results || (render.transition_results={}))[entry.source_call_id]={origin:origin,pending:pending.value};
    var deliver=function(){lifecycleRecord('transition_result',render,entry,{hook_slot_id:slot,
      observation_id:origin.observation_id,occurrence_id:origin.observation_id+':occurrence',evidence_ids:[origin.observation_id],
      start_identity_id:origin.start_identity_id,transition_pending:pending.value});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();
    return value;
  }

  function lifecycleTransitionPendingUse(key,value) {
    var entry=lifecycleEntry(key,'transition_pending_use'),render=entry && started && !disabled?activeLifecycleRender(entry):null;
    var selected=render && render.transition_results && render.transition_results[entry.source_call_id];if(!selected)return value;
    var deliver=function(){lifecycleRecord('transition_pending_used',render,entry,{hook_slot_id:lifecycleHookSlot(render,entry),
      origin_observation_id:selected.origin.observation_id,transition_pending:value,transition_pending_matches:Object.is(value,selected.pending),
      read_source_id:entry.read_source_id});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();return value;
  }

  function lifecycleIdResult(key,value) {
    var entry=lifecycleEntry(key,'id_result');if(!entry || !started || disabled)return value;
    var render=activeLifecycleRender(entry);if(!render)return value;
    var slot=lifecycleHookSlot(render,entry);ensureLifecycleAttempt(render,entry,slot);
    var origin={observation_id:lifecycleId('id_read'),value:value};
    (render.id_results || (render.id_results={}))[entry.source_call_id]=origin;
    var deliver=function(){lifecycleRecord('id_read',render,entry,{hook_slot_id:slot,
      observation_id:origin.observation_id,occurrence_id:origin.observation_id+':occurrence',
      evidence_ids:[origin.observation_id],id_value:encodedLifecycleValue(value)});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();
    return value;
  }

  function lifecycleIdUse(key,value) {
    var entry=lifecycleEntry(key,'id_use');if(!entry || !started || disabled)return value;
    var render=activeLifecycleRender(entry),origin=render && render.id_results && render.id_results[entry.source_call_id];
    if(!render)return value;
    var usage={observation_id:lifecycleId('id_used'),value:value};
    (render.id_uses || (render.id_uses={}))[key]=usage;
    var deliver=function(){lifecycleRecord('id_used',render,entry,{hook_slot_id:lifecycleHookSlot(render,entry),
      observation_id:usage.observation_id,occurrence_id:usage.observation_id+':occurrence',evidence_ids:[usage.observation_id],
      id_read_source_id:entry.id_read_source_id,id_property:entry.id_property,
      id_read_observation_id:origin && origin.observation_id,id_value:encodedLifecycleValue(value),id_value_matches:!!origin && Object.is(origin.value,value)});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(deliver);else deliver();
    return value;
  }
  function lifecycleIdElement(keys,value){
    if(!started || disabled)return value;
    keys.forEach(function(key){
      var entry=lifecycleEntry(key,'id_use'),render=entry && activeLifecycleRender(entry);
      var use=render && render.id_uses && render.id_uses[key];
      if(use){delete render.id_uses[key];idCommitObserver.element(entry,value,use,render);}
    });
    return value;
  }

  function lifecycleApiResult(key, value) {
    return lifecycleApiObservation(key, value, 'api_call', 'invoked');
  }

  function lifecycleApiValue(key, value) {
    return lifecycleApiObservation(key, value, 'api_value', 'read');
  }

  function lifecycleRecord(operation, render, entry, extra) {
    if (!started || disabled || !render || !entry) return null;
    var observationId = lifecycleId(operation);
    var record = {
      schema: 'producttrace.react-lifecycle-observation.v1',
      kind: 'react_lifecycle',
      map_fingerprint: bindings.react_lifecycle.map_fingerprint,
      observation_id: observationId,
      occurrence_id: observationId + ':occurrence',
      operation: operation,
      source_call_id: entry.source_call_id,
      semantic_id: entry.semantic_id,
      owner_source_id: entry.owner_source_id,
      root_id: render.identity.root_id,
      instance_id: render.identity.instance_id,
      mount_id: render.identity.mount_id,
      render_id: render.render_id,
      evidence_ids: [observationId],
    };
    if(['render_attempted','render_committed','render_abandoned'].indexOf(operation)!==-1&&render.strict_replay_id)record.strict_replay_id=render.strict_replay_id;
    if(['render_attempted','render_committed','render_abandoned'].indexOf(operation)!==-1&&render.position_id)record.render_position_id=render.position_id;
    if(['render_attempted','render_committed','render_abandoned'].indexOf(operation)!==-1&&render.suspense_boundary){
      if(render.suspense_boundary.frontier)record.suspense_boundary={status:'unresolved',reason:render.suspense_boundary.frontier};
      else {
        var replacementBoundary=render.replacement_suspense_boundary;
        var replacementPrior=replacementBoundary
          &&replacementBoundary.origin_observation_id===render.suspense_boundary.origin_observation_id
          ?replacementBoundary.previous_commit:null;
        // A replacement begins while the prior commit is still observable. Keep
        // that exact receipt because the renderer may advance its root commit
        // marker before it revisits this component during commit traversal.
        var boundaryCommit=boundaryCommitObserver.currentOriginCommit(render.suspense_boundary.origin_observation_id)
          ||replacementPrior;
        var retainedBoundaryCommit=!boundaryCommit&&(render.suspense_boundary.previous_commit
          ||boundaryCommitObserver.currentCommit(render.suspense_boundary.fiber));
        var boundaryRenderer=boundaryCommit?boundaryCommit.renderer
          :retainedBoundaryCommit?retainedBoundaryCommit.renderer:render.suspense_boundary.renderer;
        if(boundaryRenderer&&record.root_id==='react-root:dispatcher-pending')record.root_id=boundaryRenderer.root_id;
        record.suspense_boundary={status:'source_resolved',
          origin_observation_id:render.suspense_boundary.origin_observation_id,
          manifest_key:render.suspense_boundary.manifest_key,
          source_call_id:render.suspense_boundary.source_call_id,
          semantic_id:render.suspense_boundary.semantic_id,
          input_identity:render.suspense_boundary.input_identity,
          renderer:boundaryRenderer,
          commit_observation_id:boundaryCommit&&boundaryCommit.origin_observation_id===render.suspense_boundary.origin_observation_id
            ?boundaryCommit.observation_id:null,
          selection:boundaryCommit&&boundaryCommit.origin_observation_id===render.suspense_boundary.origin_observation_id
            ?boundaryCommit.selection.selection:null,
          retained_commit_observation_id:retainedBoundaryCommit&&retainedBoundaryCommit.origin_observation_id!==render.suspense_boundary.origin_observation_id
            ?retainedBoundaryCommit.observation_id:null,
          retained_origin_observation_id:retainedBoundaryCommit&&retainedBoundaryCommit.origin_observation_id!==render.suspense_boundary.origin_observation_id
            ?retainedBoundaryCommit.origin_observation_id:null,
          retained_selection:retainedBoundaryCommit&&retainedBoundaryCommit.origin_observation_id!==render.suspense_boundary.origin_observation_id
            ?retainedBoundaryCommit.selection.selection:null};
      }
    }
    if (entry.hook_owned && extra && extra.hook_slot_id) record.hook_slot_id = extra.hook_slot_id;
    if (entry.protocol_member) {
      record.protocol_member = entry.protocol_member;
      record.source_member_call_id = entry.source_member_call_id;
    }
    if (extra) for (var key in extra) if (extra[key] !== undefined && key !== 'hook_slot_id') record[key] = extra[key];
    if(operation==='cleanup_invoked'){var rootOperation=rootObserver.rootCleanup(observationId,render.identity,entry.source_call_id);if(rootOperation)record.root_operation_id=rootOperation;}
    return emit(record);
  }

  function abandonLifecycleRender(render, replacementRenderId, replacementBoundary) {
    if (!render || render.status !== 'attempted' || !render.anchor_entry) return;
    if (!render.attempt_record_emitted) {
      lifecycleRecord('render_attempted', render, render.anchor_entry,
        { hook_slot_id: render.anchor_hook_slot_id,
          replaces_render_ids: render.replaced_render_ids && render.replaced_render_ids.length
            ? render.replaced_render_ids.slice() : undefined });
      render.attempt_record_emitted = true;
    }
    render.replacement_suspense_boundary=replacementBoundary||null;
    lifecycleRecord('render_abandoned', render, render.anchor_entry,
      { hook_slot_id: render.anchor_hook_slot_id,
        replacement_render_id: replacementRenderId || null,
        abandonment_cause: replacementRenderId ? 'superseded_by_render_attempt' : 'renderer_abandoned' });
    render.status = 'abandoned';
    for (var i = 0; i < render.callback_states.length; i++) {
      if (render.callback_states[i].pending_render === render) render.callback_states[i].pending_render = null;
    }
    render.pending_records.length = 0;
    if (render.position_key && lifecycleRenderPositions[render.position_key] === render) {
      delete lifecycleRenderPositions[render.position_key];
    }
  }

  function beginLifecycleRender(entry) {
    var fiber = currentReactFiber();
    var identity = ensureFiberIdentity(fiber);
    if (!fiber || !identity) return null;
    var suspenseBoundary=boundaryCommitObserver.renderBoundary(fiber);
    var positionKey = fiberRenderPosition(fiber, entry);
    var positionId=positionKey&&(lifecycleRenderPositionIds[positionKey]
      ||(lifecycleRenderPositionIds[positionKey]=lifecycleId('render_position')));
    var renderId = 'react-render:' + (++lifecycleRenderCount);
    var replacedRenders = [];
    var previous = getFiberRender(fiber);
    if (previous && previous.status === 'attempted') {replacedRenders.push(previous.render_id);abandonLifecycleRender(previous,renderId,suspenseBoundary);}
    var displaced = positionKey && lifecycleRenderPositions[positionKey];
    if (displaced && displaced !== previous && displaced.status === 'attempted') {
      replacedRenders.push(displaced.render_id);abandonLifecycleRender(displaced,renderId,suspenseBoundary);
    }
    var anchorHookSlot = entry && entry.hook_owned
      ? 'react-source-hook:' + (entry.hook_source_call_id || entry.source_call_id) + ':1' : null;
    var render = {
      fiber: fiber,
      strict_replay_id:strictReplayObserver.current(fiber),
      identity: identity,
      render_id: renderId,
      status: 'preparing',
      anchor_entry: entry || null,
      anchor_hook_slot_id: anchorHookSlot,
      hook_counts: anchorHookSlot ? { [entry.hook_source_call_id || entry.source_call_id]: 1 } : {},
      hook_slots: anchorHookSlot ? { [entry.hook_source_call_id || entry.source_call_id]: anchorHookSlot } : {},
      pending_records: [],
      callback_states: [],
      position_key: positionKey,
      position_id: positionId,
      previous_committed: lifecycleCommittedRenders.get(fiber)
        || (fiber.alternate && lifecycleCommittedRenders.get(fiber.alternate)) || null,
      memo_productions: {}, memo_selections: {},
      replaced_render_ids: replacedRenders,
      suspense_boundary: suspenseBoundary,
    };
    setFiberRender(fiber, render);
    if (positionKey) lifecycleRenderPositions[positionKey] = render;
    return render;
  }

  function beginDispatcherLifecycleRender(entry, sourceBoundary) {
    var dispatcher = currentReactDispatcher();
    if (!dispatcher || typeof dispatcher.useRef !== 'function'
        || typeof dispatcher.useInsertionEffect !== 'function') return null;
    var dispatcherRef=lifecycleSelectedDispatcherRef;
    var markerRef;
    try {
      markerRef = dispatcher.useRef(null);
    } catch (_) {
      return null;
    }
    if (!markerRef || typeof markerRef !== 'object') return null;
    var marker = markerRef.current;
    if (!marker || marker.__producttrace_lifecycle_marker__ !== true) {
      var fallbackInstance = ++lifecycleFallbackInstanceCount;
      marker = {
        __producttrace_lifecycle_marker__: true,
        instance_id: 'react-instance:dispatcher:' + fallbackInstance,
        mount_id: 'react-mount:dispatcher:' + fallbackInstance,
        pending_render: null,
        committed_render: null,
        position_id:lifecycleId('render_position'),
      };
      markerRef.current = marker;
    }
    lifecycleDispatcherMarkers.set(markerRef,marker);
    var renderId='react-render:'+(++lifecycleRenderCount),replacedRenders=[];
    var boundaryPositionKey=sourceBoundary&&!sourceBoundary.frontier
      ?'react-dispatcher-boundary\0'+entry.owner_source_id+'\0'+sourceBoundary.input_identity:null;
    var boundaryPositionId=boundaryPositionKey&&(lifecycleRenderPositionIds[boundaryPositionKey]
      ||(lifecycleRenderPositionIds[boundaryPositionKey]=lifecycleId('render_position')));
    var positionId=marker.committed_render?marker.position_id:boundaryPositionId||marker.position_id;
    var positionKey='react-dispatcher-position\0'+entry.owner_source_id+'\0'+positionId;
    if (marker.pending_render && marker.pending_render.status === 'attempted') {
      replacedRenders.push(marker.pending_render.render_id);abandonLifecycleRender(marker.pending_render,renderId,sourceBoundary);
    }
    var displaced=positionKey&&lifecycleRenderPositions[positionKey];
    if(displaced&&displaced!==marker.pending_render&&displaced.status==='attempted'){
      replacedRenders.push(displaced.render_id);abandonLifecycleRender(displaced,renderId,sourceBoundary);
    }
    var anchorHookSlot = entry && entry.hook_owned
      ? 'react-source-hook:' + (entry.hook_source_call_id || entry.source_call_id) + ':1' : null;
    var render = {
      fiber: null,
      identity: marker.last_identity || {
        root_id: 'react-root:dispatcher-pending',
        instance_id: marker.instance_id,
        mount_id: marker.mount_id,
        commit_id: null,
        render_id: null,
        render_observed: true,
        runtime_observed: true,
        basis: 'react-dispatcher-hook.v1',
      },
      render_id: renderId,
      status: 'preparing',
      anchor_entry: entry || null,
      anchor_hook_slot_id: anchorHookSlot,
      hook_counts: anchorHookSlot ? { [entry.hook_source_call_id || entry.source_call_id]: 1 } : {},
      hook_slots: anchorHookSlot ? { [entry.hook_source_call_id || entry.source_call_id]: anchorHookSlot } : {},
      pending_records: [],
      callback_states: [],
      position_key: positionKey,
      position_id: positionId||marker.position_id,
      previous_committed: marker.committed_render && marker.committed_render.status === 'committed'
        ? marker.committed_render : null,
      memo_productions: {}, memo_selections: {},
      dispatcher_marker: marker,
      attempt_record_emitted: false,
      replaced_render_ids: replacedRenders,
      suspense_boundary: sourceBoundary,
    };
    marker.pending_render = render;
    if(positionKey)lifecycleRenderPositions[positionKey]=render;
    lifecycleFallbackCurrentRender = render;
    if(replacedRenders.length){
      // Entering the compiler-stamped component is itself an observed render
      // attempt. Emit a superseding attempt now even if React never reaches a
      // later instrumented hook or exposes the component Fiber in this commit.
      render.status='attempted';
      lifecycleRecord('render_attempted',render,entry,{hook_slot_id:anchorHookSlot,
        replaces_render_ids:replacedRenders.slice()});
      render.attempt_record_emitted=true;
    }
    try {
      dispatcher.useInsertionEffect(function () {
        marker.committed_render = render;
      });
    } catch (_) {
      marker.pending_render = null;
      lifecycleFallbackCurrentRender = null;
      return null;
    }
    if(entry && entry.key)lifecycleDispatcherOwners[entry.key]=dispatcherRef;
    return render;
  }

  function activeLifecycleRender(entry) {
    var fiber = currentReactFiber();
    if (!fiber && lifecycleFallbackCurrentRender
        && lifecycleFallbackCurrentRender.status !== 'committed'
        && lifecycleFallbackCurrentRender.status !== 'abandoned') {
      return lifecycleFallbackCurrentRender;
    }
    var render = getFiberRender(fiber);
    if (!render || render.status === 'committed' || render.status === 'abandoned') {
      render = beginLifecycleRender(entry);
    }
    return render;
  }

  function lifecycleHookSlot(render, entry) {
    if (!entry.hook_owned) return null;
    var source = entry.hook_source_call_id || entry.source_call_id;
    if (render.hook_slots[source]) return render.hook_slots[source];
    var ordinal = (render.hook_counts[source] || 0) + 1;
    render.hook_counts[source] = ordinal;
    var slot = 'react-source-hook:' + source + ':' + ordinal;
    render.hook_slots[source] = slot;
    return slot;
  }

  function ensureLifecycleAttempt(render, entry, hookSlotId) {
    if (!render || render.status !== 'preparing') return;
    render.status = 'attempted';
    render.anchor_entry = entry;
    render.anchor_hook_slot_id = hookSlotId;
    if (!render.dispatcher_marker) {
      lifecycleRecord('render_attempted', render, entry, { hook_slot_id: hookSlotId,
        replaces_render_ids: render.replaced_render_ids && render.replaced_render_ids.length
          ? render.replaced_render_ids.slice() : undefined });
      render.attempt_record_emitted = true;
    }
  }

  function lifecycleEntry(key, expected) {
    var entry = lifecycleEntries[key];
    return entry && (!expected || entry.kind === expected) ? entry : null;
  }

  function lifecycleComponent(key, props) {
    var entry = lifecycleEntry(key, 'component_render');
    if (!started || disabled) {
      // Production components already acquired two private hook slots. Removing
      // them on stop would shift the application's hooks and corrupt its state.
      var ref=lifecycleDispatcherOwners[key],dispatcher=ref && ref.current;
      var stoppedRenderer=lifecycleFiberOwners[key];
      if(stoppedRenderer)try{lifecycleFallbackCurrentRender=getFiberRender(stoppedRenderer.getCurrentFiber());}catch(_){lifecycleFallbackCurrentRender=null;}
      if(dispatcher){
        var stoppedMarker=dispatcher.useRef(null);
        var stoppedOwner=stoppedMarker && lifecycleDispatcherMarkers.get(stoppedMarker);
        lifecycleFallbackCurrentRender=stoppedOwner && stoppedOwner.committed_render || null;
        dispatcher.useInsertionEffect(function(){});
      }
      return;
    }
    if (!entry) return;
    if (!beginLifecycleRender(entry)) beginDispatcherLifecycleRender(entry,boundaryCommitObserver.renderBoundaryFromProps(props));
    else if(lifecycleSelectedFiberRenderer)lifecycleFiberOwners[key]=lifecycleSelectedFiberRenderer;
  }

  function callbackCache(original) {
    var cache = lifecycleCallbackStates && lifecycleCallbackStates.get(original);
    if (!cache && lifecycleCallbackStates) {
      cache = {};
      lifecycleCallbackStates.set(original, cache);
    }
    return cache;
  }

  function lifecycleTagCallback(key, callback) {
    var entry = lifecycleEntry(key, 'callback_tag');
    if (!entry || typeof callback !== 'function' || !started || disabled) return callback;
    var render = activeLifecycleRender(entry);
    if (!render) return callback;
    var hookSlotId = lifecycleHookSlot(render, entry);
    ensureLifecycleAttempt(render, entry, hookSlotId);
    var cache = callbackCache(callback);
    if (cache) cache.__producttrace_source = { entry: entry, render: render, hook_slot_id: hookSlotId };
    return callback;
  }

  // The observer closes over the render that created this function. Looking at
  // the latest Fiber here would silently assign stale closures to newer props.
  // The factory returns the original instrumented function, preserving React's
  // input/output identity contract and normal this/arguments/throw behavior.
  function lifecycleDefineCallback(key, factory, inferredName) {
    var entry = lifecycleEntry(key, 'retained_callback');
    var render = entry && started && !disabled ? activeLifecycleRender(entry) : null;
    var hookSlotId = render ? lifecycleHookSlot(render, entry) : null;
    if (render) ensureLifecycleAttempt(render, entry, hookSlotId);
    var callbackId = lifecycleId('callback_identity');
    var base = { hook_slot_id: hookSlotId, callback_identity_id: callbackId,
      callback_slot: entry && entry.callback_slot, callback_source_id: entry && entry.callback_source_id };
    function observe(operation, extra) {
      var record = function () { lifecycleRecord(operation, render, entry,
        Object.assign({}, base, typeof extra === 'function' ? extra() : extra)); };
      if (!render || !started || disabled) return;
      if (['committed','abandoned','unmounted'].indexOf(render.status) !== -1
          || render.status === 'attempted' && !render.dispatcher_marker
          || ['callback_invoked','context_value_used'].indexOf(operation) !== -1 && render.dispatcher_marker
            && render !== lifecycleFallbackCurrentRender) record();
      else if (render.status === 'attempted' || render.status === 'preparing') render.pending_records.push(record);
    }
    observe('callback_created');
    var invocationObserver = function (captureReaders) {
      if (!render || !started || disabled) return;
      var captured = (captureReaders || []).map(function (capture) {
        var encoded;
        try { encoded = encodedLifecycleValue(capture[1]()); }
        catch (_) { encoded = { encoding: 'redacted', value: null }; }
        return Object.assign({ binding_id: capture[0] }, encoded);
      });
      var extra = { hook_slot_id: hookSlotId,
        callback_slot: entry.callback_slot, callback_source_id: entry.callback_source_id,
        invocation_id: sessionId + ':react:invocation:' + (++lifecycleInvocationCount),
        captured_values: captured };
      observe('callback_invoked', extra);
    };
    invocationObserver.contextValue = function (readId, value) {
      if (!render || !started || disabled) return value;
      var source = (entry.context_reads || []).find(function (read) { return read.read_id === readId; });
      if (!source) return value;
      var origin = render.context_reads && render.context_reads[source.binding_id];
      // Compare at the actual expression evaluation. A pending production render
      // can deliver its earlier read before this dependent use when adopted.
      var matches = !!origin && Object.is(origin.value, value);
      observe('context_value_used', function () {
        var proof = origin && origin.record && origin.record.context_value_proof;
        return {context_use:{read_id:readId,binding_id:source.binding_id,source_call_id:source.source_call_id,
          read_observation_id:origin && origin.record && origin.record.observation_id,
          value_identity:proof && proof.observed_value.identity,value_matches:matches}};
      });
      return value;
    };
    var callback = factory(invocationObserver);
    if (inferredName && !callback.name) {
      Object.defineProperty(callback, 'name', { value: inferredName, configurable: true });
    }
    var cache = callbackCache(callback);
    if (cache && render) cache.__producttrace_retained = { callback_id: callbackId, render: render, entry: entry, hook_slot_id:hookSlotId };
    return callback;
  }

  function lifecycleRetainedResult(key, callback) {
    var entry = lifecycleEntry(key, 'retained_result');
    var render = entry && started && !disabled ? activeLifecycleRender(entry) : null;
    var cache = typeof callback === 'function' && callbackCache(callback);
    var retained = cache && cache.__producttrace_retained;
    if (!render || !retained) return callback;
    var extra = { hook_slot_id: lifecycleHookSlot(render, entry), callback_slot: entry.callback_slot,
      callback_source_id: entry.callback_source_id, callback_identity_id: retained.callback_id,
      origin_render_id: retained.render.render_id };
    var record = function () { lifecycleRecord('callback_selected', render, entry, extra); };
    if (render.dispatcher_marker && render.status !== 'committed') render.pending_records.push(record);
    else record();
    return callback;
  }

  // A shared function can be selected by many hooks. Keep each selection under
  // its render and source hook instead of attaching a last-writer owner to it.
  function lifecycleSharedRetainedResult(key, callback) {
    var entry=lifecycleEntry(key,'shared_retained_result');
    var render=entry && started && !disabled ? activeLifecycleRender(entry) : null;
    if(!render || typeof callback!=='function')return callback;
    var hook=lifecycleHookSlot(render,entry);ensureLifecycleAttempt(render,entry,hook);
    var cache=callbackCache(callback),selections=cache.__producttrace_shared || [];
    // Old selections are only useful while their owner remains committed.
    selections=selections.filter(function(row){return ['committed','attempted','preparing'].indexOf(row.render.status)!==-1;});
    var selected={entry:entry,render:render,record:null};selections.push(selected);cache.__producttrace_shared=selections;
    var owned=render.shared_retained_selections || [];owned.push({cache:cache,selection:selected});render.shared_retained_selections=owned;
    var observe=function(){selected.record=lifecycleRecord('shared_callback_selected',render,entry,{
      hook_slot_id:hook,callback_slot:entry.callback_slot,callback_source_id:entry.callback_source_id,
      callback_identity_id:lifecycleValueIdentity(callback),runtime_observed:true});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(observe);else observe();
    return callback;
  }

  function lifecycleSharedRetainedDefine(key, factory, inferredName) {
    var callback=factory(function(captures){lifecycleSharedRetainedBody(key,callback,null,captures);});
    if(inferredName && !callback.name)Object.defineProperty(callback,'name',{value:inferredName,configurable:true});
    return callback;
  }

  // This probe is inserted in the original named function. It observes entry,
  // not completion, and never substitutes a new function for React to retain.
  function lifecycleSharedRetainedBody(key, callback, args, captureReaders) {
    var entry=lifecycleEntry(key,'shared_retained_body');
    if(!entry || !started || disabled)return;
    var identity=lifecycleValueIdentity(callback),action=activeRefAction,owner=action && action.retained_owner;
    var cache=callbackCache(callback),selections=cache && cache.__producttrace_shared || [];
    var matches=selections.filter(function(row){var r=row.render;return action && owner && row.record
      && r.status==='committed' && action.callee_identity_id===identity
      && action.retained_producer_call_ids.indexOf(row.entry.source_call_id)!==-1
      && row.entry.callback_source_id===entry.callback_source_id
      && ['root_id','instance_id','mount_id'].every(function(field){return r.identity[field]===owner[field];})
      && r.render_id===owner.render_id;});
    var selected=matches.length===1?matches[0]:null,id=lifecycleId('shared_callback_body');
    emit({schema:'producttrace.react-shared-callback.v1',kind:'react_shared_callback',manifest_key:key,
      map_fingerprint:bindings.react_lifecycle.map_fingerprint,observation_id:id,occurrence_id:id+':occurrence',evidence_ids:[id],
      runtime_observed:true,callback_source_id:entry.callback_source_id,callback_identity_id:identity,
      selection_observation_id:selected && selected.record.observation_id || null,
      action:action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null,
      reason:selected?null:matches.length>1?'shared_callback_owner_ambiguous':'shared_callback_owner_unobserved',
      arguments_observed:args!==null,
      arguments:args===null?null:Array.prototype.map.call(args,function(value){return {value_id:lifecycleValueIdentity(value),value:encodedLifecycleValue(value)};}),
      captured_values:readLifecycleCaptures(function(){return captureReaders;})});
  }

  function lifecycleTagSource(sourceId, callback, captureReaders, inferredName) {
    if (typeof callback !== 'function' || typeof sourceId !== 'string') return callback;
    scopeObserver.tagSource(sourceId,callback,captureReaders,inferredName);
    if(inferredName && !callback.name)Object.defineProperty(callback,'name',{value:inferredName,configurable:true});
    var cache = callbackCache(callback);
    if (cache) {
      var sources = cache.__producttrace_sources || {};
      sources[sourceId] = true;
      cache.__producttrace_sources = sources;
      if (typeof captureReaders === 'function') {
        var readers = cache.__producttrace_source_readers || {};
        readers[sourceId] = captureReaders;
        cache.__producttrace_source_readers = readers;
      }
    }
    return callback;
  }

  function lifecycleEventCallback(key, callback) {
    var entry = lifecycleEntry(key, 'event_callback');
    if (!entry || typeof callback !== 'function' || !started || disabled) return callback;
    var cache = callbackCache(callback);
    var state = cache && cache[key];
    if (!state) {
      state = { original: callback, wrapper: null };
      state.wrapper = function () {
        if(!started || disabled)return state.original.apply(this,arguments);
        var options = entry.scenario_options || [];
        var sourceTags = callbackCache(state.original);
        sourceTags = sourceTags && sourceTags.__producttrace_sources || {};
        var matches = options.filter(function (option) { return sourceTags[option.handler_source_id] === true; });
        if (options.length === 1 && matches.length === 0) matches = [options[0]];
        var selected = matches.length === 1 ? matches[0] : null;
        var stamp = Number.isInteger(window[ACTION_STAMP_GLOBAL]) ? window[ACTION_STAMP_GLOBAL] : null;
        var actionRecord = stamp == null ? null : actionRecordsByStamp[stamp];
        var fiber = currentReactFiber();
        var identity = fiberRuntimeIdentity(fiber) || actionRecord && actionRecord.react_identity || null;
        var memoObservation = null;
        var memoReason = null;
        var expectedProducers = selected && selected.memo_producer_call_ids || [];
        if (expectedProducers.length) {
          var originalCache = callbackCache(state.original);
          var origins = (originalCache && originalCache.__producttrace_memo || []).filter(function (origin) {
            return expectedProducers.indexOf(origin.entry.source_call_id) !== -1
              && origin.source_id === selected.handler_source_id;
          });
          if (origins.length === 1 && actionRecord) {
            var origin = origins[0];
            var readers = originalCache.__producttrace_source_readers || {};
            memoObservation = lifecycleRecord('memo_callback_invoked', origin.render, origin.entry, {
              hook_slot_id:origin.hook_slot_id, production_id:origin.production_id,
              value_id:origin.value_id, callback_value_id:origin.callback_value_id,
              callback_source_id:origin.source_id, callback_result_path:origin.path,
              invocation_id:sessionId + ':react:invocation:' + (++lifecycleInvocationCount),
              action_occurrence_id:actionRecord.session + ':action:' + actionRecord.seq,
              captured_values:readLifecycleCaptures(readers[origin.source_id]),
            });
          } else memoReason = origins.length > 1 ? 'memo_callback_origin_ambiguous'
            : !actionRecord ? 'callback_action_occurrence_required' : 'memo_callback_origin_unobserved';
        }
        var observationId = lifecycleId('event_callback');
        var observation = {
          schema: 'producttrace.react-callback-observation.v1',
          kind: 'react_callback',
          map_fingerprint: bindings.react_lifecycle.map_fingerprint,
          observation_id: observationId,
          occurrence_id: observationId + ':occurrence',
          evidence_ids: [observationId],
          control_id: entry.control_id,
          binding_id: entry.binding_id,
          event: entry.event,
          action_occurrence_id: actionRecord
            ? actionRecord.session + ':action:' + actionRecord.seq : null,
          candidate_source_ids: options.map(function (option) { return option.handler_source_id; }),
          selected_source_id: selected ? selected.handler_source_id : null,
          selected_scenario_id: selected ? selected.scenario_id : null,
          callee_identity_id:lifecycleValueIdentity(state.original),
          memo_observation_id:memoObservation && memoObservation.observation_id || null,
          status: selected && !memoReason ? 'resolved' : 'unresolved',
          reason: memoReason || (selected ? null : matches.length > 1
            ? 'runtime_callback_source_ambiguous' : 'runtime_callback_source_unidentified'),
          runtime_observed: true,
          react_identity: identity,
        };
        if (actionRecord) actionRecord.react_callback = {
          observation_id: observationId,
          control_id: entry.control_id,
          selected_source_id: observation.selected_source_id,
          selected_scenario_id: observation.selected_scenario_id,
          status: observation.status,
        };
        emit(observation);
        // A live source callback and its exact native event are stronger than
        // the temporary global action stamp, which can outlive event dispatch.
        // React development may dispatch its own guarded-callback event. The
        // original captured DOM event remains active beneath that nested call.
        // Its native eventPhase becomes NONE when dispatch ends, unlike a timer
        // stamp. Never inspect a user-supplied callback argument to find it.
        var nativeStamp=null;
        if(activeNativeActionEvent && activeNativeActionEvent.eventPhase!==0)nativeStamp=actionEventStamps.get(activeNativeActionEvent);
        var previousRefAction=activeRefAction;
        if(nativeStamp!=null && actionRecordsByStamp[nativeStamp]===actionRecord && observation.status==='resolved')activeRefAction={
          action_occurrence_id:observation.action_occurrence_id,callback_observation_id:observationId,
          scenario_id:observation.selected_scenario_id,control_id:entry.control_id,
          callee_identity_id:observation.callee_identity_id,retained_owner:actionRecord.react_lifecycle_identity,
          retained_producer_call_ids:selected && selected.retained_producer_call_ids || []};
        try{return state.original.apply(this, arguments);}finally{activeRefAction=previousRefAction;}
      };
      if (cache) cache[key] = state;
    }
    return state.wrapper;
  }

  function readLifecycleCaptures(readers) {
    if (typeof readers !== 'function') return [];
    return readers().map(function (capture) {
      var encoded;
      try { encoded = encodedLifecycleValue(capture[1]()); }
      catch (_) { encoded = { encoding:'redacted', value:null }; }
      return Object.assign({binding_id:capture[0]}, encoded);
    });
  }

  function lifecycleContextValue(key, readId, value) {
    var active=lifecycleActiveCallbackInvocation,entry=lifecycleEntries[key];
    if (!started || disabled || !active || active.entry!==entry) return value;
    var site=(entry.context_reads || []).find(function (read) {return read.read_id===readId;});
    if (!site) return value;
    var render=active.render,origin=render.context_reads && render.context_reads[site.binding_id];
    var matches=!!origin && Object.is(origin.value,value);
    var deliver=function () {
      var proof=origin && origin.record && origin.record.context_value_proof;
      lifecycleRecord('context_value_used',render,entry,{hook_slot_id:active.hook_slot_id,
        callback_slot:entry.callback_slot,callback_source_id:entry.callback_source_id,
        caused_by_invocation_id:active.invocation_id,
        context_use:{read_id:readId,binding_id:site.binding_id,source_call_id:site.source_call_id,
          read_observation_id:origin && origin.record && origin.record.observation_id,
          value_identity:proof && proof.observed_value.identity,value_matches:matches}});
    };
    if (active.deferred && render.status!=='committed') render.pending_records.push(deliver);
    else deliver();
    return value;
  }

  function lifecycleReducerPassthrough(callback) {
    var cache=callbackCache(callback);
    if(!cache.__producttrace_reducer_passthrough)cache.__producttrace_reducer_passthrough=function(){
      var args=arguments,request=args[1] && typeof args[1]==='object'?lifecycleStateActions.get(args[1]):null;
      if(request)args=[args[0],request.action];
      return callback.apply(this,args);
    };
    return cache.__producttrace_reducer_passthrough;
  }

  function lifecycleCallbackCacheKey(key,render) {
    // Committing a production render replaces its provisional root ID, while
    // the dispatcher marker remains the same component lifetime.
    return key + '\u0000' + (render.dispatcher_marker
      ? 'dispatcher:' + render.dispatcher_marker.mount_id
      : render.identity.root_id + '\u0000' + render.identity.mount_id);
  }

  function lifecycleDynamicMemo(key,callback){
    var entry=lifecycleEntry(key,'dynamic_memo');
    if(!entry||!started||disabled)return callback;
    var origin=scopeObserver.describeSource(callback,entry.memo_callback_candidates);
    var targets=origin?(entry.memo_callback_keys||[]).filter(function(candidate){return lifecycleEntries[candidate].callback_source_id===origin.source_id;}):[];
    if(targets.length!==1){
      var render=activeLifecycleRender(entry);
      if(render){var gaps=render.memo_source_frontiers||(render.memo_source_frontiers={});gaps[entry.source_call_id]=true;}
      return callback;
    }
    var cache=callbackCache(callback),readers=cache&&cache.__producttrace_source_readers&&cache.__producttrace_source_readers[origin.source_id];
    return lifecycleCallback(targets[0],callback,readers,origin);
  }

  function lifecycleCallback(key, callback, captureReaders, memoOrigin) {
    var entry = lifecycleEntries[key];
    // Queued actions must survive recording shutdown and source-resolution gaps.
    // Decoding remains transparent even when no new evidence can be emitted.
    var passthrough=typeof callback==='function' && lifecycleReducerKeys[key]
      ?lifecycleReducerPassthrough(callback):callback;
    if(entry && typeof callback==='function' && (!started || disabled)) {
      // Existing React inputs must not change identity merely because capture
      // stopped. Keep the already-installed wrapper and make invocation inert.
      var stoppedRender=getFiberRender(currentReactFiber()) || lifecycleFallbackCurrentRender;
      var stoppedCache=lifecycleCallbackStates && lifecycleCallbackStates.get(callback);
      var stoppedState=stoppedRender && stoppedCache && stoppedCache[lifecycleCallbackCacheKey(key,stoppedRender)];
      if(stoppedState)return stoppedState.wrapper;
    }
    if (!entry || !/^callback|context_consumer_callback$/u.test(entry.kind)
        || typeof callback !== 'function' || !started || disabled || entry.callback_source_proven===false) return passthrough;
    var render = activeLifecycleRender(entry);
    if (!render && entry.kind === 'context_consumer_callback') {
      // Production does not expose the current Consumer Fiber here. Preserve
      // the invocation as an explicit ownership gap instead of borrowing the
      // parent component or silently omitting the callback.
      return function () {
        if (started && !disabled) {
          var id=lifecycleId('consumer_frontier');
          try {emit({schema:'producttrace.react-frontier.v1',kind:'react_frontier',runtime_observed:true,
            map_fingerprint:bindings.react_lifecycle.map_fingerprint,manifest_key:key,
            observation_id:id,occurrence_id:id+':occurrence',evidence_ids:[id],
            source_call_id:entry.source_call_id,callback_source_id:entry.callback_source_id,
            reason:'consumer_render_owner_unobserved',operation:'callback_invoked'});}catch(_){}
        }
        return Reflect.apply(callback,this,arguments);
      };
    }
    if (!render) return passthrough;
    var hookSlotId = lifecycleHookSlot(render, entry);
    ensureLifecycleAttempt(render, entry, hookSlotId);
    var cache = callbackCache(callback);
    var cacheKey = lifecycleCallbackCacheKey(key,render);
    var state = cache && cache[cacheKey];
    if (!state) {
      state = { entry: entry, original: callback, capture_readers:captureReaders, memo_origin:memoOrigin||null,pending_render: null,
        committed_render: null, hook_slot_id: hookSlotId, wrapper: null };
      state.wrapper = function () {
        if(!started || disabled)return passthrough.apply(this,arguments);
        var current = currentReactFiber();
        var callbackRenderPhase = /render|calculation|comparison|synchronous call/u.test(state.entry.phase || '');
        var fallback=callbackRenderPhase && lifecycleFallbackCurrentRender;
        var currentRender = getFiberRender(current);
        if (state.entry.external_store_role && currentRender && currentRender.anchor_entry
            && currentRender.anchor_entry.owner_source_id!==state.entry.owner_source_id) currentRender=null;
        currentRender = currentRender || (fallback && fallback.anchor_entry
          && fallback.anchor_entry.owner_source_id===state.entry.owner_source_id ? fallback : null);
        if (state.entry.external_store_role && currentRender) {
          var expectedRender=state.pending_render || state.committed_render;
          var sameStoreOwner=expectedRender && (currentRender.dispatcher_marker && expectedRender.dispatcher_marker
            ? currentRender.dispatcher_marker===expectedRender.dispatcher_marker
            : currentRender.identity.root_id===expectedRender.identity.root_id
              && currentRender.identity.mount_id===expectedRender.identity.mount_id);
          if(!sameStoreOwner)currentRender=null;
        }
        if (!currentRender && current && callbackRenderPhase && !state.entry.external_store_role) {
          currentRender = beginLifecycleRender(state.entry);
          ensureLifecycleAttempt(currentRender, state.entry,
            state.hook_slot_id || lifecycleHookSlot(currentRender, state.entry));
        }
        var selectedRender = currentRender && currentRender.status === 'attempted'
          ? currentRender : state.committed_render || state.pending_render;
        if (!selectedRender) return passthrough.apply(this, arguments);
        var invocationId = sessionId + ':react:invocation:' + (++lifecycleInvocationCount);
        var consumerValue=arguments[0];
        var extra = { hook_slot_id: state.hook_slot_id,
          callback_slot: state.entry.callback_slot,
          callback_source_id: state.entry.callback_source_id,
          invocation_id: invocationId, captured_values:readLifecycleCaptures(state.capture_readers) };
        if(state.memo_origin)extra.memo_callback_origin=state.memo_origin;
        if (state.entry.kind === 'context_consumer_callback') {
          extra.context_id = state.entry.context_id;
          extra.context_value = encodedLifecycleValue(arguments[0]);
        }
        var storeRole=state.entry.external_store_role;
        if(storeRole) {
          var originalCache=callbackCache(state.original),retainedOrigin=originalCache && originalCache.__producttrace_retained;
          extra.store_callback_origin=retainedOrigin?{callback_identity_id:retainedOrigin.callback_id,
            producer_source_call_id:retainedOrigin.entry.source_call_id,producer_hook_slot_id:retainedOrigin.hook_slot_id,origin_render_id:retainedOrigin.render.render_id}:null;
        }
        var storeListenerId=storeRole==='subscribe'?lifecycleId('store_listener'):null;
        if (storeListenerId) extra.store_listener_id=storeListenerId;
        var renderPhase = callbackRenderPhase;
        var emitInvocation = function () {
          if (state.entry.kind === 'context_consumer_callback') {
            var consumerFiber=selectedRender.fiber || current;
            var consumerType=consumerFiber && consumerFiber.type;
            var consumerContext=consumerType && (consumerType._context || consumerType);
            var consumerProvider = consumerContext ? nearestProviderEvidence(consumerFiber,consumerContext)
              : nearestProviderByContextId(consumerFiber,state.entry.context_id);
            extra.context_value_proof=contextObserver.contextReadEvidence(consumerContext,consumerValue,consumerProvider);
            extra.provider_protocol_application_id = consumerProvider && consumerProvider.protocol_application_id;
            extra.provider_source_member_call_id = consumerProvider && consumerProvider.source_member_call_id;
            extra.provider_value = consumerProvider && consumerProvider.value;
            extra.context_default_used = consumerProvider && consumerProvider.status === 'unresolved' ? null : consumerProvider === null;
            extra.context_provider_status = consumerProvider === null
              ? 'default' : consumerProvider.status;
            extra.context_provider_unresolved_reason = consumerProvider && consumerProvider.reason;
          }
          lifecycleRecord('callback_invoked', selectedRender, state.entry, extra);
        };
        if ((!renderPhase || selectedRender.dispatcher_marker)
            && selectedRender.status !== 'committed') {
          selectedRender.pending_records.push(emitInvocation);
        } else emitInvocation();
        var actual=arguments;
        var stateRequest=state.entry.observes_state_reducer && arguments[1] && typeof arguments[1]==='object'
          ?lifecycleStateActions.get(arguments[1]):null;
        if(stateRequest) {
          actual=[arguments[0],stateRequest.action];
          stateRequest.observe('state_updater_invoked',{invocation_id:invocationId,
            callback_source_id:state.entry.callback_source_id,pending_state:encodedLifecycleValue(arguments[0]),
            pending_state_raw:arguments[0],captured_values:readLifecycleCaptures(state.capture_readers)},selectedRender);
        }
        // Observe the callback passed by React without supplying our own trigger.
        // The wrapper is per subscription, while the subscribe/getter wrappers
        // themselves retain identity across renders.
        var storeNotification=lifecycleActiveStoreNotification;
        var matchingNotification=storeNotification && storeNotification.source_call_id===state.entry.source_call_id
          && storeNotification.mount_id===selectedRender.identity.mount_id
          && storeNotification.root_id===selectedRender.identity.root_id
          && storeNotification.instance_id===selectedRender.identity.instance_id;
        var storeObserve=function(operation,fields){
          var deliver=function(){lifecycleRecord(operation,selectedRender,state.entry,Object.assign({
            hook_slot_id:state.hook_slot_id,callback_slot:state.entry.callback_slot,
            callback_source_id:state.entry.callback_source_id,caused_by_invocation_id:invocationId},fields));};
          if (selectedRender.status!=='committed' && (!renderPhase || selectedRender.dispatcher_marker)) selectedRender.pending_records.push(deliver);
          else deliver();
        };
        if(storeRole==='subscribe' && typeof actual[0]==='function') {
          var originalListener=actual[0];actual=Array.prototype.slice.call(actual);
          actual[0]=function(){
            var notificationId=lifecycleId('store_notification');
            storeObserve('store_listener_invoked',{invocation_id:notificationId,store_listener_id:storeListenerId,action:activeRefAction});
            var previousNotification=lifecycleActiveStoreNotification;
            lifecycleActiveStoreNotification={invocation_id:notificationId,store_listener_id:storeListenerId,
              source_call_id:state.entry.source_call_id,mount_id:selectedRender.identity.mount_id,
              root_id:selectedRender.identity.root_id,instance_id:selectedRender.identity.instance_id};
            try{return Reflect.apply(originalListener,this,arguments);}
            finally{lifecycleActiveStoreNotification=previousNotification;}
          };
        }
        var snapshotOutcome=function(outcome,value){
          if(storeRole!=='snapshot' && storeRole!=='server_snapshot')return;
          storeObserve('store_snapshot_observed',{outcome:outcome,snapshot_role:storeRole,
            value:encodedLifecycleValue(value),value_id:lifecycleValueIdentity(value),argument_count:actual.length,
            notification_invocation_id:matchingNotification?storeNotification.invocation_id:null,
            store_listener_id:matchingNotification?storeNotification.store_listener_id:null});
        };
        var previousInvocation=lifecycleActiveCallbackInvocation;
        lifecycleActiveCallbackInvocation={entry:state.entry,render:selectedRender,
          hook_slot_id:state.hook_slot_id,invocation_id:invocationId,
          deferred:(!renderPhase || selectedRender.dispatcher_marker) && selectedRender.status!=='committed'};
        var result;
        var effectOutcome=function(operation,outcome,value,parentInvocation,slot,sourceId){
          if(!state.entry.observes_effect_outcome)return;
          var fields={runtime_observed:true,hook_slot_id:state.hook_slot_id,callback_slot:slot,
            callback_source_id:sourceId,caused_by_invocation_id:parentInvocation,
            outcome:outcome,value:encodedLifecycleValue(value),value_id:lifecycleValueIdentity(value),
            value_kind:value===null?'null':typeof value};
          var deliver=function(){lifecycleRecord(operation,selectedRender,state.entry,fields);};
          // Layout and insertion callbacks can finish before DevTools reports
          // their commit. Preserve order behind the matching invocation receipt.
          if(selectedRender.status!=='committed')selectedRender.pending_records.push(deliver);
          else deliver();
        };
        try { result = state.original.apply(this, actual); }
        catch(error) { snapshotOutcome('threw',error);
          if(stateRequest)stateRequest.observe('state_calculation_failed',{invocation_id:invocationId,
            callback_source_id:state.entry.callback_source_id,error:encodedLifecycleValue(error)},selectedRender);
          effectOutcome('callback_completed','threw',error,invocationId,state.entry.callback_slot,state.entry.callback_source_id);throw error; }
        finally { lifecycleActiveCallbackInvocation=previousInvocation; }
        effectOutcome('callback_completed','returned',result,invocationId,state.entry.callback_slot,state.entry.callback_source_id);
        snapshotOutcome('returned',result);
        if(storeRole==='subscribe' && typeof result==='function') {
          var storeCleanup=result;
          return function(){
            storeObserve('store_cleanup_invoked',{invocation_id:lifecycleId('store_cleanup'),store_listener_id:storeListenerId});
            return Reflect.apply(storeCleanup,this,arguments);
          };
        }
        if (state.entry.observes_imperative_handle) {
          var handleId=lifecycleValueIdentity(result),handleValue=encodedLifecycleValue(result),factoryArgumentCount=actual.length;
          var handleKind=result===null?'null':typeof result;
          var producedHandle=function () {lifecycleRecord('handle_produced',selectedRender,state.entry,{
            hook_slot_id:state.hook_slot_id,callback_slot:state.entry.callback_slot,
            callback_source_id:state.entry.callback_source_id,caused_by_invocation_id:invocationId,
            value_id:handleId,value:handleValue,value_kind:handleKind,factory_argument_count:factoryArgumentCount});};
          if (selectedRender.status!=='committed') selectedRender.pending_records.push(producedHandle);
          else producedHandle();
        }
        if(stateRequest)stateRequest.observe('state_calculated',{invocation_id:invocationId,
          callback_source_id:state.entry.callback_source_id,next_state:encodedLifecycleValue(result),next_state_raw:result},selectedRender);
        if (state.entry.observes_state_initializer) {
          var initialization={production_id:lifecycleId('state_initialization'),value:result,
            value_id:lifecycleValueIdentity(result)};
          var initializations=selectedRender.state_initializations || (selectedRender.state_initializations={});
          var products=initializations[state.entry.source_call_id] || (initializations[state.entry.source_call_id]=[]);
          products.push(initialization);
          var producedInitialization=function(){lifecycleRecord('value_produced',selectedRender,state.entry,{
            hook_slot_id:state.hook_slot_id,production_id:initialization.production_id,value_id:initialization.value_id,
            value:encodedLifecycleValue(result),caused_by_invocation_id:invocationId});};
          if(selectedRender.dispatcher_marker && selectedRender.status!=='committed')selectedRender.pending_records.push(producedInitialization);
          else producedInitialization();
        }
        if (state.entry.observes_memo_value) {
          var product = {production_id:lifecycleId('memo_product'),value:result,
            value_id:lifecycleValueIdentity(result),origin_render_id:selectedRender.render_id};
          selectedRender.memo_productions[state.entry.source_call_id] = product;
          var produced = function () {
            var callbacks = [];
            (state.entry.result_callbacks || []).forEach(function (binding) {
              var value = result;
              for (var i=0;i<binding.path.length;i++) {
                if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
                // Follow data properties only. Observing a memo must never execute a getter.
                var descriptor = Object.getOwnPropertyDescriptor(value,binding.path[i]);
                if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor,'value')) return;
                value = descriptor.value;
              }
              if (typeof value !== 'function') return;
              var cache = callbackCache(value);
              if (!cache || !cache.__producttrace_sources || !cache.__producttrace_sources[binding.source_id]) return;
              var callbackId = lifecycleValueIdentity(value);
              callbacks.push({path:binding.path,source_id:binding.source_id,callback_value_id:callbackId});
              var origins = cache.__producttrace_memo || [];
              origins.push({entry:state.entry,hook_slot_id:state.hook_slot_id,
                production_id:product.production_id,value_id:product.value_id,
                source_id:binding.source_id,path:binding.path,callback_value_id:callbackId,
                // Keep ownership, not the render or its previous-render chain.
                render:{identity:{root_id:selectedRender.identity.root_id,
                  instance_id:selectedRender.identity.instance_id,mount_id:selectedRender.identity.mount_id},
                  render_id:selectedRender.render_id}});
              cache.__producttrace_memo = origins;
            });
            lifecycleRecord('value_produced',selectedRender,state.entry,{
              hook_slot_id:state.hook_slot_id,production_id:product.production_id,
              value_id:product.value_id,value:encodedLifecycleValue(result),
              caused_by_invocation_id:invocationId,result_callbacks:callbacks});
          };
          if(selectedRender.dispatcher_marker && selectedRender.status!=='committed')selectedRender.pending_records.push(produced);
          else produced();
        }
        if (typeof result === 'function' && state.entry.cleanup_source_id) {
          var cleanup = result;
          return function () {
            var cleanupInvocationId=sessionId + ':react:invocation:' + (++lifecycleInvocationCount);
            lifecycleRecord('cleanup_invoked', selectedRender, state.entry, {
              hook_slot_id: state.hook_slot_id,
              callback_slot: state.entry.cleanup_slot,
              callback_source_id: state.entry.cleanup_source_id,
              invocation_id: cleanupInvocationId,
              caused_by_invocation_id: invocationId,
              captured_values:readLifecycleCaptures(state.capture_readers).filter(function (value) {
                return (state.entry.cleanup_captures || []).some(function (binding) { return binding.binding_id === value.binding_id; });
              }),
            });
            var previousCleanupInvocation=lifecycleActiveCallbackInvocation;
            lifecycleActiveCallbackInvocation={entry:lifecycleEntries[state.entry.cleanup_manifest_key],
              render:selectedRender,hook_slot_id:state.hook_slot_id,invocation_id:cleanupInvocationId,deferred:false};
            try { var cleanupResult=cleanup.apply(this, arguments);
              effectOutcome('cleanup_completed','returned',cleanupResult,cleanupInvocationId,state.entry.cleanup_slot,state.entry.cleanup_source_id);
              return cleanupResult;
            } catch(error) {
              effectOutcome('cleanup_completed','threw',error,cleanupInvocationId,state.entry.cleanup_slot,state.entry.cleanup_source_id);
              throw error;
            }
            finally { lifecycleActiveCallbackInvocation=previousCleanupInvocation; }
          };
        }
        return result;
      };
      if (cache) cache[cacheKey] = state;
    }
    state.pending_render = render;
    state.hook_slot_id = hookSlotId;
    if (render.callback_states.indexOf(state) === -1) render.callback_states.push(state);
    return state.wrapper;
  }

  function lifecycleValueIdentity(value) {
    var object = value !== null && (typeof value === 'object' || typeof value === 'function');
    // Primitive IDs identify a production occurrence. Retained selections reuse
    // that token after Object.is checks; no permanent string-value index is needed.
    if (!object) return lifecycleId('value');
    var id = lifecycleValueObjects.get(value);
    if (!id) { id=lifecycleId('value'); lifecycleValueObjects.set(value,id); }
    return id;
  }

  function lifecycleMemoResult(key,value) {
    var entry=lifecycleEntry(key,'memo_result');
    var render=entry && started && !disabled ? activeLifecycleRender(entry) : null;
    if (!render) return value;
    var hookSlot=lifecycleHookSlot(render,entry);
    ensureLifecycleAttempt(render,entry,hookSlot);
    var sourceGap=render.memo_source_frontiers&&render.memo_source_frontiers[entry.source_call_id];
    var product=sourceGap?null:render.memo_productions[entry.source_call_id];
    if (!sourceGap&&!product && render.previous_committed) product=render.previous_committed.memo_selections[entry.source_call_id];
    var matches=product && Object.is(product.value,value);
    if(matches)render.memo_selections[entry.source_call_id]=product;
    var selected=function () {
      lifecycleRecord('value_selected',render,entry,{hook_slot_id:hookSlot,
        production_id:matches?product.production_id:null,value_id:matches?product.value_id:lifecycleValueIdentity(value),
        value:encodedLifecycleValue(value),origin_render_id:matches?product.origin_render_id:null,memo_source_frontier:Boolean(sourceGap)});
    };
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(selected);
    else selected();
    return value;
  }

  function lifecycleStateProcessingRender(state) {
    var render=getFiberRender(currentReactFiber()) || lifecycleFallbackCurrentRender;
    if(!render || render.status!=='attempted')return null;
    var expected=state.committed_render || state.pending_render;
    if(!expected)return null;
    var sameOwner=render.identity.root_id===expected.identity.root_id
      &&render.identity.instance_id===expected.identity.instance_id
      &&render.identity.mount_id===expected.identity.mount_id;
    return sameOwner?render:null;
  }

  function lifecycleStateCommitSelection(state,render,value) {
    var requests=state.requests||[],explicit=[];
    requests.forEach(function(request){
      (request.calculations||[]).forEach(function(calculation){
        if(calculation.completed&&calculation.outcome==='returned'&&calculation.processing_render===render)explicit.push({request:request,calculation:calculation});
      });
    });
    explicit.sort(function(left,right){return left.calculation.sequence-right.calculation.sequence;});
    if(explicit.length) {
      for(var i=1;i<explicit.length;i++)if(!Object.is(explicit[i-1].calculation.next_state,explicit[i].calculation.pending_state))return null;
      if(!Object.is(explicit[explicit.length-1].calculation.next_state,value))return null;
      // An eagerly computed update can feed the first calculation in a batch.
      // Include it only when one exact, earlier request bridges the last
      // committed value to the observed input. Ambiguity remains a frontier.
      var first=explicit[0],prefix=[];
      if(state.has_committed_value&&!Object.is(state.committed_value,first.calculation.pending_state)) {
        var candidates=[];
        requests.slice(0,requests.indexOf(first.request)).forEach(function(request){
          (request.calculations||[]).forEach(function(calculation){
            if(calculation.completed&&calculation.outcome==='returned'&&!calculation.processing_render
              &&Object.is(calculation.pending_state,state.committed_value)
              &&Object.is(calculation.next_state,first.calculation.pending_state))candidates.push({request:request,calculation:calculation});
          });
          if(request.update_kind==='value'&&Object.is(request.action,state.committed_value)===false
            &&Object.is(request.action,first.calculation.pending_state))candidates.push({request:request,calculation:null});
        });
        if(candidates.length===1)prefix=candidates;
      }
      return {basis:'processing_render',updates:prefix.concat(explicit)};
    }
    if(!state.has_committed_value||Object.is(state.committed_value,value))return null;
    // Some renderers execute a functional updater while getCurrentFiber is not
    // exposed. Reconstruct only an unambiguous chain of actual callback calls:
    // each observed return must be the next call's observed input, and the last
    // return must be the state React exposed from the hook. Prefer the longest
    // chain so concurrent rebasing (old base -> transition -> urgent replay)
    // does not collapse to a coincidentally equal suffix.
    var chains=[];
    requests.forEach(function(request,requestIndex){
      (request.calculations||[]).forEach(function(calculation){
        if(!calculation.completed||calculation.outcome!=='returned'||calculation.processing_render||calculation.attributed)return;
        var row={request:request,calculation:calculation,request_index:requestIndex};
        var candidates=[{updates:[row],first_input:calculation.pending_state,last_output:calculation.next_state}];
        chains.forEach(function(chain){
          if(chain.last_index<requestIndex&&Object.is(chain.last_output,calculation.pending_state))
            candidates.push({updates:chain.updates.concat(row),first_input:chain.first_input,
              last_output:calculation.next_state,last_index:requestIndex});
        });
        candidates.forEach(function(chain){chain.last_index=requestIndex;chains.push(chain);});
      });
    });
    var endings=chains.filter(function(chain){return Object.is(chain.last_output,value)
      &&(Object.is(chain.first_input,state.committed_value)||chain.updates.length>1);});
    var longest=endings.reduce(function(length,chain){return Math.max(length,chain.updates.length);},0);
    endings=endings.filter(function(chain){return chain.updates.length===longest;});
    var signatures={};endings.forEach(function(chain){signatures[chain.updates.map(function(row){return row.request.request_id+'\u0000'+row.calculation.invocation_id;}).join('\u0001')]=chain;});
    var unique=Object.keys(signatures);
    if(unique.length===1)return {basis:'observed_calculation_chain',updates:signatures[unique[0]].updates};
    var replacements=[];
    requests.forEach(function(request){if(request.update_kind==='value'&&!request.attributed&&Object.is(request.action,value))replacements.push({request:request,calculation:null});});
    return replacements.length===1?{basis:'unique_replacement',updates:replacements}:null;
  }

  function lifecycleStateResult(key,pair) {
    var entry=lifecycleEntry(key,'state_result');
    if(!entry || !started || disabled || !Array.isArray(pair) || typeof pair[1]!=='function')return pair;
    var render=activeLifecycleRender(entry);
    if(!render)return pair;
    var slot=lifecycleHookSlot(render,entry);
    ensureLifecycleAttempt(render,entry,slot);
    var cache=callbackCache(pair[1]);
    var state=cache.__producttrace_state;
    if(state && state.entry.source_call_id!==entry.source_call_id)return pair;
    if(!state)state=cache.__producttrace_state={entry:entry,identity:lifecycleId('state_dispatch'),
      pending_render:null,committed_render:null,hook_slot_id:slot,requests:[],has_committed_value:false,committed_value:undefined};
    state.pending_render=render;
    state.pending_value=pair[0];
    state.pending_value_render=render;
    if(render.callback_states.indexOf(state)===-1)render.callback_states.push(state);
    // Identity alone can be ambiguous if React called an initializer more than
    // once with equal results. Only a unique observed return proves this link.
    var initializations=(render.state_initializations || {})[entry.source_call_id] || [];
    var matches=initializations.filter(function(product){return Object.is(product.value,pair[0]);});
    var initialization=matches.length===1?matches[0]:null;
    var read=function(){lifecycleRecord('state_read',render,entry,{hook_slot_id:slot,
      state_identity_id:state.identity,value:encodedLifecycleValue(pair[0]),
      initialization_production_id:initialization?initialization.production_id:null,
      initialization_value_id:initialization?initialization.value_id:null,
      initialization_status:initialization?'observed_return':matches.length>1?'ambiguous':'unobserved'});};
    if(render.dispatcher_marker && render.status!=='committed')render.pending_records.push(read);
    else read();
    var selection=lifecycleStateCommitSelection(state,render,pair[0]);
    if(selection) {
      var commits=render.state_commit_selections||(render.state_commit_selections=[]);
      commits.push({state:state,entry:entry,hook_slot_id:slot,value:pair[0],selection:selection});
    }
    // Keep React's original pair and dispatcher identity. Only known call sites
    // get a temporary observer; application references remain exactly unchanged.
    return pair;
  }

  function lifecycleStateDispatch(key,dispatch) {
    var entry=lifecycleEntry(key,'state_dispatch');
    if(!entry || !started || disabled || typeof dispatch!=='function')return dispatch;
    return function(){
      var state=callbackCache(dispatch).__producttrace_state;
      if(!state || state.entry.source_call_id!==entry.source_call_id)return dispatch.apply(this,arguments);
      var render=state.committed_render || state.pending_render;
      if(!render)return dispatch.apply(this,arguments);
      var args=Array.prototype.slice.call(arguments);
      var action=args[0],functional=entry.execution_rule.update_mode==='functional_or_replace' && typeof action==='function';
      var callbackData=functional && callbackCache(action);
      var sourceTags=callbackData&&callbackData.__producttrace_sources;
      var candidateIds=(entry.updater_source_candidates||[]).map(function(candidate){return candidate.source_id;});
      if(entry.updater_source_id)candidateIds.unshift(entry.updater_source_id);
      var selectedIds=candidateIds.filter(function(sourceId){return sourceTags&&sourceTags[sourceId];});
      var selectedSourceId=selectedIds.length===1?selectedIds[0]:null;
      var requestId=lifecycleId('state_request');
      var stamp=window[ACTION_STAMP_GLOBAL];
      var actionRecord=Number.isInteger(stamp) && actionRecordsByStamp[stamp];
      var sourceScopes=scopeObserver.currentScopes();
      var extra={hook_slot_id:state.hook_slot_id,state_identity_id:state.identity,update_call_id:entry.update_call_id,
        request_id:requestId,update_value_id:lifecycleValueIdentity(action),update_value:encodedLifecycleValue(action),update_kind:entry.execution_rule.update_mode==='reducer'?'reducer':functional?'functional':'value',
        callback_source_id:entry.execution_rule.update_mode==='reducer'?entry.reducer_source_id:selectedSourceId,
        action_occurrence_id:actionRecord?actionRecord.session+':action:'+actionRecord.seq:null,
        source_scopes:sourceScopes,
        frontier:entry.execution_rule.update_mode==='reducer'&&!entry.reducer_source_id?'reducer_source_unresolved'
          :functional&&!selectedSourceId?(selectedIds.length>1?'updater_source_ambiguous':'updater_source_unresolved'):null};
      var request={request_id:requestId,update_kind:extra.update_kind,action:action,calculations:[],attributed:false};
      state.requests.push(request);
      if(state.requests.length>256)state.requests.splice(0,state.requests.length-256);
      var observe=function(operation,fields,processingRender){
        var target=processingRender&&processingRender.status==='attempted'?processingRender:render;
        var calculation=null;
        if(operation==='state_updater_invoked') {
          calculation={invocation_id:fields.invocation_id,pending_state:fields.pending_state_raw,
            next_state:undefined,completed:false,processing_render:processingRender||null,
            sequence:++lifecycleInvocationCount,attributed:false};
          request.calculations.push(calculation);
        } else if(operation==='state_calculated' || operation==='state_calculation_failed') {
          calculation=request.calculations.slice().reverse().find(function(row){return row.invocation_id===fields.invocation_id&&!row.completed;});
          if(calculation){calculation.next_state=fields.next_state_raw;calculation.completed=true;
            calculation.outcome=operation==='state_calculated'?'returned':'threw';}
        }
        var clean=Object.assign({},fields);delete clean.pending_state_raw;delete clean.next_state_raw;
        clean.request_render_id=render.render_id;
        clean.processing_render_id=processingRender?processingRender.render_id:null;
        var emitRecord=function(){lifecycleRecord(operation,target,entry,Object.assign({},extra,clean));};
        if(target.dispatcher_marker && target.status==='attempted')target.pending_records.push(emitRecord);
        else emitRecord();
      };
      observe('state_requested',{});
      if(entry.execution_rule.update_mode==='reducer' && entry.reducer_source_id) {
        // The queue carries an opaque request token. The reducer receives the
        // exact original action, including function and repeated primitive actions.
        var envelope={};
        lifecycleStateActions.set(envelope,{action:action,observe:observe});
        args[0]=envelope;
      }
      if(functional && selectedSourceId)args[0]=function(previous){
        var invocationId=lifecycleId('state_calculation');
        var captured=readLifecycleCaptures((callbackData.__producttrace_source_readers||{})[selectedSourceId]);
        var processingRender=lifecycleStateProcessingRender(state);
        // React may call this eagerly, during a render, or again after a rebase.
        // Each actual call gets its own identity; none implies a committed write.
        observe('state_updater_invoked',{invocation_id:invocationId,
          pending_state:encodedLifecycleValue(previous),pending_state_raw:previous,captured_values:captured},processingRender);
        var result;
        try{result=action(previous);}catch(error){
          observe('state_calculation_failed',{invocation_id:invocationId,error:encodedLifecycleValue(error)},processingRender);throw error;
        }
        observe('state_calculated',{invocation_id:invocationId,next_state:encodedLifecycleValue(result),next_state_raw:result},processingRender);
        return result;
      };
      return dispatch.apply(this,args);
    };
  }

  function lifecycleRegisterContext(key, context) {
    var entry = lifecycleEntry(key, 'context_create');
    if (entry && context && (typeof context === 'object' || typeof context === 'function')
        && lifecycleContextEntries) lifecycleContextEntries.set(context, entry);
    return context;
  }

  function lifecycleContextInput(key, context) {
    var entry = lifecycleEntry(key, 'context_read');
    if (!entry || !started || disabled) return context;
    var render = activeLifecycleRender(entry);
    if (!render) return context;
    var hookSlotId = lifecycleHookSlot(render, entry);
    ensureLifecycleAttempt(render, entry, hookSlotId);
    var contextOwner = render.fiber || render;
    var values = lifecycleContextInputs.get(contextOwner) || {};
    values[key] = { context: context, render: render, entry: entry, hook_slot_id: hookSlotId };
    lifecycleContextInputs.set(contextOwner, values);
    return context;
  }

  function encodedLifecycleValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean'
        || typeof value === 'number' && Number.isFinite(value)) {
      return { encoding: 'primitive', value: value };
    }
    return { encoding: 'redacted', value: null };
  }

  function nearestProviderEvidence(fiber, context) {
    if (!fiber) return {status:'unresolved',reason:'provider_ancestry_unobserved'};
    var current = fiber && fiber.return;
    var hops = 0;
    while (current && hops++ < 200) {
      var type = current.type;
      var providerContext = type && type._context;
      if (providerContext === context) {
        var marker = current.memoizedProps && current.memoizedProps.__producttraceProvider
          || current.pendingProps && current.pendingProps.__producttraceProvider;
        var entry = typeof marker === 'string' ? lifecycleEntries[marker] : null;
        return entry && entry.kind === 'context_provider'
          ? { protocol_application_id: entry.protocol_application_id,
            source_member_call_id: entry.source_member_call_id,
            raw_value:(current.memoizedProps || current.pendingProps || {}).value,
            value: encodedLifecycleValue((current.memoizedProps || current.pendingProps || {}).value),
            status: 'source_resolved', reason: null }
          : { protocol_application_id: null, source_member_call_id: null,
            raw_value:(current.memoizedProps || current.pendingProps || {}).value,
            value: encodedLifecycleValue((current.memoizedProps || current.pendingProps || {}).value),
            status: 'source_unresolved', reason: 'provider_source_uninstrumented' };
      }
      current = current.return;
    }
    return current ? {status:'unresolved',reason:'provider_ancestry_limit'} : null;
  }

  function nearestProviderByContextId(fiber, contextId) {
    if (!fiber) return {status:'unresolved',reason:'provider_ancestry_unobserved'};
    var current = fiber && fiber.return;
    var hops = 0;
    while (current && hops++ < 200) {
      var marker = current.memoizedProps && current.memoizedProps.__producttraceProvider
        || current.pendingProps && current.pendingProps.__producttraceProvider;
      var entry = typeof marker === 'string' ? lifecycleEntries[marker] : null;
      if (entry && entry.kind === 'context_provider' && entry.context_id === contextId) {
        return { protocol_application_id: entry.protocol_application_id,
          source_member_call_id: entry.source_member_call_id,
          value: encodedLifecycleValue((current.memoizedProps || current.pendingProps || {}).value),
          status: 'source_resolved', reason: null };
      }
      var providerContext = current.type && current.type._context;
      var contextEntry = providerContext && lifecycleContextEntries
        && lifecycleContextEntries.get(providerContext);
      if (contextEntry && contextEntry.context_id === contextId) {
        return { protocol_application_id: null, source_member_call_id: null,
          value: encodedLifecycleValue((current.memoizedProps || current.pendingProps || {}).value),
          status: 'source_unresolved', reason: 'provider_source_uninstrumented' };
      }
      current = current.return;
    }
    return current ? {status:'unresolved',reason:'provider_ancestry_limit'} : null;
  }

  function lifecycleContextResult(key, value) {
    var entry = lifecycleEntry(key, 'context_read');
    var fiber = currentReactFiber();
    var fallbackRender = !fiber ? lifecycleFallbackCurrentRender : null;
    var contextOwner = fiber || fallbackRender;
    var values = contextOwner && lifecycleContextInputs.get(contextOwner);
    var input = values && values[key];
    if (!entry || !input) return value;
    delete values[key];
    var capturedRead = {value:value,record:null};
    if (entry.context_result_binding_id) {
      if (!input.render.context_reads) input.render.context_reads = Object.create(null);
      input.render.context_reads[entry.context_result_binding_id] = capturedRead;
    }
    var emitContextRead = function () {
      var provider = nearestProviderEvidence(input.render.fiber || fiber, input.context);
      capturedRead.record = lifecycleRecord('value_read', input.render, entry, {
        hook_slot_id: input.hook_slot_id,
        context_id: entry.context_id,
        context_value: encodedLifecycleValue(value),
        context_value_proof:contextObserver.contextReadEvidence(input.context,value,provider),
        provider_protocol_application_id: provider && provider.protocol_application_id,
        provider_source_member_call_id: provider && provider.source_member_call_id,
        provider_value: provider && provider.value,
        context_default_used: provider && provider.status === 'unresolved' ? null : provider === null,
        context_provider_status: provider === null ? 'default' : provider.status,
        context_provider_unresolved_reason: provider && provider.reason,
      });
    };
    if (!fiber && input.render.status !== 'committed') input.render.pending_records.push(emitContextRead);
    else emitContextRead();
    return value;
  }

  function dispatcherLifecycleMarker(fiber) {
    var hook = fiber && fiber.memoizedState;
    var hops = 0;
    while (hook && hops++ < 500) {
      var state = hook.memoizedState;
      // Only inspect the private ref allocated by our dispatcher bridge. A
      // user's state/ref may expose getters or a lookalike marker property.
      var marker = lifecycleDispatcherMarkers.get(state);
      if (marker) return marker;
      hook = hook.next;
    }
    return null;
  }

  function adoptDispatcherLifecycleRender(fiber) {
    var marker = dispatcherLifecycleMarker(fiber);
    var render = marker && marker.committed_render;
    if (!render || render.status !== 'attempted' || !render.anchor_entry) return;
    render.fiber = fiber;
    var committedIdentity = fiberIdentities && fiberIdentities.get(fiber);
    if (committedIdentity) render.identity = committedIdentity;
    setFiberRender(fiber, render);
    marker.pending_render = null;
    marker.last_identity = render.identity;
    marker.position_id = render.position_id;
  }

  function commitFiberLifecycle(fiber) {
    adoptDispatcherLifecycleRender(fiber);
    var render = getFiberRender(fiber);
    if (!render || render.status !== 'attempted' || !render.anchor_entry) return;
    var committedIdentity = fiberIdentities && fiberIdentities.get(fiber);
    if (committedIdentity) render.identity = committedIdentity;
    if (!render.attempt_record_emitted) {
      lifecycleRecord('render_attempted', render, render.anchor_entry,
        { hook_slot_id: render.anchor_hook_slot_id,
          replaces_render_ids: render.replaced_render_ids && render.replaced_render_ids.length
            ? render.replaced_render_ids.slice() : undefined });
      render.attempt_record_emitted = true;
    }
    lifecycleRecord('render_committed', render, render.anchor_entry,
      { hook_slot_id: render.anchor_hook_slot_id });
    render.status = 'committed';
    // Commit replaces a hook selection. Prune only now: an interrupted render
    // must not erase the callback still selected by the committed UI.
    (render.shared_retained_selections || []).forEach(function(owned){
      owned.cache.__producttrace_shared=owned.cache.__producttrace_shared.filter(function(row){
        return row===owned.selection || row.entry.source_call_id!==owned.selection.entry.source_call_id
          || !['root_id','instance_id','mount_id'].every(function(field){return row.render.identity[field]===render.identity[field];});
      });
    });
    render.shared_retained_selections=null;
    lifecycleCommittedRenders.set(fiber, render);
    if (fiber.alternate) lifecycleCommittedRenders.set(fiber.alternate, render);
    for (var i = 0; i < render.callback_states.length; i++) {
      var state = render.callback_states[i];
      if (state.pending_render === render) {
        state.committed_render = render;
        state.pending_render = null;
      }
    }
    var pending = render.pending_records.splice(0, render.pending_records.length);
    for (var j = 0; j < pending.length; j++) pending[j]();
    (render.state_commit_selections||[]).forEach(function(commit){
      var updates=commit.selection.updates.map(function(selected){
        selected.request.attributed=true;
        if(selected.calculation)selected.calculation.attributed=true;
        return {request_id:selected.request.request_id,
          invocation_id:selected.calculation?selected.calculation.invocation_id:null};
      });
      lifecycleRecord('state_committed',render,commit.entry,{hook_slot_id:commit.hook_slot_id,
        state_identity_id:commit.state.identity,value:encodedLifecycleValue(commit.value),
        selection_basis:commit.selection.basis,committed_updates:updates});
    });
    for (var k = 0; k < render.callback_states.length; k++) {
      var committedState=render.callback_states[k];
      if(committedState.identity&&committedState.pending_value_render===render) {
        committedState.committed_value=committedState.pending_value;
        committedState.has_committed_value=true;
        committedState.pending_value=undefined;
        committedState.pending_value_render=null;
      }
    }
    render.previous_committed = null;
  }

  function unmountFiberLifecycle(fiber) {
    portalCommitObserver.unmount(fiber);
    if(fiber && fiber.tag===1 && classFiberInstances && fiber.stateNode){var knownClass=classFiberInstances.get(fiber.stateNode);if(knownClass)knownClass.mounted=false;}
    var render = getFiberRender(fiber);
    if (!render || render.status !== 'committed' || !render.anchor_entry) return;
    // React invokes passive cleanup after the deletion commit. Emit unmount at
    // the end of this task so the cleanup retains its exact setup ancestry.
    setTimeout(function () {
      if (!started || disabled || render.status !== 'committed') return;
      lifecycleRecord('unmounted', render, render.anchor_entry,
        { hook_slot_id: render.anchor_hook_slot_id });
      render.status = 'unmounted';
    }, 0);
  }

  function installHook() {
    var existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    function onCommit(root,rendererId) {
      commitCount++;
      var rootId = ensureRootIdentity(root);
      boundaryCommitObserver.begin(rootId,'react-commit:'+commitCount);
      portalCommitObserver.begin(rootId,'react-commit:'+commitCount);
      if(root && root.containerInfo)committedContainerRoots.set(root.containerInfo,{root:root,rootId:rootId,commitId:'react-commit:'+commitCount,session:sessionId});
      rootObserver.rootCommitted(root,'react-commit:'+commitCount);
      captureFiberMounts(root, rootId, 'react-commit:' + commitCount);
      var activeHook=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      profilerObserver.commit(root,activeHook&&activeHook.renderers&&activeHook.renderers.get(rendererId));
    }
    if (existing && typeof existing.onCommitFiberRoot === 'function') {
      hookTarget = existing;
      hookPrevious = existing.onCommitFiberRoot;
      hookWrapper = function (id, root, prio, err) {
        observe('react_commit', function () { onCommit(root,id); });
        return hookPrevious.apply(existing, arguments);
      };
      hookUnmountPrevious = existing.onCommitFiberUnmount;
      hookUnmountWrapper = function (id, fiber) {
        observe('react_unmount', function () { unmountFiberLifecycle(fiber); });
        if (typeof hookUnmountPrevious === 'function') return hookUnmountPrevious.apply(existing, arguments);
      };
      hookStrictPrevious=existing.setStrictMode;hookStrictHadOwn=Object.prototype.hasOwnProperty.call(existing,'setStrictMode');
      hookStrictWrapper=function(id,replaying){observe('react_strict_replay',function(){strictReplayObserver.signal(id,replaying);});
        if(typeof hookStrictPrevious==='function')return hookStrictPrevious.apply(existing,arguments);};
      existing.setStrictMode=hookStrictWrapper;
      existing.onCommitFiberRoot = hookWrapper;
      existing.onCommitFiberUnmount = hookUnmountWrapper;
      hookMode = 'wrapped';
      return;
    }
    hookOriginalGlobal = existing;
    var renderers = new Map();
    var fiberRoots = new Map();
    var nextId = 1;
    hookCreated = {
      renderers: renderers,
      getFiberRoots: function (rendererId) { return fiberRoots.get(rendererId) || new Set(); },
      supportsFiber: true,
      isDisabled: false,
      inject: function (renderer) { var id = nextId++; renderers.set(id, renderer); return id; },
      checkDCE: function () {},
      sub: function () { return function () {}; },
      on: function () {}, off: function () {}, emit: function () {},
      setStrictMode:function(id,replaying){observe('react_strict_replay',function(){strictReplayObserver.signal(id,replaying);});},
      onScheduleFiberRoot: function () {},
      onCommitFiberUnmount: function (id, fiber) {
        observe('react_unmount', function () { unmountFiberLifecycle(fiber); });
      },
      onPostCommitFiberRoot: function () {},
      onCommitFiberRoot: function (id, root) {
        if (!fiberRoots.has(id)) fiberRoots.set(id, new Set());
        fiberRoots.get(id).add(root);
        observe('react_commit', function () { onCommit(root,id); });
      },
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hookCreated;
    hookMode = 'created';
  }

  function restoreHook() {
    if(hookMode==='wrapped'&&hookTarget&&hookTarget.setStrictMode===hookStrictWrapper){
      if(hookStrictHadOwn)hookTarget.setStrictMode=hookStrictPrevious;else delete hookTarget.setStrictMode;
    }
    if (hookMode === 'wrapped' && hookTarget && hookTarget.onCommitFiberRoot === hookWrapper) {
      hookTarget.onCommitFiberRoot = hookPrevious;
      if (hookTarget.onCommitFiberUnmount === hookUnmountWrapper) {
        hookTarget.onCommitFiberUnmount = hookUnmountPrevious;
      }
      return true;
    }
    if (hookMode === 'created' && window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === hookCreated) {
      if (hookOriginalGlobal === undefined) delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      else window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hookOriginalGlobal;
      return true;
    }
    return hookMode === 'none';
  }

  // DOM node -> fiber (React attaches it as an own property).
  function fiberOf(node) {
    while (node) {
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          return node[keys[i]];
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  function nameOfType(type) {
    if (!type) return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      // memo / forwardRef wrappers
      return type.displayName ||
        (type.render && (type.render.displayName || type.render.name)) ||
        (type.type && nameOfType(type.type)) || null;
    }
    return null;
  }

  function testPattern(pattern, value) {
    if (pattern == null) return true;
    if (Array.isArray(pattern)) {
      for (var i = 0; i < pattern.length; i++) {
        if (testPattern(pattern[i], value)) return true;
      }
      return false;
    }
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(String(value == null ? '' : value));
    }
    return value === pattern;
  }

  function componentMatches(pattern, names) {
    if (pattern == null) return true;
    for (var i = 0; i < names.length; i++) {
      if (testPattern(pattern, names[i])) return true;
    }
    return false;
  }

  function recordFiberIdentity(fiber, rootId, commitId) {
    if (!fiber || !fiberIdentities) return null;
    var identity = fiberIdentities.get(fiber)
      || (fiber.alternate && fiberIdentities.get(fiber.alternate));
    if (!identity) identity = {
      root_id: rootId,
      instance_id: 'react-instance:' + (++fiberIdentityCount),
      mount_id: 'react-mount:' + fiberIdentityCount,
    };
    var committed = {
      root_id: identity.root_id,
      instance_id: identity.instance_id,
      mount_id: identity.mount_id,
      commit_id: commitId,
      render_id: null,
      render_observed: false,
      runtime_observed: true,
      basis: 'react-devtools-commit.v1',
    };
    fiberIdentities.set(fiber, committed);
    if (fiber.alternate) fiberIdentities.set(fiber.alternate, committed);
    if(fiber.tag===1 && fiber.stateNode && classFiberInstances)classFiberInstances.set(fiber.stateNode,
      {fiber:fiber,root:rootForFiber(fiber),mounted:true,session:sessionId});
    return committed;
  }

  function fiberRuntimeIdentity(fiber) {
    var identity = fiberIdentities && fiberIdentities.get(fiber);
    return identity ? JSON.parse(JSON.stringify(identity)) : null;
  }

  function nearestCommittedLifecycleIdentity(fiber) {
    var current = fiber;
    var hops = 0;
    while (current && hops++ < 200) {
      var render = getFiberRender(current);
      if (render && render.status === 'committed' && render.anchor_entry) {
        return {
          session: sessionId,
          root_id: render.identity.root_id,
          instance_id: render.identity.instance_id,
          mount_id: render.identity.mount_id,
          render_id: render.render_id,
          source_call_id: render.anchor_entry.source_call_id,
          semantic_id: render.anchor_entry.semantic_id,
          owner_source_id: render.anchor_entry.owner_source_id,
          status: 'committed',
          runtime_observed: true,
          basis: 'react-lifecycle-render.v1',
        };
      }
      current = current.return;
    }
    return null;
  }

  function scopeMatches(scope, target, names) {
    if (!scope) return false;
    if (!componentMatches(scope.component, names)) return false;
    if (scope.testid != null && !testPattern(scope.testid, target.testid)) return false;
    if (scope.id != null && !testPattern(scope.id, target.id)) return false;
    if (scope.aria != null && !testPattern(scope.aria, target.aria)) return false;
    if (scope.labelledby != null && !testPattern(scope.labelledby, target.labelledby)) return false;
    if (scope.text != null && !testPattern(scope.text, target.text)) return false;
    if (scope.dialog != null && !testPattern(scope.dialog, target.dialog)) return false;
    if (scope.title != null && !testPattern(scope.title, target.title)) return false;
    if (scope.placeholder != null && !testPattern(scope.placeholder, target.placeholder)) return false;
    return true;
  }

  function readPath(value, path) {
    var segs = path.split('.');
    for (var i = 0; i < segs.length && value != null; i++) value = value[segs[i]];
    return value;
  }

  function validIdentity(spec, value, props) {
    if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return false;
    if (spec.validate instanceof RegExp) return testPattern(spec.validate, value);
    if (typeof spec.validate === 'function') {
      try { return spec.validate(value, props) === true; } catch (e) { return false; }
    }
    return false;
  }

  // Walk fiber ancestry. Modern propRules are surface-scoped and validated;
  // legacy propPaths remain readable only so old maps fail visibly rather than
  // breaking their host application during migration.
  function resolveFiberEvidence(input) {
    var fiber = input.fiber;
    var target = input.target;
    var chain = [];
    var allNames = [];
    var nodes = [];
    var ids = {};
    var basis = {};
    var identity = bindings.identity || {};
    var rules = identity.propRules || [];
    var legacy = rules.length === 0;
    if (legacy) rules = identity.propPaths || [];
    var hops = 0;
    var f = fiber;
    while (f && hops < 60) {
      var isComponent = typeof f.type === 'function' || (f.type && typeof f.type === 'object');
      if (isComponent) {
        var nm = nameOfType(f.type);
        if (nm && allNames[allNames.length - 1] !== nm) allNames.push(nm);
        nodes.push({ name: nm, props: f.memoizedProps });
      }
      f = f.return;
      hops++;
    }
    chain = allNames.slice(0, 10);

    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (!node.props) continue;
      for (var p = 0; p < rules.length; p++) {
        var spec = rules[p];
        if (ids[spec.as] != null) continue;
        if (!legacy) {
          if (!scopeMatches(spec.scope, target, allNames)) continue;
          if (spec.owner != null && !testPattern(spec.owner, node.name)) continue;
        }
        var val = readPath(node.props, spec.path);
        if (legacy ? (val != null && (typeof val === 'string' || typeof val === 'number'))
          : validIdentity(spec, val, node.props)) {
          ids[spec.as] = val;
          basis[spec.as] = {
            source: 'fiber_prop',
            path: spec.path,
            owner: node.name || null,
          };
        }
      }
    }
    return { chain: chain, allNames: allNames, ids: ids, basis: basis, legacy: legacy };
  }

  // -------------------------------------------------------------- actions
  var ACTION_EVENTS = ['click', 'copy', 'cut', 'paste', 'submit', 'change', 'keydown'];

  function describeTarget(el, eventType) {
    if (!el || !el.tagName) return {};
    var d = { tag: el.tagName.toLowerCase() };
    var t = d.tag === 'form'
      ? el
      : (el.closest ? (el.closest('button,a,[role="button"],[data-testid],[id],[aria-labelledby]') || el) : el);
    if (t.getAttribute) {
      var testid = t.getAttribute('data-testid');
      var id = t.getAttribute('id');
      var aria = t.getAttribute('aria-label');
      var labelledby = t.getAttribute('aria-labelledby');
      var title = t.getAttribute('title');
      var placeholder = t.getAttribute('placeholder');
      var sourceControl = eventType && t.getAttribute('data-producttrace-control-' + eventType);
      if (testid) d.testid = testid;
      if (id) d.id = id;
      if (aria) d.aria = aria;
      if (labelledby) d.labelledby = labelledby;
      if (title) d.title = title;
      if (placeholder) d.placeholder = placeholder;
      if (sourceControl) d.source_control = sourceControl;
      d.tag = t.tagName.toLowerCase();
    }
    // Short interactive-element text only; never content-bearing nodes.
    if ((d.tag === 'button' || d.tag === 'a') && t.textContent) {
      var txt = t.textContent.trim().slice(0, 60);
      if (txt) d.text = txt;
    }
    var dialog = t.closest ? t.closest('[role="dialog"]') : null;
    if (dialog) {
      var dialogTitle = dialog.getAttribute('aria-label');
      var labelledBy = dialog.getAttribute('aria-labelledby');
      if (!dialogTitle && labelledBy) {
        var labelled = document.getElementById(labelledBy);
        if (labelled) dialogTitle = labelled.textContent;
      }
      if (!dialogTitle && dialog.querySelector) {
        var heading = dialog.querySelector('h1,h2,h3,[role="heading"]');
        if (heading) dialogTitle = heading.textContent;
      }
      if (dialogTitle) d.dialog = dialogTitle.trim().slice(0, 60);
    }
    return d;
  }

  function selectionEvidence(el) {
    var controlLength = 0;
    var documentLength = 0;
    var documentElement = null;
    try {
      var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
      if ((tag === 'input' || tag === 'textarea') &&
          typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        controlLength = Math.max(0, el.selectionEnd - el.selectionStart);
      }

      // A browser copy event is dispatched to the focused control, even when
      // the user selected text elsewhere in the document. Resolve that real
      // range separately so identity comes from the selected product surface.
      var selection = window.getSelection ? window.getSelection() : null;
      documentLength = selection ? String(selection).length : 0;
      if (selection && documentLength > 0 && selection.rangeCount > 0) {
        var container = selection.getRangeAt(0).commonAncestorContainer;
        documentElement = container && container.nodeType === 1
          ? container
          : (container ? container.parentElement : null);
      }
    } catch (e) {}
    if (documentLength > 0 && documentElement) {
      return {
        state: { present: true, length: documentLength, source: 'document_range' },
        element: documentElement,
      };
    }
    return {
      state: {
        present: controlLength > 0,
        length: controlLength,
        source: controlLength > 0 ? 'control_range' : null,
      },
      element: el,
    };
  }

  function keyState(ev) {
    if (ev.type !== 'keydown') return null;
    var printable = typeof ev.key === 'string' && ev.key.length === 1 &&
      !ev.metaKey && !ev.ctrlKey && !ev.altKey;
    return {
      key: printable ? 'Printable' : ev.key,
      code: printable ? null : (ev.code || null),
      meta: ev.metaKey === true,
      ctrl: ev.ctrlKey === true,
      alt: ev.altKey === true,
      shift: ev.shiftKey === true,
      composing: ev.isComposing === true,
      repeat: ev.repeat === true,
    };
  }

  function isEvidenceMode() {
    return options.outputMode === 'evidence';
  }

  function evidenceStamp(record) {
    if (isEvidenceMode()) return emit(record);
    record.evidence_seq = ++evidenceSeq;
    record.evidence_id = 'browser:' + evidenceSeq;
    return record;
  }

  function namedTarget(target) {
    if (!target) return 'control';
    return target.aria || target.text || target.title || target.testid
      || target.placeholder || target.id || target.tag || 'control';
  }

  function formOf(el) {
    if (!el || !el.tagName) return null;
    if (el.tagName.toLowerCase() === 'form') return el;
    if (el.form) return el.form;
    return el.closest ? el.closest('form') : null;
  }

  function workflowSurfaceElement(el) {
    if (!el || !el.closest) return null;
    return el.closest('form,dialog,[role="dialog"],[role="menu"],[role="listbox"],[role="tree"],[role="tabpanel"],[aria-modal="true"]');
  }

  function workflowSurfaceId(el) {
    var surface = workflowSurfaceElement(el);
    if (!surface) return null;
    var id = workflowSurfaceIds.get(surface);
    if (!id) {
      id = 'surface_' + (++workflowSurfaceCounter);
      workflowSurfaceIds.set(surface, id);
    }
    return id;
  }

  function fieldDescriptor(el) {
    if (!isValueBearing(el)) return null;
    var label = null;
    try {
      if (el.getAttribute) label = el.getAttribute('aria-label');
      if (!label && el.labels && el.labels.length) label = el.labels[0].textContent;
      if (!label && el.getAttribute) label = el.getAttribute('placeholder') || el.getAttribute('name');
    } catch (_) {}
    var tag = el.tagName ? el.tagName.toLowerCase() : 'input';
    var type = tag === 'input' && el.getAttribute
      ? (el.getAttribute('type') || 'text').toLowerCase()
      : tag;
    var anchor = null;
    if (el.getAttribute) {
      var testid = el.getAttribute('data-testid');
      var id = el.getAttribute('id');
      var name = el.getAttribute('name');
      var aria = el.getAttribute('aria-label');
      if (testid) anchor = { kind: 'data-testid', value: testid };
      else if (id) anchor = { kind: 'id', value: id };
      else if (name) anchor = { kind: 'name', value: name };
      else if (aria) anchor = { kind: 'aria-label', value: aria };
    }
    return {
      key: (el.getAttribute && (el.getAttribute('name') || el.getAttribute('id'))) || label || type,
      name: String(label || type).trim().replace(/\s+/g, ' ').slice(0, 60),
      type: type,
      sensitive: type === 'password',
      anchor: anchor,
    };
  }

  function elementAnchorKeys(el) {
    var keys = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth++ < 8) {
      var attrs = [
        ['data-testid', 'data-testid'],
        ['id', 'id'],
        ['name', 'name'],
        ['aria-label', 'aria-label'],
        ['aria-labelledby', 'aria-labelledby'],
      ];
      for (var i = 0; i < attrs.length; i++) {
        var value = node.getAttribute && node.getAttribute(attrs[i][0]);
        if (value) keys.push(attrs[i][1] + ':' + String(value));
      }
      node = node.parentElement;
    }
    return keys;
  }

  function createOperation(form, actionRecord, sourceElement) {
    var target = form ? describeTarget(form) : actionRecord.target;
    var operation = {
      id: ++operationCounter,
      form: form,
      path: actionRecord.path,
      target: target,
      component: actionRecord.component,
      chain: actionRecord.chain || [],
      action: actionRecord.action || null,
      source_control: actionRecord.target && actionRecord.target.source_control || null,
      react_identity: actionRecord.react_identity || null,
      react_boundaries: actionRecord.react_boundaries || [],
      semantic_event: actionRecord.semantic_event || null,
      ids: Object.assign({}, actionRecord.ids || {}),
      trajectory_id: actionRecord.trajectory_id || null,
      step_id: actionRecord.step_id || null,
      attachment_basis: actionRecord.attachment_basis || null,
      anchor_keys: elementAnchorKeys(sourceElement),
      surface_id: workflowSurfaceId(sourceElement),
      revealed_surface_ids: {},
      fields: {},
      controls: [],
      effects: [],
      evidence_ids: [],
      stamps: [],
      trigger: null,
      submitted: false,
      checkpoint_type: null,
      terminal: false,
      timer: null,
      finalized: false,
    };
    pendingOperations.push(operation);
    if (form) pendingOperationByForm.set(form, operation);
    return operation;
  }

  function operationFor(form, actionRecord, sourceElement) {
    var existing = form ? pendingOperationByForm.get(form) : null;
    if (existing && !existing.finalized) return existing;
    return createOperation(form, actionRecord, sourceElement);
  }

  function addEvidence(operation, actionRecord) {
    if (!operation || !actionRecord) return;
    if (actionRecord.evidence_id) operation.evidence_ids.push(actionRecord.evidence_id);
    var stamp = actionRecord.evidence_seq;
    if (Number.isInteger(stamp)) {
      operation.stamps.push(stamp);
      operationByStamp[stamp] = operation;
    }
    Object.assign(operation.ids, actionRecord.ids || {});
    if (actionRecord.action) operation.action = actionRecord.action;
    if (actionRecord.target && actionRecord.target.source_control) {
      operation.source_control = actionRecord.target.source_control;
    }
    if (actionRecord.semantic_event) operation.semantic_event = actionRecord.semantic_event;
    if (actionRecord.trajectory_id != null) operation.trajectory_id = actionRecord.trajectory_id;
    if (actionRecord.step_id != null) operation.step_id = actionRecord.step_id;
    if (actionRecord.attachment_basis) operation.attachment_basis = actionRecord.attachment_basis;
    if (actionRecord.component && !operation.component) operation.component = actionRecord.component;
    if (actionRecord.react_identity) operation.react_identity = actionRecord.react_identity;
  }

  function addFieldEvidence(operation, el, eventType) {
    var field = fieldDescriptor(el);
    if (!field) return;
    var current = operation.fields[field.key] || {
      name: field.name,
      type: field.type,
      sensitive: field.sensitive,
      anchor: field.anchor,
      edited: false,
    };
    var wasEdited = current.edited;
    if (eventType === 'change' || eventType === 'keydown'
        || (eventType === 'click' && (field.type === 'checkbox' || field.type === 'radio'))) {
      current.edited = true;
    }
    operation.fields[field.key] = current;
    return current.edited && !wasEdited;
  }

  function compactEffect(type, detail, evidenceId) {
    var effect = { type: type, evidence_id: evidenceId };
    if (detail && Array.isArray(detail.surfaces)) {
      effect.surfaces = detail.surfaces.slice(0, 5).map(function (surface) {
        return { anchor: surface.anchor || null, component: surface.component || null };
      });
      effect.total = detail.total || detail.surfaces.length;
    }
    if (detail && detail.method) effect.method = String(detail.method).slice(0, 20);
    if (detail && (detail.path || detail.url)) effect.path = String(detail.path || detail.url).slice(0, 200);
    return effect;
  }

  function operationCaption(operation, kind) {
    if (kind === 'form_submit') {
      return 'Submitted “' + namedTarget(operation.target) + '”'
        + (operation.trigger && operation.trigger.label ? ' using “' + operation.trigger.label + '”' : '') + '.';
    }
    if (kind === 'field_change') {
      var changedFields = Object.keys(operation.fields).map(function (key) { return operation.fields[key].name; });
      return 'Filled “' + (changedFields[0] || 'field') + '”.';
    }
    var trigger = operation.trigger || {};
    var verb = trigger.event === 'click' ? 'Clicked' : 'Used';
    return verb + ' “' + (trigger.label || namedTarget(operation.target)) + '”.';
  }

  function operationKind(operation) {
    if (operation.checkpoint_type === 'field_change') return 'field_change';
    if (operation.form) return operation.submitted ? 'form_submit' : 'form_interaction';
    return 'interaction';
  }

  function compactEvidence(operation) {
    return {
      ids: operation.evidence_ids.slice(0, 4).concat(operation.evidence_ids.length > 4
        ? [operation.evidence_ids[operation.evidence_ids.length - 1]] : []),
      count: operation.evidence_ids.length,
      omitted: Math.max(0, operation.evidence_ids.length - 5),
    };
  }

  function effectAnchorKeys(operation) {
    var keys = [];
    for (var i = 0; i < operation.effects.length; i++) {
      var surfaces = operation.effects[i].surfaces || [];
      for (var j = 0; j < surfaces.length; j++) {
        var anchor = surfaces[j].anchor;
        if (anchor && anchor.kind && anchor.value != null) keys.push(anchor.kind + ':' + String(anchor.value));
      }
    }
    return keys;
  }

  function operationAnchorKeys(operation) {
    var keys = operation.anchor_keys.slice();
    Object.keys(operation.fields).forEach(function (fieldKey) {
      var anchor = operation.fields[fieldKey].anchor;
      if (anchor && anchor.kind && anchor.value != null) keys.push(anchor.kind + ':' + String(anchor.value));
    });
    return keys;
  }

  function sharedIdentity(left, right) {
    var keys = Object.keys(left || {});
    for (var i = 0; i < keys.length; i++) {
      if (left[keys[i]] != null && right && right[keys[i]] === left[keys[i]]) return true;
    }
    return false;
  }

  function workflowRelated(workflow, operation) {
    if (!workflow) return false;
    if (operation.form && workflow.forms.indexOf(operation.form) !== -1) return true;
    if (operation.surface_id && workflow.enabled_surface_ids[operation.surface_id]) return true;
    if (sharedIdentity(workflow.ids, operation.ids)) return true;
    if (workflow.trajectory_id != null && workflow.trajectory_id === operation.trajectory_id) return true;
    var anchors = operationAnchorKeys(operation);
    for (var i = 0; i < anchors.length; i++) {
      if (workflow.enabled_anchors[anchors[i]]) return true;
    }
    return false;
  }

  function workflowLabel(operation) {
    if (operation.form) return namedTarget(operation.target);
    return operation.trigger && operation.trigger.label
      ? operation.trigger.label
      : namedTarget(operation.target);
  }

  function workflowEvent(workflow, eventType, caption, checkpoint, finalSummary) {
    var eventIndex = ++workflow.event_index;
    return emit({
      kind: 'workflow_event',
      schema: 'producttrace.workflow-event.v1',
      event_type: eventType,
      event_id: workflow.id + ':event_' + eventIndex,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      trace_id: workflow.id,
      workflow_id: workflow.id,
      trajectory_id: workflow.trajectory_id,
      step_id: workflow.step_id,
      source: 'producttrace.browser',
      properties: {
        caption: caption,
        workflow_label: workflow.label,
        workflow_status: workflow.status,
        checkpoint: checkpoint,
        summary: finalSummary,
        entities: Object.assign({}, workflow.ids),
        learning: {
          role: 'trajectory_context',
          standalone_training_signal: workflow.status === 'completed' && workflow.terminal_result_proven,
          reason: workflow.status === 'completed' && workflow.terminal_result_proven
            ? 'A terminal result is supported by source and runtime evidence.'
            : 'Use as trajectory context until a terminal result or explicit feedback is proven.',
        },
      },
      metadata: { source_schema: 'producttrace.workflow-event.v1' },
    });
  }

  function resetWorkflowIdle(workflow) {
    if (workflow.idle_timer) clearTimeout(workflow.idle_timer);
    workflow.idle_timer = setTimeout(function () {
      if (activeWorkflow === workflow) finishWorkflow(null, 'idle');
    }, Math.max(1000, Number(options.workflowIdleMs) || 30000));
  }

  function startWorkflow(operation) {
    var workflow = {
      id: sessionId + ':workflow_' + (++workflowCounter),
      label: workflowLabel(operation),
      status: 'pending',
      event_index: 0,
      checkpoints: [],
      forms: [],
      enabled_anchors: {},
      enabled_surface_ids: {},
      ids: {},
      trajectory_id: operation.trajectory_id || null,
      step_id: operation.step_id || null,
      terminal_result_proven: false,
      has_workflow_signal: false,
      idle_timer: null,
    };
    activeWorkflow = workflow;
    return workflow;
  }

  function finishWorkflow(forcedStatus, reason) {
    var workflow = activeWorkflow;
    if (!workflow) return null;
    if (workflow.idle_timer) clearTimeout(workflow.idle_timer);
    var status = forcedStatus;
    if (!status) status = workflow.has_workflow_signal || workflow.checkpoints.length > 1 ? 'incomplete' : 'action';
    workflow.status = status;
    var caption = status === 'completed'
      ? 'Completed “' + workflow.label + '”.'
      : (status === 'incomplete'
        ? 'Worked on “' + workflow.label + '” without completing it.'
        : (workflow.checkpoints[0] ? workflow.checkpoints[0].caption : 'Observed an action.'));
    var summary = {
      reason: reason || status,
      steps: workflow.checkpoints.map(function (checkpoint) {
        return { index: checkpoint.index, caption: checkpoint.caption, type: checkpoint.type };
      }),
      terminal_result_proven: workflow.terminal_result_proven,
    };
    var record = workflowEvent(workflow,
      status === 'completed' ? 'product.workflow_completed'
        : (status === 'incomplete' ? 'product.workflow_incomplete' : 'product.action_observed'),
      caption, null, summary);
    if (activeWorkflow === workflow) activeWorkflow = null;
    return record;
  }

  function recordWorkflowCheckpoint(operation, properties) {
    if (activeWorkflow && !workflowRelated(activeWorkflow, operation)) finishWorkflow(null, 'new_unrelated_action');
    var isNew = !activeWorkflow;
    var workflow = activeWorkflow || startWorkflow(operation);
    if (operation.form && workflow.forms.indexOf(operation.form) === -1) workflow.forms.push(operation.form);
    Object.assign(workflow.ids, operation.ids || {});
    if (operation.trajectory_id != null) workflow.trajectory_id = operation.trajectory_id;
    if (operation.step_id != null) workflow.step_id = operation.step_id;
    var enabled = effectAnchorKeys(operation);
    for (var i = 0; i < enabled.length; i++) workflow.enabled_anchors[enabled[i]] = true;
    Object.keys(operation.revealed_surface_ids).forEach(function (surfaceId) {
      workflow.enabled_surface_ids[surfaceId] = true;
    });
    if (operation.form || enabled.length || Object.keys(operation.revealed_surface_ids).length) workflow.has_workflow_signal = true;
    workflow.terminal_result_proven = workflow.terminal_result_proven
      || properties.outcome.terminal_result_proven;
    var checkpoint = {
      index: workflow.checkpoints.length + 1,
      caption: properties.caption,
      type: properties.operation_type,
      surface: properties.surface,
      trigger: properties.trigger,
      control: properties.control,
      fields: properties.fields,
      entities: properties.entities,
      source_action: properties.source_action,
      source_control: properties.source_control,
      react_identity: properties.react_identity,
      react_boundaries: properties.react_boundaries || [],
      outcome: properties.outcome,
      evidence: properties.evidence,
      uncertainty: properties.uncertainty,
    };
    workflow.checkpoints.push(checkpoint);
    workflowEvent(workflow, isNew ? 'product.workflow_started' : 'product.workflow_checkpoint',
      properties.caption, checkpoint, null);
    if (operation.submitted) return finishWorkflow('completed', 'form_submitted');
    resetWorkflowIdle(workflow);
    return workflow;
  }

  function finalizeOperation(operation) {
    if (!operation || operation.finalized || !operation.terminal) return null;
    // Timers can finish out of order. Emit any earlier complete operation first
    // so a fast follow-up cannot become the apparent cause of its prerequisite.
    var firstStamp = operation.stamps.length ? Math.min.apply(null, operation.stamps) : Infinity;
    var earlier = pendingOperations.filter(function (candidate) {
      if (candidate === operation || candidate.finalized || !candidate.terminal) return false;
      var candidateStamp = candidate.stamps.length ? Math.min.apply(null, candidate.stamps) : Infinity;
      return candidateStamp < firstStamp;
    }).sort(function (left, right) {
      return Math.min.apply(null, left.stamps) - Math.min.apply(null, right.stamps);
    });
    for (var before = 0; before < earlier.length; before++) finalizeOperation(earlier[before]);
    operation.finalized = true;
    if (operation.timer) clearTimeout(operation.timer);
    for (var i = 0; i < operation.stamps.length; i++) delete operationByStamp[operation.stamps[i]];
    var pendingIndex = pendingOperations.indexOf(operation);
    if (pendingIndex !== -1) pendingOperations.splice(pendingIndex, 1);
    var kind = operationKind(operation);
    var fields = Object.keys(operation.fields).map(function (key) { return operation.fields[key]; });
    var unresolved = [];
    if (!operation.action) unresolved.push('business meaning has no verified source binding');
    if (!Object.keys(operation.ids).length) unresolved.push('no product entity identity was proven');
    var terminalResultProven = !!operation.semantic_event && operation.effects.length > 0;
    if (!terminalResultProven) unresolved.push('terminal product result was not proven');
    return recordWorkflowCheckpoint(operation, {
      caption: operationCaption(operation, kind),
      operation_type: kind,
      surface: { path: operation.path, component: operation.component || null },
      trigger: operation.trigger,
      control: operation.target,
      fields: fields,
      entities: operation.ids,
      source_action: operation.action,
      source_control: operation.source_control,
      react_identity: operation.react_identity,
      react_boundaries: operation.react_boundaries || [],
      outcome: {
        status: terminalResultProven ? 'proven' : 'unresolved',
        terminal_result_proven: terminalResultProven,
        observed_effects: operation.effects,
      },
      evidence: compactEvidence(operation),
      uncertainty: unresolved,
    });
  }

  function scheduleOperation(operation, delay) {
    if (!operation || !operation.terminal || operation.finalized) return;
    if (operation.timer) clearTimeout(operation.timer);
    var settle = delay == null ? Number(options.operationSettleMs) : Number(delay);
    operation.timer = setTimeout(function () { finalizeOperation(operation); }, Math.max(0, settle || 0));
  }

  function absorbAction(ev, el, actionRecord) {
    var form = formOf(el);
    var valueBearing = isValueBearing(el);
    if (!form && valueBearing) return null;
    var submitLike = ev.type === 'submit'
      || (ev.type === 'click' && form && el.matches && el.matches('button[type="submit"],input[type="submit"],button:not([type])'));

    if (form || valueBearing) {
      var previous = form ? pendingOperationByForm.get(form) : null;
      var startsCheckpoint = ev.type === 'click' || ev.type === 'submit'
        || (ev.type === 'keydown' && actionRecord.key && actionRecord.key.key === 'Enter');
      // Separate distinct controls even when they are activated faster than the
      // settle timer. Keep a submit event with the submit-button click that
      // caused it so one browser activation remains one checkpoint.
      if (previous && !previous.finalized && previous.terminal && startsCheckpoint
          && !(previous.submitted && ev.type === 'submit')) finalizeOperation(previous);
      var operation = operationFor(form, actionRecord, el);
      var firstFieldEdit = addFieldEvidence(operation, el, ev.type);
      if (valueBearing) {
        if (!operation.submitted) {
          operation.terminal = false;
          if (operation.timer) clearTimeout(operation.timer);
        }
        if (ev.type === 'keydown' && actionRecord.key && actionRecord.key.key === 'Enter') {
          addEvidence(operation, actionRecord);
          operation.trigger = { event: 'keydown', label: 'Enter', component: actionRecord.component || null };
        } else if (firstFieldEdit) {
          addEvidence(operation, actionRecord);
        }
        if (ev.type === 'change' || (ev.type === 'click' && firstFieldEdit)) {
          operation.checkpoint_type = 'field_change';
          operation.terminal = true;
          finalizeOperation(operation);
        }
        return operation;
      }
      addEvidence(operation, actionRecord);
      if (ev.type === 'keydown' && actionRecord.key && actionRecord.key.key === 'Enter') {
        operation.trigger = { event: 'keydown', label: 'Enter', component: actionRecord.component || null };
      } else if (ev.type === 'click' && !valueBearing) {
        var label = namedTarget(actionRecord.target);
        operation.controls.push({ event: 'click', label: label, evidence_id: actionRecord.evidence_id });
        operation.trigger = { event: 'click', label: label, component: actionRecord.component || null };
      }
      if (submitLike) {
        operation.submitted = true;
        operation.terminal = true;
        scheduleOperation(operation);
      } else if (ev.type === 'click' && !valueBearing) {
        operation.terminal = true;
        scheduleOperation(operation, Math.min(150, Math.max(50, Number(options.operationSettleMs) || 0)));
      }
      return operation;
    }

    if (ev.type === 'keydown' && actionRecord.key && actionRecord.key.key === 'Printable') return null;
    var standalone = createOperation(null, actionRecord, el);
    addEvidence(standalone, actionRecord);
    standalone.trigger = {
      event: ev.type,
      label: namedTarget(actionRecord.target),
      component: actionRecord.component || null,
    };
    standalone.terminal = true;
    scheduleOperation(standalone);
    return standalone;
  }

  function flushOperations() {
    var active = pendingOperations.slice();
    for (var i = 0; i < active.length; i++) finalizeOperation(active[i]);
  }

  function flushWorkflow(reason) {
    flushOperations();
    if (!isEvidenceMode()) finishWorkflow(null, reason || 'flush');
  }

  // ------------------------------------------------------------ discovery
  function implicitRole(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    return null;
  }

  function discoveryTarget(el) {
    if (!el || !el.tagName) return el;
    return el.closest
      ? (el.closest('button,a,input,textarea,select,[role],[data-testid],[id],[aria-labelledby]') || el)
      : el;
  }

  function isValueBearing(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }

  function accessibleName(el) {
    if (!el || !el.getAttribute) return null;
    var aria = el.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 40);
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\s+/).map(function (id) {
        var node = document.getElementById(id);
        return node && node.textContent ? node.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 40);
    }
    if (isValueBearing(el)) return '[input]';
    var text = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '';
    return text ? text.slice(0, 40) : null;
  }

  function discoveryAnchors(el) {
    var target = discoveryTarget(el);
    if (!target || !target.tagName) return [{ kind: 'node', value: 'unknown' }];
    var anchors = [];
    var testid = target.getAttribute && target.getAttribute('data-testid');
    var id = target.getAttribute && target.getAttribute('id');
    var aria = target.getAttribute && target.getAttribute('aria-label');
    var labelledby = target.getAttribute && target.getAttribute('aria-labelledby');
    var role = target.getAttribute && target.getAttribute('role');
    role = role || implicitRole(target);
    var name = accessibleName(target);
    var tag = target.tagName.toLowerCase();
    if (testid) anchors.push({ kind: 'data-testid', value: testid.slice(0, 64) });
    if (id) anchors.push({ kind: 'id', value: id.slice(0, 64) });
    if (aria) anchors.push({ kind: 'aria-label', value: aria.slice(0, 64) });
    if (labelledby) anchors.push({ kind: 'aria-labelledby', value: labelledby.slice(0, 64) });
    if (role && name) anchors.push({ kind: 'role+name', value: (role + ':' + name).slice(0, 64) });
    var text = isValueBearing(target) ? '[input]' : accessibleName(target);
    anchors.push({ kind: 'tag+text', value: (tag + ':' + (text || '')).slice(0, 64) });
    return anchors;
  }

  function identityShape(value) {
    if (typeof value !== 'string') return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return 'uuid';
    if (/^[0-9a-f]{24}$/i.test(value)) return 'objectid';
    if (/^[A-Za-z0-9_-]{10,64}$/.test(value) && /[A-Za-z]/.test(value) && /[0-9_-]/.test(value)) return 'nanoid';
    return null;
  }

  function discoveryFiberEvidence(fiber, valueBearing) {
    var components = [];
    var nodes = [];
    var f = fiber;
    var hops = 0;
    while (f && hops < 60 && nodes.length < 16) {
      var isComponent = typeof f.type === 'function' || (f.type && typeof f.type === 'object');
      if (isComponent) {
        var name = nameOfType(f.type);
        if (name && components.length < 8 && components[components.length - 1] !== name) components.push(name);
        nodes.push({ name: name || null, props: f.memoizedProps });
      }
      f = f.return;
      hops++;
    }
    var candidates = [];
    var candidateSeen = {};
    function visit(value, path, depth, component, visited, budget) {
      if (budget.count >= 300 || value == null || depth > 3) return;
      var scalar = typeof value === 'string' || typeof value === 'number';
      if (scalar) {
        var key = path.split('.').pop();
        var shape = identityShape(value);
        if (/id$|Id$|^id$|uuid|key$|slug/i.test(key) || shape) {
          var sample = valueBearing && /^value$/i.test(key) ? '[input]' : String(value).slice(0, 64);
          var candidateKey = (component || '') + '\u0000' + path + '\u0000' + sample;
          if (!candidateSeen[candidateKey]) {
            candidateSeen[candidateKey] = true;
            candidates.push({
              path: path,
              key: key,
              sample: sample,
              component: component || null,
              reason: /id$|Id$|^id$|uuid|key$|slug/i.test(key) ? 'key' : shape,
            });
          }
        }
        return;
      }
      if (typeof value !== 'object' || value.nodeType || visited.indexOf(value) !== -1) return;
      visited.push(value);
      var keys;
      try { keys = Object.keys(value).sort(); } catch (e) { visited.pop(); return; }
      for (var i = 0; i < keys.length && budget.count < 300; i++) {
        var key = keys[i];
        if (key === 'children' || key === 'dangerouslySetInnerHTML') continue;
        var child;
        try { child = value[key]; } catch (e) { continue; }
        if (typeof child === 'function' || typeof child === 'symbol') continue;
        budget.count++;
        visit(child, path ? path + '.' + key : key, depth + 1, component, visited, budget);
      }
      visited.pop();
    }
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].props) visit(nodes[i].props, '', 0, nodes[i].name, [], { count: 0 });
    }
    candidates.sort(function (a, b) {
      return String(a.component).localeCompare(String(b.component)) || a.path.localeCompare(b.path) || a.sample.localeCompare(b.sample);
    });
    return { components: components, candidates: candidates };
  }

  function recordDiscovery(ev, el, fiberEvidence) {
    if (!discoverEnabled) return;
    var target = discoveryTarget(el);
    var anchors = discoveryAnchors(target);
    var component = fiberEvidence.components[0] || null;
    var anchor = anchors[0];
    var key = (component || '') + '\u0000' + anchor.kind + '\u0000' + anchor.value;
    var existing = discoveryByKey[key];
    if (existing) {
      if (existing.events.indexOf(ev.type) === -1) existing.events.push(ev.type);
      return;
    }
    if (discoveryEntries.length >= MAX_DISCOVERY) {
      discoveryTruncated = true;
      return;
    }
    var entry = {
      anchor: anchor,
      anchors: anchors,
      component: component,
      components: fiberEvidence.components,
      events: [ev.type],
      identity_candidates: fiberEvidence.candidates,
    };
    discoveryByKey[key] = entry;
    discoveryEntries.push(entry);
  }

  function discoveryReport() {
    return {
      schema: 'producttrace.discovery.v1',
      session: sessionId,
      enabled: discoverEnabled,
      discovery_truncated: discoveryTruncated,
      count: discoveryEntries.length,
      entries: JSON.parse(JSON.stringify(discoveryEntries)),
    };
  }

  function stableMountAnchor(control) {
    var anchors = control && control.anchors || [];
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].kind === 'data-testid') return anchors[i];
    }
    for (var j = 0; j < anchors.length; j++) {
      if (anchors[j].kind === 'id') return anchors[j];
    }
    for (var k = 0; k < anchors.length; k++) {
      if (anchors[k].kind === 'aria-label') return anchors[k];
    }
    for (var l = 0; l < anchors.length; l++) {
      if (anchors[l].kind === 'aria-labelledby') return anchors[l];
    }
    return null;
  }

  function visibleMountedNode(node) {
    if (typeof node.getBoundingClientRect !== 'function') return true;
    try {
      var rect = node.getBoundingClientRect();
      var style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(node) : null;
      return rect.width > 0 && rect.height > 0
        && (!style || style.display !== 'none' && style.visibility !== 'hidden');
    } catch (_) {
      return false;
    }
  }

  function captureFiberMounts(root, rootId, commitId) {
    var next = {};
    var newlyMounted = [];
    var newlyRevealedStable = [];
    var newlyRevealedSurfaceElements = [];
    var previousStable = {};
    var currentStable = {};
    Object.keys(mountedControls).forEach(function (key) {
      var anchor = stableMountAnchor(mountedControls[key]);
      if (anchor) previousStable[anchor.kind + ':' + anchor.value] = true;
    });
    var actionStamp = Number.isInteger(window[ACTION_STAMP_GLOBAL])
      ? window[ACTION_STAMP_GLOBAL] : pendingReactActionStamp;
    var stack = root && root.current ? [root.current] : [];
    var visited = 0;
    while (stack.length && visited++ < 20000) {
      var fiber = stack.pop();
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
      recordFiberIdentity(fiber, rootId, commitId);
      commitFiberLifecycle(fiber);
      boundaryCommitObserver.commit(fiber,fiberIdentities.get(fiber));
      if(fiber.tag===13)lazyCommitObserver.boundaryCommit(fiber,boundaryCommitObserver.currentCommit(fiber));
      lazyCommitObserver.commit(fiber,fiberIdentities.get(fiber));
      portalCommitObserver.commit(fiber,fiberIdentities.get(fiber));
      var descriptorRender=getFiberRender(fiber),descriptorIdentity=fiberIdentities.get(fiber);
      descriptorObserver.commit(fiber,Object.assign({},descriptorIdentity,{render_id:descriptorRender && descriptorRender.status==='committed'?descriptorRender.render_id:null}));
      if(descriptorRender && descriptorRender.status==='committed')refCommitObserver.commitOwner(Object.assign({},descriptorIdentity,{render_id:descriptorRender.render_id}));
      if(fiber.tag===5)refCommitObserver.commit(fiber,Object.assign({},descriptorIdentity,
        {render_id:descriptorRender && descriptorRender.status==='committed'?descriptorRender.render_id:null}));
      if(fiber.tag===5){
        var idOwner=fiber.return,idOwnerRender=null;
        while(idOwner&&!idOwnerRender){idOwnerRender=getFiberRender(idOwner);idOwner=idOwner.return;}
        if(idOwnerRender && idOwnerRender.status==='committed')idCommitObserver.commit(fiber,descriptorIdentity,
          Object.assign({},idOwnerRender.identity,{render_id:idOwnerRender.render_id}));
      }
      var node = fiber.stateNode;
      if (!node || node.nodeType !== 1 || !node.isConnected || typeof node.getAttribute !== 'function'
          || !visibleMountedNode(node)) continue;
      var anchors = discoveryAnchors(node);
      var useful = anchors.filter(function (anchor) {
        return anchor.kind === 'data-testid' || anchor.kind === 'id'
          || anchor.kind === 'aria-label' || anchor.kind === 'aria-labelledby'
          || anchor.kind === 'role+name';
      });
      if (!useful.length) continue;
      var evidence = discoveryFiberEvidence(fiber, isValueBearing(node));
      var control = {
        anchors: useful,
        component: evidence.components[0] || null,
        components: evidence.components.slice(0, 6),
      };
      var key = (control.component || '') + '\u0000' + useful.map(function (anchor) { return anchor.kind + ':' + anchor.value; }).join('\u0001');
      next[key] = control;
      if (!mountedControls[key]) {
        mountEvents.push({ cursor: ++mountCursor, control: control });
        if (mountEvents.length > 5000) mountEvents.shift();
        newlyMounted.push(control);
      }
      var stableAnchor = stableMountAnchor(control);
      if (stableAnchor) {
        var stableKey = stableAnchor.kind + ':' + stableAnchor.value;
        if (!previousStable[stableKey] && !currentStable[stableKey]) {
          newlyRevealedStable.push({
            anchor: { kind: stableAnchor.kind, value: String(stableAnchor.value).slice(0, 120) },
            component: control.component || null,
          });
          newlyRevealedSurfaceElements.push(node);
        }
        currentStable[stableKey] = true;
      }
    }
    mountedControls = next;
    if (isEvidenceMode()) {
      for (var offset = 0; started && offset < newlyMounted.length; offset += 100) {
        emit({
          kind: 'mount',
          path: location.pathname,
          controls: newlyMounted.slice(offset, offset + 100),
        });
      }
    }
    if (Number.isInteger(actionStamp) && newlyRevealedStable.length) {
      effectFromStamp('surface_change', {
        adapter: 'react-devtools-commit.v1',
        surfaces: newlyRevealedStable.slice(0, 20),
        total: newlyRevealedStable.length,
        textContentCaptured: false,
        correlationWindow: 'next_react_commit_before_next_task',
      }, actionStamp, newlyRevealedSurfaceElements);
    }
    if (Number.isInteger(actionStamp) && pendingReactActionStamp === actionStamp) {
      pendingReactActionStamp = null;
      pendingReactActionToken++;
    }
  }

  function mountSnapshot() {
    return { cursor: mountCursor, controls: JSON.parse(JSON.stringify(Object.keys(mountedControls).sort().map(function (key) { return mountedControls[key]; }))) };
  }

  function mountDiff(cursor) {
    return {
      cursor: mountCursor,
      controls: JSON.parse(JSON.stringify(mountEvents.filter(function (entry) { return entry.cursor > (cursor || 0); }).map(function (entry) { return entry.control; }))),
    };
  }

  function discover(enabled) {
    discoverEnabled = enabled !== false;
    return discoveryReport();
  }

  function matchBinding(ev, target, chain, state) {
    var acts = bindings.actions || [];
    for (var i = 0; i < acts.length; i++) {
      var b = acts[i];
      if (b.event && b.event !== ev.type) continue;
      if (b.sourceControl != null && !testPattern(b.sourceControl, target.source_control)) continue;
      if (b.testid != null && !testPattern(b.testid, target.testid)) continue;
      if (b.id != null && !testPattern(b.id, target.id)) continue;
      if (b.aria != null && !testPattern(b.aria, target.aria)) continue;
      if (b.labelledby != null && !testPattern(b.labelledby, target.labelledby)) continue;
      if (b.placeholder != null && !testPattern(b.placeholder, target.placeholder)) continue;
      if (b.text != null && !testPattern(b.text, target.text)) continue;
      if (b.dialog != null && !testPattern(b.dialog, target.dialog)) continue;
      if (b.route != null && !testPattern(b.route, window.location.pathname)) continue;
      if (b.title != null && !testPattern(b.title, target.title)) continue;
      if (b.key != null && !testPattern(b.key, ev.key)) continue;
      if (b.meta != null && b.meta !== (ev.metaKey === true)) continue;
      if (b.ctrl != null && b.ctrl !== (ev.ctrlKey === true)) continue;
      if (b.alt != null && b.alt !== (ev.altKey === true)) continue;
      if (b.shift != null && b.shift !== (ev.shiftKey === true)) continue;
      if (b.composing != null && b.composing !== (ev.isComposing === true)) continue;
      if (b.selection === 'nonempty' && !state.selection.present) continue;
      if (b.component) {
        if (!componentMatches(b.component, chain)) continue;
      }
      return b;
    }
    return null;
  }

  function semanticEventFromBinding(binding, trusted, path) {
    var semantic = binding && binding.semantic;
    if (!semantic || semantic.schema !== 'producttrace.semantic-template.v1'
        || !/^[a-z][a-z0-9_]*$/.test(semantic.verb || '')
        || !/^[a-z][a-z0-9_]*$/.test(semantic.object_type || '')
        || !/^[a-z_]+$/.test(semantic.expected_effect_type || '')
        || !/^[0-9a-f]{64}$/.test(semantic.source_event_fingerprint || '')) return null;
    return {
      schema: 'producttrace.semantic-event.v1',
      actor: { kind: trusted ? 'user' : 'application', id: null, role: null },
      action: {
        verb: semantic.verb,
        object_type: semantic.object_type,
        object_id: semantic.object_id == null ? null : String(semantic.object_id),
      },
      context: { route: path, parent_type: null, parent_id: null },
      outcome: { status: 'initiated', effect_type: semantic.expected_effect_type },
      evidence: {
        target: { kind: 'generated_runtime_binding' },
        effect: { source_event_fingerprint: semantic.source_event_fingerprint },
      },
    };
  }

  function hasFiberEventHandler(fiber, eventType) {
    var prop = eventType === 'click' ? 'onClick' : null;
    if (!prop) return false;
    var node = fiber;
    var depth = 0;
    while (node && depth++ < 12) {
      var props = node.memoizedProps || node.pendingProps;
      if (props && typeof props[prop] === 'function') return true;
      node = node.return;
    }
    return false;
  }

  function isMeaningfulClick(el, fiber, binding) {
    if (binding || !el || !el.closest) return !!binding;
    if (el.closest('button,a[href],input,textarea,select,summary,[contenteditable="true"]')) return true;
    var roleNode = el.closest('[role]');
    if (roleNode && /^(button|link|menuitem|option|tab|checkbox|radio|switch|combobox|treeitem)$/.test(roleNode.getAttribute('role') || '')) return true;
    return hasFiberEventHandler(fiber, 'click');
  }

  function activationElement(eventType, el) {
    if (eventType !== 'click' || !el || !el.closest) return el;
    return el.closest('button,a[href],input,textarea,select,summary,[contenteditable="true"],[role]')
      || el.closest('[data-testid],[aria-label]')
      || el;
  }

  function onAction(ev) {
    // Ignore synthetic/no-target noise.
    var el = ev.target;
    if (!el || el.nodeType !== 1) return;
    var reservedStamp = isEvidenceMode() ? seq + 1 : evidenceSeq + 1;
    exposeActionStamp(reservedStamp);
    // Capture wide: programmatic events are recorded too, carrying
    // trusted:false — downstream consumers filter, we never silently drop.
    var actionEl = isEvidenceMode() ? el : activationElement(ev.type, el);
    var target = describeTarget(actionEl, ev.type);
    var selection = selectionEvidence(el);
    var evidenceEl = (ev.type === 'copy' || ev.type === 'cut') && selection.state.present
      ? (selection.element || el)
      : actionEl;
    var evidenceTarget = describeTarget(evidenceEl, ev.type);
    var fiber = fiberOf(evidenceEl);
    // One bounded ancestry walk feeds both the per-action evidence stream and
    // the optional aggregate discovery report. Keeping this as one seam avoids
    // two subtly different definitions of an identity candidate.
    var fiberEvidence = fiber
      ? discoveryFiberEvidence(fiber, isValueBearing(discoveryTarget(evidenceEl)))
      : { components: [], candidates: [] };
    recordDiscovery(ev, evidenceEl, fiberEvidence);
    var res = fiber ? resolveFiberEvidence({ fiber: fiber, target: evidenceTarget })
      : { chain: [], allNames: [], ids: {}, basis: {}, legacy: false };
    var state = { selection: selection.state };
    var b = matchBinding(ev, target, res.allNames, state);
    // A click on passive layout is not a user checkpoint. Evidence mode keeps
    // it for analyzer fixtures; the product timeline only keeps activations.
    if (!isEvidenceMode() && ev.type === 'click' && !isMeaningfulClick(el, fiber, b)) return;
    if (!isEvidenceMode() && ev.type === 'keydown' && !b && !isValueBearing(el)) return;
    var idcfg = bindings.identity || {};
    var routeRes = resolveRouteIdentity();
    var routeIds = routeRes.ids;
    var trajectory = res.ids[idcfg.trajectoryKey] != null ? res.ids[idcfg.trajectoryKey]
      : (routeIds[idcfg.trajectoryKey] != null ? routeIds[idcfg.trajectoryKey] : null);
    var step = res.ids[idcfg.stepKey] != null ? res.ids[idcfg.stepKey] : null;
    var attachmentBasis = step != null ? res.basis[idcfg.stepKey]
      : (trajectory != null ? (res.basis[idcfg.trajectoryKey] || routeRes.basis[idcfg.trajectoryKey]) : null);
    var actionRecord = evidenceStamp({
      kind: 'action',
      path: location.pathname,
      event: ev.type,
      trusted: ev.isTrusted === true,
      target: target,
      evidence_target: evidenceEl !== el ? evidenceTarget : null,
      component: res.chain[0] || null,
      chain: res.chain,
      fiber_evidence: {
        components: fiberEvidence.components,
        identity_candidates: fiberEvidence.candidates,
      },
      react_identity: fiberRuntimeIdentity(fiber),
      react_boundaries: boundaryCommitObserver.ancestry(fiber),
      react_portals: portalCommitObserver.ancestry(fiber),
      react_lifecycle_identity: nearestCommittedLifecycleIdentity(fiber),
      ids: res.ids,
      identity_basis: res.basis,
      attachment_basis: attachmentBasis || null,
      identity_schema: res.legacy ? 'legacy-global' : 'scoped-v1',
      action: b ? b.action : null,
      semantic_event: b ? semanticEventFromBinding(b, ev.isTrusted === true, location.pathname) : null,
      direction: b ? (b.direction || null) : null,
      selection: ev.type === 'copy' || ev.type === 'cut' ? state.selection : null,
      key: keyState(ev),
      trajectory_id: trajectory,
      step_id: step,
      attach: step != null ? 'step' : (trajectory != null ? 'trajectory' : 'none'),
    });
    var actionStamp = isEvidenceMode() ? actionRecord.seq : actionRecord.evidence_seq;
    actionEventStamps.set(ev, actionStamp);
    activeNativeActionEvent=ev;
    actionRecordsByStamp[actionStamp] = actionRecord;
    var oldActionStamp = actionStamp - 100;
    if (oldActionStamp > 0) delete actionRecordsByStamp[oldActionStamp];
    if (!isEvidenceMode()) absorbAction(ev, actionEl, actionRecord);
    if (actionRecord.trusted === true) armNextReactCommit(actionStamp);
    // Announcers run after this capture listener. The stamp was exposed before
    // any fallible observation work and must still identify the emitted action.
    if (actionStamp !== reservedStamp) exposeActionStamp(actionStamp);
  }

  var EFFECT_TYPES = {
    clipboard_write: true,
    navigation: true,
    dialog_open: true,
    download: true,
    selection_change: true,
    network_request: true,
    media_capture: true,
    persistence_write: true,
    data_mutation: true,
    surface_change: true,
  };

  function effectFromStamp(type, detail, stamp, revealedSurfaceElements) {
    if (stamp == null || !EFFECT_TYPES[type]) return null;
    if (!isEvidenceMode()) {
      var operation = operationByStamp[stamp];
      var evidenceId = 'browser:' + (++evidenceSeq);
      if (!operation || operation.finalized) return null;
      var scopeElements = Array.isArray(revealedSurfaceElements) ? revealedSurfaceElements : [];
      for (var scopeIndex = 0; scopeIndex < scopeElements.length; scopeIndex++) {
        var surfaceId = workflowSurfaceId(scopeElements[scopeIndex]);
        if (surfaceId) operation.revealed_surface_ids[surfaceId] = true;
      }
      operation.evidence_ids.push(evidenceId);
      operation.effects.push(compactEffect(type, detail, evidenceId));
      scheduleOperation(operation);
      return { kind: 'effect', effect_type: type, evidence_id: evidenceId, correlation_stamp: stamp };
    }
    return emit({
      kind: 'effect',
      effect_type: type,
      correlation_stamp: stamp,
      observer: 'producttrace-managed-preload.v1',
      detail: detail && typeof detail === 'object' ? detail : null,
    });
  }

  function effect(type, detail, event, revealedSurfaceElements) {
    var stamp = event && typeof event === 'object' ? actionEventStamps.get(event) ?? null : null;
    return effectFromStamp(type, detail, stamp, revealedSurfaceElements);
  }

  var effectReporterClaimed = false;
  function claimEffectReporter() {
    if (effectReporterClaimed) return null;
    effectReporterClaimed = true;
    return function (type, detail, event) { return effect(type, detail, event); };
  }

  // ------------------------------------------------------------ visibility
  function resolveRouteIdentity() {
    var out = {};
    var basis = {};
    var pats = (bindings.identity && bindings.identity.routePatterns) || [];
    for (var i = 0; i < pats.length; i++) {
      var m = location.pathname.match(pats[i].pattern);
      if (m && m[1] != null &&
          (!pats[i].validate || validIdentity(pats[i], m[1], null))) {
        out[pats[i].as] = m[1];
        basis[pats[i].as] = { source: 'route', pattern: String(pats[i].pattern) };
      }
    }
    return { ids: out, basis: basis };
  }

  function routeIdentity() {
    return resolveRouteIdentity().ids;
  }

  function emitRoute(cause) {
    if (isEvidenceMode()) emit({ kind: 'route', path: location.pathname, cause: cause, ids: routeIdentity() });
  }

  var listeners = [];
  var historyOriginalPush = null;
  var historyOriginalReplace = null;
  var historyPushWrapper = null;
  var historyReplaceWrapper = null;

  function listen(target, event, handler, capture) {
    target.addEventListener(event, handler, capture);
    listeners.push({ target: target, event: event, handler: handler, capture: capture });
  }

  function removeListeners() {
    for (var i = 0; i < listeners.length; i++) {
      var item = listeners[i];
      item.target.removeEventListener(item.event, item.handler, item.capture);
    }
    listeners = [];
  }

  function installVisibility() {
    historyOriginalPush = history.pushState;
    historyOriginalReplace = history.replaceState;
    historyPushWrapper = function () {
      var r = historyOriginalPush.apply(history, arguments);
      observe('history_push', function () { emitRoute('push'); });
      return r;
    };
    historyReplaceWrapper = function () {
      var r = historyOriginalReplace.apply(history, arguments);
      observe('history_replace', function () { emitRoute('replace'); });
      return r;
    };
    history.pushState = historyPushWrapper;
    history.replaceState = historyReplaceWrapper;
    listen(window, 'popstate', function () {
      observe('route_pop', function () { emitRoute('pop'); });
    }, false);
    listen(document, 'visibilitychange', function () {
      observe('visibility', function () {
        if (isEvidenceMode()) emit({ kind: 'focus', state: document.visibilityState });
      });
      // A click that navigates would otherwise lose its record to the batch
      // timer. Delivery already uses keepalive; it just has to be asked for
      // before the page goes away.
      if (document.visibilityState === 'hidden') { flushWorkflow('page_hidden'); flush(); }
    }, false);
    listen(window, 'pagehide', function () { flushWorkflow('page_hidden'); flush(); }, false);
    listen(window, 'focus', function () {
      observe('window_focus', function () { if (isEvidenceMode()) emit({ kind: 'focus', state: 'window-focus' }); });
    }, false);
    listen(window, 'blur', function () {
      observe('window_blur', function () { if (isEvidenceMode()) emit({ kind: 'focus', state: 'window-blur' }); });
    }, false);
  }

  function restoreHistory() {
    var restored = true;
    if (historyPushWrapper && history.pushState === historyPushWrapper) history.pushState = historyOriginalPush;
    else if (historyPushWrapper) restored = false;
    if (historyReplaceWrapper && history.replaceState === historyReplaceWrapper) history.replaceState = historyOriginalReplace;
    else if (historyReplaceWrapper) restored = false;
    return restored;
  }

  function detachObservers() {
    removeListeners();
    var historyRestored = restoreHistory();
    var hookRestored = restoreHook();
    return historyRestored && hookRestored;
  }

  function disable(reason, detach) {
    if (disabled) return;
    disabled = true;
    disabledReason = reason;
    emit({ kind: 'diagnostic', event: 'disabled', reason: reason });
    if (detach) detachObservers();
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var index = Math.max(0, Math.ceil(sorted.length * p) - 1);
    return sorted[index];
  }

  function status() {
    var bufferedCount = sinkMode === 'endpoint' || sinkMode === 'onRecord'
      ? pending.length + inFlightCount
      : records.length;
    return {
      session: sessionId,
      sink: sinkMode,
      records_delivered: deliveredCount,
      records_buffered: bufferedCount,
      records_dropped: dropCount,
      sink_errors: sinkErrorCount,
      counts: {
        total: seq,
        by_kind: Object.assign({}, kindCounts),
        retained: records.length,
        commits: commitCount,
      },
      observe_ms: {
        p50: percentile(observeTimes, 0.50),
        p95: percentile(observeTimes, 0.95),
        max: observeTimes.length ? Math.max.apply(null, observeTimes) : 0,
      },
      errors: errorCount,
      consecutive_errors: consecutiveErrors,
      drops: dropCount,
      disabled: disabled,
      reason: disabledReason,
      started: started,
      stopped: stopped,
      hook: hookMode,
      discover: {
        enabled: discoverEnabled,
        entries: discoveryEntries.length,
        truncated: discoveryTruncated,
      },
    };
  }

  // ------------------------------------------------------------------ api
  function start(b, opts) {
    if (started) return recorder;
    started = true;
    if (b) bindings = b;
    if (opts) for (var k in opts) options[k] = opts[k];
    indexLifecycleManifest();
    if (options.outputMode !== 'operations' && options.outputMode !== 'evidence') options.outputMode = 'operations';
    resolveSink();
    for (var i = 0; i < ACTION_EVENTS.length; i++) {
      (function (eventName) {
        // Window is the stable capture root across Chrome's provisional
        // about:blank popup document and its first same-origin navigation.
        listen(window, eventName, function (ev) {
          observe('dom_' + eventName, function () { onAction(ev); });
        }, true);
      })(ACTION_EVENTS[i]);
    }
    installVisibility();
    if (isEvidenceMode()) {
      emit({
        kind: 'meta', event: 'start', bindings: bindings.name || 'unbound',
        hook: hookMode,
        identity_schema: bindings.identity && bindings.identity.propRules ? 'scoped-v1' : 'legacy-global',
        url: location.href, ua: navigator.userAgent.slice(0, 80),
        viewport: { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio || 1 },
      });
    }
    emitRoute('start');
    return recorder;
  }

  function stop() {
    if (stopped) return status();
    stopped = true;
    discoverEnabled = false;
    if (!disabled) {
      disabled = true;
      disabledReason = 'stopped';
      detachObservers();
    } else {
      // A wrapper added after Producttrace may still retain our callback.
      // The disabled flag makes that callback inert when top-of-chain restore
      // is no longer safe.
      detachObservers();
    }
    flushWorkflow('recorder_stopped');
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    flush();
    return status();
  }

  installHook(); // must happen at load time, before React

  window.__productTraceReactLifecycle = {
    predicateFrame:predicateUseObserver.predicateFrame,
    predicateCall:predicateUseObserver.predicateCall,
    predicateUse:predicateUseObserver.predicateUse,
    scopeCall:scopeObserver.scopeCall,
    scopeArgument:scopeObserver.scopeArgument,
    scopeTarget:scopeObserver.scopeTarget,
    transitionResult:lifecycleTransitionResult,
    wrapperReturn:lifecycleWrapperReturn,
    profilerDefine:function(key,factory,name){var entry=lifecycleEntry(key,'profiler_callback');
      return entry?profilerObserver.define(entry,factory,name):factory(function(args,body){return body();});},
    wrapperCallback:lifecycleWrapperCallback,
    transitionPendingUse:lifecycleTransitionPendingUse,
    deferredInput:lifecycleDeferredInput,
    deferredResult:lifecycleDeferredResult,
    deferredUse:lifecycleDeferredUse,
    classRegister:classObserver.classRegister,
    classRender:classObserver.classRender,
    classRead:classObserver.classRead,
    classUpdateCall:classObserver.classUpdateCall,
    classUpdateMethod:classObserver.classUpdateMethod,
    classUpdateArgument:classObserver.classUpdateArgument,
    classUpdateCallback:classObserver.classUpdateCallback,
    hostCall:hostObserver.hostCall,
    hostArgument:hostObserver.hostArgument,
    serverCall:serverObserver.serverCall,
    serverArgument:serverObserver.serverArgument,
    serverComponent:serverObserver.serverComponent,
    serverPromiseFulfilled:serverObserver.serverPromiseFulfilled,
    serverPipe:serverObserver.serverPipe,
    serverEvent:serverObserver.serverEvent,
    serverIteration:serverObserver.serverIteration,
    rootCall:rootObserver.rootCall,
    rootArgument:rootObserver.rootArgument,
    rootMethod:rootObserver.rootMethod,
    rootRecovery:rootObserver.rootRecovery,
    elementCall:elementObserver.elementCall,
    elementArgument:elementObserver.elementArgument,
    elementTarget:elementObserver.elementTarget,
    portalCall:portalObserver.portalCall,
    portalArgument:portalObserver.portalArgument,
    refCall:refObserver.refCall,
    refArgument:refObserver.refArgument,
    refRead:refObserver.refRead,
    refWrite:refObserver.refWrite,
    refMethod:refObserver.refMethod,
    boundaryResult:function(key,value){return lifecycleApiObservation(key,value,'api_boundary','element_created');},
    apiResult: lifecycleApiResult,
    apiValue: lifecycleApiValue,
    idResult:lifecycleIdResult,
    idUse:lifecycleIdUse,
    idElement:lifecycleIdElement,
    component: lifecycleComponent,
    callback: lifecycleCallback,
    tagCallback: lifecycleTagCallback,
    defineCallback: lifecycleDefineCallback,
    retainedResult: lifecycleRetainedResult,
    sharedRetainedResult:lifecycleSharedRetainedResult,
    sharedRetainedBody:lifecycleSharedRetainedBody,
    dynamicMemo:lifecycleDynamicMemo,
    sharedRetainedDefine:lifecycleSharedRetainedDefine,
    memoResult: lifecycleMemoResult,
    stateResult:lifecycleStateResult,
    stateDispatch:lifecycleStateDispatch,
    tagSource: lifecycleTagSource,
    eventCallback: lifecycleEventCallback,
    registerContext: lifecycleRegisterContext,
    contextCall:contextObserver.contextCall,
    contextArgument:contextObserver.contextArgument,
    contextInput: lifecycleContextInput,
    contextResult: lifecycleContextResult,
    contextValue:lifecycleContextValue,
  };

  recorder = {
    stop: stop,
    status: status,
  };

  window.ProductTrace = {
    start: start,
    // Deprecated compatibility alias. New bindings should call start().
    init: start,
    records: records,
    exportJSONL: function () { return records.map(function (r) { return JSON.stringify(r); }).join('\n'); },
    stats: function () {
      var s = status();
      return {
        session: s.session,
        total: s.counts.total,
        byKind: s.counts.by_kind,
        commits: s.counts.commits,
        hook: s.hook,
      };
    },
    discover: discover,
    _claimEffectReporter: claimEffectReporter,
    discoveryReport: discoveryReport,
    mountSnapshot: mountSnapshot,
    mountDiff: mountDiff,
    flush: function () { flushWorkflow('explicit_flush'); flush(); },
  };
})();
