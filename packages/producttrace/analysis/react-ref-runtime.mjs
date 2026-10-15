/** Shared call/cell observer. It returns the original ref and performs each
 * application property operation once; observing a write never reads it back. */
export function createReactRefObserver(config) {
  const cells=new WeakMap(),objects=new WeakMap();let active=null;
  const context=()=>config.context?.()||'default';
  const snapshotter=()=>{
    const values=[];
    return value=>{
      const object=value!==null && (typeof value==='object' || typeof value==='function');
      let identity;
      if(object && config.objectIdentity) identity=config.objectIdentity(value);
      else if(object) {
        let found=objects.get(value);
        if(!found || found.context!==context()){found={context:context(),id:config.id('ref_value')};objects.set(value,found);}
        identity=found.id;
      } else {
        let found=values.find(row=>Object.is(row.value,value));
        if(!found){found={value,id:config.id('ref_value')};values.push(found);}identity=found.id;
      }
      return {identity,kind:value===null?'null':typeof value,...config.encode(value)};
    };
  };
  const emit=(record,handle)=>{try{if(config.enabled())config.observe(record,handle);}catch(_){};};
  const cellFor=value=>{
    const cell=value!==null && (typeof value==='object' || typeof value==='function')?cells.get(value):null;
    return cell?.context===context()?cell:null;
  };
  const owner=handle=>{try{return config.describeOwner?.(handle)||null;}catch(_){return null;}};
  const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled() || !entry?.ref_rule)return run();
    const parent=active,snapshot=snapshotter(),observationId=config.id('ref_return');
    const frame={key,entry,snapshot,inputs:{}};active=frame;
    const record={manifest_key:key,observation_id:observationId,operation:'returned',inputs:frame.inputs};
    let ownerHandle=null;
    try {
      const value=run();record.value=snapshot(value);
      if(value!==null && typeof value==='object') {
        let cell=cellFor(value);record.previously_returned=Boolean(cell);
        if(!cell) {
          let handle=null;try{handle=config.captureOwner?.(entry)||null;}catch(_){}
          cell={context:context(),ref_id:config.id('ref'),source_call_id:entry.source_call_id,
            origin_observation_id:observationId,owner:handle};cells.set(value,cell);
        }
        Object.assign(record,{ref_id:cell.ref_id,origin_observation_id:cell.origin_observation_id,
          origin_source_call_id:cell.source_call_id,owner:owner(cell.owner)});
        ownerHandle=cell.owner;
        // Canonical React returns a data property. An altered API result may
        // not; do not execute a getter merely to construct a ref observation.
        try {
          const descriptor=Object.getOwnPropertyDescriptor(value,entry.ref_rule.property);
          if(descriptor && Object.hasOwn(descriptor,'value')) {
            record.current=snapshot(descriptor.value);
            record.descriptor={writable:descriptor.writable,enumerable:descriptor.enumerable,configurable:descriptor.configurable};
            record.sealed=Object.isSealed(value);
          } else record.frontier='ref_data_property_unobserved';
        } catch(_){record.frontier='ref_descriptor_unobserved';}
        // Retain the exact returned object for renderer-time ref attachment.
        // Registration is observational: an unavailable commit reader must
        // never change the application call or its returned ref object.
        try { config.registerRef?.(entry,value,record); }
        catch(_){record.frontier=record.frontier||'ref_commit_registration_unobserved';}
      } else record.frontier='ref_object_unobserved';
      return value;
    } catch(error){record.operation='threw';record.value=snapshot(error);throw error;}
    finally {active=parent;emit(record,ownerHandle);}
  };
  const argument=(key,index,value)=>{
    if(active?.key===key)active.inputs[index]=active.snapshot(value);
    return value;
  };
  const access=(key,target,value,write)=>{
    const entry=config.entry(key),property=entry?.ref_property||'current';
    if(!config.enabled() || !entry?.ref_access)return write?(target[property]=value):target[property];
    const cell=cellFor(target),snapshot=snapshotter();
    const record={manifest_key:key,observation_id:config.id('ref_access'),operation:write?'write':'read',
      ref_id:cell?.ref_id||null,origin_observation_id:cell?.origin_observation_id||null,
      origin_source_call_id:cell?.source_call_id||null,owner:owner(cell?.owner),action:config.action?.()||null,outcome:'returned'};
    try {const result=write?(target[property]=value):target[property];record.value=snapshot(result);return result;}
    catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
    finally {emit(record,cell?.owner);}
  };
  const method=(key,target)=>{
    const entry=config.entry(key),property=entry?.ref_property||'current';
    // Getting the property must precede argument evaluation. Calling the
    // resulting closure preserves the original reference's receiver even if an
    // argument changes current. It never reads current for a second time.
    if(!config.enabled() || !entry?.ref_access) {
      const value=target[property];return function(){return Reflect.apply(value,target,arguments);};
    }
    const cell=cellFor(target),snapshot=snapshotter(),base={manifest_key:key,
      ref_id:cell?.ref_id||null,origin_observation_id:cell?.origin_observation_id||null,
      origin_source_call_id:cell?.source_call_id||null,owner:owner(cell?.owner)};
    const read={...base,observation_id:config.id('ref_access'),operation:'read',
      action:config.action?.()||null,outcome:'returned'};
    let value;
    try {value=target[property];read.value=snapshot(value);
      try{read.callback=config.describeSource?.(value,entry.ref_callback_candidates)||null;}catch(_){read.callback=null;}}
    catch(error){read.outcome='threw';read.value=snapshot(error);throw error;}
    finally {emit(read,cell?.owner);}
    return function(){
      if(!config.enabled())return Reflect.apply(value,target,arguments);
      const record={...base,observation_id:config.id('ref_invoke'),operation:'invoke',
        read_observation_id:read.observation_id,callee:read.value,callback:read.callback,
        arguments:Array.from(arguments,snapshot),action:config.action?.()||null,outcome:'returned'};
      try {const result=Reflect.apply(value,target,arguments);record.value=snapshot(result);return result;}
      catch(error){record.outcome='threw';record.value=snapshot(error);throw error;}
      finally {emit(record,cell?.owner);}
    };
  };
  return {refCall:call,refArgument:argument,refRead:(key,target)=>access(key,target,undefined,false),
    refWrite:(key,target,value)=>access(key,target,value,true),refMethod:method};
}
