/** Observe the original descriptor and inputs. No extra container property read
 * or key coercion is allowed: both can execute application code. */
export function createReactPortalObserver(config) {
  let active=null;
  const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled() || !entry?.portal_rule)return run();
    const previous=active,values=[];
    const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));
      if(!row){row={value,id:config.id('portal_value')};values.push(row);}
      return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
    const frame={key,inputs:{},args:[],snapshot};active=frame;
    const record={manifest_key:key,observation_id:config.id('portal_return'),operation:'returned',inputs:frame.inputs};
    try {
      const result=run();record.result=snapshot(result);record.fields={};
      try {for(const field of ['$$typeof',entry.portal_rule.children_field,entry.portal_rule.container_field,'key','implementation']) {
        const descriptor=result && typeof result==='object'?Object.getOwnPropertyDescriptor(result,field):null;
        if(!descriptor || !Object.hasOwn(descriptor,'value')){record.frontier='portal_data_property_unobserved';continue;}
        record.fields[field]=snapshot(descriptor.value);
        if(field==='$$typeof')record.marker=typeof descriptor.value==='symbol'?Symbol.keyFor(descriptor.value)||null:null;
      }
      }catch(_){record.frontier='portal_descriptor_unobserved';}
      if(!record.frontier)config.registerCommit?.(entry,result,record,frame.args);
      return result;
    }catch(error){record.operation='threw';record.error=snapshot(error);throw error;}
    finally {active=previous;try{if(config.enabled())config.observe(record);}catch(_){};}
  };
  const argument=(key,index,value)=>{if(active?.key===key){active.args[index]=value;active.inputs[index]=active.snapshot(value);}return value;};
  return {portalCall:call,portalArgument:argument};
}
