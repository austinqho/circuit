import {validateReactExecutionRule} from './react-execution-rule.mjs';
export function createReactRootEvidenceSession({fingerprint,entries,resolveCleanup=()=>null}) {
 const indexed=new Map(entries.filter(row=>row.root_rule).map(row=>[row.key,row])),origins=new Map(),seen=new Set();
 return {join(record){
  const fail=reason=>({schema:'producttrace.react-root-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
  const scoped=id=>typeof record?.session==='string'&&record.session.length>0&&typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(record?.schema!=='producttrace.react-root-observation.v1'||record.kind!=='react_root'||record.runtime_observed!==true||record.map_fingerprint!==fingerprint
    ||!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('invalid_root_observation');
  const entry=indexed.get(record.manifest_key),rule=entry?.root_rule;
  if(!entry||record.source_call_id!==entry.source_call_id||record.semantic_id!==entry.semantic_id||!entry.package_verification_sha256
    ||!validateReactExecutionRule(rule).valid||rule.kind!=='dom_root'||record.method!==(entry.root_method||'create'))return fail('root_source_rule_required');
  if(record.frontier||record.recovery_frontier)return fail(record.frontier||record.recovery_frontier);
  if(seen.has(record.observation_id))return fail('duplicate_root_observation');
  const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind)
    &&(value.encoding==='redacted'?value.value===null&&!['null','string','boolean'].includes(value.kind):value.encoding==='primitive'
      &&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
  const active=value=>value?.state==='active'&&token(value.internal)&&value.internal.kind==='object'&&token(value.container)&&value.container.kind==='object'
    &&(value.renderer_root_id===null||typeof value.renderer_root_id==='string'&&value.renderer_root_id.startsWith('react-root:'));
  if(!token(record.result)||!record.inputs||!Object.values(record.inputs).every(token))return fail('root_values_required');
  const descriptions=new Map(),values=[record.result,...Object.values(record.inputs),...Object.values(record.methods||{}),
    ...[record.recovery_callback?.value,record.receiver,record.method_value,record.before?.internal,record.before?.container,record.after?.internal,record.after?.container].filter(Boolean)];
  for(const value of values){
   if(!token(value))return fail('root_values_required');
   const previous=descriptions.get(value.identity);
   if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('root_value_identity_conflict');
   descriptions.set(value.identity,value);
  }
  let origin,runtime;
   if(record.method==='create'){
   const container=record.inputs[rule.container_argument];
   if(record.operation!=='returned'||record.result.kind!=='object'||!active(record.after)||!token(container)||container.identity!==record.after.container.identity
     ||!['render','unmount'].every(name=>token(record.methods?.[name])&&record.methods[name].kind==='function'))return fail('root_allocation_unobserved');
   if(entry.root_recovery_source_id&&(!record.recovery_callback||record.recovery_callback.source_id!==entry.root_recovery_source_id
     ||!token(record.recovery_callback.value)||record.recovery_callback.value.kind!=='function'))return fail('root_recovery_callback_registration_required');
   if(origins.has(record.result.identity))return fail('root_allocation_identity_reused');
   origin={session:record.session,source_call_id:record.source_call_id,observation_id:record.observation_id,after:structuredClone(record.after),methods:structuredClone(record.methods)};
   runtime={claim:'observed_root_allocation',handle_identity:record.result.identity,container:structuredClone(container),renderer_root_id:record.after.renderer_root_id,
     recovery_callback_registered:!!record.recovery_callback,recovery_callback_source_id:record.recovery_callback?.source_id||null};
  }else{
   origin=token(record.receiver)?origins.get(record.receiver.identity):null;
   if(!origin||record.receiver.kind!=='object'||origin.session!==record.session||origin.source_call_id!==entry.root_producer_call_id)return fail('root_handle_origin_unobserved');
   if(!token(record.method_value)||record.method_value.kind!=='function'||record.method_value.identity!==origin.methods[record.method]?.identity)return fail('root_original_method_unobserved');
   if(record.before?.state!==origin.after.state)return fail('root_lifetime_order_unproven');
   if(record.before.state==='active'&&(!active(record.before)||record.before.internal.identity!==origin.after.internal.identity||record.before.container.identity!==origin.after.container.identity||record.before.renderer_root_id!==origin.after.renderer_root_id))return fail('root_receiver_state_mismatch');
   if(record.method==='render'){
    if(record.before.state==='unmounted'){
     if(rule.render_after_unmount!=='throw'||record.operation!=='threw'||record.after?.state!=='unmounted')return fail('root_render_after_unmount_mismatch');
    }else if(record.operation!=='returned'||record.result.kind!=='undefined'||!active(record.after)||record.after.internal.identity!==record.before.internal.identity||record.after.container.identity!==record.before.container.identity||record.after.renderer_root_id!==record.before.renderer_root_id)return fail('root_render_outcome_unobserved');
   }else if(record.method==='unmount'){
    if(record.operation!=='returned'||record.result.kind!=='undefined'||record.after?.state!=='unmounted')return fail('root_unmount_outcome_unobserved');
   }else return fail('root_method_unmodeled');

   runtime={claim:'observed_root_method',method:record.method,creation_observation_id:origin.observation_id,outcome:record.operation,state:record.after.state,
     renderer_root_id:record.before.renderer_root_id||null};
  }
  const commits=record.commits||[],cleanups=record.cleanups||[];
  if(!Array.isArray(commits)||!Array.isArray(cleanups)||commits.length>64||cleanups.length>4096)return fail('root_execution_scope_invalid');
  if(commits.length||cleanups.length){
    if(record.method!=='unmount'||rule.unmount_timing!=='synchronous'||record.before?.state!=='active'||record.operation!=='returned')return fail('root_synchronous_unmount_required');
    if(commits.some(row=>!row||row.renderer_root_id!==record.before.renderer_root_id||typeof row.commit_id!=='string'||!row.commit_id.startsWith('react-commit:')||row.empty_tree!==true)
      ||new Set(commits.map(row=>row.commit_id)).size!==commits.length)return fail('root_empty_commit_required');
    if(cleanups.some(row=>!row)||new Set(cleanups.map(row=>row.observation_id)).size!==cleanups.length)return fail('root_cleanup_duplicate');
    for(const cleanup of cleanups){
      const observed=resolveCleanup(cleanup.observation_id);
      if(!observed||observed.session!==record.session||observed.root_operation_id!==record.observation_id||observed.operation!=='cleanup_invoked'
        ||cleanup.root_id!==record.before.renderer_root_id||['root_id','instance_id','mount_id','source_call_id'].some(key=>cleanup[key]!==observed[key]))return fail('root_cleanup_invocation_required');
    }
  }
  // A rejected attachment must not advance the handle's lifetime. Otherwise a
  // malformed record could prevent a later valid unmount from being checked.
  if(record.method==='create')origins.set(record.result.identity,origin);else origin.after=structuredClone(record.after);
  seen.add(record.observation_id);
  return {schema:'producttrace.react-root-join.v1',status:'resolved',reason:null,runtime_observed:true,
    source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{...runtime,commit_observed:commits.length>0,cleanup_observed:cleanups.length>0,commits:structuredClone(commits),cleanup_invocations:structuredClone(cleanups),cleanup_completion_proven:false}};
 }};
}

export function checkReactRootRecovery(record,origin,originJoin,entry,{fingerprint}){
 const fail=reason=>({schema:'producttrace.react-root-recovery-join.v1',status:'unresolved',reason,runtime_observed:false});
 if(!record||record.schema!=='producttrace.react-root-recovery.v1'||record.kind!=='react_root_recovery'||record.runtime_observed!==true
   ||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session)return fail('root_recovery_context_required');
 const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
 if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)
   ||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('root_recovery_occurrence_required');
 const rule=entry?.root_rule;
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='dom_root'||entry.key!==record.manifest_key
   ||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id
   ||entry.root_recovery_source_id!==record.callback_source_id)return fail('root_recovery_rule_required');
 if(record.frontier)return fail(record.frontier);
 if(!origin||origin.session!==record.session||origin.observation_id!==record.origin_observation_id||origin.method!=='create'
   ||originJoin?.status!=='resolved'||originJoin.runtime?.renderer_root_id!==record.renderer_root_id
   ||origin.recovery_callback?.source_id!==record.callback_source_id
   ||origin.recovery_callback?.value?.identity!==record.callback_identity?.identity)return fail('root_recovery_registration_required');
 const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind);
 if(!token(record.callback_identity)||record.callback_identity.kind!=='function'||!token(record.receiver)||!token(record.result)
   ||!Array.isArray(record.arguments)||!record.arguments.every(token)||!['returned','threw'].includes(record.operation))return fail('root_recovery_values_required');
 return {schema:'producttrace.react-root-recovery-join.v1',status:'resolved',reason:null,runtime_observed:true,
  source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,callback_source_id:record.callback_source_id},
  runtime:{claim:'observed_root_recovery_callback',origin_observation_id:origin.observation_id,renderer_root_id:record.renderer_root_id,
   callback_identity:record.callback_identity.identity,arguments:structuredClone(record.arguments),outcome:record.operation,result:structuredClone(record.result)}};
}

