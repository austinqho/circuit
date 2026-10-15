import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { createLibraryProgram, LibraryProgramFrontier, isLibraryProgramErrorPrediction, requiresInvocationObservation } from './library-program.mjs';

function sameStandardError(actual, expected) {
  if (!isLibraryProgramErrorPrediction(expected) || !types.isNativeError(actual) || types.isProxy(actual)) return false;
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  const a = Object.getOwnPropertyDescriptors(actual), b = Object.getOwnPropertyDescriptors(expected);
  const keys = Reflect.ownKeys(a).filter(key => key !== 'stack');
  const expectedKeys = Reflect.ownKeys(b).filter(key => key !== 'stack');
  return keys.length === expectedKeys.length && keys.every(key => Object.hasOwn(b, key)
    && 'value' in a[key] && 'value' in b[key]
    && ['value', 'writable', 'enumerable', 'configurable'].every(field => Object.is(a[key][field], b[key][field])));
}

/** Compare graphs, including aliases, without invoking getters or functions. */
function graphComparator() {
  const forward = new Map(), reverse = new Map(), inputFunctions = new Map(), observedMethods = new Map();
  const reference = value => value !== null && ['object', 'function'].includes(typeof value);
  const pair = (actual, expected) => {
    if (forward.has(actual)) return forward.get(actual) === expected;
    if (reverse.has(expected)) return false;
    forward.set(actual, expected); reverse.set(expected, actual); return true;
  };
  const seed = (actual, expected, depth = 0) => {
    if (!reference(actual) || !reference(expected) || forward.has(actual) || depth > 12) return;
    pair(actual, expected);
    if (typeof actual === 'function') inputFunctions.set(actual, expected);
    if (actual === expected && typeof actual === 'object' && !types.isProxy(actual)) {
      const descriptors = Object.getOwnPropertyDescriptors(actual);
      for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key];
        if ('value' in descriptor) seed(descriptor.value, descriptor.value, depth + 1);
      }
    }
  };
  const equal = (actual, expected, depth = 0, visited = new Set(), returnedFunction = false) => {
    if (Object.is(actual, expected)) return true;
    if (!reference(actual) || !reference(expected) || typeof actual !== typeof expected || depth > 12) return false;
    if (typeof actual === 'object' && (types.isProxy(actual) || types.isProxy(expected))) return false;
    if (forward.has(actual)) {
      if (forward.get(actual) !== expected) return false;
    } else if (!pair(actual, expected)) return false;
    if (typeof actual === 'function') {
      // Input callback probes have an attested pairing. A new root return is
      // wrapped below so its later calls can be checked. A function merely
      // passed to a callback or hidden in an object has no such observer: its
      // body must not be inferred from a matching typeof or borrowed outcome.
      if (inputFunctions.get(actual) === expected || observedMethods.get(actual) === expected || returnedFunction && depth === 0) return true;
      throw new LibraryProgramFrontier('nested_function_execution_requires_observer');
    }
    if (Array.isArray(actual) !== Array.isArray(expected)) return false;
    if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
    for (const type of [Number, String, Boolean]) {
      if (Object.getPrototypeOf(actual) === type.prototype)
        return Object.is(type.prototype.valueOf.call(actual), type.prototype.valueOf.call(expected));
    }
    if (Object.isExtensible(actual) !== Object.isExtensible(expected)) return false;
    if (visited.has(actual)) return true;
    visited.add(actual);
    const a = Object.getOwnPropertyDescriptors(actual), b = Object.getOwnPropertyDescriptors(expected);
    const keys = Reflect.ownKeys(a);
    if (keys.length > 4096 || keys.length !== Reflect.ownKeys(b).length) return false;
    return keys.every(key => Object.hasOwn(b, key) && 'value' in a[key] && 'value' in b[key]
      && ['enumerable', 'configurable', 'writable'].every(flag => a[key][flag] === b[key][flag])
      && equal(a[key].value, b[key].value, depth + 1, visited));
  };
  const alias = (actual, expected) => {
    if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return false;
    if (types.isProxy(actual) || types.isProxy(expected)) throw new LibraryProgramFrontier('proxy_result_identity_outside_domain');
    return pair(actual, expected);
  };
  return { seed, equal, alias, counterpart: value => forward.get(value) ?? value,
    observeMethod(actual,expected) { if(!pair(actual,expected))return false;observedMethods.set(actual,expected);return true; }, returned: (actual, expected) => equal(actual, expected, 0, new Set(), true) };
}

function project(value, paths) {
  if (paths === null) return value;
  return paths.map(path => {
    let current = value;
    for (const key of path) {
      if (current === null || current === undefined) throw new LibraryProgramFrontier('projection_on_nullish');
      if (types.isProxy(current)) throw new LibraryProgramFrontier('proxy_projection_outside_domain');
      const descriptor = Object.getOwnPropertyDescriptor(Object(current), key);
      if (!descriptor || !('value' in descriptor)) throw new LibraryProgramFrontier('projection_requires_data_property');
      current = descriptor.value;
    }
    return current;
  });
}

