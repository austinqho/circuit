/** Keep a predicate result with the invocation of its containing source body.
 * Booleans have no object identity; equal values from separate calls are never
 * joined merely because they compare equal. The compiler supplies the local,
 * immutable binding path and the observer supplies the actual call occurrence.
 * This factory is embedded unchanged in the browser build. */
export function createReactPredicateUseObserver(config){
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

export function checkReactPredicateUse(record,origin,{fingerprint,entry}){
  const fail=reason=>({schema:'producttrace.react-predicate-use-join.v1',status:'unresolved',reason,runtime_observed:false});
  if(!record||record.schema!=='producttrace.react-predicate-use.v1'||record.kind!=='react_predicate_use'
    ||record.runtime_observed!==true||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session
    ||entry?.kind!=='predicate_use'||typeof entry.inverted!=='boolean'||entry.source_call_id!==record.source_call_id
    ||entry.condition_source_id!==record.condition_source_id)return fail('predicate_use_context_required');
  const scoped=id=>typeof id==='string'&&id.startsWith(record.session+':')&&id!==record.session+':';
  if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'
    ||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)
    ||!record.evidence_ids.every(scoped))return fail('predicate_use_occurrence_required');
  if(record.frontier)return fail(record.frontier);
  const proof=origin?.runtime?.predicate_proof,call=proof?.call;
  if(!origin||origin.status!=='resolved'||origin.runtime?.session!==record.session
    ||origin.source?.source_call_id!==record.source_call_id||proof?.outcome!=='returned'
    ||!call||call.scope_id!==record.source_scope_id||!scoped(call.scope_id)
    ||!scoped(record.source_frame_id)||call.source_frame_id!==record.source_frame_id)return fail('predicate_call_receipt_required');
  if(typeof record.value!=='boolean'||record.value!==(entry.inverted?!proof.value:proof.value)
    ||(record.action_occurrence_id||null)!==(call.action_occurrence_id||null))return fail('predicate_consumed_value_mismatch');
  return {schema:'producttrace.react-predicate-use-join.v1',status:'resolved',reason:null,runtime_observed:true,
    observation_id:record.observation_id,source:{source_call_id:record.source_call_id,condition_source_id:record.condition_source_id},
    runtime:{claim:'observed_predicate_result_consumption',session:record.session,source_scope_id:call.scope_id,
      origin_observation_id:origin.observation_id,value:record.value,action_occurrence_id:record.action_occurrence_id||null,
      candidates:proof.candidates.filter(edge=>edge.predicate_condition.node_id===record.condition_source_id),
      target_execution_observed:false}};
}
