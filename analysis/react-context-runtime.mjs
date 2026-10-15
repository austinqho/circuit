/** Capture original context creation inputs and returned identity. Reads compare
 * original values without invoking them or inspecting an application's object. */
export function createReactContextObserver(config) {
  const definitions=new WeakMap(),objects=new WeakMap();let active=null;
  const context=()=>config.context?.()||'default';
  const snapshots=(seed=[])=>{
    const primitives=seed.slice();
    return value=>{
      const object=value!==null && (typeof value==='object' || typeof value==='function');let id;
      if(object) {
        let known=objects.get(value);
        if(!known || known.context!==context()){known={context:context(),id:config.id('context_value')};objects.set(value,known);}
        id=known.id;
      } else {
        let known=primitives.find(row=>Object.is(row.value,value));
        if(!known){known={value,id:config.id('context_value')};primitives.push(known);}id=known.id;
      }
      return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};
    };
  };
  const emit=record=>{try{if(config.enabled())config.observe(record);}catch(_){}};
  const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled() || !entry?.context_rule)return run();
    const parent=active,snapshot=snapshots(),frame={key,inputs:{},values:[],snapshot};active=frame;
    const record={manifest_key:key,observation_id:config.id('context_origin'),outcome:'returned',inputs:frame.inputs};
    try {
      const result=run();record.value=snapshot(result);
      if(result!==null && typeof result==='object') {
        const previous=definitions.get(result);record.previously_returned=previous?.context===context();
        const defaultValue=frame.values[entry.context_rule.default_argument];
        const definition={context:context(),identity:config.id('context_object'),origin:record.observation_id,
          source_context_id:entry.context_id,source_call_id:entry.source_call_id,defaultValue,defaultSnapshot:snapshot(defaultValue)};
        record.context_object_id=definition.identity;record.default_value=definition.defaultSnapshot;
        // A changed or noncanonical factory must not replace a known identity.
        if(!record.previously_returned)definitions.set(result,definition);
      }
      return result;
    } catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
    finally {active=parent;emit(record);}
  };
  const argument=(key,index,value)=>{
    if(active?.key===key){active.inputs[index]=active.snapshot(value);active.values[index]=value;}return value;
  };
  const read=(object,value,provider)=>{
    if(!config.enabled() || object===null || (typeof object!=='object' && typeof object!=='function'))return null;
    const definition=definitions.get(object);if(!definition || definition.context!==context())return null;
    const snapshot=snapshots([{value:definition.defaultValue,id:definition.defaultSnapshot.identity}]);
    const result={context_object_id:definition.identity,origin_observation_id:definition.origin,
      source_context_id:definition.source_context_id,source_call_id:definition.source_call_id,observed_value:snapshot(value)};
    if(provider===null)Object.assign(result,{selected_from:'default',selected_value:definition.defaultSnapshot});
    else if(provider && provider.status!=='unresolved')Object.assign(result,{selected_from:'provider',selected_value:snapshot(provider.raw_value)});
    else result.selected_from='unresolved';
    return result;
  };
  return {contextCall:call,contextArgument:argument,contextReadEvidence:read};
}
