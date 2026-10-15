import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** Wrapper construction and later source-body entry are separate observations.
 * A component function may be reused by multiple wrappers. The renderer's actual
 * wrapper identity, not its name, must select the construction being referenced.
 */
export function createReactWrapperEvidenceSession(map,entries) {
  const sources=new Map(map.react_semantics.map(row=>[row.call_id,row]));
  const byKey=new Map(entries.map(row=>[row.key,row])),origins=new Map(),wrappers=new Map();
  const copy=value=>JSON.parse(JSON.stringify(value));
  const result=(record,reason,runtime=null)=>({schema:'producttrace.react-wrapper-join.v1',status:reason?'unresolved':'resolved',reason,
    runtime_observed:!reason,source:reason?null:{call_id:record.source_call_id,callback_source_id:record.callback_source_id},runtime});
  const identity=(record,value)=>typeof record.session==='string' && record.session.length>0 && typeof value==='string' && value.length>record.session.length+1 && value.startsWith(record.session+':');
  const occurrence=record=>identity(record,record.observation_id) && record.occurrence_id===record.observation_id+':occurrence'
    && Array.isArray(record.evidence_ids) && record.evidence_ids.includes(record.observation_id);
  const entryFor=record=>{
    const entry=byKey.get(record?.manifest_key),source=sources.get(record?.source_call_id);
    if(!source || source.version!=='18.3.1' || !source.package_verification_sha256
      || !validateReactExecutionRule(source.behavior?.execution).valid || source.behavior.execution.kind!=='component_wrapper'
      || source.causal_bindings?.wrapper_render?.source_id!==record.callback_source_id
      || JSON.stringify(source.behavior.execution)!==JSON.stringify(entry?.execution_rule))return null;
    return record?.map_fingerprint===map.fingerprint && entry?.source_call_id===record.source_call_id
      && entry.callback_source_id===record.callback_source_id?entry:null;
  };
  const join=record=>{
    if(record?.schema!=='producttrace.react-wrapper-observation.v1' || record.kind!=='react_wrapper' || record.runtime_observed!==true || !occurrence(record))return result(record||{},'invalid_wrapper_observation');
    const entry=entryFor(record);
    if(!entry || !['wrapper_return','wrapper_callback'].includes(entry.kind))return result(record,'wrapper_source_mismatch');
    if(record.operation==='frontier')return result(record,['wrapper_result_shape_unobserved','wrapper_render_owner_unobserved','wrapper_render_origin_unobserved'].includes(record.reason)?record.reason:'invalid_wrapper_frontier');
    if(record.operation!=='created' || entry.kind!=='wrapper_return' || !identity(record,record.wrapper_id) || !identity(record,record.component_identity_id))return result(record,'wrapper_creation_required');
    if(origins.has(record.observation_id))return result(record,'duplicate_wrapper_observation');
    if(entry.execution_rule.allocation==='per_call' && wrappers.has(record.wrapper_id))return result(record,'wrapper_allocation_identity_reused');
    origins.set(record.observation_id,copy(record));wrappers.set(record.wrapper_id,record.observation_id);
    return result(record,null,{claim:'observed_wrapper_creation',wrapper_id:record.wrapper_id,component_identity_id:record.component_identity_id,
      observation_id:record.observation_id,callback_invoked:false});
  };
  const checkCallback=record=>{
    const entry=entryFor(record),origin=origins.get(record.wrapper_origin_observation_id);
    if(record.runtime_observed!==true || !entry || entry.kind!=='wrapper_callback' || entry.owner_source_id!==record.owner_source_id || !occurrence(record) || !origin || origin.session!==record.session
      || origin.source_call_id!==record.source_call_id || origin.callback_source_id!==record.callback_source_id
      || origin.wrapper_id!==record.wrapper_id || origin.component_identity_id!==record.component_identity_id
      || record.renderer_wrapper_matched!==true || !identity(record,record.invocation_id))return result(record,'wrapper_callback_origin_unobserved');
    if(!Array.isArray(record.arguments) || record.arguments.some(row=>!identity(record,row?.value_id)
      || !row.value || !(row.value.encoding==='redacted' && row.value.value===null
        || row.value.encoding==='primitive' && (row.value.value===null || ['string','boolean'].includes(typeof row.value.value)
          || typeof row.value.value==='number' && Number.isFinite(row.value.value)))))return result(record,'wrapper_callback_arguments_required');
    const rule=entry.execution_rule.render_ref,ref=record.forwarded_ref;
    let forwardedRef=null;
    if(rule && ref) {
      if(ref.status==='resolved') {
        if(ref.argument!==rule.argument || ref.field!==rule.field || ref.fiber_tag!==rule.fiber_tag
          || !['body_entry','committed_render'].includes(ref.snapshot) || ref.identity_matched!==true
          || !identity(record,ref.value_id) || ref.renderer_value_id!==ref.value_id
          || record.arguments[rule.argument]?.value_id!==ref.value_id)
          return result(record,'forwarded_ref_input_mismatch');
        forwardedRef={claim:'observed_renderer_ref_argument',argument:rule.argument,renderer_field:rule.field,
          value_id:ref.value_id,value:copy(record.arguments[rule.argument].value),snapshot:ref.snapshot,
          ref_attachment_proven:false,ref_cleanup_proven:false,direct_renderer_dispatch_proven:false};
      } else if(ref.status!=='unresolved' || ref.reason!=='forwarded_ref_renderer_input_unconfirmed')
        return result(record,'invalid_forwarded_ref_frontier');
    } else if(!rule && ref!=null)return result(record,'unexpected_forwarded_ref_input');
    return result(record,null,{claim:'observed_stored_component_body',origin_observation_id:origin.observation_id,
      wrapper_id:origin.wrapper_id,component_identity_id:origin.component_identity_id,callback_source_id:record.callback_source_id,
      invocation_id:record.invocation_id,arguments:copy(record.arguments),renderer_context_matched:true,
      direct_renderer_dispatch_proven:false,callback_completion_proven:false,ref_attachment_proven:false,
      forwarded_ref:forwardedRef || (rule?{status:'unresolved',reason:'forwarded_ref_renderer_input_unconfirmed'}:null)});
  };
  const checkOutcome=(record,parent)=>{
    const entry=entryFor(record);
    if(!entry || entry.kind!=='wrapper_callback' || !occurrence(record) || record.runtime_observed!==true || record.invocation_id!==undefined
      || !parent || parent.invocation_id!==record.caused_by_invocation_id
      || parent.origin_observation_id!==record.wrapper_origin_observation_id || parent.wrapper_id!==record.wrapper_id
      || parent.component_identity_id!==record.component_identity_id || parent.callback_source_id!==record.callback_source_id)
      return result(record,'wrapper_outcome_invocation_required');
    const value=record.value;
    if(!['returned','threw'].includes(record.outcome) || !identity(record,record.value_id)
      || !value || !(value.encoding==='redacted' && value.value===null || value.encoding==='primitive'
        && (value.value===null || ['string','boolean'].includes(typeof value.value)
          || typeof value.value==='number' && Number.isFinite(value.value))))return result(record,'wrapper_outcome_value_required');
    return result(record,null,{claim:'observed_component_body_outcome',invocation_id:parent.invocation_id,
      callback_source_id:parent.callback_source_id,wrapper_id:parent.wrapper_id,origin_observation_id:parent.origin_observation_id,
      outcome:record.outcome,value_id:record.value_id,value:copy(value),callback_completion_proven:true,
      renderer_result_consumed_proven:false,render_commit_proven:false,error_boundary_proven:false});
  };
  return {join,checkCallback,checkOutcome};
}
