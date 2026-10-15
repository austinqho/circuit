import {validateReactExecutionRule} from './react-execution-rule.mjs';

/**
 * Join a createPortal return to the HostPortal fiber that React actually
 * committed. React copies the original children reference into memoizedProps
 * and the original container reference into stateNode.containerInfo. Matching
 * both references and the key avoids choosing a portal by DOM location or text.
 */
export function createReactPortalCommitObserver(config){
 let context=null,byContainer=new WeakMap(),byFiber=new WeakMap(),rootCommits=new Map();
 const own=(value,key)=>{
  if(value===null||!['object','function'].includes(typeof value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 };
 const refresh=()=>{const next=config.context();if(next!==context){context=next;byContainer=new WeakMap();byFiber=new WeakMap();rootCommits=new Map();}return next;};
 return {
  begin(rootId,commitId){if(!config.enabled())return;refresh();rootCommits.set(rootId,commitId);},
  register(entry,portal,description,args){
   if(!config.enabled())return;refresh();
   const rule=entry.portal_rule,children=args[rule.children_argument],container=args[rule.container_argument];
   if(description.operation!=='returned'||description.frontier||!portal||typeof portal!=='object'
     ||!container||!['object','function'].includes(typeof container)
     ||own(portal,'$$typeof')!==Symbol.for(rule.marker)||own(portal,rule.children_field)!==children
     ||own(portal,rule.container_field)!==container)return;
   let items=byContainer.get(container);if(!items){items=[];byContainer.set(container,items);}
   if(items.length>=64){items.overflow=true;return;}
   items.push({entry,description,children,container,key:own(portal,'key'),context,lastCommit:null});
  },
  commit(fiber,identity){
   if(!config.enabled()||!identity||own(fiber,'tag')!==4)return;refresh();
   const state=own(fiber,'stateNode'),container=own(state,'containerInfo'),children=own(fiber,'memoizedProps'),key=own(fiber,'key');
   const items=container&&['object','function'].includes(typeof container)?byContainer.get(container):null;if(!items)return;
   const matches=items.filter(item=>item.context===context&&item.children===children&&item.key===key);
   for(const item of matches){
    const stamp=[identity.root_id,identity.instance_id,identity.mount_id,identity.commit_id].join('\0');
    if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
    const record={schema:'producttrace.react-portal-commit.v1',kind:'react_portal_commit',runtime_observed:true,operation:'committed',
     observation_id:config.id('portal_commit'),origin_observation_id:item.description.observation_id,
     manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
     children_identity:item.description.inputs[item.entry.portal_rule.children_argument].identity,
     container_identity:item.description.inputs[item.entry.portal_rule.container_argument].identity,
     renderer:{...identity,tag:4,key},frontier:items.overflow||matches.length!==1?'portal_commit_origin_ambiguous':null};
    config.observe(record);
    if(!record.frontier){const retained={observation_id:record.observation_id,origin_observation_id:record.origin_observation_id,
      root_id:identity.root_id,commit_id:identity.commit_id,renderer:record.renderer,entry:item.entry};
     byFiber.set(fiber,retained);if(fiber.alternate)byFiber.set(fiber.alternate,retained);}
   }
  },
  unmount(fiber){
   if(!config.enabled()||!fiber)return;refresh();
   const retained=byFiber.get(fiber)||(fiber.alternate&&byFiber.get(fiber.alternate));if(!retained)return;
   config.observe({schema:'producttrace.react-portal-commit.v1',kind:'react_portal_commit',runtime_observed:true,operation:'unmounted',
    observation_id:config.id('portal_unmount'),origin_observation_id:retained.origin_observation_id,
    commit_observation_id:retained.observation_id,manifest_key:retained.entry.key,source_call_id:retained.entry.source_call_id,
    semantic_id:retained.entry.semantic_id,renderer:{...retained.renderer}});
   byFiber.delete(fiber);if(fiber.alternate)byFiber.delete(fiber.alternate);
  },
  ancestry(fiber){
   if(!config.enabled())return [];refresh();
   const rows=[],seen=new Set();let cursor=fiber;
   while(cursor&&seen.size<128&&!seen.has(cursor)){
    seen.add(cursor);const item=byFiber.get(cursor);
    if(item&&rootCommits.get(item.root_id)===item.commit_id)rows.push({observation_id:item.observation_id,root_id:item.root_id,commit_id:item.commit_id});
    cursor=own(cursor,'return');
   }
   return cursor?[{frontier:'portal_ancestry_incomplete'}]:rows;
  },
 };
}

export function checkReactPortalCommit(record,origin,entry,{fingerprint,resolveCommit=()=>null}){
 const fail=reason=>({schema:'producttrace.react-portal-commit-join.v1',status:'unresolved',reason,runtime_observed:false});
 if(!record||record.schema!=='producttrace.react-portal-commit.v1'||record.kind!=='react_portal_commit'||record.runtime_observed!==true
   ||record.map_fingerprint!==fingerprint||typeof record.session!=='string'||!record.session)return fail('portal_commit_context_required');
 const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
 if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)
   ||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('portal_commit_occurrence_required');
 const rule=entry?.portal_rule;
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='portal_description'||entry.key!==record.manifest_key
   ||entry.source_call_id!==record.source_call_id||entry.semantic_id!==record.semantic_id)return fail('portal_commit_rule_required');
 if(record.frontier)return fail(record.frontier);
 if(!origin||origin.session!==record.session||origin.observation_id!==record.origin_observation_id||origin.manifest_key!==record.manifest_key
   ||origin.operation!=='returned')return fail('portal_description_required');
 if(!record.renderer||record.renderer.tag!==4||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof record.renderer[key]==='string'&&record.renderer[key]))
   return fail('portal_renderer_identity_required');
 if(record.operation==='unmounted'){
  const commit=resolveCommit(record.commit_observation_id);
  if(!commit||commit.status!=='resolved'||commit.runtime.session!==record.session||commit.runtime.origin_observation_id!==origin.observation_id
    ||['root_id','instance_id','mount_id','commit_id'].some(key=>commit.runtime.renderer[key]!==record.renderer[key]))return fail('portal_prior_commit_required');
  return {schema:'producttrace.react-portal-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_portal_unmounted',session:record.session,
    origin_observation_id:origin.observation_id,commit_observation_id:record.commit_observation_id,renderer:{...record.renderer}}};
 }
 if(record.operation!=='committed'||record.children_identity!==origin.inputs?.[rule.children_argument]?.identity
   ||record.container_identity!==origin.inputs?.[rule.container_argument]?.identity)return fail('portal_commit_input_mismatch');
 return {schema:'producttrace.react-portal-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
  source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_portal_inputs_in_committed_tree',session:record.session,
   origin_observation_id:origin.observation_id,children_identity:record.children_identity,container_identity:record.container_identity,
   renderer:{...record.renderer},descendant_callback_execution_proven:false}};
}
