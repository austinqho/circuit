import {validateReactExecutionRule} from './react-execution-rule.mjs';
const text=value=>typeof value==='string' && value.length>0;
const encoded=value=>{
  if(!value || !text(value.identity) || !['null','undefined','function','object','string','number','boolean','bigint','symbol'].includes(value.kind)
    || typeof value.truthy!=='boolean' || !['primitive','redacted'].includes(value.encoding))return false;
  if(value.encoding==='primitive')return (value.kind==='null'?value.value===null:typeof value.value===value.kind && ['string','boolean','number'].includes(value.kind))
    && (typeof value.value!=='number' || Number.isFinite(value.value)) && Boolean(value.value)===value.truthy;
  return value.value===null && !['null','string','boolean'].includes(value.kind)
    && (value.kind==='undefined'?!value.truthy:['object','function','symbol'].includes(value.kind)?value.truthy:true);
};

/** A throwing call with unevaluated arguments does not prove the library ran.
 * A completed call records the actual result; marker getters are not replayed. */
export function checkReactPredicateEvidence(rule,call,{inputIndices=[]}={}) {
  const fail=reason=>({status:'unresolved',reason});
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='element_predicate')return fail('predicate_rule_invalid');
  if(!call || !text(call.scope_id) || !call.inputs || !Array.isArray(call.callbacks) || call.callbacks.length
    || !['returned','threw'].includes(call.outcome) || !encoded(call.result))return fail('predicate_call_completion_required');
  if(Object.entries(call.inputs).some(([index,value])=>!inputIndices.includes(Number(index)) || !encoded(value)))return fail('predicate_inputs_required');
  if(inputIndices.some(index=>!encoded(call.inputs[index])))return fail(call.outcome==='threw'?'predicate_argument_evaluation_failed':'predicate_inputs_required');
  const argument=call.inputs[rule.argument];
  const readsMarker=(argument?.kind||'undefined')===rule.input_kind && !(rule.exclude_null && argument?.kind==='null');
  // Snapshots encode null as its own kind, while JavaScript's typeof is object.
  const actualRead=argument?.kind==='null'?rule.input_kind==='object' && !rule.exclude_null:readsMarker;
  if(!actualRead && (call.outcome!=='returned' || call.result.kind!=='boolean' || call.result.value!==false))return fail('predicate_guard_outcome_mismatch');
  if(call.outcome==='returned' && (call.result.kind!=='boolean' || call.result.encoding!=='primitive'))return fail('predicate_boolean_result_required');
  return {status:'resolved',reason:null,outcome:call.outcome,
    ...(call.outcome==='returned'?{value:call.result.value}:{exception:call.result}),
    marker_read_required:actualRead,marker_read_separately_observed:false};
}
/** Validate a completed real call against the program. Scheduling remains a
 * conditional source obligation, never inferred commit or asynchronous proof. */
export function checkReactScopeEvidence(rule,scope,{sourceId,sourceIds=sourceId?[sourceId]:[],inputIndices=[]}={}) {
  const fail=reason=>({status:'unresolved',reason});
  if(!validateReactExecutionRule(rule).valid || !['synchronous_scope','test_scope'].includes(rule.kind))return fail('scope_rule_invalid');
  const testScope=rule.kind==='test_scope';
  if(testScope && rule.callback_timing!=='synchronous')return fail('test_scope_timing_unobserved');
  if(!scope || !text(scope.scope_id) || scope.parent_scope_id!=null && !text(scope.parent_scope_id)
    || scope.action_occurrence_id!=null && !text(scope.action_occurrence_id) || !scope.inputs || !Array.isArray(scope.callbacks)
    || !['returned','threw'].includes(scope.outcome) || !encoded(scope.result))return fail('scope_completion_required');
  if(inputIndices.some(index=>!encoded(scope.inputs[index])) || Object.entries(scope.inputs).some(([index,value])=>!inputIndices.includes(Number(index)) || !encoded(value)))return fail('scope_inputs_required');
  const callback=scope.inputs[rule.callback_argument];
  const skipped=rule.missing_callback==='skip_falsy' && !callback?.truthy;
  const callable=callback?.kind==='function';
  if(!callable) {
    if(scope.callbacks.length || scope.outcome!==(skipped?'returned':'threw')
      || skipped && scope.result.kind!=='undefined')return fail('scope_missing_callback_mismatch');
  } else {
    if(scope.callbacks.length!==1)return fail('scope_callback_count_mismatch');
    const call=scope.callbacks[0];
    if(!text(call.source_id) || !sourceIds.includes(call.source_id))return fail('scope_callback_source_unproven');
    if(call.callback_identity_id!=null && call.callback_identity_id!==callback.identity)return fail('scope_callback_identity_mismatch');
    if(!text(call.invocation_id) || !encoded(call.result) || !['returned','threw'].includes(call.outcome)
      || !Array.isArray(call.arguments) || call.arguments.length!==rule.callback_arguments.length)return fail('scope_callback_completion_required');
    for(const [index,inputIndex] of rule.callback_arguments.entries()) {
      const actual=call.arguments[index],input=scope.inputs[inputIndex];
      if(!encoded(actual) || (input?JSON.stringify(input)!==JSON.stringify(actual):actual.kind!=='undefined'))return fail('scope_callback_argument_mismatch');
    }
    if(scope.outcome==='returned' && (call.outcome!=='returned'
      || (rule.result==='undefined'?scope.result.kind!=='undefined':testScope&&rule.result==='thenable'?scope.result.kind!=='object':JSON.stringify(scope.result)!==JSON.stringify(call.result))))return fail('scope_result_mismatch');
    if(testScope && call.outcome==='threw' && (scope.outcome!=='threw' || rule.callback_exceptions!=='propagate'
      || JSON.stringify(scope.result)!==JSON.stringify(call.result)))return fail('scope_exception_mismatch');
    if(scope.outcome==='threw' && rule.exceptions==='propagate'
      && (call.outcome!=='threw' || JSON.stringify(scope.result)!==JSON.stringify(call.result)))return fail('scope_exception_mismatch');
  }
  if(testScope)return {status:'resolved',reason:null,callback_executed:callable,
    scheduling:{kind:'test_queue',claim:'conditional_source_contract',commit_observed:false,queue_drain_observed:false},
    thenable_protocol_observed:false,await_completion_observed:false,build_observed:false,
    error_origin:scope.outcome==='threw'?(scope.callbacks[0]?.result.identity===scope.result.identity?'callback':'unobserved'):null};
  return {status:'resolved',reason:null,callback_executed:callable,
    scheduling:{kind:rule.scheduling,claim:'conditional_source_contract',commit_observed:false,async_continuation:'outside_scope'},
    error_origin:scope.outcome==='threw'?(scope.callbacks[0]?.result.identity===scope.result.identity?'callback':'scope'):null};
}
