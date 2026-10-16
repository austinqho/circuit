import {validateReactExecutionRule,planReactClassUpdate} from './react-execution-rule.mjs';
/** A request receipt and an independently accepted class-body origin are required
 * before a later callback can join. No inferred queue/commit success is admitted. */
export function createReactClassUpdateEvidenceSession({fingerprint,entries,resolveInstance,resolveAction,maxPending=1000}) {
 const indexed=new Map(entries.filter(row=>row.class_update_rule).map(row=>[row.key,row])),seen=new Set(),requests=new Map(),limit=Number.isSafeInteger(maxPending)&&maxPending>0?Math.min(maxPending,1000):1000;
 return {join(record){
  const fail=reason=>({schema:'producttrace.react-class-update-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
  const scoped=id=>typeof record?.session==='string'&&record.session.length>0&&typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(record?.schema!=='producttrace.react-class-update-observation.v1'||record.kind!=='react_class_update'||record.runtime_observed!==true||record.map_fingerprint!==fingerprint
   ||!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('invalid_class_update_observation');
  const entry=indexed.get(record.manifest_key),rule=entry?.class_update_rule;
  if(!entry||!entry.package_verification_sha256||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id||!validateReactExecutionRule(rule).valid||rule.kind!=='class_update')return fail('class_update_source_required');
  if(record.frontier)return fail(record.frontier);if(seen.has(record.observation_id))return fail('duplicate_class_update_observation');
  const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind)
   &&(value.encoding==='redacted'?value.value===null:value.encoding==='primitive'&&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
  const same=(a,b)=>a&&b&&['identity','kind','encoding','value'].every(key=>Object.is(a[key],b[key]));
  const coherent=values=>{const known=new Map();for(const value of values){if(!token(value))return false;const old=known.get(value.identity);if(old&&!same(old,value))return false;known.set(value.identity,value);}return true;};
  if(['returned','threw'].includes(record.operation)){
   const origin=resolveInstance?.(record.registration_id,record.instance_origin_id);
   if(!origin||origin.registration.manifest_key!==entry.class_key||origin.render.session!==record.session||!same(origin.render.receiver,record.receiver))return fail('class_update_instance_origin_required');
   if(!token(record.callee)||record.callee.kind!=='function'||!same(origin.registration.methods?.[rule.member],record.callee))return fail('class_update_method_unconfirmed');
   if(!record.inputs||Object.keys(record.inputs).length!==entry.class_update_argument_count||!Array.from({length:entry.class_update_argument_count},(_,i)=>record.inputs[i]).every(token)
     ||!token(record.result)||record.operation==='returned'&&record.result.kind!=='undefined'||!Array.isArray(record.callbacks))return fail('class_update_call_values_required');
   const indices=new Set();for(const row of record.callbacks){const definition=entry.class_update_callbacks.find(value=>value.index===row.index&&value.source_id===row.source_id);
    if(!definition||indices.has(row.index)||!token(row.value)||row.value.kind!=='function'||!same(row.value,record.inputs[row.index]))return fail('class_update_callback_origin_required');indices.add(row.index);}
   if(!coherent([record.receiver,record.callee,record.result,...Object.values(record.inputs),...record.callbacks.map(row=>row.value)]))return fail('class_update_value_identity_conflict');
   const action=record.action?resolveAction?.(record.action):null;if(record.action&&!action)return fail('class_update_action_unconfirmed');
   requests.set(record.observation_id,structuredClone(record));while(requests.size>limit)requests.delete(requests.keys().next().value);seen.add(record.observation_id);
   return {schema:'producttrace.react-class-update-join.v1',status:'resolved',reason:null,runtime_observed:true,source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,member:rule.member},
    runtime:{claim:'observed_class_update_method_call',operation:record.operation,instance_identity:record.receiver.identity,instance_origin_id:record.instance_origin_id,action:action?structuredClone(action):null,queue_execution_proven:false,commit_proven:false}};
  }
  const request=requests.get(record.request_id),definition=entry.class_update_callbacks.find(row=>row.index===record.index&&row.source_id===record.source_id),callback=request?.callbacks.find(row=>row.index===record.index);
  if(!request||!definition?.edge_id||request.manifest_key!==record.manifest_key||request.session!==record.session||!definition||!callback||!same(callback.value,record.callback))return fail('class_update_request_required');
  if(!['callback_returned','callback_threw'].includes(record.operation)||!['during_method_call','after_method_return'].includes(record.timing)||!token(record.receiver)||!token(record.result)||!Array.isArray(record.arguments))return fail('class_update_callback_values_required');
  const role=record.index===rule.payload_argument?'calculation':record.index===rule.completion_argument?'completion':null;
  const plan=planReactClassUpdate(rule,{operation:'callback',role,instance:request.receiver});
  if(plan.status!=='planned'||record.arguments_complete!==(definition.body.kind==='function')||record.receiver_basis!==(definition.body.kind==='function'?'call':'lexical'))return fail('class_update_callback_shape_required');
  if(record.arguments.length!==plan.args.length||!record.arguments.every(token))return fail('class_update_callback_arguments_unobserved');
  if(record.receiver_basis==='call'&&!same(record.receiver,request.receiver))return fail('class_update_callback_receiver_mismatch');
  if(!coherent([record.callback,record.receiver,record.result,...record.arguments]))return fail('class_update_value_identity_conflict');
  seen.add(record.observation_id);
  return {schema:'producttrace.react-class-update-join.v1',status:'resolved',reason:null,runtime_observed:true,source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,callback_source_id:definition.source_id,callback_edge_id:definition.edge_id,member:rule.member},
   runtime:{claim:'observed_class_update_callback_body',request_id:record.request_id,role,operation:record.operation,arguments:structuredClone(record.arguments),arguments_complete:record.arguments_complete,receiver_basis:record.receiver_basis,
    result:structuredClone(record.result),queue_execution_proven:false,state_merge_proven:false,commit_proven:false,direct_renderer_dispatch_proven:false}};
 }};
}
