import {validateReactExecutionRule} from './react-execution-rule.mjs';

/** Retain the exact lazy object and the renderer's own Suspense ancestry. This
 * observer never reads module.default or subscribes to an application thenable;
 * settlement arrives from the separately guarded native-Promise observer. */
export function createReactLazyCommitObserver(config){
 let context=null,byLazy=new WeakMap(),items=[];
 const own=(value,key)=>{
  if(value===null||!['object','function'].includes(typeof value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 };
 const refresh=()=>{const next=config.context();if(next!==context){context=next;byLazy=new WeakMap();items=[];}return next;};
 const boundaryOf=fiber=>{let current=fiber&&own(fiber,'return'),seen=new Set();
  while(current&&seen.size<128&&!seen.has(current)){seen.add(current);if(own(current,'tag')===13)return current;current=own(current,'return');}
  return null;};
 const sameFiber=(left,right)=>left===right||left&&right&&(own(left,'alternate')===right||own(right,'alternate')===left);
 return {
  register(entry,lazy,record){
   if(!config.enabled()||!lazy||typeof lazy!=='object'||record.operation!=='returned')return;refresh();
   let rows=byLazy.get(lazy);if(!rows){rows=[];byLazy.set(lazy,rows);}
   if(rows.length>=32||items.length>=512){rows.overflow=true;return;}
   const item={entry,lazy,context,allocation_observation_id:record.observation_id,lazy_identity:record.result.identity,
    loader:null,settlement:null,boundary:null,boundaryProps:null,boundaryKey:null,boundaryMatch:null,boundaryAmbiguous:false,
    fallback:null,lastCommit:null,completed:false};
   rows.push(item);items.push(item);
  },
  loader(entry,lazy,thenable,record,fiber){
   if(!config.enabled()||!lazy||typeof lazy!=='object')return;refresh();
   const rows=(byLazy.get(lazy)||[]).filter(item=>item.context===context&&item.entry.key===entry.key
    &&item.allocation_observation_id===record.creation_observation_id&&item.lazy_identity===record.lazy_identity);
   if(rows.length!==1)return;
   const item=rows[0];item.loader={observation_id:record.observation_id,thenable,
    thenable_identity:record.result?.identity||null,protocol:record.thenable_protocol||null};
   item.boundary=boundaryOf(fiber);item.boundaryProps=own(item.boundary,'pendingProps')||own(item.boundary,'memoizedProps');
   item.boundaryKey=own(item.boundary,'key');
  },
  settle(entry,lazy,value,record){
   if(!config.enabled()||!lazy||typeof lazy!=='object')return;refresh();
   const rows=(byLazy.get(lazy)||[]).filter(item=>item.context===context&&item.entry.key===entry.key
    &&item.allocation_observation_id===record.creation_observation_id&&item.lazy_identity===record.lazy_identity
    &&item.loader?.observation_id===record.loader_observation_id&&item.loader.thenable_identity===record.thenable_identity);
   if(rows.length===1)rows[0].settlement={observation_id:record.observation_id,
    outcome:record.operation==='loader_fulfilled'?'fulfilled':'rejected',value,result_identity:record.result?.identity||null};
  },
  boundaryCommit(fiber,commit){
   if(!config.enabled()||!fiber||!commit)return;refresh();
   for(const item of items){if(item.context!==context)continue;
    const exact=sameFiber(item.boundary,fiber)||item.boundaryProps&&own(fiber,'memoizedProps')===item.boundaryProps&&own(fiber,'key')===item.boundaryKey;
    if(!exact)continue;
    if(item.boundaryMatch&&!sameFiber(item.boundaryMatch,fiber))item.boundaryAmbiguous=true;else item.boundaryMatch=fiber;
    if(commit.selection?.selection==='fallback')item.fallback={...commit};
   }
  },
  commit(fiber,renderer){
   if(!config.enabled()||!fiber||!renderer)return;refresh();
   const lazy=own(fiber,'elementType'),rows=lazy&&typeof lazy==='object'?byLazy.get(lazy):null;if(!rows)return;
   const boundary=boundaryOf(fiber),reveal=boundary&&config.boundary(boundary),component=own(fiber,'type');
   for(const item of rows){if(item.context!==context||item.completed)continue;
    if(!item.fallback&&reveal?.previous_commit?.selection?.selection==='fallback')item.fallback={...reveal.previous_commit};
    const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.commit_id].join('\0');if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
    let frontier=null;
    if(rows.overflow||rows.length!==1)frontier='lazy_allocation_origin_ambiguous';
    else if(item.boundaryAmbiguous)frontier='lazy_suspense_boundary_origin_ambiguous';
    else if(!item.loader)frontier='lazy_loader_occurrence_unobserved';
    else if(item.loader.protocol!=='native_promise.v1')frontier='lazy_thenable_settlement_unobserved';
    else if(!item.settlement)frontier='lazy_native_promise_settlement_unobserved';
    else if(item.settlement.outcome!=='fulfilled')frontier='lazy_rejected_value_cannot_commit';
    else if(!item.fallback)frontier='lazy_fallback_commit_unobserved';
    else if(!reveal||reveal.selection?.selection!=='children')frontier='lazy_reveal_boundary_commit_unobserved';
    else if(!component||typeof component!=='function')frontier='lazy_resolved_component_unobserved';
    const observation_id=config.id('lazy_commit');
    config.observe({schema:'producttrace.react-lazy-commit.v1',kind:'react_lazy_commit',runtime_observed:true,
     observation_id,manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
     allocation_observation_id:item.allocation_observation_id,loader_observation_id:item.loader?.observation_id||null,
     settlement_observation_id:item.settlement?.observation_id||null,lazy_identity:item.lazy_identity,
     thenable_identity:item.loader?.thenable_identity||null,module_identity:item.settlement?.result_identity||null,
     component_identity:component&&typeof component==='function'?config.identity(component):null,
     fallback_boundary_commit_observation_id:item.fallback?.observation_id||null,
     reveal_boundary_commit_observation_id:reveal?.observation_id||null,renderer:{...renderer},frontier});
    if(!frontier)item.completed=true;
   }
  },
 };
}

export function checkReactLazyCommit(record,{fingerprint,entry,allocation,loader,settlement,fallback,reveal}){
 const fail=reason=>({schema:'producttrace.react-lazy-commit-join.v1',status:'unresolved',reason,runtime_observed:false});
 if(record?.schema!=='producttrace.react-lazy-commit.v1'||record.kind!=='react_lazy_commit'||record.runtime_observed!==true
   ||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session)return fail('lazy_commit_context_required');
 const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
 if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'
   ||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))
   return fail('lazy_commit_occurrence_required');
 const rule=entry?.element_rule;
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='lazy_component'||rule.module_property!=='default'
   ||entry.key!==record.manifest_key||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id)
   return fail('lazy_commit_rule_required');
 if(record.frontier)return fail(record.frontier);
 if(allocation?.status!=='resolved'||allocation.runtime.claim!=='observed_lazy_allocation'
   ||allocation.observation_id!==record.allocation_observation_id||allocation.runtime.lazy_identity!==record.lazy_identity)
   return fail('lazy_allocation_evidence_required');
 if(loader?.status!=='resolved'||loader.runtime.claim!=='observed_lazy_loader_completion'||loader.runtime.outcome!=='returned'
   ||loader.observation_id!==record.loader_observation_id||loader.runtime.creation_observation_id!==record.allocation_observation_id
   ||loader.runtime.result.identity!==record.thenable_identity)return fail('lazy_loader_evidence_required');
 if(settlement?.status!=='resolved'||settlement.runtime.claim!=='observed_lazy_loader_settlement'||settlement.runtime.outcome!=='fulfilled'
   ||settlement.observation_id!==record.settlement_observation_id||settlement.runtime.loader_observation_id!==record.loader_observation_id
   ||settlement.runtime.thenable_identity!==record.thenable_identity||settlement.runtime.result.identity!==record.module_identity)
   return fail('lazy_settlement_evidence_required');
 const suspenseSemantic=entry.semantic_id.replace('/lazy/','/Suspense/');
 const boundary=(value,selection)=>value?.status==='resolved'&&value.source?.semantic_id===suspenseSemantic
   &&value.runtime.claim==='observed_boundary_input_in_committed_tree'&&value.runtime.session===record.session
   &&value.runtime.renderer?.tag===13&&value.runtime.selection?.selection===selection;
 if(!boundary(fallback,'fallback')||fallback.runtime.observation_id!==record.fallback_boundary_commit_observation_id
   ||!boundary(reveal,'children')||reveal.runtime.observation_id!==record.reveal_boundary_commit_observation_id)
   return fail('lazy_suspense_commit_evidence_required');
 const before=fallback.runtime.renderer,after=reveal.runtime.renderer;
 if(['root_id','instance_id','mount_id'].some(key=>before[key]!==after[key])||before.commit_id===after.commit_id
   ||record.renderer.root_id!==after.root_id||record.renderer.commit_id!==after.commit_id
   ||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof record.renderer[key]==='string'&&record.renderer[key])
   ||!scoped(record.component_identity))
   return fail('lazy_retry_renderer_identity_mismatch');
 return {schema:'producttrace.react-lazy-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
  source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,module_property:rule.module_property},
  runtime:{claim:'observed_lazy_settlement_retry_commit',session:record.session,lazy_identity:record.lazy_identity,
   thenable_identity:record.thenable_identity,module_identity:record.module_identity,component_identity:record.component_identity,
   allocation_observation_id:record.allocation_observation_id,loader_observation_id:record.loader_observation_id,
   settlement_observation_id:record.settlement_observation_id,fallback_boundary_commit_observation_id:record.fallback_boundary_commit_observation_id,
   reveal_boundary_commit_observation_id:record.reveal_boundary_commit_observation_id,renderer:{...record.renderer},
   module_property_selected_by_verified_rule:true,module_property_read_directly_by_tracer:false}};
}
