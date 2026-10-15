import { validateLibraryProgram } from '../analysis/library-program.mjs';
import { LIBRARY_PROGRAM_SYNTAX } from '../analysis/library-program-syntax.mjs';
import { programHash } from '../analysis/library-program-bank.mjs';
import { STRUCTURED_PROGRAM_PROPOSAL_SCHEMA, decodeStructuredProgram } from './library-program-format.mjs';

export const LIBRARY_PROGRAM_PROPOSAL_SCHEMA = STRUCTURED_PROGRAM_PROPOSAL_SCHEMA;
export const LIBRARY_PROGRAM_AUTHOR_PROMPT = `Read the exact installed implementation and describe the requested boundary domain using a small program. Never write tests, change the domain, invent operations, or claim correctness beyond the scope. You receive no bank answers or test code. If the language cannot describe this scope, abstain and identify the missing operation or host fact. A failed program will receive an independently observed counterexample/check failure so you can repair it.
Return response schema producttrace.library-program-proposal.v2. program is the structured object {"schema":"producttrace.library-program.v1","body":INSTRUCTION}, not a JSON string or JavaScript. Use null only when abstaining. If a previous reply used program_json, repair it into this structured format. Each instruction has exactly these fields:
literal: op,value (finite number, string, boolean or null); undefined: op; symbol: op,key (Symbol.for); arg: op,index (zero-based current invocation argument); args: op (array of all current arguments); receiver: op (current this);
local: op,name; bind: op,name,value,body (lexical mutable cell, evaluate value first); set: op,name,value (set an existing cell and return the value); sequence: op,steps (instructions, return last result);
get: op,value,key (own data property; key literal string or integer); array: op,items (instructions); object: op,entries (array of {key:property-name,value:INSTRUCTION}, unique keys); seal: op,value (Object.seal, only a newly allocated program object);
type: op,value (typeof); is_array: op,value (Array.isArray brand check, including cross-realm arrays; length fields do not imply an array; revoked proxy is a frontier); same: op,left,right (Object.is: NaN matches NaN, but +0 differs from -0); equal: op,left,right (JavaScript strict ===: NaN does not equal itself, while +0 equals -0); number_add: op,left,right (JavaScript primitive Number addition; includes NaN, infinities and signed zero; no coercion, strings or bigint; non-number operands are a frontier); not: op,value; if: op,test,then,else (truthiness and only evaluate selected branch);
at: op,value,index (array and computed nonnegative integer index, own data properties only); every: op,items,value_name,index_name,test (iterate each index in an array, bind its value/index as lexical locals, stop at first falsy test; empty array true; holes read as undefined; bounded by host fuel);
fn: op,this_mode,body (return a new closure retaining lexical cells; args/arg now refer to its invocation, not the outer function; this_mode is strict, sloppy, or lexical, with normal JavaScript receiver coercion);
call: op,target,receiver,args (invoke only a supplied callback or program closure, args must evaluate to an array; returns the actual callback result or throws its exact error);
concat: op,items (each instruction evaluates to an array, concatenate one level); slice: op,value,start (array slice from literal start); defer: op,body (schedule a microtask; return undefined).
make_error: op,name,message (name is Error,TypeError,RangeError,SyntaxError; message is an instruction returning a bounded string); throw: op,value (throw the evaluated value). Generated standard errors only compare without stack when the trusted domain explicitly permits standard_error_without_stack; callback-thrown identities remain exact.
keys: op,value (own enumerable string keys of an object/function, in Object.keys order, bounded); has_own: op,value,key (computed own-property existence, includes non-enumerable properties and never reads the property value); lookup: op,value,key (computed string/integer own data property, no accessors or inherited reads); put: op,value,key,item (write a computed own data property of a newly allocated program object only; return item); freeze: op,value (freeze a newly allocated program object only); string: op,value (convert a primitive other than symbol to string, never run object coercion); frontier: op,reason (stop with an explicit lowercase_identifier reason when input is outside the rule's supported domain; this never counts as agreement). Arrays allocated by array are writable private objects: put at their current length appends an item. every may sequence writes and finish with true to visit all indices. A private recursive helper can be created by bind of an undefined cell followed by set of fn capturing that cell; call may invoke that helper, subject to fuel. These compositions do not require separate map, fold, push or recursion operations. Dynamic property keys exclude __proto__,prototype,constructor. These operations do not grant permission to mutate application objects. result_paths selects data to compare; result_identity_paths independently selects opaque result-object aliases to compare, without inspecting unprojected fields. They are checker-owned scope declarations, not instructions you can change.
Follow the supplied execution_protocol and its input frame. For call_boundary, the body ALREADY runs when the exported library function is called. Do not wrap that export in an extra fn. Use fn for a private helper closure or a function the library returns; do not introduce an extra exported-function wrapper. For the synthetic example function remember(value) { return () => value; }, the body is {"op":"bind","name":"saved","value":{"op":"arg","index":0},"body":{"op":"fn","this_mode":"lexical","body":{"op":"local","name":"saved"}}}. This contains one fn, not two. For checker-declared result_methods, return the object with its fn-valued methods. Each later observed own-method call invokes that fn with the method call arguments and receiver; do not add another wrapper. At the producer boundary the host calls the export; at the returned_callback boundary it calls the function returned by that export. A function result at the first stage does not mean the second stage should also return a function. Host-observation protocols have a different explicit input frame; do not confuse that frame with the library's arguments. The observed_type in feedback is the REAL LIBRARY result at that stage; predicted_type is YOUR PROGRAM result at that stage.
Application objects cannot be mutated; put can write newly allocated private program objects. Bounded composition of keys, lookup, put and every can copy enumerable string-keyed own data without an object-spread opcode. There is no unbounded loop, implicit callback invocation, library-specific hook, or implicit scheduling. Capture outer arguments in bind cells before constructing a fn if needed. Arrow-like calls generally pass undefined as receiver; fn.apply(null,...) passes null. Sloppy returned functions coerce undefined/null receivers to the host global receiver, and box primitives. The host global receiver is opaque. Call arguments are a full ordered list, not merely the first item. Preserve callback return identity and count, branches, ownership and timing. Version-specific constants must come from the installed source. Warnings/debug-only fields excluded by the declared scope need not be represented. Passing means agreement on independently tested cases, not a universal proof.`;