/** Enumerate reference origins without evaluating accessors or function bodies. */
function functionReferences(value, rootPath) {
  const result = [];
  let count = 0;
  const visit = (value, path, ancestors) => {
    if (++count > 4096 || path.length > 12) throw new LibraryProgramFrontier('reference_graph_limit');
    if (typeof value === 'function') { result.push({ value, path }); return; }
    if (value === null || typeof value !== 'object') return;
    if (types.isProxy(value)) throw new LibraryProgramFrontier('proxy_reference_outside_domain');
    if (ancestors.has(value)) return;
    const next = new Set(ancestors); next.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key];
      if (!('value' in descriptor)) continue;
      if (typeof key === 'symbol') {
        if (descriptor.value !== null && ['object', 'function'].includes(typeof descriptor.value))
          throw new LibraryProgramFrontier('symbol_reference_path_requires_host_identity');
        continue;
      }
      visit(descriptor.value, [...path, key], next);
    }
  };
  visit(value, rootPath, new Set());
  return result;
}

/** A callback probe has a different identity from its original function. When
 * that original is also visible through another input path, replacing just the
 * callback slot can change the library's branch before replay even starts.
 * Detect these known aliases without evaluating getters; keep the real call
 * untouched and require a different observer for this input domain.
 */
function callbackInputAlias(args, indices, receiver) {
  const selected = new Set(indices.filter(index => typeof args[index] === 'function'));
  const callbacks = new Set([...selected].map(index => args[index]));
  if (!callbacks.size) return false;
  const seen = new Set(); let nodes = 0;
  const visit = (value, selectedRoot = false, depth = 0) => {
    if (!selectedRoot && callbacks.has(value)) return true;
    if (value === null || !['object','function'].includes(typeof value) || seen.has(value)) return false;
    if (types.isProxy(value)) throw new LibraryProgramFrontier('proxy_input_outside_domain');
    if (++nodes > 4096 || depth > 12) throw new LibraryProgramFrontier('input_graph_limit');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 4096) throw new LibraryProgramFrontier('input_graph_limit');
    for (const key of keys) {
      // Standard function prototype.constructor points back to the function.
      // That intrinsic graph is outside this known-input-alias observation.
      if (typeof value === 'function' && ['length','name','arguments','caller','prototype'].includes(key)) continue;
      if ('value' in descriptors[key] && visit(descriptors[key].value, false, depth + 1)) return true;
    }
    return false;
  };
  const roots = new Set();
  for (let index = 0; index < args.length; index++) {
    const root = selected.has(index);
    if (root && roots.has(args[index])) return true;
    if (root) roots.add(args[index]);
    if (visit(args[index], root)) return true;
  }
  return visit(receiver);
}

/** Find exact input-object aliases for an executed rule read. This records
 * the program's selected read, not a guess from equal primitive values. Own
 * data descriptors only; no getters, function captures or prototype walks.
 */
function inputObjectPaths(values, target) {
  const paths=[];let visited=0;
  const visit=(value,path,ancestors)=>{
    if(++visited>4096||path.length>12||paths.length>=64)throw new LibraryProgramFrontier('read_origin_graph_limit');
    if(value===null||typeof value!=='object'||types.isProxy(value))return;
    if(value===target)paths.push(path);
    if(ancestors.has(value))return;
    const next=new Set(ancestors);next.add(value);
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)))
      if('value' in descriptor)visit(descriptor.value,[...path,key],next);
  };
  values.forEach((value,index)=>visit(value,[index],new Set()));
  return paths;
}

