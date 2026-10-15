import {validateReactExecutionRule} from './react-execution-rule.mjs';
export function createReactPortalEvidenceSession({fingerprint,entries}) {
 const byKey=new Map(entries.filter(entry=>entry.portal_rule).map(entry=>[entry.key,entry])),seen=new Set();
 return {join(record){
  const fail=reason=>({schema:'producttrace.react-portal-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null,observation_id:record?.observation_id});
  if(record?.schema!=='producttrace.react-portal-observation.v1' || record.kind!=='react_portal'
   || record.runtime_observed!==true || record.map_fingerprint!==fingerprint || typeof record.session!=='string' || !record.session)return fail('invalid_portal_observation');
  const scoped=value=>typeof value==='string' && value.startsWith(record.session+':') && value!==record.session+':';
  if(!scoped(record.observation_id) || record.occurrence_id!==record.observation_id+':occurrence'
   || !Array.isArray(record.evidence_ids) || !record.evidence_ids.includes(record.observation_id)
   || !record.evidence_ids.every(scoped))return fail('portal_occurrence_required');
  const entry=byKey.get(record.manifest_key),rule=entry?.portal_rule;
  if(!entry || entry.source_call_id!==record.source_call_id || entry.semantic_id!==record.semantic_id
   || !entry.package_verification_sha256 || !validateReactExecutionRule(rule).valid || rule.kind!=='portal_description')return fail('portal_source_rule_required');
  if(record.operation!=='returned')return fail(record.operation==='threw'?'portal_call_or_argument_threw':'portal_operation_unsupported');
  if(record.frontier)return fail(record.frontier);
  if(seen.has(record.observation_id))return fail('duplicate_portal_observation');
  const encoded=value=>value && scoped(value.identity) && ['null','undefined','object','function','string','number','boolean','symbol','bigint'].includes(value.kind)
   && (value.encoding==='primitive' ? value.kind==='null'?value.value===null:['string','boolean','number'].includes(value.kind)
      && typeof value.value===value.kind && (value.kind!=='number'||Number.isFinite(value.value))
     :value.encoding==='redacted' && value.value===null && !['null','string','boolean'].includes(value.kind));
  const fields=record.fields,inputs=record.inputs,child=inputs?.[rule.children_argument],container=inputs?.[rule.container_argument];
  if(record.result?.kind!=='object' || !encoded(record.result) || record.marker!==rule.marker
   || fields?.['$$typeof']?.kind!=='symbol' || !encoded(fields['$$typeof'])
   || !encoded(child) || !encoded(container) || !encoded(fields?.[rule.children_field]) || !encoded(fields?.[rule.container_field])
   || fields[rule.children_field].identity!==child.identity || fields[rule.container_field].identity!==container.identity
   || fields.implementation?.kind!=='null' || !encoded(fields.implementation) || !encoded(fields.key)
   || !['null','string'].includes(fields.key.kind) || rule.children_at_creation!=='store')return fail('portal_descriptor_input_mismatch');
  const key=inputs[rule.key_argument];let keyRelation='coercion_unproven';
  if(key && !encoded(key))return fail('portal_key_input_invalid');
  if(!key || key.kind==='undefined' || key.kind==='null'){
   if(fields.key.kind!=='null')return fail('portal_key_mismatch');keyRelation='null_default';
  }else if(key.encoding==='primitive'){
   if(!encoded(key) || fields.key.value!==String(key.value))return fail('portal_key_mismatch');keyRelation='primitive_coercion';
  }else if(!encoded(key))return fail('portal_key_input_invalid');
  const values=new Map();
  for(const value of [record.result,...Object.values(inputs),...Object.values(fields)]){
   if(!encoded(value))return fail('portal_value_invalid');
   const previous=values.get(value.identity);
   if(previous && (previous.kind!==value.kind || previous.encoding!==value.encoding || !Object.is(previous.value,value.value)))return fail('portal_value_identity_conflict');
   values.set(value.identity,value);
  }
  seen.add(record.observation_id);
  return {schema:'producttrace.react-portal-join.v1',status:'resolved',reason:null,observation_id:record.observation_id,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,children_argument:rule.children_argument},
   runtime:{claim:'observed_portal_description',children:structuredClone(child),container:structuredClone(container),key:structuredClone(fields.key),key_relation:keyRelation,
    renderer_execution_proven:false,host_commit_proven:false,children_callback_execution_proven:false}};
 }};
}
