/** Retain an observed React ref object until the renderer commits a host fiber
 * whose `ref` is that exact object and whose state node is the exact value React
 * wrote to `current`. No application getter is invoked and no value equality is
 * used to substitute another ref occurrence. */
export function createReactRefCommitObserver(config){
  let context=null,refs=new WeakMap(),items=[];
  const own=(value,key)=>{
    if(value===null||!['object','function'].includes(typeof value))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  };
  const refresh=()=>{const next=config.context();if(next!==context){context=next;refs=new WeakMap();items=[];}return next;};
  return {
    register(entry,value,record){
      if(!config.enabled()||!value||typeof value!=='object'||record.operation!=='returned'
        ||typeof record.ref_id!=='string'||typeof record.observation_id!=='string')return;
      refresh();let item=refs.get(value);
      if(!item){item={entry,record,ref:value,context,lastCommit:null,lastOwnerCommit:null};refs.set(value,item);if(items.length<512)items.push(item);}
      else {item.entry=entry;item.record=record;}
    },
    commitOwner(renderer){
      if(!config.enabled()||!renderer||!['root_id','instance_id','mount_id','render_id','commit_id'].every(key=>typeof renderer[key]==='string'&&renderer[key]))return;
      refresh();
      for(const item of items){const owner=item.record.owner;
        if(item.context!==context||!item.entry.hook_owned||!owner
          ||['root_id','instance_id','mount_id','render_id'].some(key=>owner[key]!==renderer[key]))continue;
        const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.render_id,renderer.commit_id].join('\0');
        if(item.lastOwnerCommit===stamp)continue;item.lastOwnerCommit=stamp;
        config.observe({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
          manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
          surface:item.entry.surface,export:item.entry.export,source_access_id:null,
          observation_id:config.id('ref_hook_commit'),operation:'hook_committed',ref_id:item.record.ref_id,
          origin_observation_id:item.record.origin_observation_id,origin_source_call_id:item.entry.source_call_id,
          value:config.snapshot(item.ref),renderer:{...renderer},
          reason:'The exact observed hook ref object belonged to this exact component render when React committed it.'});
      }
    },
    commit(fiber,renderer){
      if(!config.enabled()||!renderer||!['root_id','instance_id','mount_id','commit_id'].every(key=>typeof renderer[key]==='string'&&renderer[key]))return;
      refresh();const ref=own(fiber,'ref'),item=ref&&typeof ref==='object'?refs.get(ref):null;
      if(!item||item.context!==context)return;
      const host=own(fiber,'stateNode'),current=own(ref,item.entry.ref_rule.property);
      if(!host||current!==host)return;
      const stamp=[renderer.root_id,renderer.instance_id,renderer.mount_id,renderer.commit_id].join('\0');
      if(item.lastCommit===stamp)return;item.lastCommit=stamp;
      config.observe({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
        manifest_key:item.entry.key,source_call_id:item.entry.source_call_id,semantic_id:item.entry.semantic_id,
        surface:item.entry.surface,export:item.entry.export,source_access_id:null,
        observation_id:config.id('ref_commit'),operation:'host_attached',ref_id:item.record.ref_id,
        origin_observation_id:item.record.origin_observation_id,origin_source_call_id:item.entry.source_call_id,
        value:config.snapshot(host),renderer:{...renderer},
        reason:'The committed host fiber retained this exact observed ref object and React had written the exact host node to its current data property.'});
    },
  };
}