// This first boundary domain has no heap-write instruction. Detect visible
// input mutation and reject replay, rather than read changed values as though
// they were the values present before the real invocation.
function snapshotInputs(values, accessorObservation) {
  const seen = new Map();
  const visit = (value, depth = 0) => {
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) return;
    if (types.isProxy(value)) throw new LibraryProgramFrontier('proxy_input_outside_domain');
    if (depth > 12 || seen.size > 4096) throw new LibraryProgramFrontier('input_graph_limit');
    if (typeof value === 'object') {
      const prototype = Object.getPrototypeOf(value);
      if (prototype && types.isProxy(prototype)) throw new LibraryProgramFrontier('proxy_input_prototype_outside_domain');
      const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor');
      const native = constructor && 'value' in constructor && typeof constructor.value === 'function'
        ? Function.prototype.toString.call(constructor.value) : '';
      // Descriptors cannot observe Map/Set entries, Date state, private class
      // fields or other host slots. Do not let a same-identity return hide
      // changes to that invisible state. Ordinary cross-realm objects remain
      // usable; their Object prototype has the same native constructor shape.
      const plain = prototype === null || native === 'function Object() { [native code] }'
        && Object.getPrototypeOf(prototype) === null;
      const array = Array.isArray(value) && native === 'function Array() { [native code] }';
      const error = types.isNativeError(value) && /^function (Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|AggregateError)\(\) \{ \[native code\] \}$/.test(native);
      if (!plain && !array && !error) throw new LibraryProgramFrontier('hidden_input_state_requires_host_evidence');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 4096) throw new LibraryProgramFrontier('input_graph_limit');
    if (accessorObservation === 'reject' && keys.some(key => !('value' in descriptors[key])))
      throw new LibraryProgramFrontier('accessor_input_outside_domain');
    seen.set(value, { descriptors, extensible: Object.isExtensible(value), prototype: Object.getPrototypeOf(value) });
    // Function internals/captures are opaque. Enumerable custom fields remain
    // visible, but prototype.constructor cycles need not be traversed.
    for (const key of keys) {
      const descriptor = descriptors[key];
      if ('value' in descriptor && (typeof value !== 'function' || descriptor.enumerable)) visit(descriptor.value, depth + 1);
    }
  };
  for (const value of values) visit(value);
  return () => [...seen].every(([value, before]) => {
    const now = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(before.descriptors);
    return Object.getPrototypeOf(value) === before.prototype
      && Object.isExtensible(value) === before.extensible && keys.length === Reflect.ownKeys(now).length
      && keys.every(key => Object.hasOwn(now, key) && ['value', 'get', 'set', 'enumerable', 'configurable', 'writable']
        .every(field => Object.is(now[key][field], before.descriptors[key][field])));
  });
}

/**
 * Node boundary observer used both by independent verification and integration.
 * Real callbacks execute once. The program sees shadow callbacks which consume
 * their recorded results; it can never execute application code during replay.
 * AsyncLocalStorage supplies exact call occurrence ownership, not a timestamp
 * guess. Browser use needs an equivalent host and is not implied by this API.
 *
 * This low-level constructor accepts an unadmitted program for testing. Its
 * evidence always says observed agreement, never bank admission or business
 * success. The bank admission layer must additionally attest source/version.
 */