/** A later renderer commit is accepted only when its current root element is
 * the exact object supplied by one accepted create/hydrate or render call. */
export function checkReactRootCommit(record,origin,originJoin,entry,{fingerprint}){
 const fail=reason=>({schema:'producttrace.react-root-commit-join.v1',status:'unresolved',reason,runtime_observed:false});
 if(!record||record.schema!=='producttrace.react-root-commit.v1'||record.kind!=='react_root_commit'||record.runtime_observed!==true
   ||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session)return fail('root_commit_context_required');
 const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
 if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)
   ||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('root_commit_occurrence_required');
 const rule=entry?.root_rule;
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='dom_root'||entry.key!==record.manifest_key
   ||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id)return fail('root_commit_rule_required');
 if(record.frontier)return fail(record.frontier);
 if(!origin||origin.session!==record.session||origin.observation_id!==record.origin_observation_id||origin.manifest_key!==record.manifest_key
   ||originJoin?.status!=='resolved'||originJoin.runtime?.renderer_root_id!==record.renderer_root_id)return fail('root_operation_required');
 const inputIndex=origin.method==='create'&&rule.mode==='hydrate'?rule.children_argument:origin.method==='render'?rule.render_argument:null;
 if(inputIndex===null||origin.operation!=='returned'||origin.inputs?.[inputIndex]?.identity!==record.input_identity||!scoped(record.input_identity))
   return fail('root_commit_input_required');
 if(typeof record.renderer_root_id!=='string'||!record.renderer_root_id.startsWith('react-root:')
   ||typeof record.commit_id!=='string'||!record.commit_id.startsWith('react-commit:')||record.empty_tree!==false)return fail('root_nonempty_commit_required');
 return {schema:'producttrace.react-root-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
  source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_root_input_committed',session:record.session,
   origin_observation_id:origin.observation_id,input_identity:record.input_identity,renderer_root_id:record.renderer_root_id,commit_id:record.commit_id}};
}
