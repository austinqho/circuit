import {validateReactExecutionRule} from './react-execution-rule.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const encoded=(value,session)=>value && typeof value.identity==='string' && value.identity.startsWith(session+':')
  && ['undefined','null','boolean','number','string','object','function','symbol','bigint'].includes(value.kind)
  && (value.encoding==='redacted'?value.value===null:value.encoding==='primitive' && (value.value===null && value.kind==='null'
    || typeof value.value===value.kind && ['boolean','string','number'].includes(value.kind) && (value.kind!=='number' || Number.isFinite(value.value))));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createReactContextEvidenceSession(map) {
  const origins=new Map(),objects=new Map(),returned=new Map();
  const failure=reason=>({status:'unresolved',reason,runtime_observed:false});
  const joinOrigin=record=>{
    if(record?.schema!=='producttrace.react-context-origin.v1' || record.kind!=='react_context_origin'
      || record.runtime_observed!==true || record.map_fingerprint!==map.fingerprint)return failure('context_origin_observation_required');
    const session=record.session;
    if(typeof session!=='string' || !session || typeof record.observation_id!=='string' || !record.observation_id.startsWith(session+':')
      || record.occurrence_id!==record.observation_id+':occurrence' || !Array.isArray(record.evidence_ids)
      || !record.evidence_ids.includes(record.observation_id))return failure('context_origin_identity_required');
    const source=map.react_semantics.find(row=>row.call_id===record.source_call_id && row.semantic_id===record.semantic_id);
    const rule=source?.behavior?.execution;
    if(!source?.package_verification_sha256 || !validateReactExecutionRule(rule).valid || rule.kind!=='context_binding'
      || rule.mode!=='create' || source.causal_bindings.context_id!==record.source_context_id)return failure('context_origin_source_mismatch');
    const indices=Object.keys(source.causal_bindings.inputs).filter(key=>/^arguments\.\d+$/.test(key)).map(key=>Number(key.split('.')[1]));
    if(!record.inputs || Object.keys(record.inputs).some(key=>!indices.includes(Number(key)))
      || indices.some(index=>!encoded(record.inputs[index],session)))return failure('context_argument_evaluation_incomplete');
    if(record.outcome!=='returned')return failure('context_creation_not_returned');
    if(record.previously_returned!==false || !encoded(record.value,session) || record.value.kind!=='object'
      || typeof record.context_object_id!=='string' || !record.context_object_id.startsWith(session+':')
      || !encoded(record.default_value,session))return failure('context_allocation_identity_required');
    const supplied=record.inputs[rule.default_argument];
    if(supplied?!equal(supplied,record.default_value):record.default_value.kind!=='undefined')return failure('context_default_input_mismatch');
    const next={session,context_object_id:record.context_object_id,source_context_id:record.source_context_id,
      source_call_id:record.source_call_id,default_value:copy(record.default_value),result_identity:record.value.identity};
    if(origins.has(record.observation_id) && !equal(origins.get(record.observation_id),next)
      || objects.has(record.context_object_id) && objects.get(record.context_object_id)!==record.observation_id
      || returned.has(record.value.identity) && returned.get(record.value.identity)!==record.observation_id)return failure('context_origin_conflict');
    origins.set(record.observation_id,next);objects.set(record.context_object_id,record.observation_id);
    returned.set(record.value.identity,record.observation_id);
    return {status:'resolved',reason:null,runtime_observed:true,origin:copy(next)};
  };
  const joinRead=(packet,{session,sourceContextId,defaultUsed,observedValue,providerValue})=>{
    const origin=origins.get(packet?.origin_observation_id);
    if(!origin || origin.session!==session || origin.context_object_id!==packet.context_object_id
      || origin.source_context_id!==sourceContextId || packet.source_context_id!==sourceContextId
      || origin.source_call_id!==packet.source_call_id)return failure('context_creation_origin_required');
    if(!encoded(packet.observed_value,session) || !encoded(packet.selected_value,session)
      || packet.selected_from!==(defaultUsed?'default':'provider'))return failure('context_value_identity_required');
    if(!equal({encoding:packet.observed_value.encoding,value:packet.observed_value.value},observedValue))return failure('context_observed_value_mismatch');
    if(defaultUsed?!equal(packet.selected_value,origin.default_value)
      :!equal({encoding:packet.selected_value.encoding,value:packet.selected_value.value},providerValue))return failure('context_selected_value_mismatch');
    if(!equal(packet.observed_value,packet.selected_value))return failure('context_selected_value_mismatch');
    return {status:'resolved',reason:null,runtime_observed:true,origin_observation_id:packet.origin_observation_id,
      context_object_id:packet.context_object_id,value_identity:packet.observed_value.identity,
      default_value_proven:defaultUsed,object_value_identity_proven:['object','function'].includes(packet.observed_value.kind)};
  };
  return {joinOrigin,joinRead};
}
