import { createLibraryProgram, validateLibraryProgram } from './library-program.mjs';

/**
 * Host-backed alias attribution for APIs that retain and return user functions.
 * The program receives [argument handles, result handle, remember, resolve]. It may
 * call only the two private evidence capabilities; application callbacks are
 * never replaced, invoked, or granted to the program.
 *
 * Ownership is a required host fact. Observing a returned function proves which
 * registered source it refers to, not why a framework chose that cached value,
 * whether its render committed, or whether the function subsequently executed.
 */
export function createOwnedReferenceBoundary({ producer, program, captureOwner, occurrencePrefix = 'owned-reference', executionContext = null, executionSource = null }) {
  if (typeof producer !== 'function' || typeof captureOwner !== 'function') throw new TypeError('owned_reference_host');
  if(executionContext!==null&&(typeof executionContext.run!=='function'||typeof executionContext.current!=='function'))throw new TypeError('execution_context_host');
  const format = validateLibraryProgram(program);
  if (!format.valid) throw new TypeError(format.errors.join(','));
  program = structuredClone(program);
  const owners = new WeakMap(), evidence = [], failures = [];
  const handles = new WeakMap(), references = new WeakMap();
  const handle = value => {
    if (value === null || !['object', 'function'].includes(typeof value)) return value;
    if (!handles.has(value)) {
      const token = Object.freeze({ kind: typeof value });
      handles.set(value, token); references.set(token, value);
    }
    return handles.get(value);
  };
  let ownerSequence = 0, callSequence = 0, valueSequence = 0;
  const fail = (occurrence, reason) => failures.push({ occurrence, reason });
  return Object.freeze({
    invoke(args, { receiver = undefined, callbackIds = {} } = {}) {
      const occurrence = `${occurrencePrefix}:${++callSequence}`;
      let executionId=null;
      const call=()=>{
        const actual=event=>{executionId=event?.id??null;return Reflect.apply(producer,receiver,args)};
        return executionContext?executionContext.run({kind:'library_invocation',occurrence,source:executionSource},actual):actual(null);
      };
      let owner;
      try { owner = captureOwner(); } catch { fail(occurrence, 'mounted_owner_unavailable'); }
      if (!owner || !['object', 'function'].includes(typeof owner)) {
        fail(occurrence, 'mounted_owner_unavailable');
        return call();
      }
      let state = owners.get(owner);
      if (!state) { state = { id: `${occurrencePrefix}:owner:${++ownerSequence}`, values: new WeakMap() }; owners.set(owner, state); }
      // Run the actual API with its exact original arguments. In particular,
      // useCallback(fn) must be allowed to return fn with unchanged identity.
      const result = call();
      const selections = new WeakMap();
      const remember = token => {
        const value = token && typeof token === 'object' ? references.get(token) : undefined;
        if (typeof value !== 'function') throw new Error('remember_requires_callback_argument');
        const sources = args.flatMap((arg, index) => arg === value && Object.hasOwn(callbackIds, index) ? [callbackIds[index]] : []);
        if (!sources.length) throw new Error('callback_source_capability_missing');
        let stored = state.values.get(value);
        if (!stored) { stored = { id: `${state.id}:value:${++valueSequence}`, sources: new Set() }; state.values.set(value, stored); }
        sources.forEach(source => stored.sources.add(source));
        return undefined;
      };
      const resolve = reference => {
        const value = reference && typeof reference === 'object' ? references.get(reference) : undefined;
        if (value !== result || typeof value !== 'function') throw new Error('selection_must_be_actual_returned_callback');
        const stored = state.values.get(value);
        if (!stored) throw new Error('returned_callback_origin_unobserved');
        const token = Object.freeze({}); selections.set(token, stored); return token;
      };
      try {
        const engine = createLibraryProgram(program, { callbacks: [remember, resolve] });
        // Programs see identity handles, not application objects. Even an
        // irrelevant property read in a proposed rule cannot trigger a user
        // Proxy trap/getter or expose a callable application function.
        const token = engine.invoke([args.map(handle), handle(result), remember, resolve]);
        const selected = token && typeof token === 'object' ? selections.get(token) : null;
        if (!selected) throw new Error('selection_evidence_missing');
        evidence.push({ schema: 'producttrace.library-owned-reference.v1', occurrence, execution_id: executionId, owner: state.id,
          value: selected.id, sources: [...selected.sources], kind: 'returned_callback_reference',
          reason: 'The actual API returned this exact previously observed callback in the same host-attested slot. Registration is not execution or commit evidence.' });
      } catch (error) { fail(occurrence, error.message); }
      return result;
    },
    checkpoint() { return { status: failures.length ? 'frontier' : 'observed_agreement', observation_mode: 'owned_references',
      calls: callSequence, failures: structuredClone(failures), evidence: structuredClone(evidence) }; },
  });
}

/**
 * One private marker hook per instrumented call supplies React's own mounted
 * slot identity, including separate instances and remounts. This host changes
 * hook layout, so it must be attached consistently at build time, never toggled
 * midway through a mounted tree. No Fiber field or component-name guess is used.
 */
export function createReactReferenceOwnerHost(React) {
  if (!React || !['18.2.0', '18.3.1', '19.1.1'].includes(React.version) || typeof React.useRef !== 'function')
    throw new TypeError('react_owner_host_version_unverified');
  const useRef = React.useRef;
  return Object.freeze({ captureOwner() { return useRef(null); } });
}

/** A private memo with the same dependency input supplies React's actual cache
 * generation for this instrumented slot. React discards/retains these adjacent
 * memo hooks together in the pinned production renderers. This is not a commit
 * event, and both marker hooks must be installed consistently before mounting.
 * Independent renderer tests attest suspension, retry and dependency behavior.
 */
export function createReactMemoOwnerHost(React) {
  const owner=createReactReferenceOwnerHost(React);
  if(typeof React.useMemo!=='function')throw new TypeError('react_memo_host_unavailable');
  const useMemo=React.useMemo;
  return Object.freeze({captureOwner:owner.captureOwner,
    captureGeneration(args){return useMemo(()=>({}),args[1])}});
}