export function createLibraryBoundary({ producer, program, callbackArguments = [], returnedCallbackArguments = [],
  resultPaths = null, resultIdentityPaths = [], onEvidence = () => {}, maxSteps = 4096, occurrencePrefix = 'library-call', observationMode = 'invocations', errorObservation = 'identity', accessorObservation = 'reject', nestedReferences = false, diagnosticInputs = false, returnedResultMode = 'invoke', onOccurrence = () => {}, dataReadEvidence = false, resultMethods = [], executionContext = null, executionSource = null }) {
  if(executionContext!==null&&(typeof executionContext.run!=='function'||typeof executionContext.current!=='function'))throw new TypeError('execution_context_host');
  if (typeof dataReadEvidence !== 'boolean') throw new TypeError('data_read_evidence');
  if (!['invoke','value'].includes(returnedResultMode)) throw new TypeError('returned_result_mode');
  if (typeof diagnosticInputs !== 'boolean') throw new TypeError('diagnostic_input_mode');
  if (typeof nestedReferences !== 'boolean' || nestedReferences && observationMode !== 'references') throw new TypeError('nested_reference_mode');
  if (!['reject', 'opaque_descriptors'].includes(accessorObservation)) throw new TypeError('accessor_observation');
  if (!['identity', 'standard_error_without_stack'].includes(errorObservation)) throw new TypeError('error_observation');
  if (!['invocations', 'references'].includes(observationMode)) throw new TypeError('observation_mode');
  if (typeof producer !== 'function' || typeof onEvidence !== 'function' || typeof onOccurrence !== 'function') throw new TypeError('boundary_function');
  if (typeof occurrencePrefix !== 'string' || !occurrencePrefix.length) throw new TypeError('occurrence_prefix');
  program = structuredClone(program);
  if (observationMode === 'references') {
    if (requiresInvocationObservation(program)) throw new TypeError('reference_mode_cannot_predict_execution');
  }
  if (!Array.isArray(callbackArguments) || new Set(callbackArguments).size !== callbackArguments.length
    || callbackArguments.some(i => !Number.isSafeInteger(i) || i < 0 || i > 63)) throw new TypeError('callback_arguments');
  if (!Array.isArray(returnedCallbackArguments) || new Set(returnedCallbackArguments).size !== returnedCallbackArguments.length
    || returnedCallbackArguments.some(i => !Number.isSafeInteger(i) || i < 0 || i > 63)
    || returnedCallbackArguments.length && observationMode !== 'invocations') throw new TypeError('returned_callback_arguments');
  if (resultPaths !== null && (!Array.isArray(resultPaths) || resultPaths.length > 64 || resultPaths.some(path =>
    !Array.isArray(path) || path.length > 12 || path.some(key => typeof key !== 'string' && !Number.isInteger(key))))) throw new TypeError('result_projection');
  if (!Array.isArray(resultIdentityPaths) || resultIdentityPaths.length > 64 || resultIdentityPaths.some(path =>
    !Array.isArray(path) || path.length > 12 || path.some(key => typeof key !== 'string' && !Number.isInteger(key)))) throw new TypeError('result_identity_projection');
  if(!Array.isArray(resultMethods)||resultMethods.length>32||resultMethods.some(row=>
    !row||Object.keys(row).sort().join(',')!=='callbackArguments,path'||!Array.isArray(row.path)||!row.path.length||row.path.length>12||row.path.some(key=>
      !(typeof key==='string'&&key.length>0&&key.length<=128&&!['__proto__','constructor','prototype'].includes(key)||Number.isSafeInteger(key)&&key>=0&&key<=4096))
    ||!Array.isArray(row.callbackArguments)||new Set(row.callbackArguments).size!==row.callbackArguments.length||row.callbackArguments.some(index=>!Number.isSafeInteger(index)||index<0||index>63))
    ||new Set(resultMethods.map(row=>JSON.stringify(row.path.map(String)))).size!==resultMethods.length
    ||resultMethods.length&&(observationMode!=='invocations'||resultPaths!==null||resultIdentityPaths.length))throw new TypeError('result_method_scope');
  resultMethods=structuredClone(resultMethods);
  const members=new WeakMap();
  const resultIdentities = new WeakMap();
  let resultIdentitySequence = 0;
  const resultIdentity = value => {
    if (!resultIdentities.has(value)) resultIdentities.set(value, `${occurrencePrefix}:value:${++resultIdentitySequence}`);
    return resultIdentities.get(value);
  };
  const context = new AsyncLocalStorage(), callbackContext = new AsyncLocalStorage();
  const actions = [], failures = [], deferred = [], evidence = [], pendingReferences = [];
  let sequence = 0, replay = null;
  const diagnosticIds = new Map();
  const describe = (value, originals) => {
    value = originals.get(value) ?? value;
    if (value === null) return { type: 'null' };
    const type = typeof value;
    if (type === 'undefined') return { type };
    if (type === 'number') return { type, value: Number.isNaN(value) ? 'NaN' : Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value) };
    if (type === 'boolean') return { type, value };
    if (type === 'string') return { type, value: value.slice(0, 200), truncated: value.length > 200 };
    if (type === 'bigint') return { type, value: String(value).slice(0, 200) };
    // Synthetic test diagnostics retain identity, not object properties. Never
    // inspect getters, names, prototypes or user content to format an error.
    if (!diagnosticIds.has(value)) diagnosticIds.set(value, `identity:${diagnosticIds.size + 1}`);
    return { type, identity: diagnosticIds.get(value) };
  };
  const fail = (reason, action = null, detail = undefined) => failures.push({ reason, occurrence: action?.id ?? null,
    ...(detail ? { detail } : {}) });
  const attempt = fn => { try { return { type: 'return', value: fn() }; } catch (error) { return { type: 'throw', value: error }; } };
  const aliasReason = (args, indices, receiver) => {
    if (observationMode === 'references') return null;
    try { return callbackInputAlias(args, indices, receiver) ? 'callback_alias_requires_identity_preserving_observer' : null; }
    catch (error) { return error.message; }
  };
  const unobserved = (actual, args, receiver, reason) => {
    const action = {id:`${occurrencePrefix}:${++sequence}`,calls:[],consumed:0,reads:[],reported:0};
    actions.push(action); fail(reason, action);
    try { onOccurrence({occurrence:action.id,label:'unobserved_callback_alias'}); } catch { fail('occurrence_observer_failed',action); }
    const call=event=>{action.executionId=event?.id??null;return Reflect.apply(actual,receiver,args)};
    return executionContext?executionContext.run({kind:'library_invocation',occurrence:action.id,source:executionSource},call):call(null);
  };
  const run = (actual, predicted, args, receiver, state, label, method = null) => {
    const action = { id: `${occurrencePrefix}:${++sequence}`, label, calls: [], consumed: 0, synchronous: true, reads: [], inputArgs: args,
      ...(diagnosticInputs ? { decisions: [], diagnostic: { arguments: args.map(value => describe(value, state.originals)), receiver: describe(receiver, state.originals) } } : {}) };
    actions.push(action);
    if(label==='producer')state.producerOccurrence=action.id;
    try { onOccurrence({occurrence:action.id,label}); } catch { fail('occurrence_observer_failed',action); }
    let inputUnchanged, replayable = true;
    try { inputUnchanged = snapshotInputs([...state.capturedValues, ...args.map(value => state.originals.get(value) ?? value), receiver], accessorObservation); }
    catch (error) { fail(error.message, action); replayable = false; }
    if (replayable) {
      for (const value of args) state.graph.seed(value, value);
      state.graph.seed(receiver, receiver);
    }
    const actualCall=event=>{action.executionId=event?.id??null;return Reflect.apply(actual,receiver,args)};
    const observed = context.run(action, () => attempt(() => executionContext
      ? executionContext.run({kind:'library_invocation',occurrence:action.id,source:executionSource},actualCall)
      : actualCall(null)));
    action.synchronous = false;
    if (replayable && !inputUnchanged()) { fail('input_mutation_requires_heap_replay', action); replayable = false; }
    if (!replayable) {
      // Unknown proxy/getter inputs and mutated heaps must not be inspected a
      // second time by replay. Preserve the application's actual outcome and
      // leave the occurrence unresolved instead of producing extra side effects.
      if (observed.type === 'throw') throw observed.value;
      return observed.value;
    }
    const previous = replay;
    replay = action;
    const expected = attempt(predicted);
    replay = previous;
    if (expected.value instanceof LibraryProgramFrontier && !(observed.type === 'throw' && observed.value === expected.value)) fail(expected.value.message, action, { ...expected.value.detail, ...(diagnosticInputs ? { predicted_decisions: action.decisions } : {}) });
    else if (observed.type !== expected.type) fail('return_or_throw_mismatch', action);
    else if (observed.type === 'throw') {
      if (!Object.is(observed.value, expected.value)
        && !(errorObservation === 'standard_error_without_stack' && sameStandardError(observed.value, expected.value)))
        fail('thrown_value_mismatch', action);
    } else {
      try {
        if(label==='producer') for(const description of resultMethods) {
          const parentPath=description.path.slice(0,-1),key=String(description.path.at(-1));
          const actualParent=project(observed.value,[parentPath])[0],expectedParent=project(expected.value,[parentPath])[0];
          if(!actualParent||typeof actualParent!=='object'||types.isProxy(actualParent))throw new LibraryProgramFrontier('returned_method_container_outside_domain');
          const actualMethod=project(actualParent,[[key]])[0],expectedMethod=project(expectedParent,[[key]])[0];
          if(typeof actualMethod!=='function'||types.isProxy(actualMethod)||!state.engine.canInvoke(expectedMethod))throw new LibraryProgramFrontier('returned_method_replay_capability_missing');
          if(!state.graph.observeMethod(actualMethod,expectedMethod))throw new LibraryProgramFrontier('returned_method_alias_mismatch');
          let slots=members.get(actualParent);if(!slots){slots=new Map();members.set(actualParent,slots);}
          if(slots.has(key)&&slots.get(key).state!==state){slots.get(key).ambiguous=true;throw new LibraryProgramFrontier('returned_method_owner_ambiguous');}
          slots.set(key,{actual:actualMethod,expected:expectedMethod,state,path:description.path,callbackArguments:description.callbackArguments,registered:action.id});
        }
        // These paths describe only aliases between opaque result objects.
        // Scalar/data claims remain separate resultPaths projections. The
        // checker, never the proposing rule, chooses this observation scope.
        for (const path of resultIdentityPaths) {
          const actual = project(observed.value, [path])[0], predicted = project(expected.value, [path])[0];
          if (!state.graph.alias(actual, predicted)) fail('result_reference_relationship_mismatch', action, { result_path: path });
          else pendingReferences.push({ schema: 'producttrace.library-boundary-evidence.v1', kind: 'result_identity',
            occurrence: action.id, result_path: path, value: resultIdentity(actual), status: 'observed_agreement',
            reason: 'This result path held this exact object identity during the observed call. Equal value IDs prove aliasing only; unprojected fields and later consumers are not observed here.' });
        }
        const compare = observationMode === 'invocations' && resultPaths === null && (label === 'producer' || returnedResultMode === 'invoke') ? state.graph.returned : state.graph.equal;
        if (!compare(project(observed.value, resultPaths), project(expected.value, resultPaths))) fail('result_value_or_identity_mismatch', action,
          { boundary: label, observed_type: observed.value === null ? 'null' : typeof observed.value,
            predicted_type: expected.value === null ? 'null' : typeof expected.value, argument_count: args.length });
      } catch (error) { fail(error.message, action); }
    }
    if(method) pendingReferences.push({schema:'producttrace.library-boundary-evidence.v1',kind:'returned_method_invocation',occurrence:action.id,
      registered_occurrence:method.registered,result_path:method.path,invocation_source:method.source??null,outcome:observed.type,
      reason:'Observed this exact own method on the original library-produced object. Its shared program is replayed through the same callback capability and result checks; the object and method identities were preserved.'});
    if (observed.type === 'throw') throw observed.value;
    for(const read of action.reads) pendingReferences.push({
      schema:'producttrace.library-boundary-evidence.v1',kind:'rule_data_read',occurrence:action.id,
      program_path:read.path,operation:read.op,input_paths:read.inputPaths,
      value_kind:read.value===null?'null':typeof read.value,
      matches_predicted_result:expected.type==='return'&&Object.is(read.value,expected.value),
      reason:'The shared program selected these exact input-object paths during replay. Result agreement is checked separately; equal primitive values do not establish a unique origin, provider identity or render commit.'
    });
    if (observationMode === 'references') {
      // Reference-only summaries pass the original function objects through to
      // React (or any other consumer). Replacing them with probes would change
      // memoization and equality even if their eventual bodies ran correctly.
      const paths = resultPaths ?? (typeof observed.value === 'function' ? [[]] : []);
      for (const path of paths) {
        try {
          const actual = project(observed.value, [path])[0], predicted = project(expected.value, [path])[0];
          if (nestedReferences) {
            for (const output of functionReferences(actual, path)) {
              const predictedReference = project(expected.value, [output.path])[0];
              for (const reference of state.references) if (output.value === reference.value && predictedReference === reference.value) {
                pendingReferences.push({ schema: 'producttrace.library-boundary-evidence.v1', kind: 'callback_reference',
                  occurrence: action.id, callback: reference.id, input_path: reference.path, result_path: output.path,
                  status: failures.length ? 'frontier' : 'observed_agreement',
                  reason: 'The observed output retains this exact input callback at these data paths. Invocation and component ownership require separate runtime evidence.' });
              }
            }
            continue;
          }
          for (const reference of state.references) if (actual === reference.value && predicted === reference.value) {
            pendingReferences.push({ schema: 'producttrace.library-boundary-evidence.v1', kind: 'callback_reference',
              occurrence: action.id, callback: reference.id, result_path: path, status: failures.length ? 'frontier' : 'observed_agreement',
              reason: 'The real result stores this exact source callback identity. Its later invocation requires separate runtime evidence.' });
          }
        } catch (error) { fail(error.message, action); }
      }
      return observed.value;
    }
    if (label === 'returned_callback' && returnedResultMode === 'value') return observed.value;
    if (typeof observed.value !== 'function' || typeof expected.value !== 'function') return observed.value;
    // A function returned as data is still the caller's original value. Only
    // newly predicted library closures need an invocation observer; wrapping
    // an already identical application function would break equality while
    // replay misleadingly continued to report agreement.
    if(observed.value===expected.value){
      const origins=[];
      state.capturedValues.forEach((value,index)=>{if(value===observed.value)origins.push({occurrence:state.producerOccurrence,path:[index]})});
      if(label!=='producer')args.forEach((value,index)=>{if(value===observed.value)origins.push({occurrence:action.id,path:[index]})});
      if(origins.length)pendingReferences.push({schema:'producttrace.library-boundary-evidence.v1',kind:'returned_input_function_reference',
        occurrence:action.id,execution_id:action.executionId??null,input_origins:origins,result_path:[],
        reason:'The actual returned value is the exact input function object retained by this library call. Its identity is preserved; this record does not claim that function executed.'});
      return observed.value;
    }
    return new Proxy(observed.value, { apply(target, thisArg, argumentsList) {
      const reason = aliasReason(argumentsList, returnedCallbackArguments, thisArg);
      if (reason) return unobserved(target, argumentsList, thisArg, reason);
      const {actualArgs, predictedArgs} = prepareCallbacks(argumentsList, returnedCallbackArguments, {}, state, 'returned');
      return run(target, () => state.engine.invokeCallable(expected.value, predictedArgs, thisArg), actualArgs, thisArg, state, 'returned_callback');
    } });
  };
  // A library summary does not predict the body of an application callback.
  // Its observed descendants are accounted only after replay verified an
  // ancestor call. AsyncLocalStorage supplies ancestry across later tasks;
  // timestamp proximity or a shared argument index never supplies this link.
  const consumeObservedDescendants = action => {
    while (action.consumed < action.calls.length) {
      const child=action.calls[action.consumed];
      let parent=child.parent === null ? null : action.calls[child.parent];
      let accounted=false;
      while(parent) {
        if(parent.verifiedByReplay||parent.accountedByParent){accounted=true;break;}
        parent=parent.parent === null ? null : action.calls[parent.parent];
      }
      if(!accounted)break;
      child.accountedByParent=true;action.consumed++;
    }
  };
  const prepareCallbacks = (args, indices, callbackIds, state, role) => {
      const actualArgs = [...args], predictedArgs = [...args], shadows = [];
      if (nestedReferences) {
        try {
          for (let index = 0; index < args.length; index++) for (const reference of functionReferences(args[index], [index]))
            state.references.push({ ...reference, id: `${callbackIds[index] ?? `argument:${index}`}:data:${JSON.stringify(reference.path.slice(1))}` });
        } catch (error) { fail(error.message); }
      }
      for (const index of indices) {
        const original = args[index];
        // Some APIs accept a value or a callback in the same position. Only an
        // actual callable grants a callback capability for this occurrence.
        if (typeof original !== 'function') continue;
        const id = callbackIds[index] ?? `${role}:argument:${index}`;
        if (observationMode === 'references') {
          if (!nestedReferences) state.references.push({ id, value: original });
          continue;
        }
        let cache = state.callbackCache.get(original);
        if (!cache) { cache = new Map(); state.callbackCache.set(original, cache); }
        const cacheKey = `${role}:${index}:${id}`;
        const known = cache.get(cacheKey);
        if (known) { actualArgs[index] = known.wrapped; predictedArgs[index] = known.shadow; continue; }
        const capability = {};
        const wrapped = new Proxy(original, { apply(target, thisArg, callArgs) {
          const action = context.getStore();
          const parent = callbackContext.getStore();
          const call = { callback: id, capability, args: callArgs, receiver: thisArg, synchronous: action?.synchronous === true,
            index: action?.calls.length, parent: action && parent?.action === action ? parent.call.index : null,
            parentRelation: action && parent?.action === action ? parent.call.closed ? 'async_continuation' : 'synchronous' : null };
          if (!action) fail('callback_trigger_occurrence_unavailable');
          else action.calls.push(call);
          const actualCallback=event=>{call.executionId=event?.id??null;return Reflect.apply(target,thisArg,callArgs)};
          const outcome = callbackContext.run({action, call}, () => attempt(() => executionContext&&action
            ? executionContext.run({kind:'callback_invocation',occurrence:action.id,callback:id,ordinal:call.index},actualCallback)
            : actualCallback(null)));
          call.closed = true;
          call.outcome = outcome;
          if (outcome.type === 'throw') throw outcome.value;
          return outcome.value;
        } });
        const shadow = function (...callArgs) {
          const action = replay;
          if(action)consumeObservedDescendants(action);
          const call = action?.calls[action.consumed++];
          if (!call || call.capability !== capability) throw Object.assign(new LibraryProgramFrontier('callback_order_or_count_mismatch'), { detail: {
            boundary: action?.label ?? null, observed_callback_count: action?.calls.length ?? 0,
            predicted_callback_ordinal: action?.consumed ?? null, predicted_callback: id, observed_callback: call?.callback ?? null,
            ...(diagnosticInputs ? { invocation: action?.diagnostic, predicted_arguments: callArgs.map(value => describe(value, state.originals)) } : {}),
          } });
          // Proxy [[Call]] and this rest-parameter list may allocate their
          // transport arrays in different realms. Compare the argument slots,
          // not those observer-created arrays' prototypes or identities.
          let matchingArguments = call.args.length === callArgs.length;
          for (let index = 0; matchingArguments && index < callArgs.length; index++)
            matchingArguments = state.graph.equal(call.args[index], callArgs[index]);
          if (!matchingArguments || !state.graph.equal(call.receiver, this))
            throw Object.assign(new LibraryProgramFrontier('callback_arguments_or_receiver_mismatch'), { detail: {
              callback: id, arguments_match: matchingArguments,
              ...(diagnosticInputs ? { invocation: action.diagnostic,
                observed_arguments: call.args.map(value => describe(value, state.originals)),
                predicted_arguments: callArgs.map(value => describe(value, state.originals)),
                observed_receiver: describe(call.receiver, state.originals), predicted_receiver: describe(this, state.originals) } : {}),
            } });
          if (call.synchronous !== !action.replayingDeferred) throw new LibraryProgramFrontier('callback_timing_mismatch');
          call.verifiedByReplay=true;
          consumeObservedDescendants(action);
          if (call.outcome.type === 'throw') throw call.outcome.value;
          return call.outcome.value;
        };
        shadows.push(shadow);
        cache.set(cacheKey, {wrapped, shadow});
        state.engine?.grantCallback(shadow);
        actualArgs[index] = wrapped; predictedArgs[index] = shadow;
        state.originals.set(wrapped, original);
        state.originals.set(shadow, original);
        state.graph.seed(wrapped, shadow);
      }
      for (let i = 0; i < args.length; i++) state.graph.seed(actualArgs[i], predictedArgs[i]);
      return {actualArgs, predictedArgs, shadows};
  };
  return Object.freeze({
    /** The source adapter supplies the already evaluated member and receiver,
     * before evaluating its arguments. No object or method is replaced. */
    markMemberAmbiguous(receiver,key) {
      const slot=members.get(receiver)?.get(String(key));if(slot){slot.ambiguous=true;fail('returned_method_owner_ambiguous');}
    },
    prepareMember(receiver,key,producer,source=null) {
      if(receiver===null||!['object','function'].includes(typeof receiver))return null;
      const slot=members.get(receiver)?.get(String(key));if(!slot)return null;
      if(slot.ambiguous||slot.actual!==producer){fail(slot.ambiguous?'returned_method_owner_ambiguous':'returned_method_identity_changed');return (...args)=>Reflect.apply(producer,receiver,args);}
      return (...args)=>{
        const reason = aliasReason(args, slot.callbackArguments, receiver);
        if (reason) return unobserved(producer, args, receiver, reason);
        const {actualArgs,predictedArgs}=prepareCallbacks(args,slot.callbackArguments,{},slot.state,'method:'+JSON.stringify(slot.path));
        return run(producer,()=>slot.state.engine.invokeCallable(slot.expected,predictedArgs,slot.state.graph.counterpart(receiver)),actualArgs,receiver,slot.state,'returned_method',{...slot,source});
      };
    },
    invoke(args, { receiver = undefined, callbackIds = {} } = {}) {
      if (!Array.isArray(args) || args.length > 64) throw new TypeError('boundary_arguments');
      const reason = aliasReason(args, callbackArguments, receiver);
      if (reason) return unobserved(producer, args, receiver, reason);
      const state = { graph: graphComparator(), originals: new Map(), capturedValues: [...args], references: [], callbackCache: new WeakMap(), engine: null };
      const {actualArgs, predictedArgs, shadows} = prepareCallbacks(args, callbackArguments, callbackIds, state, 'producer');
      const engine = createLibraryProgram(program, { callbacks: shadows, maxSteps,
        ...(dataReadEvidence ? {onRead(read) {
          if(!replay)return;
          if(replay.replayingDeferred)throw new LibraryProgramFrontier('deferred_read_requires_input_snapshot');
          const origins=inputObjectPaths(replay.inputArgs,read.container);
          if(!origins.length)return;
          if(replay.reads.length>=256)throw new LibraryProgramFrontier('read_evidence_limit');
          replay.reads.push({...read,inputPaths:origins.map(path=>[...path,read.key])});
        }} : {}),
        ...(diagnosticInputs ? { onDecision({ path, op, operands, result }) {
          if (!replay) return;
          replay.decisions.push({ path, op, operands: operands.map(value => describe(value, state.originals)), result });
          if (replay.decisions.length > 64) replay.decisions.shift();
        } } : {}),
        schedule(work) {
          const action = replay;
          deferred.push(() => {
            const previous = replay; replay = action; action.replayingDeferred = true;
            try { work(); } catch (error) { fail(error.message, action); }
            finally { replay = previous; action.replayingDeferred = false; }
          });
        } });
      state.engine = engine;
      return run(producer, () => engine.invoke(predictedArgs, receiver), actualArgs, receiver, state, 'producer');
    },
    /** Call after the host's independently chosen observation window. */
    checkpoint() {
      let budget = 1024;
      while (deferred.length && --budget > 0) deferred.shift()();
      if (deferred.length) { fail('scheduled_work_limit'); deferred.length = 0; }
      for (const action of actions) {
        consumeObservedDescendants(action);
        if (action.consumed < action.calls.length) fail('unmodeled_callback_invocation', action, {
          observed_callback_count: action.calls.length, predicted_callback_count: action.consumed,
          ...(diagnosticInputs ? { invocation: action.diagnostic } : {}),
        });
      }
      const status = failures.length ? 'frontier' : 'observed_agreement';
      for (const row of pendingReferences.splice(0)) {
        row.status = status; evidence.push(row); onEvidence(row);
      }
      for (const action of actions) {
        if (action.reported === action.calls.length) continue;
        const start = action.reported ?? 0;
        action.reported = action.calls.length;
        for (let index = start; index < action.calls.length; index++) {
          const call = action.calls[index];
          const row = { schema: 'producttrace.library-boundary-evidence.v1', kind: 'callback_invocation', occurrence: action.id,
            ...(call.executionId?{execution_id:call.executionId}:{}),
            callback: call.callback, ordinal: index, parent_ordinal: call.parent, parent_relation: call.parentRelation, timing: call.synchronous ? 'synchronous' : 'deferred',
            status, outcome: call.outcome?.type ?? 'incomplete',
            reason: call.parent === null
              ? 'Observed the real callback inside this exact library call; program replay uses its recorded outcome.'
              : 'Observed this callback inside the real parent callback or its exact async continuation. Replay accounts for the independently observed descendant without executing application code again.' };
          evidence.push(row); onEvidence(row);
        }
      }
      return { status, scope: 'observations_through_checkpoint', observation_mode: observationMode, error_observation: errorObservation, accessor_observation: accessorObservation, calls: actions.length,
        failures: structuredClone(failures), evidence: structuredClone(evidence) };
    },
  });
}
