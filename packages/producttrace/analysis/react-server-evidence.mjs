import {validateReactExecutionRule} from './react-execution-rule.mjs';
export function createReactServerEvidenceSession({fingerprint,entries,maxPending=1000}) {
 const indexed=new Map(entries.filter(row=>row.server_rule).map(row=>[row.key,row]));
 const consumers=new Map(entries.filter(row=>row.kind==='server_consumer').map(row=>[row.key,row]));
 const seen=new Set(),pending=new Map(),origins=new Map(),resources=new Map();
 const pendingLimit=Number.isSafeInteger(maxPending)&&maxPending>0?Math.min(maxPending,1000):1000;
 return {join(record){
  const fail=reason=>({schema:'producttrace.react-server-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
  const scoped=id=>typeof record?.session==='string'&&record.session.length>0&&typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(record?.schema!=='producttrace.react-server-observation.v1'||record.kind!=='react_server'||record.runtime_observed!==true||record.map_fingerprint!==fingerprint
   ||!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('invalid_server_observation');
  const entry=indexed.get(record.manifest_key),rule=entry?.server_rule;
  if(!entry||record.source_call_id!==entry.source_call_id||record.semantic_id!==entry.semantic_id||!entry.package_verification_sha256
    ||!validateReactExecutionRule(rule).valid||!['server_string','legacy_server_stream','readable_server_stream','pipeable_server_stream'].includes(rule.kind))return fail('server_source_rule_required');
  const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind)
   &&(value.encoding==='redacted'?value.value===null:value.encoding==='primitive'&&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
  if(record.frontier)return fail(record.frontier);
  if(seen.has(record.observation_id))return fail('duplicate_server_observation');
  const consumerOperations=new Set(['promise_fulfilled','pipe_started','pipe_failed','stream_completed','stream_errored','stream_closed','consumer_failed']);
  if(consumerOperations.has(record.operation)){
   const consumer=consumers.get(record.consumer_manifest_key),origin=origins.get(record.creation_observation_id);
   const same=(left,right)=>left&&right&&['identity','kind','encoding','value'].every(key=>Object.is(left[key],right[key]));
   if(!consumer||consumer.server_consumer_source_id!==record.consumer_source_id||consumer.server_consumer_kind!==record.consumer_kind
     ||!origin||origin.manifest_key!==record.manifest_key||origin.source_call_id!==record.source_call_id
     ||origin.semantic_id!==record.semantic_id||!record.evidence_ids.includes(record.creation_observation_id)
     ||!Number.isSafeInteger(record.seq)||!Number.isSafeInteger(origin.seq)||record.seq<=origin.seq)
    return fail('server_consumer_origin_required');
   const resourceKey=value=>`${record.session}\0${value.identity}`;
   if(record.operation==='promise_fulfilled'){
    if(rule.kind!=='readable_server_stream'||consumer.server_consumer_kind!=='await_binding'||!token(record.promise)||!token(record.resource)
      ||record.promise.kind!=='object'||record.resource.kind!=='object'||!same(record.promise,origin.result))return fail('server_promise_fulfillment_mismatch');
    resources.set(resourceKey(record.resource),record.creation_observation_id);seen.add(record.observation_id);
    return {schema:'producttrace.react-server-join.v1',status:'resolved',reason:null,runtime_observed:true,
     source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,consumer_source_id:record.consumer_source_id},
     runtime:{claim:'observed_server_promise_fulfillment',creation_observation_id:record.creation_observation_id,
      resource_identity:record.resource.identity,promise_fulfillment_proven:true,stream_completion_proven:false}};
   }
   if(['pipe_started','pipe_failed'].includes(record.operation)){
    if(rule.kind!=='pipeable_server_stream'||consumer.server_consumer_kind!=='pipe'||!token(record.resource)||!token(record.destination)
      ||record.resource.kind!=='object'||record.destination.kind!=='object'||!same(record.resource,origin.result)
      ||record.operation==='pipe_failed'&&!token(record.error))return fail('server_pipe_operation_mismatch');
    if(record.operation==='pipe_started')resources.set(resourceKey(record.destination),record.creation_observation_id);
    seen.add(record.observation_id);
    return {schema:'producttrace.react-server-join.v1',status:'resolved',reason:null,runtime_observed:true,
     source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,consumer_source_id:record.consumer_source_id},
     runtime:{claim:record.operation==='pipe_started'?'observed_server_pipe_start':'observed_server_pipe_failure',
      creation_observation_id:record.creation_observation_id,destination_identity:record.destination.identity,
      pipe_started:record.operation==='pipe_started',stream_completion_proven:false}};
   }
   const direct=rule.kind==='legacy_server_stream'&&same(record.resource,origin.result);
   const linked=token(record.resource)&&resources.get(resourceKey(record.resource))===record.creation_observation_id;
   const event=consumer.server_consumer_kind==='event';
   const iteration=consumer.server_consumer_kind==='async_iteration';
   if(!token(record.resource)||record.resource.kind!=='object'||(!direct&&!linked)
     ||event&&record.event!==consumer.server_consumer_event||!event&&!iteration
     ||record.operation==='stream_completed'&&!(iteration&&record.consumer_outcome==='completed'||event&&['end','finish'].includes(record.event))
     ||record.operation==='stream_errored'&&!(event&&record.event==='error')
     ||record.operation==='stream_closed'&&!(event&&record.event==='close')
     ||record.operation==='consumer_failed'&&!(iteration&&record.consumer_outcome==='consumer_failed'))return fail('server_stream_terminal_mismatch');
   seen.add(record.observation_id);
   if(record.operation==='stream_closed')return fail('server_stream_close_not_terminal');
   if(record.operation==='consumer_failed')return fail('server_stream_consumer_failed');
   return {schema:'producttrace.react-server-join.v1',status:'resolved',reason:null,runtime_observed:true,
    source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,consumer_source_id:record.consumer_source_id},
    runtime:{claim:record.operation==='stream_completed'?'observed_server_stream_completion':'observed_server_stream_error',
     creation_observation_id:record.creation_observation_id,resource_identity:record.resource.identity,
     terminal_event:record.event||record.consumer_outcome,stream_completion_proven:record.operation==='stream_completed',
     stream_error_proven:record.operation==='stream_errored'}};
  }
  const pipeable=rule.kind==='pipeable_server_stream';
  if(pipeable){
   if(record.async_context_basis!=='node-async-local-storage.v1')return fail('server_async_context_required');
   if(!entry.server_component)return fail('server_root_component_unobserved');
   if(record.operation==='returned'){
    if(!record.inputs||Object.keys(record.inputs).length!==entry.server_argument_count||!Array.from({length:entry.server_argument_count},(_,i)=>record.inputs[i]).every(token)
      ||!token(record.result)||record.result.kind!==rule.result||!entry.server_component||!token(record.element?.type)||record.element.type.kind!=='function'
      ||!token(record.element?.props)||record.element.props.kind!=='object'||record.element.identity!==record.inputs[rule.element_argument]?.identity
      ||!Array.isArray(record.invocations)||record.invocations.length!==0||record.creation_observation_id!==undefined)return fail('server_async_allocation_required');
    pending.set(record.observation_id,structuredClone(record));origins.set(record.observation_id,structuredClone(record));seen.add(record.observation_id);
    while(pending.size>pendingLimit)pending.delete(pending.keys().next().value);
    return fail('server_component_pending');
   }
   const origin=pending.get(record.creation_observation_id),same=(left,right)=>left&&right&&['identity','kind','encoding','value'].every(key=>Object.is(left[key],right[key]));
   if(record.operation!=='component_entered'||!scoped(record.creation_observation_id)||!origin||origin.manifest_key!==record.manifest_key
     ||!same(origin.result,record.result)||origin.element.identity!==record.element?.identity||!same(origin.element.type,record.element?.type)||!same(origin.element.props,record.element?.props)
     ||!record.inputs||Object.keys(record.inputs).length!==Object.keys(origin.inputs).length||!Object.keys(origin.inputs).every(key=>same(origin.inputs[key],record.inputs[key])))return fail('server_async_allocation_unconfirmed');
  }
  if(!record.inputs||Object.keys(record.inputs).length!==entry.server_argument_count||!Array.from({length:entry.server_argument_count},(_,i)=>record.inputs[i]).every(token)
    ||!token(record.result)||record.operation!==(pipeable?'component_entered':'returned')||record.result.kind!==rule.result)return fail('server_return_unobserved');
  if(!entry.server_component||record.inputs[rule.element_argument]?.kind!=='object'||record.element?.identity!==record.inputs[rule.element_argument].identity||!token(record.element?.type)||record.element.type.kind!=='function'||!token(record.element?.props)||record.element.props.kind!=='object'
    ||!Array.isArray(record.invocations)||record.invocations.length===0)return fail('server_root_component_unobserved');
  const descriptions=new Map(),values=[...Object.values(record.inputs),record.result,record.element.type,record.element.props];
  const invocationIds=new Set();
  for(const row of record.invocations){
   if(!scoped(row.observation_id)||row.observation_id===record.observation_id||invocationIds.has(row.observation_id))return fail('server_component_occurrence_required');
   invocationIds.add(row.observation_id);
   if(row.source_id!==entry.server_component.source_id||row.timing!==rule.callback_timing||row.root_input_match!==true||!token(row.callee)||row.callee.kind!=='function'
    ||row.callee.identity!==record.element.type.identity||!token(row.props)||row.props.kind!=='object'||row.props.identity!==record.element.props.identity)return fail('server_component_input_mismatch');
   values.push(row.callee,row.props);
  }
  for(const value of values){const previous=descriptions.get(value.identity);if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('server_value_identity_conflict');descriptions.set(value.identity,value);}
  if(!pipeable)origins.set(record.observation_id,structuredClone(record));
  seen.add(record.observation_id);
  return {schema:'producttrace.react-server-join.v1',status:'resolved',reason:null,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,component_source_id:entry.server_component.source_id},
   runtime:{claim:pipeable?'observed_server_handle_and_async_component':rule.kind==='readable_server_stream'?'observed_server_component_and_promise_return':rule.kind==='legacy_server_stream'?'observed_server_component_and_stream_return':'observed_server_component_and_return',invocations:record.invocations.length,invocation_ids:[...invocationIds],component_identity:record.element.type.identity,props_identity:record.element.props.identity,
    output:rule.result,...(pipeable?{creation_observation_id:record.creation_observation_id,async_context_basis:record.async_context_basis,stream_completion_proven:false,async_component_lineage_proven:true}:{}),...(rule.kind==='readable_server_stream'?{promise_fulfillment_proven:false,stream_completion_proven:false,async_component_lineage_proven:false}:{}),...(rule.kind==='legacy_server_stream'?{stream_completion_proven:false,async_component_lineage_proven:false}:{}),direct_renderer_dispatch_proven:false,markup_contents_proven:false,hydration_proven:false,client_effects_proven:false}};
 }};
}
