import {validateReactExecutionRule,planReactClassOperation} from './react-execution-rule.mjs';
/** Registrations and original body/read observations are independent prerequisites.
 * A renderer owner identifies the instance being rendered, not a committed tree. */
export function createReactClassEvidenceSession({fingerprint,entries,resolveAction}) {
 const indexed=new Map(entries.filter(row=>row.class_rule).map(row=>[row.key,row])),seen=new Set(),registrations=new Map(),instances=new Map();
 return {resolveInstance(registrationId,renderId){const registration=registrations.get(registrationId),render=instances.get(renderId);return registration&&render&&render.registration_id===registrationId?structuredClone({registration,render}):null;},join(record){
  const fail=reason=>({schema:'producttrace.react-class-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
  const scoped=id=>typeof record?.session==='string'&&record.session.length>0&&typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(record?.schema!=='producttrace.react-class-observation.v1'||record.kind!=='react_class'||record.runtime_observed!==true||record.map_fingerprint!==fingerprint
    ||!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('invalid_class_observation');
  const entry=indexed.get(record.manifest_key),rule=entry?.class_rule,mapping=entry?.class_mapping;
  if(!entry||record.source_call_id!==entry.source_call_id||record.semantic_id!==entry.semantic_id||!entry.package_verification_sha256||!mapping
    ||!validateReactExecutionRule(rule).valid||rule.kind!=='class_component')return fail('class_source_rule_required');
  if(record.frontier)return fail(record.frontier);if(seen.has(record.observation_id))return fail('duplicate_class_observation');
  const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind)
   &&(value.encoding==='redacted'?value.value===null:value.encoding==='primitive'&&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
  const same=(left,right)=>left&&right&&['identity','kind','encoding','value'].every(key=>Object.is(left[key],right[key]));
  if(!token(record.class_type)||record.class_type.kind!=='function')return fail('class_type_required');
  if(record.operation==='registered'){
   if(!token(record.base_type)||record.base_type.kind!=='function'||record.pure!==rule.pure)return fail('class_base_required');
   registrations.set(record.observation_id,structuredClone(record));seen.add(record.observation_id);
   return fail('class_render_pending');
  }
  const registration=registrations.get(record.registration_id);
  if(!registration||registration.manifest_key!==record.manifest_key||registration.session!==record.session||!same(registration.class_type,record.class_type))return fail('class_registration_required');
  const owner=record.owner;
  if(!owner||owner.basis!=='react-current-class-render.v1'||!/^react-root:[1-9][0-9]*$/.test(owner.root_id)
    ||!/^react-instance:[1-9][0-9]*$/.test(owner.instance_id)||!/^react-mount:[1-9][0-9]*$/.test(owner.mount_id))return fail('class_renderer_owner_unobserved');
  if(!['returned','threw'].includes(record.operation)||!token(record.result)||!token(record.receiver)||record.receiver.kind!=='object'
    ||!record.inputs||Object.keys(record.inputs).length!==2||!token(record.inputs.props)||!token(record.inputs.state)||!Array.isArray(record.reads))return fail('class_render_values_required');
  const plan=planReactClassOperation(rule,{operation:'render',props:record.inputs.props,state:record.inputs.state});
  if(plan.status!=='planned'||plan.method!=='render')return fail('class_render_plan_required');
  const values=[record.class_type,record.receiver,record.result,...Object.values(record.inputs)],readSources=new Map(mapping.reads.map(row=>[row.source_id,row.field]));
  for(const row of record.reads){
   if(!readSources.has(row.source_id)||readSources.get(row.source_id)!==row.field||!token(row.value)||row.input_match!==true||!same(plan.inputs[row.field],row.value))return fail('class_input_read_mismatch');
   values.push(row.value);
  }
  const descriptions=new Map();for(const value of values){const previous=descriptions.get(value.identity);if(previous&&!same(previous,value))return fail('class_value_identity_conflict');descriptions.set(value.identity,value);}
  const action=record.action?resolveAction?.(record.action):null;if(record.action&&!action)return fail('class_action_unconfirmed');
  seen.add(record.observation_id);instances.set(record.observation_id,structuredClone(record));while(instances.size>1000)instances.delete(instances.keys().next().value);
  return {schema:'producttrace.react-class-join.v1',status:'resolved',reason:null,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,render_source_id:mapping.render_source_id,read_source_ids:record.reads.map(row=>row.source_id)},
   runtime:{claim:'observed_class_render_body_and_inputs',operation:record.operation,registration_id:record.registration_id,class_identity:record.class_type.identity,instance_identity:record.receiver.identity,
    owner:structuredClone(owner),inputs:structuredClone(record.inputs),result:structuredClone(record.result),action:action?structuredClone(action):null,
    commit_proven:false,update_cause_proven:false,direct_renderer_dispatch_proven:false}};
 }};
}
