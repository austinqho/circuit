/** Record original class render bodies without replacing the class, its render
 * method, or instances. Renderer context, rather than a matching class name,
 * selects the mounted owner. Reads are observed only where application code reads. */
export function createReactClassObserver(config) {
 let context=null,classes=new Map(),identities=new WeakMap(),instances=new WeakMap(),active=null,updating=null;
 const reset=()=>{const next=config.context?.()||'default';if(next!==context){context=next;classes=new Map();identities=new WeakMap();instances=new WeakMap();}return next;};
 const snapshot=value=>{let id=value!==null&&['object','function'].includes(typeof value)?identities.get(value):null;if(!id){id=config.id('class_value');if(value!==null&&['object','function'].includes(typeof value))identities.set(value,id);}
  return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};};
 // The compiler passes ReactCurrentOwner from the attested namespace import.
 // No global React singleton or application-supplied instance name is assumed.
 const register=(key,value,ownerRef)=>{
  if(!config.enabled())return value;reset();const entry=config.entry(key);if(!entry?.class_rule)return value;
  try{const base=Object.getPrototypeOf(value),prototype=Object.getOwnPropertyDescriptor(base,'prototype')?.value;
   const marker=prototype&&Object.getOwnPropertyDescriptor(prototype,'isPureReactComponent'),pure=marker?.value===true;
   if(typeof value!=='function'||!prototype||pure!==entry.class_rule.pure)return value;
   const observation_id=config.id('class_registration'),record={manifest_key:key,observation_id,operation:'registered',class_type:snapshot(value),base_type:snapshot(base),pure};
   const methods={};for(const name of ['setState','forceUpdate']){const method=Object.getOwnPropertyDescriptor(prototype,name)?.value;if(typeof method==='function')methods[name]=method;}
   record.methods=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,snapshot(method)]));
   classes.set(key,{value,ownerRef,record,context,methods});config.observe(record);
  }catch(_){}return value;
 };
 // Observe inside the original method, using its lexical receiver and arguments.
 // The active frame ends with this body, including nested renders and exceptions.
 const render=(key,receiver,run)=>{
  if(!config.enabled())return run();reset();const entry=config.entry(key),registered=classes.get(key);
  if(!entry?.class_rule||!registered)return run();const previous=active,frameContext=context;
  const record={manifest_key:key,observation_id:config.id('class_render'),operation:'returned',registration_id:registered.record.observation_id,
   class_type:registered.record.class_type,receiver:snapshot(receiver),reads:[]};
  try{const fiber=registered.ownerRef?.current;
   if(!fiber||fiber.tag!==1||fiber.type!==registered.value||fiber.stateNode!==receiver)record.frontier='class_renderer_owner_unobserved';
   else{record.owner=config.owner?.(fiber)||null;record.inputs={props:snapshot(fiber.pendingProps),state:snapshot(fiber.memoizedState)};instances.set(receiver,{registration_id:registered.record.observation_id,render_id:record.observation_id,owner:record.owner});}
  }catch(_){record.frontier='class_renderer_owner_unobserved';}
  const action=config.action?.();record.action=action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null;
  active={key,record,context:frameContext,props:registered.ownerRef?.current?.pendingProps,state:registered.ownerRef?.current?.memoizedState};
  try{const result=run();record.result=snapshot(result);return result;}
  catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
  finally{active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frameContext)config.observe(record);}catch(_){}}
 };
 const read=(key,sourceId,field,value)=>{if(config.enabled()&&active?.key===key&&(config.context?.()||'default')===active.context)active.record.reads.push({source_id:sourceId,field,input_match:Object.is(value,active[field]),value:Object.is(value,active[field])&&active.record.inputs?.[field]?active.record.inputs[field]:snapshot(value)});return value;};
 // Keep each update's callback closure attached to that exact call, even when
 // React runs it after the method returned. These are source-body observations;
 // they do not infer queue processing, state merging or a commit from a return.
 const emitUpdate=record=>{try{config.observeUpdate?.(record);}catch(_){}};
 const updateCall=(key,receiver,run)=>{
  if(!config.enabled())return run();reset();const entry=config.entry(key),registered=classes.get(entry?.class_key),origin=instances.get(receiver);
  if(!entry?.class_update_rule||!registered)return run();
  const previous=updating,frame={key,entry,registered,receiver,context,done:false,queued:[]};
  frame.record={manifest_key:key,observation_id:config.id('class_update'),operation:'returned',registration_id:registered.record.observation_id,
   instance_origin_id:origin?.render_id||null,receiver:snapshot(receiver),inputs:{},callbacks:[]};
  const action=config.action?.();frame.record.action=action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null;
  if(!origin||origin.registration_id!==registered.record.observation_id)frame.record.frontier='class_update_instance_unobserved';
  updating=frame;
  try{const result=run();frame.record.result=snapshot(result);return result;}
  catch(error){frame.record.operation='threw';frame.record.result=snapshot(error);throw error;}
  finally{updating=previous;frame.done=true;if(config.enabled()&&(config.context?.()||'default')===frame.context){emitUpdate(frame.record);for(const row of frame.queued)emitUpdate(row);}frame.queued=[];}
 };
 const updateMethod=(key,receiver,callee)=>{
  const frame=updating;
  if(config.enabled()&&frame?.key===key){frame.record.callee=snapshot(callee);if(callee!==frame.registered.methods[frame.entry.class_update_rule.member])frame.record.frontier='class_update_method_unconfirmed';}
  // The original method is read once, before its arguments, and receives the
  // original receiver. Application getters, exceptions and return values survive.
  return function(){return Reflect.apply(callee,receiver,arguments);};
 };
 const updateArgument=(key,index,value)=>{if(config.enabled()&&updating?.key===key)updating.record.inputs[index]=snapshot(value);return value;};
 const updateCallback=(key,index,factory)=>{
  const frame=updating,callback=frame?.entry.class_update_callbacks.find(row=>row.index===index);
  if(!config.enabled()||frame?.key!==key||!callback)return factory((_receiver,_args,run)=>run());
  let value;
  const observeBody=(receiver,args,run)=>{
   if(!config.enabled()||(config.context?.()||'default')!==frame.context)return run();
   const row={manifest_key:key,observation_id:config.id('class_update_callback'),operation:'callback_returned',request_id:frame.record.observation_id,
    index,source_id:callback.source_id,callback:snapshot(value),receiver:snapshot(receiver),arguments:Array.from(args,snapshot),arguments_complete:callback.body.kind==='function',
    receiver_basis:callback.body.kind==='function'?'call':'lexical',timing:frame.done?'after_method_return':'during_method_call'};
   try{const result=run();row.result=snapshot(result);return result;}
   catch(error){row.operation='callback_threw';row.result=snapshot(error);throw error;}
   finally{if(config.enabled()&&(config.context?.()||'default')===frame.context){if(frame.done)emitUpdate(row);else frame.queued.push(row);}}
  };
  value=factory(observeBody);frame.record.callbacks.push({index,source_id:callback.source_id,value:snapshot(value)});return value;
 };
 return {classRegister:register,classRender:render,classRead:read,classUpdateCall:updateCall,classUpdateMethod:updateMethod,classUpdateArgument:updateArgument,classUpdateCallback:updateCallback};
}
