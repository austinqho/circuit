/** Observe original server component bodies, returned resources, and the
 * application's own consumption operations. Instrumentation never replaces a
 * stream, promise, destination, iterator, or event-listener function. */
export function createReactServerObserver(config) {
 let active=null;
 const objectIds=new WeakMap(),resources=new WeakMap(),destinations=new WeakMap();
 const objectIdentity=value=>{let id=objectIds.get(value);if(!id){id=config.id('server_value');objectIds.set(value,id);}return id;};
 const snapshot=(value,local=[])=>{
  if((typeof value==='object'&&value!==null)||typeof value==='function')return {identity:objectIdentity(value),kind:typeof value,...config.encode(value)};
  let row=local.find(row=>Object.is(row.value,value));if(!row){row={value,id:config.id('server_value')};local.push(row);}
  return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};
 };
 const consumer=(key,kind)=>{const entry=config.entry(key);return config.enabled()&&entry?.kind==='server_consumer'&&entry.server_consumer_kind===kind?entry:null;};
 const retainOwnership=(index,value,owned)=>{
  if(!value||!((typeof value==='object')||typeof value==='function'))return;
  if(!index.has(value))index.set(value,owned);
  else if(index.get(value)!==owned)index.set(value,null);
 };
 const origin=value=>value&&((typeof value==='object'&&value!==null)||typeof value==='function')?(resources.get(value)||destinations.get(value)):null;
 const observeConsumer=(entry,owned,operation,extra={})=>{
  if(!entry||!owned)return;
  const observationId=config.id('server_consumer');
  try{config.observe({manifest_key:owned.key,observation_id:observationId,operation,
    creation_observation_id:owned.creation_observation_id,consumer_manifest_key:entry.key,
    consumer_source_id:entry.server_consumer_source_id,consumer_kind:entry.server_consumer_kind,
    evidence_ids:[observationId,owned.creation_observation_id],...extra});}catch(_){}
 };
 const call=(key,run)=>{
  const entry=config.entry(key);if(!config.enabled()||!entry?.server_rule)return run();
  const previous=active,values=[],describe=value=>snapshot(value,values);
  const record={manifest_key:key,observation_id:config.id('server_render'),operation:'returned',inputs:{},invocations:[]};
  const frame={key,entry,record,snapshot:describe,context:config.context?.()||'default',phase:'arguments'};active=frame;
  if(entry.server_rule.kind==='pipeable_server_stream')record.async_context_basis=config.asyncContextBasis||null;
  try{
   const result=entry.server_rule.kind==='pipeable_server_stream'&&config.runInContext?config.runInContext(frame,run):run();
   record.result={...describe(result),encoding:'redacted',value:null};
   if(result&&((typeof result==='object')||typeof result==='function'))retainOwnership(resources,result,{key,kind:entry.server_rule.kind,
    creation_observation_id:record.observation_id,result:record.result});
   return result;
  }
  catch(error){record.operation='threw';record.result=describe(error);throw error;}
  finally{frame.phase='returned';active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);}catch(_){}}
 };
 const argument=(key,index,value)=>{
  const frame=active;if(frame?.key!==key)return value;
  frame.record.inputs[index]=frame.snapshot(value);
  if(index===frame.entry.server_rule.element_argument){
   const data=name=>{const property=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,name):null;
    if(!property||!Object.hasOwn(property,'value'))throw Error('server element data unavailable');return property.value;};
   try{if(data('$$typeof')!==Symbol.for('react.element'))throw Error('server input is not an element');
    frame.record.element={identity:frame.record.inputs[index].identity,type:frame.snapshot(data('type')),props:frame.snapshot(data('props'))};
   }catch(_){frame.record.frontier='server_root_element_unobserved';}
  }
  // Arguments may themselves call the component. Only enter the renderer phase
  // after the final argument finishes, so such calls cannot borrow this cause.
  if(index===frame.entry.server_argument_count-1)frame.phase='renderer';
  return value;
 };
 const component=(sourceId,self,args)=>{
  const frame=active||config.currentContext?.();if(!config.enabled()||!frame||(config.context?.()||'default')!==frame.context)return;
  const asynchronous=frame.entry.server_rule.kind==='pipeable_server_stream'&&frame.phase==='returned'&&frame.record.operation==='returned'&&config.currentContext?.()===frame;
  if(frame.phase!=='renderer'&&!asynchronous)return;
  if(!frame.entry.server_component||sourceId!==frame.entry.server_component.source_id)return;
  const invocation={observation_id:config.id('server_component'),source_id:sourceId,callee:frame.snapshot(self),props:frame.snapshot(args[0]),
   timing:asynchronous?'asynchronous':'synchronous',root_input_match:frame.record.element?.type.identity===frame.snapshot(self).identity
    &&frame.record.element?.props.identity===frame.snapshot(args[0]).identity};
  if(asynchronous){
   try{config.observe({...frame.record,observation_id:config.id('server_async_body'),creation_observation_id:frame.record.observation_id,
    operation:'component_entered',invocations:[invocation]});}catch(_){}
  }else frame.record.invocations.push(invocation);
 };
 const serverPromiseFulfilled=(key,promise,value)=>{
  const entry=consumer(key,'await_binding'),owned=origin(promise);
  if(entry&&owned?.kind==='readable_server_stream'&&value&&((typeof value==='object')||typeof value==='function')){
   retainOwnership(resources,value,owned);observeConsumer(entry,owned,'promise_fulfilled',{promise:snapshot(promise),resource:snapshot(value)});
  }
  return value;
 };
 const serverPipe=(key,resource,destination,invoke)=>{
  const entry=consumer(key,'pipe'),owned=origin(resource);
  if(!entry||owned?.kind!=='pipeable_server_stream')return invoke(resource,destination);
  retainOwnership(destinations,destination,owned);
  try{const result=invoke(resource,destination);observeConsumer(entry,owned,'pipe_started',{resource:snapshot(resource),destination:snapshot(destination)});return result;}
  catch(error){if(destination&&destinations.get(destination)===owned)destinations.delete(destination);
   observeConsumer(entry,owned,'pipe_failed',{resource:snapshot(resource),destination:snapshot(destination),error:snapshot(error)});throw error;}
 };
 const serverEvent=(key,resource,event)=>{
  const entry=consumer(key,'event'),owned=origin(resource);if(!entry||entry.server_consumer_event!==event||!owned)return;
  const operation=event==='end'||event==='finish'?'stream_completed':event==='error'?'stream_errored':'stream_closed';
  observeConsumer(entry,owned,operation,{resource:snapshot(resource),event});
 };
 const serverIteration=(key,resource,outcome)=>{
  const entry=consumer(key,'async_iteration'),owned=origin(resource);if(!entry||!owned)return;
  observeConsumer(entry,owned,outcome==='completed'?'stream_completed':'consumer_failed',{resource:snapshot(resource),consumer_outcome:outcome});
 };
 return {serverCall:call,serverArgument:argument,serverComponent:component,
  serverPromiseFulfilled,serverPipe,serverEvent,serverIteration};
}
