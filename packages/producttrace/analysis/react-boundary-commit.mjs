import {validateReactExecutionRule} from './react-execution-rule.mjs';

/** Interpret the boundary rule against an actual renderer snapshot. The mode
 * flags describe configuration, not proof that a descendant callback ran. */
export function selectReactBoundaryCommit(rule,snapshot){
 const renderer=rule?.renderer;
 if(!renderer||!snapshot||snapshot.tag!==renderer.tag||!Number.isSafeInteger(snapshot.mode)
   ||typeof snapshot.has_state!=='boolean'||typeof snapshot.dehydrated!=='boolean')return null;
 return {input:renderer.input,selection:renderer.selection==='suspense_state'
   ?!snapshot.has_state?'children':snapshot.dehydrated?'dehydrated':'fallback':'children',
   strict_render_mode:renderer.strict_render_mask!==0&&(snapshot.mode&renderer.strict_render_mask)!==0,
   strict_effect_mode:renderer.strict_effect_mask!==0&&(snapshot.mode&renderer.strict_effect_mask)!==0};
}

/** A Fragment may reuse a sibling selected by key (or position if unkeyed),
 * only when its parent and renderer type also match. This describes reuse; it
 * does not cause a render or predict which scheduled update will commit. */
export function predictReactFragmentIdentity(rule,previous,current){
 const policy=rule?.fragment;
 const valid=row=>row&&['root_id','parent_instance_id','parent_mount_id'].every(key=>typeof row[key]==='string'&&row[key])
   &&Number.isSafeInteger(row.index)&&row.index>=0&&(row.key===null||typeof row.key==='string');
 if(!policy||!valid(previous)||!valid(current))return null;
 const sameParent=['root_id','parent_instance_id','parent_mount_id'].every(key=>previous[key]===current[key]);
 const keyMatches=policy.key_match==='index_only'?previous.index===current.index
   :previous.key===current.key&&(current.key!==null||previous.index===current.index);
 return {retains:sameParent&&keyMatches&&previous.tag===policy.type_tag&&current.tag===policy.type_tag,
   ref:policy.ref,extra_props:policy.extra_props};
}

/** Match the original object React handed to a boundary fiber. Fragment's input
 * is children rather than props. Primitive or elided fragments stay unresolved;
 * equal text is never sufficient to choose a mounted boundary. */
