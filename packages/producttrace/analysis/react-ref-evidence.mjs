import {validateReactExecutionRule} from './react-execution-rule.mjs';
const text=value=>typeof value==='string' && value.length>0;
const copy=value=>JSON.parse(JSON.stringify(value));
const sameOwner=(expected,actual)=>!expected || actual && ['instance_id','mount_id','render_id','hook_slot_id'].every(key=>expected[key]===actual[key])
  && (expected.root_id==='react-root:dispatcher-pending' || expected.root_id===actual.root_id);
const encoded=(value,session)=>value && text(value.identity) && value.identity.startsWith(session+':')
  && ['null','undefined','object','function','string','number','boolean','symbol','bigint'].includes(value.kind)
  && (value.encoding==='primitive'?(value.kind==='null'?value.value===null:
    typeof value.value===value.kind && ['string','boolean','number'].includes(value.kind)
      && (value.kind!=='number' || Number.isFinite(value.value))):value.encoding==='redacted' && value.value===null
      && !['null','string','boolean'].includes(value.kind));

export function createReactRefEvidenceSession({fingerprint,entries}) {
  const byKey=new Map(entries.map(entry=>[entry.key,entry])),origins=new Map(),returnedIds=new Map(),methodReads=new Map(),attachments=new Map(),hookCommitObservations=new Map(),committedOrigins=new Set();
  const programs=new Map(entries.filter(entry=>entry.ref_rule).map(entry=>[entry.source_call_id,entry.ref_rule]));
  return {join(record){
    const fail=reason=>({schema:'producttrace.react-ref-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
    if(record?.schema!=='producttrace.react-ref-observation.v1' || record.kind!=='react_ref' || record.runtime_observed!==true)return fail('ref_runtime_observation_required');
    if(record.map_fingerprint!==fingerprint)return fail('map_fingerprint_mismatch');
    if(!text(record.session) || !text(record.observation_id) || !record.observation_id.startsWith(record.session+':')
      || record.occurrence_id!==record.observation_id+':occurrence' || !Array.isArray(record.evidence_ids) || !record.evidence_ids.includes(record.observation_id)
      || !encoded(record.value,record.session))return fail('ref_observation_identity_required');
    const entry=byKey.get(record.manifest_key);
    if(!entry || !(entry.ref_rule || entry.ref_access) || entry.source_call_id!==record.source_call_id
      || entry.semantic_id!==record.semantic_id || entry.surface!==record.surface || entry.export!==record.export
      || record.source_access_id!==(entry.ref_access?.source_id||null))return fail('ref_source_occurrence_mismatch');
    const program=programs.get(entry.source_call_id);
    if(!validateReactExecutionRule(program).valid || program.kind!=='ref_cell')return fail('ref_rule_invalid');
    if(entry.ref_access && entry.ref_property!==program.property)return fail('ref_source_property_mismatch');
    if(record.owner && (!['root_id','instance_id','mount_id','render_id','hook_slot_id'].every(key=>text(record.owner[key]))
      || !['preparing','attempted','committed','abandoned','unmounted'].includes(record.owner.status)))return fail('ref_owner_context_invalid');
    const result=extra=>({schema:'producttrace.react-ref-join.v1',status:'resolved',reason:null,runtime_observed:true,
      source:{source_call_id:entry.source_call_id,source_access_id:entry.ref_access?.source_id||null,
        semantic_id:entry.semantic_id,surface:entry.surface,export:entry.export,claim:'source_contract'},
      runtime:{observation_id:record.observation_id,operation:record.operation,value:copy(record.value),
        owner:record.owner?copy(record.owner):null,owner_claim:'observed_render_context',commit_proven:false,...extra}});
    if(record.operation==='host_attached') {
      const origin=origins.get(record.origin_observation_id);
      if(!origin || origin.ref_id!==record.ref_id || origin.session!==record.session
        || origin.source_call_id!==entry.source_call_id || record.origin_source_call_id!==entry.source_call_id)
        return fail('ref_origin_observation_required');
      if(record.owner!==undefined || !record.renderer
        || !['root_id','instance_id','mount_id','commit_id'].every(key=>text(record.renderer[key]))
        || record.renderer.runtime_observed!==true || record.renderer.basis!=='react-devtools-commit.v1')
        return fail('ref_host_commit_identity_required');
      const accepted={session:record.session,ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,
        source_call_id:entry.source_call_id,value:copy(record.value),renderer:copy(record.renderer)};
      const previous=attachments.get(record.observation_id);
      if(previous && JSON.stringify(previous)!==JSON.stringify(accepted))return fail('ref_host_attachment_conflict');
      attachments.set(record.observation_id,accepted);
      return result({ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,
        property:program.property,write_value:'exact_committed_host_node',host:copy(record.value),
        renderer:copy(record.renderer),owner_claim:'committed_host_fiber',commit_proven:true,
        attachment_claim:'observed_ref_attached_to_committed_host'});
    }
    if(record.operation==='hook_committed') {
      if(!entry.hook_owned || program.allocation!=='mounted_hook')return fail('ref_hook_commit_rule_required');
      const origin=origins.get(record.origin_observation_id);
      if(!origin || origin.ref_id!==record.ref_id || origin.session!==record.session
        || origin.source_call_id!==entry.source_call_id || record.origin_source_call_id!==entry.source_call_id)
        return fail('ref_origin_observation_required');
      if(!origin.owner || !record.renderer
        || !['root_id','instance_id','mount_id','render_id','commit_id'].every(key=>text(record.renderer[key]))
        || ['root_id','instance_id','mount_id','render_id'].some(key=>origin.owner[key]!==record.renderer[key])
        || record.renderer.runtime_observed!==true || record.renderer.basis!=='react-devtools-commit.v1'
        || record.value.identity!==origin.value.identity)return fail('ref_hook_commit_identity_required');
      const accepted={session:record.session,ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,
        source_call_id:entry.source_call_id,value:copy(record.value),renderer:copy(record.renderer)};
      const previous=hookCommitObservations.get(record.observation_id);
      if(previous && JSON.stringify(previous)!==JSON.stringify(accepted))return fail('ref_hook_commit_conflict');
      hookCommitObservations.set(record.observation_id,accepted);committedOrigins.add(record.origin_observation_id);
      return result({ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,
        renderer:copy(record.renderer),owner_claim:'committed_hook_owner',commit_proven:true,
        initialization_proof:'exact_hook_ref_on_committed_render',hook_commit_claim:'observed_hook_ref_committed'});
    }
    if(entry.ref_rule) {
      if(!['returned','threw'].includes(record.operation) || !record.inputs || !Array.isArray(entry.ref_input_indices))return fail('ref_call_inputs_required');
      if(Object.entries(record.inputs).some(([index,value])=>!entry.ref_input_indices.includes(Number(index)) || !encoded(value,record.session)))return fail('ref_call_inputs_required');
      if(entry.ref_input_indices.some(index=>!encoded(record.inputs[index],record.session)))return fail(record.operation==='threw'?'ref_argument_evaluation_failed':'ref_call_inputs_required');
      if(record.operation==='threw')return result({outcome:'threw',allocation_observed:false});
      if(record.value.kind!=='object' || !text(record.ref_id) || !record.ref_id.startsWith(record.session+':')
        || record.origin_source_call_id!==entry.source_call_id || typeof record.previously_returned!=='boolean')return fail('ref_return_identity_required');
      if(record.current && !encoded(record.current,record.session))return fail('ref_current_snapshot_invalid');
      if(entry.ref_rule.allocation==='per_call') {
        if(record.previously_returned)return fail('ref_per_call_allocation_reused');
        const input=record.inputs[entry.ref_rule.argument];
        const initialMatches=entry.ref_rule.initial==='null'?record.current?.kind==='null' && record.current.value===null
          :input?record.current?.identity===input.identity:record.current?.kind==='undefined';
        if(!initialMatches || record.descriptor?.writable!==true
          || record.descriptor?.enumerable!==true)return fail('ref_initial_cell_mismatch');
        if(!['development','production'].includes(record.build))return fail('ref_build_required');
        const sealed=entry.ref_rule.sealed[record.build];
        if(record.sealed!==sealed || record.descriptor.configurable!==!sealed)return fail('ref_sealing_mismatch');
      }
      if(entry.ref_rule.allocation==='mounted_hook' && !record.previously_returned) {
        const input=record.inputs[entry.ref_rule.argument];
        const initialMatches=input?record.current?.identity===input.identity:record.current?.kind==='undefined';
        if(!initialMatches)return fail('ref_initial_cell_mismatch');
      }
      if(!record.previously_returned && record.origin_observation_id!==record.observation_id)return fail('ref_origin_identity_mismatch');
      const origin=origins.get(record.origin_observation_id),previous=returnedIds.get(record.ref_id);
      if(record.previously_returned && (!origin || origin.ref_id!==record.ref_id || origin.source_call_id!==entry.source_call_id || origin.session!==record.session))return fail('ref_origin_observation_required');
      if(origin && !sameOwner(origin.owner,record.owner))return fail('ref_origin_owner_mismatch');
      if(previous && (previous.origin_observation_id!==record.origin_observation_id || previous.source_call_id!==entry.source_call_id))return fail('ref_identity_conflict');
      if(!record.previously_returned) {
        if(origins.has(record.observation_id) && origins.get(record.observation_id).ref_id!==record.ref_id)return fail('ref_origin_identity_conflict');
        const value={ref_id:record.ref_id,source_call_id:entry.source_call_id,origin_observation_id:record.observation_id,session:record.session,
          owner:record.owner?copy(record.owner):null,value:copy(record.value)};
        origins.set(record.observation_id,value);returnedIds.set(record.ref_id,value);
      }
      return result({ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,
        returned_identity:record.previously_returned?'previously_observed_ref':'first_observed_ref',
        initialization_proof:entry.ref_rule.allocation==='per_call'?'returned_initial_cell':record.previously_returned
          ?'retained_cell_from_accepted_origin':committedOrigins.has(record.origin_observation_id)
            ?'observed_initial_cell_on_committed_owner':record.owner?.status==='committed'
              ?'observed_initial_cell_on_committed_owner':'initial_cell_observed_owner_commit_unproven',
        current:record.current?copy(record.current):null,frontier:record.frontier||null});
    }
    if(!(entry.ref_access.mode==='invoke'?['read','invoke'].includes(record.operation):record.operation===entry.ref_access.mode)
      || !['returned','threw'].includes(record.outcome))return fail('ref_access_operation_mismatch');
    const origin=origins.get(record.origin_observation_id);
    if(!origin || origin.ref_id!==record.ref_id || origin.session!==record.session
      || origin.source_call_id!==entry.source_call_id || record.origin_source_call_id!==entry.source_call_id)return fail('ref_origin_observation_required');
    if(!sameOwner(origin.owner,record.owner))return fail('ref_origin_owner_mismatch');
    if(entry.ref_access.mode==='invoke') {
      if(record.operation==='read') {
        const next={session:record.session,key:record.manifest_key,ref_id:record.ref_id,outcome:record.outcome,value:copy(record.value),callback:record.callback?copy(record.callback):null};
        const previous=methodReads.get(record.observation_id);
        if(previous && JSON.stringify(previous)!==JSON.stringify(next))return fail('ref_method_read_conflict');
        methodReads.set(record.observation_id,next);
      } else {
        const read=methodReads.get(record.read_observation_id);
        if(!read || read.outcome!=='returned' || read.session!==record.session || read.key!==record.manifest_key
          || read.ref_id!==record.ref_id || JSON.stringify(read.value)!==JSON.stringify(record.callee))return fail('ref_method_read_required');
        if(JSON.stringify(read.callback)!==JSON.stringify(record.callback||null))return fail('ref_method_callee_source_mismatch');
        if(!Array.isArray(record.arguments) || !record.arguments.every(value=>encoded(value,record.session)))return fail('ref_method_arguments_required');
        return result({ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,outcome:record.outcome,
          read_observation_id:record.read_observation_id,callee:copy(record.callee),arguments:copy(record.arguments),
          receiver:'observed_ref_object',call_claim:'attempted',body_execution_proven:false,property:entry.ref_property});
      }
    }
    return result({ref_id:record.ref_id,origin_observation_id:record.origin_observation_id,outcome:record.outcome,
      property:entry.ref_property,value_origin:'unproven',property_access:'ordinary_may_invoke_user_code',
      write_readback_observed:false});
  }};
}
