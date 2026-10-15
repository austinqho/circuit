import { LIBRARY_PROGRAM_SYNTAX } from './library-program-syntax.mjs';
/**
 * Small executable vocabulary shared by authoring checks and trace replay.
 * Programs describe a boundary; they have no filesystem, network, eval, or
 * implicit access to application functions. Hosts explicitly grant callbacks.
 */
export const LIBRARY_PROGRAM_SCHEMA = 'producttrace.library-program.v1';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fields = Object.fromEntries(Object.entries(LIBRARY_PROGRAM_SYNTAX).map(([op, shape]) => [op, Object.keys(shape)]));
const children = Object.fromEntries(Object.entries(LIBRARY_PROGRAM_SYNTAX).map(([op, shape]) => [op, Object.keys(shape).filter(key => shape[key] === 'instruction')]));
const plain = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key))
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d);
const name = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)
  && !forbidden.has(value);

export function validateLibraryProgram(program) {
  const errors = [], diagnostics = [];
  let count = 0;
  if (!exact(program, ['schema', 'body']) || program.schema !== LIBRARY_PROGRAM_SCHEMA)
    return { valid: false, errors: ['program_schema'] };
  const walk = (node, scope, depth, location) => {
    if (++count > 512 || depth > 32) { errors.push('program_size_limit'); return; }
    if (!plain(node) || !Object.hasOwn(fields, node.op)
      || !exact(node, ['op', ...fields[node.op]])) { errors.push('instruction_shape'); return; }
    if (node.op === 'literal' && !(node.value === null || ['boolean', 'string', 'number'].includes(typeof node.value))
      || node.op === 'literal' && typeof node.value === 'number' && !Number.isFinite(node.value)) errors.push('literal_domain');
    if (node.op === 'symbol' && (typeof node.key !== 'string' || node.key.length > 128)) errors.push('symbol_key');
    if (node.op === 'arg' && (!Number.isSafeInteger(node.index) || node.index < 0 || node.index > 63)) errors.push('argument_index');
    if (node.op === 'get' && !(typeof node.key === 'string' && node.key.length <= 128 && !forbidden.has(node.key)
      || Number.isSafeInteger(node.key) && node.key >= 0 && node.key <= 4096)) errors.push('property_key');
    if (node.op === 'slice' && (!Number.isSafeInteger(node.start) || Math.abs(node.start) > 64)) errors.push('slice_bound');
    if (node.op === 'fn' && !['strict', 'sloppy', 'lexical'].includes(node.this_mode)) errors.push('function_receiver_mode');
    if (node.op === 'make_error' && !['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(node.name)) errors.push('error_constructor');
    if (node.op === 'frontier' && (typeof node.reason !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(node.reason))) errors.push('frontier_reason');
    if (['local', 'set'].includes(node.op) && !scope.has(node.name)) {
      errors.push('unbound_local');
      // This is proposed-program text, never application input or a bank answer.
      if (diagnostics.length < 16) diagnostics.push({reason:'unbound_local',path:location,name:typeof node.name==='string'?node.name.slice(0,64):null,in_scope:[...scope].slice(-32)});
    }
    if (node.op === 'bind') {
      if (!name(node.name)) errors.push('binding_name');
      walk(node.value, scope, depth + 1, location + "/value");
      walk(node.body, new Set([...scope, node.name]), depth + 1, location + "/body");
    } else if (node.op === 'every') {
      if (!name(node.value_name) || !name(node.index_name) || node.value_name === node.index_name) errors.push('iteration_bindings');
      walk(node.items, scope, depth + 1, location + "/items");
      walk(node.test, new Set([...scope, node.value_name, node.index_name]), depth + 1, location + "/test");
    } else if (node.op === 'fn') walk(node.body, scope, depth + 1, location + '/body');
    else if (['array', 'concat', 'sequence'].includes(node.op)) {
      const values = node.op === 'sequence' ? node.steps : node.items;
      if (!Array.isArray(values) || values.length > 64) errors.push('instruction_list');
      else values.forEach((value,index) => walk(value, scope, depth + 1, location + (node.op === 'sequence' ? '/steps/' : '/items/') + index));
    } else if (node.op === 'object') {
      if (!plain(node.entries) || Object.keys(node.entries).length > 64
        || Object.keys(node.entries).some(key => forbidden.has(key))) errors.push('object_entries');
      else for (const [key,value] of Object.entries(node.entries)) walk(value, scope, depth + 1, location + '/entries/' + key.replace(/~/g,'~0').replace(/\//g,'~1'));
    } else for (const key of children[node.op] || []) walk(node[key], scope, depth + 1, location + '/' + key);
  };
  walk(program.body, new Set(), 0, '/body');
  return { valid: errors.length === 0, errors: [...new Set(errors)], diagnostics };
}

export function requiresInvocationObservation(program) {
  const seen = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    return ['call', 'fn', 'defer'].includes(node.op) || Object.values(node).some(visit);
  };
  return visit(program);
}

export class LibraryProgramFrontier extends Error {
  constructor(reason) { super(reason); this.name = 'LibraryProgramFrontier'; }
}
const frontier = reason => { throw new LibraryProgramFrontier(reason); };
const predictedErrors = new WeakSet();
export function isLibraryProgramErrorPrediction(value) { return value !== null && typeof value === 'object' && predictedErrors.has(value); }

/**
 * The same instance may retain cells captured by a returned closure. Distinct
 * producer calls receive distinct cells. Callers own lifetime and step budgets;
 * a model cannot increase either limit or acquire another host capability.
 */
export function createLibraryProgram(program, { callbacks = [], maxSteps = 4096, schedule, onDecision, onRead } = {}) {
  const check = validateLibraryProgram(program);
  if (!check.valid) throw new TypeError(check.errors.join(','));
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100000) throw new TypeError('step_budget');
  // Freeze a private JSON copy so a proposer cannot change instructions after
  // validation. All constants in the language are JSON scalars.
  const body = JSON.parse(JSON.stringify(program.body));
  if (onDecision !== undefined && typeof onDecision !== 'function') throw new TypeError('decision_observer');
  if (onRead !== undefined && typeof onRead !== 'function') throw new TypeError('read_observer');
  // Debugging is a host capability, not part of a proposed rule. It reports
  // decisions the interpreter actually made, never an expected answer.
  const locations = new WeakMap();
  const locate = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (value.op) locations.set(value, path);
    for (const [key, child] of Object.entries(value)) locate(child, `${path}/${key}`);
  };
  if (onDecision || onRead) locate(body, '/body');
  const decision = (node, operands, result) => {
    if (onDecision) onDecision({ path: locations.get(node), op: node.op, operands, result });
    return result;
  };
  const granted = new WeakSet(callbacks);
  const closures = new WeakSet();
  const allocated = new WeakSet();
  const allocate = value => { allocated.add(value); return value; };
  const propertyKey = key => {
    if (!(typeof key === 'string' && key.length <= 128 && !forbidden.has(key)
      || Number.isSafeInteger(key) && key >= 0 && key <= 4096)) return frontier('property_key_outside_domain');
    return key;
  };
  const read = (value, key) => {
    propertyKey(key);
    if (value === null || value === undefined) return frontier('property_on_nullish');
    if (value === globalThis) return frontier('global_receiver_is_opaque');
    const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
    if (descriptor && !('value' in descriptor)) return frontier('accessor_requires_host_evidence');
    if (!descriptor && key in Object(value)) return frontier('inherited_property_requires_host_evidence');
    return descriptor?.value;
  };
  const arrayDescriptor = (value, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor && !('value' in descriptor) || !descriptor && index in value)
      return frontier('array_index_requires_host_evidence');
    return descriptor;
  };
  let remaining = maxSteps, executionDepth = 0;
  // Fuel bounds one synchronous execution, including nested program calls.
  // A long-lived retained callback must not run out merely because yesterday's
  // unrelated invocations consumed its original lifetime budget.
  const runFrame = work => {
    if (executionDepth++ === 0) remaining = maxSteps;
    try { return work(); } finally { executionDepth--; }
  };
  const evaluate = (node, frame) => {
    if (--remaining < 0) return frontier('program_step_limit');
    const ev = child => evaluate(child, frame);
    switch (node.op) {
      case 'literal': return node.value;
      case 'undefined': return undefined;
      case 'make_error': {
        const message = ev(node.message);
        if (typeof message !== 'string' || message.length > 4096) return frontier('error_message_domain');
        const constructors = { Error, TypeError, RangeError, SyntaxError };
        const error = new constructors[node.name](message);
        predictedErrors.add(error); return error;
      }
      case 'throw': throw ev(node.value);
      case 'frontier': return frontier(node.reason);
      case 'string': {
        const value = ev(node.value);
        if (value !== null && !['undefined', 'boolean', 'string', 'number', 'bigint'].includes(typeof value))
          return frontier('string_coercion_requires_host_evidence');
        const result = String(value);
        if (result.length > 4096) return frontier('string_size_limit');
        return result;
      }
      case 'is_array': {
        const value = ev(node.value);
        // Array.isArray performs a brand check, not a length/property guess.
        // Revoked proxies cannot be inspected; ordinary proxies need no traps.
        try { return Array.isArray(value); }
        catch { return frontier('array_brand_unavailable'); }
      }
      case 'number_add': {
        const left = ev(node.left), right = ev(node.right);
        // Primitive Number addition only. Never coerce a host object or grant
        // its valueOf/toPrimitive methods merely to advance a private counter.
        if (typeof left !== 'number' || typeof right !== 'number')
          return frontier('number_add_requires_numbers');
        return left + right;
      }
      case 'symbol': return Symbol.for(node.key);
      case 'arg': return frame.args[node.index];
      case 'args': return [...frame.args];
      case 'receiver': return frame.receiver;
      case 'local': return frame.locals.get(node.name).value;
      case 'set': return frame.locals.get(node.name).value = ev(node.value);
      case 'get':
      case 'lookup': {
        const container = ev(node.value), key = node.op === 'get' ? node.key : ev(node.key);
        const value = read(container, key);
        if (onRead) onRead({path: locations.get(node), op: node.op, container, key, value});
        return value;
      }
      case 'has_own': {
        const value = ev(node.value), key = propertyKey(ev(node.key));
        if (value === null || value === undefined) return frontier('property_on_nullish');
        if (value === globalThis) return frontier('global_receiver_is_opaque');
        return Object.getOwnPropertyDescriptor(Object(value), key) !== undefined;
      }
      case 'keys': {
        const value = ev(node.value);
        if (value === null || !['object', 'function'].includes(typeof value) || value === globalThis)
          return frontier('key_enumeration_outside_domain');
        const keys = Object.keys(value);
        if (keys.length > 4096) return frontier('object_size_limit');
        for (const key of keys) propertyKey(key);
        return allocate(keys);
      }
      case 'put': {
        const value = ev(node.value), key = propertyKey(ev(node.key)), item = ev(node.item);
        // Rules can build private predicted objects, but never write to an
        // application object. Heap mutation needs a separate replay protocol.
        if (!allocated.has(value)) return frontier('mutation_of_host_value_forbidden');
        if (Array.isArray(value) && key === 'length'
          && (!Number.isSafeInteger(item) || item < 0 || item > 4096)) return frontier('array_length_outside_domain');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && (!('value' in descriptor) || !descriptor.writable)
          || !descriptor && !Object.isExtensible(value)) return frontier('write_to_immutable_prediction');
        if (!descriptor && Reflect.ownKeys(value).length >= 4096) return frontier('object_size_limit');
        Object.defineProperty(value, key, descriptor ? { value: item } : {value: item, writable: true, enumerable: true, configurable: true});
        return item;
      }
      case 'array': return allocate(node.items.map(ev));
      case 'at': {
        const value = ev(node.value), index = ev(node.index);
        if (!Array.isArray(value) || !Number.isSafeInteger(index) || index < 0 || index > 4096)
          return frontier('array_index_outside_domain');
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor && !('value' in descriptor) || !descriptor && index in value)
          return frontier('array_index_requires_host_evidence');
        return descriptor?.value;
      }
      case 'every': {
        const items = ev(node.items);
        if (!Array.isArray(items) || items.length > 4096) return frontier('iteration_array_limit');
        for (let index = 0; index < items.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(items, index);
          if (descriptor && !('value' in descriptor) || !descriptor && index in items)
            return frontier('array_index_requires_host_evidence');
          const locals = new Map(frame.locals);
          locals.set(node.value_name, { value: descriptor?.value }); locals.set(node.index_name, { value: index });
          if (!evaluate(node.test, { ...frame, locals })) return false;
        }
        return true;
      }
      case 'object': return allocate(Object.fromEntries(Object.entries(node.entries).map(([key, value]) => [key, ev(value)])));
      case 'seal': case 'freeze': {
        const value = ev(node.value);
        if (!allocated.has(value)) return frontier('mutation_of_host_value_forbidden');
        return node.op === 'freeze' ? Object.freeze(value) : Object.seal(value);
      }
      case 'type': return typeof ev(node.value);
      case 'same': case 'equal': {
        const left = ev(node.left), right = ev(node.right);
        return decision(node, [left, right], node.op === 'same' ? Object.is(left, right) : left === right);
      }
      case 'not': return !ev(node.value);
      case 'if': {
        const condition = Boolean(ev(node.test));
        decision(node, [condition], condition);
        return condition ? ev(node.then) : ev(node.else);
      }
      case 'bind': {
        const locals = new Map(frame.locals);
        locals.set(node.name, { value: ev(node.value) });
        return evaluate(node.body, { ...frame, locals });
      }
      case 'sequence': { let value; for (const step of node.steps) value = ev(step); return value; }
      case 'fn': {
        const fn = function (...args) {
          const receiver = node.this_mode === 'lexical' ? frame.receiver
            : node.this_mode === 'sloppy' ? this == null ? globalThis : Object(this) : this;
          return runFrame(() => evaluate(node.body, { args, receiver, locals: frame.locals }));
        };
        closures.add(fn);
        return fn;
      }
      case 'call': {
        const target = ev(node.target), receiver = ev(node.receiver), args = ev(node.args);
        if (typeof target !== 'function' || !closures.has(target) && !granted.has(target)) return frontier('callback_capability_missing');
        if (!Array.isArray(args) || args.length > 64) return frontier('call_arguments_outside_domain');
        return Reflect.apply(target, receiver, args);
      }
      case 'concat': {
        const arrays = node.items.map(ev);
        if (!arrays.every(Array.isArray)) return frontier('concat_requires_arrays');
        const result = [];
        for (const array of arrays) {
          if (array.length > 4096) return frontier('array_size_limit');
          for (let index = 0; index < array.length; index++) {
            const descriptor = arrayDescriptor(array, index);
            if (descriptor) result.push(descriptor.value);
            if (result.length > 4096) return frontier('array_size_limit');
          }
        }
        return allocate(result);
      }
      case 'slice': {
        const value = ev(node.value);
        if (!Array.isArray(value)) return frontier('slice_requires_array');
        if (value.length > 4096) return frontier('array_size_limit');
        const start = node.start < 0 ? Math.max(value.length + node.start, 0) : Math.min(node.start, value.length);
        const result = allocate(new Array(value.length - start));
        for (let index = start; index < value.length; index++) {
          const descriptor = arrayDescriptor(value, index);
          if (descriptor) result[index - start] = descriptor.value;
        }
        return result;
      }
      case 'defer': {
        if (typeof schedule !== 'function') return frontier('scheduler_capability_missing');
        schedule(() => runFrame(() => evaluate(node.body, frame)));
        return undefined;
      }
      default: return frontier('unknown_instruction');
    }
  };
  return Object.freeze({
    invoke(args, receiver = undefined) {
      if (!Array.isArray(args) || args.length > 64) throw new TypeError('invocation_arguments');
      return runFrame(() => evaluate(body, { args, receiver, locals: new Map() }));
    },
    // Returned values are not automatically executable capabilities. The host
    // must use the same grant check as a call instruction, otherwise replay of
    // a pass-through function could execute application code a second time.
    canInvoke(target) { return typeof target === 'function' && (closures.has(target) || granted.has(target)); },
    invokeCallable(target, args, receiver = undefined) {
      if(typeof target !== 'function' || !closures.has(target) && !granted.has(target)) return frontier('callback_capability_missing');
      if(!Array.isArray(args) || args.length > 64) throw new TypeError('invocation_arguments');
      return runFrame(()=>Reflect.apply(target, receiver, args));
    },
    // Only the trusted observer receives this method. Rule instructions cannot
    // acquire capabilities for functions supplied in a later invocation.
    grantCallback(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback_capability');
      granted.add(callback);
    },
    get remainingSteps() { return remaining; },
  });
}