export function createReactBoundaryCommitObserver(config){
 let context=null,byInput=new WeakMap(),byChildProps=new WeakMap(),identities=new WeakMap(),byFiber=new WeakMap(),rootCommits=new Map(),byOrigin=new Map();
 const own=(value,key)=>{
  if(value===null||!['object','function'].includes(typeof value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 };
 const refresh=()=>{const next=config.context();if(next!==context){context=next;byInput=new WeakMap();byChildProps=new WeakMap();identities=new WeakMap();byFiber=new WeakMap();rootCommits=new Map();byOrigin=new Map();}};
 const currentFiberCommit=fiber=>{const rows=byFiber.get(fiber)||(fiber&&fiber.alternate&&byFiber.get(fiber.alternate))||[];
  return rows.length===1&&rootCommits.get(rows[0].root_id)===rows[0].commit_id?rows[0]:null;};
 return {
  begin(rootId,commitId){if(!config.enabled())return;refresh();rootCommits.set(rootId,commitId);},
  created(entry,value,observationId){
   if(!config.enabled())return null;refresh();
   const rule=entry.boundary_rule,props=own(value,'props');
   if(own(value,'$$typeof')!==Symbol.for(rule.element_marker)||own(value,'type')!==Symbol.for(rule.marker))return null;
   const input=rule.renderer.input==='children'?own(props,'children'):props;
   if(input===null||!['object','function'].includes(typeof input))return {frontier:'boundary_reference_input_required'};
   let id=identities.get(input);if(!id){id=config.id('boundary_input');identities.set(input,id);}
   const items=byInput.get(input)||[];
   if(items.length>=64){items.overflow=true;return {frontier:'boundary_input_origin_limit'};}
   const item={entry,origin:observationId,inputId:id,key:own(value,'key'),context,lastCommit:null};
   items.push(item);byInput.set(input,items);
   if(entry.semantic_id==='react/Suspense/18.3.1'){
    const children=own(props,'children'),values=Array.isArray(children)?children.slice(0,64):[children];
    for(const child of values){
     if(own(child,'$$typeof')!==Symbol.for('react.element'))continue;
     const childProps=own(child,'props');if(!childProps||typeof childProps!=='object')continue;
     const owners=byChildProps.get(childProps)||[];owners.push(item);if(values.length>=64)owners.overflow=true;byChildProps.set(childProps,owners);
    }
   }
   return {identity:id,field:rule.renderer.input,key:own(value,'key')};
  },
  commit(fiber,identity){
   if(!config.enabled()||!identity)return;refresh();
   if((byFiber.get(fiber)||[]).some(row=>row.root_id===identity.root_id&&row.commit_id===identity.commit_id))return;
   const previousRows=byFiber.get(fiber)||(fiber.alternate&&byFiber.get(fiber.alternate))||[];
   const previous=previousRows.length===1?previousRows[0]:null;
   byFiber.delete(fiber);if(fiber.alternate)byFiber.delete(fiber.alternate);
   const input=own(fiber,'memoizedProps'),items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
   if(!items)return;
   const parent=config.parentIdentity?.(own(fiber,'return'));
   const state=own(fiber,'memoizedState'),snapshot={...identity,key:own(fiber,'key'),index:own(fiber,'index'),
     parent_instance_id:parent?.instance_id||null,parent_mount_id:parent?.mount_id||null,tag:own(fiber,'tag'),mode:own(fiber,'mode'),
     has_state:state!==null&&state!==undefined,dehydrated:state!=null&&own(state,'dehydrated')!=null};
   for(const item of items){
    const selected=config.select(item.entry.boundary_rule,snapshot);if(item.context!==context||item.key!==own(fiber,'key')||!selected)continue;
    const stamp=[identity.root_id,identity.instance_id,identity.mount_id,identity.commit_id].join('\0');
    if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
    const peers=items.filter(other=>other.context===context&&other.key===item.key&&other.entry.boundary_rule.renderer.tag===snapshot.tag);
    const record={schema:'producttrace.react-boundary-commit.v1',kind:'react_boundary_commit',runtime_observed:true,
      observation_id:config.id('boundary_commit'),origin_observation_id:item.origin,manifest_key:item.entry.key,
      source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,
      renderer:snapshot,selection:selected,frontier:items.overflow||peers.length!==1?'boundary_input_origin_ambiguous':null};
    if(item.entry.boundary_rule.fragment&&previous?.renderer&&previous.semantic_id===item.entry.semantic_id){
      const prediction=config.predictIdentity?.(item.entry.boundary_rule,previous.renderer,snapshot);
      if(prediction){record.previous_observation_id=previous.observation_id;record.identity_prediction=prediction;
        if(!prediction.retains)record.frontier='fragment_identity_rule_disagrees';}
    }
    config.observe(record);
    // Keep the immediately preceding commit only when React retained the exact
    // boundary mount. Lazy retry evidence uses this to connect fallback to reveal.
    if(!record.frontier){const retainedPrevious=previous&&['root_id','instance_id','mount_id'].every(key=>previous.renderer?.[key]===snapshot[key])
       &&previous.commit_id!==identity.commit_id?{observation_id:previous.observation_id,root_id:previous.root_id,commit_id:previous.commit_id,
         renderer:{...previous.renderer},semantic_id:previous.semantic_id,selection:{...previous.selection}}:null;
      const ids=byFiber.get(fiber)||[];ids.push({observation_id:record.observation_id,root_id:identity.root_id,commit_id:identity.commit_id,renderer:snapshot,
        semantic_id:item.entry.semantic_id,origin_observation_id:item.origin,selection:selected,previous_commit:retainedPrevious});
      byFiber.set(fiber,ids);if(fiber.alternate)byFiber.set(fiber.alternate,ids);
      byOrigin.set(item.origin,{observation_id:record.observation_id,root_id:identity.root_id,
        commit_id:identity.commit_id,renderer:snapshot,semantic_id:item.entry.semantic_id,
        origin_observation_id:item.origin,selection:selected,previous_commit:retainedPrevious});}
   }
  },
  currentCommit(fiber){
   if(!config.enabled())return null;refresh();return currentFiberCommit(fiber);
  },
  currentOriginCommit(origin){
   if(!config.enabled())return null;refresh();const row=byOrigin.get(origin);
   return row&&rootCommits.get(row.root_id)===row.commit_id?row:null;
  },
  renderBoundary(fiber){
   if(!config.enabled())return null;refresh();
   let cursor=fiber&&own(fiber,'return'),seen=new Set();
   while(cursor&&seen.size<128&&!seen.has(cursor)){
    seen.add(cursor);
    if(own(cursor,'tag')===13){
     const input=own(cursor,'pendingProps')||own(cursor,'memoizedProps');
     const items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
     const matches=(items||[]).filter(item=>item.context===context&&item.key===own(cursor,'key')
       &&item.entry.semantic_id==='react/Suspense/18.3.1');
     if(items?.overflow||matches.length!==1)return {frontier:items?.overflow
       ?'boundary_input_origin_limit':'suspense_render_origin_unresolved'};
     const item=matches[0];
     const identity=config.identify?.(cursor);
     if(!identity)return {frontier:'suspense_render_identity_unresolved'};
     return {fiber:cursor,origin_observation_id:item.origin,manifest_key:item.entry.key,
       source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,
       renderer:{root_id:identity.root_id,instance_id:identity.instance_id,mount_id:identity.mount_id},
       previous_commit:currentFiberCommit(cursor)};
    }
    cursor=own(cursor,'return');
   }
   return cursor?{frontier:'suspense_render_ancestry_incomplete'}:null;
  },
  renderBoundaryFromProps(props){
   if(!config.enabled()||!props||typeof props!=='object')return null;refresh();
   const items=byChildProps.get(props),matches=(items||[]).filter(item=>item.context===context
     &&item.entry.semantic_id==='react/Suspense/18.3.1');
   if(!items)return null;
   if(items.overflow||matches.length!==1)return {frontier:items.overflow
     ?'boundary_input_origin_limit':'suspense_render_origin_unresolved'};
   const item=matches[0];return {fiber:null,origin_observation_id:item.origin,manifest_key:item.entry.key,
     source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,input_identity:item.inputId,renderer:null};
  },
  currentStrict(fiber){
   if(!config.enabled())return null;refresh();
   let cursor=own(fiber,'return'),seen=new Set();
   while(cursor&&seen.size<128&&!seen.has(cursor)){
    seen.add(cursor);
    if(own(cursor,'tag')===8){
      const input=own(cursor,'pendingProps')||own(cursor,'memoizedProps');
      const items=input&&['object','function'].includes(typeof input)?byInput.get(input):null;
      const matches=(items||[]).filter(item=>item.context===context&&item.key===own(cursor,'key')
        &&item.entry.semantic_id==='react/StrictMode/18.3.1');
      if(items?.overflow||matches.length!==1)return null;
      const identity=config.identify?.(cursor);if(!identity)return null;
      return {entry:matches[0].entry,origin:matches[0].origin,input_identity:matches[0].inputId,
        identity:{...identity,tag:own(cursor,'tag'),mode:own(cursor,'mode')}};
    }
    cursor=own(cursor,'return');
   }
   return null;
  },
  ancestry(fiber){
   if(!config.enabled())return [];refresh();
   const result=[],seen=new Set();let cursor=fiber;
   while(cursor&&seen.size<128&&!seen.has(cursor)){
    seen.add(cursor);
    for(const item of byFiber.get(cursor)||[])if(rootCommits.get(item.root_id)===item.commit_id)result.push({observation_id:item.observation_id,root_id:item.root_id,commit_id:item.commit_id});
    cursor=own(cursor,'return');
   }
   return cursor?[{frontier:'boundary_ancestry_incomplete'}]:result;
  },
 };
}

export function checkReactBoundaryCommit(record,origin,entry,{fingerprint,resolvePrevious=()=>null}){
 const fail=reason=>({schema:'producttrace.react-boundary-commit-join.v1',status:'unresolved',reason,runtime_observed:false});
 if(!record||record.kind!=='react_boundary_commit'||record.schema!=='producttrace.react-boundary-commit.v1'
   ||record.runtime_observed!==true||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session)return fail('boundary_commit_context_required');
 const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
 if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)
   ||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('boundary_commit_occurrence_required');
 const rule=entry?.boundary_rule;
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='boundary_type'||entry.key!==record.manifest_key
   ||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id)return fail('boundary_commit_rule_required');
 if(record.frontier)return fail(record.frontier);
 if(!origin||origin.session!==record.session||origin.observation_id!==record.origin_observation_id||origin.manifest_key!==record.manifest_key
   ||origin.operation!=='element_created'||origin.boundary_input?.frontier||origin.boundary_input?.identity!==record.input_identity
   ||origin.boundary_input?.field!==rule.renderer.input||!scoped(record.input_identity))return fail('boundary_created_input_required');
 if(!record.renderer||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof record.renderer[key]==='string'&&record.renderer[key]))return fail('boundary_renderer_identity_required');
 if(rule.fragment&&(record.renderer.key!==origin.boundary_input.key
   ||!(record.renderer.key===null||typeof record.renderer.key==='string')))return fail('fragment_created_key_required');
 const selected=selectReactBoundaryCommit(rule,record.renderer);
 if(!selected||JSON.stringify(record.selection)!==JSON.stringify(selected))return fail('boundary_renderer_selection_mismatch');
 let identityRelation=null;
 if(record.previous_observation_id!=null||record.identity_prediction!=null){
   const previous=resolvePrevious(record.previous_observation_id),before=previous?.runtime?.renderer;
   if(previous?.status!=='resolved'||previous.runtime.session!==record.session||previous.source?.semantic_id!==record.semantic_id
     ||!before||!['root_id','instance_id','mount_id'].every(key=>before[key]===record.renderer[key])
     ||before.commit_id===record.renderer.commit_id)return fail('fragment_previous_commit_required');
   const expected=predictReactFragmentIdentity(rule,before,record.renderer);
   if(!expected?.retains||JSON.stringify(expected)!==JSON.stringify(record.identity_prediction))return fail('fragment_identity_prediction_mismatch');
   identityRelation={claim:'observed_retained_fragment_identity',previous_observation_id:record.previous_observation_id,prediction:expected};
 }

 return {schema:'producttrace.react-boundary-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_boundary_input_in_committed_tree',session:record.session,
     observation_id:record.observation_id,origin_observation_id:record.origin_observation_id,input_identity:record.input_identity,renderer:{...record.renderer},selection:selected,identity_relation:identityRelation,
     descendant_callback_execution_proven:false,profiler_callback_execution_proven:false}};
}
