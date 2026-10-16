/** Match an observed React element to a committed renderer instance using the
 * original props object and element type. Equality of strings or component
 * names is never sufficient. This observer does not execute component bodies.
 * Its factory is self-contained so the browser build can use the same code.
 */
export function createReactDescriptorCommitObserver(config) {
  let context=null,byProps=new WeakMap();
  const data=(object,key)=>{
    if(!object||!['object','function'].includes(typeof object))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(object,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  };
  const refresh=()=>{const current=config.context();if(current!==context){context=current;byProps=new WeakMap();}return current;};
  return {
    register(entry,element,description){
      if(!config.enabled())return;refresh();
      if(description.operation!=='returned'||description.frontier||!description.result?.identity||!description.fields?.props?.identity)return;
      const props=data(element,'props'),type=data(element,'type'),owner=data(element,'_owner');
      if(!props||typeof props!=='object'||data(element,'$$typeof')!==Symbol.for('react.element'))return;
      let definitions=byProps.get(props);if(!definitions){definitions=[];byProps.set(props,definitions);}
      // A full list is ambiguous rather than a reason to pick the newest item.
      if(definitions.length>=64){definitions.overflow=true;return;}
      definitions.push({entry,description,type,owner,context,commits:new Set()});
    },
    commit(fiber,identity){
      if(!config.enabled())return;refresh();
      if(!identity||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof identity[key]==='string'&&identity[key]))return;
      const props=data(fiber,'memoizedProps'),type=data(fiber,'elementType');
      const definitions=props&&typeof props==='object'?byProps.get(props):null;if(!definitions)return;
      const candidates=definitions.filter(item=>item.context===context&&item.type===type);
      if(!candidates.length)return;
      for(const definition of candidates){
        const stamp=identity.root_id+'\0'+identity.instance_id+'\0'+identity.mount_id+'\0'+identity.commit_id;
        if(definition.commits.has(stamp))continue;
        // Only remember the last commit per definition; this is deduplication,
        // not a retained history of every render in a long-lived application.
        definition.commits.clear();definition.commits.add(stamp);
        const {entry,description}=definition;
        let parent=data(fiber,'return'),ownerParentDistance=null,ownerRelation=null;
        const ownerReference=definition.owner!==null&&['object','function'].includes(typeof definition.owner);
        for(let distance=1;ownerReference&&parent&&distance<=64;distance++,parent=data(parent,'return')){
          if(parent===definition.owner){ownerParentDistance=distance;ownerRelation='direct';break;}
          if(data(parent,'alternate')===definition.owner||data(definition.owner,'alternate')===parent){ownerParentDistance=distance;ownerRelation='alternate';break;}
        }
        config.observe({schema:'producttrace.react-descriptor-commit.v1',kind:'react_descriptor_commit',runtime_observed:true,
          manifest_key:entry.key,source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,
          observation_id:config.id('descriptor_commit'),description_observation_id:description.observation_id,
          element_identity:description.result.identity,props_identity:description.fields.props.identity,
          type_identity:description.fields.type.identity,owner_identity:description.fields._owner?.identity||null,
          owner_parent_distance:ownerParentDistance,owner_relation:ownerRelation,renderer:{...identity},
          frontier:definitions.overflow||candidates.length!==1?'committed_descriptor_ambiguous':null,
          reason:'The committed React fiber retained this exact observed props object and element type; no component invocation or child effect is inferred.'});
      }
    },
  };
}

/** A commit cannot manufacture a creation observation or borrow an element
 * from another session. The original description must have passed its own
 * source/rule gate before the caller supplies it here.
 */
export function checkReactDescriptorCommit(record,origin,{fingerprint,session,rendererKnown=false}){
  const reject=reason=>({status:'unresolved',reason,runtime_observed:false});
  if(!record||record.schema!=='producttrace.react-descriptor-commit.v1'||record.kind!=='react_descriptor_commit'||record.runtime_observed!==true
    ||record.session!==session||record.map_fingerprint!==fingerprint)return reject('descriptor_commit_context_mismatch');
  if(record.frontier)return reject(record.frontier);
  const scoped=value=>typeof value==='string'&&value.startsWith(session+':')&&value!==session+':';
  if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)
    ||!record.evidence_ids.every(scoped))return reject('descriptor_commit_occurrence_required');
  if(!origin||origin.session!==session||origin.map_fingerprint!==fingerprint||origin.observation_id!==record.description_observation_id
    ||origin.source_call_id!==record.source_call_id||origin.semantic_id!==record.semantic_id||origin.manifest_key!==record.manifest_key)
    return reject('descriptor_creation_required');
  if(origin.result?.identity!==record.element_identity||origin.fields?.props?.identity!==record.props_identity||origin.fields?.type?.identity!==record.type_identity
    ||origin.fields?._owner?.identity!==record.owner_identity)
    return reject('descriptor_commit_value_mismatch');
  if(!record.renderer||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof record.renderer[key]==='string'&&record.renderer[key]))return reject('descriptor_renderer_identity_required');
  const ownerLineage=Number.isSafeInteger(record.owner_parent_distance)&&record.owner_parent_distance>0&&record.owner_parent_distance<=64
    &&['direct','alternate'].includes(record.owner_relation);
  if(!rendererKnown&&!ownerLineage)return reject('descriptor_committed_owner_required');
  return {schema:'producttrace.react-descriptor-commit-join.v1',observation_id:record.observation_id,source:{source_call_id:record.source_call_id,semantic_id:record.semantic_id},status:'resolved',reason:null,runtime_observed:true,runtime:{claim:'observed_descriptor_props_in_committed_tree',description_observation_id:origin.observation_id,
    renderer:{...record.renderer},element_identity:record.element_identity,props_identity:record.props_identity,
    descriptor_identity_proven:false,owner_lineage_proven:ownerLineage,owner_identity:record.owner_identity,
    owner_parent_distance:record.owner_parent_distance,owner_relation:record.owner_relation,
    component_invocation_proven:false,descendant_effect_proven:false}};
}
