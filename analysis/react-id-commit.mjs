/** Track the original props object produced around a known useId expression.
 * This observes React's commit, without searching the DOM for a matching string.
 * Keep the factory self-contained: the browser build embeds this exact code. */
export function createReactIdCommitObserver(config) {
  let context=null,byProps=new WeakMap();
  const own=(value,key)=>{
    if(value===null||!['object','function'].includes(typeof value))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  };
  const refresh=()=>{const next=config.context();if(next!==context){context=next;byProps=new WeakMap();}};
  return {
    element(entry,element,use,render){
      if(!config.enabled())return element;refresh();
      const props=own(element,'props'),type=own(element,'type');
      if(!use||!render||typeof type!=='string'||!props||typeof props!=='object'
        ||own(element,'$$typeof')!==Symbol.for('react.element')||own(props,entry.id_property)!==use.value)return element;
      let items=byProps.get(props);if(!items){items=[];byProps.set(props,items);}
      if(items.length>=64){items.overflow=true;return element;}
      items.push({entry,use,render,type,context,lastCommit:null});
      return element;
    },
    commit(fiber,host,owner){
      if(!config.enabled()||!host||!owner)return;refresh();
      const props=own(fiber,'memoizedProps'),items=props&&typeof props==='object'?byProps.get(props):null;
      if(!items)return;
      const type=own(fiber,'elementType');
      for(const item of items){
        if(item.context!==context||item.type!==type||item.render.status!=='committed'
          ||own(props,item.entry.id_property)!==item.use.value
          ||item.render.render_id!==owner.render_id
          ||['root_id','instance_id','mount_id'].some(key=>item.render.identity[key]!==owner[key]))continue;
        const stamp=[host.root_id,host.instance_id,host.mount_id,host.commit_id].join('\0');
        if(item.lastCommit===stamp)continue;item.lastCommit=stamp;
        const peers=items.filter(other=>other.context===context&&other.type===type&&other.entry.id_property===item.entry.id_property);
        config.observe({schema:'producttrace.react-id-commit.v1',kind:'react_id_commit',runtime_observed:true,
          manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
          observation_id:config.id('id_commit'),use_observation_id:item.use.observation_id,
          id_read_source_id:item.entry.id_read_source_id,id_property:item.entry.id_property,value:item.use.value,
          host:{...host,type},owner:{...owner},
          frontier:items.overflow||peers.length!==1?'id_property_origin_ambiguous':null});
      }
    },
  };
}

export function checkReactIdCommit(record,origin,{fingerprint,ownerKnown=false}){
  const fail=reason=>({schema:'producttrace.react-id-commit-join.v1',status:'unresolved',reason,runtime_observed:false});
  if(!record||record.schema!=='producttrace.react-id-commit.v1'||record.kind!=='react_id_commit'
    ||record.map_fingerprint!==fingerprint||record.runtime_observed!==true||typeof record.session!=='string'||!record.session)return fail('id_commit_context_required');
  const scoped=value=>typeof value==='string'&&value.startsWith(record.session+':')&&value!==record.session+':';
  if(!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'
    ||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('id_commit_occurrence_required');
  if(record.frontier)return fail(record.frontier);
  if(!origin||origin.status!=='resolved'||origin.runtime?.operation!=='id_used'||origin.runtime.session!==record.session
    ||origin.observation_id!==record.use_observation_id||origin.source.call_id!==record.source_call_id||origin.source.semantic_id!==record.semantic_id
    ||origin.runtime.id_proof?.read_source_id!==record.id_read_source_id||origin.runtime.id_proof?.property!==record.id_property
    ||origin.runtime.id_proof?.value!==record.value)return fail('id_property_use_required');
  if(!record.owner||!record.host||!['root_id','instance_id','mount_id','commit_id','type'].every(key=>typeof record.host[key]==='string'&&record.host[key])
    ||['root_id','instance_id','mount_id','render_id'].some(key=>record.owner[key]!==origin.runtime[key])
    ||record.host.root_id!==record.owner.root_id||!ownerKnown)return fail('id_committed_owner_required');
  return {schema:'producttrace.react-id-commit-join.v1',status:'resolved',reason:null,runtime_observed:true,
    observation_id:record.observation_id,source:{...origin.source},runtime:{claim:'observed_id_props_in_committed_host',
      use_observation_id:origin.observation_id,id_property:record.id_property,value:record.value,
      owner:{...record.owner},host:{...record.host},host_commit_proven:true,
      property_write_causality_proven:false,dom_attribute_value_proven:false,entity_identity_proven:false}};
}