function parseProposal(response) {
  if (response?.schema === 'producttrace.library-program-proposal.v2') {
    if (Object.keys(response).sort().join(',') !== 'program,reason,schema,status'
      || !['propose', 'abstain'].includes(response.status) || typeof response.reason !== 'string'
      || response.reason.length > 5000) return { valid: false, reason: 'proposal_format' };
    if (response.status === 'abstain') return response.program === null && response.reason.trim()
      ? { valid: true, abstained: true, reason: response.reason } : { valid: false, reason: 'abstention_format' };
    let program;
    try { program = decodeStructuredProgram(response.program); }
    catch (error) { return { valid: false, reason: error.message }; }
    const format = validateLibraryProgram(program);
    return format.valid ? { valid: true, program } : { valid: false, reason: format.errors[0], detail: { diagnostics: format.diagnostics ?? [] } };
  }
  // Archived v1 attempts remain readable for auditing and automatic resumption.
  // New provider requests exclusively use the structured v2 transport above.
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || Object.keys(response).sort().join(',') !== 'program_json,reason,schema,status'
    || response.schema !== 'producttrace.library-program-proposal.v1'
    || !['propose', 'abstain'].includes(response.status) || typeof response.reason !== 'string'
    || response.reason.length > 5000) return { valid: false, reason: 'proposal_format' };
  if (response.status === 'abstain') return response.program_json === null && response.reason.trim()
    ? { valid: true, abstained: true, reason: response.reason } : { valid: false, reason: 'abstention_format' };
  if (typeof response.program_json !== 'string' || response.program_json.length > 50000) return { valid: false, reason: 'program_json_missing_or_large' };
  let program;
  try { program = JSON.parse(response.program_json); } catch (error) {
    // A syntax error is safe, useful repair feedback: it describes the proposed
    // text, not a hidden grading input or a replacement answer.
    return { valid: false, reason: 'program_json_parse', detail: String(error.message).slice(0, 500) };
  }
  const format = validateLibraryProgram(program);
  return format.valid ? { valid: true, program } : { valid: false, reason: format.errors[0], detail: { diagnostics: format.diagnostics ?? [] } };
}

