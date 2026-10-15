/** Observe the original descriptor and inputs. Do not reread
 * configuration properties or coerce keys: those can execute application code. */
export function createReactElementObserver(config) {
  let active=null,context=null,identities=new WeakMap(),symbols=new Map();
  // Subscribe only to an unmodified Promise from this realm. Calling an
  // arbitrary thenable would execute application code and change its behavior.
  const nativePromiseThen=value=>{
    if(typeof Promise!=='function'||!value||typeof value!=='object')return null;
    let prototype,then;
    try{prototype=Object.getPrototypeOf(value);then=Object.getOwnPropertyDescriptor(Promise.prototype,'then');}catch(_){return null;}
    return prototype===Promise.prototype&&then&&Object.hasOwn(then,'value')&&typeof then.value==='function'
      &&/^function\s+then\(\)\s+\{\s+\[native code\]\s+\}$/u.test(Function.prototype.toString.call(then.value))?then.value:null;
  };
  // React installs its Promise listener inside the loader call. Deferring ours
  // preserves that registration order while retaining the same Promise object.
  const defer=typeof config.deferSettlement==='function'?config.deferSettlement:run=>queueMicrotask(run);
  const emit=record=>{try{if(config.enabled()&&(config.context?.()||'default')===record.context){const {context:_,...publicRecord}=record;config.observe(publicRecord);}}catch(_){}};
  const call=(key,run)=>{
    const entry=config.entry(key);if(!config.enabled() || !entry?.element_rule)return run();
    const nextContext=config.context?.()||'default';if(nextContext!==context){context=nextContext;identities=new WeakMap();symbols=new Map();}
    const previous=active,values=[];
    const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));
      if(!row){const reference=value!==null&&['object','function'].includes(typeof value);let id=reference&&config.objectIdentity?config.objectIdentity(value):reference?identities.get(value):typeof value==='symbol'?symbols.get(value):null;
        if(!id){id=config.id('element_value');if(reference)identities.set(value,id);else if(typeof value==='symbol'&&symbols.size<128)symbols.set(value,id);}row={value,id};values.push(row);}
      return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
    const frame={key,entry,context:nextContext,inputs:{},propertyInputs:[],snapshot};active=frame;
    const record={manifest_key:key,observation_id:config.id('element_return'),operation:'returned',
      inputs:frame.inputs,property_inputs:frame.propertyInputs};
    frame.record=record;
    try {
      const result=run();record.result=snapshot(result);record.fields={};
      if(entry.element_rule.kind==='lazy_component'){
        try {
          const data=(object,name)=>{const property=Object.getOwnPropertyDescriptor(object,name);return property&&Object.hasOwn(property,'value')?property.value:undefined;};
          const payload=data(result,'_payload');
          if(data(result,'$$typeof')!==Symbol.for('react.lazy')||data(payload,'_status')!==-1||data(payload,'_result')!==frame.loader){record.frontier='lazy_initial_payload_unobserved';return result;}
          record.marker='react.lazy';frame.lazyIdentity=record.result.identity;frame.lazyObject=result;
          try{config.registerLazy?.(entry,result,record);}catch(_){record.frontier='lazy_registration_unobserved';}
        }catch(_){record.frontier='lazy_initial_payload_unobserved';}
        return result;
      }
      // React's development factory has an observable deprecated `.type`
      // getter. Record the original function identity without reading it.
      if(entry.element_rule.kind==='element_factory'&&!entry.factory_producer_call_id)return result;
      try {for(const field of ['$$typeof','type','props','key','ref','_owner']) {
        const descriptor=result && typeof result==='object'?Object.getOwnPropertyDescriptor(result,field):null;
        if(!descriptor || !Object.hasOwn(descriptor,'value')){record.frontier='element_data_property_unobserved';continue;}
        record.fields[field]=snapshot(descriptor.value);
        if(field==='$$typeof')record.marker=typeof descriptor.value==='symbol'?Symbol.keyFor(descriptor.value)||null:null;
      }
      }catch(_){record.frontier='element_descriptor_unobserved';}
      try {
        const props=Object.getOwnPropertyDescriptor(result,'props');
        record.property_outputs={};
        for(const input of entry.element_property_inputs||[]){
          if(input.target!=='props'||Object.hasOwn(record.property_outputs,input.name))continue;
          const descriptor=props&&Object.hasOwn(props,'value')&&props.value&&typeof props.value==='object'
            ?Object.getOwnPropertyDescriptor(props.value,input.name):null;
          record.property_outputs[input.name]=descriptor&&Object.hasOwn(descriptor,'value')?snapshot(descriptor.value):null;
        }
      }catch(_){record.frontier='element_property_output_unobserved';}
      try{config.registerDescriptor?.(entry,result,record);}catch(_){record.frontier='descriptor_registration_unobserved';}
      return result;
    }catch(error){record.operation='threw';record.error=snapshot(error);throw error;}
    finally {active=previous;try{if(config.enabled())config.observe(record);}catch(_){};}
  };
  const argument=(key,index,value)=>{
    if(active?.key!==key)return value;
    const frame=active;frame.inputs[index]=frame.snapshot(value);
    for(const input of frame.entry.element_property_inputs||[]){
      if(input.input_index!==index)continue;
      if(input.argument_value)frame.propertyInputs.push({...input,value:frame.inputs[index]});
      else {
        const descriptor=value&&['object','function'].includes(typeof value)?Object.getOwnPropertyDescriptor(value,input.name):null;
        frame.propertyInputs.push({...input,value:descriptor&&Object.hasOwn(descriptor,'value')?frame.snapshot(descriptor.value):null});
      }
    }
    if(frame.entry.element_rule.kind!=='lazy_component'||index!==frame.entry.element_rule.loader_argument)return value;
    frame.loader=value;
    if(typeof value!=='function')return value;
    frame.loader=function(){
      if(!config.enabled()||(config.context?.()||'default')!==frame.context)return value.apply(this,arguments);
      const observation={manifest_key:key,observation_id:config.id('lazy_loader'),operation:'loader_returned',
        context:frame.context,
        creation_observation_id:frame.record.observation_id,lazy_identity:frame.lazyIdentity,
        loader_identity:frame.inputs[index].identity,source_id:frame.entry.lazy_loader_source_id,
        arguments:Array.from(arguments,frame.snapshot)};
      let result,then;
      try{result=value.apply(this,arguments);observation.result=frame.snapshot(result);then=nativePromiseThen(result);
        if(then)observation.thenable_protocol='native_promise.v1';
        else observation.settlement_frontier='lazy_thenable_not_exact_native_promise';
        return result;}
      catch(error){observation.operation='loader_threw';observation.result=frame.snapshot(error);throw error;}
      finally{
        emit(observation);
        if(observation.operation==='loader_returned')try{config.loadLazy?.(frame.entry,frame.lazyObject,result,observation,config.currentFiber?.());}catch(_){}
        if(then)try{defer(()=>{
          try{then.call(result,value=>{const settlement={manifest_key:key,context:frame.context,
              observation_id:config.id('lazy_settlement'),operation:'loader_fulfilled',
              creation_observation_id:frame.record.observation_id,loader_observation_id:observation.observation_id,
              lazy_identity:frame.lazyIdentity,loader_identity:frame.inputs[index].identity,
              thenable_identity:observation.result.identity,source_id:frame.entry.lazy_loader_source_id,result:frame.snapshot(value)};
            emit(settlement);try{config.settleLazy?.(frame.entry,frame.lazyObject,value,settlement);}catch(_){};},
            error=>{const settlement={manifest_key:key,context:frame.context,
              observation_id:config.id('lazy_settlement'),operation:'loader_rejected',
              creation_observation_id:frame.record.observation_id,loader_observation_id:observation.observation_id,
              lazy_identity:frame.lazyIdentity,loader_identity:frame.inputs[index].identity,
              thenable_identity:observation.result.identity,source_id:frame.entry.lazy_loader_source_id,result:frame.snapshot(error)};
              emit(settlement);try{config.settleLazy?.(frame.entry,frame.lazyObject,error,settlement);}catch(_){};});
          }catch(_){}}
        );}catch(_){}
      }
    };
    return frame.loader;
  };
  const target=(key,value)=>{if(active?.key===key)active.record.target=active.snapshot(value);return value;};
  return {elementCall:call,elementArgument:argument,elementTarget:target};
}