// Repeated instances of one failure must not crowd a different defect out of
// the repair prompt. Select bounded, distinct checker diagnoses, not answers.
function repairFeedback(check) {
  const seen = new Set(), failures = [];
  for (const failure of check.report?.failures ?? []) {
    const signature = `${failure.reason}:${failure.detail?.boundary ?? ''}:${failure.detail?.input_kind ?? ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature); failures.push(failure);
    if (failures.length === 3) break;
  }
  return { stage: check.stage, reason: check.reason, detail: check.detail, failures };
}

/** Provider owns generation; the preconfigured bank owns all independent checks. */
export async function authorLibraryProgram({ implementation, scope, bank, provider,
  maxAttempts = 3, maxOutputTokens = 5000, onAttempt = () => {}, previousProposal = null }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) throw new TypeError('attempt_limit');
  if (implementation.context.source_status !== 'ready_for_scoped_proposal' || !implementation.unchanged())
    return { status: 'frontier', reason: implementation.context.source_reason || 'source_unavailable', attempts: [] };
  const context = structuredClone(implementation.context), declaredScope = structuredClone(scope);
  const protocol = declaredScope.protocol || 'call_boundary';
  if (!['call_boundary', 'owned_returned_reference', 'owned_call_boundary', 'host_event_boundary'].includes(protocol))
    return { status: 'frontier', reason: 'unsupported_execution_protocol', attempts: [] };
  const protocolDefinition = protocol === 'call_boundary'
    ? 'Frame arguments are the real library call arguments. The program predicts its boundary result and callback behavior.'
    : protocol === 'host_event_boundary'
      ? 'The body is a private factory evaluated once with no arguments per independently attested owner. Return a private event-handler closure. Its frame is [event, registrationArguments]. register supplies [setupShadow, dependencyListSnapshot]; commit and disconnect supply an empty argument array. Each event handler must return undefined. Host events are independently observed, not inferred from setup execution. Register may update pending inputs without committing them. Commit/disconnect replay checks the actual setup and cleanup calls already recorded in that host event, including count, order, exact arguments, receiver and captured callback outcome. A setup return that is callable receives a separate shadow capability for later cleanup; replay never executes application code. Use persistent private cells and ordinary existing instructions. Do not treat rendering as committing, and do not create a new scheduling opcode.'
    : protocol === 'owned_call_boundary'
      ? 'The program body is evaluated once with no arguments for each host-attested owner slot and must return a private closure. Each real API invocation in that slot then calls that closure with the original arguments and receiver. Lexical cells persist per owner; different owners start fresh. If the independent scope requires a host cache generation, cells instead persist per owner/generation pair and the host may select a previously observed generation after discarded work. Generation identity is not a commit claim. The entire returned value graph, aliases, and thrown outcomes are checked. Only function arguments at the checker-declared callback_arguments positions are granted capabilities; other function inputs may be retained as values only. Callback outcomes are independently observed and replayed without executing application code again. Outside writes and host scheduling are not predicted; report a frontier when they cannot be explained. This protocol deliberately uses a bootstrap closure; it is not an extra wrapper around an ordinary call_boundary.'
      : 'Frame arguments: 0 = argument array with every object/function replaced by a stable opaque identity handle (own kind field is object or function; primitives unchanged); 1 = actual returned value represented the same way; 2 = trusted remember capability; 3 = trusted resolve capability. remember(handle) records only a handle for an observed source callback argument in this host-attested mounted slot. resolve(handle) accepts only the handle for the actual returned callback with a previously recorded origin in the same slot, and returns an opaque evidence token. Application object properties, dependency contents and raw user functions are unavailable to this protocol. The program must return that token. Only these two capabilities may be called; user callbacks must not execute. The rule attributes returned reference origin using observations; it does not predict dependency decisions, commits, or later callback execution. Abstain if the result cannot be related to input callback identities under this protocol.';
  const attempts = [], failedPrograms = new Set();
  const admitCandidate = async program => {
    try { return await bank.admit({ implementation, program, scope: declaredScope }); }
    catch (error) { return { status: 'frontier', stage: 'checker', reason: 'checker_failure', detail: String(error.message).slice(0, 300) }; }
  };
  let previous = null, feedback = null;
  if (previousProposal) {
    const parsed = parseProposal(previousProposal);
    if (parsed.abstained || previousProposal.status !== 'propose') throw new TypeError('resumable_program_required');
    const rechecked = parsed.valid
      ? await admitCandidate(parsed.program)
      : { status: 'rejected', stage: 'format', reason: parsed.reason, detail: parsed.detail };
    if (rechecked.status === 'admitted') return { status: 'admitted', program: parsed.program, admission: rechecked, attempts, reused_proposal: true };
    if (rechecked.reason === 'checker_failure') return { status: 'frontier', reason: 'checker_failure', check: rechecked, attempts };
    previous = previousProposal;
    feedback = repairFeedback(rechecked);
  }
  for (let index = 0; index < maxAttempts; index++) {
    if (!implementation.unchanged()) return { status: 'frontier', reason: 'implementation_changed', attempts };
    const input = JSON.stringify({ phase: previous ? 'repair' : 'initial', implementation: context,
      language_operations: Object.keys(LIBRARY_PROGRAM_SYNTAX),
      boundary_domain: declaredScope.description, execution_protocol: protocol, protocol_definition: protocolDefinition,
      boundary_capabilities: { result_methods: (declaredScope.resultMethods ?? []).map(row=>({path:row.path,callback_arguments:row.callbackArguments})), owner_generation: declaredScope.ownerGeneration ?? 'owner', callback_arguments: declaredScope.callbackArguments, returned_callback_arguments: declaredScope.returnedCallbackArguments ?? [], result_paths: declaredScope.resultPaths, result_identity_paths: declaredScope.resultIdentityPaths ?? [],
        error_observation: declaredScope.errorObservation || 'identity', accessor_observation: declaredScope.accessorObservation || 'reject', nested_references: declaredScope.nestedReferences === true,
        observation_mode: declaredScope.observationMode || 'invocations' },
      previous_proposal: previous, feedback });
    let generated;
    try {
      generated = await provider.generate({ system: LIBRARY_PROGRAM_AUTHOR_PROMPT, input,
        schema: LIBRARY_PROGRAM_PROPOSAL_SCHEMA, maxOutputTokens, timeoutMs: 60000 });
    } catch (error) {
      const metadata = error.attempt_metadata || {};
      const failureStage = error.stage === 'spending' ? 'spending' : 'provider';
      const failureReason = failureStage === 'spending' ? 'spending_gate_closed' : 'provider_failure';
      const failure = { number: index + 1, proposal: null, provider_error: String(error.message).slice(0, 300),
        finish_reason: metadata.finish_reason ?? null, usage: metadata.usage ?? null,
        cost_usd: metadata.cost_usd ?? null, latency_ms: metadata.latency_ms ?? null,
        provider_called: metadata.provider_called ?? null,
        prompt_sha256: programHash([LIBRARY_PROGRAM_AUTHOR_PROMPT, input]),
        check: { status: 'frontier', stage: failureStage, reason: failureReason } };
      attempts.push(failure);
      await onAttempt(structuredClone(failure));
      return { status: 'frontier', reason: failureReason, detail: String(error.message).slice(0, 300), attempts };
    }
    const parsed = parseProposal(generated.proposal);
    const attempt = { number: index + 1, proposal: generated.proposal, usage: generated.usage,
      cost_usd: generated.cost_usd, latency_ms: generated.latency_ms, prompt_sha256: programHash([LIBRARY_PROGRAM_AUTHOR_PROMPT, input]) };
    if (!parsed.valid) attempt.check = { status: 'rejected', stage: 'format', reason: parsed.reason, detail: parsed.detail };
    else if (parsed.abstained) {
      // A model's refusal is a frontier, not independently justified abstention.
      // It requires a separate host diagnosis before it counts as resolved.
      attempt.check = { status: 'frontier', stage: 'proposal', reason: parsed.reason };
    } else attempt.check = await admitCandidate(parsed.program);
    attempts.push(attempt);
    await onAttempt(structuredClone(attempt));
    if (attempt.check.status === 'admitted') return { status: 'admitted', program: parsed.program, admission: attempt.check, attempts };
    if (attempt.check.reason === 'checker_failure') return { status: 'frontier', reason: 'checker_failure', attempts };
    if (parsed.abstained) return { status: 'frontier', reason: 'model_abstained_requires_independent_diagnosis', attempts };
    // Changes to the explanation cannot disguise an identical failed program.
    const fingerprint = programHash(parsed.program ?? generated.proposal?.program ?? generated.proposal?.program_json ?? generated.proposal);
    if (failedPrograms.has(fingerprint)) return { status: 'frontier', reason: 'repeated_failed_proposal', attempts };
    failedPrograms.add(fingerprint);
    // Only failed observations reach the proposer. Never send the expected rule,
    // grading programs, test source, complete fixtures, or a bank entry.
    feedback = repairFeedback(attempt.check);
    previous = generated.proposal;
  }
  return { status: 'frontier', reason: 'repair_attempts_exhausted', attempts };
}
